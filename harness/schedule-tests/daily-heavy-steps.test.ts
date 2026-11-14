// The D24 heavy-step rules of Phase 7 task 7.1b.
//
// D24 interface names: `BENCH_HEAVY`, `BENCH_MEM_FLOOR_MB`,
// `BENCH_MEMINFO`, `BENCH_MEM_POLL_S`, and `BENCH_MEM_WAIT_S`.
// D24 heavy variables: `HEAVY_MIN_AVAIL_MB=1500`, `HEAVY_PRIORITY=p2`,
// and `HEAVY_RUN_TIMEOUT_S=1800`.
// D24 failure lines: `harness self-check failed: heavy-run exited <n>` and
// `canary failed: heavy-run exited <n> for <canary_id>`.
// D24 memory lines: `[<n>/<total>] WAIT <run_id> (memory: MemAvailable <m>
// MB under <floor> MB)` and `[<n>/<total>] SKIP <run_id> (memory:
// MemAvailable <m> MB under <floor> MB after <wait> s)`.
//
// Every case uses temporary copies. The tests never call the real
// heavy-run, model, opencode, openchamber, runs tree, docs tree, or home.
import { spawnSync } from "node:child_process";
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const HARNESS = join(ROOT, "harness");
const TMP_ROOT = "/tmp/opencode";
const MODEL = "test-model";
const WEEK = "2026w47";

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
  expect(FAILED, "daily heavy-step check counters").toBe(FAIL_COUNT > 0 ? 1 : 0);
});

type Result = { status: number | null; stdout: string; stderr: string };
type HeavyCall = {
  minAvailableMb: string;
  priority: string;
  timeoutSeconds: string;
  agentExit: string;
  thinking: string;
  apiPort: string;
  e2ePort: string;
  command: string;
};
type Fixture = {
  root: string;
  repo: string;
  home: string;
  bin: string;
  heavy: string;
  heavyLog: string;
  agentLog: string;
  runLog: string;
  meminfo: string;
};

function script(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, { mode: 0o755 });
  chmodSync(path, 0o755);
}

function heavyScript(path: string): void {
  script(path, `#!/usr/bin/env bash
printf '%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' \
  "\${HEAVY_MIN_AVAIL_MB:-}" "\${HEAVY_PRIORITY:-}" "\${HEAVY_RUN_TIMEOUT_S:-}" \
  "\${AGENT_EXIT:-}" "\${THINKING:-}" "\${API_PORT:-}" "\${E2E_PORT:-}" "$*" >> "\${HEAVY_LOG}"
if [ -n "\${HEAVY_FAIL_MATCH:-}" ]; then
  case "$*" in
    *"\${HEAVY_FAIL_MATCH}"*) exit "\${HEAVY_FAIL_CODE:-124}" ;;
  esac
fi
exec "$@"
`);
}

function fakeTsx(path: string): void {
  script(path, `#!/usr/bin/env bash
case "$*" in
  *"plan-work.ts --batch-lines"*) printf '%s\\n' 'opencode-go|test-model|test-model' ;;
  *"plan-work.ts --work-list"*) printf '%s\\n' '[]' ;;
  *"score-freshness.ts"*) exit 1 ;;
  *"verify-controls.ts"*) exit 0 ;;
  *"revisions.ts"*) printf '%s\\n' 'fixture-r1' ;;
  *"candidate-contract.ts --writable-paths"*) printf '%s\\n' 'src/page.tsx' ;;
  *"candidate-contract.ts"*) printf '%s\\n' '{"schema":1,"reasons":[]}' ;;
  *"usage.ts"*) printf '%s\\n' '{"output":1}' ;;
  *"provenance-record.ts"*) exit 0 ;;
  *) exit 0 ;;
esac
`);
}

function baseFixture(): Fixture {
  mkdirSync(TMP_ROOT, { recursive: true });
  const root = mkdtempSync(join(TMP_ROOT, "daily-heavy-steps-"));
  const repo = join(root, "repo");
  const home = join(root, "home");
  const bin = join(root, "bin");
  const heavy = join(root, "heavy.sh");
  const heavyLog = join(root, "heavy.log");
  const agentLog = join(root, "agent.log");
  const runLog = join(root, "run.log");
  const meminfo = join(root, "meminfo");
  for (const dir of [join(repo, "harness"), join(repo, "runs"), home, bin]) {
    mkdirSync(dir, { recursive: true });
  }
  heavyScript(heavy);
  writeFileSync(heavyLog, "");
  writeFileSync(agentLog, "");
  writeFileSync(runLog, "");
  writeFileSync(meminfo, "MemAvailable: 1024000 kB\n");
  return { root, repo, home, bin, heavy, heavyLog, agentLog, runLog, meminfo };
}

