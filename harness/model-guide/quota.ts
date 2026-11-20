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
 * The Go plan (`opencode-go`) reads through ra-quota (plan task 4.13r point
 * 8): `${BENCH_RA_QUOTA} status --json` when that seam is set. The tool reads
 * `.["opencode-go"].windows` percents. A fresh last-good reading (< 6 h) of
 * `RA_QUOTA_LASTGOOD` stands in when ra-quota gives no usable entry. A stale
 * (>= 6 h) or missing reading gives `stopped` and names the reading.
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
 *    "windows":{"5h":V,"weekly":V,"monthly":V}}
 *
 * The live Go source names its windows `5h`, `weekly`, and `monthly`, and
 * holds `credits_balance` with a null `usedPercent`. A window whose
 * `usedPercent` is null, not a number, or negative is not usable: the read
 * skips it, and `windows` holds the usable windows only.
 *
 * `state` is `ready`, `wait`, or `stopped`. `ready` means every usable
 * window is below 70. `wait` means a usable window is 70 or more. The Go
 * plan (`opencode-go`) uses the thresholds of the PM order of 2026-11-19:
 * it requires the `5h` and the `weekly` window, and gives `stopped` when
 * either window is absent or holds no usable value. `ready` means the 5h
 * window is below 95 and the `weekly` window is below 100. `wait` means the
 * 5h window is 95 or more or the `weekly` window is 100 or more. On
 * `stopped`, stderr holds exactly one line `quota: <reason>`. The tool
 * exits 0 for every state. Exit 2 is for a bad flag.
 *
 * The read has a timeout of 5 s, below the 10 s bound of the contract. The
 * whole answer is parsed, so a 2 MiB body with 200 windows works.
 *
 * This tool reads no credential and no real home folder. It sends one
 * loopback request to the quota source and nothing else.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { request } from "node:http";

/** The window value that moves a route to `wait` (spec D15). */
const WAIT_PERCENT = 70;

/** The provider of the Go plan (spec D15, PM 2026-11-19). */
const GO_PROVIDER = "opencode-go";

/** The 5h window value that moves a Go route to `wait` (spec D15, PM 2026-11-19). */
const GO_FIVEH_PERCENT = 95;

/** The 5h window name of the live Go source (spec D15). */
const GO_FIVEH_WINDOW = "5h";

/** The week window name of the live Go source (spec D15, PM 2026-11-19). */
const GO_WEEK_WINDOW = "weekly";

/** The week window value that moves a Go route to `wait` (spec D15, PM 2026-11-19). */
const GO_WEEK_PERCENT = 100;

/** The bound of one quota read, in milliseconds. */
const READ_TIMEOUT_MS = 5_000;

/** The bound of the port source, in milliseconds. */
const PORT_TIMEOUT_MS = 10_000;

/** The bound of one ra-quota read, in milliseconds. ra-quota has its own
 * 60 s HTTP timeout, so this bound sits above it. */
const RA_QUOTA_TIMEOUT_MS = 90_000;

/** The age of a last-good reading that still counts (6 h). */
const LASTGOOD_TTL_SECONDS = 6 * 3600;

/** The clock skew that a last-good reading may lead the clock by (60 s). A
 * reading further in the future is a forged or broken timestamp and counts
 * as missing (plan task 4.13t, ADV-P4B-2). */
const LASTGOOD_FUTURE_SKEW_SECONDS = 60;

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

/** One parsed quota answer, or the reason of a stop. `windows` holds the
 * usable values only. */
type QuotaRead =
  | { ok: true; windows: Record<string, number> }
  | { ok: false; reason: string };

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
    // The quota reason never carries the loopback error string (task
    // 4.15, Review B N32). The line holds a fixed closed-list text only.
    return { ok: false, reason: "the quota source reported an error" };
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
    if (window === null || typeof window !== "object" || Array.isArray(window)) continue;
    const value = (window as { usedPercent?: unknown }).usedPercent;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
    windows[name] = value;
  }
  if (Object.keys(windows).length === 0) {
    return { ok: false, reason: "the quota answer holds no usable window" };
  }
  return { ok: true, windows };
}

/** The window values of the ra-quota windows shape: each entry holds a
 * `percent`. The live ra-quota output removes `credits_balance`, but a null
 * or negative percent is skipped anyway. A set with no usable value is null. */
function percentWindows(raw: unknown): Record<string, number> | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const windows: Record<string, number> = {};
  for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const value = (entry as { percent?: unknown }).percent;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
    windows[name] = value;
  }
  return Object.keys(windows).length === 0 ? null : windows;
}

/** The last-good reading of the Go plan, or null. The file may hold the plan
 * entry at the top (`RA_QUOTA_LASTGOOD` of the tests) or under `plans` (the
 * ra-quota file of the operator). */
