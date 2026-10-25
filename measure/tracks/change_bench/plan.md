# Implementation plan — change_bench

Depends on `bench_v2` phases 2 and 4.

## Phase 1: Contracts

- [x] 1.1 `harness/change/sets/c1.json` and a set loader.
- [x] 1.2 `CHANGE_CRITERIA` in `harness/tests/criteria.ts` with tier and CR.
- [x] 1.3 Contract `change` mode: the nine task files plus the track closeout.

## Phase 2: Model-visible tree and reference

- [x] 2.1 `harness/change/model-visible/` (`AGENTS.md`, spec, plan, metadata).
- [x] 2.2 `harness/change/make-variant.ts` (deterministic, hash manifest).
- [x] 2.3 `reference-change/`: the nine task files with CR-1 to CR-4.

## Phase 3: Tests

- [x] 3.1 `harness/tests/e2e/change.spec.ts` (CR-1, CR-3 action, CR-4).
- [x] 3.2 `harness/tests/api/change.test.ts` (CR-2, CR-3 API).
- [x] 3.3 Track-aware suite selection in `grade.sh` and the collector.
- [x] 3.4 Sensitivity controls for every X.* ID against the change reference.

## Phase 4: Scoring and calibration

- [x] 4.1 `deriveChangeScoreMetrics`; `score.ts` record.
- [x] 4.2 Provenance bindings for the change set.
- [x] 4.3 Meta tests; canary scores 100; untouched variant scores change 0.
- [x] 4.4 Export and site rows.
