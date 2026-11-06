# Implementation plan — opencode_host_isolation

PM 2026-11-06: light lane

This plan gives each harness job its own OpenCode store, stops the job
processes with a trap, and sets the `logic` self-check for the daily job.
Spec: `spec.md`. Base commit: `f55d2aa`.

Order: the spec check, the Red tests, the Green code, the checker review, the
tests, the hashes, the live-day preflight, and then the 2026-11-08 live day.

Constraints for every role:

- The lane is the light lane. One maker and one checker. The checker sits in
  a different model family, and it is not a Kimi model (spec D13).
  - Maker: `minimax-cn-coding-plan/MiniMax-M3.1-Flash`.
  - Code checker: `claude-code/claude-sonnet-5-5#high`.
  - Spec checker: `volcengine-agent-plan/glm-latest#high`.
- The deadline: tasks 1.1 to 1.6 finish before Sat 2026-11-07 23:00 +07
  (spec D14). When they do not, the orchestrator tells the PM at that time.
  No role stops the timer.
- Only the new test files of `harness/schedule-tests/` run outside the
  heavy-run wrapper. Each other test run, and the preflight, use
  `/home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh` with
  `HEAVY_MIN_AVAIL_MB=1500`.
- No role runs the real `opencode` binary outside task 2.1. No role runs
  `opencode auth login`, and no role edits, removes, or copies a file of the
  shared store (`~/.local/share/opencode`, `~/.local/state/opencode`,
  `~/.config/opencode`, `~/.cache/opencode`).
- No role touches the OpenChamber server
  (`opencode serve --hostname 127.0.0.1 --port 43003`).
- No role reads `harness/results.json`. No log, test, or record holds a real
  token.
- The owner gates stay with Daniel: each push, each deletion outside a job
  folder, the timer, and the answer to O1.
- Stage files by explicit path. Never stage `.opencode/` or `tech-debt.md`.
- The evidence folder is `measure/runs/opencode_host_isolation/`.

Marker use:

- `[ ]` marks an open task. The orchestrator adds `[~]` to the one open task
  and `[b]` to a task that waits for an owner or for an earlier task.
- `[x]` needs a commit SHA on the first line of the task.

## Phase 1: The harness change (spec D1 to D12)

- [x] 1.0 The spec check. 479095f
  The spec checker reads `spec.md` and this plan. It
  checks that every choice of the maker has one decided answer in the spec.
  It writes `measure/runs/opencode_host_isolation/spec-check-1.0.json` with
  `status`, a short paraphrase of the spec, and one entry for each finding.
  - Evidence: `spec-check-1.0.json` status pass, 0 blocking, 5 non-blocking
    (F1 Major; F2-F5 Nit), gate `role-gate --role spec-review` PASS; reviewer
    `volcengine-agent-plan/glm-latest#high`.
  - Verify: the file shows `status: pass`, or each blocking finding has a
    fix in `spec.md` or `plan.md` in a later commit.
  - Lane: light. The spec checker changes no code.
  - Spec checker: `volcengine-agent-plan/glm-latest#high`.
