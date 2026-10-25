# Test strategy — rigor_a_h

This strategy tells Red, Green, the reviewers, and the adversarial role how
the scenario criteria are written, proved, and kept fair. Spec: `spec.md`.
Plan: `plan.md`. Corpus: `corpus.json`.

## 1. Scope and risk

The product of this track is test code. A defect in a scenario test grades
models wrongly, so the main risks are these:

| Risk | Effect | Defense |
|---|---|---|
| A test fails a correct implementation | A model loses points for a free choice | Three reference canaries, the alternate implementations of section 7, and the exclusion list (spec) |
| A test cannot fail | The criterion adds no rigor | One control per criterion (section 9) |
| A test duplicates a current criterion or probe | One defect costs points twice | The control collateral names no current id (section 9) |
| A race test is not deterministic | The verdict changes between grades | 5 of 5 and 2 of 2 rules (section 10) |
| The suite change stales records on `main` | `plan-work.ts` schedules new model runs | All edits on the track branch until task 5.2 (spec NFR-3) |
| The sweep writes to a stored run | History changes | `CORPUS_SHA` before and after (section 2) |

## 2. Gate commands

Run every command from the worktree root
(`../lending-desk-bench-rigor`) unless the line says `main`.

- `RED_TEST_COMMAND`:
  `cd harness && BENCH_META=1 npx vitest run tests/meta/scenario-criteria.test.ts tests/meta/corpus-sweep.test.ts --maxWorkers=1`
- `GREEN_TEST_COMMAND`:
  `cd harness && BENCH_META=1 npx vitest run tests/meta/scenario-criteria.test.ts tests/meta/corpus-sweep.test.ts --maxWorkers=1 && npm run test:meta:logic && BENCH_TRACK=change npm run test:meta:logic`
- Control gate:
  `cd harness && npx tsx verify-controls.ts --id sensitivity-F.return-race --id sensitivity-G.body-shape --id sensitivity-D.history-rows --id sensitivity-C.current-store --id sensitivity-E.return-retry`.
  It exits 0, and its report shows `calibration_passed: true` for each
  control.
- Build canary (`CANARY build <tree>`):
  `cd harness && AGENT_SKIP=1 OVERLAY="$PWD/../<tree>" ./run.sh local <tree> a canary-rigor-<tree>-<n>`,
  with `<tree>` set to `reference` or `reference-variant`. It passes when
  the record has `valid === true` and `total === 100`.
- Other canaries: the canary arm of `harness/batch.sh` for `change`,
  `bugfix`, and `tests`, as in `bench_v2` plan task 7.3.
- `CORPUS_SHA` (run in `main`):
  `jq -r '.runs[].run_id' measure/tracks/rigor_a_h/corpus.json | while read -r id; do sha256sum "runs/$id/artifacts/score.json" "runs/$id/artifacts/provenance.json"; done | sha256sum`
- `PI_SHA` (run in `main`). Pi provenance records use schema 1. They have an
  `executor.pi` object and no `executor.kind`, so the selector tests the
  object. The command stops on an empty list, prints `PI_RUNS=<n>`, and
  hashes each `score.json`, `results.json`, and `provenance.json` that
  exists. On 2026-10-25 it printed `PI_RUNS=95` and
  `PI_SHA=c41f6bae1aacc126e1a0c7f0a73be2758c82eeea97b20485fa0c695a88eab38b`.
  `for p in runs/*/artifacts/provenance.json; do jq -e '.executor.pi | type == "object"' "$p" >/dev/null && echo "${p%/provenance.json}"; done | sort > .tmp/rigor-pi-artifacts.txt; test -s .tmp/rigor-pi-artifacts.txt && echo "PI_RUNS=$(wc -l < .tmp/rigor-pi-artifacts.txt)" && while read -r a; do for f in score.json results.json provenance.json; do if [ -f "$a/$f" ]; then sha256sum "$a/$f"; fi; done; done < .tmp/rigor-pi-artifacts.txt | sha256sum | sed 's/ .*//; s/^/PI_SHA=/'`
