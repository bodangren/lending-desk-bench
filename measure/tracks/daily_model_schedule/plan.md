# Implementation plan — daily_model_schedule

This plan adds a job that tests one model on each run day (Wednesday and
Sunday). The job refreshes the model list. It selects one untested model,
or else the model with the stalest last test date. It runs that model, and
it publishes the site data. Spec:
`spec.md`. Test strategy: `test-strategy.md`. Independent oracle:
`pick-oracle.py`. Base commit: `aa94185`.

Order: contract, then tests (Red), then implementation (Green) and reviews,
then docs, then the O1 conditions (Phase 4b), then the doctor and the owner
gate.

Constraints for every role:

- `harness/cron-weekly.sh` stays disabled. Do not edit it, and do not edit
  its commented crontab line (spec EV12).
- The daily entry point is a separate script, `harness/cron-daily.sh`.
- The schedule is a systemd user timer (spec D11, O1 condition 1). The
  track commits the two unit files in task 4b.3. The install is an owner
  action, only after decision O1, after the manual push of task 5.1, and
  after 2026-11-02 07:00 (task 5.3). No crontab line is installed.
- The job pushes nothing until the one manual push of task 5.1 (spec D13,
  O1 condition 3). No role pushes the branch.
- Send no model call before task 5.4. The tests, the dry runs, the catalog
  fetch, and `opencode models` send no prompt (spec NFR-1).
- Do not edit a file of the runner hash or the suite hash, `plan-work.ts`,
  `go-cost.ts`, or `go-pricing.json` (spec EV8, FR-9).
- Phases 2 to 4b happen only in the worktree `../lending-desk-bench-daily`
  on the branch `daily-schedule`. The worktree links `runs` to the `runs/`
  of `main` for reading only. Stage files by explicit path, so the link never
  enters a commit.
- Preserve unrelated dirty work. Stage files by explicit path only.

Marker use:

- `[~]` marks the task that is open now.
- `[b]` with a trailing `deferred:<owner>` marks a task that waits for an
  earlier task or for an owner decision. The orchestrator changes it to `[~]`
  when its turn comes.
- `[x]` needs a commit SHA on the first line of the task.
- While a `[b]` task remains, exactly one task is `[~]`. Its first line does
  not hold the word `deferred`. When the `[~]` task closes, the same edit
  marks the next task `[~]`. Reason: anti-pattern A12. Run `STATUS_CHECK`
  after each marker change.

Gate commands: the exact commands are in section 3 of the test strategy.
This plan uses their names: `SCHEDULE_TEST`, `META_LOGIC`, `RED_PATH_CHECK`,
`PATH_CHECK`, `BASE_HASH`, `WORKLIST_SHA`, `BATCH_COMPAT`, `SELECTOR_MATCH`,
`PICK_MATCH`, `DOCS_CHECK`, `PI_SHA`, `PI_CHECK`, `DAY_CHECK`,
`PUBLISH_CHECK`, `CONSENT_CHECK`, `TIMER_CHECK`, and `STATUS_CHECK`. Task
4b.1 adds the exact commands for the O1 conditions: the Go guard, the push
rule, the selector exit, the unit files, and `TIMER_CHECK` in place of the
old `CRON_CHECK`. Until task 4b.1 closes, those names have no command yet.

## Phase 1: Contract and setup [checkpoint: 1a48dea]

- [x] 1.1 Contract: `spec.md`, `plan.md`, `test-strategy.md`, `pick-oracle.py`, `metadata.json`, `index.md`, and the registry rows in `measure/tracks.md` and `measure/index.md`. 3c21502
  The strategy role wrote them on 2026-10-25 and did not commit them. The
  orchestrator commits them in one commit by explicit path. It records the
  SHA on the first line of this task and marks the task `[x]`.
  - Verify: `python3 ~/.agents/skills/measure-orchestrator/scripts/measure_interphase_checks.py role-gate --repo . --role strategy --track daily_model_schedule --log-file measure/runs/daily_model_schedule/strategy.log` prints `PASS: strategy gate passed`.
  - Verify: `git show --name-only --format= <sha>` lists `measure/tracks/daily_model_schedule/test-strategy.md` and `measure/tracks/daily_model_schedule/pick-oracle.py`.
  - Verify: `STATUS_CHECK` prints `STATUS_CHECK=pass blocked=<n> open=1`.
- [x] 1.2 Phase base and worktree. Capture `PHASE_BASE` as section 2 of the
  test strategy states. Create `../lending-desk-bench-daily` on the new
  branch `daily-schedule` from `PHASE_BASE`. Link `runs` to the `runs/` of
  `main`. Install the harness dependencies from the lockfile. In `main`,
  record `BASE_HASH`, `WORKLIST_SHA`, `BATCH_COMPAT`, and the two lines of
  `PI_SHA base`.

  Recorded on 2026-10-25 in `main`:
  - `PHASE_BASE=3c2150271e435cfd8bac451e22f37264f8052aea`
  - `BASE_HASH runner=3e5a4c64c9bcd0b30d6143389c8e96b9a80d955681df7b072c394db937ab29ea`
  - `BASE_HASH suite=451652e5e03ee1d3030014c527bff7714740b96a38756853d5fc68276c522ae6`
  - `WORKLIST_ROWS=120`
  - `WORKLIST_SHA=2f5e65d6cf5df4aa2dc8e5f42d4650ced3040fc77903a1d7c06c395e59a61a28`
  - `BATCH_COMPAT_RUNS=180`
  - `BATCH_COMPAT=b492c77c29fe854f1edae945ed5842974acd5bcc83331ec10aa6e4cb13cfeed7`
  - `PI_RUNS=95`
  - `PI_SHA=cbb545a856d936c4ea4200ed4e8841362badc31fdd19a4962408e31bd2f297ca`
  The worktree harness links the `node_modules` of `main`, because the npm
  registry read timed out. The lockfile hashes match on both trees:
  `3079afaa31f19f9665856b0cb8ed7d8b6b208bd56280896fcc741b1c428afde9`.
  - Verify: `PHASE_BASE=ok` (test strategy section 2).
  - Verify: `git -C ../lending-desk-bench-daily rev-parse --abbrev-ref HEAD` prints `daily-schedule`.
  - Verify: this task holds `PHASE_BASE`, `BASE_HASH`, `WORKLIST_ROWS`, `WORKLIST_SHA`, `BATCH_COMPAT_RUNS=180`, `BATCH_COMPAT`, `PI_RUNS`, and `PI_SHA`.

## Phase 2: Test (Red) [checkpoint: 7cde12f]

Run in the worktree. Red commits on the branch `daily-schedule`.

- [x] 2.1 Test file `harness/schedule-tests/daily-schedule.test.ts` with the 7cde12f
  cases of test strategy sections 6.1 to 6.4. Each spawn gets an explicit
  environment. No case may be `skip`, `todo`, or `fails`.
  Commit 7cde12f adds all 42 cases. It changes only the test file.
  `RED_PATH_CHECK` printed `RED_PATH_CHECK=pass` after this commit.
  - Verify: `SCHEDULE_TEST` exits non-zero, and each failure names a missing interface of test strategy section 5.
  - Verify: `RED_PATH_CHECK` prints `RED_PATH_CHECK=pass`.
- [x] 2.2 Red evidence. Run `SCHEDULE_TEST`. Record the start time, the end 7cde12f
  time, the exit code, and the Vitest `Tests` line in this task.
  - Command: `cd harness && npx vitest run schedule-tests/daily-schedule.test.ts --no-cache --configLoader native`.
  - Safety: native config loading and disabled caching prevent writes to shared `harness/node_modules`.
  - Environment: `TMPDIR=/tmp/opencode`, `npm_config_offline=true`, and `npm_config_update_notifier=false`.
    `npm_config_cache` points to `measure/runs/daily_model_schedule/npm-cache`.
    `RESULT_FILE` points to the JSON report for each run.
  - Run 1: start `2026-10-25T10:52:56Z`; end `2026-10-25T10:53:48Z`; exit `1`.
    `Test Files  1 failed (1)`; `Tests  39 failed | 3 passed (42)`.
    Reports: `measure/runs/daily_model_schedule/red-3.log` and `red-3.json`.
  - Run 2: start `2026-10-25T10:53:48Z`; end `2026-10-25T10:54:38Z`; exit `1`.
    `Test Files  1 failed (1)`; `Tests  39 failed | 3 passed (42)`.
    Reports: `measure/runs/daily_model_schedule/red-4.log` and `red-4.json`.
  - `RED_DETERMINISM=pass cases=42 failed=39 passed=3` compares the complete case names and statuses from both JSON reports.
  - `RED_INTERFACE_LABELS=pass failures=39` confirms that every failure names an interface from strategy section 5.
  - Remaining failures: selector cases 6.1.1–6.1.22 need `harness/daily-pick.ts`.
    Batch cases 6.2.1–6.2.6 need `harness/batch.sh --model`.
    Job cases 6.3.1–6.3.10 need `harness/cron-daily.sh` and the day record fields.
    Artifact case 6.4.1 needs `weekly.sh` to forward `"$@"` to `batch.sh`.
    `measure/runs/daily_model_schedule/red-failures.txt` lists all 39 failed cases.
  - Already satisfied at HEAD: cases 6.2.7, 6.2.8, and 6.4.2.
    They prove the unpinned list, absence of an environment pin, and the existing self-check scrub list.
    They remain passing guards, not claimed Red failures.
  - Initial dirty paths: the relevant plan edits activated task 2.1.
    The generated/ignorable links `harness/node_modules` and `runs` remained unstaged. No unrelated dirty paths existed.
  - `phase_base_sha=3c2150271e435cfd8bac451e22f37264f8052aea`; `role_base_sha=5b21d197cce7885d1592dc0034de596b858be4e0`.
    Both commits resolve. Commit 7cde12f adds new Red work after the role base.
  - `measure/workflow.md` is absent. This phase follows the supplied strategy and task instructions.
    An initial long `TMPDIR` caused a tsx socket error. The final runs use `/tmp/opencode` and contain no such error.
  - `STATUS_CHECK=pass blocked=13 open=1` after task 3.1 became the next active task.
  - `role-gate --repo . --role mid-red --track daily_model_schedule --phase "Phase 2: Test (Red)" --baseline 5b21d197cce7885d1592dc0034de596b858be4e0 --log-file measure/runs/daily_model_schedule/mid-red-7cde12f.log`
    printed `PASS: mid-red gate passed` with `RED_TEST_COMMAND` set to the safe command above.
    Report: `measure/runs/daily_model_schedule/red-role-gate.log`. The gate reran all 42 cases.
  - Verify: the recorded exit code is not 0, and the recorded failures are only those of task 2.1.
  - Verify: `role-gate --role mid-red --phase "Phase 2: Test (Red)"` with `RED_TEST_COMMAND` set to `SCHEDULE_TEST` prints `PASS: mid-red gate passed`.

## Phase 3: Implement (Green) [checkpoint: a376d24]

Run in the worktree. Green commits on the branch `daily-schedule`.

- [x] 3.1 Selection rule: `harness/daily-pick.ts` — commit `282e9da`.
  Spec selection rules 1 to 6, FR-2 to FR-5; test strategy section 5.1. It
  reads only its flags and files. It compares ids in byte order. It matches
  a served model by an exact line.
  - Verify: the "selector" block of `SCHEDULE_TEST` passes.
  - Verify: `rg -n 'process\.env|localeCompare' harness/daily-pick.ts` prints no line.
  - Evidence: `SCHEDULE_TEST` selector block 6.1.1–6.1.22 all pass
    (`Tests  42 passed (42)` at the full-suite run below). The guard command
    prints nothing (exit 1). The first cut stored parsed flags under
    hyphenated keys and read underscored ones, so `--runs-root` fell back to
    the default; caught by a manual synthetic run before the first commit,
    fixed in the same commit `282e9da`.
- [x] 3.2 Oracle cross-check — commit `282e9da`. Run `SELECTOR_MATCH` in the
  worktree on the real runs tree and on one saved fetch. The selector and
  `pick-oracle.py` must print the same model, reason, date, and counts.
  Record the line in this task.
  - Verify: `SELECTOR_MATCH` prints `SELECTOR_MATCH=pass date=<day> model=<id> ...`.
  - Verify: `SELECTOR_MATCH` with an empty served file exits non-zero on both sides.
  - Evidence: `SELECTOR_MATCH=pass date=2026-10-25 model=hy4-preview reason=untested last_test=none candidates=28 eligible=11 untested=11`
    (strategy section 7 records the same value for 2026-10-25). Empty served
    file: the selector exits 2 with `daily-pick: the served list is empty`;
    `pick-oracle.py` exits 1 with `PICK_ORACLE=fail empty served list`.
    Both sides non-zero. The fetch inputs are `.tmp/daily-catalog.json` and
    `.tmp/daily-served.txt` in the worktree.
- [x] 3.3 Run one model: `batch.sh --model <id>`, `weekly.sh` `"$@"` — commit `82106a9`.
  Spec FR-7, D7; test strategy section 5.2.
  Do not add an environment variable that `batch.sh` reads.
  - Verify: the "batch pin" block of `SCHEDULE_TEST` passes.
  - Verify: `BATCH_COMPAT` prints the value of task 1.2.
  - Evidence: `SCHEDULE_TEST` batch block 6.2.1–6.2.8 all pass.
    `BATCH_COMPAT_RUNS=180`;
    `BATCH_COMPAT=b492c77c29fe854f1edae945ed5842974acd5bcc83331ec10aa6e4cb13cfeed7`
    (equals task 1.2), rerun at Green HEAD `a376d24` with the same value.
- [x] 3.4 Daily entry point `harness/cron-daily.sh` — commit `a376d24`.
  Spec FR-1, FR-6, FR-8; test strategy section 5.3. It takes the shared
  lock. It refreshes
  the catalog and the served list through a temporary file and a rename. It
  writes the day record before the runner. It calls
  `weekly.sh --model <id>`, and it adds the run ids to the record. It
  commits only `docs/` and pushes. It reports each unpriced, gone, and
  unservable model in the day record and in the commit body, and it does not
  edit `harness/go-pricing.json`.
  - Verify: the "daily job" block of `SCHEDULE_TEST` passes.
  - Verify: `bash -n harness/cron-daily.sh` exits 0.
  - Evidence: `SCHEDULE_TEST` job block 6.3.1–6.3.10 all pass.
    `bash -n harness/cron-daily.sh` exits 0.
