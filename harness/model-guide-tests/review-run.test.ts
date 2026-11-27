/**
 * The review runner of task 4.1 (spec D13, D14, D15, D22; FR-11).
 *
 * The runner under test is `harness/model-guide/review-run.sh`. It does not
 * exist yet, so every case of this file fails at the phase base. The file
 * stays red until the Green task 4.7.
 *
 * The contract of this file, which the Green task 4.7 implements:
 *
 *   Usage:
 *     harness/model-guide/review-run.sh --route <route> --set <set_id> \
 *       --private <dir> [--date <YYYY-MM-DD>]
 *
 *   - `--route`, `--set`, and `--private` are required. `--date` is optional.
 *   - `--set` takes a plain set id: it starts with a letter or a digit, holds
 *     only letters, digits, `.`, `_`, and `-`, and holds no `..`. A value with
 *     a slash or a parent segment is refused.
 *   - `--route` takes a route of `harness/model-guide/routes.json`. A value
 *     with a parent segment is refused.
 *   - `--private` names the private root. The default is
 *     `$HOME/.local/share/lending-desk-bench/model-guide`.
 *   - Exit 2 is a refusal: one line `review-run: <check>` on stdout, no pass
 *     record, and no call.
 *   - Every other run writes one pass record in the private folder. Its
 *     `state` is one of `complete`, `open`, `wait`, or `region-blocked`.
 *   - The pass record holds `set_id`, `route`, `pass`, `date`, `state`,
 *     `diffs`, `outputs`, `errors`, `tokens`, and `tokens_complete`. Each
 *     entry of `diffs` holds its `id` and its own `tokens` object (spec
 *     D13, Tokens, PM 2026-11-18). It holds no `complete` field and no
 *     `rank` field.
 *   - `--probe` runs the probe mode of spec D14 (PM 2026-11-18). The block
 *     above the probe cases pins its line, its exit codes, and the probe
 *     record.
 *   - The raw output of each diff is stored in the private folder only.
 *   - Each model call is `run --standalone --format json --model <route>`.
 *   - The job config of the call denies `read`, `edit`, `bash`, `webfetch`,
 *     `websearch`, `question`, `subagent`, and `skill`. The runner points
 *     `OPENCODE_CONFIG` at that file for the call.
 *   - The seams are `BENCH_QUOTA_BASE`, `OPENCODE_CONFIG`,
 *     `MG_CALL_TIMEOUT_S`, and `MG_RUN_RETRY_WAIT_MS`.
 *
 * The set of the run is `<private>/sets/<set_id>/`, and its diffs are the
 * `diffs/<diff_id>.diff` files of that folder, in the order of their names.
 * The `src/<diff_id>.diff` files hold the source diffs without the plants
 * (`review-set.ts` line 18, `leak-check.ts` line 38). The runner must never
 * send a source diff to the model (spec D7).
 *
 * The test uses no network, no model, no real home folder, and no real
 * `opencode`. The only socket is the loopback server of the quota case. The
 * fake `opencode` of `fixtures/fakes/fake-opencode` is the only binary the
 * spawn can reach.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
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
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";

const HARNESS = resolve(import.meta.dirname, "..");
const REPO_ROOT = resolve(HARNESS, "..");

/** The module under test. Its path is fixed, so a gate cannot point the
 * test at a file outside the repository. */
const RUNNER_SOURCE = join(HARNESS, "model-guide", "review-run.sh");
const PROMPT_SOURCE = join(HARNESS, "model-guide", "review-prompt.md");
const QUOTA_SOURCE = join(HARNESS, "model-guide", "quota.ts");
const HOST_SOURCE = join(HARNESS, "opencode-host.sh");
const CREDENTIAL_SOURCE = join(HARNESS, "opencode-credential.sh");
const FAKE_SOURCE = join(HARNESS, "model-guide-tests", "fixtures", "fakes", "fake-opencode");
const TSX_BIN = join(HARNESS, "node_modules", ".bin", "tsx");

/** The tools of the job config of D14. */
const DENY_TOOLS = ["read", "edit", "bash", "webfetch", "websearch", "question", "subagent", "skill"];

/** The credential value of the provider. The fake export and the value scan of
 * the stub helper both hold it. */
const SECRET = "sk-test-credential-value-0123456789";

/** The region error of spec D22. The runner marks a Go route that returns it
 * as `region-blocked`. */
const REGION_ERROR = "Error: the model is not available in your region";

// Row 4.16 r5: the isolated path may not name a D14 pilot route. This
// synthetic Go route is written into the temp routes.json by routesFile(), so
// the Go quota windows and the D22 region rule stay covered without using a
// pilot route.
const ROUTE = "opencode-go/isolated-nonpilot#high";
const METERED_ROUTE = "deepseek/deepseek-flash#high";
const UNKNOWN_ROUTE = "opencode-go/not-in-routes#high";
const SET_ID = "mg-test-set";

const TWO_MIB = 2 * 1024 * 1024;

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
async function stopStartedServers(): Promise<void> {
  killStartedServers();
  await Promise.all([...serverExits]);
  serverExits.clear();
  sweepTempRoots();
}

process.on("exit", () => {
  killStartedServers();
  sweepTempRoots();
});
process.on("SIGINT", () => {
  killStartedServers();
  sweepTempRoots();
  process.exit(130);
});
process.on("SIGTERM", () => {
  killStartedServers();
  sweepTempRoots();
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
  await stopStartedServers();
});

/** The pids of the helper processes (decoys) this file spawned. A case
 * kills its own helpers in its finally block; the sweep below is the back
 * stop, so every helper process is gone before the orphan scan
 * (task 4.13o). */
const helperPids = new Set<number>();

/** Our own decoy children by pid, so the kill reaps the close event. */
const decoyProcs = new Map<number, ChildProcess>();

/** Kills one helper process and waits until it is gone, so the runner
 * leaves no dangling child for the load watch. Our own children (decoys)
 * are reaped through their close event; other pids are polled. */
async function killHelper(pid: number): Promise<void> {
  helperPids.delete(pid);
  const child = decoyProcs.get(pid);
  decoyProcs.delete(pid);
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
  await waitForDeath(pid, 2000);
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

/** Spawns a decoy process whose argv holds `serve --service <tag>`, with
 * its HOME and cwd outside the job root. The guard must never touch it.
 * The caller owns the pid: it kills it in a finally block. */
function spawnDecoy(tag: string, home: string, cwd = "/tmp"): number {
  const child = spawn("bash", ["-c", 'exec -a "$0" sleep 120', `fake-opencode serve --service ${tag}`], {
    env: { HOME: home, PATH: "/usr/bin:/bin" },
    cwd,
    stdio: "ignore",
    detached: true,
  });
  const pid = child.pid as number;
  child.unref();
  helperPids.add(pid);
  decoyProcs.set(pid, child);
  return pid;
}

/** The pids that the fake wrote to the daemon file of the fixture. The
 * file appears after the daemon starts, so the read polls. */
async function daemonPids(fixture: Fixture, timeoutMs = 5000): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (existsSync(fixture.daemonPath)) {
      const pids = readFileSync(fixture.daemonPath, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .map(Number)
        .filter(Number.isFinite);
      if (pids.length > 0) {
        for (const pid of pids) helperPids.add(pid);
        return pids;
      }
    }
    if (Date.now() >= deadline) return [];
    await new Promise<void>((done) => setTimeout(done, 50));
  }
}

/** The raw argv entries that the fake daemon wrote at spawn to
 * `<daemonPath>.argv.json` (Option B, task 4.13q). The file holds the JSON
 * array of the raw /proc/self/cmdline entries of the daemon child. The
 * read polls, because the file appears after the daemon starts. */
async function spawnArgvEntries(fixture: Fixture, timeoutMs = 5000): Promise<string[]> {
  const argvPath = `${fixture.daemonPath}.argv.json`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(argvPath, "utf8"));
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // The daemon has not written the file yet.
    }
    if (Date.now() >= deadline) return [];
    await new Promise<void>((done) => setTimeout(done, 50));
  }
}

/** The command line of a process. */
function procCmdline(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim();
  } catch {
    return "";
  }
}

/** The raw argv entries of a process, with no NUL normalization. The
 * production guard reads the raw buffer, so a Red pin on the real daemon
 * shape must read it raw too (task 4.13q F1). */
function rawCmdlineEntries(pid: number): string[] {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8")
      .split("\0")
      .filter((entry) => entry !== "");
  } catch {
    return [];
  }
}

/** The environment of a process. */
function procEnviron(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/environ`, "utf8");
  } catch {
    return "";
  }
}

/** The HOME of a process, from its environment. */
function procHome(pid: number): string {
  const match = /HOME=([^\0]*)/.exec(procEnviron(pid));
  return match ? match[1] : "";
}

/** The text of one shell function of the runner, extracted verbatim, so the
 * test pins the production helper instead of a copy (task 4.13q N3). */
function shellFunc(sourcePath: string, name: string): string {
  const lines = readFileSync(sourcePath, "utf8").split("\n");
  const start = lines.findIndex((line) => line === `${name}() {`);
  expect(start, `${name} is missing in ${sourcePath}`).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((line, index) => index > start && line === "}");
  expect(end, `${name} has no closing brace in ${sourcePath}`).toBeGreaterThan(start);
  return lines.slice(start, end + 1).join("\n");
}

/** The stderr lines of the runner. */
function stderrLines(result: { stderr: string | null }): string[] {
  return (result.stderr ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** The pids of the live processes whose command line holds the text. */
function liveServeProcesses(): string[] {
  const out: string[] = [];
  let names: string[];
  try {
    names = readdirSync("/proc");
  } catch {
    return out;
  }
  for (const name of names) {
    if (!/^[0-9]+$/.test(name)) continue;
    const cmdline = procCmdline(Number(name));
    if (cmdline.includes("serve --service")) out.push(`${name} ${cmdline}`);
  }
  return out;
}

/** The auth export calls of the fake log. */
function exportCalls(entries: LogEntry[]): LogEntry[] {
  return entries.filter((entry) => entry.argv.startsWith("auth export"));
}

/** The load watch of the PM: no server and no fake child of this run may
 * stay alive after the file. The scan keeps the lines that hold a temp
 * folder of this suite (`mg-`). */
afterAll(async () => {
  sweepHelpers();
  await stopStartedServers();
  const quotaOrphans = commandLines(["pgrep", "-f", "mg-.*quota-server"]);
  const fakeOrphans = commandLines(["bash", "-c", "ps -eo pid,args | grep '[f]ake-opencode'"]);
  const mine = [...quotaOrphans, ...fakeOrphans].filter((line) => line.includes("mg-"));
  expect(mine, "an orphan process of this run stays alive").toEqual([]);
});

interface CallSpec {
  exit?: number;
  stderr?: string;
  stdout_bytes?: number;
  pad_bytes?: number;
  sleep?: number;
  value?: string;
  tokens?: Record<string, unknown>;
  /** The real event shapes of one call (task 4.13w, Review A 2fdb8f8):
   * `texts` prints one `text` event each, and `tokens` prints one
   * `step_finish` event with the nested bundle object in `part.tokens`. */
  token_stream?: { texts?: string[]; tokens?: Record<string, unknown> };
  /** The stdout error event of the installed bundle (task 4.13y,
   * Review B ff4e009 N20): the call prints
   * `{"type":"error",...,"error":<the object>}` on stdout. */
  error_event?: Record<string, unknown>;
  /** Extra stdout lines of the call (task 4.13y): each entry is printed
   * on its own line, e.g. hand-built `step_finish` events. */
  raw_lines?: string[];
  /** When set, the call leaves a daemon child behind whose argv holds
   * `serve --service <tag>` and whose HOME is the HOME of the call
   * (task 4.13o). */
  daemon?: string;
  /** The same, but the child ignores SIGTERM, so only SIGKILL stops it. */
  daemon_term?: string;
}

interface Scenario {
  route?: string;
  family?: string;
  kind?: string;
  quotaProvider?: string | null;
  quotaSource?: string | null;
  diffs?: string[];
  /** When true, the `src/` copy of a diff holds a source-only marker and the
   * `diffs/` copy holds a seeded marker, so the two texts differ. */
  distinctCopies?: boolean;
  calls?: CallSpec[];
  quotaPercent?: number;
  quotaStopPercent?: number;
  quotaStopAfter?: number;
  /** The week value of the fake quota server. It defaults to quotaPercent. */
  quotaWeek?: number;
  /** The week value after quotaStopAfter model calls. It defaults to
   * quotaStopPercent. It lets the week rise while 5h stays low. */
  quotaStopWeek?: number;
  /** When true, the fake quota server serves the real window set of the
   * live opencode-go source ("5h", "weekly", "monthly", and a null
   * "credits_balance") instead of "5h", "day", "week" (task 4.13i). */
  realKeys?: boolean;
  /** When true, the fixture copies the real provider-credential.sh instead
   * of the stub, so the seed and the value scan reach the fake (task 4.13o).
   * The export answers the store of the call HOME: `authExportShared` for a
   * call outside the job home, `authExportJob` for a call inside it. Each
   * one is the array text of the store. */
  realCredential?: boolean;
  authExportShared?: unknown;
  authExportJob?: unknown;
  setId?: string;
  routes?: unknown[];
}

interface Fixture {
  root: string;
  fakeRoot: string;
  repo: string;
  privateDir: string;
  home: string;
  tmp: string;
  logPath: string;
  specPath: string;
  pidPath: string;
  daemonPath: string;
  fakePath: string;
  fakeDir: string;
  requestPath: string;
  setId: string;
  route: string;
  diffs: string[];
  quotaBase: string;
  runCounter: number;
  close: () => void;
}

/** The runner is the module under test. Its absence is the Red reason. */
function assertRunnerExists(): void {
  expect(
    existsSync(RUNNER_SOURCE),
    `the review runner is missing: ${RUNNER_SOURCE}`,
  ).toBe(true);
}

/** One synthetic source diff of the set. */
function diffText(id: string): string {
  return [
    `--- a/src/${id}.ts`,
    `+++ b/src/${id}.ts`,
    "@@ -1,6 +1,6 @@",
    " export const value = 1;",
    "-export const other = 2;",
    "+export const other = 3;",
    " export const third = 4;",
    "",
  ].join("\n");
}

/** The text of `src/<id>.diff`: the source diff, without the plants. It holds
 * the marker `SRC-ONLY-<id>`, which the seeded copy does not hold. */
function sourceDiffText(id: string): string {
  return `${diffText(id)}+// SRC-ONLY-${id}\n`;
}

/** The text of `diffs/<id>.diff`: the seeded diff of spec D7. It holds the
 * marker `SEEDED-<id>`, which the source copy does not hold. */
function seededDiffText(id: string): string {
  return `${diffText(id)}+// SEEDED-${id}\n`;
}

/** The stub of the provider credential helper. The real helper is the file of
 * the Green task 4.6, and its own test file proves it. The runner test needs
 * one provider and one value, so the stub serves both. */
const CREDENTIAL_STUB = `#!/usr/bin/env bash
set -uo pipefail
case "\${1:-}" in
  seed) exit 0 ;;
  scan-values) printf '%s\\n' "\${MG_TEST_SECRET_VALUE:-}"; exit 0 ;;
  *) echo "provider-credential: unknown mode" >&2; exit 2 ;;
esac
`;

/** The stub of the quota helper is the real file of the Green task 4.4. The
 * runner reads the quota through the seam `BENCH_QUOTA_BASE`, so the case
 * needs the real file when it exists. */
function copyIfPresent(source: string, target: string, mode?: number): void {
  if (!existsSync(source)) return;
  writeFileSync(target, readFileSync(source));
  if (mode !== undefined) chmodSync(target, mode);
}

/** The names and the bytes of every file of one tree. */
function snapshotTree(dir: string, skip: string[] = []): string[] {
  const out: string[] = [];
  const walk = (current: string, prefix: string): void => {
    let names: string[];
    try {
      names = readdirSync(current).sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (prefix === "" && skip.includes(name)) continue;
      const full = join(current, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const info = lstatSync(full);
      if (info.isSymbolicLink()) {
        out.push(`link ${rel} ${readlinkSync(full)}`);
        continue;
      }
      if (info.isDirectory()) {
        out.push(`dir ${rel}`);
        walk(full, rel);
        continue;
      }
      const hash = createHash("sha256").update(readFileSync(full)).digest("hex");
      out.push(`file ${rel} ${hash} ${info.size}`);
    }
  };
  walk(dir, "");
  return out;
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

/** The files of one tree that hold a text. */
function filesHolding(dir: string, needle: string): string[] {
  return filesUnder(dir).filter((file) => {
    try {
      return readFileSync(file, "utf8").includes(needle);
    } catch {
      return false;
    }
  });
}

/** One log line of the fake `opencode`. The `home`, `cwd`, and `ppidcmd`
 * fields are the HOME, the working folder, and the parent argv of the call
 * (task 4.13o). */
interface LogEntry {
  argv0: string;
  argv: string;
  config: string;
  job: string;
  home: string;
  cwd: string;
  ppidcmd: string;
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
        argv0: fields.argv0 ?? "",
        argv: fields.argv ?? "",
        config: fields.config ?? "",
        job: fields.job ?? "",
        home: fields.home ?? "",
        cwd: fields.cwd ?? "",
        ppidcmd: fields.ppidcmd ?? "",
        stdin: fields.stdin ?? "",
      };
    });
}

/** The log lines of the model calls. */
function modelCalls(entries: LogEntry[]): LogEntry[] {
  return entries.filter((entry) => entry.argv.startsWith("run "));
}

/** The pass records of the private folder. A pass record is a JSON file with
 * a `state` field. */
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

/** The named lines of the runner. */
function namedLines(result: { stdout: string | null }): string[] {
  return (result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^review-run/.test(line));
}

/** The stdout lines of the runner. */
function stdoutLines(result: { stdout: string | null }): string[] {
  return (result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** The fields of the pass record that name a completion. */
function completionMarkers(record: Record<string, unknown>): string[] {
  return Object.keys(record).filter((key) => key === "complete" || key === "completed");
}

/** The quota source of the case. It is a temp script that the test writes.
 * It answers `GET /api/quota/<id>` with the windows of spec D15, and it logs
 * every request path. */
const QUOTA_SERVER_SOURCE = `const fs = require("node:fs");
const http = require("node:http");
const logPath = process.env.QUOTA_LOG || "";
const percent = Number(process.env.QUOTA_PERCENT || "10");
const stopText = process.env.QUOTA_STOP_PERCENT || "";
const stopPercent = stopText === "" ? null : Number(stopText);
const stopAfter = Number(process.env.QUOTA_STOP_AFTER || "2");
const requestLog = process.env.QUOTA_REQUEST_LOG || "";
const weekText = process.env.QUOTA_WEEK || "";
const weekStart = weekText === "" ? percent : Number(weekText);
const stopWeekText = process.env.QUOTA_STOP_WEEK || "";
const realKeys = process.env.QUOTA_REAL_KEYS === "1";

// The number of the model calls of the fake log.
const modelCalls = () => {
  let text = "";
  try { text = fs.readFileSync(logPath, "utf8"); } catch (error) { return 0; }
  let count = 0;
  for (const line of text.split("\\n")) {
    const at = line.indexOf("argv=");
    if (at < 0) continue;
    const rest = line.slice(at + 5);
    const end = rest.indexOf("\\t");
    const argv = end < 0 ? rest : rest.slice(0, end);
    if (argv.startsWith("run ")) count += 1;
  }
  return count;
};

const server = http.createServer((req, res) => {
  const url = req.url || "";
  if (requestLog !== "") fs.appendFileSync(requestLog, url + "\\n");
  let fiveH = percent;
  let day = percent;
  let week = weekStart;
  if (modelCalls() >= stopAfter && (stopPercent !== null || stopWeekText !== "")) {
    if (stopPercent !== null) {
      fiveH = stopPercent;
      day = stopPercent;
      week = stopPercent;
    }
    if (stopWeekText !== "") week = Number(stopWeekText);
  }
  // The opencode-go source serves the real window set of the live
  // endpoint (task 4.13i): it names the week window "weekly", holds
  // "monthly", and holds a null "credits_balance". Every other source
  // keeps "5h", "day", "week". realKeys forces the live set for the G4
  // case no matter the path.
  const live = realKeys || url.indexOf("/opencode-go") !== -1;
  const body = live
    ? JSON.stringify({
      usage: {
        windows: {
          "5h": { usedPercent: fiveH },
          weekly: { usedPercent: week },
          monthly: { usedPercent: day },
          credits_balance: { usedPercent: null },
        },
      },
    })
    : JSON.stringify({
      usage: {
        windows: {
          "5h": { usedPercent: fiveH },
          day: { usedPercent: day },
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

/** The routes file of a temp repo: the route of the case, and the metered
 * route of the refusal case. A case that needs a route the file does not
 * hold passes its own list, so the file never holds that route.
 *
 * A no-source row keeps the shape of the committed `routes.json`: the
 * `quota_provider` is not empty and `quota_source` is `null`. `quotaSource`
 * distinguishes `undefined` (the default source) from `null` (no source). */
function routesFile(
  route: string,
  options: {
    family?: string;
    kind?: string;
    quotaProvider?: string | null;
    quotaSource?: string | null;
  } = {},
): unknown[] {
  return [
    {
      family: options.family ?? "Go",
      route,
      kind: options.kind ?? "plan",
      quota_provider: options.quotaProvider ?? "opencode-go",
      quota_source: options.quotaSource === undefined ? "opencode-go" : options.quotaSource,
      ranked: true,
    },
    {
      family: "DeepSeek Flash",
      route: METERED_ROUTE,
      kind: "metered",
      quota_provider: "deepseek",
      quota_source: null,
      ranked: false,
    },
  ];
}

/** Builds the temp repo, the private folder, the fake, and the quota server. */
async function buildFixture(scenario: Scenario = {}): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), "mg-review-run-"));
  const fakeRoot = mkdtempSync(join(tmpdir(), "mg-review-fake-"));
  tempRoots.add(root);
  tempRoots.add(fakeRoot);
  const repo = join(root, "repo");
  const privateDir = join(root, "private");
  const home = join(root, "home");
  const tmp = join(root, "tmp");
  const guideDir = join(repo, "harness", "model-guide");
  const binDir = join(repo, "bin");
  const fakeDir = join(binDir, "fake-opencode.d");
  const fakePath = join(binDir, "fake-opencode");
  const logPath = join(fakeRoot, "opencode.log");
  const specPath = join(fakeRoot, "opencode-spec.json");
  const pidPath = join(fakeRoot, "opencode-pids.txt");
  const daemonPath = join(fakeRoot, "opencode-daemons.txt");

  for (const dir of [guideDir, binDir, fakeDir, home, tmp, privateDir]) {
    mkdirSync(dir, { recursive: true });
  }
  mkdirSync(join(repo, "docs", "assets", "css"), { recursive: true });
  mkdirSync(join(repo, "docs", "assets", "data"), { recursive: true });

  // The scripts that the runner runs sit in the temp repo, so the runner
  // never touches the real repository.
  copyIfPresent(RUNNER_SOURCE, join(guideDir, "review-run.sh"), 0o755);
  copyIfPresent(PROMPT_SOURCE, join(guideDir, "review-prompt.md"));
  copyIfPresent(QUOTA_SOURCE, join(guideDir, "quota.ts"));
  copyIfPresent(HOST_SOURCE, join(repo, "harness", "opencode-host.sh"), 0o755);
  copyIfPresent(CREDENTIAL_SOURCE, join(repo, "harness", "opencode-credential.sh"), 0o755);
  // The credential helper: the stub, or the real file when the case pins
  // the seed HOME (task 4.13o). The real helper needs no network: it reads
  // the fake through BENCH_OPENCODE_BIN and selects with node.
  if (scenario.realCredential === true) {
    copyIfPresent(
      join(HARNESS, "model-guide", "provider-credential.sh"),
      join(guideDir, "provider-credential.sh"),
      0o755,
    );
  } else {
    writeFileSync(join(guideDir, "provider-credential.sh"), CREDENTIAL_STUB, { mode: 0o755 });
  }

  // The fake `opencode`. The path of the file holds the text `fake-opencode`,
  // and the directory of the PATH entry holds it too, so a resolved
  // `opencode` is the fake.
  writeFileSync(fakePath, readFileSync(FAKE_SOURCE), { mode: 0o755 });
  writeFileSync(join(fakeDir, "opencode"), readFileSync(FAKE_SOURCE), { mode: 0o755 });

  // A local `tsx`, so a runner that calls `quota.ts` finds no network.
  if (existsSync(TSX_BIN)) {
    mkdirSync(join(repo, "node_modules", ".bin"), { recursive: true });
    symlinkSync(TSX_BIN, join(repo, "node_modules", ".bin", "tsx"));
  }

  // The routes of the temp repo. The file is a JSON array of route objects.
  const route = scenario.route ?? ROUTE;
  const routes = scenario.routes ??
    routesFile(route, {
      family: scenario.family,
      kind: scenario.kind,
      quotaProvider: scenario.quotaProvider,
      quotaSource: scenario.quotaSource,
    });
  writeFileSync(join(guideDir, "routes.json"), `${JSON.stringify(routes, null, 2)}\n`);

  // A synthetic docs tree. It must stay byte-identical.
  writeFileSync(join(repo, "docs", "index.html"), "<!doctype html>\n<title>Index</title>\n");
  writeFileSync(join(repo, "docs", "assets", "css", "site.css"), "body { color: #222; }\n");
  writeFileSync(join(repo, "docs", "assets", "data", "benchmark.json"), '{"runs":0}\n');

  // The set of the run.
  const setId = scenario.setId ?? SET_ID;
  const diffs = scenario.diffs ?? ["d-01", "d-02", "d-03"];
  const srcDir = join(privateDir, "sets", setId, "src");
  const seededDir = join(privateDir, "sets", setId, "diffs");
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(seededDir, { recursive: true });
  for (const diff of diffs) {
    if (scenario.distinctCopies) {
      writeFileSync(join(srcDir, `${diff}.diff`), sourceDiffText(diff));
      writeFileSync(join(seededDir, `${diff}.diff`), seededDiffText(diff));
    } else {
      writeFileSync(join(srcDir, `${diff}.diff`), diffText(diff));
      writeFileSync(join(seededDir, `${diff}.diff`), diffText(diff));
    }
  }
  // The message line of each diff (spec D10 ruling 2026-11-18): one line in
  // `messages/<diff_id>.txt`. The runner sends it between the prompt and the
  // seeded diff. Every fixture writes it, so the earlier cases stay green
  // once the Green role lands.
  const messagesDir = join(privateDir, "sets", setId, "messages");
  mkdirSync(messagesDir, { recursive: true });
  for (const diff of diffs) {
    writeFileSync(join(messagesDir, `${diff}.txt`), `MSG-LINE-${diff} the commit message of the diff\n`);
  }

  // The spec of the fake. The shared and job stores answer `auth export`
  // by the HOME of the call when the case pins the seed HOME (task 4.13o).
  // A store that the case does not name falls back to `auth_export`.
  const specDoc: Record<string, unknown> = {
    calls: scenario.calls ?? [],
    auth_export: JSON.stringify([
      {
        integrationID: "opencode",
        active: true,
        value: {
          access: SECRET,
          refresh: "inert",
          expires: 9999999999999,
          metadata: { orgID: "org-test-0123456789" },
        },
      },
    ]),
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

  // The quota server of the case. It is the only socket of the file.
  //
  // The server runs in its own process. A server of the test process would
  // not answer while the test waits for the runner, because the test blocks
  // in `spawnSync` and the event loop of the process stops.
  const requestPath = join(fakeRoot, "quota-requests.txt");
  const serverPath = join(fakeRoot, "quota-server.js");
  writeFileSync(serverPath, QUOTA_SERVER_SOURCE);
  const percent = scenario.quotaPercent ?? 10;
  const stopPercent = scenario.quotaStopPercent;
  const stopAfter = scenario.quotaStopAfter ?? 2;
  const week = scenario.quotaWeek;
  const stopWeek = scenario.quotaStopWeek;
  const realKeys = scenario.realKeys ?? false;
  const server = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      QUOTA_LOG: logPath,
      QUOTA_PERCENT: String(percent),
      QUOTA_STOP_PERCENT: stopPercent === undefined ? "" : String(stopPercent),
      QUOTA_STOP_AFTER: String(stopAfter),
      QUOTA_WEEK: week === undefined ? "" : String(week),
      QUOTA_STOP_WEEK: stopWeek === undefined ? "" : String(stopWeek),
      QUOTA_REAL_KEYS: realKeys ? "1" : "",
      QUOTA_REQUEST_LOG: requestPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // The load watch: the file waits for this exit in the afterEach, and the
  // process handlers kill it when a test stops before its finally block.
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

  return {
    root,
    fakeRoot,
    repo,
    privateDir,
    home,
    tmp,
    logPath,
    specPath,
    pidPath,
    daemonPath,
    fakePath,
    fakeDir,
    requestPath,
    setId,
    route,
    diffs,
    quotaBase: `http://127.0.0.1:${port}`,
    runCounter: 0,
    close: () => {
      server.kill("SIGKILL");
    },
  };
}

