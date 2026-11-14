# Implementation plan — model_guide

PM 2026-11-14: direction change.

This plan builds page B and the overview table first, then the track A
review set and the scorer, then the first track A runs, and then the publish
gate and the weekly update. Spec: `spec.md`. Base commit: `ea36fae`.

Order by date:

| Date (+07) | Gate |
|---|---|
| Mon 2026-11-16 18:00 | spec and plan done; the spec review runs before task 1.1 |
| Wed 2026-11-18 | page B and the overview table in the preview folder (Phases 1 and 2) |
| Thu 2026-11-19 | set `mg-2026-11a` and the runner ready (Phases 3 and 4.1 to 4.3) |
| Sun 2026-11-22 | track A first results in the preview folder (Phase 4) |
| after Daniel's word | the first publish (Phase 5) |

Constraints for every role:

- The orchestrator assigns the roles. The spec reviewer and each code
  checker use a model family other than the family of the maker. The spec
  reviewer is not a Claude model (the author family).
- Stage files by explicit path: `git commit -m ... -- <paths>`. Never stage
  `.opencode/`, `tech-debt.md`, or `measure/runs/`. On an `index.lock`
  error, run the commit once more.
- No role writes a file under `docs/` before Phase 5 (spec D21). The daily
  job commits and pushes `docs/` (spec EV8).
- No role copies the hand-off file into the repository.
- No role reads a local checkout of another project. The source repos are
  read with `gh api` GET calls only.
- No role writes a key, a seeded diff, a raw output, or an adjudication
  note into the repository. These live in the private folder
  `$HOME/.local/share/lending-desk-bench/model-guide/` (mode 700).
- No test starts the real `opencode` binary, a model, the network, or the
  real quota endpoint. Tests use fakes and synthetic data in a temp folder.
- Only the new test files of `harness/model-guide-tests/` run outside the
  heavy-run wrapper. Each model call and each track A pass runs through
  `/home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh`.
- Test command for one file:
  `cd harness && npx vitest run model-guide-tests/<file> --configLoader native`.
- No role runs a metered route. Each pass obeys the quota rule of spec D15.
- The evidence folder is `measure/runs/model_guide/` (not staged).
- Human gates stay with Daniel: the first publish, paid generation,
  deletions outside a job folder, and public dates.

Marker use:

- `[ ]` marks an open task. The orchestrator adds `[~]` to the one open task
  and `[b]` to a task that waits for an owner, the PM, or an earlier task.
- `[x]` needs a commit SHA on the first line of the task.

File map (every new file of this track):

| File | Role |
|---|---|
| `harness/model-guide/real-work.ts` | page B data (FR-1 to FR-3) |
| `harness/model-guide/guide.ts` | overview table data (FR-6) |
| `harness/model-guide/preview.sh` | preview folder (FR-7, FR-14) |
| `harness/model-guide/publish.ts` | publish gate (FR-7) |
| `harness/model-guide/update.sh` | weekly update (spec D19) |
| `harness/model-guide/pages/real-work.html` | page B template (FR-4, FR-5) |
| `harness/model-guide/pages/review.html` | review page template (FR-14) |
| `harness/model-guide/pages/guide-section.html` | overview table block (FR-6) |
| `harness/model-guide/data/print-audit-2026-11.json` | print-audit data point (spec D17) |
| `harness/model-guide/pick-diffs.ts` | candidate commits (FR-8) |
| `harness/model-guide/review-set.ts` | set lint and public manifest (FR-8) |
| `harness/model-guide/review-score.ts` | scorer (FR-9) |
| `harness/model-guide/adjudicate.ts` | adjudication queue (FR-12) |
| `harness/model-guide/leak-check.ts` | leak check (FR-10) |
| `harness/model-guide/quota.ts` | quota read and rule (spec D15) |
| `harness/model-guide/review-run.sh` | review runner (FR-11) |
| `harness/model-guide/provider-credential.sh` | provider seed and value scan (spec D14) |
| `harness/model-guide/routes.json` | route list (spec D12) |
| `harness/model-guide/review-prompt.md` | reviewer instruction (spec D10) |
| `harness/model-guide/data/sets/<set_id>.json` | public set manifest (spec D9) |
| `harness/model-guide/data/review-scores/<set_id>.json` | public score file (spec D13) |
| `harness/model-guide-tests/*.test.ts` | tests of this track |
| `harness/model-guide-tests/fixtures/` | synthetic export, diffs, keys, fakes |

