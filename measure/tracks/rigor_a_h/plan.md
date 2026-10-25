# Implementation plan — rigor_a_h

This plan builds a stricter A–H criterion set. Mutation evidence admits each
criterion. The published score changes only after a pilot shows that the set
separates at least three models. Spec: `spec.md`. Test strategy:
`test-strategy.md`. Base commit: `f4712c6`.

Order: contract and schema, then tests (Red), then implementation (Green),
then documentation and doctor.

Constraints for every role:

- Do not edit `fixture/` or a model-visible track file (spec NFR-1).
- Send no model call before owner decision D3 (spec NFR-2).
- Never change an existing run directory (spec NFR-3). The executor adds
  only `rigor-` run directories.
- Keep rigor files under `harness/rigor/` until task 3.13 (spec NFR-5).
- Preserve unrelated dirty work. Stage files by explicit path only.
- Red (Phase 2) changes only files under `harness/rigor/__tests__/` and
  `measure/`.
- Red and Green never receive the held-out file path before task 3.6.

Marker use:

- `[~]` marks the task that is open now.
- `[b]` with a trailing `deferred:<owner>` marks a task that waits for an
  earlier task or for an owner decision. The orchestrator changes it to `[~]`
  when its phase opens.
- `[x]` needs a commit SHA in the task line.

Gate commands (detail in `test-strategy.md` section 2):

- `RED_TEST_COMMAND`: `cd harness && BENCH_META=1 npx vitest run rigor/__tests__/meta --maxWorkers=1`
- `GREEN_TEST_COMMAND`: `cd harness && BENCH_META=1 npx vitest run rigor/__tests__/meta --maxWorkers=1 && npm run test:meta:logic && BENCH_TRACK=change npm run test:meta:logic`
- Adversarial gate: `cd harness && BENCH_TRACK=change BENCH_META=1 npx vitest run rigor/__tests__/meta --maxWorkers=1`
- History checksum (`HISTORY_SHA`): `find runs -path '*/artifacts/score.json' -not -path 'runs/rigor-*' -exec sha256sum {} + | sort | sha256sum`, run from the repository root. A task that must not change history prints the same value before and after.
- Track canary (`CANARY <track>`): the canary arm of `harness/batch.sh`, run for one track with `BENCH_TRACK` set, as in `bench_v2` plan task 7.3. The arm is the `run.sh` call and the `valid === true && total === 100` check. It passes when the record is valid and scores 100.

## Phase 1: Contract and schema definition

- [~] 1.1 Strategy artifacts: `spec.md`, `plan.md`, `test-strategy.md`,
  `metadata.json`, `index.md`, and the registry rows. The strategy role wrote
  them on 2026-10-25 and did not commit them. The orchestrator commits them
  and records the SHA here.
  - Verify: `python3 ~/.agents/skills/measure-orchestrator/scripts/measure_interphase_checks.py role-gate --repo . --role strategy --track rigor_a_h --log-file measure/runs/rigor_a_h/strategy.log` prints `PASS: strategy gate passed`.
- [b] 1.2 Owner decisions D1–D6 (spec section "Owner decisions"). — deferred:owner
  - Record each answer and its date in the spec table.
  - Verify: `rg -c '^\| D[1-6] \|.*\| (approved|changed) 20[0-9-]+' measure/tracks/rigor_a_h/spec.md` prints `6`.
- [b] 1.3 Design note `measure/tracks/rigor_a_h/design.md`. — deferred:jr-green
  - Content: the file layout under `harness/rigor/`, and the schemas of the
    registries and the matrix.
  - Content: the schemas of the kill-matrix report, the admission report,
    the pilot report, the saturation report, and the FR-9 record fields.
  - Content: the CLI contracts with their labeled output lines, the item
    allocation table, and the collection guard of NFR-5.
  - Verify: `rg -c '^## (Layout|Schemas|CLI contracts|Item allocation|Collection guard)$' measure/tracks/rigor_a_h/design.md` prints `5`.
