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
- The deadline: tasks 1.1 to 1.11 finish before Sat 2026-11-07 23:00 +07
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

## Phase 1: The harness change (spec D1 to D15) [checkpoint: 14e88a4]

The checkpoint `b64376e` was removed from this heading on 2026-11-06: task
1.7/1.8 reopened the phase (spec D15), so the phase is open again. A new
checkpoint went on after task 1.11 as `[checkpoint: 14e88a4]` (the harness
code commit of tasks 1.8-1.11, verified by tasks 1.10 and 1.11).

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
  - Evidence of the round-5 Red fix on 2026-11-06. The cause: the seed
    diagnosis of task 2.1 (commit `d91ede6`) showed that the seed form
    `auth export --standalone opencode` exits 1 on this host with the line
    `Location plugins did not finish activating`. The spec D3 fallback form
    `auth export opencode --standalone` exits 0 on the same host. Green
    changed `harness/opencode-credential.sh` for that fallback. The Red test
    of the daily job held one exact-order seed assertion, so it rejected the
    fallback form.
  - The rule of round 5: the shared read of the daily job must equal one of
    the two forms of spec D3. The test uses `toContainEqual` with both forms.
    A grep of the three files of this track found no other exact-order seed
    assertion. Only `harness/schedule-tests/opencode-host-isolation.test.ts`
    changed. No production code changed.
  - The run of round 5 on 2026-11-06, with the Green change of
    `harness/opencode-credential.sh` in the tree, one foreground call:
    `cd harness && npx vitest run schedule-tests/opencode-host-isolation.test.ts --configLoader native`
    gave `Test Files  1 passed (1)` and `Tests  11 passed (11)`, `EXIT=0`.
    After the run, `ps -eo pid,args | grep '[f]ake-opencode'` printed no line.
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
  - Round 3 of Green (2026-11-06, commit `f62230d`): the task-1.5 heavy run
    found a fixture regression. Cause: `harness/cron-daily.sh:22` sources
    `harness/opencode-host.sh`, and the temp-tree fixtures of the older
    schedule tests copy a fixed file list into a temp `harness/` without
    `opencode-host.sh`; the job then died at line 22 with
    `opencode-host.sh: No such file or directory` and
    `DAILY FAIL opencode-home: ...`. Fix: `opencode-host.sh` was added to the
    copy list of `harness/schedule-tests/daily-schedule.test.ts` (three
    fixture sites) and `harness/schedule-tests/daily-schedule-green.test.ts`
    (one site). No assertion, expected line, or test name changed. Recorded
    deviation: plan task 1.2 named only the meta fakes; this extends the same
    rule to the schedule-tests fixtures.
  - Evidence of round 3 (2026-11-06, each file alone):
    - `daily-schedule.test.ts`: `Tests  107 passed (107)`, EXIT=0.
    - `daily-schedule-green.test.ts`: `Tests  4 passed (4)`, EXIT=0.
    - The three files of this track re-ran alone: `opencode-host-isolation.test.ts`
      `Tests  11 passed (11)`; `opencode-host-trap.test.ts` `Tests  4 passed (4)`;
      `daily-selfcheck-default.test.ts` `Tests  2 passed (2)`; each EXIT=0.
    - After the runs, `ps -eo pid,args | grep '[f]ake-opencode'` printed no
      line.
  - Round 4 of Green (2026-11-06, code commit `3bc5a79`): the spec D3
    fallback of the seed export form. Diagnosis `d91ede6` showed the first
    order `auth export --standalone opencode` fails in the job environment
    ("Location plugins did not finish activating" on each retry) while
    `auth export opencode --standalone` exits 0 against the shared store.
    The seed call in `harness/opencode-credential.sh` now uses the fallback
    order; the retry rule stays (3 calls, 5 s apart); `auth import
    --standalone` is unchanged (spec D3 names only the export form). One
    committed assertion in `opencode-host-isolation.test.ts:342` still
    demanded the first order; Green returned blocked, and Red round 5
    (`7c71f6c`) made the check accept both spec D3 forms with
    `toContainEqual`. After the Red fix the three track files re-ran alone:
    `opencode-host-isolation.test.ts` `Tests  11 passed (11)`;
    `opencode-host-trap.test.ts` `Tests  4 passed (4)`;
    `daily-selfcheck-default.test.ts` `Tests  2 passed (2)`; each EXIT=0;
    `ps -eo pid,args | grep '[f]ake-opencode'` printed no line. The FR-1 rg
    checks, the XDG export check, the NFR-3 diff check, and `bash -n` on the
    seven scripts all hold on the new commit.
  - Round 5 of Green (2026-11-06, code commit `18a942d`): checker round 4
    (`check-1.3-r4.json`, status pass, 0 blocking) routed F11-F12. F11: the
    job-store read of the helper is now `auth export opencode --standalone`,
    the same D3 fallback order as the seed, because the live day makes this
    read in each later helper process (batch preflight, run export,
    check-window) and the dry run never reaches it. After the change the
    three track files re-ran alone: `opencode-host-isolation.test.ts`
    `Tests  11 passed (11)`; `opencode-host-trap.test.ts`
    `Tests  4 passed (4)`; `daily-selfcheck-default.test.ts`
    `Tests  2 passed (2)`; each EXIT=0; `ps -eo pid,args |
    grep '[f]ake-opencode'` printed no line. The FR-1 rg checks, the XDG
    export check, the NFR-3 diff check, and `bash -n` hold on the new
    commit.
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
  - Rounds 3-5 of the checker (2026-11-06): `check-1.3-r3.json`,
    `check-1.3-r4.json`, and `check-1.3-r5.json`, all status pass with 0
    blocking findings. Open Nits: F7 (carried, no change by decision), F8
    (seed failure reason hidden by the `/dev/null` redirect), F12 (added the
    task-2.1 job-store proof step, done in run 2), F13 (run-2 seed retry,
    named under task 2.1), F14 (the `Permission denied` noise at
    `opencode-host.sh:34` from the `/proc` scan of another session's
    process, deferred), F15 (task 1.6 header now names `18a942d`).
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
  - Evidence of the D3-fallback re-run on 2026-11-06 (code commit `3bc5a79`,
    after the Red fix `7c71f6c`): `opencode-host-isolation.test.ts` gave
    `Tests  11 passed (11)`; `opencode-host-trap.test.ts` gave
    `Tests  4 passed (4)`; `daily-selfcheck-default.test.ts` gave
    `Tests  2 passed (2)`; each exit code was 0, and `ps -eo pid,args |
    grep '[f]ake-opencode'` printed no line.
  - Evidence of the F11 re-run on 2026-11-06 (code commit `18a942d`): the
    three files gave `Tests  11 passed (11)`, `Tests  4 passed (4)`, and
    `Tests  2 passed (2)`; each exit code was 0, and `ps -eo pid,args |
    grep '[f]ake-opencode'` printed no line.
  - Verify: after the three runs, `ps -eo pid,args | grep '[f]ake-opencode'`
    prints no line.
  - Lane: light. The touched files of `harness/tests/meta/` run in task 1.5,
    because `grade-exit.test.ts` runs `grade.sh`.
