// The notice gate of D20 (finding F4 of the round of 2026-11-13).
//
// G1 is static: no test file may start the daily job without the notice
// seam `BENCH_DAILY_NOTIFY_CMD`. G2 to G5 run the job in a temporary
// repository with a fake `openchamber` first on PATH. The child environment
// holds a temporary HOME, so the real PM config is never read. No case
// starts the real `openchamber` or the real `opencode`.
import { spawnSync } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const HARNESS = join(ROOT, "harness");
const DATE = "2026-10-26";
const D20 = "D20 notice gate";
const AGENT_CGROUP = "0::/user.slice/user-1000.slice/user@1000.service/app.slice/openchamber.service";
const TIMER_CGROUP = "0::/user.slice/user-1000.slice/user@1000.service/app.slice/lending-desk-daily.service";
const SPAWN_MARKERS = ["spawnSync(", "spawn(", "execFileSync(", "execSync(", "runScript(", "exec("];

let FAILED = 0;
let PASS_COUNT = 0;
let FAIL_COUNT = 0;
const RESULTS: string[] = [];
function pass(label: string) { PASS_COUNT++; RESULTS.push(`PASS: ${label}`); }
function fail(label: string, error: unknown) {
  FAILED = 1; FAIL_COUNT++;
  RESULTS.push(`FAIL: ${label}: ${error instanceof Error ? error.message : String(error)}`);
}

function caseOf(label: string, body: (f: Fixture) => void, timeout = 60_000) {
  it(label, () => {
    console.log(`=== ${label} ===`);
    const f = fixture();
    try { body(f); pass(label); }
    catch (error) { fail(label, error); throw error; }
    finally { rmSync(f.root, { recursive: true, force: true }); }
  }, timeout);
}

afterAll(() => {
  for (const result of RESULTS) console.log(result);
  console.log(`=== Total: ${PASS_COUNT + FAIL_COUNT} checks (PASS=${PASS_COUNT}, FAIL=${FAIL_COUNT}) ===`);
  expect(FAILED, "notice seam guard counters").toBe(FAIL_COUNT > 0 ? 1 : 0);
});

type Fixture = {
  root: string; repo: string; home: string; bin: string; runs: string; days: string;
  pricing: string; catalog: string; served: string; quota: string; batch: string;
  marker: string; record: string; cgroup: string; pmConfig: string; lock: string;
  meminfo: string;
};
type JobResult = { status: number | null; stdout: string; stderr: string };

function script(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, { mode: 0o755 });
}

/** Every test file of the harness. */
function testFiles(): string[] {
  const files: string[] = [];
  for (const dir of [join(HARNESS, "schedule-tests"), join(HARNESS, "tests")]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) if (name.endsWith(".test.ts")) files.push(join(dir, name));
  }
  return files.sort();
}

/** A file that starts the job names the script in a spawn call. */
function startsTheJob(text: string): boolean {
  if (!text.includes("cron-daily.sh")) return false;
  if (!SPAWN_MARKERS.some(marker => text.includes(marker))) return false;
  const lines = text.split(/\r?\n/);
  return lines.some(line => line.includes("cron-daily.sh") && SPAWN_MARKERS.some(marker => line.includes(marker)));
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "notice-seam-guard-"));
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
  const marker = join(root, "openchamber-ran.txt");
  const record = join(root, "openchamber-argv.txt");
  const cgroup = join(root, "cgroup.txt");
  const pmConfig = join(root, "pm-config.json");
  const lock = join(root, "publish.lock");
  const meminfo = join(root, "meminfo");
  for (const dir of [join(repo, "harness"), home, bin, runs, days]) mkdirSync(dir, { recursive: true });

  writeFileSync(pricing, JSON.stringify({
    schema: 1, source: "test", retrieved: DATE, provider: "opencode-go",
    high_usage_min_requests_per_month: 1, deepseek_rate: "off-peak", aliases: {},
    apis: { "openai-completions": { baseUrl: "https://example.invalid" } },
    models: { "glm-5.2": { name: "glm-5.2", api: "openai-completions", high_usage: true, batch: true,
      requests_per_month: 100, monthly_usage_usd: 15, rates: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 } } },
  }));
  writeFileSync(catalog, JSON.stringify({ live: ["glm-5.2"] }));
  writeFileSync(served, "opencode-go/glm-5.2\n");
  // The D28 memory seam: a fixture file, never the real /proc/meminfo.
  writeFileSync(meminfo, "MemTotal: 16384000 kB\nMemAvailable: 16000000 kB\n");

  copyFileSync(join(HARNESS, "cron-daily.sh"), join(repo, "harness/cron-daily.sh"));
  // cron-daily.sh sources opencode-host.sh (track opencode_host_isolation).
  copyFileSync(join(HARNESS, "opencode-host.sh"), join(repo, "harness/opencode-host.sh"));
  for (const name of ["daily-pick.ts", "go-cost.ts", "candidate-contract.ts", "package.json", "toolchain.sh"])
    symlinkSync(join(HARNESS, name), join(repo, "harness", name));
  symlinkSync(join(HARNESS, "node_modules"), join(repo, "harness/node_modules"));

  script(quota, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({usage:{windows:{weekly:{usedPercent:10},monthly:{usedPercent:10}}}}));
`);
  script(batch, "#!/usr/bin/env node\nprocess.exit(0);\n");
  // The fake openchamber. It writes a marker and records its arguments.
  script(join(bin, "openchamber"), `#!/usr/bin/env bash