- [x] 3.5 Green gate — commit `f386b18`. Run `SCHEDULE_TEST`, `PATH_CHECK`, `BATCH_COMPAT`, and
  `META_LOGIC` in the worktree. Record each labeled line in this task.
  Three of four gates pass; `META_LOGIC` exits 1 with 34 failures that are
  pre-existing at the phase base and belong to the in-flight
  `opencode_executor` track; see the evidence below.
  - Verify: `SCHEDULE_TEST` exits 0, `PATH_CHECK` prints `PATH_CHECK=pass`, `BATCH_COMPAT` equals task 1.2, and `META_LOGIC` exits 0.
  - Verify: `role-gate --role jr-green --phase "Phase 3: Implement (Green)"` with `GREEN_TEST_COMMAND` set to `SCHEDULE_TEST` prints `PASS: jr-green gate passed`.
  - Evidence: `SCHEDULE_TEST` at Green HEAD:
    `Test Files  1 passed (1)`; `Tests  42 passed (42)` (exit 0).
    `PATH_CHECK=pass` with `PHASE_BASE=3c21502`.
    `BATCH_COMPAT_RUNS=180`;
    `BATCH_COMPAT=b492c77c29fe854f1edae945ed5842974acd5bcc83331ec10aa6e4cb13cfeed7`.
  - Evidence: `META_LOGIC` (`cd harness && npm run test:meta:logic`) exits 1:
    `Test Files  6 failed | 24 passed (30)`; `Tests  34 failed | 204 passed (238)`.
    The same command at `PHASE_BASE` 3c21502 (a read-only `git archive` copy
    in `/tmp/opencode/base-tree`) fails identically: opencode-credential 13,
    opencode-executor 17, opencode-fixture 1, opencode-recorded 1,
    runner-safety 1, grade-exit 1 — the same 34, so no failure was introduced
    or changed by Green. All six suites test the `opencode_executor`
    migration, whose task 4.2 is in progress; none is reachable from the
    Green path allow-list of `PATH_CHECK`. The batch-guarding suites
    (`bench-incremental`, `selfcheck-env`) pass.
  - Phase-gate exception (orchestrator decision, 2026-10-27, from the Green
    handoff options): `META_LOGIC` exit 0 is waived for this gate in the
    worktree. The failing suite is `opencode-credential`, which belongs to
    the in-flight `opencode_executor` track. The owner needs decision O1
    by 2026-10-29, so the phase does not wait for that track.
  - Gate rerun at the amendment HEAD `33ce288` on 2026-10-27 (task closure):
    `SCHEDULE_TEST` exit 0, `Test Files  1 passed (1)`, `Tests  42 passed
    (42)`; `PATH_CHECK=pass`; `BATCH_COMPAT_RUNS=180`;
    `BATCH_COMPAT=b492c77c29fe854f1edae945ed5842974acd5bcc83331ec10aa6e4cb13cfeed7`;
    `META_LOGIC` exit 1, `Test Files  1 failed | 29 passed (30)`, `Tests  4
    failed | 234 passed (238)`, all in `opencode-credential` (waived);
    `role-gate --role jr-green ... --baseline 5b21d197cce...` printed
    `PASS: jr-green gate passed`.
  - Evidence for the waiver: the 4 failing names are a strict subset of the
    13 `opencode-credential` failures at `PHASE_BASE` (read-only archive
    copy, 2026-10-27, the 2026-10-25 proof method; the copy gave
    `Test Files  6 failed | 24 passed (30)`, `Tests  34 failed | 204
    passed (238)`). `main` at `5ebdcf6` holds harness code identical to
    `PHASE_BASE` (`git diff 3c21502 5ebdcf6 -- harness/` is empty), and
    the same command there gave `Test Files  30 passed (30)`, `Tests  238
    passed (238)`. The trees differ in untracked state (`main` holds
    `.opencode/`; the worktree does not). The branch changes no file of
    the suite (`PATH_CHECK`; `git diff 3c21502 33ce288 -- harness/tests/`
    is empty), and its unpinned batch output is byte-equal
    (`BATCH_COMPAT`). No cause beyond these observations is claimed.
  - Environment repair before the rerun: the worktree
    `harness/node_modules` had become a partial directory without `.bin`
    and without `vitest` (157 of 237 entries, no live writer). The role
    removed it and re-linked it to the `node_modules` of `main`, the state
    that task 1.2 records. No tracked file changed.
- [x] 3.6 Review A (correctness): the selection rule, the run date rule, the 4c111d9
  identity rule against `plan-work.ts`, and `--day-runs`. The role writes
  `measure/runs/daily_model_schedule/review-a-<short head>.json`.
  - Verify: `measure_interphase_checks.py audit-result --role review-a --file <path>` prints `PASS: audit result is valid`, and the file shows `status: pass`.
  - Evidence: `review-a-4c111d9.json` shows `status: pass`, 0 blocking and 4 nonblocking findings; `audit-result --role review-a` printed `PASS: audit result is valid` (orchestrator, 2026-10-28).
  - Remediation of the Review A finding (`review-a-f9c907c.json` at `f9c907c`,
    status fail): this commit splits selection rules 4 and 5 in
    `harness/daily-pick.ts` to match `pick-oracle.py`, and it adds the
    regression case (an untested candidate beside a no-week-token run) to the
    selector block. SCHEDULE_TEST `Test Files  1 passed (1)`; `Tests  43 passed
    (43)` (exit 0); PATH_CHECK=pass; SELECTOR_MATCH `SELECTOR_MATCH=pass
    date=2026-10-27 model=hy4-preview reason=untested last_test=none
    candidates=28 eligible=28 untested=11`; BATCH_COMPAT `BATCH_COMPAT_RUNS=180`
    and `BATCH_COMPAT=b492c77c29fe854f1edae945ed5842974acd5bcc83331ec10aa6e4cb13cfeed7`;
    the fixture sides now agree (`model=y-fresh reason=untested`).
- [x] 3.7 Review B (security): endpoint data in the shell, the id check, the 4c111d9
  temporary files, the lock, the credential, and the push scope (spec R4,
  R5). The role writes
  `measure/runs/daily_model_schedule/review-b-<short head>.json`.
  - Verify: `measure_interphase_checks.py audit-result --role review-b --file <path>` prints `PASS: audit result is valid`, and the file shows `status: pass`.
  - Evidence: `review-b-4c111d9.json` shows `status: pass`, 0 blocking and 9 nonblocking findings; `audit-result --role review-b` printed `PASS: audit result is valid` (orchestrator, 2026-10-28).
  - Remediation of the Review B findings (`review-b-756dc7e.json` at `756dc7e`,
    status fail, three blockers): this commit path-limits the publish commit to
    `docs/`, so a path staged outside `docs/` stays out of the commit and out of
    the push. This commit takes the job lock exclusively and non-blocking, so a
    second daily job skips. The "shared lock" wording of task 3.4 described the
    old implementation; the exclusive mode keeps the D9 guarantee and adds
    daily-vs-daily exclusion. This commit fails the job when the runner exits 0
    and produces no run (spec D3): the job prints
    `DAILY FAIL runs: the runner produced no runs`, exits non-zero, prints
    `DAILY PUBLISH none`, and makes no commit. The day record stays truthful.
    The new cases are 6.3.11 (a shared lock holder skips the job), 6.3.12 (a
    runner with zero runs fails the day), 6.4.3 (the commit is path-limited to
    `docs/`), and 6.4.4 (a temporary Git repository proves the commit scope).
    The gate lines are `Test Files  1 passed (1)`; `Tests  48 passed (48)`
    (exit 0); `PATH_CHECK=pass`; `BATCH_COMPAT_RUNS=180`;
    `BATCH_COMPAT=b492c77c29fe854f1edae945ed5842974acd5bcc83331ec10aa6e4cb13cfeed7`;
    `STATUS_CHECK=pass blocked=8 open=1`.
- [x] 3.8 Review C (API contract): the `batch.sh` flag, the `weekly.sh` 4c111d9
  arguments, the selector JSON, the day record, and the labeled lines. The
  role writes `measure/runs/daily_model_schedule/review-c-<short head>.json`.
  - Verify: `measure_interphase_checks.py audit-result --role review-c --file <path>` prints `PASS: audit result is valid`, and the file shows `status: pass`.
  - Evidence: `review-c-4c111d9.json` shows `status: pass`, 0 blocking and 7 nonblocking findings; `audit-result --role review-c` printed `PASS: audit result is valid` (orchestrator, 2026-10-28).
  - Remediation of the Review C finding (`review-c-756dc7e.json` at `756dc7e`,
    status fail, one blocker): this commit validates the `--model` value when
    the flag is present, so an empty value exits 2 and plans no run. The new
    case is 6.2.9 (an empty value exits 2 and plans no run), next to case
    6.2.4. The gate lines are `Test Files  1 passed (1)`;
    `Tests  48 passed (48)` (exit 0); `PATH_CHECK=pass`;
    `BATCH_COMPAT_RUNS=180`;
    `BATCH_COMPAT=b492c77c29fe854f1edae945ed5842974acd5bcc83331ec10aa6e4cb13cfeed7`;
    `STATUS_CHECK=pass blocked=8 open=1`. The case lists of section 6 of the
    test strategy now hold 6.1.23, 6.2.9, 6.3.11, 6.3.12, 6.4.3, and 6.4.4.
- [x] 3.9 Adversarial tests of test strategy section 12. The role adds the 8b7f721
  cases to the test file. It writes
  `measure/runs/daily_model_schedule/adversarial-<short head>.json`.
  - Verify: `SCHEDULE_TEST` exits 0 with the added cases, and the role file shows `status: pass`.
  - Evidence: `SCHEDULE_TEST` at `8b7f721`: `Test Files  1 passed (1)`; `Tests  55 passed (55)` (exit 0).
    `PATH_CHECK=pass` with `PHASE_BASE=3c2150271e435cfd8bac451e22f37264f8052aea`.
    The cases 12.1 to 12.7 of test strategy section 12 sit in the `adversarial` block.
    The result file is `measure/runs/daily_model_schedule/adversarial-4c111d9.json`.
    It shows `status: pass`, 0 blocking findings and 3 nonblocking findings.
    The first nonblocking finding is a contract gap in the test strategy.
    A resumed run of the same day publishes the reason `resume` in the commit subject.
    `PUBLISH_CHECK` accepts only the reasons `untested` and `stalest`.
    The orchestrator must route that gap before task 5.4.

## Phase 4: Docs [checkpoint: a450b88]

Run in the worktree. Commit on the branch `daily-schedule`.

- [x] 4.1 Operator docs — commit `a450b88`. Add the section `## Daily model schedule` to
  `README.md`. It names the three owner steps, `harness/cron-daily.sh`,
  `harness/daily-pick.ts`, `batch.sh --model`, and the day records under
  `reports/daily/`. It states the run days: Wednesday and Sunday at 01:00.
  It states the schedule line `0 1 * * 0,3`. It states that
  `cron-weekly.sh` stays disabled, and that the crontab change is an owner
  action. It gives the price table update: when a day record lists an
  unpriced model, the operator adds the price to `harness/go-pricing.json`
  from `https://opencode.ai/docs/go/`.
  The model then becomes an untested candidate. It gives the operator action
  for a deleted day record: when an operator deletes a day record under
  `reports/daily/`, the next job run on that day selects a new model and
  tests it. The operator restores the deleted record before the next run day.
  Update the header comments
  of the changed scripts to match.
  - Verify: `DOCS_CHECK` prints `DOCS_CHECK=pass`.
  - Verify: `PATH_CHECK` prints `PATH_CHECK=pass`, and `SCHEDULE_TEST` exits 0.
  - Evidence: at the role start (`21def39`), `README.md` held no
    `## Daily model schedule` section, so `DOCS_CHECK` failed with
    `no section`. Commit `a450b88` adds the README section, the
    comment-only script updates (finding F1), and the registry row of
    finding F2. No code line changed. On HEAD `a450b88`:
    `DOCS_CHECK=pass` (exit 0); `PATH_CHECK=pass` (exit 0) with
    `PHASE_BASE=3c2150271e435cfd8bac451e22f37264f8052aea`;
    `bash -n` exits 0 on `harness/cron-daily.sh`, `harness/batch.sh`,
    and `harness/weekly.sh`; `SCHEDULE_TEST` through heavy-run.sh:
    `Test Files  1 passed (1)`; `Tests  55 passed (55)` (exit 0;
    Vitest start 09:15:43, duration 133.72 s, 2026-10-31 local time;
    one run, no `ETIMEDOUT` and no host-load failure).
    The real-data dry run (the owner-approved route) started
    2026-10-31T07:32:50+07:00 on the code state `21def39` plus the
    comment-only changes that commit `a450b88` holds. It ran no model,
    wrote no day record (`reports/` did not exist after the run), and
    pushed nothing (`BENCH_DAILY_PUBLISH=0`). The same dry run printed:
    `PICK_MATCH=pass date=2026-10-31 model=hy4-preview reason=untested
    last_test=none candidates=26 eligible=26 untested=11` and
    `DAILY DRY-RUN planned=12`. The command was the exact `PICK_MATCH`
    command of test-strategy section 3 inside one heavy-run.sh wrapper.
    The wrapper added only a `tee` of the dry-run output, two `echo`
    lines for the two sides, and one `sed` line for the dry-run label.
    It changed no gate step:

    ```bash
    /home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh -c 'mkdir -p .tmp && day=$(date -u +%F) && (cd harness && npx tsx go-cost.ts --catalog) > .tmp/daily-catalog.tmp && mv .tmp/daily-catalog.tmp .tmp/daily-catalog.json && opencode models > .tmp/daily-served.tmp && mv .tmp/daily-served.tmp .tmp/daily-served.txt && a=$(BENCH_DAILY_CATALOG=$PWD/.tmp/daily-catalog.json BENCH_DAILY_SERVED=$PWD/.tmp/daily-served.txt BENCH_DAILY_DATE=$day BENCH_DAILY_PUBLISH=0 bash harness/cron-daily.sh --dry-run 2>&1 | tee .tmp/daily-dry-run.txt | sed -n "s/^DAILY_PICK //p") && b=$(python3 -I measure/tracks/daily_model_schedule/pick-oracle.py .tmp/daily-catalog.json .tmp/daily-served.txt harness/go-pricing.json runs reports/daily "$day" | tee .tmp/daily-oracle.txt | sed -n "s/^PICK_ORACLE //p") && echo "DAILY_PICK=$a" && echo "PICK_ORACLE=$b" && sed -n "/^DAILY DRY-RUN /p" .tmp/daily-dry-run.txt && test -n "$a" && test "$a" = "$b" && echo "PICK_MATCH=pass $a"'
    ```

    The full logs are `measure/runs/daily_model_schedule/pick-match-4.1.log`
    and `measure/runs/daily_model_schedule/schedule-test-4.1.log`.
    Task 5.1 runs `PICK_MATCH` again in `main` after the merge.
    `STATUS_CHECK` after this plan commit gives `blocked=4 open=0` and
    prints no pass line: Phase 5 stays `[b]` by the orchestrator
    instruction of this run, so no `[~]` task follows 4.1. The
    orchestrator counts the four `[b]` tasks by hand (anti-pattern A12)
    and opens task 5.1 when its turn comes.

## Phase 4b: O1 conditions (Red and Green)

Run in the worktree. Commit on the branch `daily-schedule`. The owner
approved O1 on 2026-10-31 with 3 conditions (spec O1 row). This phase turns
the conditions into rules and code: spec D11 to D14, FR-10 to FR-13, and
NFR-6. The monthly window rule joins this phase (spec D12 and the O1 row).
Phase 4 Review C and the Phase 4 acceptance have not run yet; the
orchestrator runs them and orders them with this phase. The checkpoint of
Phase 4 names the docs commit `a450b88` by the convention of Phases 1 to 3:
it is not an acceptance claim.

- [x] 4b.1 Strategy amendment of `test-strategy.md`. 78f73c0 The strategy role adds
  the exact gate commands for the 4 new rules: the Go guard (FR-10), the
  push rule (FR-11), the selector exit (FR-12), and the unit files
  (FR-13). It amends the existing gates:
  - `DOCS_CHECK`: the README names the systemd timer units of D11, not the
    crontab line.
  - `TIMER_CHECK` in place of `CRON_CHECK`: it reads the two unit files and
    asserts each value of D11, and it asserts that no unit is installed and
    no crontab line runs `cron-daily.sh`.
  - `PUBLISH_CHECK`: it accepts a skipped push before the manual push of
    task 5.1 (a local docs commit with a `DAILY PUSH skipped` line passes).
  - The section 12 contradiction on the resume reason and the short resume
    record (the adversarial findings 1 and 2 of task 3.9): a resumed day
    publishes the reason `resume`, and `PUBLISH_CHECK` accepts only
    `untested` and `stalest`. The role resolves the gap in the strategy
    text before task 5.4.
  The role also updates the section 5 interfaces (the new seams of NFR-6,
  the `go_guard_stop` field, the new labeled lines `DAILY SKIP go-guard`,
  `DAILY GO-GUARD`, and `DAILY PUSH skipped`), the section 6 case lists,
  the `PATH_CHECK` allow-list (`harness/systemd/`), and the section 9 phase
  table (Phase 4b).
  - Verify: the amended strategy names one gate command for each rule of FR-10 to FR-13 (the strategy role names the exact commands).
  - Verify: `TIMER_CHECK` replaces `CRON_CHECK` in the strategy, `DOCS_CHECK` requires the timer names, and `PUBLISH_CHECK` accepts a skipped push before the manual push.
  - Verify: the section 12 text resolves the resume-reason gap of task 3.9.
  - Verify: `python3 ~/.agents/skills/measure-orchestrator/scripts/measure_interphase_checks.py role-gate --repo . --role strategy --track daily_model_schedule --log-file measure/runs/daily_model_schedule/strategy-1dddcaa.log` prints `PASS: strategy gate passed`.
  - Evidence: commit `78f73c0` amends `test-strategy.md`. `STATUS_CHECK` printed `STATUS_CHECK=pass blocked=3 open=1`.
  - r2: `UNIT_CHECK` verify uses a temporary copy, so the worktree `ExecStart` path exists. Task 5.1 runs `UNIT_CHECK` in `main`. F3=FIX.
