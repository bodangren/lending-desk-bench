// The publish and the notice rules of Phase 6 (spec D15, D16, D17).
//
// Every case builds a temporary Git repository with a bare origin. The job
// runs from a copy of `harness/cron-daily.sh` inside that repository, so the
// git commands act on the temporary tree only. No case writes under the real
// `.tmp/`, `runs/`, `reports/`, or `docs/`. No case calls a model, a fetch,
// `opencode`, or the real `openchamber`. The notice transport is the seam
// `BENCH_DAILY_NOTIFY_CMD`, which writes to a sink file under the temporary
// root.
import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const HARNESS = join(ROOT, "harness");
const DATE = "2026-10-26";
const MODEL = "glm-5.2";
const STOP = "weekly used 81 percent";
const D15 = "D15 publish after a zero-run guard stop";
const D16 = "D16 fast-forward push";
const D17 = "D17 notice to the PM";
const D18 = "D18 monthly guard 95";
const D19 = "D19 exit codes";

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
  expect(FAILED, "publish notice check counters").toBe(FAIL_COUNT > 0 ? 1 : 0);
});

type Fixture = {
  root: string; repo: string; origin: string; home: string; bin: string;
  runs: string; days: string; pricing: string; catalog: string; served: string;
  quota: string; batch: string; sink: string; notify: string; notifyFail: string;
  marker: string; initial: string;
};
type JobResult = { status: number | null; stdout: string; stderr: string };

function script(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, { mode: 0o755 });
}

