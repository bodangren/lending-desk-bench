/** Extract time-on-task, token counts and cost from a pi JSONL session log. */
import { existsSync, createReadStream, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";

export type Usage = {
  input: number; output: number; cacheRead: number; cacheWrite: number;
  totalTokens: number; costUsd: number; assistantTurns: number;
  toolCalls: number; turns: number; logBytes: number;
  model: string | null; provider: string | null;
};

export async function extractUsage(path: string): Promise<Usage> {
  const u: Usage = {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    costUsd: 0, assistantTurns: 0, toolCalls: 0, turns: 0, logBytes: 0,
    model: null, provider: null,
  };
  // run.sh gzips the transcript once scoring is done (a-deepseek-v4-flash produced a
  // 939MB session.json, and the matrix runs each model ten times). Accept either form
  // so a standalone regrade still reports usage.
  const gz = `${path}.gz`;
  const src = existsSync(path) ? path : existsSync(gz) ? gz : null;
  if (!src) return u;

  // pi repeats the full message on every message_update, so these logs reach ~1GB.
  // Stream instead of readFileSync, and skip update lines before parsing them.
  u.logBytes = statSync(src).size;
  const stream = src.endsWith(".gz")
    ? createReadStream(src).pipe(createGunzip())
    : createReadStream(src, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (!line.includes('"message_end"') && !line.includes('"turn_end"')) continue;
    let ev: any;
    try { ev = JSON.parse(line); } catch { continue; }

    // Only message_end carries the final usage for a turn; message_update repeats it.
    if (ev.type === "turn_end") u.turns += 1;
    if (ev.type === "message_end" && ev.message?.role === "assistant") {
      const m = ev.message;
      u.provider ??= m.provider ?? null;
      u.model ??= m.model ?? null;
      u.assistantTurns += 1;
      const g = m.usage ?? {};
      u.input += g.input ?? 0;
      u.output += g.output ?? 0;
      u.cacheRead += g.cacheRead ?? 0;
      u.cacheWrite += g.cacheWrite ?? 0;
      u.totalTokens += g.totalTokens ?? 0;
      u.costUsd += g.cost?.total ?? 0;
      for (const c of m.content ?? []) if (c.type === "toolCall") u.toolCalls += 1;
    }
  }
  u.costUsd = Math.round(u.costUsd * 1e6) / 1e6;
  return u;
}

if (process.argv[1]?.endsWith("usage.ts")) {
  extractUsage(process.argv[2]).then((u) => console.log(JSON.stringify(u, null, 2)));
}
