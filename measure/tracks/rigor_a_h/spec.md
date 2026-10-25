# Harder A–H criteria from interleavings, state sequences, and robustness variants

Spec format: classic FR list. Track type: feature. Base commit: `e449c63`.

## Summary

The 8 most recent build runs (week 2026w43, 4 models, 2 arms) pass all 60
A–H criteria. This track adds **scenario criteria** to the A–H set. A
scenario criterion tests a spec checkbox in a condition that the current
criteria skip. There are three such conditions: two actors at the same time,
a sequence of state changes, and an input class of a stated rule.

A new criterion enters the set only when a planted defect fails it, and the
same defect passes every current criterion and probe. Thus each new
criterion detects a defect that the current suite misses. The stored candidate trees then show
whether the new set separates models. This measurement sends no model call.

The track adds up to 5 criteria. Admission can remove a candidate. The
admitted criteria join the 60 current criteria inside the completion axis.
The track changes no weight, no axis, and no formula.

The evidence also sets a limit. The four w43 models write code that behaves
the same on every stated checkbox. A static read predicts that they keep
100% on the new set. Only a harder task can separate them, and a harder task
needs new model runs. Owner decision D2 covers that choice.

## Relation to the owner fidelity requirement

The owner added this requirement on 2026-10-25:

> if A-H will likely remain saturated, we need to determine if the goal of this benchmark (implementation of jr dev level TS / React 19 / Next 16) is actually met with perfect fidelity or not. Is it error free? To spec? Optimized? Probably not, but it might be for certain domains, and that's fine. Then we know which cheap models can be assigned to which domains with certainty and which are a risk. Remember this benchmark's goals and use first principles.

The requirement has two parts:

1. **Check strength.** A domain verdict of "no failure" is only as strong as
   the checks of that domain. This track makes the checks of C, D, E, F, and
   G harder.
2. **Publication.** One verdict for each model and domain, with the failure
   mode behind it. The separate track `domain_trust` owns this part.

This track adds one item for the requirement. The sweep prints one
`SWEEP.DOMAIN` line for each model and domain (FR-8). Owner decision D2 then
sees, for each domain, where the harder checks find a defect. Pi records keep
every byte (FR-7). Thus the sweep is the only source of scenario verdicts for
models that have Pi runs only.

The publication is a separate track for four reasons:

1. It needs no suite change, no regrade, and no decision D1. The stored
   records already show the domains where the cheap models fail.
2. Its files are `harness/export-site-data.py`, a new module, and `docs/`.
   They are outside the suite hash and the runner hash
   (`harness/provenance.ts`). It can land in `main` with no stale record.
3. Its gate is different: a data contract review and a browser review, not
   controls and canaries.
4. When the separation gate of this track fails, the matrix still ships.

## Evidence

All facts come from the files on disk on 2026-10-25.
[`corpus.json`](./corpus.json) lists every run that this section counts.

### E1. Saturation is a ceiling, not a broken suite

- 49 build runs have a candidate tree and a valid, publishable record. 8
  are OpenCode runs (2026w43). 41 are legacy Pi runs (2026w37 to 2026w39).
- 22 of the 49 runs pass every A–H criterion that counts for their fixture
  revision. They come from 10 models: claude-haiku-5-5, deepseek-v4.1-flash,
  deepseek-v4-flash-vision-exp, glm-5.3-flash, gpt-6-luna,
  minimax-m3.1-flash, mimo-v2.6-flash, muse-spark-1.2-contributor,
  muse-spark-1.3-contributor, and qwen3.8-flash.
- The other 27 runs fail at least one current criterion. Thus the current
  criteria separate weak models from strong models. They do not separate
  strong models from each other.

### E2. The four w43 models write the same behavior

The strategy role read the 9 task files of the 8 w43 candidates. It found no
stated behavior on which the candidates differ.