/** The quota requests that the server received. */
function quotaRequests(fixture: Fixture): string[] {
  if (!existsSync(fixture.requestPath)) return [];
  return readFileSync(fixture.requestPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** Removes the temp trees of a case. */
function dropFixture(fixture: Fixture): void {
  fixture.close();
  rmSync(fixture.root, { recursive: true, force: true });
  rmSync(fixture.fakeRoot, { recursive: true, force: true });
  tempRoots.delete(fixture.root);
  tempRoots.delete(fixture.fakeRoot);
}

/** The environment of a spawn. Every path is inside the temp tree. */
function spawnEnv(fixture: Fixture, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
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
    FAKE_OPENCODE_DAEMON_FILE: fixture.daemonPath,
    BENCH_QUOTA_BASE: fixture.quotaBase,
    MG_TEST_SECRET_VALUE: SECRET,
    MG_CALL_TIMEOUT_S: "600",
    MG_RUN_RETRY_WAIT_MS: "0",
    ...extra,
  };
  delete env.BENCH_TRACK;
  delete env.OPENCODE_CONFIG;
  if (extra.MG_UNSET_SERVER_BASE === "1") delete env.BENCH_SERVER_BASE;
  return env;
}

/** Runs the runner of the temp repo.
 *
 * The output goes to two files of the temp folder, not to a pipe. A runner
 * that leaves a child process behind holds the pipe open, and the read of the
 * pipe would wait for that child. */
function runRunner(
  fixture: Fixture,
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
    result = spawnSync(
      "bash",
      [join(fixture.repo, "harness", "model-guide", "review-run.sh"), ...args],
      {
        cwd: fixture.repo,
        env: spawnEnv(fixture, extra),
        encoding: "utf8",
        timeout: 20_000,
        stdio: ["ignore", outFd, errFd],
      },
    );
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
function runArgs(fixture: Fixture, route?: string, setId?: string): string[] {
  return [
    "--route",
    route ?? fixture.route,
    "--set",
    setId ?? fixture.setId,
    "--private",
    fixture.privateDir,
  ];
}

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
    await new Promise((done) => setTimeout(done, 50));
  }
  return !isAlive(pid);
}

/** The live processes whose command line holds the text. */
function liveFakeProcesses(): string[] {
  const out: string[] = [];
  let names: string[];
  try {
    names = readdirSync("/proc");
  } catch {
    return out;
  }
  for (const name of names) {
    if (!/^[0-9]+$/.test(name)) continue;
    let cmdline: string;
    try {
      cmdline = readFileSync(`/proc/${name}/cmdline`, "utf8");
    } catch {
      continue;
    }
    if (cmdline.includes("fake-opencode")) out.push(`${name} ${cmdline.replace(/\0/g, " ").trim()}`);
  }
  return out;
}

describe("P4 R1 the pass shape of the review runner", () => {
  it("R1 calls the fake once for each diff, stores one raw output per diff in the private folder, and writes one pass record", async () => {
    const fixture = await buildFixture({
      calls: [
        { value: JSON.stringify({ type: "result", text: "RAW-d-01" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-02" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-03" }) },
      ],
    });
    try {
      assertRunnerExists();
      const before = snapshotTree(fixture.repo, [".tmp"]);
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(modelCalls(logEntries(fixture.logPath))).toHaveLength(3);
      for (const diff of fixture.diffs) {
        const stored = filesHolding(fixture.privateDir, `RAW-${diff}`);
        expect(stored, `no stored raw output for ${diff}`).toHaveLength(1);
      }
      expect(filesHolding(fixture.repo, "RAW-"), "a raw output left the private folder").toEqual([]);
      const records = passRecords(fixture.privateDir);
      expect(records, "the runner wrote no pass record").toHaveLength(1);
      expect(["complete", "open"]).toContain(records[0].state);
      expect(snapshotTree(fixture.repo, [".tmp"])).toEqual(before);
    } finally {
      dropFixture(fixture);
    }
  });

  it("R2 calls the model with run --standalone --format json --model <route>", async () => {
    const fixture = await buildFixture({
      calls: [{ value: JSON.stringify({ type: "result", text: "RAW-d-01" }) }],
      diffs: ["d-01"],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const calls = modelCalls(logEntries(fixture.logPath));
      expect(calls).toHaveLength(1);
      expect(calls[0].argv).toBe(`run --standalone --format json --model ${ROUTE}`);
    } finally {
      dropFixture(fixture);
    }
  });

  it("R3 writes a job config that denies read, edit, bash, webfetch, websearch, question, subagent, and skill", async () => {
    const fixture = await buildFixture({
      calls: [{ value: JSON.stringify({ type: "result", text: "RAW-d-01" }) }],
      diffs: ["d-01"],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const calls = modelCalls(logEntries(fixture.logPath));
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call.config, "the call got no job config").not.toBe("");
        let config: unknown = null;
        try {
          config = JSON.parse(call.config);
        } catch {
          config = null;
        }
        expect(config, `the job config is not JSON: ${call.config}`).not.toBeNull();
        const permission = (config as { permission?: Record<string, string> } | null)?.permission ?? {};
        const missing = DENY_TOOLS.filter((tool) => permission[tool] !== "deny");
        expect(missing.join(", "), `the job config does not deny: ${missing.join(", ")}`).toBe("");
      }
    } finally {
      dropFixture(fixture);
    }
  });
});

describe("P4 R4 the route refusal", () => {
  it("R4 refuses a route that routes.json does not hold before any call", async () => {
    // The route of the run is not in the temp routes.json: the file holds
    // the plan route of the case, and the run names another route.
    const fixture = await buildFixture({
      route: UNKNOWN_ROUTE,
      routes: routesFile(ROUTE),
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      expect(logEntries(fixture.logPath), "the fake log is not empty").toEqual([]);
      expect(passRecords(fixture.privateDir), "the runner wrote a pass record").toEqual([]);
      const named = namedLines(result);
      expect(named, `the runner printed no named line: ${result.stdout}`).toHaveLength(1);
      expect(named[0]).toMatch(/route/);
    } finally {
      dropFixture(fixture);
    }
  });

  it("R4 refuses a route whose kind is metered before any call", async () => {
    const fixture = await buildFixture({ route: METERED_ROUTE, kind: "metered" });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      expect(logEntries(fixture.logPath), "the fake log is not empty").toEqual([]);
      expect(passRecords(fixture.privateDir), "the runner wrote a pass record").toEqual([]);
      const named = namedLines(result);
      expect(named, `the runner printed no named line: ${result.stdout}`).toHaveLength(1);
      expect(named[0]).toMatch(/kind|metered/);
    } finally {
      dropFixture(fixture);
    }
  });
});

describe("P4 R5 the quota start rule of a non-Go source", () => {
  it("R5 starts no pass at a window of 70 % and starts the pass at 69.9 %", async () => {
    const wait = await buildFixture({
      quotaProvider: "kimi-code-plan-cn",
      quotaSource: "kimi-for-coding",
      quotaPercent: 70,
      calls: [{ value: JSON.stringify({ type: "result", text: "RAW-d-01" }) }],
    });
    try {
      assertRunnerExists();
      const result = runRunner(wait, runArgs(wait));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(modelCalls(logEntries(wait.logPath)), "the runner called the model at 70 %").toEqual([]);
      expect(filesHolding(wait.privateDir, "RAW-"), "the runner stored a raw output at 70 %").toEqual([]);
      const records = passRecords(wait.privateDir);
      expect(records, "the runner wrote no pass record").toHaveLength(1);
      expect(records[0].state).toBe("wait");
      expect(
        quotaRequests(wait).filter((path) => path.startsWith("/api/quota/")),
        "the runner read no quota through BENCH_QUOTA_BASE",
      ).not.toEqual([]);
    } finally {
      dropFixture(wait);
    }

    const ready = await buildFixture({
      quotaProvider: "kimi-code-plan-cn",
      quotaSource: "kimi-for-coding",
      quotaPercent: 69.9,
      calls: [
        { value: JSON.stringify({ type: "result", text: "RAW-d-01" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-02" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-03" }) },
      ],
    });
    try {
      const result = runRunner(ready, runArgs(ready));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(modelCalls(logEntries(ready.logPath)), "the runner started no pass at 69.9 %").toHaveLength(3);
    } finally {
      dropFixture(ready);
    }
  });
});

describe("P4 R6 the quota stop rule of a non-Go source", () => {
  it("R6 stops the pass at 80 % and leaves the pass open with the two stored outputs", async () => {
    const fixture = await buildFixture({
      quotaProvider: "kimi-code-plan-cn",
      quotaSource: "kimi-for-coding",
      quotaStopPercent: 80,
      quotaStopAfter: 2,
      calls: [
        { value: JSON.stringify({ type: "result", text: "RAW-d-01" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-02" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-03" }) },
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      const records = passRecords(fixture.privateDir);
      expect(records, "the runner wrote no pass record").toHaveLength(1);
      expect(records[0].state).toBe("open");
      expect(records[0].outputs ?? [], "the pass record holds no stored output").toHaveLength(2);
      expect(completionMarkers(records[0]), "the pass record holds a complete marker").toEqual([]);
      expect(filesHolding(fixture.privateDir, "RAW-"), "the runner stored three raw outputs").toHaveLength(2);
    } finally {
      dropFixture(fixture);
    }
  });

  it("R6 runs the pass to the end at 79 %", async () => {
    // The window starts at 69.9 %, so the pass starts (D15: a window of
    // 70 % at the start gives no pass). It rises to 79 % after the second
    // diff, and the pass still runs to the end: the stop rule fires at
    // 80 % only.
    const fixture = await buildFixture({
      quotaProvider: "kimi-code-plan-cn",
      quotaSource: "kimi-for-coding",
      quotaPercent: 69.9,
      quotaStopPercent: 79,
      quotaStopAfter: 2,
      calls: [
        { value: JSON.stringify({ type: "result", text: "RAW-d-01" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-02" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-03" }) },
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const records = passRecords(fixture.privateDir);
      expect(records).toHaveLength(1);
      expect(records[0].state).toBe("complete");
      expect(filesHolding(fixture.privateDir, "RAW-")).toHaveLength(3);
    } finally {
      dropFixture(fixture);
    }
  });
});

describe("P4 the Go plan thresholds of the review runner (task 4.13g)", () => {
  it("G1 the pass starts on a Go route at week 97 % with a low 5h and refuses at week 100 %", async () => {
    const ready = await buildFixture({
      quotaPercent: 10,
      quotaWeek: 97,
      calls: [
        { value: JSON.stringify({ type: "result", text: "RAW-d-01" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-02" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-03" }) },
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(ready, runArgs(ready));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(modelCalls(logEntries(ready.logPath)), "the runner started no pass at week 97 %").toHaveLength(3);
      const records = passRecords(ready.privateDir);
      expect(records, "the runner wrote no pass record").toHaveLength(1);
      expect(records[0].state).toBe("complete");
    } finally {
      dropFixture(ready);
    }

    const wait = await buildFixture({
      quotaPercent: 10,
      quotaWeek: 100,
      calls: [{ value: JSON.stringify({ type: "result", text: "RAW-d-01" }) }],
    });
    try {
      assertRunnerExists();
      const result = runRunner(wait, runArgs(wait));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(modelCalls(logEntries(wait.logPath)), "the runner called the model at week 100 %").toEqual([]);
      expect(filesHolding(wait.privateDir, "RAW-"), "the runner stored a raw output at week 100 %").toEqual([]);
      const records = passRecords(wait.privateDir);
      expect(records, "the runner wrote no pass record").toHaveLength(1);
      expect(records[0].state).toBe("wait");
    } finally {
      dropFixture(wait);
    }
  });

  it("G2 the pass stops before the next diff at the Go thresholds but not at 80 %", async () => {
    const through = await buildFixture({
      quotaPercent: 10,
      quotaWeek: 10,
      quotaStopWeek: 80,
      quotaStopAfter: 2,
      calls: [
        { value: JSON.stringify({ type: "result", text: "RAW-d-01" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-02" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-03" }) },
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(through, runArgs(through));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(modelCalls(logEntries(through.logPath)), "the runner stopped the Go pass at 80 %").toHaveLength(3);
      const records = passRecords(through.privateDir);
      expect(records, "the runner wrote no pass record").toHaveLength(1);
      expect(records[0].state).toBe("complete");
      expect(filesHolding(through.privateDir, "RAW-"), "the runner stored three raw outputs").toHaveLength(3);
    } finally {
      dropFixture(through);
    }

    const stopped = await buildFixture({
      quotaPercent: 10,
      quotaWeek: 10,
      quotaStopWeek: 100,
      quotaStopAfter: 2,
      calls: [
        { value: JSON.stringify({ type: "result", text: "RAW-d-01" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-02" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-03" }) },
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(stopped, runArgs(stopped));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(modelCalls(logEntries(stopped.logPath)), "the runner called the model after week 100 %").toHaveLength(2);
      const records = passRecords(stopped.privateDir);
      expect(records, "the runner wrote no pass record").toHaveLength(1);
      expect(records[0].state).toBe("open");
      expect(records[0].outputs ?? [], "the pass record holds no stored output").toHaveLength(2);
      expect(completionMarkers(records[0]), "the pass record holds a complete marker").toEqual([]);
    } finally {
      dropFixture(stopped);
    }
  }, 120_000);

  it("G4 the pass starts with the real window set at weekly 97 % and refuses at weekly 100 %", async () => {
    const ready = await buildFixture({
      quotaPercent: 10,
      quotaWeek: 97,
      realKeys: true,
      calls: [
        { value: JSON.stringify({ type: "result", text: "RAW-d-01" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-02" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-03" }) },
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(ready, runArgs(ready));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(modelCalls(logEntries(ready.logPath)), "the runner started no pass at weekly 97 %").toHaveLength(3);
      const records = passRecords(ready.privateDir);
      expect(records, "the runner wrote no pass record").toHaveLength(1);
      expect(records[0].state).toBe("complete");
    } finally {
      dropFixture(ready);
    }

    const wait = await buildFixture({
      quotaPercent: 10,
      quotaWeek: 100,
      realKeys: true,
      calls: [{ value: JSON.stringify({ type: "result", text: "RAW-d-01" }) }],
    });
    try {
      assertRunnerExists();
      const result = runRunner(wait, runArgs(wait));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(modelCalls(logEntries(wait.logPath)), "the runner called the model at weekly 100 %").toEqual([]);
      expect(filesHolding(wait.privateDir, "RAW-"), "the runner stored a raw output at weekly 100 %").toEqual([]);
      const records = passRecords(wait.privateDir);
      expect(records, "the runner wrote no pass record").toHaveLength(1);
      expect(records[0].state).toBe("wait");
    } finally {
      dropFixture(wait);
    }
  });
});

describe("P4 R7 the transient retry", () => {
  it("R7 retries a transport error twice and completes the pass", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [
        { exit: 1, stderr: "provider: transport error" },
        { exit: 1, stderr: "provider: transport error" },
        { value: JSON.stringify({ type: "result", text: "RAW-d-01" }) },
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(modelCalls(logEntries(fixture.logPath)), "the runner did not retry the diff").toHaveLength(3);
      const records = passRecords(fixture.privateDir);
      expect(records).toHaveLength(1);
      expect(records[0].state).toBe("complete");
    } finally {
      dropFixture(fixture);
    }
  });

  it("R7 leaves the pass open after three transport errors", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [
        { exit: 1, stderr: "provider: transport error" },
        { exit: 1, stderr: "provider: transport error" },
        { exit: 1, stderr: "provider: transport error" },
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(modelCalls(logEntries(fixture.logPath)), "the runner retried a fourth time").toHaveLength(3);
      const records = passRecords(fixture.privateDir);
      expect(records).toHaveLength(1);
      expect(records[0].state).toBe("open");
      expect(completionMarkers(records[0]), "the pass record holds a complete marker").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });
});

describe("P4 R8 the bad retry wait value", () => {
  for (const bad of ["NaN", "Infinity", "-1", "1e999"]) {
    it(`R8 ends the run inside the timeout with MG_RUN_RETRY_WAIT_MS=${bad}`, async () => {
      const fixture = await buildFixture({
        diffs: ["d-01"],
        calls: [
          { exit: 1, stderr: "provider: transport error" },
          { value: JSON.stringify({ type: "result", text: "RAW-d-01" }) },
        ],
      });
      try {
        assertRunnerExists();
        const started = Date.now();
        const result = runRunner(fixture, runArgs(fixture), { MG_RUN_RETRY_WAIT_MS: bad });
        const elapsed = Date.now() - started;
        expect(result.error, "the spawn hit the 20 s timeout").toBeUndefined();
        expect(elapsed, "the run did not end inside 20 s").toBeLessThan(20_000);
        if (result.status === 2) {
          expect(namedLines(result), `the runner printed no named line: ${result.stdout}`).toHaveLength(1);
        } else {
          const records = passRecords(fixture.privateDir);
          expect(records).toHaveLength(1);
          expect(["complete", "open"]).toContain(records[0].state);
        }
      } finally {
        dropFixture(fixture);
      }
    });
  }
});

describe("P4 R9 the value scan", () => {
  it("R9 deletes a raw output that holds a credential value and stops the pass", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [{ value: JSON.stringify({ type: "result", text: SECRET }) }],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(filesHolding(fixture.privateDir, SECRET), "the credential value stayed in the private folder").toEqual([]);
      expect(filesHolding(fixture.repo, SECRET), "the credential value stayed in the repository").toEqual([]);
      expect(readFileSync(fixture.logPath, "utf8").includes(SECRET), "the credential value stayed in the log").toBe(false);
      const named = namedLines(result);
      expect(
        named.filter((line) => /value|scan|credential/i.test(line)),
        `the runner printed no named line: ${result.stdout}`,
      ).toHaveLength(1);
      const records = passRecords(fixture.privateDir);
      expect(records).toHaveLength(1);
      expect(records[0].state).toBe("open");
    } finally {
      dropFixture(fixture);
    }
  });
});

describe("P4 R10 the large raw output", () => {
  it("R10 stores a 2 MiB raw output whole on the isolated path", async () => {
    // Row 4.16 r6: restore the r4 contract (test-strategy.md:695). The
    // non-pilot route of this fixture keeps the isolated seed path.
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [{ stdout_bytes: TWO_MIB, value: "TAIL-MARKER" }],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const stored = filesHolding(fixture.privateDir, "TAIL-MARKER");
      expect(stored, "the runner stored no raw output with the tail").toHaveLength(1);
      expect(statSync(stored[0]).size, "the raw output was cut").toBeGreaterThan(TWO_MIB - 1024);
    } finally {
      dropFixture(fixture);
    }
  });

  it("R10 finds a credential value in the last 1000 bytes of a 2 MiB raw output", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [{ stdout_bytes: TWO_MIB, value: SECRET }],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(filesHolding(fixture.privateDir, SECRET), "the scan missed the tail value").toEqual([]);
      expect(filesHolding(fixture.repo, SECRET), "the tail value stayed in the repository").toEqual([]);
      const records = passRecords(fixture.privateDir);
      expect(records).toHaveLength(1);
      expect(records[0].state).toBe("open");
    } finally {
      dropFixture(fixture);
    }
  });
});

describe("P4 R11 the region rule", () => {
  it("R11 marks a Go route with the region error as region-blocked", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [{ exit: 1, stderr: REGION_ERROR }],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(modelCalls(logEntries(fixture.logPath)), "the runner retried the region error").toHaveLength(1);
      const records = passRecords(fixture.privateDir);
      expect(records).toHaveLength(1);
      expect(records[0].state).toBe("region-blocked");
      expect(records[0].rank ?? null, "the pass record holds a rank").toBeNull();
      const errors = (records[0].errors ?? []) as unknown[];
      expect(errors, "the pass record holds no stored error line").toHaveLength(1);
      expect(String(errors[0])).toContain("region");
      expect(filesHolding(fixture.privateDir, "RAW-"), "the runner stored a raw output").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });
});

describe("P4 R12 the trap of the job folder", () => {
  it("R12 stops the fake child, removes the job folder, and leaves no fake process", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [{ sleep: 30, value: "" }],
    });
    try {
      assertRunnerExists();
      const started = Date.now();
      const result = runRunner(fixture, runArgs(fixture), { MG_CALL_TIMEOUT_S: "2" });
      const elapsed = Date.now() - started;
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(elapsed, "the run did not end inside 15 s").toBeLessThan(15_000);
      const pids = readFileSync(fixture.pidPath, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .map((line) => Number(line));
      expect(pids.length, "the fake wrote no pid").toBeGreaterThan(0);
      for (const pid of pids) {
        expect(await waitForDeath(pid), `the fake child ${pid} is still alive`).toBe(true);
      }
      const tmpDir = join(fixture.repo, ".tmp");
      const folders = existsSync(tmpDir)
        ? readdirSync(tmpDir).filter((name) => name.startsWith("opencode-host-"))
        : [];
      expect(folders, "a job folder stayed in the temp repo").toEqual([]);
      expect(liveFakeProcesses(), "a fake process is still alive").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
    // Row 4.16: the case waits for a child to die. Bun's 5 s default fired
    // under the added live-server load. The assertions are unchanged.
  }, 60_000);
});

describe("P4 R13 the no write rule", () => {
  it("R13 writes no file in the temp repo and no file under docs", async () => {
    const fixture = await buildFixture({
      calls: [
        { value: JSON.stringify({ type: "result", text: "RAW-d-01" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-02" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-03" }) },
      ],
    });
    try {
      assertRunnerExists();
      const before = snapshotTree(fixture.repo, [".tmp"]);
      const docsBefore = snapshotTree(join(fixture.repo, "docs"));
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(snapshotTree(join(fixture.repo, "docs")), "the run wrote under docs").toEqual(docsBefore);
      expect(snapshotTree(fixture.repo, [".tmp"]), "the run wrote in the temp repo").toEqual(before);
      expect(filesHolding(fixture.privateDir, "RAW-").length, "the private folder holds no output").toBe(3);
    } finally {
      dropFixture(fixture);
    }
  });
});

describe("P4 R14 the call timeout", () => {
  it("R14 ends the call at MG_CALL_TIMEOUT_S", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [{ sleep: 30, value: "" }],
    });
    try {
      assertRunnerExists();
      const started = Date.now();
      const result = runRunner(fixture, runArgs(fixture), { MG_CALL_TIMEOUT_S: "2" });
      const elapsed = Date.now() - started;
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(elapsed, "the call did not end inside 10 s").toBeLessThan(10_000);
      const records = passRecords(fixture.privateDir);
      expect(records).toHaveLength(1);
      expect(records[0].state, "the pass record is not open").not.toBe("complete");
    } finally {
      dropFixture(fixture);
    }
    // Row 4.16: the case waits for a call timeout. Bun's 5 s default fired
    // under the added live-server load. The assertions are unchanged.
  }, 60_000);
});

describe("P4 R15 the path safety", () => {
  it("R15 refuses a set id with a slash and a route value with a parent segment", async () => {
    const cases: Array<[string, string[]]> = [
      ["set", ["--set", "../x"]],
      ["set", ["--set", "a/b"]],
      ["route", ["--route", "mega/../x"]],
    ];
    for (const [kind, override] of cases) {
      const fixture = await buildFixture({
        calls: [{ value: JSON.stringify({ type: "result", text: "RAW-d-01" }) }],
        diffs: ["d-01"],
      });
      try {
        assertRunnerExists();
        const args = runArgs(fixture);
        const index = args.indexOf(override[0]);
        args.splice(index, 2, override[0], override[1]);
        const before = snapshotTree(fixture.repo, [".tmp"]);
        const result = runRunner(fixture, args);
        expect(result.status, `${kind} ${override[1]}: ${result.stdout}\n${result.stderr}`).toBe(2);
        const named = namedLines(result);
        expect(named, `${kind} ${override[1]}: no named line`).toHaveLength(1);
        expect(named[0]).toMatch(new RegExp(kind));
        expect(snapshotTree(fixture.repo, [".tmp"]), `${kind} ${override[1]}: the run wrote in the temp repo`).toEqual(before);
        expect(
          filesHolding(fixture.privateDir, "RAW-"),
          `${kind} ${override[1]}: the runner stored a raw output`,
        ).toEqual([]);
      } finally {
        dropFixture(fixture);
      }
    }
  });
});

describe("P4 the fake binary of every spawn", () => {
  it("resolves the opencode of the spawn to the fake and leaves no fake process", async () => {
    const fixture = await buildFixture({
      calls: [{ value: JSON.stringify({ type: "result", text: "RAW-d-01" }) }],
      diffs: ["d-01"],
    });
    try {
      assertRunnerExists();
      const resolved = spawnSync("bash", ["-c", "command -v opencode"], {
        env: spawnEnv(fixture),
        encoding: "utf8",
      });
      const path = (resolved.stdout ?? "").trim();
      expect(path, "the spawn has no opencode on the PATH").not.toBe("");
      expect(path, "the resolved opencode is not the fake").toContain("fake-opencode");
      expect(path, "the resolved opencode is not in the temp tree").toContain(fixture.repo);
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const calls = modelCalls(logEntries(fixture.logPath));
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call.argv0, "the model call ran another binary").toContain("fake-opencode");
        expect(call.argv0, "the model call ran a binary outside the temp tree").toContain(fixture.repo);
      }
      expect(liveFakeProcesses(), "a fake process is still alive").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });
});

