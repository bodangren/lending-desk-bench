# Rigorous A–H criteria with mutation-based admission

## Summary

The build track does not separate models on product quality. This track
designs a stricter criterion set for spec sections A–H. A new criterion
enters the set only when it kills a registered mutant that the current suite
does not kill. A pilot must show that the new set separates at least three
models. Until the pilot passes, no published score changes. A second
saturated suite must not ship.

Spec format: classic FR list. Track type: feature. Base commit: `f4712c6`.

## Evidence

These measurements come from the 8 most recent build runs: 4 models, 2 arms
each, week 2026w43, OpenCode executor. They were verified before this track
started. This track does not derive them again.

- The build track scores 78 checks: 60 A–H criteria, 3 adherence criteria
  (`M.*`), and 15 probes (`P.*`).
- All 60 A–H criteria pass in all 8 runs. The completion axis is 1.0 for
  every model.
- Only one probe fires: `P.dedup-item`. It fires in all 8 runs, so it
  discriminates nothing. The other 14 probes pass in all 8 runs.
- Every published score difference comes from the 3 `M.*` criteria. These
  criteria grade process files, not the product.
- Completion carries 0.55 of the total (`AXIS_WEIGHTS` in
  `harness/score-calculation.ts`). It gives the same 55 points to every model.
  It follows that the adversarial axis gives about 18.7 points to every model.

Machine-readable surfaces that this design uses:

| Surface | Use in this track |
|---|---|
| `harness/tests/criteria.ts` | Baseline ids, tiers, `since`, `SATURATED_WEIGHT = 0.25` |
| `harness/tests/spec-matrix.ts` | The 54 checkbox ids `A.1`–`H.2` |
| `harness/tests/negative-controls.ts` | `applyNegativeControl`, the anchored mutation engine |
| `harness/bugfix/registry.ts` | Bug shape and `validateRegistry`; port target for set `v2` |
| `harness/tests-track/sets/m1.json` | 12 tests-track mutants; port target for set `m2` |
| `harness/tests/e2e/*.spec.ts`, `harness/tests/api/*.test.ts`, `harness/tests/unit/*.test.ts` | Baseline graders; survivor analysis |
| `harness/score-calculation.ts` | `AXIS_WEIGHTS` and the axis formulas |
| `fixture/measure/tracks/lending_desk/spec.md` | Sections A–H: the model-visible facts |

## Definitions

| Term | Meaning |
|---|---|
| Check | One scored test id: a criterion or a probe. |
| Baseline suite | The 78 checks of `CRITERIA` and `PROBES` at the base commit. |
| Rigor criterion | A new spec-stated criterion of this track. Its id has the form `R.<section>.<slug>`. |
| Rigor suite | The graders of the rigor criteria. |
| Oracle suite | The baseline suite plus the rigor suite. |
| Clean app | `fixture/` with the `reference/` overlay. |
| Variant app | `fixture/` with the `reference-variant/` overlay. |
| Mutant | The clean app with one anchored source mutation in one file. Its id has the form `RM-<section>-<slug>`. |
| Grade | One run of the gate and one suite against one app on a fresh server. |
| Kill | Check `c` kills mutant `m` when `c` passes on the clean app in 2 of 2 grades and on the variant app in 1 of 1 grade, and `c` fails on `m` in 2 of 2 grades. |
| Baseline survivor | A mutant that passes the gate and that no baseline check kills. |
| Unique kill | A kill of a baseline survivor. |
| Dev pool | The registered mutants that the Red and Green roles can read. |
| Held-out pool | The registered mutants that the Red and Green roles do not see before task 3.6. |
| Pilot | The two-stage measurement of FR-7. |
| Monitor | The saturation monitor of FR-8. |

## Functional requirements

### FR-1 — Rigor criteria registry

- Each rigor criterion records: id, tier, section, checkbox (a spec matrix
  id such as `A.2`), the quoted spec words, `requires`, `items`, `since`, and
  `ports`.
- The quoted words are an exact substring of
  `fixture/measure/tracks/lending_desk/spec.md`. Review A confirms that the
  words entail the assertion.