- [x] 1.5 The full suites through `heavy-run.sh`. 18a942d. It passed on the
  F11 commit; the heavy run waited for the queue.
  - Command: `HEAVY_MIN_AVAIL_MB=1500 /home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh -c 'cd harness && npx vitest run schedule-tests/ --configLoader native && npm run test:meta:logic'`.
  - Verify: the run exits 0. The log holds a `Tests` line with no failed
    test for each of the two suites.
  - Verify: the log sits at
    `measure/runs/opencode_host_isolation/full-suite-1.5.log`.
  - Lane: light. One heavy run.
  - Evidence of the run on 2026-11-06 (HEAD `b8d3ee6`, harness commit
    `46edf4c`, one foreground call, exit 1): the `schedule-tests/` suite ran
    and gave `Test Files  2 failed | 5 passed (7)` and
    `Tests  12 failed | 123 passed (135)`. The `test:meta:logic` suite did not
    run, because the `&&` chain stopped. The log sits at
    `measure/runs/opencode_host_isolation/full-suite-1.5.log`. After the run,
    `ps -eo pid,args | grep '[f]ake-opencode'` printed no line, and
    `ps -eo pid,args | grep -E '[o]pencode(\.exe)? serve'` printed only the
    OpenChamber server `opencode serve --hostname 127.0.0.1 --port 43003`.
    The three files of this track passed inside the run; the 12 failures sit
    in the daily-schedule files of the `daily_model_schedule` track.
  - Failed tests of the run, each with its first error line:
    - `daily-schedule-green.test.ts` > `stops with read failed when the quota
      compare process fails`: `AssertionError: expected 1 to be +0`.
    - `daily-schedule-green.test.ts` > `runs D12 steps 5 to 9 after a stop
      before batch 2`: `AssertionError: expected 1 to be +0`.
    - `daily-schedule-green.test.ts` > `passes one self-check marker to all
      four batches`: `AssertionError: expected 1 to be +0`.
    - `daily-schedule.test.ts` > `6.4.4 publish scope: the publish commit
      holds only docs/`: `/tmp/daily-schedule-JgEiQj/pub/harness/cron-daily.sh:
      line 22: /tmp/daily-schedule-JgEiQj/pub/harness/opencode-host.sh: No such
      file or directory` (then `DAILY FAIL opencode-home: the OpenCode job
      folder could not be made`).
    - `daily-schedule.test.ts` > `6.5.14 push at the parent: git push origin
      <sha>:main`: `expected [] to include 'push origin 06f00a0eabc…'`.
    - `daily-schedule.test.ts` > `6.5.15 other local commits: the job skips
      the push and keeps the commit local`: `expected [] to deeply equal
      [ Array(1) ]`.
    - `daily-schedule.test.ts` > `6.5.16 origin/main moved: the skip line is
      not other local commits`: `fatal: ambiguous argument
      'origin/main..HEAD~1'`.
    - `daily-schedule.test.ts` > `6.5.17 failed fetch: the commit stays local
      and the remote stays unchanged`: `expected [] to deeply equal
      [ 'DAILY PUSH skipped: fetch failed' ]`.
    - `daily-schedule.test.ts` > `6.5.23 resume record: counts, excluded,
      order, and last_test stay`: `the first run must write a day record:
      expected false to be true`.
    - `daily-schedule.test.ts` > `12.12 remote rejects the push: three
      attempts, exit 1, the commit stays local`: `must try the push three
      times: expected [] to deeply equal [ …(3) ]`.
    - `daily-schedule.test.ts` > `12.13 push race: the remote tip is the docs
      commit, not a later local commit`: `the wrapper must add the extra
      commit after the fetch: expected 'initial' to be 'race extra'`.
    - `daily-schedule.test.ts` > `12.18 monthly compare fault: only the
      monthly compare process fails (Review A F1)`: `missing D12
      BENCH_DAILY_QUOTA_CMD: expected [] to deeply equal [ 'DAILY SKIP
      go-guard: read failed' ]`.
  - Suspected root cause (no fix in this round): the daily-schedule fixtures
    copy `harness/cron-daily.sh` into a temp publish tree without
    `harness/opencode-host.sh`. The `source "$H/opencode-host.sh"` at
    `cron-daily.sh:22` then fails, `opencode_host_begin` is an unknown
    command, and the job exits 1 with `DAILY FAIL opencode-home` before the
    scenario steps. In a real deploy the two files sit next to each other, so
    the fail-fast path is right; the fixtures need `opencode-host.sh` in
    their copy list. A later round fixes this.
  - Evidence of round 2 on 2026-11-06 (HEAD `65924ea`, harness commit
    `f62230d`, one foreground call, exit 0): the run passed after the
    round-3 fixture fix (`f62230d`, `opencode-host.sh` copied into the
    schedule-test fixtures). Wall time about 17 min (11:46:28 to 12:03:35
    +07). The `schedule-tests/` suite gave `Test Files  7 passed (7)` and
    `Tests  135 passed (135)`; the `test:meta:logic` suite gave
    `Test Files  30 passed (30)` and `Tests  238 passed (238)`. The log sits
    at `measure/runs/opencode_host_isolation/full-suite-1.5-r2.log`; the
    failed first run stays as evidence at
    `measure/runs/opencode_host_isolation/full-suite-1.5.log`. After the run,
    `ps -eo pid,args | grep '[f]ake-opencode'` printed no line, and
    `ps -eo pid,args | grep -E '[o]pencode(\.exe)? serve'` printed only the
    OpenChamber server `opencode serve --hostname 127.0.0.1 --port 43003`.
  - Evidence of round 4 on 2026-11-06 (HEAD `ab5a9d1`, harness commit
    `18a942d`, one foreground call, exit 0): the run passed on the F11
    commit. Wall time about 16 min (14:03:42 to 14:20:02 +07). The
    `schedule-tests/` suite gave `Test Files  7 passed (7)` and
    `Tests  135 passed (135)`; the `test:meta:logic` suite gave
    `Test Files  30 passed (30)` and `Tests  238 passed (238)`. The run logs:
    `full-suite-1.5.log` (failed first run), `full-suite-1.5-r2.log` (pass
    on `f62230d`), `full-suite-1.5-r3.log` (pass on `3bc5a79`), and
    `full-suite-1.5-r4.log` (this pass). After the run,
    `ps -eo pid,args | grep '[f]ake-opencode'` printed no line, and
    `ps -eo pid,args | grep -E '[o]pencode(\.exe)? serve'` printed only the
    OpenChamber server `opencode serve --hostname 127.0.0.1 --port 43003`.
  - Evidence of round 3 on 2026-11-06 (HEAD `f550e49`, harness commit
    `3bc5a79`, one foreground call, exit 0): the run passed on the
    D3-fallback commit. Wall time about 16 min (13:19:29 to about 13:35:35
    +07). The `schedule-tests/` suite gave `Test Files  7 passed (7)` and
    `Tests  135 passed (135)`; the `test:meta:logic` suite gave
    `Test Files  30 passed (30)` and `Tests  238 passed (238)`. The log sits
    at `measure/runs/opencode_host_isolation/full-suite-1.5-r3.log`; the two
    earlier runs stay as evidence at `full-suite-1.5.log` (failed first run)
    and `full-suite-1.5-r2.log` (pass on `f62230d`). After the run,
    `ps -eo pid,args | grep '[f]ake-opencode'` printed no line, and
    `ps -eo pid,args | grep -E '[o]pencode(\.exe)? serve'` printed only the
    OpenChamber server `opencode serve --hostname 127.0.0.1 --port 43003`.
