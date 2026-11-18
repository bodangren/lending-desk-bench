# Model guide: seeded-defect review, real-work outcomes, and the use-this-model table

Spec format: classic FR list. Track type: feature. Base commit: `ea36fae`.
Author model: `claude-code/claude-opus-5-5[1m]#high`. Date: 2026-11-14.
Revision 2, 2026-11-14: the findings F1 to F12 of the spec review round 1.
Revision 3, 2026-11-14: the findings F13 to F23 of the spec review round 2.
Revision 4, 2026-11-18: the PM ruling on the route blocker: the D12 route
list, the D13 pilot routes, the D14 probe mode, the D15 night limits, and the
token log (PM 2026-11-18).

## Summary

The benchmark does not separate the models. The build leaderboard is 88.9
to 95.0, and the tests track is 79.4 to 98.8. The owner wants the project
to tell us which model to use for each kind of our work.

This track adds four parts and one backlog line:

1. **Track A, seeded-defect review.** Real diffs from two public repos of
   the owner get planted defects with a private answer key. Each model
   reviews each diff. The score counts found, missed, and false claims, and
   gives blockers the largest weight. The rank uses the worst of N runs.
2. **Page B, real work.** A page shows the outcome record of our own role
   runs from a sanitized PM export. The page shows the coverage numbers.
3. **The print-audit data point** on page B: one calibration result with
   scores and error types only.
4. **The overview table** "for this kind of work, use this model", with the
   evidence and its date, at the top of the overview page.
5. **The replay track** goes to the backlog of the registry, with no date.

The build track keeps running as the base line. The track `rigor_a_h` stops
(paused). The track `daily_model_schedule` is not part of this track.

## Owner requirement

The PM orchestrator sent the order on 2026-11-14. The words are exact.

> PM ORDER, Lending direction change. Daniel, 11-14: "And our benchmarks are STILL almost all pegged at 100%, even though we attempted to increase the difficulty. We failed in that attempt. We need to do MUCH better on this project. It should tell us what models to use for our work. (And help anyone else who does similar work)"
> Facts: the build leaderboard is 88.9 to 95.0 and the tests track is 79.4 to 98.8. The tracks do not separate the models. The catch-up order of today stays.
> New direction, in this order:
> 1. Stop new difficulty work on the build track. Keep it running as the base line.
> 2. NEW track A, seeded-defect review. Take real diffs from our public repos (monorepo, forge). Plant known defects with an answer key. The model reviews the diff. Score found, missed, and false claims; weigh blockers most; rank by the worst of N runs. Reviews are 1,035 of our 1,833 recorded role runs, so this is the task that matters for us.
> 3. NEW page B, real work. The PM hands you a sanitized export of our outcome record (per model, role, and week: pass, fail, blocking findings, ratings, coverage). File: ~/Desktop/handoff/real-work-outcomes/, with a MANIFEST. Show the coverage numbers on the page.
> 4. Add the print-audit calibration as one data point on page B: a 52-error answer key; k3.1-pro found 11 of 13 blockers, Sonnet 5.5 found 13 of 13. Scores and error types only, no book pages.
> 5. The overview page leads with one table: "for this kind of work, use this model", with the evidence date. Update it each week.
> 6. Models: the routes we use (Claude Sonnet, Kimi, MiniMax M3.1 Flash, DeepSeek Flash, GLM 5.3, StepFun, Go models). Plan and free routes only. No paid spend.
> 7. A replay track (real past tasks with hidden tests) goes to the backlog, with no date.
> Process: one Measure track with a spec review, then Red and Green as usual. Spec by 11-16 18:00. Track A first results by 11-22. Page B as a local preview by 11-18.
> Gate: the first publish of page B goes to Daniel for his look and his word, because it is a new kind of data. After that, the standing push rule applies.

The PM sent the page B hand-off on 2026-11-14. The words are exact.

> File: ~/Desktop/handoff/real-work-outcomes/real-work-outcomes-2026-11-14.json, sha256 dae855cad4bcd29b0623d8a0b8d4eb75aa16a7ddd6688455735bf312df5464f2, MANIFEST.txt next to it.
> Content: per route, role, and ISO week: runs, pass, fail, error, no-result, blocking findings, mean rating per axis, rater agreement; plus an all-time block. No text, paths, ids, or names.
> Coverage (show it on the page): 1,798 runs from 2026-06-06 to 2026-11-13; 50.6 % have a known model, 71.7 % have a result. Ratings sit at 4.0 to 4.8 of 5, so do not rank by ratings alone. Rank by pass rate and blocking findings, with the run count beside each number, and mark routes with fewer than 10 runs.
> Route names stay as written, so #high and [1m] variants are separate rows. Merge them on the page by model, and say so in the method note.
> A fresh export comes each week.

## Owner decisions

The PM decided these points on 2026-11-14. Each decision binds the track.

- **OD1. Q2, the secrecy of the keys.** The answer keys and the seeded diffs
  stay outside the public repository. The repository holds only the SHA-256
  values and the counts. The raw model outputs and the adjudication notes
  also stay outside. This is the default of D9.
- **OD2. Q3, the DeepSeek Flash route.** DeepSeek Flash runs through
  `opencode-go/deepseek-v4.1-flash`. The routes `deepseek/*` are metered and
  are not plan routes. This track never runs a metered route.
- **OD3. Q4, the rank of the checker roles.** The checker roles rank by pass
  rate only. The page shows findings per run beside the rate
  (PM 2026-11-17; replaced by PM 2026-11-18). The checker rows rank by the AA
  net score, then findings per run, then more runs, then the model key
  (PM 2026-11-18).
- **OD4. Q5, the merge on page B.** The merge joins only the `#<variant>`
  rows and the `[1m]` rows of one route. The same model on another provider
  stays a separate row.
- **OD5. F5 and F16, the second judge.** The second judge is "no ready
  route" (the D11 fallback): each disputed finding is left out. Reason:
  every route outside the ranked families of D12 with an AA-Omniscience net
  score of 20 or more is not allowed (Kimi, GPT) or not available (Grok,
  Doubao on Ark). No Opus subagent (owner routing rule). The PM checks again
  before task 4.13 on 2026-11-22. An allowed route with a net score of 20 or
  more, outside the D12 families, then replaces the fallback (PM 2026-11-17).
  A start test runs before the first judge call of that route. The
  orchestrator logs the route that judged each finding. Only the verdicts
  that both judges agree on count. An unclear verdict never takes away the
  rank of a route. The former judge passed its start test on 2026-11-14
  (EV14). The PM replaced that route on 2026-11-16 (PM 2026-11-16). The PM
  decided the rule of two on 2026-11-14 (F16).
- **OD6. Q7, the print-audit error types.** The file
  `~/Desktop/handoff/a23-print-audit-error-types/print-audit-error-types-v13.json`
  holds the error types. Its SHA-256 is
  `f52a7bbf0f4263a84a16dba02cb4ccf4c76b6f40d3e70110104ebbf6140a6e87`.
  `MANIFEST.txt` sits next to it. The file holds 52 rows. Each row holds an
  id, a severity, the checklist items (0 to 3), and the result of each run. A
  checklist item holds a code and a text. 43 rows hold 1 to 3 checklist items
  and 9 rows hold none. The file holds a summary and a bias note. It holds
  types only and no page content. The orchestrator checked the SHA-256 on
  2026-11-14.
- **OD7. F6, the pilot gate.** A defect set whose scores do not spread does
  not go to ranking. The PM wrote that this answers the point of Daniel that
  the scores sit at the top.
- **OD8. The route fact of 2026-11-14.** Daniel turned on Global regions on
  the new OpenCode Go account at about 11:00 on 2026-11-14. The region rule
  stays as a guard: the account rejects a model that is hosted outside
  Europe and the United States. D22 and R9 hold this rule.

## Evidence

The author measured each item on 2026-11-14 with read-only commands.

- **EV1. The hand-off file.** `sha256sum` of
  `~/Desktop/handoff/real-work-outcomes/real-work-outcomes-2026-11-14.json`
  gives `dae855cad4bcd29b0623d8a0b8d4eb75aa16a7ddd6688455735bf312df5464f2`
  (167 451 bytes). `MANIFEST.txt` holds the same value and the size. It also
  holds `source-commit: none (database export, 2026-11-14)` and the line
  `row-counts: source_runs 1834, source_ratings 529, source_findings 4213,
  source_rater_checks 49, exported_runs 1798, weekly_rows 238,
  all_time_rows 141`.
- **EV2. The file shape.** The top keys are `schema`
  (`real-work-outcomes/1`), `generated_on` (`2026-11-14`), `definitions`,
  `coverage`, `weekly`, and `all_time`. A `weekly` row has `route`, `role`,
  `week`, `runs`, `pass`, `fail`, `error`, `no_result`,
  `blocking_findings`, `ratings`, and `rater_checks`. An `all_time` row has
  the same keys, with `work_types` in place of `week`. A `work_types` value
  holds `runs`, `pass`, and `fail` for each work type. A `ratings` value
  holds `mean` and `n` for each axis. `rater_checks` holds `n`, `agreed`,
  and `agreement` (null when `n` is 0).
- **EV3. The definitions block of the file** (exact):
  `pass` = "result pass"; `fail` = "result fail"; `error` = "result error,
  timeout, or abandoned"; `no_result` = "result not recorded";
  `blocking_findings` = "findings with severity blocking"; `week` = "ISO week
  of the run start time, UTC"; `runs` = "run rows; a pick row paired with a
  collected row of the same route counts once".
- **EV4. The coverage block.** `runs` 1798, `runs_with_known_route` 909,
  `share_known_route` 0.506, `runs_with_result` 1290, `share_with_result`
  0.717, `paired_duplicates_left_out` 36, `first_run_date` 2026-06-06,
  `last_run_date` 2026-11-13. The sum of `runs` over `weekly` is 1798, and
  the sum over `all_time` is 1798.
- **EV5. The rows.** The `weekly` block has 10 ISO weeks, 2026-W23 to
  2026-W46. The route `unknown` holds 889 runs and the route `other` holds
  3. The largest named routes are `claude-code/claude-sonnet-5-5#high`
  (204), `minimax-cn-coding-plan/MiniMax-M3.1-Flash` (202),
  `deepseek/deepseek-flash#high` (157), `nvidia/stepfun-ai/step-5-preview#high`
  (57), and `opencode/minimax-m3.1-flash-free#high` (47). Variant pairs
  exist, for example `kimi-code-plan-cn/kimi-for-coding` (32) and
  `kimi-code-plan-cn/kimi-for-coding#high` (25), and four
  `claude-code/claude-opus-5-5` variants.