// --- the check 4.9 fixes: F1 the one-pass rule, F2 the stopped read ------
//
// F1 (spec D15): "A route with no quota source runs at most 1 pass per
// night." The row of the committed `routes.json` says "no source" with
// `quota_source: null` and a non-empty `quota_provider` (`nvidia`), and
// `quota.ts` returns `ready` with the cap 1 for that row. The guard must
// key on the empty source, not on an empty provider.
//
// Refusal contract of F1. Spec D15 gives no exit code and no line. The
// runner's own refusal of a second run under the exclusive lock
// (`review-run.sh`, ADV-R-8) is exit 2 with one line on stderr, so the
// one-pass refusal follows it: exit 2, exactly one line on stderr that
// starts with `review-run:` and names the one-pass rule, an empty stdout,
// no call, and no second pass record.
//
// F2 (spec D15): a quota read that gives `stopped` before the first diff
// leaves the pass `open`, writes one record that holds the quota reason,
// and makes no call.

describe("P4 the check 4.9 fixes F1 and F2", () => {
  const NO_SOURCE_ROUTE = "nvidia/stepfun-ai/step-5-preview#high";
  const RUN_DATE = "2026-11-20";

  it("F1 a route with no quota source runs at most one pass per night, and the second run refuses before any call", async () => {
    const fixture = await buildFixture({
      route: NO_SOURCE_ROUTE,
      family: "StepFun",
      kind: "free",
      quotaProvider: "nvidia",
      quotaSource: null,
      calls: [
        { value: JSON.stringify({ type: "result", text: "RAW-d-01" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-02" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-03" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-04" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-05" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-06" }) },
      ],
    });
    try {
      assertRunnerExists();
      const args = [...runArgs(fixture), "--date", RUN_DATE];

      const first = runRunner(fixture, args);
      expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
      expect(modelCalls(logEntries(fixture.logPath)), "the first run made no call").toHaveLength(3);
      expect(passRecords(fixture.privateDir), "the first run wrote no pass record").toHaveLength(1);
      expect(
        quotaRequests(fixture),
        "a provider with no quota source sent a quota request",
      ).toEqual([]);

      const second = runRunner(fixture, args);
      expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(2);
      const errLines = (second.stderr ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== "");
      expect(
        errLines,
        `the second run must print one line on stderr: ${second.stderr}`,
      ).toHaveLength(1);
      expect(errLines[0], "the refusal line must start with review-run:").toMatch(/^review-run:/);
      expect(errLines[0], "the refusal line must name the one-pass rule").toMatch(
        /one pass per night/,
      );
      expect(second.stdout, "the refusal line must not go to stdout").toBe("");
      expect(
        modelCalls(logEntries(fixture.logPath)),
        "the second run called the model",
      ).toHaveLength(3);
      expect(
        passRecords(fixture.privateDir),
        "the second run wrote a second pass record",
      ).toHaveLength(1);
    } finally {
      dropFixture(fixture);
    }
  });

  it("F2 a stopped quota read before the pass leaves the pass open with no call", async () => {
    const fixture = await buildFixture({
      calls: [{ value: JSON.stringify({ type: "result", text: "RAW-d-01" }) }],
    });
    try {
      assertRunnerExists();
      // A base with no listener gives the read failure of spec D15, so the
      // quota state is `stopped` before the first diff.
      const result = runRunner(fixture, runArgs(fixture), {
        BENCH_QUOTA_BASE: "http://127.0.0.1:1",
      });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const records = passRecords(fixture.privateDir);
      expect(records, "the run wrote no pass record").toHaveLength(1);
      expect(records[0].state, "a stopped quota read must leave the pass open").toBe("open");
      expect(records[0].outputs ?? [], "no output may be stored").toEqual([]);
      const errors = (records[0].errors ?? []) as unknown[];
      expect(errors.length, "the record holds no quota reason").toBeGreaterThan(0);
      expect(String(errors[0]), "the record must name the quota reason").toContain("quota");
      expect(modelCalls(logEntries(fixture.logPath)), "the run called the model").toHaveLength(0);
      expect(filesHolding(fixture.privateDir, "RAW-"), "the run stored a raw output").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });
});

// --- task 4.9a: probe mode, the token log, and the new routes.json ------
//
// Probe mode (spec D14, "Probe mode (PM 2026-11-18)"). `review-run.sh
// --probe` makes exactly one model call on the first control diff of the
// set (a diff with no plant), writes no pass record and no stored raw
// output beyond the probe record, prints one line
// `<route> reachable|unreachable|region-blocked <error line or ->` on
// stdout, and gives exit 0 for `reachable`, exit 3 for `unreachable` or
// `region-blocked`, and exit 2 for a refusal. The probe uses the same
// lock, quota rules, job isolation, credential scan, and trap as a pass.
//
// Contracts this file pins where the spec is silent:
//   - The probe record lives in `<private>/probes/<set_id>/`. It holds
//     `set_id`, `route`, `date`, `state`, `tokens`, and `tokens_complete`,
//     and it names the diff of the call. The pass records stay in
//     `<private>/passes/`.
//   - A probe blocked by the quota rule (a window at 70 %) or by the
//     credential scan is a refusal: exit 2, one `review-run:` line on
//     stdout, and no pass record. A probe that finds the lock held follows
//     the lock refusal of `review-run.sh`: exit 2 and one `review-run:`
//     line on stderr.
//   - `unreachable` and `region-blocked` print the first line of the
//     error of the call after the state word.
//
// Token shape (spec D13, "Tokens (PM 2026-11-18)"). The fake emits one
// json event per call that holds tokens, in the shape of an
// `opencode run --format json` step-finish event:
//
//   {"type":"step-finish","tokens":{"input":10,"output":20,"reasoning":5,
//     "cache":{"read":100,"write":7}}}
//
// The record holds the flat sums, and `total` is the sum of the five
// components:
//
//   "tokens": {"input","output","reasoning","cache_read","cache_write",
//              "total"}
//
// Each entry of `diffs` holds its `id` and its own `tokens` object in the
// same shape. `tokens_complete` is `true` when every call held a token
// field and `false` when one call did not; a call with no token field
// adds 0.
//
// routes.json (spec D12, PM 2026-11-18): three routes leave the committed
// file, and the pilot routes stay.
//
// Every case keeps the orphan nets of the PM load watch, uses only the
// fake `opencode`, and never runs the real `opencode` CLI.

describe("P4 probe mode, the token log, and routes.json (task 4.9a)", () => {
  const PROBE_DATE = "2026-11-20";

  const TOKENS_A = { input: 10, output: 20, reasoning: 5, cache: { read: 100, write: 7 } };
  const TOKENS_B = { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } };
  const TOKENS_C = { input: 11, output: 12, reasoning: 13, cache: { read: 14, write: 15 } };
  const FLAT_A = { input: 10, output: 20, reasoning: 5, cache_read: 100, cache_write: 7, total: 142 };
  const FLAT_B = { input: 1, output: 2, reasoning: 3, cache_read: 4, cache_write: 5, total: 15 };
  const FLAT_C = { input: 11, output: 12, reasoning: 13, cache_read: 14, cache_write: 15, total: 65 };
  const ZERO_TOKENS = { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0, total: 0 };

  const sleep = (ms: number): Promise<void> =>
    new Promise<void>((done) => {
      setTimeout(done, ms);
    });

  /** Waits until one check holds, or until the bound runs out. */
  async function waitFor(check: () => boolean, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (check()) return true;
      if (Date.now() >= deadline) return check();
      await sleep(50);
    }
  }

  function probeArgs(fixture: Fixture): string[] {
    return [...runArgs(fixture), "--probe", "--date", PROBE_DATE];
  }

  /** The keys of the temp set. `d-02` is the first control diff: it holds
   * no plant, and the two other diffs hold one each. */
  function writeControlKeys(fixture: Fixture): void {
    const keysDir = join(fixture.privateDir, "sets", fixture.setId, "keys");
    mkdirSync(keysDir, { recursive: true });
    for (const diff of fixture.diffs) {
      const plants = diff === "d-02"
        ? []
        : [
            {
              id: `P-${diff}`,
              new_lines: [3, 5],
              file: `src/${diff}.ts`,
              class: "C1",
              severity: "blocker",
              title: "planted",
              reason: "the test plant",
              witness: "witness",
              weight: 5,
            },
          ];
      writeFileSync(
        join(keysDir, `${diff}.json`),
        `${JSON.stringify(
          { schema: "model-guide-key/1", set_id: fixture.setId, diff_id: diff, plants },
          null,
          2,
        )}\n`,
      );
    }
  }

  /** The pass records of a run. They live under `passes/`; a probe record
   * lives under `probes/` and is not one. */
  function passRecordsOf(fixture: Fixture): Array<Record<string, unknown>> {
    return passRecords(join(fixture.privateDir, "passes"));
  }

  /** The probe records of a run: one json file under `probes/`. */
  function probeRecords(fixture: Fixture): Array<Record<string, any>> {
    return filesUnder(join(fixture.privateDir, "probes"))
      .filter((file) => file.endsWith(".json"))
      .map((file) => JSON.parse(readFileSync(file, "utf8")));
  }

  it("P1 the probe calls the first control diff once, prints reachable, and writes a probe record with the tokens", async () => {
    const fixture = await buildFixture({
      calls: [{ tokens: TOKENS_A, value: JSON.stringify({ type: "result", text: "PROBE-d-02" }) }],
    });
    writeControlKeys(fixture);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, probeArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout, "the probe prints one line").toBe(`${ROUTE} reachable -\n`);
      const calls = modelCalls(logEntries(fixture.logPath));
      expect(calls, "the probe must make exactly one call").toHaveLength(1);
      expect(calls[0].stdin, "the call must hold the first control diff").toContain("src/d-02");
      expect(calls[0].stdin, "the call must hold no other diff").not.toContain("src/d-01");
      expect(passRecordsOf(fixture), "the probe wrote a pass record").toEqual([]);
      const records = probeRecords(fixture);
      expect(records, "the probe wrote no probe record").toHaveLength(1);
      expect(records[0].state, "the state of the probe record").toBe("reachable");
      expect(JSON.stringify(records[0]), "the probe record must name the diff").toContain("d-02");
      expect(records[0].tokens, "the probe record holds the token sums").toEqual(FLAT_A);
      expect(records[0].tokens_complete, "every call held a token field").toBe(true);
      expect(
        filesHolding(fixture.privateDir, "PROBE-d-02"),
        "the probe stored a raw output",
      ).toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });

  it("P2 the probe prints unreachable with the error line and exits 3", async () => {
    const fixture = await buildFixture({
      calls: [
        { exit: 1, stderr: "provider: transport error" },
        { exit: 1, stderr: "provider: transport error" },
        { exit: 1, stderr: "provider: transport error" },
      ],
    });
    writeControlKeys(fixture);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, probeArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(3);
      const lines = stdoutLines(result);
      expect(lines, "the probe prints one line").toHaveLength(1);
      expect(
        lines[0].startsWith(`${ROUTE} unreachable `),
        `wrong probe line: ${lines[0]}`,
      ).toBe(true);
      expect(lines[0], "the line must hold the error line").toContain("transport error");
      expect(
        modelCalls(logEntries(fixture.logPath)).length,
        "the probe made no call",
      ).toBeGreaterThan(0);
      expect(passRecordsOf(fixture), "the probe wrote a pass record").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });

  it("P3 the probe prints region-blocked with the D22 error line and exits 3", async () => {
    const fixture = await buildFixture({
      calls: [
        { exit: 1, stderr: REGION_ERROR },
        { exit: 1, stderr: REGION_ERROR },
        { exit: 1, stderr: REGION_ERROR },
      ],
    });
    writeControlKeys(fixture);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, probeArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(3);
      const lines = stdoutLines(result);
      expect(lines, "the probe prints one line").toHaveLength(1);
      expect(
        lines[0].startsWith(`${ROUTE} region-blocked `),
        `wrong probe line: ${lines[0]}`,
      ).toBe(true);
      expect(lines[0], "the line must hold the region error").toContain("not available in your region");
      expect(passRecordsOf(fixture), "the probe wrote a pass record").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });

  it("P4 the probe refuses an unknown route and a metered route before any call", async () => {
    const unknownFixture = await buildFixture({
      route: UNKNOWN_ROUTE,
      routes: routesFile(ROUTE),
    });
    try {
      assertRunnerExists();
      const unknown = runRunner(unknownFixture, probeArgs(unknownFixture));
      expect(unknown.status, `${unknown.stdout}\n${unknown.stderr}`).toBe(2);
      const unknownNamed = namedLines(unknown);
      expect(unknownNamed, `the refusal must name the route: ${unknown.stdout}`).toHaveLength(1);
      expect(unknownNamed[0], "the refusal line must name the route").toMatch(/route/);
      expect(logEntries(unknownFixture.logPath), "the probe called the model").toEqual([]);
      expect(passRecordsOf(unknownFixture), "the probe wrote a pass record").toEqual([]);
    } finally {
      dropFixture(unknownFixture);
    }

    const meteredFixture = await buildFixture({ route: METERED_ROUTE, kind: "metered" });
    try {
      const metered = runRunner(meteredFixture, probeArgs(meteredFixture));
      expect(metered.status, `${metered.stdout}\n${metered.stderr}`).toBe(2);
      const meteredNamed = namedLines(metered);
      expect(meteredNamed, `the refusal must name the kind: ${metered.stdout}`).toHaveLength(1);
      expect(meteredNamed[0], "the refusal line must name the metered kind").toMatch(/kind|metered/);
      expect(logEntries(meteredFixture.logPath), "the probe called the model").toEqual([]);
      expect(passRecordsOf(meteredFixture), "the probe wrote a pass record").toEqual([]);
    } finally {
      dropFixture(meteredFixture);
    }
  });

  it("P5 the probe takes the lock of the route, the set, and the date", async () => {
    const fixture = await buildFixture({
      calls: [{ sleep: 30, value: JSON.stringify({ type: "result", text: "PROBE-d-02" }) }],
    });
    writeControlKeys(fixture);
    let holder: ChildProcess | null = null;
    let holderOut = "";
    let holderErr = "";
    try {
      assertRunnerExists();
      const child = spawn(
        "bash",
        [join(fixture.repo, "harness", "model-guide", "review-run.sh"), ...probeArgs(fixture)],
        { cwd: fixture.repo, env: spawnEnv(fixture), stdio: ["ignore", "pipe", "pipe"] },
      );
      holder = child;
      // The orphan net kills this child when a test stops before its
      // finally block, and the afterEach waits for its exit.
      startedServers.add(child);
      serverExits.add(
        new Promise<void>((done) => {
          child.once("close", () => done());
        }),
      );
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        holderOut += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        holderErr += chunk;
      });

      const lockDir = join(fixture.privateDir, ".locks");
      const hasLock = (): boolean =>
        existsSync(lockDir) &&
        readdirSync(lockDir).some((name) => name.endsWith(".lock"));
      const lockSeen = await waitFor(() => hasLock() || child.exitCode !== null, 10_000);
      expect(
        lockSeen && hasLock(),
        `the first probe took no lock (exit ${child.exitCode}, stdout=${holderOut}, stderr=${holderErr})`,
      ).toBe(true);
      expect(
        await waitFor(() => modelCalls(logEntries(fixture.logPath)).length >= 1, 10_000),
        "the first probe made no call",
      ).toBe(true);

      const second = runRunner(fixture, probeArgs(fixture));
      expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(2);
      const errLines = (second.stderr ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== "");
      expect(
        errLines,
        `the second probe must print one line on stderr: ${second.stderr}`,
      ).toHaveLength(1);
      expect(errLines[0], "the line must start with review-run:").toMatch(/^review-run:/);
      expect(errLines[0], "the line must name the lock").toMatch(/lock/);
      expect(
        modelCalls(logEntries(fixture.logPath)),
        "the second probe called the model",
      ).toHaveLength(1);
      expect(passRecordsOf(fixture), "a probe wrote a pass record").toEqual([]);
    } finally {
      if (holder !== null) holder.kill("SIGKILL");
      dropFixture(fixture);
    }
  });

  it("P6 the probe obeys the 70 % quota rule of a non-Go source and makes no call", async () => {
    const fixture = await buildFixture({
      quotaProvider: "kimi-code-plan-cn",
      quotaSource: "kimi-for-coding",
      quotaPercent: 70,
      calls: [{ tokens: TOKENS_A, value: JSON.stringify({ type: "result", text: "PROBE-d-02" }) }],
    });
    writeControlKeys(fixture);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, probeArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      const lines = stdoutLines(result);
      expect(lines, `the probe must print one refusal line: ${result.stdout}`).toHaveLength(1);
      expect(lines[0], "the line must start with review-run:").toMatch(/^review-run:/);
      expect(lines[0], "the line must name the quota rule").toMatch(/quota/i);
      expect(
        modelCalls(logEntries(fixture.logPath)),
        "the probe called the model at 70 %",
      ).toEqual([]);
      expect(passRecordsOf(fixture), "the probe wrote a pass record").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });

  it("P7 the probe runs the credential scan and stores no value", async () => {
    const fixture = await buildFixture({
      calls: [{ value: JSON.stringify({ type: "result", text: SECRET }) }],
    });
    writeControlKeys(fixture);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, probeArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      const lines = stdoutLines(result);
      expect(lines, `the probe must print one refusal line: ${result.stdout}`).toHaveLength(1);
      expect(lines[0], "the line must start with review-run:").toMatch(/^review-run:/);
      expect(lines[0], "the line must name the credential scan").toMatch(/credential|value/i);
      expect(
        filesHolding(fixture.privateDir, SECRET),
        "the credential value stayed in the private folder",
      ).toEqual([]);
      expect(
        filesHolding(fixture.repo, SECRET),
        "the credential value stayed in the repository",
      ).toEqual([]);
      expect(
        readFileSync(fixture.logPath, "utf8").includes(SECRET),
        "the credential value stayed in the log",
      ).toBe(false);
      expect(passRecordsOf(fixture), "the probe wrote a pass record").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });

  it("G3 the probe starts on a Go route at week 97 % and refuses at week 100 %", async () => {
    const ready = await buildFixture({
      quotaPercent: 10,
      quotaWeek: 97,
      calls: [{ tokens: TOKENS_A, value: JSON.stringify({ type: "result", text: "PROBE-d-02" }) }],
    });
    writeControlKeys(ready);
    try {
      assertRunnerExists();
      const result = runRunner(ready, probeArgs(ready));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout, "the probe prints one line").toBe(`${ROUTE} reachable -\n`);
      expect(
        modelCalls(logEntries(ready.logPath)),
        "the probe made no call at week 97 %",
      ).toHaveLength(1);
      expect(passRecordsOf(ready), "the probe wrote a pass record").toEqual([]);
      const records = probeRecords(ready);
      expect(records, "the probe wrote no probe record").toHaveLength(1);
      expect(records[0].state, "the state of the probe record").toBe("reachable");
    } finally {
      dropFixture(ready);
    }

    const wait = await buildFixture({
      quotaPercent: 10,
      quotaWeek: 100,
      calls: [{ tokens: TOKENS_A, value: JSON.stringify({ type: "result", text: "PROBE-d-02" }) }],
    });
    writeControlKeys(wait);
    try {
      assertRunnerExists();
      const result = runRunner(wait, probeArgs(wait));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      const lines = stdoutLines(result);
      expect(lines, `the probe must print one refusal line: ${result.stdout}`).toHaveLength(1);
      expect(lines[0], "the line must start with review-run:").toMatch(/^review-run:/);
      expect(lines[0], "the line must name the quota rule").toMatch(/quota/i);
      expect(
        modelCalls(logEntries(wait.logPath)),
        "the probe called the model at week 100 %",
      ).toEqual([]);
      expect(passRecordsOf(wait), "the probe wrote a pass record").toEqual([]);
    } finally {
      dropFixture(wait);
    }
  });

  it("T1 the pass record holds the token sums and each diff entry holds its own tokens", async () => {
    const fixture = await buildFixture({
      calls: [
        { tokens: TOKENS_A, value: JSON.stringify({ type: "result", text: "RAW-d-01" }) },
        { tokens: TOKENS_B, value: JSON.stringify({ type: "result", text: "RAW-d-02" }) },
        { tokens: TOKENS_C, value: JSON.stringify({ type: "result", text: "RAW-d-03" }) },
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const records = passRecords(fixture.privateDir);
      expect(records, "the run wrote no pass record").toHaveLength(1);
      expect(records[0].tokens, "the token sums of the pass").toEqual({
        input: 22,
        output: 34,
        reasoning: 21,
        cache_read: 118,
        cache_write: 27,
        total: 222,
      });
      expect(records[0].tokens_complete, "every call held a token field").toBe(true);
      const diffs = records[0].diffs as any[];
      expect(Array.isArray(diffs), "the record must hold diff entries").toBe(true);
      expect(diffs.map((entry) => entry.id)).toEqual(["d-01", "d-02", "d-03"]);
      expect(diffs[0].tokens, "the tokens of d-01").toEqual(FLAT_A);
      expect(diffs[1].tokens, "the tokens of d-02").toEqual(FLAT_B);
      expect(diffs[2].tokens, "the tokens of d-03").toEqual(FLAT_C);
    } finally {
      dropFixture(fixture);
    }
  });

  it("T2 a call with no token field adds 0 and sets tokens_complete false", async () => {
    const fixture = await buildFixture({
      calls: [
        { tokens: TOKENS_A, value: JSON.stringify({ type: "result", text: "RAW-d-01" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-02" }) },
        { tokens: TOKENS_C, value: JSON.stringify({ type: "result", text: "RAW-d-03" }) },
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const records = passRecords(fixture.privateDir);
      expect(records, "the run wrote no pass record").toHaveLength(1);
      expect(records[0].tokens, "the call without tokens adds 0").toEqual({
        input: 21,
        output: 32,
        reasoning: 18,
        cache_read: 114,
        cache_write: 22,
        total: 207,
      });
      expect(records[0].tokens_complete, "one call held no token field").toBe(false);
      const diffs = records[0].diffs as any[];
      expect(diffs.map((entry) => entry.id)).toEqual(["d-01", "d-02", "d-03"]);
      expect(diffs[1].tokens, "the call without tokens adds zero").toEqual(ZERO_TOKENS);
    } finally {
      dropFixture(fixture);
    }
  });

  it("J1 the committed routes.json holds the allowed review routes", () => {
    const file = join(HARNESS, "model-guide", "routes.json");
    expect(existsSync(file), `routes.json is missing: ${file}`).toBe(true);
    const doc = JSON.parse(readFileSync(file, "utf8"));
    const rows = Array.isArray(doc) ? doc : (doc.routes ?? []);
    const routes = rows.map((row: { route?: unknown }) => row.route);
    const gone = [
      "claude-code/claude-sonnet-5-5#high",
      "kimi-code-plan-cn/kimi-for-coding#high",
      "bailian-token-plan/glm-5.3#high",
      "nvidia/stepfun-ai/step-5-preview#high",
      // PM 2026-11-20: the hy4 pilot route moved to the Go plan family.
      "opencode/hy4-flash-free",
    ];
    for (const route of gone) {
      expect(routes, `${route} must leave routes.json (spec D12, PM 2026-11-18)`).not.toContain(
        route,
      );
    }
    const kept = [
      "claude-agent/sonnet#high",
      "opencode-go/hy4-flash-free#high",
      "opencode-go/deepseek-v4.1-flash",
      "opencode-go/mimo-v2.6-flash",
      "opencode-go/hungerg-free",
    ];
    for (const route of kept) {
      expect(routes, `${route} must stay in routes.json`).toContain(route);
    }
    const claude = rows.find((row: { route?: unknown }) => row.route === "claude-agent/sonnet#high") as
      | Record<string, unknown>
      | undefined;
    expect(claude, "the Claude Agent route row is missing").toBeDefined();
    expect(claude?.family, "the Claude family").toBe("Claude Sonnet");
    expect(claude?.kind, "the Claude kind").toBe("plan");
    expect(claude?.quota_provider, "the Claude quota provider").toBe("claude-agent");
    expect(claude?.quota_source, "the Claude quota source").toBe("claude");
    const hy4 = rows.find((row: { route?: unknown }) => row.route === "opencode-go/hy4-flash-free#high") as
      | Record<string, unknown>
      | undefined;
    expect(hy4, "the new hy4 route row is missing").toBeDefined();
    expect(hy4?.family, "the hy4 family").toBe("Hy");
    expect(hy4?.kind, "the hy4 kind").toBe("plan");
    expect(hy4?.quota_provider, "the hy4 quota provider").toBe("opencode-go");
    expect(hy4?.quota_source, "the hy4 quota source").toBe("opencode-go");
    const hungerg = rows.find((row: { route?: unknown }) => row.route === "opencode-go/hungerg-free") as
      | Record<string, unknown>
      | undefined;
    expect(hungerg, "the Hungerg route row is missing").toBeDefined();
    expect(hungerg?.family, "the Hungerg family").toBe("Hungerg");
    expect(hungerg?.kind, "the Hungerg kind").toBe("plan");
    expect(hungerg?.quota_provider, "the Hungerg quota provider").toBe("opencode-go");
    expect(hungerg?.quota_source, "the Hungerg quota source").toBe("opencode-go-hungerg-free");
  });
});

// --- task 4.9c: the runner reviews the seeded diffs of `diffs/` ------------
//
// The defect (orchestrator, 2026-11-18). `review-run.sh` line 242 builds the
// diff list from `$SET_DIR/src/*.diff`, and line 238 checks the `src` folder.
// The `src` folder holds the source diffs (`review-set.ts` line 18,
// `leak-check.ts` line 38), and the seeded diffs are in `diffs/` (spec D7).
// A pass that reads `src/` sends unseeded code to the model, so every plant
// of the diff counts as missed.
//
// The contract of the cases:
//   - The runner reads the diffs of `<private>/sets/<set_id>/diffs/`, in the
//     order of their names, and it sends those texts to the model.
//   - A diff that is only in `src/` is not a diff of the set: it gets no call
//     and no entry in the pass record.
//   - A set with no diff in `diffs/` is a refusal: exit 2, one `review-run:`
//     line, no call, and no pass record.
//   - The probe uses the control diff of `diffs/`, so its call holds the
//     seeded copy of that diff.
//   - The message line (task 4.9e, spec D10 ruling 2026-11-18): M1 the pass
//     call holds the prompt, the message line of `messages/<diff_id>.txt`,
//     and the seeded diff in that order; M2 the probe call holds the same
//     order; M3 a missing message file is a refusal; M4 an empty message
//     file is a refusal (exit 2, one `review-run:` line on stdout, no call,
//     no pass record).
//
// Every case uses the fake `opencode` only, keeps the orphan nets of the PM
// load watch, and never runs the real `opencode` CLI.

/** Writes the key of every diff of the set. The diff with the id
 * `controlId` holds no plant, so it is the control diff of the probe mode
 * (spec D14). */
function writeSeededControlKey(fixture: Fixture, controlId: string): void {
  const keysDir = join(fixture.privateDir, "sets", fixture.setId, "keys");
  mkdirSync(keysDir, { recursive: true });
  for (const diff of fixture.diffs) {
    const plants = diff === controlId
      ? []
      : [
          {
            id: `P-${diff}`,
            new_lines: [3, 5],
            file: `src/${diff}.ts`,
            class: "C1",
            severity: "blocker",
            title: "planted",
            reason: "the test plant",
            witness: "witness",
            weight: 5,
          },
        ];
    writeFileSync(
      join(keysDir, `${diff}.json`),
      `${JSON.stringify(
        { schema: "model-guide-key/1", set_id: fixture.setId, diff_id: diff, plants },
        null,
        2,
      )}\n`,
    );
  }
}

describe("P4 the seeded diffs of the set (task 4.9c)", () => {
  const PROBE_DATE = "2026-11-20";

  it("S1 the pass sends the seeded copy of every diff to the model and no source-only text", async () => {
    const fixture = await buildFixture({
      distinctCopies: true,
      calls: [
        { value: JSON.stringify({ type: "result", text: "RAW-d-01" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-02" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-03" }) },
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const calls = modelCalls(logEntries(fixture.logPath));
      expect(calls, "the pass made no call for each diff").toHaveLength(3);
      for (const [index, diff] of fixture.diffs.entries()) {
        expect(calls[index].stdin, `the call for ${diff} holds no seeded diff`).toContain(
          `SEEDED-${diff}`,
        );
        expect(calls[index].stdin, `the call for ${diff} holds the source diff`).not.toContain(
          `SRC-ONLY-${diff}`,
        );
      }
    } finally {
      dropFixture(fixture);
    }
  });

  it("S2 a diff that is only in src/ gets no call and no entry in the pass record", async () => {
    const fixture = await buildFixture({
      distinctCopies: true,
      diffs: ["d-01"],
      calls: [{ value: JSON.stringify({ type: "result", text: "RAW-d-01" }) }],
    });
    // A diff that is only in the source folder. It is not a diff of the set.
    writeFileSync(
      join(fixture.privateDir, "sets", fixture.setId, "src", "d-99.diff"),
      sourceDiffText("d-99"),
    );
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const calls = modelCalls(logEntries(fixture.logPath));
      expect(calls, "the runner called the model for a diff of src/").toHaveLength(1);
      expect(calls[0].stdin, "the call holds no seeded diff").toContain("SEEDED-d-01");
      expect(calls[0].stdin, "the call holds the source-only diff").not.toContain("SRC-ONLY-d-99");
      const records = passRecords(fixture.privateDir);
      expect(records, "the run wrote no pass record").toHaveLength(1);
      const diffs = records[0].diffs as any[];
      expect(diffs.map((entry) => entry.id), "the record holds a diff of src/").toEqual(["d-01"]);
      expect(
        filesHolding(fixture.privateDir, "RAW-d-99"),
        "the runner stored a raw output of the source-only diff",
      ).toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });

  it("S3 a set with an empty diffs/ folder and a filled src/ folder refuses with exit 2 and makes no call", async () => {
    const fixture = await buildFixture({
      distinctCopies: true,
      diffs: [],
      calls: [{ value: JSON.stringify({ type: "result", text: "RAW-d-01" }) }],
    });
    // The source folder holds a diff. The set holds no seeded diff.
    writeFileSync(
      join(fixture.privateDir, "sets", fixture.setId, "src", "d-01.diff"),
      sourceDiffText("d-01"),
    );
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      const named = namedLines(result);
      expect(named, `the runner printed no named line: ${result.stdout}`).toHaveLength(1);
      expect(named[0], "the refusal line must name the diff").toMatch(/diff|seed/i);
      expect(modelCalls(logEntries(fixture.logPath)), "the runner called the model").toEqual([]);
      expect(passRecords(fixture.privateDir), "the runner wrote a pass record").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });

  it("S4 the probe uses the control diff of diffs/ and its call holds the seeded copy", async () => {
    const fixture = await buildFixture({
      distinctCopies: true,
      calls: [{ value: JSON.stringify({ type: "result", text: "PROBE-d-02" }) }],
    });
    writeSeededControlKey(fixture, "d-02");
    try {
      assertRunnerExists();
      const result = runRunner(fixture, [...runArgs(fixture), "--probe", "--date", PROBE_DATE]);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const calls = modelCalls(logEntries(fixture.logPath));
      expect(calls, "the probe made no call").toHaveLength(1);
      expect(calls[0].stdin, "the probe call holds no seeded diff").toContain("SEEDED-d-02");
      expect(calls[0].stdin, "the probe call holds the source diff").not.toContain("SRC-ONLY-d-02");
    } finally {
      dropFixture(fixture);
    }
  });
});

// --- task 4.9e: the message line in the prompt (spec D10 ruling 2026-11-18)
//
// The prompt holds three parts in this order: `review-prompt.md`, the
// message line of `messages/<diff_id>.txt`, and the seeded diff. A pass or
// a probe with a missing or empty message file is a refusal: exit 2, one
// `review-run:` line on stdout, no call, and no pass record.
describe("P4 the message line of the prompt (task 4.9e)", () => {
  const PROBE_DATE = "2026-11-20";
  /** One single-line snippet of the committed review prompt. The fake logs
   * the call stdin with tabs and line breaks as spaces, so the pin uses a
   * snippet with no line break. */
  const PROMPT_SNIPPET = "You review one code diff.";

  /** The order of the three prompt parts in one call stdin. */
  function expectPromptOrder(stdin: string, diff: string): void {
    const promptAt = stdin.indexOf(PROMPT_SNIPPET);
    const messageAt = stdin.indexOf(`MSG-LINE-${diff}`);
    const seededAt = stdin.indexOf(`SEEDED-${diff}`);
    expect(promptAt, "the call holds no review prompt").toBeGreaterThanOrEqual(0);
    expect(messageAt, `the call holds no message line of ${diff}`).toBeGreaterThanOrEqual(0);
    expect(seededAt, `the call holds no seeded diff of ${diff}`).toBeGreaterThanOrEqual(0);
    expect(promptAt, "the message line comes before the prompt").toBeLessThan(messageAt);
    expect(messageAt, "the seeded diff comes before the message line").toBeLessThan(seededAt);
  }

  it("M1 the pass call holds the prompt, the message line, and the seeded diff in that order", async () => {
    const fixture = await buildFixture({
      distinctCopies: true,
      calls: [
        { value: JSON.stringify({ type: "result", text: "RAW-d-01" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-02" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-03" }) },
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const calls = modelCalls(logEntries(fixture.logPath));
      expect(calls, "the pass made no call for each diff").toHaveLength(3);
      for (const [index, diff] of fixture.diffs.entries()) {
        expectPromptOrder(calls[index].stdin, diff);
      }
    } finally {
      dropFixture(fixture);
    }
  });

  it("M2 the probe call holds the prompt, the message line, and the seeded diff in that order", async () => {
    const fixture = await buildFixture({
      distinctCopies: true,
      calls: [{ value: JSON.stringify({ type: "result", text: "PROBE-d-02" }) }],
    });
    writeSeededControlKey(fixture, "d-02");
    try {
      assertRunnerExists();
      const result = runRunner(fixture, [...runArgs(fixture), "--probe", "--date", PROBE_DATE]);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const calls = modelCalls(logEntries(fixture.logPath));
      expect(calls, "the probe made no call").toHaveLength(1);
      expectPromptOrder(calls[0].stdin, "d-02");
    } finally {
      dropFixture(fixture);
    }
  });

  it("M3 a pass with a missing message file refuses with exit 2, one named line, no call, and no pass record", async () => {
    const fixture = await buildFixture({
      distinctCopies: true,
      calls: [{ value: JSON.stringify({ type: "result", text: "RAW-d-01" }) }],
    });
    rmSync(join(fixture.privateDir, "sets", fixture.setId, "messages", "d-01.txt"));
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      expect(namedLines(result), `the runner printed no named line: ${result.stdout}`).toHaveLength(1);
      expect(modelCalls(logEntries(fixture.logPath)), "the runner called the model").toEqual([]);
      expect(passRecords(fixture.privateDir), "the runner wrote a pass record").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });

  it("M4 a probe with an empty message file refuses with exit 2, one named line, no call, and no record", async () => {
    const fixture = await buildFixture({
      distinctCopies: true,
      calls: [{ value: JSON.stringify({ type: "result", text: "PROBE-d-02" }) }],
    });
    writeSeededControlKey(fixture, "d-02");
    writeFileSync(join(fixture.privateDir, "sets", fixture.setId, "messages", "d-02.txt"), "");
    try {
      assertRunnerExists();
      const result = runRunner(fixture, [...runArgs(fixture), "--probe", "--date", PROBE_DATE]);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      expect(namedLines(result), `the runner printed no named line: ${result.stdout}`).toHaveLength(1);
      expect(modelCalls(logEntries(fixture.logPath)), "the runner called the model").toEqual([]);
      expect(passRecords(fixture.privateDir), "the runner wrote a record").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });
});

describe("P4 the message file checks (task 4.13e)", () => {
  const TOKENS_A = { input: 10, output: 20, reasoning: 5, cache: { read: 100, write: 7 } };
  const PROBE_DATE = "2026-11-20";

  /** The args of one probe run of the set. */
  function probeArgs(fixture: Fixture): string[] {
    return [...runArgs(fixture), "--probe", "--date", PROBE_DATE];
  }

  /** The keys of the temp set. `d-02` is the first control diff: it holds
   * no plant, and the two other diffs hold one each. */
  function writeControlKeys(fixture: Fixture): void {
    const keysDir = join(fixture.privateDir, "sets", fixture.setId, "keys");
    mkdirSync(keysDir, { recursive: true });
    for (const diff of fixture.diffs) {
      const plants = diff === "d-02"
        ? []
        : [
            {
              id: `P-${diff}`,
              new_lines: [3, 5],
              file: `src/${diff}.ts`,
              class: "C1",
              severity: "blocker",
              title: "planted",
              reason: "the test plant",
              witness: "witness",
              weight: 5,
            },
          ];
      writeFileSync(
        join(keysDir, `${diff}.json`),
        `${JSON.stringify(
          { schema: "model-guide-key/1", set_id: fixture.setId, diff_id: diff, plants },
          null,
          2,
        )}\n`,
      );
    }
  }

  /** The pass records of a run. They live under `passes/`; a probe record
   * lives under `probes/` and is not one. */
  function passRecordsOf(fixture: Fixture): Array<Record<string, unknown>> {
    return passRecords(join(fixture.privateDir, "passes"));
  }

  const okCalls = () => [
    { value: JSON.stringify({ type: "result", text: "RAW-d-01" }) },
    { value: JSON.stringify({ type: "result", text: "RAW-d-02" }) },
    { value: JSON.stringify({ type: "result", text: "RAW-d-03" }) },
  ];

  it("M5 a pass refuses a message file with a second line, with exit 2, one named line, no call, and no pass record", async () => {
    const fixture = await buildFixture({ calls: okCalls() });
    writeFileSync(
      join(fixture.privateDir, "sets", fixture.setId, "messages", "d-01.txt"),
      "MSG-LINE-d-01 the commit message of the diff\nA second line reaches the model\n",
    );
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      const named = namedLines(result);
      expect(named, `the runner printed no named line: ${result.stdout}`).toHaveLength(1);
      expect(named[0], "the refusal names the diff").toContain("d-01");
      expect(modelCalls(logEntries(fixture.logPath)), "the runner called the model").toEqual([]);
      expect(passRecords(fixture.privateDir), "the runner wrote a pass record").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });

  it("M6 a pass refuses a message file with a control character, with exit 2, one named line, no call, and no pass record", async () => {
    const fixture = await buildFixture({ calls: okCalls() });
    writeFileSync(
      join(fixture.privateDir, "sets", fixture.setId, "messages", "d-01.txt"),
      "MSG-LINE-d-01 with \u0001 control\n",
    );
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      const named = namedLines(result);
      expect(named, `the runner printed no named line: ${result.stdout}`).toHaveLength(1);
      expect(named[0], "the refusal names the diff").toContain("d-01");
      expect(modelCalls(logEntries(fixture.logPath)), "the runner called the model").toEqual([]);
      expect(passRecords(fixture.privateDir), "the runner wrote a pass record").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });

  it("M7 a pass refuses a message file with a line over 1000 bytes, with exit 2, one named line, no call, and no pass record", async () => {
    const fixture = await buildFixture({ calls: okCalls() });
    writeFileSync(
      join(fixture.privateDir, "sets", fixture.setId, "messages", "d-01.txt"),
      `${"M".repeat(1200)}\n`,
    );
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      const named = namedLines(result);
      expect(named, `the runner printed no named line: ${result.stdout}`).toHaveLength(1);
      expect(named[0], "the refusal names the diff").toContain("d-01");
      expect(modelCalls(logEntries(fixture.logPath)), "the runner called the model").toEqual([]);
      expect(passRecords(fixture.privateDir), "the runner wrote a pass record").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });

  it("M8 a pass refuses a symlinked message file, with exit 2, one named line, no call, and no pass record", async () => {
    const fixture = await buildFixture({ calls: okCalls() });
    const msgPath = join(fixture.privateDir, "sets", fixture.setId, "messages", "d-01.txt");
    const target = join(fixture.tmp, "linked-message.txt");
    writeFileSync(target, "MSG-LINE-d-01 the linked commit message\n");
    rmSync(msgPath);
    symlinkSync(target, msgPath);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      const named = namedLines(result);
      expect(named, `the runner printed no named line: ${result.stdout}`).toHaveLength(1);
      expect(named[0], "the refusal names the diff").toContain("d-01");
      expect(modelCalls(logEntries(fixture.logPath)), "the runner called the model").toEqual([]);
      expect(passRecords(fixture.privateDir), "the runner wrote a pass record").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });

  it("M9 a pass refuses a symlinked seeded diff, with exit 2, one named line, no call, and no pass record", async () => {
    const fixture = await buildFixture({ calls: okCalls() });
    const link = join(fixture.privateDir, "sets", fixture.setId, "diffs", "d-01.diff");
    const target = join(fixture.privateDir, "sets", fixture.setId, "diffs", "d-02.diff");
    rmSync(link);
    symlinkSync(target, link);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      const named = namedLines(result);
      expect(named, `the runner printed no named line: ${result.stdout}`).toHaveLength(1);
      expect(named[0], "the refusal names the diff").toContain("d-01");
      expect(modelCalls(logEntries(fixture.logPath)), "the runner called the model").toEqual([]);
      expect(passRecords(fixture.privateDir), "the runner wrote a pass record").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });

  it("P2b the probe makes exactly 3 calls on a persistent transport error (guard: holds at HEAD)", async () => {
    const fixture = await buildFixture({
      calls: [
        { exit: 1, stderr: "provider: transport error" },
        { exit: 1, stderr: "provider: transport error" },
        { exit: 1, stderr: "provider: transport error" },
      ],
    });
    writeControlKeys(fixture);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, probeArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(3);
      expect(
        modelCalls(logEntries(fixture.logPath)),
        "the probe retry ceiling is 3 calls (spec D14)",
      ).toHaveLength(3);
      expect(passRecordsOf(fixture), "the probe wrote a pass record").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });
});
// --- task 4.13o: the daemon guard of the runners (PM decision 2026-11-19, point 3) ---
//
// The contract that this block pins (no production file implements it yet,
// so every Red case fails at HEAD for the pinned reason):
// 1. After each pass and each probe, the runner stops every process whose
//    argv holds `serve --service` and whose HOME or cwd is under the job
//    root (TERM, then KILL after 5 s). It writes one stderr line
//    `review-run: INFRA stopped daemon <pid>` and the same text in the
//    `infra` array of the pass or probe record.
// 2. A decoy with the same argv outside the job root survives.
// 3. The seed makes exactly one real-HOME call, `auth export <provider>
//    --standalone` (timeout 60, cwd outside the runner cwd with no .git).
//    The import and the scan-values export use the job HOME. Any other
//    real-HOME call, and an empty shared store, refuse with exit 2, one
//    named line, no model call, and no pass record.
describe("P4 the daemon guard of the review runner (task 4.13o)", () => {
  const SEED_PROVIDER = "opencode-go";
  const NO_DELAYS = { BENCH_CREDENTIAL_SEED_DELAYS: "0" };

  /** One entry of the fake shared or job store for the real helper. The
   * entries use the live `auth export` shape (task 4.13q point 7):
   * `integrationID`, `active`, and a value, with no `provider` field. */
  function storeEntry(): unknown {
    return {
      integrationID: SEED_PROVIDER,
      active: true,
      value: {
        type: "oauth",
        key: "FAKE-KEY-OPENCODIGO-0001",
        access: SECRET,
        refresh: "inert",
        expires: 9999999999999,
        metadata: { orgID: "org-test-0123456789" },
      },
    };
  }

  /** The pass records of a run: records with a `diffs` array. */
  function passRecordsOnly(fixture: Fixture): Array<Record<string, unknown>> {
    return passRecords(fixture.privateDir).filter((record) => Array.isArray(record.diffs));
  }

  it("D1 the pass stops the daemon child, writes the INFRA line to stderr and the pass record, and leaves the decoy alive", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}', daemon: "mg-daemon-D1" }],
    });
    const decoyPid = spawnDecoy("mg-decoy-D1", fixture.home);
    let daemonPid = 0;
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      const daemons = await daemonPids(fixture);
      expect(daemons, "the fake left no daemon child").toHaveLength(1);
      daemonPid = daemons[0];
      // The Red pin on the real daemon shape (task 4.13q F1, Option B):
      // the fake wrote its own raw /proc/self/cmdline entries at spawn,
      // so the proof survives the stop of the daemon.
      const d1Entries = await spawnArgvEntries(fixture);
      expect(d1Entries.length, "the spawn argv file holds at least 3 entries").toBeGreaterThanOrEqual(3);
      expect(d1Entries, "the fake daemon must use a real argv split").toContain("serve");
      expect(
        d1Entries.indexOf("--service") - d1Entries.indexOf("serve"),
        "serve and --service must be adjacent argv entries",
      ).toBe(1);
      expect(
        d1Entries.some((entry) => entry.includes("serve --service")),
        "no single argv entry holds the joined text",
      ).toBe(false);
      expect(isAlive(daemonPid), "the runner stopped the daemon child").toBe(false);
      const infra = stderrLines(result).filter((line) => line.includes("INFRA stopped daemon"));
      expect(infra, "the runner writes one INFRA line to stderr").toHaveLength(1);
      expect(infra[0]).toBe(`review-run: INFRA stopped daemon ${daemonPid}`);
      const records = passRecordsOnly(fixture);
      expect(records, "the runner wrote one pass record").toHaveLength(1);
      expect(records[0].infra).toEqual([`review-run: INFRA stopped daemon ${daemonPid}`]);
      expect(isAlive(decoyPid), "the decoy outside the job root survives").toBe(true);
    } finally {
      if (daemonPid !== 0) await killHelper(daemonPid);
      await killHelper(decoyPid);
      dropFixture(fixture);
    }
  });

  it("D3 a daemon that ignores SIGTERM is KILLed after the guard", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}', daemon_term: "mg-daemon-D3" }],
    });
    const decoyPid = spawnDecoy("mg-decoy-D3", fixture.home);
    let daemonPid = 0;
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      const daemons = await daemonPids(fixture);
      expect(daemons, "the fake left no daemon child").toHaveLength(1);
      daemonPid = daemons[0];
      // The Red pin on the real daemon shape (task 4.13q F1, Option B).
      const d3Entries = await spawnArgvEntries(fixture);
      expect(d3Entries.length, "the spawn argv file holds at least 3 entries").toBeGreaterThanOrEqual(3);
      expect(d3Entries, "the fake daemon must use a real argv split").toContain("serve");
      expect(
        d3Entries.indexOf("--service") - d3Entries.indexOf("serve"),
        "serve and --service must be adjacent argv entries",
      ).toBe(1);
      expect(
        d3Entries.some((entry) => entry.includes("serve --service")),
        "no single argv entry holds the joined text",
      ).toBe(false);
      expect(isAlive(daemonPid), "the runner KILLed the TERM-ignoring daemon").toBe(false);
      const infra = stderrLines(result).filter((line) => line.includes("INFRA stopped daemon"));
      expect(infra, "the runner writes one INFRA line to stderr").toHaveLength(1);
      expect(infra[0]).toBe(`review-run: INFRA stopped daemon ${daemonPid}`);
      expect(isAlive(decoyPid), "the decoy outside the job root survives").toBe(true);
    } finally {
      if (daemonPid !== 0) await killHelper(daemonPid);
      await killHelper(decoyPid);
      dropFixture(fixture);
    }
  }, 25_000);

  it("D4 a process whose HOME or cwd resolves outside the job root survives, and the sibling folder survives", async () => {
    // The job folder is preset, so the decoy paths are known before the
    // run: opencode_host_begin keeps an existing BENCH_OPENCODE_HOME.
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}' }],
    });
    const jobDir = join(fixture.root, "preset-job");
    mkdirSync(jobDir, { recursive: true });
    const outsideDir = join(fixture.root, "outside");
    mkdirSync(outsideDir, { recursive: true });
    // The HOME string starts with the job root but resolves outside it.
    const outsideHome = `${jobDir}/../outside/home`;
    // A cwd reached through a symlink inside the job root resolves
    // outside it; readlink already resolves, so this decoy survives at
    // HEAD and pins the Green behavior too.
    const linkDir = join(jobDir, "link");
    symlinkSync(outsideDir, linkDir);
    const siblingHome = `${jobDir}-other/home`;
    // The decoys keep the joined argv shape, so the guard selects them on
    // argv at HEAD; only the scoping decides. After Green the resolved
    // paths decide instead.
    const homePid = spawnDecoy("mg-decoy-D4-home", outsideHome);
    const linkPid = spawnDecoy("mg-decoy-D4-link", fixture.home, linkDir);
    const siblingPid = spawnDecoy("mg-decoy-D4-sib", siblingHome);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture), { BENCH_OPENCODE_HOME: jobDir });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(isAlive(homePid), "a HOME that resolves outside the job root survives").toBe(true);
      expect(isAlive(linkPid), "a cwd reached through a symlink outside the job root survives").toBe(true);
      expect(isAlive(siblingPid), "a sibling of the job root survives").toBe(true);
      const infra = stderrLines(result).filter((line) => line.includes("INFRA stopped daemon"));
      expect(infra, "the guard stopped a process outside the job root").toEqual([]);
    } finally {
      await killHelper(homePid);
      await killHelper(linkPid);
      await killHelper(siblingPid);
      dropFixture(fixture);
    }
  });
});

