# Implementation plan — harness audit

Order follows blast radius. Phase 1 makes the harness able to catch this defect class.
Phase 2 removes the defects that decide the ranking today. Later phases are cleanup.

Do not regrade after a change. The benchmark runs weekly across all qualifying models.

---

## Phase 1: Make the self-checks run

Nothing in phases 2 to 5 stays fixed unless this phase lands first.

- [x] 1.1 Add `npm run test:meta` to `grade.sh`, or to a pre-batch step in `batch.sh`.
      DONE. `batch.sh` now runs a self-check before the model loop. `BENCH_SELFCHECK`
      takes meta (default), full, or skip. A failure exits 3 and grades nothing.
      Verified: 121 of 121 meta tests pass.
- [x] 1.2 Add a `verify-controls` step that runs before a batch.
      DONE, NOT EXERCISED. The same self-check runs `verify-controls.ts --fast` by
      default and `--all` under `BENCH_SELFCHECK=full`. The verifier already exits 1
      when a control fails. The step itself has not run yet: each control costs one
      graded run, so it needs a quiet host.
- [x] 1.3 Add the reverse meta check for FR-5.16.
      DONE and VALIDATED. `M.criteria-provenance` in `tests/meta/spec-matrix.test.ts`,
      with the allow list `UNMAPPED_CRITERIA` in `tests/meta/spec-matrix-contract.ts`.
      Each of the 9 allowed ids names the checkbox it derives from. The test also
      rejects a stale or shadowing allow-list entry.
      On its first run it flagged exactly one orphan: `C.summary`. That is the defect
      the check was written to catch, so the check works.
- [x] 1.4 Decide `NEGATIVE_CONTROLS` (FR-1.4).
      DONE — kept, with the record corrected. The audit called the whole module dead.
      Only the array is unused outside its meta test; `applyNegativeControl` is the
      mutation engine every sensitivity control runs through (`verify-controls.ts:268`).
      Deleting the array would remove the only regression test of that engine, so the
      module now carries a comment saying it is an engine fixture and grades no
      candidate.
- [ ] 1.5 Add a second correct implementation under `reference-variant/` that differs in
      every incidental choice: `datetime-local`, no placeholder option, a different card
      element order, a wrapped `<h1>`. Grade it in CI. It must score 100. This is the
      only mechanism that catches a reference-coupled criterion before a model does.

## Phase 2: The defects that decide the ranking

- [x] 2.1 Accept any correct due-date input type (FR-2.3).
      DONE. `tests/e2e/detail.spec.ts` has `dueDateInput()` and `fillDueDate()`. All 11
      `fill()` sites and the `toHaveCount(1)` assertion use them, and the helper fills
      `2026-04-30T00:00` for a `datetime-local` input.
      Verified by `playwright test --list`: the file parses and all 26 tests are still
      declared. `tsc --noEmit` was denied by the sandbox, so no type check has run.
      Backup of the original: `scratchpad/detail.spec.ts.bak`.
- [x] 2.2 Delete `C.summary` (FR-2.1).
      DONE. Removed from `tests/e2e/catalogue.spec.ts`, `tests/criteria.ts`, and
      `tests/sensitivity-controls.ts`. `CRITERIA` now holds 61 ids.
      The historical records under `docs/assets/data/` still name it. That is correct:
      they record what happened. The site regenerates on the next batch.
- [x] 2.3 Loosen `E.member-options` (FR-2.2) and close FR-5.10.
      DONE. The test polls the option texts, keeps the five seeded member names, sorts
      them, and compares. A placeholder option of any wording is ignored, and the
      option order no longer matters.
      The sensitivity control still bites: it replaces `{m.name}` with `{m.id}`, so
      every member name leaves the page.
- [x] 2.4 Compare `dueAt` as an instant (FR-2.4).
      DONE. `onDueDate()` accepts any instant inside the UTC day, and `expectDueOn()`
      applies it in `F.checkout-record` and `F.lifecycle`. The exact `borrowedAt`
      assertion is unchanged, so the control that mutates `borrowedAt` still bites.
- [x] 2.5 Give `P.streams-shell` a marker only the history can produce (FR-2.5).
      DONE. The probe now reads `/items/itm-017` instead of `/items/itm-018`. itm-017
      carries an open loan, so spec D forbids `CheckoutForm` and no member `<option>`
      exists on the page. The marker is "Bruno Silva", who holds only the returned loan
      lon-009, so the name can come from a history row alone.
      The heading pattern was loosened in the same edit, which closes FR-5.4.
      The control was retargeted to the new marker. Its mechanism is still weak — it
      renames the fallback rather than removing the boundary. See task 5.17.

## Phase 3: Stop charging one defect twice

- [x] 3.1 `E.return-error` (FR-4.1). DONE. The "Not authorized" assertion runs first,
      so an E.8 defect can no longer take the E.9 point. The `exact: true` availability
      check is gone; the revert is read from structure (the Return control returns and
      the store still holds an open loan). The control still bites: it removes the
      error paragraph, so the first assertion fails.
