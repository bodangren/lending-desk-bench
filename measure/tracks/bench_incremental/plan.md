# Implementation plan — bench_incremental

Depends on `bench_v2` freshness, provenance, and recost machinery.
`batch.sh`, `weekly.sh`, and `recost.sh` sit outside the provenance hash
lists, so edits do not stale existing scores. `harness/plan-work.ts` also
stays outside the hash lists: scheduling must not invalidate grades.

## Phase 1: Contracts

- [x] 1.1 Work-list JSON schema and `plan-work.ts` CLI (`--work-list <track>`, `--all`). Implemented by Green commit `0ba543be3ad1c146069050ff24c787a646622808`.
- [x] 1.2 `rescore-doctor.sh` `WEEK=all` contract: every run with persisted results, across all weeks. Implemented by Green commit `32b99e2b6d229a4b75b094580c789ee8cc9deb67`.
- [x] 1.3 Pricing-hash marker contract: `reports/go-pricing.sha`, written after each recost decision. Implemented by Green commit `1a870ea695f697e23894e5c16a85b9476892ac14`.

## Phase 2: Tests (Red)

- [x] 2.1 Meta tests: synthetic run trees classify `new`, `failing`, and `current` per track and arm. Red test commit `8fcf50ea398af6fd302095b070a142f59be00f14`.
- [x] 2.2 Meta test: canary, calibration, control, and adhoc runs never enter the work list. Red test commit `8fcf50ea398af6fd302095b070a142f59be00f14`.
- [x] 2.3 Meta test: selector output is identical under a leaked `BENCH_TRACK` (A11 guard). Red test commit `8fcf50ea398af6fd302095b070a142f59be00f14`.
- [x] 2.4 Meta test: batch dry-run consumes the work list; `FORCE=1` restores the full matrix. Red test commit `8fcf50ea398af6fd302095b070a142f59be00f14`.
- [x] 2.5 Site regression: sparse-week export still emits every current model's latest row; the new regression test passes at the phase base. Red test commit `8fcf50ea398af6fd302095b070a142f59be00f14`.

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

- [x] 3.1 `harness/plan-work.ts`. Commit `0ba543be3ad1c146069050ff24c787a646622808`.
- [x] 3.2 `batch.sh` consumes the work list; cross-week skip; `FORCE=1` escape hatch. Commit `e2075ba0137af5d7cb971468777e52f19fdfeb9d`.
- [x] 3.3 `rescore-doctor.sh` gains the all-runs mode. Commit `32b99e2b6d229a4b75b094580c789ee8cc9deb67`.
- [x] 3.4 `weekly.sh`: recost-if-pricing-changed and rescore-if-hashes-changed ordering. Commit `1a870ea695f697e23894e5c16a85b9476892ac14`.

### Phase 3 Green evidence

- Selector unblock first: `harness/summarize.sh` honors an additive
  `BENCH_RUNS_DIR` runs-root override; the default stays `../runs` and is
  byte-identical. Commit `708a16e8fcf7bf31cbf0d5d8f45bc0bbc85326d2`. The Red
  commit `f647c16` scopes the summarize test's runs tree to a temp directory;
  without the override the test scanned the full real `runs/` tree (434 s)
  and failed.
- The phase-base Red command
  (`BENCH_META=1 npx vitest run tests/meta/bench-incremental.test.ts
  --maxWorkers=1`, superset with `tests/meta/publication-freshness.test.ts`)
  exited 1 at role start with 4 failing tests; after the Green implementation
  the same command exited 0: `Tests  9 passed (9)`
  (2026-10-17T16:18:27+08:00).
- Gate R1: `cd harness && npm run test:meta:logic` exited 0 —
  `Test Files  26 passed (26)`, `Tests  170 passed (170)`
  (2026-10-17T16:18:54+08:00).
- Gate R3 (adversarial environment): `cd harness && BENCH_TRACK=change npm
  run test:meta:logic` exited 0 — `Test Files  26 passed (26)`,
  `Tests  170 passed (170)` (2026-10-17T16:20:20+08:00).
- Two consecutive R1 passes on this host: the second
  `cd harness && npm run test:meta:logic` exited 0 — `Test Files  26 passed
  (26)`, `Tests  170 passed (170)` (2026-10-17T16:22:09+08:00).
- `BENCH_TRACK=bugfix` spot-check (`tests/meta/bench-incremental.test.ts`,
  `tests/meta/selfcheck-env.test.ts`, `tests/meta/publication-freshness.test.ts`)
  exited 0 — `Test Files  3 passed (3)`, `Tests  11 passed (11)`
  (2026-10-17T16:21:40+08:00).
- Hash-list guard: `tsx provenance.ts --shell` prints the same runner and
  suite hashes at role start and after the phase
  (`6d011308c050906a614c5b234a977e640ea3a4dd5c8a5985db6330831002ca04`,
  `9cc0c0fa968175f7fb219b6236719d7802e071b477e40c6ada3fad3dd7944ec8`);
  `plan-work.ts` is not in either list.
- Dry run (4.1 preview, evidence only): `tsx plan-work.ts --all` over the
  real `runs/` tree classified 152 rows (19 batch models x 4 tracks x 2
  arms): new 81, failing 71, current 0. Per track: build 38 failing; bugfix
  33 failing + 5 new; tests 38 new; change 38 new. Every real w37-w39 run is
  STALE-PROVENANCE under the current hashes, so no row is `current` until
  the weekly rescore-if-hashes-changed cure runs. Archived (uncommitted):
  `reports/plan-work-dryrun-2026-10-17.json` and
  `reports/plan-work-dryrun-2026-10-17.stderr.log`.
- Hermeticity note: the selector attests each run against the executor that
  run itself recorded (plan-work.ts `withRecordedExecutorEnvironment`), so
  ambient executor inputs (`BENCH_AGENT_IMAGE`, `BENCH_EXECUTOR_*`,
  `BENCH_SKILL_ROOT`) cannot change a classification; `batch.sh` scrubs
  `BENCH_TRACK` from the selector invocation and keeps the A11 self-check
  scrub.

## Phase 4: Verify and document

- [ ] 4.1 Dry run against the real `runs/` tree; cross-check classes
  against `score-freshness.ts`.
- [ ] 4.2 Full meta suite under a `BENCH_TRACK=change` adversarial
  environment.
- [ ] 4.3 `README.md`, `measure/index.md`, `measure/tracks.md` updates.
- [ ] 4.4 `test-strategy.md` with role re-records; phase acceptance
  evidence.
