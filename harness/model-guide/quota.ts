/**
 * The quota sources of the review routes (spec D15, FR-15; plan task 4.4).
 *
 * Usage:
 *   cd harness && npx tsx model-guide/quota.ts --provider <quota_provider> \
 *     [--base <http://127.0.0.1:port>]
 *
 * `--provider` takes the `quota_provider` value of one row of
 * `harness/model-guide/routes.json`. The base is `--base`, else
 * `BENCH_QUOTA_BASE`, else the port of `openchamber status --json`
 * (`instances[0].port`).
 *
 * The four providers with a quota source read `GET /api/quota/<id>`:
 *
 *   claude-code            -> claude
 *   kimi-code-plan-cn      -> kimi-for-coding
 *   minimax-cn-coding-plan -> minimax-cn-coding-plan
 *   opencode-go            -> opencode-go
 *
 * `nvidia`, `bailian-token-plan`, `volcengine-agent-plan`, and `opencode`
 * have no quota source. The tool sends no request, gives `ready`, and gives
 * the cap 1 (one pass per night, spec D15). A provider with a source gives
 * the cap 3 (N of spec D13).
 *
 * stdout holds one JSON line:
 *
 *   {"provider":"...","source":"...","state":"...","cap":N,
 *    "windows":{"5h":V,"day":V,"week":V}}
 *
 * `state` is `ready`, `wait`, or `stopped`. `ready` means every window is
 * below 70. `wait` means a window is 70 or more. On `stopped`, stderr holds
 * exactly one line `quota: <reason>`. The tool exits 0 for every state. Exit
 * 2 is for a bad flag.
 *
 * The read has a timeout of 5 s, below the 10 s bound of the contract. The
 * whole answer is parsed, so a 2 MiB body with 200 windows works.
 *
 * This tool reads no credential and no real home folder. It sends one
 * loopback request to the quota source and nothing else.
 */

import { spawnSync } from "node:child_process";
import { request } from "node:http";

/** The window value that moves a route to `wait` (spec D15). */
const WAIT_PERCENT = 70;

/** The bound of one quota read, in milliseconds. */
const READ_TIMEOUT_MS = 5_000;

/** The bound of the port source, in milliseconds. */
const PORT_TIMEOUT_MS = 10_000;

/** The cap of a provider with a quota source: N of spec D13. */
const SOURCED_CAP = 3;

/** The cap of a provider with no quota source: one pass per night. */
const UNSOURCED_CAP = 1;

/** The `<id>` of each provider with a quota source (spec D15). */
const SOURCE_IDS: Record<string, string> = {
  "claude-code": "claude",
  "kimi-code-plan-cn": "kimi-for-coding",
  "minimax-cn-coding-plan": "minimax-cn-coding-plan",
  "opencode-go": "opencode-go",
};

/** The providers with no quota source (spec D15). */
const NO_SOURCE = ["nvidia", "bailian-token-plan", "volcengine-agent-plan", "opencode"];

/** The answer of the tool. */
interface QuotaDoc {
  provider: string;
  source: string | null;
  state: "ready" | "wait" | "stopped";
  cap: number;
  windows: Record<string, number>;
}

/** One parsed quota answer, or the reason of a stop. */
type QuotaRead = { ok: true; windows: Record<string, number> } | { ok: false; reason: string };

/** Prints the JSON line of the answer. */
function emit(doc: QuotaDoc): void {
  process.stdout.write(`${JSON.stringify(doc)}\n`);
}

/** Prints one named line and exits 2: a bad flag. */
function refuse(reason: string): never {
  process.stderr.write(`quota: ${reason}\n`);
  process.exit(2);
}

/** Gives the `stopped` state with one named line, then exits 0. */
function stop(provider: string, source: string | null, reason: string): never {
  emit({ provider, source, state: "stopped", cap: SOURCED_CAP, windows: {} });
  process.stderr.write(`quota: ${reason}\n`);
  process.exit(0);
}

/** Reads the flags of one run. */
function parseArgs(argv: string[]): { provider: string; base: string } {
  let provider = "";
  let base = "";
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--provider" || flag === "--base") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) refuse(`${flag} needs a value`);
      if (flag === "--provider") provider = value;
      else base = value;
      index += 1;
      continue;
    }
    refuse(`unknown flag ${flag}`);
  }
  if (provider === "") refuse("--provider is required");
  return { provider, base };
}

/** A port value of 1 to 65535, from an integer or a digit string. */
function usablePort(value: unknown): number | null {
  let port: number;
  if (typeof value === "number") {
    port = value;
  } else if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    port = Number(value);
  } else {
    return null;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}

