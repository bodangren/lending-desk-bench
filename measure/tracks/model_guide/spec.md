# Model guide: seeded-defect review, real-work outcomes, and the use-this-model table

Spec format: classic FR list. Track type: feature. Base commit: `ea36fae`.
Author model: `claude-code/claude-opus-5-5[1m]#high`. Date: 2026-11-14.
Revision 2, 2026-11-14: the findings F1 to F12 of the spec review round 1.
Revision 3, 2026-11-14: the findings F13 to F23 of the spec review round 2.

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
  rate only. The page shows the blocking rate beside the rate.
- **OD4. Q5, the merge on page B.** The merge joins only the `#<variant>`
  rows and the `[1m]` rows of one route. The same model on another provider
  stays a separate row.
- **OD5. F5 and F16, the second judge.** The second judge is ByteDance
  Doubao, the route `volcengine-agent-plan/ark-code-latest`. That family is
  not ranked. Its start test passed on 2026-11-14 (EV14). Only the verdicts
  that both judges agree on count. A disputed finding is left out and never
  counts against a route. An unclear verdict never takes away the rank of a
  route. The PM decided this rule on 2026-11-14 (F16).
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
  answered `ARK OK`. So the second judge of D11 is reachable on 2026-11-14.

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

5. **D5. The seeding method.** The fixture author is the route
   `claude-code/claude-opus-5-5[1m]#high`. No ranked route seeds (D12). The
   author works in a fresh session and writes into the private folder only.
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
   14 diffs and 40 to 60 plants. At least 14 plants are blockers. Each class
   C1 to C7 has at least 3 plants. C8 and C9 have at least 1 plant each. A
   set has a fixed content: a change makes a new set id.

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
      route `claude-code/claude-opus-5-5[1m]#high`. The second judge is
      ByteDance Doubao, the route `volcengine-agent-plan/ark-code-latest`.
      That family is not ranked. Its start test passed on 2026-11-14 (EV14).
      The Ark plan ends at about 2026-11-22. After that date, or when a start
      test fails, the second judge comes from a family that is not ranked in
      that round. When no such judge is available, a disputed finding is left
      out and never counts against a route. The second judge never reads the
      verdicts of the first judge. Neither judge sees the route name of a
      finding.
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
    | Kimi | `kimi-code-plan-cn/kimi-for-coding#high` | plan |
    | MiniMax M3.1 Flash | `minimax-cn-coding-plan/MiniMax-M3.1-Flash` | plan |
    | DeepSeek Flash | `opencode-go/deepseek-v4.1-flash` | plan (Go) |
    | GLM 5.3 | `bailian-token-plan/glm-5.3#high` | plan |
    | StepFun | `nvidia/stepfun-ai/step-5-preview#high` | free |
    | Go | `opencode-go/mimo-v2.6-flash` | plan (Go) |
    | Go | `opencode-go/muse-spark-1.3-contributor#high` | plan (Go) |

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
    - **N.** N = 3 passes for each route and each set.
    - **The pilot gate.** A set goes to ranking only after a pilot. The
      pilot set is `mg-2026-11p`. It has 6 seeded diffs and at least 12
      plants. The 6 diffs are the first 6 qualified commits in the D4 order.
      The fixture author seeds them by the method of D5 to D7. The pilot set
      is separate from the ranked set `mg-2026-11a`. A reseed makes a new set
      id: `mg-2026-11p2`, then `mg-2026-11p3`.
      The pilot runs 2 routes with 2 passes each, so each route has a
      worst-of-2 score. The pilot routes are
      `minimax-cn-coding-plan/MiniMax-M3.1-Flash` and
      `kimi-code-plan-cn/kimi-for-coding#high`. A pilot route that is
      unreachable or region-blocked is replaced by the next route of D12.
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
      without 3 complete passes.
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
    both from one hand-off file.
    - **Input check.** The tool takes the path of the JSON file. It reads
      `MANIFEST.txt` next to it. It stops with exit 2 when the SHA-256 or the
      size differs from the manifest, when `schema` is not
      `real-work-outcomes/1`, or when a run sum differs from
      `coverage.runs`. It never copies the input file into the repository.
    - **Source line.** The page shows the file name, its SHA-256, and
      `generated_on`.
    - **Coverage block.** The page shows the runs, the date range, the share
      with a known model, the share with a result, and the left-out paired
      duplicates. It also shows the runs of `unknown` and `other`.
    - **Merge.** Rows with the same model key merge by sums. The merge joins
      only the `#<variant>` rows and the `[1m]` rows of one route. The same
      model on another provider stays a separate row (OD4). The page lists
      the routes of each merged row. The method note says: "Route names
      stay as written in the record, so #high and [1m] variants are
      separate routes. This page merges them by model." `unknown` and
      `other` do not merge and get no rank.
    - **Role groups.** The page has one table for producer roles and one
      table for checker roles.
    - **Work-type tables.** The page has one table for each work type of
      `work_types`. The `all_time` block gives one row for each route, role,
      and work type. A work-type row sums the role rows of that route and
      work type. Each `work_types` value holds `runs`, `pass`, and `fail`
      only. These tables use that data and no other data.
      - **The pass rate of a work type.** `pass / (pass + fail)`. A row with
        `pass + fail` of 0 has no rate.
      - **The result count.** The page shows `pass + fail` beside each rate.
      - **The minimum.** A row with fewer than 10 results (`pass + fail`)
        gets the mark `few runs`. The mark counts results, not export runs
        (`runs`). It goes below the other rows, and it cannot pick.
      - **The rank.** The higher pass rate first, then the higher result
        count.
      - **No blocking rate.** The export has no blocking findings for a work
        type. These tables show no blocking rate and no error count.
      - **No data.** A work type with no row says "no pick yet".
    - **Pass rate.** `pass / (pass + fail + error)`. `no_result` stays out
      of the rate. The page shows it in its own column.
    - **Blocking rate.** Blocking findings for each run with a result.
    - **Rank.** Producer table: the higher pass rate first, then the lower
      blocking rate. Checker table: the higher pass rate first. The checker
      table shows the blocking rate, but the rank does not use it, because a
      checker that finds more blockers is not worse (OD3). Each
      rate has its run count beside it, for example `0.82 (n=114)`.
    - **Small samples.** A merged row with fewer than 10 runs with a result
      gets the mark `few runs` and goes below the rows without the mark. A
      route with fewer than 10 runs always has fewer than 10 runs with a
      result, so this rule covers the PM rule.
    - **Ratings.** The page shows the mean of each axis and its `n`, and the
      rater agreement with its `n`. The rank never uses a rating.
    - **Trend.** One column shows the pass rate of the last 4 ISO weeks of
      the `weekly` block, with its run count.

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
      are "k3.1-pro" 11 of 13 blockers and "Sonnet 5.5" 13 of 13 blockers.
    - **The page.** The block on page B shows the two results, the error
      types with their counts, and the bias note. The block holds no book
      text, no page, and no file name. The block says that the data point is
      one calibration run, not a rank.
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
    - **Sources for each row.**

      | Row | First source | Second source |
      |---|---|---|
      | Code review | track A rank (worst of N) | page B checker table |
      | App code | page B work-type table, work type `app code` | build base line |
      | Test writing | page B producer table, role `red` | tests track base line |
      | Docs and ops | page B work-type table, work type `docs and ops` | none |
      | Print-book audit | page B work-type table, work type `print books` | print-audit data point |
      | Tooling | page B work-type table, work type `tooling` | none |

    - **Pick rule.** The first source picks the first and the second choice
      from its rank. A model qualifies only with 10 runs or more in the page
      B row (10 results for a work-type row), or with a complete rank (track
      A). When the first source has no qualified model, the second source
      picks. When neither has one, the cell says "no pick yet: not enough
      evidence".
    - **Ruling Q1 (PM, 2026-11-15).** The Test writing row uses the page B
      producer table as a whole while `real-work.json` has no role key. The
      evidence cell starts with "page B producer". A red-only table comes
      when the export carries the role.
    - **Ruling Q2 (PM, 2026-11-15).** The plan line "Verify (Phase 2)" wins.
      While track A has no complete rank, the Code review row shows "no pick
      yet: not enough evidence". The page B checker table does not pick for
      code review before Phase 4, because a checker pass rate measures the
      checked work, not the review skill.
    - **Evidence cell.** The source, the number, and the run count, for
      example "page B: pass 0.86 (n=114)".
    - **Evidence date.** The `generated_on` of the export, or the date of the
      last complete pass of track A, for each row.
    - **Base line.** The build and tests scores never pick. They show beside
      the pick as a check. The `domain_trust` link follows D3.