function copyHarnessFiles(f: Fixture): void {
  for (const name of ["env.sh", "opencode-host.sh"]) {
    copyFileSync(join(HARNESS, name), join(f.repo, "harness", name));
    chmodSync(join(f.repo, "harness", name), 0o755);
  }
  mkdirSync(join(f.repo, "harness/node_modules/.bin"), { recursive: true });
  fakeTsx(join(f.repo, "harness/node_modules/.bin/tsx"));
}

function fixture(): Fixture {
  const f = baseFixture();
  copyHarnessFiles(f);
  copyFileSync(join(HARNESS, "batch.sh"), join(f.repo, "harness/batch.sh"));
  copyFileSync(join(HARNESS, "run.sh"), join(f.repo, "harness/run.sh"));
  chmodSync(join(f.repo, "harness/batch.sh"), 0o755);
  chmodSync(join(f.repo, "harness/run.sh"), 0o755);
  script(join(f.bin, "npm"), `#!/usr/bin/env bash
printf 'npm\\t%s\\n' "$*" >> "\${NPM_LOG}"
exit "\${NPM_EXIT:-0}"
`);
  script(join(f.bin, "opencode"), `#!/usr/bin/env bash
printf 'opencode\\t%s\\n' "$*" >> "\${OPENCODE_LOG}"
case "\${1:-}" in
  --version) printf '%s\\n' 'opencode v2.test' ;;
  models) printf '%s\\n' 'opencode-go/test-model' ;;
esac
`);
  script(join(f.bin, "rg"), "#!/usr/bin/env bash\nprintf '%s\\n' 'ripgrep 15.1.0'\n");
  script(join(f.bin, "ss"), "#!/usr/bin/env bash\nexit 0\n");
  script(join(f.repo, "harness/opencode-credential.sh"), "#!/usr/bin/env bash\nexit 0\n");
  script(join(f.repo, "harness/preflight.sh"), "#!/usr/bin/env bash\nexit 0\n");
  script(join(f.repo, "harness/summarize.sh"), "#!/usr/bin/env bash\nexit 0\n");
  script(join(f.repo, "harness/grade.sh"), `#!/usr/bin/env bash
printf 'grade\\t%s\\n' "$*" >> "\${GRADE_LOG}"
exit "\${GRADE_EXIT:-0}"
`);
  writeFileSync(join(f.repo, "harness/go-pricing.json"), JSON.stringify({
    schema: 1, source: "test", retrieved: "2026-11-15", provider: "opencode-go",
    models: {
      [MODEL]: { name: MODEL, api: "openai-completions", high_usage: true, batch: true,
        requests_per_month: 100, monthly_usage_usd: 15,
        rates: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 } },
    },
  }));
  const fixturePath = join(f.repo, "fixture");
  mkdirSync(join(fixturePath, "src"), { recursive: true });
  mkdirSync(join(fixturePath, "node_modules"), { recursive: true });
  writeFileSync(join(fixturePath, "src/page.tsx"), "export const Page = () => null;\n");
  patchAgentFunction(f);
  return f;
}

function patchAgentFunction(f: Fixture): void {
  const path = join(f.repo, "harness/run.sh");
  const source = readFileSync(path, "utf8");
  const start = source.indexOf("run_agent_container() {");
  const marker = "\n# 0. Host readiness.";
  const end = source.indexOf(marker, start);
  if (start < 0 || end < 0) throw new Error("the run.sh fixture cannot find run_agent_container");
  const replacement = `run_agent_container() {
  printf 'agent\\n' >> "$AGENT_LOG"
  printf 'changed\\n' >> "$CAND/src/page.tsx"
  mkdir -p "$OUT/executor"
  printf '%s\\n' '{"kind":"fake"}' > "$OUT/execution-identity.json"
  printf '%s\\n' '{"kind":"fake"}' > "$OUT/executor-cohort.json"
  return 0
}
`;
  writeFileSync(path, source.slice(0, start) + replacement + source.slice(end + 1), { mode: 0o755 });
  chmodSync(path, 0o755);
}

