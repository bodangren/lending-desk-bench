// The publish label of the commit message (PM ruling 2026-11-16, task 7.7).
//
// The message line
//   Publish daily <date> OpenCode Go results: <label> (<reason>).
// takes <label> from the model of the runs in the publish range, in run
// order, each model once. It never takes <label> from the day record model
// (`record.model`). A pinned catch-up unit can publish runs of model B on a
// day record whose model is model A; the message names B, not A. A D27 day
// with runs of two models names both models in run order, each once.
// The zero-run guard-stop line of D15, the resume reason, and the
// excluded-models body lines stay as they are.
//
// Every case runs a copy of `cron-daily.sh` in a temporary repository. The
// child environment has a temporary HOME, a notice sink, a board file, and
// explicit selector, batch, quota, and lock paths. The copied script has its
// default heavy-run path replaced with a missing temporary path, and VITEST
// selects the empty heavy path. The batch and selector are stubs. A fake
// OpenCode and a fake openchamber sit first on PATH, and the case fails if
// either marker is written. No case reaches a real model, a catalog fetch,
// the network, the real docs tree, the real HOME, systemd, or the real lock
// of the running unit.
import { spawnSync } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const HARNESS = join(ROOT, "harness");
const TMP_ROOT = "/tmp/opencode";
const DATE = "2026-11-16";
// L1: the day record model and the model of the publish-range runs.
const RECORD_MODEL = "day-record-model";
const PINNED = "pinned-run-model";
// L2: the two models of one D27 day, in run order.
const ALPHA = "alpha-model";
const BETA = "beta-model";
// L3 and L4.
const GUARD = "guard-model";
const RESUME = "resume-model";
const D10 = "D10 publish message";
const D15 = "D15 zero-run guard-stop message";
const D19 = "D19 exit codes";
const D27 = "D27 catch-up loop";

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
  expect(FAILED, "publish label check counters").toBe(FAIL_COUNT > 0 ? 1 : 0);
});

