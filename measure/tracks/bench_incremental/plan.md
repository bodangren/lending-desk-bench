# Implementation plan — bench_incremental

Depends on `bench_v2` freshness, provenance, and recost machinery.
`batch.sh`, `weekly.sh`, and `recost.sh` sit outside the provenance hash
lists, so edits do not stale existing scores. `harness/plan-work.ts` also
stays outside the hash lists: scheduling must not invalidate grades.

## Phase 1: Contracts

- [ ] 1.1 Work-list JSON schema and `plan-work.ts` CLI (`--work-list <track>`,
  `--all`).
- [ ] 1.2 `rescore-doctor.sh` `WEEK=all` contract: every run with persisted
  results, across all weeks.
- [ ] 1.3 Pricing-hash marker contract: `reports/go-pricing.sha`, written
  after each recost decision.

## Phase 2: Tests (Red)

- [x] 2.1 Meta tests: synthetic run trees classify `new`, `failing`, and
  `current` per track and arm. Red test commit: `c95b1be`.
- [x] 2.2 Meta test: canary, calibration, control, and adhoc runs never
  enter the work list. Red test commit: `c95b1be`.
- [x] 2.3 Meta test: selector output is identical under a leaked
  `BENCH_TRACK` (A11 guard). Red test commit: `c95b1be`.
- [x] 2.4 Meta test: batch dry-run consumes the work list; `FORCE=1`
  restores the full matrix. Red test commit: `c95b1be`.
- [x] 2.5 Site regression: sparse-week export still emits every current
  model's latest row. The new regression test passes at the phase base.

### Phase 2 Red evidence

- `cd harness && npm run test:meta:logic` ran from 2026-10-17T13:52:09+08:00
  to 2026-10-17T14:01:21+08:00 and exited 1.
- Vitest summary: `Test Files  1 failed | 25 passed (26)` and
  `Tests  4 failed | 166 passed (170)`.
- Tasks 2.1 and 2.2 fail because `harness/plan-work.ts` is missing.
- Task 2.3 fails because the selector command is missing.
- Task 2.4 fails because `batch.sh` does not consume `plan-work.ts`.
- Task 2.5 passes with the sparse-week synthetic export test.
- Targeted command: `BENCH_META=1 npx vitest run
  tests/meta/bench-incremental.test.ts --maxWorkers=1`; result was
  `Tests  4 failed | 1 passed (5)`.

## Phase 3: Implement (Green)

- [ ] 3.1 `harness/plan-work.ts`.
- [ ] 3.2 `batch.sh` consumes the work list; cross-week skip; `FORCE=1`
  escape hatch.
- [ ] 3.3 `rescore-doctor.sh` gains the all-runs mode.
- [ ] 3.4 `weekly.sh`: recost-if-pricing-changed and
  rescore-if-hashes-changed ordering.

## Phase 4: Verify and document

- [ ] 4.1 Dry run against the real `runs/` tree; cross-check classes
  against `score-freshness.ts`.
- [ ] 4.2 Full meta suite under a `BENCH_TRACK=change` adversarial
  environment.
- [ ] 4.3 `README.md`, `measure/index.md`, `measure/tracks.md` updates.
- [ ] 4.4 `test-strategy.md` with role re-records; phase acceptance
  evidence.
