# Implementation plan — rigor_a_h

This plan adds 5 scenario criteria to the A–H set. A control proves that
each criterion can fail. The stored corpus shows whether the set separates
models, with no model call. Scoring does not change. Spec: `spec.md`. Test
strategy: `test-strategy.md`. Corpus: `corpus.json`. Base commit: `e449c63`.

Order: contract and setup, then tests (Red), then implementation (Green),
then the separation measurement, then activation, docs, and doctor.

Constraints for every role:

- Do not edit `fixture/` or a model-visible track file (spec NFR-2).
- Send no model call (spec NFR-1).
- Phases 2 to 4 happen only in the worktree `../lending-desk-bench-rigor` on
  the branch `rigor-a-h` (spec NFR-3). Do not edit `harness/` in `main`
  before task 5.2.
- Never write to a corpus run in `main` (spec NFR-4).
- Preserve unrelated dirty work. Stage files by explicit path only.
- Red (Phase 2) changes only `harness/tests/meta/**` and `measure/`.

Marker use:

- `[~]` marks the task that is open now.
- `[b]` with a trailing `deferred:<owner>` marks a task that waits for an
  earlier task or for an owner decision. The orchestrator changes it to `[~]`
  when its phase opens.
- `[x]` needs a commit SHA in the task line.
- While a `[b]` task remains, exactly one task is `[~]`. Its first line
  does not hold the word `deferred`. When the `[~]` task closes, the same
  edit marks the next task `[~]`. Reason: anti-pattern A12. The status
  checker reads no `[b]` task, so a plan with only `[x]` and `[b]` tasks
  shows as a closeout candidate. Run `STATUS_CHECK` after each marker
  change.

Gate commands: test strategy section 2 (`RED_TEST_COMMAND`,
`GREEN_TEST_COMMAND`, the control gate, `CANARY build <tree>`,
`TIMED_CANARY`, `NFR6_CHECK`, `SCORING_CHECK`, `CORPUS_SHA`, `PI_SHA`,
`HISTORY_SHA`, `TRUSTED_LIST`, `TRUSTED_CHECK`, `EXPORT_CHECK`,
`NFR10_CHECK`, `NFR10_VERIFY`, `BASE_HASH`, `STATUS_CHECK`, and the
work-list comparison).

## Phase 1: Contract and setup

- [x] 1.1 Strategy artifacts: `spec.md`, `plan.md`, `test-strategy.md`,
  `corpus.json`, `metadata.json`, `index.md`, and the registry rows in
  `measure/tracks.md` and `measure/index.md`. The strategy role wrote them
  on 2026-10-25 and did not commit them. The orchestrator commits them and
  records the SHA here. 07b4df8
  - Verify: `python3 ~/.agents/skills/measure-orchestrator/scripts/measure_interphase_checks.py role-gate --repo . --role strategy --track rigor_a_h --log-file measure/runs/rigor_a_h/strategy.log` prints `PASS: strategy gate passed`.
  - Verify: `jq -c '.counts' measure/tracks/rigor_a_h/corpus.json` prints `{"runs":49,"stored_saturated":22,"stored_saturated_models":10,"opencode_runs":8,"pi_runs":41}`.
- [~] 1.2 Worktree and toolchain. The precondition is met. The orchestrator
  committed the untracked hashed sources in `main` at e9fb565, and
  `npm run test:meta:logic` passed 30 files and 238 tests on that commit.
  Now create `../lending-desk-bench-rigor` on the new branch `rigor-a-h`
  from that commit. Install the harness and fixture dependencies from their
  lockfiles. Record `CORPUS_SHA` in `main`. In the worktree, run
  `TIMED_CANARY base<k> base` for each k from 1 to 5. Record the five
  `GRADE_TIME` lines in this task.
  - Verify: `git status --short --untracked-files=all -- harness/bugfix harness/change harness/tests-track harness/tests harness/verify-bugs.ts reference-change` prints nothing in `main`.
  - Verify: `BASE_HASH` prints the same line in `main` and in the worktree.
  - Verify: `git -C ../lending-desk-bench-rigor rev-parse --abbrev-ref HEAD` prints `rigor-a-h`.
  - Verify: in the worktree, the records `canary-rigor-reference-base1` to `canary-rigor-reference-base5` have `valid === true` and `total === 100` on the base suite. `measure/runs/rigor_a_h/grade-time.log` holds 5 `GRADE_TIME suite=base` lines with `exit=0`.
  - Verify: the plan line of this task holds the `CORPUS_SHA` value.
  - Verify: `STATUS_CHECK` prints `STATUS_CHECK=pass blocked=<n> open=1`.

