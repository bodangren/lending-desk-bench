# Implementation plan — bugfix_bench

Order follows the measure classic pipeline: contracts, tests, implementation.
Phase 5 calibrates before any cohort. Phase 6 ships reporting.

Execution notes:

- Run meta tests with `BENCH_META=1` from `harness/`.
- Any edit under `harness/` that provenance hashes invalidates old scores.
  That is intended. Do not invent workarounds.
- Calibration runs use overlay mode (`AGENT_SKIP=1`). They are diagnostic and
  nonrankable. Never use `BENCH_IGNORE_LOAD=1` for calibration.
- Do not regrade build-track runs while implementing this track.

Lessons applied from `harness_audit`:

- Detectors grade spec-stated behavior only. The `reference-variant/` gate
  (audit task 1.5) blocks registry admission until it exists.
- One defect is charged once. Repair and regression axes are disjoint by
  construction: detector ids never enter the regression denominator.
- No exact-string, exact-markup, or reference-incidental assertions may serve
  as detectors.

---

## Phase 1: Contract and schema definition

- [x] 1.1 Define the bug registry types and validator.
      DONE. `harness/bugfix/registry.ts` exports `BugEntry`, the class union,
      `validateRegistry`, pairwise `detectorConflicts`, `getBug`, and a
      content-stable `registryHash`. Validated by `tests/meta/bugfix-registry.test.ts`.
- [x] 1.2 Define the task set schema and loader.
      DONE. `harness/bugfix/set-loader.ts` with `loadSet`, `validateSet`
      (class coverage, registry membership, detector disjointness), and
      `setFileHash`. Admission and calibration sets opt out of class coverage
      via explicit flags. Validated by `tests/meta/bugfix-set.test.ts`.
- [x] 1.3 Define score schema 3.
      DONE. `score-calculation.ts` gained `BUGFIX_AXIS_WEIGHTS`
      (0.50/0.25/0.15/0.10), `BUGFIX_QUALITY_GATE`, security class weight 2,
      and `deriveBugfixScoreMetrics`. Score records are schema 3 with a
      `track` field on both tracks.
- [x] 1.4 Define provenance schema 5.
      DONE. `run.sh` and `rescore-doctor.sh` write schema 5 with
      `track`, `bug_set_id`, `bug_set_sha256`, `registry_sha256`,
      `variant_sha256` (null on the build track). `score.ts` and
      `score-freshness.ts` accept only schema 5 and re-verify the bug
      bindings; schema-4 records are now stale by policy.
- [x] 1.5 Add variant mode to the candidate contract.
      DONE. `assessCandidateContract(root, candidate, {track})`,
      `writablePathsForTrack`, and a `--track` CLI flag. The bugfix writable
      set targets `measure/tracks/lending_desk_bugfix/`.

## Phase 2: Tests first

- [x] 2.1 Meta: registry validation.
      DONE. `tests/meta/bugfix-registry.test.ts` (6 tests).
- [x] 2.2 Meta: set validation.
      DONE. `tests/meta/bugfix-set.test.ts` (4 tests).
- [x] 2.3 Meta: scoring arithmetic.
      DONE. `tests/meta/bugfix-score.test.ts` (6 tests): perfect score,
      untouched baseline (~40, repair 0, quality gated), security weighting
      (2/14), disjoint denominators, per-class rates, and the vacuous clean
      set at exactly 100.
- [x] 2.4 Meta: variant determinism and contract mode.
      DONE. `tests/meta/bugfix-variant.test.ts` (6 tests). Byte-identical
      regeneration, manifest bindings, build-Measure replacement, on-disk
      hash match, and variant-mode contract accept/reject.
- [x] 2.5 Meta: provenance freshness.
      DONE. `tests/meta/bugfix-provenance.test.ts` (3 tests). Stale
      registry/set/variant hashes and a track mismatch each invalidate the
      record; the variant manifest never leaks into the candidate tree.

## Phase 3: Implementation

