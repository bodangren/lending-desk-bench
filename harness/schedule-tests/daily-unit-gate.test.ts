// The unit start gate of spec D28 (task 7.1e, PM decision 2026-11-15 C105).
//
// A Lending batch unit (lending-desk-daily.service or
// lending-desk-catchup-<model>.service, cron-daily.sh) is an allowed heavy
// class. D28 pins: one unit at a time through the D9 lock, and the job
// starts only when MemAvailable is over BENCH_DAILY_MEM_START_MB (default
// 8000). The gate reads BENCH_MEMINFO (default /proc/meminfo), polls every
// BENCH_MEM_POLL_S up to BENCH_MEM_WAIT_S, and skips the day with the pinned
// line when the value stays low.
//
// D28 interface: `BENCH_MEMINFO`, `BENCH_DAILY_MEM_START_MB`,
// `BENCH_MEM_POLL_S`, and `BENCH_MEM_WAIT_S`. The cron lines are
// `DAILY SKIP memory: MemAvailable <n> MB at or under <limit> MB` and
// `DAILY FAIL memory: <path> has no readable MemAvailable`.
//
// Every job case runs a copy of `cron-daily.sh` in a temporary repository.
// The child environment has a temporary HOME, a notice sink, a board file,
// a memory file, and explicit selector, batch, quota, and lock paths. No
// case can reach the real heavy-run, opencode, openchamber, docs tree, or
// HOME.
import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const HARNESS = join(ROOT, "harness");
const TMP_ROOT = "/tmp/opencode";
const D28 = "D28 unit start gate";
const LOW_KB = 4_000_000; // 3906 MB, under the 8000 MB default gate.
const HIGH_KB = 9_000_000; // 8789 MB, over the gate.
const LIMIT_KB = 8_192_000; // 8000 MB exactly, at the gate.

let FAILED = 0;
let PASS_COUNT = 0;
let FAIL_COUNT = 0;
const RESULTS: string[] = [];
function pass(label: string) { PASS_COUNT++; RESULTS.push(`PASS: ${label}`); }
function fail(label: string, error: unknown) {
  FAILED = 1; FAIL_COUNT++;
  RESULTS.push(`FAIL: ${label}: ${error instanceof Error ? error.message : String(error)}`);
}

function caseOf(label: string, body: (f: Fixture) => void | Promise<void>, timeout = 60_000) {
  it(label, async () => {
    console.log(`=== ${label} ===`);
    const f = fixture();
    try { await body(f); pass(label); }
    catch (error) { fail(label, error); throw error; }
    finally { rmSync(f.root, { recursive: true, force: true }); }
  }, timeout);
}

afterAll(() => {
  for (const result of RESULTS) console.log(result);
  console.log(`=== Total: ${PASS_COUNT + FAIL_COUNT} checks (PASS=${PASS_COUNT}, FAIL=${FAIL_COUNT}) ===`);
  expect(FAILED, "daily unit gate check counters").toBe(FAIL_COUNT > 0 ? 1 : 0);
});

type Fixture = {
  root: string; repo: string; home: string; bin: string;
  runs: string; days: string; pricing: string; catalog: string; served: string;
  quota: string; batch: string; selector: string; notify: string; sink: string;
  board: string; selectorLog: string; batchLog: string;
  opencodeMarker: string; openchamberMarker: string;
  cgroup: string; pmConfig: string; lock: string; meminfo: string;
};
type JobResult = { status: number | null; stdout: string; stderr: string };

function script(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, { mode: 0o755 });
}