- **A.** All 8 compare `Date.parse(loan.dueAt)` with `now.getTime()` and use
  the same two boundaries. Over all 80 stored build trees, the function has
  67 different texts. All pass the current A criteria, except 4 stubs and 1
  boundary defect that `A.boundary` already fails. A read of the texts finds
  no other behavior difference.
- **B, C, D, H.** All 8 derive the catalogue badges from one read of all
  loans. They filter by name only and match the category exactly. They show
  the status of each loan in its own row, render six placeholder tiles, and
  call `reset()` on `Try again`.
- **E.** The 8 forms use three state designs: `useOptimistic` in a
  transition, `useState` in a transition, and `useState` with a `finally`
  block, some with `router.refresh()`. Each design reverts on a rejection
  and enables its control again.
- **F, G.** Every action and route catches `ItemOnLoanError` and
  `LoanAlreadyClosedError`, or catches every error of the close. Every route
  guards a `null` JSON body. Every write uses `now()`.
- The 8 candidates differ only where the spec does not decide. Two examples
  are the conversion of a calendar date to an instant and whitespace in
  `?q=`. Other examples are the order of two errors that apply together,
  repeated query parameters, and unknown ids in `POST`.

### E3. Defects that the current criteria miss

The strategy role found two defect classes in saturated runs by a static
read. The sweep (FR-4) must confirm or refute each one.

1. **The return action does not catch `LoanAlreadyClosedError`.** Two desks
   that return one item at the same moment get one success and one thrown
   error. Checkbox F.6 requires `{ ok: false, error: "Item is not on loan" }`
   for the losing call. The probe `P.concurrent-return` tests this race on
   the API. The probe `P.action-race` tests the checkout action. No
   criterion and no probe tests the return action. Saturated runs:
   `a-muse-spark-1-2-contributor` (w37, w38) and
   `a-muse-spark-1-3-contributor` (w37, w38). Over all 49 runs, a static
   read finds 19 runs with no guard around `closeLoan` in `returnItem`.
2. **The route reads fields from a parsed body with no `null` guard.** A JSON
   body of `null` then gives status 500. Checkboxes G.7 and G.11 require 400
   for a missing field. `G.400` and `G.patch400` send object bodies only.
   `P.malformed-json` sends text that is not JSON. Saturated runs:
   `a-muse-spark-1-2-contributor` (w37, w38).

Three current criteria have a blind spot. No stored run shows a defect there
yet.

3. `D.history-status` passes when the words `returned`, `ok`, and `overdue`
   appear anywhere on the page. It does not check that each row shows the
   status of its own loan (D.2).
4. No criterion changes the store outside an action and then visits
   `/items`. Checkbox C.1 requires "its current open loan".
5. `E.return-error` checks that the `Return` control is visible after a
   rejection. It does not check that the control is enabled, reads `Return`,
   and works on the next activation (E.6, E.7).

### E4. The H.2 retry finding

- The Next.js 16.2.11 documentation is in `fixture/node_modules`. Its page
  `03-file-conventions/error.md` says this about `reset()`:

  > However, if you have a specific reason to clear the error state and
  > re-render the error boundary's children without re-fetching the contents,
  > you can use the `reset()` function.

  The same page names `unstable_retry()` as the function that re-fetches.
- Checkbox H.2 requires a control "that retries without a full page
  reload". The three reference trees call `reset()` only.
