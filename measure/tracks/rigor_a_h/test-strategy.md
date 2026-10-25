# Test strategy — rigor_a_h (track-wide, phases 1–4)

Revision: 2026-10-25, strategy role. Role base:
`f4712c6e8d830525c046f6b61c4260f233ce6c11`.

The worktree is dirty at role start. Other tracks own many untracked paths
(`harness/bugfix/`, `harness/tests-track/`, `harness/change/`, and others).
Every gate runs against the working tree. Stage files by explicit path only.

## 1. Scope and risk summary

This strategy covers the four phases of `rigor_a_h`. The track adds a
stricter A–H criterion set. Mutation evidence admits each criterion, and a
pilot decides whether the set changes the published score.

Risks, most important first:

1. **Over-specification.** A rigor criterion fails a correct alternative
   implementation, and a model loses points for a legitimate choice.
   Defense: the variant canary, the spec quote, Review A, and the stage-1
   check for criteria that fail on every candidate.
2. **A second saturated suite ships.** Defense: the unique-kill rule, the
   live-on-arrival rule, pilot stage 2, and the monitor gate.
3. **Overfitting to the dev pool.** Criteria kill the mutants that Red wrote
   and nothing else. Defense: the sealed held-out pool and its 0.60 gate.
4. **Production contamination before activation.** A rigor file reaches a
   production collection, a hash goes stale, or a Red test breaks the Sunday
   self-check. Defense: path isolation (spec NFR-5) and the collection guard.
5. **Flaky graders.** E and H checks read short state transitions; cache
   mutants depend on Next.js behavior. Defense: the 2-of-2 rule; a flip
   rejects the criterion.
6. **Non-hermetic meta tests (A11).** Defense: the `BENCH_TRACK=change` gate.
7. **History corruption.** The pilot or the executor changes a stored run.
   Defense: `HISTORY_SHA` before and after, and a meta test with fake runs.
8. **Untrusted candidate code inside the grader process.** The action layer
   imports candidate code into the Vitest process. Defense: a minimal
   environment with no credential path, and Review B.

## 2. Gate commands

```text
RED_TEST_COMMAND:   cd harness && BENCH_META=1 npx vitest run rigor/__tests__/meta --maxWorkers=1
GREEN_TEST_COMMAND: cd harness && BENCH_META=1 npx vitest run rigor/__tests__/meta --maxWorkers=1 \
                    && npm run test:meta:logic && BENCH_TRACK=change npm run test:meta:logic
ADVERSARIAL:        cd harness && BENCH_TRACK=change BENCH_META=1 npx vitest run rigor/__tests__/meta --maxWorkers=1
PROJECT_LINT:       cd harness && BENCH_META=1 npx vitest run rigor/__tests__/meta/collection-guard.test.ts --maxWorkers=1
PROJECT_CHECKS:     cd harness && npx tsx rigor/verify-rigor.ts --canary
PROJECT_TESTS:      the GREEN_TEST_COMMAND
```

Executor, pilot, and monitor commands (Phase 3):

```text
cd harness && npx tsx rigor/verify-rigor.ts --canary
cd harness && npx tsx rigor/verify-rigor.ts --baseline --all
cd harness && npx tsx rigor/verify-rigor.ts --rigor --all
cd harness && npx tsx rigor/verify-rigor.ts --heldout
cd harness && npx tsx rigor/pilot.ts --stage 1 --series opencode --week 2026w43
cd harness && npx tsx rigor/pilot.ts --stage 2 --week <week>
cd harness && npx tsx rigor/saturation.ts --track build --week 2026w43
```

Justification. The rigor meta tests live under `harness/rigor/__tests__/meta/`.
`npm run test:meta:logic` does not collect them, because its filter
`tests/meta` is not a substring of `rigor/__tests__/meta`. Thus Red can
commit failing tests on `main`, and the Sunday self-check stays green (spec
NFR-8). The Green command adds both production gates. They prove that the
track did not change production behavior. The frozen exclude list of
`test:meta:logic` in `harness/package.json` stays unchanged (A7).

`HISTORY_SHA` and `CANARY <track>` are defined in the plan header.

After task 3.13, the rigor meta tests move to `harness/tests/meta/`. From then
on, `npm run test:meta:logic` collects them, and the Red and Green commands
reduce to the two production gates.

## 3. Roles, order, and review applicability