describe("P4 the proc table seam of the guards (task 4.13q N3)", () => {
  it("N3 daemon_pid_alive honors BENCH_OPENCODE_PROC like daemon_pids does", () => {
    const proc = mkdtempSync(join(tmpdir(), "mg-review-proc-"));
    tempRoots.add(proc);
    try {
      // A live pid of the fake table. The real /proc holds no 424242, so
      // only a helper that honors the seam can see it alive.
      const pidDir = join(proc, "424242");
      mkdirSync(pidDir, { recursive: true });
      const statText = (state: string): string =>
        `424242 (fake-opencode) ${state} 1 1 1 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0 123456 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n`;
      writeFileSync(join(pidDir, "stat"), statText("R"));
      const helper = shellFunc(RUNNER_SOURCE, "daemon_pid_alive");
      const alive = spawnSync("bash", ["-c", `${helper}\nBENCH_OPENCODE_PROC="${proc}" daemon_pid_alive 424242`], {
        encoding: "utf8",
        timeout: 20_000,
      });
      expect(alive.status, `daemon_pid_alive missed a running pid of the fake table:\n${alive.stdout}\n${alive.stderr}`).toBe(0);
      // A zombie of the fake table reads dead, as on the real table.
      writeFileSync(join(pidDir, "stat"), statText("Z"));
      const dead = spawnSync("bash", ["-c", `${helper}\nBENCH_OPENCODE_PROC="${proc}" daemon_pid_alive 424242`], {
        encoding: "utf8",
        timeout: 20_000,
      });
      expect(dead.status, "daemon_pid_alive treats a zombie of the fake table as alive").not.toBe(0);
    } finally {
      rmSync(proc, { recursive: true, force: true });
      tempRoots.delete(proc);
    }
  });
});

describe("P4 the daemon guard of the probe (task 4.13o)", () => {
  const PROBE_DATE = "2026-11-20";

  function probeArgs(fixture: Fixture): string[] {
    return [...runArgs(fixture), "--probe", "--date", PROBE_DATE];
  }

  /** The keys of the temp set. `d-02` is the first control diff. */
  function writeControlKeys(fixture: Fixture): void {
    const keysDir = join(fixture.privateDir, "sets", fixture.setId, "keys");
    mkdirSync(keysDir, { recursive: true });
    for (const diff of fixture.diffs) {
      writeFileSync(
        join(keysDir, `${diff}.json`),
        `${JSON.stringify(
          { schema: "model-guide-key/1", set_id: fixture.setId, diff_id: diff, plants: [] },
          null,
          2,
        )}\n`,
      );
    }
  }

  /** The probe records of a run. */
  function probeRecordsOf(fixture: Fixture): Array<Record<string, any>> {
    return filesUnder(join(fixture.privateDir, "probes"))
      .filter((file) => file.endsWith(".json"))
      .map((file) => JSON.parse(readFileSync(file, "utf8")));
  }

  it("D2 the probe stops the daemon child and records the INFRA line and field", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01", "d-02"],
      calls: [{ value: '{"findings":[]}', daemon: "mg-daemon-D2" }],
    });
    writeControlKeys(fixture);
    const decoyPid = spawnDecoy("mg-decoy-D2", fixture.home);
    let daemonPid = 0;
    try {
      assertRunnerExists();
      const result = runRunner(fixture, probeArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      const daemons = await daemonPids(fixture);
      expect(daemons, "the fake left no daemon child").toHaveLength(1);
      daemonPid = daemons[0];
      // The Red pin on the real daemon shape (task 4.13q F1, Option B).
      const d2Entries = await spawnArgvEntries(fixture);
      expect(d2Entries.length, "the spawn argv file holds at least 3 entries").toBeGreaterThanOrEqual(3);
      expect(d2Entries, "the fake daemon must use a real argv split").toContain("serve");
      expect(
        d2Entries.indexOf("--service") - d2Entries.indexOf("serve"),
        "serve and --service must be adjacent argv entries",
      ).toBe(1);
      expect(
        d2Entries.some((entry) => entry.includes("serve --service")),
        "no single argv entry holds the joined text",
      ).toBe(false);
      expect(isAlive(daemonPid), "the probe stopped the daemon child").toBe(false);
      const infra = stderrLines(result).filter((line) => line.includes("INFRA stopped daemon"));
      expect(infra, "the probe writes one INFRA line to stderr").toHaveLength(1);
      expect(infra[0]).toBe(`review-run: INFRA stopped daemon ${daemonPid}`);
      const records = probeRecordsOf(fixture);
      expect(records, "the probe wrote one probe record").toHaveLength(1);
      expect(records[0].infra).toEqual([`review-run: INFRA stopped daemon ${daemonPid}`]);
      expect(isAlive(decoyPid), "the decoy outside the job root survives").toBe(true);
    } finally {
      if (daemonPid !== 0) await killHelper(daemonPid);
      await killHelper(decoyPid);
      dropFixture(fixture);
    }
  });
});