- `HISTORY_SHA` (run in `main`): the run ids and results of the published
  Pi history rows. It stops when the history is empty.
  `jq -e '.history.models | length > 0' docs/assets/data/benchmark.json >/dev/null && jq -S '[.history.models[] | {id, a: ((.no_skills // {}) | {run: .sources.agent, results}), b: ((.skills // {}) | {run: .sources.agent, results})}]' docs/assets/data/benchmark.json | sha256sum | sed 's/ .*//; s/^/HISTORY_SHA=/'`
- `TRUSTED_LIST <name>` (run in `main`): the OpenCode records that
  `score-freshness.ts` reports as `TRUSTED`, written to
  `measure/runs/rigor_a_h/trusted-<name>.txt`.
  `for p in runs/*/artifacts/provenance.json; do jq -e '.executor.kind == "opencode"' "$p" >/dev/null && echo "../${p%/provenance.json}/score.json"; done > .tmp/rigor-oc-scores.txt && (cd harness && npx tsx score-freshness.ts --many $(cat ../.tmp/rigor-oc-scores.txt)) | jq -r '.[] | select(.state == "TRUSTED") | .run_id' | sort > measure/runs/rigor_a_h/trusted-<name>.txt`
- `TRUSTED_CHECK` (run in `main`). It exits non-zero when the `before` list
  is empty. It also exits non-zero when a record of the `before` list is
  absent from the `after` list.
  `test -s measure/runs/rigor_a_h/trusted-before.txt && test -z "$(comm -23 measure/runs/rigor_a_h/trusted-before.txt measure/runs/rigor_a_h/trusted-after.txt)" && echo TRUSTED_CHECK=pass`
- `EXPORT_CHECK` (run in `main` after the export of task 5.3, with
  `ADMITTED` set to the comma-separated ids of task 4.2). It exits non-zero
  in three cases. A ranked row is not an OpenCode row. A ranked row lacks an
  admitted id. A history row holds an admitted id. Then `HISTORY_SHA` must
  print the value of task 5.2.
  `jq -e --arg ids "$ADMITTED" '($ids | split(",")) as $a | [.models[] | (.no_skills, .skills) | select(. != null)] as $r | ($r | length) > 0 and all($r[]; .executor.kind == "opencode" and ((.results | keys) as $k | all($a[]; . as $i | $k | index($i) != null))) and all(.history.models[] | (.no_skills, .skills) | select(. != null); (.results | keys) as $k | all($a[]; . as $i | $k | index($i) == null))' docs/assets/data/benchmark.json`
- `NFR10_CHECK` (spec NFR-10): exits non-zero on a Sunday or while the
  weekly cron holds its lock. Each job writes its output to its log.
  `[ "$(date +%u)" != 7 ] && flock -n /home/daniebo/Desktop/lending-desk-bench/.tmp/weekly-cron.lock true && echo "NFR10.CLEAR at=$(date -Iseconds)"`
- `NFR10_VERIFY <log>`: exits non-zero unless the log holds exactly two
  `NFR10.CLEAR` lines, neither on a Sunday, less than 24 hours apart.

  ```bash
  python3 - <log> <<'PY'
  import datetime, re, sys
  t = [datetime.datetime.fromisoformat(v) for v in re.findall(r"^NFR10\.CLEAR at=(\S+)$", open(sys.argv[1]).read(), re.M)]
  assert len(t) == 2 and all(v.isoweekday() != 7 for v in t) and t[1] - t[0] < datetime.timedelta(hours=24), t
  print("NFR10.PASS")
  PY
  ```

- `BASE_HASH` (run in `main` and in the worktree):
  `cd harness && npx tsx provenance.ts --shell`. It prints the runner hash
  and the suite hash. At task 1.2, the two trees print the same line.
- Work-list comparison (run in `main`):
  `cd harness && npx tsx plan-work.ts --all`. Compare only the class of each
  track, arm, and model.

The strategy role ran `PI_SHA`, `HISTORY_SHA`, both `EXPORT_CHECK` filters,
`NFR10_CHECK`, and `NFR10_VERIFY` on 2026-10-25. Each check passed on a good
input and exited non-zero on a bad input. `NFR10_CHECK` exited 1 because
2026-10-25 is a Sunday.

## 3. Test layers and owners