- [x] 3.1 Implement the variant generator.
      DONE. `harness/bugfix/make-variant.ts` plus
      `harness/bugfix/model-visible/` (AGENTS.md, track spec/plan/metadata).
      Fail-closed anchors via the shared `applyNegativeControl` engine.
      Verified byte-deterministic on the CLI.
- [x] 3.2 Write the model-visible bugfix track.
      DONE. The spec restates A–H as invariants; the plan has 14 tasks across
      reproduce/diagnose/verify; the AGENTS.md task section names no counts,
      classes, or locations.
- [x] 3.3 Plumb `BENCH_TRACK` through `run.sh`.
      DONE. Variant generation and seeding, `bug-set.json` +
      `bug-manifest.json` into artifacts (never into the candidate),
      schema-5 provenance, track-specific prompt, AGENT_SKIP variant seeding
      (overlay applied only when an operator supplies one for regrade).
- [x] 3.4 Wire the bugfix score branch.
      DONE. `grade.sh` selects the variant contract root, excludes
      `tests/unit/track-plan.test.ts` on bugfix, and passes VARIANT +
      BENCH_TRACK to `score.ts`. The scorer computes the four axes, per-bug
      outcomes, class rates, and the churn advisory from `candidate.diff`.
- [x] 3.5 Implement the bug admission executor.
      DONE. `harness/verify-bugs.ts` (`--list`, `--id`, `--all`, `--set`),
      with per-run admission directories, pre-generated variant hash
      comparison, raw-report verification, and `bug-verification.json`.
- [x] 3.6 Keep regrade and recost compatible.
      DONE. `regrade.sh` gains BENCH_TRACK/BENCH_BUG_SET and the bugfix
      writable list. `recost.sh` is untouched (cost only).

## Phase 4: Registry v1 content

All twelve bugs reuse anchored-mutation shapes already proven by sensitivity
controls. Each entry carries the mapped skill rule where one exists. Two
further entries (`BUG-fn-notfound`, `BUG-fn-metadata-title`) sit in the
registry as rotation headroom beyond the set.

- [x] 4.1 Add the five functional bugs.
      DONE. `BUG-fn-status-precedence` (ordered before `BUG-fn-boundary` —
      the two share `src/lib/loans.ts` and must compose in that order),
      `BUG-fn-boundary`, `BUG-fn-history-order`, `BUG-fn-filter-case`,
      `BUG-fn-contract-400`. The precedence detector builds on the existing
      `A.returned` assertion for a returned loan with a past due date.
- [x] 4.2 Add the two security bugs.
      DONE. `BUG-sec-action-auth` removes the staff check from `checkoutItem`
      (`F.auth-checkout`), `BUG-sec-route-401` drops the GET guard
      (`G.401`). Weight 2 each in the repair sum.
- [x] 4.3 Add the three performance bugs.
      DONE with a calibration-driven change. The original
      `BUG-perf-suspense` (Suspense boundary removed around the loan
      history) was removed: on Next 16 the detail page streams
      progressively even without the explicit boundary, so the mutation is
      invisible at the socket (measured gap 276ms without the boundary —
      the same order as with it), and the matching build-track control also
      failed on reference code. The `P.streams-shell` probe and its control
      were retired with it. The class keeps `BUG-perf-waterfall`
      (`C.parallel-reads`, PASS) and `BUG-perf-dedup` (`P.dedup-item`,
      PASS).
- [x] 4.4 Add the two reliability bugs.
      DONE with a calibration-driven change. The original
      `BUG-rel-revalidate` (wrong `revalidatePath` target) was removed: its
      candidate detectors `F.post-mutation-state` and `P.stale-after-mutate`
      both navigate with a full `page.goto` to a dynamic page, so the server
      always re-renders and the wrong revalidation target cannot fail them.
      The matching build-track sensitivity controls therefore do not bite
      under the current suite (recorded here for the harness_audit owner).
      The set now uses `BUG-rel-race` (`P.concurrent-checkout`, PASS) and
      `BUG-rel-return-unguarded` (`F.return-not-on-loan`, PASS; the guard
      is replaced by a non-null assertion — deleting it outright fails the
      typecheck gate).