- [x] 1.1 The Red tests (spec FR-7, FR-8, FR-9). 6f44bda. Write the three test files.
  - Round 4 (2026-11-06): the checker of task 1.3 wrote
    `measure/runs/opencode_host_isolation/check-1.3.json` with the status
    fail and the recommendation retry_tests. Round 4 reopens this task for the
    test fixes of the findings F1 to F4 of that file. The model of this round
    is `minimax-cn-coding-plan/MiniMax-M3.1-Flash`.
  - Correction (check-1.3-r2 finding F9, 2026-11-06): the checker's mutation
    claims about the early return at `opencode-credential.sh:157` are not
    exact; line 161 repeats the check. Also, removing `XDG_DATA_HOME` alone
    keeps isolation through `HOME`. The F2 checks still fail for real
    mutations, such as removing the `seeded` write.
  Touch these files and no others:
  - `harness/schedule-tests/opencode-host-isolation.test.ts` (spec FR-7).
  - `harness/schedule-tests/opencode-host-trap.test.ts` (spec FR-8).
  - `harness/schedule-tests/daily-selfcheck-default.test.ts` (spec FR-9).
  Each test copies the scripts that it runs into a temp repo, the same as
  `harness/schedule-tests/rescore-guard.test.ts`. No test writes under the
  real `.tmp/`, `runs/`, or `reports/`. No test starts the real `opencode`
  binary, Podman, a browser, or a model.
  - Command for each file:
    `cd harness && npx vitest run schedule-tests/<file> --configLoader native`.
  - Verify: each of the three files fails on the code of `f55d2aa`. The task
    records the `Tests` line and the names of the failed tests of each file.
  - Verify: `opencode-host-trap.test.ts` stops its fake child processes and
    its decoy at its end, also on a failure. After each run,
    `ps -eo pid,args | grep '[f]ake-opencode'` prints no line. The fake
    child must carry the text `fake-opencode` in its command line.
  - Evidence of the Red run on 2026-11-06:
    - `cd harness && npx vitest run schedule-tests/opencode-host-isolation.test.ts --configLoader native`
      gave `Test Files  1 failed (1)` and `Tests  9 failed (9)`. The failed
      tests: `keeps every daily job call out of the shared home`;
      `keeps every batch call out of the shared home`;
      `keeps every seed call out of the shared home`;
      `keeps every export call out of the shared home`;
      `keeps every check-window call out of the shared home`;
      `keeps every warn call out of the shared home`;
      `keeps every preflight call out of the shared home`;
      `keeps every scan-values call out of the shared home`;
      `keeps every run call out of the shared home`.
    - `cd harness && npx vitest run schedule-tests/opencode-host-trap.test.ts --configLoader native`
      gave `Test Files  1 failed (1)` and `Tests  3 failed (3)`. The failed
      tests: `stops the marked child on a normal exit`;
      `stops the marked child on a SIGTERM`;
      `stops the marked child of a dead owner in the sweep`.
    - `cd harness && npx vitest run schedule-tests/daily-selfcheck-default.test.ts --configLoader native`
      gave `Test Files  1 failed (1)` and `Tests  1 failed | 1 passed (2)`. The
      failed test: `gives each batch the logic self-check when the caller sets
      no value`. The test `keeps the self-check of an explicit caller value`
      passed on the base code.
  - Evidence of the round-3 Red fix on 2026-11-06. Green found a test
    defect: line 284 called `under(dataFolder(call), .../.tmp/opencode-host-)`.
    The `under()` helper appends `/` to the parent, so it tested the prefix
    `.tmp/opencode-host-/`. Every correct job folder is
    `.tmp/opencode-host-<job>-<pid>/...`, so the assertion was false for
    every correct implementation. The fix replaces only that call with a
    plain prefix test:
    `dataFolder(call).startsWith(join(f.repo, ".tmp", "opencode-host-"))`.
    The model of this round is `volcengine-agent-plan/glm-5.3-flash#high`,
    because MiniMax was at its 5-hour limit until 09:00. Node proof with
    the new condition, `node -e 'const {join}=require("node:path");
    const p=join("/r",".tmp","opencode-host-"); console.log(join("/r/.tmp/opencode-host-daily-1","data").startsWith(p), join("/home/u",".local","share").startsWith(p))'`,
    printed `true false`. After the fix, the file with the Green code of
    task 1.2 in the tree gave `Test Files  1 passed (1)` and
    `Tests  9 passed (9)`, `EXIT=0`. After the run,
    `ps -eo pid,args | grep '[f]ake-opencode'` printed no line.
  - Evidence of the round-4 Red fix on 2026-11-06. The checker of task 1.3
    found the findings F1 to F4 in
    `measure/runs/opencode_host_isolation/check-1.3.json` (status fail,
    retry_tests). The round changes two test files and no production code.
    The earlier Red commits of this task are `edb87cd`, `ffc6cb0`, and the
    Green commit of task 1.2 is `f87de82`.
    - F1: `testEnv` of `opencode-host-isolation.test.ts` sets `OPENCODE_DB` to
      `<shared home>/.local/share/opencode/opencode.db`. The check of
      `opencode_db` holds for every recorded call now. The seed call is no
      longer exempt.
    - F2: `expectIsolated` finds the seed read by its count. The test asserts
      one seed read of the shared store. A job store read that resolves under
      the shared home fails the count. The run case asserts one shared read
      and two `auth export` calls. A new case runs the helper twice in one job
      folder and asserts one shared read in total.
    - F3: a new test in `opencode-host-trap.test.ts` keeps a job folder
      without an `owner.pid` whose time is less than 60 s old. A second
      folder without an `owner.pid` and with the time 120 s back must be
      removed.
    - F4: a new test in `opencode-host-isolation.test.ts` runs the export mode
      of the helper as the owner. The stdout holds one JSON payload line, and
      the stderr holds the `OPENCODE_HOME CLEANUP` line.
    - The Red run of round 4 on 2026-11-06 (each file alone, shell timeout
      600 s):
      - `cd harness && npx vitest run schedule-tests/opencode-host-isolation.test.ts --configLoader native`
        gave `Test Files  1 failed (1)` and `Tests  1 failed | 10 passed (11)`.
        The failed test: `prints the cleanup line of the owner on stderr`. The
        failure says `the export stdout holds 2 lines`. The nine old tests
        and the two new tests of F1 and F2 pass.
      - `cd harness && npx vitest run schedule-tests/opencode-host-trap.test.ts --configLoader native`
        gave `Test Files  1 failed (1)` and `Tests  1 failed | 3 passed (4)`.
        The failed test: `keeps a new job folder that has no owner pid`. The
        failure says `the sweep removed the new job folder`. The three old
        tests pass.
      - After both runs, `ps -eo pid,args | grep '[f]ake-opencode'` printed no
        line.
    - The mutation proof of F1 and F2. The new checks pass on the code of
      `cf74ee3`, because the code keeps the rules. Each new check fails on a
      mutation of one line:
      - F1: `harness/opencode-host.sh:187` holds `env -u OPENCODE_DB` in
        `opencode_host_run`. Without that line, every call of the job store
        keeps `OPENCODE_DB` of the test environment, the fake records
        `opencode_db` as true, and the check of every call fails.
        `harness/opencode-credential.sh:165` holds `env -u OPENCODE_DB` in the
        shared read of the seed. Without that line, the seed call records
        `opencode_db` as true and the check fails. The old test exempted the
        seed call, so that mutation passed the old test.
      - F2: `harness/opencode-credential.sh:157` returns early when the job
        folder holds the marker `seeded`. Without that line, the second
        helper run of the new case reads the shared store again. The shared
        read count of the new case is 2 and the new check fails. The run case
        fails the same way when a job store read resolves under the shared
        home: `harness/opencode-host.sh:191` sets
        `XDG_DATA_HOME="$folder/data"`, and without that line the job store
        read resolves under the shared home. The shared read count of the run
        case is 2 and the new check fails.
  - Lane: light. The maker runs only these three files.
  - Maker: `minimax-cn-coding-plan/MiniMax-M3.1-Flash`.
