# Domain trust matrix: safe and risk domains for each model, with failure modes

Spec format: classic FR list. Track type: feature. Base commit: `e449c63`.

## Summary

Engineering leads ask one question: "Which model can I trust for this kind
of work?" The leaderboard gives one number for each model. That number does
not tell a lead which domains a cheap model does correctly.

This track publishes one verdict for each model and each domain A–H, next to
the leaderboard. A verdict is `safe`, `unoptimized`, `risk`, or `unproven`.
Each verdict other than `safe` names its failure mode: the failed checks,
their kind, their meaning, and their failure count.

The track reads stored records only. It sends no model call. It changes no
score, no test, and no fixture. The leaderboard stays as it is.

## Owner requirement

The owner gave this requirement on 2026-10-25:

> if A-H will likely remain saturated, we need to determine if the goal of this benchmark (implementation of jr dev level TS / React 19 / Next 16) is actually met with perfect fidelity or not. Is it error free? To spec? Optimized? Probably not, but it might be for certain domains, and that's fine. Then we know which cheap models can be assigned to which domains with certainty and which are a risk. Remember this benchmark's goals and use first principles.

## First principles

1. **The goal.** The benchmark measures junior-level feature work in
   TypeScript, React 19, and Next.js 16. A lead assigns work by its kind.
   Domains A–H are those kinds.
2. **Perfect fidelity has three parts.** The owner names them. The suite
   already measures each part:
   - **To spec.** The A–H criteria grade the checkboxes of the task spec.
   - **Error-free.** The hidden probes grade defects that the spec does not
     list. Examples are races, the order of the auth check, malformed input,
     stale data, a credential leak, and accessibility.
   - **Optimized.** Three probes grade wasted work: N+1 reads, a record read
     two times in one request, and store reads before validation.
3. **Certainty needs repeats.** One clean run is one observation. Each
   verdict states how many runs support it.
4. **A failure is certain. A pass is not.** One observed failure proves a
   risk. A clean result proves only that the checks which ran found no
   defect. Thus `risk` needs one failure, and `safe` needs each check of the
   domain to pass in `N_MIN` runs or more.
5. **A check that did not run is not a failure.** The score already skips a
   criterion that the fixture revision of a record does not state. The
   matrix uses the same rule. A missing result counts as "not graded".

## Evidence

All facts come from the files on disk on 2026-10-25.

- **EV1. The domain data exists, but no page shows it for the cheap
  models.** `harness/export-site-data.py` (`load_entry`) writes a `domains`
  block for each published entry. `docs/results.html` renders it only for
  the 4 ranked OpenCode rows. All 4 rows show 100% in A–H. The 11 Pi history
  models also carry a `domains` block, from one representative run for each
  arm. No page renders it.
- **EV2. The published domain block counts unstated checks as failures.**
  The block counts every key of `results.json`. The score skips a criterion
  whose `since` value is above the record revision (`statedUnder` in
  `harness/score-calculation.ts`). 15 fixture revision 1 records in the
  corpus of `rigor_a_h` hold `E.error-announced` or `E.labels` as `false`.
  In the published history, 4 entries list `E.error-announced` as an E
  failure. They are hy3 (arm a), glm-5.3-flash (arm a), and qwen3.7-plus
  (arms a and b). For example, hy3 shows E at 91% only because of this
  defect.
- **EV3. Some records lack checks.** 20 Pi records (revision not recorded,
  73 result keys) hold no result for the 5 fixture revision 2 probes, or for
  `E.labels` and `E.error-announced`.
- **EV4. No catalog model is optimized in D.** `P.dedup-item` fails in 46
  of the 49 corpus runs, and in each of the 8 frontier runs of 2026w43. It
  passes in `a-glm-5-3-flash-2026w37`, `a-mimo-v2-6-flash-2026w39`, and
  `b-qwen3-6-plus-2026w38`. The second of these runs failed most other
  checks. The reference passes the probe:
  `reference/app/items/[id]/page.tsx` wraps `getItem` in React `cache`. The
  frontier candidates call `getItem` in `generateMetadata` and again in the
  page. In the 8 frontier runs, this probe is the only failed A–H criterion
  or probe.
