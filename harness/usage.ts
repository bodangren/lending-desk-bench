/**
 * Usage extraction for one run. Two parsers live here:
 *
 *   - `extractUsage` reads a pi JSONL session log. It stays for legacy regrades.
 *   - `extractOpenCodeUsage` reads the OpenCode session export. It is the usage
 *     source of the graded executor (spec FR-7, design.md section 4).
 *
 * The OpenCode event stream is a cross-check only. It never feeds a usage record.
 */
import { existsSync, createReadStream, closeSync, openSync, readSync, readFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, basename } from "node:path";
import { createGunzip, gunzipSync } from "node:zlib";

export type Usage = {
  input: number; output: number; cacheRead: number; cacheWrite: number;
  totalTokens: number; costUsd: number; assistantTurns: number;
  toolCalls: number; turns: number; logBytes: number;
  model: string | null; provider: string | null;
};

/** The session export path inside a run's artifacts tree. */
export const OPENCODE_EXPORT_PATH = ["executor", "session-export.json"];

/** A usage source that cannot be read. The run is invalid when this happens. */
export class UsageSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageSourceError";
  }
}

/** A zeroed usage record. */
export function emptyUsage(): Usage {
  return {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    costUsd: 0, assistantTurns: 0, toolCalls: 0, turns: 0, logBytes: 0,
    model: null, provider: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** The cost rounding of the pi parser: multiply by 1e6, round, divide back. */
function roundCost(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function isDirectory(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
}

/** Extract time-on-task, token counts and cost from a pi JSONL session log. */
export async function extractUsage(path: string): Promise<Usage> {
  const u: Usage = emptyUsage();
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
  u.costUsd = roundCost(u.costUsd);
  return u;
}

/**
 * Read the OpenCode session export and map it onto the Usage shape
 * (design.md section 4.4). The file may be plain JSON or gzip.
 *
 * The token totals come from `info.tokens` only. The message bodies are never
 * read for tokens: the parser counts message kinds and tool parts.
 */
export async function extractOpenCodeUsage(path: string): Promise<Usage> {
  const source = resolveExportSource(path);
  const bytes = readFileSync(source);
  if (bytes.length === 0) throw new UsageSourceError(`the session export is empty: ${source}`);
  const text = decompressExport(source, bytes);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UsageSourceError(`the session export is not valid JSON: ${source}`);
  }
  if (!isRecord(parsed)) throw new UsageSourceError(`the session export is not a JSON object: ${source}`);
  const info = parsed.info;
  if (!isRecord(info)) throw new UsageSourceError(`the session export has no info object: ${source}`);
  const tokens = info.tokens;
  if (!isRecord(tokens)) throw new UsageSourceError(`the session export has no info.tokens object: ${source}`);

  const cache = isRecord(tokens.cache) ? tokens.cache : {};
  const model = isRecord(info.model) ? info.model : {};
  const input = num(tokens.input);
  const output = num(tokens.output);
  const reasoning = num(tokens.reasoning);
  const cacheRead = num(cache.read);
  const cacheWrite = num(cache.write);

  const usage: Usage = {
    ...emptyUsage(),
    input,
    // The reasoning tokens count as output tokens (spec FR-7).
    output: output + reasoning,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + reasoning + cacheRead + cacheWrite,
    costUsd: roundCost(num(info.cost)),
    logBytes: bytes.length,
    model: typeof model.id === "string" ? model.id : null,
    provider: typeof model.providerID === "string" ? model.providerID : null,
  };
  countMessages(parsed.messages, usage);
  return usage;
}

/** The export file to read: the given file, its gzip form, or the artifacts default. */
function resolveExportSource(path: string): string {
  const base = isDirectory(path) ? join(path, ...OPENCODE_EXPORT_PATH) : path;
  if (existsSync(base)) return base;
  const gz = `${base}.gz`;
  if (existsSync(gz)) return gz;
  throw new UsageSourceError(`the session export is missing: ${base}`);
}

/** The export text. A gzip file must hold valid gzip and valid JSON inside it. */
function decompressExport(source: string, bytes: Buffer): string {
  const gzipped = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (gzipped) {
    try {
      return gunzipSync(bytes).toString("utf8");
    } catch {
      throw new UsageSourceError(`the session export is not valid gzip: ${source}`);
    }
  }
  if (source.endsWith(".gz")) throw new UsageSourceError(`the session export is not valid gzip: ${source}`);
  return bytes.toString("utf8");
}

/** Count the message kinds only. The message bodies never carry token counts. */
function countMessages(messages: unknown, usage: Usage): void {
  if (!Array.isArray(messages)) return;
  for (const message of messages) {
    if (!isRecord(message)) continue;
    if (message.type === "user") {
      usage.turns += 1;
      continue;
    }
    if (message.type !== "assistant") continue;
    usage.assistantTurns += 1;
    if (!Array.isArray(message.parts)) continue;
    for (const part of message.parts) if (isRecord(part) && part.type === "tool") usage.toolCalls += 1;
  }
}

/** True when the file head is a JSON object whose first key is "info". */
function isSessionExportHead(head: string): boolean {
  return /^\s*\{\s*"info"\s*:/.test(head);
}

/** The first bytes of a file as text, gunzipped when the bytes are gzip. */
async function headText(path: string): Promise<string> {
  const handle = openSync(path, "r");
  let bytes: Buffer;
  try {
    const buffer = Buffer.alloc(4096);
    const read = readSync(handle, buffer, 0, buffer.length, 0);
    bytes = buffer.subarray(0, read);
  } finally {
    closeSync(handle);
  }
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return await gunzipHead(path);
  return bytes.toString("utf8");
}

/** The first decompressed bytes of a gzip file. */
async function gunzipHead(path: string): Promise<string> {
  const source = createReadStream(path);
  const gunzip = createGunzip();
  source.on("error", () => {});
  gunzip.on("error", () => {});
  source.pipe(gunzip);
  let head = "";
  try {
    for await (const chunk of gunzip) {
      head = (chunk as Buffer).toString("utf8");
      break;
    }
  } catch {
    head = "";
  }
  source.destroy();
  gunzip.destroy();
  return head;
}

/**
 * The usage record of one run. An artifacts directory resolves the OpenCode
 * session export first and the pi transcript second. A file is read with the
 * parser its name and content select.
 */
export async function usageForPath(path: string, mode: "auto" | "export" | "pi" = "auto"): Promise<Usage> {
  if (mode === "export") return extractOpenCodeUsage(path);
  if (mode === "pi") return extractUsage(path);
  if (isDirectory(path)) {
    const exportPath = join(path, ...OPENCODE_EXPORT_PATH);
    if (existsSync(exportPath) || existsSync(`${exportPath}.gz`)) return extractOpenCodeUsage(exportPath);
    return extractUsage(join(path, "session.json"));
  }
  if (isExportName(path)) return extractOpenCodeUsage(path);
  if (!existsSync(path) && !existsSync(`${path}.gz`)) return extractUsage(path);
  const source = existsSync(path) ? path : `${path}.gz`;
  const head = await headText(source);
  if (isSessionExportHead(head)) return extractOpenCodeUsage(source);
  return extractUsage(source);
}

/** True for the session export file name, with or without the gzip suffix. */
function isExportName(path: string): boolean {
  return basename(path).replace(/\.gz$/, "") === "session-export.json";
}

if (process.argv[1]?.endsWith("usage.ts")) {
  const args = process.argv.slice(2);
  const mode = args[0] === "--export" ? "export" : args[0] === "--pi" ? "pi" : "auto";
  const target = mode === "auto" ? args[0] : args[1];
  if (!target) {
    console.error("usage: usage.ts [--export|--pi] <artifacts-dir|session-export|session-transcript>");
    process.exit(2);
  }
  usageForPath(target, mode)
    .then((u) => console.log(JSON.stringify(u, null, 2)))
    .catch((error) => {
      console.error(`usage.ts: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(2);
    });
}