- On 2026-10-25, `runs/` holds 427 files that match
  `runs/*/candidate/app/items/error.tsx`. The scope is every run directory,
  with no exclusion: model runs of all tracks, canaries, controls,
  calibration runs, and meta-test runs. 122 files are byte-identical to the
  stub. Each of the other 305 files calls `reset()`. No file calls
  `router.refresh()` or `unstable_retry()`. In the 49 corpus runs, 4 files
  are the stub, and 45 files call `reset()`. This command, run in `main`,
  prints both counts:

  ```bash
  python3 - <<'PY'
  import json, pathlib, re, sys
  stub = pathlib.Path("fixture/app/items/error.tsx").read_text()
  corpus = {r["run_id"] for r in json.load(open("measure/tracks/rigor_a_h/corpus.json"))["runs"]}
  files = sorted(pathlib.Path("runs").glob("*/candidate/app/items/error.tsx"))
  for scope, fs in (("all", files), ("corpus", [f for f in files if f.parts[1] in corpus])):
      t = [f.read_text(errors="ignore") for f in fs]
      s = sum(x == stub for x in t)
      r = sum(x != stub and bool(re.search(r"\breset\s*\(\s*\)|=\{\s*reset\s*\}", x)) for x in t)
      q = sum(bool(re.search(r"router\.refresh|unstable_retry", x)) for x in t)
      print(f"H2_SCAN scope={scope} files={len(t)} stub={s} reset={r} other={len(t) - s - r} refresh_or_retry={q}")
  PY
  ```

  It printed these lines on 2026-10-25:

  ```text
  H2_SCAN scope=all files=427 stub=122 reset=305 other=0 refresh_or_retry=0
  H2_SCAN scope=corpus files=49 stub=4 reset=45 other=0 refresh_or_retry=0
  ```

  A new run directory changes the `all` line. The corpus runs are
  read-only (NFR-4), so the `corpus` line stays the same.
- The stub `fixture/app/items/error.tsx` gives `reset` and no other
  function. The spec forbids signature changes.
- A criterion for a true retry fails every stored run and the reference. It
  separates no model, and the stub sends models toward the failure. This
  track does not add it. D2 lists it as input for a harder task.

## Design decisions

1. **How the new criteria are built.** Each scenario criterion is one test
   in the existing suites. `G.body-shape` goes into
   `harness/tests/api/loans.test.ts`. The four browser criteria go into a
   new file, `harness/tests/e2e/scenarios.spec.ts`. Each test reads the
   store through the grader route `app/api/bench-state` before and after
   each step. It calculates its expectation from the checkbox text and that
   live state. It never assumes the seed state.
2. **What proves that a criterion can fail.** Each criterion gets one
   sensitivity control in the existing manifest,
   `harness/tests/sensitivity-controls.ts`. The existing executor,
   `harness/verify-controls.ts`, runs it. The control applies one anchored
   mutation to `reference/`. It must fail its criterion. Its collateral list
   names no current criterion and no probe. Thus the current suite does not
   detect the defect, and the new criterion does.
3. **Where the criteria come from.** The criteria have three sources. The
   first is an interleaving of two actors. The second is a sequence of state
   changes across checkboxes. The third is an input class of a stated rule.
   Each criterion names the checkboxes that fix its oracle. A convention in
   the exclusion list never decides a verdict.
4. **Replace or join.** Join. The 60 current criteria still separate the 27
   unsaturated runs. Their removal would lose that signal and would make
   every stored score incomparable.
5. **The runs on disk.** Right after activation, and before the next weekly
   batch, `harness/regrade-all.sh` regrades every OpenCode record. It grafts
   the stored agent files onto the current tree and sends no model call.
   Legacy Pi records stay byte-identical, as `regrade-run.sh` already
   ensures. The sweep grades Pi candidates only as diagnostic overlays, and
   these results never publish.
6. **Scoring.** No change. The 5 criteria are tier 1 with weight 1. On a
   fixture revision 2 record, the completion weights sum to 47.25 today and
   to 52.25 with the new criteria. One new failure then costs about 1.05
   total points, the same as one current weight-1 criterion. A run that
   passes all 5 keeps its total. The existing formula already gives a live
   criterion four times the weight of a saturated one, so no weight change
   is necessary.

## Definitions

- **Current criteria.** The 60 A–H criteria in `CRITERIA` at the base
  commit. The `M.*` adherence criteria are not A–H criteria.