## Phase 2: Test (Red)

Run in the worktree. Red commits on the branch `rigor-a-h`.

- [b] 2.1 Registry meta test `harness/tests/meta/scenario-criteria.test.ts`
  with the 7 checks of test strategy section 3.1. Add the frozen base
  control list `harness/tests/meta/fixtures/scenario-criteria/base-controls.json`.
  — deferred:mid-red
  - Verify: `cd harness && BENCH_META=1 npx vitest run tests/meta/scenario-criteria.test.ts --maxWorkers=1` fails, and each failure names a missing inventory id, derivation, test title, or control. Checks 5 and 6 pass.
- [b] 2.2 Sweep meta test `harness/tests/meta/corpus-sweep.test.ts` with the
  9 cases of test strategy section 3.2 and its synthetic records under
  `harness/tests/meta/fixtures/corpus-sweep/`. — deferred:mid-red
  - Verify: `cd harness && BENCH_META=1 npx vitest run tests/meta/corpus-sweep.test.ts --maxWorkers=1` fails only because `harness/corpus-sweep.ts` does not exist.
- [b] 2.3 Red evidence. Run `RED_TEST_COMMAND`. Record the start time, the
  end time, the exit code, and the Vitest summary line in this task.
  — deferred:mid-red
  - Verify: the recorded exit code is not 0, and the recorded failures are only those of tasks 2.1 and 2.2.

## Phase 3: Implement (Green)

Run in the worktree. Green commits on the branch `rigor-a-h`.

- [b] 3.1 `G.body-shape` in `harness/tests/api/loans.test.ts` (test
  strategy section 5.2). — deferred:jr-green
  - Verify: `CANARY build reference` passes, and its `api-raw.json` holds `G.body-shape` as passed.
- [b] 3.2 The four browser tests in `harness/tests/e2e/scenarios.spec.ts`,
  with helpers and the parser of section 6 in
  `harness/tests/e2e/_scenario.ts` (test strategy sections 4 to 6).
  — deferred:jr-green
  - Verify: `CANARY build reference` passes, and its `e2e-raw.json` holds `F.return-race`, `D.history-rows`, `C.current-store`, and `E.return-retry` as passed.
- [b] 3.3 Registry. Add the 5 entries to `CRITERIA` (tier 1), the 5
  `scenario:` derivations to `UNMAPPED_CRITERIA`, and the 5 controls of
  test strategy section 9 to `SENSITIVITY_CONTROLS`. Add the section
  `### Scenario criteria` and its subsection `#### Admission rule` to
  `SCORING.md` (spec FR-1). Record the `SCORING_CHECK` line in this task.
  — deferred:jr-green
  - Verify: `cd harness && BENCH_META=1 npx vitest run tests/meta/scenario-criteria.test.ts tests/meta/spec-matrix.test.ts --maxWorkers=1` exits 0.
  - Verify: `SCORING_CHECK` exits 0 and prints `SCORING_CHECK=pass sources=3 conditions=6` (spec FR-1, AC-10).
- [b] 3.4 Controls. Run the control gate two times. Then run
  `verify-controls.ts --all`. Add a scenario criterion to the collateral of
  an existing control only when that control also fails it.
  — deferred:jr-green
  - Verify: both control-gate runs exit 0 with `calibration_passed: true` for the 5 new controls. `cd harness && npx tsx verify-controls.ts --all` exits 0.
