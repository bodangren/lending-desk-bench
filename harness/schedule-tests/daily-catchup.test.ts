// The nightly catch-up rules of Phase 7 (spec D21, D22, D24, and D25).
//
// D24 interface: `BENCH_DAILY_HEAVY`, `BENCH_HEAVY`, and
// `BENCH_MEM_FLOOR_MB=1500`. The cron lines are `DAILY HEAVY <path>`,
// `DAILY HEAVY skipped: test`, and
// `DAILY FAIL heavy: heavy-run.sh is missing`.
//
// Every job case runs a copy of `cron-daily.sh` in a temporary repository.
// The child environment has a temporary HOME, a notice sink, a board file,
// and explicit selector, batch, quota, and lock paths. The copied script has
// its default heavy-run path replaced with a missing temporary path. No case
// can reach the real heavy-run, opencode, openchamber, docs tree, or HOME.
import { spawnSync } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const HARNESS = join(ROOT, "harness");
const TMP_ROOT = "/tmp/opencode";
const FRESH = "fresh-model";
const RANKED = "ranked-0";
const LOW = "low-model";
const D21 = "D21 nightly timer";
const D22 = "D22 night rule";
const D24 = "D24 heavy-run";
const D25 = "D25 notice fields";
const D26 = "D26 high-use rule";

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
  expect(FAILED, "daily catch-up check counters").toBe(FAIL_COUNT > 0 ? 1 : 0);
});