The overview block goes into `index.html` between the lines
`<!-- model-guide:start -->` and `<!-- model-guide:end -->`, directly after
`</nav>` (`docs/index.html:26`), so it is above the hero. The nav of each page gets the links `Real work` and `Review` after
`Results`. The preview applies both edits in the preview folder; the publish
applies them in `docs/`.

## Phase 0: Registry and spec review

- [x] 0.1 The registry (spec D2, FR-13). Commit of this plan.
  - `measure/tracks.md` gets `model_guide`, `rigor_a_h` as paused with the
    reason "PM 2026-11-14: no new difficulty work on the build track", and a
    "Backlog" section with the replay track and no date.
  - Verify: `rg -n "model_guide|paused — PM 2026-11-14|Replay" measure/tracks.md`
    shows the three lines.
- [ ] 0.2 The spec review (spec D20). Before task 1.1.
  - The reviewer follows the Measure spec-review standard and writes its
    round into `measure/tracks/model_guide/spec-review.md`.
  - The reviewer is of a family other than Claude.
  - Verify: `spec-review.md` has Round 1 and an Author Response line for each
    finding. Each Blocker has FIX, CONTEST, or ESCALATE.

## Phase 1: Page B in the preview folder (by Wed 2026-11-18)

Spec D16, D21, FR-1 to FR-4, FR-7.

- [ ] 1.1 Red. Write the tests. Touch these files and no others:
  - `harness/model-guide-tests/real-work.test.ts`
  - `harness/model-guide-tests/preview-gate.test.ts`
  - `harness/model-guide-tests/fixtures/real-work-mini.json` and
    `harness/model-guide-tests/fixtures/MANIFEST.txt` (synthetic, in the
    `real-work-outcomes/1` shape of spec EV2)
  Normal cases:
  - The input check passes on the fixture, and the output keeps the file
    name, the SHA-256, and `generated_on`.
  - `x/m#high`, `x/m[1m]#high`, and `x/m` merge into the model key `x/m` by
    sums, and the row lists the three routes.
  - Pass rate = `pass / (pass + fail + error)`; `no_result` stays out and is
    in its own field.
  - Producer rank: pass rate, then the lower blocking rate. Checker rank:
    pass rate only.
  - Each rate carries its run count.
  - The coverage block holds the runs, the dates, the two shares, the
    left-out duplicates, and the `unknown` and `other` runs.
  - The 4-week pass rate uses the last 4 ISO weeks of `weekly`.
  - `preview.sh` writes `real-work.html` and `real-work.json` into a temp
    preview folder, and the nav and the method note text of spec D16 are in
    the page.
  Edge cases:
  - A changed byte, a wrong size, a wrong schema, or a run sum that differs
    from `coverage.runs` gives exit 2 and no output file.
  - A missing `MANIFEST.txt` gives exit 2.
  - A row with 9 runs with a result gets `few runs` and goes below a row
    with 10. A row with 10 has no mark.
  - `unknown` and `other` are in no rank and do not merge.
  - A rank that a rating alone would change does not change.
  - `rater_checks.n` = 0 shows no agreement value.
  - `preview.sh` leaves the temp `docs/` copy without a change.
  - `publish.ts` without an approval record, or with one wrong SHA-256,
    gives exit 2 and writes no file.
  - Verify: each file fails on `ea36fae`. Record the failed test names in
    `measure/runs/model_guide/red-1.1.txt`.
- [ ] 1.2 Green. Write `real-work.ts`, `pages/real-work.html`, `preview.sh`,
  and `publish.ts` until the Red tests pass. Touch no test file.
  - Verify: both test files pass. `git status --short docs/` prints nothing.
- [ ] 1.3 Checks. One code checker reads the diff against spec D16 and D21.
  - The checker confirms that no path writes under `docs/` without the
    approval record, and that the rank uses no rating.
  - Verify: `measure/runs/model_guide/check-1.3.json` has status pass, or
    each blocking finding has a fix commit.
- [ ] 1.4 The preview with the real export.
  - Command:
    `harness/model-guide/preview.sh --export ~/Desktop/handoff/real-work-outcomes/real-work-outcomes-2026-11-14.json`.
  - Verify: `.tmp/model-guide-preview/real-work.html` shows the SHA-256
    `dae855cad4bcd29b0623d8a0b8d4eb75aa16a7ddd6688455735bf312df5464f2`,
    `generated_on` 2026-11-14, 1,798 runs, 2026-06-06 to 2026-11-13,
    50.6 %, and 71.7 % (spec acceptance 2). `git status --short docs/`
    prints nothing.