- [x] 3.2 `E.submits` (FR-4.2). DONE. The store poll runs before the badge assertion.
      E.2 is a question about `checkoutItem`, and `E.optimistic` already grades the
      badge. The control still bites: it makes `checkoutItem` return an error.
- [x] 3.3 `D.history-status` element matching (FR-4.3). DONE. `getByText(/returned/i)`
      and `getByText(/\bok\b/i)` test each element's own text, so an inline row that
      reads "Bruno Silvareturned" in `innerText` now passes. "overdue" was already
      tolerant and is now written the same way. The control still bites: it renders
      every status as "ok", so /returned/i finds nothing.
- [x] 3.4 `D.history-status` race (FR-4.4). DONE by the same edit: the locators
      retry, which the single `innerText` read did not.
- [x] 3.5 Remove `P.no-waterfall` (FR-4.5). DONE. Deleted from `probes.spec.ts`,
      `criteria.ts`, `spec-matrix-contract.ts`, and both control entries. `PROBES` now
      holds 11 ids, so the adversarial denominator drops by one. Retargeting was
      rejected: the only other read pair on /items runs in two render phases, so it
      would not overlap even for correct code.

## Phase 4: Publication and the quality axis

- [x] 4.1 Stop publishing untrusted records (FR-3.1). DONE by marking, not gating: 0 of
      28 records is publishable, so a gate would publish an empty site.
      `export-site-data.py` now carries `trust` per model (valid, trusted, publishable,
      rankable, under_load). `results.html` prints an "unranked" tag under any total
      whose record is not rankable, with the reason in the tooltip. The scoring note no
      longer hard-codes "Week 2026w35"; it explains the tag.
      Verified: the exporter emits trust for all 12 models, 0 rankable, and both page
      scripts pass `node --check`.
- [x] 4.2 Decide the quality axis (FR-1.3). DONE — kept and integrated.
      Measured first: `source-signals.ts` raises at least one diagnostic on 9 of the 19
      valid candidates, range 0 to 3 (unused-import, explicit-any, eslint-disable,
      console-statement). react-doctor raises 0 on all of them, so this is the axis's
      only resolution. Wired into `doctor.ts`; `reference/doctor.json` regenerated and
      still 0, as a clean reference should be. `errors`/`warnings` now count the merged
      list, because react-doctor's own summary is 0 and would have hidden every signal.
      Step B applied in `score-calculation.ts`:
      `quality = softTiercale(completion, QUALITY_GATE) × max(0, 1 − penalty/PENALTY_FULL)`
      with `QUALITY_GATE = 0.6`. `SCORING.md` updated.

      OPEN CALIBRATION DECISION — needs your call, because it reorders the table.
      `PENALTY_FULL` is still 30, tuned for react-doctor's output volume. The largest
      penalty any candidate now earns is 1.5, so quality spans 0.950 to 1.000 and the
      axis stays nearly flat. Recomputed over the 19 valid runs:

        PENALTY_FULL=30  quality 0.950-1.000  total spread 28.4   4/19 positions move
        PENALTY_FULL=10  quality 0.850-1.000  total spread 29.0   7/19 positions move
        PENALTY_FULL=5   quality 0.700-1.000  total spread 30.0  12/19 positions move
        PENALTY_FULL=3   quality 0.500-1.000  total spread 31.4  13/19 positions move
        old formula      quality 0.626-0.935  total spread 34.2

      Note the old spread was widest only because quality copied completion. Every score
      rises under the new formula, most for the weakest candidates (+7.3) and least for
      the strongest (+1.0). That is the double-count being removed, but it compresses
      the scale. Lowering `PENALTY_FULL` restores discrimination honestly. I did not
      change it, because reordering up to 13 of 19 positions is your decision.
- [x] 4.3 "Uncached input" and cache hit. DONE. The results table header is now
      "Uncached input" with a tooltip saying cache reads are counted separately and
      providers split the two differently. The cache-hit column already existed there.
      The per-model pages had neither: they now show "Uncached input" and a "Cache hit"
      stat, using the existing `cacheHitRate` helper. Both regenerated and syntax
      checked.

## Phase 5: Cleanup

- [x] 5.1 `C.parallel-reads` (FR-5.1). DONE. Falls back to `listItems` when no
      `countItems` call is traced. `countItems` is still preferred, so the control
      behaves exactly as before on the reference.
- [x] 5.2 `B.badge` (FR-5.2). DONE. Selects the card by `a[href="/items/itm-013"]`,
      so the card content may appear in any order.
- [x] 5.3 Heading patterns (FR-5.3, FR-5.4). DONE. Both use
      `/<h1[^>]*>[\s\S]{0,200}?…/`, so a wrapped heading matches. `H.loading` also
      guards the `search(/<h1/)` result: it returned -1 when the prefix held no h1,
      and `slice(-1)` then counted the last character and blamed the tiles.
