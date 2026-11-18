# Implementation plan — tests_bench

Depends on `bench_v2` phases 2, 4, and 5 (fixture r2, contract classes, and
`reference-variant/`).

## Phase 1: Contracts

- [x] e9fb565 1.1 `harness/tests-track/mutants.ts`: resolve a mutant ID to a registry bug
      or a sensitivity control; build a mutant tree from the clean app.
      (archive evidence from git, PM 2026-11-18)
- [x] e9fb565 1.2 `harness/tests-track/sets/m1.json` and a set loader with validation.
      (archive evidence from git, PM 2026-11-18)
- [x] 2346ef0 1.3 Contract `tests` mode: writable test files under `tests/`, limits.
      (archive evidence from git, PM 2026-11-18)

## Phase 2: Model-visible tree

- [x] e9fb565 2.1 `harness/tests-track/model-visible/` (`AGENTS.md`, track spec, plan,
      metadata, `vitest.config.mts`). (archive evidence from git, PM 2026-11-18)
- [x] e9fb565 2.2 `harness/tests-track/make-variant.ts` (deterministic, hash manifest).
      (archive evidence from git, PM 2026-11-18)

## Phase 3: Oracle and admission

- [x] e9fb565 3.1 `harness/tests-track/oracle-overlay/tests/*.test.ts`: HTTP and unit tests
      that kill every mutant in `m1`. (archive evidence from git, PM 2026-11-18)
- [x] 3.2 Admission: the oracle, graded as a tests-track candidate (the canary),
      passes twice on the clean app and once on the variant app, and kills each
      mutant. `tests-results.json` records the outcome per app. No separate
      verifier is needed: the canary runs every week.

## Phase 4: Grading and scoring

- [x] e9fb565 4.1 `harness/tests-track/grade-tests.ts`: app cache, per-app server, per-app
      vitest run, `tests-results.json`. (archive evidence from git, PM 2026-11-18)
- [x] 2346ef0 4.2 `run.sh` / `grade.sh` / `batch.sh`: `BENCH_TRACK=tests`. (archive evidence from git, PM 2026-11-18)
- [x] 2346ef0 4.3 `score-calculation.ts`: `deriveTestsScoreMetrics`; `score.ts` record. (archive evidence from git, PM 2026-11-18)
- [x] 2346ef0 4.4 Provenance bindings for the mutant set. (archive evidence from git, PM 2026-11-18)

## Phase 5: Calibration and reporting

- [x] 2346ef0 5.1 Meta tests: set validation, contract mode, arithmetic. (archive evidence from git, PM 2026-11-18)
- [x] 5.2 Canary: the oracle suite graded as a candidate scores 100.
- [x] 2346ef0 5.3 Export and site rows. (archive evidence from git, PM 2026-11-18)
