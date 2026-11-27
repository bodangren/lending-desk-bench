# Implementation plan — guide_docs_ops_20261127

PM decision 2026-11-27: light lane.

## Phase 1: Model guide docs and ops row

Red/Green order: write the fixture, grader, registration, and guide tests first. Start Green only after the named tests fail for the missing track. Add no spec or review gate.

- [x] 1.1 Add Red tests for the docs-and-ops contract.
  Done when the tests fail for the missing track and pin the fixture, grader, registration, and guide behavior.
  Red evidence: tests at f8d55d5 and plan evidence at a2e044e.
  Touches: `harness/tests/meta/docs-ops-fixture.test.ts`, `harness/tests/meta/docs-ops-grader.test.ts`, `harness/tests/meta/docs-ops-registration.test.ts`, `harness/model-guide-tests/guide.test.ts`, `harness/model-guide-tests/fixtures/guide/tracks-mini.json`.

- [x] 1.2 Add the docs-and-ops fixture.
  Green: 36ba742.
  Done when the generated candidate holds the correct app, the track contract, and writable runbook and verifier stubs.
  The candidate receives `fixture/` with the `reference/` task overlay, `package.json`, `tsconfig.json`, `AGENTS.md`, `measure/tracks/lending_desk_docs_ops/spec.md`, `measure/tracks/lending_desk_docs_ops/plan.md`, `measure/tracks/lending_desk_docs_ops/metadata.json`, `docs/runbook.md`, and `ops/verify.ts`.
  The documentation task completes `docs/runbook.md` with setup, scripts, environment, API routes, loan state, verification, and rollback facts from the repository.
  The operations task completes `ops/verify.ts` to validate a fixed operations manifest, emit sorted JSON errors, and return the documented exit code.
  Touches: `harness/docs-and-ops/model-visible/AGENTS.md`, `harness/docs-and-ops/model-visible/track/spec.md`, `harness/docs-and-ops/model-visible/track/plan.md`, `harness/docs-and-ops/model-visible/track/metadata.json`, `harness/docs-and-ops/model-visible/docs/runbook.md`, `harness/docs-and-ops/model-visible/ops/verify.ts`, `harness/docs-and-ops/sets/d1.json`, `harness/docs-and-ops/tasks.ts`, `harness/docs-and-ops/make-variant.ts`, `harness/docs-and-ops/oracle-overlay/docs/runbook.md`, `harness/docs-and-ops/oracle-overlay/ops/verify.ts`, `harness/candidate-contract.ts`.

- [x] 1.3 Add the deterministic grader and score axes. — 178e8ed
  Green: 178e8ed.
  Done when the oracle passes, each broken fixture fails its declared checks, and malformed result IDs invalidate the run.
  Grade documentation against required sections, repository commands, route names, and placeholder rejection.
  Grade the verifier against fixed valid and invalid manifests, deterministic output, exit codes, a clean environment, and a timeout.
  Use documentation and operations as the primary axes, with adherence and quality as the secondary axes. Gate adherence and quality on the mean of the primary axes.
  Touches: `harness/docs-and-ops/grade-docs-ops.ts`, `harness/tests/criteria.ts`, `harness/track-scoring.ts`, `harness/score-calculation.ts`, `harness/score.ts`, `harness/grade.sh`.

- [x] 1.4 Register `docs-and-ops` across the runner and public track export.
  Green: 36ba742.
  Done when `BENCH_TRACK=docs-and-ops` produces `do-` run IDs, passes the oracle canary, survives regrade and rescore, and appears in `tracks.json`.
  Use the `d1` frozen set and the standard non-build repeat default. Keep the track browserless. Leave weekly and daily automation unchanged.
  Touches: `harness/candidate-contract.ts`, `harness/run.sh`, `harness/grade.sh`, `harness/batch.sh`, `harness/plan-work.ts`, `harness/track-bindings.ts`, `harness/provenance.ts`, `harness/regrade-run.sh`, `harness/regrade-all.sh`, `harness/rescore-doctor.sh`, `harness/export-site-data.py`, `harness/tests/meta/schema4-fixtures.ts`, `harness/tests/meta/bench-v2.test.ts`, `harness/tests/meta/bench-incremental.test.ts`, `harness/schedule-tests/grader-browser-record.test.ts`, `harness/schedule-tests/rescore-guard.test.ts`.

- [x] 1.5 Run the app-code session routes that the executor supports. Result: `2eb91c1`. Routes `opencode-go/hy4-flash-free` (`do-a-hy4-flash-free-2026w48-r1`, `do-b-hy4-flash-free-2026w48-r1`) and `opencode-go/muse-spark-1.3-contributor` (`do-a-muse-spark-1-3-contributor-2026w48-r1`, `do-b-muse-spark-1-3-contributor-2026w48-r1`); all four trusted; export freshness run to a temp path.
  Done when each route allowed by the current quota has a current docs-and-ops score that passes freshness.
  Run through `heavy-run.sh` with `BENCH_TRACK=docs-and-ops`, one batch at a time. Keep quota-wait routes open with their GO date. Record unsupported provider routes as `deferred:backlog` with the exact `run.sh` refusal.
  Route `opencode-go/hy4-flash-free`: both runs valid, trusted, publishable and rankable. Totals `96.5` and `96.5`. Mean per arm `96.5`.
  Route `opencode-go/muse-spark-1.3-contributor`: both runs valid, trusted, publishable and rankable. Totals `97.6` and `98.3`. Mean per arm `97.95`.
  Mean per arm over the two routes: arm a `97.05`, arm b `97.4`.
  Freshness: `harness/export-site-data.py` wrote to a temp path and the live freshness checker called every score `TRUSTED` and rankable.
  Touches: `runs/`, `reports/`, `measure/tracks/guide_docs_ops_20261127/plan.md`.

- [x] 1.6 Guide row code for the docs and ops row. Result: `7923199`, `47006fd`, `178e8ed`, `ef44461`, `9ff36eb`.
  Done when the guide picks from Arm A docs-and-ops scores and the live data and page match the published files.
  Read `tracks["docs-and-ops"].models`, rank by total, and keep the empty-table behavior. Use the tracks export date as the evidence date and the highest total as the base line.
  Touches: `harness/model-guide/guide.ts`, `harness/model-guide-tests/guide.test.ts`, `harness/model-guide-tests/fixtures/guide/tracks-mini.json`.

- [b] 1.7 Publish the docs-and-ops guide row and the public track page. deferred:public with Task pending: the PM opens the Google Task.
  Gate: new public track.
  Touches: `docs/tracks.html`, `docs/assets/data/tracks.json`, `docs/assets/data/model-guide.json`, `docs/index.html`, `measure/tracks/guide_docs_ops_20261127/plan.md`.

## Backlog

- docs-and-ops run for opencode-go/hungerg-free: runs when the provider rate limit ends (about 2026-11-28 07:50 +07)
