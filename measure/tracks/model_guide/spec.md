# Model guide: seeded-defect review, real-work outcomes, and the use-this-model table

Spec format: classic FR list. Track type: feature. Base commit: `ea36fae`.
Author model: `claude-code/claude-opus-5-5[1m]#high`. Date: 2026-11-14.

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
PM. The PM or the owner can change it. Each open owner choice also appears
under "Owner questions".

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
   The candidate tool lists the qualified commits, newest first, and the
   fixture author picks from that list. A rejected candidate gets a reason
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

6. **D6. The defect classes and the severity scale.** Each plant has one
   class, one to three accepted classes for the match (D10), and one
   severity.

   | Class | Name | Example operators |
   |---|---|---|
   | C1 | Access control | remove or weaken an auth or role check; check the wrong owner |
   | C2 | Data integrity | write the wrong field; lose an update; drop a transaction or a uniqueness rule |
   | C3 | Logic | invert a condition; off by one; wrong comparison; wrong default |
   | C4 | Error handling | swallow an error; drop an `await`; ignore a failed result |
   | C5 | Input validation | remove a bound or a type check; build a query from raw input |
   | C6 | Data exposure | log or return a secret or personal data |
   | C7 | Contract | change a return shape or a field name that a caller uses |
   | C8 | Test defect | an assertion that cannot fail; a removed assertion; a skipped test |
   | C9 | Performance | a query in a loop; an unbounded read |

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
     set. It holds no file path and no line of a plant.
   - The score file `harness/model-guide/data/review-scores/<set_id>.json`
     (D13).
   The leak check (FR-10) runs before each commit of track A data. Each
   model provider sees the seeded diffs in the prompts; risk R2 covers that.
   Owner question Q2.

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
    - **Unmatched finding.** A finding that matches no plant goes to
      adjudication (D11). It is not a false claim before that check.

11. **D11. Adjudication of unmatched findings.** The adjudicator is the
    route `claude-code/claude-opus-5-5[1m]#high`, in a fresh session. It sees
    the seeded diff, the key, and the unmatched findings. It does not see
    the route name of a finding. The tool groups the unmatched findings of
    one diff by file and a line window of 3, so one call covers one diff and
    every route. The adjudicator gives one verdict to each group:
    - `plant:<id>`: the finding describes that plant at a wrong line or with
      a wrong class. The plant counts as found.
    - `real-defect`: the defect was in the source diff. It goes to
      `real_defects` of the key. It is neutral in the score. The page shows
      the count of real defects found for each route.
    - `false-claim`: the finding names no defect. It counts as a false claim.
    - `unclear`: no decision. It is neutral, and the run is marked
      `provisional`.
    The orchestrator reads each `real-defect` verdict and sends it to the PM
    orchestrator as a hand-off, because the defect is in another project.
    This track never writes in a source repo. A plant that no route finds in
    any run of a complete set goes to the adjudicator once more. When the
    adjudicator finds that it is not a defect, the set gets a new id without
    that plant.

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
    fields `family`, `route`, `kind`, and `quota_provider`. The runner refuses
    a route whose `kind` is not `plan` or `free`. The route
    `deepseek/deepseek-flash#high` of the real-work record is not in the list,
    because the author cannot show that it is a plan route. Owner question Q3.

13. **D13. The score and the rank.**
    - **Pass score.** `W` = the sum of the weights of all plants of the set.
      `F` = the sum of the weights of the found plants. `X` = the number of
      false claims in the pass. Score = `max(0, 100 × F / W − 2 × X)`, with
      one decimal.
    - **Other numbers for each pass:** blocker recall (found blockers divided
      by blockers), the found, missed, and false-claim counts, the invalid
      reviews, and the real defects found.
    - **N.** N = 3 passes for each route and each set.
    - **Rank.** The rank uses the worst pass score of the N passes. A tie
      goes to the higher worst blocker recall, and then to the higher median
      score. A route with fewer than 3 complete passes, or with a
      `provisional` pass, shows `incomplete` and has no rank.
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
      control diff. A route that fails the probe is `unreachable`. The
      orchestrator sends the error line to the PM. Owner question Q8 covers
      the Claude route, which can need the shared `HOME`.