- [x] 1.2 The Green code (spec D1 to D10). f87de82 46edf4c
  - Round 2 of Green (2026-11-06): the checker of task 1.3 found the findings
    F3 to F6 in `measure/runs/opencode_host_isolation/check-1.3.json` (status
    fail, retry_tests). Round 2 of Green fixed F3 to F6 in production code.
    The maker model of round 2 stays
    `kimi-code-plan-cn/kimi-for-coding#high`.
  - Evidence of the round-2 Green run on 2026-11-06 (each file alone, shell
    timeout 600 s):
    - `cd harness && npx vitest run schedule-tests/opencode-host-isolation.test.ts --configLoader native`
      gave `Test Files  1 passed (1)` and `Tests  11 passed (11)`.
    - `cd harness && npx vitest run schedule-tests/opencode-host-trap.test.ts --configLoader native`
      gave `Test Files  1 passed (1)` and `Tests  4 passed (4)`. After each run,
      `ps -eo pid,args | grep '[f]ake-opencode'` printed no line.
    - `cd harness && npx vitest run schedule-tests/daily-selfcheck-default.test.ts --configLoader native`
      gave `Test Files  1 passed (1)` and `Tests  2 passed (2)`.
  - Fixes of round 2 (commit 46edf4c, files `harness/opencode-host.sh` and
    `harness/opencode-credential.sh` only):
    - F3: `opencode_host_sweep` skips a folder with no `owner.pid` whose mtime
      is less than 60 s old; a folder with no `owner.pid` that is 60 s old or
      older stays a dead-owner folder and is cleaned.
    - F4: the helper prints the `OPENCODE_HOME CLEANUP ...` and
      `OPENCODE_HOME SWEEP ...` lines on stderr, so the stdout of `export`
      holds only the JSON payload. The owner scripts keep their lines on
      stdout.
    - F5: the seed call drops `2>&1`; the stderr of the selection goes to
      `/dev/null`, so a node stderr warning cannot enter the payload.
    - F6: in the `warn` mode a seed failure does not change the exit status;
      `warn` exits 0 always.
  - Verify (round 2): `bash -n` on the seven scripts exits 0 (OK); the two `rg`
    commands of spec FR-1 print the expected output (the first no line, the
    second exactly one line, `harness/opencode-credential.sh:169`, the seed
    shared read); `rg -n 'XDG_DATA_HOME|XDG_STATE_HOME'` on the four job
    scripts prints no line; `git diff --stat f55d2aa -- harness/opencode-entry.sh
    harness/go-cost.ts harness/execution-identity.ts harness/provenance.ts`
    prints no line.
  - Evidence of the round-1 Green run on 2026-11-06 (each file alone, shell timeout 600 s):
    - `cd harness && npx vitest run schedule-tests/opencode-host-isolation.test.ts --configLoader native`
      gave `Test Files  1 passed (1)` and `Tests  9 passed (9)`.
    - `cd harness && npx vitest run schedule-tests/opencode-host-trap.test.ts --configLoader native`
      gave `Test Files  1 passed (1)` and `Tests  3 passed (3)`. After each run,
      `ps -eo pid,args | grep '[f]ake-opencode'` printed no line.
    - `cd harness && npx vitest run schedule-tests/daily-selfcheck-default.test.ts --configLoader native`
      gave `Test Files  1 passed (1)` and `Tests  2 passed (2)`.
  - Verify: `bash -n` on the seven scripts exits 0 (OK).
  - Verify: the two `rg` commands of spec FR-1 print the expected output: the
    first prints no line; the second prints exactly one line,
    `harness/opencode-credential.sh:166` (the seed shared read).
  - Verify: `rg -n 'XDG_DATA_HOME|XDG_STATE_HOME' harness/cron-daily.sh
    harness/batch.sh harness/weekly.sh harness/cron-weekly.sh` prints no line.
  - Verify: `git diff --stat f55d2aa -- harness/opencode-entry.sh
    harness/go-cost.ts harness/execution-identity.ts harness/provenance.ts`
    prints no line.
  - Maker substitution: the spec names `minimax-cn-coding-plan/MiniMax-M3.1-Flash`
    for this task; the MiniMax plan reached its 5-hour limit at 07:16 (error
    2056), so the PM moved Green to `kimi-code-plan-cn/kimi-for-coding#high`.
  - Defaults of the Green maker (Kimi Green, commit f87de82):
    1. A helper process that performed the seed selects the seed payload in
       place of a second job-store read. This keeps one opencode call per
       helper process, so the meta credential tests keep their export-call
       sequence against the counting fake (spec FR-9; assertions unchanged).
    2. The meta fakes need no change: `createFakeOpencode` dispatches on
       argv[0]/argv[1] only and already accepts the D3 argument lists and the
       D4 `auth import` call.
    3. `opencode_host_begin` sets no traps; each owner script sets its own, so
       `run.sh` keeps its present TERM and INT traps (spec D6).
    4. The cleanup treats a zombie process as stopped (it reads
       `/proc/<pid>/stat`), and the process scans use shell builtins and one
       `find` pass instead of a helper fork per pid or fd. Round 1 forked per
       pid/fd and the trap test's SIGTERM case needed ~20 s; round 2 runs it
       in ~2 s.
  - Note: the Red file `opencode-host-isolation.test.ts` needed one fix before
    Green could pass. The round-2 Green found its job-folder check unpassable
    (`under()` appends `/` to a parent that ends with the literal dash
    `opencode-host-`) and returned blocked. Red commit `ffc6cb0` changed the
    check to `startsWith`; nothing else in the tests changed.
  Touch these files and no others:
  - `harness/opencode-host.sh` (new): the functions of spec D1, D2, D6, and
    D7. The names are `opencode_host_begin <job>`, `opencode_host_run`,
    `opencode_host_cleanup`, and `opencode_host_sweep`.
  - `harness/opencode-credential.sh`: the mode `seed`, the seed before each
    other mode, the job-store reads, the owner role outside a job (spec D1,
    D4), and the `inert` filter of `scan-values` (spec D5).
  - `harness/cron-daily.sh`: `opencode_host_begin daily` after the lock, the
    line `DAILY OPENCODE_HOME <job folder>`, the cleanup in the `EXIT` trap
    of line 67, the `INT` and `TERM` traps, `opencode-credential.sh seed`
    and `opencode_host_run models --standalone` at line 120, and
    `export BENCH_SELFCHECK="${BENCH_SELFCHECK:-logic}"` (spec D6, D8, D9).
  - `harness/batch.sh`: `opencode_host_begin batch`, the traps,
    `opencode_host_run --version` at line 272, and
    `opencode-credential.sh seed` and `opencode_host_run models --standalone`
    at line 316.
  - `harness/run.sh`: `opencode_host_begin run` at the start of the agent
    branch, before line 904; `opencode_host_run --version` at line 606; and
    the cleanup call in the traps of lines 164 and 748. Lines 605 and 608
    keep the real binary path for `realpath` and `sha256sum`. The Podman
    argument list does not change.
  - `harness/cron-weekly.sh`: `opencode_host_begin weekly-cron` after the
    lock, the traps, and `opencode_host_run --version` at line 44.
  - `harness/weekly.sh`: `opencode_host_begin weekly` and the traps.
  - `harness/tests/meta/grade-exit.test.ts`: `60_000` to `180_000` at lines
    51 and 73 (spec D10).
  - The fake `opencode` binaries of `harness/tests/meta/` that the new
    argument lists or the `auth import` call break (spec FR-9). The
    assertions of those tests do not change.
  - `measure/runs/opencode_host_isolation/findings.md` (new): F1 to F7 of
    spec D12, one line each, with the source file and line.
  - Verify: each of the three files of task 1.1 passes alone, with the
    command of task 1.1. The task records each `Tests` line.
  - Verify: `bash -n harness/opencode-host.sh harness/opencode-credential.sh
    harness/cron-daily.sh harness/batch.sh harness/run.sh
    harness/cron-weekly.sh harness/weekly.sh` exits 0.
  - Verify: the two `rg` commands of spec FR-1 print the expected output.
  - Verify: `rg -n 'XDG_DATA_HOME|XDG_STATE_HOME' harness/cron-daily.sh
    harness/batch.sh harness/weekly.sh harness/cron-weekly.sh` prints no
    `export` line (spec D2).
  - Verify: `git diff --stat f55d2aa -- harness/opencode-entry.sh
    harness/go-cost.ts harness/execution-identity.ts harness/provenance.ts`
    prints no line (spec NFR-3, D11).
  - Lane: light. The maker runs only the three new test files.
  - Maker: `minimax-cn-coding-plan/MiniMax-M3.1-Flash`.
