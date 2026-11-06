import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The trap test of FR-8.
 *
 * The fake `opencode` starts a detached child for each `models` call. The
 * child stands for `serve --service`. Its command line holds the text
 * `fake-opencode`. The test also starts a decoy process without a marker.
 * The decoy stands for the OpenChamber server.
 *
 * The test copies the scripts that it runs into a temp repo. The temp repo is
 * the `$ROOT` of every script. No test writes under the real `.tmp/`, `runs/`,
 * or `reports/`. No test starts the real `opencode` binary, Podman, a
 * browser, or a model.
 */

const HARNESS = resolve(import.meta.dirname, "..");
const TIMEOUT = 120_000;
const MODEL = "fake-model";
const MODEL_REF = `opencode-go/${MODEL}`;

/** The scripts that the test copies into the temp repo. */
const SCRIPTS = [
  "cron-daily.sh", "env.sh", "toolchain.sh", "opencode-credential.sh",
  "opencode-host.sh",
];

type Fixture = {
  root: string;
  repo: string;
  harness: string;
  bin: string;
  sharedHome: string;
  childPid: string;
  sweepPid: string;
  readyFile: string;
};

type Active = { root: string; pids: number[]; pidFiles: string[] };

let current: Active | undefined;

afterEach(() => {
  const active = current;
  current = undefined;
  if (!active) return;
  for (const file of active.pidFiles) {
    const pid = readPid(file);
    if (pid) kill(pid);
  }
  for (const pid of active.pids) kill(pid);
  rmSync(active.root, { recursive: true, force: true });
});

function kill(pid: number): void {
  try { process.kill(pid, "SIGKILL"); } catch { /* the process is gone */ }
}

/** The fake `opencode`. The models call starts a detached child. */
function fakeOpencode(bin: string): string {
  const path = join(bin, "opencode");
  writeFileSync(path, `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path");
const argv = process.argv.slice(2);
const home = process.env.HOME || "";
const data = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
if (process.env.FAKE_OPENCODE_RECORD) {
  fs.appendFileSync(process.env.FAKE_OPENCODE_RECORD, JSON.stringify({
    argv, HOME: home, XDG_DATA_HOME: process.env.XDG_DATA_HOME || "",
    XDG_STATE_HOME: process.env.XDG_STATE_HOME || "",
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || "",
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || "",
    TMPDIR: process.env.TMPDIR || "",
    opencode_db: Object.prototype.hasOwnProperty.call(process.env, "OPENCODE_DB") }) + "\\n");
}
const store = path.join(data, "opencode", "fake-auth.json");
const has = (flag) => argv.includes(flag);
if (has("--version")) { console.log("opencode v2.2.4"); process.exit(0); }
if (has("models")) {
  console.log("${MODEL_REF}");
  // The detached child stands for the background service of OpenCode.
  if (process.env.FAKE_OPENCODE_CHILD_SCRIPT && process.env.FAKE_OPENCODE_CHILD_PID) {
    const child = require("node:child_process").spawn("setsid",
      [process.env.FAKE_OPENCODE_CHILD_SCRIPT, process.env.FAKE_OPENCODE_CHILD_PID],
      { stdio: "ignore", env: process.env });
    child.unref();
  }
  process.exit(0);
}
if (argv[0] === "auth") {
  if (has("export")) {
    if (!fs.existsSync(store)) process.exit(1);
    process.stdout.write(fs.readFileSync(store, "utf8"));
    process.exit(0);
  }
  if (has("import")) {
    fs.mkdirSync(path.dirname(store), { recursive: true });
    fs.writeFileSync(store, fs.readFileSync(0));
    console.log("Imported 1 credential");
    process.exit(0);
  }
}
process.exit(96);
`);
  chmodSync(path, 0o755);
  return path;
}

/** The detached child of the fake models call. It runs for 600 s. */
function childScript(bin: string): string {
  const sleeper = join(bin, "fake-opencode-sleep");
  copyFileSync("/bin/sleep", sleeper);
  chmodSync(sleeper, 0o755);
  const path = join(bin, "fake-opencode-serve");
  writeFileSync(path, `#!/usr/bin/env bash
# fake-opencode serve
printf '%s\\n' "$$" > "$1"
exec ${sleeper} 600
`);
  chmodSync(path, 0o755);
  return path;
}