| Phase | Roles | Notes |
|---|---|---|
| 1 | jr-green (1.3–1.6), owner (1.2), adversarial-testing (1.7) | No Red gate. Task 1.7 runs before Phase 2. |
| 2 | mid-red | Changes only `harness/rigor/__tests__/**` and `measure/**`. |
| 3 | jr-green, owner (3.12–3.15) | Executor runs need a quiet host. |
| 4 | jr-green | Docs, monitor wiring, doctor equivalents. |

Deviation from the standard role order. The adversarial-testing role writes
the held-out pool in task 1.7, before Red. The held-out pool must exist
before any criterion exists, or it cannot test generalization. The role also
keeps its normal place before phase acceptance.

Review applicability:

| Review | Phases | Focus |
|---|---|---|
| Review A (correctness) | 1–4 | Spec entailment of each quote, exemptions, equivalent mutants, admission arithmetic, over-specification against the variant |
| Review B (security) | 3 | Action-layer environment, no credential in candidate reach, executor write scope, held-out sealing |
| Review C (UX and API) | 3, 4 | Labeled CLI lines, score-record fields, site export columns |
| UX browser review | 4 | Applicable when `docs/` pages change (`UX_REQUIRED=auto`) |

## 4. Test layers

| Layer | Tool | Scope | Location before activation | Production? |
|---|---|---|---|---|
| L1 Contract | Vitest, `BENCH_META=1` | Validators, admission, executor integrity, scoring, monitor, ports, collection guard | `harness/rigor/__tests__/meta/` | No |
| L2 Unit grader | Vitest, direct import | Section A through `src/lib/loans.ts` | `harness/rigor/__tests__/unit/` | No |
| L3 Action grader | Vitest, direct import, mocks | Section F through `src/actions/loans.ts` | `harness/rigor/__tests__/action/` | No |
| L4 API grader | Vitest over HTTP | Section G | `harness/rigor/__tests__/api/` | No |
| L5 Browser grader | Playwright, own config | Sections B, C, D, E, H | `harness/rigor/__tests__/e2e/` | No |
| L6 Mutation executor | `tsx` | Kill matrices and admission | `harness/rigor/verify-rigor.ts` | No |
| L7 Canary | executor and `batch.sh` canary arm | Clean app, variant app, track canaries | — | After 3.13 |
| L8 Pilot | `tsx` | Stored candidates (stage 1), shadow grades (stage 2) | `harness/rigor/pilot.ts` | No |
| L9 Monitor | `tsx` | Weekly saturation report | `harness/rigor/saturation.ts` | After 4.2 |

Layer rules:

- L2 to L5 test behavior only. A grader never reads candidate source text.
- L4 and L5 run on their own server boot with a fresh seed. Each grader that
  changes state uses only the items in its `items` list (section 15).
- L3 resets the in-process store before each test (`globalThis.__store`) and
  sets `BENCH_NOW` to the fixed clock.

## 5. Mutation-based discrimination method

The method measures discrimination with mutants, not with model runs. A
criterion earns its place only by detecting a defect that the baseline
misses.

Steps:

1. **Pools.** The adversarial-testing role seals the held-out pool (task
   1.7). Red writes the dev pool (task 2.7).
2. **Baseline kill matrix (task 3.3).** Each mutant × 78 baseline checks × 2
   grades. Outcome per cell: `kill`, `pass`, or `flip`. A mutant with one
   `kill` is not a survivor. Green removes it with the reason.
3. **Rigor kill matrix (task 3.5).** Each surviving dev mutant × each
   candidate criterion × 2 grades.
4. **Admission (task 3.5).** Spec FR-4 rules 1–4. Rule 5 waits for stage 1.
5. **Generalization (task 3.6).** The admitted set runs on the held-out
   survivors. The kill rate must be at least 0.60.

Reported numbers:

- **Proposal survival rate.** Survivors divided by proposed mutants, for
  each section. It measures the weakness of the baseline. The pool holds
  survivors only, so the baseline mutation score over the frozen pool is 0
  by construction. Do not report that 0 as a finding.
- **Unique-kill count** for each candidate criterion.
- **Overlap matrix.** Shared kills between rigor criteria, for the redundancy
  rule.
- **Held-out kill rate.**

Falsification conditions:

- A canary failure stops the executor with exit code 3. No admission line
  is printed.
- A mutant that fails the gate is not registered.
- A criterion with `unique_kills=0` is rejected, even when it kills baseline
  kills.
