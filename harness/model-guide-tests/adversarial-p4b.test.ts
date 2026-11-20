/**
 * Adversarial tests of the Phase 4 hardening range (tasks 4.9a to 4.9f and
 * 4.13a to 4.13r; audit range 8e0c441..ee48a25).
 *
 * The targets are the pieces of the range that the last reviews left open:
 * the Go quota through ra-quota and its last-good fallback (review-b
 * N1, N7), the daemon guard of the runners (N4, N6), the HOME guard of the
 * call paths (N2), the runner guards that no test drives (N3), and the
 * judge verdict parse.
 *
 * The file pins two kinds of cases:
 *
 *   - DEFECT pins. The case names the contract that the code must meet,
 *     and the code does not meet it at the audited HEAD. The case stays
 *     failing and routes to Green. Nothing in this file fixes production.
 *
 *   - Guard pins. The case passes at the audited HEAD and holds a
 *     falsification condition: remove the guarded behavior and the case
 *     fails. A guard pin is not a vacuous pass (A4).
 *
 * The DEFECT pins of this file:
 *
 *   AQ1, AQ2 (review-b N1): a last-good reading whose `fetchedAt` sits in
 *   the future, or holds milliseconds instead of seconds, must fail
 *   closed. quota.ts:369 tests only `now - fetchedAt >= 6 h`, so a
 *   negative age never trips and the forged reading gives `ready`.
 *
 *   AD1 (review-b N6): the daemon guard matches `serve --service` as a
 *   substring of the joined argv, so a process whose argv tokens hold
 *   `observe` and `--service` — and no token `serve` — is stopped. The
 *   guard must require the argv token pair, not the substring.
 *
 *   AD2 (review-b N4): the pre-KILL identity check is skipped when no
 *   starttime was recorded, so the guard can KILL a pid whose daemon
 *   identity was never established. The KILL must require a recorded
 *   starttime.
 *
 *   AH1 (review-b N2): the HOME guard resolves the home folder only. A
 *   preset job folder whose `data` folder is a symlink out of the job
 *   root sends the import call of the seed — the store that holds the
 *   seeded credential — outside the job root, and the run does not
 *   refuse. Every call path of the run must resolve inside the job root.
 *
 *   AM1: a diff file whose id is not a plain id — a newline in the name —
 *   is never refused, and the pass record splits the corrupted row into
 *   two bogus diff entries. The runner must refuse it like a hostile
 *   set id.
 *
 *   AJ1: the judge verdict parse reads the raw stdout of the call and
 *   scans it for a fenced json block. The real `opencode run
 *   --format json` answer is a `{"type":"result","text":...}` event
 *   whose fenced block is a JSON-escaped string, so the parse finds no
 *   usable block and every verdict silently drops to `unclear`. The
 *   runner must read the answer out of the result event.
 *
 * The guard pins of this file:
 *
 *   AQ3 (review-b N7): the fresh fallback of the ra-quota read works
 *   with the plans-wrapped last-good shape of the real ra-quota file.
 *   Falsification: break `readLastgood` and the case fails.
 *
 *   AQ4: a ra-quota answer that parses but holds no usable
 *   `opencode-go` entry — the plan value is a string — falls back to a
 *   fresh last-good reading instead of stopping. Falsification: stop
 *   the fallback and the case fails.
 *
 *   AQ5: a ra-quota answer that holds only a 5h window gives `stopped`
 *   naming the missing weekly window, and a full hostile answer at 5h 96
 *   gives `wait` on the direct read. Falsification: drop the
 *   usable-window rule and the case fails.
 *
 *   AD3, AD4 (review-b N3): the runner HOME guards of review-run.sh and
 *   judge-run.sh refuse a preset job root whose home resolves outside
 *   the root, before any call and before any record. Falsification:
 *   remove the guard and the case fails.
 *
 * The file uses only the committed fake `opencode` through
 * `BENCH_OPENCODE_BIN`, temp scripts that this file writes, and loopback
 * servers that this file starts. It never runs `opencode`, never runs
 * `openchamber`, never reads the real home folder, the real private
 * folder, or the network. Every helper process is a child of this file
 * and is killed in its finally block.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";

const HARNESS = resolve(import.meta.dirname, "..");

/** The modules under test. Their paths are fixed, so a gate cannot point
 * the test at a file outside the repository. */
const RUNNER_SOURCE = join(HARNESS, "model-guide", "review-run.sh");
const JUDGE_SOURCE = join(HARNESS, "model-guide", "judge-run.sh");
const QUOTA_SOURCE = join(HARNESS, "model-guide", "quota.ts");
const HOST_SOURCE = join(HARNESS, "opencode-host.sh");
const CREDENTIAL_SOURCE = join(HARNESS, "opencode-credential.sh");
const FAKE_SOURCE = join(HARNESS, "model-guide-tests", "fixtures", "fakes", "fake-opencode");
const TSX_BIN = join(HARNESS, "node_modules", ".bin", "tsx");

/** The review route of the cases. It is a Go route, so the fake quota
 * server serves it the live window set. */
// Row 4.16 r5: a synthetic Go route written into the temp routes.json. It is
// not a D14 pilot route, so the isolated path stays available.
const ROUTE = "opencode-go/isolated-nonpilot#high";
/** The judge route of the cases. It is outside the ranked families. */
const JUDGE_ROUTE = "bailian-token-plan/qwen3.8-max#high";
const SET_ID = "mg-advb-set";
const JUDGE_SET_ID = "mg-advb-judge-set";
const SECRET = "sk-test-credential-value-0123456789";

// --- the PM load watch: this file leaves no server and no temp folder ----
/** The quota servers this file started. */
const startedServers = new Set<ChildProcess>();
/** The exit of each server this file started. */
const serverExits = new Set<Promise<void>>();
/** The temp folders this file created. */
const tempRoots = new Set<string>();

/** Kills every server this file started, without waiting. */
function killStartedServers(): void {
  for (const server of startedServers) {
    try {
      server.kill("SIGKILL");
    } catch {
      // The server is already gone.
    }
  }
  startedServers.clear();
}

/** Removes every temp folder this file created and did not remove yet. */
function sweepTempRoots(): void {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.clear();
}

/** Kills every server, waits for each exit, and removes the temp folders. */
async function stopEverything(): Promise<void> {
  killStartedServers();
  await Promise.all([...serverExits]);
  serverExits.clear();
  sweepTempRoots();
}

process.on("exit", () => {
  killStartedServers();
  sweepTempRoots();
  sweepHelpers();
});
process.on("SIGINT", () => {
  killStartedServers();
  sweepTempRoots();
  sweepHelpers();
  process.exit(130);
});
process.on("SIGTERM", () => {
  killStartedServers();
  sweepTempRoots();
  sweepHelpers();
  process.exit(143);
});