19. **D19. The weekly update.** The PM sends a new export each week. The
    orchestrator runs `harness/model-guide/update.sh <export file>`. The
    script runs the input check of D16, writes `real-work.json`, and writes
    `model-guide.json`. Before the approval (D21), it writes into the
    preview folder. After the approval, it writes into `docs/assets/data/`,
    and it commits the two data files with explicit paths. The standing push
    rule then applies. A table whose newest evidence date is more than 14
    days old shows the mark `stale`.

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

`harness/model-guide/real-work.ts --input <file> --out <folder>` runs the
input check of D16. A mismatch of the SHA-256, the size, the schema, or the
run sum gives exit 2 and one line that names the failed check. No output file
is written in that case.

### FR-2 — The merge and the rates

The tool merges the rows by model key and computes the pass rate, the
blocking rate, the `no_result` count, the ratings with `n`, the rater
agreement with `n`, and the 4-week pass rate (D16). `unknown` and `other`
stay out of every rank. The merge joins only the `#<variant>` rows and the
`[1m]` rows of one route.

### FR-3 — The rank and the small-sample mark

The producer table ranks by pass rate and then by blocking rate. The checker
table ranks by pass rate only. A row with fewer than 10 runs with a result
gets the mark `few runs` and goes below the other rows. Each rate has its
run count beside it. The work-type tables rank by the pass rate of
`pass / (pass + fail)` and then by the result count. A work-type row with
fewer than 10 results (`pass + fail`) gets the mark `few runs` and cannot
pick.