- A criterion that flips on the clean app or the variant app is rejected.
- A section under its minimum blocks the set unless the owner records a
  waiver.

Equivalent mutants. Review A classifies a mutant as equivalent when no check
can observe it under the fixture state. The registry records the reason. An
equivalent mutant does not count as a survivor and does not count against
the baseline.

## 6. Canary

- The oracle suite passes on the clean app in 2 of 2 grades and on the
  variant app in 1 of 1 grade. Both apps score 100 under the revision-2
  formula.
- The executor runs `--canary` first in every mode.
- After activation: `CANARY build` passes for `reference/` and for
  `reference-variant/`. `CANARY bugfix`, `CANARY change`, and `CANARY tests`
  pass with the stated rigor criteria in their denominators.
- A rigor criterion that fails on the variant app is rejected. Never edit
  `reference-variant/` to make a criterion pass.

## 7. Pilot

Stage 1 (task 3.9, no model call):

- Population: the 8 stored OpenCode build candidates of 2026w43. The legacy
  Pi candidates are an optional, unranked second population.
- Each candidate: graft the writable files onto a temporary clean tree, build
  it, and run the rigor suite twice. Read the baseline outcomes from the
  stored record. Never write `runs/**`.
- Pass: `flips=0`, `harness_errors=0`, and `distinct_rates_max` at least 3.
  Two rates are distinct when they differ by at least `1/N`.
- Each criterion with a pass rate of 1.0 over the stage-1 population is
  rejected (FR-4 rule 5). Each criterion with a pass rate of 0 goes to
  Review A for an over-specification check, and then to the owner.
- Record the median grade time with and without the rigor pass (spec NFR-7).

Stage 2 (task 3.12, model calls under D3):

- Population: at least 4 models × 2 arms × 3 repeats in one week.
- The rigor suite grades in shadow. Published scores do not change.
- Separation statistic `S(a)`: spec FR-7. Compute the largest set of
  pairwise-separated ranges with the greedy rule. Sort the ranges by their
  upper end. Keep a range when its lower end is at least the last kept upper
  end plus `1/N`.
- Pass: `S(a) ≥ 3` in at least one arm, `rigor_var ≥ adherence_var`, and
  `SATURATION.SUITE set=rigor verdict=ok`.
- Report the paired Skills delta on the rigor axis for information only.

Pilot failure: the set does not ship. Record the numbers in the plan. The
owner decides the next step.

## 8. Saturation monitor tests (task 2.4)

Required tests and falsification conditions:

1. **Flag boundaries.** `p = 0.90` gives `high`; `p = 0.899` gives `live`;
   `p = 0.10` gives `low`; `p = 0.101` gives `live`. The test fails if one
   boundary moves by one run.
2. **Insufficient data.** 7 runs, or 2 models, give `insufficient`, never a
   flag.
3. **Separation statistic.** Ranges `[0.50, 0.60]`, `[0.70, 0.80]`,
   `[0.90, 1.00]` with `N = 10` give `S = 3`. Ranges that overlap give
   `S = 1`. A gap below `1/N` does not separate.
4. **Suite verdict.** 50% flagged gives `saturated`. 49% flagged with
   `S ≥ 3` gives `ok`. `S = 2` gives `saturated`.
5. **Measured problem.** A redacted copy of the 8 w43 build records gives 60
   of 60 A–H criteria `high`, 14 probes `high`, and `P.dedup-item` `low`. The
   redacted copy keeps only the criteria map, the probes map, the model id,
   the arm, and the validity fields.
6. **Record filter.** A planted invalid record and a planted Pi record do not
   change any count.
7. **Hermetic.** The file passes under `BENCH_TRACK=change`.
8. **Report only.** The monitor writes no `score.json` and no criterion
   weight. A test compares the source tree hashes before and after a run.

## 9. Scoring tests (task 2.5)

1. All rigor criteria pass with all `requires` passing: the rigor axis is 1.
2. One rigor criterion passes while one of its `requires` fails: that
   criterion counts 0.
3. An r1 record does not count rigor criteria with `since: 2`.
4. The tier rates of a record are equal with and without rigor results.
5. The D1 weights sum to 1. A test fails when a weight changes and the sum
   does not.
6. A flagged rigor criterion has weight 0.25.
7. An all-pass record scores 100. An untouched candidate (completion 0) has
   rigor 0.
8. Revision-1 totals stay byte-identical for the synthetic records of
   `harness/tests/meta/score-calculation.test.ts`.