- **Scenario criterion.** A new A–H criterion that this track adds under
  FR-1.
- **Control.** One entry in `SENSITIVITY_CONTROLS`: an anchored source
  mutation of `reference/` with its expected failure and its collateral.
- **Corpus.** The 49 runs in `corpus.json`.
- **Saturated run.** A corpus run whose sweep result passes every current
  criterion that counts for its fixture revision.
- **Frontier runs.** The 8 OpenCode build runs of 2026w43.
- **Sweep.** One diagnostic overlay grade of each corpus run on the track
  branch (FR-4).
- **Live-state oracle.** An expected value that a test calculates from the
  checkbox text and the store, which it reads through `app/api/bench-state`.
- **New completion.** The completion of a run over the current criteria and
  the admitted scenario criteria, by the existing formula.
- **Track branch.** The branch `rigor-a-h` in a separate worktree. All harness
  edits of Phases 2 to 4 happen there (NFR-3).

## Functional requirements

### FR-1 — Scenario criteria in the registry

- Each scenario criterion is an entry in `CRITERIA` with its section letter,
  `tier: 1`, no `weight` field, and no `since` field.
- Its entry in `UNMAPPED_CRITERIA` starts with `scenario:`. It names its
  source class (`interleaving`, `sequence`, or `robustness`) and at least
  one `SPEC_MATRIX` row id.
- Its test title equals its criterion id. `G.body-shape` is in
  `tests/api/loans.test.ts`. The other admitted criteria are in
  `tests/e2e/scenarios.spec.ts`.
- `SCORING.md` permits scenario criteria. Today it permits only splits of a
  compound checkbox and closeout checks.
- `SCORING.md` gets a section `### Scenario criteria` in the section
  `## Functional completion (55%)`. The section states the
  scenario-criterion rule: the three sources, tier 1, the `scenario:`
  derivation, and the exclusion list. Its subsection `#### Admission rule`
  states the six conditions of FR-3 as a numbered list, in FR-3 order.
- **Check.** The meta test of plan task 2.1 fails when an entry, a
  derivation, a test title, or a control is missing.
- **Check.** `SCORING_CHECK` (test strategy section 2) prints
  `SCORING_CHECK=pass sources=3 conditions=6`. It exits non-zero when the
  section, the subsection, a source, or a condition is missing.

### FR-2 — Sourcing and exclusion rule

- A scenario criterion comes from one of the three sources in design
  decision 3. A criterion that only repeats one checkbox at a new example
  value does not qualify.
- The oracle follows from checkbox text and the live store. No verdict
  depends on a convention in the exclusion list below.
- **Check.** Review A maps each assertion to checkbox text. The adversarial
  role grades the alternate correct implementations of test strategy
  section 7, and each one must pass every scenario criterion.

### FR-3 — Admission rule

A scenario criterion is admitted only when all six conditions are true:

1. Its control fails it in 2 of 2 grades. `verify-controls.ts` reports no
   failure outside the declared collateral, and the collateral names no
   current criterion and no probe.
2. `reference/` and `reference-variant/` each pass it in 5 of 5 grades.
3. The change canary (`reference-change/`) scores 100. Or the criterion is
   in the `superseded` list of the change request that changes its
   behavior, and Review A accepts the reason.
4. The bugfix clean set scores 100, and `verify-bugs.ts --all` passes. A
   bug that also fails the criterion declares it as collateral.
5. It fails fewer than all corpus runs in the sweep.
6. Review A finds no corpus failure that comes from a convention in the
   exclusion list.

A criterion that misses a condition leaves the set before activation. The
plan records the condition and the evidence.

- **Check.** The admission table of plan task 4.2 has one row for each
  candidate and one column for each condition.

### FR-4 — Corpus sweep

- `harness/corpus-sweep.ts` reads `corpus.json`. For each run, it calls the
  existing overlay path:
  `AGENT_SKIP=1 OVERLAY=<repo>/runs/<run id>/candidate ./run.sh local corpus-sweep a sweep-<run id>`.