function readLastgood(): { fetchedAt: number; windows: Record<string, number> } | null {
  const path = process.env.RA_QUOTA_LASTGOOD ?? "";
  if (path === "") return null;
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return null;
  const root = doc as Record<string, unknown>;
  let entry: unknown = root;
  const plans = root.plans;
  if (plans !== null && typeof plans === "object" && !Array.isArray(plans)) {
    entry = (plans as Record<string, unknown>)[GO_PROVIDER];
  }
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
  const record = entry as { fetchedAt?: unknown; windows?: unknown };
  if (typeof record.fetchedAt !== "number" || !Number.isFinite(record.fetchedAt)) return null;
  const windows = percentWindows(record.windows);
  if (windows === null) return null;
  return { fetchedAt: record.fetchedAt, windows };
}

/** Reads the Go quota through ra-quota `status --json` (plan task 4.13r
 * point 8). A fresh last-good reading (< 6 h) stands in when the command gives
 * no usable entry, so a timeout keeps a usable answer. A stale or missing
 * reading gives the reason of a stop. */
function readRaQuota(command: string): QuotaRead {
  const result = spawnSync(command, ["status", "--json"], {
    encoding: "utf8",
    timeout: RA_QUOTA_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const text = String(result.stdout ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    let doc: unknown;
    try {
      doc = JSON.parse(text.slice(start, end + 1));
    } catch {
      doc = null;
    }
    if (doc !== null && typeof doc === "object" && !Array.isArray(doc)) {
      const entry = (doc as Record<string, unknown>)[GO_PROVIDER];
      if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
        const windows = percentWindows((entry as { windows?: unknown }).windows);
        if (windows !== null) return { ok: true, windows };
      }
    }
  }
  const lastgood = readLastgood();
  if (lastgood === null) return { ok: false, reason: "the last-good reading is missing" };
  // A reading dated in the future counts as missing (task 4.13t, ADV-P4B-2).
  // A negative age never trips the stale check, so a forged future-dated
  // reading, or a fetchedAt in milliseconds, would otherwise give `ready`.
  // The 60 s allowance absorbs ordinary clock skew between writers.
  const ageSeconds = Date.now() / 1000 - lastgood.fetchedAt;
  if (ageSeconds < -LASTGOOD_FUTURE_SKEW_SECONDS) {
    return { ok: false, reason: "the last-good reading is dated in the future" };
  }
  if (ageSeconds >= LASTGOOD_TTL_SECONDS) {
    return { ok: false, reason: "the last-good reading is stale (older than 6 h)" };
  }
  return { ok: true, windows: lastgood.windows };
}

/** True when the usable windows hold `name` with a finite value of 0 or more. */
function usableWindow(windows: Record<string, number>, name: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(windows, name)) return false;
  const value = windows[name];
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** The state of one set of windows (spec D15). The Go plan uses the 5h and
 * the weekly thresholds of the PM order of 2026-11-19. Every other source
 * uses the 70 % rule of every usable window. */
function stateOf(provider: string, windows: Record<string, number>): "ready" | "wait" {
  if (provider === GO_PROVIDER) {
    const fiveH = windows[GO_FIVEH_WINDOW];
    const week = windows[GO_WEEK_WINDOW];
    if (fiveH !== undefined && fiveH >= GO_FIVEH_PERCENT) return "wait";
    if (week !== undefined && week >= GO_WEEK_PERCENT) return "wait";
    return "ready";
  }
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
  if (provider === GO_PROVIDER) {
    const raQuota = process.env.BENCH_RA_QUOTA ?? "";
    if (raQuota !== "") {
      const answer = readRaQuota(raQuota);
      if (!answer.ok) stop(provider, id, answer.reason);
      if (
        !usableWindow(answer.windows, GO_FIVEH_WINDOW) ||
        !usableWindow(answer.windows, GO_WEEK_WINDOW)
      ) {
        stop(provider, id, "the Go answer holds no usable 5h or weekly window");
      }
      emit({ provider, source: id, state: stateOf(provider, answer.windows), cap: SOURCED_CAP, windows: answer.windows });
      return;
    }
  }
  if (resolved === "") {
    const fromPort = baseFromPortSource();
    if (!fromPort.ok) stop(provider, id, fromPort.reason);
    resolved = fromPort.base;
  }
  if (!/^https?:\/\/[^/]+\/?$/.test(resolved)) stop(provider, id, "the quota base is invalid");
  const root = resolved.replace(/\/+$/, "");
  const answer = await readQuota(`${root}/api/quota/${id}`);
  if (!answer.ok) stop(provider, id, answer.reason);
  if (
    provider === GO_PROVIDER &&
    (!usableWindow(answer.windows, GO_FIVEH_WINDOW) || !usableWindow(answer.windows, GO_WEEK_WINDOW))
  ) {
    stop(provider, id, "the Go answer holds no usable 5h or weekly window");
  }
  emit({ provider, source: id, state: stateOf(provider, answer.windows), cap: SOURCED_CAP, windows: answer.windows });
}

// No top-level await: the runner copies this file into a temp repo that holds
// no `type: module` package.json, and tsx then compiles it as CJS.
void main();