type Fixture = {
  root: string; repo: string; origin: string; home: string; bin: string;
  runs: string; days: string; pricing: string; catalog: string; served: string;
  quota: string; batch: string; selector: string; notify: string; sink: string;
  board: string; heavy: string; heavyLog: string; selectorLog: string;
  batchLog: string; opencodeMarker: string; openchamberMarker: string;
  cgroup: string; pmConfig: string; lock: string;
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
fs.appendFileSync(process.env.BATCH_LOG, JSON.stringify({
  track, args,
  heavyPath: process.env.BENCH_HEAVY ?? '',
  memoryFloorMb: process.env.BENCH_MEM_FLOOR_MB ?? '',
}) + '\\n');
if (!args.includes('--dry-run')) {
  const artifacts = path.join(process.env.BENCH_RUNS_ROOT, 'a-' + model.replaceAll('.', '-') + '-' + track + '-' + process.env.WEEK + '-r1', 'artifacts');
  fs.mkdirSync(artifacts, {recursive:true});
  fs.writeFileSync(path.join(artifacts, 'provenance.json'), JSON.stringify({
    executor: {kind: 'opencode'}, model: 'opencode-go/' + model, arm: 'a', track,
  }));
}
if (process.env.STUB_UPDATE_BOARD === '1') {
  const board = JSON.parse(fs.readFileSync(process.env.STUB_BOARD_PATH, 'utf8'));
  if (!board.models.some((row) => row.id === model)) board.models.push({id: model});
  fs.writeFileSync(process.env.STUB_BOARD_PATH, JSON.stringify(board, null, 2) + '\\n');
}
`;

const SELECTOR_SOURCE = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.SELECTOR_LOG, JSON.stringify(args) + '\\n');
const group = Number(process.env.PICK_GROUP || '1');
const isNew = process.env.PICK_NEW !== 'false';
const model = process.env.PICK_MODEL || 'fresh-model';
const reason = process.env.PICK_REASON || (isNew ? 'untested' : 'stalest');
if (process.env.PICK_EXIT === '3') {
  console.log(JSON.stringify({
    schema: 1, date: process.env.BENCH_DAILY_DATE, week: process.env.WEEK || '2026w47', model: null,
    reason: 'none', last_test: null, counts: {live: 0, candidates: 0, eligible: 0, untested: 0},
    excluded: {unpriced: [], gone: [], unservable: [], this_week: []}, order: [], group: 0, new: false,
  }));
  console.error('DAILY_PICK date=' + process.env.BENCH_DAILY_DATE + ' model=none reason=none'
    + ' last_test=none candidates=0 eligible=0 untested=0');
  process.exit(3);
}
const output = {
  schema: 1, date: process.env.BENCH_DAILY_DATE, week: process.env.WEEK || '2026w47', model,
  reason, last_test: null, counts: {live: 2, candidates: 2, eligible: 2, untested: 1},
  excluded: {unpriced: [], gone: [], unservable: [], this_week: []}, order: [],
  group, new: isNew,
};
console.log(JSON.stringify(output));
console.error('DAILY_PICK date=' + process.env.BENCH_DAILY_DATE + ' model=' + model
  + ' reason=' + reason + ' last_test=none candidates=2 eligible=2 untested=1'
  + ' group=' + group + ' new=' + (isNew ? 'yes' : 'no'));
`;

function fixture(): Fixture {
  mkdirSync(TMP_ROOT, { recursive: true });
  const root = mkdtempSync(join(TMP_ROOT, "daily-catchup-"));
  const repo = join(root, "repo");
  const origin = join(root, "origin.git");
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
  const heavy = join(root, "heavy.sh");
  const heavyLog = join(root, "heavy.log");
  const selectorLog = join(root, "selector.log");
  const batchLog = join(root, "batch.log");
  const opencodeMarker = join(root, "opencode-ran.txt");
  const openchamberMarker = join(root, "openchamber-ran.txt");
  const cgroup = join(root, "cgroup.txt");
  const pmConfig = join(root, "pm-config.json");
  const lock = join(root, "daily.lock");
  for (const dir of [join(repo, "harness"), home, bin, runs, days]) mkdirSync(dir, { recursive: true });

  writeFileSync(pricing, JSON.stringify({
    schema: 1, source: "test", retrieved: "2026-11-14", provider: "opencode-go",
    high_usage_min_requests_per_month: 1, deepseek_rate: "off-peak", aliases: {},
    apis: { "openai-completions": { baseUrl: "https://example.invalid" } },
    models: {
      [FRESH]: { name: FRESH, api: "openai-completions", high_usage: true, batch: true,
        requests_per_month: 100, monthly_usage_usd: 15,
        rates: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 } },
      [RANKED]: { name: RANKED, api: "openai-completions", high_usage: true, batch: true,
        requests_per_month: 90, monthly_usage_usd: 15,
        rates: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 } },
      [LOW]: { name: LOW, api: "openai-completions", high_usage: false, batch: true,
        requests_per_month: 900, monthly_usage_usd: 15,
        rates: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 } },
    },
  }));
  writeFileSync(catalog, JSON.stringify({ live: [FRESH, RANKED, LOW] }));
  writeFileSync(served, `opencode-go/${FRESH}\nopencode-go/${RANKED}\nopencode-go/${LOW}\n`);

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
  script(heavy, `#!/usr/bin/env bash
printf '%s\\t%s\\t%s\\t%s\\n' "\${BENCH_TRACK:-}" "\${HEAVY_MIN_AVAIL_MB:-}" "\${HEAVY_PRIORITY:-}" "$*" >> "\${HEAVY_LOG}"
exec "$@"
`);
  script(join(bin, "opencode"), `#!/usr/bin/env bash\nprintf 'ran\\n' > ${JSON.stringify(opencodeMarker)}\nexit 0\n`);
  script(join(bin, "openchamber"), `#!/usr/bin/env bash\nprintf 'ran\\n' > ${JSON.stringify(openchamberMarker)}\nexit 0\n`);
  writeFileSync(cgroup, "0::/user.slice/user-1000.slice/user@1000.service/app.slice/openchamber.service\n");
  writeFileSync(pmConfig, JSON.stringify({ pmSession: "ses_test" }) + "\n");

  mkdirSync(join(repo, "docs/assets/data"), { recursive: true });
  writeFileSync(board, JSON.stringify({ schema: 1, models: [], history: { models: [] } }, null, 2) + "\n");

  const early = { repo, home } as Fixture;
  git(["init", "-q", "-b", "main", repo], early);
  git(["init", "-q", "--bare", "-b", "main", origin], early);
  git(["config", "user.email", "catchup@example.invalid"], early);
  git(["config", "user.name", "Catch-up Test"], early);
  git(["remote", "add", "origin", origin], early);
  git(["add", "docs/"], early);
  git(["commit", "-q", "-m", "initial"], early);
  git(["push", "-q", "origin", "main"], early);

  return { root, repo, origin, home, bin, runs, days, pricing, catalog, served, quota, batch,
    selector, notify, sink, board, heavy, heavyLog, selectorLog, batchLog, opencodeMarker,
    openchamberMarker, cgroup, pmConfig, lock };
}

