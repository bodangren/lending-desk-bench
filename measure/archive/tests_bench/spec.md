# Test-writing benchmark — lending_desk_tests

## Summary

Add a third benchmark track that measures whether a model can write tests that
find defects. The model receives the complete, correct application and writes
tests only. The grader runs those tests against the correct application, a
second correct implementation, and a frozen set of defective versions
(mutants). A good suite passes on both correct applications and fails on the
mutants.

The track reuses the isolation, arms, provenance, bug registry, sensitivity
controls, and scoring machinery.

## Definitions

- **Clean app.** The r2 fixture with the `reference/` overlay.
- **Variant app.** The r2 fixture with the `reference-variant/` overlay: a second
  correct implementation that differs in every incidental choice.
- **Mutant.** The clean app with one registry bug or one sensitivity control
  applied.
- **Mutant set.** A frozen, versioned list of mutants (`harness/tests-track/sets/`).
- **Valid test.** A test that passes twice on the clean app and once on the
  variant app.
- **Kill.** A mutant is killed when at least one valid test fails on it.

## Functional requirements

### FR-1 — Mutant set

- `harness/tests-track/sets/<id>.json` lists mutant IDs. Each ID is a registry
  bug ID or a sensitivity control ID.
- A mutant is admitted only when it is observable over HTTP or by a direct
  import of `src/lib/loans.ts`. Browser-only behavior (optimistic UI, pending
  labels) and trace-only behavior (waterfalls, deduplication) are excluded.
- Admission proof: the harness oracle suite (`harness/tests-track/oracle-overlay/tests/`),
  graded as a candidate, passes on the clean app and on the variant app, and fails on
  every mutant. It is the track's weekly canary.
- Set `m1` holds 12 mutants: 7 functional, 3 security, 2 reliability.
  `BUG-fn-notfound` was left out: behind the `/items` loading boundary the not-found
  page streams with status 200, and plain HTTP sees it only as a `noindex` tag.

### FR-2 — Variant tree (model-visible)

- The candidate starts from the clean app.
- `measure/tracks/lending_desk/` is replaced by
  `measure/tracks/lending_desk_tests/` (`spec.md`, `plan.md`, `metadata.json`).
- `AGENTS.md` is the tests version. `package.json` gains a `test` script, and
  `vitest.config.mts` is added. Both are protected.
- The spec states the application behavior (the build spec A–H as facts), how
  to start the app, the `BASE_URL` and staff-key conventions, and that the
  grader runs the tests against correct and defective versions. It states no
  mutant, count, or class.

### FR-3 — Candidate contract (tests mode)

- Writable: new files under `tests/` that end in `.test.ts`, at most 20 files
  and 200 KB in total, plus the track's `plan.md` and `metadata.json`.
- Every application file is protected.
- The soft and hard violation classes of `bench_v2` FR-8 apply.

### FR-4 — Grading

1. Gate: `npm run typecheck` and `npm run build` on the candidate.
2. Run the candidate suite twice against the clean app, once against the
   variant app, and once against each mutant. Each run gets a fresh server with
   the fixed clock.
3. Mutant and variant apps are built once per cohort and cached by content
   hash under `runs/.tests-track-cache/`. A run copies the candidate `tests/`
   into a fresh copy of each cached app.
4. `tests-results.json` records per-test outcomes for every app.

### FR-5 — Scoring

```text
kill      = Σ(killed × weight) / Σ(weight), weight 2 for security, 1 otherwise
validity  = valid tests / all tests (0 when the suite has no test)
adherence = contract (bench_v2 FR-8)
quality   = soft-scaled on kill at 0.6, times the doctor penalty
total     = round1(100 × (0.60 × kill + 0.20 × validity
                          + 0.10 × adherence + 0.10 × quality))
```

- A suite with no valid test scores kill 0.
- A test that fails on the variant app is brittle. It is excluded from kills
  and lowers validity. This defeats source hashing and full-page snapshots.

### FR-6 — Provenance and calibration

- Provenance binds `track: "tests"`, `mutant_set_id`, `mutant_set_sha256`, and
  the variant tree hash.
- Calibration: the oracle suite, graded as a candidate, scores 100. An empty
  suite scores kill 0.

## Acceptance criteria

- [ ] FR-1: every mutant in `m1` passes admission.
- [ ] FR-2: no model-visible file names a mutant.
- [ ] FR-3: the contract accepts new test files and rejects an app edit as soft.
- [ ] FR-4: `grade.sh` grades the track end to end.
- [ ] FR-5: meta tests verify the arithmetic on synthetic results.
- [ ] FR-6: the oracle canary scores 100.

## Out of scope

- Browser tests written by the model. The fixture has no Playwright.
- Coverage metrics.

## Risks

| Risk | Mitigation |
|---|---|
| Model test code runs on the host during grading | Same risk class as candidate app code today; accepted |
| Flaky tests produce false kills | Two clean runs; a test must pass both |
| Grading time grows with the mutant count | Cached mutant builds; one server start per app |