- **EV6. The roles and work types.** The roles by runs: `review-a` 498,
  `review-b` 257, `review-c` 256, `adversarial` 191, `phase-acceptance` 164,
  `green` 149, `red` 82, `record` 69, `acceptance` 65, `coder` 33,
  `strategy` 23, `final-acceptance` 9, `small` 2. The work types by runs:
  `app code` 1018, `docs and ops` 443, `print books` 226, `tooling` 110,
  `other` 1. The rating axes are `correctness` and `other`.
- **EV7. The two source repos.** `gh` (read-only) shows
  `Reading-Advantage-Thailand/reading-advantage-monorepo` (public, branch
  `master`, head `8bcce8c84d7a868dffa706930a4a3354d554a1e4` at
  2026-11-13T02:45:01Z, languages TypeScript, JavaScript, Python, PLpgSQL,
  Shell, HTML, CSS) and `bodangren/advantage-forge` (public, branch
  `master`, head `c37c21d59e1e350bc82fc81be3387364e0c3a080` at
  2026-10-27T05:30:49Z, primary language TypeScript). Each repo has 100 or
  more commits in the period that this spec uses (D4).
- **EV8. The daily publish.** `harness/cron-daily.sh:599` runs
  `git add docs/`, and `harness/cron-daily.sh:634` commits `docs/`. The job
  then pushes (`harness/cron-daily.sh:657`). So each file under `docs/` goes
  to the public site on the next timer start.
- **EV9. The ignored folders.** `.gitignore` ignores `runs/`, `reports/`,
  `.tmp/`, and `tmp/`. A file in those folders never goes to the site.
- **EV10. The quota read.** `harness/cron-daily.sh:308-330` (`guard_read`)
  reads the OpenChamber endpoint
  `GET http://127.0.0.1:<port>/api/quota/opencode-go`, with the port from
  `openchamber status --json`. It reads `usage.windows.<window>.usedPercent`.
- **EV11. The host isolation.** `harness/opencode-host.sh` gives a job its own
  OpenCode store (`opencode_host_begin`, `opencode_host_run`,
  `opencode_host_cleanup`). `harness/opencode-credential.sh` seeds only the
  Console credential of the `opencode` provider. `harness/run.sh:648-656`
  writes an OpenCode config with deny rules for `question`, `websearch`,
  `subagent`, and `skill`.
- **EV12. The site.** `docs/index.html` is the overview page. Its nav links
  `./methodology.html`, `./results.html`, `./models/`, and `./tracks.html`.
  The data files are in `docs/assets/data/` (`benchmark.json`,
  `bugfix.json`, `tracks.json`). `harness/export-site-data.py` writes
  `benchmark.json`.
- **EV13. The test layout.** `harness/schedule-tests/*.test.ts` run with
  `cd harness && npx vitest run schedule-tests/<file> --configLoader native`.
  They copy scripts into a temp repo and start no model.
- **EV14. The start test of the second judge.** The orchestrator ran a start
  test on 2026-11-14. The route `volcengine-agent-plan/ark-code-latest`
  answered `ARK OK`. That test is the historical record only. The PM
  replaced that route on 2026-11-16 (PM 2026-11-16). Both Ark plans are used
  up until about 2026-11-22: `ark-agent` (monthly quota exceeded) and
  `ark-coding` (error 2056). The arkcli SSO credential has expired. D11
  holds the rule that replaces this route.

## Definitions

- **Route.** A model id as OpenCode names it: `<provider>/<model>`, with an
  optional `[1m]` part and an optional `#<variant>` part. Example:
  `claude-code/claude-opus-5-5[1m]#high`.
- **Model key.** The route without the `#<variant>` part and without the
  `[1m]` part. The provider part stays. Example:
  `claude-code/claude-opus-5-5`.
- **Plan route.** A route that a flat subscription pays for: `claude-code`,
  `kimi-code-plan-cn`, `minimax-cn-coding-plan`, `bailian-token-plan`,
  `volcengine-agent-plan`, `coding-plan`, and `opencode-go`.
- **Free route.** A route with no charge: `opencode/*-free` and `nvidia/*`.
- **Metered route.** Any other route. This track never runs a metered route.
- **Source diff.** The unified diff of one pinned commit of a source repo,
  against its first parent.
- **Plant.** One defect that the fixture author adds to the `+` lines of a
  source diff.
- **Seeded diff.** A source diff with its plants.
- **Answer key.** The private JSON file that lists the plants of one seeded
  diff (D6).
- **Review set.** A fixed group of seeded diffs with one id, for example
  `mg-2026-11a`.
- **Pass.** One review of each diff of one review set by one route.
- **Finding.** One item of the model output (D9).
- **Real defect.** A defect that was in the source diff before the seeding.
- **Private folder.** `$HOME/.local/share/lending-desk-bench/model-guide/`
  (mode 700). It is outside every repository.
- **Producer role.** `green`, `red`, `coder`, `small`, `strategy`, and
  `record`.
- **Checker role.** `review-a`, `review-b`, `review-c`, `adversarial`,
  `acceptance`, `phase-acceptance`, and `final-acceptance`.
- **Preview folder.** `.tmp/model-guide-preview/`. Git ignores it (EV9).
- **Approval record.** `measure/tracks/model_guide/publish-approval.md`. It
  holds the words of Daniel, the date, and the SHA-256 of each file that he
  approved.

## Design decisions

Each decision is a default of the author on 2026-11-14 unless it quotes the
PM. The PM or the owner can change it. The decisions of the PM of 2026-11-14
are in "Owner decisions". Each open owner choice also appears under "Owner
questions".

1. **D1. Track id and title.** The id is `model_guide`. The title is "Model
   guide: seeded-defect review, real-work outcomes, and the use-this-model
   table". One track covers track A, page B, the print-audit data point, the
   overview table, and the backlog line of the replay track. The type is
   feature. The spec format is classic, the same as the other tracks of
   this repository.

2. **D2. The registry.** `measure/tracks.md` gets the row of `model_guide`
   and the line under "Tracks in progress". The row of `rigor_a_h` gets the
   status `paused — PM 2026-11-14: no new difficulty work on the build
   track`, and its line leaves "Tracks in progress". The row of
   `domain_trust` stays as it is. The build track keeps its daily runs as the
   base line. A new section "Backlog" holds the replay track with no date.
   `daily_model_schedule` stays as it is and is not part of this track.

3. **D3. The relation to `domain_trust`.** `domain_trust` gives one verdict
   for each model and each build domain A–H, from synthetic build runs. The
   overview table (D18) answers a different question: which model to use for
   a kind of our real work. Default: `domain_trust` stays as it is. When its
   matrix is on the site, the "app code" row of the overview table links it
   as a second source. The matrix never changes the pick of a row. Owner
   question Q1.

### Track A: the review set

4. **D4. The source diffs.** The source repos are
   `Reading-Advantage-Thailand/reading-advantage-monorepo` and
   `bodangren/advantage-forge` (EV7). The fixture tooling reads them only
   through `gh api` GET calls on the public remote. It never reads a local
   checkout. Each source diff is pinned by the full commit SHA and the parent
   SHA. A commit qualifies when all of these are true:
   - It is not a merge commit, and its committer date is from 2026-08-01 to
     2026-11-13.
   - It changes 1 to 8 files and 40 to 400 lines (added plus removed).
   - At least 60 % of the changed lines are in `.ts`, `.tsx`, `.js`, `.py`,
     or `.sql` files.
   - It changes no lock file, no binary file, no file under `dist/`,
     `build/`, or `generated/`, and no file over 2 000 lines.
   The candidate tool lists the qualified commits, newest first. The choice
   of a diff is rule-based and is not a model choice. The tool takes the
   first qualified commits of the list in that order. It skips each diff
   that a set already holds. It stops at the number of diffs of D8. The
   fixture author never chooses a diff. A rejected candidate gets a reason
   line in the private folder.

   **Pre-registered rule (PM 2026-11-16).** A test-only diff is a source diff
   in which every changed file is a test file. A test file has `.test.` or
   `.spec.` in its base name, or a folder of its path is `__tests__`, `tests`,
   or `test`. Every other diff is a code diff. When the test-only diffs show
   no spread in the pilot (D13), the diff choice changes before the ranked
   runs. Each repo then gives at most 2 test-only diffs in its 7. The
   tool skips each later test-only commit. It takes the next qualified code
   commit in the order above. That change makes the new set id `mg-2026-11b`
   (D8). When the test-only diffs show a spread, nothing changes.