- [b] 3.5 Canaries. Run `TIMED_CANARY <k> new` for each k from 1 to 5.
  Run `CANARY build reference-variant` 5 times. Run the change, bugfix, and
  tests canaries. Run `cd harness && npx tsx verify-bugs.ts --all`. Run
  `NFR6_CHECK`. Record the five `GRADE_TIME` lines and the `NFR6` line in
  this task. — deferred:jr-green
  - Verify: 10 of 10 build canary records have `valid === true` and `total === 100`. The change, bugfix, and tests canaries score 100. `verify-bugs.ts --all` exits 0.
  - Verify: `NFR6_CHECK` exits 0 and prints `NFR6 base_median_s=<x.x> new_median_s=<x.x> ratio=<x.xxxx> verdict=pass` (spec NFR-6).
- [b] 3.6 Sweep script `harness/corpus-sweep.ts` (spec FR-4, test strategy
  section 8). It calls `deriveScoreMetrics` for new completion and never
  copies the formula. — deferred:jr-green
  - Verify: `cd harness && BENCH_META=1 npx vitest run tests/meta/corpus-sweep.test.ts --maxWorkers=1` exits 0.
- [b] 3.7 Green gate. Run `GREEN_TEST_COMMAND` and `CORPUS_SHA` in `main`.
  — deferred:jr-green
  - Verify: `GREEN_TEST_COMMAND` exits 0. `CORPUS_SHA` equals the value of task 1.2.
  - Verify: in `main`, `git status --short -- harness/corpus-sweep.ts harness/tests/e2e/scenarios.spec.ts harness/tests/e2e/_scenario.ts harness/tests/meta/scenario-criteria.test.ts harness/tests/meta/corpus-sweep.test.ts` prints nothing, and `git log --oneline e449c63..HEAD -- harness/tests/sensitivity-controls.ts harness/tests/criteria.ts harness/tests/meta/spec-matrix-contract.ts` prints no commit of this track.
- [b] 3.8 Adversarial fairness. Build the 10 variants of test strategy
  section 7 as overlays of `reference/` and grade each with the build canary
  command. — deferred:adversarial-testing
  - Verify: each variant record has `valid === true`, and each admitted-candidate id is passed in it. The role writes `measure/runs/rigor_a_h/adversarial-<short head>.json` with the 10 run ids.

## Phase 4: Measure separation

Run in the worktree. No model call.

- [b] 4.1 Run `NFR10_CHECK`, then
  `cd harness && npx tsx corpus-sweep.ts --corpus ../measure/tracks/rigor_a_h/corpus.json --runs-root <main>/runs`,
  then `NFR10_CHECK` again. Write all output to
  `measure/runs/rigor_a_h/sweep.log`, and keep the report.
  — deferred:jr-green
  - Verify: the output has 49 `SWEEP.RUN` lines, one `SWEEP.REPRO` line, 5 `SWEEP.CRITERION` lines, one `SWEEP.GATE` line, one `SWEEP.FRONTIER` line, and 168 `SWEEP.DOMAIN` lines. `CORPUS_SHA` in `main` equals the value of task 1.2.
  - Verify: `NFR10_VERIFY measure/runs/rigor_a_h/sweep.log` prints `NFR10.PASS`.
- [b] 4.2 Admission table (spec FR-3). Write one row for each candidate and
  one column for each condition, with evidence. Remove each rejected
  criterion, its test, its derivation, and its control. Remove its id from
  the constant of test strategy section 3.1. Record the line
  `ADMITTED=<id,...>` in this task for `EXPORT_CHECK`. — deferred:review-a
  - Verify: the table holds 5 rows and 6 condition columns, and each cell names its evidence. `GREEN_TEST_COMMAND` exits 0 after the removals.
  - Verify: the `ADMITTED` ids equal the inventory constant of test strategy section 3.1.