- [x] 1.6 The AFTER hashes (spec D11). 18a942d. The final values hold on
  this commit; the values recorded for `46edf4c` stay as history below.
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
  - Update (2026-11-06, harness commit `18a942d`, check-1.3-r4 F10): the
    values of commit `46edf4c` were stale since `3bc5a79` changed
    `opencode-credential.sh`. New values: `runner_sha256` is
    `56c9d61d1f1fb9e75f11602b44b656827451eb07b90cc42c5b5c7e2b66cd6944`
    (command exit 0); `suite_sha256` stays
    `8a24205b405a9aae22cf2412d3fc9a40b4b3ffdb30e2a0c0cfa26c4405ee734d`.
  - Verify: this task holds the two AFTER values and the SHA of the harness
    commit.
  - Lane: light. A read-only command.
- [x] 1.7 The Red test of the served-list retry (spec FR-11, D15). f4ed298
  c83cd92. Write the new file
  `harness/schedule-tests/daily-served-retry.test.ts`. The file puts a fake
  `opencode` on `PATH` and in `BENCH_OPENCODE_BIN`, the same rule as spec
  FR-7. The fake appends one JSON line per call to a record file. The test
  copies the scripts that it runs into a temp repo, the same as
  `harness/schedule-tests/rescore-guard.test.ts`. No test writes under the
  real `.tmp/`, `runs/`, or `reports/`. No test starts the real `opencode`
  binary, Podman, a browser, or a model.
  - Case 1, the transient path: the fake fails the first
    `models --standalone` call (exit 1, stderr
    `ServiceUnavailableError: Location plugins did not finish activating`)
    and passes the second call. The job reaches the dry-run plan with the
    seams `BENCH_DAILY_QUOTA_CMD` and `BENCH_DAILY_CATALOG`. The fake records
    exactly 2 `models` calls. Both carry `--standalone` and resolve the data
    folder under the job store.
  - Case 2, the fail path: the fake fails every `models` call. The job
    prints `DAILY FAIL served: opencode models failed` and exits 1 after
    exactly 3 calls.
  - Case 3, the empty-list path: the fake exits 0 and prints nothing on the
    first `models --standalone` call, and prints a model line on the second
    call. The job reaches the dry-run plan. The fake records exactly 2
    `models` calls. Both carry `--standalone` and resolve the data folder
    under the job store.
  - Each test sets a timeout of 120_000 ms.
  - The Red run on 2026-11-06 (one foreground call, shell timeout 600 s):
    `cd harness && npx vitest run schedule-tests/daily-served-retry.test.ts --configLoader native`
    gave `Test Files  1 failed (1)` and `Tests  2 failed (2)`, EXIT=1.
  - The failed tests, each with its first error line:
    - `retries the served list once and reaches the dry-run plan`:
      `AssertionError: the served list made 1 models calls instead of 2`.
    - `fails the daily job after three served-list calls`:
      `AssertionError: the served list made 1 models calls instead of 3`.
  - The cause: the served-list call of `harness/cron-daily.sh:140` makes one
    attempt only. The job stops at `DAILY FAIL served: opencode models failed`
    and exits 1. The stderr of the fake holds
    `ServiceUnavailableError: Location plugins did not finish activating`.
  - The rules of the test file: the fake file name holds `fake-opencode`, and
    the PATH name calls the same fake, so every child holds `fake-opencode` in
    its command line. The fake counts its `models` calls in its own count
    file. The job folder of each case sits under the temp repo, so no test
    writes under the real `.tmp/`, `runs/`, or `reports/`.
  - The process check after the run: `ps -eo pid,args | grep '[f]ake-opencode'`
    printed no line.
  - The tests fail on the current code (harness commit `18a942d`): the
    served-list call makes 1 attempt only, so case 1 sees 1 `models` call
    and case 2 sees the failure after 1 call.
  - Command: `cd harness && npx vitest run schedule-tests/daily-served-retry.test.ts --configLoader native`.
  - Verify: the run fails on the current code. The task records the
    `Tests` line and the names of the failed tests. After the run,
    `ps -eo pid,args | grep '[f]ake-opencode'` prints no line.
  - Round 2 (2026-11-06, the finding F16 of `check-1.9.json`, status fail,
    1 blocking). The checker found that no case covered the empty-list clause
    of D15, so a retry that tests only the exit status passed both old cases.
    Round 2 adds case 3 to `harness/schedule-tests/daily-served-retry.test.ts`
    and changes the fake only. No production code changed.
  - The run of round 2 on 2026-11-06 (one file, one worker, one foreground
    call, shell timeout 600 s):
    `cd harness && npx vitest run schedule-tests/daily-served-retry.test.ts --configLoader native --maxWorkers=1`
    gave `Test Files  1 passed (1)` and `Tests  3 passed (3)`, EXIT=0.
  - The three test names of the file: `retries the served list once and
    reaches the dry-run plan`; `fails the daily job after three served-list
    calls`; `retries the served list after an empty list and reaches the
    dry-run plan`.
  - The wrong code change that case 3 catches: a retry that tests only the
    exit status, as `harness/batch.sh:322-336` does. That retry makes 1
    `models` call and stops at `DAILY FAIL served: opencode models failed`,
    because the test `[ ! -s "$SERVED_TMP" ]` never triggers a retry. Case 3
    then fails with `the served list made 1 models calls instead of 2` and
    with the exit status 1. This round ran no mutation. The sentence is the
    read of the code.
  - The fix of the finding F19: the reach step of case 1 now names only the
    dry-run plan. The word `or` is gone.
  - The process check after the run of round 2: `ps -eo pid,args | grep
    '[f]ake-opencode'` printed no line.
  - Lane: light. Only this file runs outside the heavy-run wrapper.
  - Maker: `minimax-cn-coding-plan/MiniMax-M3.1-Flash`.