describe("P4 the seed HOME of the review runner (task 4.13o)", () => {
  const SEED_PROVIDER = "opencode-go";
  const SEED_ARGV = `auth export ${SEED_PROVIDER} --standalone`;
  const NO_DELAYS = { BENCH_CREDENTIAL_SEED_DELAYS: "0" };

  /** One entry of the fake shared or job store for the real helper. The
   * entry uses the live `auth export` shape (task 4.13q point 7):
   * `integrationID`, `active`, and a value, with no `provider` field. */
  function storeEntry(): unknown {
    return {
      integrationID: SEED_PROVIDER,
      active: true,
      value: {
        type: "oauth",
        key: "FAKE-KEY-OPENCODIGO-0001",
        access: SECRET,
        refresh: "inert",
        expires: 9999999999999,
        metadata: { orgID: "org-test-0123456789" },
      },
    };
  }

  it("S1 the seed export uses the real HOME with the exact exempt form, timeout 60, and a cwd outside the runner cwd", async () => {
    const fixture = await buildFixture({
      // Row 4.16: the isolated seed path stays on a non-pilot route (14.12.3).
      ...isolatedOverride(),
      realCredential: true,
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}' }],
      authExportShared: [storeEntry()],
      authExportJob: [],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture), NO_DELAYS);
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      const exports = exportCalls(logEntries(fixture.logPath)).filter((entry) => entry.home === fixture.home);
      expect(exports, "the seed made one real-HOME export call").toHaveLength(1);
      expect(exports[0].home, "the seed export uses the real HOME").toBe(fixture.home);
      expect(exports[0].argv, "the seed export has the exact exempt form").toBe(SEED_ARGV);
      expect(exports[0].cwd, "the seed export runs outside the runner cwd").not.toBe(fixture.repo);
      expect(
        existsSync(join(exports[0].cwd, ".git")),
        "the seed export cwd holds no .git",
      ).toBe(false);
      expect(
        exports[0].ppidcmd.split(" ").slice(0, 2),
        "the seed export runs with timeout 60",
      ).toEqual(["timeout", "60"]);
    } finally {
      dropFixture(fixture);
    }
  });

  it("S2 the seed succeeds when the fake real-HOME store holds the provider entry", async () => {
    const fixture = await buildFixture({
      // Row 4.16: the isolated seed path stays on a non-pilot route (14.12.3).
      ...isolatedOverride(),
      realCredential: true,
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}' }],
      authExportShared: [storeEntry()],
      authExportJob: [storeEntry()],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture), NO_DELAYS);
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const records = passRecords(fixture.privateDir).filter((record) => Array.isArray(record.diffs));
      expect(records, "the runner wrote one pass record").toHaveLength(1);
      expect(records[0].state, "the pass is complete").toBe("complete");
    } finally {
      dropFixture(fixture);
    }
  });

  it("S3 the import call has the job HOME and --standalone", async () => {
    const fixture = await buildFixture({
      // Row 4.16: the isolated seed path stays on a non-pilot route (14.12.3).
      ...isolatedOverride(),
      realCredential: true,
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}' }],
      authExportShared: [storeEntry()],
      authExportJob: [storeEntry()],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture), NO_DELAYS);
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const entries = logEntries(fixture.logPath);
      const imports = entries.filter((entry) => entry.argv.startsWith("auth import"));
      expect(imports, "the seed made one import call").toHaveLength(1);
      expect(imports[0].home, "the import uses the job HOME").toBe(`${imports[0].job}/home`);
      expect(imports[0].argv, "the import is standalone").toContain("--standalone");
    } finally {
      dropFixture(fixture);
    }
  });

  it("S4 the scan-values export reads the job store", async () => {
    const fixture = await buildFixture({
      // Row 4.16: the isolated seed path stays on a non-pilot route (14.12.3).
      ...isolatedOverride(),
      realCredential: true,
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}' }],
      authExportShared: [storeEntry()],
      authExportJob: [storeEntry()],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture), NO_DELAYS);
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const entries = logEntries(fixture.logPath);
      const calls = exportCalls(entries);
      expect(calls, "the seed made one export call").toHaveLength(2);
      const scan = calls[calls.length - 1];
      expect(scan.home, "the scan-values export uses the job HOME").toBe(`${scan.job}/home`);
      expect(scan.argv, "the scan-values export has no provider arg").toBe("auth export --standalone");
    } finally {
      dropFixture(fixture);
    }
  });

  it("S5 exactly one real-HOME call, the exempt seed export", async () => {
    const fixture = await buildFixture({
      // Row 4.16: the isolated seed path stays on a non-pilot route (14.12.3).
      ...isolatedOverride(),
      realCredential: true,
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}' }],
      authExportShared: [storeEntry()],
      authExportJob: [],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture), NO_DELAYS);
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      const entries = logEntries(fixture.logPath);
      const realHome = entries.filter((entry) => entry.home === fixture.home);
      expect(
        realHome.map((entry) => entry.argv),
        "the only real-HOME call is the exempt seed export",
      ).toEqual(["auth export opencode-go --standalone"]);
    } finally {
      dropFixture(fixture);
    }
  });

  it("R1 an empty shared store refuses the pass with exit 2, one line, no call, and no record", async () => {
    const fixture = await buildFixture({
      // Row 4.16: the isolated seed path stays on a non-pilot route (14.12.3).
      ...isolatedOverride(),
      realCredential: true,
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}' }],
      authExportShared: [],
      authExportJob: [storeEntry()],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture), NO_DELAYS);
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      const named = namedLines(result);
      expect(named, `the runner printed no named line: ${result.stdout}`).toHaveLength(1);
      expect(modelCalls(logEntries(fixture.logPath)), "the runner called the model").toEqual([]);
      expect(passRecords(fixture.privateDir), "the runner wrote a pass record").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });

  it("S6 the seed export cwd sits outside any git repo when TMPDIR points inside one", async () => {
    const fixture = await buildFixture({
      // Row 4.16: the isolated seed path stays on a non-pilot route (14.12.3).
      ...isolatedOverride(),
      realCredential: true,
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}' }],
      authExportShared: [storeEntry()],
      authExportJob: [],
    });
    const gitDir = join(fixture.root, "git-tmp");
    mkdirSync(gitDir, { recursive: true });
    const init = spawnSync("git", ["init", "-q", gitDir], { encoding: "utf8", timeout: 20_000 });
    expect(init.status, `git init failed:\n${init.stdout}\n${init.stderr}`).toBe(0);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture), { ...NO_DELAYS, TMPDIR: gitDir });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      const top = spawnSync("git", ["-C", gitDir, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        timeout: 20_000,
      });
      expect(top.status, "TMPDIR is not inside a git repo").toBe(0);
      const root = top.stdout.trim();
      const cwds = exportCalls(logEntries(fixture.logPath))
        .filter((entry) => entry.home === fixture.home)
        .map((entry) => entry.cwd);
      expect(cwds, "the seed made no real-HOME export call").toHaveLength(1);
      const under = cwds[0] === root || cwds[0].startsWith(`${root}/`);
      expect(under, `the seed export cwd sits inside the git repo: ${cwds[0]}`).toBe(false);
    } finally {
      dropFixture(fixture);
    }
  });
});

// --- task 4.13w: the token log reads the real step_finish event -----------
//
// The defect (Review A 2fdb8f8). `read_tokens` of `review-run.sh` matches
// the fake event shape `{"type":"step-finish","tokens":{...}}`, but the
// installed `@opencode/cli` bundle prints the token event as
// `{"type":"step_finish",...,"part":{...,"tokens":{"input","output",
// "reasoning","cache":{"read","write"}}}}`. Every live call would record
// zero tokens and `tokens_complete` false. The fake prints the real shapes
// when a call holds `token_stream`: one `text` event per entry of `texts`
// and one `step_finish` event with `part.tokens`.
//
// The contract of the cases:
//   - The pass record holds the summed real tokens, each diff entry holds
//     its own real tokens, and `tokens_complete` is true.
//   - The probe record holds the real tokens of its one call with
//     `tokens_complete` true.
//   - A pass that mixes the old shape and the real shape sums both (the
//     old shape keeps working: the earlier T1 and T2 cases stay green).
//
// Every case uses the fake `opencode` only, keeps the orphan nets of the PM
// load watch, and never runs the real `opencode` CLI.
describe("P4 the real step_finish token event (task 4.13w, Review A 2fdb8f8)", () => {
  /** The nested token shape of the installed bundle (Review A 2fdb8f8):
   * `part.tokens` of a `step_finish` event holds `input`, `output`,
   * `reasoning`, and `cache: {read, write}`. */
  const REAL_A = { input: 10, output: 20, reasoning: 5, cache: { read: 100, write: 7 } };
  const REAL_B = { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } };
  const REAL_C = { input: 11, output: 12, reasoning: 13, cache: { read: 14, write: 15 } };
  const FLAT_REAL_A = { input: 10, output: 20, reasoning: 5, cache_read: 100, cache_write: 7, total: 142 };
  const FLAT_REAL_B = { input: 1, output: 2, reasoning: 3, cache_read: 4, cache_write: 5, total: 15 };
  const FLAT_REAL_C = { input: 11, output: 12, reasoning: 13, cache_read: 14, cache_write: 15, total: 65 };

  /** One call that answers on the real stream: a fenced empty-findings
   * block as one `text` event, and the nested tokens as `part.tokens` of
   * one `step_finish` event. */
  function realCall(tokens: Record<string, unknown>): CallSpec {
    return {
      token_stream: {
        texts: ["```json\n{\"findings\": []}\n```"],
        tokens,
      },
    };
  }

  /** The probe records of a run: one json file under `probes/`. */
  function probeRecordsOf(fixture: Fixture): Array<Record<string, any>> {
    return filesUnder(join(fixture.privateDir, "probes"))
      .filter((file) => file.endsWith(".json"))
      .map((file) => JSON.parse(readFileSync(file, "utf8")));
  }

  it("W1 the pass record holds the summed tokens of the real step_finish events", async () => {
    const fixture = await buildFixture({
      calls: [realCall(REAL_A), realCall(REAL_B), realCall(REAL_C)],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const records = passRecords(fixture.privateDir);
      expect(records, "the run wrote no pass record").toHaveLength(1);
      expect(records[0].tokens, "the token sums of the real events").toEqual({
        input: 22,
        output: 34,
        reasoning: 21,
        cache_read: 118,
        cache_write: 27,
        total: 222,
      });
      expect(records[0].tokens_complete, "every call held a real token event").toBe(true);
      const diffs = records[0].diffs as any[];
      expect(Array.isArray(diffs), "the record must hold diff entries").toBe(true);
      expect(diffs.map((entry) => entry.id)).toEqual(["d-01", "d-02", "d-03"]);
      expect(diffs[0].tokens, "the tokens of d-01").toEqual(FLAT_REAL_A);
      expect(diffs[1].tokens, "the tokens of d-02").toEqual(FLAT_REAL_B);
      expect(diffs[2].tokens, "the tokens of d-03").toEqual(FLAT_REAL_C);
    } finally {
      dropFixture(fixture);
    }
  });

  it("W2 the probe record holds the tokens of the real step_finish event", async () => {
    const fixture = await buildFixture({ calls: [realCall(REAL_A)] });
    writeSeededControlKey(fixture, "d-01");
    try {
      assertRunnerExists();
      const result = runRunner(fixture, [...runArgs(fixture), "--probe", "--date", "2026-11-20"]);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout, "the probe prints one line").toBe(`${ROUTE} reachable -\n`);
      const records = probeRecordsOf(fixture);
      expect(records, "the run wrote no probe record").toHaveLength(1);
      expect(records[0].tokens, "the token sums of the real event").toEqual(FLAT_REAL_A);
      expect(records[0].tokens_complete, "the call held a real token event").toBe(true);
    } finally {
      dropFixture(fixture);
    }
  });

  it("W3 a pass that mixes the old shape and the real shape sums both", async () => {
    const fixture = await buildFixture({
      calls: [
        { tokens: { input: 10, output: 20, reasoning: 5, cache: { read: 100, write: 7 } }, value: "" },
        realCall(REAL_B),
      ],
      diffs: ["d-01", "d-02"],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const records = passRecords(fixture.privateDir);
      expect(records, "the run wrote no pass record").toHaveLength(1);
      expect(records[0].tokens, "the token sums of the mixed shapes").toEqual({
        input: 11,
        output: 22,
        reasoning: 8,
        cache_read: 104,
        cache_write: 12,
        total: 157,
      });
      expect(records[0].tokens_complete, "both calls held a token event").toBe(true);
    } finally {
      dropFixture(fixture);
    }
  });
});

// --- task 4.13y: error-line key scan, strict token numbers, stdout error events ---
//
// Sources: Review B ff4e009 N16, N17, N18, N20 and Review C ff4e009 N3.
// These must be fixed before the first live probe on 2026-11-20.
//
// N16: a credential value on the first stderr line of a failed call reaches
// stdout and the records, because `scan_output` reads the stdout file only.
// The Red pins: no runner output and no record holds the value; a fixed
// text appears instead. Cases Y1 (probe unreachable), Y2 (probe region
// branch), Y3 (pass region branch).
// N17: `read_tokens` counts a number that cannot be a token count, and
// `tokens_complete` stays true. A token field counts only when it is a
// non-negative safe integer. Cases Y4 (1e20 and 2^53+1), Y5 (two-event
// negative and fractional sums), Y6 (a single hostile field must not erase
// the valid fields of the call).
// N18: three pins. N18a (a non-number field sets the flag false) and N18b
// (the sums add several events of one call) are guards: they pass at HEAD
// and pin the behavior Green must keep. N18c (a hostile number keeps the
// record valid JSON and sets the flag false) fails at HEAD.
// Review C N3: a `step_finish` event with no tokens field marks the call
// incomplete. Case Y7 fails at HEAD, where the event is skipped.
// N20: in `--format json` the real binary writes an error as a stdout
// event. The envelope below is the exact shape of the installed
// `@opencode/cli` bundle, read only:
// `u=(r,t,n)=>{if(e.format!=="json")return!1;return
// process.stdout.write(JSON.stringify({type:r,timestamp:t,
// sessionID:e.sessionID,...n})+H),!0}` with the call sites
// `u("error",n,{error:t.data.error})`, `u("error",n,{error:t.error})`, and
// `u("error",Date.now(),{error:m})`. The fake prints that event on stdout
// when a call holds `error_event`. Cases Y11 (pass), Y12 (pass with a key
// in the event), Y13 (probe).
//
// Every case uses the fake `opencode` only, keeps the orphan nets of the PM
// load watch, and never runs the real `opencode` CLI.
describe("P4 task 4.13y error-line scan, strict tokens, stdout error events (Review B ff4e009 N16 N17 N18 N20, Review C N3)", () => {
  const PROBE_DATE = "2026-11-20";
  /** The fixed text that replaces an error line holding a key (N16, N20). */
  const FIXED = "the error output held a credential value";

  function probeArgs(fixture: Fixture): string[] {
    return [...runArgs(fixture), "--probe", "--date", PROBE_DATE];
  }

  /** The keys of the temp set. The diff with the id `controlId` holds no
   * plant, so it is the control diff of the probe mode (spec D14). */
  function writeControlKey(fixture: Fixture, controlId: string): void {
    const keysDir = join(fixture.privateDir, "sets", fixture.setId, "keys");
    mkdirSync(keysDir, { recursive: true });
    for (const diff of fixture.diffs) {
      const plants = diff === controlId
        ? []
        : [
            {
              id: `P-${diff}`,
              new_lines: [3, 5],
              file: `src/${diff}.ts`,
              class: "C1",
              severity: "blocker",
              title: "planted",
              reason: "the test plant",
              witness: "witness",
              weight: 5,
            },
          ];
      writeFileSync(
        join(keysDir, `${diff}.json`),
        `${JSON.stringify(
          { schema: "model-guide-key/1", set_id: fixture.setId, diff_id: diff, plants },
          null,
          2,
        )}\n`,
      );
    }
  }

  /** The probe records of a run: one json file under `probes/`. */
  function probeRecordsOf(fixture: Fixture): Array<Record<string, unknown>> {
    return filesUnder(join(fixture.privateDir, "probes"))
      .filter((file) => file.endsWith(".json"))
      .map((file) => JSON.parse(readFileSync(file, "utf8")));
  }

  /** One `step_finish` event line of the installed bundle with the given
   * raw `tokens` text (exact digits survive, unlike a JSON round trip). */
  function stepFinishLine(tokensText: string): string {
    return `{"type":"step_finish","timestamp":1795048839000,"sessionID":"ses_4_13y","part":{"type":"step-finish","timestamp":1795048839000,"tokens":${tokensText}}}`;
  }

  /** The `step_finish` event line with no tokens field (Review C N3). */
  const TOKENS_LESS_LINE =
    '{"type":"step_finish","timestamp":1795048839000,"sessionID":"ses_4_13y","part":{"type":"step-finish","timestamp":1795048839000}}';

  /** The fenced empty-findings answer of one call. */
  const FENCED = "```json\n{\"findings\": []}\n```";

  /** One call that answers on the real stream with the given tokens. */
  function yRealCall(tokens: Record<string, unknown>): CallSpec {
    return { token_stream: { texts: [FENCED], tokens } };
  }

  it("Y1 a key on the first stderr line of a failed probe call never reaches stdout or the probe record", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [
        { exit: 1, stderr: SECRET },
        { exit: 1, stderr: SECRET },
        { exit: 1, stderr: SECRET },
      ],
    });
    writeControlKey(fixture, "d-01");
    try {
      assertRunnerExists();
      const result = runRunner(fixture, probeArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(3);
      expect(result.stdout, "the probe line held the key").not.toContain(SECRET);
      expect(result.stdout, "the probe line must hold the fixed text").toContain(FIXED);
      expect(filesHolding(fixture.privateDir, SECRET), "the key stayed in the private folder").toEqual([]);
      expect(filesHolding(fixture.repo, SECRET), "the key stayed in the repository").toEqual([]);
      const records = probeRecordsOf(fixture);
      expect(records, "the run wrote no probe record").toHaveLength(1);
      expect(String(records[0].error ?? ""), "the probe record must hold the fixed text").toBe(FIXED);
    } finally {
      dropFixture(fixture);
    }
  });

  it("Y2 a key on the stderr line of a region probe call never reaches stdout or the probe record", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [{ exit: 1, stderr: `${REGION_ERROR} (key ${SECRET} rejected)` }],
    });
    writeControlKey(fixture, "d-01");
    try {
      assertRunnerExists();
      const result = runRunner(fixture, probeArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(3);
      expect(modelCalls(logEntries(fixture.logPath)), "the region probe retried").toHaveLength(1);
      const lines = stdoutLines(result);
      expect(lines, "the probe prints one line").toHaveLength(1);
      expect(lines[0].startsWith(`${ROUTE} region-blocked `), `wrong probe line: ${lines[0]}`).toBe(true);
      expect(lines[0], "the probe line held the key").not.toContain(SECRET);
      expect(lines[0], "the probe line must hold the fixed text").toContain(FIXED);
      expect(filesHolding(fixture.privateDir, SECRET), "the key stayed in the private folder").toEqual([]);
      const records = probeRecordsOf(fixture);
      expect(records, "the run wrote no probe record").toHaveLength(1);
      expect(String(records[0].error ?? ""), "the probe record must hold the fixed text").toBe(FIXED);
    } finally {
      dropFixture(fixture);
    }
  });

  it("Y3 a key on the stderr line of a region-blocked pass never reaches the pass record", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [{ exit: 1, stderr: `${REGION_ERROR} (key ${SECRET} rejected)` }],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(modelCalls(logEntries(fixture.logPath)), "the runner retried the region error").toHaveLength(1);
      expect(result.stdout, "the runner output held the key").not.toContain(SECRET);
      const records = passRecords(fixture.privateDir);
      expect(records, "the run wrote no pass record").toHaveLength(1);
      expect(records[0].state).toBe("region-blocked");
      const errors = (records[0].errors ?? []) as unknown[];
      expect(errors, "the pass record holds no stored error line").toHaveLength(1);
      expect(String(errors[0]), "the pass record must hold the fixed text").toBe(FIXED);
      expect(filesHolding(fixture.privateDir, SECRET), "the key stayed in the private folder").toEqual([]);
      expect(filesHolding(fixture.repo, SECRET), "the key stayed in the repository").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });

  it("Y4 a hostile token number is not counted and sets tokens_complete false", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01", "d-02"],
      calls: [
        yRealCall({ input: 1e20, output: 20, reasoning: 5, cache: { read: 100, write: 7 } }),
        {
          raw_lines: [
            stepFinishLine('{"input":9007199254740993,"output":0,"reasoning":0,"cache":{"read":0,"write":0}}'),
          ],
        },
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const records = passRecords(fixture.privateDir);
      expect(records, "the run wrote no pass record").toHaveLength(1);
      expect(records[0].tokens_complete, "a hostile number kept the flag true").toBe(false);
      const diffs = records[0].diffs as any[];
      expect(Array.isArray(diffs), "the record must hold diff entries").toBe(true);
      expect(diffs[0].tokens.input, "1e20 was counted").toBe(0);
      expect(diffs[1].tokens.input, "2^53+1 was counted").toBe(0);
    } finally {
      dropFixture(fixture);
    }
  });

  it("Y5 two events of one call add the valid numbers only and set tokens_complete false", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01", "d-02"],
      calls: [
        {
          raw_lines: [
            stepFinishLine('{"input":-5,"output":0,"reasoning":0,"cache":{"read":0,"write":0}}'),
            stepFinishLine('{"input":10,"output":0,"reasoning":0,"cache":{"read":0,"write":0}}'),
          ],
        },
        {
          raw_lines: [
            stepFinishLine('{"input":0.5,"output":0,"reasoning":0,"cache":{"read":0,"write":0}}'),
            stepFinishLine('{"input":0.5,"output":0,"reasoning":0,"cache":{"read":0,"write":0}}'),
          ],
        },
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const records = passRecords(fixture.privateDir);
      expect(records, "the run wrote no pass record").toHaveLength(1);
      expect(records[0].tokens_complete, "a hostile number kept the flag true").toBe(false);
      const diffs = records[0].diffs as any[];
      expect(Array.isArray(diffs), "the record must hold diff entries").toBe(true);
      expect(diffs[0].tokens.input, "the negative value was counted").toBe(10);
      expect(diffs[1].tokens.input, "a fractional value was counted").toBe(0);
    } finally {
      dropFixture(fixture);
    }
  });

  it("Y6 a single hostile field keeps the valid fields of the call and sets tokens_complete false", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [yRealCall({ input: -5, output: 20, reasoning: 5, cache: { read: 1, write: 2 } })],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const records = passRecords(fixture.privateDir);
      expect(records, "the run wrote no pass record").toHaveLength(1);
      expect(records[0].tokens_complete, "a hostile number kept the flag true").toBe(false);
      const diffs = records[0].diffs as any[];
      expect(Array.isArray(diffs), "the record must hold diff entries").toBe(true);
      expect(diffs[0].tokens, "the valid fields of the call were erased").toEqual({
        input: 0,
        output: 20,
        reasoning: 5,
        cache_read: 1,
        cache_write: 2,
        total: 28,
      });
    } finally {
      dropFixture(fixture);
    }
  });

  it("Y7 a step_finish event with no tokens field marks the call incomplete", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [
        {
          raw_lines: [
            stepFinishLine('{"input":10,"output":20,"reasoning":5,"cache":{"read":100,"write":7}}'),
            TOKENS_LESS_LINE,
          ],
        },
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const records = passRecords(fixture.privateDir);
      expect(records, "the run wrote no pass record").toHaveLength(1);
      expect(records[0].tokens_complete, "the tokens-less event was skipped").toBe(false);
      const diffs = records[0].diffs as any[];
      expect(Array.isArray(diffs), "the record must hold diff entries").toBe(true);
      expect(diffs[0].tokens, "the valid event of the call was erased").toEqual({
        input: 10,
        output: 20,
        reasoning: 5,
        cache_read: 100,
        cache_write: 7,
        total: 142,
      });
    } finally {
      dropFixture(fixture);
    }
  });

  it("Y8 guard: a non-number token field sets tokens_complete false", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [yRealCall({ input: "10", output: 20, reasoning: 5, cache: { read: 100, write: 7 } })],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const records = passRecords(fixture.privateDir);
      expect(records, "the run wrote no pass record").toHaveLength(1);
      expect(records[0].tokens_complete, "a non-number field kept the flag true").toBe(false);
    } finally {
      dropFixture(fixture);
    }
  });

  it("Y9 guard: the sums add several step_finish events of one call", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [
        {
          raw_lines: [
            stepFinishLine('{"input":10,"output":20,"reasoning":5,"cache":{"read":100,"write":7}}'),
            stepFinishLine('{"input":1,"output":2,"reasoning":3,"cache":{"read":4,"write":5}}'),
          ],
        },
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const records = passRecords(fixture.privateDir);
      expect(records, "the run wrote no pass record").toHaveLength(1);
      expect(records[0].tokens_complete, "two valid events set the flag false").toBe(true);
      const diffs = records[0].diffs as any[];
      expect(Array.isArray(diffs), "the record must hold diff entries").toBe(true);
      expect(diffs[0].tokens, "the two events were not summed").toEqual({
        input: 11,
        output: 22,
        reasoning: 8,
        cache_read: 104,
        cache_write: 12,
        total: 157,
      });
    } finally {
      dropFixture(fixture);
    }
  });

  it("Y10 a hostile number keeps the record valid JSON and sets tokens_complete false", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [yRealCall({ input: 1152921504606846976, output: 20, reasoning: 5, cache: { read: 100, write: 7 } })],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const records = passRecords(fixture.privateDir);
      expect(records, "the run wrote no pass record").toHaveLength(1);
      expect(JSON.parse(JSON.stringify(records[0])), "the record is not valid JSON").toEqual(records[0]);
      expect(typeof (records[0].tokens as any).input, "the hostile sum is not a number").toBe("number");
      expect(records[0].tokens_complete, "a hostile number kept the flag true").toBe(false);
      const diffs = records[0].diffs as any[];
      expect(Array.isArray(diffs), "the record must hold diff entries").toBe(true);
      expect(diffs[0].tokens.input, "the unsafe integer was counted").toBe(0);
    } finally {
      dropFixture(fixture);
    }
  });

  it("Y11 a region error event on stdout gives the region-blocked state", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [
        { exit: 1, stderr: "", error_event: { type: "region", message: REGION_ERROR } },
        { exit: 1, stderr: "", error_event: { type: "region", message: REGION_ERROR } },
        { exit: 1, stderr: "", error_event: { type: "region", message: REGION_ERROR } },
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      const records = passRecords(fixture.privateDir);
      expect(records, "the run wrote no pass record").toHaveLength(1);
      expect(records[0].state, "the stdout error event gave no region-blocked state").toBe("region-blocked");
    } finally {
      dropFixture(fixture);
    }
  });

  it("Y12 a key in a stdout error event never reaches the pass record", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [
        { exit: 1, stderr: "", error_event: { type: "region", message: `${REGION_ERROR} (key ${SECRET} rejected)` } },
        { exit: 1, stderr: "", error_event: { type: "region", message: `${REGION_ERROR} (key ${SECRET} rejected)` } },
        { exit: 1, stderr: "", error_event: { type: "region", message: `${REGION_ERROR} (key ${SECRET} rejected)` } },
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.stdout, "the runner output held the key").not.toContain(SECRET);
      const records = passRecords(fixture.privateDir);
      expect(records, "the run wrote no pass record").toHaveLength(1);
      expect(records[0].state, "the stdout error event gave no region-blocked state").toBe("region-blocked");
      const errors = (records[0].errors ?? []) as unknown[];
      expect(errors, "the pass record holds no stored error line").toHaveLength(1);
      expect(String(errors[0]), "the pass record must hold the fixed text").toBe(FIXED);
      expect(filesHolding(fixture.privateDir, SECRET), "the key stayed in the private folder").toEqual([]);
      expect(filesHolding(fixture.repo, SECRET), "the key stayed in the repository").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });

  it("Y13 a region error event on stdout gives the region-blocked probe state", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [{ exit: 1, stderr: "", error_event: { type: "region", message: REGION_ERROR } }],
    });
    writeControlKey(fixture, "d-01");
    try {
      assertRunnerExists();
      const result = runRunner(fixture, probeArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(3);
      const lines = stdoutLines(result);
      expect(lines, "the probe prints one line").toHaveLength(1);
      expect(lines[0].startsWith(`${ROUTE} region-blocked `), `wrong probe line: ${lines[0]}`).toBe(true);
      expect(lines[0], "the probe line must hold the region error").toContain("not available in your region");
      const records = probeRecordsOf(fixture);
      expect(records, "the run wrote no probe record").toHaveLength(1);
      expect(records[0].state).toBe("region-blocked");
    } finally {
      dropFixture(fixture);
    }
  });
});
// --- task 4.13aa: no raw error line on a failed scan, the decoded-text scan,
// and the pinned stdout scan path ---
//
// Sources: Review B f26965d N22, N23, N25; Review A f26965d NA2;
// Review C f26965d N1. These must land before the live probe on 2026-11-20
// at 01:45.
//
// N22/NA2/N1: `error_line_of` prints the raw error line when `scan_output`
// itself fails (exit 2). The Red pins: the fixed text replaces the line on
// the probe stdout line, in the probe record, and in the pass record of the
// region branch. Cases AA1 (probe) and AA2 (pass region branch).
// N23: the scan reads the bytes of the output file, but the error line is
// the decoded text of a JSON stdout event. A key with a quote, a backslash,
// or a control character is escaped in the file, so the byte scan misses it
// and the decoded line leaks. The Red pins: the scan reads the decoded
// text. Cases AA3 (probe) and AA5 (pass region branch).
// N25: the probe path with a key in a stdout error event has no failing
// test. Case AA4 pins it; it passes at HEAD and guards the behavior Green
// must keep.
describe("P4 task 4.13aa failed scan and decoded-text scan (Review B f26965d N22 N23 N25, Review A NA2, Review C N1)", () => {
  const AA_PROBE_DATE = "2026-11-20";
  /** The fixed text that replaces an error line holding a found key. */
  const AA_FIXED = "the error output held a credential value";
  /** The distinct fixed text of a failed scan (review finding N31). */
  const AA_SCAN_FAIL_TEXT = "the error output could not be scanned";
  /** A key with a quote, a backslash, and a control character (tab). The
   * JSON stdout event escapes all three, so a byte scan of the file misses
   * it while the decoded line holds it raw (Review B N23). */
  const AA_WEIRD = "sk-test-\"quoted\"\\back\tail";

  /** A helper that seeds fine but whose value scan always fails (exit 2),
   * so the run reaches the N22 path: a good seed, then a failed scan. */
  const AA_SCAN_FAIL_STUB = `#!/usr/bin/env bash
set -uo pipefail
case "\${1:-}" in
  seed) exit 0 ;;
  scan-values) echo "provider-credential: the job store read failed" >&2; exit 2 ;;
  *) echo "provider-credential: unknown mode" >&2; exit 2 ;;
esac
`;

  function aaProbeArgs(fixture: Fixture): string[] {
    return [...runArgs(fixture), "--probe", "--date", AA_PROBE_DATE];
  }

  function aaWriteControlKey(fixture: Fixture, controlId: string): void {
    const keysDir = join(fixture.privateDir, "sets", fixture.setId, "keys");
    mkdirSync(keysDir, { recursive: true });
    for (const diff of fixture.diffs) {
      const plants =
        diff === controlId
          ? []
          : [
              {
                id: `P-${diff}`,
                new_lines: [3, 5],
                file: `src/${diff}.ts`,
                class: "C1",
                severity: "blocker",
                title: "planted",
                reason: "the test plant",
                witness: "witness",
                weight: 5,
              },
            ];
      writeFileSync(
        join(keysDir, `${diff}.json`),
        `${JSON.stringify(
          { schema: "model-guide-key/1", set_id: fixture.setId, diff_id: diff, plants },
          null,
          2,
        )}\n`,
      );
    }
  }

  function aaProbeRecordsOf(fixture: Fixture): Array<Record<string, unknown>> {
    return filesUnder(join(fixture.privateDir, "probes"))
      .filter((file) => file.endsWith(".json"))
      .map((file) => JSON.parse(readFileSync(file, "utf8")));
  }

  /** The temp helper whose scan always fails replaces the stub copy, so
   * the seed passes and the value scan of the error line fails. */
  function aaBreakScan(fixture: Fixture): void {
    writeFileSync(
      join(fixture.repo, "harness", "model-guide", "provider-credential.sh"),
      AA_SCAN_FAIL_STUB,
    );
    chmodSync(join(fixture.repo, "harness", "model-guide", "provider-credential.sh"), 0o755);
  }

  it("AA1 a failed value scan prints the fixed text on a failed probe instead of the raw line", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [
        { exit: 1, stderr: SECRET },
        { exit: 1, stderr: SECRET },
        { exit: 1, stderr: SECRET },
      ],
    });
    aaWriteControlKey(fixture, "d-01");
    aaBreakScan(fixture);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, aaProbeArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(3);
      expect(result.stdout, "the probe line held the key").not.toContain(SECRET);
      expect(result.stdout, "the probe line must hold the failed-scan text").toContain(AA_SCAN_FAIL_TEXT);
      expect(filesHolding(fixture.privateDir, SECRET), "the key stayed in the private folder").toEqual([]);
      expect(filesHolding(fixture.repo, SECRET), "the key stayed in the repository").toEqual([]);
      const records = aaProbeRecordsOf(fixture);
      expect(records, "the run wrote no probe record").toHaveLength(1);
      expect(String(records[0].error ?? ""), "the probe record must hold the failed-scan text").toBe(AA_SCAN_FAIL_TEXT);
    } finally {
      dropFixture(fixture);
    }
  });

  it("AA2 a failed value scan stores the fixed text in a region-blocked pass record", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [{ exit: 1, stderr: `${REGION_ERROR} (key ${SECRET} rejected)` }],
    });
    aaBreakScan(fixture);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(modelCalls(logEntries(fixture.logPath)), "the runner retried the region error").toHaveLength(1);
      expect(result.stdout, "the runner output held the key").not.toContain(SECRET);
      const records = passRecords(fixture.privateDir);
      expect(records, "the run wrote no pass record").toHaveLength(1);
      expect(records[0].state).toBe("region-blocked");
      const errors = (records[0].errors ?? []) as unknown[];
      expect(errors, "the pass record holds no stored error line").toHaveLength(1);
      expect(String(errors[0]), "the pass record must hold the failed-scan text").toBe(AA_SCAN_FAIL_TEXT);
      expect(filesHolding(fixture.privateDir, SECRET), "the key stayed in the private folder").toEqual([]);
      expect(filesHolding(fixture.repo, SECRET), "the key stayed in the repository").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });

  it("AA3 a key with a quote, a backslash, and a tab never reaches the probe line or record", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [
        { exit: 1, stderr: "", error_event: { message: `boom ${AA_WEIRD} fail` } },
        { exit: 1, stderr: "", error_event: { message: `boom ${AA_WEIRD} fail` } },
        { exit: 1, stderr: "", error_event: { message: `boom ${AA_WEIRD} fail` } },
      ],
    });
    aaWriteControlKey(fixture, "d-01");
    try {
      assertRunnerExists();
      const result = runRunner(fixture, aaProbeArgs(fixture), { MG_TEST_SECRET_VALUE: AA_WEIRD });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(3);
      expect(result.stdout, "the probe line held the key").not.toContain(AA_WEIRD);
      expect(result.stdout, "the probe line must hold the fixed text").toContain(AA_FIXED);
      expect(filesHolding(fixture.privateDir, AA_WEIRD), "the key stayed in the private folder").toEqual([]);
      expect(filesHolding(fixture.repo, AA_WEIRD), "the key stayed in the repository").toEqual([]);
      const records = aaProbeRecordsOf(fixture);
      expect(records, "the run wrote no probe record").toHaveLength(1);
      expect(String(records[0].error ?? ""), "the probe record must hold the fixed text").toBe(AA_FIXED);
    } finally {
      dropFixture(fixture);
    }
  });

  it("AA4 guard: a key in a stdout error event of a probe never reaches the probe line or record", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [
        { exit: 1, stderr: "", error_event: { message: `boom ${SECRET} rejected` } },
        { exit: 1, stderr: "", error_event: { message: `boom ${SECRET} rejected` } },
        { exit: 1, stderr: "", error_event: { message: `boom ${SECRET} rejected` } },
      ],
    });
    aaWriteControlKey(fixture, "d-01");
    try {
      assertRunnerExists();
      const result = runRunner(fixture, aaProbeArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(3);
      expect(result.stdout, "the probe line held the key").not.toContain(SECRET);
      expect(result.stdout, "the probe line must hold the fixed text").toContain(AA_FIXED);
      expect(filesHolding(fixture.privateDir, SECRET), "the key stayed in the private folder").toEqual([]);
      expect(filesHolding(fixture.repo, SECRET), "the key stayed in the repository").toEqual([]);
      const records = aaProbeRecordsOf(fixture);
      expect(records, "the run wrote no probe record").toHaveLength(1);
      expect(String(records[0].error ?? ""), "the probe record must hold the fixed text").toBe(AA_FIXED);
    } finally {
      dropFixture(fixture);
    }
  });

  it("AA5 a region error event with an escaped key never reaches the pass record", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [
        { exit: 1, stderr: "", error_event: { message: `${REGION_ERROR} (${AA_WEIRD})` } },
        { exit: 1, stderr: "", error_event: { message: `${REGION_ERROR} (${AA_WEIRD})` } },
        { exit: 1, stderr: "", error_event: { message: `${REGION_ERROR} (${AA_WEIRD})` } },
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture), { MG_TEST_SECRET_VALUE: AA_WEIRD });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.stdout, "the runner output held the key").not.toContain(AA_WEIRD);
      const records = passRecords(fixture.privateDir);
      expect(records, "the run wrote no pass record").toHaveLength(1);
      expect(records[0].state).toBe("region-blocked");
      const errors = (records[0].errors ?? []) as unknown[];
      expect(errors, "the pass record holds no stored error line").toHaveLength(1);
      expect(String(errors[0]), "the pass record must hold the fixed text").toBe(AA_FIXED);
      expect(filesHolding(fixture.privateDir, AA_WEIRD), "the key stayed in the private folder").toEqual([]);
      expect(filesHolding(fixture.repo, AA_WEIRD), "the key stayed in the repository").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });
});