- [x] 1.3 The checker review. 9f48d0b. The checker reads the commits of tasks 1.1 and
  1.2 against spec D1 to D12 and FR-1 to FR-9. The checker reads each new
  test and confirms that it fails for the right cause on `f55d2aa`. It
  writes `measure/runs/opencode_host_isolation/check-1.3.json` with
  `status`, `retry_recommendation`, and each finding with its severity.
  - Verify: the file shows `status: pass` and 0 blocking findings.
  - Verify: this task records the maker model and the checker model, and
    the two sit in different families.
  - Lane: light. The checker changes no code.
  - Checker model: `claude-code/claude-sonnet-5-5#high` (Anthropic family).
  - Maker models: `minimax-cn-coding-plan/MiniMax-M3.1-Flash` (MiniMax
    family; `edb87cd`, `6f44bda`), `volcengine-agent-plan/glm-5.3-flash#high`
    (GLM family; `ffc6cb0`), and `kimi-code-plan-cn/kimi-for-coding#high`
    (Kimi family; `f87de82`, `46edf4c`). The checker family differs from
    every maker family.
  - Evidence of round 1 (2026-11-06): `measure/runs/opencode_host_isolation/check-1.3.json`,
    audited head `cf74ee3`. Status fail, recommendation retry_tests, 2
    blocking findings (F1, F2) and 5 non-blocking findings (F3-F7). F1-F4
    went to Red round 4 (`6f44bda`, `6f857df`).
  - Evidence of round 2 (2026-11-06): `measure/runs/opencode_host_isolation/check-1.3-r2.json`,
    audited head `9f48d0b`. Status pass, 0 blocking findings, 3 non-blocking
    findings: F7 carried with no change by decision; F8 (Nit: the `/dev/null`
    redirect of the seed hides the seed failure reason) with no change; F9
    (Nit: two inexact mutation claims in task 1.1, corrected under task 1.1
    in this plan). The `review-a` role gate on round 2 printed only
    `FAIL: current phase still has 4 non-deferred incomplete tasks` (the gate
    counts the whole phase); the gate text is not a finding against the
    checker result. F3-F6 went to Green round 2 (`46edf4c`, `9f48d0b`).