- `requires` lists baseline criteria. A rigor pass counts only when each
  listed criterion also passes. This rule stops a vacuous pass: a route that
  answers 400 to every request cannot earn `R.G.post400-each-field`.
- `items` lists the seed items that the grader changes. The `items` lists of
  two rigor criteria do not overlap.
- A grader tests behavior. It does not read the candidate source text.
- A grader uses only spec text of fixture revision r1 or r2. `since` is 2
  only for criteria under checkboxes `E.10` and `E.11`.
- The rigor suite runs in its own pass, on its own server boot with a fresh
  seed. The browser graders prepare and read state through the protected
  route `app/api/bench-state`, as the baseline E and F graders do.
- An action layer imports `src/actions/loans.ts` under Vitest. It mocks
  `next/headers` and `next/cache`. It grades F boundaries that the date input
  cannot reach, for example a due date equal to now. Task 1.5 proves this
  layer on the clean app and the variant app before Red depends on it.

### FR-2 — Coverage matrix

- The matrix has one row for each of the 54 checkboxes of the fixture spec.
  The row ids equal the `SPEC_MATRIX` ids.
- A row lists the rigor criteria, the dev mutants, and the held-out mutants.
  A row with no rigor criterion records an exemption and its reason.
- An exemption states why fixture r2 allows no stricter observable assertion.
  Review A accepts or rejects each exemption.
- Section targets are minimums:

| Section | Checkboxes | Baseline criteria | Candidate criteria (below) | Min dev mutants | Min held-out mutants | Min admitted criteria |
|---|---|---|---|---|---|---|
| A | 5 | 5 | 4 | 6 | 2 | 3 |
| B | 4 | 5 | 2 | 2 | 1 | 1 |
| C | 7 | 8 | 3 | 4 | 1 | 2 |
| D | 6 | 7 | 4 | 4 | 1 | 2 |
| E | 11 | 11 | 1 | 1 | 1 | 1 |
| F | 7 | 9 | 5 | 6 | 2 | 3 |
| G | 12 | 13 | 5 | 6 | 2 | 3 |
| H | 2 | 2 | 2 | 2 | 1 | 1 |
| Total | 54 | 60 | 26 | 31 | 11 | 16 |

- A section that misses a minimum blocks admission. Only an owner waiver
  with a stated reason removes the block. The matrix records each waiver.
- The targets follow the observed gaps of the baseline. Section E has a low
  target because the baseline already grades its pending, optimistic,
  error, and label states at their observable limits.

### FR-3 — Mutant registry and pools

- Each mutant records these fields:
  - id, section, and class (`functional`, `security`, `performance`, or
    `reliability`);
  - one target file, and anchored replacements over the clean app;
  - the violated checkbox, with its quoted words;
  - `source`, a realism note, and the pool (`dev` or `held-out`).
- `source` is `observed` with the run ids of stored candidates that show the
  same deviation, or `operator` for a classic mutation operator.
- The registry admits a mutant only when all of these are true:
  1. The mutant passes `npm run typecheck` and `npm run build`.
  2. The mutant violates the quoted spec words.
  3. The violation is observable under fixture r2 through HTTP, the browser,
     or a direct import.
- An equivalent mutant is a mutant that no check can observe under the
  fixture state. The registry rejects it and records the reason. Example: a
  history sorted by loan id gives the `borrowedAt` order for every seed item
  and for every loan that a grader can create.
- The executor proves survival (FR-6). The registry never assumes it.
- The adversarial-testing role writes the held-out pool before Red writes
  any criterion (task 1.7). The file stays outside the repository until task
  3.6. The plan records its sha256 at authoring time.
- The kill-matrix report counts `observed` and `operator` mutants for each
  section.

### FR-4 — Admission rule

The rule is falsifiable. A rigor criterion `c` is admitted only when all of
these are true:

1. **Canary.** `c` passes on the clean app in 2 of 2 grades and on the
   variant app in 1 of 1 grade.