- **EV5. The preview matrix.** The strategy role applied the rule of this
  spec to the stored records, with `N_MIN = 2`. The result is in
  [`preview.json`](./preview.json). The run filter of the export selects 34
  runs from 14 catalog models, the same runs as the `rigor_a_h` corpus.
  Codes: S `safe`, O `unoptimized`, R `risk`, U `unproven`.

  | Model | Runs | A | B | C | D | E | F | G | H |
  |---|---|---|---|---|---|---|---|---|---|
  | claude-haiku-5-5 | 2 (2 OpenCode) | S | S | S | O | S | S | S | S |
  | deepseek-v4.1-flash | 4 (2 OpenCode, 2 Pi) | S | S | S | O | S | S | S | S |
  | glm-5.3-flash | 3 (3 Pi) | S | S | O | R | R | R | S | R |
  | gpt-5.6-luna | 2 (2 Pi) | S | U | S | O | U | R | U | S |
  | gpt-6-luna | 2 (2 OpenCode) | S | S | S | O | S | S | S | S |
  | hy3 | 1 (1 Pi) | U | U | U | U | U | R | R | U |
  | longcat-2.0 | 3 (3 Pi) | S | U | R | O | R | R | R | S |
  | mimo-v2.5 | 3 (3 Pi) | S | U | O | O | R | R | R | S |
  | mimo-v2.6-flash | 2 (2 Pi) | S | R | R | R | R | R | R | R |
  | minimax-m3.1-flash | 2 (2 OpenCode) | S | S | S | O | S | S | S | S |
  | muse-spark-1.2-contributor | 2 (2 Pi) | S | U | O | O | U | U | R | S |
  | muse-spark-1.3-contributor | 3 (3 Pi) | S | U | S | O | U | U | R | S |
  | qwen3.7-plus | 2 (2 Pi) | S | R | O | O | R | R | R | S |
  | qwen3.8-flash | 3 (3 Pi) | S | S | S | R | R | R | R | R |