/** One git command in the temporary tree. It fails the case on a non-zero exit. */
function git(args: string[], cwd: string, home: string): string {
  const r = spawnSync("git", args, {
    cwd,
    env: { PATH: "/usr/bin:/bin", HOME: home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

// The batch stub. It writes the run directories of one track and the site data
// under `docs/`, so the job has something to commit.
const BATCH_SOURCE = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const track = process.env.BENCH_TRACK || 'build';
const model = args[1] || 'glm-5.2';
for (const arm of ['a', 'b']) {
  const id = arm + '-' + model.replaceAll('.', '-') + '-' + track + '-' + process.env.WEEK + '-r1';
  const artifacts = path.join(process.env.BENCH_RUNS_ROOT, id, 'artifacts');
  fs.mkdirSync(artifacts, {recursive:true});
  fs.writeFileSync(path.join(artifacts, 'provenance.json'), JSON.stringify({executor:{kind:'opencode'}, model:'opencode-go/' + model, arm, track}));
}
const docs = process.env.STUB_DOCS_DIR;
if (docs) {
  fs.mkdirSync(path.join(docs, 'assets', 'data'), {recursive:true});
  fs.writeFileSync(path.join(docs, 'assets', 'data', 'benchmark.json'), JSON.stringify({generated_at: '2026-10-26'}) + '\\n');
}
`;

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "daily-publish-"));
  const repo = join(root, "repo");
  const origin = join(root, "origin.git");
  const home = join(root, "home");
  const bin = join(root, "bin");
  const runs = join(root, "runs");
  const days = join(root, "reports/daily");
  const pricing = join(root, "pricing.json");
  const catalog = join(root, "catalog.json");
  const served = join(root, "served.txt");
  const sink = join(root, "notify-sink.txt");
  const marker = join(root, "openchamber-ran.txt");
  for (const dir of [join(repo, "harness"), home, bin, runs, days]) mkdirSync(dir, { recursive: true });

  writeFileSync(pricing, JSON.stringify({
    schema: 1, source: "test", retrieved: DATE, provider: "opencode-go",
    high_usage_min_requests_per_month: 1, deepseek_rate: "off-peak", aliases: {},
    apis: { "openai-completions": { baseUrl: "https://example.invalid" } },
    models: { [MODEL]: {
      name: MODEL, api: "openai-completions", high_usage: true, batch: true,
      requests_per_month: 100, monthly_usage_usd: 15,
      rates: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
    } },
  }));
  writeFileSync(catalog, JSON.stringify({ live: [MODEL] }));
  writeFileSync(served, `opencode-go/${MODEL}\n`);

  copyFileSync(join(HARNESS, "cron-daily.sh"), join(repo, "harness/cron-daily.sh"));
  // cron-daily.sh sources opencode-host.sh (track opencode_host_isolation).
  copyFileSync(join(HARNESS, "opencode-host.sh"), join(repo, "harness/opencode-host.sh"));
  for (const name of ["daily-pick.ts", "go-cost.ts", "candidate-contract.ts", "package.json", "toolchain.sh"])
    symlinkSync(join(HARNESS, name), join(repo, "harness", name));
  symlinkSync(join(HARNESS, "node_modules"), join(repo, "harness/node_modules"));
  mkdirSync(join(repo, "docs"), { recursive: true });
  writeFileSync(join(repo, "docs/index.html"), "<html></html>\n");

  git(["init", "-q", "-b", "main", repo], root, home);
  git(["init", "-q", "--bare", "-b", "main", origin], root, home);
  git(["config", "user.email", "publish@example.invalid"], repo, home);
  git(["config", "user.name", "Publish Test"], repo, home);
  git(["remote", "add", "origin", origin], repo, home);
  git(["add", "docs/"], repo, home);
  git(["commit", "-q", "-m", "initial"], repo, home);
  git(["push", "-q", "origin", "main"], repo, home);

  const quota = join(root, "quota.cjs");
  const batch = join(root, "batch.cjs");
  const notify = join(root, "notify.sh");
  const notifyFail = join(root, "notify-fail.sh");
  script(batch, BATCH_SOURCE);
  script(notify, `#!/usr/bin/env bash\nprintf '%s\\n' "$1" >> ${JSON.stringify(sink)}\n`);
  script(notifyFail, "#!/usr/bin/env bash\nexit 1\n");
  // A fake openchamber. The job must never start it under a test.
  script(join(bin, "openchamber"), `#!/usr/bin/env bash\nprintf 'ran\\n' > ${JSON.stringify(marker)}\nexit 0\n`);

  return {
    root, repo, origin, home, bin, runs, days, pricing, catalog, served,
    quota, batch, sink, notify, notifyFail, marker,
    initial: git(["rev-parse", "HEAD"], repo, home),
  };
}

/** The quota seam. A weekly value above 80 stops the day before the first batch. */
function writeQuota(f: Fixture, weekly: number, monthly = 10): void {
  script(f.quota, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({usage:{windows:{weekly:{usedPercent:${weekly}},monthly:{usedPercent:${monthly}}}}}));
`);
}

/** The job. The notice transport is the seam `BENCH_DAILY_NOTIFY_CMD`. */
function runJob(f: Fixture, options: { args?: string[]; env?: Record<string, string>; notify?: string | null } = {}): JobResult {
  const env: Record<string, string> = {
    PATH: `${f.bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: f.home, TMPDIR: f.root, TSX_DISABLE_CACHE: "1", _BENCH_ENV_LOADED: "1",
    GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
    BENCH_RUNS_ROOT: f.runs, BENCH_PRICING_PATH: f.pricing, BENCH_DAILY_DIR: f.days,
    BENCH_DAILY_DATE: DATE, BENCH_DAILY_CATALOG: f.catalog, BENCH_DAILY_SERVED: f.served,
    BENCH_DAILY_BATCH: f.batch, BENCH_DAILY_POST: "0", BENCH_DAILY_QUOTA_CMD: f.quota,
    BENCH_DAILY_PUBLISH: "1", BENCH_DAILY_LOCK: join(f.root, "publish.lock"),
    STUB_LOG: join(f.root, "stub.jsonl"), STUB_DOCS_DIR: join(f.repo, "docs"),
  };
  const notify = options.notify === undefined ? f.notify : options.notify;
  if (notify) env.BENCH_DAILY_NOTIFY_CMD = notify;
  Object.assign(env, options.env ?? {});
  const r = spawnSync("bash", [join(f.repo, "harness/cron-daily.sh"), ...(options.args ?? [])], {
    cwd: f.repo, env, encoding: "utf8", timeout: 45_000, maxBuffer: 8 * 1024 * 1024,
  });
  if (r.error) throw new Error(`cron-daily.sh: ${r.error.message}`);
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function lines(r: JobResult, prefix: string): string[] {
  return (r.stdout + "\n" + r.stderr).split(/\r?\n/).filter(line => line.startsWith(prefix));
}
function sinkLines(f: Fixture): string[] {
  return existsSync(f.sink) ? readFileSync(f.sink, "utf8").split(/\r?\n/).filter(Boolean) : [];
}
/** A planted change under `docs/`, as the page step of a guard-stop day left it. */
function plantDocs(f: Fixture): void {
  mkdirSync(join(f.repo, "docs/assets/data"), { recursive: true });
  writeFileSync(join(f.repo, "docs/assets/data/benchmark.json"), JSON.stringify({ generated_at: DATE }) + "\n");
}
/** One other local commit between `origin/main` and the docs commit. */
function otherCommit(f: Fixture): string {
  writeFileSync(join(f.repo, "note.txt"), "other local commit\n");
  git(["add", "note.txt"], f.repo, f.home);
  git(["commit", "-q", "-m", "other local"], f.repo, f.home);
  return git(["rev-parse", "HEAD"], f.repo, f.home);
}
function short(sha: string, f: Fixture): string {
  return git(["rev-parse", "--short", sha], f.repo, f.home);
}
/** A run of the model in the week of the day. The model is then tested. */
function plantRun(f: Fixture): void {
  const artifacts = join(f.runs, "a-glm-5-2-2026w44-r1", "artifacts");
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(artifacts, "provenance.json"), JSON.stringify({
    executor: { kind: "opencode" }, model: "opencode-go/glm-5.2", arm: "a", track: "build",
  }));
}

describe("publish and notice", () => {
  caseOf("N1 zero-run guard stop: the job commits docs/ and pushes it", f => {
    writeQuota(f, 81);
    plantDocs(f);
    const r = runJob(f);
    expect(r.status, `${D19}: the guard stop must exit 3\n${r.stdout}\n${r.stderr}`).toBe(3);
    expect(lines(r, "DAILY SKIP go-guard:"), `${D15}: the job must print the stop line`).toEqual([`DAILY SKIP go-guard: ${STOP}`]);
    expect(lines(r, "DAILY RUNS "), `${D15}: the guard stop made no run`).toEqual(["DAILY RUNS 0"]);
    const published = lines(r, "DAILY PUBLISH ");
    expect(published.length, `${D15}: the job must publish the site data\n${r.stdout}\n${r.stderr}`).toBe(1);
    expect(published[0], `${D15}: the publish line must name the commit`).toMatch(/^DAILY PUBLISH [0-9a-f]{7,}$/);
    const docs = git(["rev-parse", "HEAD"], f.repo, f.home);
    const docsShort = short(docs, f);
    expect(git(["log", "-1", "--format=%s"], f.repo, f.home), `${D15}: the commit message must name the day and the guard reason`)
      .toBe(`Publish daily ${DATE} site data: no new runs (go-guard: ${STOP}).`);
    expect(git(["show", "--name-only", "--format=", "HEAD"], f.repo, f.home).split("\n").filter(Boolean),
      `${D15}: the commit must hold only docs/`).toEqual(["docs/assets/data/benchmark.json"]);
    expect(git(["rev-parse", "main"], f.origin, f.home), `${D15}: origin/main must equal the docs commit`).toBe(docs);
    expect(sinkLines(f), `${D19}: the guard stop must send one SKIP line`).toEqual([
      `lending-desk-daily SKIP ${DATE} exit=3: go-guard ${STOP}; publish=${docsShort} range=${short(f.initial, f)}..${docsShort} commits=1 rows=0`,
    ]);
  });

  caseOf("N2 zero-run guard stop without a docs change: the job publishes nothing", f => {
    writeQuota(f, 81);
    const r = runJob(f);
    expect(r.status, `${D19}: the guard stop must exit 3\n${r.stdout}\n${r.stderr}`).toBe(3);
    expect(lines(r, "DAILY PUBLISH "), `${D15}: a day with no change publishes nothing`).toEqual(["DAILY PUBLISH none"]);
    expect(git(["rev-parse", "HEAD"], f.repo, f.home), `${D15}: the job must make no commit`).toBe(f.initial);
    expect(sinkLines(f), `${D19}: the guard stop must send one SKIP line`).toEqual([
      `lending-desk-daily SKIP ${DATE} exit=3: go-guard ${STOP}; publish=none rows=0`,
    ]);
  });

  caseOf("N3 a full day: the push carries the other local commit", f => {
    writeQuota(f, 10);
    plantDocs(f);
    const other = otherCommit(f);
    const r = runJob(f);
    expect(r.status, `${D19}: a full day must exit 0\n${r.stdout}\n${r.stderr}`).toBe(0);
    expect(lines(r, "DAILY SKIP go-guard:"), `${D18}: a clean guard read must not stop the day`).toEqual([]);
    expect(lines(r, "DAILY GO-GUARD ").length, `${D18}: the day needs four clean guard reads`).toBe(4);
    const docs = git(["rev-parse", "HEAD"], f.repo, f.home);
    expect(git(["rev-parse", "HEAD^"], f.repo, f.home), `${D16}: the other local commit must sit before the docs commit`).toBe(other);
    expect(lines(r, "DAILY PUSH "), `${D16}: the job must print the pushed range`)
      .toEqual([`DAILY PUSH ${short(f.initial, f)}..${short(docs, f)} commits=2`]);
    expect(lines(r, "DAILY PUBLISH "), `${D16}: the job must print the publish line`).toEqual([`DAILY PUBLISH ${short(docs, f)}`]);
    expect(lines(r, "DAILY PUSH skipped:"), `${D16}: the skip lines are retired`).toEqual([]);
    expect(git(["rev-parse", "main"], f.origin, f.home), `${D16}: origin/main must equal the docs commit`).toBe(docs);
    expect(git(["log", "--format=%s", "main"], f.origin, f.home), `${D16}: the push must carry the other local commit`).toContain("other local");
    expect(sinkLines(f), `${D19}: a full day must send one PUBLISH line`).toEqual([
      `lending-desk-daily PUBLISH ${DATE} ${short(docs, f)} range=${short(f.initial, f)}..${short(docs, f)} commits=2 rows=8`,
    ]);
  });

  caseOf("N4 origin/main moved: the push fails and the remote stays unchanged", f => {
    writeQuota(f, 10);
    git(["checkout", "-q", "-b", "side"], f.repo, f.home);
    writeFileSync(join(f.repo, "side.txt"), "moved\n");
    git(["add", "side.txt"], f.repo, f.home);
    git(["commit", "-q", "-m", "origin moved"], f.repo, f.home);
    git(["push", "-q", "origin", "side:main"], f.repo, f.home);
    git(["checkout", "-q", "main"], f.repo, f.home);
    const remoteBefore = git(["rev-parse", "main"], f.origin, f.home);
    const r = runJob(f);
    expect(lines(r, "DAILY FAIL push:"), `${D16}: a moved remote must fail the run\n${r.stdout}\n${r.stderr}`)
      .toEqual(["DAILY FAIL publish: origin/main is not an ancestor of the docs commit; the commit is local"]);
    expect(r.status, `${D16}: a moved remote must exit 1`).toBe(1);
    expect(git(["rev-parse", "main"], f.origin, f.home), `${D16}: the remote must stay unchanged`).toBe(remoteBefore);
  });

  caseOf("N5 failed fetch: the push fails and the commit stays local", f => {
    writeQuota(f, 10);
    git(["remote", "set-url", "origin", join(f.root, "missing.git")], f.repo, f.home);
    const r = runJob(f);
    expect(lines(r, "DAILY FAIL push:"), `${D16}: a failed fetch must fail the run\n${r.stdout}\n${r.stderr}`)
      .toEqual(["DAILY FAIL push: fetch failed; the commit is local"]);
    expect(r.status, `${D16}: a failed fetch must exit 1`).toBe(1);
    expect(git(["log", "-1", "--format=%s"], f.repo, f.home), `${D16}: the docs commit must stay local`).toMatch(/^Publish daily /);
  });

  caseOf("N6 branch is not main: the job makes no commit and fails", f => {
    writeQuota(f, 10);
    git(["checkout", "-q", "-b", "side"], f.repo, f.home);
    const r = runJob(f);
    expect(lines(r, "DAILY FAIL publish:"), `${D16}: a branch other than main must fail the run\n${r.stdout}\n${r.stderr}`)
      .toEqual(["DAILY FAIL publish: the branch is side, not main"]);
    expect(r.status, `${D16}: a branch other than main must exit 1`).toBe(1);
    expect(git(["rev-parse", "HEAD"], f.repo, f.home), `${D16}: the job must make no commit`).toBe(f.initial);
  });

  caseOf("N7 publish and skip notice: the sink holds one line per run", f => {
    const g = fixture();
    try {
      // The full day of case N3.
      writeQuota(f, 10);
      plantDocs(f);
      otherCommit(f);
      const r3 = runJob(f);
      const docs3 = git(["rev-parse", "HEAD"], f.repo, f.home);
      const publishLine = `lending-desk-daily PUBLISH ${DATE} ${short(docs3, f)} range=${short(f.initial, f)}..${short(docs3, f)} commits=2 rows=8`;
      expect(sinkLines(f), `${D17}: the full day must send one PUBLISH line`).toEqual([publishLine]);
      expect(lines(r3, "DAILY NOTIFY "), `${D17}: the job must print DAILY NOTIFY before the send`).toEqual([`DAILY NOTIFY ${publishLine}`]);

      // The guard stop of case N1.
      writeQuota(g, 81);
      plantDocs(g);
      const r1 = runJob(g);
      const docs1 = git(["rev-parse", "HEAD"], g.repo, g.home);
      const skipLine = `lending-desk-daily SKIP ${DATE} exit=3: go-guard ${STOP}; publish=${short(docs1, g)} range=${short(g.initial, g)}..${short(docs1, g)} commits=1 rows=0`;
      expect(sinkLines(g), `${D17}: the guard stop must send one SKIP line`).toEqual([skipLine]);
      expect(lines(r1, "DAILY NOTIFY "), `${D17}: the job must print DAILY NOTIFY before the send`).toEqual([`DAILY NOTIFY ${skipLine}`]);
    } finally { rmSync(g.root, { recursive: true, force: true }); }
  });

  caseOf("N8 early failure: the job sends one FAIL line to the PM", f => {
    const r = runJob(f, { env: { BENCH_DAILY_CATALOG: join(f.root, "missing-catalog.json") } });
    expect(r.status, `${D17}: the catalog fault must exit non-zero`).not.toBe(0);
    const fails = lines(r, "DAILY FAIL ");
    expect(fails.length, `${D17}: the run must print one DAILY FAIL line\n${r.stdout}\n${r.stderr}`).toBe(1);
    const reason = fails[0].replace(/^DAILY FAIL /, "");
    expect(sinkLines(f), `${D17}: the sink must hold one FAIL line`).toEqual([
      `lending-desk-daily FAIL ${DATE} exit=${r.status}: ${reason} log=reports/cron-daily.log`,
    ]);
  });

  caseOf("N9 failed notice: the job prints the failure and keeps its exit status", f => {
    writeQuota(f, 81);
    plantDocs(f);
    const r = runJob(f, { notify: f.notifyFail });
    expect(r.status, `${D17}: a failed send must not change the exit status`).toBe(3);
    expect(lines(r, "DAILY NOTIFY failed:"), `${D17}: the job must print the failed send`).toHaveLength(1);
    expect(lines(r, "DAILY PUBLISH "), `${D17}: the publish must still happen`).toHaveLength(1);
    expect(sinkLines(f), `${D17}: a failed send writes no line`).toEqual([]);
  });

  caseOf("N10 dry run: the job sends nothing", f => {
    writeQuota(f, 81);
    const dry = runJob(f, { args: ["--dry-run"] });
    expect(dry.status, `${D19}: a dry run must exit 0`).toBe(0);
    expect(lines(dry, "DAILY SKIP go-guard:"), `${D19}: the dry run must stop at the guard`).toEqual([`DAILY SKIP go-guard: ${STOP}`]);
    expect(lines(dry, "DAILY NOTIFY "), `${D17}: a dry run sends nothing`).toEqual([]);
    expect(sinkLines(f), `${D17}: a dry run sends nothing`).toEqual([]);
  });

  caseOf("N11 test safety: the job never starts openchamber under a test", f => {
    const r = runJob(f, {
      notify: null,
      env: { VITEST: "true", BENCH_DAILY_CATALOG: join(f.root, "missing-catalog.json") },
    });
    expect(r.status, `${D17}: the catalog fault must exit non-zero`).not.toBe(0);
    expect(lines(r, "DAILY NOTIFY skipped: test"), `${D17}: the job must skip the send under a test`)
      .toEqual(["DAILY NOTIFY skipped: test"]);
    expect(existsSync(f.marker), `${D17}: the job must never start openchamber under a test`).toBe(false);
    expect(sinkLines(f), `${D17}: a test sends nothing`).toEqual([]);
  });

  caseOf("N12 lock held: the job sends one SKIP line and exits 3", async f => {
    // The holder keeps the lock until the case ends. READY proves that it owns it.
    const holder = spawn("flock", ["-x", join(f.root, "publish.lock"), "bash", "-c", "printf 'READY\\n'; read -r release"], {
      cwd: f.root, env: { PATH: "/usr/bin:/bin" }, stdio: ["pipe", "pipe", "pipe"],
    });
    try {
      await new Promise<void>((ok, reject) => {
        holder.once("error", reject);
        holder.once("exit", code => reject(new Error(`lock holder exited ${code}`)));
        holder.stdout.once("data", data => String(data) === "READY\n" ? ok() : reject(new Error("lock readiness mismatch")));
      });
      const r = runJob(f);
      expect(r.status, `${D19}: a held lock must exit 3\n${r.stdout}\n${r.stderr}`).toBe(3);
      expect(lines(r, "DAILY SKIP "), `${D19}: the job must print the lock line`).toEqual(["DAILY SKIP lock held"]);
      expect(git(["rev-parse", "HEAD"], f.repo, f.home), `${D19}: the held lock must make no commit`).toBe(f.initial);
      expect(sinkLines(f), `${D19}: the held lock must send one SKIP line`).toEqual([
        `lending-desk-daily SKIP ${DATE} exit=3: lock held; publish=none rows=0`,
      ]);
    } finally {
      const exited = new Promise<void>(ok => holder.once("exit", () => ok()));
      holder.stdin.end("release\n");
      await exited;
    }
  });

  caseOf("N13 no eligible model: the job sends one SKIP line and exits 3", f => {
    writeQuota(f, 10);
    plantRun(f);
    const r = runJob(f);
    expect(r.status, `${D19}: the reason none must exit 3\n${r.stdout}\n${r.stderr}`).toBe(3);
    expect(lines(r, "DAILY PUBLISH "), `${D19}: the reason none publishes nothing`).toEqual(["DAILY PUBLISH none"]);
    expect(sinkLines(f), `${D19}: the reason none must send one SKIP line`).toEqual([
      `lending-desk-daily SKIP ${DATE} exit=3: no eligible model; publish=none rows=0`,
    ]);
  });

  caseOf("N14 monthly 84.06: the day runs and exits 0", f => {
    writeQuota(f, 0, 84.06);
    const r = runJob(f);
    expect(r.status, `${D18}: a monthly value below 95 must not stop the day\n${r.stdout}\n${r.stderr}`).toBe(0);
    expect(lines(r, "DAILY SKIP go-guard:"), `${D18}: the monthly value must not stop the day`).toEqual([]);
    expect(lines(r, "DAILY GO-GUARD ").length, `${D18}: the day needs four clean guard reads`).toBe(4);
    expect(lines(r, "DAILY RUNS "), `${D18}: the four batches must run`).toEqual(["DAILY RUNS 8"]);
  });
});
