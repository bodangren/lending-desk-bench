# Benchmark v2 — validity, fixture r2, scoring rebalance

## Summary

An evaluation on 2026-09-24 found that the published data had two validity
defects and that one third of the checks did not separate models. This track
fixes the validity defects, starts fixture revision r2, moves score weight to
the areas that separate models, adds a contract-adherence axis, and adds new
checks. Two sibling tracks add new benchmark tracks: `tests_bench` and
`change_bench`.

Decisions from the owner (2026-09-24):

- The repository stays public. The answer-leak risk is accepted.
- Fixture r2 goes live with the next weekly batch. It starts a new cohort.
- The new weights apply now. All historical records are regraded and rescored.
- Both new tracks are built in full.

## Evidence

- 11 build records and all 29 bugfix records were graded with no Chromium
  binary. They were recorded as valid, with totals near 20 (build) and 49
  (bugfix).
- 12 w38 build records are invalid with "required local executable is
  unavailable". `cleanup.sh` drained `node_modules`, then an in-place regrade
  called `grade.sh` on the drained candidates.
- 19 build and 3 bugfix runs were rejected by the filesystem contract and never
  graded. Part of the cause is the `AGENTS.md` wording (see `tech-debt.md`).
- 21 of 71 checks pass on 28 or more of 29 real runs (A, B, the C filters, and
  three probes).
- Run-to-run and arm-to-arm differences of 10 to 87 points come from single
  failures, so one run per model and arm cannot rank the top group.
- `cron-weekly.sh` sets `BENCH_SELFCHECK=skip`.

## Functional requirements

### FR-1 — A missing browser invalidates the record

- `grade.sh` launches Chromium once before the gate. If the launch fails, the
  record is invalid with reason `browser unavailable`.
- After each Playwright pass, `grade.sh` reads the raw report. A
  `browserType.launch` error makes the record invalid.
- `score.ts` applies the same raw-report check, so a rescore of a historical
  no-browser record also gives an invalid record.

### FR-2 — Grading restores its own dependencies

- `grade.sh` copies `fixture/node_modules` into the candidate when the
  candidate has no `node_modules/.bin/next`. A drained candidate is regradable.

### FR-3 — Canary before each batch

- `batch.sh` grades the track's calibration candidate before any model run.
  The canary must be valid and score 100. Otherwise the batch stops with exit 3.
- Calibration candidates: build = reference overlay; bugfix = clean set;
  tests = oracle test suite; change = change reference overlay.
- `BENCH_CANARY=0` skips the canary and prints a warning.

### FR-4 — The self-check runs on the production host

- `BENCH_SELFCHECK` accepts `logic`: the meta suite without the Podman
  isolation tests (`npm run test:meta:logic`), plus no controls.
- `cron-weekly.sh` uses `logic` by default.

### FR-5 — Repeated runs

- `batch.sh` reads `REPS` per track: `REPS_BUILD` (default 3), `REPS_BUGFIX`,
  `REPS_TESTS`, and `REPS_CHANGE` (default 1). `REPS` overrides all tracks.
- Every repeat has the run ID suffix `-r<N>`, also when the track has one rep,
  so that the export parses one ID form. Historical IDs without a suffix stay
  valid and count as `r1`.

### FR-6 — Fixture revision r2

- `fixture/AGENTS.md` states: "Do not add, rename, change, or remove any
  exported symbol or type signature." The definition of done states: "Every
  acceptance criterion in `spec.md` is met. Do not edit `spec.md`."
- `fixture/measure/tracks/lending_desk/spec.md` gains two E checkboxes:
  accessible labels on the checkout inputs, and error messages announced to
  assistive technology. The plan task list does not change, so M.closeout
  stays comparable.
- A protected, grader-only route `app/api/bench-state/route.ts` reads and
  changes the store. It answers 404 unless the server has `BENCH_STATE_KEY`
  and the request sends that key. The E and F browser tests read and set up
  state through this route, not through the candidate's API.
- `fixture/package.json` adds pinned `vitest` as a dev dependency, for the
  tests track.
- `harness/revisions.ts` declares `FIXTURE_REVISION = 2`. Provenance and score
  records carry `fixture_revision`.

### FR-7 — New checks for r2

Criteria (spec-stated):

- `E.labels` (Tier 1): the member selector and the due-date input have
  accessible names.
- `E.error-announced` (Tier 2): a rejected checkout or return error appears in
  an element with `role="alert"` or an `aria-live` region.

Probes (hidden):

