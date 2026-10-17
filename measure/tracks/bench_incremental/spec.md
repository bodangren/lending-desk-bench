# Incremental benchmark runs — bench_incremental

## Summary

The weekly cron retests every batch model on all four tracks. Run IDs embed
the ISO week, and the batch only skips an exact ID match. So every new week
re-runs the full matrix. This track replaces the full retest with an
incremental schedule. The batch tests only new models and models whose
latest results fail. Cost recalculation stays a pure `go-pricing.json`
operation and never schedules an agent run.

## Definitions

- **Batch model.** A `go-pricing.json` entry with `high_usage && batch`, as
  listed by `go-cost.ts --batch-lines`.
- **Trusted run.** A run that `score-freshness.ts` assesses as TRUSTED and
  rankable under the current runner and suite hashes.
- **New model.** A batch model with no agent run for a given track and arm.
- **Failing model.** A batch model with agent runs for a track and arm, but
  fewer trusted runs than the track's repeat count.
- **Current model.** A batch model whose trusted-run count for a track and
  arm reaches the track's repeat count.
- **Work list.** The per-track set of new and failing models the batch
  schedules.
- **Cure.** Restoring rankability without an agent: `rescore-doctor.sh` for
  a scoring-only harness change, or a regrade graft for a suite-content
  change.

## Functional requirements

### FR-1 — Work-list selector

- `harness/plan-work.ts` enumerates every batch model for each track and
  arm.
- It reads model identity from each run's `provenance.json` (`model`,
  `arm`, `track`). It never derives identity from run IDs. Canary,
  calibration, control, and adhoc runs therefore never enter the work list.
- It classifies each batch model as `new`, `failing`, or `current` using
  `assessScoreFreshness` from `score-freshness.ts`.
- A model is `current` when its trusted-run count for the track and arm
  reaches the track repeat count (`REPS_BUILD` default 3, other tracks 1).
- It emits the work list as JSON: track, arm, model, class, trusted count,
  and reason.

### FR-2 — Batch consumption

- `batch.sh` schedules only work-list entries instead of the full pricing
  table.
- Run IDs keep the `<prefix><arm>-<slug>-<WEEK>-r<N>` form. Existing
  rescore, export, and page tools keep working.
- A scheduled model runs both arms in one batch invocation. The paired
  Skills delta needs both arms in a shared week.
- A scheduled model runs the track's full repeat count. A failing model
  gets the same reps as a new model (operator decision 2026-10-17).
- `FORCE=1` restores full-matrix behavior as an escape hatch.
- The `env -u BENCH_TRACK` self-check scrub from A11 stays. The selector
  stays hermetic under a leaked environment.

### FR-3 — Cure before scheduling

- `rescore-doctor.sh` gains an all-runs mode (`WEEK=all`). It cures
  provenance staleness for every run with persisted results, across all
  weeks.
- The weekly order is: recost if the price table changed, rescore if the
  harness hashes changed, compute the work list, then run.
- A suite-content harness change stays an operator decision: regrade graft
  (`regrade-run.sh` / `regrade-all.sh`) or a forced full matrix. The
  selector never decides this.

### FR-4 — Cost-table detection

- `weekly.sh` stores the `go-pricing.json` sha256 under `reports/`. When
  the hash changes, it runs `recost.sh` over every score. A price change
  schedules no agent runs.
- New pricing entries become `new` models through the normal work list.

### FR-5 — Weekly driver

- A quiet week runs: catalog fetch, recost-if-changed, rescore-if-changed,
  work list (possibly empty), self-check, canary, site export, publish.
- The self-check and canary stay unconditional. A quiet week still proves
  the grading path before anything publishes.

### FR-6 — Scoring integrity

- The selector only schedules. It never edits `score.json`, provenance, or
  freshness results.
- `harness/plan-work.ts` stays outside the provenance hash lists, alongside
  `batch.sh`, `weekly.sh`, and `recost.sh`. Scheduling changes must not
  invalidate existing grades.

## Non-functional requirements

- NFR-1 — Hermeticity: selector output depends only on `runs/`,
  `go-pricing.json`, and harness hashes. Caller environment never changes
  the result (A11 class).
- NFR-2 — Meta coverage: meta tests prove the three classes with synthetic
  run trees. No real model runs.
- NFR-3 — Sparse weeks: the site export keeps emitting per-model
  latest-week rows when some models have no run in the current week. A
  regression test guards this.

## Acceptance criteria

- A dry run over the current `runs/` tree classifies every batch model
  consistently with `score-freshness.ts`.
- With no pricing, harness, or catalog change and every model current, the
  weekly batch schedules zero agent runs.
- A price edit triggers recost only.
- A failing or new model is re-run with full track reps.
- The full meta suite stays green under `BENCH_TRACK=change` (A11 guard).

## Out of scope

- Run-ID format changes and site data schema changes.
- Automatic detection of suite-content vs scoring-only harness changes.
- Self-check or canary removal; cadence changes.
- The model-visible fixture, criteria, or scoring weights.