Verify (Phase 1): spec acceptance 2, 3, 4, and 7 hold in the preview folder.

## Phase 2: The print-audit block and the overview table (by Wed 2026-11-18)

Spec D17, D18, D19, FR-5, FR-6.

- [ ] 2.1 Red. Write the tests. Touch these files and no others:
  - `harness/model-guide-tests/print-audit.test.ts`
  - `harness/model-guide-tests/guide.test.ts`
  - `harness/model-guide-tests/update.test.ts`
  - synthetic fixtures under `harness/model-guide-tests/fixtures/`
  Normal cases:
  - The block shows 11 of 13 and 13 of 13, the key size 52, and the error
    types with their counts when the file has them.
  - The table has the six rows of spec D18 in that order.
  - The first source picks the first and the second choice. The evidence
    cell holds the source, the number, and the run count. Each row has its
    evidence date.
  - The base line shows beside the pick and never changes it.
  - `update.sh` before the approval writes into the preview folder only.
  - `update.sh` after the approval writes the two data files into a temp
    `docs/assets/data/` and runs `git commit` with explicit paths only.
  Edge cases:
  - A file with no error types shows "Error types: not yet received."
  - The file holds no key `pages`, `text`, or `file`; a test fails on any
    such key.
  - No qualified model in the first source: the second source picks.
  - No qualified model in either source: "no pick yet: not enough evidence".
  - Evidence older than 14 days gives the mark `stale`; 14 days gives none.
  - A track A route with `incomplete` does not qualify.
  - `update.sh` with a failed input check gives exit 2 and changes no file.
  - Verify: each file fails on the Phase 1 code. Record the failed test
    names in `measure/runs/model_guide/red-2.1.txt`.
- [ ] 2.2 Green. Write `data/print-audit-2026-11.json`, `guide.ts`,
  `pages/guide-section.html`, `update.sh`, and the overview edit of
  `preview.sh`. Touch no test file.
  - Verify: the Phase 1 and Phase 2 test files pass. `git status --short
    docs/` prints nothing.
- [ ] 2.3 Checks. One code checker reads the diff against spec D17 to D19.
  - Verify: `measure/runs/model_guide/check-2.3.json` has status pass, or
    each blocking finding has a fix commit.
- [ ] 2.4 [b] The error types of the 52-error key (spec D17, owner question
  Q7). Waits for the PM.
  - When they come, add the types and the counts to
    `data/print-audit-2026-11.json`. Add no book text.
  - Verify: the print-audit test passes, and the block shows the types.
- [ ] 2.5 The preview with the table.
  - Command: `harness/model-guide/preview.sh --export <the 2026-11-14 file>`.
  - Verify: `.tmp/model-guide-preview/index.html` shows the table first,
    with six rows, picks or "no pick yet", evidence, and dates (spec
    acceptance 5 and 6). The orchestrator tells the PM that the preview is
    ready.

Verify (Phase 2): page B and the overview table are in the preview folder by
Wed 2026-11-18. The code review row shows "no pick yet" until Phase 4.

## Phase 3: The track A review set and the scorer (by Thu 2026-11-19)

Spec D4 to D11, D13, FR-8 to FR-10, FR-12.