- It runs on the track branch, so its records go to the `runs/` directory of
  the worktree. It never writes to a corpus run.
- It counts only the criteria that count for the fixture revision of each
  run (`since_rule` in `corpus.json`). Scenario criteria have no `since`
  field, so they count for every run.
- It writes `reports/rigor-sweep-<date>.json` and prints the labeled lines of
  test strategy section 8: `SWEEP.RUN`, `SWEEP.REPRO`, `SWEEP.CRITERION`,
  `SWEEP.GATE`, `SWEEP.FRONTIER`, and `SWEEP.DOMAIN`.
- `SWEEP.REPRO` compares the sweep result of each current criterion with the
  stored record. It lists each mismatch by run id and criterion id.
- **Check.** `CORPUS_SHA` (plan header) prints the same value before and
  after the sweep.

### FR-5 — Separation gate

- `levels` is the number of different new-completion values among the
  saturated runs.
- `models_lowered` is the number of models with at least one saturated run
  whose new completion is less than 1.
- The gate passes when all three conditions are true:
  1. `models_lowered ≥ 2`.
  2. `levels ≥ 3`.
  3. `SWEEP.REPRO` matches at least 90% of the corpus runs, and Review A
     accepts the reason for each mismatch.
- When the gate fails, the set does not activate. The plan records the
  numbers, and the owner decides the next step (D2 options).
- The static read predicts `models_lowered = 2` and `levels = 3`
  (`predicted_new_failures` in `corpus.json`).

### FR-6 — Activation without a scoring change

- Owner decision D1 approves activation. Then the track branch merges into
  `main`.
- `AXIS_WEIGHTS` stays completion 0.55, adversarial 0.20, adherence 0.15,
  quality 0.10. `SATURATED_WEIGHT` stays 0.25.
  `harness/score-calculation.ts` stays byte-identical to the base commit.
- An existing control whose mutation also fails a scenario criterion adds
  that criterion to its collateral. No existing control loses a collateral
  entry or an expected failure.
- **Check.** `git diff e449c63 -- harness/score-calculation.ts` prints
  nothing. The meta test of plan task 2.1 asserts the weight values.
  `verify-controls.ts --all` passes.

### FR-7 — Records on disk

- After the merge, and before the next weekly batch, `regrade-all.sh`
  regrades every OpenCode record of every track.
- A record is **current** when `harness/score-freshness.ts` reports
  `TRUSTED` for it. Every OpenCode record that is `TRUSTED` before the merge
  is `TRUSTED` after the regrade. On 2026-10-25, 17 of the 76 OpenCode
  records are `TRUSTED`. 53 are `STALE-PROVENANCE`, 5 are `INVALID`, and 1
  is `GATE-BLOCKED`.
- Every legacy Pi record keeps every byte. On 2026-10-25, 95 run
  directories hold a Pi provenance record (schema 1, with an `executor.pi`
  object and no `executor.kind`).
- `plan-work.ts --all` gives the same class for each track, arm, and model
  before the merge and after the regrade. Thus the suite change schedules no
  new model run.
- The site export shows the regraded OpenCode rows and the unchanged Pi
  history. Each ranked row is an OpenCode row and holds every admitted
  criterion. No history row holds an admitted criterion. The history rows
  keep their run ids and results (`HISTORY_SHA`).
- **Check.** Plan task 5.2 records `PI_SHA`, `HISTORY_SHA`, the two
  `TRUSTED` lists, and the two `plan-work.ts` outputs. `TRUSTED_CHECK` exits
  0. Plan task 5.3 runs `EXPORT_CHECK`. Test strategy section 2 gives each
  command, and each one exits non-zero on a violation.

### FR-8 — Frontier report