// === Phase 4b row 4.15: the backlog of nonblocking findings ================
// Sources: measure/runs/model_guide/review-b-c0a26d7.json, test strategy
// section 14.5, and the carried Review A and Review C findings. Every case
// below either fails at the accepted HEAD for the missing fix, or is marked
// as a guard in measure/runs/model_guide/red-4.15.txt with its falsification.
describe("P4b task 4.15 backlog (Review B c0a26d7, Review A F1/F2)", () => {
  const P4B_DATE = "2026-11-20";
  const KEY_FIXED = "the error output held a credential value";
  /** N31: a failed scan must have its own fixed text, different from the
   * text of a found key. Red pins the contract; Green implements it. */
  const SCAN_FAIL_TEXT = "the error output could not be scanned";

  const SCAN_FAIL_STUB = `#!/usr/bin/env bash
set -uo pipefail
case "\${1:-}" in
  seed) exit 0 ;;
  scan-values) echo "provider-credential: the job store read failed" >&2; exit 2 ;;
  *) echo "provider-credential: unknown mode" >&2; exit 2 ;;
esac
`;

  /** Extracts a function from the runner source up to the next top-level
   * function. Unlike shellFunc, this keeps a brace at column 0 inside an
   * embedded `node -e` script (daemon_pids has one). */
  function shellBlock(name: string, nextName: string): string {
    const lines = readFileSync(RUNNER_SOURCE, "utf8").split("\n");
    const start = lines.findIndex((line) => line === `${name}() {`);
    expect(start, `${name} is missing in the runner`).toBeGreaterThanOrEqual(0);
    const end = lines.findIndex((line, index) => index > start && line === `${nextName}() {`);
    expect(end, `${nextName} is missing in the runner`).toBeGreaterThan(start);
    return lines.slice(start, end).join("\n");
  }

  function probeArgs4b(fixture: Fixture): string[] {
    return [...runArgs(fixture), "--probe", "--date", P4B_DATE];
  }

  function writeControlKey4b(fixture: Fixture): void {
    const keysDir = join(fixture.privateDir, "sets", fixture.setId, "keys");
    mkdirSync(keysDir, { recursive: true });
    for (const diff of fixture.diffs) {
      writeFileSync(
        join(keysDir, `${diff}.json`),
        `${JSON.stringify(
          {
            schema: "model-guide-key/1",
            set_id: fixture.setId,
            diff_id: diff,
            plants: [],
          },
          null,
          2,
        )}\n`,
      );
    }
  }

  function probeRecords4b(fixture: Fixture): Array<Record<string, unknown>> {
    return filesUnder(join(fixture.privateDir, "probes"))
      .filter((file) => file.endsWith(".json"))
      .map((file) => JSON.parse(readFileSync(file, "utf8")));
  }

  function breakScan4b(fixture: Fixture): void {
    writeFileSync(
      join(fixture.repo, "harness", "model-guide", "provider-credential.sh"),
      SCAN_FAIL_STUB,
    );
    chmodSync(join(fixture.repo, "harness", "model-guide", "provider-credential.sh"), 0o755);
  }

  // N21: the message rule is ASCII-only under LC_ALL=C. A Unicode control
  // character must be refused as well. Falsification: keep [[:cntrl:]] only.
  it("N21 the message rule refuses U+202E, U+0085, and U+200B", () => {
    const dir = mkdtempSync(join(tmpdir(), "mg-review-msg-"));
    tempRoots.add(dir);
    try {
      const helper = shellFunc(RUNNER_SOURCE, "read_message_line");
      const cases: Array<[string, string]> = [
        ["rlo", "\u202e"],
        ["nel", "\u0085"],
        ["zwsp", "\u200b"],
      ];
      for (const [tag, control] of cases) {
        writeFileSync(join(dir, `${tag}.txt`), `line ${control} with a Unicode control\n`);
        const script = `${helper}\nMESSAGE_DIR="${dir}"\nMESSAGE_MAX_BYTES=1000\nread_message_line "${tag}"`;
        const result = spawnSync("bash", ["-c", script], {
          encoding: "utf8",
          env: { ...process.env, LC_ALL: "C" },
          timeout: 10_000,
        });
        expect(
          result.status,
          `${tag}: the message rule accepted a Unicode control character`,
        ).not.toBe(0);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      tempRoots.delete(dir);
    }
  });

  // N10: the XDG guard checks every level of each call path. A link at
  // `data/opencode` must be refused as well as a link at `data` itself.
  it("N10 the XDG guard refuses a symlink below the first level of a call path", () => {
    const dir = mkdtempSync(join(tmpdir(), "mg-review-xdg-"));
    tempRoots.add(dir);
    try {
      const job = join(dir, "job");
      const outside = join(dir, "outside");
      mkdirSync(outside, { recursive: true });
      for (const sub of ["home", "config", "data", "state", "cache", "runtime", "tmp"]) {
        mkdirSync(join(job, sub), { recursive: true });
      }
      symlinkSync(outside, join(job, "data", "opencode"));
      const lines = readFileSync(RUNNER_SOURCE, "utf8").split("\n");
      const start = lines.findIndex((line) => line.includes("The call paths of the job folder"));
      expect(start, "the XDG guard block is missing").toBeGreaterThanOrEqual(0);
      const end = lines.findIndex((line, index) => index > start && line === "done");
      expect(end, "the XDG guard block has no closing done").toBeGreaterThan(start);
      const block = lines.slice(start, end + 1).join("\n");
      const script = [
        'refuse() { printf "%s\\n" "$1"; exit 2; }',
        `JOB="${job}"`,
        block,
        'printf "%s\\n" "ACCEPTED"',
      ].join("\n");
      const result = spawnSync("bash", ["-c", script], { encoding: "utf8", timeout: 10_000 });
      expect(result.stdout, "the guard accepted a link below the first level").not.toContain("ACCEPTED");
      expect(result.status, "the guard accepted a second-level XDG link").toBe(2);
      expect(result.stdout, "the refusal must name the data folder").toContain("data");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      tempRoots.delete(dir);
    }
  });

  // N11: the daemon matcher selects a process only when `serve` and
  // `--service` are adjacent in that order. Falsification: accept the
  // tokens at a distance or in reverse order.
  it("N11 the daemon matcher needs serve and --service adjacent in that order", () => {
    const proc = mkdtempSync(join(tmpdir(), "mg-review-proc-"));
    const root = mkdtempSync(join(tmpdir(), "mg-review-jobroot-"));
    tempRoots.add(proc);
    tempRoots.add(root);
    try {
      mkdirSync(join(root, "home"), { recursive: true });
      const pid = "700011";
      const pidDir = join(proc, pid);
      mkdirSync(pidDir, { recursive: true });
      writeFileSync(
        join(pidDir, "cmdline"),
        `${["opencode", "serve", "decoy", "--service", "x"].join("\0")}\0`,
      );
      writeFileSync(join(pidDir, "environ"), `HOME=${join(root, "home")}\0PATH=/x\0`);
      symlinkSync(root, join(pidDir, "cwd"));
      const helper = shellBlock("daemon_pids", "stop_daemons");
      const call = (cmdline: string): string => {
        writeFileSync(join(pidDir, "cmdline"), cmdline);
        const out = spawnSync(
          "bash",
          ["-c", `${helper}\nBENCH_OPENCODE_PROC="${proc}" daemon_pids "${root}"`],
          { encoding: "utf8", timeout: 10_000 },
        );
        expect(out.status, "daemon_pids failed").toBe(0);
        return out.stdout.trim();
      };
      const adjacent = call(`opencode\0serve\0--service\0x\0`);
      expect(adjacent, "the positive control saw no adjacent daemon").toBe(pid);
      const distant = call(`opencode\0serve\0decoy\0--service\0x\0`);
      expect(distant, "the matcher selected non-adjacent serve and --service tokens").toBe("");
    } finally {
      rmSync(proc, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
      tempRoots.delete(proc);
      tempRoots.delete(root);
    }
  });

  // N9: stop_daemons logs a stopped daemon only when its start time still
  // matches the value recorded at TERM. A reused pid must not be logged.
  it("N9 stop_daemons logs no INFRA line when the start time changed", async () => {
    const proc = mkdtempSync(join(tmpdir(), "mg-review-proc-"));
    tempRoots.add(proc);
    try {
      mkdirSync(join(proc, "home"), { recursive: true });
      const pid = "700009";
      const pidDir = join(proc, pid);
      mkdirSync(pidDir, { recursive: true });
      const stat = (start: string): string =>
        `${pid} (fake-opencode) R 1 1 1 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0 ${start} 0 0\n`;
      writeFileSync(join(pidDir, "stat"), stat("111111"));
      writeFileSync(join(pidDir, "cmdline"), `opencode\0serve\0--service\0n9\0`);
      writeFileSync(join(pidDir, "environ"), `HOME=${join(proc, "home")}\0PATH=/x\0`);
      symlinkSync(proc, join(pidDir, "cwd"));
      const helpers = [
        shellBlock("daemon_pids", "stop_daemons"),
        shellBlock("daemon_pid_alive", "daemon_starttime"),
        shellBlock("daemon_starttime", "daemon_pids"),
        shellBlock("stop_daemons", "on_exit"),
      ].join("\n");
      const statPath = join(pidDir, "stat");
      const runGuard = (): { stdout: string; stderr: string; status: number | null } =>
        spawnSync(
          "bash",
          ["-c", `${helpers}\nINFRA_LIST=""\nBENCH_OPENCODE_PROC="${proc}" stop_daemons "${proc}"`],
          { encoding: "utf8", timeout: 20_000 },
        );
      // Positive control: with a stable start time the stopped daemon is
      // logged. Falsification: no INFRA line even for a stable pid.
      writeFileSync(statPath, stat("111111"));
      const stable = runGuard();
      expect(stable.stderr, "a stable daemon was not logged").toContain("INFRA stopped daemon");
      writeFileSync(statPath, stat("111111"));
      const mutator = spawn(
        "bash",
        ["-c", `sleep 0.3; printf '%s' '${stat("999999")}' > '${statPath}'`],
        { stdio: "ignore" },
      );
      let result: { stdout: string; stderr: string; status: number | null };
      try {
        result = runGuard();
      } finally {
        mutator.kill("SIGKILL");
      }
      expect(result.stderr, "an INFRA line was logged for a reused pid").not.toContain(
        "INFRA stopped daemon",
      );
    } finally {
      rmSync(proc, { recursive: true, force: true });
      tempRoots.delete(proc);
    }
  }, 40_000);

  // N26: an error line over 500 bytes is cut before the record write. A
  // 300 KB line must still give a probe record and a bounded error field.
  it("N26 error_line_of cuts an error line over 500 bytes before the record write", () => {
    const dir = mkdtempSync(join(tmpdir(), "mg-review-errline-"));
    tempRoots.add(dir);
    try {
      const outPath = join(dir, "out.txt");
      const errPath = join(dir, "err.txt");
      const valuesPath = join(dir, "values.txt");
      writeFileSync(outPath, "");
      writeFileSync(errPath, `${"x".repeat(300 * 1024)}\n`);
      writeFileSync(valuesPath, "");
      const helper = shellFunc(RUNNER_SOURCE, "error_line_of");
      const script = [
        helper,
        'ERROR_KEY_TEXT="the error output held a credential value"',
        `TMP_VALUES="${valuesPath}"`,
        "scan_output() { return 1; }",
        `error_line_of "${outPath}" "${errPath}" "the model call failed"`,
      ].join("\n");
      const result = spawnSync("bash", ["-c", script], {
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
        timeout: 20_000,
      });
      expect(result.status, "error_line_of failed").toBe(0);
      expect(result.stdout.length, "error_line_of kept the full 300 KB line").toBeLessThanOrEqual(500);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      tempRoots.delete(dir);
    }
  });

  // N27: read_tokens clears tokens_complete when a sum passes 2^53.
  it("N27 a token sum above 2^53 clears tokens_complete", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [
        {
          raw_lines: [
            '{"type":"step_finish","part":{"type":"step-finish","tokens":{"input":9007199254740991,"output":0,"reasoning":0,"cache":{"read":0,"write":0}}}}',
            '{"type":"step_finish","part":{"type":"step-finish","tokens":{"input":9007199254740991,"output":0,"reasoning":0,"cache":{"read":0,"write":0}}}}',
          ],
          value: '{"findings":[]}',
        },
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      const records = passRecords(fixture.privateDir);
      expect(records, "the run wrote no pass record").toHaveLength(1);
      // Each field is a safe integer, but their sum is above 2^53 and no
      // longer exact. This fails when the per-key sum check is removed.
      expect(records[0].tokens_complete, "an unsafe sum kept tokens_complete true").toBe(false);
    } finally {
      dropFixture(fixture);
    }
  });

  // N28: a probe that fails once and then succeeds holds no error line when
  // the state is reachable.
  it("N28 a probe that fails once then succeeds stores no error line", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [
        { exit: 1, stderr: "a transient transport failure" },
        { tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } }, value: "answer" },
      ],
    });
    writeControlKey4b(fixture);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, probeArgs4b(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const records = probeRecords4b(fixture);
      expect(records, "the run wrote no probe record").toHaveLength(1);
      expect(records[0].state).toBe("reachable");
      expect(records[0].error, "a reachable probe stored the first error line").toBeUndefined();
    } finally {
      dropFixture(fixture);
    }
  });

  // N31 AA1: a failed scan prints its own fixed text, not the found-key text.
  it("N31 a failed scan prints a distinct text on a failed probe", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [{ exit: 1, stderr: SECRET }, { exit: 1, stderr: SECRET }, { exit: 1, stderr: SECRET }],
    });
    writeControlKey4b(fixture);
    breakScan4b(fixture);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, probeArgs4b(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.stdout, "a failed scan printed the found-key text").not.toContain(KEY_FIXED);
      expect(result.stdout, "the failed-scan text is missing").toContain(SCAN_FAIL_TEXT);
    } finally {
      dropFixture(fixture);
    }
  });

  // N31 AA2: the same distinct text in a region-blocked pass record.
  it("N31 a failed scan stores a distinct text in a region-blocked pass record", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [{ exit: 1, stderr: `${REGION_ERROR} (key ${SECRET} rejected)` }],
    });
    breakScan4b(fixture);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      const records = passRecords(fixture.privateDir);
      expect(records, "the run wrote no pass record").toHaveLength(1);
      const errors = (records[0].errors ?? []) as unknown[];
      expect(errors, "the pass record holds no error line").toHaveLength(1);
      expect(String(errors[0]), "a failed scan stored the found-key text").not.toContain(KEY_FIXED);
      expect(String(errors[0]), "the failed-scan text is missing").toContain(SCAN_FAIL_TEXT);
    } finally {
      dropFixture(fixture);
    }
  });

  // N30 probe part and F1: a key in a stdout error event on the probe region
  // branch never reaches stdout or the probe record. Guard at HEAD; its
  // breakage proof is mutation r6 of review-b-c0a26d7.json.
  it("N30/F1 a key in a probe region stdout error event never reaches the record", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [
        {
          exit: 1,
          stderr: "",
          error_event: { type: "region", message: `${REGION_ERROR} (key ${SECRET} rejected)` },
        },
      ],
    });
    writeControlKey4b(fixture);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, probeArgs4b(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.stdout, "the probe line held the key").not.toContain(SECRET);
      const records = probeRecords4b(fixture);
      expect(records, "the run wrote no probe record").toHaveLength(1);
      expect(String(records[0].error ?? ""), "the probe record held the key").not.toContain(SECRET);
      expect(String(records[0].error ?? ""), "the record must hold the fixed text").toContain(KEY_FIXED);
    } finally {
      dropFixture(fixture);
    }
  });
});

