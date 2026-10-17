# Test strategy — bench_incremental (track-wide, phases 1–4)

Revision: 2026-10-17, strategy agent re-record at role start:

- HEAD: `e69fb07117a3a0a1e2e92ddf1250582aa34c2fa1`
- tracked_diff_hash: `e989967c5459b72368cf4f5182f94211452e03d1`
- status_hash: `05d740af5d48fb9e9233d34a1a194826015777e0`
- recorded: 2026-10-17T13:12:06+08:00

The tree is dirty at role start. Every gate command below runs against the
working tree, never against HEAD. The strategy file lives inside the untracked
`measure/tracks/bench_incremental/` directory, so writing it does not alter
either hash. The role-end re-record in section 12 verifies this.

## 1. Scope and risk summary

This strategy covers all four phases of `bench_incremental`. The track
replaces the weekly full-matrix retest with an incremental schedule:
`plan-work.ts` selects new and failing models per track and arm; `batch.sh`
consumes the work list; `weekly.sh` cures staleness before scheduling.

Risk areas, in priority order:

1. **Selector misclassification.** A `current` model that is re-run wastes API
   spend. A `failing` model that is skipped leaves a false ranking published.
   Both errors are silent: the batch completes either way.
2. **Non-hermetic environment leaks (A11).** A leaked `BENCH_TRACK` must not
   change selector output or meta-suite verdicts.
3. **Run-artifact corruption by scheduling tools.** `plan-work.ts` and the
   pricing-hash marker must never write under `runs/`. Only `rescore-doctor.sh`
   and `recost.sh` may touch run artifacts, under their existing contracts.
4. **Stale-price publication.** A `go-pricing.json` edit without a recost
   publishes stale economics.
5. **Quiet-week site regressions.** A week with zero scheduled runs must still
   export every current model's latest-week row.

## 2. Interphase checker commands

```
RED_TEST_COMMAND:   cd harness && npm run test:meta:logic
GREEN_TEST_COMMAND: cd harness && npm run test:meta:logic && \
                    BENCH_TRACK=change npm run test:meta:logic
```

Justification. The meta suite is the contract surface for the selector, the
batch consumption, and the site-export regression. New meta test files under
`harness/tests/meta/` are picked up by `test:meta:logic` without an
exclude-list change. The Green command adds the adversarial-environment pass
because A11 is a standing risk for every phase that touches batch or weekly
orchestration. A heavier Green gate (live batch dry-runs against the real
`runs/` tree) is rejected: `plan-work.ts` is scheduling-only and never enters
the grading path, so live dry-run proof belongs to phase 4 acceptance, not the
interphase checker. The `test:meta:logic` exclude list in
`harness/package.json` is frozen; growing it to reach green is forbidden (A7).

## 3. Phase 1: Contracts

Risk: **low.** Documentation and CLI-shape definitions only. No production
code changes. The risk is a contract that the later phases cannot test.

### Red commands (targeted)

No Red test command applies. The phase produces contract text only.

### Green gate

1. The work-list JSON schema names every field the phase-2 tests assert:
   `track`, `arm`, `model`, `class`, trusted count, and reason.
2. The `WEEK=all` contract states that `rescore-doctor.sh` covers every run
   with persisted results across all weeks, and keeps its per-run fail-closed
   behavior (replace `score.json` only with a valid record).
3. The pricing-hash marker contract states the path (`reports/go-pricing.sha`),
   the writer (weekly.sh, after each recost decision), and that
   `reports/` is never committed.

### Closeout gate

Each contract field is traceable to a phase-2 test in the plan. A schema field
with no planned assertion fails the gate (A4 analog: a contract nothing tests
is vacuous).

### Anti-pattern coverage

| Anti-pattern | Defense |
|---|---|
| A4 vacuous-pass | Every schema field must map to a planned phase-2 assertion |
| A5 false claim | Contract text states behavior, not results; no "passes" claims |

## 4. Phase 2: Tests (Red)

Risk: **high.** These tests are the only defense against selector
misclassification. A weak test here passes a wrong selector in phase 3 and the
error ships silently into the weekly cron. New meta tests also change
`suite_sha256` (all of `harness/tests/**` is hashed); see section 9.

### Red commands (targeted)

