# Harness audit — verified grading defects

## Summary

The benchmark grades candidates against criteria that the model-visible spec does not
state. Five reviewers examined the harness. A second agent then tried to refute each
finding against the source. The verification pass removed 9 of 60 findings and reduced
27 more, so this report lists only what survived.

The root cause is structural. The harness has three self-check layers. None of them
runs in the grading path. Nothing ever tested whether a criterion is reachable from the
spec alone, so criteria written from the reference implementation survived review.

All rates below use the 19 valid records in `runs/`. The repository holds 28 run
directories: 19 are valid, 6 have `valid: false`, and 3 hold no `score.json`.

## Evidence base

- Reviewed: 60 candidate findings across 5 scopes.
- Confirmed: 24. Partial: 27. Refuted: 9. Added by the verifiers: 13.
- Raw output: `scratchpad/verified-*.json`.

---

## FR-1 — Critical: the calibration layer never executes

**FR-1.1** `verify-controls.ts` must run in the grading path.

The command chain is `batch.sh → run.sh → grade.sh`. `grade.sh` runs the candidate
contract, preflight, typecheck, build, the unit suite, the api suite, two Playwright
passes, `collect.ts`, and `score.ts`. No step names `verify-controls.ts`.
`harness/package.json` declares no script for it. A repository-wide grep finds four
hits outside the file: `provenance.ts:47` hashes it, two meta tests read it as text,
and `README.md:166` documents it as a manual operator command. `runs/` holds 28 model
directories and zero control directories.

`SCORING.md` makes the mutation controls step 2 of the calibration sequence, before any
matrix. 28 runs are published without that step. Every statement of the form "a control
proves this test is calibrated" is void.

**FR-1.2** The meta suite must run in the grading path.

`npm run test:meta` exists at `harness/package.json:8`. No shell script and no CI file
calls it. Those 24 tests police the criteria, the matrix, and the control manifest.

**FR-1.3** The quality axis must measure something.

`penalty_over_reference` is 0 in all 19 valid runs, so `quality` equals `completion`
exactly. react-doctor 0.9.2 returns 0 diagnostics and score 100 on every candidate
under every flag combination, including `--lint` and dead-code analysis. The axis holds
20% of the total and adds no information.

**FR-1.4** `NEGATIVE_CONTROLS` must run or be deleted.

`harness/tests/negative-controls.ts:17` has one importer, a meta test. Three of its four
entries are byte-identical to live sensitivity controls.

---

## FR-2 — Critical: criteria that grade the reference, not the spec

**FR-2.1** `C.summary` must be deleted.

`harness/tests/e2e/catalogue.spec.ts:178` asserts the exact string
`"29 in the catalogue · hand-tool, measuring, power-tool, safety"`. Section C of
`spec.md` holds 7 checkboxes. None asks for a summary line, a count, a category list,
the phrase "in the catalogue", the U+00B7 separator, or an alphabetical category order.
The text exists only in `reference/app/items/page.tsx:47`. `AGENTS.md` tells the model
to copy the `/members` convention, and `fixture/app/members/page.tsx` renders no summary
line.

Rate: 0 of 19 pass. Delete the test, the entry at `harness/tests/criteria.ts:35`, and
the control at `harness/tests/sensitivity-controls.ts:63`.

**FR-2.2** `E.member-options` must not require the placeholder text.

`harness/tests/e2e/detail.spec.ts:241` requires the exact option array, which starts
with `"Select a member"`. That string exists only in
`reference/app/items/[id]/checkout-form.tsx:34`. Checkbox E.1 says only "Renders a
member selector listing `members` by name, and a due-date input". `toHaveText` with an
array fixes the element count, so a candidate that renders exactly the five member
names fails with "Expected 6, Received 5".

Rate: 17 of 19 fail. The two that pass copied the reference text.

Fix: assert the member names only, and ignore any option with an empty value.

**FR-2.3** The due-date locator must accept any correct input type.

`harness/tests/e2e/detail.spec.ts` located the due-date control with
`input[type="date"]` at 12 sites. Checkbox E.1 names no input type, and
`src/db/schema.ts` types `dueAt` as ISO 8601, which `datetime-local` also produces.
A candidate that chose `datetime-local` matched nothing, so `toHaveCount(1)` failed and
every `fill()` waited to the 30-second timeout.

Rate: 12 of 19 runs lose 12 ids each. Two of those ids are Tier 0 criteria and one is a
Tier 0 probe, so the Tier 0 rate drops to 0.857. That soft-scales every Tier 1 and
Tier 2 weight to 0.952. One unstated markup choice moves the whole score.

This is the largest single distortion in the harness.

**FR-2.4** `F.checkout-record` and `F.lifecycle` must compare instants, not strings.

`harness/tests/e2e/detail.spec.ts:304` and `:366` require
`dueAt: "2026-04-30T00:00:00.000Z"`. The form field holds `"2026-04-30"`, which is a
valid ISO 8601 date. Checkbox F.1 says "records a loan with `borrowedAt` of now and the
given `dueAt`". No checkbox states a date-to-instant convention.