function git(args: string[], f: Fixture): string {
  const r = spawnSync("git", args, {
    cwd: f.repo,
    env: { PATH: "/usr/bin:/bin", HOME: f.home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

const BATCH_SOURCE = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const track = process.env.BENCH_TRACK || 'build';
const modelIndex = args.indexOf('--model');
const model = modelIndex >= 0 ? args[modelIndex + 1] : 'fresh-model';
fs.appendFileSync(process.env.BATCH_LOG, JSON.stringify({ track, args }) + '\\n');
if (!args.includes('--dry-run')) {
  const artifacts = path.join(process.env.BENCH_RUNS_ROOT, 'a-' + model.replaceAll('.', '-') + '-' + track + '-' + process.env.WEEK + '-r1', 'artifacts');
  fs.mkdirSync(artifacts, {recursive:true});
  fs.writeFileSync(path.join(artifacts, 'provenance.json'), JSON.stringify({
    executor: {kind: 'opencode'}, model: 'opencode-go/' + model, arm: 'a', track,
  }));
}
`;

const SELECTOR_SOURCE = `#!/usr/bin/env node
const args = process.argv.slice(2);
require('node:fs').appendFileSync(process.env.SELECTOR_LOG, JSON.stringify(args) + '\\n');
const model = process.env.PICK_MODEL || 'fresh-model';
console.log(JSON.stringify({
  schema: 1, date: process.env.BENCH_DAILY_DATE, week: process.env.WEEK || '2026w47', model,
  reason: 'untested', last_test: null, counts: {live: 1, candidates: 1, eligible: 1, untested: 1},
  excluded: {unpriced: [], gone: [], unservable: [], this_week: []}, order: [], group: 1, new: true,
}));
console.error('DAILY_PICK date=' + process.env.BENCH_DAILY_DATE + ' model=' + model
  + ' reason=untested last_test=none candidates=1 eligible=1 untested=1 group=1 new=yes');
`;

function writeMeminfo(path: string, kb: number): void {
  writeFileSync(path, `MemTotal: 16384000 kB\nMemAvailable: ${kb} kB\n`);
}

function fixture(): Fixture {
  mkdirSync(TMP_ROOT, { recursive: true });
  const root = mkdtempSync(join(TMP_ROOT, "daily-unit-gate-"));
  const repo = join(root, "repo");
  const home = join(root, "home");
  const bin = join(root, "bin");
  const runs = join(root, "runs");
  const days = join(root, "reports/daily");
  const pricing = join(root, "pricing.json");
  const catalog = join(root, "catalog.json");
  const served = join(root, "served.txt");
  const quota = join(root, "quota.cjs");
  const batch = join(root, "batch.cjs");
  const selector = join(root, "selector.cjs");
  const notify = join(root, "notify.sh");
  const sink = join(root, "notify-sink.txt");
  const board = join(repo, "docs/assets/data/benchmark.json");
  const selectorLog = join(root, "selector.log");
  const batchLog = join(root, "batch.log");
  const opencodeMarker = join(root, "opencode-ran.txt");
  const openchamberMarker = join(root, "openchamber-ran.txt");
  const cgroup = join(root, "cgroup.txt");
  const pmConfig = join(root, "pm-config.json");
  const lock = join(root, "daily.lock");
  const meminfo = join(root, "meminfo");
  for (const dir of [join(repo, "harness"), home, bin, runs, days]) mkdirSync(dir, { recursive: true });

  writeFileSync(pricing, JSON.stringify({
    schema: 1, source: "test", retrieved: "2026-11-15", provider: "opencode-go",
    pick_min_requests_per_month: 10000, requests_source: "https://opencode.ai/docs/console/go/",
    requests_read: "2026-11-15", deepseek_rate: "off-peak", aliases: {},
    apis: { "openai-completions": { baseUrl: "https://example.invalid" } },
    models: {
      "fresh-model": { name: "fresh-model", api: "openai-completions", batch: true,
        requests_per_month: 50000, page_order: 1, monthly_usage_usd: 15,
        rates: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 } },
    },
  }));
  writeFileSync(catalog, JSON.stringify({ live: ["fresh-model"] }));
  writeFileSync(served, "opencode-go/fresh-model\n");
  writeMeminfo(meminfo, HIGH_KB);

  const cronSource = readFileSync(join(HARNESS, "cron-daily.sh"), "utf8")
    .replaceAll("/home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh", join(root, "missing-real-heavy.sh"));
  writeFileSync(join(repo, "harness/cron-daily.sh"), cronSource, { mode: 0o755 });
  copyFileSync(join(HARNESS, "opencode-host.sh"), join(repo, "harness/opencode-host.sh"));
  for (const name of ["daily-pick.ts", "go-cost.ts", "candidate-contract.ts", "package.json", "toolchain.sh"])
    symlinkSync(join(HARNESS, name), join(repo, "harness", name));
  symlinkSync(join(HARNESS, "node_modules"), join(repo, "harness/node_modules"));

  script(quota, "#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({usage:{windows:{weekly:{usedPercent:10},monthly:{usedPercent:10}}}}));\n");
  script(batch, BATCH_SOURCE);
  script(selector, SELECTOR_SOURCE);
  script(notify, `#!/usr/bin/env bash\nprintf '%s\\n' "$1" >> ${JSON.stringify(sink)}\n`);
  script(join(bin, "opencode"), `#!/usr/bin/env bash\nprintf 'ran\\n' > ${JSON.stringify(opencodeMarker)}\nexit 0\n`);
  script(join(bin, "openchamber"), `#!/usr/bin/env bash\nprintf 'ran\\n' > ${JSON.stringify(openchamberMarker)}\nexit 0\n`);
  writeFileSync(cgroup, "0::/user.slice/user-1000.slice/user@1000.service/app.slice/openchamber.service\n");
  writeFileSync(pmConfig, JSON.stringify({ pmSession: "ses_test" }) + "\n");

  mkdirSync(join(repo, "docs/assets/data"), { recursive: true });
  writeFileSync(board, JSON.stringify({ schema: 1, models: [], history: { models: [] } }, null, 2) + "\n");

  const early = { repo, home } as Fixture;
  git(["init", "-q", "-b", "main", repo], early);
  git(["config", "user.email", "unit-gate@example.invalid"], early);
  git(["config", "user.name", "Unit Gate Test"], early);

  return { root, repo, home, bin, runs, days, pricing, catalog, served, quota, batch,
    selector, notify, sink, board, selectorLog, batchLog, opencodeMarker,
    openchamberMarker, cgroup, pmConfig, lock, meminfo };
}

function setBoard(f: Fixture, count: number): void {
  const board = {
    schema: 1,
    models: Array.from({ length: count }, (_, index) => ({ id: `ranked-${index}` })),
    history: { models: [] },
  };
  writeFileSync(f.board, JSON.stringify(board, null, 2) + "\n");
}

function runJob(f: Fixture, options: { args?: string[]; env?: Record<string, string> } = {}): JobResult {
  const env: Record<string, string> = {
    PATH: `${f.bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: f.home, TMPDIR: f.root, TMP: f.root, TSX_DISABLE_CACHE: "1", _BENCH_ENV_LOADED: "1",
    GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
    VITEST: "true", BENCH_RUNS_ROOT: f.runs, BENCH_PRICING_PATH: f.pricing,
    BENCH_DAILY_DIR: f.days, BENCH_DAILY_DATE: "2026-11-16",
    BENCH_DAILY_LOCAL_DATE: "2026-11-16", BENCH_DAILY_BOARD: f.board,
    BENCH_DAILY_CATALOG: f.catalog, BENCH_DAILY_SERVED: f.served,
    BENCH_DAILY_SELECT: f.selector, BENCH_DAILY_BATCH: f.batch,
    BENCH_DAILY_QUOTA_CMD: f.quota, BENCH_DAILY_POST: "0", BENCH_DAILY_PUBLISH: "0",
    BENCH_DAILY_LOCK: f.lock, BENCH_DAILY_NOTIFY_CMD: f.notify,
    BENCH_DAILY_CGROUP_FILE: f.cgroup, BENCH_DAILY_PM_CONFIG: f.pmConfig,
    BENCH_DAILY_NOW: "02:00", BENCH_MEMINFO: f.meminfo,
    SELECTOR_LOG: f.selectorLog, BATCH_LOG: f.batchLog,
  };
  Object.assign(env, options.env ?? {});
  const r = spawnSync("bash", [join(f.repo, "harness/cron-daily.sh"), ...(options.args ?? [])], {
    cwd: f.repo, env, encoding: "utf8", timeout: 45_000, maxBuffer: 8 * 1024 * 1024,
  });
  if (r.error) throw new Error(`cron-daily.sh: ${r.error.message}`);
  if (existsSync(f.opencodeMarker)) throw new Error("safety: the job reached the opencode seam");
  if (existsSync(f.openchamberMarker)) throw new Error("safety: the job reached the openchamber seam");
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function lines(r: JobResult, prefix: string): string[] {
  return (r.stdout + "\n" + r.stderr).split(/\r?\n/).filter(line => line.startsWith(prefix));
}
function sinkLines(f: Fixture): string[] {
  return existsSync(f.sink) ? readFileSync(f.sink, "utf8").split(/\r?\n/).filter(Boolean) : [];
}
function logLines(path: string): string[] {
  return existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean) : [];
}
function selectorArgs(f: Fixture): string[][] {
  return logLines(f.selectorLog).map(line => JSON.parse(line) as string[]);
}
function batchCalls(f: Fixture): Array<{ track: string; args: string[] }> {
  return logLines(f.batchLog).map(line => JSON.parse(line) as { track: string; args: string[] });
}

const SKIP_LINE = `DAILY SKIP memory: MemAvailable ${Math.floor(LOW_KB / 1024)} MB at or under 8000 MB`;

describe("daily unit start gate", () => {
  caseOf("U1 the D9 lock already gives one cron-daily.sh at a time for both unit names", async f => {
    setBoard(f, 9);
    // Hold the D9 lock the way a running unit of the class holds it.
    const holder = spawn("bash", ["-c", 'exec 9>"$1"; flock -n 9 || exit 1; sleep 30', "holder", f.lock], { stdio: "ignore" });
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    try {
      const r = runJob(f);
      expect(r.status, `${D28}: a second unit must skip with exit 3\n${r.stdout}\n${r.stderr}`).toBe(3);
      expect(lines(r, "DAILY SKIP "), `${D28}: the second unit must print the lock skip line`)
        .toEqual(["DAILY SKIP lock held"]);
      expect(lines(r, "DAILY SKIP memory"), `${D28}: the lock skip needs no memory read`).toEqual([]);
      expect(selectorArgs(f), `${D28}: the second unit must not pick`).toEqual([]);
      expect(batchCalls(f), `${D28}: the second unit must run no batch`).toEqual([]);
      expect(sinkLines(f), `${D28}: the lock skip must send one notice`).toHaveLength(1);
      expect(sinkLines(f)[0], `${D28}: the notice must name the lock reason`).toContain("exit=3: lock held");
    } finally {
      holder.kill("SIGKILL");
    }
  });

  caseOf("U2 a low MemAvailable value skips the day with the pinned line", f => {
    setBoard(f, 9);
    writeMeminfo(f.meminfo, LOW_KB);
    const r = runJob(f, { env: { BENCH_MEM_POLL_S: "1", BENCH_MEM_WAIT_S: "2" } });
    expect(r.status, `${D28}: a low memory value must exit 3\n${r.stdout}\n${r.stderr}`).toBe(3);
    expect(lines(r, "DAILY SKIP "), `${D28}: the job must print the pinned memory skip line`)
      .toEqual([SKIP_LINE]);
    expect(selectorArgs(f), `${D28}: the skip must run no pick`).toEqual([]);
    expect(batchCalls(f), `${D28}: the skip must run no batch`).toEqual([]);
    const sent = sinkLines(f);
    expect(sent, `${D28}: the skip must send one notice`).toHaveLength(1);
    expect(sent[0], `${D28}: the notice must name the memory reason`)
      .toContain(`exit=3: memory: MemAvailable ${Math.floor(LOW_KB / 1024)} MB at or under 8000 MB`);
  });

  caseOf("U3 a MemAvailable value that recovers during the wait starts the job", async f => {
    setBoard(f, 9);
    writeMeminfo(f.meminfo, LOW_KB);
    const env: Record<string, string> = {
      ...process.env,
      PATH: `${f.bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: f.home, TMPDIR: f.root, TMP: f.root, TSX_DISABLE_CACHE: "1", _BENCH_ENV_LOADED: "1",
      GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
      VITEST: "true", BENCH_RUNS_ROOT: f.runs, BENCH_PRICING_PATH: f.pricing,
      BENCH_DAILY_DIR: f.days, BENCH_DAILY_DATE: "2026-11-16",
      BENCH_DAILY_LOCAL_DATE: "2026-11-16", BENCH_DAILY_BOARD: f.board,
      BENCH_DAILY_CATALOG: f.catalog, BENCH_DAILY_SERVED: f.served,
      BENCH_DAILY_SELECT: f.selector, BENCH_DAILY_BATCH: f.batch,
      BENCH_DAILY_QUOTA_CMD: f.quota, BENCH_DAILY_POST: "0", BENCH_DAILY_PUBLISH: "0",
      BENCH_DAILY_LOCK: f.lock, BENCH_DAILY_NOTIFY_CMD: f.notify,
      BENCH_DAILY_CGROUP_FILE: f.cgroup, BENCH_DAILY_PM_CONFIG: f.pmConfig,
      BENCH_DAILY_NOW: "02:00", BENCH_MEMINFO: f.meminfo,
      BENCH_MEM_POLL_S: "1", BENCH_MEM_WAIT_S: "5",
      SELECTOR_LOG: f.selectorLog, BATCH_LOG: f.batchLog,
    };
    const child = spawn("bash", [join(f.repo, "harness/cron-daily.sh")], {
      cwd: f.repo, env, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    // The first reads see a low value; a later read sees the recovery.
    await new Promise((resolveWait) => setTimeout(resolveWait, 2500));
    writeMeminfo(f.meminfo, HIGH_KB);
    const status = await new Promise<number | null>((resolveWait) => {
      child.on("close", (code) => resolveWait(code));
    });
    if (existsSync(f.opencodeMarker)) throw new Error("safety: the job reached the opencode seam");
    if (existsSync(f.openchamberMarker)) throw new Error("safety: the job reached the openchamber seam");
    const r: JobResult = { status, stdout, stderr };
    expect(r.status, `${D28}: a recovered memory value must let the job run\n${stdout}\n${stderr}`).toBe(0);
    expect(lines(r, "DAILY SKIP memory"), `${D28}: the job must not skip after the recovery`).toEqual([]);
    expect(selectorArgs(f).length, `${D28}: the job must pick after the recovery`).toBe(1);
    expect(batchCalls(f).map(call => call.track), `${D28}: the job must run every track batch`)
      .toEqual(["build", "bugfix", "tests", "change"]);
  });

  caseOf("U4 a dry run with a low MemAvailable value prints the skip line and exits 0", f => {
    setBoard(f, 9);
    writeMeminfo(f.meminfo, LOW_KB);
    const r = runJob(f, { args: ["--dry-run"], env: { BENCH_MEM_POLL_S: "1", BENCH_MEM_WAIT_S: "2" } });
    expect(r.status, `${D28}: a dry run must exit 0\n${r.stdout}\n${r.stderr}`).toBe(0);
    expect(lines(r, "DAILY SKIP "), `${D28}: a dry run must print the pinned memory skip line`)
      .toEqual([SKIP_LINE]);
    expect(batchCalls(f), `${D28}: a dry run must run no batch`).toEqual([]);
    expect(sinkLines(f), `${D28}: a dry run must send no notice`).toEqual([]);
  });

  caseOf("U5 a failed memory read fails the job with the pinned line", f => {
    setBoard(f, 9);
    const r = runJob(f, { env: { BENCH_MEMINFO: join(f.root, "no-such-meminfo") } });
    expect(r.status, `${D28}: a failed read must exit 1\n${r.stdout}\n${r.stderr}`).toBe(1);
    expect(lines(r, "DAILY FAIL memory:"), `${D28}: the job must print the pinned fail line`)
      .toEqual([`DAILY FAIL memory: ${join(f.root, "no-such-meminfo")} has no readable MemAvailable`]);
    expect(selectorArgs(f), `${D28}: the failure must run no pick`).toEqual([]);
    expect(batchCalls(f), `${D28}: the failure must run no batch`).toEqual([]);
    const sent = sinkLines(f);
    expect(sent, `${D28}: the failure must send one notice`).toHaveLength(1);
    expect(sent[0], `${D28}: the notice must be a FAIL`).toContain("FAIL");
  });

  caseOf("U6 a MemAvailable value at the limit skips the day", f => {
    setBoard(f, 9);
    writeMeminfo(f.meminfo, LIMIT_KB);
    const r = runJob(f, { env: { BENCH_MEM_POLL_S: "1", BENCH_MEM_WAIT_S: "2" } });
    expect(r.status, `${D28}: a value at the limit must exit 3\n${r.stdout}\n${r.stderr}`).toBe(3);
    expect(lines(r, "DAILY SKIP "), `${D28}: the job must print the pinned memory skip line`)
      .toEqual(["DAILY SKIP memory: MemAvailable 8000 MB at or under 8000 MB"]);
    expect(batchCalls(f), `${D28}: the skip must run no batch`).toEqual([]);
  });
});