function baseEnv(f: Fixture): Record<string, string> {
  return {
    PATH: `${f.bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: f.home,
    TMPDIR: f.root,
    TMP: f.root,
    _BENCH_ENV_LOADED: "1",
    HEAVY_LOG: f.heavyLog,
    AGENT_LOG: f.agentLog,
    RUN_LOG: f.runLog,
    NPM_LOG: join(f.root, "npm.log"),
    OPENCODE_LOG: join(f.root, "opencode.log"),
    GRADE_LOG: join(f.root, "grade.log"),
    BENCH_OPENCODE_BIN: join(f.bin, "opencode"),
    BENCH_PRICING_PATH: join(f.repo, "harness/go-pricing.json"),
    BENCH_RUNS_ROOT: join(f.repo, "runs"),
  };
}

function runBatch(f: Fixture, env: Record<string, string> = {}): Result {
  const result = spawnSync("bash", [join(f.repo, "harness/batch.sh"), "--model", MODEL], {
    cwd: join(f.repo, "harness"),
    env: { ...baseEnv(f), WEEK, ARMS: "", REPS: "1", BENCH_SELFCHECK: "meta", BENCH_CANARY: "1", ...env },
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw new Error(`batch.sh: ${result.error.message}`);
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function runRunner(f: Fixture, runId: string, env: Record<string, string> = {}): Result {
  const result = spawnSync("bash", [join(f.repo, "harness/run.sh"), "opencode-go", MODEL, "a", runId], {
    cwd: f.repo,
    env: {
      ...baseEnv(f), WEEK, BENCH_TRACK: "build", API_PORT: "32101", E2E_PORT: "32102", ...env,
    },
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw new Error(`run.sh: ${result.error.message}`);
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function lines(result: Result): string[] {
  return (result.stdout + "\n" + result.stderr).split(/\r?\n/).filter(Boolean);
}

function heavyCalls(f: Fixture): HeavyCall[] {
  if (!existsSync(f.heavyLog)) return [];
  return readFileSync(f.heavyLog, "utf8").split(/\r?\n/).filter(Boolean).map(line => {
    const parts = line.split("\t");
    return {
      minAvailableMb: parts[0] ?? "",
      priority: parts[1] ?? "",
      timeoutSeconds: parts[2] ?? "",
      agentExit: parts[3] ?? "",
      thinking: parts[4] ?? "",
      apiPort: parts[5] ?? "",
      e2ePort: parts[6] ?? "",
      command: parts.slice(7).join("\t"),
    };
  });
}

function logLines(path: string): string[] {
  return existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean) : [];
}

function installBatchRunFake(f: Fixture): void {
  script(join(f.repo, "harness/run.sh"), `#!/usr/bin/env bash
printf 'run\\t%s\\n' "$*" >> "$RUN_LOG"
run_id="\${4:-}"
mkdir -p "../runs/$run_id/artifacts"
printf '%s\\n' '{"valid":true,"total":100}' > "../runs/$run_id/artifacts/score.json"
exit "\${FAKE_RUN_EXIT:-0}"
`);
}

describe("the D24 heavy steps", () => {
  caseOf("H1 the batch self-check and canary use the heavy seam", f => {
    installBatchRunFake(f);
    const result = runBatch(f, { BENCH_HEAVY: f.heavy });
    expect(result.status, `the heavy batch must pass\n${result.stdout}\n${result.stderr}`).toBe(0);
    const calls = heavyCalls(f);
    expect(calls, "the self-check and canary must each use heavy-run").toHaveLength(2);
    const selfCheck = calls.find(call => call.command.includes("npm") && call.command.includes("test:meta"));
    const canary = calls.find(call => call.command.includes("run.sh") && call.command.includes("local reference"));
    expect(selfCheck, "the meta self-check must use heavy-run").toBeDefined();
    expect(canary, "the reference canary must use heavy-run").toBeDefined();
    for (const call of calls) {
      expect(call.minAvailableMb, "heavy-run must receive HEAVY_MIN_AVAIL_MB=1500").toBe("1500");
      expect(call.priority, "heavy-run must receive HEAVY_PRIORITY=p2").toBe("p2");
      expect(call.timeoutSeconds, "heavy-run must receive HEAVY_RUN_TIMEOUT_S=1800").toBe("1800");
    }
  });

  caseOf("H2 the batch self-check failure names the heavy-run exit code", f => {
    installBatchRunFake(f);
    const result = runBatch(f, {
      BENCH_HEAVY: f.heavy, HEAVY_FAIL_MATCH: "npm", HEAVY_FAIL_CODE: "124",
    });
    expect(result.status, "a heavy self-check failure must exit 3").toBe(3);
    expect(lines(result), "the self-check failure must name the heavy-run exit code")
      .toContain("harness self-check failed: heavy-run exited 124");
  });

  caseOf("H3 the batch canary failure names the heavy-run exit code", f => {
    installBatchRunFake(f);
    const result = runBatch(f, {
      BENCH_HEAVY: f.heavy, HEAVY_FAIL_MATCH: "run.sh", HEAVY_FAIL_CODE: "124",
    });
    expect(result.status, "a heavy canary failure must exit 3").toBe(3);
    const failure = lines(result).find(line => line.startsWith("canary failed:"));
    expect(failure, "the canary failure must name the heavy-run exit code").toMatch(
      /^canary failed: heavy-run exited 124 for canary-build-/,
    );
  });

  caseOf("H4 the batch memory gate waits and then skips the candidate", f => {
    installBatchRunFake(f);
    const result = runBatch(f, {
      BENCH_SELFCHECK: "skip",
      BENCH_CANARY: "0",
      ARMS: "a",
      BENCH_MEM_FLOOR_MB: "1500",
      BENCH_MEMINFO: f.meminfo,
      BENCH_MEM_POLL_S: "1",
      BENCH_MEM_WAIT_S: "2",
    });
    expect(result.status, `the memory skip must pass\n${result.stdout}\n${result.stderr}`).toBe(0);
    const runId = `a-${MODEL}-${WEEK}-r1`;
    expect(lines(result), "the memory gate must print the pinned wait line").toContain(
      `[1/1] WAIT ${runId} (memory: MemAvailable 1000 MB under 1500 MB)`,
    );
    expect(lines(result), "the memory gate must print the pinned skip line").toContain(
      `[1/1] SKIP ${runId} (memory: MemAvailable 1000 MB under 1500 MB after 2 s)`,
    );
    expect(logLines(f.runLog), "the skipped candidate must not start").toEqual([]);
  }, 90_000);

  caseOf("H5 each candidate grading step uses heavy-run and the agent step stays outside", f => {
    const first = runRunner(f, `a-${MODEL}-${WEEK}-r1`, { BENCH_HEAVY: f.heavy });
    const second = runRunner(f, `b-${MODEL}-${WEEK}-r1`, { BENCH_HEAVY: f.heavy });
    expect(first.status, `the first grading step must pass\n${first.stdout}\n${first.stderr}`).toBe(0);
    expect(second.status, `the second grading step must pass\n${second.stdout}\n${second.stderr}`).toBe(0);
    const calls = heavyCalls(f);
    expect(calls, "each candidate grading step must use heavy-run").toHaveLength(2);
    for (const call of calls) {
      expect(call.command, "only grade.sh may use heavy-run").toContain("grade.sh");
      expect(call.minAvailableMb, "heavy-run must receive HEAVY_MIN_AVAIL_MB=1500").toBe("1500");
      expect(call.priority, "heavy-run must receive HEAVY_PRIORITY=p2").toBe("p2");
      expect(call.timeoutSeconds, "heavy-run must receive HEAVY_RUN_TIMEOUT_S=1800").toBe("1800");
      expect(call.agentExit, "heavy-run must receive AGENT_EXIT").toBe("0");
      expect(call.thinking, "heavy-run must receive THINKING").toBe("default");
      expect(call.apiPort, "heavy-run must receive API_PORT").toBe("32101");
      expect(call.e2ePort, "heavy-run must receive E2E_PORT").toBe("32102");
    }
    expect(logLines(f.agentLog), "both agent steps must run outside heavy-run").toHaveLength(2);
  });

  caseOf("H6 a heavy grading failure keeps the grade exit code", f => {
    const result = runRunner(f, `a-${MODEL}-${WEEK}-r1`, {
      BENCH_HEAVY: f.heavy, HEAVY_FAIL_MATCH: "grade.sh", HEAVY_FAIL_CODE: "124",
    });
    expect(result.status, "a heavy grading failure must keep exit 124").toBe(124);
    expect(heavyCalls(f), "the grading step must use heavy-run").toHaveLength(1);
  });

  caseOf("H7 light paths do not call heavy-run", f => {
    const runnerPath = join(f.repo, "harness/run.sh");
    const patchedRunner = readFileSync(runnerPath, "utf8");
    installBatchRunFake(f);
    const batch = runBatch(f, {
      BENCH_SELFCHECK: "skip", BENCH_CANARY: "0", ARMS: "a",
    });
    expect(batch.status, `the light batch must pass\n${batch.stdout}\n${batch.stderr}`).toBe(0);
    expect(heavyCalls(f), "the light batch must not call heavy-run").toEqual([]);
    expect(logLines(f.runLog), "the light batch must run its candidate").toHaveLength(1);

    writeFileSync(runnerPath, patchedRunner, { mode: 0o755 });
    chmodSync(runnerPath, 0o755);
    const runner = runRunner(f, `a-${MODEL}-${WEEK}-r1`);
    expect(runner.status, `the light runner must pass\n${runner.stdout}\n${runner.stderr}`).toBe(0);
    expect(heavyCalls(f), "the light runner must not call heavy-run").toEqual([]);
  });
});