/** The lines of one command of the orphan scan. */
function commandLines(args: string[]): string[] {
  const result = spawnSync(args[0], args.slice(1), { encoding: "utf8", timeout: 20_000 });
  return (result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

afterEach(async () => {
  await stopEverything();
});

/** The pids of the helper processes this file spawned. A case kills its
 * own helpers in its finally block; the sweep below is the back stop. */
const helperPids = new Set<number>();

/** Our own helper children by pid, so the kill reaps the close event. */
const helperProcs = new Map<number, ChildProcess>();

/** Kills one helper process and waits until it is gone, so the file
 * leaves no dangling child for the load watch. */
async function killHelper(pid: number): Promise<void> {
  helperPids.delete(pid);
  const child = helperProcs.get(pid);
  helperProcs.delete(pid);
  if (child !== undefined) {
    try {
      child.kill("SIGKILL");
    } catch {
      return;
    }
    await new Promise<void>((done) => {
      const timer = setTimeout(done, 5000);
      child.once("close", () => {
        clearTimeout(timer);
        done();
      });
    });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return;
  }
  await waitForDeath(pid);
}

/** Kills every helper process this file spawned. */
function sweepHelpers(): void {
  for (const pid of [...helperPids]) {
    helperPids.delete(pid);
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The helper is already gone.
    }
  }
}

/** Spawns one helper child of this file and tracks its pid. */
function spawnHelper(child: ChildProcess): number {
  const pid = child.pid as number;
  child.unref();
  helperPids.add(pid);
  helperProcs.set(pid, child);
  return pid;
}

/** The load watch of the PM: no server, no fake child, and no
 * `serve --service` process of this run may stay alive after the file.
 * The scans keep the lines that hold a temp tag of this suite (`mg-`). */
afterAll(async () => {
  sweepHelpers();
  await stopEverything();
  const quotaOrphans = commandLines(["pgrep", "-f", "mg-.*quota-server"]);
  const fakeOrphans = commandLines(["bash", "-c", "ps -eo pid,args | grep '[f]ake-opencode'"]);
  const serveOrphans = commandLines(["bash", "-c", "ps -eo pid,args | grep 'serve --servic[e]'"]);
  const mine = [...quotaOrphans, ...fakeOrphans, ...serveOrphans].filter((line) => line.includes("mg-"));
  expect(mine, "an orphan process of this run stays alive").toEqual([]);
});

/** The pid of a process that is alive. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Waits until a pid is gone. */
async function waitForDeath(pid: number, ms = 3000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise<void>((done) => setTimeout(done, 50));
  }
  return !isAlive(pid);
}

/** The text of a contiguous block of shell functions, from `startName() {`
 * up to the line of `endName() {`, exclusive. The daemon helpers of the
 * runners hold node scripts with column-0 `}` lines inside, so a single
 * function extraction by brace would truncate them. The block is the
 * production text verbatim. */
function shellFuncBlock(sourcePath: string, startName: string, endName: string): string {
  const lines = readFileSync(sourcePath, "utf8").split("\n");
  const start = lines.findIndex((line) => line === `${startName}() {`);
  expect(start, `${startName} is missing in ${sourcePath}`).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((line, index) => index > start && line === `${endName}() {`);
  expect(end, `${endName} is missing in ${sourcePath}`).toBeGreaterThan(start);
  return lines.slice(start, end).join("\n").trimEnd();
}

/** The run state of a real process: the field after the comm of its
 * stat line. An empty answer means the process is gone. A reaped or
 * KILLed child reads as gone or as a zombie, so a case that pins
 * survival must read the state, not only `kill -0`. */
function procState(pid: number): string {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const after = stat.slice(stat.lastIndexOf(")") + 2);
    return after.split(" ")[0] ?? "";
  } catch {
    return "";
  }
}

/** True when a helper child still runs: alive, not a zombie, and not
 * gone. */
function stillRunning(pid: number): boolean {
  if (!isAlive(pid)) return false;
  const state = procState(pid);
  return state !== "" && state !== "Z" && state !== "X";
}

/** The runner is a module under test. Its absence is a gate error. */
function assertRunnerExists(path: string, label: string): void {
  expect(existsSync(path), `${label} is missing: ${path}`).toBe(true);
}

// --- the quota group ------------------------------------------------------

/** One temp tree of a quota case. Every path of the spawn lives inside it. */
interface QuotaSandbox {
  root: string;
  bin: string;
  env: Record<string, string>;
  close(): void;
}

/** Builds the temp tree and the environment of one quota case. */
function makeQuotaSandbox(): QuotaSandbox {
  const root = mkdtempSync(join(tmpdir(), "mg-advb-quota-"));
  tempRoots.add(root);
  const home = join(root, "home");
  const tmp = join(root, "tmp");
  const bin = join(root, "bin");
  for (const dir of [home, tmp, bin]) mkdirSync(dir, { recursive: true });
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_RUNTIME_DIR: join(home, "run"),
    TMPDIR: tmp,
    TZ: "UTC",
    PATH: `${bin}:${process.env.PATH ?? ""}`,
  };
  delete env.BENCH_TRACK;
  delete env.BENCH_QUOTA_BASE;
  delete env.BENCH_RA_QUOTA;
  delete env.RA_QUOTA_LASTGOOD;
  delete env.RA_QUOTA_API_PORT;
  delete env.OPENCODE_CONFIG;
  return {
    root,
    bin,
    env,
    close: () => {
      rmSync(root, { recursive: true, force: true });
      tempRoots.delete(root);
    },
  };
}

/** The result of one run of the quota tool. */
interface RunResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  elapsed: number;
}

/** Runs the quota tool once. */
async function runQuotaTool(sandbox: QuotaSandbox, args: string[], timeoutMs = 15_000): Promise<RunResult> {
  assertRunnerExists(QUOTA_SOURCE, "the quota tool");
  const started = Date.now();
  return await new Promise<RunResult>((done) => {
    const child = spawn(TSX_BIN, [QUOTA_SOURCE, ...args], {
      cwd: HARNESS,
      env: sandbox.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (status: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      done({ status, signal, stdout, stderr, elapsed: Date.now() - started });
    };
    const timer = setTimeout(() => {
      stderr += "\nadvb-test: the spawn hit its timeout\n";
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      stderr += `${String(error)}\n`;
      finish(null, null);
    });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      finish(status, signal);
    });
  });
}

/** The JSON line of the tool output. */
function quotaDoc(result: RunResult): Record<string, unknown> {
  const line = result.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("{"));
  expect(line, `the tool printed no JSON line:\n${result.stdout}${result.stderr}`).toBeDefined();
  const doc = JSON.parse(line as string) as Record<string, unknown>;
  expect(doc, "the JSON line is not an object").toBeTypeOf("object");
  return doc;
}

/** The state of a run, checked with the shape of the contract. */
function expectState(result: RunResult, state: string, label: string): Record<string, unknown> {
  expect(result.status, `${label}: ${result.stdout}\n${result.stderr}`).toBe(0);
  const doc = quotaDoc(result);
  expect(doc.state, `${label}: wrong state`).toBe(state);
  return doc;
}

/** The shape of a `stopped` answer: one named line on stderr. */
function expectStopped(result: RunResult, label: string): Record<string, unknown> {
  const doc = expectState(result, "stopped", label);
  const lines = result.stderr
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  expect(lines, `${label}: stderr must hold exactly one line, got ${JSON.stringify(lines)}`).toHaveLength(1);
  expect(lines[0], `${label}: the line must start with "quota:"`).toMatch(/^quota:/);
  return doc;
}

/** Writes a fake `ra-quota` double that prints the given stdout and makes
 * no network call. The read of the tool must stand on its own. */