- The sweep prints `SWEEP.FRONTIER runs=<r> saturated_after=<f>` for the
  frontier runs.
- When `f` equals `r`, owner decision D2 opens.
- The sweep prints one `SWEEP.DOMAIN` line for each corpus model and each
  domain A–H (test strategy section 8). The line counts the runs that pass
  every current criterion of the domain, and the runs that also pass its
  scenario criteria. It names each scenario criterion that failed, with its
  count. The line counts criteria only. Probes stay out of it.
- Plan task 4.4 turns these lines into a domain table for D2: one row for
  each model, one column for each domain.
- **Check.** Plan task 4.4 quotes the `SWEEP.FRONTIER` line and the domain
  table, and records whether D2 opened.

## Initial inventory

Red and Green start from these 5 candidates. Admission (FR-3) decides each
one. All are tier 1. Test strategy section 5 gives the steps.

| Criterion | Checkboxes | Source | Scenario and oracle | Control on `reference/` | Evidence |
|---|---|---|---|---|---|
| `F.return-race` | F.2, F.6, E.6, E.9 | interleaving | Two desks open one item that has one open loan. Both activate `Return` at the same moment. The store then has exactly one close of that loan, with `returnedAt` equal to now. Exactly one desk renders `Item is not on loan`. Both desks still show the item name as the `<h1>`, so no error boundary replaced a page. | `returnItem` no longer catches `LoanAlreadyClosedError`. | Corpus: 4 saturated runs, 2 models |
| `G.body-shape` | G.7, G.11 | robustness | `POST` and `PATCH` with the JSON bodies `null`, `[]`, `"text"`, and `7` each return 400 with a string `error`. | The `POST` handler reads fields from the parsed body with no `null` guard. | Corpus: 2 saturated runs, 1 model |
| `D.history-rows` | D.2, A.1–A.4 | sequence | On three items with returned loans, the test opens one loan each, with an overdue, a due-soon, and an ok due time. It also reads two seeded items. On each detail page, each history row pairs the member of one loan with the status of that loan. The rows follow `borrowedAt`, newest first. Rows with equal `borrowedAt` form a group with free order. | The history takes the names from the sorted list and the statuses from the unsorted list. | Blind spot E3.3 |
| `C.current-store` | C.1, B.2 | sequence | The test visits `/items` and both detail pages. Then it opens a loan on an available item and closes the loan of another item through the grader route. On the next `/items` visit, the two badges show the new state. | The catalogue reads the loans through `unstable_cache`, so only `revalidatePath` from an action clears it. | Blind spot E3.4 |
| `E.return-retry` | E.6, E.7, E.9, F.2, F.3 | sequence | The desk opens an item on loan. The test removes the staff cookie, and the desk activates `Return`. After the error text appears, the control reads `Return` and is enabled, and the loan stays open. The test restores the cookie. One more activation closes the loan with `returnedAt` equal to now. | The `Return` control stays disabled while an error is shown. | Blind spot E3.5 |

Sections A, B, and H get no candidate. E2 shows no behavior difference in A
and B. The only H gap is the retry finding E4.

## Exclusion list

These conventions never decide a verdict of a scenario criterion:

1. The conversion of a calendar date from the form to an instant: the start,
   the end, or any instant of that UTC day.
2. Trimming or normalizing whitespace in `?q=`.
3. The error that wins when two rejections apply at the same time.
4. The order of history rows with equal `borrowedAt`. Under the fixed clock,
   every new loan has `borrowedAt` equal to now.
5. Empty, repeated, or unlisted query values, for example `?q=`,
   `?q=a&q=b`, or `?overdue=1`.
6. Whether `POST` accepts an unknown item id, an unknown member id, or a
   `dueAt` string that is not a date.
7. The HTTP status of the not-found page.
8. Error text that the spec does not quote, for example the `error` string
   of a 400 response.
9. Markup: element types, nesting, and the order of the parts of a card or
   of a history row.