/** The base of the port source, or the reason of a stop. */
function baseFromPortSource(): { ok: true; base: string } | { ok: false; reason: string } {
  const result = spawnSync("openchamber", ["status", "--json"], {
    encoding: "utf8",
    timeout: PORT_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) return { ok: false, reason: "openchamber status failed" };
  const text = String(result.stdout ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return { ok: false, reason: "openchamber status printed no JSON object" };
  let doc: unknown;
  try {
    doc = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { ok: false, reason: "openchamber status printed invalid JSON" };
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, reason: "openchamber status printed no JSON object" };
  }
  const instances = (doc as { instances?: unknown }).instances;
  if (!Array.isArray(instances) || instances.length === 0) {
    return { ok: false, reason: "openchamber status holds no instance" };
  }
  const first = instances[0];
  if (first === null || typeof first !== "object") {
    return { ok: false, reason: "openchamber status holds no instance" };
  }
  const port = usablePort((first as { port?: unknown }).port);
  if (port === null) return { ok: false, reason: "openchamber status holds no usable port" };
  return { ok: true, base: `http://127.0.0.1:${port}` };
}

/** Reads one quota answer. It never rejects. */
function readQuota(url: string): Promise<QuotaRead> {
  return new Promise<QuotaRead>((done) => {
    let settled = false;
    const finish = (answer: QuotaRead): void => {
      if (settled) return;
      settled = true;
      done(answer);
    };
    let req: ReturnType<typeof request>;
    try {
      req = request(url, { method: "GET", headers: { accept: "application/json" } });
    } catch {
      finish({ ok: false, reason: "the quota source URL is invalid" });
      return;
    }
    req.setTimeout(READ_TIMEOUT_MS, () => {
      req.destroy();
      finish({ ok: false, reason: "the quota read timed out" });
    });
    req.on("error", (error: NodeJS.ErrnoException) => {
      const reason = error.code === "ECONNREFUSED" ? "the quota source refused the read" : "the quota read failed";
      finish({ ok: false, reason });
    });
    req.on("response", (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      res.on("error", () => {
        finish({ ok: false, reason: "the quota read failed" });
      });
      res.on("end", () => {
        const status = res.statusCode ?? 0;
        if (status !== 200) {
          finish({ ok: false, reason: `the quota source answered ${status}` });
          return;
        }
        finish(parseAnswer(Buffer.concat(chunks).toString("utf8")));
      });
    });
    req.end();
  });
}

/** Parses the body of one quota answer. */
function parseAnswer(body: string): QuotaRead {
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch {
    return { ok: false, reason: "the quota answer is not JSON" };
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, reason: "the quota answer is not a JSON object" };
  }
  const root = doc as { error?: unknown; usage?: unknown };
  if (root.error !== undefined && root.error !== null) {
    const text = typeof root.error === "string" ? root.error : "quota error";
    return { ok: false, reason: `the quota source reported an error: ${text}` };
  }
  const usage = root.usage;
  if (usage === null || typeof usage !== "object" || Array.isArray(usage)) {
    return { ok: false, reason: "the quota answer holds no usage" };
  }
  const rawWindows = (usage as { windows?: unknown }).windows;
  if (rawWindows === null || typeof rawWindows !== "object" || Array.isArray(rawWindows)) {
    return { ok: false, reason: "the quota answer holds no window" };
  }
  const entries = Object.entries(rawWindows as Record<string, unknown>);
  if (entries.length === 0) return { ok: false, reason: "the quota answer holds no window" };
  const windows: Record<string, number> = {};
  for (const [name, window] of entries) {
    if (window === null || typeof window !== "object" || Array.isArray(window)) {
      return { ok: false, reason: `the window ${name} holds no usedPercent` };
    }
    const value = (window as { usedPercent?: unknown }).usedPercent;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return { ok: false, reason: `the window ${name} holds no usable usedPercent` };
    }
    windows[name] = value;
  }
  return { ok: true, windows };
}

/** The state of one set of windows (spec D15). */
function stateOf(windows: Record<string, number>): "ready" | "wait" {
  return Object.values(windows).some((value) => value >= WAIT_PERCENT) ? "wait" : "ready";
}

/** Runs one quota read. */
async function main(): Promise<void> {
  const { provider, base } = parseArgs(process.argv.slice(2));
  const id = SOURCE_IDS[provider];
  if (id === undefined) {
    if (!NO_SOURCE.includes(provider)) refuse(`the provider ${provider} is not in the spec D15 table`);
    emit({ provider, source: null, state: "ready", cap: UNSOURCED_CAP, windows: {} });
    return;
  }

  let resolved = base !== "" ? base : (process.env.BENCH_QUOTA_BASE ?? "");
  if (resolved === "") {
    const fromPort = baseFromPortSource();
    if (!fromPort.ok) stop(provider, id, fromPort.reason);
    resolved = fromPort.base;
  }
  if (!/^https?:\/\/[^/]+\/?$/.test(resolved)) stop(provider, id, "the quota base is invalid");
  const root = resolved.replace(/\/+$/, "");
  const answer = await readQuota(`${root}/api/quota/${id}`);
  if (!answer.ok) stop(provider, id, answer.reason);
  emit({ provider, source: id, state: stateOf(answer.windows), cap: SOURCED_CAP, windows: answer.windows });
}

// No top-level await: the runner copies this file into a temp repo that holds
// no `type: module` package.json, and tsx then compiles it as CJS.
void main();