function writeRaQuotaDouble(sandbox: QuotaSandbox, stdout: string): string {
  const path = join(sandbox.bin, "ra-quota");
  writeFileSync(path, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(stdout)});\n`, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

/** The ra-quota windows shape of a last-good reading. */
function shapedWindows(windows: Record<string, number>): Record<string, { percent: number }> {
  const shaped: Record<string, { percent: number }> = {};
  for (const [name, percent] of Object.entries(windows)) shaped[name] = { percent };
  return shaped;
}

/** Writes a flat last-good reading, the shape of the test seam. */
function writeLastgoodFlat(path: string, fetchedAt: number, windows: Record<string, number>): void {
  writeFileSync(path, `${JSON.stringify({ fetchedAt, windows: shapedWindows(windows) })}\n`);
}

/** Writes a plans-wrapped last-good reading, the shape of the real
 * ra-quota file of the operator. */
function writeLastgoodWrapped(path: string, fetchedAt: number, windows: Record<string, number>): void {
  writeFileSync(
    path,
    `${JSON.stringify({ plans: { "opencode-go": { fetchedAt, windows: shapedWindows(windows) } } })}\n`,
  );
}

describe("ADV-P4B AQ the Go quota through a hostile ra-quota source", () => {
  it("AQ1 a forged last-good reading dated in the future fails closed (review-b N1)", async () => {
    const sandbox = makeQuotaSandbox();
    try {
      // The double gives no usable entry, so the read must lean on the
      // last-good file. The file is forged: its fetchedAt sits ten years
      // in the future, so the age is negative.
      const double = writeRaQuotaDouble(sandbox, "{}\n");
      const lastgood = join(sandbox.root, "lastgood.json");
      writeLastgoodFlat(lastgood, Date.now() / 1000 + 10 * 365.25 * 24 * 3600, { "5h": 50, weekly: 40 });
      sandbox.env.BENCH_RA_QUOTA = double;
      sandbox.env.RA_QUOTA_LASTGOOD = lastgood;
      const result = await runQuotaTool(sandbox, ["--provider", "opencode-go"]);
      // DEFECT pin: a reading whose age is negative is not a fresh
      // reading. It must count as missing, and the read must stop.
      expectStopped(result, "a forged future-dated last-good reading");
    } finally {
      sandbox.close();
    }
  });

  it("AQ2 a last-good reading in milliseconds fails closed (review-b N1)", async () => {
    const sandbox = makeQuotaSandbox();
    try {
      const double = writeRaQuotaDouble(sandbox, "{}\n");
      const lastgood = join(sandbox.root, "lastgood.json");
      // The fetchedAt holds milliseconds, the shape a confused writer
      // produces. The age is a large negative number.
      writeLastgoodFlat(lastgood, Date.now(), { "5h": 50, weekly: 40 });
      sandbox.env.BENCH_RA_QUOTA = double;
      sandbox.env.RA_QUOTA_LASTGOOD = lastgood;
      const result = await runQuotaTool(sandbox, ["--provider", "opencode-go"]);
      // DEFECT pin: a millisecond scale fetchedAt is a forged or broken
      // reading, never a fresh one. The read must stop.
      expectStopped(result, "a millisecond-scale last-good reading");
    } finally {
      sandbox.close();
    }
  });

  it("AQ3 a fresh plans-wrapped last-good reading stands in when the double gives no entry (review-b N7)", async () => {
    const sandbox = makeQuotaSandbox();
    try {
      // Guard pin. The real ra-quota last-good file wraps the plan entry
      // under `plans`, and a fetch that gives no usable entry leans on a
      // fresh reading of that shape.
      const double = writeRaQuotaDouble(sandbox, "{}\n");
      const lastgood = join(sandbox.root, "ra-quota-lastgood.json");
      writeLastgoodWrapped(lastgood, Date.now() / 1000 - 3600, { "5h": 50, weekly: 40 });
      sandbox.env.BENCH_RA_QUOTA = double;
      sandbox.env.RA_QUOTA_LASTGOOD = lastgood;
      const result = await runQuotaTool(sandbox, ["--provider", "opencode-go"]);
      const doc = expectState(result, "ready", "a fresh plans-wrapped reading");
      expect(doc.cap, "the cap of the Go provider is the N of spec D13").toBe(3);
      expect(doc.windows).toEqual({ "5h": 50, weekly: 40 });
    } finally {
      sandbox.close();
    }
  });

  it("AQ4 an answer that parses but holds no usable opencode-go entry falls back to the reading", async () => {
    const sandbox = makeQuotaSandbox();
    try {
      // Guard pin. The answer is valid JSON, but the opencode-go value is
      // a string and the only windows belong to another plan, so the
      // read must fall back to a fresh last-good reading, not stop.
      const hostile = `${JSON.stringify({
        "opencode-go": "blocked by the operator",
        "kimi-for-coding": { windows: { "5h": { percent: 99 }, weekly: { percent: 99 } } },
      })}\n`;
      const double = writeRaQuotaDouble(sandbox, hostile);
      const lastgood = join(sandbox.root, "lastgood.json");
      writeLastgoodWrapped(lastgood, Date.now() / 1000 - 60, { "5h": 30, weekly: 20 });
      sandbox.env.BENCH_RA_QUOTA = double;
      sandbox.env.RA_QUOTA_LASTGOOD = lastgood;
      const result = await runQuotaTool(sandbox, ["--provider", "opencode-go"]);
      const doc = expectState(result, "ready", "a hostile valid answer with a fresh reading");
      expect(doc.windows).toEqual({ "5h": 30, weekly: 20 });
    } finally {
      sandbox.close();
    }
  });

  it("AQ5 a direct hostile answer at 5h 96 gives wait, and a 5h-only answer stops naming the weekly gap", async () => {
    const sandbox = makeQuotaSandbox();
    try {
      // Guard pin, first half: the direct read of a hostile answer that
      // holds both windows applies the 95/100 thresholds.
      const hot = `${JSON.stringify({
        "opencode-go": { windows: { "5h": { percent: 96 }, weekly: { percent: 40 } } },
      })}\n`;
      const hotDouble = writeRaQuotaDouble(sandbox, hot);
      sandbox.env.BENCH_RA_QUOTA = hotDouble;
      const hotResult = await runQuotaTool(sandbox, ["--provider", "opencode-go"]);
      expectState(hotResult, "wait", "a direct answer at 5h 96");

      // Guard pin, second half: an answer with a usable 5h window and no
      // weekly window is not a usable Go answer. The read must stop and
      // name the gap, with no fallback.
      delete sandbox.env.RA_QUOTA_LASTGOOD;
      const half = `${JSON.stringify({
        "opencode-go": { windows: { "5h": { percent: 50 } } },
      })}\n`;
      const halfDouble = writeRaQuotaDouble(sandbox, half);
      sandbox.env.BENCH_RA_QUOTA = halfDouble;
      const halfResult = await runQuotaTool(sandbox, ["--provider", "opencode-go"]);
      expectStopped(halfResult, "a 5h-only answer");
      expect(halfResult.stderr, "the stop must name the 5h or weekly gap").toMatch(/5h|weekly/i);
    } finally {
      sandbox.close();
    }
  });
});

// --- the runner group -----------------------------------------------------

/** The spec entry of one model call of the fake. */
interface CallSpec {
  exit?: number;
  stderr?: string;
  sleep?: number;
  value?: string;
  tokens?: Record<string, unknown>;
}

/** One entry of the fake shared or job store for the real helper. The
 * entry uses the live `auth export` shape (task 4.13q point 7). */
function storeEntry(provider: string): unknown {
  return {
    integrationID: provider,
    active: true,
    value: {
      type: "oauth",
      key: "FAKE-KEY-ADV-0001",
      access: SECRET,
      refresh: "inert",
      expires: 9999999999999,
      metadata: { orgID: "org-test-0123456789" },
    },
  };
}

/** The stub of the provider credential helper. */
const CREDENTIAL_STUB = `#!/usr/bin/env bash
set -uo pipefail
case "\${1:-}" in
  seed) exit 0 ;;
  scan-values) printf '%s\\n' "\${MG_TEST_SECRET_VALUE:-}"; exit 0 ;;
  *) echo "provider-credential: unknown mode" >&2; exit 2 ;;