- [x] 1.8 The Green code of the served-list retry (spec D15, FR-11). 14e88a4.
  The
  retry goes into `harness/cron-daily.sh` only: up to 3 calls of
  `opencode_host_run models --standalone` into the served temp file, 5 s
  apart, while the call exits non-zero or writes an empty list. A
  non-empty list stops the retry at once. After the third failure the job
  prints the existing line `DAILY FAIL served: opencode models failed` and
  exits 1. Each retry keeps `--standalone` and the job store (spec D2,
  D3).
  - The maker also appends the finding F8 of spec D12 to
    `measure/runs/opencode_host_isolation/findings.md`, one line with the
    source. This is a Measure evidence file, not harness code.
  - Verify: the new file of task 1.7 and the three track files of tasks
    1.1 to 1.4 pass alone, each with its command of task 1.4. The task
    records each `Tests` line.
  - Verify: `bash -n harness/cron-daily.sh` exits 0.
  - Verify: the two `rg` commands of spec FR-1 print the expected output.
  - Lane: light. The maker runs only the four schedule-test files.
  - Maker: `kimi-code-plan-cn/kimi-for-coding#high`.
  - Evidence of the Green run on 2026-11-06 (each file alone, shell timeout
    600 s): `daily-served-retry.test.ts` `Tests  2 passed (2)`;
    `opencode-host-isolation.test.ts` `Tests  11 passed (11)`;
    `opencode-host-trap.test.ts` `Tests  4 passed (4)`;
    `daily-selfcheck-default.test.ts` `Tests  2 passed (2)`; each EXIT=0;
    `ps -eo pid,args | grep '[f]ake-opencode'` printed no line. `bash -n` on
    the seven scripts exits 0 (OK). The two `rg` commands of spec FR-1 print
    the expected output (the first no line; the second exactly one line,
    `harness/opencode-credential.sh:175`, the seed shared read). The retry
    keeps the stderr of the `models` call in the job log (no `2>/dev/null`),
    so the live-day log keeps the diagnostic text of a failed call; spec D15
    names no redirect.
- [x] 1.9 The checker review of the amendment. 32f2b84. The checker reads the
  amendment of `spec.md` and `plan.md` (D15, FR-11, AC-11, F8, EV15) and
  the code of tasks 1.7 and 1.8 against them. It writes
  `measure/runs/opencode_host_isolation/check-1.9.json` with `status`,
  `retry_recommendation`, and each finding with its severity.
  - Verify: the file shows `status: pass` and 0 blocking findings.
  - Verify: this task records the maker models and the checker model, and
    the checker family differs from every maker family.
  - Round 1 (2026-11-06, checker `claude-code/claude-sonnet-5-5#high`, audited
    head `948b7d6`): `measure/runs/opencode_host_isolation/check-1.9.json` holds
    the status fail, the recommendation `retry_tests`, 1 blocking finding, and
    7 non-blocking findings. The blocking finding is F16: no case covered the
    empty-list clause of D15, so a retry that tests only the exit status
    passed both old cases.
  - The Red round 2 of task 1.7 (`c83cd92`) adds that case. The run of the
    round (one file, one worker, one foreground call):
    `daily-served-retry.test.ts` `Tests  3 passed (3)`, EXIT=0. The finding
    F19 (the word `or` in the reach step of case 1) is fixed in the same
    round. The finding F16 asks also for a new Check text of FR-11 in
    `spec.md`; the spec is not a file of this role, so the orchestrator owns
    that change.
  - Lane: light. The checker changes no code.
  - Checker model: `claude-code/claude-sonnet-5-5#high`.
- [x] 1.10 The full suites through `heavy-run.sh` again. 14e88a4. On the commit of
  task 1.8. It ran inside the PM A-23 window (no p1 waiter at
  15:57:49).
  - Evidence of the run on 2026-11-06 (one foreground call, exit 0): wall
    time about 17 min (15:59:29 to 16:16:05 +07). The `schedule-tests/`
    suite (now 8 files, with `daily-served-retry.test.ts`) gave
    `Test Files  8 passed (8)` and `Tests  138 passed (138)`; the
    `test:meta:logic` suite gave `Test Files  30 passed (30)` and
    `Tests  238 passed (238)`. The log sits at
    `measure/runs/opencode_host_isolation/full-suite-1.10.log`. After the
    run, `ps -eo pid,args | grep '[f]ake-opencode'` printed no line, and
    `ps -eo pid,args | grep -E '[o]pencode(\.exe)? serve'` printed only the
    OpenChamber server `opencode serve --hostname 127.0.0.1 --port 43003`.
  - Command: the command of task 1.5.
  - Verify: the run exits 0. The log holds a `Tests` line with no failed
    test for each of the two suites. The log sits at
    `measure/runs/opencode_host_isolation/full-suite-1.10.log`.
  - PM rule A-23 (2026-11-06): the full suite runs only after 22:00, or
    when no p1 job waits for the lock (`pgrep -af '[f]lock -w 600'` shows
    none).
  - Lane: light. One heavy run.
- [x] 1.11 The AFTER hashes again (spec D11), on the commit of task 1.8. 14e88a4.
  - Command: the command of task 1.6.
  - Evidence (2026-11-06, harness commit `14e88a4`, command exit 0):
    `runner_sha256` is
    `56c9d61d1f1fb9e75f11602b44b656827451eb07b90cc42c5b5c7e2b66cd6944` —
    it stays equal to the value of `18a942d`, because `harness/cron-daily.sh`
    is not in the `runner_sha256` list of `harness/provenance.ts` (spec
    EV11: it sits in neither hash list). `suite_sha256` is
    `8a24205b405a9aae22cf2412d3fc9a40b4b3ffdb30e2a0c0cfa26c4405ee734d` —
    it equals the expected value, because no file under `harness/tests/`
    changed since `46edf4c` (the task-1.7/-1.8 test file lives under
    `harness/schedule-tests/`, which is not in the suite list either).

## Phase 2: The live-day preflight [checkpoint: 14e88a4]