15. **D15. The quota budget.** The runner reads the quota of the route
    provider before each pass and before each diff. It uses the endpoint of
    EV10 with the `quota_provider` of the route.
    - It starts a pass only when each window of that provider is below 70 %.
    - It stops the pass when a window reaches 80 %, and it marks the pass
      open.
    - A failed read, a missing field, or a value that is not a number stops
      the route for that night.
    - The track A window is 02:00 to 06:00 +07. One night runs at most one
      pass for each route. The routes run one at a time, in the order of
      D12.
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
    - **Merge.** Rows with the same model key merge by sums. The page lists
      the routes of each merged row. The method note says: "Route names
      stay as written in the record, so #high and [1m] variants are
      separate routes. This page merges them by model." `unknown` and
      `other` do not merge and get no rank.
    - **Role groups.** The page has one table for producer roles and one
      table for checker roles, and one table for each work type of
      `work_types`.
    - **Pass rate.** `pass / (pass + fail + error)`. `no_result` stays out
      of the rate. The page shows it in its own column.
    - **Blocking rate.** Blocking findings for each run with a result.
    - **Rank.** Producer table: the higher pass rate first, then the lower
      blocking rate. Checker table: the higher pass rate first. The checker
      table shows the blocking rate, but the rank does not use it, because a
      checker that finds more blockers is not worse. Owner question Q4. Each
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
    `harness/model-guide/data/print-audit-2026-11.json` holds: the key size
    (52 errors), the blocker count (13), and two results: "k3.1-pro" 11 of
    13 blockers and "Sonnet 5.5" 13 of 13 blockers. It also holds the error
    types of the key with the count of each type. The PM must still send the
    error types. Until they come, the block shows the two blocker scores and
    the line "Error types: not yet received." The file holds no book text,
    no page, and no file name. The block says that the data point is one
    calibration run, not a rank.

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
      | App code | page B producer table, work type `app code` | build base line |
      | Test writing | page B producer table, role `red` | tests track base line |
      | Docs and ops | page B, work type `docs and ops` | none |
      | Print-book audit | page B, work type `print books` | print-audit data point |
      | Tooling | page B, work type `tooling` | none |

    - **Pick rule.** The first source picks the first and the second choice
      from its rank. A model qualifies only with 10 runs with a result or
      more (page B), or with a complete rank (track A). When the first source
      has no qualified model, the second source picks. When neither has one,
      the cell says "no pick yet: not enough evidence".
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
    first publish holds page B, the overview table, and the track A results
    together, so Daniel looks once. The orchestrator sends the preview to
    Daniel through the PM. When Daniel gives his word, the orchestrator
    writes the approval record. The publish tool checks that the SHA-256 of
    each file in the preview equals the value in the record. Then it copies
    the files into `docs/`. After that first publish, the standing push rule
    applies.

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
stay out of every rank.

### FR-3 — The rank and the small-sample mark

The producer table ranks by pass rate and then by blocking rate. The checker
table ranks by pass rate only. A row with fewer than 10 runs with a result
gets the mark `few runs` and goes below the other rows. Each rate has its
run count beside it.

### FR-4 — The page and the method note

`real-work.html` shows the source line, the coverage block, the producer
table, the checker table, the work-type tables, the print-audit block, and
the method note of D16. The page reuses `docs/assets/css/site.css` and the
nav of the other pages.

### FR-5 — The print-audit block

The block reads `harness/model-guide/data/print-audit-2026-11.json` and shows
D17. With no error types in the file, it shows "Error types: not yet
received."

### FR-6 — The overview table

`harness/model-guide/guide.ts` writes `model-guide.json` from the page B
data, the track A score file, the print-audit file, and the base-line data
in `docs/assets/data/benchmark.json`. The overview page shows the table first
(D18). A row with no qualified model shows "no pick yet: not enough
evidence". A table with evidence older than 14 days shows `stale`.

### FR-7 — The preview and the publish gate

`harness/model-guide/preview.sh` builds the preview folder from `docs/` and
the new files. It writes nothing under `docs/`.
`harness/model-guide/publish.ts` copies the preview files into `docs/` only
when the approval record exists and each SHA-256 in it matches. Otherwise it
gives exit 2 and writes nothing.

### FR-8 — The candidate diffs and the set lint

`harness/model-guide/pick-diffs.ts` lists the qualified commits of D4 with
`gh api` GET calls only. `harness/model-guide/review-set.ts lint <set_id>`
checks a set in the private folder: the key schema of D7, the plant rules of
D5, the counts of D8, the hunk headers, and the SHA-256 values of the public
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