function setBoard(f: Fixture, count: number, history: string[] = []): void {
  const board = {
    schema: 1,
    models: Array.from({ length: count }, (_, index) => ({ id: `ranked-${index}` })),
    history: { models: history.map((id) => ({ id })) },
  };
  writeFileSync(f.board, JSON.stringify(board, null, 2) + "\n");
  git(["add", "docs/assets/data/benchmark.json"], f);
  if (git(["diff", "--cached", "--name-only"], f) !== "") {
    git(["commit", "-q", "-m", "board fixture"], f);
  }
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
    SELECTOR_LOG: f.selectorLog, BATCH_LOG: f.batchLog, HEAVY_LOG: f.heavyLog,
    STUB_BOARD_PATH: f.board,
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
function batchCalls(f: Fixture): Array<{
  track: string; args: string[]; heavyPath: string; memoryFloorMb: string;
}> {
  return logLines(f.batchLog).map(line => JSON.parse(line) as {
    track: string; args: string[]; heavyPath: string; memoryFloorMb: string;
  });
}

describe("nightly catch-up", () => {
  caseOf("C1 the timer and script header say every night", f => {
    const timer = readFileSync(join(HARNESS, "systemd/lending-desk-daily.timer"), "utf8");
    const header = readFileSync(join(HARNESS, "cron-daily.sh"), "utf8").split(/\r?\n/).slice(0, 20).join("\n");
    expect(timer, `${D21}: the timer must run every night`).toContain("OnCalendar=*-*-* 01:00:00");
    expect(timer, `${D21}: the timer Description must say every night`).toMatch(/^Description=.*every night/im);
    expect(header, `${D21}: the script header must say every night`).toMatch(/every night/i);
  });

  caseOf("C2 a caught-up Monday rests before the catalog fetch", f => {
    setBoard(f, 10);
    const r = runJob(f, { env: { BENCH_DAILY_CATALOG: join(f.root, "missing-catalog.json") } });
    expect(r.status, `${D22}: a REST night must exit 0\n${r.stdout}\n${r.stderr}`).toBe(0);
    expect(lines(r, "DAILY CATCHUP "), `${D22}: the job must print the catch-up line`)
      .toEqual(["DAILY CATCHUP local=2026-11-16 run_day=no board=10 due=10"]);
    expect(lines(r, "DAILY REST "), `${D22}: the job must print the REST line`)
      .toEqual(["DAILY REST caught up: board=10 due=10"]);
    expect(lines(r, "DAILY FAIL catalog:"), `${D22}: REST must come before the catalog fetch`).toEqual([]);
    expect(selectorArgs(f), `${D22}: REST must come before the selector`).toEqual([]);
    expect(sinkLines(f), `${D22}: a REST night must send no notice`).toEqual([]);
  });

  caseOf("C3 a Monday below the due count runs with the board flag", f => {
    setBoard(f, 9);
    const r = runJob(f);
    expect(r.status, `${D22}: a night below the due count must run\n${r.stdout}\n${r.stderr}`).toBe(0);
    expect(lines(r, "DAILY CATCHUP "), `${D22}: the job must print the catch-up line`)
      .toEqual(["DAILY CATCHUP local=2026-11-16 run_day=no board=9 due=10"]);
    expect(lines(r, "DAILY REST "), `${D22}: the job must not rest below the due count`).toEqual([]);
    expect(selectorArgs(f), `${D22}: the job must pass --board to the selector`).toEqual([
      expect.arrayContaining(["--board", f.board]),
    ]);
    expect(batchCalls(f).map(call => call.track), `${D22}: the night must run every track batch`)
      .toEqual(["build", "bugfix", "tests", "change"]);
  });

  caseOf("C4 a Monday with only a group 3 pick skips with exit 3", f => {
    setBoard(f, 9);
    const r = runJob(f, { env: { PICK_GROUP: "3", PICK_NEW: "false", PICK_MODEL: RANKED, PICK_REASON: "stalest" } });
    expect(r.status, `${D22}: no new model must exit 3\n${r.stdout}\n${r.stderr}`).toBe(3);
    expect(lines(r, "DAILY CATCHUP "), `${D22}: the job must print the catch-up line`)
      .toEqual(["DAILY CATCHUP local=2026-11-16 run_day=no board=9 due=10"]);
    expect(lines(r, "DAILY SKIP "), `${D22}: the job must print the no-new-model skip line`)
      .toEqual(["DAILY SKIP no new model"]);
    expect(batchCalls(f), `${D22}: the skip must stop before the first batch`).toEqual([]);
    const sent = sinkLines(f);
    expect(sent, `${D25}: the skip must send one notice`).toHaveLength(1);
    expect(sent[0], `${D25}: the skip notice must name the no-new-model reason`).toContain("exit=3: no new model");
    expect(sent[0], `${D25}: the skip notice must end with the board fields`)
      .toMatch(/ model=ranked-0 new=no board=9 due=10$/);
  });

  caseOf("C5 Wednesday always runs even when the board is caught up", f => {
    setBoard(f, 100);
    const r = runJob(f, { env: { BENCH_DAILY_DATE: "2026-11-18", BENCH_DAILY_LOCAL_DATE: "2026-11-18" } });
    expect(r.status, `${D22}: Wednesday must run\n${r.stdout}\n${r.stderr}`).toBe(0);
    expect(lines(r, "DAILY CATCHUP "), `${D22}: Wednesday must print run_day=yes`)
      .toEqual(["DAILY CATCHUP local=2026-11-18 run_day=yes board=100 due=11"]);
    expect(lines(r, "DAILY REST "), `${D22}: Wednesday must not rest`).toEqual([]);
    expect(batchCalls(f).map(call => call.track), `${D22}: Wednesday must run every track batch`)
      .toEqual(["build", "bugfix", "tests", "change"]);
  });

  caseOf("C6 Sunday always runs even when the board is caught up", f => {
    setBoard(f, 100);
    const r = runJob(f, { env: { BENCH_DAILY_DATE: "2026-11-22", BENCH_DAILY_LOCAL_DATE: "2026-11-22" } });
    expect(r.status, `${D22}: Sunday must run\n${r.stdout}\n${r.stderr}`).toBe(0);
    expect(lines(r, "DAILY CATCHUP "), `${D22}: Sunday must print run_day=yes`)
      .toEqual(["DAILY CATCHUP local=2026-11-22 run_day=yes board=100 due=12"]);
    expect(lines(r, "DAILY REST "), `${D22}: Sunday must not rest`).toEqual([]);
    expect(batchCalls(f).map(call => call.track), `${D22}: Sunday must run every track batch`)
      .toEqual(["build", "bugfix", "tests", "change"]);
  });

  caseOf("C7 the due count follows the run days", async f => {
    const dates = ["2026-11-15", "2026-11-18", "2026-11-22"];
    const expected = [
      "DAILY CATCHUP local=2026-11-15 run_day=yes board=0 due=10",
      "DAILY CATCHUP local=2026-11-18 run_day=yes board=0 due=11",
      "DAILY CATCHUP local=2026-11-22 run_day=yes board=0 due=12",
    ];
    const observed: string[] = [];
    for (const date of dates) {
      const g = date === "2026-11-15" ? f : fixture();
      try {
        setBoard(g, 0);
        const r = runJob(g, { args: ["--dry-run"], env: { BENCH_DAILY_DATE: date, BENCH_DAILY_LOCAL_DATE: date } });
        observed.push(lines(r, "DAILY CATCHUP ")[0] ?? "");
      } finally {
        if (g !== f) rmSync(g.root, { recursive: true, force: true });
      }
    }
    expect(observed, `${D22}: the due count must match the run days`).toEqual(expected);
  });

  caseOf("C8 a dry run prints the catch-up and REST lines", f => {
    setBoard(f, 10);
    const r = runJob(f, { args: ["--dry-run"] });
    expect(r.status, `${D22}: a dry REST night must exit 0\n${r.stdout}\n${r.stderr}`).toBe(0);
    expect(lines(r, "DAILY CATCHUP "), `${D22}: a dry run must print the catch-up line`)
      .toEqual(["DAILY CATCHUP local=2026-11-16 run_day=no board=10 due=10"]);
    expect(lines(r, "DAILY REST "), `${D22}: a dry run must print the REST line`)
      .toEqual(["DAILY REST caught up: board=10 due=10"]);
    expect(sinkLines(f), `${D22}: a dry run must send no notice`).toEqual([]);
  });

  caseOf("C9 the cron job exports the heavy path and memory floor to every batch", f => {
    setBoard(f, 9);
    const r = runJob(f, { env: { BENCH_DAILY_HEAVY: f.heavy } });
    expect(r.status, `${D24}: the heavy night must run\n${r.stdout}\n${r.stderr}`).toBe(0);
    expect(lines(r, "DAILY HEAVY "), `${D24}: the job must print the heavy path once`)
      .toEqual([`DAILY HEAVY ${f.heavy}`]);
    expect(logLines(f.heavyLog), `${D24}: cron-daily.sh must not wrap a batch in heavy-run`)
      .toEqual([]);
    const calls = batchCalls(f);
    expect(calls.map(call => call.track), `${D24}: every track batch must run directly`)
      .toEqual(["build", "bugfix", "tests", "change"]);
    for (const call of calls) {
      expect(call.heavyPath, `${D24}: every batch must receive BENCH_HEAVY`).toBe(f.heavy);
      expect(call.memoryFloorMb, `${D24}: every batch must receive BENCH_MEM_FLOOR_MB=1500`)
        .toBe("1500");
    }
  });

  caseOf("C10 VITEST exports an empty heavy path and skips heavy-run", f => {
    setBoard(f, 9);
    const r = runJob(f);
    expect(r.status, `${D24}: the test night must run\n${r.stdout}\n${r.stderr}`).toBe(0);
    expect(lines(r, "DAILY HEAVY skipped: test"), `${D24}: VITEST must skip heavy-run`)
      .toEqual(["DAILY HEAVY skipped: test"]);
    expect(logLines(f.heavyLog), `${D24}: VITEST must not start heavy-run`).toEqual([]);
    const calls = batchCalls(f);
    expect(calls.map(call => call.track), `${D24}: VITEST must run every batch directly`)
      .toEqual(["build", "bugfix", "tests", "change"]);
    for (const call of calls) {
      expect(call.heavyPath, `${D24}: VITEST must export an empty BENCH_HEAVY`).toBe("");
      expect(call.memoryFloorMb, `${D24}: every batch must receive BENCH_MEM_FLOOR_MB=1500`)
        .toBe("1500");
    }
  });

  caseOf("C11 a missing heavy-run script fails before the first batch", f => {
    setBoard(f, 9);
    const missing = join(f.root, "missing-heavy.sh");
    const r = runJob(f, { env: { BENCH_DAILY_HEAVY: missing } });
    expect(r.status, `${D24}: a missing heavy-run script must exit 2\n${r.stdout}\n${r.stderr}`).toBe(2);
    expect(lines(r, "DAILY FAIL heavy:"), `${D24}: the job must print the heavy failure`)
      .toEqual(["DAILY FAIL heavy: heavy-run.sh is missing"]);
    expect(batchCalls(f), `${D24}: the failure must stop before the first batch`).toEqual([]);
    const sent = sinkLines(f);
    expect(sent, `${D25}: the failure must send one notice`).toHaveLength(1);
    expect(sent[0], `${D25}: the fail notice must end with the model`).toMatch(/ model=fresh-model$/);
  });

  caseOf("C12 the publish notice carries the model, new flag, board, and due count", f => {
    setBoard(f, 9);
    const r = runJob(f, { env: { BENCH_DAILY_PUBLISH: "1", STUB_UPDATE_BOARD: "1" } });
    expect(r.status, `${D25}: the publish night must exit 0\n${r.stdout}\n${r.stderr}`).toBe(0);
    const sent = sinkLines(f);
    expect(sent, `${D25}: the publish must send one notice`).toHaveLength(1);
    expect(sent[0], `${D25}: the publish notice must end with the board fields`)
      .toMatch(/ model=fresh-model new=yes board=10 due=10$/);
  });

  caseOf("C13 the job refuses a picked model outside the high-use list", f => {
    setBoard(f, 9);
    const r = runJob(f, { env: { PICK_MODEL: LOW } });
    expect(r.status, `${D26}: a model outside the high-use list must exit 3\n${r.stdout}\n${r.stderr}`).toBe(3);
    expect(lines(r, "DAILY SKIP "), `${D26}: the job must print the pinned skip line`)
      .toEqual([`DAILY SKIP not high-use: ${LOW}`]);
    expect(batchCalls(f), `${D26}: the skip must stop before the first batch`).toEqual([]);
    const sent = sinkLines(f);
    expect(sent, `${D26}: the skip must send one notice`).toHaveLength(1);
    expect(sent[0], `${D26}: the notice must name the model and the reason`)
      .toContain(`exit=3: not high-use: ${LOW}`);
  });

  caseOf("C14 a night with no new high-use model skips with exit 3", f => {
    setBoard(f, 9);
    const r = runJob(f, { env: { PICK_EXIT: "3" } });
    expect(r.status, `${D26}: a night without a high-use model must exit 3\n${r.stdout}\n${r.stderr}`).toBe(3);
    expect(lines(r, "DAILY SKIP "), `${D26}: the job must print the pinned skip line`)
      .toEqual(["DAILY SKIP no high-use model"]);
    expect(batchCalls(f), `${D26}: the skip must stop before the first batch`).toEqual([]);
    const sent = sinkLines(f);
    expect(sent, `${D26}: the skip must send one notice`).toHaveLength(1);
    expect(sent[0], `${D26}: the notice must name the reason`)
      .toContain("exit=3: no high-use model");
  });
});