- [ ] 3.1 Red. Write the tests. Touch these files and no others:
  - `harness/model-guide-tests/pick-diffs.test.ts` (a fake `gh` on PATH)
  - `harness/model-guide-tests/review-set.test.ts`
  - `harness/model-guide-tests/review-score.test.ts`
  - `harness/model-guide-tests/adjudicate.test.ts`
  - `harness/model-guide-tests/leak-check.test.ts`
  - synthetic diffs, keys, and outputs under
    `harness/model-guide-tests/fixtures/review/`
  Normal cases:
  - `pick-diffs.ts` calls only `gh api` GET and lists the commits that meet
    each rule of spec D4, newest first.
  - The lint passes a set that meets spec D5 to D8 and writes the public
    manifest with only the fields of spec D9.
  - A finding in the window with an accepted class matches. The plant
    weight counts once.
  - The pass score follows spec D13: `max(0, 100 × F / W − 2 × X)`.
  - Blocker recall, the found, missed, and false-claim counts, and the
    counts by class and severity are in the pass record.
  - The rank uses the worst pass; a tie goes to the worst blocker recall,
    then to the median.
  - The queue groups the unmatched findings by file and a 3-line window and
    holds no route name.
  - `apply` maps `plant:<id>` to found, `real-defect` to neutral and to the
    key, and `false-claim` to a false claim.
  Edge cases:
  - A line at `new_lines[0] - 3` and `new_lines[1] + 3` matches; one line
    further does not.
  - A wrong class at the right line does not match.
  - A finding between two plants matches the nearer one.
  - A second finding on a found plant is a duplicate and costs nothing.
  - Finding 31 and later are ignored.
  - No JSON block, invalid JSON, or a finding without `file` or `line`
    makes the review `invalid`, with 0 found and 0 false claims.
  - A score below 0 becomes 0.
  - An `unclear` verdict marks the pass `provisional`, and the route has no
    rank. Fewer than 3 complete passes gives `incomplete`.
  - The lint fails on a plant in a removed line, plants fewer than 8 lines
    apart, a plant over 6 lines, a wrong hunk header, a wrong SHA-256, and a
    class or severity count below spec D8.
  - The score file and the manifest hold no `new_lines`, `witness`,
    `operator`, `file`, or finding text.
  - The leak check fails on a staged file with a key field, with the
    private folder path, or with a seeded line of 20 characters or more
    that is not in the source diff. It passes on a clean tree.
  - Verify: each file fails on the Phase 2 code. Record the failed test
    names in `measure/runs/model_guide/red-3.1.txt`.
- [ ] 3.2 Green. Write `pick-diffs.ts`, `review-set.ts`, `review-score.ts`,
  `adjudicate.ts`, `leak-check.ts`, and `review-prompt.md`. Touch no test
  file.
  - Verify: the test files of Phases 1 to 3 pass.
- [ ] 3.3 Checks. One code checker reads the diff against spec D4 to D13.
  - The checker confirms that no public output can hold a key field.
  - Verify: `measure/runs/model_guide/check-3.3.json` has status pass, or
    each blocking finding has a fix commit.
- [ ] 3.4 The candidates. Run `pick-diffs.ts` for each source repo.
  - Store the lists in the private folder. Store nothing in the repository.
  - Verify: each list has 7 or more qualified commits. When a list has
    fewer, the orchestrator tells the PM and widens nothing without an
    answer.
- [ ] 3.5 The seeding (spec D5 to D8). The fixture author
  `claude-code/claude-opus-5-5[1m]#high` writes set `mg-2026-11a` in a fresh
  session, in the private folder only.
  - The session runs through `heavy-run.sh`. It gets the operator catalog of
    spec D6 and the candidate lists.
  - Verify: `review-set.ts lint mg-2026-11a` passes.
- [ ] 3.6 The public manifest. Commit
  `harness/model-guide/data/sets/mg-2026-11a.json` with an explicit path.
  - Run `leak-check.ts` before the commit.
  - Verify: the leak check passes, and the manifest SHA-256 values match the
    private files.

Verify (Phase 3): spec acceptance 8 holds.

## Phase 4: The runner and the first track A results (by Sun 2026-11-22)

Spec D12 to D15, FR-11, FR-14.

- [ ] 4.1 Red. Write the tests. Touch these files and no others:
  - `harness/model-guide-tests/review-run.test.ts`
  - `harness/model-guide-tests/quota.test.ts`
  - `harness/model-guide-tests/credential-provider.test.ts`
  - fake `opencode` and fake quota scripts under
    `harness/model-guide-tests/fixtures/fakes/`
  Each test copies the scripts that it runs into a temp repo, the same as
  `harness/schedule-tests/rescore-guard.test.ts`. The fake child carries the
  text `fake-opencode` in its command line.
  Normal cases:
  - A pass of a `plan` route with every window below 70 % reviews each diff
    of the set once, stores the raw outputs in the temp private folder, and
    writes one pass record.
  - Each call uses `opencode run --standalone --format json --model <route>`
    with the job store, and the job config denies `read`, `edit`, `bash`,
    `webfetch`, `websearch`, `question`, `subagent`, and `skill`.
  - `provider-credential.sh seed <p>` imports only the entry of provider
    `<p>` and prints no value.
  - The trap stops the fake processes and removes the job folder.
  Edge cases:
  - A route that is not in `routes.json`, or whose `kind` is `metered`,
    gives exit 2 before any call.
  - A window at 70 % at the start gives no call. A window at 80 % during
    the pass stops it and leaves it open.
  - A failed read, a missing field, or a value that is not a number stops
    the route.
  - A transport error retries up to 2 times. Three failures leave the pass
    open and not complete.
  - A raw output with a credential value is deleted, and the pass stops.
  - No file is written in the repository or under `docs/`.
  - After each run, `ps -eo pid,args | grep '[f]ake-opencode'` prints no line.
  - Verify: each file fails on the Phase 3 code. Record the failed test
    names in `measure/runs/model_guide/red-4.1.txt`.