esac
`;

/** Copies a file of the repository into the temp repo when it exists. */
function copyIfPresent(source: string, target: string, mode?: number): void {
  if (!existsSync(source)) return;
  writeFileSync(target, readFileSync(source));
  if (mode !== undefined) chmodSync(target, mode);
}

/** One synthetic seeded diff of the set. */
function seededDiffText(id: string): string {
  return [
    `--- a/src/${id}.ts`,
    `+++ b/src/${id}.ts`,
    "@@ -1,6 +1,6 @@",
    " export const value = 1;",
    "-export const other = 2;",
    "+export const other = 3;",
    " export const third = 4;",
    `+// SEEDED-${id}`,
    "",
  ].join("\n");
}

/** The quota source of a runner case. It answers the Go live window set
 * for `/opencode-go` and the old names for every other source, the same
 * server as the runner suites use. */
const QUOTA_SERVER_SOURCE = `const fs = require("node:fs");
const http = require("node:http");
const requestLog = process.env.QUOTA_REQUEST_LOG || "";
const percent = Number(process.env.QUOTA_PERCENT || "10");
const weekText = process.env.QUOTA_WEEK || "";
const week = weekText === "" ? percent : Number(weekText);
const server = http.createServer((req, res) => {
  const url = req.url || "";
  if (requestLog !== "") fs.appendFileSync(requestLog, url + "\\n");
  const live = url.indexOf("/opencode-go") !== -1;
  const body = live
    ? JSON.stringify({
      usage: {
        windows: {
          "5h": { usedPercent: percent },
          weekly: { usedPercent: week },
          monthly: { usedPercent: percent },
          credits_balance: { usedPercent: null },
        },
      },
    })
    : JSON.stringify({
      usage: {
        windows: {
          "5h": { usedPercent: percent },
          day: { usedPercent: percent },
          week: { usedPercent: week },
        },
      },
    });
  res.writeHead(200, { "content-type": "application/json", connection: "close" });
  res.end(body);
});
server.listen(0, "127.0.0.1", () => {
  process.stdout.write("PORT " + server.address().port + "\\n");
});
`;

/** One log line of the fake `opencode`. */
interface LogEntry {
  argv: string;
  home: string;
  cwd: string;
  job: string;
  stdin: string;
}

/** The log lines of the fake. */
function logEntries(logPath: string): LogEntry[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const fields: Record<string, string> = {};
      for (const part of line.split("\t")) {
        const at = part.indexOf("=");
        if (at > 0) fields[part.slice(0, at)] = part.slice(at + 1);
      }
      return {
        argv: fields.argv ?? "",
        home: fields.home ?? "",
        cwd: fields.cwd ?? "",
        job: fields.job ?? "",
        stdin: fields.stdin ?? "",
      };
    });
}

/** The log lines of the model calls. */
function modelCalls(entries: LogEntry[]): LogEntry[] {
  return entries.filter((entry) => entry.argv.startsWith("run "));
}

/** Every file of one tree. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    let names: string[];
    try {
      names = readdirSync(current).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(current, name);
      const info = lstatSync(full);
      if (info.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(dir);
  return out;
}

/** The pass records of the private folder: JSON files with a `state`. */
function passRecords(privateDir: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const file of filesUnder(privateDir)) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!text.trim().startsWith("{")) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      continue;
    }
    if (doc && typeof doc === "object" && typeof (doc as { state?: unknown }).state === "string") {
      out.push(doc as Record<string, unknown>);
    }
  }
  return out;
}