| Layer | File | Writer | What it proves |
|---|---|---|---|
| Registry meta test | `harness/tests/meta/scenario-criteria.test.ts` | Red | FR-1, the static part of FR-3, FR-6 |
| Sweep meta test | `harness/tests/meta/corpus-sweep.test.ts` and `harness/tests/meta/fixtures/corpus-sweep/` | Red | FR-4 and FR-5 arithmetic, line grammar, read-only behavior |
| API scenario test | `harness/tests/api/loans.test.ts` (`G.body-shape`) | Green | The criterion behavior |
| Browser scenario tests | `harness/tests/e2e/scenarios.spec.ts`, helpers in `harness/tests/e2e/_scenario.ts` | Green | The criterion behavior |
| Controls | `harness/tests/sensitivity-controls.ts` | Green | Each criterion can fail, and the current suite misses the defect |
| Canaries and sweep | existing `run.sh` overlay path, `harness/corpus-sweep.ts` | Green | Fairness and separation |

The helper file name starts with an underscore, so Playwright does not
collect it, as for `_forms.ts`.

### 3.1 Registry meta test (task 2.1)

The test reads `CRITERIA`, `UNMAPPED_CRITERIA`, `SPEC_MATRIX`,
`SENSITIVITY_CONTROLS`, `PROBES`, `AXIS_WEIGHTS`, and `SATURATED_WEIGHT`.
It fails when one of these is false:

1. Each inventory id in spec FR-1 is in `CRITERIA` with `tier: 1`, no
   `weight`, and no `since`. The list of inventory ids is a constant in the
   test. Task 4.2 removes an id from that constant when admission rejects
   it.
2. Each inventory id has an `UNMAPPED_CRITERIA` entry that matches
   `^scenario: (interleaving|sequence|robustness); ` and names at least one
   `SPEC_MATRIX` row id.
3. The test title equals the id in the file that spec FR-1 names. The test
   reads titles with the same helper as `M.matrix-wired`.
4. Each inventory id has exactly one control with
   `expectedFailures: [id]`. Its `allowedCollateral` contains no id of the
   60 current criteria and no probe id.
5. No existing control loses an expected failure or a collateral entry. The
   test compares the controls with a frozen copy of the base list in
   `harness/tests/meta/fixtures/scenario-criteria/base-controls.json`.
6. `AXIS_WEIGHTS` equals completion 0.55, adversarial 0.2, adherence 0.15,
   quality 0.1, and `SATURATED_WEIGHT` equals 0.25.
7. `npx playwright test --list` (with a placeholder `PW_PORT`) lists every
   test of `scenarios.spec.ts` after every other main-pass test. Section 4
   explains why the order matters.

### 3.2 Sweep meta test (task 2.2)

The test runs the summarizer of `harness/corpus-sweep.ts` on synthetic
records only. It never grades a candidate. Required cases:

1. **Since rule.** A revision 1 record that fails only `E.labels` is
   saturated. A revision 2 record that fails only `E.labels` is not.
2. **Completion.** The summarizer gets new completion from
   `deriveScoreMetrics` in `harness/score-calculation.ts` with the run's
   revision. A planted copy of the formula with a different value fails the
   test.
3. **Gate arithmetic.** Three synthetic saturated runs of two models with 0,
   1, and 2 scenario failures give `levels=3 models_lowered=2`. Two runs of
   one model with 1 failure each give `models_lowered=1`.
4. **Gate verdict.** `models_lowered=2 levels=3 repro_rate=0.9000` gives
   `verdict=pass`. Each value one step lower gives `verdict=fail`.
5. **REPRO.** A sweep record that differs from its stored record on one
   current criterion counts as one mismatch and lists `run:id`.
6. **Grammar.** Every printed line matches section 8. The parser rejects a
   line with a missing, extra, or reordered field.
7. **Read-only.** The summarizer hashes the synthetic corpus files before and
   after a run, and the hashes are equal.
8. **Hermetic.** The file passes under `BENCH_TRACK=change` (anti-pattern
   A11).