```
# R1 — full meta suite; the new tests must fail, the rest must stay green:
cd /home/daniebo/Desktop/lending-desk-bench/harness && npm run test:meta:logic

# R2 — targeted iteration on the new selector test file(s) once named:
cd /home/daniebo/Desktop/lending-desk-bench/harness && \
  BENCH_META=1 npx vitest run tests/meta/<new-selector-test>.test.ts --maxWorkers=1

# R3 — A11 adversarial pass; must stay green for existing tests:
cd /home/daniebo/Desktop/lending-desk-bench/harness && \
  BENCH_TRACK=change npm run test:meta:logic
```

Red evidence requirements. The Red handoff must record the R1 command, its
timestamp, and the labeled vitest summary (`Test Files  N passed | M failed`,
`Tests  N passed | M failed`). Each new test must fail for the stated reason:
a missing `plan-work.ts` import is an acceptable Red only if the failure
message names the module; assertion-level Reds are preferred where a stub
exists. The Red handoff lists each new test and its falsification condition.

### Required test set (from plan 2.1–2.5) and falsification conditions

1. **Classification (2.1).** Synthetic run trees classify `new`, `failing`,
   and `current` per track and arm. Falsification: a tree with trusted-run
   count below the track repeat count must classify `failing`; at or above it,
   `current`; with no agent runs, `new`. Build track uses its repeat count
   (default 3); other tracks use 1.
2. **Identity from provenance only (2.2).** Canary, calibration, control, and
   adhoc runs never enter the work list. Falsification: a synthetic run whose
   run ID matches the batch shape but whose `provenance.json` carries a
   non-agent mode or a non-batch model must not count toward any batch model.
   A run whose ID looks like a canary ID but whose provenance carries a batch
   model, agent mode, matching arm and track must count. Any run-ID parsing in
   the selector fails this test.
3. **A11 hermeticity (2.3).** Selector output is byte-identical under a leaked
   `BENCH_TRACK`. Falsification: run the classification twice, once with
   `BENCH_TRACK=change` in the process environment, and diff the JSON output.
   The test constructs its environment with `envWithoutTrack()` / `applyEnv`
   from `score-helpers.ts` unless a fixture pins a track.
4. **Batch consumption (2.4).** A batch dry-run consumes the work list and
   skips everything else; `FORCE=1` restores the full matrix. Falsification:
   the scheduled run-ID set must equal the work-list set expanded by arms and
   reps, and must equal the full pricing-table set under `FORCE=1`.
5. **Sparse-week site export (2.5).** The export emits every current model's
   latest-week row when some models have no run in the current week.
   Falsification: a synthetic `runs/` tree with a model absent from the latest
   week must still produce that model's row from its latest valid week.

### Green gate

Not applicable in phase 2; the tests stay red until phase 3. The phase-2
closeout requires only that the pre-existing suite stays green (R1 minus the
new failures) and that R3 shows no new environment fragility.

### Closeout gate

Red evidence recorded per the requirements above. The new tests are committed
or stashed with the track's test commit. No assertion in a pre-existing test
is weakened, deleted, or skipped.

### Fixtures, mocks, live behavior

- Synthetic run trees only (NFR-2). No real model runs. No API calls.
- The selector tests must call the real `assessScoreFreshness` from
  `score-freshness.ts`. A mock freshness verdict is forbidden: it would detach
  the test from the trust definition it guards.
- Freshness assessment reads the candidate tree; synthetic trees must satisfy
  the candidate contract or the test must assert the resulting non-TRUSTED
  state explicitly. A fixture that accidentally produces TRUSTED through a
  contract loophole invalidates the classification test.

### Guardrails and changed-contract risks

- `harness/tests/**` is inside `suite_sha256`. Adding meta tests stales
  existing scores on the next freshness assessment. This is accepted (same
  rule as bench_v2 7.1R) and is cured by the phase-3 `WEEK=all` rescore path.
  The phase ordering must keep the new tests final before phase 4.1's dry run.
- The work-list JSON schema from phase 1 is frozen at Red. A schema change in
  phase 3 reopens phase 2.

### Anti-pattern coverage