- [ ] 4.2 Green. Write `review-run.sh`, `quota.ts`, `routes.json`, and
  `provider-credential.sh`. Add the review page edit of `preview.sh` and
  `pages/review.html`. Touch no test file. Do not change
  `harness/opencode-credential.sh` or `harness/opencode-host.sh`.
  - Verify: the test files of Phases 1 to 4 pass.
  - Verify: `git diff --stat ea36fae -- harness/opencode-credential.sh harness/opencode-host.sh harness/provenance.ts harness/tests`
    prints nothing.
- [ ] 4.3 Checks. One code checker reads the diff against spec D12 to D15.
  - The checker confirms the metered refusal, the 70 % and 80 % rules, and
    the credential scan.
  - Verify: `measure/runs/model_guide/check-4.3.json` has status pass, or
    each blocking finding has a fix commit.
- [ ] 4.4 The route probe (spec D14). One call per route with a control
  diff, through `heavy-run.sh`, in the window of spec D15.
  - Record `reachable` or `unreachable` with the error line in
    `measure/runs/model_guide/probe-4.4.txt`.
  - The orchestrator sends each `unreachable` route to the PM (owner
    question Q8).
  - Verify: each route of `routes.json` has one line in the file.
- [ ] 4.5 The passes. The nights of 2026-11-20, 2026-11-21, and 2026-11-22
  (02:00 to 06:00 +07). One pass per reachable route per night.
  - Command for each route:
    `heavy-run.sh harness/model-guide/review-run.sh --set mg-2026-11a --route <route>`.
  - Verify: each reachable route has 3 complete passes, or the file
    `measure/runs/model_guide/passes-4.5.txt` names the reason (quota stop or
    open pass).
- [ ] 4.6 The adjudication (spec D11). Run `adjudicate.ts queue`, one Opus
  call per diff through `heavy-run.sh`, and then `adjudicate.ts apply`.
  - The orchestrator sends the real-defect list to the PM as a hand-off.
  - Verify: no group stays without a verdict, or the routes with an
    `unclear` verdict show `incomplete`.
- [ ] 4.7 The score file and the review page.
  - Write `harness/model-guide/data/review-scores/mg-2026-11a.json`. Run
    `leak-check.ts`. Commit the file with an explicit path.
  - Run `preview.sh` again.
  - Verify: `.tmp/model-guide-preview/review.html` shows the rank by the
    worst pass, and the code review row of the table has a pick or "no pick
    yet" (spec acceptance 9 and 10).

Verify (Phase 4): the track A first results are in the preview folder by Sun
2026-11-22.

## Phase 5: The publish gate and the weekly update

Spec D19, D21.

- [ ] 5.1 The gate package. The orchestrator sends the preview to the PM for
  Daniel: the folder path, the SHA-256 of each new or changed file, and the
  open owner questions.
  - Verify: the PM confirms the receipt.
- [ ] 5.2 [b] Daniel's word. Waits for Daniel.
  - The orchestrator writes `measure/tracks/model_guide/publish-approval.md`
    with his words, the date, and the SHA-256 values. Commit it with an
    explicit path.
- [ ] 5.3 The first publish. Run `harness/model-guide/publish.ts`.
  - Run `leak-check.ts`. Commit the files under `docs/` with explicit paths.
  - The standing push rule applies from this task on.
  - Verify: `docs/real-work.html`, `docs/review.html`, the three data files,
    and the table in `docs/index.html` match the approved SHA-256 values.
- [ ] 5.4 The first weekly update. When the PM sends the next export, run
  `harness/model-guide/update.sh <file>`.
  - Verify: `docs/assets/data/real-work.json` and
    `docs/assets/data/model-guide.json` show the new `generated_on` and the
    new SHA-256, and the commit holds only those two paths.

Verify (Phase 5): the site shows page B, the review page, and the overview
table, and each table shows its evidence date.

## Backlog note

The replay track (real past tasks with hidden tests) is in the "Backlog"
section of `measure/tracks.md` with no date. This plan has no task for it.