- [x] 1.4 The touched test files alone. 9f48d0b. After the fixes of task 1.3, run
  each new file of `harness/schedule-tests/` alone, outside the wrapper.
  - Command: `cd harness && npx vitest run schedule-tests/opencode-host-isolation.test.ts --configLoader native`.
  - Command: `cd harness && npx vitest run schedule-tests/opencode-host-trap.test.ts --configLoader native`.
  - Command: `cd harness && npx vitest run schedule-tests/daily-selfcheck-default.test.ts --configLoader native`.
  - Verify: each command exits 0 and prints a `Tests` line with no failed
    test. The task records the three `Tests` lines.
  - Evidence (2026-11-06, on `9f48d0b`, recorded in the checker round 2):
    `opencode-host-isolation.test.ts` gave `Tests  11 passed (11)`;
    `opencode-host-trap.test.ts` gave `Tests  4 passed (4)`;
    `daily-selfcheck-default.test.ts` gave `Tests  2 passed (2)`; each exit
    code was 0, and `ps -eo pid,args | grep '[f]ake-opencode'` printed no
    line after the runs.
  - Verify: after the three runs, `ps -eo pid,args | grep '[f]ake-opencode'`
    prints no line.
  - Lane: light. The touched files of `harness/tests/meta/` run in task 1.5,
    because `grade-exit.test.ts` runs `grade.sh`.