type Fixture = {
  root: string; repo: string; origin: string; home: string; bin: string;
  runs: string; days: string; pricing: string; catalog: string; served: string;
  quota: string; batch: string; selector: string; notify: string; sink: string;
  board: string; heavy: string; heavyLog: string; selectorLog: string;
  batchLog: string; opencodeMarker: string; openchamberMarker: string;
  cgroup: string; pmConfig: string; lock: string; queue: string;
  meminfo: string;
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
const model = modelIndex >= 0 ? args[modelIndex + 1] : 'guard-model';
fs.appendFileSync(process.env.BATCH_LOG, JSON.stringify({
  track, args,
  heavyPath: process.env.BENCH_HEAVY ?? '',
  memoryFloorMb: process.env.BENCH_MEM_FLOOR_MB ?? '',
}) + '\\n');
function plantRun() {
  const artifacts = path.join(process.env.BENCH_RUNS_ROOT, 'a-' + model.replaceAll('.', '-') + '-' + track + '-' + process.env.WEEK + '-r1', 'artifacts');
  fs.mkdirSync(artifacts, {recursive:true});
  fs.writeFileSync(path.join(artifacts, 'provenance.json'), JSON.stringify({
    executor: {kind: 'opencode'}, model: 'opencode-go/' + model, arm: 'a', track,
  }));
}
if (!args.includes('--dry-run')) plantRun();
if (process.env.STUB_UPDATE_BOARD === '1') {
  const board = JSON.parse(fs.readFileSync(process.env.STUB_BOARD_PATH, 'utf8'));
  if (!board.models.some((row) => row.id === model)) board.models.push({id: model});
  fs.writeFileSync(process.env.STUB_BOARD_PATH, JSON.stringify(board, null, 2) + '\\n');
}
`;

// The selector seam. The queue file holds one model per line. The first call
// pops the first line; an empty queue gives the no-model path with exit 3.
const SELECTOR_SOURCE = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.SELECTOR_LOG, JSON.stringify(args) + '\\n');
let model = process.env.PICK_MODEL || 'guard-model';
const queuePath = process.env.SELECTOR_QUEUE || '';
let queued = false;
if (queuePath && fs.existsSync(queuePath)) {
  const lines = fs.readFileSync(queuePath, 'utf8').split('\\n').filter(Boolean);
  if (lines.length > 0) {
    model = lines[0];
    queued = true;
    fs.writeFileSync(queuePath, lines.slice(1).join('\\n') + (lines.length > 1 ? '\\n' : ''));
  } else {
    model = null;
  }
}
if (model === null || process.env.PICK_EXIT === '3') {
  console.log(JSON.stringify({
    schema: 1, date: process.env.BENCH_DAILY_DATE, week: process.env.WEEK || '2026w47', model: null,
    reason: 'none', last_test: null, counts: {live: 0, candidates: 0, eligible: 0, untested: 0},
    excluded: {unpriced: [], gone: [], unservable: [], this_week: []}, order: [], group: 0, new: false,
  }));
  console.error('DAILY_PICK date=' + process.env.BENCH_DAILY_DATE + ' model=none reason=none'
    + ' last_test=none candidates=0 eligible=0 untested=0');
  process.exit(3);
}
const reason = queued ? 'untested' : (process.env.PICK_REASON || 'untested');
const output = {
  schema: 1, date: process.env.BENCH_DAILY_DATE, week: process.env.WEEK || '2026w47', model,
  reason, last_test: null, counts: {live: 2, candidates: 2, eligible: 2, untested: 1},
  excluded: {unpriced: [], gone: [], unservable: [], this_week: []}, order: [],
  group: 1, new: true,
};
console.log(JSON.stringify(output));
console.error('DAILY_PICK date=' + process.env.BENCH_DAILY_DATE + ' model=' + model
  + ' reason=' + reason + ' last_test=none candidates=2 eligible=2 untested=1 new=yes');
`;

const MODELS = [RECORD_MODEL, PINNED, ALPHA, BETA, GUARD, RESUME];

function fixture(): Fixture {
  mkdirSync(TMP_ROOT, { recursive: true });
  const root = mkdtempSync(join(TMP_ROOT, "daily-publish-label-"));
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
  const queue = join(root, "selector-queue.txt");
  const meminfo = join(root, "meminfo");
  for (const dir of [join(repo, "harness"), home, bin, runs, days]) mkdirSync(dir, { recursive: true });

  // The D26 pick list: every model is on the list (requests over the minimum).
  writeFileSync(pricing, JSON.stringify({
    schema: 1, source: "test", retrieved: DATE, provider: "opencode-go",
    pick_min_requests_per_month: 10000, requests_source: "https://opencode.ai/docs/console/go/",
    requests_read: DATE, deepseek_rate: "off-peak", aliases: {},
    apis: { "openai-completions": { baseUrl: "https://example.invalid" } },
    models: Object.fromEntries(MODELS.map((id, index) => [id, {
      name: id, api: "openai-completions", batch: true,
      requests_per_month: 50000 - index * 1000, page_order: index + 1, monthly_usage_usd: 15,
      rates: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
    }])),
  }));
  writeFileSync(catalog, JSON.stringify({ live: MODELS }));
  writeFileSync(served, MODELS.map((id) => `opencode-go/${id}`).join("\n") + "\n");
  // The D28 memory seam: a fixture file, never the real /proc/meminfo.
  writeFileSync(meminfo, "MemTotal: 16384000 kB\nMemAvailable: 16000000 kB\n");

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
  // The fake OpenCode and the fake openchamber. The job must never start them.
  script(join(bin, "opencode"), `#!/usr/bin/env bash\nprintf 'ran\\n' > ${JSON.stringify(opencodeMarker)}\nexit 0\n`);
  script(join(bin, "openchamber"), `#!/usr/bin/env bash\nprintf 'ran\\n' > ${JSON.stringify(openchamberMarker)}\nexit 0\n`);
  writeFileSync(cgroup, "0::/user.slice/user-1000.slice/user@1000.service/app.slice/openchamber.service\n");
  writeFileSync(pmConfig, JSON.stringify({ pmSession: "ses_test" }) + "\n");

  mkdirSync(join(repo, "docs/assets/data"), { recursive: true });
  writeFileSync(board, JSON.stringify({ schema: 1, models: [], history: { models: [] } }, null, 2) + "\n");

  const early = { repo, home } as Fixture;
  git(["init", "-q", "-b", "main", repo], early);
  git(["init", "-q", "--bare", "-b", "main", origin], early);
  git(["config", "user.email", "publish-label@example.invalid"], early);
  git(["config", "user.name", "Publish Label Test"], early);
  git(["remote", "add", "origin", origin], early);
  git(["add", "docs/"], early);
  git(["commit", "-q", "-m", "initial"], early);
  git(["push", "-q", "origin", "main"], early);

  return { root, repo, origin, home, bin, runs, days, pricing, catalog, served, quota, batch,
    selector, notify, sink, board, heavy, heavyLog, selectorLog, batchLog, opencodeMarker,
    openchamberMarker, cgroup, pmConfig, lock, queue, meminfo };
}

function runJob(f: Fixture, options: { args?: string[]; env?: Record<string, string> } = {}): JobResult {
  const env: Record<string, string> = {
    PATH: `${f.bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: f.home, TMPDIR: f.root, TMP: f.root, TSX_DISABLE_CACHE: "1", _BENCH_ENV_LOADED: "1",
    GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
    VITEST: "true", BENCH_RUNS_ROOT: f.runs, BENCH_PRICING_PATH: f.pricing,
    BENCH_DAILY_DIR: f.days, BENCH_DAILY_DATE: DATE,
    BENCH_DAILY_LOCAL_DATE: DATE, BENCH_DAILY_BOARD: f.board,
    BENCH_DAILY_CATALOG: f.catalog, BENCH_DAILY_SERVED: f.served,
    BENCH_DAILY_SELECT: f.selector, BENCH_DAILY_BATCH: f.batch,
    BENCH_DAILY_QUOTA_CMD: f.quota, BENCH_DAILY_POST: "0", BENCH_DAILY_PUBLISH: "1",
    BENCH_DAILY_LOCK: f.lock, BENCH_DAILY_NOTIFY_CMD: f.notify,
    BENCH_DAILY_CGROUP_FILE: f.cgroup, BENCH_DAILY_PM_CONFIG: f.pmConfig,
    BENCH_DAILY_NOW: "02:00", BENCH_MEMINFO: f.meminfo,
    SELECTOR_LOG: f.selectorLog, BATCH_LOG: f.batchLog, HEAVY_LOG: f.heavyLog,
    STUB_BOARD_PATH: f.board, STUB_UPDATE_BOARD: "1",
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
/** The subjects of the publish commits, newest first. */
function publishSubjects(f: Fixture): string[] {
  return git(["log", "--format=%s"], f).split("\n").filter(subject => subject.startsWith("Publish daily "));
}
/** The quota seam. A weekly value above 80 stops the day before the first batch. */
function writeQuota(f: Fixture, weekly: number, monthly = 10): void {
  script(f.quota, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({usage:{windows:{weekly:{usedPercent:${weekly}},monthly:{usedPercent:${monthly}}}}}));
`);
}
/** The day record of the date. The record names its model; the runs decide the label. */
function writeRecord(f: Fixture, record: Record<string, unknown>): void {
  writeFileSync(join(f.days, `${DATE}.json`), JSON.stringify(record, null, 2) + "\n");
}

describe("publish label from the run models", () => {
  caseOf("L1 a pinned catch-up day: the label names the run model, not the day record model", f => {
    // The pinned unit publishes runs of PINNED on a day record that names RECORD_MODEL.
    writeRecord(f, {
      schema: 1, date: DATE, model: RECORD_MODEL, reason: "pm-pin catch-up", run_ids: [],
    });
    writeFileSync(f.queue, `${PINNED}\n`);
    const r = runJob(f, { env: { SELECTOR_QUEUE: f.queue } });
    expect(r.status, `${D19}: the pinned night must exit 0\n${r.stdout}\n${r.stderr}`).toBe(0);
    const subjects = publishSubjects(f);
    expect(subjects.length, `${D10}: the pinned night must make one publish commit\n${r.stdout}\n${r.stderr}`).toBe(1);
    const subject = subjects[0];
    expect(subject, `${D10}: the label must name the model of the publish-range runs\n${subject}`)
      .toContain(PINNED);
    expect(subject, `${D10}: the label must not name the day record model\n${subject}`)
      .not.toContain(RECORD_MODEL);
    expect(subject, `${D10}: the message shape and the record reason must stay\n${subject}`)
      .toMatch(new RegExp(`^Publish daily ${DATE} OpenCode Go results: .+ \\(pm-pin catch-up\\)\\.$`));
  });

  caseOf("L2 a D27 day with runs of two models: the last label names both in run order, each once", f => {
    writeFileSync(f.queue, `${ALPHA}\n${BETA}\n`);
    const r = runJob(f, { env: { SELECTOR_QUEUE: f.queue } });
    expect(r.status, `${D27}: the catch-up night must exit 0\n${r.stdout}\n${r.stderr}`).toBe(0);
    expect(lines(r, "DAILY PUBLISH ").length, `${D27}: each model must publish its own commit`).toBe(2);
    const subjects = publishSubjects(f);
    expect(subjects.length, `${D10}: the day must hold two publish commits`).toBe(2);
    const [last, first] = subjects;
    expect(first, `${D10}: the first commit covers the runs of the first model only\n${first}`)
      .toContain(ALPHA);
    expect(first, `${D10}: the first commit covers no second-model run\n${first}`)
      .not.toContain(BETA);
    expect(last, `${D10}: the label must name the first run model\n${last}`).toContain(ALPHA);
    expect(last, `${D10}: the label must name the second run model\n${last}`).toContain(BETA);
    expect(last.indexOf(ALPHA), `${D10}: the models must appear in run order\n${last}`)
      .toBeLessThan(last.indexOf(BETA));
    expect(last.split(ALPHA).length - 1, `${D10}: each model appears once\n${last}`).toBe(1);
    expect(last.split(BETA).length - 1, `${D10}: each model appears once\n${last}`).toBe(1);
    expect(last, `${D10}: the message shape and the reason must stay\n${last}`)
      .toMatch(new RegExp(`^Publish daily ${DATE} OpenCode Go results: .+ \\(untested\\)\\.$`));
  });

  caseOf("L3 a zero-run guard stop keeps the D15 message", f => {
    writeQuota(f, 81);
    writeFileSync(f.queue, `${GUARD}\n`);
    // A planted change under docs/, as the page step of a guard-stop day left it.
    writeFileSync(f.board, JSON.stringify({
      schema: 1, models: [{ id: "planted-model" }], history: { models: [] },
    }, null, 2) + "\n");
    const r = runJob(f, { env: { SELECTOR_QUEUE: f.queue } });
    expect(r.status, `${D19}: the guard stop must exit 3\n${r.stdout}\n${r.stderr}`).toBe(3);
    expect(lines(r, "DAILY SKIP go-guard:"), `${D15}: the job must print the stop line`)
      .toEqual(["DAILY SKIP go-guard: weekly used 81 percent"]);
    const subjects = publishSubjects(f);
    expect(subjects.length, `${D15}: the zero-run guard stop must publish once`).toBe(1);
    expect(subjects[0], `${D15}: the one-line message must stay`)
      .toBe(`Publish daily ${DATE} site data: no new runs (go-guard: weekly used 81 percent).`);
  });

  caseOf("L4 a resume keeps the resume reason and the excluded body lines", f => {
    // The record exists, so the real selector resumes it: reason `resume`.
    writeRecord(f, {
      schema: 1, date: DATE, model: RESUME, reason: "stalest", run_ids: [],
      excluded: { unpriced: ["ghost-model"], gone: ["dead-model"], unservable: ["absent-model"] },
    });
    // Only one live model, so the second pick finds no eligible model and ends the day.
    writeFileSync(f.catalog, JSON.stringify({ live: [RESUME] }));
    writeFileSync(f.served, `opencode-go/${RESUME}\n`);
    const r = runJob(f, { env: { BENCH_DAILY_SELECT: "" } });
    expect(r.status, `${D19}: the resumed night must exit 0\n${r.stdout}\n${r.stderr}`).toBe(0);
    const subjects = publishSubjects(f);
    expect(subjects.length, `${D10}: the resumed night must publish once`).toBe(1);
    expect(subjects[0], `${D10}: the resume reason must stay in the subject\n${subjects[0]}`)
      .toBe(`Publish daily ${DATE} OpenCode Go results: ${RESUME} (resume).`);
    const body = git(["log", "-1", "--format=%B"], f);
    expect(body, `${D10}: the unpriced body line must stay`).toContain("Unpriced: ghost-model");
    expect(body, `${D10}: the gone body line must stay`).toContain("Gone: dead-model");
    expect(body, `${D10}: the unservable body line must stay`).toContain("Unservable: absent-model");
  });
});