| Anti-pattern | Defense |
|---|---|
| A3 digit-only counts | Pass/fail counts come from the labeled vitest summary, never a digit grep |
| A4 vacuous-pass | Each new test has a stated falsification condition; an empty synthetic tree that classifies nothing fails the test |
| A5 false claim | The plan checkbox moves only on recorded Red evidence with command and timestamp |
| A7 over-broad filter | The identity test (2.2) forbids run-ID exclusion filters; exclusion must be provenance-based. The `test:meta:logic` exclude list stays frozen |
| A11 inherited environment | Test 2.3 is the standing guard; test env construction uses `envWithoutTrack()` / `applyEnv` |

## 5. Phase 3: Implement (Green)

Risk: **high.** This phase writes the selector and rewires the weekly driver.
A defect here runs every week in cron. Run-artifact corruption and stale-price
publication risks are realized here.

### Red commands (targeted)

Same as phase 4 R1–R3. Red state entering phase 3: the phase-2 tests fail;
the rest of the suite passes.

```
# Iteration subset once the selector test file is named:
cd /home/daniebo/Desktop/lending-desk-bench/harness && \
  BENCH_META=1 npx vitest run tests/meta/<new-selector-test>.test.ts --maxWorkers=1
```

### Green gate

1. R1 full pass, including every phase-2 test.
2. R3 (`BENCH_TRACK=change`) full pass. Spot-check `BENCH_TRACK=bugfix` once.
3. No assertion, fixture payload, or exclude-list entry weakened or deleted.
   Additive guard tests are allowed.
4. Hash-list guard: `harness/provenance.ts` `currentHashes()` lists are
   unchanged, and `plan-work.ts` does not appear in them. Verify with
   `tsx provenance.ts --shell` before and after the phase; runner and suite
   hashes may change only through the phase-2 test additions, not through any
   production-file edit outside the approved fix surface.

### Closeout gate

- Two consecutive full R1 passes on this host (flake defense, inherited from
  the bench_v2 stability rule).
- R3 pass captured in the same evidence block.
- A dry-run listing from `plan-work.ts --all` against the real `runs/` tree is
  captured for phase 4.1 cross-check. It is evidence, not a gate: phase 4
  verifies it.
- Evidence (command, timestamp, labeled pass counts) attached to the plan
  handoff.

### Fix surface

Allowed: new file `harness/plan-work.ts`; `harness/batch.sh`;
`harness/weekly.sh`; `harness/rescore-doctor.sh`; additive meta tests under
`harness/tests/meta/`.

Frozen (escalate to the orchestrator if Green believes a change is needed):
`harness/score-freshness.ts`, `harness/score.ts`, `harness/score-attestation.ts`,
`harness/provenance.ts`, `harness/provenance-check.ts`,
`harness/provenance-record.ts`, `harness/candidate-contract.ts`,
`harness/go-cost.ts`, `harness/go-pricing.json`, and the `test:meta:logic`
exclude list. Note that `go-cost.ts` is inside `runner_sha256`: an edit to it
stales every existing score. `plan-work.ts` must import `batchLines` and
`assessScoreFreshness` without editing either module.

### Fixtures, mocks, live behavior

- Live-behavior proof required: the R1/R3 suite runs execute the real
  freshness pipeline against synthetic trees.
- Artifact tests may supplement for shell wiring (for example: `batch.sh`
  reads the work list instead of the raw pricing lines; `weekly.sh` writes the
  pricing-hash marker; `rescore-doctor.sh` accepts `WEEK=all`). Each artifact
  test must pair with a live test that executes the behavior.
- No mocks may replace `assessScoreFreshness`, `go-cost.ts`, or the run
  filesystem in the classification tests.

### Guardrails and changed-contract risks

- **Scheduling tools never write run artifacts (FR-6).** `plan-work.ts` is
  read-only over `runs/`. `weekly.sh` writes only the marker under `reports/`.
  Guard: a meta test asserts the selector runs against a read-only-mounted or
  permission-frozen copy of a synthetic tree without error and without
  modification (compare a recursive checksum before and after).
- **Run-ID format unchanged (FR-2).** `<prefix><arm>-<slug>-<WEEK>-r<N>` stays.
  `summarize.sh`, `rescore-doctor.sh`, and the export keep parsing it. The
  existing meta tests that exercise these tools are the regression guard.
- **`FORCE=1` escape hatch.** It must restore the exact pre-change behavior:
  every batch model, every arm, full reps, exact-ID trusted-score skip.