- [x] 5.4 `P.stale-after-mutate` tier (FR-5.5). DONE. Tier 0 to Tier 1, which matches
      every prerequisite it depends on.
- [x] 5.5 `G.401` (FR-5.6). DONE. The unauthorized probes now write to itm-015 (free)
      and itm-010 (open loan lon-003). Neither appears in any other test, so a missing
      staff check costs this criterion alone.
- [x] 5.6 Measure markers (FR-5.7, FR-5.8). DONE and VERIFIED. A `planTasks()` helper
      parses `-`, `*` or `+` bullets and either marker case. `M.plan-complete` now
      requires all 24 tasks to be present first, so an emptied plan.md fails instead of
      passing. `M.closeout` compares task text only.
      Checked against three real candidates: the two that failed still fail for the same
      reason, and `b-glm-5-3-flash`, which passed, still passes all 8.
- [x] 5.7 `M.metadata-valid` (FR-5.9). DONE. Kept as a corruption check. It also
      accepts an absent `actual_tasks`, which the untouched fixture has, and leaves the
      closeout values to `M.closeout`.
- [x] 5.8 Unscoped locators (FR-5.11). DONE. All 11 `selectOption` call sites use
      `.first()`. The date input was already scoped by `dueDateInput()`.
- [x] 5.9 `F.future-due-date` (FR-5.12). DONE. Fills 2026-03-14, which is in the past
      under every date-to-instant convention.
- [x] 5.10 `P.no-key-leak` (FR-5.13). DONE. Both pages must answer 2xx and render the
      item name before the negative assertions run, so a 500 no longer earns the probe.
- [x] 5.11 `G.patch409` (FR-5.14). DONE. It closes itm-007 (open loan lon-002) itself
      and PATCHes it again, instead of relying on `G.patch200` having closed itm-027
      earlier in the file. itm-007 is untouched elsewhere, and `G.filter-overdue` runs
      before this test.
- [x] 5.12 `G.get200` (FR-5.15). DONE. Compares against `seedLoans.length` rather than
      a lower bound of 19, and checks the full field set of the first record.
- [x] 5.13 Import `NOW` from the seed (FR-5.17). DONE and VERIFIED. Both suites import
      from `@candidate/src/db/seed`. Checked by running the unit suite against a real
      candidate tree (`runs/a-deepseek-v4-flash-2026w35/candidate`): the import
      resolves and the A criteria pass. It does not resolve against `reference/` alone,
      because that tree holds only the writable files.
- [x] 5.14 Detect the checkout form by a spec-named part (FR-5.18). DONE for the
      presence assertions: `D.form-hidden` and `D.return-visible` use a `checkoutForm()`
      helper built on the member selector, which E.1 states.
      The click sites still match `/check ?out/i`, because a click needs a button and
      no checkbox names one. The pattern tolerates case and an optional space, and 0 of
      19 runs failed on it, so the remaining exposure is latent.
- [x] 5.15 Matrix labels (FR-5.19). DONE. Both rows now read "optimistic update"
      instead of "optimistic update and rollback", which is what the primary tests run.
      The rollback stays graded under E.5 and E.9.
- [x] 5.16 Reduce the section G dependency (FR-5.20). DONE in part. `loansFor`,
      `loanCount` and `openLoanCount` now read the unfiltered GET and select in the
      test, so the four Tier 0 F criteria no longer depend on `G.filter-item` (Tier 1).
      They still depend on checkbox G.1, which is the unfiltered GET itself, and
      `createOpenLoan` still depends on `G.post201`. Removing those needs UI-driven
      setup, which is a larger change than the latent risk justifies: 0 of 19 runs was
      affected.
- [x] 5.17 Strengthen the `P.streams-shell` control. DONE. It now replaces the whole
      `<Suspense>` wrapper with a bare `<LoanHistory />`, so the history read blocks the
      shell and both marks land together. Anchor confirmed present in `reference/`.

## Phase 6: Approved earlier, not started

- [ ] 6.1 Make the repository private, or publish `docs/` separately. `reference/` and
      `harness/tests/` are public and the container has open egress.
- [x] 6.2 Flush-order assertions. DONE. `_stream.ts` records the chunk ordinal at which
      each marker first appears, alongside the millisecond mark. `H.loading` and
      `P.streams-shell` now assert the content chunk is later than the shell chunk,
      instead of a 100ms gap.
      The old threshold was a third of the injected `BENCH_LATENCY_MS`, so it moved with
      that setting, with host load, and with any caching a candidate added. For
      `P.streams-shell` the measured deltas were -4ms to 0ms even when the boundary was
      genuinely absent, because the inlined RSC payload can precede the HTML that
      consumes it. The chunk ordinal answers the real question.
- [ ] 6.3 Grade contract violators instead of invalidating them, and flag the violation.
      5 of the invalid runs come from the all-or-nothing filesystem contract.
- [ ] 6.4 Set `REPS=3`.