10. The page after a transport failure of a server action.
11. The page after a rejection, other than the stated error text and the
    revert of the optimistic display.

## Non-functional requirements

- **NFR-1 No model call.** The sweep, the controls, and the canaries use
  overlays and stored trees only.
- **NFR-2 No model-visible change.** No edit under `fixture/` or under
  `harness/*/model-visible/`. No new checkbox. No fixture revision.
- **NFR-3 Hash isolation.** The suite hash covers `harness/tests/**`, the
  fixture, and the three reference trees. A change there makes every stored
  record stale, and `plan-work.ts` then schedules new model runs. Thus all
  harness edits of Phases 2 to 4 happen on the track branch in a separate
  worktree. `main` keeps the base suite hash until the merge of task 5.2.
- **NFR-4 Read-only corpus.** The sweep opens corpus runs for reading only.
- **NFR-5 Determinism.** A scenario criterion gives the same verdict in 5 of
  5 grades of each reference tree and 2 of 2 grades of its control. A
  criterion that misses this rule leaves the set.
- **NFR-6 Grade time.** The scenario tests add at most 10% to the median
  grade time of the `reference` build canary. The grade time is the wall
  time of one `TIMED_CANARY` run (test strategy section 2). Task 1.2 times 5
  runs on the base suite. Task 3.5 times 5 runs on the new suite.
  `NFR6_CHECK` compares the two medians. It prints
  `NFR6 base_median_s=<x.x> new_median_s=<x.x> ratio=<x.xxxx> verdict=<pass|fail>`,
  and it exits non-zero unless the verdict is `pass`.
- **NFR-7 Labeled evidence (anti-pattern A3).** Gates parse labeled lines,
  never a bare number.
- **NFR-8 Hermetic meta tests (anti-pattern A11).** The new meta tests pass
  under `BENCH_TRACK=change`.
- **NFR-9 Harness conventions.** Validators are hand-written TypeScript, as
  in `harness/tests-track/set-loader.ts`. The harness has no Zod dependency,
  and this track adds none.
- **NFR-10 Schedule.** The weekly cron (`harness/cron-weekly.sh`, Sunday
  01:00 local time) holds the lock
  `/home/daniebo/Desktop/lending-desk-bench/.tmp/weekly-cron.lock` while it
  runs. The three weeks with an end line ran 34 to 67 minutes. The window is
  all of Sunday in local time, and any time that the lock is held. The sweep
  (task 4.1) and the regrade (task 5.2) start and end outside the window.
  Each job takes less than 24 hours, so it cannot span a Sunday.
  `NFR10_CHECK` runs at the start and at the end of each job.
  `NFR10_VERIFY` then reads the two lines (test strategy section 2). The rule
  applies whether or not the cron entry is installed.

## Owner decisions

| ID | Decision | Proposed default | Answer |
|---|---|---|---|
| D1 | Activate the admitted criteria, regrade the OpenCode series, and publish it. | Activate when the gate passes. The owner first sees the before and after totals of the 8 frontier runs. | open |
| D2 | Opens only when all 8 frontier runs stay saturated. (a) Fund a harder task. A new track designs fixture revision 3 with new A–H checkboxes. Every roster model then runs again, which is a spend. The H.2 retry finding (E4) is one input. (b) Accept that A–H separates the roster below the frontier, and that the frontier models differ on the other three axes. The `domain_trust` matrix then gives the fidelity answer for each domain. | No default. The owner chooses. | open |

## Acceptance criteria

1. **AC-1** Each admitted criterion has a `CRITERIA` entry, a `scenario:`
   derivation, a test with its id as the title, and a control (FR-1).
2. **AC-2** `verify-controls.ts` passes for each admitted control in 2 of 2
   runs, with no current criterion or probe as collateral.
   `verify-controls.ts --all` passes (FR-3, FR-6).