- **`rescore-doctor.sh WEEK=all`.** The all-runs mode keeps the per-run
  fail-closed contract: replace `score.json` only with a valid record, restore
  `provenance.json.prev` on failure. A skipped run (missing candidate, missing
  artifact) prints `SKIP` with its reason and never fails the batch.
- **Pricing is not hashed.** `go-pricing.json` sits outside both hash lists.
  A price edit must trigger `recost.sh` only. Guard: a test that recomputes
  `currentHashes()` after a price-table edit and expects identical hashes is
  not possible (the file is not hashed, so hashes cannot change); the real
  guard is the phase-4.1 acceptance check that a price edit schedules zero
  agent runs.

### Anti-pattern coverage

| Anti-pattern | Defense |
|---|---|
| A3 digit-only counts | Batch dry-run and work-list counts parsed from labeled JSON fields and the labeled `BATCH COMPLETE` line, never digit greps |
| A4 vacuous-pass | An empty work list is a valid result only when the dry run also reports every model `current`; a selector that emits nothing because it read nothing fails the read-only guard test |
| A5 false claim | Green handoff cites captured command output with timestamps; plan checkboxes move only on verified evidence |
| A7 over-broad filter | Work-list inclusion comes from provenance identity, not ID-shape exclusion; test 2.2 is the guard. Exclude list in `package.json` frozen |
| A10 generated-facts drift | The pricing-hash marker is rewritten after each recost decision; a stale marker is detectable by recomparing `sha256(go-pricing.json)` with the marker |
| A11 inherited environment | R3 adversarial full-suite pass; `batch.sh` keeps the `env -u BENCH_TRACK` self-check scrub; the selector test 2.3 proves hermetic output |

## 6. Phase 4: Verify and document

Risk: **medium.** Read-only verification over real artifacts plus
documentation. The risk is a false verification claim (A5) and a registry
overstatement (A6).

### Red commands (targeted)

```
# V1 — dry run against the real runs/ tree:
cd /home/daniebo/Desktop/lending-desk-bench/harness && \
  ./node_modules/.bin/tsx plan-work.ts --all

# V2 — adversarial full suite (also the A11 standing guard):
cd /home/daniebo/Desktop/lending-desk-bench/harness && \
  BENCH_TRACK=change npm run test:meta:logic
```

Red condition: V1 classifications disagree with `assessScoreFreshness` on any
run, or V2 fails.

### Green gate

1. **Cross-check (4.1).** For a sampled set of runs across all four tracks,
   `plan-work.ts` classifications match an independent
   `score-freshness.ts --many` assessment. Trusted counts per track and arm
   match the work-list `trusted count` fields. Zero mismatches.
2. **A11 (4.2).** V2 passes. The R1 suite passes twice consecutively.
3. **Acceptance dry runs** (spec acceptance criteria):
   - Simulated quiet week (no pricing, harness, or catalog change; every model
     current): the work list is empty and schedules zero agent runs.
   - A price edit on a scratch copy of `go-pricing.json` changes the
     `recost-if-changed` decision and schedules zero agent runs.
   - A failing or new synthetic model enters the work list with the full track
     repeat count.

### Closeout gate

- V1 output archived under `reports/` (uncommitted, per the never-commit
  rule), summarized in the plan handoff with labeled counts per class.
- Documentation (4.3): `README.md`, `measure/index.md`, `measure/tracks.md`
  updated. Track status moves only after acceptance evidence exists (A6).
- This strategy file carries the role re-records (4.4).

### Fixtures, mocks, live behavior

Live behavior only against the real `runs/` tree for 4.1 and the quiet-week
dry run. The price-edit check uses a scratch pricing copy and never the real
table. No mocks.

### Anti-pattern coverage

| Anti-pattern | Defense |
|---|---|
| A3 digit-only counts | Class counts parsed from the work-list JSON fields |
| A4 vacuous-pass | An empty work list passes only with per-model `current` evidence |
| A5 false claim | 4.1 cross-check cites the archived V1 output and the `--many` output |
| A6 registry-note overstatement | `tracks.md` and `metadata.json` status changes land only with commit evidence and a green suite |
| A11 inherited environment | V2 is the acceptance gate for hermeticity |