2. **Unique kill.** `c` kills at least one dev mutant that no baseline check
   kills. In set terms: `K(c) \ K(B) ≠ ∅`. `K(x)` is the set of mutants that
   `x` kills. `K(B)` is the union of `K(b)` over the baseline checks `b`.
3. **Spec trace.** The quoted words of `c` are a substring of the fixture
   spec, and Review A confirms the entailment.
4. **Non-redundancy.** No other admitted rigor criterion has the same
   unique-kill set. When two sets are equal, the registry keeps the criterion
   with the fewer `items`, then the lower id.
5. **Live on arrival.** In pilot stage 1, `c` passes on at least one
   candidate and fails on at least one candidate. An owner waiver can keep a
   criterion that fails on every candidate. A criterion that passes on every
   candidate is rejected: it is saturated on arrival.

The set is admitted only when all of these are true:

6. Each section meets its minimum admitted count, or has an owner waiver.
7. The admitted set kills at least 60% of the held-out baseline survivors.
   With zero held-out survivors, the result is `insufficient`, not a pass.
8. The pilot passes (FR-7).

The executor prints one labeled line for each candidate criterion:

```text
RIGOR.ADMIT id=<id> canary=<pass|fail> unique_kills=<n> redundant_with=<id|none> live=<yes|no|waived> verdict=<admit|reject>
```

A line with `verdict=admit` and `canary=fail`, `unique_kills=0`, or
`live=no` is a defect in the executor.

### FR-5 — Canary

- The oracle suite passes on the clean app in 2 of 2 grades and on the
  variant app in 1 of 1 grade. Under the new formula, both apps score 100.
- The executor runs the canary first. A canary failure stops the executor
  with exit code 3, as in `batch.sh`.
- A rigor criterion that fails on the variant app grades an incidental choice
  of the reference. The criterion is rejected. The variant stays unchanged.
- After activation, the weekly build canary grades the clean app and the
  variant app (owner decision D4). The bugfix clean set, the change reference,
  and the tests-track oracle continue to score 100.

### FR-6 — Mutation executor

- The executor is `harness/rigor/verify-rigor.ts` (task 1.3 confirms the
  path). Its modes are `--canary`, `--baseline`, `--rigor`, and `--heldout`.
- For each mutant, the executor copies the clean app to a fresh directory.
  It applies one mutation with `applyNegativeControl`. Then it runs the gate
  and 2 grades of the selected suite.
- A check whose outcome differs between the 2 grades of one app is flaky on
  that app. A flaky outcome never counts as a kill. A criterion that is flaky
  on the clean app or the variant app is rejected.
- The executor writes `reports/rigor/<stamp>/kill-matrix.json` (checks ×
  mutants × grades) and `admission.json`. It prints the labeled lines
  `RIGOR.CANARY`, `RIGOR.BASELINE`, `RIGOR.ADMIT`, `RIGOR.SECTION`,
  `RIGOR.HELDOUT`, and one summary line for each mode.
- The executor grades each app through `run.sh` with `AGENT_SKIP=1`, as
  `harness/verify-controls.ts` does. It creates only new run directories
  with the prefix `rigor-`. Their records carry the overlay calibration
  identity, so they never become ranked results.
- The executor never writes `reference/`, `reference-variant/`, or
  `fixture/`, and never changes an existing run directory. It compares the
  tree hashes before and after each mode, as `harness/protected-tree.ts`
  does.

### FR-7 — Pilot

**Stage 1 — screen, no model call.**

- The required population is the 8 stored OpenCode build candidates of
  2026w43. The stored legacy Pi build candidates are an optional, unranked
  second population.
- For each candidate, the pilot grafts the writable files onto a temporary
  clean tree, builds it, and runs the rigor suite twice. It reads the
  baseline outcomes from the stored score record. It never writes `runs/**`.
- Pass condition: 0 flips between the 2 grades and 0 harness errors. In at
  least one arm, the 4 models also show at least 3 distinct rigor rates. Two
  rates are distinct when they differ by at least `1/N`. `N` is the number
  of criteria in the evaluated set.