- [x] 2.1 The dry run of the daily job with the service PATH. 14e88a4. The run uses a
  recording shim. The shim appends one JSON line per call to
  `measure/runs/opencode_host_isolation/preflight-2.1-calls.jsonl` with the
  arguments, `HOME`, the four XDG variables, and `TMPDIR`. Then it runs
  `exec /home/daniebo/.nvm/versions/node/v24.19.0/lib/node_modules/@opencode/cli/bin/opencode.exe "$@"`.
  The shim sits at
  `measure/runs/opencode_host_isolation/opencode-env-shim.sh`. It records no
  output of OpenCode.
  - Evidence of the round on 2026-11-06 (HEAD `b64376e`, harness commit
    `46edf4c`): the run exited 1. Two runs were made; the first run's shim had
    an argv defect (it recorded the record path, not the arguments) and its
    log stays as evidence at `preflight-2.1-r1.log` / `preflight-2.1-calls-r1.jsonl`.
    The shim was fixed (it passes `"$@"` to node and records
    `process.argv.slice(2)`), and the second run recorded the arguments. Both
    runs failed the same way, and the second run is the record:
  - Verify: the run exits 0 — FAIL. The log holds `DAILY FAIL catalog: the
    catalog fetch failed` (exit 1); the run stopped at the catalog fetch,
    before the served list and before the dry-run batches.
  - Verify: `DAILY DRY-RUN planned=<n>` with `<n>` above 0 — FAIL (the line is
    absent; the run stopped earlier).
  - Verify: one `DAILY OPENCODE_HOME <path>` line and one
    `OPENCODE_HOME CLEANUP stopped=0 path=<same path>` line, no
    `OPENCODE_HOME CLEANUP FAIL` line — PASS. The path was
    `.tmp/opencode-host-daily-2388944`; the cleanup removed the folder.
  - Verify (shim log, FR-3 isolation of the calls): PARTIAL. The run made
    three calls only, all the seed retries of the form
    `["auth","export","--standalone","opencode"]` with `HOME=/home/daniebo`
    and no XDG variable — exactly the D4 seed form. No `models` call ran, so
    the job-folder check has no non-seed line to test.
  - Verify (FR-2): each `auth` line carries `--standalone` — PASS (the three
    lines are `auth export --standalone opencode`).
  - Verify: after the run, `ps -eo pid,args | grep '[o]pencode'` prints only
    the OpenChamber server, and no `.tmp/opencode-host-daily-*` folder exists
    — PASS.
  - Verify: the hash of `~/.local/state/opencode/service.json` equals the
    hash before the run — PASS. Both are
    `047e87b91d193b68bf0a9dc61111a4e6c7b79e44a5eae0cd475cc0acadc39b67`.
  - Verify: the D3 fallback trigger — TRIGGERED. The seed's
    `auth export --standalone opencode` failed three times against the real
    opencode v2.2.4, with the caller's own HOME and no XDG (spec D4), while
    the old production form `auth export opencode` worked on this store (the
    catalog fetch worked daily before 2026-11-06). The `--standalone` flag
    after `export` is the only changed variable (spec R2). The fallback form
    `auth export opencode --standalone` of spec D3 applies in a new commit,
    then tasks 1.4 and 1.5 repeat, then this task repeats. This round does
    not apply the fallback; the orchestrator routes it.
  - Evidence of run 4 on 2026-11-06 (HEAD `00ef15d`, harness commit
    `14e88a4`, exit 0; run log `preflight-2.1-r4.log`, shim log
    `preflight-2.1-r4-calls.jsonl`): the run with the seam
    `BENCH_DAILY_QUOTA_CMD=quota-in-range.sh` (weekly 20, monthly 50) holds
    `DAILY GO-GUARD weekly=20 monthly=50` and `DAILY DRY-RUN planned=12`;
    one `DAILY OPENCODE_HOME .tmp/opencode-host-daily-2842610` line and one
    `OPENCODE_HOME CLEANUP stopped=0 path=<same>` line, no `CLEANUP FAIL`.
    The shim log holds 4 lines: two shared-home seed exports (the seed
    retried once after `Location plugins did not finish activating`, spec D4
    retry rule), one job-store `auth import --standalone`, and one job-store
    `models --standalone` (the D15 retry was not needed; the models call
    succeeded at the first attempt). Every `models`/`auth` line carries
    `--standalone`. The `service.json` hash equaled the before-run hash
    `047e87b91d...`, only the OpenChamber server remained, and no job folder
    was left. Every Verify of this task passes in run 4.
  - Summary of runs 2-4: run 2 proved the isolation end to end (exit 0, one
    successful shared read, job-store import and models, cleanup, hash
    equal) and the F12 job-store proof (CW1=0, CW2=0; one shared line, one
    job-store `auth export opencode --standalone` line); its only open
    Verify was "planned above 0", blocked by the live monthly quota of 80.8
    percent. Run 3 (before the D15 retry existed) failed twice at the served
    list with `ServiceUnavailableError: Location plugins did not finish
    activating` — the fault that D15 answers. Run 4 passes every Verify on
    the D15 code. Recorded deviation: the seam replaces only the quota read;
    the live day uses the real guard, which reads 80.8 % on 2026-11-06 and
    will skip the day until it drops below 80 or the owner changes the
    guard.
  - Verify: the log sits at
    `measure/runs/opencode_host_isolation/preflight-2.1.log` — PASS.
  - Evidence of run 2 on 2026-11-06 (HEAD `7ba32ed`, harness commit
    `18a942d`; run log `preflight-2.1-r2.log`, shim log
    `preflight-2.1-r2-calls.jsonl`; run 1 stays as evidence): the run exited
    0. It holds `DAILY OPENCODE_HOME
    /home/daniebo/Desktop/lending-desk-bench/.tmp/opencode-host-daily-2655857`
    and `OPENCODE_HOME CLEANUP stopped=0 path=<same>`, and no
    `OPENCODE_HOME CLEANUP FAIL` line. It holds `DAILY DRY-RUN planned=0`
    with `DAILY SKIP go-guard: monthly used 80.79950906666666 percent` — the
    live monthly quota is above 80, so the guard stopped the day by design
    and the "planned above 0" Verify did not pass for an environmental
    reason, not a harness fault. The shim log holds 4 lines: two
    `auth export opencode --standalone` lines with `HOME=/home/daniebo` and
    no XDG (the seed; the first attempt failed with the known transient
    plugin notice and the retry rule succeeded on the second attempt, spec
    D4), one `auth import --standalone` line, and one
    `models --standalone` line, both under
    `.tmp/opencode-host-daily-2655857`. Every `models` and `auth` line
    carries `--standalone`. After the run, `ps -eo pid,args | grep
    '[o]pencode'` printed only the OpenChamber server, no
    `.tmp/opencode-host-daily-*` folder existed, and the hash of
    `~/.local/state/opencode/service.json` equaled the before-run hash
    `047e87b91d193b68bf0a9dc61111a4e6c7b79e44a5eae0cd475cc0acadc39b67`.
  - Evidence of the F12 job-store proof on 2026-11-06 (proof log
    `jobstore-proof-2.1.log`, shim log `jobstore-proof-2.1-calls.jsonl`,
    job name `diag`): CW1=0 and CW2=0. The shim log holds exactly one
    shared-home line (the seed, `auth export opencode --standalone` with
    `HOME=/home/daniebo`) and exactly one job-store
    `auth export opencode --standalone` line under
    `.tmp/opencode-host-diag-2656614` (the second check-window read; the
    first reused the seed payload), plus one job-store `auth import
    --standalone` line. `opencode_host_cleanup` printed
    `OPENCODE_HOME CLEANUP stopped=0 path=<the diag folder>`; after it, no
    opencode process except the OpenChamber server existed, no
    `.tmp/opencode-host-diag-*` folder existed, and the `service.json` hash
    was unchanged.
  - Read of run 2: every Verify of this task passed except "planned above
    0", which the live monthly quota (80.8 percent) blocks. The task stays
    `[~]`; the PM sees the quota fact in the task 2.2 report.
  - Evidence of run 3 on 2026-11-06 (seam run, harness commit `18a942d`; two
    attempts, logs `preflight-2.1-r3a.log` / `-r3b.log` with shim logs
    `preflight-2.1-r3a-calls.jsonl` / `-r3b-calls.jsonl`): the seam
    `quota-in-range.sh` prints one fixed reading, weekly 20 and monthly 50
    percent, and makes no network call. Both attempts exited 1 at the served
    list: `DAILY FAIL served: opencode models failed`, with the real error
    `ServiceUnavailableError: Location plugins did not finish activating`
    from `opencode models --standalone` in the job store. The isolation
    itself was correct in both attempts (seed + import + models, all with the
    right folders and `--standalone`; service.json hash unchanged at
    `047e87b91d...`; only the OpenChamber server after; no job folder left).
    Run 2 at 14:56 proves the same path end to end (exit 0), so the blocker
    is the host-level plugin flakiness, not the harness. The `models` call of
    the served list has no retry (the old code had none either); a retry
    rule there is a routed decision for the orchestrator, with the live day
    in mind. The task stays `[~]`; the seam and its deviation line are ready
    for the next attempt: "the seam replaces only the quota read; the live
    day uses the real guard, which reads 80.8 % on 2026-11-06 and will skip
    the day until it drops below 80 or the owner changes the guard".
  - check-1.3-r5 F13: the summary names the exception — 2 shared-home lines
    in run 2, because the seed retried once after
    `Location plugins did not finish activating` (spec D4 retry rule).
  - Diagnosis 2 (2026-11-06, cwd A/B; PM correction applied): the
    orchestrator's hypothesis was that `opencode_host_run` keeps cwd = the
    repository root, so a host call sees the untracked project folder
    `.opencode/` and a `--standalone` server fails on slow project
    ("location") plugin activation. Arm A ran before the PM correction
    arrived (5 calls, cwd = the repository root, isolated store under
    `.tmp/oc-diag2-RRhotZ`, `models --standalone`): all 5 EXIT=0, stderr 0
    bytes. Per the correction, Arm B did not run and the A/B test is not
    repeated. `ps` after the arm held only the OpenChamber server (pid
    2558); no process of the temp folder remained; the folder was removed.
    The read-only check of `.opencode/` listed one newer file,
    `.opencode/goals/state.json.lock` (a transient lock file). Read: cwd =
    the repository root does not reproduce the plugin failure with an
    isolated store, so the hypothesis is not supported; the flakiness is
    host-level and timing-bound (run 2 at 14:56 exited 0 through the same
    path; runs at 15:07 and 15:10 failed).
  - Run 4, after task 1.10: the dry run with the seam
    `BENCH_DAILY_QUOTA_CMD` (the script
    `measure/runs/opencode_host_isolation/quota-in-range.sh`, weekly 20,
    monthly 50), the shim, and the service PATH, through heavy-run p2, on
    the harness commit of task 1.8.
  - Verify (run 4): the run exits 0. The log holds `DAILY DRY-RUN
    planned=<n>` with `<n>` above 0. Every isolation Verify of run 2 holds:
    the `DAILY OPENCODE_HOME` and cleanup lines, the shim-log folder and
    `--standalone` checks, the `ps` check, and the unchanged
    `service.json` hash.
  - Recorded deviation (check-1.3-r4 F12): the dry run cannot reach a
    job-store read, because the catalog fetch of the real `go-cost.ts`
    needs the credential first. Job-store proof: in one heavy-run call with
    the service PATH and the shim, run
    `bash -c 'source harness/opencode-host.sh && opencode_host_begin diag && harness/opencode-credential.sh check-window; echo CW1=$?; harness/opencode-credential.sh check-window; echo CW2=$?; opencode_host_cleanup'`.
    `opencode_host_begin` accepts the job name `diag` (it accepts any
    non-empty name). Verify: CW1=0 and CW2=0; the shim log holds exactly
    one shared-home line (the seed) and one job-store
    `auth export opencode --standalone` line under
    `.tmp/opencode-host-diag-`; after it, no opencode process except the
    OpenChamber server, no `.tmp/opencode-host-diag-*` folder, and the
    `service.json` hash is unchanged.
  - Seed diagnosis (2026-11-06, no code change; calls in the round brief only,
    stdout to /dev/null, stderr files `diag-2.1-a.err` / `diag-2.1-b.err`):
    - Help of `opencode auth export` in an isolated store: USAGE
      `opencode auth export [flags] [<target>]`, and `--standalone` is a
      GLOBAL FLAG. EXIT=0. No process of the isolated store appeared; `ps`
      held only the OpenChamber server (pid 2558).
    - The seed form `auth export --standalone opencode` against the shared
      store, caller's own environment: EXIT=1. Stderr first line:
      `Location plugins did not finish activating` (43 bytes; no token-like
      value). `ps` held only the OpenChamber server. This is the known
      transient plugin notice of the retry rule, not a usage error.
    - The D3 fallback form `auth export opencode --standalone`, same rules:
      EXIT=0, empty stderr. `ps` held only the OpenChamber server. No
      detached server started.
    - Read: the seed failure is not a parse or usage error; the fallback form
      matches the documented order and works against the shared store now.
      The spec D3 procedure applies: the fallback form goes into
      `opencode-credential.sh` in a new commit, then tasks 1.4 and 1.5
      repeat, then this task repeats. Whether the fallback also cures the
      plugin flakiness inside the job environment is proven by the repeated
      preflight only.
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
    The one other line is the seed read in the spec D3 fallback order
    `auth export opencode --standalone`, with no `XDG_DATA_HOME` and
    `HOME=/home/daniebo` (spec FR-3, D3).
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
- [x] 2.2 The report to the PM. 6de9a50. The orchestrator sent the report
  on 2026-11-06 at about 14:58 +07. It held the result of Phase 1 and task
  2.1, the AFTER hashes of task 1.6, the open owner question O1, and the
  findings F1 to F7. The "facts changed" list named: the new local commits
  of this track; `runner_sha256` now `56c9d61d…66cd6944`; the daily
  self-check now `logic`; the 2026-11-08 run will skip on the Go guard at
  the current monthly quota; the next possible good run Sun 2026-11-22
  01:00. The open owner questions: O1 (the credential source) and the guard
  limit. The `grader_system_chrome` orchestrator (the same session) knows
  that its AFTER hashes moved (its risk R4).
  - Verify: the plan records the date of the send.
  - Verify: the report closes with a "facts changed" list. The list names
    the moved hashes and the new self-check of the daily job.
  - Lane: light. A text report.

