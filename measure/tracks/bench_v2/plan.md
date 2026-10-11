# Implementation plan — bench_v2

Order: low-risk validity fixes first, then the fixture revision, then scoring,
then calibration and the historical regrade. The two sibling tracks
(`tests_bench`, `change_bench`) run between phases 5 and 7.

Execution notes:

- Run meta tests with `BENCH_META=1` from `harness/`.
- A harness edit changes the runner or suite hash. The historical regrade in
  phase 7 runs once, after every test and scoring edit is final.
- Never use `BENCH_IGNORE_LOAD` as a reason to skip a calibration.

---

## Phase 1: Validity fixes

- [x] 1.1 `harness/browser-check.ts`: launch Chromium, render one page, exit 0.
      `grade.sh` calls it before the gate and writes an invalid record on failure.
- [x] 1.2 `grade.sh`: scan both Playwright raw reports for `browserType.launch`
      and write an invalid record on a hit.
- [x] 1.3 `score.ts`: the same raw-report scan, so a rescore invalidates a
      historical no-browser record.
- [x] 1.4 `grade.sh`: restore `node_modules` from the fixture when the candidate
      has no `next` binary.
- [x] 1.5 `batch.sh`: `BENCH_SELFCHECK=logic`; `cron-weekly.sh` default `logic`.
- [x] 1.6 `batch.sh`: per-track repeats and `-r<N>` run IDs.
- [x] 1.7 `batch.sh`: per-track canary (`BENCH_CANARY`).

## Phase 2: Fixture revision r2

- [x] 2.1 `harness/revisions.ts` with `FIXTURE_REVISION = 2`.
- [x] 2.2 `fixture/AGENTS.md` and the spec goal: add/rename/change/remove
      wording; definition of done forbids editing `spec.md`.
- [x] 2.3 Spec E gains the labels and error-announcement checkboxes.
- [x] 2.4 `fixture/app/api/bench-state/route.ts` (protected, key-gated).
- [x] 2.5 `fixture/package.json`: pinned `vitest`; reinstall `fixture/node_modules`.
- [x] 2.6 Playwright config passes `BENCH_STATE_KEY`; the E and F tests read and
      set up state through the bench-state route.
- [x] 2.7 Reference: `role="alert"` on both form errors; update every anchor in
      controls, negative controls, and the bug registry that the edit moves.

## Phase 3: New checks

- [x] 3.1 `E.labels`, `E.error-announced` tests, criteria, spec-matrix rows,
      controls.
- [x] 3.2 `P.auth-before-parse`, `P.malformed-json` API probes and controls.
- [x] 3.3 `P.action-race`, `P.retry-after-error` browser probes and controls.
- [x] 3.4 `P.axe-clean` with pinned `axe-core` in the harness, and its control.

## Phase 4: Scoring

- [x] 4.1 Contract hard/soft classes; `contract-violation.json`; graft in
      `run.sh`.
- [x] 4.2 Provenance schema 6: `fixture_revision`, optional `graft` block,
      track-specific bindings.
- [x] 4.3 Criterion weights; adherence axis; new build and bugfix weights.
- [x] 4.4 `score.ts`, `score-freshness.ts`, `score-attestation.ts` accept
      schema 6 and the new axes.
- [x] 4.5 Executor resolution from the run record for rescore and regrade.

## Phase 5: Reference variant

- [x] 5.1 `reference-variant/`: a second correct implementation of the nine
      task files, different in every incidental choice.
- [x] 5.2 Calibrate: the reference and the reference variant both score 100.

## Phase 6: Reporting

- [x] 6.1 Export: repeat grouping (median, worst, count), paired Skills delta,
      `fixture_revision`, new axes, tracks data for bugfix/tests/change.
- [x] 6.2 Site: results table columns, tracks page, methodology text.
- [x] 6.3 `summarize.sh` and model pages read the new fields.

## Phase 7: Calibration and regrade

- [~] 7.1 Update and extend the meta tests; reopened 2026-10-11 because the
      `test:meta:logic` claim was false at the w41 cron. `BENCH_TRACK=change`
      produces 15 meta failures: class E1 is the `batch.sh` self-check
      environment leak, and class E2 is non-hermetic meta tests that inherit
      `BENCH_TRACK` (see `test-strategy.md` §§1–2). Red adds
      `harness/tests/meta/selfcheck-env.test.ts`. Green fix surface follows
      §4 (`batch.sh`, score helpers and fixtures, seven failing tests, and the
      additive guard). Acceptance follows §8: two full R1 passes, an R2 pass,
      unchanged tests and excludes, and a track-neutral self-check invocation.
      Red proof at
      2026-10-11T08:31:54+08:00: `BENCH_META=1 npx vitest run
      tests/meta/selfcheck-env.test.ts --maxWorkers=1` exited 1; both guards
      failed as expected (15s wall, 3.59s Vitest duration).
- [ ] 7.2 `verify-controls --id` for every new control; `verify-bugs --all`.
- [x] 7.3 Canary for each of the four tracks scores 100.
- [ ] 7.4 `regrade-run.sh` and `regrade-all.sh`; regrade every historical
      agent run (w37–w39, both tracks).
- [ ] 7.5 Export the site data and the model pages.

## Phase 8: Documentation

- [x] 8.1 `README.md`, `SCORING.md`, `measure/index.md`, `measure/tracks.md`.
- [x] 8.2 `tech-debt.md`: close the paid items; record new debt.