**Stage 2 — confirmation, model calls, owner decision D3.**

- The population is at least 4 models, both arms, and at least 3 repeats for
  each model and arm, from one week. Weekly cron repeats count when they meet
  these numbers.
- The rigor suite grades each new candidate in shadow. Published scores do
  not change.
- Separation statistic. For model `m` and arm `a`, `I(m, a)` is the range
  `[min, max]` of the rigor rate over the repeats. Models `m1` and `m2` are
  separated in arm `a` when `max I(m1, a) + 1/N ≤ min I(m2, a)`, or the
  reverse. `S(a)` is the size of the largest set of models that are
  separated pairwise in arm `a`.
- Pass condition: all three of these are true.
  1. `S(a) ≥ 3` for at least one arm.
  2. Over the stage-2 runs, the variance of the rigor contribution
     (D1 weight × rigor) is at least the variance of the adherence
     contribution.
  3. The monitor gives `verdict=ok` for the rigor criteria over the stage-2
     runs.
- When the pilot fails, the set does not ship. The plan records the result,
  and the owner decides the next step. A failed pilot is a valid result. It
  shows that stricter tests of A–H do not separate the current models, and
  that the task itself must become harder. That work is out of scope.

### FR-8 — Saturation monitor

- The monitor is `harness/rigor/saturation.ts` until activation. Its input is
  the valid, trusted, publishable records of one track in the OpenCode series,
  in a window of the last 4 ISO weeks.
- For each check, the monitor counts the runs `n` and the passes `k`, and
  calculates `p = k / n`. The flag is `high` when `p ≥ 0.90`, `low` when
  `p ≤ 0.10`, and `live` otherwise.
- **Threshold.** A check is saturated when its flag is `high` or `low` over
  at least 8 runs from at least 3 models. With fewer runs or fewer models, the
  verdict is `insufficient`.
- **Suite verdict.** A set of checks is `saturated` when at least 50% of its
  checks are flagged. It is also `saturated` when `S < 3` over the window
  (the FR-7 statistic). Otherwise the verdict is `ok`.
- The monitor writes `reports/saturation-<week>-<track>.json` and prints:

```text
SATURATION check=<id> n=<n> pass=<k> rate=<p> flag=<high|low|live>
SATURATION.SUITE set=<baseline|rigor|probes> verdict=<ok|saturated|insufficient> flagged=<f>/<t> separated_models=<s>
```

- The monitor changes no weight and no score. It reports only. Two
  consecutive `saturated` verdicts for the rigor set print
  `SATURATION.ALERT` in the cron log. The owner then decides to add mutants
  and criteria, or to give flagged checks `SATURATED_WEIGHT` at the next
  scoring revision.
- **Measured-problem check.** On the 8 w43 build records,
  the monitor flags 60 of 60 A–H criteria `high`, 14 probes `high`, and
  `P.dedup-item` `low`.
- **Threshold rationale.** On 2026-09-24, a check counted as saturated when
  it passed on 28 or more of 29 runs (0.97). The value 0.90 finds the same
  checks earlier and with fewer runs.

### FR-9 — Scoring revision

- Before activation (task 3.13), published scores do not change. The rigor
  axis exists only in pilot reports.
- After activation (scoring revision 2), the build total is:

```text
completion  = unchanged: tier-scaled weighted pass rate over the 60 A–H criteria
rigor       = min(1, completion / 0.6) × Σ(pass_c ∧ requires_c) × w_c / Σ w_c
              over the admitted rigor criteria stated under the record's revision
adversarial = unchanged
adherence   = unchanged
quality     = unchanged
total       = round1(100 × (0.25 × completion + 0.30 × rigor + 0.20 × adversarial
                           + 0.15 × adherence + 0.10 × quality))
```

- `w_c = 1`. A rigor criterion that the monitor flags at the revision freeze
  gets `SATURATED_WEIGHT` (0.25).
- Tier rates stay counted over the 60 A–H criteria. Rigor criteria do not
  change the tier gate.