## Phase 3: The live day of 2026-11-08

- [x] 3.1 The record before the live day. cfc0afb. On Sat 2026-11-07, after task 2.1,
  record the hash of `~/.local/state/opencode/service.json`, the output of
  `ps -eo pid,args | grep '[o]pencode'`, and the list of
  `.tmp/opencode-host-*` folders. Record `git rev-parse HEAD` and
  `systemctl --user list-timers lending-desk-daily.timer`.
  - Evidence of the record on 2026-11-07 03:23 +07 (HEAD `cfc0afb`; log
    `measure/runs/opencode_host_isolation/record-3.1.log`): the hash of
    `service.json` is
    `833140b40b299e5ecdc4d28c2b66bbea6429cda1f91a47ba6aeca70fe7a35e89`;
    its mtime is 2026-11-06 19:04:04 +07 and its size is 165 bytes. The glob
    `.tmp/opencode-host-*` matched no folder. `git rev-parse HEAD` gave
    `cfc0afb9a098d1e0df2d640f8f1d45f57b6fd8ac`. The ps list holds the
    OpenChamber server pid 2558 and the detached service pid 3179063. It also
    holds three shell wrappers of another project (pids 52178, 52179, 52180),
    whose command line holds the path `/tmp/opencode/tsc-run-p3b.sh`. A later
    read of those three pids printed no line, so the wrappers had ended.
  - Verify: `HEAD` holds the harness commit of task 1.2 — PASS. The title
    line of task 1.2 holds `f87de82` (the Green code) and `46edf4c` (its
    round-2 fix). `git merge-base --is-ancestor f87de82 HEAD` exited 0, and
    `git merge-base --is-ancestor 46edf4c HEAD` exited 0.
  - Verify: the timer shows the next start Sun 2026-11-08 01:00 +07 — PASS.
    `systemctl --user list-timers lending-desk-daily.timer` printed
    `Sun 2026-11-08 01:00:00 +07` as the NEXT value.
  - Deviation: the hash differs from the run-4 value of task 2.1
    (`047e87b91d193b68bf0a9dc61111a4e6c7b79e44a5eae0cd475cc0acadc39b67`).
    The cause is the detached service pid 3179063. It started Fri 2026-11-06
    19:04:02 +07 with ppid 1571 and it rewrote `service.json` at
    2026-11-06 19:04:04 +07. Its environ holds
    `PWD=/home/daniebo/Desktop/advantage-pr` and no `BENCH_OPENCODE_JOB`
    line. A session of the advantage-pr project started that process, and the
    bench did not start it. Task 3.2 compares the hash with this 3.1 value.
    A later change by a process without the `BENCH_OPENCODE_JOB` marker is
    outside the bench.
  - Lane: light. A read-only check.