- [~] 1.5 The full suites through `heavy-run.sh`. Run once at the end of the
  code phase. It waits for the heavy-run queue; the orchestrator sends it
  after this round.
  - Command: `HEAVY_MIN_AVAIL_MB=1500 /home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh -c 'cd harness && npx vitest run schedule-tests/ --configLoader native && npm run test:meta:logic'`.
  - Verify: the run exits 0. The log holds a `Tests` line with no failed
    test for each of the two suites.
  - Verify: the log sits at
    `measure/runs/opencode_host_isolation/full-suite-1.5.log`.
  - Lane: light. One heavy run.
- [x] 1.6 The AFTER hashes (spec D11). 46edf4c. Run the hash command on the harness
  commit. Record both values.
  - Command: `cd harness && ./node_modules/.bin/tsx provenance.ts --shell`.
  - Verify: the command exits 0 and prints two hashes. EXIT=0 on
    2026-11-06.
  - Evidence (2026-11-06, harness commit `46edf4c`): `runner_sha256` AFTER is
    `82866758c8124de96b7ff8a1a9e9b58e907d9437525040639f81fef64f040cf4`; it
    differs from
    `f199cfb475061a01225ced93e01167b405e0202f9dc45282f8d4a0d044da0365`
    (`grader_system_chrome` task 1.4). `suite_sha256` AFTER is
    `8a24205b405a9aae22cf2412d3fc9a40b4b3ffdb30e2a0c0cfa26c4405ee734d`; it
    differs from
    `08d6ae6d7515e506b841111e2ffe7b3bc5d3f69c8da676f65c7b46bc8b2af20b`.
  - Verify: this task holds the two AFTER values and the SHA of the harness
    commit.
  - Lane: light. A read-only command.