- Rationale. Today completion gives 55 equal points to every model. The
  split keeps 0.25 as a gate for basic function. It moves 0.30 to the axis
  that the pilot proves. Adversarial, adherence, and quality keep their
  weights, so the change touches only the saturated axis. The weights are
  owner decision D1.
- Each record carries `scoring_revision` and the rigor set sha256.
  Provenance binds the rigor set hash.
- The OpenCode series is regraded once under revision 2, with no model call.
  Legacy Pi rows stay as labeled history under revision 1
  (`opencode_executor` FR-8).

### FR-10 — Ports to the variant tracks

The bugfix, change, and tests tracks restate A–H as facts in their own
model-visible specs.

- **Applicability.** A rigor criterion counts on a variant track only when
  that track's model-visible spec states its fact. The registry records
  `ports.<track>` as `stated` with a quote from that spec, or as `absent`.
  A meta test checks that each `stated` quote is a substring of that spec
  file. No model-visible file changes.
- **Bugfix** (`lending_desk_bugfix`). Stated rigor criteria enter the
  regression denominator, minus detectors and collateral. Rigor mutants
  become candidates for a new bug set `v2`. Their detectors are rigor
  criteria, and `verify-bugs.ts` admits them. Activation of `v2` starts a new
  bugfix cohort (D5). Canary: the clean set scores 100.
- **Change** (`lending_desk_change`). Stated rigor criteria enter regression.
  A rigor criterion that a change request alters goes into the `superseded`
  list of that request. Rigor graders use due dates within 60 days of the
  fixed clock, so CR-3 does not conflict. Canary: `reference-change/` scores
  100.
- **Tests** (`lending_desk_tests`). A rigor mutant can join a new mutant set
  `m2` (m1 plus these mutants) when two conditions are true. The mutant is
  observable over HTTP or by an import of `src/lib/loans.ts`. The tests-track
  spec states its fact. The tests-track oracle gains one test for each new
  mutant and must kill all of them. Activation of `m2` starts a new
  tests cohort (D5). Browser-only and action-only mutants stay out
  (`tests_bench` FR-1).
- Until activation, the port files stay under `harness/rigor/`, so no track
  hash changes.

## Candidate inventory

Red starts from this inventory. Survival is expected, not proven. The
executor proves it in task 3.3, and admission decides each criterion in task
3.5. The fixed clock is `2026-03-15T12:00:00.000Z` ("now").

### A. `computeLoanStatus(loan, now)`

| Criterion | Box | Tier | Assertion | Expected survivor mutants | requires |
|---|---|---|---|---|---|
| `R.A.returned-future` | A.1 | 0 | A returned loan with `dueAt` 24 h and 200 h after now is `"returned"`. | `RM-A-returned-late`: the returned check runs only inside the overdue branch. | `A.returned` |
| `R.A.just-before-now` | A.2 | 0 | `dueAt` 1 ms before now is `"overdue"`. | `RM-A-grace`: overdue starts 60 s after the due time. | `A.overdue` |
| `R.A.just-after-48h` | A.4 | 0 | `dueAt` 48 h + 1 ms and 48 h 30 min after now is `"ok"`. | `RM-A-hour-floor`, `RM-A-hour-round`, `RM-A-minute-slack` | `A.ok` |
| `R.A.now-argument` | A.2 | 0 | The status follows the `now` argument. With now + 1000 h as the argument, a loan due at now + 500 h is `"overdue"`. | `RM-A-store-clock`: the function reads `now()` from `src/db` and ignores its argument. | `A.overdue`, `A.ok` |

### B. `ItemCard`

| Criterion | Box | Tier | Assertion | Expected survivor mutants | requires |
|---|---|---|---|---|---|
| `R.B.alt-exact` | B.4 | 1 | The image of each of the 29 cards has alternative text equal to the item name. | `RM-B-alt-prefixed`: `` alt={`Photo of ${item.name}`} ``. The baseline match is a substring match. | `B.image-alt` |
| `R.B.whole-card-link` | B.3 | 1 | For each card, the image, the name, the category, and the badge are inside one link to `/items/<item id>`. | `RM-B-image-outside-link`: the image renders before the link element. | `B.link` |