// === Phase 4b r6: the runner carries the no-entry seed reason ============
// The 2026-11-20 probe refused both Go routes with the generic seed text.
// The PM diagnostic found an empty `auth export` array. The runner must name
// the fixed no-entry reason in its one refusal line (task 4.15).
describe("P4b row 4.15 r6: the runner carries the seed reason", () => {
  const NO_DELAYS = { BENCH_CREDENTIAL_SEED_DELAYS: "0" };
  const SEED_REASON =
    "review-run: the provider credential seed failed: the store holds no active entry of provider opencode-go";

  function storeEntry(): unknown {
    return {
      integrationID: "opencode-go",
      active: true,
      value: {
        type: "oauth",
        key: "FAKE-KEY-OPENCODIGO-0001",
        access: SECRET,
        refresh: "inert",
        expires: 9999999999999,
        metadata: { orgID: "org-test-0123456789" },
      },
    };
  }

  it("R-SR1 an empty shared store refuses the pass and names the no-entry reason", async () => {
    const fixture = await buildFixture({
      // Row 4.16: the isolated seed path stays on a non-pilot route (14.12.3).
      ...isolatedOverride(),
      realCredential: true,
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}' }],
      authExportShared: [],
      authExportJob: [storeEntry()],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture), NO_DELAYS);
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      const named = namedLines(result);
      expect(named, `the runner printed no named line: ${result.stdout}`).toHaveLength(1);
      expect(named[0], "the runner hid the no-entry seed reason").toBe(SEED_REASON);
      expect(named[0], "the runner printed a raw value").not.toContain(SECRET);
      expect(modelCalls(logEntries(fixture.logPath)), "the runner called the model").toEqual([]);
      expect(passRecords(fixture.privateDir), "the runner wrote a pass record").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });
});

// === Phase 4b r7: review B contract cases =================================
describe("P4b row 4.15 r7: the N26 and G2 runner paths", () => {
  it("N26 a 300 KB error line gives a record and exit 0 with a bounded line", async () => {
    // Review B G1. The cap in error_line_of uses `printf | head -c 499`
    // under the runner's `set -euo pipefail`. SIGPIPE makes the pipeline
    // return 141, so no line and no record reach the pass file. The case
    // drives the full runner path, not the bare function.
    const big = "x".repeat(300 * 1024);
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [
        { exit: 1, stderr: big },
        { exit: 1, stderr: big },
        { exit: 1, stderr: big },
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `the runner aborted: ${result.stdout}\n${result.stderr}`).toBe(0);
      const records = passRecords(fixture.privateDir);
      expect(records, "the run wrote no pass record").toHaveLength(1);
      const errors = (records[0].errors ?? []) as unknown[];
      expect(errors, "the pass record holds no error line").toHaveLength(1);
      const line = String(errors[0]);
      expect(line.length, "the stored error line is empty").toBeGreaterThan(0);
      expect(line.length, "the stored error line exceeds 500 bytes").toBeLessThanOrEqual(500);
    } finally {
      dropFixture(fixture);
    }
  });

  it("N26b error_line_of under pipefail returns a bounded line for a 300 KB error", () => {
    // Review B G1 proof. The runner calls error_line_of in a command
    // substitution, which suppresses errexit inside the function. Running
    // the same function under the runner's own `set -euo pipefail` shows the
    // SIGPIPE of `printf | head -c 499`: the function returns 141 and no
    // line. This case pins the function itself, not only its caller.
    const dir = mkdtempSync(join(tmpdir(), "mg-review-n26b-"));
    tempRoots.add(dir);
    try {
      const outPath = join(dir, "out.txt");
      const errPath = join(dir, "err.txt");
      const valuesPath = join(dir, "values.txt");
      writeFileSync(outPath, "");
      writeFileSync(errPath, `${"x".repeat(300 * 1024)}\n`);
      writeFileSync(valuesPath, "");
      const source = readFileSync(RUNNER_SOURCE, "utf8").split("\n");
      const block = (name: string, next: string): string => {
        const start = source.findIndex((line) => line === `${name}() {`);
        expect(start, `${name} is missing`).toBeGreaterThanOrEqual(0);
        const end = source.findIndex((line, index) => index > start && line === `${next}() {`);
        expect(end, `${next} is missing`).toBeGreaterThan(start);
        return source.slice(start, end).join("\n");
      };
      const script = [
        "set -euo pipefail",
        block("error_event_text", "error_all_events_text"),
        block("error_all_events_text", "error_line_of"),
        block("error_line_of", "is_region_error"),
        'ERROR_KEY_TEXT="the error output held a credential value"',
        'ERROR_SCAN_TEXT="the error output could not be scanned"',
        `TMP_VALUES="${valuesPath}"`,
        "scan_output() { return 1; }",
        `error_line_of "${outPath}" "${errPath}" "the model call failed"`,
      ].join("\n");
      const result = spawnSync("bash", ["-c", script], {
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
        timeout: 20_000,
      });
      expect(result.status, `error_line_of aborted: ${result.stderr}`).toBe(0);
      expect(result.stdout.length, "the bounded line is empty").toBeGreaterThan(0);
      expect(result.stdout.length, "the bounded line exceeds 500 bytes").toBeLessThanOrEqual(500);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      tempRoots.delete(dir);
    }
  });

  it("G2 the symlink walk does not abort when find meets many links", () => {
    // Review B G2. `find ... | head -n 1` under `set -euo pipefail` returns
    // 141 once find writes more than the pipe buffer after head exits. A
    // fresh job tree is small, so the case presets a large tree with many
    // links under one call path. The walk must still refuse with exit 2.
    const root = mkdtempSync(join(tmpdir(), "mg-review-g2-"));
    tempRoots.add(root);
    try {
      const job = join(root, "job");
      for (const sub of ["home", "config", "data", "state", "cache", "runtime", "tmp"]) {
        mkdirSync(join(job, sub), { recursive: true });
      }
      const target = join(job, "data", "target");
      writeFileSync(target, "target\n");
      for (let i = 0; i < 20_000; i += 1) {
        symlinkSync(target, join(job, "data", `link-${i}`));
      }
      const lines = readFileSync(RUNNER_SOURCE, "utf8").split("\n");
      const start = lines.findIndex((line) => line.includes("The call paths of the job folder"));
      expect(start, "the XDG guard block is missing").toBeGreaterThanOrEqual(0);
      const end = lines.findIndex((line, index) => index > start && line === "done");
      expect(end, "the guard block has no closing done").toBeGreaterThan(start);
      const block = lines.slice(start, end + 1).join("\n");
      const script = [
        "set -euo pipefail",
        'refuse() { printf "%s\\n" "$1"; exit 2; }',
        `JOB="${job}"`,
        block,
        'printf "%s\\n" "ACCEPTED"',
      ].join("\n");
      const result = spawnSync("bash", ["-c", script], { encoding: "utf8", timeout: 30_000 });
      expect(result.status, `the guard aborted: ${result.stderr}`).toBe(2);
      expect(result.stdout, "the guard printed ACCEPTED despite a link").not.toContain("ACCEPTED");
      expect(result.stdout, "the guard did not name the data folder").toContain("data");
    } finally {
      rmSync(root, { recursive: true, force: true });
      tempRoots.delete(root);
    }
  }, 40_000);
});

// ---------------------------------------------------------------------------
// Row 4.16: the live-server path (spec D14 "Live-server path (PM 2026-11-20)").
//
// The pilot routes reach a model through one bench session on the OpenChamber
// API. The base URL comes from BENCH_SERVER_BASE and from no other env value.
// These cases start a loopback fake on port 0. The fake records each method,
// path, and body. It has no DELETE handler. No case names port 38307 and no
// case calls the live server. The fake stops in afterEach (the shared watch
// above) and in a finally block of each case.
// ---------------------------------------------------------------------------

/** A synthetic non-pilot opencode-go route. The old seed cases of the isolated
 * path use it, so those cases keep covering the seed and stay green after row
 * 4.16. It is not a D14 live-server route. */
const ISOLATED_ROUTE = "opencode-go/isolated-nonpilot#high";
function isolatedOverride(): Partial<Scenario> {
  return { route: ISOLATED_ROUTE, routes: routesFile(ISOLATED_ROUTE) };
}

/** The fake OpenChamber HTTP server. It runs in its own process, because the
 * runner is a spawnSync child and a server in this process cannot answer while
 * this process blocks. Port 0 gives a random free port. */
const LIVE_SERVER_SOURCE = [
  'const fs = require("node:fs");',
  'const http = require("node:http");',
  'const logPath = process.env.LIVE_LOG || "";',
  'const specPath = process.env.LIVE_SPEC || "";',
  'const timeLog = process.env.LIVE_TIME_LOG || "";',
  'let spec = {};',
  'let queuedAt = 0;',
  'try { spec = JSON.parse(fs.readFileSync(specPath, "utf8")); } catch (e) {}',
  'const server = http.createServer((req, res) => {',
  '  let body = "";',
  '  req.on("data", (c) => { body += c; });',
  '  req.on("end", () => {',
  '    try { if (logPath) fs.appendFileSync(logPath, req.method + " " + req.url + " " + body + "\\n"); } catch (e) {}',
  '    try { if (timeLog) fs.appendFileSync(timeLog, String(Date.now()) + " " + req.method + " " + req.url + "\\n"); } catch (e) {}',
  '    const url = req.url || "";',
  '    const send = (obj, status) => {',
  '      res.writeHead(status || 200, { "content-type": "application/json", connection: "close" });',
  '      res.end(typeof obj === "string" ? obj : JSON.stringify(obj));',
  '    };',
  '    const isMessage = req.method === "POST" && (url.indexOf("/message") >= 0 || url.indexOf("/prompt") >= 0);',
  '    if (isMessage && spec.fail_sends) {',
  '      const errorText = spec.send_error || "transport failure";',
  '      spec.fail_sends = Number(spec.fail_sends) - 1;',
  '      if (spec.fail_sends <= 0) { delete spec.fail_sends; delete spec.send_error; }',
  '      fs.writeFileSync(specPath, JSON.stringify(spec));',
  '      send({ error: errorText }, 500); return;',
  '    }',
  '    const finish = () => {',
  '      if (req.method === "DELETE") { send({ error: "no delete" }, 405); return; }',
  '      if (req.method === "POST" && url.indexOf("/api/session") === 0 && url.indexOf("/model") < 0 && url.indexOf("/message") < 0 && url.indexOf("/prompt") < 0) {',
  '        let directory = "";',
  '        try { const parsed = JSON.parse(body || "{}"); directory = (parsed.location && parsed.location.directory) || ""; } catch (e) {}',
  '        const shown = spec.session_location !== undefined ? spec.session_location : directory;',
  '        send({ id: "ses_live_1", location: { directory: shown } }); return;',
  '      }',
  '      if (req.method === "POST" && url.indexOf("/model") >= 0) { send({ ok: true }); return; }',
  '      if (isMessage) { queuedAt = Date.now(); send({ messageID: "msg_live_1" }); return; }',
  '      if (req.method === "GET" && url.indexOf("/message") >= 0) {',
  '        if (spec.get_fail) { send({ error: "message read failed" }, 500); return; }',
  '        if (spec.queue_delay_ms && Date.now() - queuedAt < Number(spec.queue_delay_ms)) { send({ data: [], cursor: {} }); return; }',
  '        const now = Date.now();',
  '        const page = (spec.messages || []).map((m) => {',
  '          if (!m || !m._stampAtRead) return m;',
  '          const copy = { ...m }; delete copy._stampAtRead;',
  '          const offset = Number(copy._stampOffset || 0); delete copy._stampOffset;',
  '          const stamped = now + offset;',
  '          const done = copy.time && typeof copy.time.completed === "number";',
  '          copy.time = done ? { created: stamped, completed: stamped + 1 } : { created: stamped };',
  '          return copy;',
  '        });',
  '        send({ data: page, cursor: {} }); return;',
  '      }',
  '      if (req.method === "GET" && url.indexOf("/provider") >= 0) { send({ data: [] }); return; }',
  '      if (req.method === "GET" && url.indexOf("/api/session") === 0) { send({ id: "ses_live_1", location: { directory: spec.directory || "" } }); return; }',
  '      send({ ok: true });',
  '    };',
  '    if (isMessage && spec.send_error) { send({ error: spec.send_error }, 500); return; }',
  '    if (isMessage && spec.send_delay_ms) { setTimeout(finish, Number(spec.send_delay_ms)); return; }',
  '    finish();',
  '  });',
  '});',
  'server.listen(0, "127.0.0.1", () => { process.stdout.write("PORT " + server.address().port + "\\n"); });',
].join("\n");

interface LiveServer {
  base: string;
  requests: () => string[];
  times: () => number[];
  close: () => void;
}

async function startLiveServer(fakeRoot: string, spec: Record<string, unknown> = {}): Promise<LiveServer> {
  const logPath = join(fakeRoot, "live-requests.txt");
  const timePath = join(fakeRoot, "live-times.txt");
  const specPath = join(fakeRoot, "live-spec.json");
  const scriptPath = join(fakeRoot, "live-server.js");
  // Row 4.16 r5: a fixture that does not name a message page gets one native
  // completed answer. The one-deadline rule would otherwise wait the full
  // call timeout on an empty page. A case that wants an empty page passes
  // `messages: []` explicitly (the r4 F13 probe case).
  if (spec.messages === undefined) {
    spec = { ...spec, messages: [nativeAssistant('```json\n{"findings":[]}\n```\n')] };
  }
  writeFileSync(specPath, JSON.stringify(spec));
  writeFileSync(scriptPath, LIVE_SERVER_SOURCE);
  const server = spawn(process.execPath, [scriptPath], {
    env: { ...process.env, LIVE_LOG: logPath, LIVE_SPEC: specPath, LIVE_TIME_LOG: timePath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  startedServers.add(server);
  serverExits.add(new Promise<void>((done) => { server.once("close", () => done()); }));
  const port = await new Promise<number>((done, failed) => {
    let buffer = "";
    const timer = setTimeout(() => failed(new Error("the live server did not start")), 10_000);
    server.stdout.on("data", (chunk: Buffer) => {
      buffer += String(chunk);
      const m = /PORT (\d+)/.exec(buffer);
      if (m) { clearTimeout(timer); done(Number(m[1])); }
    });
    server.on("error", (e) => { clearTimeout(timer); failed(e); });
  });
  return {
    base: `http://127.0.0.1:${port}`,
    requests: () => existsSync(logPath)
      ? readFileSync(logPath, "utf8").split("\n").map((line) => line.trim()).filter((line) => line !== "")
      : [],
    times: () => !existsSync(timePath) ? [] : readFileSync(timePath, "utf8")
      .split("\n").map((line) => Number(line.trim().split(" ")[0]))
      .filter((value) => Number.isFinite(value) && value > 0),
    close: () => { try { server.kill("SIGKILL"); } catch { /* already gone */ } },
  };
}

/** One native assistant message of the OpenChamber message list (v2 shape).
 * The answer text sits in `content[]`. The token use sits beside it in the
 * top-level `tokens` field. Completion is `time.completed` and `finish`.
 * An optional `error` is the native structured model error (D22). */
function nativeAssistant(text: string, opts: {
  complete?: boolean;
  tokens?: unknown;
  error?: Record<string, unknown>;
  id?: string;
  created?: number;
  completed?: number;
  stampOffsetMs?: number;
} = {}): Record<string, unknown> {
  const half = Math.ceil(text.length / 2);
  const complete = opts.complete !== false;
  // Orchestrator 2026-11-21, option 1: a live message of the current call is
  // stamped when the fixture is built. The fixed past constant was not real
  // behavior and is rejected by the current-call rule. An explicit created
  // stays as given, so P4E-2 can still plant an old answer.
  const created = opts.created ?? Date.now();
  const record: Record<string, unknown> = {
    _stampAtRead: opts.created === undefined,
    _stampOffset: opts.stampOffsetMs ?? 0,
    id: opts.id ?? "msg_live_1",
    type: "assistant",
    model: { providerID: "opencode-go", id: "hy4-flash-free", variant: "high" },
    content: [
      { type: "text", text: text.slice(0, half) },
      { type: "text", text: text.slice(half) },
    ],
    time: complete
      ? { created, completed: opts.completed ?? created + 1 }
      : { created },
    tokens: opts.tokens ?? { input: 7, output: 8, reasoning: 9, cache: { read: 10, write: 11 } },
  };
  if (complete) record.finish = "stop";
  if (opts.error) record.error = opts.error;
  return record;
}

const PILOT_ROUTE = "opencode-go/hy4-flash-free#high";
const CLAUDE_ROUTE = "claude-agent/sonnet#high";
const HUNGERG_ROUTE = "opencode-go/hungerg-free";

/** A key with no plant makes one diff the control of a probe run. The runner
 * refuses a probe when the set holds no control diff. */
function writeProbeControl(fixture: Fixture): void {
  const keysDir = join(fixture.privateDir, "sets", fixture.setId, "keys");
  mkdirSync(keysDir, { recursive: true });
  for (const diff of fixture.diffs) {
    writeFileSync(
      join(keysDir, `${diff}.json`),
      `${JSON.stringify({
        schema: "model-guide-key/1",
        set_id: fixture.setId,
        diff_id: diff,
        plants: [],
      }, null, 2)}\n`,
    );
  }
}

describe("P4b row 4.16 the live-server path of the review runner", () => {
  it("L1 a pilot pass creates one session with the job root and the route provider, model, and variant", async () => {
    const fixture = await buildFixture({
      route: PILOT_ROUTE,
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}' }],
    });
    const live = await startLiveServer(fixture.fakeRoot);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture, PILOT_ROUTE), { BENCH_SERVER_BASE: live.base });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      const creates = live.requests().filter((line) => line.startsWith("POST /api/session "));
      expect(creates, "the live path created no session").toHaveLength(1);
      const body = JSON.parse(creates[0].slice("POST /api/session ".length));
      const directory = body.location && body.location.directory;
      expect(typeof directory, "the create carries no location.directory").toBe("string");
      expect(directory.startsWith("/"), "the session directory is not absolute").toBe(true);
      expect(directory.startsWith(fixture.repo), "the session directory is inside the git repo").toBe(false);
      expect(existsSync(directory), "the session directory is not a real folder").toBe(true);
      const model = body.model || {};
      expect(model.providerID, "the create carries no model providerID").toBe("opencode-go");
      expect(model.id, "the create carries no model id").toBe("hy4-flash-free");
      expect(model.variant, "the create carries no model variant").toBe("high");
    } finally {
      live.close();
      dropFixture(fixture);
    }
  }, 60_000);

  it("L2 a project config missing one deny refuses with exit 2 before any session create", async () => {
    const fixture = await buildFixture({
      route: PILOT_ROUTE,
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}' }],
    });
    const live = await startLiveServer(fixture.fakeRoot);
    const job = join(fixture.tmp, "preset-job");
    mkdirSync(job, { recursive: true });
    writeFileSync(
      join(job, "opencode.json"),
      JSON.stringify({ permission: {
        read: "deny", edit: "deny", bash: "deny", webfetch: "deny",
        websearch: "deny", question: "deny", subagent: "allow", skill: "deny",
      } }),
    );
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture, PILOT_ROUTE), {
        BENCH_SERVER_BASE: live.base,
        BENCH_OPENCODE_HOME: job,
      });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      expect(namedLines(result), "the runner printed no named line").toHaveLength(1);
      expect(
        live.requests().filter((line) => line.startsWith("POST /api/session ")),
        "a session was created on a refused deny",
      ).toEqual([]);
    } finally {
      live.close();
      dropFixture(fixture);
    }
  }, 60_000);

  it("L3 a pilot pass makes no auth export, no auth import, and no seed call", async () => {
    const fixture = await buildFixture({
      route: PILOT_ROUTE,
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}' }],
    });
    const live = await startLiveServer(fixture.fakeRoot);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture, PILOT_ROUTE), { BENCH_SERVER_BASE: live.base });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      const auth = logEntries(fixture.logPath).filter((entry) => /^auth (export|import)/.test(entry.argv));
      expect(auth.map((entry) => entry.argv), "the live path made a seed or auth call").toEqual([]);
      expect(
        live.requests().filter((line) => line.startsWith("POST /api/session ")),
        "the live path created no session",
      ).toHaveLength(1);
    } finally {
      live.close();
      dropFixture(fixture);
    }
  }, 60_000);

  it("L3 a pilot probe makes no auth export, no auth import, and no seed call", async () => {
    const fixture = await buildFixture({
      route: PILOT_ROUTE,
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}' }],
    });
    writeProbeControl(fixture);
    const live = await startLiveServer(fixture.fakeRoot);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, [...runArgs(fixture, PILOT_ROUTE), "--probe"], {
        BENCH_SERVER_BASE: live.base,
      });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      const auth = logEntries(fixture.logPath).filter((entry) => /^auth (export|import)/.test(entry.argv));
      expect(auth.map((entry) => entry.argv), "the live probe made a seed or auth call").toEqual([]);
      expect(
        live.requests().filter((line) => line.startsWith("POST /api/session ")),
        "the live probe created no session",
      ).toHaveLength(1);
    } finally {
      live.close();
      dropFixture(fixture);
    }
  }, 60_000);

  it("L4 the runner reads the answer text and native token fields of the assistant message", async () => {
    const answer = "```json\n{\"findings\":[]}\n```\n";
    const fixture = await buildFixture({
      route: PILOT_ROUTE,
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}' }],
    });
    const live = await startLiveServer(fixture.fakeRoot, {
      messages: [nativeAssistant(answer)],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture, PILOT_ROUTE), { BENCH_SERVER_BASE: live.base });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(
        live.requests().filter((line) => line.startsWith("POST /api/session ")),
        "the live path created no session",
      ).toHaveLength(1);
      const records = passRecords(fixture.privateDir);
      expect(records, "the runner wrote no pass record").toHaveLength(1);
      expect(records[0].tokens, "the token sums of the message parts").toEqual({
        input: 7, output: 8, reasoning: 9, cache_read: 10, cache_write: 11, total: 45,
      });
      expect(records[0].tokens_complete, "the call held a token part").toBe(true);
    } finally {
      live.close();
      dropFixture(fixture);
    }
  }, 60_000);

  it("L5 a message send past MG_CALL_TIMEOUT_S stops the call and writes no pass record", async () => {
    const fixture = await buildFixture({
      route: PILOT_ROUTE,
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}' }],
    });
    const live = await startLiveServer(fixture.fakeRoot, { send_delay_ms: 30_000 });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture, PILOT_ROUTE), {
        BENCH_SERVER_BASE: live.base,
        MG_CALL_TIMEOUT_S: "1",
      });
      expect(result.error, "the spawn hit the outer timeout").toBeUndefined();
      expect(
        namedLines(result).some((line) => line.startsWith("review-run:")),
        `the runner printed no fixed timeout text: ${result.stdout}`,
      ).toBe(true);
      expect(passRecords(fixture.privateDir), "the runner wrote a pass record after the timeout").toEqual([]);
    } finally {
      live.close();
      dropFixture(fixture);
    }
  }, 60_000);

  it("L6 a probe retries a transport error up to 3 calls and reports unreachable", async () => {
    const fixture = await buildFixture({
      route: PILOT_ROUTE,
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}' }],
    });
    writeProbeControl(fixture);
    const live = await startLiveServer(fixture.fakeRoot, { send_error: "transport failure" });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, [...runArgs(fixture, PILOT_ROUTE), "--probe"], {
        BENCH_SERVER_BASE: live.base,
      });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(3);
      const lines = stdoutLines(result);
      expect(lines, "the probe printed no line").toHaveLength(1);
      expect(lines[0], "the probe state is not unreachable").toContain("unreachable");
      const sends = live.requests().filter((line) => /^POST .*\/(message|prompt)/.test(line));
      expect(sends, "the probe did not make 3 send calls").toHaveLength(3);
    } finally {
      live.close();
      dropFixture(fixture);
    }
  }, 60_000);

  it("L6 a probe that fails once and then succeeds reports reachable with no error line", async () => {
    const fixture = await buildFixture({
      route: PILOT_ROUTE,
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}' }],
    });
    writeProbeControl(fixture);
    // The fake answers the first send with a transport error and the next one
    // normally. The spec counter lives in the server script below.
    const live = await startLiveServer(fixture.fakeRoot, { send_error: "transport failure", fail_sends: 1 });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, [...runArgs(fixture, PILOT_ROUTE), "--probe"], {
        BENCH_SERVER_BASE: live.base,
      });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const lines = stdoutLines(result);
      expect(lines, "the probe printed no line").toHaveLength(1);
      expect(lines[0], "the probe state is not reachable").toContain("reachable");
      const sends = live.requests().filter((line) => /^POST .*\/(message|prompt)/.test(line));
      expect(sends, "the probe did not retry on the live server").toHaveLength(2);
    } finally {
      live.close();
      dropFixture(fixture);
    }
  }, 60_000);

  it("L7 a pilot pass, probe, and judge path make no DELETE request", async () => {
    const fixture = await buildFixture({
      route: PILOT_ROUTE,
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}' }],
    });
    const live = await startLiveServer(fixture.fakeRoot);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture, PILOT_ROUTE), { BENCH_SERVER_BASE: live.base });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(
        live.requests().filter((line) => line.startsWith("POST /api/session ")),
        "the live path created no session",
      ).toHaveLength(1);
      expect(
        live.requests().filter((line) => line.startsWith("DELETE ")),
        "the live path made a DELETE request",
      ).toEqual([]);
    } finally {
      live.close();
      dropFixture(fixture);
    }
  }, 60_000);

  it("L8 a known key shape in a message part is refused and no value-list seam is called", async () => {
    const answer = `the answer holds ${SECRET}\n\`\`\`json\n{"findings":[]}\n\`\`\`\n`;
    const fixture = await buildFixture({
      route: PILOT_ROUTE,
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}' }],
    });
    const live = await startLiveServer(fixture.fakeRoot, {
      messages: [nativeAssistant(answer)],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture, PILOT_ROUTE), { BENCH_SERVER_BASE: live.base });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(
        live.requests().filter((line) => line.startsWith("POST /api/session ")),
        "the live path created no session",
      ).toHaveLength(1);
      expect(result.stdout, "the found key reached stdout").not.toContain(SECRET);
      const stored = filesHolding(fixture.privateDir, SECRET);
      expect(stored, "the found key was stored").toEqual([]);
      const scanValues = logEntries(fixture.logPath).filter((entry) => entry.argv.startsWith("scan-values"));
      expect(scanValues.map((entry) => entry.argv), "the live path called scan-values").toEqual([]);
    } finally {
      live.close();
      dropFixture(fixture);
    }
  }, 60_000);

  it("L9 the quota rules stay: wait makes no live call, ready makes one session", async () => {
    // Spec D15 (PM 2026-11-19): a Go route waits at 5h >= 95 % or weekly >=
    // 100 %. The non-Go 70 % boundary does not apply. L9-G of quota.test.ts
    // pins the Go rule, so the wait half of this case uses 95 %.
    const waited = await buildFixture({
      route: PILOT_ROUTE,
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}' }],
      quotaPercent: 95,
    });
    const liveWait = await startLiveServer(waited.fakeRoot);
    try {
      assertRunnerExists();
      const result = runRunner(waited, runArgs(waited, PILOT_ROUTE), { BENCH_SERVER_BASE: liveWait.base });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(quotaRequests(waited).length, "the runner read no quota before the wait").toBeGreaterThan(0);
      expect(
        liveWait.requests().filter((line) => line.startsWith("POST /api/session ")),
        "a wait state made a live session",
      ).toEqual([]);
    } finally {
      liveWait.close();
      dropFixture(waited);
    }

    const ready = await buildFixture({
      route: PILOT_ROUTE,
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}' }],
      quotaPercent: 10,
    });
    const liveReady = await startLiveServer(ready.fakeRoot);
    try {
      const result = runRunner(ready, runArgs(ready, PILOT_ROUTE), { BENCH_SERVER_BASE: liveReady.base });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(quotaRequests(ready).length, "the runner read no quota through BENCH_QUOTA_BASE").toBeGreaterThan(0);
      expect(
        liveReady.requests().filter((line) => line.startsWith("POST /api/session ")),
        "a ready state made no live session",
      ).toHaveLength(1);
    } finally {
      liveReady.close();
      dropFixture(ready);
    }
  }, 60_000);

  it("L10 the probe prints the state line and keeps the exit codes on the live path", async () => {
    const ok = await buildFixture({
      route: PILOT_ROUTE,
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}' }],
    });
    writeProbeControl(ok);
    const liveOk = await startLiveServer(ok.fakeRoot);
    try {
      assertRunnerExists();
      const result = runRunner(ok, [...runArgs(ok, PILOT_ROUTE), "--probe"], { BENCH_SERVER_BASE: liveOk.base });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const lines = stdoutLines(result);
      expect(lines, "the probe printed no line").toHaveLength(1);
      expect(lines[0], `${PILOT_ROUTE} does not head the probe line`).toContain(`${PILOT_ROUTE} reachable`);
      expect(
        liveOk.requests().filter((line) => line.startsWith("POST /api/session ")),
        "the reachable probe created no live session",
      ).toHaveLength(1);
    } finally {
      liveOk.close();
      dropFixture(ok);
    }

    const refused = await buildFixture({
      route: PILOT_ROUTE,
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}' }],
    });
    const liveRefused = await startLiveServer(refused.fakeRoot);
    try {
      const result = runRunner(refused, ["--route", METERED_ROUTE, "--set", refused.setId, "--private", refused.privateDir, "--probe"], {
        BENCH_SERVER_BASE: liveRefused.base,
      });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      expect(namedLines(result), "the refusal printed no named line").toHaveLength(1);
    } finally {
      liveRefused.close();
      dropFixture(refused);
    }
  }, 60_000);

});