- [b] 1.4 Type contract `harness/rigor/contract.ts`. — deferred:jr-green
  - Exported types for every schema of task 1.3. Constants for the section
    targets and the thresholds of D2. No grading behavior.
  - Verify: `cd harness && npx tsx -e "import('./rigor/contract.ts').then((m) => console.log('CONTRACT.EXPORTS', Object.keys(m).sort().join(',')))"` prints the export list that `design.md` names.
- [b] 1.5 Action-layer feasibility (spec FR-1). — deferred:jr-green
  - Import `src/actions/loans.ts` of the clean app and the variant app under
    Vitest, with `next/headers` and `next/cache` mocked. Call each action
    once as staff and once as non-staff. Record the outcomes.
  - Verify: `rg -c '^ACTION app=(clean|variant) fn=(checkoutItem|returnItem) caller=(staff|anon) result=' measure/tracks/rigor_a_h/evidence/task-1.5-action-layer.txt` prints `8`.
- [b] 1.6 Cache-mutant feasibility (spec candidate `RM-C-cached-loans`). — deferred:jr-green
  - Apply the mutant to a temporary copy of the clean app. Grade it once
    through the control path of `harness/verify-controls.ts`. Record the
    baseline failures and whether an out-of-band `/api/loans` change shows
    stale on the next `/items` visit.
  - Verify: `rg -n '^CACHE-PROBE mutant=RM-C-cached-loans baseline_failures=[0-9]+ api_change_stale=(yes|no)$' measure/tracks/rigor_a_h/evidence/task-1.6-cache-mutant.txt` prints 1 line.
- [b] 1.7 Held-out pool (spec FR-3). — deferred:adversarial-testing
  - The adversarial-testing role writes at least 11 held-out mutants, with
    the section minimums of FR-2, to a file outside the repository. Record
    its sha256 and its date here. Give the path to the orchestrator only.
  - Verify: `sha256sum "$RIGOR_HELDOUT"` equals the value recorded here, and `jq '.mutants | length' "$RIGOR_HELDOUT"` prints a number of at least 11.

## Phase 2: Test (Red)

Every new file goes under `harness/rigor/__tests__/`. The production gates
must stay green during this phase.

- [b] 2.1 Collection guard `meta/collection-guard.test.ts` (spec NFR-5). — deferred:mid-red
  - At least one rigor grader file exists. No production command collects a
    rigor file: `vitest run tests/unit`, `tests/api`, `tests/meta`, and the
    Playwright `testDir`. The suite walk and the runner hash list hold no
    `harness/rigor/` path. A planted path fixture proves the check.
  - Verify: `cd harness && BENCH_META=1 npx vitest run rigor/__tests__/meta/collection-guard.test.ts --maxWorkers=1` exits 1, and the failure names the missing grader file.
- [b] 2.2 Registry and matrix tests `meta/registry.test.ts` (spec FR-1, FR-2, FR-3). — deferred:mid-red
  - Each malformed entry fails with a named reason. The matrix has 54 rows
    with the `SPEC_MATRIX` ids. Section targets hold. `requires` names
    baseline ids. Quotes are substrings of the fixture spec. `items` lists
    are disjoint. Each `stated` port quote is a substring of that track's
    model-visible spec.
  - Verify: `cd harness && BENCH_META=1 npx vitest run rigor/__tests__/meta/registry.test.ts --maxWorkers=1` exits 1, and each failure names a missing validator or row.
- [b] 2.3 Admission, executor, and pilot tests `meta/admission.test.ts`, `meta/executor.test.ts`, `meta/pilot.test.ts` (spec FR-4 to FR-7). — deferred:mid-red
  - Synthetic kill matrices prove survivors, unique kills, the 2-of-2 rule,
    the canary rule, and redundancy. They also prove live on arrival,
    waivers, section lines, the held-out rate, and the `insufficient` result.
    A fake grade command proves
    exit code 3 on a canary failure and no write to a protected tree. Fake
    run directories keep their bytes after a stage-1 pilot run.
  - Verify: `cd harness && BENCH_META=1 npx vitest run rigor/__tests__/meta/admission.test.ts rigor/__tests__/meta/executor.test.ts rigor/__tests__/meta/pilot.test.ts --maxWorkers=1` exits 1, and each failure names the missing module or behavior.