### C. Catalogue

| Criterion | Box | Tier | Assertion | Expected survivor mutants | requires |
|---|---|---|---|---|---|
| `R.C.q-name-only` | C.2 | 1 | `?q=safety` lists only Safety Harness. `?q=batteries` gives the empty-result text. | `RM-C-q-all-fields`: the filter also searches the category and the description. | `C.filter-q` |
| `R.C.category-exact` | C.3 | 1 | `?category=tool` and `?category=Safety` give the empty-result text. | `RM-C-category-includes`, `RM-C-category-casefold` | `C.filter-category` |
| `R.C.current-open-loans` | C.1 | 0 | A loan opens on one item and closes on another through `/api/loans`. The next `/items` visit shows both badges as in the store. | `RM-C-cached-loans`: the page reads loans through `unstable_cache`. Only the actions invalidate it. Task 1.6 proves feasibility. | `C.renders-all`, `G.post201`, `G.patch200` |

### D. Detail

| Criterion | Box | Tier | Assertion | Expected survivor mutants | requires |
|---|---|---|---|---|---|
| `R.D.row-status` | D.2 | 1 | On `itm-017`, `itm-007`, and `itm-018`, each history row shows the status from A of its own loan, in row order. Case, a hyphen, or a space does not matter. | `RM-D-status-misaligned`: names come from the sorted list and statuses from the unsorted list. | `D.history-order` |
| `R.D.history-current` | D.2 | 1 | After a visit to the detail page, a loan opens through `/api/loans`. On the next visit, the new loan is the first history row. | `RM-D-cached-history`: the history read goes through `unstable_cache`. | `D.history-order`, `G.post201` |
| `R.D.form-current` | D.4 | 1 | After a visit to an available item, a loan opens through `/api/loans`. The next visit shows `Return` and no checkout form. After the loan closes the same way, the next visit shows the form. | `RM-D-cached-open-loan`: the open-loan read goes through `unstable_cache`. | `D.form-hidden`, `D.return-visible`, `G.post201`, `G.patch200` |
| `R.D.h1-exact` | D.1 | 1 | The `<h1>` text equals the item name for `itm-002` and `itm-016`. | `RM-D-h1-suffixed`: the heading adds the category. | `D.renders` |

### E. Forms

| Criterion | Box | Tier | Assertion | Expected survivor mutants | requires |
|---|---|---|---|---|---|
| `R.E.checkout-settles` | E.4 | 1 | After an accepted checkout, with no navigation, the page still shows the item on loan 5 s after the store records the loan, and `Return` replaces the form. | `RM-E-no-revalidate`: `checkoutItem` does not call `revalidatePath`. | `E.submits` |

### F. Actions (action layer)

| Criterion | Box | Tier | Assertion | Expected survivor mutants | requires |
|---|---|---|---|---|---|
| `R.F.due-at-now` | F.5 | 1 | `checkoutItem` with `dueAt` equal to now returns `{ ok: false, error: "Due date must be in the future" }` and writes no loan. | `RM-F-due-inclusive`: `due < now` replaces `due <= now`. | `F.future-due-date`, `F.checkout-record` |
| `R.F.due-after-now` | F.5 | 1 | `checkoutItem` with `dueAt` 1 s after now returns `{ ok: true }`. | `RM-F-due-by-day`: the guard compares calendar days. | `F.checkout-record` |
| `R.F.auth-first` | F.3 | 0 | A non-staff caller gets `Not authorized` also with a past `dueAt`, also for an item on loan, and also from `returnItem` for an item with no open loan. | `RM-F-validate-before-auth`, `RM-F-lookup-before-auth` | `F.auth-checkout`, `F.auth-return` |
| `R.F.return-with-history` | F.2 | 0 | `returnItem("itm-017")` returns `{ ok: true }`, sets `returnedAt` to now on `lon-010`, and keeps `lon-009` unchanged. | `RM-F-first-loan`: the action closes the first loan of the item. | `F.return-record` |
| `R.F.due-stored-exact` | F.1 | 1 | `checkoutItem` with `dueAt` `2026-04-01T09:30:00.000Z` stores that exact instant. | `RM-F-due-midnight`: the action moves `dueAt` to the start of its day. | `F.checkout-record` |

