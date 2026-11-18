# Implementation plan — change_bench

Depends on `bench_v2` phases 2 and 4.

## Phase 1: Contracts

- [x] e9fb565 1.1 `harness/change/sets/c1.json` and a set loader. (archive evidence from git, PM 2026-11-18)
- [x] 2346ef0 1.2 `CHANGE_CRITERIA` in `harness/tests/criteria.ts` with tier and CR. (archive evidence from git, PM 2026-11-18)
- [x] 2346ef0 1.3 Contract `change` mode: the nine task files plus the track closeout. (archive evidence from git, PM 2026-11-18)

## Phase 2: Model-visible tree and reference

- [x] e9fb565 2.1 `harness/change/model-visible/` (`AGENTS.md`, spec, plan, metadata). (archive evidence from git, PM 2026-11-18)
- [x] e9fb565 2.2 `harness/change/make-variant.ts` (deterministic, hash manifest). (archive evidence from git, PM 2026-11-18)
- [x] e9fb565 2.3 `reference-change/`: the nine task files with CR-1 to CR-4. (archive evidence from git, PM 2026-11-18)

## Phase 3: Tests

- [x] e9fb565 3.1 `harness/tests/e2e/change.spec.ts` (CR-1, CR-3 action, CR-4). (archive evidence from git, PM 2026-11-18)
- [x] e9fb565 3.2 `harness/tests/api/change.test.ts` (CR-2, CR-3 API). (archive evidence from git, PM 2026-11-18)
- [x] 2346ef0 3.3 Track-aware suite selection in `grade.sh` and the collector. (archive evidence from git, PM 2026-11-18)
- [x] 2346ef0 3.4 Sensitivity controls for every X.* ID against the change reference. (archive evidence from git, PM 2026-11-18)

## Phase 4: Scoring and calibration

- [x] 2346ef0 4.1 `deriveChangeScoreMetrics`; `score.ts` record. (archive evidence from git, PM 2026-11-18)
- [x] 2346ef0 4.2 Provenance bindings for the change set. (archive evidence from git, PM 2026-11-18)
- [x] 2346ef0 4.3 Meta tests; canary scores 100; untouched variant scores change 0. (archive evidence from git, PM 2026-11-18)
- [x] 2346ef0 4.4 Export and site rows. (archive evidence from git, PM 2026-11-18)
