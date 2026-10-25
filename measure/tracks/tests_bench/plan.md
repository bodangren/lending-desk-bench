# Implementation plan — tests_bench

Depends on `bench_v2` phases 2, 4, and 5 (fixture r2, contract classes, and
`reference-variant/`).

## Phase 1: Contracts

- [x] 1.1 `harness/tests-track/mutants.ts`: resolve a mutant ID to a registry bug
      or a sensitivity control; build a mutant tree from the clean app.
- [x] 1.2 `harness/tests-track/sets/m1.json` and a set loader with validation.
- [x] 1.3 Contract `tests` mode: writable test files under `tests/`, limits.

## Phase 2: Model-visible tree

- [x] 2.1 `harness/tests-track/model-visible/` (`AGENTS.md`, track spec, plan,
      metadata, `vitest.config.mts`).
- [x] 2.2 `harness/tests-track/make-variant.ts` (deterministic, hash manifest).

## Phase 3: Oracle and admission

- [x] 3.1 `harness/tests-track/oracle-overlay/tests/*.test.ts`: HTTP and unit tests
      that kill every mutant in `m1`.
- [x] 3.2 Admission: the oracle, graded as a tests-track candidate (the canary),
      passes twice on the clean app and once on the variant app, and kills each
      mutant. `tests-results.json` records the outcome per app. No separate
      verifier is needed: the canary runs every week.

## Phase 4: Grading and scoring

- [x] 4.1 `harness/tests-track/grade-tests.ts`: app cache, per-app server, per-app
      vitest run, `tests-results.json`.
- [x] 4.2 `run.sh` / `grade.sh` / `batch.sh`: `BENCH_TRACK=tests`.
- [x] 4.3 `score-calculation.ts`: `deriveTestsScoreMetrics`; `score.ts` record.
- [x] 4.4 Provenance bindings for the mutant set.

## Phase 5: Calibration and reporting

- [x] 5.1 Meta tests: set validation, contract mode, arithmetic.
- [x] 5.2 Canary: the oracle suite graded as a candidate scores 100.
- [x] 5.3 Export and site rows.