### G. Loans API

| Criterion | Box | Tier | Assertion | Expected survivor mutants | requires |
|---|---|---|---|---|---|
| `R.G.post400-each-field` | G.7 | 1 | `POST` with a non-string `memberId` (number, null) or a non-string `dueAt` (number, boolean) returns 400 with an error string and creates no loan. | `RM-G-partial-validation`: only `itemId` gets a type check. | `G.post201`, `G.400` |
| `R.G.patch-with-history` | G.9 | 1 | A `POST` opens a loan on `itm-001`, which has two returned loans. `PATCH { itemId: "itm-001" }` returns 200 with the new loan, with `returnedAt` set. The old loans stay unchanged. | `RM-G-patch-first-loan`: the route closes the first loan of the item. | `G.patch200` |
| `R.G.patch-returned-at-now` | G.9 | 1 | `PATCH` sets `returnedAt` to the fixed clock. The Goal section of the spec gives the clock rule. | `RM-G-patch-host-clock`: `new Date().toISOString()`. | `G.patch200` |
| `R.G.fresh-out-of-band` | G.12 | 1 | `GET ?itemId=<id>` runs. Another writer (the grader state route) opens a loan. The next `GET` lists the new loan. | `RM-G-cached-get`: `GET` reads through `unstable_cache`, and only `POST` and `PATCH` invalidate it. | `G.fresh` |
| `R.G.unknown-item-empty` | G.2 | 1 | `GET ?itemId=itm-999` returns 200 and `{ loans: [] }`. | `RM-G-unknown-404`, `RM-G-unknown-400` | `G.filter-item` |

### H. Loading and error boundaries

| Criterion | Box | Tier | Assertion | Expected survivor mutants | requires |
|---|---|---|---|---|---|
| `R.H.six-tiles` | H.1 | 2 | The loading shell holds exactly six placeholder tiles. The count reads the largest group of sibling elements after the heading, so markup inside a tile does not count. | `RM-H-nine-tiles` | `H.loading` |
| `R.H.retry-remounts` | H.2 | 2 | A click on `Try again` replaces the rendered error-message element, with no document navigation. | `RM-H-retry-inert`: the click handler does not call `reset`. | `H.error` |

Rows with no candidate criterion start as exemption candidates. Red writes
the reason, and Review A accepts or rejects it.

## Non-functional requirements

- **NFR-1 No model-visible change.** No edit under `fixture/`. No change to a
  model-visible track file. No new checkbox. No fixture revision.
- **NFR-2 No model call before D3.** The executor, the canary, and pilot
  stage 1 use overlays and stored candidates only.
- **NFR-3 Read-only history.** The pilot never writes `runs/**`. The
  executor never changes an existing run directory; it adds only `rigor-`
  directories (FR-6). Reports go to `reports/`, which git ignores.
- **NFR-4 Hermetic meta tests (anti-pattern A11).** Every new meta test
  passes under `BENCH_TRACK=change`.
- **NFR-5 Production isolation until activation.** Rigor files stay under
  `harness/rigor/`, outside the suite hash (`harness/tests/**`) and the
  runner hash list. No production command collects a rigor test. The Vitest
  CLI filters match by substring (`harness/vitest.config.ts`), so no rigor
  path contains `tests/unit`, `tests/api`, `tests/meta`, or `tests/e2e`. The
  proposed layout is `harness/rigor/__tests__/{registry,meta,unit,action,api,e2e}/`.
  A meta test proves the isolation (task 2.1).
- **NFR-6 Determinism.** Every kill and every pilot outcome is seen in 2 of 2
  grades.
- **NFR-7 Grade time.** The rigor pass adds at most 25% to the median grade
  time of stage 1. The pilot report states both times.