- [x] 4b.2 Red: failing tests for the new rules. 459fc7f The role adds the cases of
  the amended strategy to `harness/schedule-tests/daily-schedule.test.ts`:
  the guard stops (before the first batch, mid-day, a failed read, a
  missing field, a non-number), the dry-run guard line, the push rule (a
  push at the parent, a skip with other local commits, a failed fetch), the
  selector exit 1, the per-batch order of D12, and the unit-file artifact
  cases. No case may be `skip`, `todo`, or `fails`.
  - Verify: `SCHEDULE_TEST` exits non-zero, and each new failure names a missing interface of spec D11 to D14.
  - Verify: `RED_PATH_CHECK` prints `RED_PATH_CHECK=pass`.
  - Verify: the mid-red role gate prints `PASS: mid-red gate passed`.
  - Evidence: `SCHEDULE_TEST` at `459fc7f` used `heavy-run.sh` and exited non-zero.
    `Test Files  1 failed (1)`. `Tests  39 failed | 43 passed (82)`.
    The log is `measure/runs/daily_model_schedule/red-4b.log`.
    `RED_PATH_CHECK=pass` with `PHASE_BASE=e47c2c5faf1156ba7e64d4687346bd6795d00ae3`.
    The track `PHASE_BASE` `3c215027` cannot pass here. Phase 3 changed `harness/` after it.
    `UNIT_CHECK=fail absent harness/systemd/lending-desk-daily.service harness/systemd/lending-desk-daily.timer`.
    `DOCS_CHECK=fail missing harness/systemd/lending-desk-daily.service`.
    D12 `BENCH_DAILY_QUOTA_CMD`: 6.3.1, 6.5.1, 6.5.4, 6.5.5, 6.5.6, 6.5.7, 6.5.8, 6.5.9, 6.5.10, 6.5.11, 6.5.12, 6.5.13, 6.5.24.
    D12 `BENCH_DAILY_BATCH`: 6.3.4, 6.3.5, 6.3.6, 6.3.10, 6.3.12, 6.4.4, 6.4.7, 6.5.2, 6.5.3, 6.5.13, 12.1, 12.2, 12.4, 12.5.
    D12 live quota text: 6.4.6. D13 `git push origin <sha>:main`: 6.4.3, 6.4.4, 6.5.14, 6.5.15, 6.5.16, 6.5.17.
    D14 `BENCH_DAILY_SELECT`: 6.5.18, 6.5.19, 6.5.20, 6.5.21.
    D11 unit files: 6.4.5, 6.5.22.
    Case 6.5.23 names the section 5.4 resume-record keep. No failure was a timeout or a fixture fault.
    `STATUS_CHECK=pass blocked=3 open=1`.
    r2 `b970769` fixes two test defects. A mid-day stop keeps the earlier guard lines and batch calls. Case 6.4.4 pushes the initial commit, so `origin/main` is the docs parent.
    The snapshot run of `b970769` exited non-zero. `Test Files  1 failed (1)`. `Tests  39 failed | 43 passed (82)`.
    The log is `measure/runs/daily_model_schedule/red-4b-r2.log`. `EXIT=1`.
    Cases 6.5.8, 6.5.9, and 6.5.10 still fail on missing D12 `BENCH_DAILY_QUOTA_CMD`. Case 6.4.4 still fails on missing D12 `BENCH_DAILY_BATCH` and D13.
- [x] 4b.3 Green — implementation commits `1e7c26e` and `60a5ec7`.
  Implement the guard, per-batch order,
  push rule, selector exit, unit files, README update, and header comments.
  The guard reads `usage.windows.weekly.usedPercent` through the
  port of `openchamber status --json` (seam `BENCH_DAILY_QUOTA_CMD`), once
  before each of the 4 track batches. The job runs the 4 batches itself in
  the exact order of D12, then the recost and the site refresh. The push
  rule follows D13 (`git push origin <sha>:main`, only at the parent
  match). A selector exit other than 0 and 3 fails the job (D14). The unit
  files are `harness/systemd/lending-desk-daily.service` and
  `harness/systemd/lending-desk-daily.timer` (D11). The README names the
  timer, the guard, and the push rule. The header comments of
  `cron-daily.sh` match.
  - Verify: `SCHEDULE_TEST` exits 0.
  - Verify: `PATH_CHECK` prints `PATH_CHECK=pass` (the allow-list of task 4b.1 holds `harness/systemd/`).
  - Verify: `BATCH_COMPAT` equals task 1.2, and `bash -n harness/cron-daily.sh` exits 0.
  - Verify: the jr-green role gate prints `PASS: jr-green gate passed`.
  - Evidence: `SCHEDULE_TEST` at implementation commit `1e7c26e` exited 0:
    `Test Files  1 passed (1)`; `Tests  82 passed (82)`. Vitest started
    17:22:12 and ran for 241.37 seconds. The log is
    `measure/runs/daily_model_schedule/green-4b.log`.
  - Evidence: `GUARD_CHECK` exited 0 with 14 passed and 68 skipped.
    `PUSH_RULE_CHECK` exited 0 with 4 passed and 78 skipped.
    `SELECT_EXIT_CHECK` exited 0 with 4 passed and 78 skipped.
    Their logs are under `/tmp/opencode/`.
  - Evidence: `UNIT_CHECK_VERIFY=pass`; `UNIT_CHECK=pass`;
    `DOCS_CHECK=pass`; `BASH_N=pass`; `PATH_CHECK=pass` with
    `PHASE_BASE=3c2150271e435cfd8bac451e22f37264f8052aea`;
    `WEEKLY_SAME=pass` with
    `PHASE_4B_STRATEGY=e47c2c5faf1156ba7e64d4687346bd6795d00ae3`;
    `DIFF_CHECK=pass`; `TIMER_ABSENT=pass`.
  - Evidence: the worktree `BATCH_COMPAT` run on commit `60a5ec7` printed
    `BATCH_COMPAT_RUNS=180` and
    `BATCH_COMPAT=b492c77c29fe854f1edae945ed5842974acd5bcc83331ec10aa6e4cb13cfeed7`.
    The log is `/tmp/opencode/daily-schedule-r7-batch-compat.log`.
    `bash -n harness/cron-daily.sh` exited 0. `measure/doctor.sh` is not
    present. The strategy's Green gates passed.
  - Remediation at commit `60a5ec7` fixes F1, F2, F3, F4, F5, F6, and F9.
    F7 is contested because its comment and dead seam are in committed Red
    tests. F8 is declined because the finding concerns the unowned strategy.
    The implementation adds the Green regression test file.
  - Remediation gates: `GUARD_CHECK` exited 0 with 14 passed;
    `PUSH_RULE_CHECK` exited 0 with 4 passed;
    `SELECT_EXIT_CHECK` exited 0 with 4 passed;
    `GREEN_REGRESSION` exited 0 with 4 passed;
    `SCHEDULE_TEST` exited 0 with 82 passed. `BASH_N=pass`;
    `UNIT_CHECK_VERIFY=pass`; `UNIT_CHECK=pass`; `PATH_CHECK=pass`;
    `WEEKLY_SAME=pass`; `DOCS_CHECK=pass`;
    `BATCH_COMPAT_RUNS=180`; `BATCH_COMPAT=b492c77c29fe854f1edae945ed5842974acd5bcc83331ec10aa6e4cb13cfeed7`.
    The gate logs are under `/tmp/opencode/`.
- [x] 4b.6 Strategy amendment for the monthly window. 2a69a58 The strategy role amends
  `test-strategy.md`: section 5 interfaces (the new reasons and the new
  clean-read line), the section 6 case list, `GUARD_CHECK`, and `DOCS_CHECK`
  (the README names the monthly window). It also records the review
  dispositions: Review A N1 (a compare-fault test that cannot fail) goes to
  Green; Review C F2 (`batch.sh:130-134`) is declined, because the price table
  holds batch models today.
  - Verify: the strategy role gate prints `PASS: strategy gate passed`.
  - Evidence: the amendment commit is `2a69a5869cf976f869c29a02cad6c7189768c5c2`.
    Record it as `STRATEGY_4B6=2a69a5869cf976f869c29a02cad6c7189768c5c2`.
    Task 4b.7 uses it as the base of `RED_PATH_CHECK_4B7`, after the command
    of strategy section 2 prints `STRATEGY_4B6=ok`. `PHASE_4B_STRATEGY` is
    unchanged. The strategy role gate printed `PASS: strategy gate passed`
    (log `measure/runs/daily_model_schedule/strategy-0810d78.log`). The
    amendment adds the five monthly reasons and the clean-read line to
    section 5; cases 6.5.25 to 6.5.36 and the fixture rule to section 6.5;
    `GUARD_CHECK` with 26 case ids; `GREEN_REGRESSION`; `RED_PATH_CHECK_4B7`;
    the amended `DOCS_CHECK` (it exits 1 with `DOCS_CHECK=fail missing
    monthly window` before task 4b.8); adversarial cases 14 to 17; and the
    review dispositions of `1b17ae2` in section 13.
- [x] 4b.7 Red — commit `e38f94d`. The cases cover each new
  monthly reason, the weekly below-0 reason, the new clean-read line, 80 and
  80.0001 for the monthly window, a monthly stop before batch 2 that keeps
  the build run ids, and a dry-run monthly stop. The role updates existing
  fixtures and assertions to the new clean-read line where the amended
  strategy says so.
  - Verify: `SCHEDULE_TEST` exits non-zero, each new failure names the monthly
    rule of D12, `RED_PATH_CHECK_4B7=pass`, and the mid-red gate passes.
  - Evidence: commit `e38f94d` adds the Red work. It changes only the two
    test files. `Test Files  1 failed (1)`; `Tests  18 failed | 76 passed
    (94)`; exit 1. Log:
    `measure/runs/daily_model_schedule/red-4b7-schedule.log`.
  - Fixture-only step (strategy section 6.5, rule 7): the fixtures carry
    monthly 10, and no new case exists yet. `Test Files  1 failed (1)`;
    `Tests  6 failed | 76 passed (82)`; exit 1. The six failures are exactly
    cases 6.3.1, 6.5.8, 6.5.9, 6.5.10, 6.5.11, and 6.5.13, as rule 7
    allows. No other old case changed its meaning. Log:
    `measure/runs/daily_model_schedule/red-4b7-fixture.log`.
  - The 12 new failures are cases 6.5.25 to 6.5.36. Each names D12
    `BENCH_DAILY_QUOTA_CMD` and its monthly reason or clean-read line.
    Case 6.5.25 and sub-case 6.5.36(a) name the weekly below-0 rule.
    The current code reports `read failed` for a negative weekly value,
    because it passes the value as a bare Node argument.
  - `GUARD_CHECK` exits 1: `Tests  17 failed | 9 passed | 68 skipped (94)`.
    The filter matches 26 cases, so no filter skip hides a case (A4).
    Log: `measure/runs/daily_model_schedule/red-4b7-guard.log`.
  - `STRATEGY_4B6=ok`; `RED_PATH_CHECK_4B7=pass` at test HEAD `e38f94d`.
    The diff from `2a69a58` holds the two test files and `plan.md`. Log:
    `measure/runs/daily_model_schedule/red-4b7-path.log`.
  - `DOCS_CHECK` exits 1 with `DOCS_CHECK=fail missing monthly window`.
    Log: `measure/runs/daily_model_schedule/red-4b7-docs.log`.
  - No failure was a timeout or a fixture fault. `harness/cron-daily.sh`,
    `README.md`, `spec.md`, and `test-strategy.md` are unchanged.
  - The orchestrator mid-red gate passed. `RED_PATH_CHECK_4B7=pass` at
    test HEAD `10a2859`.
  - `phase_base_sha=e47c2c5faf1156ba7e64d4687346bd6795d00ae3` (the Phase 4b
    baseline of plan task 4b.2 and strategy section 9);
    `role_base_sha=adbc59d4c9ba5cdc3b9f1e1dd0b94ffe9535af68`;
    `STRATEGY_4B6=2a69a5869cf976f869c29a02cad6c7189768c5c2`. The three
    values resolve. Commit `e38f94d` is new Red work after the role base.
- [x] 4b.8 Green — implementation commit `b3e9130`. Implement the D12 amendment in
  `harness/cron-daily.sh`. Update the README for the monthly window. Fix the
  README lock sentence (Review C F1: `README.md:281` says a run can wait when
  a lock is held; the code skips the day with `DAILY SKIP lock held`). Make
  the Green compare-fault test able to fail (Review A N1).
  - The guard checks weekly first, then monthly, using one quota response.
    It uses the exact D12 stop reasons and clean-read line. The README names
    the monthly field and says the job skips when the lock is held.
  - Verify: `SCHEDULE_TEST` exited 0 with `Tests  94 passed (94)`.
    `GUARD_CHECK` exited 0 with `Tests  26 passed | 68 skipped (94)`.
    `GREEN_REGRESSION` exited 0 with `Tests  4 passed (4)`.
    `GREEN_MUTATION=fail-as-expected`; its command exited 0.
    `PUSH_RULE_CHECK` and `SELECT_EXIT_CHECK` each exited 0 with 4 passed
    and 90 skipped. `BATCH_COMPAT_RUNS=180` and
    `BATCH_COMPAT=b492c77c29fe854f1edae945ed5842974acd5bcc83331ec10aa6e4cb13cfeed7`.
  - Static gates: `BASH_N=pass`; `UNIT_CHECK_VERIFY=pass`;
    `UNIT_CHECK=pass`; `DOCS_CHECK=pass`; `PATH_CHECK=pass`;
    `WEEKLY_SAME=pass`; `STATUS_CHECK=pass blocked=3 open=1`;
    `DIFF_CHECK=pass`.
  - The Red baseline command exited 1 before implementation with
    `Tests  18 failed | 76 passed (94)`. Its log is
    `/tmp/opencode/daily-schedule-4b8-red-baseline.log`.
  - Gate logs: `/tmp/opencode/daily-schedule-4b8-schedule.log`,
    `/tmp/opencode/daily-schedule-4b8-guard.log`,
    `/tmp/opencode/daily-schedule-4b8-green.log`,
    `/tmp/opencode/daily-schedule-4b8-mutation.log`,
    `/tmp/opencode/daily-schedule-4b8-push.log`,
    `/tmp/opencode/daily-schedule-4b8-select.log`, and
    `/tmp/opencode/daily-schedule-4b8-batch-compat.log`.
    The Green regression file is the only new file.