## 10. Port tests (task 2.6)

1. Bugfix regression includes each `stated` rigor criterion and excludes
   each `absent` criterion, each detector, and each collateral id.
2. Change regression excludes each `superseded` id.
3. Each `stated` quote is a substring of that track's model-visible spec.
4. The candidate set `v2` passes `validateRegistry` and `detectorConflicts`.
5. The candidate set `m2` passes the tests-track set validator and holds no
   browser-only or action-only mutant.

## 11. Phase detail

### Phase 1: Contract and schema

Risk: **medium.** The contract fixes the paths and schemas that Phases 2 and
3 test. A wrong path breaks the collection guard.

- No Red command applies.
- Green gate: the five design sections exist (task 1.3), and the type
  contract imports (task 1.4). The two feasibility evidence files hold their
  labeled lines (tasks 1.5, 1.6).
- Feasibility outcomes decide scope. If task 1.5 fails on the variant app,
  the action layer is out, and section F uses UI graders only. Task 1.6 can
  show `api_change_stale=no`, or baseline failures above 0. Then the four
  cache criteria stay in the inventory, and admission rejects them because
  they have no unique kill.
- Closeout gate: each schema field maps to a Phase-2 assertion (A4 analog).

### Phase 2: Test (Red)

Risk: **high.** These tests are the only defense against wrong admission
arithmetic and against production contamination.

Red evidence. Record the command, the start and end times, the exit code, and
the labeled Vitest summary (`Test Files  N failed | M passed`,
`Tests  N failed | M passed`). Each new test fails for its stated reason. A
missing module is an acceptable Red only when the failure message names it.

Required tests and falsification conditions:

1. **Collection guard (2.1).** It fails when no rigor grader file exists. It
   fails for a planted path such as `harness/rigor/tests/api/x.test.ts`. It
   fails when the runner hash list or the suite walk holds a rigor path.
2. **Registry (2.2).** Each malformed fixture fails with its own reason.
   The cases are:
   - an unknown checkbox, or a quote that is not in the spec;
   - an unknown `requires` id, or a `requires` id that is not a baseline
     criterion;
   - a duplicate id, a bad id pattern, or overlapping `items`;
   - a mutant with no realism note, or a mutant target outside the nine
     task files.

   The removal of one matrix row also makes the test fail.
3. **Admission (2.3).** Synthetic matrices with a known answer for each FR-4
   rule. A 1-of-2 failure is a flip, not a kill. Zero held-out survivors give
   `insufficient`. The labeled line format matches FR-4 exactly.
4. **Executor integrity (2.3).** A fake grade command that fails the canary
   gives exit code 3 and no `RIGOR.ADMIT` line. A fake grade command that
   writes into `reference/` makes the executor fail.
5. **Monitor (2.4), scoring (2.5), ports (2.6).** Sections 8–10.
6. **Pilot read-only (2.3, `meta/pilot.test.ts`).** Fake run directories
   keep their bytes after a stage-1 run. The test fails when the pilot
   writes one byte under a fake run directory.

Green gate after Phase 2: none. The production gates must exit 0 at Red.

### Phase 3: Implement (Green)

Risk: **high.** Long executor runs on a shared host.

- Green gate: the `GREEN_TEST_COMMAND` exits 0.
- Executor gates: the canary lines, `RIGOR.BASELINE.SUMMARY` with `killed=0`,
  `RIGOR.ADMIT.SUMMARY`, the section lines, and `RIGOR.HELDOUT` with a rate
  of at least 0.60.
- Pilot gate: `PILOT.STAGE1` with `flips=0`, `harness_errors=0`, and
  `distinct_rates_max` at least 3. `HISTORY_SHA` is equal before and after.
- Run executor modes one at a time on a quiet host. Host load is advisory
  metadata; it never blocks a grade (SCORING.md "Host trust").
- Activation (3.13) and regrade (3.14) wait for the owner.
- Closeout gate: every `[x]` task carries a commit SHA. Admission evidence
  lives in `reports/rigor/<stamp>/`; the plan records the stamp and the
  sha256 of `admission.json`.

### Phase 4: Docs and doctor

Risk: **low.**

- Gate: the four canaries, both production gates, the executor canary, and
  the monitor on the final HEAD.
- The cron rehearsal of `opencode_executor` design section 6 exits 0 and logs
  the monitor lines.

## 12. Fixtures, mocks, and live-behavior proof