5. **D5. The seeding method.** The PM set the fixture author on 2026-11-16.
   The author is a route of a family outside the ranked list of D12, and it
   is never Opus (Daniel's rule). The PM order of the routes is
   `xai/grok-4.7#high` first. When that route fails on its first call, the
   author is `openai/gpt-6.1-sol#high` with `--allow-codex`, for these two
   seeding sessions only. Codex is the last resort (Daniel 11-06). On
   2026-11-16 the route `xai/grok-4.7#high` failed on its first call
   ("Model xai/grok-4.7 is not available"), so the author is
   `openai/gpt-6.1-sol#high`. The orchestrator logs which route wrote each
   fixture. No ranked route seeds (D12). The author works in a fresh session
   and writes into the private folder only.
   - A plant changes only `+` lines of the source diff, at most 6 lines in
     one place. The seeding tool recomputes each hunk header.
   - Each plant uses one operator of the catalog in D6, and it must be a
     real defect in the context of the diff. Its `witness` is one sentence
     that names an input or a state and the wrong result.
   - A plant does not add a comment or a name that shows the defect.
   - Plants in one diff are at least 8 lines apart.
   - The author writes no plant into a line that the source diff removes.

6. **D6. The defect classes, the operator catalog, and the severity scale.**
   Each plant has one class, one to three accepted classes for the match
   (D10), one operator of the catalog, and one severity.

   | Class | Name |
   |---|---|
   | C1 | Access control |
   | C2 | Data integrity |
   | C3 | Logic |
   | C4 | Error handling |
   | C5 | Input validation |
   | C6 | Data exposure |
   | C7 | Contract |
   | C8 | Test defect |
   | C9 | Performance |

   The catalog below holds every valid operator. The set of names is closed.
   The lint of FR-8 fails when the operator of a plant is not in the catalog
   of its class. Each operator names one change to the `+` lines of a diff.

   - **C1, access control.** `C1-1 remove-role-check`: delete a role or a
     permission check before an action. `C1-2 weaken-role-check`: change the
     required role to a wider set. `C1-3 wrong-owner-check`: compare the
     record owner with the wrong id. `C1-4 missing-owner-check`: skip the
     owner test when the record has no owner. `C1-5 open-route`: expose a
     protected route without a check.
   - **C2, data integrity.** `C2-1 wrong-field-write`: write a value into
     the wrong field. `C2-2 lost-update`: read a value and write back a
     stale value. `C2-3 drop-transaction`: remove the transaction around the
     writes. `C2-4 drop-unique`: remove a uniqueness rule or its index.
     `C2-5 partial-write`: skip the write of one field of a batch.
   - **C3, logic.** `C3-1 invert-condition`: invert a condition. `C3-2
     off-by-one`: move a boundary by one. `C3-3 wrong-comparison`: compare
     with the wrong operator or the wrong value. `C3-4 wrong-default`:
     change the default value of a branch. `C3-5 swap-arguments`: swap two
     arguments of the same type. `C3-6 drop-branch`: remove one branch of a
     conditional.
   - **C4, error handling.** `C4-1 swallow-error`: catch an error and do
     nothing. `C4-2 drop-await`: remove an `await` or a promise return.
     `C4-3 ignore-result`: ignore a failed result of a call. `C4-4
     catch-wrong`: catch a wider or a narrower error type. `C4-5
     success-on-error`: return a success value when a call failed.
   - **C5, input validation.** `C5-1 drop-bound`: remove a range or a length
     check. `C5-2 drop-type-check`: remove a type check. `C5-3 raw-query`:
     build a query from raw input. `C5-4 weak-pattern`: loosen a pattern so
     that it accepts an invalid input. `C5-5 trust-client-flag`: trust a flag
     that the client sends.
   - **C6, data exposure.** `C6-1 log-secret`: write a secret or a token
     into a log. `C6-2 return-secret`: return a secret field in a response.
     `C6-3 over-select`: select more fields than the caller needs. `C6-4
     log-personal-data`: write personal data into a log. `C6-5 expose-in-error`:
     put the input value into an error message.
   - **C7, contract.** `C7-1 rename-field`: rename a field that a caller
     reads. `C7-2 change-return-shape`: change the shape of a return value.
     `C7-3 change-type`: change the type of a returned or a stored value.
     `C7-4 drop-field`: remove a field of a return value. `C7-5 add-required-field`:
     add a required field to a return value.
   - **C8, test defect.** `C8-1 always-true-assert`: change an assertion so
     that it cannot fail. `C8-2 remove-assert`: remove an assertion. `C8-3
     skip-test`: skip a test. `C8-4 weaken-assert`: compare with a wider
     value. `C8-5 wrong-fixture`: use a fixture that does not hold the tested
     state.
   - **C9, performance.** `C9-1 query-in-loop`: run a query inside a loop.
     `C9-2 unbounded-read`: read a whole table without a limit. `C9-3
     missing-order`: remove an order or an index hint. `C9-4 extra-call-per-row`:
     add one extra call for each row. `C9-5 no-pagination`: remove the limit
     of a list query.

   The operator name of a plant is the operator id of the catalog, for
   example `C3-1 invert-condition`.

   The severity scale has three levels, blocker first:
   - **blocker** (weight 5): a review must stop the merge. A security hole,
     data loss or corruption, or a crash or wrong result on the main path.
   - **major** (weight 2): wrong behavior on a normal path, with no data loss
     and no security effect.
   - **minor** (weight 1): an edge case, a performance cost, or a test that
     protects less.

7. **D7. The answer key format.** One private file for each seeded diff,
   `<private folder>/sets/<set_id>/keys/<diff_id>.json`:

   ```json
   {
     "schema": "model-guide-key/1",
     "set_id": "mg-2026-11a",
     "diff_id": "mono-01",
     "source": { "repo": "<owner>/<name>", "commit": "<40 hex>", "parent": "<40 hex>" },
     "seeded_diff_sha256": "<64 hex>",
     "plants": [
       {
         "id": "P1",
         "file": "<path in the repo>",
         "new_lines": [120, 122],
         "class": "C1",
         "accepted_classes": ["C1", "C5"],
         "severity": "blocker",
         "operator": "<catalog operator name>",
         "witness": "<one sentence>"
       }
     ],
     "real_defects": []
   }
   ```

   `new_lines` holds the first and the last line of the plant on the new
   side of the diff. `real_defects` holds the confirmed real defects (D11),
   with the same fields, the class `R`, and the source `adjudication`. The
   seeded diff is `<private folder>/sets/<set_id>/diffs/<diff_id>.diff`.

8. **D8. The size of the first set.** The first review set is `mg-2026-11a`.
   It has 12 seeded diffs, 6 from each source repo, with 3 to 5 plants each.
   It also has 2 control diffs with no plant (1 from each repo). So it has
   14 diffs and 40 to 60 plants. Each source repo gives its first 7
   qualified commits in the D4 order, newest first. The first 6 of each repo
   are seeded, and the 7th of each repo is the control diff with no plant.
   The diff ids are `mono-01` to `mono-07` and `forge-01` to `forge-07` in
   that order, so `mono-07` and `forge-07` are the controls. At least 14
   plants are blockers. Each class C1 to C7 has at least 3 plants. C8 and
   C9 have at least 1 plant each. A set has a fixed content: a change makes
   a new set id.

### Track A: secrecy

9. **D9. Where the secrets live.** This repository and its site are public.
   A later model can learn a key from a public file, and it can also compute
   the plants from a public seeded diff and the public source commit. So the
   seeded diffs, the keys, the raw model outputs, and the adjudication notes
   live in the private folder only. The repository holds only these public
   files:
   - The set manifest `harness/model-guide/data/sets/<set_id>.json`: the set
     id, the creation date, and for each diff the id, the repo, the commit,
     the parent, the SHA-256 of the seeded diff, and the SHA-256 of the key.
     It also holds the plant counts by class and by severity for the whole
     set. It holds no file path and no line of a plant. The SHA-256 of a key
     goes into the manifest after the adjudication apply of D11 adds
     `real_defects` to that key. The orchestrator commits the manifest after
     the apply.
   - The score file `harness/model-guide/data/review-scores/<set_id>.json`
     (D13).
   The leak check (FR-10) runs before each commit of track A data. Each
   model provider sees the seeded diffs in the prompts; risk R2 covers that.
   Owner decision OD1.

### Track A: the review task

10. **D10. The input, the output, and the match.**
    - **Input.** One prompt per diff: the fixed reviewer instruction
      `harness/model-guide/review-prompt.md` (public), the first line of the
      commit message, and the seeded diff. Each line of the diff starts with
      its new-side line number, for example `L120 + const x = ...`. A
      removed line shows `L---`. The model gets no repository, no history,
      and no tool.
    - **Output.** One fenced JSON block:
      `{"findings": [{"file", "line", "severity", "class", "title", "reason"}]}`.
      `severity` is `blocker`, `major`, or `minor`. `class` is `C1` to `C9`.
      The instruction allows at most 30 findings for one diff. The scorer
      reads the first 30 and ignores the rest.
    - **Invalid output.** No JSON block, invalid JSON, or a finding without
      `file` or `line` makes the review of that diff `invalid`. An invalid
      review finds 0 plants and has 0 false claims.
    - **Match.** A finding matches a plant when the `file` is the same path,
      the `line` is from `new_lines[0] - 3` to `new_lines[1] + 3`, and the
      `class` is in `accepted_classes`. One finding matches at most one
      plant. When a finding fits two plants, it matches the nearer one. A
      plant is found when one finding or more match it. A second finding on
      a found plant is a duplicate. A duplicate is neutral.
    - **A wrong line or a wrong class.** A finding outside the line window,
      or with a class that is not in `accepted_classes`, does not count as
      found. The adjudication of D11 cannot make it found. It goes to
      adjudication, and it can only become `real-defect` or `false-claim`.
    - **Unmatched finding.** A finding that matches no plant goes to
      adjudication (D11). It is not a false claim before that check.

11. **D11. The adjudication of unmatched findings.**
    - **The unit.** One finding is the unit of adjudication. Each finding
      gets its own verdict. The tool groups findings that make the same claim
      only to remove duplicates. A group never gets one verdict for all of
      its members.
    - **The judges.** Two judges read each finding. The first judge is the
      route of `ra-quota pick` for a decision role (AA net score 20 or more:
      `claude-code/claude-sonnet-5-5#max` or
      `opencode-go/muse-spark-1.3-contributor#high`), never an Opus subagent
      (owner routing rule, PM 2026-11-17). The second judge is "no
      ready route" (the D11 fallback): each disputed finding is left out.
      Reason: every route outside the ranked families of D12 with an
      AA-Omniscience net score of 20 or more is not allowed (Kimi, GPT) or
      not available (Grok, Doubao on Ark). No Opus subagent (owner routing
      rule). The PM checks again before task 4.13 on 2026-11-22. An allowed
      route with a net score of 20 or more, outside the D12 families, then
      replaces the fallback (PM 2026-11-17). A start test runs before the
      first judge call of that route. The orchestrator logs the route that
      judged each finding. The second judge never reads the verdicts of the
      first judge. Neither judge sees the route name of a finding. The PM
      replaced the former second judge, the ByteDance Doubao route, on
      2026-11-16 (PM 2026-11-16).
    - **The verdicts.** Each judge gives one verdict to each finding:
      - `real-defect`: the defect was in the source diff before the seeding.
        It goes to `real_defects` of the key. It is neutral in the score. The
        page shows the count of real defects found for each route.
      - `false-claim`: the finding names no defect. It counts as a false
        claim.
      - `unclear`: no decision. It is neutral, and the pass is marked
        `provisional`.
    - **The rule of two.** Only a verdict that both judges agree on counts. A
      disagreement counts as `unclear`. An `unclear` verdict never counts
      against the model, and it never takes away the rank of a route. It
      marks the pass `provisional`. The route keeps its rank.
    - **No rescue.** A finding that names a plant at a wrong line or with a
      wrong class never counts as found. There is no `plant:<id>` verdict.
    - **The blind queue.** The tool writes the unmatched findings of each
      diff into the private folder. It groups them by file and a line window
      of 3, so one call covers one diff and every route. A group holds the id
      of each finding and the claim text. It holds no route name.
    - **The hand-off.** The orchestrator reads each `real-defect` verdict and
      sends it to the PM orchestrator as a hand-off, because the defect is in
      another project. This track never writes in a source repo.
    - **The manifest.** `adjudicate.ts apply` writes `real_defects` into the
      key first. The set manifest records the SHA-256 of that key after the
      apply. The orchestrator commits the manifest after the apply.
    - **The lost plant.** A plant that no route finds in the pilot and in
      every run of a complete set goes to the two judges once more. When both
      judges find that it is not a defect, the set gets a new id without that
      plant.

12. **D12. The routes.** The PM names the families (order item 6). Default
    route list for the first set, in this order:

    | Family | Route | Kind |
    |---|---|---|
    | Claude Sonnet | `claude-code/claude-sonnet-5-5#high` | plan |
    | MiniMax M3.1 Flash | `minimax-cn-coding-plan/MiniMax-M3.1-Flash` | plan |
    | DeepSeek Flash | `opencode-go/deepseek-v4.1-flash` | plan (Go) |
    | Hy | `opencode/hy4-flash-free` | free |
    | Go | `opencode-go/mimo-v2.6-flash` | plan (Go) |
    | Go | `opencode-go/muse-spark-1.3-contributor#high` | plan (Go) |

    Three routes leave this list for the set `mg-2026-11a`:
    `kimi-code-plan-cn/kimi-for-coding#high`,
    `bailian-token-plan/glm-5.3#high`, and
    `nvidia/stepfun-ai/step-5-preview#high`. They are not on the allowed
    list (Daniel 11-16) (PM 2026-11-18).

    The PM added the Hy row on 2026-11-16. The route is free until about
    2026-11-30. It gets no build-task or tests-task run.

    The file `harness/model-guide/routes.json` holds this list with the
    fields `family`, `route`, `kind`, `quota_provider`, and `quota_source`.
    The runner refuses a route whose `kind` is not `plan` or `free`. The
    route `deepseek/deepseek-flash#high` of the real-work record is not in
    the list, because it is metered and is not a plan route (OD2). The quota
    source of each route is in D15. The second judge of D11 is not in the ranked
    list. The file holds it with the field `ranked` set to `false`.

13. **D13. The score and the rank.**
    - **Pass score.** `W` = the sum of the weights of all plants of the set.
      `F` = the sum of the weights of the found plants. `X` = the number of
      false claims in the pass. Score = `max(0, 100 × F / W − 2 × X)`, with
      one decimal.
    - **Other numbers for each pass:** blocker recall (found blockers divided
      by blockers), the found, missed, and false-claim counts, the invalid
      reviews, and the real defects found.
    - **N.** N = 3 passes for each route and each set. N stays 3 for every
      route, also for a free route, so that the worst pass of each route
      compares on equal terms.
    - **The pilot gate.** A set goes to ranking only after a pilot. The
      pilot set is `mg-2026-11p`. It has 6 seeded diffs and at least 12
      plants (PM 2026-11-16). The 6 diffs are the first 3 qualified commits
      of each repo in the D4 order, newest first. These are `mono-01` to
      `mono-03` and `forge-01` to `forge-03` of `mg-2026-11a`. The fixture
      author seeds them by the method of D5 to D7. Each pilot seeded diff is
      byte-identical to the seeded diff of the same id in `mg-2026-11a`,
      with the same seeded-diff SHA-256. The pilot key holds the same
      plants; only its `set_id` differs. The pilot set is separate from the
      ranked set `mg-2026-11a`. A reseed makes a new set id: `mg-2026-11p2`,
      then `mg-2026-11p3`. Each reseed keeps the same 6 source commits and
      seeds them again by the harder rule of this gate. That rule holds only
      when the test-only rule of D4 does not fire.
      The pilot report of task 4.11 (2026-11-21) gives, for each pilot route,
      the found, missed, and false-claim counts and the worst-of-2 score of
      each diff kind: the test-only diffs and the code diffs. The score of a
      kind uses the pass-score formula above on the plants of that kind only.
      The test-only diffs show no spread when the best worst-of-2 score of the
      kind minus the lowest worst-of-2 score of the kind is below 20 points.
      When the test-only diffs show no spread, D4 changes before the ranked
      runs. The next pilot set `mg-2026-11p2` then takes the first 3 diffs of
      each repo under the changed rule. It therefore does not keep the same 6
      source commits.
      The pilot runs 3 routes with 2 passes each (PM 2026-11-16), so each
      route has a worst-of-2 score. The pilot routes are
      `opencode/hy4-flash-free`, `opencode-go/deepseek-v4.1-flash`, and
      `opencode-go/mimo-v2.6-flash` (PM 2026-11-18). No Claude route and no
      MiniMax route is in the pilot (PM 2026-11-18). A pilot route that is
      unreachable or region-blocked is replaced by the next route of D12.
      The Kimi route is replaced when it is in wait (spec D15) at 02:00 on a
      pilot night. The next route of D12 after MiniMax M3.1 Flash takes its
      place: `opencode-go/deepseek-v4.1-flash`. Kimi gets its passes after
      its reset, on the night of 2026-11-22. When Kimi has fewer than 3
      passes after that night, it shows `incomplete` and gets no rank
      (PM 2026-11-16; replaced by PM 2026-11-18).
      The set goes to ranking only when both rules hold:
      - The best worst-of-2 score minus the lowest worst-of-2 score is 20
        points or more.
      - The best worst-of-2 score is below 90.
      A set that fails a rule does not go to ranking. The fixture author
      seeds a harder pilot set with the next set id. The harder set has
      plants of 2 to 6 lines, and at least half of its plants have the
      classes C1, C2, C5, or C7. The pilot runs again. After 2 reseeds the
      orchestrator sends the set to the PM. This gate answers the point of
      Daniel that the scores sit at the top (OD7).
    - **The pilot passes count.** When the pilot set passes the gate with no
      reseed, and the ranked set `mg-2026-11a` holds the same 6 diffs, the
      passes of the pilot set count as main passes of the same route. Each
      pilot route then needs 1 more pass for its 3 passes.
    - **The dates of the pilot.** The pilot runs on the nights of 2026-11-20
      and 2026-11-21, with one pass for each pilot route on each night. Each
      other reachable route gets its passes on the nights of 2026-11-20 to
      2026-11-22. Each pilot route gets its last pass on the night of
      2026-11-22. So the first track A results still land by 2026-11-22
      (D20). A reseed does not fit before 2026-11-22. The orchestrator tells
      the PM the new date, and the page shows `incomplete` for each route
      without 3 complete passes. The Kimi substitution rule above is part of
      D13 (PM 2026-11-16; replaced by PM 2026-11-18).
    - **Rank.** The rank uses the worst pass score of the N passes. A tie
      goes to the higher worst blocker recall, and then to the higher median
      score. A route with fewer than 3 complete passes shows `incomplete` and
      has no rank. A `provisional` pass stays complete and does not remove
      the rank.
    - **Transport errors.** No response, a provider error, a timeout of
      600 s, or a quota stop is not a model result. The runner tries the diff
      again up to 2 times. When all three tries fail, the pass stays open and
      is not complete.
    - **Score file.** `harness/model-guide/data/review-scores/<set_id>.json`
      holds, for each route and pass: the date, the numbers above, and the
      counts by class and severity. It holds no finding text, no file path,
      and no line.
    - **Tokens (PM 2026-11-18).** Each pass record and each probe record
      holds `"tokens": {"input", "output", "reasoning", "cache_read",
      "cache_write", "total"}`. The values are the sums over the model calls
      of the pass, read from the token fields of the opencode json events. A
      call with no token field adds 0 and sets `"tokens_complete": false`.
      Each diff entry of the record holds its own `tokens` object.
    - **Review page.** The page `review.html` shows the rank, the worst,
      median, and best pass score, the blocker recall, the false claims, the
      real defects found, and the counts by class and severity. Its data file
      is `review.json`, a copy of the score file. The page also shows the
      set manifest counts and a method note for D4 to D13.

### Track A: the executor

14. **D14. How a run reaches a route.** All routes use one path: the host
    OpenCode with the host isolation of `harness/opencode-host.sh` (EV11).
    - The runner `harness/model-guide/review-run.sh` starts a job folder with
      `opencode_host_begin model-guide`. It removes the folder with the trap
      of `opencode_host_cleanup`.
    - The seed copies the credential of the route provider only, through
      the new helper `harness/model-guide/provider-credential.sh seed
      <provider>`. It reads the shared store once per job folder, with the
      same `opencode auth export` call and retry rule as
      `harness/opencode-credential.sh`. It never prints a value. The track
      does not change `harness/opencode-credential.sh`, because
      `harness/provenance.ts:71` puts that file in the `runner_sha256` list,
      and a change would change the hash of the build base line.
    - Each call is `opencode run --standalone --format json --model <route>`
      with the prompt of D10, through `opencode_host_run`.
    - The job config denies every tool: `read`, `edit`, `bash`, `webfetch`,
      `websearch`, `question`, `subagent`, and `skill`.
    - The runner scans each raw output for the credential values of the
      provider (`provider-credential.sh scan-values <provider>`) before it stores the
      output. A hit deletes the output and stops the pass.
    - The first task of Phase 4 is a probe: one call per route with a
      control diff. A route that fails the probe is `unreachable`. A Go route
      that fails with the region error of D22 is `region-blocked`. The
      orchestrator sends the error line to the PM. Owner question Q8 covers
      the Claude route, which can need the shared `HOME`.
    - **Probe mode (PM 2026-11-18).** `review-run.sh --probe` makes exactly
      one model call on the first control diff of the set (a diff with no
      plant, spec line about 423). It writes no pass record and no stored raw
      output beyond the probe record. It prints one line
      `<route> reachable|unreachable|region-blocked <error line or ->` on
      stdout. It gives exit 0 for `reachable`, exit 3 for `unreachable` or
      `region-blocked`, and exit 2 for a refusal. The probe uses the same
      lock, quota rules, job isolation, credential scan, and trap as a pass.
      The probe runs 02:00 to 06:00 +07 on 2026-11-19 through
      `heavy-run.sh`, with one call per route of `routes.json`.

15. **D15. The quota budget.** The runner reads the quota of the route
    provider before each pass and before each diff.
    - **The live source of each provider.** The source is the OpenChamber
      endpoint `GET http://127.0.0.1:<port>/api/quota/<id>`, with the port
      from `openchamber status --json`. The read gives
      `usage.windows.<window>.usedPercent`, as in EV10.

      | Provider of the route | `<id>` | Quota source |
      |---|---|---|
      | `claude-code` | `claude` | OpenChamber `GET /api/quota/claude` |
      | `kimi-code-plan-cn` | `kimi-for-coding` | OpenChamber `GET /api/quota/kimi-for-coding` |
      | `minimax-cn-coding-plan` | `minimax-cn-coding-plan` | OpenChamber `GET /api/quota/minimax-cn-coding-plan` |
      | `opencode-go` | `opencode-go` | OpenChamber `GET /api/quota/opencode-go` |
      | `nvidia`, `bailian-token-plan`, `volcengine-agent-plan`, `opencode` free routes | none | none |

    - **The state of each route.** The quota read gives one state for each
      route. The states are `ready`, `wait`, and `stopped`.
      - `ready`: every window is below 70 %.
      - `wait`: a window is 70 % or more. No pass starts. The route waits
        for the next night.
      - `stopped`: the source gives a quota error, a limit error, a read
        failure, a source with no value, a missing field, or a value that is
        not a number. The route stops for the night.
    - **The rules.** A pass starts only when the state is `ready`. The pass
      stops when a window reaches 80 %, and it marks the pass open. A route
      with no quota source runs at most 1 pass per night. It stops at the
      first quota or limit error.
    - **Night limits (PM 2026-11-18).** The orchestrator stops the night's
      runs when the Go 5-hour window is over 95 % or the Go week is over
      90 %. The runner's own rules (no start at 70 %, stop at 80 % of a
      window) stay and are stricter for one route; the night limit covers
      the whole night.
    - **The window.** The track A window is 02:00 to 06:00 +07. One night
      runs at most one pass for each route. The routes run one at a time, in
      the order of D12.
    - Each pass runs through
      `/home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh`. The
      orchestrator starts it. This track adds no timer.
    The 30 % margin is for the work roles of the day.