/** The decoy process. It has no marker and it must stay alive. */
function decoyScript(bin: string): string {
  // The command line of the decoy holds no text `fake-opencode`.
  const sleeper = join(bin, "decoy-sleep");
  copyFileSync("/bin/sleep", sleeper);
  chmodSync(sleeper, 0o755);
  const path = join(bin, "decoy-process");
  writeFileSync(path, `#!/usr/bin/env bash
# decoy process without a marker
exec ${sleeper} 600
`);
  chmodSync(path, 0o755);
  return path;
}

/** A shell stub of the test seam. */
function shellStub(bin: string, name: string, body: string): string {
  const path = join(bin, name);
  writeFileSync(path, `#!/usr/bin/env bash
# fake-${name}
${body}
`);
  chmodSync(path, 0o755);
  return path;
}

/** The temp repo of one case. */
function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "opencode-host-trap-"));
  const repo = join(root, "repo");
  const harness = join(repo, "harness");
  const bin = join(root, "bin");
  const sharedHome = join(root, "shared-home");
  mkdirSync(join(harness, "node_modules", ".bin"), { recursive: true });
  mkdirSync(join(repo, "reports"), { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(sharedHome, ".local", "share", "opencode"), { recursive: true });
  mkdirSync(join(root, "tmp"), { recursive: true });
  for (const name of SCRIPTS) {
    const source = join(HARNESS, name);
    if (!existsSync(source)) continue;
    writeFileSync(join(harness, name), readFileSync(source), { mode: 0o755 });
    chmodSync(join(harness, name), 0o755);
  }
  writeFileSync(join(sharedHome, ".local", "share", "opencode", "fake-auth.json"), JSON.stringify([{
    id: "fake-console-1", integrationID: "opencode", label: "Fake Console", active: true,
    value: {
      type: "oauth", methodID: "device", access: "fake-access", refresh: "fake-refresh",
      expires: 4102444800000, metadata: { orgID: "fake-org", server: "https://opencode.ai/console" },
    },
  }]) + "\n");
  writeFileSync(join(root, "catalog.json"), JSON.stringify({ live: [MODEL_REF] }) + "\n");
  writeFileSync(join(root, "pricing.json"), JSON.stringify({ provider: "opencode-go", models: { [MODEL]: {} } }) + "\n");
  fakeOpencode(bin);
  const script = childScript(bin);
  decoyScript(bin);
  shellStub(bin, "quota", `printf '{"usage":{"windows":{"weekly":{"usedPercent":10},"monthly":{"usedPercent":20}}}}\\n'`);
  shellStub(bin, "quota-wait", `printf 'ready\\n' > "$FAKE_READY_FILE"\nsleep 30`);
  shellStub(bin, "select", `printf '{"model":"${MODEL_REF}","run_ids":[],"reason":"new"}\\n'`);
  shellStub(bin, "batch", `printf '[1/1] DRY-RUN START ${MODEL}\\n'`);
  return {
    root, repo, harness, bin, sharedHome,
    childPid: join(root, "child.pid"), sweepPid: join(root, "sweep.pid"),
    readyFile: join(root, "ready"),
  };
}