9. **Domain lines.** Two synthetic models, X and Y, with two runs each. One
   run of X fails `F.return-race` only. The summarizer prints
   `SWEEP.DOMAIN model=X domain=F runs=2 clean_current=2 clean_after=1 new_fail=F.return-race:1`.
   The line for X and domain A shows `new_fail=none` and `clean_after`
   equal to `clean_current`. One run of Y is a revision 1 run that fails
   only `E.labels`. The line for Y and domain E counts that run in
   `clean_current`. The output holds exactly 16 `SWEEP.DOMAIN` lines.

## 4. Live-state oracle and item table

Earlier test files change the store, and a candidate defect can change it in
other ways. Thus each scenario test follows these rules:

1. It sets its precondition through `app/api/bench-state` (`op: "open"` or
   `op: "close"`), as `createOpenLoan` and `closeOpenLoan` in `_forms.ts` do.
2. It reads the loans through `app/api/bench-state` after the precondition
   and after each step.
3. It calculates each expected value from that state and the checkbox text.
   It never uses a seed constant as an expected value.
4. `scenarios.spec.ts` runs after every other main-pass test (section 3.1,
   item 7). Thus its state changes cannot reach a current criterion.

| Criterion | Items | Precondition |
|---|---|---|
| `F.return-race` | `itm-005` | Exactly one open loan. |
| `E.return-retry` | `itm-026` | Exactly one open loan. |
| `D.history-rows` | read: `itm-017`, `itm-018`; prepared: `itm-013`, `itm-016`, `itm-001` | Prepared items: close any open loan. Then open one loan due 1 h before now (`itm-013`), 24 h after now (`itm-016`), or 200 h after now (`itm-001`). |
| `C.current-store` | `itm-023` (X), `itm-009` (Y) | X has no open loan. Y has one open loan. |

`itm-013` holds two returned loans with equal `borrowedAt`. Thus the history
of `itm-013` tests the group rule of section 6.

## 5. Scenario tests

Timeouts follow the current suite: 10 s for a screen state and 15 s for a
store poll. "Now" is `2026-03-15T12:00:00.000Z` (`BENCH_NOW` in `_forms.ts`).

### 5.1 `F.return-race`

1. Set the precondition. Record the id of the open loan.
2. Open two pages in one browser context (`context.newPage()` twice), as
   `P.action-race` does. Both load `/items/itm-005`.
3. Wait until each page shows a button named `Return`.
4. Click both buttons in one `Promise.all`.
5. Poll the store until the item has no open loan. Assert that exactly one
   loan of the item changed `returnedAt` from `null`, and that its value is
   now.
6. Poll until exactly one page shows the text `Item is not on loan`.
7. Assert that each page shows an `<h1>` with the item name.

The current probes test the race on the API and on the checkout action.
This test is the only one on the return action.

### 5.2 `G.body-shape`

1. For each body in `null`, `[]`, `"text"`, and `7`, send it as JSON with the
   staff header to `POST /api/loans` and to `PATCH /api/loans`.
2. Assert status 400 and a JSON body whose `error` is a string.

The API pass starts its server without `BENCH_STATE_KEY`, so this test reads
no store. `G.7` and `G.11` state the status and the error shape only.

### 5.3 `D.history-rows`

1. Set the preconditions of section 4.
2. For each of the five items, read its loans from the store. Sort the loans
   by `borrowedAt`, newest first. Map each loan to its member name and to its
   status at now, by the rules of spec section A.
3. Visit the detail page and wait until the parser of section 6 finds as
   many rows as the item has loans.
4. Assert that the parsed rows equal the expected rows under the group rule.

### 5.4 `C.current-store`

1. Set the precondition.
2. Visit `/items`, `/items/itm-023`, and `/items/itm-009`. These visits fill
   any cache that the candidate keeps.
3. Through the grader route, open a loan on X and close the loan of Y.
4. Visit `/items`. The card with `href="/items/itm-023"` contains `On loan`.
   The card with `href="/items/itm-009"` contains `Available`. The test
   selects each card by its `href` and reads the badge as `B.badge` does.

### 5.5 `E.return-retry`

1. Set the precondition. Load `/items/itm-026`. Wait for the `Return`
   button.
2. Remove the cookies of the context. Click `Return`.
3. Wait until the text `Not authorized` is visible.
4. Assert that a button with the exact name `Return` is visible and enabled
   within 10 s.