- [x] 4b.4 9059895 — Reviews A, B, and C of the Phase 4b changes. A: the guard logic
  and the per-batch order against D12. B: the push rule of D13, the quota
  read over the local port, the credential, and the unattended timer. C:
  the new seams, the new labeled lines, the `go_guard_stop` field, and the
  unit-file text. Each role writes
  `measure/runs/daily_model_schedule/review-<a|b|c>-4b-<short head>.json`.
  - Verify: each `audit-result` prints `PASS: audit result is valid`, and each file shows `status: pass`.
  - Evidence: Reviews A, B, and C ran on `905989541f9473ddf1b1d34e81214ff4c400290d`. All show `status: pass`, and each `audit-result` printed `PASS: audit result is valid`. Review C passed the Phase 4 README gate. Files: `measure/runs/daily_model_schedule/review-a-4b-9059895.json` (claude-code/claude-sonnet-5-5#high), `review-b-4b-9059895.json` (kimi-code-plan-cn/kimi-for-coding), and `review-c-4b-9059895.json` (claude-code/claude-sonnet-5-5#high).
  - Accepted nonblocking items: Review A F3, F4, and F5 (plan text and duplicate code); Review C F1 (`README.md:273` says “weekly usage guard”); Review C F2 (`harness/batch.sh:3` says the guard checks the weekly window). README line 268 states both windows.
- [x] 4b.5 0174973 — Adversarial tests of the Phase 4b rules. The role adds the cases
  of the amended strategy section 12 (a quota JSON with a string number, a
  port that serves the wrong JSON, a push race between the check and the
  push) and writes
  `measure/runs/daily_model_schedule/adversarial-4b-<short head>.json`.
  Then the Phase 4b acceptance runs.
  - Verify: `SCHEDULE_TEST` exits 0 with the added cases, and the role file shows `status: pass`.
  - Evidence: the adversarial role ran on claude-code/claude-sonnet-5-5#high and added cases 12.8 to 12.20. Case 12.18 closes Review A F1; the monthly compare-fault mutation probe fails the case. `SCHEDULE_TEST` gave `Tests  107 passed (107)`, and `GREEN_REGRESSION` gave `Tests  4 passed (4)`. Result: `measure/runs/daily_model_schedule/adversarial-4b-9059895.json`, with `status: pass` and `audited_head_sha` `017497378eab8509d72da4283046ac80f5879400`. The orchestrator ran `role-gate --role measure-adversarial-testing`, which printed `PASS: adversarial-testing gate passed`.

## Phase 5: Doctor and owner gate

- [x] 5.1 Merge and doctor — commit `3277d2a`. In `main`, run `WORKLIST_SHA`, merge
  `daily-schedule`, and run `WORKLIST_SHA` again with no run between. Then
  run `BASE_HASH`, `SCHEDULE_TEST`, `META_LOGIC`, `BATCH_COMPAT`, and
  `PICK_MATCH`. Record each labeled line in this task. Then report the
  commit range `origin/main..main` to the PM orchestrator for the secret
  scan (O1 condition 3).

  The manual push is an owner action after the scan and before the install
  of task 5.3 — done 2026-11-01. The PM scans the range for secrets, then
  Daniel says "push" one time, and that one manual push sends `main` to
  `origin`. Until it happens, the job pushes nothing: the rule of spec D13
  skips every job push, because `origin/main` trails the merged branch.

  Recorded on 2026-10-31 in main after the merge:
  - `MERGE_COMMIT=3277d2ac54d81f1f19d772280a7391a21905498c`
  - `WORKLIST_BEFORE_ROWS=120`
  - `WORKLIST_BEFORE_SHA=2f5e65d6cf5df4aa2dc8e5f42d4650ced3040fc77903a1d7c06c395e59a61a28`
  - `WORKLIST_AFTER_ROWS=120`
  - `WORKLIST_AFTER_SHA=2f5e65d6cf5df4aa2dc8e5f42d4650ced3040fc77903a1d7c06c395e59a61a28`
  - `BASE_HASH runner=3e5a4c64c9bcd0b30d6143389c8e96b9a80d955681df7b072c394db937ab29ea`
  - `BASE_HASH suite=451652e5e03ee1d3030014c527bff7714740b96a38756853d5fc68276c522ae6`
  - `SCHEDULE_TEST Tests  107 passed (107)`; exit 0.
  - `GREEN_REGRESSION Tests  4 passed (4)`; exit 0.
  - `META_LOGIC=pass exit=0`; `Test Files  30 passed (30)`; `Tests  238 passed (238)`.
  - `BATCH_COMPAT_RUNS=180`
  - `BATCH_COMPAT=b492c77c29fe854f1edae945ed5842974acd5bcc83331ec10aa6e4cb13cfeed7`
  - `PICK_MATCH=pass date=2026-10-31 model=hy4-preview reason=untested last_test=none candidates=26 eligible=26 untested=11`
  - `UNIT_CHECK_VERIFY=pass`; `UNIT_CHECK=pass`.
  - `CONSENT_CHECK=pass lines=1` (the matching O1 row is line 506 of `spec.md`).
  - `DOCS_CHECK=pass`.
  - `TIMER_ABSENT_FILES=pass`. The shell denied `systemctl` and `crontab`, so their checks did not run.
  - Heavy-run logs: `/tmp/opencode/daily-model-schedule-5.1-base-hash.log`,
    `/tmp/opencode/daily-model-schedule-5.1-schedule-test.log`,
    `/tmp/opencode/daily-model-schedule-5.1-green-regression.log`,
    `/tmp/opencode/daily-model-schedule-5.1-meta-logic.log`,
    `/tmp/opencode/daily-model-schedule-5.1-batch-compat.log`, and
    `/tmp/opencode/daily-model-schedule-5.1-pick-match.log`.

  Recorded on 2026-11-01 and 2026-11-02 (secret scan and manual push):
  - The PM orchestrator scanned `f4712c6..c613bc8` (61 commits, 101 files) for secrets. The scan was clean.
  - Owner answer: "2. Push" (Daniel, 16:52 ICT 2026-11-01, relayed by the PM orchestrator).
  - A build session on `deepseek/deepseek-flash#high` pushed `main` to `origin` one time: fast-forward `f4712c6..c613bc8`, no force. The branch `daily-schedule` was not pushed.
  - `PUSH_CHECK=pass`. On 2026-11-02 at 12:43 ICT, `git rev-parse main` and `git rev-parse origin/main` both printed `c613bc88586efc8b090c673a2c758e02e6fe475e`.

  Recorded on 2026-10-25 in `main`:
  - `PHASE_BASE=3c2150271e435cfd8bac451e22f37264f8052aea`
  - `BASE_HASH runner=3e5a4c64c9bcd0b30d6143389c8e96b9a80d955681df7b072c394db937ab29ea`
  - `BASE_HASH suite=451652e5e03ee1d3030014c527bff7714740b96a38756853d5fc68276c522ae6`
  - `WORKLIST_ROWS=120`
  - `WORKLIST_SHA=2f5e65d6cf5df4aa2dc8e5f42d4650ced3040fc77903a1d7c06c395e59a61a28`
  - `BATCH_COMPAT_RUNS=180`
  - `BATCH_COMPAT=b492c77c29fe854f1edae945ed5842974acd5bcc83331ec10aa6e4cb13cfeed7`
  - `PI_RUNS=95`
  - `PI_SHA=cbb545a856d936c4ea4200ed4e8841362badc31fdd19a4962408e31bd2f297ca`
  The worktree harness links the `node_modules` of `main`, because the npm
  registry read timed out. The lockfile hashes match on both trees:
  `3079afaa31f19f9665856b0cb8ed7d8b6b208bd56280896fcc741b1c428afde9`.
  - Verify: the two `WORKLIST_SHA` lines are equal, and `BASE_HASH` equals task 1.2, or the orchestrator names the other track that changed it.
  - Verify: `SCHEDULE_TEST` and `META_LOGIC` exit 0, and `BATCH_COMPAT` equals task 1.2.
  - Verify: `PICK_MATCH` prints `PICK_MATCH=pass date=<day> model=<id> reason=<reason> ...`.
  - Verify: the commit range `origin/main..main` was reported to the PM orchestrator, and after the one manual push, `git rev-parse origin/main` equals `git rev-parse main`.
- [x] 5.2 Owner decision O1. The answer is recorded in the spec table: 48ccc11
  approved 2026-10-31 with 3 conditions (spec O1 row; rules D11 to D14).
  The PM orchestrator relayed Daniel's answer "Approve with conditions"
  (Tasks, 2026-10-31 12:01 ICT). The decision request showed the
  `PICK_MATCH` line of task 4.1, the spend of spec D1, and the push scope;
  condition 3 replaces the old push scope with the rule of D13. The three
  conditions are exact in quotation in the spec row.
  - Verify: `CONSENT_CHECK` prints exactly 1 line: `rg -n '^\| O1 \|.*\| approved 20[0-9]{2}-[0-9]{2}-[0-9]{2}' measure/tracks/daily_model_schedule/spec.md`.
  - Evidence: commit `48ccc11` records the answer. At `48ccc11`,
    `CONSENT_CHECK` printed exactly 1 line (spec.md line 484):

    ```
    484:| O1 | Install the systemd user timer of D11 (unit files `harness/systemd/lending-desk-daily.service` and `harness/systemd/lending-desk-daily.timer`, `OnCalendar` Wednesday and Sunday 01:00 local time, `Persistent=false`). This starts a paid run of 12 agent runs on each run day. The run days are Wednesday and Sunday. The job pushes its own `docs/` commit under the push rule of D13. Spend is 1.07 USD per run day on average and 3.24 USD at the observed maximum. The week has about 2 run days. | Approve after the real-data dry run of task 4.1 passes and `opencode_executor` task 4.2 closes. Spend from EV11: 1.07 USD each run day on average, 3.24 USD at the observed maximum. | approved 2026-10-31 — Daniel answered "Approve with conditions" (Tasks, 2026-10-31 12:01 ICT, relayed by the PM orchestrator), with 3 conditions, exact in quotation: (1) "A systemd user timer, not a crontab line (house rule: every scheduled job is a systemd user unit + timer). Same schedule: Wednesday and Sunday 01:00. Use Persistent=false, so a missed run never starts at boot and spends Go use at an unplanned time. Put the .service and .timer files in your repo; do not install them yet." (2) "Go guard: the job skips a run day (exit 0, one clear log line, no model call) when the OpenCode Go weekly window is above 80 %, or when it cannot read the window. Read it from OpenChamber: port from `openchamber status --json`, GET /api/quota/opencode-go, usage.windows.weekly.usedPercent. The job must never draw on the paid Go credit balance." (3) "Push: no push by the job until one manual push. After your merge (task 5.1), tell me the commit range; I scan it for secrets, then Daniel says \"push\" once. After that, the job pushes only its own docs commit." Within condition 2 the PM also accepted (2026-10-31): "read the Go guard again before each of the 4 track batches, and stop the day at the first reading above 80 % or at an unreadable window. Log one line for each stop." Rules: D11, D12, D13, D14. Timing (PM): the owner installs after task 5.1, after the secret scan and the one manual push, after the selector exit fix (D14), and after 2026-11-02 07:00 (the Go week reset). First run day: Wednesday 2026-11-04 01:00. |
    ```
- [x] 5.3 Systemd user timer install (unit files at `c613bc8`), an owner action, only after O1 is
  approved, after the one manual push of task 5.1, and after 2026-11-02
  07:00 (the Go week reset). Before it, run `PI_SHA day0` and
  `ls runs > .tmp/daily-runs-before.txt` in `main`. The owner installs the
  two unit files of spec D11 (`harness/systemd/lending-desk-daily.service`
  and `harness/systemd/lending-desk-daily.timer`) as systemd user units,
  and enables the timer. The first run day is Wednesday 2026-11-04 at
  01:00. No crontab line is installed. — done 2026-11-02
  - Verify: `TIMER_CHECK` prints `TIMER_CHECK=pass` (the strategy role writes the command in task 4b.1).
  - Verify: `crontab -l | grep -c '^# DISABLED 2026-10-25 by owner request'` prints `1`.
  - Verify: `crontab -l | grep -c 'cron-daily'` prints `0`.
  - Evidence, recorded on 2026-11-02 in `main`:
    - Owner authorization, exact words: "I am not at the computer. You need to run these." (Daniel, Google Tasks `MUZDR0tIVkI1dW9kU3NLUA`, 10:18 ICT 2026-11-02, reply to the install note `YUhGSDNCME1NaW05WmM4Xw`, relayed by the PM orchestrator). On this authorization, a build session ran the install for the owner.
    - Order: O1 approved 2026-10-31 (task 5.2); the manual push on 2026-11-01 (task 5.1); the Go week reset on 2026-11-02 at 07:00; the day-0 snapshot at 07:28 ICT; the install at 12:41 ICT.
    - Day-0 snapshot (session `Build · P5 5.3 · daily_model_schedule`, `SNAPSHOT=pass`; the timer was `not-found` at 07:28:58 ICT): `PI_RUNS=95`; `PI_SHA=cbb545a856d936c4ea4200ed4e8841362badc31fdd19a4962408e31bd2f297ca`; `PI_BASE_MATCH=yes` (equal to task 1.2); file `measure/runs/daily_model_schedule/pi-day0.txt`. The file `.tmp/daily-runs-before.txt` holds 547 lines, sha256 `91c3768582946df84a4be215f49310914ea0fb5f54059e577ab5594f1ab7dbf1`.
    - Install (session `ses_e653995dfffeR2agIbn5Db3NHw`, `INSTALL=pass`). Each command ran in its own shell call, and each exited 0:
      1. `cp /home/daniebo/Desktop/lending-desk-bench/harness/systemd/lending-desk-daily.service /home/daniebo/Desktop/lending-desk-bench/harness/systemd/lending-desk-daily.timer /home/daniebo/.config/systemd/user/`: no output.
      2. `systemctl --user daemon-reload`: no output.
      3. `systemctl --user enable --now lending-desk-daily.timer`: `Created symlink '/home/daniebo/.config/systemd/user/timers.target.wants/lending-desk-daily.timer' → '/home/daniebo/.config/systemd/user/lending-desk-daily.timer'.`
      4. `systemctl --user list-timers`: the timer row is `Wed 2026-11-04 01:00:00 +07 1 day 12h -                                      - lending-desk-daily.timer                      lending-desk-daily.service`.
    - The service did not start: `systemctl --user is-active lending-desk-daily.service` printed `inactive`, `ExecMainStartTimestamp` was empty, and `reports/cron-daily.log` was absent.
    - The installed unit files equal the repository files (`cmp`, `UNITS_IDENTICAL=yes`). `UnitFileState=enabled`; `ActiveEnterTimestamp=Mon 2026-11-02 12:41:57 +07`; `NextElapseUSecRealtime=Wed 2026-11-04 01:00:00 +07`.
    - `TIMER_CHECK=pass` (exit 0, 12:43 ICT; the orchestrator ran it read-only).
    - `crontab -l | grep -c '^# DISABLED 2026-10-25 by owner request'` printed `1`. `crontab -l | grep -c 'cron-daily'` printed `0`.
    - Route deviation: `ra-quota pick record` gave `openai/gpt-6-luna#high`. `session.create` opened the session with the read-only orchestrator agent. That agent passed the brief to a build session on `minimax-cn-coding-plan/MiniMax-M3.1-Flash`. The PM orchestrator accepted the route (12:53 ICT 2026-11-02; an allowed route), so the install did not run again.
- [b] 5.4 First live day. After the first job ends, run `DAY_CHECK <day>`,
  `PUBLISH_CHECK <day>`, `PI_SHA day1`, and `PI_CHECK day0 day1` in `main`.
  Record each labeled line in this task. Check the guard and the push rule
  in `reports/cron-daily.log`: the day holds one `DAILY GO-GUARD
  weekly=<n> monthly=<m>` line before each of the 4 batches, or one
  `DAILY SKIP go-guard: <reason>` line on a stopped day; and the publish
   ends with `DAILY PUBLISH <sha>` after a pushed commit, or with one
   `DAILY PUSH skipped: <reason>` line. Record each line in this task.

   - First live day, 2026-11-04 (record date 2026-11-03):
     - `systemctl --user status lending-desk-daily.service`: started `Wed 2026-11-04 01:00:06 +07`; main process exited with `status=2/INVALIDARGUMENT` at 01:01:05; the service failed with result `exit-code` at 01:01:11.
     - `reports/cron-daily.log` has exactly three lines: `DAILY START 2026-11-04T01:00:06+07:00`, `DAILY_PICK date=2026-11-03 model=hy4-preview reason=untested last_test=none candidates=26 eligible=26 untested=11`, and `DAILY FAIL playwright: Chromium is missing`. The log has no `GO-GUARD`, `DAILY PUSH`, or `DAILY PUBLISH` lines.
     - `reports/daily/2026-11-03.json`: `model=hy4-preview`, `reason=untested`, `run_ids=[]`, `runner_exit=null`, `go_guard_stop=null`.
     - `ls runs | wc -l` printed `547`; `.tmp/daily-runs-before.txt` has `547` lines. The day made no run, batch, model call, publish commit, or push.
     - Cause: `harness/cron-daily.sh:356-360` stops with exit 2 when no `~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell` exists. The cache now holds only `.links` and `ffmpeg-1011`. The PM log records Daniel's 2026-11-03 21:21 ICT order to delete Chromium builds older than `156.0.8078.73`; the PM deleted `chromium_headless_shell-1234` (`151.0.7922.34`), `-1243`, and `-1228`.
     - `DAY_CHECK` fix: exclude dot entries from the `runs` difference. The check skips dot entries such as `runs/.port-locks`, because `ls runs` does not list them.
     - `DAY_CHECK 2026-11-03`: `AssertionError: DAY_CHECK=fail no new run directory`; exit 1.
     - `PI_SHA day1`: `PI_RUNS=95` and `PI_SHA=cbb545a856d936c4ea4200ed4e8841362badc31fdd19a4962408e31bd2f297ca`; exit 0.
     - `PI_CHECK day0 day1`: `PI_CHECK=pass`; exit 0.
     - `PUBLISH_CHECK 2026-11-03 skipped`: printed no pass line; exit 1. Its first step found no matching publish commit.
     - Gate defect: `DAY_CHECK <day>` in `test-strategy.md` used `os.listdir("runs")`, while the day-0 list used `ls runs`. The always-new `runs/.port-locks` entry caused `FileNotFoundError: [Errno 2] No such file or directory: 'runs/.port-locks/artifacts/provenance.json'`, exit 1.
     - `PUBLISH_CHECK 2026-11-03 skipped` fails at its first step because `git log -1 --format=%H --grep="^Publish daily 2026-11-03 "` prints nothing.
     - Go quota at 02:38 ICT: monthly use was `75.3 %` and reset was `Sat 2026-11-21 20:44`; weekly use was `8.3 %`; balance was `$17.02`. This day spent no Go quota.
     - PM 2026-11-03: light lane
     - Blocker: the next live day needs a grader browser. Daniel decides through the PM: (a) restore the pinned build `chromium_headless_shell-1234`, which keeps all scores comparable; or (b) move to system Chrome (`channel: "chrome"`), which changes `runner_sha256` (`harness/browser-check.ts`) and `suite_sha256` (`harness/playwright.config.ts`) and makes every trusted score stale.
     - The timer stays enabled. Until Daniel decides, each day stops at this check with exit 2, before any batch, model call, or push.

  Recorded on 2026-10-25 in `main`:
  - `PHASE_BASE=3c2150271e435cfd8bac451e22f37264f8052aea`
  - `BASE_HASH runner=3e5a4c64c9bcd0b30d6143389c8e96b9a80d955681df7b072c394db937ab29ea`
  - `BASE_HASH suite=451652e5e03ee1d3030014c527bff7714740b96a38756853d5fc68276c522ae6`
  - `WORKLIST_ROWS=120`
  - `WORKLIST_SHA=2f5e65d6cf5df4aa2dc8e5f42d4650ced3040fc77903a1d7c06c395e59a61a28`
  - `BATCH_COMPAT_RUNS=180`
  - `BATCH_COMPAT=b492c77c29fe854f1edae945ed5842974acd5bcc83331ec10aa6e4cb13cfeed7`
  - `PI_RUNS=95`
  - `PI_SHA=cbb545a856d936c4ea4200ed4e8841362badc31fdd19a4962408e31bd2f297ca`
  The worktree harness links the `node_modules` of `main`, because the npm
  registry read timed out. The lockfile hashes match on both trees:
  `3079afaa31f19f9665856b0cb8ed7d8b6b208bd56280896fcc741b1c428afde9`.
  - Verify: `DAY_CHECK` prints `DAY_CHECK=pass model=<id> runs=<n> harness=<k>`, and `<id>` equals the model of `reports/daily/<day>.json`.
  - Verify: `PUBLISH_CHECK` prints `PUBLISH_CHECK=pass <sha>`, and `PI_CHECK day0 day1` prints `PI_CHECK=pass`.
  - Verify: `reports/cron-daily.log` holds the guard lines of the day (four `DAILY GO-GUARD weekly=<n>` lines, or one `DAILY SKIP go-guard: <reason>` line) and the push result (`DAILY PUBLISH <sha>` or one `DAILY PUSH skipped: <reason>` line).

## Phase 6: Publish on every good run and a visible failure (PM 2026-11-13)

The PM order of 2026-11-13 changes three rules (spec EV13 to EV20). The job
publishes after a zero-run guard stop (D15). The push is a fast-forward that
carries the waiting local commits (D16). A failed run and a published run
each send one line to the PM (D17).

measure-guard denies `[~]` while an earlier phase holds no checkpoint, so the
tasks of this phase go from `[ ]` to `[x]`. Do not try `[~]`. Do not add a
checkpoint to an earlier phase.

Finding F4 (2026-11-13 22:13, PM): the real notice path was guarded by
`VITEST` only. A hand live run sent a real line that looked like a timer run
(spec EV25). D20 gates the real transport on the systemd timer unit or an
explicit live flag.

- [x] 2369824 6.1 Red: the amendment of the spec and the Red tests. The role adds
  D15, D16, and D17 to `spec.md`, with FR-14, FR-15, and FR-16, with AC-13,
  AC-14, and AC-15, and with the new text of R4. The role adds the test file
  `harness/schedule-tests/daily-publish-notice.test.ts` with the cases N1 to
  N11. The role moves the D13 cases of
  `harness/schedule-tests/daily-schedule.test.ts` (6.5.15, 6.5.16, 6.5.17,
  12.12, and 12.13) to D16. Every schedule-test file that starts
  `cron-daily.sh` sets `BENCH_DAILY_NOTIFY_CMD` to a sink, so no test can
  reach the PM session.
  - Verify: `cd harness && npx vitest run schedule-tests/daily-publish-notice.test.ts --configLoader native --maxWorkers=1` exits non-zero, and each failure names a missing rule of D15, D16, or D17.
  - Verify: `cd harness && npx vitest run schedule-tests/daily-schedule.test.ts --configLoader native --maxWorkers=1` fails only in the cases 6.5.15, 6.5.16, and 6.5.17.
  - Lane: light lane. Maker: minimax-cn-coding-plan/MiniMax-M3.1-Flash (Red). Checker: claude-code/claude-sonnet-5-5#high (task 6.3). The checker family differs from every maker family.
  - Evidence: commit `b731efb` holds the spec amendment and this phase of the
    plan. Commit `2369824` holds the Red work: the new test file and the
    three changed test files. No production file changed.
  - Command: `cd harness && npx vitest run schedule-tests/daily-publish-notice.test.ts --configLoader native --maxWorkers=1`.
    `Test Files  1 failed (1)`; `Tests  9 failed | 2 passed (11)`; exit 1.
    The failing cases are N1 (D15), N3, N4, N5, and N6 (D16), and N7, N8,
    N9, and N11 (D17). Each failure names the missing rule. The cases N2 and
    N10 pass at HEAD: they hold the rule that a day with no push sends
    nothing.
  - Command: `cd harness && npx vitest run schedule-tests/daily-schedule.test.ts --configLoader native --maxWorkers=1`.
    `Test Files  1 failed (1)`; `Tests  3 failed | 104 passed (107)`; exit 1.
    The failing cases are 6.5.15, 6.5.16, and 6.5.17. The cases 12.12 and
    12.13 keep the D16 label and pass.
  - Command: `cd harness && npx vitest run schedule-tests/daily-schedule-green.test.ts --configLoader native --maxWorkers=1`.
    `Test Files  1 passed (1)`; `Tests  4 passed (4)`; exit 0.
  - Command: `cd harness && npx vitest run schedule-tests/daily-selfcheck-default.test.ts --configLoader native --maxWorkers=1`.
    `Test Files  1 passed (1)`; `Tests  2 passed (2)`; exit 0.
  - Command: `ps -eo pid,args | grep '[f]ake-openc'`. It prints no line.
  - Host load: another project ran a heavy suite on this machine (load
    average 5.7). One full run of the file hit the 30 s case timeout in the
    case 12.1 and gave `Tests  4 failed | 103 passed (107)`. The case 12.1
    alone gave `Tests  1 passed | 106 skipped (107)`. The last full run gave
    `Tests  3 failed | 104 passed (107)`. No failure came from a test fault.
  - Deviation: measure-guard denies `[~]` while an earlier phase holds no
    checkpoint, so the task went from `[ ]` to `[x]`.
- [x] 57fc537 6.1b Red: the second amendment, from the PM decisions of 2026-11-13.
  The role adds D18 and D19 to `spec.md`, with the amended FR-10, FR-14,
  FR-16, AC-9, AC-13, and AC-15. The role adds the Red tests of the
  monthly limit of 95 and of the exit codes 0, 3, 1, 2, 130, and 143. The
  cases of `harness/schedule-tests/daily-schedule.test.ts` that assert exit
  0 on a live guard stop, a held lock, or the reason `none` now assert exit
  3. The cases N1, N2, N3, N7, and N10 of
  `harness/schedule-tests/daily-publish-notice.test.ts` change with the new
  exit codes. The role adds the cases N12, N13, and N14.
  - Verify: `cd harness && npx vitest run schedule-tests/daily-publish-notice.test.ts --configLoader native --maxWorkers=1` exits non-zero, and each failure names a missing rule of D15 to D19.
  - Verify: `cd harness && npx vitest run schedule-tests/daily-schedule.test.ts --configLoader native --maxWorkers=1` fails only in the cases that the role changed or added, and in the cases 6.5.15, 6.5.16, and 6.5.17.
  - Lane: light lane. Maker: minimax-cn-coding-plan/MiniMax-M3.1-Flash (Red). Checker: a third family. The checker family differs from every maker family.
  - Evidence: commit `57432dd` holds the spec amendment and this plan task.
    Commit `57fc537` holds the Red work: the three test files. No production
    file changed.
  - Command: `cd harness && npx vitest run schedule-tests/daily-publish-notice.test.ts --configLoader native --maxWorkers=1 --reporter=verbose`.
    `Test Files  1 failed (1)`; `Tests  13 failed | 1 passed (14)`; exit 1.
    The failing cases are N1, N2, N3, N4, N5, N6, N7, N8, N9, N11, N12,
    N13, and N14. The case N10 passes: a dry run sends nothing.
    The missing rules are D19 (N1, N2, N9, N12, N13), D16 (N3, N4, N5, N6),
    D17 (N7, N8, N11), and D18 (N14).
  - Command: `cd harness && npx vitest run schedule-tests/daily-schedule-green.test.ts --configLoader native --maxWorkers=1 --reporter=verbose`.
    `Test Files  1 failed (1)`; `Tests  2 failed | 2 passed (4)`; exit 1.
    The failing cases are the two live guard-stop cases: "stops with read
    failed when the quota compare process fails" and "runs D12 steps 5 to 9
    after a stop before batch 2". Both expect exit 3 (D19).
  - Command: `cd harness && npx vitest run schedule-tests/daily-schedule.test.ts --configLoader native --maxWorkers=1 --reporter=verbose`.
    `Test Files  1 failed (1)`; `Tests  37 failed | 72 passed (109)`; exit 1.
    The failing cases are 6.3.7, 6.3.9, 6.3.11, 6.5.1, 6.5.4, 6.5.5, 6.5.6,
    6.5.7, 6.5.8, 6.5.9, 6.5.10, 6.5.15, 6.5.16, 6.5.17, 6.5.21, 6.5.24,
    6.5.25, 6.5.26, 6.5.27, 6.5.28, 6.5.29, 6.5.32, 6.5.34, 6.5.36, 6.5.37,
    6.5.38, 12.8, 12.9, 12.10, 12.11, 12.14, 12.15, 12.16, 12.17, 12.18,
    12.19, and 12.20. Every one of them is a case the role changed or
    added, or one of the cases 6.5.15 to 6.5.17. The shared helpers
    `assertSkip`, `assertMidStop`, and `assertHiddenStop` now expect exit 3,
    so every case that uses one of them fails at HEAD. The dry-run cases
    keep exit 0 and pass. No case failed from a timeout.
  - Command: `ps -eo pid,args | grep '[f]ake-openc'`. It prints no line.
  - Deviation: measure-guard denies `[~]` while an earlier phase holds no
    checkpoint, so the task went from `[ ]` to `[x]`.
  - Red retry (2026-11-13, from Green 6.2): commit `94c2c08` fixes two Red
    faults. First, the case N4 and the case 6.5.16 expected the fail line
    `DAILY FAIL publish: origin/main is not an ancestor of the docs commit;
    the commit is local`. Spec D16 gives the text with the prefix
    `DAILY FAIL push:`. Both cases now expect the D16 text. No other
    assertion changed. Second, the spec amendment of the same day changes
    the notice seam of D17: `BENCH_DAILY_NOTIFY_CMD` names an executable, and
    the job runs `"$BENCH_DAILY_NOTIFY_CMD" "<line>"`, with the line as its
    only argument. The old sentence stays for the record. The fixtures stay
    unchanged.
    - Verify: `cd harness && npx vitest run schedule-tests/daily-publish-notice.test.ts --configLoader native --maxWorkers=1 --reporter=verbose -t "N4"` exits non-zero. The case N4 still fails, because the code of task 6.2 is not written yet.
    - Evidence: `Test Files  1 failed (1)`; `Tests  1 failed | 13 skipped (14)`; exit 1. The failure names the missing D16 fail line.
- [x] 2f57a2d 6.1c Red: the notice gate (D20), from finding F4. The role adds D20
  and EV25 to `spec.md`, with the amended FR-16 and AC-15. The role adds
  the test file `harness/schedule-tests/notice-seam-guard.test.ts` with the
  cases G1 to G5. Every helper that starts `cron-daily.sh` in
  `harness/schedule-tests/` sets `BENCH_DAILY_NOTIFY_CMD` to a sink, the dry
  run helpers too.
  - Verify: `cd harness && npx vitest run schedule-tests/notice-seam-guard.test.ts --configLoader native --maxWorkers=1` exits non-zero, and each failure names a missing rule of D20.
  - Verify: the static case G1 passes, so no test file starts the job without the seam.
  - Lane: light lane. Maker: minimax-cn-coding-plan/MiniMax-M3.1-Flash (Red). Checker: volcengine-agent-plan/glm-5.3-flash#high (task 6.3b). The checker family differs from every maker family.
  - Evidence: commit `ced89e5` holds the spec amendment (D20, EV25, the
    amended FR-16 and AC-15) and this plan task. Commit `2f57a2d` holds the
    Red work: the new test file and the three changed test files. No
    production file changed.
  - Command: `cd harness && npx vitest run schedule-tests/notice-seam-guard.test.ts --configLoader native --maxWorkers=1 --reporter=verbose`.
    `Test Files  1 failed (1)`; `Tests  2 failed | 3 passed (5)`; exit 1.
    The failing cases are G2 and G4. The case G2 fails because the job
    prints no `DAILY NOTIFY skipped: not the timer unit` line. The case G4
    fails because the hand line starts with `lending-desk-daily FAIL `
    instead of `lending-desk-daily HAND FAIL `. The cases G1, G3, and G5
    pass at HEAD: the seam is in every test file that starts the job, the
    timer path of D17 already sends the real line, and the `VITEST` rule of
    D17 already skips the send. The cases G3 and G5 guard that the gate of
    D20 keeps both paths.
  - Command: `cd harness && npx vitest run schedule-tests/daily-served-retry.test.ts --configLoader native --maxWorkers=1 --reporter=verbose`.
    `Test Files  1 passed (1)`; `Tests  3 passed (3)`; exit 0.
  - Command: `cd harness && npx vitest run schedule-tests/opencode-host-isolation.test.ts --configLoader native --maxWorkers=1 --reporter=verbose`.
    `Test Files  1 passed (1)`; `Tests  11 passed (11)`; exit 0.
  - Command: `cd harness && npx vitest run schedule-tests/opencode-host-trap.test.ts --configLoader native --maxWorkers=1 --reporter=verbose`.
    `Test Files  1 passed (1)`; `Tests  4 passed (4)`; exit 0.
  - Command: `ps -eo pid,args | grep '[f]ake-openc'`. It prints no line.
  - Deviation: measure-guard denies `[~]` while an earlier phase holds no
    checkpoint, so the task went from `[ ]` to `[x]`.
- [x] 0a57c28 6.2 Green: the code in `harness/cron-daily.sh` only. The role
  implements D15, D16, D17, D18, and D19 in that file. No other file
  changes. Green: `claude-code/claude-sonnet-5-5#high` (PM 2026-11-13).
  - Verify: each test file of the phase alone with `--configLoader native --maxWorkers=1` exits 0.
  - Verify: `bash -n harness/cron-daily.sh` exits 0.
  - Lane: light lane. Maker: claude-code/claude-sonnet-5-5#high (Anthropic). Checker: a third family. The checker family differs from every maker family.
  - Evidence: commit `0a57c28` changes `harness/cron-daily.sh` only. Round 1
    of the role was blocked by two Red faults (the D16 fail line of N4 and
    6.5.16, and the D17 notice transport). The Red retry fixed both
    (commits `94c2c08` and `643cf77`). Round 2 made this commit.
  - Command: `cd harness && npx vitest run schedule-tests/daily-publish-notice.test.ts --configLoader native --maxWorkers=1 --reporter=verbose`.
    `Test Files  1 passed (1)`; `Tests  14 passed (14)`; exit 0.
  - Command: `cd harness && npx vitest run schedule-tests/daily-schedule-green.test.ts --configLoader native --maxWorkers=1 --reporter=verbose`.
    `Test Files  1 passed (1)`; `Tests  4 passed (4)`; exit 0.
  - Command: `cd harness && npx vitest run schedule-tests/daily-selfcheck-default.test.ts --configLoader native --maxWorkers=1 --reporter=verbose`.
    `Test Files  1 passed (1)`; `Tests  2 passed (2)`; exit 0.
  - Command: `cd harness && npx vitest run schedule-tests/daily-schedule.test.ts --configLoader native --maxWorkers=1 --reporter=verbose`.
    `Test Files  1 passed (1)`; `Tests  109 passed (109)`; exit 0.
  - Command: `cd harness && npx vitest run schedule-tests/opencode-host-isolation.test.ts --configLoader native --maxWorkers=1 --reporter=verbose`.
    `Tests  11 passed (11)`.
  - Command: `cd harness && npx vitest run schedule-tests/opencode-host-trap.test.ts --configLoader native --maxWorkers=1 --reporter=verbose`.
    `Tests  4 passed (4)`.
  - Command: `cd harness && npx vitest run schedule-tests/daily-served-retry.test.ts --configLoader native --maxWorkers=1 --reporter=verbose`.
    `Tests  3 passed (3)`.
  - Command: `cd harness && npx vitest run schedule-tests/credential-seed-backoff.test.ts --configLoader native --maxWorkers=1 --reporter=verbose`.
    `Tests  4 passed (4)`.
  - Command: `cd harness && bash -n cron-daily.sh`. Exit 0.
  - Command: `cd harness && ./node_modules/.bin/tsx provenance.ts --shell`.
    `runner_sha256` `9d26e6c875288d4b8d1c25850673bc464e6aa58610676073a3030e36eb3395ef`
    and `suite_sha256` `8a24205b405a9aae22cf2412d3fc9a40b4b3ffdb30e2a0c0cfa26c4405ee734d`.
    Both are unchanged.
  - Command: `ps -eo pid,args | grep -E '[f]ake-openc|[c]ron-daily'`. It prints no line.
  - Choices that the spec does not state: a failed batch prints
    `DAILY FAIL runner: the <track> batch exited <n>` (the first failed batch)
    and keeps its exit code. An invalid `BENCH_DAILY_DATE` exits 2 before the
    EXIT trap and sends no notice (a test seam). With `VITEST` set and no
    notice command the job prints only `DAILY NOTIFY skipped: test`.
    `BENCH_DAILY_PUBLISH=0` on a guard stop prints `DAILY PUBLISH skipped`
    and exits 3, with a SKIP line `publish=none`.
  - Deviation: measure-guard denies `[~]` while an earlier phase holds no
    checkpoint, so the task went from `[ ]` to `[x]`.
- [x] 729780f 6.3 Checker review of the amendment, of task 6.1, of task 6.1b, and of
  task 6.2. The role reviews D18 and D19 with the rest. The
  role writes `measure/runs/daily_model_schedule/check-6.3.json`.
  - Verify: the file shows `status: pass` and 0 blocking findings.
  - Lane: light lane. Checker: a third family. The family differs from every maker family.
  - Evidence: `measure/runs/daily_model_schedule/check-6.3.json`.
    `status: pass`; `retry_recommendation: none`; `audited_head` `729780f`;
    0 blocking findings; 3 nonblocking findings.
  - Checker model: `volcengine-agent-plan/glm-5.3-flash#high` (GLM). The
    family differs from MiniMax (Red) and from Anthropic (Green).
  - Substitution: two checkers stopped at their start with "Free usage
    limit reached": `opencode/deepseek-v4.1-flash-free#high` and
    `opencode/glm-5.3-flash-free#high`. `ra-quota` had no other GO route
    outside the maker families and Kimi, except Codex. The Ark Agent plan
    was WAIT by about 2 points of month pace. The orchestrator used it for
    the deadline of 2026-11-14 18:00.
  - F1 (Major): the out-of-scope item "Any change of the Go guard limit"
    contradicted D18. Fixed by Red in commit `0ff9ef3` (spec text only).
  - F2 (Minor): risk R3 held the old limit of 80. Fixed by Red in commit
    `0ff9ef3` (spec text only).
  - F3 (Minor): a batch that exits 3 leaves the job exit 3, and the FAIL
    line names it. Open, nonblocking.
  - Deviation: measure-guard denies `[~]` while an earlier phase holds no
    checkpoint, so the task went from `[ ]` to `[x]`.
- [x] 17b8e25 6.2b Green: the notice gate of D20 in `harness/cron-daily.sh` only. The
  role reads the cgroup file, and it sends the real line only under the
  timer unit or under `BENCH_DAILY_NOTIFY_LIVE=1`. A hand run sends a HAND
  line. No other file changes.
  - Verify: each test file of the phase alone with `--configLoader native --maxWorkers=1` exits 0.
  - Verify: `bash -n harness/cron-daily.sh` exits 0.
  - Lane: light lane. Maker: claude-code/claude-sonnet-5-5#high (Anthropic). Checker: volcengine-agent-plan/glm-5.3-flash#high (task 6.3b). The checker family differs from every maker family.
  - Evidence: commit `17b8e25` changes `harness/cron-daily.sh` only. The gate
    order in `daily_notify`: the seam `BENCH_DAILY_NOTIFY_CMD`, then the
    `VITEST` rule, then the timer unit (the cgroup file holds
    `/lending-desk-daily.service`) or `BENCH_DAILY_NOTIFY_LIVE=1`. Otherwise
    the job prints `DAILY NOTIFY skipped: not the timer unit`. A line sent
    under the live flag outside the unit starts `lending-desk-daily HAND `.
    The header seam list holds `BENCH_DAILY_CGROUP_FILE` and
    `BENCH_DAILY_NOTIFY_LIVE`.
  - Command: `cd harness && npx vitest run schedule-tests/notice-seam-guard.test.ts --configLoader native --maxWorkers=1 --reporter=verbose`.
    `Test Files  1 passed (1)`; `Tests  5 passed (5)`; exit 0.
  - Command: `cd harness && npx vitest run schedule-tests/daily-publish-notice.test.ts --configLoader native --maxWorkers=1 --reporter=verbose`.
    `Test Files  1 passed (1)`; `Tests  14 passed (14)`; exit 0.
  - Command: `cd harness && npx vitest run schedule-tests/daily-schedule-green.test.ts --configLoader native --maxWorkers=1 --reporter=verbose`.
    `Tests  4 passed (4)`.
  - Command: `cd harness && npx vitest run schedule-tests/daily-selfcheck-default.test.ts --configLoader native --maxWorkers=1 --reporter=verbose`.
    `Tests  2 passed (2)`.
  - Command: `cd harness && npx vitest run schedule-tests/daily-schedule.test.ts --configLoader native --maxWorkers=1 --reporter=verbose`.
    `Test Files  1 passed (1)`; `Tests  109 passed (109)`; exit 0.
  - Command: `cd harness && npx vitest run schedule-tests/daily-served-retry.test.ts --configLoader native --maxWorkers=1 --reporter=verbose`.
    `Tests  3 passed (3)`.
  - Command: `cd harness && npx vitest run schedule-tests/opencode-host-isolation.test.ts --configLoader native --maxWorkers=1 --reporter=verbose`.
    `Tests  11 passed (11)`.
  - Command: `cd harness && npx vitest run schedule-tests/opencode-host-trap.test.ts --configLoader native --maxWorkers=1 --reporter=verbose`.
    `Tests  4 passed (4)`.
  - Command: `cd harness && bash -n cron-daily.sh`. Exit 0.
  - Command: `cd harness && ./node_modules/.bin/tsx provenance.ts --shell`.
    Exit 0. `runner_sha256`
    `9d26e6c875288d4b8d1c25850673bc464e6aa58610676073a3030e36eb3395ef` and
    `suite_sha256`
    `8a24205b405a9aae22cf2412d3fc9a40b4b3ffdb30e2a0c0cfa26c4405ee734d`.
    Both are unchanged.
  - Command: `ps -eo pid,args | grep -E '[f]ake-openc|[c]ron-daily'`. It prints no line.
  - Note for the checker and for task 6.6: a transient `systemd-run --user`
    unit has no `lending-desk-daily.service` cgroup. A hand check from such a
    unit needs `BENCH_DAILY_NOTIFY_LIVE=1`, and then its line starts with
    `lending-desk-daily HAND `.
  - Deviation: measure-guard denies `[~]` while an earlier phase holds no
    checkpoint, so the task went from `[ ]` to `[x]`.
- [x] ec10e5a 6.3b Checker re-check of D20, of task 6.1c, and of task 6.2b. The role
  writes `measure/runs/daily_model_schedule/check-6.3b.json`.
  - Verify: the file shows `status: pass` and 0 blocking findings.
  - Lane: light lane. Checker: volcengine-agent-plan/glm-5.3-flash#high (GLM). The family differs from every maker family.
  - Evidence: `measure/runs/daily_model_schedule/check-6.3b.json`.
    `status: pass`; `retry_recommendation: none`; `audited_head` `ec10e5a`;
    0 blocking findings; 2 nonblocking findings.
  - Checker model: `volcengine-agent-plan/glm-5.3-flash#high` (GLM). The
    family differs from MiniMax (Red) and from Anthropic (Green). This is the
    same substitution as in task 6.3.
  - N1 (Nit): the case G1 is a text check, and its scan covers the top level
    of `harness/schedule-tests/` and `harness/tests/` only. Open, nonblocking.
  - F3 (Minor, from check-6.3): a batch that exits 3 leaves the job exit 3,
    and the FAIL line names it. Open, nonblocking.
  - Deviation: measure-guard denies `[~]` while an earlier phase holds no
    checkpoint, so the task went from `[ ]` to `[x]`.
- [x] 0ff9ef3 6.4 Hashes. The role runs the hash command and records both values.
  - Command: `cd harness && ./node_modules/.bin/tsx provenance.ts --shell`.
  - Verify: the output holds `runner_sha256` `9d26e6c875288d4b8d1c25850673bc464e6aa58610676073a3030e36eb3395ef` and `suite_sha256` `8a24205b405a9aae22cf2412d3fc9a40b4b3ffdb30e2a0c0cfa26c4405ee734d` (FR-9). A change of either value is a finding.
  - Lane: light lane. One maker, one checker in a different family.
  - Result: exit 0. `runner_sha256`
    `9d26e6c875288d4b8d1c25850673bc464e6aa58610676073a3030e36eb3395ef` and
    `suite_sha256`
    `8a24205b405a9aae22cf2412d3fc9a40b4b3ffdb30e2a0c0cfa26c4405ee734d`.
    Both equal the expected values. No change.
  - Deviation: measure-guard denies `[~]` while an earlier phase holds no
    checkpoint, so the task went from `[ ]` to `[x]`.
- [x] ec10e5a 6.5 Full suites through `heavy-run.sh` (the command of
  `opencode_host_isolation` task 1.5), only between 22:00 and 07:00 and only
  with no p1 waiter. The night suites run after task 6.2b.
  - Verify: the run exits 0, and the log holds a `Tests` line with no failed test for each suite.
  - Verify: the log sits under `measure/runs/daily_model_schedule/`.
  - Lane: light lane. One heavy run.
  - Queue before the run (2026-11-13 22:45 +0700, inside the window):
    `ps -eo args | grep -c '[f]lock -w .*heavy.lock'` gave 0, and
    `pgrep -fc '[f]lock -w 600'` gave 0. No p1 waiter. HEAD was `ec10e5a`.
    The wrapper printed `heavy-run: load hold — load 6.20 over 6`, then ran.
    The run ended at 23:05 +0700.
  - Command: `HEAVY_MIN_AVAIL_MB=1500 HEAVY_PRIORITY=p2 /home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh -c 'cd harness && npx vitest run schedule-tests/ --configLoader native > ../measure/runs/daily_model_schedule/full-suite-6.5-schedule.log 2>&1; echo "SCHEDULE_EXIT=$?"; npm run test:meta:logic > ../measure/runs/daily_model_schedule/full-suite-6.5-meta-logic.log 2>&1; echo "META_EXIT=$?"'`.
  - Result: `SCHEDULE_EXIT=0` and `META_EXIT=0`.
  - Schedule suite: `Test Files  14 passed (14)`; `Tests  173 passed (173)`;
    `Duration  895.07s`. Log:
    `measure/runs/daily_model_schedule/full-suite-6.5-schedule.log`.
  - Meta logic suite: `Test Files  30 passed (30)`; `Tests  238 passed (238)`;
    `Duration  258.71s`. Log:
    `measure/runs/daily_model_schedule/full-suite-6.5-meta-logic.log`.
  - No case failed, so no case ran again alone. The process check
    `ps -eo pid,args | grep -E '[f]ake-openc|[c]ron-daily'` printed no line.
  - Deviation: measure-guard denies `[~]` while an earlier phase holds no
    checkpoint, so the task went from `[ ]` to `[x]`.
- [x] 0ff9ef3 6.6 Live checks before 2026-11-14 18:00. A later hand channel
  test needs `BENCH_DAILY_NOTIFY_LIVE=1`, and it gives a HAND line.
  - (a) One dry rerun in a transient `systemd-run --user` unit with the
    service PATH and the working folder, as `opencode_host_isolation` task
    4.6. It prints the line `DAILY GO-GUARD weekly=<n> monthly=<m>` and
    plans 12 runs. It prints no skip line and no `DAILY NOTIFY` send line.
  - (b) One live channel test from a transient `systemd-run --user` unit:
    `BENCH_DAILY_CATALOG=/nonexistent harness/cron-daily.sh`. It must stop at
    `DAILY FAIL catalog` before any pick, model call, day record, or commit,
    exit 1, and send one real FAIL line to the PM session. The PM knows of
    this test line in advance.
  - Verify: the dry rerun sends nothing, and the live channel test sends one FAIL line and exits 1.
  - Lane: light lane. One maker, one checker in a different family.
  - Queue before each run: `ps -eo args | grep -c '[f]lock -w .*heavy.lock'`
    gave 0, and `pgrep -fc '[f]lock -w 600'` gave 0. The dry rerun still
    waited over 600 s in the `heavy-run.sh` queue (holder PID 1322600, a
    `phase3-browser-gate.sh` run of another project). Then it ran.
  - (a) Command: `HEAVY_MIN_AVAIL_MB=1500 HEAVY_PRIORITY=p2 /home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh -c 'systemd-run --user --wait --pipe --collect --quiet -p Environment=PATH=<service PATH> -p WorkingDirectory=/home/daniebo/Desktop/lending-desk-bench /home/daniebo/Desktop/lending-desk-bench/harness/cron-daily.sh --dry-run > measure/runs/daily_model_schedule/rerun-6.6a.log 2>&1; echo "EXIT=$?"'`.
    The service PATH is `/home/daniebo/.local/share/pnpm/bin:/home/daniebo/.local/bin:/home/daniebo/.nvm/versions/node/v24.19.0/bin:/usr/local/bin:/usr/bin:/bin`.
    Log: `measure/runs/daily_model_schedule/rerun-6.6a.log`.
    - PASS: `EXIT=0`.
    - PASS: one `DAILY GO-GUARD weekly=0 monthly=84.06490206666668` line. The monthly value is below 95.
    - PASS: no `DAILY SKIP` line.
    - PASS: `DAILY DRY-RUN planned=12`.
    - PASS: no `DAILY NOTIFY` line.
    - PASS: no `DAILY FAIL` line.
    - PASS: `OPENCODE_HOME CLEANUP stopped=0 path=/home/daniebo/Desktop/lending-desk-bench/.tmp/opencode-host-daily-1365313`.
    - PASS: no `.tmp/opencode-host-*` folder after the run.
    - `DAILY_PICK date=2026-11-13 model=kimi-k2.7-code reason=untested last_test=none candidates=9 eligible=9 untested=1`.
  - (b) Before: `ls reports/daily/` gave `2026-11-03.json` and `2026-11-10.json`.
    `git rev-parse HEAD` gave `bf56a544d0046b151373e4e5abc667a3c418a80d`.
  - (b) Command: `HEAVY_MIN_AVAIL_MB=1500 HEAVY_PRIORITY=p2 /home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh -c 'systemd-run --user --wait --pipe --collect --quiet -p Environment=PATH=<service PATH> -p Environment=BENCH_DAILY_CATALOG=/nonexistent -p WorkingDirectory=/home/daniebo/Desktop/lending-desk-bench /home/daniebo/Desktop/lending-desk-bench/harness/cron-daily.sh > measure/runs/daily_model_schedule/channel-6.6b.log 2>&1; echo "EXIT=$?"'`.
    Log: `measure/runs/daily_model_schedule/channel-6.6b.log`.
    - PASS: `EXIT=1`.
    - PASS: one line `DAILY FAIL catalog: /nonexistent is empty, not JSON, or has no live models`.
    - PASS: no `DAILY_PICK` line.
    - PASS: one line `DAILY NOTIFY lending-desk-daily FAIL 2026-11-13 exit=1: catalog: /nonexistent is empty, not JSON, or has no live models log=reports/cron-daily.log`.
    - PASS: no `DAILY NOTIFY failed` line.
    - PASS: no new day record.
    - PASS: HEAD unchanged, no new commit.
    - PASS: `OPENCODE_HOME CLEANUP stopped=0 path=/home/daniebo/Desktop/lending-desk-bench/.tmp/opencode-host-daily-1366297`.
  - (b) After: `ls reports/daily/` gave `2026-11-03.json` and `2026-11-10.json`.
    `git rev-parse HEAD` gave `bf56a544d0046b151373e4e5abc667a3c418a80d`.
    `git status --short` held only `?? .opencode/` and `?? tech-debt.md`.
  - The send went through the real route (`timeout 30 openchamber session send`).
    The log holds no `DAILY NOTIFY failed` line. The recorder did not read the
    PM session, so the receipt by the PM stays for the report of task 6.7.
  - Deviation: measure-guard denies `[~]` while an earlier phase holds no
    checkpoint, so the task went from `[ ]` to `[x]`.
- [x] ec10e5a 6.7 Report to the PM: status, facts changed, and defaults taken.
  - Verify: the report names the commit SHA, the pushed range, and the rows of the last run.
  - Lane: light lane. One maker, one checker in a different family.
  - The orchestrator sent the reports to the PM in this session on
    2026-11-13. The recorder did not send them.
  - PM receipts: D18 accepted (the monthly stop is above 95, the weekly stop
    stays above 80). The exit codes accepted: 0 for a publish, 3 for a skip
    (the site data is still committed and pushed first), and 1, 2, 130, 143
    for a failure, with one line each. A skip day that systemd shows as
    failed is right. The real send limited to the timer unit accepted. The
    night suites after the D20 code accepted.
  - Finding F4: the PM took the planned channel line of task 6.6b (22:13:02,
    transient unit `run-p1366296-i1372737.service`) for a test leak. D20
    closed the gap.
  - Causes reported: on 11-04 exit 2 with `DAILY FAIL playwright: Chromium is
    missing` (the pinned Playwright headless shell was deleted on 11-03; fixed
    by `grader_system_chrome` Phase 1). On 11-08 exit 1 with `DAILY FAIL
    catalog` after the credential seed failed 3 calls in about 10 s under
    systemd (fixed by `opencode_host_isolation` Phase 4). On 11-11 exit 0 with
    no publish: the zero-run guard stop exited before the publish (fixed by
    D15 and D19).
  - Go month estimate per run (pricing data of week 2026w43): mean 0.105
    percent, highest single run 1.343 percent, about 1 to 8 percent for a
    12-run day.
  - The pushed range and the rows of the last run come with the timer run of
    task 6.8.
  - Deviation: measure-guard denies `[~]` while an earlier phase holds no
    checkpoint, so the task went from `[ ]` to `[x]`.
- [ ] 6.8 The timer run of Sun 2026-11-15 01:00. The role records the
  `DAILY PUSH`, `DAILY PUBLISH`, and `DAILY NOTIFY` lines and the public
  `generated_at` value. The monthly Go use is 84.06 percent, so the monthly
  limit of 95 lets all four track batches run. The run exits 0, prints one
  PUBLISH line, and adds new rows to the page.
  - Verify: the log holds a `DAILY PUSH` line, a `DAILY PUBLISH` line, and one `DAILY NOTIFY` line.
  - Verify: the run exits 0, and the log holds no `DAILY SKIP go-guard` line.
  - Verify: the public page shows a `generated_at` of 2026-11-14 or later, and no hand step ran.
  - Lane: light lane. One maker, one checker in a different family.

## Phase 7: Nightly catch-up (PM 2026-11-14)

The PM order is exact in quotation:

> Rule from now: each run day (Wed, Sun) adds one NEW model to the leaderboard. A run day with no new model is a failure. ... 3. Catch-up: add one extra model each night while the Go month stays under your 95 % guard. 4. After the Go reset (11-21 20:44): one new model each night until the leaderboard holds 4 plus one model per run day since 10-25. Then go back to Wed and Sun. 5. Order of models: untested Go models first, then the history models again on the OpenCode runner. 6. A failed run day gets a rerun the next night. Do not wait for the next run day. 7. Each night run goes through heavy-run, as now.

This phase adds the nightly timer, catch-up rule, board-aware pick order, D24 heavy-step split, and notice fields of spec D21 to D25.

- [x] 63a366f 7.1 Red: the spec amendment and the targeted Red tests. The role adds D21 to D25 to `spec.md`, with the matching evidence, functional requirements, acceptance criteria, and the D19 REST exit row. The role adds `harness/schedule-tests/daily-catchup.test.ts` and `harness/schedule-tests/daily-pick-board.test.ts`. The tests cover the timer text, night rule, REST path, due dates, pick groups, the first D24 heavy-run gate, and notice fields. Every test that starts `cron-daily.sh` uses the notice sink, board seam, and safe heavy-run seam. No test reaches a real model, catalog fetch, heavy-run, OpenCode command, OpenChamber command, docs tree, or real home.
  - Verify: `cd harness && npx vitest run schedule-tests/daily-catchup.test.ts schedule-tests/daily-pick-board.test.ts --configLoader native --maxWorkers=1` exits non-zero. Each failure names a missing rule of D21 to D25.
  - Verify: `cd harness && npx vitest run schedule-tests/notice-seam-guard.test.ts --configLoader native --maxWorkers=1 --reporter=verbose` exits 0.
  - Verify: `cd harness && npx vitest run schedule-tests/daily-publish-notice.test.ts --configLoader native --maxWorkers=1 --reporter=verbose` exits 0.
  - Lane: light lane. Maker: `nvidia/minimaxai/minimax-m3.1-flash#thinking` (MiniMax). Checker: task 7.3 uses a different family.
  - Evidence: commit `89d0b33` holds the spec amendment of D21 to D25. Commit
    `1ccffe6` holds the D23 amendment that names the real oracle path. Commit
    `c030b36` holds the first Red work: the two new test files. Commit
    `63a366f` holds the r3 Red work: the oracle and the test file. No
    production file changed.
  - Command: `cd harness && npx vitest run schedule-tests/daily-catchup.test.ts --configLoader native --maxWorkers=1 --reporter=verbose`.
    `Test Files  1 failed (1)`; `Tests  12 failed (12)`; exit 1. The failing
    cases are C1 (D21), C2, C3, C4, C5, C6, C7, and C8 (D22), C9, C10, and
    C11 (the first D24 gate), and C12 (D25). Each failure names the missing rule.
  - Command: `cd harness && npx vitest run schedule-tests/daily-pick-board.test.ts --configLoader native --maxWorkers=1 --reporter=verbose`.
    `Test Files  1 failed (1)`; `Tests  5 failed | 2 passed (7)`; exit 1. The
    failing cases are P2, P4, P5, P6, and P7 (D23). Each failure names the
    missing `--board` flag of `harness/daily-pick.ts`. The cases P1 and P3 pass
    at HEAD. The r2 run gave `Tests  6 failed | 1 passed (7)`. It named the
    wrong oracle path, so the case P3 failed on a missing file.
  - Command: `cd harness && npx vitest run schedule-tests/notice-seam-guard.test.ts --configLoader native --maxWorkers=1 --reporter=verbose`.
    `Test Files  1 passed (1)`; `Tests  5 passed (5)`; exit 0.
  - Command: `cd harness && npx vitest run schedule-tests/daily-publish-notice.test.ts --configLoader native --maxWorkers=1 --reporter=verbose`.
    `Test Files  1 passed (1)`; `Tests  14 passed (14)`; exit 0.
  - Note: the oracle is `measure/tracks/daily_model_schedule/pick-oracle.py`. It
    takes the board file as its 7th positional argument. The Red role owns the
    oracle in this phase. The Green role does not write it.
  - Deviation: measure-guard denies `[~]` in Phase 7 while Phase 6 holds an open task, so the task went from `[ ]` to `[x]`.
  - Deviation: r3: the brief named a wrong oracle path; Red fixed the spec, the oracle, and P3/P4.
- [x] 2632407 7.1b Red: the D24 amendment for heavy steps (PM 2026-11-15).
  - Files: `measure/tracks/daily_model_schedule/spec.md` holds EV28, EV29, the amended D24, FR-20, and AC-19. `harness/schedule-tests/daily-catchup.test.ts` holds the cases C9, C10, and C11. `harness/schedule-tests/daily-heavy-steps.test.ts` holds the new file with the cases H1 to H7.
  - Verify: `cd harness && npx vitest run schedule-tests/daily-catchup.test.ts schedule-tests/daily-heavy-steps.test.ts --configLoader native --maxWorkers=1 --reporter=dot` exits non-zero.
  - Failing cases: C9, C10, and C11 name the missing D24 cron gate. H1 to H6 name the missing heavy seam of the self-check, the canary, the memory gate, and the grading step. H7 holds the light path and passes at HEAD.
  - Evidence: EV29 holds the measured grading time of every track group. No grading step is over 1800 s. The largest value of every group stays under 400 s.
  - Lane: light lane. Maker: opencode/minimax-m3.1-flash-free#high (MiniMax).
- [x] 51eab64 7.1c Red: D26, the high-use rule (Daniel 2026-11-15).
  - Files: `measure/tracks/daily_model_schedule/spec.md` holds EV30, D26, the FR-2 cross-reference, FR-22, AC-21, and the new skip reasons of D19. `measure/tracks/daily_model_schedule/pick-oracle.py` holds the D26 filter. `harness/schedule-tests/daily-pick-board.test.ts` holds the cases Q1 to Q5. `harness/schedule-tests/daily-catchup.test.ts` holds the cases C13 and C14.
  - Verify: `cd harness && npx vitest run schedule-tests/daily-pick-board.test.ts schedule-tests/daily-catchup.test.ts --configLoader native --maxWorkers=1 --reporter=dot` exits non-zero.
  - Failing cases: Q1, Q3, and Q4 name the missing D26 filter of the selector. Q2 and Q5 name the missing `--board` flag of `harness/daily-pick.ts`. C13 and C14 name the missing D26 check of the job.
  - Note: the oracle is the file of the Red role. It now holds the D26 filter. With the real price table, the catalog of 2026w46, the served list of 2026w46, and the public board, the oracle picks `mimo-v2.6-pro` in group 1. The next pick is `mimo-v2.6-flash` in group 2. The model `minimax-m3` is not in the live list of 2026w46, so it is no candidate.
  - Lane: light lane. Maker: opencode/minimax-m3.1-flash-free#high (MiniMax).
- [x] 94b5388 7.1d Red: the D26 rewrite (10,000-request list, latest versions only), D27 (several models a day), and the D18 monthly stop at 100 % (Daniel 2026-11-15 06:1x and 06:3x).
  - Files: `measure/tracks/daily_model_schedule/spec.md` holds EV31 (kept from the stopped run), EV32, the D26 rewrite with the `superseded_by` data rule, D27, the D18 amendment, FR-2, FR-10, FR-22, the new FR-23, AC-9, AC-21, the new AC-22, R3, and the Out-of-scope line. `measure/tracks/daily_model_schedule/pick-oracle.py` holds the D26 list rule, the exclude list as the 8th positional argument, and the newness rule. `harness/schedule-tests/daily-pick-board.test.ts` holds the reworked P2 to P7 and the new Q1 to Q6. `harness/schedule-tests/daily-catchup.test.ts` holds the reworked C2, C4, and C8 (the REST lines of D22 are retired) and the new C15 to C21. `harness/schedule-tests/go-pick-list.test.ts` is the new real-data test. `harness/schedule-tests/daily-publish-notice.test.ts` holds the D18 cases N14 to N16. `harness/schedule-tests/daily-schedule.test.ts` holds the 95-to-100 boundary moves of the cases 6.5.29, 6.5.32, 6.5.34, 6.5.35, 6.5.37, 6.5.38, and 12.19.
  - Verify: `cd harness && npx vitest run schedule-tests/daily-catchup.test.ts schedule-tests/daily-pick-board.test.ts schedule-tests/go-pick-list.test.ts --configLoader native --maxWorkers=1 --reporter=dot` exits non-zero.
  - Failing cases: daily-pick-board: P2, P4, P5, P6, P7, Q1, Q2, Q3, Q4, Q5, Q6 (P1 and P3 pass at HEAD). daily-catchup: C1 to C21 (21 failed). go-pick-list: "computes the D26 on-list set from the real table". daily-publish-notice: N14. daily-schedule: 6.5.37. Each failure names the missing D26, D27, or D18 rule.
  - Note: the oracle with the real price table, the catalog of 2026w46, the served list of 2026w46, and the public board picks `muse-spark-1.3-contributor` on the current stale table. After the Green data update it must pick `beam-free` first.
  - Deviation: measure-guard denies `[~]` in Phase 7 while Phase 6 holds an open task, so the task went from `[ ]` to `[x]`.
  - Lane: light lane. Maker: kimi-code-plan-cn/kimi-for-coding#high (Kimi), substitution for the free MiniMax route.
- [x] c890f1f 7.1e Red. Test fixes from the Green 7.2 CONTEST items, and the D28 unit start gate.
  - Files: `measure/tracks/daily_model_schedule/spec.md` holds D28, FR-24,
    AC-23, the D19 reason amendment, and the NFR-6 seam amendment (commit
    `ceea302`). The four test files hold the CONTEST fixes and the new D28
    cases U1 to U6 (commit `c890f1f`). No production file changed.
  - Part A evidence, each file alone with `--no-cache --configLoader native
    --maxWorkers=1` from `harness/`: `daily-pick-board.test.ts` exit 0 (13
    passed); `daily-catchup.test.ts` exit 0 (21 passed);
    `daily-schedule.test.ts` exit 0 (109 passed). All pass on Green's code
    at `c67bbbe`.
  - Part B evidence: `daily-unit-gate.test.ts` exit 1 (2 passed, 4 failed).
    The failing cases are U2, U4, U5, and U6; each names the missing D28
    gate. The cases U1 and U3 pass at HEAD and pin the D9 lock answer (one
    `cron-daily.sh` at a time for both unit names; recovery starts the job).
  - The record is `measure/runs/daily_model_schedule/red-7.1e.txt`.
  - Lane: light lane. Maker: kimi-code-plan-cn/kimi-for-coding#high (Kimi).
- [x] f560e77 7.1f Red. Test seam for the D28 memory gate in the job test files (check K1-1).
  - Evidence: the nine K1-1 files pin BENCH_MEMINFO to a fixture meminfo with
    MemAvailable 16000000 kB in the shared base environment of each file. No
    case reads the real /proc/meminfo. Every assertion stays as it was;
    daily-unit-gate.test.ts stays unchanged. The record is
    `measure/runs/daily_model_schedule/red-7.1f.txt`. Each file alone from
    `harness/` with `--configLoader native --maxWorkers=1` exits 0:
    `notice-seam-guard.test.ts` 5 passed; `daily-schedule-green.test.ts`
    4 passed; `daily-catchup.test.ts` 21 passed;
    `daily-publish-notice.test.ts` 16 passed;
    `daily-selfcheck-default.test.ts` 2 passed; `daily-served-retry.test.ts`
    3 passed; `opencode-host-isolation.test.ts` 11 passed;
    `opencode-host-trap.test.ts` 4 passed; `daily-schedule.test.ts`
    109 passed.
  - Lane: light lane. Maker: kimi-code-plan-cn/kimi-for-coding#high (Kimi).
- [x] 4934cb3 7.2 Green: the implementation of D18 and D21 to D28. The role updates the nightly timer text, the `cron-daily.sh` header, the local-date and board rules, the selector, the heavy-run gate, the notice fields, and the D28 unit start gate. The job always passes the board file to both pickers. The REST lines are retired by D27, so the job runs the catch-up loop on every night. The heavy-run split follows the amended D24 of task 7.1b, and the pick follows D26 of task 7.1d. Green also updates harness/go-pricing.json to the D26 data, implements D27, and sets the monthly guard stop to 100 %.
  - Verify: the Red command of task 7.1 exits 0.
  - Verify: the notice seam and publish notice commands of task 7.1 exit 0.
  - Verify: `bash -n harness/cron-daily.sh` exits 0.
  - Lane: light lane. Maker: `claude-code/claude-sonnet-5-5#high` (Anthropic). Checker: task 7.3 uses a different family.
  - Evidence: the implementation commits are `4934cb3` (the D26 price data and the optional Go model fields), `6999c4b` (the D26 pick list, `--board`, and `--exclude`), `6845a0a` (the D24 heavy-run split of `batch.sh` and `run.sh`), `f5d1f74` (the D21 to D27 catch-up flow and the D18 stop at 100), and `eba8363` (the D28 unit start gate). The D26 list rule is active only when the price table declares `pick_min_requests_per_month`, so the Phase 6 tests and lines stay byte-for-byte. The monthly Go stop is at or above 100 percent; the weekly stop stays above 80. `bash -n harness/cron-daily.sh` exits 0.
  - Evidence, Red 7.1e: the four CONTEST items of the first round are fixed in the Red tests and the oracle of `c890f1f`, and the D28 spec is `ceea302`. The D28 gate reads `MemAvailable` after the D9 lock and before the catalog fetch. It waits while the value stays at or under `BENCH_DAILY_MEM_START_MB` (default 8000) and skips the day with the pinned line. A failed read fails the job with the pinned line.
  - Evidence, test files run one at a time with `--maxWorkers=1` from `harness/`, every one exit 0: `schedule-tests/daily-catchup.test.ts` (21 passed); `schedule-tests/daily-pick-board.test.ts` (13 passed); `schedule-tests/go-pick-list.test.ts` (1 passed); `schedule-tests/daily-heavy-steps.test.ts` (7 passed); `schedule-tests/daily-publish-notice.test.ts` (16 passed); `schedule-tests/daily-schedule.test.ts` (109 passed); `schedule-tests/daily-unit-gate.test.ts` (6 passed); `schedule-tests/notice-seam-guard.test.ts` (5 passed); `tests/meta/go-cost.test.ts` (9 passed). The log is `measure/runs/daily_model_schedule/green-p7-fbb5def.log`.
  - Note: `harness/node_modules` is an untracked symlink to the main checkout. It is never staged.
- [x] 102289e 7.3 Checker review of D21 to D25, task 7.1, and task 7.2. The checker family must differ from MiniMax, Anthropic, and Kimi. The role writes `measure/runs/daily_model_schedule/check-7.3.json`.
  - Verify: the file shows `status: pass` and no blocking finding.
  - Lane: light lane. One independent checker.
  - Evidence: check-7.3.json status pass at 9332c91 (route opencode/glm-5.3-flash-free#high, round 3), no blocking finding; K1-1 fixed by 7.1f; K1-2 to K1-5 are nonblocking Nits.
- [x] 102289e 7.4 Night suites behind heavy-run. The role runs the relevant schedule suites through `heavy-run.sh` during the night window. The logs sit under `measure/runs/daily_model_schedule/`.
  - Verify: each suite log holds a `Tests` line with no failed test.
  - Verify: the process check holds no `fake-openc` or `cron-daily` process.
  - Lane: light lane. One heavy run.
  - Evidence: the suites ran at p7-green `102289e` on the night of 2026-11-15 through `heavy-run.sh` with `HEAVY_MIN_AVAIL_MB=1500` and `HEAVY_PRIORITY=p2`.
  - Evidence: the schedule suite exited 0 with `Test Files  19 passed (19)` and `Tests  223 passed (223)`. The log is `/home/daniebo/Desktop/lending-desk-bench-p7green/measure/runs/daily_model_schedule/night-7.4-schedule.log`.
  - Evidence: the go-cost suite exited 0 with `Test Files  1 passed (1)` and `Tests  9 passed (9)`. The log is `/home/daniebo/Desktop/lending-desk-bench-p7green/measure/runs/daily_model_schedule/night-7.4-go-cost.log`.
  - Evidence: the process check showed only the real catch-up unit (pid 3942168, `cron-daily.sh` of `lending-desk-catchup-glm-5-3-flash`). It showed no test leftover.
  - Deviation: the Build session ran on claude-code/claude-opus-5-5[1m] because the dispatch named no model. measure-guard denies `[~]` in Phase 7 while Phase 6 holds an open task, so the task went from `[ ]` to `[x]`, as task 7.1d did.
- [x] 6452f29 7.5 Push and timer install by a Build session before Mon 2026-11-16 01:00. The Build session pushes the merged branch and installs the updated `lending-desk-daily.timer` as a systemd user unit. It reloads systemd and enables the nightly timer.
  - Verify: `systemctl --user is-enabled lending-desk-daily.timer` prints `enabled`.
  - Verify: `systemctl --user is-active lending-desk-daily.timer` prints `active`.
  - Verify: the installed timer holds `OnCalendar=*-*-* 01:00:00`.
  - Evidence: the merge commit is `6452f29` with the message "Merge branch 'p7-green': daily_model_schedule Phase 7 (D21-D28)". The merge took both parents: `58811b2` on main and `102289e` on p7-green. No file under `docs/` changed.
  - Evidence: the push was a fast-forward, `119b06d..6452f29`, 15 commits, no force.
  - Evidence: `bash -n` exits 0 for all 28 files of `harness/*.sh` and for `harness/model-guide/preview.sh` and `harness/model-guide/update.sh`.
  - Evidence: `cp harness/systemd/lending-desk-daily.timer harness/systemd/lending-desk-daily.service ~/.config/systemd/user/` copied the merged units. `systemctl --user daemon-reload` exits 0, `enable` exits 0, and `restart` exits 0.
  - Evidence: `is-enabled` prints `enabled`, `is-active` prints `active`, and `show -p TimersCalendar` prints `OnCalendar=*-*-* 01:00:00 ; next_elapse=Mon 2026-11-16 01:00:00 +07`. `list-timers` prints the next run Mon 2026-11-16 01:00:00 +07. The service unit stays `inactive`.
  - Deviation: the timer install happened at 00:48, after the catch-up unit ended at 00:19 (the D9 lock), and before the 01:00 deadline.
  - Lane: light lane. One Build session.
- [ ] 7.6 Record the first catch-up night and the PM line. The role records the CATCHUP line, the board and due counts, the picked group, the heavy-run result, the notice result, and the PM line. The role also records the public board change.
  - Verify: the first catch-up night adds one new model to the leaderboard.
  - Verify: the PM line names the model, new flag, board length, and due count.
  - Note: PM stop 2026-11-16 04:40:56: the orchestrator stopped lending-desk-daily.service by PM order at the model boundary after the iceman-contributor-free publish f6c2920; the next pick (qwen3.8-flash) had started no run; the unit ended failed with exit 143 and sent a FAIL notice that names the stop.
  - Lane: light lane. One maker, one checker in a different family.
- [x] a69193df64a08d9a0cb711183c9da1f968e65d22 7.7 Red. Publish label from the run models (PM 2026-11-16).
  - Files: `harness/schedule-tests/daily-publish-label.test.ts` is the new file
    with the cases L1 to L4. It uses the seams of the schedule suite: the
    notice sink, the board seam, the safe heavy-run seam, the selector queue,
    the stub batch, and the fake OpenCode. No production file changed.
  - Verify: `cd harness && npx vitest run schedule-tests/daily-publish-label.test.ts --maxWorkers=1 --reporter=dot` exits non-zero, and each failure names the missing PM rule of 2026-11-16 (the label comes from the model of the runs in the publish range).
  - Verify: `cd harness && npx vitest run schedule-tests/daily-publish-notice.test.ts --maxWorkers=1 --reporter=dot` exits 0.
  - Evidence: the record is `measure/runs/daily_model_schedule/red-7.7.txt`. The L1 and L2 failures name the label rule; L3 and L4 pin the D15 guard-stop line, the resume reason, and the excluded body lines, and pass at HEAD.
  - Deviation: measure-guard denies `[~]` in Phase 7 while Phase 6 holds the open task 6.8, so the task went from `[ ]` to `[x]` at the record step, as task 7.1d did.
- [x] 0a3070bc43ad61a19226f3d4d9f81d33f5b7df30 7.8 Green. The publish label from the run models in cron-daily.sh. Touch no test file. Starts only when no lending-desk unit runs.
  - Files: `harness/cron-daily.sh` changes only the message builder node block. The label names the models of the day runs from `record.models`, in run order, each once. The label falls back to `record.model` when no model entry has a run. No test file changed.
  - Verify: `cd harness && npx vitest run schedule-tests/daily-publish-label.test.ts --maxWorkers=1 --reporter=dot` exits 0.
  - Verify: `cd harness` and the same command on `daily-publish-notice`, `daily-schedule`, `daily-catchup`, `daily-pick-board`, and `daily-unit-gate` each exits 0.
  - Verify: `bash -n harness/cron-daily.sh` exits 0.
  - Evidence: the record is `measure/runs/daily_model_schedule/green-p7-f6c2920.log`. Case L1 and case L2 failed at role base f6c2920 before the change. The cited suites passed after the change.
  - Deviation: measure-guard denies `[~]` in Phase 7 while Phase 6 holds the open task 6.8, so the task went from `[ ]` to `[x]` at the record step, as task 7.1d did.
- [x] ac41ec935b33f94bc30c004e1b44c9fc96933ad8 7.9 Red. The D26 picker uses the board filter (high_usage and batch) (PM 2026-11-16).
  - Files: `measure/tracks/daily_model_schedule/spec.md` amends D26 with the
    board filter (the same filter as `batch_models` in
    `harness/export-site-data.py`), quoting Daniel's rule of 2026-11-15.
    `harness/schedule-tests/daily-pick-board-filter.test.ts` is the new file
    with the cases F1 and F2. `harness/schedule-tests/go-pick-list.test.ts`
    changes G3 to the new rule (the oracle picks the first high-use, batch
    model off the board, never beam-free). No production file changed.
  - Verify: `cd harness && npx vitest run schedule-tests/daily-pick-board-filter.test.ts --maxWorkers=1 --reporter=dot` exits non-zero, and each failure names the missing board filter of D26 (PM 2026-11-16).
  - Verify: `cd harness && npx vitest run schedule-tests/go-pick-list.test.ts --maxWorkers=1 --reporter=dot` exits non-zero on G3, and G1 and G2 still pass.
  - Verify: `cd harness && npx vitest run schedule-tests/daily-pick-board.test.ts --maxWorkers=1 --reporter=dot` and `cd harness && npx vitest run schedule-tests/daily-catchup.test.ts --maxWorkers=1 --reporter=dot` exit 0.
  - Evidence: the record is `measure/runs/daily_model_schedule/red-7.9.txt`. F1 fails on the free model pick, F2 fails on the offenders beam-free, iceman-contributor-free, longcat-2.5-free, and hy4, and G3 fails on the oracle pick beam-free; daily-pick-board and daily-catchup stay green.
  - Deviation: measure-guard denies `[~]` in Phase 7 while Phase 6 holds the open task 6.8, so the task went from `[ ]` to `[x]` at the record step, as task 7.1d did.
- [x] 40f98a4fdb3ef1aabb5e388f20d76a02ba094221 7.10 Green. daily-pick.ts picks only from the board filter; one shared rule with export-site-data.py. Touch no test file. Starts only when no lending-desk unit runs.
- [x] 4214c72f996fe79b4858a562860057e73e4203fe 7.11 Red. The publish label names only the runs of the publish range (check K2-1).
  - Files: `harness/schedule-tests/daily-publish-label.test.ts` only. The
    case L2 is rewritten: on a two-model D27 day each publish names only the
    model of its own publish range. The new case L5 pins that a pinned
    publish on a day record with published entries of other models names only
    the pinned model. The cases L1, L3, and L4 stay as they were.
  - Verify: `cd harness && npx vitest run schedule-tests/daily-publish-label.test.ts --maxWorkers=1 --reporter=dot` exits non-zero, only L2 and L5 fail, and each failure names the wrong label rule (the label joins the whole day record, cron-daily.sh:948-953).
  - Verify: `cd harness && npx vitest run schedule-tests/daily-publish-notice.test.ts --maxWorkers=1 --reporter=dot` exits 0.
  - Evidence: the record is `measure/runs/daily_model_schedule/red-7.11.txt`. L2 fails on the second publish subject `alpha-model, beta-model`, L5 fails on the subject `day-record-model, pinned-run-model`, and L1, L3, L4 pass.
  - Deviation: measure-guard denies `[~]` in Phase 7 while Phase 6 holds the open task 6.8, so the task went from `[ ]` to `[x]` at the record step, as task 7.1d did.
- [ ] 7.12 Green. Scope the publish label to the runs of the current publish. Touch no test file.
  - Files: `harness/daily-pick.ts` adds the D26 board filter to the list branch: a candidate needs `high_usage` and `batch` not false, the same filter as `batch_models` in `export-site-data.py`. The rule 4 and rule 5 path stays unchanged. `measure/tracks/daily_model_schedule/pick-oracle.py` adds the same filter to its candidate set. No test file changed.
  - Verify: `cd harness && npx vitest run schedule-tests/daily-pick-board-filter.test.ts --maxWorkers=1 --reporter=dot` exits 0.
  - Verify: the same command exits 0 on `go-pick-list`, `daily-pick-board`, `daily-catchup`, `daily-schedule`, `daily-publish-notice`, and `daily-publish-label`.
  - Verify: the real-table pick in a temporary folder names `qwen3.8-flash`, and the oracle line equals the `DAILY_PICK` line.
  - Evidence: the record is `measure/runs/daily_model_schedule/green-p7-0f71749.log`. Cases F1, F2, and G3 passed at fix 40f98a4, and the cited suites stayed green. The cited log holds the real-table pick.
  - Deviation: measure-guard denies `[~]` in Phase 7 while Phase 6 holds the open task 6.8, so the task went from `[ ]` to `[x]` at the record step, as task 7.1d did.