printf 'ran\\n' > ${JSON.stringify(marker)}
printf '%s\\n' "$*" >> ${JSON.stringify(record)}
exit 0
`);
  writeFileSync(cgroup, `${AGENT_CGROUP}\n`);
  writeFileSync(pmConfig, JSON.stringify({ pmSession: "ses_test" }) + "\n");
  return { root, repo, home, bin, runs, days, pricing, catalog, served, quota, batch,
    marker, record, cgroup, pmConfig, lock, meminfo };
}

/**
 * The job. It fails early on the catalog, so the notice runs on the exit
 * path. The child environment holds no `VITEST` and no real `HOME`.
 */
function runJob(f: Fixture, values: Record<string, string> = {}): JobResult {
  const env: Record<string, string> = {
    PATH: `${f.bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: f.home, TMPDIR: f.root, TSX_DISABLE_CACHE: "1", _BENCH_ENV_LOADED: "1",
    GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
    BENCH_RUNS_ROOT: f.runs, BENCH_PRICING_PATH: f.pricing, BENCH_DAILY_DIR: f.days,
    BENCH_DAILY_DATE: DATE, BENCH_DAILY_CATALOG: join(f.root, "missing-catalog.json"),
    BENCH_DAILY_SERVED: f.served, BENCH_DAILY_QUOTA_CMD: f.quota, BENCH_DAILY_BATCH: f.batch,
    BENCH_DAILY_POST: "0", BENCH_DAILY_PUBLISH: "0", BENCH_DAILY_LOCK: f.lock,
    BENCH_DAILY_CGROUP_FILE: f.cgroup, BENCH_MEMINFO: f.meminfo, ...values,
  };
  // The notice seam is off in this file, so no test can reach the PM session.
  delete env.BENCH_DAILY_NOTIFY_CMD;
  const r = spawnSync("bash", [join(f.repo, "harness/cron-daily.sh")], {
    cwd: f.repo, env, encoding: "utf8", timeout: 45_000, maxBuffer: 8 * 1024 * 1024,
  });
  if (r.error) throw new Error(`cron-daily.sh: ${r.error.message}`);
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function lines(r: JobResult, prefix: string): string[] {
  return (r.stdout + "\n" + r.stderr).split(/\r?\n/).filter(line => line.startsWith(prefix));
}
function sentLines(f: Fixture): string[] {
  return existsSync(f.record) ? readFileSync(f.record, "utf8").split(/\r?\n/).filter(Boolean) : [];
}

describe("notice seam guard", () => {
  caseOf("G1 no test file starts the daily job without the notice seam", () => {
    const offenders: string[] = [];
    for (const file of testFiles()) {
      const text = readFileSync(file, "utf8");
      if (!startsTheJob(text)) continue;
      if (!text.includes("BENCH_DAILY_NOTIFY_CMD")) offenders.push(file);
    }
    expect(offenders, `${D20}: these test files start cron-daily.sh without the notice seam`).toEqual([]);
  });

  caseOf("G2 an agent shell sends nothing: the job skips the notice", f => {
    const r = runJob(f);
    expect(r.status, `${D20}: the catalog fault must exit non-zero`).not.toBe(0);
    expect(lines(r, "DAILY NOTIFY skipped: not the timer unit"), `${D20}: the job must skip the send outside the timer unit`)
      .toEqual(["DAILY NOTIFY skipped: not the timer unit"]);
    expect(existsSync(f.marker), `${D20}: the job must never start openchamber outside the timer unit`).toBe(false);
    expect(sentLines(f), `${D20}: the job must send nothing outside the timer unit`).toEqual([]);
  });

  caseOf("G3 the timer unit sends the real line", f => {
    writeFileSync(f.cgroup, `${TIMER_CGROUP}\n`);
    const r = runJob(f, { BENCH_DAILY_PM_CONFIG: f.pmConfig });
    expect(r.status, `${D20}: the catalog fault must exit non-zero`).not.toBe(0);
    const sent = sentLines(f);
    expect(sent.length, `${D20}: the timer unit must send one line`).toBe(1);
    expect(sent[0], `${D20}: the send must name the PM session`).toContain("session send --session ses_test");
    expect(sent[0], `${D20}: the send must name the PM folder`).toContain("--dir /home/daniebo/Desktop/advantage-pr");
    expect(sent[0], `${D20}: the timer line must start with the job name`).toContain("--prompt lending-desk-daily FAIL ");
  });

  caseOf("G4 the live flag sends a HAND line", f => {
    const r = runJob(f, { BENCH_DAILY_NOTIFY_LIVE: "1", BENCH_DAILY_PM_CONFIG: f.pmConfig });
    expect(r.status, `${D20}: the catalog fault must exit non-zero`).not.toBe(0);
    const sent = sentLines(f);
    expect(sent.length, `${D20}: the live flag must send one line`).toBe(1);
    expect(sent[0], `${D20}: the hand line must start with the job name and HAND`).toContain("--prompt lending-desk-daily HAND FAIL ");
  });

  caseOf("G5 a test sends nothing under VITEST", f => {
    writeFileSync(f.cgroup, `${TIMER_CGROUP}\n`);
    const r = runJob(f, { VITEST: "true", BENCH_DAILY_PM_CONFIG: f.pmConfig });
    expect(r.status, `${D20}: the catalog fault must exit non-zero`).not.toBe(0);
    expect(lines(r, "DAILY NOTIFY skipped: test"), `${D20}: the job must skip the send under a test`)
      .toEqual(["DAILY NOTIFY skipped: test"]);
    expect(existsSync(f.marker), `${D20}: the job must never start openchamber under a test`).toBe(false);
    expect(sentLines(f), `${D20}: a test must send nothing`).toEqual([]);
  });
});