`harness/model-guide/adjudicate.ts queue <set_id>` writes the grouped
unmatched findings of each diff into the private folder (D11), with no route
name. `adjudicate.ts apply <set_id>` reads the verdicts, updates the key
`real_defects`, and writes the list of real defects for the PM hand-off into
the private folder.

### FR-13 — The registry

`measure/tracks.md` follows D2.

### FR-14 — The review page

The preview tool writes `review.html` and `review.json` from the score file
(D13). A route with fewer than 3 complete passes or a `provisional` pass
shows `incomplete` and has no rank.

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
5. The print-audit block shows 11 of 13 and 13 of 13, and the error types
   or "Error types: not yet received."
6. The overview table in the preview has the six rows of D18, each with a
   pick or "no pick yet: not enough evidence", the evidence, and a date.
7. Until the approval record exists, `git status` shows no change under
   `docs/` from this track, and the publish tool gives exit 2.
8. The set `mg-2026-11a` passes the lint. The public manifest and the score
   file hold no key field and no seeded line. The leak check passes.
9. By 2026-11-22, each reachable route of D12 has 3 complete passes or a
   recorded reason (unreachable, quota stop, or provisional). The preview
   shows the track A rank by the worst pass.
10. No run used a metered route, and no pass started at 70 % or more of a
    window.

## Owner questions

Each question has a default. The track continues with the default.

- **Q1 (D3).** How does the overview table relate to `domain_trust`?
  Default: `domain_trust` stays as it is. The "app code" row links its
  matrix as a second source when the matrix is on the site.
- **Q2 (D9).** Where do the keys live? Default: the private folder outside
  the repository. The repository holds only the SHA-256 values and the
  counts. The seeded diffs and the raw outputs also stay private.
- **Q3 (D12).** Is `deepseek/deepseek-flash#high` a plan route? Default: no.
  DeepSeek Flash runs through `opencode-go/deepseek-v4.1-flash`.
- **Q4 (D16).** What do `pass` and `blocking_findings` mean for a checker
  role? Default: the checker rank uses the pass rate only. The page shows
  the blocking rate, but the rank does not use it.
- **Q5 (D16).** Do routes of the same model on two providers merge? Default:
  no. The merge removes only `#<variant>` and `[1m]`.
- **Q6 (D17).** Which route is "k3.1-pro" in the print audit? Default: the
  page shows the PM label "k3.1-pro" and names no route.
- **Q7 (D17).** The error types of the 52-error key. Input that Phase 2
  waits for. Default until it comes: "Error types: not yet received."
- **Q8 (D14).** Can the Claude route run in an isolated job store? Default:
  the probe decides. An unreachable route waits for a PM rule and has no
  rank.
- **Q9 (D5, D11).** Is Opus the fixture author and the adjudicator?
  Default: yes. Opus is not in the ranked list. The adjudication is blind to
  the route name.
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

- **R1. Small samples.** One set has 40 to 60 plants. A difference of a few
  points between routes can be noise. The page shows the counts, and N = 3
  shows the spread.
- **R2. The providers see the seeded diffs.** A provider can keep a prompt.
  The keys stay private, but a later model can know a seeded diff. A new set
  id each quarter limits this.
- **R3. Same-family bias.** The Opus author and adjudicator is in the same
  family as the Sonnet route. The blind adjudication and the fixed operator
  catalog limit this. Q9 covers it.
- **R4. Unmatched true findings.** A good model can find real defects. D11
  makes them neutral, not false claims. An `unclear` verdict blocks the rank
  of a route until it gets a decision.
- **R5. Line counts.** A model can give a wrong line. The line prefixes of
  D10 and the window of 3 lines limit this. The `plant:<id>` verdict of D11
  covers the rest.
- **R6. The real-work record.** Only 50.6 % of the runs have a known model,
  and 71.7 % have a result. The meaning of a pass differs by role. The page
  shows the coverage and splits the roles.
- **R7. The schedule.** Track A needs the set by 2026-11-19 to run 3 nights
  before 2026-11-22. A late set gives fewer passes, and the page shows
  `incomplete`.
- **R8. The private folder.** A loss of the folder loses the keys. The
  public SHA-256 values show a changed or a lost key. A new set replaces a
  lost one.