- [ ] 3.2 The live day uses the new setting (spec FR-10). Read the part of
  `reports/cron-daily.log` from the line `DAILY START 2026-11-08T01:00` to
  the next `DAILY END` line.
  Note (2026-11-08): the run of 2026-11-08 01:00 stopped at the seed (spec EV16). This task reads the first live day after Phase 4, Wed 2026-11-11 01:00 or later.
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

## Phase 4: The seed back-off and the quiet environ read (spec D16 to D18)

- [ ] 4.1 The Red tests (spec FR-12 to FR-14). Write three new files:
  - `harness/schedule-tests/credential-seed-backoff.test.ts` (FR-12): a
    fake `opencode` drives the seed of a copied helper with
    `BENCH_CREDENTIAL_SEED_DELAYS="0 0 0 0"`. The cases prove the attempt
    lines, the reasons, the counts, the exit codes, and the absence of the
    credential payload on stderr (EV16, the line-179 leak).
  - `harness/schedule-tests/catalog-fetch-retry.test.ts` (FR-13): a fake
    `fetchImpl` drives `fetchCatalogIds`. The cases prove the retry rule,
    the lines, the throws, and that no line holds the token.
  - `harness/schedule-tests/opencode-host-quiet-environ.test.ts` (FR-14):
    a fake proc root proves the read fault of one `environ` file is quiet
    and skips that pid; the real `/proc` case proves no `environ` text on
    stderr.
  Each test copies what it runs into a temp repo, the same as
  `harness/schedule-tests/daily-served-retry.test.ts`. Each test sets a
  timeout of 120_000 ms. No test writes under the real `.tmp/`, `runs/`,
  or `reports/`. No test starts the real `opencode`, Podman, a browser, or
  a model. The fake file name holds `fake-opencode`.
  - Command for each file, from `harness/`, one worker:
    `npx vitest run schedule-tests/<file> --configLoader native --maxWorkers=1`.
  - Verify: each of the three files fails on the current code for the
    expected reason. The task records the three commands, each `Tests`
    line, each failed test name with its first error line, and the process
    check.
  - Verify: after the runs, `ps -eo pid,args | grep '[f]ake-opencode'`
    prints no line.
  - Evidence of the Red run on 2026-11-08 on `dd81e58` (each file alone,
    one worker, one foreground call, shell timeout 600 s, workdir
    `harness/`):
    - `npx vitest run schedule-tests/credential-seed-backoff.test.ts --configLoader native --maxWorkers=1`
      gave `Test Files  1 failed (1)` and `Tests  4 failed (4)`, EXIT=1.
      The failed tests, each with its first error line:
      - `retries three failed exports and seeds on the fourth call`:
        `AssertionError: the seed exited 2`. The helper made 3 export calls
        and printed no `seed attempt` line.
      - `fails after five calls when every export exits 1 with no stderr`:
        `AssertionError: the seed did not make 5 export calls: expected 3
        to be 5`.
      - `reports timeout for a 124 exit and seeds on the next call`:
        `AssertionError: the seed wrote 0 attempt lines instead of 1`.
      - `reports exit 1 for a good print with a non-zero exit and does not
        leak`: `AssertionError: the seed exited 2`. The stderr held the
        payload line `[{"integrationID":"opencode","active":true,"value":
        {"access":"fake-access-T0KEN-41","refresh":"inert",...` (the
        line-179 leak of EV16; the values are fake strings).
    - `npx vitest run schedule-tests/catalog-fetch-retry.test.ts --configLoader native --maxWorkers=1`
      gave `Test Files  1 failed (1)` and `Tests  5 failed (5)`, EXIT=1.
      The failed tests: `retries a network throw once and returns the ids`;
      `retries two 5xx statuses and returns the ids on the third call`;
      `throws Go catalog HTTP 503 after three failed calls`; `throws Go
      catalog HTTP 401 at once on a non-retryable status`; `carries the
      authorization header on every call and never prints the token`. Each
      first error line: `TypeError: fetchCatalogIds is not a function`.
    - `npx vitest run schedule-tests/opencode-host-quiet-environ.test.ts --configLoader native --maxWorkers=1`
      gave `Test Files  1 failed (1)` and `Tests  2 failed (2)`, EXIT=1.
      The failed tests, each with its first error line:
      - `skips an unreadable environ in the fake proc root and prints the
        marker match alone`: `AssertionError: the marked pids printed the
        wrong pids (stderr: .../opencode-host.sh: line 34:
        /proc/1571/environ: Permission denied`. The stdout was empty, not
        `4243`: the current code ignores `BENCH_OPENCODE_PROC`.
      - `reads the real proc table with no environ text on stderr`:
        `AssertionError: the real proc scan wrote environ text to stderr:
        expected '...' not to match /environ/` (the pid-1571 line). On a
        host without such a pid the case passes trivially.
    - S2 tightening: the test asserts the last `opencode-credential:`
      line, not the last stderr line, because the helper EXIT trap prints
      the `OPENCODE_HOME CLEANUP` line on stderr after the seed-failed
      line.
    - After the runs, `ps -eo pid,args | grep '[f]ake-opencode'` printed
      no line.
    - The raw run logs sit at `/tmp/opencode/red-4.1/seed-red.log`,
      `/tmp/opencode/red-4.1/catalog-red.log`, and
      `/tmp/opencode/red-4.1/qenviron-red.log`.
  - Deviation: measure-guard denied `[~]` in Phase 4 while Phase 3 holds
    no checkpoint, so the task went from `[ ]` to `[x]`. The orchestrator
    records the phase-order block. The heading of "Phase 3: The live day
    of 2026-11-08" stays without `[checkpoint: <sha>]`, and tasks 3.2 and
    3.3 keep their markers.
  - Maker: `bailian-token-plan/qwen3.8-flash#high`.
  - Lane: light. Red `bailian-token-plan/qwen3.8-flash#high` (spec D13,
    Phase 4).
