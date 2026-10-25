# Implementation plan — daily_model_schedule

This plan adds a daily job that tests one model on each day. The job
refreshes the model list. It selects one untested model, or else the model
with the stalest last test date. It runs that model, and it publishes the
site data. Spec:
`spec.md`. Test strategy: `test-strategy.md`. Independent oracle:
`pick-oracle.py`. Base commit: `aa94185`.

Order: contract, then tests (Red), then implementation (Green) and reviews,
then docs, then the doctor and the owner gate.

Constraints for every role:

- `harness/cron-weekly.sh` stays disabled. Do not edit it, and do not edit
  its commented crontab line (spec EV12).
- The daily entry point is a separate script, `harness/cron-daily.sh`.
- The crontab change is an owner action. Only the owner installs the daily
  line, after decision O1 (task 5.3).
- Send no model call before task 5.4. The tests, the dry runs, the catalog
  fetch, and `opencode models` send no prompt (spec NFR-1).
- Do not edit a file of the runner hash or the suite hash, `plan-work.ts`,
  `go-cost.ts`, or `go-pricing.json` (spec EV8, FR-9).
- Phases 2 to 4 happen only in the worktree `../lending-desk-bench-daily`
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
`PUBLISH_CHECK`, `CONSENT_CHECK`, `CRON_CHECK`, and `STATUS_CHECK`.

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

## Phase 3: Implement (Green)

Run in the worktree. Green commits on the branch `daily-schedule`.

- [~] 3.1 Selection rule: build `harness/daily-pick.ts` (spec selection
  rules 1 to 6, FR-2 to FR-5; test strategy section 5.1). It reads only its
  flags and files. It compares ids in byte order. It matches a served model
  by an exact line.
  - Verify: the "selector" block of `SCHEDULE_TEST` passes.
  - Verify: `rg -n 'process\.env|localeCompare' harness/daily-pick.ts` prints no line.
- [b] 3.2 Oracle cross-check. Run `SELECTOR_MATCH` in the worktree on the
  real runs tree and on one saved fetch. The selector and `pick-oracle.py`
  must print the same model, reason, date, and counts. Record the line in
  this task. — deferred:jr-green
  - Verify: `SELECTOR_MATCH` prints `SELECTOR_MATCH=pass date=<day> model=<id> ...`.
  - Verify: `SELECTOR_MATCH` with an empty served file exits non-zero on both sides.
- [b] 3.3 Run one model: `batch.sh --model <id>`, and `weekly.sh` passes
  `"$@"` to each `batch.sh` call (spec FR-7, D7; test strategy section 5.2).
  Do not add an environment variable that `batch.sh` reads.
  — deferred:jr-green
  - Verify: the "batch pin" block of `SCHEDULE_TEST` passes.
  - Verify: `BATCH_COMPAT` prints the value of task 1.2.
- [b] 3.4 Daily entry point `harness/cron-daily.sh` (spec FR-1, FR-6,
  FR-8; test strategy section 5.3). It takes the shared lock. It refreshes
  the catalog and the served list through a temporary file and a rename. It
  writes the day record before the runner. It calls
  `weekly.sh --model <id>`, and it adds the run ids to the record. It
  commits only `docs/` and pushes. It reports each unpriced, gone, and
  unservable model in the day record and in the commit body, and it does not
  edit `harness/go-pricing.json`. — deferred:jr-green
  - Verify: the "daily job" block of `SCHEDULE_TEST` passes.
  - Verify: `bash -n harness/cron-daily.sh` exits 0.
- [b] 3.5 Green gate. Run `SCHEDULE_TEST`, `PATH_CHECK`, `BATCH_COMPAT`, and
  `META_LOGIC` in the worktree. Record each labeled line in this task.
  — deferred:jr-green
  - Verify: `SCHEDULE_TEST` exits 0, `PATH_CHECK` prints `PATH_CHECK=pass`, `BATCH_COMPAT` equals task 1.2, and `META_LOGIC` exits 0.
  - Verify: `role-gate --role jr-green --phase "Phase 3: Implement (Green)"` with `GREEN_TEST_COMMAND` set to `SCHEDULE_TEST` prints `PASS: jr-green gate passed`.