Four runs fail on the `dueAt` field alone with a correct `itemId`, `memberId`,
`borrowedAt`, and `returnedAt`. Combined with FR-2.3, Tier 0 criterion
`F.checkout-record` passes 3 of 19.

**FR-2.5** `P.streams-shell` must use a marker the history alone can produce.

`harness/tests/e2e/probes.spec.ts:127` marks the loan history with the bare substring
`"Dara Nwosu"`. That name is member `mbr-004` in the seed. The target `itm-018` has no
open loan, so section D requires the page to render `CheckoutForm`, and section E
requires that form to list every member by name. The marker therefore matches a member
`<option>` as well as a history row. A candidate that suspends the history correctly but
renders the selector in the shell records the mark at shell time and fails. The
reference passes only because it also wraps `CheckoutSection` in a Suspense boundary,
which no checkbox asks for.

Rate: 0 of 19 pass.

---

## FR-3 — Critical: the published results are void by the harness's own rule

**FR-3.1** The site must publish only trusted records.

All 28 `score.json` records carry `trusted: false`, `publishable: false`, and
`rankable: false`. All 19 valid ones carry `host.under_load: true`. `SCORING.md`
requires all six flags before publication and states that an under-load result must not
be ranked. The site publishes them.

Every timing-sensitive rate in this report therefore describes evidence the harness
itself marks void.

---

## FR-4 — Major: one defect charged twice

**FR-4.1** `E.return-error` must assert the error string before the revert.

`harness/tests/e2e/detail.spec.ts:390` uses `getByText("Available", { exact: true })`,
which is a case-sensitive whole-string match. `a-longcat` renders "This item is
available." and `b-gpt-5-6-luna` renders "Status: Available". Both pass
`E.return-optimistic`, which uses the tolerant matcher at line 150, and both fail
`E.return-error` on `exact: true` alone. 11 of 19 runs fail at line 390 and never reach
the E.9 assertion the id is mapped to.

**FR-4.2** `E.submits` must poll the store before asserting the badge.

The badge assertion at `detail.spec.ts:158` runs before the store poll at line 160. A
candidate with a correct `checkoutItem` loses the E.2 point for an E.4 defect it is
already charged for. `b-qwen3-6-plus` passes `F.checkout-record` and fails `E.submits`
at line 158.

**FR-4.3** `D.history-status` must read rows, not body text.

`detail.spec.ts:76` reads `body.innerText()` and matches `/\breturned\b/`. `innerText`
inserts no separator between two inline elements, so a row built as
`<span>name</span><span>status</span>` yields "Bruno Silvareturned" and the word
boundary fails. The reference passes only because its row carries the Tailwind class
`flex justify-between`. The regex is also case-sensitive, so the label "Returned"
fails, while line 81 matches "overdue" case-insensitively in the same test.

Rate: 4 of 19 lose the Tier 1 id while `computeLoanStatus` is correct.

**FR-4.4** `D.history-status` must poll the history region.

Line 75 reads `innerText` once with no poll, and `toMatch` does not retry. Section H
requires `app/items/loading.tsx`, which in the App Router also covers the child
`/items/[id]` segment. Two runs captured only the navigation and the fallback heading.
Both pass `H.loading` and `D.history-order`, which polls.

**FR-4.5** `P.no-waterfall` duplicates `C.parallel-reads`.

Both truncate the trace file, issue one raw `GET /items`, find the `countItems` call
and the `listCategories` call, and require the overlap to exceed 0. The two ids agree
in 19 of 19 runs. One spec fault costs the candidate on the completion axis and the
adversarial axis.

---

## FR-5 — Minor: brittle, latent, or mis-tiered

**FR-5.1** `C.parallel-reads` requires the `countItems` name. Checkbox C.7 names no
function. Three runs use `Promise.all([listItems(), listCategories()])` and fail.

**FR-5.2** `B.badge` anchors the accessible-name pattern with `/^Tile Cutter/`. Section
B states no element order inside the card.

**FR-5.3** `H.loading` matches the heading with the raw-HTML pattern
`/<h1[^>]*>\s*Items/`. A shell that wraps the word in a `<span>` satisfies H.1 and
fails. Latent: all 26 candidates copy the reference form.

**FR-5.4** `P.streams-shell` uses the same `\s*` heading pattern for the item name.
Latent in this cohort.

**FR-5.5** `P.stale-after-mutate` is Tier 0 at `criteria.ts:87`, but every prerequisite
is Tier 1. `SCORING.md` states that a probe carries the tier of its prerequisite.

**FR-5.6** `G.401` writes to `itm-024` and `itm-027`, which `G.post-fields` and
`G.patch200` need later. A candidate that omits the staff check lets those writes land,
so one Tier 0 authorization defect costs one Tier 0 and two Tier 1 criteria. No
`allowedCollateral` entry declares this. The `G.401` control only changes 401 to 403,
so the write stays blocked and the control never exercises the path.