- [ ] 4.2 The Green code (spec D16 to D18). The changes go into
  `harness/opencode-credential.sh`, `harness/go-cost.ts`, and
  `harness/opencode-host.sh` only.
  - Verify: each of the 3 new files passes alone; the 4 older
    schedule-test files of this track pass alone;
    `harness/tests/meta/opencode-credential.test.ts` and
    `harness/tests/meta/go-cost.test.ts` pass alone; each run uses
    `--maxWorkers=1`; `bash -n` exits 0 on the two scripts; the two `rg`
    commands of FR-1 print the expected output. The task records each
    `Tests` line.
  - Lane: light. Maker: `volcengine-agent-plan/glm-5.3-flash#high` (spec
    D13, Phase 4).
- [ ] 4.3 The checker review of the amendment and of tasks 4.1 and 4.2. The
  checker reads the amendment of `spec.md` and `plan.md` (EV16, D16 to
  D18, FR-12 to FR-14, AC-12 to AC-14) and the files of tasks 4.1 and 4.2
  against them. It writes
  `measure/runs/opencode_host_isolation/check-4.3.json` with `status`,
  `retry_recommendation`, and each finding with its severity.
  - Verify: `measure/runs/opencode_host_isolation/check-4.3.json` shows
    status pass and 0 blocking findings.
  - Verify: the checker family differs from every maker family.
  - Lane: light. The checker changes no code. Checker:
    `claude-code/claude-sonnet-5-5#high` (spec D13, Phase 4).
- [ ] 4.4 The AFTER hashes again (spec D11), on the commit of task 4.2.
  - Command: the command of task 1.6.
  - Verify: `runner_sha256` changes, because `harness/opencode-credential.sh`
    and `harness/go-cost.ts` are in its list; the task records the new
    value.
  - Verify: `suite_sha256` stays
    `8a24205b405a9aae22cf2412d3fc9a40b4b3ffdb30e2a0c0cfa26c4405ee734d`,
    because no file under `harness/tests/` changes.
  - Verify: the orchestrator names the new value to `grader_system_chrome`
    (its risk R4).
  - Lane: light. A read-only command.
- [ ] 4.5 The full suites through `heavy-run.sh` (the command of task 1.5),
  only between 22:00 and 07:00 and only with no p1 waiter.
  - Verify: the run exits 0. The log holds a `Tests` line with no failed
    test for each of the two suites.
  - Verify: the log sits at `measure/runs/opencode_host_isolation/`.
  - Lane: light. One heavy run.
- [ ] 4.6 The rerun. One `harness/cron-daily.sh --dry-run` with the service
  PATH, the real guard, the real catalog, and no seams, through
  `HEAVY_MIN_AVAIL_MB=1500 HEAVY_PRIORITY=p2 heavy-run.sh`.
  - Verify: EXIT=0; no `Permission denied` line; no `DAILY FAIL` line; one
    `DAILY OPENCODE_HOME` line and one matching `OPENCODE_HOME CLEANUP`
    line; either `DAILY GO-GUARD ...` with `DAILY DRY-RUN planned=<n>`, or
    `DAILY SKIP go-guard: monthly used <n> percent` with `DAILY DRY-RUN
    planned=0`; `DAILY END`; no `.tmp/opencode-host-*` folder after; only
    the OpenChamber server after.
  - Verify: the task records each `seed attempt` line.
  - Lane: light. One heavy run.
- [ ] 4.7 The report to the PM: status, facts changed, defaults taken, and
  the new `runner_sha256`.
  - Verify: the plan records the date of the send.
  - Verify: the report closes with a "facts changed" list.
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