## Phase 2: The live-day preflight

- [ ] 2.1 The dry run of the daily job with the service PATH. The run uses a
  recording shim. The shim appends one JSON line per call to
  `measure/runs/opencode_host_isolation/preflight-2.1-calls.jsonl` with the
  arguments, `HOME`, the four XDG variables, and `TMPDIR`. Then it runs
  `exec /home/daniebo/.nvm/versions/node/v24.19.0/lib/node_modules/@opencode/cli/bin/opencode.exe "$@"`.
  The shim sits at
  `measure/runs/opencode_host_isolation/opencode-env-shim.sh`. It records no
  output of OpenCode.
  - Before the run: record `sha256sum ~/.local/state/opencode/service.json`
    (only the hash) and `ps -eo pid,args | grep '[o]pencode'`.
  - Command: `HEAVY_MIN_AVAIL_MB=1500 HEAVY_PRIORITY=p2 /home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh -c 'cd /home/daniebo/Desktop/lending-desk-bench && env PATH=/home/daniebo/.local/share/pnpm/bin:/home/daniebo/.local/bin:/home/daniebo/.nvm/versions/node/v24.19.0/bin:/usr/local/bin:/usr/bin:/bin BENCH_OPENCODE_BIN=/home/daniebo/Desktop/lending-desk-bench/measure/runs/opencode_host_isolation/opencode-env-shim.sh harness/cron-daily.sh --dry-run'`.
  - Verify: the run exits 0. The log holds `DAILY DRY-RUN planned=<n>` with
    `<n>` above 0.
  - Verify: the log holds one `DAILY OPENCODE_HOME <path>` line, one
    `OPENCODE_HOME CLEANUP stopped=<n> path=<path>` line with the same path,
    and no `OPENCODE_HOME CLEANUP FAIL` line.
  - Verify: in the shim log, each line except one has `XDG_DATA_HOME` and
    `XDG_STATE_HOME` under
    `/home/daniebo/Desktop/lending-desk-bench/.tmp/opencode-host-daily-`.
    The one other line is `auth export --standalone opencode`, with no
    `XDG_DATA_HOME` and `HOME=/home/daniebo` (spec FR-3).
  - Verify: in the shim log, each `models` and `auth` line carries
    `--standalone` (spec FR-2).
  - Verify: after the run, `ps -eo pid,args | grep '[o]pencode'` prints only
    the OpenChamber server, and no `.tmp/opencode-host-daily-*` folder
    exists (spec FR-4).
  - Verify: the hash of `~/.local/state/opencode/service.json` equals the
    hash before the run. A plain OpenCode call on the shared store writes
    that file (spec EV2, EV4), so an equal hash shows that the job started
    no shared server.
  - Verify: when the log shows a usage error for
    `auth export --standalone opencode`, apply the fallback form of spec D3
    in a new commit, repeat tasks 1.4 and 1.5, and then repeat this task.
  - Verify: the log sits at
    `measure/runs/opencode_host_isolation/preflight-2.1.log`.
  - Lane: light. One heavy run.