## 7. Intentionally-red aggregate-suite handling

- Many meta tests are negative tests. Their internal reds are the assertion.
  Only the labeled vitest summary decides a gate.
- `test:meta:logic` intentionally excludes `runtime-isolation*.ts` and
  `run-executor-provenance.test.ts` (Podman probes hang on this host). The
  exclusion is fixed policy. Growing it to reach green is forbidden (A7).
- During phase 2 the new selector tests are intentionally red inside an
  otherwise green suite. The Red evidence must separate the new failures from
  the pre-existing pass count. Any pre-existing test that turns red during
  phase 2 or 3 blocks the phase.
- `npm run test:unit` requires a candidate tree and is red by design against
  `fixture/`. It is not part of this track's gates.

## 8. Artifact tests vs live-behavior tests

Artifact tests assert file text: shell wiring in `batch.sh` and `weekly.sh`,
the `env -u BENCH_TRACK` scrub, the marker path. They guard wiring and cannot
prove behavior. Live-behavior tests execute the pipeline: classification over
synthetic trees, the A11 adversarial suite runs, the phase-4 dry runs. Every
gate in this strategy requires the live-behavior form of its claim. Artifact
tests may only supplement, each paired with a live test of the same contract.

## 9. Hash-freeze and changed-contract risks

- `plan-work.ts`, `batch.sh`, `weekly.sh`, and `recost.sh` stay outside the
  `provenance.ts currentHashes()` lists. Scheduling changes must not stale
  grades (FR-6). The phase-3 Green gate verifies the lists are untouched.
- `go-cost.ts` is inside `runner_sha256`. This track must not edit it. The
  selector imports it read-only.
- `go-pricing.json` is not hashed. Price edits trigger recost only, never
  agent runs.
- New meta tests under `harness/tests/**` change `suite_sha256`. This stales
  existing scores until the next `rescore-doctor.sh WEEK=all` run cures them.
  Keep the phase-2 test files final before phase 4.1, so the dry run assesses
  freshness under the same hashes that phase 4.2 verifies.
- Score record schema and provenance schema shapes are consumed by
  `summarize.sh`, `rescore-doctor.sh`, `regrade-run.sh`, and the export. This
  track must not change them.

## 10. Review gate applicability

| Gate | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|---|---|---|---|---|
| Review A (correctness) | yes — contract traceability | yes — test falsification conditions | yes — selector logic against FR-1/FR-2 | yes — cross-check evidence |
| Review B (security) | no new surface | yes — synthetic-tree confinement; no real API keys in fixtures | yes — read-only guarantee of `plan-work.ts` over `runs/`; marker path confinement to `reports/`; fail-closed rescore preserved | no new surface |
| Review C (UX/API) | yes — work-list JSON is a new consumed contract | yes — schema frozen at Red | yes — work-list JSON and run-ID format stability | yes — export JSON is the site consumer contract |
| Adversarial testing | not applicable | yes — R3 adversarial-env suite | yes — R3 plus read-only-mount guard | yes — V2 adversarial-env full suite |
| UX browser review | not applicable | not applicable | not applicable | not applicable — no user-facing UI changes; the owner may spot-check the published site after a quiet-week export |

## 11. `phase_base_sha` capture point

Capture `phase_base_sha` **immediately after the commit that adds this
strategy file** and before any Red-phase file change:

```
git rev-parse HEAD                                # -> phase_base_sha
git diff HEAD | git hash-object --stdin           # re-record tracked_diff_hash
git status --porcelain | git hash-object --stdin  # re-record status_hash
```

Do not use `e69fb07117a3a0a1e2e92ddf1250582aa34c2fa1`; it predates the
committed strategy. The tree stays dirty, so the two diff hashes are part of
the phase base alongside the commit id.

## 12. Role-end re-record

Role end re-record: 2026-10-17, values verified after writing this file:

- HEAD: `e69fb07117a3a0a1e2e92ddf1250582aa34c2fa1`
- tracked_diff_hash: `e989967c5459b72368cf4f5182f94211452e03d1`
- status_hash: `05d740af5d48fb9e9233d34a1a194826015777e0`

Values unchanged from role start. This file sits inside the untracked
`measure/tracks/bench_incremental/` directory, so `git status --porcelain`
still lists only the directory and both hashes are stable.