- [b] 2.4 Monitor tests `meta/saturation.test.ts` (spec FR-8). — deferred:mid-red
  - Synthetic records give `high`, `low`, `live`, and `insufficient` at the
    boundaries. The separation statistic gives known values on synthetic
    ranges. A redacted copy of the 8 w43 records gives 60 of 60 A–H `high`
    and `P.dedup-item` `low`. Planted invalid and Pi records are ignored.
  - Verify: `cd harness && BENCH_META=1 npx vitest run rigor/__tests__/meta/saturation.test.ts --maxWorkers=1` exits 1, and each failure names the missing module or behavior.
- [b] 2.5 Scoring tests `meta/score.test.ts` (spec FR-9). — deferred:mid-red
  - The tests cover the rigor axis arithmetic, the `requires` rule, the
    `since` rule, and the unchanged tier rates. They also cover the D1 weight
    sum of 1 and the flagged weight 0.25. An all-pass record scores 100. An
    untouched candidate gets rigor 0. Revision-1 totals stay byte-identical.
  - Verify: `cd harness && BENCH_META=1 npx vitest run rigor/__tests__/meta/score.test.ts --maxWorkers=1` exits 1, and each failure names the missing module or behavior.
- [b] 2.6 Port tests `meta/ports.test.ts` (spec FR-10). — deferred:mid-red
  - Bugfix and change regression include `stated` rigor criteria and exclude
    `absent` ones, detectors, collateral, and `superseded` ids. The candidate
    sets `v2` and `m2` pass `validateRegistry` and the tests-track set
    validator. `m2` holds no browser-only or action-only mutant.
  - Verify: `cd harness && BENCH_META=1 npx vitest run rigor/__tests__/meta/ports.test.ts --maxWorkers=1` exits 1, and each failure names the missing module or behavior.
- [b] 2.7 Dev pool and criteria data (spec FR-1, FR-3, candidate inventory). — deferred:mid-red
  - Write `registry/criteria.ts`, `registry/mutants.ts`, `registry/matrix.ts`,
    and `registry/expected-kills.json`. Meet the dev-pool minimums of FR-2.
    Write an exemption reason for each row with no criterion.
  - Verify: `cd harness && npx tsx -e "import('./rigor/__tests__/registry/mutants.ts').then((m) => console.log('DEV.MUTANTS', m.RIGOR_MUTANTS.length))"` prints `DEV.MUTANTS` with a number of at least 31.
- [b] 2.8 Red evidence. — deferred:mid-red
  - Run `RED_TEST_COMMAND` and both production gates. Record the start time,
    the end time, the exit codes, the labeled Vitest summaries, and the
    failing test names per task in this plan.
  - Verify: `RED_TEST_COMMAND` exits 1. `cd harness && npm run test:meta:logic` exits 0. `cd harness && BENCH_TRACK=change npm run test:meta:logic` exits 0.

## Phase 3: Implement (Green)

- [b] 3.1 Validators and admission core `harness/rigor/admission.ts` (spec FR-1 to FR-4). — deferred:jr-green
  - Verify: `cd harness && BENCH_META=1 npx vitest run rigor/__tests__/meta/registry.test.ts rigor/__tests__/meta/admission.test.ts --maxWorkers=1` exits 0.
- [b] 3.2 Mutation executor `harness/rigor/verify-rigor.ts` (spec FR-5, FR-6). — deferred:jr-green
  - Modes `--canary`, `--baseline`, `--rigor`, `--heldout`. One fresh copy of
    the clean app for each mutant. Two grades for each app. Tree-hash checks
    before and after.
  - Verify: `cd harness && BENCH_META=1 npx vitest run rigor/__tests__/meta/executor.test.ts --maxWorkers=1` exits 0.