- [ ] 2.2 The report to the PM. Send the result of Phase 1 and task 2.1, the
  AFTER hashes of task 1.6, the open owner question O1, and the findings F1
  to F7. Tell the `grader_system_chrome` orchestrator that its AFTER hashes
  moved (its risk R4).
  - Verify: the plan records the date of the send.
  - Verify: the report closes with a "facts changed" list. The list names
    the moved hashes and the new self-check of the daily job.
  - Lane: light. A text report.

## Phase 3: The live day of 2026-11-08

- [ ] 3.1 The record before the live day. On Sat 2026-11-07, after task 2.1,
  record the hash of `~/.local/state/opencode/service.json`, the output of
  `ps -eo pid,args | grep '[o]pencode'`, and the list of
  `.tmp/opencode-host-*` folders. Record `git rev-parse HEAD` and
  `systemctl --user list-timers lending-desk-daily.timer`.
  - Verify: `HEAD` holds the harness commit of task 1.2.
  - Verify: the timer shows the next start Sun 2026-11-08 01:00 +07.
  - Lane: light. A read-only check.
- [ ] 3.2 The live day uses the new setting (spec FR-10). Read the part of
  `reports/cron-daily.log` from the line `DAILY START 2026-11-08T01:00` to
  the next `DAILY END` line.
  - Verify: that part holds one `DAILY OPENCODE_HOME
    /home/daniebo/Desktop/lending-desk-bench/.tmp/opencode-host-daily-<pid>`
    line and one `OPENCODE_HOME CLEANUP stopped=<n> path=<same path>` line.
  - Verify: that part holds no `OPENCODE_HOME CLEANUP FAIL` line.
  - Verify: that part holds `SELF-CHECK <time> — test:meta:logic` and no
    `sensitivity controls` line (spec FR-6).
  - Verify: after the service ends, `ps -eo pid,args | grep '[o]pencode'`
    prints only the OpenChamber server, and no
    `.tmp/opencode-host-daily-*` folder exists.
  - Verify: the hash of `~/.local/state/opencode/service.json` equals the
    value of task 3.1.
  - Lane: light. The live day runs on its own timer. This task records it.
- [ ] 3.3 The close. Mark the track complete in `measure/tracks.md` and
  `metadata.json`. Send the result to the PM with a "facts changed" list.
  - Verify: the plan records the date of the send.
  - Lane: light. A text report.

## Human gates

- **O1.** Daniel picks the credential source of spec O1. Until then, the
  default of spec D4 applies.
- **The timer.** Only Daniel or the PM stops or changes
  `lending-desk-daily.timer`.
- **Each push.** No role pushes without the word "push" from Daniel.
- **Any deletion.** The stale `~/.local/state/opencode/service.json` (F5) and
  the size of the shared `opencode.db` (F6) wait for Daniel. The cleanup of
  spec D6 removes only job folders under `$ROOT/.tmp/opencode-host-`.

## Risks

- **The access token can expire during a long day.** The job store cannot
  refresh it. The `check-window` of each run fails closed (spec R1).
- **The flag place of `--standalone` is not proven for `auth`.** Task 2.1
  proves it, and spec D3 gives the fallback form.
- **The hashes move again.** The live day rescores in any case (spec EV12).
  Task 1.6 records the new values.
- **A hard kill runs no trap.** The sweep of spec D7 stops the rest at the
  next owner start.
- **Another session starts a shared server during a check.** The `service.json`
  check then fails with no fault of the harness. The shim log of task 2.1 is
  the second proof.