- [b] 3.6 Review A (correctness): the selection rule, the run date rule, the
  identity rule against `plan-work.ts`, and `--day-runs`. The role writes
  `measure/runs/daily_model_schedule/review-a-<short head>.json`.
  — deferred:review-a
  - Verify: `measure_interphase_checks.py audit-result --role review-a --file <path>` prints `PASS: audit result is valid`, and the file shows `status: pass`.
- [b] 3.7 Review B (security): endpoint data in the shell, the id check, the
  temporary files, the lock, the credential, and the push scope (spec R4,
  R5). The role writes
  `measure/runs/daily_model_schedule/review-b-<short head>.json`.
  — deferred:review-b
  - Verify: `measure_interphase_checks.py audit-result --role review-b --file <path>` prints `PASS: audit result is valid`, and the file shows `status: pass`.
- [b] 3.8 Review C (API contract): the `batch.sh` flag, the `weekly.sh`
  arguments, the selector JSON, the day record, and the labeled lines. The
  role writes `measure/runs/daily_model_schedule/review-c-<short head>.json`.
  — deferred:review-c
  - Verify: `measure_interphase_checks.py audit-result --role review-c --file <path>` prints `PASS: audit result is valid`, and the file shows `status: pass`.
- [b] 3.9 Adversarial tests of test strategy section 12. The role adds the
  cases to the test file. It writes
  `measure/runs/daily_model_schedule/adversarial-<short head>.json`.
  — deferred:adversarial-testing
  - Verify: `SCHEDULE_TEST` exits 0 with the added cases, and the role file shows `status: pass`.

## Phase 4: Docs

Run in the worktree. Commit on the branch `daily-schedule`.

- [b] 4.1 Operator docs. Add the section `## Daily model schedule` to
  `README.md`. It names the three owner steps, `harness/cron-daily.sh`,
  `harness/daily-pick.ts`, `batch.sh --model`, and the day records under
  `reports/daily/`. It states that `cron-weekly.sh` stays disabled, and
  that the crontab change is an owner action. It gives the price table
  update: when a day record lists an unpriced model, the operator adds the
  price to `harness/go-pricing.json` from `https://opencode.ai/docs/go/`.
  The model then becomes an untested candidate. Update the header comments
  of the changed scripts to match. — deferred:jr-green
  - Verify: `DOCS_CHECK` prints `DOCS_CHECK=pass`.
  - Verify: `PATH_CHECK` prints `PATH_CHECK=pass`, and `SCHEDULE_TEST` exits 0.

## Phase 5: Doctor and owner gate

- [b] 5.1 Merge and doctor. In `main`, run `WORKLIST_SHA`, merge
  `daily-schedule`, and run `WORKLIST_SHA` again with no run between. Then
  run `BASE_HASH`, `SCHEDULE_TEST`, `META_LOGIC`, `BATCH_COMPAT`, and
  `PICK_MATCH`. Record each labeled line in this task.


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
- [b] 5.2 Owner decision O1. Show the owner the `PICK_MATCH` line, the spend
  of spec D1, and the push scope of spec R4. Record the answer and its date
  in the spec table. — deferred:owner
  - Verify: `CONSENT_CHECK` prints 1 line, or `rg -n '^\| O1 \|.*\| declined 20[0-9]{2}-[0-9]{2}-[0-9]{2}' measure/tracks/daily_model_schedule/spec.md` prints 1 line.
- [b] 5.3 Crontab change, an owner action, only when O1 is approved. Before
  it, run `PI_SHA day0` and `ls runs > .tmp/daily-runs-before.txt` in
  `main`. The owner installs the line
  `0 1 * * * /home/daniebo/Desktop/lending-desk-bench/harness/cron-daily.sh >> /home/daniebo/Desktop/lending-desk-bench/reports/cron-daily.log 2>&1`.
  — deferred:owner
  - Verify: `CRON_CHECK` prints `CRON_CHECK=pass`.
  - Verify: `crontab -l | grep -c '^# DISABLED 2026-10-25 by owner request'` prints `1`.
- [b] 5.4 First live day. After the first job ends, run `DAY_CHECK <day>`,
  `PUBLISH_CHECK <day>`, `PI_SHA day1`, and `PI_CHECK day0 day1` in `main`.
  Record each labeled line in this task.

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