5. Assert that the store still holds the open loan.
6. Add the staff cookie again, with the values of `playwright.config.ts`.
7. Click `Return` one time.
8. Poll the store until the loan has `returnedAt` equal to now.

The test asserts nothing about the page after step 8. `E.return-submits`
already grades that state.

## 6. History-row parser

The parser reads the rendered DOM and assumes no markup.

1. **Status tokens.** A status token is a word match of `returned`,
   `overdue`, `due-soon`, `due soon`, or `ok`, case-insensitive, with word
   boundaries.
2. **Name tokens.** A name token is a match of one of the five member names.
   A match of `Chen Wei` inside `Chen Weiming` counts as `Chen Weiming`.
3. **Ignored nodes.** Text inside `select`, `option`, `script`, `template`,
   and `style` does not count, as in `historyNames` of `detail.spec.ts`.
4. **Row.** For each name token, the row is the lowest ancestor element whose
   text holds at least one status token. The row is valid only when its text
   holds exactly one status token and exactly one distinct member name.
5. **Rows in order.** The parser removes duplicate row elements and returns
   the valid rows in document order as `(name, status)` pairs.
6. **Group rule.** Expected rows with equal `borrowedAt` form one group. The
   parsed rows must match the expected groups in order. Inside a group, the
   pairs must match as a multiset.

A legend, a column header such as `Returned`, or a borrower line above the
history holds no single pair of one name and one status. Thus the parser
skips it.

## 7. Fairness: alternate correct implementations

The adversarial role builds each variant below as an overlay of
`reference/` and grades it with the build canary command. Each variant must
pass every scenario criterion. A failure sends the test back to Green. The
variant stays correct, and the test changes.

1. The history is a `<table>` with the columns Member, Borrowed, Due,
   Returned, and Status. The Returned column holds a date or a dash.
2. Each history row is one text node, for example
   `Ada Okonkwo — borrowed 2026-03-01 · ok`.
3. The status renders as `Due soon`, `Overdue`, `OK`, and `Returned`.
4. The status comes before the name in each row.
5. A legend above the history lists all four status words.
6. The `Return` control uses `useState` with a `finally` block, then
   `useTransition`. The reference uses `useActionState`.
7. Errors render in an `aria-live="polite"` region instead of
   `role="alert"`.
8. The catalogue badge has an icon element before its text.
9. The route guards the body with `body?.itemId` reads, then with a helper
   that returns `null` for every value that is not a plain object.
10. The checkout form converts the date to the end of the UTC day.

`reference-change/` adds the borrower line of CR-4 to the detail page. The
change canary therefore tests the borrower-line case of section 6.

## 8. Sweep report

`harness/corpus-sweep.ts` writes `reports/rigor-sweep-<YYYY-MM-DD>.json` with
one object for each run and one summary object. It prints these lines. Each
line holds every field in this order, with one space between fields.

```text
SWEEP.RUN run=<id> model=<model> rev=<1|2> current=<k>/<n> scenario=<k>/<m> new_completion=<x.xxxx> saturated=<true|false> repro=<match|mismatch>
SWEEP.REPRO match=<m> total=<n> mismatches=<run:id,...|none>
SWEEP.CRITERION id=<id> fail=<f> total=<n> fail_saturated=<g>/<s>
SWEEP.GATE saturated=<s> saturated_after=<t> levels=<k> models_lowered=<m> repro_rate=<x.xxxx> verdict=<pass|fail>
SWEEP.FRONTIER runs=<r> saturated_after=<f>
SWEEP.DOMAIN model=<model> domain=<A|B|C|D|E|F|G|H> runs=<n> clean_current=<k> clean_after=<j> new_fail=<id:count,...|none>
```

- `current` counts the current criteria that count for the run's revision.
  `scenario` counts the scenario criteria that the branch registry holds.
- `saturated` is true when the run passes every counted current criterion.
- `saturated_after` counts the saturated runs that also pass every scenario
  criterion.