- `P.auth-before-parse` (Tier 0): a non-staff POST with a malformed JSON body
  gets 401.
- `P.malformed-json` (Tier 1): a staff POST or PATCH with a malformed JSON body
  gets 400, not 500.
- `P.action-race` (Tier 1): two simultaneous checkouts of one item through the
  UI record one loan, and the other page shows "Item is already on loan".
- `P.retry-after-error` (Tier 2): after a rejected checkout, a corrected
  resubmit records the loan and clears the error.
- `P.axe-clean` (Tier 2): axe-core finds no serious or critical violations of
  the naming, label, and ARIA rules on `/items` and on one detail page.

Every new ID gets a sensitivity control, a spec-matrix row where it is
spec-stated, and a reference implementation that passes it.

### FR-8 — Contract adherence axis

- The candidate contract splits reasons into hard and soft classes.
  Hard: symlinks, special entries, nested runtime directories, `.git`.
  Soft: added files, missing files, protected edits, public-surface changes,
  TypeScript suppressions.
- A hard violation stays invalid. A soft violation no longer invalidates the
  run. `run.sh` writes `contract-violation.json`, then grafts the writable
  files onto a fresh comparison tree. Added files and protected edits do not
  reach the grader. The graft is graded.
- `adherence = 0.5 × contract + 0.5 × closeout` on the build track, where
  `contract = max(0, 1 − 0.5 × soft classes)` and `closeout` is the pass rate
  of the three M.* criteria. On the other tracks, `adherence = contract`.
- M.* criteria leave the completion axis and feed adherence only.

### FR-9 — Rebalanced weights

- Build: completion 0.55, adversarial 0.20, adherence 0.15, quality 0.10.
- Bugfix: repair 0.45, regression 0.20, robustness 0.15, adherence 0.10,
  quality 0.10.
- Criteria carry a weight. The 17 saturated criteria (A.*, B.*, C.renders,
  C.renders-all, C.filter-*, C.empty) weigh 0.25. All other criteria weigh 1.
  Tier rates stay count-based, so the soft tier gate does not change.

### FR-10 — Historical regrade

- `harness/regrade-run.sh <run-id>` grafts the run's writable files onto the
  current comparison tree, restores `node_modules`, writes schema-6 provenance
  with a `graft` block, resolves the executor from the run's own record, and
  calls `grade.sh`. The previous artifacts move to `artifacts/prev-<stamp>/`.
- `harness/regrade-all.sh` regrades every agent run of the given weeks and
  tracks, one at a time.
- Runs with no agent output stay invalid.

### FR-11 — Reporting

- The export groups repeats: the row total is the median of the week's valid
  repeats, and the row also shows the worst repeat and the repeat count.
- The export calculates one paired Skills delta per week: the mean of
  `median(B) − median(A)` over models with both arms, plus the count of models
  that improve.
- Records carry `fixture_revision`. The site labels the cohort.
- A tracks page shows the bugfix, tests, and change tracks.

### FR-12 — Executor attestation for rescoring

- `rescore-doctor.sh` and `regrade-run.sh` set `BENCH_PI_ROOT` from the run's
  recorded Pi path when that binary still has the recorded hash. The ambient
  value is used only for new runs.

## Acceptance criteria

- [ ] FR-1: a grade with a missing Chromium path gives `valid: false`.
- [ ] FR-2: a drained candidate regrades to a valid record.
- [ ] FR-3: each track's canary scores 100 on this host.
- [ ] FR-4: `BENCH_SELFCHECK=logic` passes on this host.
- [ ] FR-5: run IDs carry `-r<N>`; the export reads both ID forms.
- [ ] FR-6/7: the reference overlay scores 100 under r2; every new control
      fails its target and nothing outside declared collateral.
- [ ] FR-8: a candidate with an added file and a protected edit is graded, and
      its adherence is below 1.
- [ ] FR-9: meta tests verify the new arithmetic on synthetic results.
- [ ] FR-10: every historical agent run is regraded or stays invalid with a
      stated reason.
- [ ] FR-11: the site shows repeat statistics, the paired delta, and cohorts.

## Out of scope

- Private repository or network egress blocking (owner decision).
- LLM-judged quality.

## Risks

| Risk | Mitigation |
|---|---|
| A new check grades reference incidentals | The reference-variant must score 100 (`reference-variant/`) |
| The regrade takes many hours on a 4-CPU host | Run it in the background, one run at a time, before the Sunday cron |
| Weekly batch length grows with repeats and four tracks | Repeats default to 3 on the build track only |