3. **AC-3** `reference/` and `reference-variant/` score 100 in 5 of 5
   grades each. The change, bugfix, and tests canaries score 100.
   `verify-bugs.ts --all` passes (FR-3).
4. **AC-4** The alternate implementations of test strategy section 7 pass
   every admitted criterion (FR-2).
5. **AC-5** The sweep prints `SWEEP.GATE ... verdict=pass` and a
   `SWEEP.REPRO` line with at least 90% matches (FR-4, FR-5).
6. **AC-6** No admitted criterion fails every corpus run (FR-3).
7. **AC-7** `AXIS_WEIGHTS`, `SATURATED_WEIGHT`, and
   `harness/score-calculation.ts` are unchanged (FR-6).
8. **AC-8** After D1, every OpenCode record that `score-freshness.ts`
   reported as `TRUSTED` before the merge is `TRUSTED` after the regrade
   (`TRUSTED_CHECK` exits 0). `PI_SHA`, `HISTORY_SHA`, and the
   `plan-work.ts --all` classes are unchanged. `EXPORT_CHECK` exits 0
   (FR-7).
9. **AC-9** Plan task 4.4 quotes `SWEEP.FRONTIER`. When the line shows all
   frontier runs saturated, the plan records D2 as open or answered (FR-8).
10. **AC-10** `SCORING.md` states the scenario-criterion rule and the
    admission rule (FR-1). `SCORING_CHECK` prints
    `SCORING_CHECK=pass sources=3 conditions=6`.

## Out of scope

- New checkboxes, a fixture revision, or a stub change. D2 option (a) sends
  this work to a separate track.
- A change to a weight, an axis, the formula, or `SATURATED_WEIGHT`. A new
  tier for a current criterion.
- Moving a current probe into the criterion set.
- A saturation monitor service. The sweep script can run again later on a
  new corpus.
- A criterion for a true retry of H.2 (E4).
- More repeats per week (`REPS_BUILD`).
- The publication of a verdict for each model and domain. The track
  `domain_trust` owns it.

## Risks

- **R1 Race timing.** The e2e server adds 300 ms to each store call, so the
  race window of `F.return-race` is about 300 ms. Two clicks from
  `Promise.all` arrive within a few milliseconds. `P.action-race` uses the
  same design. NFR-5 rejects the criterion if the race is not deterministic.
- **R2 Parser fairness.** The history-row parser can fail a correct markup.
  Three reference trees and the alternate implementations of test strategy
  section 7 must pass it.
- **R3 Graft drift.** The sweep grafts revision 1 candidates onto the
  revision 2 fixture. `SWEEP.REPRO` and the `since_rule` expose any change
  of verdict.
- **R4 Small margin.** The predicted gate result is exactly at the threshold.
  One refuted prediction fails the gate. That result is valid evidence for
  D2.
- **R5 Regrade cost.** About 76 OpenCode records on all tracks need a
  regrade after activation. This is compute time, not a model call.
- **R6 Control survival.** A current test can visit `/items` after a change
  through the grader route. Then the `unstable_cache` control of
  `C.current-store` fails a current criterion and does not qualify. Green
  then proposes another control with the same effect, or the criterion
  leaves the set.
- **R7 Untracked dependencies.** On 2026-10-25, 54 files in hashed trees are
  untracked in `main`. Examples are `harness/bugfix/`, `harness/change/`,
  `harness/tests-track/`, `reference-change/`, and
  `harness/tests/api/change.test.ts`. A worktree from a commit lacks them, so
  its suite hash differs from `main`. Task 1.2 waits until they are
  committed, and then it compares the hashes of the two trees.
- **R8 Pi records after activation.** Pi records keep every byte, so they
  never hold a scenario criterion. In the `domain_trust` matrix, a model with
  Pi runs only then reads `unproven` in C to G, unless it already has a
  failure there. The sweep report of task 4.1 holds the scenario verdicts
  for those models.