/** The environment of one case. It holds no XDG variable and no OPENCODE_DB. */
function testEnv(f: Fixture, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: `${f.bin}:${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
    HOME: f.sharedHome,
    LANG: "C.UTF-8",
    TMPDIR: join(f.root, "tmp"),
    USER: process.env.USER ?? "tester",
    LOGNAME: process.env.LOGNAME ?? "tester",
    BENCH_OPENCODE_BIN: join(f.bin, "opencode"),
    FAKE_OPENCODE_RECORD: join(f.root, "calls.jsonl"),
    FAKE_OPENCODE_CHILD_SCRIPT: join(f.bin, "fake-opencode-serve"),
    FAKE_OPENCODE_CHILD_PID: f.childPid,
    BENCH_DAILY_CATALOG: join(f.root, "catalog.json"),
    BENCH_DAILY_QUOTA_CMD: join(f.bin, "quota"),
    BENCH_DAILY_BATCH: join(f.bin, "batch"),
    BENCH_DAILY_SELECT: join(f.bin, "select"),
    BENCH_DAILY_LOCK: join(f.root, "daily.lock"),
    BENCH_DAILY_DIR: join(f.root, "daily"),
    BENCH_RUNS_ROOT: join(f.root, "runs"),
    BENCH_DAILY_PUBLISH: "0",
    BENCH_PRICING_PATH: join(f.root, "pricing.json"),
    ...extra,
  };
}

function readPid(path: string): number {
  if (!existsSync(path)) return 0;
  const pid = Number(readFileSync(path, "utf8").trim());
  return Number.isInteger(pid) && pid > 0 ? pid : 0;
}

/** A zombie process is dead. */
function processAlive(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    const state = stat.slice(close + 2, close + 3);
    return state !== "Z" && state !== "X";
  } catch {
    return false;
  }
}

/** The job folder of the daily job. The line comes from spec D8. */
function jobFolder(output: string): string {
  const line = output.split(/\r?\n/).find((entry) => entry.startsWith("DAILY OPENCODE_HOME "));
  return line ? line.slice("DAILY OPENCODE_HOME ".length).trim() : "";
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return predicate();
}

function startDecoy(f: Fixture): number {
  const decoy = spawn(join(f.bin, "decoy-process"), [], { stdio: "ignore", detached: true });
  decoy.unref();
  return decoy.pid;
}

describe("the trap of the OpenCode job of FR-8", () => {
  it("stops the marked child on a normal exit", async () => {
    const f = fixture();
    current = { root: f.root, pids: [], pidFiles: [f.childPid] };
    try {
      const decoy = startDecoy(f);
      current.pids.push(decoy);
      const result = spawnSync("bash", [join(f.harness, "cron-daily.sh"), "--dry-run"], {
        cwd: f.repo, env: testEnv(f), encoding: "utf8", timeout: 100_000, maxBuffer: 16 * 1024 * 1024,
      });
      expect(result.status, `the daily dry run exited ${result.status}\n${result.stdout}\n${result.stderr}`)
        .toBe(0);
      const pid = readPid(f.childPid);
      expect(pid, "the fake models call started no child").toBeGreaterThan(0);
      const stopped = await waitUntil(() => !processAlive(pid), 20_000);
      expect(stopped, `the fake child ${pid} is still alive after the daily job exited`).toBe(true);
      expect(processAlive(decoy), "the decoy process died").toBe(true);
      const folder = jobFolder(result.stdout);
      expect(folder, "the daily job printed no DAILY OPENCODE_HOME line").not.toBe("");
      expect(existsSync(folder), `the job folder ${folder} is still there`).toBe(false);
      expect(`${result.stdout}\n${result.stderr}`, "the daily job printed no cleanup line")
        .toMatch(/^OPENCODE_HOME CLEANUP stopped=\d+ path=/m);
    } finally { /* the afterEach hook stops the processes */ }
  }, TIMEOUT);

  it("stops the marked child on a SIGTERM", async () => {
    const f = fixture();
    current = { root: f.root, pids: [], pidFiles: [f.childPid] };
    try {
      const decoy = startDecoy(f);
      current.pids.push(decoy);
      const env = testEnv(f, {
        BENCH_DAILY_QUOTA_CMD: join(f.bin, "quota-wait"),
        FAKE_READY_FILE: f.readyFile,
      });
      const daily = spawn("bash", [join(f.harness, "cron-daily.sh"), "--dry-run"], {
        cwd: f.repo, env, detached: true, stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      daily.stdout?.on("data", (chunk) => { stdout += String(chunk); });
      daily.stderr?.on("data", (chunk) => { stderr += String(chunk); });
      const closed = new Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string }>(
        (resolve) => daily.on("close", (code, signal) => resolve({ code, signal, stdout, stderr })));
      const ready = await waitUntil(() => existsSync(f.readyFile), 60_000);
      expect(ready, "the daily job never reached the quota guard").toBe(true);
      const pid = readPid(f.childPid);
      expect(pid, "the fake models call started no child").toBeGreaterThan(0);
      try { process.kill(-daily.pid, "SIGTERM"); } catch { /* the job is gone */ }
      const result = await Promise.race([
        closed,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 20_000)),
      ]);
      expect(result, "the daily job did not stop after the SIGTERM").not.toBeNull();
      const stopped = await waitUntil(() => !processAlive(pid), 20_000);
      expect(stopped, `the fake child ${pid} is still alive after the SIGTERM`).toBe(true);
      expect(processAlive(decoy), "the decoy process died").toBe(true);
      const folder = jobFolder(result?.stdout ?? "");
      expect(folder, "the daily job printed no DAILY OPENCODE_HOME line").not.toBe("");
      expect(existsSync(folder), `the job folder ${folder} is still there`).toBe(false);
    } finally { /* the afterEach hook stops the processes */ }
  }, TIMEOUT);

  it("stops the marked child of a dead owner in the sweep", async () => {
    const f = fixture();
    current = { root: f.root, pids: [], pidFiles: [f.childPid, f.sweepPid] };
    try {
      const decoy = startDecoy(f);
      current.pids.push(decoy);
      // The old job folder of a dead owner.
      const oldFolder = join(f.repo, ".tmp", "opencode-host-daily-4194303");
      mkdirSync(oldFolder, { recursive: true });
      writeFileSync(join(oldFolder, "owner.pid"), "4194303\n");
      // The marked child of that folder.
      const marked = spawn(join(f.bin, "fake-opencode-serve"), [f.sweepPid], {
        stdio: "ignore", detached: true,
        env: { ...process.env, BENCH_OPENCODE_JOB: oldFolder },
      });
      marked.unref();
      current.pids.push(marked.pid);
      const result = spawnSync("bash", [join(f.harness, "cron-daily.sh"), "--dry-run"], {
        cwd: f.repo, env: testEnv(f), encoding: "utf8", timeout: 100_000, maxBuffer: 16 * 1024 * 1024,
      });
      expect(result.status, `the daily dry run exited ${result.status}\n${result.stdout}\n${result.stderr}`)
        .toBe(0);
      expect(`${result.stdout}\n${result.stderr}`, "the daily job printed no sweep line")
        .toMatch(/^OPENCODE_HOME SWEEP stopped=1 path=/m);
      const pid = readPid(f.sweepPid);
      expect(pid, "the marked child of the old job folder started no process").toBeGreaterThan(0);
      const stopped = await waitUntil(() => !processAlive(pid), 20_000);
      expect(stopped, `the fake child ${pid} is still alive after the sweep`).toBe(true);
      expect(processAlive(decoy), "the decoy process died").toBe(true);
      expect(existsSync(oldFolder), `the old job folder ${oldFolder} is still there`).toBe(false);
    } finally { /* the afterEach hook stops the processes */ }
  }, TIMEOUT);

  it("keeps a new job folder that has no owner pid", async () => {
    const f = fixture();
    current = { root: f.root, pids: [], pidFiles: [f.childPid] };
    try {
      const decoy = startDecoy(f);
      current.pids.push(decoy);
      mkdirSync(join(f.repo, ".tmp"), { recursive: true });
      // A new owner makes the folder and writes its owner pid last (spec D1).
      // The sweep must not take such a folder away from the new owner.
      const fresh = join(f.repo, ".tmp", "opencode-host-daily-4194304");
      const old = join(f.repo, ".tmp", "opencode-host-daily-4194305");
      mkdirSync(fresh, { recursive: true });
      mkdirSync(old, { recursive: true });
      // The old folder has no owner pid and no file. Its time is 120 s old.
      const past = new Date(Date.now() - 120_000);
      utimesSync(old, past, past);
      const result = spawnSync("bash", [join(f.harness, "cron-daily.sh"), "--dry-run"], {
        cwd: f.repo, env: testEnv(f), encoding: "utf8", timeout: 100_000, maxBuffer: 16 * 1024 * 1024,
      });
      expect(result.status, `the daily dry run exited ${result.status}\n${result.stdout}\n${result.stderr}`)
        .toBe(0);
      expect(existsSync(fresh), `the sweep removed the new job folder ${fresh}`).toBe(true);
      expect(existsSync(old), `the sweep kept the old job folder ${old}`).toBe(false);
      expect(processAlive(decoy), "the decoy process died").toBe(true);
    } finally { /* the afterEach hook stops the processes */ }
  }, TIMEOUT);
});