### Page B

16. **D16. Page B.** The page is `real-work.html`. Its data file is
    `real-work.json`. The tool `harness/model-guide/real-work.ts` writes
    both from one hand-off file (replaced by Data source, PM 2026-11-17).
    - **Input check.** The tool takes the path of the JSON file. It reads
      `MANIFEST.txt` next to it. It stops with exit 2 when the SHA-256 or the
      size differs from the manifest, when `schema` is not
      `real-work-outcomes/1`, or when a run sum differs from
      `coverage.runs`. It never copies the input file into the repository
      (replaced by Data source, PM 2026-11-17).
    - **Source line.** The page shows the file name, its SHA-256, and
      `generated_on`. These values sit in the "About this data" footer
      (PM P1 2026-11-16; replaced by Data source, PM 2026-11-17).
    - **Coverage block.** The page shows the runs, the date range, the share
      with a known model, the share with a result, and the left-out paired
      duplicates. It also shows the runs of `unknown` and `other`. The block
      sits in the "About this data" footer (PM P1 2026-11-16; replaced by
      Data source, PM 2026-11-17).
    - **Merge.** Rows with the same model key merge by sums. The merge joins
      only the `#<variant>` rows and the `[1m]` rows of one route. The same
      model on another provider stays a separate row (OD4). The page lists
      the routes of each merged row in a small second line or a tooltip, not
      in a Routes column (PM P1 2026-11-16). The method note says: "Route
      names stay as written in the record, so #high and [1m] variants are
      separate routes. This page merges them by model." `unknown` and
      `other` do not merge and get no rank.
    - **Role groups.** The page has one table for producer roles and one
      table for checker roles.
    - **Work-type tables.** The page has one table for each work type of
      `work_types` (replaced by Data source, PM 2026-11-17). Each table sits
      in a tab or a collapsed section (PM P1 2026-11-16). The `all_time`
      block gives one row for each route, role, and work type. A work-type
      row sums the role rows of that route and work type. Each `work_types`
      value holds `runs`, `pass`, and `fail` only. These tables use that data
      and no other data.
      - **The pass rate of a work type.** `pass / (pass + fail)`. A row with
        `pass + fail` of 0 has no rate.
      - **The result count.** The Runs column shows `pass + fail`
        (PM P1 2026-11-16).
      - **The minimum.** A row with fewer than 10 results (`pass + fail`)
        gets the mark `few runs`. The mark counts results, not export runs
        (`runs`). It goes into the collapsed group "Too few runs to rank"
        under its table, with no rank number, and it never picks
        (PM P1 2026-11-16).
      - **The rank.** The higher pass rate first, then the higher result
        count. Only rows with 10 or more results get a rank number
        (PM P1 2026-11-16).
      - **Blocking column.** The export has no blocking findings for a work
        type. These tables drop the Blockers per run column and the error
        count (PM P1 2026-11-16, PM 2026-11-17).
      - **No data.** A work type with no qualifying row says "no pick yet".
    - **Pass rate.** `pass / (pass + fail + error)`. `no_result` stays out
      of the rate. The page shows it in its own column behind the "More
      columns" toggle (PM P1 2026-11-16; replaced by Data source,
      PM 2026-11-17).
    - **Blocking rate.** Blocking findings for each run with a result. The
      column "Blockers per run" shows this value as a number with two
      decimals, for example 1.64, and never as a percent (PM 2026-11-17;
      replaced by Data source, PM 2026-11-17).
    - **Rank.** Producer table: the higher pass rate first, then the lower
      blocking rate. Checker table: the higher pass rate first. The checker
      table shows the blocking rate, but the rank does not use it, because a
      checker that finds more blockers is not worse (OD3). Each rate shows
      as a whole percent, and the Runs column holds the result count
      (PM P1 2026-11-16; replaced by Data source, PM 2026-11-17).
    - **Small samples.** A merged row with fewer than 10 runs with a result
      gets the mark `few runs` and goes into the collapsed group "Too few
      runs to rank" under its table. It gets no rank number and it never
      picks. A route with fewer than 10 runs always has fewer than 10 runs
      with a result, so this rule covers the PM rule (PM P1 2026-11-16;
      replaced by Data source, PM 2026-11-17).
    - **Ratings.** The Rating column shows one value: the mean of the axis
      means, with one decimal, of 5. Each axis mean and its `n`, and the
      rater agreement with its `n`, sit behind the "More columns" toggle.
      The rank never uses a rating (PM P1 2026-11-16; replaced by Data
      source, PM 2026-11-17).
    - **Trend.** One column shows the pass rate of the last 4 ISO weeks of
      the `weekly` block, as a whole percent. The Runs column holds the run
      count (PM P1 2026-11-16; replaced by Data source, PM 2026-11-17).
    - **Layout (PM P1 2026-11-16).** This block replaces the display rules
      above that it names. The data rules stay: the input check, the merge,
      the rates as formulas, the rank order, and the 10-result minimum
      (replaced by Data source, PM 2026-11-17).
      - **Top block.** The top block comes first, above every table. For
        each role group (producer, checker) and each work type, one line
        gives the recommended model, its pass rate in whole %, and its
        result count. The recommended model is rank 1 among the rows with
        10 or more results. With no such row, the line says "no pick yet".
        The block fits one screen at 390 px (replaced by Data source,
        PM 2026-11-17).
      - **Names.** Each row shows a plain model name, for example
        "Kimi K3.1", "DeepSeek V4.1 Flash", or "MiniMax M3.1 Flash". The
        file `harness/model-guide/data/model-names.json` maps each model key
        to its public name. A key with no name shows the key without its
        plan prefix. The route shows only in a small second line or a
        tooltip. The default view has no Routes column.
      - **Rank display.** Only rows with 10 or more results get a rank
        number. Rows with fewer results sit in the collapsed group "Too few
        runs to rank" under their table, with no rank number. They never
        pick (replaced by Data source, PM 2026-11-17).
      - **Default columns.** The default table shows Model, Runs, Pass %,
        Blockers per run, Rating, and Trend, so 6 columns or fewer. A
        work-type table drops Blockers per run, because the data has no
        blocking findings (PM 2026-11-17; replaced by Data source,
        PM 2026-11-17).
        The other columns sit behind a "More columns" toggle: routes, pass,
        fail, error, no result, blocking count, each rating axis with its
        `n`, and the agreement with its `n` (replaced by Data source,
        PM 2026-11-17).
      - **Numbers.** A rate shows as a whole % with no decimals. A
        blockers-per-run value shows a number with two decimals, for example
        1.64, and no % sign (PM 2026-11-17). Runs shows the result count, so
        no "(n=...)" text sits beside a rate. Rating shows one value, the
        mean of the axis means, with one decimal, of 5. An empty value shows
        a dash ("–"), never a sentence (replaced by Data source,
        PM 2026-11-17).
      - **Work-type sections.** Each work type sits in a tab or a collapsed
        section. The page is about 3 screens long at 1280 px (replaced by
        Data source, PM 2026-11-17).
      - **Footer.** The source line, the coverage block, and the merge
        method note move into a short "About this data" footer. The footer
        comes after the tables. The source line and the coverage block are
        replaced by Data source, PM 2026-11-17.
      - **Width.** The page has no horizontal overflow at 390, 980, or
        1280 px. A wide table scrolls inside its own box and shows a visible
        scroll hint.
      - **Look.** The page uses the look of `docs/results.html`: the same
        fonts, card style, and header, from `docs/assets/css/site.css`.
    - **Data source (PM 2026-11-17).** This block replaces the input of
      page B: the real-work-outcomes export, its `work_types`, and its
      blocking data. Each D16 rule that it replaces carries the mark
      "(replaced by Data source, PM 2026-11-17)".
      - **Inputs.** The page B data comes from three dated data files in
        `harness/model-guide/data/`.
        - `ra-outcomes-2026-11-17.json`: the output of
          `~/Desktop/advantage-pr/scripts/jobs/ra-quota outcomes --json`.
        - `aa-reliability-2026-11-17.json`: a copy of
          `~/Desktop/advantage-pr/measure/reference/aa-reliability-2026-11-17.json`.
        - `allowed-routes-2026-11-17.json`: only the fields `allowedRoutes`
          and `orchestratorRoutes` of `~/.config/ra-quota/routes.json`.
        `MANIFEST-2026-11-17.txt` lists each file with its SHA-256 and its
        size. The tool stops with exit 2 when a SHA-256 or a size differs.
        `leak-check.ts` covers the three files. The footer shows each file
        name, its SHA-256, and the read date.
      - **Route key.** The tool strips each route string at the first " ("
        and trims it, because some routes carry free-text notes. The model
        key is the route without `#<variant>` and `[1m]` (the existing merge
        rule). The route `unknown` does not show in the tables or the top
        block, gets no rank, and never picks. The footer shows its row count
        and share (orchestrator 2026-11-17).
      - **Counts.** A row of kind `producer` counts its `tasks`. A row of
        kind `gate` counts its `decided`. `no_verdict` runs and open runs
        never count in a rate.
      - **Producer table.** The table holds the rows of kind `producer`. A
        row with `tasks` 0 does not show. Rows merge by model key over the
        routes and the producer roles. `tasks` and `accepted` are sums.
        First-round accept % = `sum(first_round_rate × accepted) /
        sum(accepted)`, over the rows with a rate. Rework =
        `sum(mean_rework_rounds × tasks) / sum(tasks)`, one decimal.
        Cleanup % = `sum(cleanup_share × tasks) / sum(tasks)`. Tokens per
        accepted task = `sum(tokens_per_accepted × accepted) /
        sum(accepted)`, in whole thousands, for example "343k". Each average
        uses only the rows where its value is not null. The default columns
        are Model, Tasks, First-round accept %, Rework, Cleanup %, and
        Tokens per accepted task. The more-columns view holds routes, roles,
        accepted, and AA net score. The rank holds the rows with 5 tasks or
        more and a first-round rate: the higher first-round accept % first,
        then the lower rework, then more tasks. The other rows sit in the
        collapsed group "Too few tasks". The page shows no self-graded
        producer pass rate (PM finding C144).
      - **Checker table.** The table holds the rows of kind `gate`. Rows
        merge by model key over the routes and the gate roles. Runs = the
        sum of `decided`. Pass % = `sum(pass) / sum(decided)`. Findings per
        run = `sum(findings) / sum(decided)`, two decimals. Escapes = the
        sum of `escapes`. The default columns are Model, Runs, Pass %,
        Findings per run, Escapes, and Net score. The rank holds the rows
        with 5 runs or more: the higher AA net score first; a row that is not
        rated ranks after every rated row; then the higher findings per run;
        then more runs; then the model key in ascending order, A to Z
        (replaced by PM 2026-11-18; tie-break direction orchestrator
        2026-11-18). The other rows sit in "Too few tasks". The Pass % column
        stays, and the checker table text says: "A high pass % does not mean
        a good checker." (PM 2026-11-18). Findings per run replaces Blocking %
        and Blockers per run on page B. Escapes take no part in any rank. When
        the sum of escapes over all gate rows of the outcomes file is 0,
        every Escapes cell shows "no data", because there is no escape data
        yet; otherwise a cell shows the number. The rule covers every Escapes
        cell of the checker table, in the ranked rows and in "Too few tasks"
        (PM 2026-11-18; cell scope orchestrator 2026-11-18).
      - **AA net score.** The tool takes the last path part of the model
        key, in lower case, and removes a "-free" suffix. It matches that
        name to a model key or an alias of the AA file. A merged row uses
        the variant of its route with the most counted runs:
        `byEffort[<variant>]` when that entry is present, else the primary
        row. No match, or rated false, gives "not rated". A model with a net
        score under 20, or not rated, carries the mark "not for verdicts".
      - **About this data (PM 2026-11-18).** The footer adds: "The record does
        not hold the effort level of each run. The net score uses the effort
        level of the route with the most runs, so a model can score higher at
        another effort level (for example Claude Sonnet 5.5 at #max)."
      - **Allowed list.** A model key is allowed when it equals an entry of
        `allowedRoutes` or `orchestratorRoutes` after the same stripping of
        `#<variant>` and `[1m]`. A row that is not allowed stays in its
        table with the mark "not allowed" and never picks.
      - **Top block.** One line per role, in this order: Red, Green, Coder,
        Review A, Review B, Review C, Adversarial, Acceptance, Phase
        acceptance, Final acceptance. Each line starts with its role label
        and a colon (orchestrator 2026-11-18). Each line uses only the rows of
        that role, merged by model key. The pick is rank 1 among the rows that
        meet the minimum of 5, that are allowed, and, for a gate role, that
        have a net score of 20 or more. A gate role picks inside the rows of
        that role, in the checker rank order of the Checker table
        (PM 2026-11-18). Each line shows the numbers of that role only, with
        the label "in this role" (PM 2026-11-18; the role, name, rate, and
        count form is replaced). A producer line has the form "<role label>:
        <plain name> <rate> % in this role, <count> tasks". A gate line has
        the form "<role label>: <plain name> <pass rate> % pass in this role,
        <count> runs, net <net score>". A line with no pick has the form
        "<role label>: no pick yet" (the three forms: orchestrator
        2026-11-18, fix of the PM 2026-11-18 forms). The net score shows as
        in the Checker table.
      - **Work types.** The new export has no work-type split. The work-type
        sections leave page B.
      - **Width.** At 390 px the model name cell takes the free width of
        its table: the number columns do not wrap and stay narrow, so a
        model name does not wrap to 3 lines.
      - **Coverage.** The footer shows the row count, the route count, the
        share of rows with the route `unknown`, and the export date.
      - **Tool details (orchestrator 2026-11-17).**
        - **CLI (Q-S1).** `real-work.ts` and `preview.sh` take
          `--manifest <path of MANIFEST-<date>.txt>`. `update.sh` takes the
          manifest path as its one positional argument (D19). The tools read
          the three dated files next to the manifest. The old `--input` and
          `--export` form is removed. There is no legacy flag (Q-S12).
        - **MANIFEST format (Q-S2).** One line per file,
          `<sha256>  <size>  <file name>`, for the three dated files only.
        - **Refusal (Q-S3).** The tool exits with 2 and writes no output
          file. It writes one stderr line,
          `input-check: <check> <file name>`. The checks are manifest,
          input, sha256, size, json, and schema.
        - **Dates (Q-S4).** The read date and the export date are the date
          in the MANIFEST file name.
        - **Coverage (Q-S5).** The route count is the count of distinct
          stripped route strings, with `unknown` included. The `unknown`
          share shows one decimal.
        - **Pick (Q-S6).** The pick of a top line is the first row in rank
          order that passes the filters of rule 8.
        - **AA lookup (Q-S7).** The tool reads only the `models` block of
          the AA file.
        - **Mark (Q-S8).** The mark "not for verdicts" shows on the model
          rows of both tables, checker and producer, because rule 6 marks
          the model.
        - **Producer rows (Q-S9).** A producer row with 5 or more tasks and
          no first-round rate goes in "Too few tasks".
        - **The route `unknown` (Q-S10).** Its rows do not show in the
          tables or the top block. Only the footer shows its row count and
          share.
        - **Print-audit names (Q-S13).** The page maps the route keys to
          plain names at render time. The print-audit data file keeps the
          raw keys. `print-audit.ts` and its test do not change.
        - **guide.ts and update.sh (strategy plan gap).** `guide.ts` reads
          the new `real-work.json` schema of the Data source block, with no
          `work_types`. The D18 rows that have no page B source use their
          second source or "no pick yet". `update.sh` runs the new input
          check and the manifest form of the CLI rule.

17. **D17. The print-audit data point.** The file
    `harness/model-guide/data/print-audit-2026-11.json` holds the
    print-audit calibration of the hand-off file of OD6.
    - **The input.** The source is
      `~/Desktop/handoff/a23-print-audit-error-types/print-audit-error-types-v13.json`
      with the SHA-256
      `f52a7bbf0f4263a84a16dba02cb4ccf4c76b6f40d3e70110104ebbf6140a6e87`
      and `MANIFEST.txt` next to it. The input check reads the SHA-256 from
      `MANIFEST.txt` and the shape of the file. The shape is the top keys
      `source`, `note`, `routes`, `summary`, and `errors`, and 52 rows in
      `errors` with the fields that the file holds. A mismatch gives exit 2
      and no output file. This check has no size test and no schema-key test.
      The input file never enters the repository.
    - **The content.** The file holds the key size of 52 errors, the blocker
      count of 13, the error types with the count of each type, the checklist
      items (0 to 3) of each error with the code and the text of each item,
      the result of each run, the summary, and the bias note. The two results
      are "Kimi K3.1 Pro" 11 of 13 blockers and "Claude Sonnet 5.5" 13 of 13
      blockers, as plain names (PM 2026-11-17).
    - **The page.** The block on page B shows the two results, the error
      types with their counts, and the bias note. The block shows a plain
      model name for each result, from
      `harness/model-guide/data/model-names.json` (PM 2026-11-17). The rule
      is the same as D16: a key with no name shows the key without its plan
      prefix, and a `#<variant>` suffix of a route maps to the name of its
      model key. The page maps the route keys to plain names at render time,
      and the print-audit data file keeps the raw keys. `print-audit.ts` and
      its test do not change (orchestrator 2026-11-17). The block holds no
      raw route key, no book text, no page, and no file name. The block says
      that the data point is one calibration run, not a rank.
    - **No placeholder.** The block always shows the error types. The line
      "Error types: not yet received." does not exist in this track.

### The overview table

18. **D18. The table "for this kind of work, use this model".** The data
    file is `model-guide.json`. The tool `harness/model-guide/guide.ts`
    writes it. The overview page shows it first, above the current hero.
    - **Rows (kinds of work).** Code review; app code; test writing; docs and
      ops; print-book audit; tooling.
    - **Columns.** Kind of work; use this model; second choice; evidence;
      evidence date.
    - **Names (accepted by the PM 2026-11-17 after audit).** The pick cells
      use the plain model names from
      `harness/model-guide/data/model-names.json`. A key with no name shows
      its key without the plan prefix.
    - **Sources for each row (PM 2026-11-17).**

      | Row | First source | Second source |
      |---|---|---|
      | Code review | track A rank (worst of N) | page B checker table |
      | App code | none | build base line |
      | Test writing | page B producer table, role `red` | tests track base line |
      | Docs and ops | none | none |
      | Print-book audit | none | print-audit data point |
      | Tooling | none | none |

      The new export has no work-type split, so the rows App code, Docs and
      ops, Print-book audit, and Tooling have no page B source. Each of those
      rows uses its second source. A row with no second source says "no pick
      yet" (PM 2026-11-17).
    - **Pick rule.** The first source picks the first and the second choice
      from its rank. A model qualifies with 5 tasks or more in a producer
      row, with 5 runs or more in a gate row, or with a complete rank (track
      A). A gate row also needs an AA net score of 20 or more. A model that is
      not allowed never picks, and a row with the mark "not for verdicts"
      never picks in a gate row (PM 2026-11-17). The second source of the Code
      review row, the page B checker table, follows the checker rank order of
      D16: the AA net score first, then findings per run, then more runs, then
      the model key (PM 2026-11-18). When the first source has no
      qualified model, the second source picks. When neither has one, the
      cell says "no pick yet: not enough evidence".
    - **Overview text (PM 2026-11-18).** The overview section text
      `harness/model-guide/pages/guide-section.html` says that a model needs
      5 tasks or runs, as this decision says, not 10.
    - **Ruling Q1 (PM, 2026-11-15).** The Test writing row uses the page B
      producer table as a whole while `real-work.json` has no role key. The
      evidence cell starts with "page B producer". A red-only table comes
      when the export carries the role.
    - **Ruling Q2 (PM, 2026-11-15).** The plan line "Verify (Phase 2)" wins.
      While track A has no complete rank, the Code review row shows "no pick
      yet: not enough evidence". The page B checker table does not pick for
      code review before Phase 4, because a checker pass rate measures the
      checked work, not the review skill.
    - **Evidence cell.** The source, the number, and the count, for example
      "page B: accept 86 %, 114 tasks". The number is the first-round accept %
      for a producer source and the pass % for a gate source (PM P1
      2026-11-16, PM 2026-11-17).
    - **Evidence date.** The export date of the outcomes file, or the date of
      the last complete pass of track A, for each row (PM 2026-11-17).
    - **Base line.** The build and tests scores never pick. They show beside
      the pick as a check. The `domain_trust` link follows D3.

19. **D19. The weekly update.** The PM sends a new export each week. The
    orchestrator runs `harness/model-guide/update.sh <path of
    MANIFEST-<date>.txt>`. The tool reads the three dated files next to that
    manifest. It runs the input check of the Data source block of D16, writes
    `real-work.json`, and writes `model-guide.json` (PM 2026-11-17).
    Before the approval (D21), it writes into the preview folder. After the
    approval, it writes into `docs/assets/data/`, and it commits the two data
    files with explicit paths. The standing push rule then applies. A table
    whose newest evidence date is more than 14 days old shows the mark
    `stale`.

### Gates and dates

20. **D20. The dates.**
    - The spec review runs before the first Red task. The reviewer uses a
      model family other than the author family (Claude).
    - Spec: Mon 2026-11-16 18:00 +07.
    - Page B local preview: Wed 2026-11-18, in the preview folder.
    - Track A first results: Sun 2026-11-22, in the preview folder.
    - The replay track: the backlog, with no date.

21. **D21. The publish gate.** Before the approval record exists, no tool of
    this track writes a file under `docs/`, because the daily job commits
    and pushes `docs/` (EV8). The preview tool copies `docs/` into the
    preview folder and adds the new pages and the overview table there. The
    preview records the SHA-256 of each copied file of `docs/` in the file
    `preview-base.json` of the preview folder. The first publish holds page
    B, the overview table, and the track A results together, so Daniel looks
    once. The orchestrator sends the preview to Daniel through the PM. When
    Daniel gives his word, the orchestrator writes the approval record. The
    publish tool checks that the SHA-256 of each file in the preview equals
    the value in the record. Then it copies the files into `docs/`. After that
    first publish, the standing push rule applies.
    - **The drift check.** Before the publish, the tool compares the current
      files of `docs/` with the base of the preview. It reads the SHA-256 of
      each current file and compares it with `preview-base.json`. When a
      current file differs from its recorded value, the tool refuses with
      exit 2, names each drifted file, and writes nothing. The orchestrator
      builds the preview again. Daniel gives his word again when a drifted
      file is in the approved set.

22. **D22. The region rule of the Go routes.** Daniel turned on Global
    regions on the new OpenCode Go account at about 11:00 on 2026-11-14. The
    rule stays as a guard: the account rejects a model that is hosted outside
    Europe and the United States (OD8). A Go route that returns this error
    has no rank for that night. The runner marks the route state
    `region-blocked` and stops the route for the night. The probe of D14
    records the same state. The orchestrator sends the state to the PM. The
    Go routes of D12 that are affected by this rule are
    `opencode-go/deepseek-v4.1-flash`, `opencode-go/mimo-v2.6-flash`, and
    `opencode-go/muse-spark-1.3-contributor#high`.

## Functional requirements

### FR-1 — The hand-off input check

`harness/model-guide/real-work.ts` runs the input check of the Data source
block of D16. It takes `--manifest <path of MANIFEST-<date>.txt>` and reads
the three dated data files next to the manifest. A failed check gives exit 2,
one stderr line that names the check and the file, and no output file. The
checks are manifest, input, sha256, size, json, and schema
(PM 2026-11-17; orchestrator 2026-11-17).

### FR-2 — The merge and the rates

The tool merges the rows by model key, over the routes and the roles of each
table, and computes the metrics of the Data source block of D16: the
first-round accept %, the rework, the cleanup %, the tokens per accepted
task, the pass %, and the findings per run (PM 2026-11-17). The route
`unknown` stays out of every rank. The merge joins only the `#<variant>` rows
and the `[1m]` rows of one route. The file
`harness/model-guide/data/model-names.json` is a committed data file.
`guide.ts` and `real-work.ts` read it and never write it
(accepted by the PM 2026-11-17 after audit).

### FR-3 — The rank and the small-sample mark

The producer table ranks by the first-round accept %, then the lower rework,
then more tasks, over the rows with 5 tasks or more and a first-round rate.
The checker table ranks by the AA net score, high first; a row that is not
rated ranks after every rated row; then by findings per run, high first; then
by more runs; then by the model key, A to Z (tie-break orchestrator
2026-11-18). The checker rank holds the rows with 5 runs or more (the pass %,
escape, and run-count order is replaced by
PM 2026-11-18). A row below its minimum goes into the collapsed group "Too
few tasks". A pick also needs an allowed model, and, for a gate role, an AA
net score of 20 or more, in the same checker order inside the rows of that
role (PM 2026-11-17, PM 2026-11-18). A rate shows as a whole percent, the
findings-per-run value shows two decimals, and the Runs and Tasks columns
hold the count (PM 2026-11-17). Escapes take
no part in any rank. When the sum of escapes over all gate rows of the
outcomes file is 0, every Escapes cell shows "no data" (PM 2026-11-18).

### FR-4 — The page and the method note

`real-work.html` shows the top block first, then the producer table, the
checker table, and the print-audit block. Page B has no work-type section
(PM 2026-11-17). The "About this data" footer holds the three file names,
their SHA-256 values, the read date, the coverage numbers, the `unknown` row
count, and the merge method note of D16 (PM 2026-11-17). The page reuses the
look of `docs/results.html`, `docs/assets/css/site.css`, and the nav of the
other pages.

### FR-5 — The print-audit block

The block reads `harness/model-guide/data/print-audit-2026-11.json` and shows
D17. The block always shows the error types with their counts. The block
shows the plain model names of D17 and no raw route key (PM 2026-11-17). The
block shows no placeholder line. The tool that writes the file runs the input
check of D17 on the hand-off file first.

### FR-6 — The overview table

`harness/model-guide/guide.ts` writes `model-guide.json` from the page B
data, the track A score file, the print-audit file, and the base-line data
in `docs/assets/data/benchmark.json`. The overview page shows the table first
(D18). A row with no qualified model shows "no pick yet: not enough
evidence". A table with evidence older than 14 days shows `stale`.

### FR-7 — The preview and the publish gate

`harness/model-guide/preview.sh` builds the preview folder from `docs/` and
the new files. It writes nothing under `docs/`. It records the SHA-256 of
each copied file of `docs/` in `preview-base.json` of the preview folder.
`harness/model-guide/publish.ts` copies the preview files into `docs/` only
when the approval record exists and each SHA-256 in it matches. Before the
copy it compares the current files of `docs/` with `preview-base.json`. On a
drift it gives exit 2, names each drifted file, and writes nothing.

### FR-8 — The candidate diffs and the set lint

`harness/model-guide/pick-diffs.ts` lists the qualified commits of D4 with
`gh api` GET calls only. It selects the diffs by the rules of D4 and skips
the diffs that a set holds. `harness/model-guide/review-set.ts lint <set_id>`
checks a set in the private folder: the key schema of D7, the plant rules of
D5, the operator of each plant against the catalog of D6, the counts of D8,
the hunk headers, and the SHA-256 values of the public
manifest. It writes the public manifest of D9.

### FR-9 — The scorer

`harness/model-guide/review-score.ts` reads a raw output, the key, and the
adjudication verdicts. It applies D10, D11, and D13, and it writes one pass
record into the score file. It never writes finding text, a path, or a line
into the score file.

### FR-10 — The leak check

`harness/model-guide/leak-check.ts` runs before each commit of track A data.
It reads the private folder. It stops with exit 2 when a staged file or a
file under `docs/` or the preview folder holds a key field (`new_lines`,
`witness`, `operator`), the path of the private folder, or a line of 20
characters or more that is in a seeded diff but not in its source diff.

### FR-11 — The review runner

`harness/model-guide/review-run.sh --set <set_id> --route <route>` runs one
pass under D14 and D15. It refuses a route that is not in
`harness/model-guide/routes.json` or whose `kind` is not `plan` or `free`.
It stores the raw outputs in the private folder only. It ends with the
trap of `harness/opencode-host.sh`.

### FR-12 — The adjudication queue

`harness/model-guide/adjudicate.ts queue <set_id>` writes the unmatched
findings of each diff into the private folder (D11), with no route name.
Each finding has its own item. The items of one group hold the id of the
finding. `adjudicate.ts apply <set_id>` reads the verdicts of the two
judges, keeps only the verdicts that both judges agree on, updates the key
`real_defects`, and writes the list of real defects for the PM hand-off into
the private folder.

### FR-13 — The registry

`measure/tracks.md` follows D2.

### FR-14 — The review page

The preview tool writes `review.html` and `review.json` from the score file
(D13). A route with fewer than 3 complete passes shows `incomplete` and has
no rank. A `provisional` pass does not remove the rank. A set that fails the
pilot gate of D13 has no rank on the page.

### FR-15 — The quota sources

`harness/model-guide/quota.ts` reads the quota source of the provider of a
route, as D15 holds. It gives one state for each route: `ready`, `wait`, or
`stopped`. It reads the OpenChamber endpoint for the providers that have
one. It gives the state `stopped` for a quota error, a limit error, a read
failure, a source with no value, a missing field, or a value that is not a
number. It gives the state `wait` for a window of 70 % or more. A route with
no quota source gets the fixed cap of
1 pass per night of D15.

## Non-functional requirements

- **No paid spend.** No run uses a metered route. Each run uses the quota
  rule of D15.
- **No model call in tests.** The tests use fake `opencode` binaries, fake
  quota reads, and small synthetic diffs and keys. No test reads the real
  private folder, the real shared store, or the network.
- **Secrecy.** No public file holds a key field, a seeded line, a raw
  output, or a credential value (D9, FR-10).
- **No other project.** The track reads the source repos only through
  `gh api` GET. It never writes in another repository or another project
  folder. A real defect goes to the PM as a hand-off.
- **Human gates.** The first publish waits for Daniel (D21). Paid
  generation, deletions outside a job folder, and public dates stay with
  Daniel.
- **Reuse.** The runner reuses `harness/opencode-host.sh`. The new
  provider helper follows the call and the retry rule of
  `harness/opencode-credential.sh` and leaves that file without a change.
  No file of the `runner_sha256` or `suite_sha256` lists of
  `harness/provenance.ts` changes. The quota read reuses the endpoint and
  the field rules of `guard_read` in `harness/cron-daily.sh`. The pages reuse
  `docs/assets/css/site.css`.
- **Language.** The page text and the method notes use ASD-STE100.

## Acceptance criteria

1. `measure/tracks.md` shows `model_guide`, shows `rigor_a_h` as paused with
   the PM reason, and has a backlog line for the replay track with no date.
2. With the three dated data files of D16 (2026-11-17), the preview folder
   holds `real-work.html` and `real-work.json` by 2026-11-18. The top block
   comes first and gives one line per role of the Data source block. The
   "About this data" footer shows each file name, its SHA-256, the read date,
   and the coverage numbers of that block: the row count, the route count,
   the `unknown` share, and the export date (PM 2026-11-17).
3. A changed byte in the export makes the input check stop with exit 2.
4. Each row shows a plain model name. A route shows in a second line or a
   tooltip, not in a default column. The footer method note states the
   merge. The producer table shows Model, Tasks, First-round accept %, Rework,
   Cleanup %, and Tokens per accepted task. The checker table shows Model,
   Runs, Pass %, Findings per run, Escapes, and Net score. A rate shows as a
   whole percent, and the Runs and Tasks columns hold the count (PM
   2026-11-17). The checker table ranks by the AA net score first, and its
   text says "A high pass % does not mean a good checker." An Escapes cell
   shows "no data" when the sum of escapes over all gate rows is 0, and a
   number otherwise (PM 2026-11-18). Rows with fewer than 5 tasks or runs
   carry "Too few tasks" and get no rank number. A row with the mark "not
   for verdicts" or "not allowed" never picks.
5. Page B has no work-type section. The producer table shows no self-graded
   pass rate. The checker table shows findings per run in place of Blocking %
   and Blockers per run (PM 2026-11-17).
6. The print-audit block shows 11 of 13 and 13 of 13, the 52 errors, and the
   error types with their counts. The block shows no placeholder line. The
   input check of the print-audit file stops with exit 2 on a wrong SHA-256
   from `MANIFEST.txt`, a missing top key, or a wrong count of `errors`
   rows.
7. The overview table in the preview has the six rows of D18, each with a
   pick or "no pick yet: not enough evidence", the evidence, and a date.
8. Until the approval record exists, `git status` shows no change under
   `docs/` from this track, and the publish tool gives exit 2. The publish
   tool also gives exit 2 when a file of `docs/` changed after the preview.
9. The set `mg-2026-11a` passes the lint. The lint fails when a plant names
   an operator that is not in the catalog of its class. The public manifest
   and the score file hold no key field and no seeded line. The leak check
   passes.
10. The pilot gate holds before the rank of a set. The best worst-of-2 score
    minus the lowest worst-of-2 score is 20 points or more, and the best
    worst-of-2 score is below 90. A set that fails a rule has no rank.
11. By 2026-11-22, each reachable route of D12 has 3 complete passes or a
    recorded reason (unreachable, quota stop, region block, or open pass).
    The preview shows the track A rank by the worst pass.
12. No run used a metered route, and no pass started at 70 % or more of a
    window.
13. `real-work.html` has no horizontal overflow at 390, 980, and 1280 px. A
    wide table scrolls inside its own box with a visible hint. The page is
    about 3 screens long at 1280 px (accepted by the PM 2026-11-17 after
    audit).

## Owner questions

Each question has a default. The track continues with the default. The
questions Q2, Q3, Q4, Q5, and Q7 were answered by the PM on 2026-11-14.
Q6 was answered on 2026-11-16. The answers are in "Owner decisions".

- **Q1 (D3).** How does the overview table relate to `domain_trust`?
  Default: `domain_trust` stays as it is. The "app code" row links its
  matrix as a second source when the matrix is on the site.
- **Q2 (D9).** Answered on 2026-11-14 (OD1). The keys live in the private
  folder outside the repository. The repository holds only the SHA-256
  values and the counts.
- **Q3 (D12).** Answered on 2026-11-14 (OD2). DeepSeek Flash runs through
  `opencode-go/deepseek-v4.1-flash`. The routes `deepseek/*` are metered.
- **Q4 (D16).** Answered on 2026-11-14 (OD3). The checker rank uses the
  pass rate only. The page shows the blocking rate. The PM replaced this
  answer on 2026-11-18 (OD3, PM 2026-11-18).
- **Q5 (D16).** Answered on 2026-11-14 (OD4). The merge removes only
  `#<variant>` and `[1m]` of one route. The same model on another provider
  stays separate.
- **Q6 (D17).** Answered on 2026-11-16 (PM). The default is replaced by
  the binding 2.4a ruling. The PM replaced the route-name rule on
  2026-11-17: the page shows the plain names "Kimi K3.1 Pro" and
  "Claude Sonnet 5.5" (D17, PM 2026-11-17).
- **Q7 (D17).** Answered on 2026-11-14 (OD6). The error types come from the
  hand-off file of OD6. The page always shows them.
- **Q8 (D14).** Can the Claude route run in an isolated job store? Default:
  the probe decides. An unreachable route waits for a PM rule and has no
  rank.
- **Q9 (D5, D11).** Is Opus the fixture author and the first judge?
  Default: no (PM 2026-11-17). The PM changed the fixture author on
  2026-11-16 (D5). The first judge is the route of `ra-quota pick` for a
  decision role, never an Opus subagent (D11, PM 2026-11-17). Opus is not in
  the ranked list. The adjudication is blind to the route name. The second
  judge is "no ready route" (the D11 fallback). An allowed route with a net
  score of 20 or more then replaces it (OD5, PM 2026-11-17).
- **Q10 (D13).** Are the weights 5, 2, and 1, the false-claim cost of 2, and
  N = 3 correct? Default: yes, for the first set.

## Out of scope

- New difficulty work on the build track. The track `rigor_a_h` is paused.
- A change to `domain_trust` or to `daily_model_schedule`.
- The replay track (the backlog).
- A timer for track A or for the weekly update.
- A change to the PM export or to its schema.
- Any metered route or paid spend.
- Book text or book pages of the print audit.
- A write in a source repo, also for a real defect.
- A backup tool for the private folder.

## Risks

- **R1. Small samples and a flat score.** One set has 40 to 60 plants. A
  difference of a few points between routes can be noise. The page shows the
  counts, and N = 3 shows the spread. The pilot gate of D13 keeps a set with
  a flat score out of the rank.
- **R2. The providers see the seeded diffs.** A provider can keep a prompt.
  The keys stay private, but a later model can know a seeded diff. A new set
  id each quarter limits this.
- **R3. Same-family bias.** The first judge can be in the same family as the
  Sonnet route (D11, PM 2026-11-17). The PM changed the fixture author on
  2026-11-16 (D5). The second judge is "no ready route" (the D11 fallback)
  (D11, PM 2026-11-17). Only the verdicts that both judges agree on count.
  The blind adjudication and the fixed operator catalog limit the bias. Q9
  covers it.
- **R4. Unmatched true findings.** A good model can find real defects. D11
  makes them neutral, not false claims. An `unclear` verdict marks the pass
  `provisional` and leaves the rank of the route unchanged. A disputed
  finding is left out and never counts against a route. A wrong line or a
  wrong class never counts as found.
- **R5. Line counts.** A model can give a wrong line. The line prefixes of
  D10 and the window of 3 lines limit this. A claim outside that window
  does not count as found.
- **R6. The real-work record.** The old export had 50.6 % of the runs with a
  known model and 71.7 % with a result. The page showed its coverage and
  split the roles. The Data source block of D16 replaces that input
  (replaced by Data source, PM 2026-11-17). The new risk is the row count per
  model: a model with fewer than 5 tasks or runs has no rank.
- **R7. The schedule.** Track A needs the set by 2026-11-19 to run 3 nights
  before 2026-11-22. A late set gives fewer passes, and the page shows
  `incomplete`.
- **R8. The private folder.** A loss of the folder loses the keys. The
  public SHA-256 values show a changed or a lost key. A new set replaces a
  lost one.
- **R9. The Go region rule.** Daniel turned on Global regions on the new
  OpenCode Go account at about 11:00 on 2026-11-14. The rule stays as a
  guard: the account rejects a model that is hosted outside Europe and the
  United States. A Go route with that error has no rank for that night. The
  track A rank then holds fewer routes. The probe of D14 finds it early.