- **NFR-8 The weekly cron stays green.** `npm run test:meta:logic` does not
  collect the Red tests of this track, so the Sunday self-check stays green.
- **NFR-9 Labeled evidence (anti-pattern A3).** Gates parse labeled lines and
  Vitest summaries, never a bare digit.
- **NFR-10 Harness conventions.** Validators are hand-written TypeScript, as
  in `harness/tests-track/set-loader.ts`. The harness has no Zod dependency,
  and this track adds none.

## Owner decisions

| ID | Decision | Proposed default | Answer |
|---|---|---|---|
| D1 | Axis weights of scoring revision 2 | completion 0.25, rigor 0.30, adversarial 0.20, adherence 0.15, quality 0.10 | open |
| D2 | Thresholds | monitor 0.90 and 0.10, `n ≥ 8`, 3 models, 4-week window; held-out kill rate 0.60; `S ≥ 3` | open |
| D3 | Stage-2 model-call budget | one batch of 4 models × 2 arms × 3 repeats = 24 build runs, or the weekly cron when it meets the numbers | open |
| D4 | The weekly build canary adds the variant app after activation | yes | open |
| D5 | Activation of bugfix `v2` and tests `m2` as new cohorts | defer until 4 weeks of monitor data exist | open |
| D6 | Branch policy | work on `main`; NFR-5 and NFR-8 keep production commands unchanged | open |

## Acceptance criteria

1. **AC-1** The registry, the matrix, and the ports validate. The matrix has
   54 rows, and each section meets its targets or has a waiver.
2. **AC-2** The executor proves each dev and held-out mutant a baseline
   survivor in 2 of 2 grades. A frozen report and its sha256 record the proof.
3. **AC-3** Each admitted criterion has a passing canary, at least one unique
   kill, a spec quote, `requires`, and `live=yes` or a waiver.
4. **AC-4** The admitted set kills at least 60% of the held-out survivors.
5. **AC-5** Pilot stage 1 shows 0 flips, 0 harness errors, and at least 3
   distinct rigor rates among the 4 OpenCode models in one arm.
6. **AC-6** Pilot stage 2 shows `S(a) ≥ 3`, a rigor variance at least the
   adherence variance, and monitor `verdict=ok` for the rigor set.
7. **AC-7** On the 8 w43 records, the monitor flags 60 of 60 A–H criteria
   `high` and `P.dedup-item` `low`.
8. **AC-8** Meta tests verify the rigor arithmetic, the `requires` rule, the
   unchanged tier gate, and the D1 weights. The clean app and the variant app
   score 100 under revision 2.
9. **AC-9** The bugfix clean set, the change reference, and the tests oracle
   score 100 with the stated rigor criteria in their denominators.
10. **AC-10** Before activation, the runner hash and the suite hash do not
    change because of this track. No production command collects a rigor
    file.
11. **AC-11** `SCORING.md`, `README.md`, and `docs/methodology.html` state
    the change, its date, and its reason.

## Out of scope

- A harder task or a new fixture revision.
- New probes. The monitor reports probe saturation; a follow-up track owns it.
- Changes to the `M.*` adherence criteria.
- LLM-judged quality.
- Rescoring of legacy Pi rows.

## Risks

| Risk | Mitigation |
|---|---|
| A rigor criterion fails a correct alternative implementation | Variant canary, spec quote, Review A, stage-1 check for criteria that fail on every candidate |
| A second saturated suite ships | Unique-kill rule, live-on-arrival rule, pilot, monitor gate in stage 2 |
| Criteria fit the dev pool only | Sealed held-out pool with a 0.60 kill-rate gate |
| A rigor file reaches a production grade before activation | Path isolation (NFR-5) and the collection-guard test |
| Timing-based graders flake | 2-of-2 rule; a flip rejects the criterion |
| Candidate code runs inside the grader process in the action layer | Minimal environment, no credential path, Review B |
| Cache mutants do not survive the baseline in this Next.js version | Task 1.6 proves feasibility; admission drops criteria with no unique kill |
| The pilot fails | A valid result; the owner decides the next step |
