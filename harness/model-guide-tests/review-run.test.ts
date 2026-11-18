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

const ROUTE = "opencode-go/muse-spark-1.3-contributor#high";
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
  it("R10 stores a 2 MiB raw output whole", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [{ stdout_bytes: TWO_MIB, value: "TAIL-MARKER" }],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const stored = filesHolding(fixture.privateDir, "TAIL-MARKER");
      expect(stored, "the runner stored no raw output").toHaveLength(1);
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
  });
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
  });
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

  it("J1 the committed routes.json holds none of the three removed routes and holds the pilot routes", () => {
    const file = join(HARNESS, "model-guide", "routes.json");
    expect(existsSync(file), `routes.json is missing: ${file}`).toBe(true);
    const doc = JSON.parse(readFileSync(file, "utf8"));
    const rows = Array.isArray(doc) ? doc : (doc.routes ?? []);
    const routes = rows.map((row: { route?: unknown }) => row.route);
    const gone = [
      "kimi-code-plan-cn/kimi-for-coding#high",
      "bailian-token-plan/glm-5.3#high",
      "nvidia/stepfun-ai/step-5-preview#high",
    ];
    for (const route of gone) {
      expect(routes, `${route} must leave routes.json (spec D12, PM 2026-11-18)`).not.toContain(
        route,
      );
    }
    const kept = [
      "opencode/hy4-flash-free",
      "opencode-go/deepseek-v4.1-flash",
      "opencode-go/mimo-v2.6-flash",
    ];
    for (const route of kept) {
      expect(routes, `${route} must stay in routes.json`).toContain(route);
    }
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