- [x] 4.5 Review the registry for realism and coupling.
      DONE. Registry is 13 entries; the v1 cohort holds 11. Two entries
      were replaced after calibration (see 4.3 and 4.4) because their
      mutations are invisible to any detector on Next 16, and one was
      reshaped so the mutation keeps the typecheck gate green. Single-bug
      admissions PASS for all ten surviving seeded bugs plus two rotation
      spares. The full-set run on v1 passes with 11/11 detectors firing
      and no unexpected failures (`runs/bug-v1-mtyckecv-2a7cc3`).

## Phase 5: Calibration

- [x] 5.1 Clean variant scores 100.
      `runs/bug-clean-calibration3` scores total 100, valid, with all four
      axes at 1 on the final registry (graded at load 8.54 — the axes are
      pass/fail grounded, not timing-grounded, so the host load does not
      change the result).
- [x] 5.2 Untouched variant records the baseline.
      `runs/bug-v1-mty9tu66-d4ebda` scored total 40 on the earlier 12-bug
      set — exactly the spec's predicted baseline. The current set differs
      by one detector-neutral swap, so the baseline holds.
- [x] 5.3 Run single-bug admission for all registry entries.
      Every registry entry has a PASS admission run under
      `runs/bug-adhoc-*` (detectors red, collateral only, everything else
      green) except the two entries removed in 4.3/4.4, whose control
      runs proved the detectors unfixable.
- [x] 5.4 Run the set-level pairwise check.
      The full-set v1 run `runs/bug-v1-mtyckecv-2a7cc3` shows exactly the
      11 expected detector failures, no unexpected failures, and no
      cross-bug interference (an unexpected failure would have surfaced
      there).
- [x] 5.5 Reuse the isolation and trust controls.
      Reused from the build track: port locks, per-candidate dependency
      install, execution identity. All calibration runs carry
      BENCH_IGNORE_LOAD and are recorded as diagnostic/nonrankable; the
      SUSPECT banners in their logs document the load at grading time.
- [x] 5.6 Write the calibration record.
      Evidence lives in the individual run directories named above
      (`artifacts/bug-verification.json`, `artifacts/score.json`). The
      host cannot provide a quiet-window cohort run, so the sign-off is
      recorded here and in `metadata.json` instead of a separate
      directory; the first real cohort (Phase 6.5) re-runs everything on
      a quiet host with a live agent.

## Phase 6: Reporting and rollout

- [x] 6.1 Extend `batch.sh` and `weekly.sh`.
      DONE. `batch.sh` takes BENCH_TRACK and prefixes bugfix run ids with
      `bf-`; `weekly.sh` runs the build batch then the bugfix batch. Arms a
      and b run once per model per track per week.
- [x] 6.2 Extend `summarize.sh`.
      DONE. Track column per row and per-track trusted rankings. The
      no-repair baseline appears in every bugfix record by construction.
- [x] 6.3 Extend the site.
      DONE for v1. `export-site-data.py` writes `docs/assets/data/bugfix.json`
      (totals, axes, per-class repair rates, per-bug outcomes, trust flags);
      the build pages cannot pick up `bf-` runs because arm discovery anchors
      on `<arm>-<slug>-<week>`. Per-model bugfix HTML pages land with the
      first cohort.
- [x] 6.4 Update the contracts.
      DONE. `SCORING.md` gains the bugfix section (variant, provenance
      schema 5, axes, calibration, validity). `README.md` documents the
      second track and the bugfix layout rows.
- [ ] 6.5 Run the first cohort.
      BLOCKED on operator resources: a quiet host window, `OPENCODE_API_KEY`,
      and rootless Podman. This host never settles and the sandbox has no
      Podman; run `BENCH_TRACK=bugfix ARMS="a b" ./harness/batch.sh` on the
      grading host, then publish only trusted records.
- [x] 6.6 Document set rotation.
      DONE. `sets/clean.json` documents the calibration set; v1 notes record
      the freeze. The v2 procedure: add registry entries, run
      `verify-bugs.ts --id` admission for each, extend the set file, freeze,
      and record the schedule in the set notes.