// ---------------------------------------------------------------------------
// Row 4.16 r3: the real OpenChamber API shapes (Review A 31fe9a0, F12 to F19).
// The fake now creates sessions with location.directory, returns a native
// assistant message with top-level tokens and time.completed, and can queue
// an answer, fail a message GET, or return a native model error. Every case
// below fails at the role base because review-run.sh uses the old shapes.
// ---------------------------------------------------------------------------
describe("P4b row 4.16r3 the real API contract of the review runner", () => {
  const ANSWER = "```json\n{\"findings\":[]}\n```\n";

  /** A curl stub for the no-base case. It records each URL and returns a
   * synthetic session. No request leaves the test folder. */
  function writeCurlStub(fixture: Fixture): { dir: string; log: string } {
    const dir = join(fixture.fakeRoot, "curlbin");
    const log = join(fixture.fakeRoot, "curl-log.txt");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "curl"), [
      "#!/usr/bin/env bash",
      `printf '%s\\n' "$*" >> '${log}'`,
      "out=\"\"; prev=\"\"",
      "for a in \"$@\"; do if [ \"$prev\" = \"-o\" ]; then out=\"$a\"; fi; prev=\"$a\"; done",
      "[ -n \"$out\" ] && printf '%s\\n' '{\"id\":\"ses_default\",\"location\":{\"directory\":\"/tmp/opencode-live-default\"}}' > \"$out\"",
      "printf '200\\n'",
    ].join("\n"), { mode: 0o755 });
    return { dir, log };
  }

  it("F12 a session whose returned location is not the job root is refused before the pass", async () => {
    const fixture = await buildFixture({
      route: PILOT_ROUTE, diffs: ["d-01"], calls: [{ value: '{"findings":[]}' }],
    });
    const live = await startLiveServer(fixture.fakeRoot, {
      messages: [nativeAssistant(ANSWER)],
      session_location: "/tmp/foreign-job-root",
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture, PILOT_ROUTE), { BENCH_SERVER_BASE: live.base });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      expect(namedLines(result), "the runner printed no named line").toHaveLength(1);
      expect(passRecords(fixture.privateDir), "the runner wrote a pass record").toEqual([]);
    } finally {
      live.close();
      dropFixture(fixture);
    }
  }, 60_000);

  it("F13 a queued answer that completes later passes and a partial answer at the deadline does not", async () => {
    const queued = await buildFixture({
      route: PILOT_ROUTE, diffs: ["d-01"], calls: [{ value: '{"findings":[]}' }],
    });
    const liveQueued = await startLiveServer(queued.fakeRoot, {
      messages: [nativeAssistant(ANSWER)], queue_delay_ms: 3000,
    });
    try {
      assertRunnerExists();
      const result = runRunner(queued, runArgs(queued, PILOT_ROUTE), {
        BENCH_SERVER_BASE: liveQueued.base,
        MG_CALL_TIMEOUT_S: "12",
      });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const records = passRecords(queued.privateDir);
      expect(records, "the queued pass wrote no record").toHaveLength(1);
      expect(records[0].state, "the completed answer was not complete").toBe("complete");
    } finally {
      liveQueued.close();
      dropFixture(queued);
    }

    const partial = await buildFixture({
      route: PILOT_ROUTE, diffs: ["d-01"], calls: [{ value: '{"findings":[]}' }],
    });
    const livePartial = await startLiveServer(partial.fakeRoot, {
      messages: [nativeAssistant("partial without completion", { complete: false })],
    });
    try {
      const result = runRunner(partial, runArgs(partial, PILOT_ROUTE), {
        BENCH_SERVER_BASE: livePartial.base,
        MG_CALL_TIMEOUT_S: "1",
      });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(namedLines(result).join("\n"), "the partial answer got no timeout text").toMatch(/timed out|not complete|incomplete/);
      const records = passRecords(partial.privateDir);
      expect(records.length > 0 && records[0].state === "complete", "the partial answer was complete").toBe(false);
    } finally {
      livePartial.close();
      dropFixture(partial);
    }
  }, 120_000);

  it("F15 a pilot route with no base uses the default loopback base and never the isolated seed", async () => {
    const fixture = await buildFixture({
      route: PILOT_ROUTE, diffs: ["d-01"], calls: [{ value: '{"findings":[]}' }],
    });
    const stub = writeCurlStub(fixture);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture, PILOT_ROUTE), {
        BENCH_SERVER_BASE: "",
        PATH: `${stub.dir}:${fixture.fakeDir}:${join(HARNESS, "node_modules", ".bin")}:${process.env.PATH ?? ""}`,
      });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      const auth = logEntries(fixture.logPath).filter((entry) => /^auth (export|import)/.test(entry.argv));
      expect(auth.map((entry) => entry.argv), "the no-base pilot used the isolated seed").toEqual([]);
      const urls = existsSync(stub.log) ? readFileSync(stub.log, "utf8") : "";
      expect(urls, "the default loopback base was not used").toContain("http://127.0.0.1:38307");
    } finally {
      dropFixture(fixture);
    }
  }, 60_000);

  it("F15 the Claude Agent route uses the live-server path and the Claude quota source", async () => {
    const fixture = await buildFixture({
      route: CLAUDE_ROUTE,
      quotaProvider: "claude-agent",
      quotaSource: "claude",
      diffs: ["d-01"],
      calls: [{ value: '{"findings":[]}' }],
    });
    const live = await startLiveServer(fixture.fakeRoot);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture, CLAUDE_ROUTE), {
        BENCH_SERVER_BASE: live.base,
      });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const auth = logEntries(fixture.logPath).filter((entry) => /^auth (export|import)/.test(entry.argv));
      expect(auth.map((entry) => entry.argv), "the Claude route used the isolated seed").toEqual([]);
      expect(modelCalls(logEntries(fixture.logPath)), "the Claude route used the isolated model call").toEqual([]);
      expect(quotaRequests(fixture), "the Claude route read no Claude quota").toContain("/api/quota/claude");
      const creates = live.requests().filter((line) => line.startsWith("POST /api/session "));
      expect(creates, "the Claude route made no live session").toHaveLength(1);
      const body = JSON.parse(creates[0].slice("POST /api/session ".length));
      expect(body.model?.providerID, "the Claude provider").toBe("claude-agent");
      expect(body.model?.id, "the Claude model").toBe("sonnet");
      expect(body.model?.variant, "the Claude variant").toBe("high");
      const records = passRecords(fixture.privateDir);
      expect(records, "the Claude route wrote no pass record").toHaveLength(1);
      expect(records[0].state, "the Claude pass is not complete").toBe("complete");
    } finally {
      live.close();
      dropFixture(fixture);
    }
  }, 60_000);

  it("F15 the Hungerg route uses the live-server path and never the isolated seed", async () => {
    const fixture = await buildFixture({
      route: HUNGERG_ROUTE, diffs: ["d-01"], calls: [{ value: '{"findings":[]}' }],
    });
    const live = await startLiveServer(fixture.fakeRoot);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture, HUNGERG_ROUTE), {
        BENCH_SERVER_BASE: live.base,
      });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const auth = logEntries(fixture.logPath).filter((entry) => /^auth (export|import)/.test(entry.argv));
      expect(auth.map((entry) => entry.argv), "the Hungerg route used the isolated seed").toEqual([]);
      expect(modelCalls(logEntries(fixture.logPath)), "the Hungerg route used the isolated model call").toEqual([]);
      const requests = live.requests().join("\n");
      expect(requests, "the Hungerg route made no live session").toContain("POST /api/session ");
      expect(requests, "the Hungerg route sent no live prompt").toContain("POST /api/session/ses_live_1/prompt ");
      const records = passRecords(fixture.privateDir);
      expect(records, "the Hungerg route wrote no pass record").toHaveLength(1);
      expect(records[0].state, "the Hungerg pass is not complete").toBe("complete");
    } finally {
      live.close();
      dropFixture(fixture);
    }
  }, 60_000);

  it("F16 a failed message GET leaves the pass not complete", async () => {
    const fixture = await buildFixture({
      route: PILOT_ROUTE, diffs: ["d-01"], calls: [{ value: '{"findings":[]}' }],
    });
    const live = await startLiveServer(fixture.fakeRoot, {
      messages: [nativeAssistant(ANSWER)], get_fail: true,
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture, PILOT_ROUTE), { BENCH_SERVER_BASE: live.base });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      const records = passRecords(fixture.privateDir);
      expect(records.length > 0 && records[0].state === "complete", "a failed GET became a complete pass").toBe(false);
    } finally {
      live.close();
      dropFixture(fixture);
    }
  }, 60_000);

  it("F16 a failed message GET makes the probe unreachable", async () => {
    const fixture = await buildFixture({
      route: PILOT_ROUTE, diffs: ["d-01"], calls: [{ value: '{"findings":[]}' }],
    });
    writeProbeControl(fixture);
    const live = await startLiveServer(fixture.fakeRoot, {
      messages: [nativeAssistant(ANSWER)], get_fail: true,
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, [...runArgs(fixture, PILOT_ROUTE), "--probe"], { BENCH_SERVER_BASE: live.base });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(stdoutLines(result).join("\n"), "a failed GET was reachable").toContain("unreachable");
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(3);
    } finally {
      live.close();
      dropFixture(fixture);
    }
  }, 60_000);

  it("F17 a native region error on a Go probe is region-blocked, not reachable", async () => {
    const fixture = await buildFixture({
      route: PILOT_ROUTE, diffs: ["d-01"], calls: [{ value: '{"findings":[]}' }],
    });
    writeProbeControl(fixture);
    const live = await startLiveServer(fixture.fakeRoot, {
      messages: [nativeAssistant("", {
        complete: false,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        error: { type: "ProviderAuthError", message: REGION_ERROR },
      })],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, [...runArgs(fixture, PILOT_ROUTE), "--probe"], { BENCH_SERVER_BASE: live.base });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(stdoutLines(result).join("\n"), "the native region error was not classified").toContain("region-blocked");
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(3);
    } finally {
      live.close();
      dropFixture(fixture);
    }
  }, 60_000);

  it("F18 a server base with userinfo for an external host is refused with no request", async () => {
    const fixture = await buildFixture({
      route: PILOT_ROUTE, diffs: ["d-01"], calls: [{ value: '{"findings":[]}' }],
    });
    const live = await startLiveServer(fixture.fakeRoot, {
      messages: [nativeAssistant(ANSWER)],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture, PILOT_ROUTE), {
        BENCH_SERVER_BASE: "http://127.0.0.1:38307@example.invalid",
        MG_CALL_TIMEOUT_S: "1",
      });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      expect(namedLines(result), "the runner printed no named line").toHaveLength(1);
      expect(live.requests(), "a request reached the fake server").toEqual([]);
    } finally {
      live.close();
      dropFixture(fixture);
    }
  }, 60_000);

  it("F19 L2 a missing config is refused, an unreadable config is refused, and no session is created", async () => {
    const missing = await buildFixture({
      route: PILOT_ROUTE, diffs: ["d-01"], calls: [{ value: '{"findings":[]}' }],
    });
    const missingLive = await startLiveServer(missing.fakeRoot, { messages: [nativeAssistant(ANSWER)] });
    const missingJob = join(missing.tmp, "missing-job");
    mkdirSync(missingJob, { recursive: true });
    try {
      assertRunnerExists();
      const result = runRunner(missing, runArgs(missing, PILOT_ROUTE), {
        BENCH_SERVER_BASE: missingLive.base,
        BENCH_OPENCODE_HOME: missingJob,
      });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      expect(namedLines(result), "the runner printed no named line").toHaveLength(1);
      expect(
        missingLive.requests().filter((line) => line.startsWith("POST /api/session ")),
        "a session was created on a missing config",
      ).toEqual([]);
    } finally {
      missingLive.close();
      dropFixture(missing);
    }

    const unreadable = await buildFixture({
      route: PILOT_ROUTE, diffs: ["d-01"], calls: [{ value: '{"findings":[]}' }],
    });
    const unreadableLive = await startLiveServer(unreadable.fakeRoot, { messages: [nativeAssistant(ANSWER)] });
    const unreadableJob = join(unreadable.tmp, "unreadable-job");
    mkdirSync(unreadableJob, { recursive: true });
    writeFileSync(join(unreadableJob, "opencode.json"), "{}\n", { mode: 0o000 });
    try {
      const result = runRunner(unreadable, runArgs(unreadable, PILOT_ROUTE), {
        BENCH_SERVER_BASE: unreadableLive.base,
        BENCH_OPENCODE_HOME: unreadableJob,
      });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      expect(namedLines(result), "the runner printed no named line").toHaveLength(1);
    } finally {
      unreadableLive.close();
      dropFixture(unreadable);
    }
  }, 120_000);

  it("F19 L5 a send timeout prints the exact fixed text and exits 2", async () => {
    const fixture = await buildFixture({
      route: PILOT_ROUTE, diffs: ["d-01"], calls: [{ value: '{"findings":[]}' }],
    });
    const live = await startLiveServer(fixture.fakeRoot, { send_delay_ms: 30_000 });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture, PILOT_ROUTE), {
        BENCH_SERVER_BASE: live.base,
        MG_CALL_TIMEOUT_S: "1",
      });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      expect(result.stdout, "the exact timeout text is absent").toBe("review-run: the message send timed out\n");
    } finally {
      live.close();
      dropFixture(fixture);
    }
  }, 60_000);

  it("F19 L7 a pilot probe makes no DELETE request", async () => {
    const fixture = await buildFixture({
      route: PILOT_ROUTE, diffs: ["d-01"], calls: [{ value: '{"findings":[]}' }],
    });
    writeProbeControl(fixture);
    const live = await startLiveServer(fixture.fakeRoot, { messages: [nativeAssistant(ANSWER)] });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, [...runArgs(fixture, PILOT_ROUTE), "--probe"], { BENCH_SERVER_BASE: live.base });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(
        live.requests().filter((line) => line.startsWith("POST /api/session ")),
        "the probe created no session",
      ).toHaveLength(1);
      expect(live.requests().filter((line) => line.startsWith("DELETE ")), "the probe made a DELETE").toEqual([]);
    } finally {
      live.close();
      dropFixture(fixture);
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Row 4.16 r4 (Review A 5f01ef9): one deadline from call entry, a fail-closed
// unset base, and the newest terminal answer of a newest-first page. Each case
// fails at the role base because review-run.sh uses a short empty window,
// falls back to the isolated seed on an unset base, and picks the oldest
// assistant of the page.
// ---------------------------------------------------------------------------
describe("P4b row 4.16r4 deadline, unset base, and newest answer", () => {
  const FINAL = "```json\n{\"findings\":[]}\n```\n";
  const EARLY = "```json\n{\"findings\":[{\"early\":true}]}\n```\n";
  const BIG_TOKENS = { input: 7, output: 8, reasoning: 9, cache: { read: 10, write: 11 } };
  const SMALL_TOKENS = { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } };

  it("F13 a queued answer that completes at 11 s is accepted inside a 30 s deadline", async () => {
    const fixture = await buildFixture({
      route: PILOT_ROUTE, diffs: ["d-01"], calls: [{ value: '{"findings":[]}' }],
    });
    const live = await startLiveServer(fixture.fakeRoot, {
      messages: [nativeAssistant(FINAL)], queue_delay_ms: 11_000,
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture, PILOT_ROUTE), {
        BENCH_SERVER_BASE: live.base,
        MG_CALL_TIMEOUT_S: "30",
      });
      expect(result.error, "the spawn hit the outer timeout").toBeUndefined();
      const records = passRecords(fixture.privateDir);
      expect(records, "the pass inside the deadline wrote no record").toHaveLength(1);
      expect(records[0].state, "the answer inside the deadline was not complete").toBe("complete");
    } finally {
      live.close();
      dropFixture(fixture);
    }
  }, 90_000);

  it("F13 a completion after the deadline is refused with the timeout text", async () => {
    const fixture = await buildFixture({
      route: PILOT_ROUTE, diffs: ["d-01"], calls: [{ value: '{"findings":[]}' }],
    });
    const live = await startLiveServer(fixture.fakeRoot, {
      messages: [nativeAssistant(FINAL)], queue_delay_ms: 6000,
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture, PILOT_ROUTE), {
        BENCH_SERVER_BASE: live.base,
        MG_CALL_TIMEOUT_S: "1",
      });
      expect(result.error, "the spawn hit the outer timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      expect(result.stdout, "the deadline text is absent").toMatch(/timed out|deadline|did not complete/);
      expect(passRecords(fixture.privateDir), "a late answer wrote a pass record").toEqual([]);
    } finally {
      live.close();
      dropFixture(fixture);
    }
  }, 60_000);

  it("F13 an empty probe answer is not reachable", async () => {
    const fixture = await buildFixture({
      route: PILOT_ROUTE, diffs: ["d-01"], calls: [{ value: '{"findings":[]}' }],
    });
    writeProbeControl(fixture);
    const live = await startLiveServer(fixture.fakeRoot, { messages: [] });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, [...runArgs(fixture, PILOT_ROUTE), "--probe"], {
        BENCH_SERVER_BASE: live.base,
        MG_CALL_TIMEOUT_S: "2",
      });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(stdoutLines(result).join("\n"), "an empty answer was reachable").toContain("unreachable");
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(3);
    } finally {
      live.close();
      dropFixture(fixture);
    }
  }, 60_000);

  it("F15 an unset base on a pilot route refuses with exit 2, one named line, and no seed call", async () => {
    const fixture = await buildFixture({
      route: PILOT_ROUTE, diffs: ["d-01"], calls: [{ value: '{"findings":[]}' }],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture, PILOT_ROUTE), {
        MG_UNSET_SERVER_BASE: "1",
      });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      const named = namedLines(result);
      expect(named, "the runner printed no named line").toHaveLength(1);
      expect(named[0], "the refusal is not a review-run line").toMatch(/^review-run:/);
      const auth = logEntries(fixture.logPath).filter((entry) => /^auth (export|import)/.test(entry.argv));
      expect(auth.map((entry) => entry.argv), "the unset pilot used the isolated seed").toEqual([]);
      expect(modelCalls(logEntries(fixture.logPath)), "the runner made a model call").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  }, 60_000);

  it("F20 the newest terminal answer wins and current-call tokens are summed", async () => {
    const fixture = await buildFixture({
      route: PILOT_ROUTE, diffs: ["d-01"], calls: [{ value: '{"findings":[]}' }],
    });
    const live = await startLiveServer(fixture.fakeRoot, {
      messages: [
        nativeAssistant(FINAL, { id: "msg_final", tokens: BIG_TOKENS }),
        nativeAssistant(EARLY, { id: "msg_early", tokens: SMALL_TOKENS }),
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture, PILOT_ROUTE), { BENCH_SERVER_BASE: live.base });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      const records = passRecords(fixture.privateDir);
      expect(records, "the pass wrote no record").toHaveLength(1);
      const outputsDir = join(fixture.privateDir, "outputs");
      const stored = filesUnder(outputsDir).filter((file) => file.endsWith(".txt") || file.endsWith(".out"));
      const allStored = stored.map((file) => readFileSync(file, "utf8")).join("\n");
      expect(allStored, "the stored answer is not the newest one").toContain('"findings":[]');
      expect(allStored, "the stored answer is the older one").not.toContain('"early":true');
      expect(records[0].tokens, "the current-call token bundles were not summed").toEqual({
        input: 8, output: 10, reasoning: 9, cache_read: 10, cache_write: 11, total: 48,
      });
    } finally {
      live.close();
      dropFixture(fixture);
    }
  }, 60_000);

  it("F20 an older partial answer does not hide a newer final answer", async () => {
    const fixture = await buildFixture({
      route: PILOT_ROUTE, diffs: ["d-01"], calls: [{ value: '{"findings":[]}' }],
    });
    const live = await startLiveServer(fixture.fakeRoot, {
      messages: [
        nativeAssistant(FINAL, { id: "msg_final", tokens: BIG_TOKENS }),
        nativeAssistant("partial without completion", {
          id: "msg_partial", complete: false, tokens: SMALL_TOKENS,
        }),
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture, PILOT_ROUTE), {
        BENCH_SERVER_BASE: live.base,
        MG_CALL_TIMEOUT_S: "10",
      });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      const records = passRecords(fixture.privateDir);
      expect(records, "the newer final answer did not complete the pass").toHaveLength(1);
      expect(records.length > 0 && records[0].state === "complete", "the newer final answer was not complete").toBe(true);
      expect(records[0].tokens, "the current-call token bundles were not summed").toEqual({
        input: 8, output: 10, reasoning: 9, cache_read: 10, cache_write: 11, total: 48,
      });
    } finally {
      live.close();
      dropFixture(fixture);
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Row 4.16 r6 (Review A a87c29c): expiry at the first GET after the deadline,
// and a newest partial that must block an older terminal answer. Both runners
// share the live selector. Each case fails at the role base.
// ---------------------------------------------------------------------------
describe("P4b row 4.16r6 deadline expiry and newest partial in the review runner", () => {
  const FINAL = "```json\n{\"findings\":[]}\n```\n";
  const EARLY = "```json\n{\"findings\":[{\"early\":true}]}\n```\n";

  it("F13 an answer due at 1.5 s is refused under a 1 s deadline, with no request after expiry", async () => {
    const fixture = await buildFixture({
      route: PILOT_ROUTE, diffs: ["d-01"], calls: [{ value: '{"findings":[]}' }],
    });
    const live = await startLiveServer(fixture.fakeRoot, {
      messages: [nativeAssistant(FINAL)], queue_delay_ms: 1500,
    });
    try {
      assertRunnerExists();
      const started = Date.now();
      const result = runRunner(fixture, runArgs(fixture, PILOT_ROUTE), {
        BENCH_SERVER_BASE: live.base,
        MG_CALL_TIMEOUT_S: "1",
      });
      expect(result.error, "the spawn hit the outer timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      expect(result.stdout, "the deadline text is absent").toMatch(/timed out|did not complete|deadline/);
      expect(passRecords(fixture.privateDir), "a late answer wrote a pass record").toEqual([]);
      const late = live.times().filter((time) => time > started + 1500);
      expect(late, "a request started after the deadline").toEqual([]);
    } finally {
      live.close();
      dropFixture(fixture);
    }
  }, 60_000);

  it("F20 a newest partial answer blocks an older completed answer", async () => {
    const fixture = await buildFixture({
      route: PILOT_ROUTE, diffs: ["d-01"], calls: [{ value: '{"findings":[]}' }],
    });
    const live = await startLiveServer(fixture.fakeRoot, {
      messages: [
        nativeAssistant("partial without completion", {
          id: "msg_new_partial", complete: false,
        }),
        nativeAssistant(EARLY, { id: "msg_early", stampOffsetMs: -1000 }),
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture, PILOT_ROUTE), {
        BENCH_SERVER_BASE: live.base,
        MG_CALL_TIMEOUT_S: "1",
      });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      const records = passRecords(fixture.privateDir);
      expect(
        records.length > 0 && records[0].state === "complete",
        "the older completed answer was accepted behind a newer partial",
      ).toBe(false);
    } finally {
      live.close();
      dropFixture(fixture);
    }
  }, 60_000);
});