- **Action-layer mocks.** `next/headers`: `headers()` and `cookies()` return
  objects with `get()`. The staff case sets the `staff_key` cookie; the
  anonymous case sets nothing. `next/cache`: `revalidatePath`,
  `revalidateTag`, and `updateTag` record their calls; `unstable_cache`
  calls through. React `cache` calls through.
- **Environment.** The action layer runs with a minimal environment, as
  `cleanEnv()` in `harness/tests-track/grade-tests.ts` does. No credential
  path and no OpenCode variable reach candidate code.
- **Clock.** `BENCH_NOW=2026-03-15T12:00:00.000Z` in every grader.
- **State setup.** Browser graders use `app/api/bench-state` through the
  helpers of `harness/tests/e2e/_forms.ts`. Out-of-band writes for the
  freshness criteria go through `/api/loans` or the state route, as the
  criterion states.
- **No network and no model** in L1 to L7. Stage 2 is the only live-model
  proof, and it needs D3.
- **Redacted records.** The monitor fixture copies 8 w43 records with
  identity and score maps only. It holds no usage, cost, or credential field.

## 13. Intentionally red suites

- `RED_TEST_COMMAND` exits 1 from task 2.1 to task 3.11. This is expected.
- `npm run test:meta:logic` and its `BENCH_TRACK=change` variant exit 0 in
  every phase. A Red commit that makes them fail is a defect.
- The weekly cron self-check does not collect the rigor meta tests before
  task 3.13.

## 14. Hash-freeze and changed-contract risks

| Event | Hash effect | Handling |
|---|---|---|
| Phases 1–3 up to 3.12 | None from this track | Record `runner_sha256` and `suite_sha256` at each phase start and end. A change must trace to a commit of another track. |
| Task 3.13 activation | Runner hash and suite hash change | Every record goes stale. Task 3.14 regrades the OpenCode series before the next publication. |
| Task 3.15 port activation | Bugfix and tests track hashes change | New cohorts start. Old cohorts stay labeled. |

Changed contracts at 3.13: `CRITERIA` gains `R.*` ids with an axis tag;
`score-calculation.ts` gains the rigor axis; records gain `scoring_revision`
and the rigor set sha256. The collector then requires the `R.*` ids in every
build collection.

## 15. Item allocation

`design.md` (task 1.3) is the authority. Proposed allocation for the rigor
pass on its own server:

| Criterion | Items changed |
|---|---|
| `R.C.current-open-loans` | `itm-004` (open), `itm-025` (close) |
| `R.D.history-current` | `itm-005` |
| `R.D.form-current` | `itm-006` |
| `R.E.checkout-settles` | `itm-011` |
| `R.G.post400-each-field` | `itm-008` (no write expected) |
| `R.G.patch-with-history` | `itm-001` |
| `R.G.patch-returned-at-now` | `itm-026` |
| `R.G.fresh-out-of-band` | `itm-009` |

A read-only criterion may read a listed item only when no change in this
table alters what it reads. `R.B.alt-exact` reads the image alternative text
of all 29 cards, and no change alters it. `R.D.row-status` reads `itm-017`,
`itm-007`, and `itm-018`. `R.D.h1-exact` reads `itm-002` and `itm-016`. The
action layer (section F) uses its own in-process store.

## 16. Anti-pattern coverage

| Anti-pattern | Defense |
|---|---|
| A3 digit-only count | Parse labeled lines (`RIGOR.*`, `PILOT.*`, `SATURATION*`) and Vitest summaries |
| A4 vacuous pass | Non-vacuous collection guard; `requires`; `insufficient` for empty held-out sets and thin monitor windows |
| A5 false claim | `[x]` only with a commit SHA and the cited command output |
| A6 registry overstatement | Registry status stays `pending` until closeout |
| A7 over-broad filter | The `test:meta:logic` exclude list stays frozen; isolation uses paths |
| A9 archived paths | Rigor tests read no track path |
| A10 generated facts | `measure/generate.sh` and `measure/doctor.sh` are absent; Phase 4 runs the equivalents |
| A11 inherited environment | `BENCH_TRACK=change` gate on every meta test |

## 17. `phase_base_sha` capture point

Each role records `git rev-parse HEAD` at role start as its baseline. Phase 1
starts from `f4712c6e8d830525c046f6b61c4260f233ce6c11` plus the commit of
task 1.1. The orchestrator records each phase checkpoint in the phase heading.