**FR-5.7** `M.closeout` and `M.plan-complete` accept only the markers `- [ ]` and
`- [x]`. A `*` bullet or a `- [X]` marker fails. No model-visible text states this. All
10 `M.closeout` failures come from `metadata.json`, which `AGENTS.md` states plainly, so
this half is latent.

**FR-5.8** `M.plan-complete` gives a false pass. `?? []` turns a missing match into an
empty list, so an empty `plan.md` passes.

**FR-5.9** `M.metadata-valid` discriminates nothing. The untouched fixture holds
`status: "pending"`, which is a member of the accepted set. All 19 runs pass.

**FR-5.10** `E.member-options` also fixes the option order. A candidate that sorts the
list alphabetically fails, because the seed places "Chen Weiming" last. Latent.

**FR-5.11** Six checkout tests call `page.locator(...)` with no `.first()`, while five
sibling tests add it. A second combobox or date input raises a strict-mode violation.
Latent.

**FR-5.12** `F.future-due-date` fills `"2026-03-15"`, the one date whose verdict depends
on the unstated date-to-instant convention. `b-qwen3-8-flash` reads it as end of day and
fails. Use `"2026-03-14"`.

**FR-5.13** `P.no-key-leak` uses two negative assertions only. A detail route that
returns 500 contains no staff key and earns the Tier 0 probe.

**FR-5.14** `G.patch409` depends on `G.patch200` closing `itm-027` earlier in the same
file. Deterministic today, but the second assertion is not self-contained.

**FR-5.15** `G.get200` asserts `toBeGreaterThanOrEqual(19)` against a seed of 23. A GET
that drops up to four seeded loans passes.

**FR-5.16** `M.matrix-primary-ownership` checks spec to criteria only, never the
reverse. `CRITERIA` holds 62 ids and `SPEC_MATRIX` holds 52 primaries. `SCORING.md`
sanctions eight of the ten unmapped ids as splits or closeout checks. Only `C.summary`
is unsanctioned. The missing reverse check is why it survived.

**FR-5.17** The fixed instant `"2026-03-15T12:00:00.000Z"` is duplicated in
`tests/api/loans.test.ts:13`, `tests/unit/loans.test.ts:6`, and `grade.sh:156`. The
suites do not import `NOW` from the protected seed.

**FR-5.18** The idle submit label `"Check out"` is graded by 19 assertions and stated by
no checkbox. The regex tolerates case and an optional space, so the exposure is latent.

**FR-5.19** The `E.4` and `E.8` matrix rows promise rollback coverage. The primary tests
assert no rollback; the rollback runs under `E.5` and `E.9`.

**FR-5.20** `F.auth-checkout`, `F.auth-return`, `F.checkout-record`, and
`F.return-record` are Tier 0 and route their evidence through the section G API, whose
filter and POST are Tier 1. Latent: all 19 runs pass the G criteria.

---

## Refuted — do not reopen

These claims were checked against the source and did not hold.

- **The scoring arithmetic is correct.** The verifier reimplemented `softTiercale`, the
  tier rates, the earned sum, the quality term, and the total, then recomputed every
  run. The recorded total matched within 0.05 in 19 of 19 runs, and the tier rates
  matched to 1e-9. The two empty-set branches are unreachable, because both maps are
  module-level literals.
- **`collect.ts:35` cannot map a skip to a failure.** `grade.sh:177` and `:182` export
  `BENCH_TRACE_FILE` for both Playwright passes, so the five `test.skip` guards never
  fire. All 19 runs collected the full declared id set.
- **`G.get200` is not wrong.** `seed.ts` holds 23 loans, and the assertion is a lower
  bound of 19.
- **`G.post-fields` `borrowedAt` is derivable.** `insertLoan` requires the field, the
  spec preamble allows `now()` as the only time source, and `grade.sh:156` pins
  `BENCH_NOW`.
- **`G.fresh` is not over-strict.** The spec requires 201, so a route that answers 200 is
  incorrect, not an alternate.
- **The `"On loan"` and `"Available"` wording is spec-stated** at E.4, E.8, and B.2.
  Playwright `getByText` defaults to a case-insensitive substring match.
- **`E.pending` does not flake.** Every failing candidate hides the control behind an
  optimistic block, which is a real E.7 failure.
- **`P.dedup-item` is sanctioned.** `SCORING.md` names "duplicated detail reads" as an
  intended probe. It passes 0 of 19, but that is a property of the cohort, and it
  charges every model the same amount.
- **`P.no-waterfall` may require a count read.** Checkbox C.7 states that the total item
  count is read. The requirement is on the read, not on a rendered line.

---

## Out of scope

Task rotation and suite versioning. The user handles the task update monthly and
declined suite versioning.