- [b] 4.3 Gate (spec FR-5). Run the sweep summary again on the admitted set.
  Mark each `predicted_new_failures` entry of `corpus.json` as confirmed or
  refuted in this task. — deferred:jr-green
  - Verify: the task quotes the `SWEEP.GATE` line. When it shows `verdict=fail`, tasks 5.2 to 5.4 stay blocked, and the orchestrator sends the numbers to the owner.
- [b] 4.4 Frontier report (spec FR-8). Quote the `SWEEP.FRONTIER` line.
  Turn the `SWEEP.DOMAIN` lines of the admitted set into a domain table.
  The table has one row for each model and one column for each domain. Each
  cell reads `clean_current → clean_after of runs`. — deferred:jr-green
  - Verify: the task quotes the `SWEEP.FRONTIER` line. When `saturated_after` equals `runs`, the spec table shows D2 as open and task 6.1 opens.
  - Verify: the domain table has 21 rows and 8 domain columns. Each cell matches its `SWEEP.DOMAIN` line in `measure/runs/rigor_a_h/sweep.log`.

## Phase 5: Activate, generate docs, and doctor

`measure/generate.sh` and `measure/doctor.sh` do not exist in this
repository. Task 5.4 runs the repository checks in their place.

- [b] 5.1 Owner decision D1. Show the owner the gate line and the before and
  after totals of the 8 frontier runs. Record the answer and its date in the
  spec table. — deferred:owner
  - Verify: `rg -n '^\| D1 \|.*\| (approved|declined) 20[0-9]{2}-[0-9]{2}-[0-9]{2}' measure/tracks/rigor_a_h/spec.md` prints 1 line.
- [b] 5.2 Merge and regrade (spec FR-7). In `main`, run `NFR10_CHECK`.
  Record `PI_SHA`, `HISTORY_SHA`, and the work-list classes. Run
  `TRUSTED_LIST before`. Merge `rigor-a-h`. Run
  `WEEKS="<every week with an OpenCode run>" ./regrade-all.sh`. Run
  `TRUSTED_LIST after`, record `PI_SHA` and the classes again, and run
  `NFR10_CHECK`. Write all output to `measure/runs/rigor_a_h/regrade.log`.
  — deferred:orchestrator
  - Verify: `TRUSTED_CHECK` prints `TRUSTED_CHECK=pass`.
  - Verify: both `PI_SHA` lines are equal, and both show the same `PI_RUNS` value. The work-list class of each track, arm, and model is unchanged.
  - Verify: `NFR10_VERIFY measure/runs/rigor_a_h/regrade.log` prints `NFR10.PASS`.
  - Verify: `git diff e449c63 -- harness/score-calculation.ts` prints nothing (spec FR-6).
- [b] 5.3 Site export and docs. Run `python3 export-site-data.py` and
  `python3 generate-model-pages.py`. Add the change, its date, and its reason
  to `README.md` and `docs/methodology.html`. — deferred:jr-green
  - Verify: `EXPORT_CHECK` with the `ADMITTED` line of task 4.2 prints `true` and exits 0.
  - Verify: `HISTORY_SHA` prints the value that task 5.2 recorded before the merge.
  - Verify: `rg -n -i 'scenario criteri' README.md docs/methodology.html` prints at least 2 lines.
- [b] 5.4 Doctor. In `main`, run `cd harness && npm run test:meta:logic`,
  `BENCH_TRACK=change npm run test:meta:logic`, and the canaries of the four
  tracks. — deferred:jr-green
  - Verify: both meta runs exit 0, and the four canaries score 100.

## Phase 6: Frontier decision

- [b] 6.1 Owner decision D2. It opens only when task 4.4 shows every frontier
  run saturated. Show the owner the domain table of task 4.4. Record the
  answer and its date in the spec table. When the answer is option (a), the
  orchestrator creates a new track for the harder task. When task 4.4 does not open D2, record "not applicable" with the
  quoted `SWEEP.FRONTIER` line. — deferred:owner
  - Verify: `rg -n '^\| D2 \|.*\| (option a|option b|not applicable) 20[0-9]{2}-[0-9]{2}-[0-9]{2}' measure/tracks/rigor_a_h/spec.md` prints 1 line.