- **EV6. The cheap rows carry the signal.** Examples of failure modes in
  the preview:
  - longcat-2.0, G: `G.401` ("all methods require staff") failed in 3 of 3
    runs.
  - qwen3.7-plus, F: `F.auth-checkout`, `F.auth-return`, and
    `P.action-race` failed in 2 of 2 runs.
  - muse-spark-1.3-contributor, G: `P.concurrent-return` ("double return;
    the losing close unhandled") failed in 3 of 3 runs.
  - mimo-v2.5, E: `E.submits`, `E.optimistic`, and `E.return-optimistic`
    failed in 3 of 3 runs.
  - gpt-5.6-luna, F: `F.checkout-record` and `F.lifecycle` failed in 2 of 2
    runs.
- **EV7. Retired models.** 7 of the 21 corpus models are not in the current
  catalog (`harness/go-pricing.json`, `high_usage` and `batch`). A lead
  cannot assign them, and the export lists no row for them.
- **EV8. Hash boundaries.** `harness/provenance.ts` hashes every file under
  `harness/tests/` into the suite hash, and a fixed file list into the
  runner hash. A new file under `harness/tests/` makes every stored record
  stale, and `plan-work.ts` then schedules new model runs.
  `harness/export-site-data.py`, a new `harness/domain_trust.py`, a new
  `harness/site-tests/` directory, and `docs/` are outside both hashes.
- **EV9. The weekly cron publishes.** `harness/cron-weekly.sh` runs the
  export, commits `docs/`, and pushes it to GitHub Pages. A change of the
  export in `main` is thus published at the next weekly run.

## Design decisions

1. **Where the code lives.** A new module, `harness/domain_trust.py`, holds
   the probe map, the kinds, and the verdict function. The export imports
   it. The test file is `harness/site-tests/domain-trust.test.ts`, outside
   `harness/tests/` (EV8). The existing export test in
   `harness/tests/meta/bench-incremental.test.ts` stays unchanged.
2. **Which records count.** The matrix uses the same records as the export.
   A record is a run directory that matches the run pattern of
   `find_arm_runs` for a catalog model. It has `valid === true` in
   `score.json`, and it has a `results.json`. All weeks, both arms, and both
   executors count.
3. **Pooling.** Pooling is conservative for `risk`: one more run can only
   add a failure. Pooling also gives more coverage for `safe`. The matrix is
   not a ranking, so the rule "Pi rows never rank" stays true. Each row
   names its run count for each executor.
4. **No order by score.** Rows sort by model id. The leaderboard stays the
   only ranking on the site.
5. **The meaning text comes from the registry.** The text of a check is the
   `spec` text of its `SPEC_MATRIX` row, or its `UNMAPPED_CRITERIA` entry,
   or the `catches` text of its probe. The track writes no new text for a
   check. On 2026-10-25, every A–H criterion has a text from one of the
   first two sources.
6. **The page.** A new section of `docs/results.html` shows the matrix
   below the score table. Each cell shows its verdict as a word, not only
   as a color. A failure-mode list follows the table, grouped by model.

## Definitions

- **Domain.** A section letter A–H with its title from `DOMAINS` in the
  export.
- **Check list of a domain.** Every criterion in `CRITERIA` whose id starts
  with the domain letter, and every probe that the probe map assigns to the
  domain. The list follows the registry. A new criterion with a domain
  letter joins the list with no change of this track.
- **Kind.** `spec` for an A–H criterion. `robustness` or `performance` for a
  probe, from the probe map.
- **Counted record.** A record that design decision 2 selects.
- **Graded result.** A pair of a counted record and a check. The check
  counts for the record revision: a criterion with `since` at most the
  revision (default 1), or any probe. `results.json` holds a boolean for the
  check.
- **Failure.** A graded result whose value is not `true`.
- **Coverage of a check.** The number of graded results of the check over
  the counted records of one model.
- **`N_MIN`.** The coverage that `safe` needs for each check. The default is
  2. Owner decision O1 sets it.

## Verdict rule

The first rule that applies gives the verdict of one model and one domain:

1. **`risk`.** At least one failure of kind `spec` or `robustness`.
2. **`unproven`.** No such failure, and at least one check of the list has a
   coverage below `N_MIN`.
3. **`unoptimized`.** Every check has a coverage of `N_MIN` or more, and at
   least one failure of kind `performance`. The page label is "Safe, not
   optimized".
4. **`safe`.** Every check has a coverage of `N_MIN` or more, and no
   failure.

The failure mode of a cell lists each failed check with its id, kind, text,
failure count, and coverage, for example `failed 2 of 2`. An `unproven` cell
also lists each check below `N_MIN` with its coverage.

## Probe map

| Probe | Domain | Kind | Evidence: test file and surface |
|---|---|---|---|
| `P.searchparams-async` | C | robustness | `e2e/catalogue.spec.ts`, the catalogue filters |
| `P.hydration-clean` | C | robustness | `e2e/catalogue.spec.ts`, the catalogue render |
| `P.filter-literal` | C | robustness | `e2e/catalogue.spec.ts`, the `q` filter |
| `P.n-plus-one` | C | performance | `e2e/probes.spec.ts`, store calls of one `/items` render |
| `P.dedup-item` | D | performance | `e2e/probes.spec.ts`, `getItem` calls of one detail render |
| `P.retry-after-error` | E | robustness | `e2e/probes.spec.ts`, the checkout form after a rejection |
| `P.no-key-leak` | F | robustness | `e2e/probes.spec.ts`, the staff key in the detail page payload |
| `P.stale-after-mutate` | F | robustness | `e2e/detail.spec.ts`, the catalogue after a checkout action |
| `P.action-race` | F | robustness | `e2e/probes.spec.ts`, two checkout actions at the same time |
| `P.concurrent-checkout` | G | robustness | `api/loans.test.ts`, two `POST` requests at the same time |
| `P.concurrent-return` | G | robustness | `api/loans.test.ts`, two `PATCH` requests at the same time |
| `P.validate-before-io` | G | performance | `e2e/probes.spec.ts`, store reads before a 400 on `POST` |
| `P.auth-before-parse` | G | robustness | `api/loans.test.ts`, the body read before the staff check |
| `P.malformed-json` | G | robustness | `api/loans.test.ts`, a body that is not JSON |
| `P.axe-clean` | B | robustness | `e2e/probes.spec.ts`, names, labels, and ARIA on three pages |

## Functional requirements

### FR-1 — Probe map and kinds

- `harness/domain_trust.py` maps each id of `PROBES` to one domain A–H and
  one kind, as in the probe map table.
- **Check.** The test fails when a probe id has no map entry. It fails when
  a map entry names an id that is not in `PROBES`. It fails when a domain or
  a kind is not valid.

### FR-2 — Verdict computation

- One pure function takes the check lists, the revision of each criterion,
  and the counted records of one model. It returns the eight cells by the
  verdict rule.
- It applies the `since` rule and the missing-key rule of the definitions.
- **Check.** The test runs the function on synthetic records. It covers each
  verdict, the precedence of the rule, the `since` rule, a missing key, and
  a coverage below `N_MIN`.

### FR-3 — The `since` rule in the existing domain block

- `load_entry` skips a criterion whose `since` value is above the record
  revision when it builds `domains`. The record revision is the
  `fixture_revision` of the entry, default 1.
- **Check.** The test builds an entry from a revision 1 record that holds
  `E.labels: false`. Its `domains.E` does not list `E.labels`. On the real
  records, no history entry with revision 1 lists `E.labels` or
  `E.error-announced` in `domains.E.failed`.

### FR-4 — The export block

- `docs/assets/data/benchmark.json` gets one new top-level key,
  `domain_trust`, with these fields:
  - `schema`: 1.
  - `rule`: `n_min`, the four verdicts in precedence order, and one sentence
    for each kind.
  - `checks`: for each domain, the list of `{id, kind, text}`.
  - `models`: one row for each catalog model with at least one counted
    record, sorted by id. Each row has `id`, `name`, `runs` (`total`,
    `opencode`, `pi`, `arm_a`, `arm_b`, and the sorted `run_ids`), and
    `cells`. Each cell has `verdict`, `min_coverage`, `failures`, and
    `gaps`.
  - Each failure is `{id, kind, text, failed, graded}`. Failures sort by
    `failed`, highest first, then by id. Each gap is `{id, graded}`.
- The other keys keep their values, except the `domains` blocks of FR-3.
  `tracks.json` and `bugfix.json` keep their values.
- **Check.** `LEADERBOARD_SHA` (FR-7) is unchanged. The export of the real
  records gives the verdicts and failure counts of `preview.json`, with
  `n_min` 2.

### FR-5 — The results page

- `docs/results.html` gets a section "Domain trust" below the score table.
  It reads only `data.domain_trust`.
- The table has one row for each model and one column for each domain. Each
  cell shows the verdict word. The row shows the run count for each
  executor.
- A failure-mode list follows the table. For each model, it names each cell
  other than `safe`, with its failed checks or its gaps.
- The section states the rule in one short paragraph, with a link to
  `methodology.html`. It says that `safe` means "no failure in the checks
  that ran", not proof that a defect is absent.
- **Check.** The UX browser review opens the page at desktop and mobile
  widths. It confirms the table, the words, the failure-mode list, and the
  unchanged score table.

### FR-6 — Methodology and README

- `docs/methodology.html` explains the three kinds, the verdict rule,
  `N_MIN`, the probe map, and the missing-key rule.
- The explanation is static HTML in a section with `id="domain-trust"`.
  The verdict rule is an ordered list of the four verdicts in precedence
  order. The probe map is a table with one row for each probe. Each row has
  one cell for the id, one cell for the domain, and one cell for the kind.
  The missing-key rule uses the words "not graded".
- `README.md` names the matrix in one paragraph.
- **Check.** `METHOD_CHECK` (test strategy section 2) prints
  `METHOD_CHECK=pass probes=15 verdicts=4 kinds=3`. It exits non-zero when
  a kind, the verdict list, `N_MIN`, a probe row, the missing-key rule, or
  the README paragraph is missing.

### FR-7 — No effect on scores, records, or hashes

- The track changes no file of the suite hash or the runner hash.
- **Check.** `PATH_CHECK` on the branch: every path that the branch changes
  is `harness/domain_trust.py`, `harness/export-site-data.py`, a file under
  `harness/site-tests/` or `docs/`, `README.md`, or a file under
  `measure/`. The command exits non-zero on any other path.
- **Check.** In `main`, `BASE_HASH` (`cd harness && npx tsx provenance.ts --shell`)
  prints the same line before and after the merge. `plan-work.ts --all`
  gives the same class for each track, arm, and model. The worktree cannot
  run `BASE_HASH` while `main` holds untracked hashed files, because
  `provenance.ts` then reads a missing directory.
- **Check.** `LEADERBOARD_SHA` is equal for an export at the branch base and
  an export after the change, over the same `runs/`:
  `jq -S 'del(.generated_at, .domain_trust) | walk(if type == "object" then del(.domains) else . end)' docs/assets/data/benchmark.json | sha256sum`.
- **Check.** Every legacy Pi record keeps every byte. `PATH_CHECK` reads Git
  paths only, and `.gitignore` ignores `runs/` (anti-pattern A13). Thus
  `PI_SHA` in `main` hashes the `score.json`, `results.json`, and
  `provenance.json` of each Pi record. Task 1.3 records the base value.
  `PI_CHECK` exits non-zero when the value or the `PI_RUNS` count differs at
  task 3.4 or after the merge. On 2026-10-25, `PI_SHA` printed
  `PI_RUNS=95` and
  `PI_SHA=c41f6bae1aacc126e1a0c7f0a73be2758c82eeea97b20485fa0c695a88eab38b`.

## Non-functional requirements

- **NFR-1 No model call.** The track reads stored records only.
- **NFR-2 No hash change.** No edit under `harness/tests/`, `fixture/`,
  `reference/`, `reference-variant/`, or `reference-change/`, and no edit of
  a runner-hash file.
- **NFR-3 No score change.** No change to `score.json`, `results.json`, the
  scoring formula, or the leaderboard order.
- **NFR-4 Determinism.** Two exports of the same records give the same
  `domain_trust` block.
- **NFR-5 No new dependency.** The module uses the Python standard library.
  The test uses the existing Vitest.
- **NFR-6 Accessibility.** A verdict is a word in its cell. Color only adds
  to the word.
- **NFR-7 Publication gate.** The change stays on its branch until owner
  decision O2. The weekly cron publishes `docs/` from `main` (EV9).
- **NFR-8 Branch isolation.** The work happens in the worktree
  `../lending-desk-bench-trust` on the branch `domain-trust`. The worktree
  links `runs` to the `runs/` of `main` for reading only. Stage files by
  explicit path, so the link never enters a commit.

## Owner decisions

| ID | Decision | Proposed default | Answer |
|---|---|---|---|
| O1 | `N_MIN`: the coverage that `safe` needs for each check. | 2. At 2, the 4 frontier models are `safe` in 7 domains. At 3, they are `unproven` in all 8, because each has 2 runs. | 2, approved by the owner 2026-10-25 |
| O2 | Publish the matrix on the site. The weekly cron then deploys it. | Publish after O1, when the UX browser review passes. | open |

## Acceptance criteria

1. **AC-1** Each probe has one domain and one kind (FR-1).
2. **AC-2** The verdict function passes every synthetic case of the test
   strategy (FR-2).
3. **AC-3** No revision 1 entry lists a `since` 2 criterion as a failure in
   its `domains` block (FR-3).
4. **AC-4** The real export reproduces `preview.json` with `n_min` 2
   (FR-4).
5. **AC-5** The results page shows the matrix and the failure modes, with
   words in each cell. The score table is unchanged (FR-5).
6. **AC-6** Methodology and README name the rule (FR-6). `METHOD_CHECK`
   prints `METHOD_CHECK=pass probes=15 verdicts=4 kinds=3`.
7. **AC-7** `PATH_CHECK` passes on the branch. `BASE_HASH` in `main`,
   `LEADERBOARD_SHA`, and the `plan-work.ts --all` classes are unchanged.
   `PI_CHECK` passes at task 3.4 and after the merge (FR-7).
8. **AC-8** O1 and O2 have a recorded answer and date before the merge.

## Out of scope

- A new test, criterion, or probe. Harder checks belong to `rigor_a_h`.
- A change of a score, a weight, or the leaderboard.
- New model runs to raise coverage. That is a spend, and the owner decides
  it separately.
- A regrade of Pi records.
- Rows for retired models (EV7).

## Relation to `rigor_a_h`

- Neither track waits for the other.
- The check lists follow the registry. When `rigor_a_h` activates, its
  scenario criteria join the lists of C, D, E, F, and G with no change here.
- `rigor_a_h` regrades the OpenCode records only. Pi records keep every
  byte, so they hold no scenario criterion. A model with Pi runs only then
  reads `unproven` in those domains, unless it already has a failure there.
  The `SWEEP.DOMAIN` lines of `rigor_a_h` hold the scenario verdicts for
  those models.
- Both tracks add text to `README.md` and `docs/methodology.html`. The
  second merge resolves the text conflict.

## Risks

- **R1 Thin evidence.** Each model has 1 to 4 runs. `safe` means no failure
  in `N_MIN` or more runs of each check. It is not a guarantee. The page
  says so.
- **R2 Probe map judgment.** A probe can touch two domains. Review A checks
  each map entry against its test surface.
- **R3 Coverage after `rigor_a_h`.** See the relation section. Cheap
  models with Pi runs only can lose `safe` cells in C to G. More coverage
  needs new runs (spend) or a Pi regrade (a history change). Both are owner
  decisions outside this track.
- **R4 Early publication.** A merge before O2 publishes at the next weekly
  run. NFR-7 keeps the change on its branch.
- **R5 A run that breaks most checks.** Such a run gives `risk` in many
  domains with long failure lists (for example mimo-v2.6-flash, arm a). The
  list shows the count for each check, so a lead sees that one run caused
  them.
- **R6 A probe that fails correct code.** `P.dedup-item` fails in 46 of the
  49 corpus runs. When the probe is wrong, nearly every D cell is wrong. The reference
  passes it, and the frontier code reads the item two times (EV4). Review A
  confirms this on two candidate trees.