- [b] 3.3 Baseline survivor proof (spec FR-3, AC-2). — deferred:jr-green
  - Run the baseline mode over the dev pool. Remove each mutant that fails
    the gate or that a baseline check kills, and record the reason. Freeze
    the pool and record its sha256 here.
  - Verify: `cd harness && npx tsx rigor/verify-rigor.ts --baseline --all` ends with `RIGOR.BASELINE.SUMMARY mutants=<n> survivors=<n> killed=0 gate_failed=0`, and every section minimum of FR-2 still holds.
- [b] 3.4 Rigor graders (spec FR-1). — deferred:jr-green
  - Unit layer for A, action layer for F, API layer for G, browser layer for
    B, C, D, E, and H. Own server boot. The item allocation of `design.md`.
  - Verify: `cd harness && npx tsx rigor/verify-rigor.ts --canary` prints `RIGOR.CANARY app=clean grades=2 failed=0` and `RIGOR.CANARY app=variant grades=1 failed=0`.
- [b] 3.5 Rigor kill matrix and admission report (spec FR-4). — deferred:jr-green
  - Run the rigor mode over the dev pool. Write `admission.json`. Remove each
    rejected criterion from the registry and record the reason.
  - Verify: `cd harness && npx tsx rigor/verify-rigor.ts --rigor --all` ends with `RIGOR.ADMIT.SUMMARY candidates=<n> admitted=<k> rejected=<r>`, and each `RIGOR.SECTION` line shows `met=yes` or `met=waived`.
- [b] 3.6 Held-out check (spec FR-3, FR-4 rule 7, AC-4). — deferred:jr-green
  - Copy the sealed file to `harness/rigor/__tests__/registry/heldout.json`.
    Compare its sha256 with task 1.7. Confirm that no grader names a held-out
    id or anchor. Run the held-out mode.
  - Verify: `sha256sum harness/rigor/__tests__/registry/heldout.json` equals the task 1.7 value, and `cd harness && npx tsx rigor/verify-rigor.ts --heldout` prints `RIGOR.HELDOUT survivors=<s> killed=<k> rate=<r>` with `r` at least 0.60.
- [b] 3.7 Saturation monitor `harness/rigor/saturation.ts` (spec FR-8, AC-7). — deferred:jr-green
  - Verify: `cd harness && BENCH_META=1 npx vitest run rigor/__tests__/meta/saturation.test.ts --maxWorkers=1` exits 0, and `cd harness && npx tsx rigor/saturation.ts --track build --week 2026w43` prints `SATURATION.SUITE set=baseline verdict=saturated`.
- [b] 3.8 Pilot tool `harness/rigor/pilot.ts` (spec FR-7). — deferred:jr-green
  - Stage 1 and stage 2 modes. Read-only on `runs/`.
  - Verify: `cd harness && BENCH_META=1 npx vitest run rigor/__tests__/meta/pilot.test.ts --maxWorkers=1` exits 0. The test uses fake candidates and proves that `runs/` stays unchanged.
- [b] 3.9 Pilot stage 1, no model call (spec FR-7, AC-5). — deferred:jr-green
  - Verify: `cd harness && npx tsx rigor/pilot.ts --stage 1 --series opencode --week 2026w43` prints `PILOT.STAGE1 candidates=8 grades=16 flips=0 harness_errors=0 distinct_rates_max=<d>` with `d` at least 3, and `HISTORY_SHA` prints the same value before and after.
- [b] 3.10 Rigor scoring `harness/rigor/score-rigor.ts` (spec FR-9, AC-8). — deferred:jr-green
  - The rigor axis and the revision-2 total, outside the runner hash until
    task 3.13.
  - Verify: `cd harness && BENCH_META=1 npx vitest run rigor/__tests__/meta/score.test.ts --maxWorkers=1` exits 0.
- [b] 3.11 Port adapters `harness/rigor/ports.ts` and the candidate sets under `harness/rigor/sets/` (spec FR-10). — deferred:jr-green
  - Applicability lists, the regression wiring for bugfix and change, the
    candidate sets `v2` and `m2`, and one tests-track oracle test for each
    `m2` mutant.
  - Verify: `cd harness && BENCH_META=1 npx vitest run rigor/__tests__/meta/ports.test.ts --maxWorkers=1` exits 0.