- `SWEEP.DOMAIN` has one line for each corpus model and each domain, in
  model order and then domain order. `runs` counts the corpus runs of the
  model. `clean_current` counts the runs that pass every counted current
  criterion with the domain letter. `clean_after` counts the runs of
  `clean_current` that also pass every scenario criterion with the domain
  letter. `new_fail` lists each scenario criterion of the domain that failed
  in at least one run of the model, with its failure count, in id order.
  Probes never count in this line.
- The corpus has 21 models, so task 4.1 expects 168 `SWEEP.DOMAIN` lines.
- Rates have 4 decimals. Booleans are lowercase.

## 9. Controls and admission evidence

Each control is one entry in `SENSITIVITY_CONTROLS`, anchored on the text of
`reference/`. Green writes the exact `from` and `to` strings.

| Control | Target | Mutation |
|---|---|---|
| `sensitivity-F.return-race` | `src/actions/loans.ts` | The `LoanAlreadyClosedError` branch of `returnItem` never matches, so the error is thrown again. |
| `sensitivity-G.body-shape` | `app/api/loans/route.ts` | `POST` reads its fields from `body as Record<string, unknown>` with no `?? {}`. |
| `sensitivity-D.history-rows` | `app/items/[id]/page.tsx` | The history row takes its status from the unsorted list at the same index. |
| `sensitivity-C.current-store` | `app/items/page.tsx` | The page reads the loans through `unstable_cache`. The existing `revalidatePath("/items")` of the actions clears it, and the grader route does not. |
| `sensitivity-E.return-retry` | `app/items/[id]/checkout-form.tsx` | The `Return` button is disabled while `state.error` is set. |

- A control declares as collateral only other scenario criteria. When a
  current criterion or probe also fails, the control does not qualify.
  Green then writes a narrower mutation, or the criterion leaves the set.
- When `unstable_cache` does not cache under `next start` with this
  configuration, Green proposes another single-file mutation with the same
  effect. Review A accepts or rejects it.
- An existing control that also fails a scenario criterion adds the
  criterion to its `allowedCollateral`. This is the only allowed change to an
  existing control.

## 10. Determinism and flakes

- Each scenario criterion passes 5 of 5 grades of `reference/` and of
  `reference-variant/`. Its control fails it in 2 of 2 grades.
- Retries stay 0, and workers stay 1, as `playwright.config.ts` sets them.
- A result that changes between grades rejects the criterion, unless Green
  finds a defect in the test and the full count runs again.
- Waits use polls with a timeout, never a fixed sleep as the only wait.
  The race clicks use one `Promise.all`, as `P.action-race` does.

## 11. Review assignments

| Role | Applies | Focus |
|---|---|---|
| Review A (correctness) | yes | Each assertion maps to checkbox text. No verdict depends on the exclusion list. The parser matches section 6. The admission table of task 4.2. |
| Review B (security) | yes | The sweep runs stored model code. It must use the same `run.sh` isolation as every grade, with no new network or file access. The corpus stays read-only. |
| Review C (API and user flow) | no | The track changes no product route or page. |
| UX browser review | no | No user-facing change. |
| Adversarial testing | yes | Section 7 variants, and attempts to make a scenario test fail a correct overlay. |

## 12. Anti-pattern checks

- **A3.** Gates parse the labeled lines of section 8, never a bare number.
- **A4.** The gate never passes on an empty corpus. A sweep with 0 graded
  runs prints `verdict=fail`. `PI_SHA`, `HISTORY_SHA`, `TRUSTED_CHECK`, and
  `EXPORT_CHECK` stop on an empty input. An earlier `PI_SHA` text selected
  `executor.kind == "pi"`. No record has that value, so that check hashed
  an empty list and always passed.
- **A5.** The plan claims a result only with the quoted labeled line and its
  file path.
- **A11.** The new meta tests pass under `BENCH_TRACK=change`.
- **A12.** `measure_interphase_checks.py status` ignores `[b]` tasks. The
  orchestrator reads the plan markers before it reports progress.

## 13. Evidence to record

For each task, the plan records the command, the labeled output line, and
the report path. Task 4.2 records the admission table: one row for each
candidate, one column for each FR-3 condition, and the evidence for each
cell. Task 4.3 records each `predicted_new_failures` entry of
`corpus.json` as confirmed or refuted.