### FR-4 — The page and the method note

`real-work.html` shows the source line, the coverage block, the producer
table, the checker table, the work-type tables, the print-audit block, and
the method note of D16. The page reuses `docs/assets/css/site.css` and the
nav of the other pages.

### FR-5 — The print-audit block

The block reads `harness/model-guide/data/print-audit-2026-11.json` and shows
D17. The block always shows the error types with their counts. The block
shows no placeholder line. The tool that writes the file runs the input check
of D17 on the hand-off file first.

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
2. With the 2026-11-14 export, the preview folder holds `real-work.html` and
   `real-work.json` by 2026-11-18. The page shows the SHA-256
   `dae855ca…64f2`, `generated_on` 2026-11-14, and the coverage numbers 1,798
   runs, 2026-06-06 to 2026-11-13, 50.6 %, and 71.7 %.
3. A changed byte in the export makes the input check stop with exit 2.
4. Merged rows list their routes. The method note states the merge. Each
   rate has its run count. Rows with fewer than 10 runs with a result carry
   `few runs`. No rank uses a rating.
5. Each work-type table shows the pass rate of `pass / (pass + fail)` with
   its result count. A work-type row sums the role rows. A row with fewer
   than 10 results carries `few runs` and cannot pick. A work type with no
   row says "no pick yet".
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
  pass rate only. The page shows the blocking rate.
- **Q5 (D16).** Answered on 2026-11-14 (OD4). The merge removes only
  `#<variant>` and `[1m]` of one route. The same model on another provider
  stays separate.
- **Q6 (D17).** Answered on 2026-11-16 (PM). The default is replaced by
  the binding 2.4a ruling. The page names the full routes:
  `kimi-code-plan-cn/k3.1-pro` and `claude-code/claude-sonnet-5-5#high`.
- **Q7 (D17).** Answered on 2026-11-14 (OD6). The error types come from the
  hand-off file of OD6. The page always shows them.
- **Q8 (D14).** Can the Claude route run in an isolated job store? Default:
  the probe decides. An unreachable route waits for a PM rule and has no
  rank.
- **Q9 (D5, D11).** Is Opus the fixture author and the first judge?
  Default: yes. Opus is not in the ranked list. The adjudication is blind to
  the route name. A second judge of a family that is not ranked reads each
  finding: ByteDance Doubao on
  `volcengine-agent-plan/ark-code-latest` (OD5).
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
- **R3. Same-family bias.** The Opus author and the first judge are in the
  same family as the Sonnet route. The second judge is ByteDance Doubao, a
  family that is not ranked. Only the verdicts that both judges agree on
  count. The blind adjudication and the fixed operator catalog limit the
  bias. Q9 covers it.
- **R4. Unmatched true findings.** A good model can find real defects. D11
  makes them neutral, not false claims. An `unclear` verdict marks the pass
  `provisional` and leaves the rank of the route unchanged. A disputed
  finding is left out and never counts against a route. A wrong line or a
  wrong class never counts as found.
- **R5. Line counts.** A model can give a wrong line. The line prefixes of
  D10 and the window of 3 lines limit this. A claim outside that window
  does not count as found.
- **R6. The real-work record.** Only 50.6 % of the runs have a known model,
  and 71.7 % have a result. The meaning of a pass differs by role. The page
  shows the coverage and splits the roles. The work types have no blocking
  findings, so their tables have no blocking rate.
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