- [b] 3.12 Pilot stage 2, model calls under D3 (spec FR-7, AC-6). — deferred:owner
  - Verify: `cd harness && npx tsx rigor/pilot.ts --stage 2 --week <week>` prints `PILOT.STAGE2 models=<m> repeats_min=<r> separated_max=<s> rigor_var=<a> adherence_var=<b>` with `m` at least 4, `r` at least 3, `s` at least 3, and `a` at least `b`. It also prints `SATURATION.SUITE set=rigor verdict=ok`.
- [b] 3.13 Admission and activation (spec FR-4, FR-5, FR-9). — deferred:owner
  - Move the admitted criteria into `harness/tests/criteria.ts`, the graders
    into `harness/tests/`, and the meta tests into `harness/tests/meta/`.
    Wire the rigor axis into `harness/score-calculation.ts` with the D1
    weights. Add the variant app to the build canary (D4). Bind the rigor
    set hash in provenance.
  - Verify: `cd harness && npm run test:meta:logic` exits 0, `cd harness && BENCH_TRACK=change npm run test:meta:logic` exits 0, and `CANARY build` passes for the `reference/` overlay and for the `reference-variant/` overlay.
- [b] 3.14 Regrade the OpenCode series of the build, bugfix, and change tracks under revision 2 (spec FR-9). — deferred:owner
  - Legacy Pi rows stay unchanged.
  - Verify: `cd harness && WEEK=all ./rescore-doctor.sh` prints no `FAIL` line. The `HISTORY_SHA` command, limited to the legacy Pi run ids, prints the same value before and after. `cd harness && python3 export-site-data.py` writes ranked rows that carry the rigor axis.
- [b] 3.15 Port activation under D5 (spec FR-10, AC-9). — deferred:owner
  - Activate bugfix `v2` and tests `m2` as new cohorts, or record the
    deferral and its reason here.
  - Verify: `CANARY bugfix`, `CANARY change`, and `CANARY tests` each pass.

## Phase 4: Generate docs and doctor

`measure/generate.sh` and `measure/doctor.sh` do not exist in this repository
(anti-pattern A10). Tasks 4.3 and 4.4 run the repository equivalents.

- [b] 4.1 Documentation (spec AC-11). — deferred:jr-green
  - `SCORING.md`: the rigor axis, the weights, the admission rule, and the
    monitor. `README.md`. `docs/methodology.html`: the change, its date, and
    its reason. `measure/index.md`: the design note row.
  - Verify: `rg -n '^## Rigor criteria' SCORING.md` prints 1 line, `rg -n 'SATURATION.SUITE' SCORING.md` prints at least 1 line, and `rg -n 'rigor' docs/methodology.html` prints at least 1 line.
- [b] 4.2 Weekly monitor wiring in `harness/weekly.sh` (spec FR-8). — deferred:jr-green
  - The monitor runs after the site export and prints its lines in the cron
    log.
  - Verify: the cron rehearsal of `measure/tracks/opencode_executor/design.md` section 6 exits 0. Its log holds one `SATURATION.SUITE` line for each monitored set: `baseline`, `probes`, and `rigor` after task 3.13.
- [b] 4.3 Doctor equivalents on the final HEAD. — deferred:jr-green
  - Run both meta gates, the four track canaries, `verify-rigor.ts --canary`,
    and the monitor. Record the labeled results here.
  - Verify: `cd harness && npm run test:meta:logic && BENCH_TRACK=change npm run test:meta:logic` exits 0. `CANARY build`, `CANARY bugfix`, `CANARY change`, and `CANARY tests` each pass. `cd harness && npx tsx rigor/verify-rigor.ts --canary` prints `failed=0` on both `RIGOR.CANARY` lines.
- [b] 4.4 Tech debt and lessons. — deferred:jr-green
  - Record the probe-saturation follow-up and every waiver in `tech-debt.md`.
  - Verify: `rg -n 'rigor_a_h' tech-debt.md` prints at least 1 line.