/** The stdout lines of a run. */
function stdoutLines(result: { stdout: string | null }): string[] {
  return (result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** The non-empty stderr lines of a run. */
function stderrLines(result: { stderr: string | null }): string[] {
  return (result.stderr ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** The scenario of one runner case. */
interface Scenario {
  diffs?: string[];
  calls?: CallSpec[];
  /** When true, the fixture copies the real provider-credential.sh, so
   * the seed and the value scan reach the fake. */
  realCredential?: boolean;
  authExportShared?: unknown[];
  authExportJob?: unknown[];
}

/** The temp trees and paths of one runner case. */
interface RunnerFixture {
  root: string;
  repo: string;
  privateDir: string;
  home: string;
  tmp: string;
  logPath: string;
  specPath: string;
  pidPath: string;
  fakePath: string;
  fakeDir: string;
  setId: string;
  route: string;
  runCounter: number;
  close: () => void;
}

/** Builds the temp repo, the private folder, the fake, and the quota
 * server of one review-runner case. */
async function buildRunnerFixture(scenario: Scenario = {}): Promise<RunnerFixture> {
  const root = mkdtempSync(join(tmpdir(), "mg-advb-review-"));
  tempRoots.add(root);
  const repo = join(root, "repo");
  const privateDir = join(root, "private");
  const home = join(root, "home");
  const tmp = join(root, "tmp");
  const guideDir = join(repo, "harness", "model-guide");
  const binDir = join(repo, "bin");
  const fakeDir = join(binDir, "fake-opencode.d");
  const fakePath = join(binDir, "fake-opencode");
  const logPath = join(root, "opencode.log");
  const specPath = join(root, "opencode-spec.json");
  const pidPath = join(root, "opencode-pids.txt");

  for (const dir of [guideDir, binDir, fakeDir, home, tmp, privateDir]) {
    mkdirSync(dir, { recursive: true });
  }
  mkdirSync(join(repo, "docs", "assets", "css"), { recursive: true });
  mkdirSync(join(repo, "docs", "assets", "data"), { recursive: true });

  copyIfPresent(RUNNER_SOURCE, join(guideDir, "review-run.sh"), 0o755);
  copyIfPresent(join(HARNESS, "model-guide", "review-prompt.md"), join(guideDir, "review-prompt.md"));
  copyIfPresent(QUOTA_SOURCE, join(guideDir, "quota.ts"));
  copyIfPresent(HOST_SOURCE, join(repo, "harness", "opencode-host.sh"), 0o755);
  copyIfPresent(CREDENTIAL_SOURCE, join(repo, "harness", "opencode-credential.sh"), 0o755);
  if (scenario.realCredential === true) {
    copyIfPresent(
      join(HARNESS, "model-guide", "provider-credential.sh"),
      join(guideDir, "provider-credential.sh"),
      0o755,
    );
  } else {
    writeFileSync(join(guideDir, "provider-credential.sh"), CREDENTIAL_STUB, { mode: 0o755 });
  }

  writeFileSync(fakePath, readFileSync(FAKE_SOURCE), { mode: 0o755 });
  writeFileSync(join(fakeDir, "opencode"), readFileSync(FAKE_SOURCE), { mode: 0o755 });
  chmodSync(join(fakeDir, "opencode"), 0o755);

  if (existsSync(TSX_BIN)) {
    mkdirSync(join(repo, "node_modules", ".bin"), { recursive: true });
    symlinkSync(TSX_BIN, join(repo, "node_modules", ".bin", "tsx"));
  }

  writeFileSync(
    join(guideDir, "routes.json"),
    `${JSON.stringify(
      [
        {
          family: "Go",
          route: ROUTE,
          kind: "plan",
          quota_provider: "opencode-go",
          quota_source: "opencode-go",
          ranked: true,
        },
      ],
      null,
      2,
    )}\n`,
  );

  writeFileSync(join(repo, "docs", "index.html"), "<!doctype html>\n<title>Index</title>\n");
  writeFileSync(join(repo, "docs", "assets", "css", "site.css"), "body { color: #222; }\n");
  writeFileSync(join(repo, "docs", "assets", "data", "benchmark.json"), '{"runs":0}\n');

  const setId = SET_ID;
  const diffs = scenario.diffs ?? ["d-01"];
  const srcDir = join(privateDir, "sets", setId, "src");
  const seededDir = join(privateDir, "sets", setId, "diffs");
  const messagesDir = join(privateDir, "sets", setId, "messages");
  for (const dir of [srcDir, seededDir, messagesDir]) mkdirSync(dir, { recursive: true });
  for (const diff of diffs) {
    writeFileSync(join(srcDir, `${diff}.diff`), seededDiffText(diff));
    writeFileSync(join(seededDir, `${diff}.diff`), seededDiffText(diff));
    writeFileSync(join(messagesDir, `${diff}.txt`), `MSG-LINE-${diff} the commit message of the diff\n`);
  }

  const specDoc: Record<string, unknown> = {
    calls: scenario.calls ?? [],
    auth_export: JSON.stringify([storeEntry("opencode")]),
    auth_export_exit: 0,
    auth_import_exit: 0,
  };
  if (scenario.authExportShared !== undefined) {
    specDoc.auth_export_shared = JSON.stringify(scenario.authExportShared);
  }
  if (scenario.authExportJob !== undefined) {
    specDoc.auth_export_job = JSON.stringify(scenario.authExportJob);
  }
  writeFileSync(specPath, `${JSON.stringify(specDoc, null, 2)}\n`);

  // The quota server of the case, in its own process.
  const serverPath = join(root, "quota-server.js");
  writeFileSync(serverPath, QUOTA_SERVER_SOURCE);
  const server = spawn(process.execPath, [serverPath], {
    env: { ...process.env, QUOTA_PERCENT: "10", QUOTA_WEEK: "10", QUOTA_REQUEST_LOG: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  startedServers.add(server);
  serverExits.add(
    new Promise<void>((done) => {
      server.once("close", () => done());
    }),
  );
  const port = await new Promise<number>((done, failed) => {
    let buffer = "";
    const timer = setTimeout(() => failed(new Error("the quota server did not start")), 10_000);
    server.stdout.on("data", (chunk: Buffer) => {
      buffer += String(chunk);
      const match = /PORT (\d+)/.exec(buffer);
      if (match) {
        clearTimeout(timer);
        done(Number(match[1]));
      }
    });
    server.on("error", (error) => {
      clearTimeout(timer);
      failed(error);
    });
  });

  const fixture: RunnerFixture & { quotaPortValue: number } = {
    root,
    repo,
    privateDir,
    home,
    tmp,
    logPath,
    specPath,
    pidPath,
    fakePath,
    fakeDir,
    setId,
    route: ROUTE,
    runCounter: 0,
    close: () => {
      server.kill("SIGKILL");
    },
    quotaPortValue: port,
  };
  return fixture;
}

/** Removes the temp trees of a runner case. */
function dropRunnerFixture(fixture: RunnerFixture): void {
  fixture.close();
  rmSync(fixture.root, { recursive: true, force: true });
  tempRoots.delete(fixture.root);
}

/** The environment of a runner spawn. Every path is inside the temp tree. */
function runnerEnv(fixture: RunnerFixture, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: fixture.home,
    XDG_CONFIG_HOME: join(fixture.home, ".config"),
    XDG_DATA_HOME: join(fixture.home, ".local", "share"),
    XDG_STATE_HOME: join(fixture.home, ".local", "state"),
    XDG_CACHE_HOME: join(fixture.home, ".cache"),
    XDG_RUNTIME_DIR: join(fixture.home, "run"),
    TMPDIR: fixture.tmp,
    TZ: "UTC",
    PATH: `${fixture.fakeDir}:${join(HARNESS, "node_modules", ".bin")}:${process.env.PATH ?? ""}`,
    BENCH_OPENCODE_BIN: fixture.fakePath,
    FAKE_OPENCODE_SPEC: fixture.specPath,
    FAKE_OPENCODE_LOG: fixture.logPath,
    FAKE_OPENCODE_PID_FILE: fixture.pidPath,
    BENCH_QUOTA_BASE: `http://127.0.0.1:${quotaPort(fixture)}`,
    MG_TEST_SECRET_VALUE: SECRET,
    MG_CALL_TIMEOUT_S: "600",
    MG_RUN_RETRY_WAIT_MS: "0",
  };
  // The deletes come before `extra`, so a case can preset
  // BENCH_OPENCODE_HOME through `extra`.
  delete env.BENCH_TRACK;
  delete env.OPENCODE_CONFIG;
  delete env.BENCH_OPENCODE_HOME;
  return {
    ...env,
    ...extra,
  };
}

/** The quota port of a runner fixture. The server was started by the
 * fixture builder; the port is stored on the fixture. */
function quotaPort(fixture: RunnerFixture): number {
  return (fixture as RunnerFixture & { quotaPortValue: number }).quotaPortValue;
}

/** Runs the runner of the temp repo. The output goes to two files of the
 * temp folder, so a child that holds a pipe open cannot block the read. */
function runRunner(
  fixture: RunnerFixture,
  args: string[],
  extra: Record<string, string> = {},
): { status: number | null; signal: string | null; stdout: string; stderr: string; error?: Error } {
  const stdoutPath = join(fixture.tmp, `run-${process.pid}-${fixture.runCounter}.out`);
  const stderrPath = join(fixture.tmp, `run-${process.pid}-${fixture.runCounter}.err`);
  fixture.runCounter += 1;
  const outFd = openSync(stdoutPath, "w");
  const errFd = openSync(stderrPath, "w");
  let result;
  try {
    result = spawnSync("bash", [join(fixture.repo, "harness", "model-guide", "review-run.sh"), ...args], {
      cwd: fixture.repo,
      env: runnerEnv(fixture, extra),
      encoding: "utf8",
      timeout: 20_000,
      stdio: ["ignore", outFd, errFd],
    });
  } finally {
    closeSync(outFd);
    closeSync(errFd);
  }
  return {
    status: result.status,
    signal: result.signal,
    stdout: readFileSync(stdoutPath, "utf8"),
    stderr: readFileSync(stderrPath, "utf8"),
    error: result.error,
  };
}

/** The args of one run of the set. */
function runArgs(fixture: RunnerFixture): string[] {
  return ["--route", fixture.route, "--set", fixture.setId, "--private", fixture.privateDir];
}

/** Spawns a decoy process whose argv tokens hold `observe` and
 * `--service` as separate entries and no token `serve`, with the given
 * HOME. The guard must never stop it. The caller owns the pid. */
function spawnObserveDecoy(tag: string, home: string): number {
  const script = 'process.on("SIGTERM",function(){});setTimeout(function(){},120000);';
  const child = spawn(process.execPath, ["-e", script, "observe", "--service", tag], {
    env: { HOME: home, PATH: "/usr/bin:/bin" },
    cwd: "/tmp",
    stdio: "ignore",
    detached: true,
  });
  return spawnHelper(child);
}

/** Builds a preset job folder for a runner case, with every subfolder the
 * calls use, and returns its path. */
function presetJobRoot(fixture: RunnerFixture): string {
  const jobDir = join(fixture.root, "preset-job");
  for (const sub of ["home", "config", "data", "state", "cache", "runtime", "tmp"]) {
    mkdirSync(join(jobDir, sub), { recursive: true });
  }
  return jobDir;
}

describe("ADV-P4B AD the daemon guard and the HOME guards of the review runner", () => {
  it("AD1 a process whose argv holds no serve token survives the guard (review-b N6)", async () => {
    // The job folder is preset, so the decoy HOME is known before the
    // run: opencode_host_begin keeps an existing BENCH_OPENCODE_HOME.
    const fixture = await buildRunnerFixture({
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}' }],
    });
    const jobDir = presetJobRoot(fixture);
    const decoyPid = spawnObserveDecoy("mg-advb-observe", join(jobDir, "home"));
    try {
      assertRunnerExists(RUNNER_SOURCE, "the review runner");
      expect(stillRunning(decoyPid), "the decoy did not start").toBe(true);
      const result = runRunner(fixture, runArgs(fixture), { BENCH_OPENCODE_HOME: jobDir });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      // DEFECT pin: the guard matches `serve --service` as a substring of
      // the joined argv, so it selects a process whose argv tokens hold
      // `observe` and `--service`. The argv of this decoy holds no
      // `serve` token, so the guard must leave it alone.
      expect(
        stillRunning(decoyPid),
        "the guard stopped a process whose argv holds no serve token (substring match)",
      ).toBe(true);
      const infra = stderrLines(result).filter((line) => line.includes("INFRA stopped daemon"));
      expect(infra, "the guard wrote an INFRA line for a process that is no daemon").toEqual([]);
      const records = passRecords(fixture.privateDir).filter((record) => Array.isArray(record.diffs));
      for (const record of records) {
        expect(record.infra, "the pass record names a process that is no daemon").toBeUndefined();
      }
    } finally {
      await killHelper(decoyPid);
      dropRunnerFixture(fixture);
    }
  }, 40_000);

  it("AD2 the guard sends no KILL when no starttime was recorded (review-b N4)", async () => {
    // The guard helpers are extracted verbatim from the runner, so the
    // case pins the production code (task 4.13q N3 style). The helpers
    // form one contiguous block: `daemon_pids` holds a node script with
    // a column-0 `}` inside, so the block runs from the first helper to
    // the line of `on_exit`.
    const funcs = shellFuncBlock(RUNNER_SOURCE, "daemon_pid_alive", "on_exit");

    // The target is a child of this test that ignores SIGTERM, so only a
    // KILL can stop it.
    const child = spawn(
      process.execPath,
      ["-e", 'process.on("SIGTERM",function(){});setTimeout(function(){},120000);'],
      { stdio: "ignore", detached: true },
    );
    const pid = spawnHelper(child);
    expect(stillRunning(pid), "the helper child did not start").toBe(true);

    // The fake proc tree of the child: a daemon cmdline, a HOME under the
    // job root, and a stat that reads as alive but holds no identity.
    const root = mkdtempSync(join(tmpdir(), "mg-advb-guard-"));
    tempRoots.add(root);
    const proc = mkdtempSync(join(tmpdir(), "mg-advb-proc-"));
    tempRoots.add(proc);
    try {
      mkdirSync(join(root, "home"), { recursive: true });
      mkdirSync(join(root, "tmp"), { recursive: true });
      const pidDir = join(proc, String(pid));
      mkdirSync(pidDir, { recursive: true });
      writeFileSync(
        join(pidDir, "cmdline"),
        ["fake-opencode", "serve", "--service", "mg-advb-empty-stat"].join("\0") + "\0",
      );
      writeFileSync(join(pidDir, "environ"), `HOME=${root}/home\0`);
      symlinkSync(join(root, "tmp"), join(pidDir, "cwd"));
      // The stat file is empty: the pid reads as alive, but its starttime
      // never reads, so the record of the identity stays empty.
      writeFileSync(join(pidDir, "stat"), "");

      const run = spawnSync(
        "bash",
        [
          "-c",
          `set -uo pipefail\nINFRA_LIST=""\n${funcs}\nBENCH_OPENCODE_PROC="${proc}"\nstop_daemons "${root}"`,
        ],
        { encoding: "utf8", timeout: 30_000 },
      );
      expect(run.error, `the guard run hit its timeout:\n${run.stdout ?? ""}${run.stderr ?? ""}`).toBeUndefined();
      // The guard ran and selected the pid: its INFRA line names the pid.
      const infra = stderrLines(run).filter((line) => line.includes("INFRA stopped daemon"));
      expect(infra, `the guard did not run on the fake table:\n${run.stdout ?? ""}${run.stderr ?? ""}`).toEqual([
        `review-run: INFRA stopped daemon ${pid}`,
      ]);
      // DEFECT pin: the pre-KILL identity check is skipped when the
      // starttime record is empty, so the guard KILLs a pid whose daemon
      // identity was never established. The KILL must require a
      // recorded starttime.
      expect(
        stillRunning(pid),
        "the guard KILLed a pid whose starttime was never recorded (empty identity record)",
      ).toBe(true);
    } finally {
      await killHelper(pid);
      rmSync(root, { recursive: true, force: true });
      rmSync(proc, { recursive: true, force: true });
      tempRoots.delete(root);
      tempRoots.delete(proc);
    }
  }, 30_000);

  it("AD3 a preset job home that resolves outside the job root refuses before any call (review-b N3)", async () => {
    // Guard pin. No test drives the runner guard of review-run.sh
    // (review-b N3). A preset job root whose home is a symlink out of
    // the root must refuse: exit 2, one named line on stdout, no call,
    // and no pass record.
    const fixture = await buildRunnerFixture({ diffs: ["d-01"] });
    try {
      assertRunnerExists(RUNNER_SOURCE, "the review runner");
      const jobDir = presetJobRoot(fixture);
      const outside = join(fixture.root, "outside-home");
      mkdirSync(outside, { recursive: true });
      rmSync(join(jobDir, "home"), { recursive: true, force: true });
      symlinkSync(outside, join(jobDir, "home"));
      const result = runRunner(fixture, runArgs(fixture), { BENCH_OPENCODE_HOME: jobDir });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      const lines = stdoutLines(result).filter((line) => line.startsWith("review-run:"));
      expect(lines, "the refusal must hold exactly one named line").toHaveLength(1);
      expect(lines[0], "the refusal must name the job root").toMatch(/job root/);
      expect(modelCalls(logEntries(fixture.logPath)), "the refusal made a model call").toEqual([]);
      expect(passRecords(fixture.privateDir), "the refusal wrote a pass record").toEqual([]);
    } finally {
      dropRunnerFixture(fixture);
    }
  });
});

describe("ADV-P4B AH the HOME guard of the call paths of the review runner", () => {
  it("AH1 a preset data folder symlinked out of the job root refuses the run (review-b N2)", async () => {
    // The seed and every call of the run point XDG_DATA_HOME at the data
    // folder of the job root. A preset job folder whose data folder is a
    // symlink out of the root sends the store that holds the seeded
    // credential outside the job root.
    const fixture = await buildRunnerFixture({
      realCredential: true,
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}' }],
      authExportShared: [storeEntry("opencode-go")],
      authExportJob: [storeEntry("opencode-go")],
    });
    try {
      assertRunnerExists(RUNNER_SOURCE, "the review runner");
      const jobDir = presetJobRoot(fixture);
      const outside = join(fixture.root, "outside-data");
      mkdirSync(outside, { recursive: true });
      rmSync(join(jobDir, "data"), { recursive: true, force: true });
      symlinkSync(outside, join(jobDir, "data"));
      const result = runRunner(fixture, runArgs(fixture), {
        BENCH_OPENCODE_HOME: jobDir,
        BENCH_CREDENTIAL_SEED_DELAYS: "0",
      });
      // DEFECT pin: the HOME guard resolves the home folder only, so a
      // symlinked data folder lets the run write its store through a path
      // that resolves outside the job root. The run must refuse any
      // call path that resolves outside the resolved job root.
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      const lines = stdoutLines(result).filter((line) => line.startsWith("review-run:"));
      expect(lines, "the refusal must hold exactly one named line").toHaveLength(1);
      expect(lines[0], "the refusal must name the job root").toMatch(/job root/);
    } finally {
      dropRunnerFixture(fixture);
    }
  }, 40_000);
});

describe("ADV-P4B AM hostile file names of the set", () => {
  it("AM1 a diff id that is not a plain id refuses before any call", async () => {
    // A hostile set folder holds a diff whose file name carries a
    // newline, with a matching message file, so the message checks pass
    // and the run reaches the record writer. The record rows are joined
    // with tabs and split on newlines, so the id corrupts the record.
    const fixture = await buildRunnerFixture({
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}' }, { value: '{"findings":[]}' }],
    });
    try {
      assertRunnerExists(RUNNER_SOURCE, "the review runner");
      const hostileId = "d-04\nevil";
      writeFileSync(
        join(fixture.privateDir, "sets", fixture.setId, "diffs", `${hostileId}.diff`),
        seededDiffText("d-04"),
      );
      writeFileSync(
        join(fixture.privateDir, "sets", fixture.setId, "messages", `${hostileId}.txt`),
        "MSG-LINE the hostile message line\n",
      );
      const result = runRunner(fixture, runArgs(fixture));
      // DEFECT pin: the runner validates the set id and the route value,
      // but no diff id. A diff id that is not a plain id must refuse
      // before any call, like a hostile set id.
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      const lines = stdoutLines(result).filter((line) => line.startsWith("review-run:"));
      expect(lines, "the refusal must hold exactly one named line").toHaveLength(1);
      expect(modelCalls(logEntries(fixture.logPath)), "the refusal made a model call").toEqual([]);
      expect(passRecords(fixture.privateDir), "the refusal wrote a pass record").toEqual([]);
    } finally {
      dropRunnerFixture(fixture);
    }
  });
});

// --- the judge runner group ------------------------------------------------

/** One group of the judge queue: one diff, one file, one window. */
interface GroupSpec {
  id: string;
  diff_id: string;
  file: string;
  window: [number, number];
  items: Array<{ id: string; line: number; claim: Record<string, string> }>;
}

/** The first group of the judge queue: one claim. */
const GROUP_ONE: GroupSpec = {
  id: "d-01#G1",
  diff_id: "d-01",
  file: "src/d-01.ts",
  window: [4107, 4109],
  items: [
    {
      id: "d-01#C0a1b2c3d4e5f",
      line: 4107,
      claim: { class: "C1", severity: "major", title: "CLAIM-TITLE-ALPHA", reason: "CLAIM-REASON-ALPHA" },
    },
  ],
};

/** The temp trees and paths of one judge case. */
interface JudgeFixture {
  root: string;
  repo: string;
  privateDir: string;
  home: string;
  tmp: string;
  logPath: string;
  specPath: string;
  fakePath: string;
  fakeDir: string;
  setId: string;
  route: string;
  runCounter: number;
  close: () => void;
}

/** Builds the temp repo, the private folder, the fake, and the quota
 * server of one judge case. */
async function buildJudgeFixture(scenario: { calls?: CallSpec[]; groups?: GroupSpec[] } = {}): Promise<JudgeFixture> {
  const root = mkdtempSync(join(tmpdir(), "mg-advb-judge-"));
  tempRoots.add(root);
  const repo = join(root, "repo");
  const home = join(root, "home");
  const tmp = join(root, "tmp");
  const privateDir = join(root, "private");
  const guideDir = join(repo, "harness", "model-guide");
  const binDir = join(repo, "bin");
  const fakeDir = join(binDir, "fake-opencode.d");
  const fakePath = join(binDir, "fake-opencode");
  const logPath = join(root, "opencode.log");
  const specPath = join(root, "opencode-spec.json");

  for (const dir of [guideDir, binDir, fakeDir, home, tmp, privateDir]) {
    mkdirSync(dir, { recursive: true });
  }

  copyIfPresent(JUDGE_SOURCE, join(guideDir, "judge-run.sh"), 0o755);
  copyIfPresent(QUOTA_SOURCE, join(guideDir, "quota.ts"));
  copyIfPresent(HOST_SOURCE, join(repo, "harness", "opencode-host.sh"), 0o755);
  copyIfPresent(CREDENTIAL_SOURCE, join(repo, "harness", "opencode-credential.sh"), 0o755);
  writeFileSync(join(guideDir, "provider-credential.sh"), CREDENTIAL_STUB, { mode: 0o755 });

  writeFileSync(fakePath, readFileSync(FAKE_SOURCE), { mode: 0o755 });
  writeFileSync(join(fakeDir, "opencode"), readFileSync(FAKE_SOURCE), { mode: 0o755 });
  chmodSync(join(fakeDir, "opencode"), 0o755);

  if (existsSync(TSX_BIN)) {
    mkdirSync(join(repo, "node_modules", ".bin"), { recursive: true });
    symlinkSync(TSX_BIN, join(repo, "node_modules", ".bin", "tsx"));
  }

  writeFileSync(
    join(guideDir, "judges.json"),
    `${JSON.stringify(
      [{ route: JUDGE_ROUTE, quota_provider: "opencode-go", quota_source: "opencode-go" }],
      null,
      2,
    )}\n`,
  );

  const setId = JUDGE_SET_ID;
  const groups = scenario.groups ?? [GROUP_ONE];
  const setDir = join(privateDir, "sets", setId);
  const diffDir = join(setDir, "diffs");
  const adjudicationDir = join(setDir, "adjudication");
  for (const dir of [diffDir, adjudicationDir]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(diffDir, "d-01.diff"), seededDiffText("d-01"));
  writeFileSync(join(adjudicationDir, "queue.json"), `${JSON.stringify({ set_id: setId, groups }, null, 2)}\n`);

  const specDoc: Record<string, unknown> = {
    calls: scenario.calls ?? [],
    auth_export: JSON.stringify([storeEntry("opencode")]),
    auth_export_exit: 0,
    auth_import_exit: 0,
  };
  writeFileSync(specPath, `${JSON.stringify(specDoc, null, 2)}\n`);

  const serverPath = join(root, "quota-server.js");
  writeFileSync(serverPath, QUOTA_SERVER_SOURCE);
  const server = spawn(process.execPath, [serverPath], {
    env: { ...process.env, QUOTA_PERCENT: "10", QUOTA_WEEK: "10", QUOTA_REQUEST_LOG: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  startedServers.add(server);
  serverExits.add(
    new Promise<void>((done) => {
      server.once("close", () => done());
    }),
  );
  const port = await new Promise<number>((done, failed) => {
    let buffer = "";
    const timer = setTimeout(() => failed(new Error("the quota server did not start")), 10_000);
    server.stdout.on("data", (chunk: Buffer) => {
      buffer += String(chunk);
      const match = /PORT (\d+)/.exec(buffer);
      if (match) {
        clearTimeout(timer);
        done(Number(match[1]));
      }
    });
    server.on("error", (error) => {
      clearTimeout(timer);
      failed(error);
    });
  });

  const fixture: JudgeFixture & { quotaPortValue: number } = {
    root,
    repo,
    privateDir,
    home,
    tmp,
    logPath,
    specPath,
    fakePath,
    fakeDir,
    setId,
    route: JUDGE_ROUTE,
    runCounter: 0,
    close: () => {
      server.kill("SIGKILL");
    },
    quotaPortValue: port,
  };
  return fixture;
}

/** Removes the temp trees of a judge case. */
function dropJudgeFixture(fixture: JudgeFixture): void {
  fixture.close();
  rmSync(fixture.root, { recursive: true, force: true });
  tempRoots.delete(fixture.root);
}

/** The environment of a judge spawn. */
function judgeEnv(fixture: JudgeFixture, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const withPort = fixture as JudgeFixture & { quotaPortValue?: number };
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: fixture.home,
    XDG_CONFIG_HOME: join(fixture.home, ".config"),
    XDG_DATA_HOME: join(fixture.home, ".local", "share"),
    XDG_STATE_HOME: join(fixture.home, ".local", "state"),
    XDG_CACHE_HOME: join(fixture.home, ".cache"),
    XDG_RUNTIME_DIR: join(fixture.home, "run"),
    TMPDIR: fixture.tmp,
    TZ: "UTC",
    PATH: `${fixture.fakeDir}:${join(HARNESS, "node_modules", ".bin")}:${process.env.PATH ?? ""}`,
    BENCH_OPENCODE_BIN: fixture.fakePath,
    FAKE_OPENCODE_SPEC: fixture.specPath,
    FAKE_OPENCODE_LOG: fixture.logPath,
    BENCH_QUOTA_BASE: `http://127.0.0.1:${withPort.quotaPortValue ?? 0}`,
    MG_TEST_SECRET_VALUE: SECRET,
    MG_CALL_TIMEOUT_S: "600",
    MG_RUN_RETRY_WAIT_MS: "0",
  };
  // The deletes come before `extra`, so a case can preset
  // BENCH_OPENCODE_HOME through `extra`.
  delete env.BENCH_TRACK;
  delete env.OPENCODE_CONFIG;
  delete env.BENCH_OPENCODE_HOME;
  return {
    ...env,
    ...extra,
  };
}

/** Runs the judge runner of the temp repo. */
function runJudge(
  fixture: JudgeFixture,
  args: string[],
  extra: Record<string, string> = {},
): { status: number | null; signal: string | null; stdout: string; stderr: string; error?: Error } {
  const stdoutPath = join(fixture.tmp, `run-${process.pid}-${fixture.runCounter}.out`);
  const stderrPath = join(fixture.tmp, `run-${process.pid}-${fixture.runCounter}.err`);
  fixture.runCounter += 1;
  const outFd = openSync(stdoutPath, "w");
  const errFd = openSync(stderrPath, "w");
  let result;
  try {
    result = spawnSync("bash", [join(fixture.repo, "harness", "model-guide", "judge-run.sh"), ...args], {
      cwd: fixture.repo,
      env: judgeEnv(fixture, extra),
      encoding: "utf8",
      timeout: 20_000,
      stdio: ["ignore", outFd, errFd],
    });
  } finally {
    closeSync(outFd);
    closeSync(errFd);
  }
  return {
    status: result.status,
    signal: result.signal,
    stdout: readFileSync(stdoutPath, "utf8"),
    stderr: readFileSync(stderrPath, "utf8"),
    error: result.error,
  };
}

/** The args of one judge run. */
function judgeArgs(fixture: JudgeFixture): string[] {
  return ["--set", fixture.setId, "--route", fixture.route, "--judge", "a", "--private", fixture.privateDir];
}

/** The judge file of a run: the flat verdict map. */
function judgeFile(fixture: JudgeFixture): Record<string, string> | null {
  const path = join(fixture.privateDir, "sets", fixture.setId, "adjudication", "judge-a.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
}

/** The run record of a judge run. */
function judgeRunRecord(fixture: JudgeFixture): Record<string, unknown> | null {
  const path = join(fixture.privateDir, "sets", fixture.setId, "adjudication", "judge-a-run.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

describe("ADV-P4B AJ the judge runner", () => {
  it("AJ1 the answer in the real --format json event shape yields its verdict", async () => {
    // The real `opencode run --format json` answer is an event stream: a
    // step-finish token event, then a result event whose text holds the
    // answer. The fenced json block of the answer is a JSON-escaped
    // string inside the result event, with no real newline in it.
    const answerText = 'The answer of the judge.\n```json\n{"d-01#C0a1b2c3d4e5f":"real-defect"}\n```';
    const eventStream = [
      '{"type":"step-finish","tokens":{"input":10,"output":20,"reasoning":5,"cache":{"read":100,"write":7}}}',
      `{"type":"result","text":${JSON.stringify(answerText)}}`,
    ].join("\n");
    const fixture = await buildJudgeFixture({ calls: [{ value: `${eventStream}\n` }] });
    try {
      assertRunnerExists(JUDGE_SOURCE, "the judge runner");
      const result = runJudge(fixture, judgeArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      // DEFECT pin: the verdict parse scans the raw stdout for a fenced
      // json block with real newlines, so the answer of a real call
      // yields no verdict and the finding silently drops to unclear.
      // The runner must read the answer out of the result event.
      expect(judgeFile(fixture), "the judge file holds no verdict of the real answer shape").toEqual({
        "d-01#C0a1b2c3d4e5f": "real-defect",
      });
      const record = judgeRunRecord(fixture);
      expect(record, "the runner wrote no run record").not.toBeNull();
      expect(record?.judged_by, "the run record maps no finding to the judge route").toEqual({
        "d-01#C0a1b2c3d4e5f": JUDGE_ROUTE,
      });
      const groups = record?.groups as Array<Record<string, unknown>> | undefined;
      expect(groups, "the run record holds no groups").toBeDefined();
      expect(groups?.[0]?.state, "the group did not complete").toBe("complete");
    } finally {
      dropJudgeFixture(fixture);
    }
  });

  it("AD4 the judge runner refuses a preset job home that resolves outside the job root (review-b N3)", async () => {
    // Guard pin. No test drives the runner guard of judge-run.sh
    // (review-b N3). The guard sits in start_job, so the case needs a
    // queue that reaches the first group.
    const fixture = await buildJudgeFixture({});
    try {
      assertRunnerExists(JUDGE_SOURCE, "the judge runner");
      const jobDir = join(fixture.root, "preset-job");
      for (const sub of ["home", "config", "data", "state", "cache", "runtime", "tmp"]) {
        mkdirSync(join(jobDir, sub), { recursive: true });
      }
      const outside = join(fixture.root, "outside-home");
      mkdirSync(outside, { recursive: true });
      rmSync(join(jobDir, "home"), { recursive: true, force: true });
      symlinkSync(outside, join(jobDir, "home"));
      const result = runJudge(fixture, judgeArgs(fixture), { BENCH_OPENCODE_HOME: jobDir });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      const lines = stdoutLines(result).filter((line) => line.startsWith("judge-run:"));
      expect(lines, "the refusal must hold exactly one named line").toHaveLength(1);
      expect(lines[0], "the refusal must name the job root").toMatch(/job root/);
      expect(modelCalls(logEntries(fixture.logPath)), "the refusal made a model call").toEqual([]);
      expect(judgeFile(fixture), "the refusal wrote a judge file").toBeNull();
    } finally {
      dropJudgeFixture(fixture);
    }
  });
});
