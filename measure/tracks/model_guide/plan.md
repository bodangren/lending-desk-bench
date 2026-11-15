# Implementation plan — model_guide

PM 2026-11-14: direction change.

This plan builds page B and the overview table first, then the track A
review set and the scorer, then the first track A runs, and then the publish
gate and the weekly update. Spec: `spec.md`. Base commit: `ea36fae`.

Revision 2, 2026-11-14: the findings F1 to F12 of the spec review round 1.
Revision 3, 2026-11-14: the findings F13 to F23 of the spec review round 2.
Each Green task writes one tool or one page, plus its wiring. Each task has
its own verify line.

Order by date:

| Date (+07) | Gate |
|---|---|
| Mon 2026-11-16 18:00 | spec and plan done; the spec review runs before task 1.1 |
| Wed 2026-11-18 | page B and the overview table in the preview folder (Phases 1 and 2) |
| Thu 2026-11-19 | sets `mg-2026-11a` and `mg-2026-11p` and the runner ready (Phases 3 and 4.1 to 4.9) |
| Fri 2026-11-20 and Sat 2026-11-21 | the pilot of `mg-2026-11p` (task 4.11); its passes count as main passes |
| Sun 2026-11-22 | track A first results in the preview folder (Phase 4) |
| after Daniel's word | the first publish (Phase 5) |

Constraints for every role:

- The orchestrator assigns the roles. The spec reviewer and each code
  checker use a model family other than the family of the maker. The spec
  reviewer is not a Claude model (the author family).
- The spec reviewer writes only under `measure/runs/model_guide/`. The author
  or a Build session updates `measure/tracks/model_guide/spec-review.md`
  after a review.
- Each Green task writes one tool or one page, plus its wiring. It has its
  own verify line.
- Stage files by explicit path: `git commit -m ... -- <paths>`. Never stage
  `.opencode/`, `tech-debt.md`, or `measure/runs/`. On an `index.lock`
  error, run the commit once more.
- No role writes a file under `docs/` before Phase 5 (spec D21). The daily
  job commits and pushes `docs/` (spec EV8).
- No role copies the hand-off file into the repository. The same rule holds
  for the print-audit hand-off file of spec OD6.
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
| `harness/model-guide/quota.ts` | quota read and rule (spec D15, FR-15) |
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

## Phase 0: Registry and spec review [checkpoint: 0a44cc9]

- [x] bbde00d 0.1 The registry (spec D2, FR-13). Commit of this plan.
  - `measure/tracks.md` gets `model_guide`, `rigor_a_h` as paused with the
    reason "PM 2026-11-14: no new difficulty work on the build track", and a
    "Backlog" section with the replay track and no date.
  - Verify: `rg -n "model_guide|paused — PM 2026-11-14|Replay" measure/tracks.md`
    shows the three lines.
- [x] 2fae48c 0.2 The spec review (spec D20). Before task 1.1.
  - The reviewer follows the Measure spec-review standard.
  - The reviewer writes only under `measure/runs/model_guide/`.
  - The author or a Build session updates `measure/tracks/model_guide/spec-review.md`
    after the review.
  - The reviewer is of a family other than Claude.
  - Verify: the result file under `measure/runs/model_guide/` holds round 1
    with the id and the severity of each finding. `spec-review.md` has a
    round 1 section with a disposition and an author response for each
    finding. Each Blocker has FIX, CONTEST, or ESCALATE.
  - Evidence: `measure/runs/model_guide/spec-review-bbde00d.json` holds
    round 1 with 4 Blocker, 7 Major, and 1 Nit findings, each with its id
    and its severity. The round 1 section of `spec-review.md` gives each
    finding a disposition and an author response. F1 to F4 are Blocker, and
    each says FIX.
- [x] fab7458 0.3 The re-review of round 1 (spec D20). The reviewer of round 1 reads
  the revised spec and plan.
  - The reviewer writes only under `measure/runs/model_guide/`.
  - The author or a Build session updates `spec-review.md` after the review.
  - Verify: the result file of round 2 names each finding of round 1 as
    fixed, partly fixed, or not fixed. `spec-review.md` has a round 2
    section.
  - Evidence: `measure/runs/model_guide/spec-review-2fae48c.json` holds
    `round1_dispositions` with F1 to F12, each marked fixed or partly
    fixed. The round 2 section of `spec-review.md` records the PM decision
    of 2026-11-14 and the F13 to F23 fixes.

## Phase 1: Page B in the preview folder (by Wed 2026-11-18)

Spec D16, D21, FR-1 to FR-4, FR-7.

- [x] 563d33a 1.1 Red. The merge and the rates. Write these files and no others:
  - `harness/model-guide-tests/real-work.test.ts`
  - `harness/model-guide-tests/fixtures/real-work-mini.json`
  - `harness/model-guide-tests/fixtures/MANIFEST.txt` (synthetic, in the
    `real-work-outcomes/1` shape of spec EV2)
  Normal cases:
  - `x/m#high`, `x/m[1m]#high`, and `x/m` merge into the model key `x/m` by
    sums, and the row lists the three routes.
  - The same model on two providers stays two rows.
  - Pass rate = `pass / (pass + fail + error)`; `no_result` stays out and is
    in its own field.
  - Producer rank: pass rate, then the lower blocking rate. Checker rank:
    pass rate only.
  - Each rate carries its run count.
  - The work-type pass rate = `pass / (pass + fail)`, with the result count
    `pass + fail` beside it.
  - A work-type row sums the role rows of its route and work type.
  - The work-type rank: the higher pass rate, then the higher result count.
  - The coverage block holds the runs, the dates, the two shares, the
    left-out duplicates, and the `unknown` and `other` runs.
  - The 4-week pass rate uses the last 4 ISO weeks of `weekly`.
  Edge cases:
  - A row with 9 runs with a result gets `few runs` and goes below a row
    with 10. A row with 10 has no mark.
  - A work type with fewer than 10 results (`pass + fail`) gets `few runs`
    and cannot pick.
  - A work type with `pass + fail` of 0 has no rate.
  - `unknown` and `other` are in no rank and do not merge.
  - A rank that a rating alone would change does not change.
  - `rater_checks.n` = 0 shows no agreement value.
  - Verify: the file fails on `ea36fae`. Record the failed test names in
    `measure/runs/model_guide/red-1.1.txt`.
  - Evidence: commit 563d33a. `red-1.1.txt` holds the failed test names and
    exit 1. Each test fails with "production file is missing".
- [x] 0f0b2df 1.2 Red. The input check. Write
  `harness/model-guide-tests/input-check.test.ts` and no other file.
  Normal cases:
  - The input check passes on the fixture, and the output keeps the file
    name, the SHA-256, and `generated_on`.
  Edge cases:
  - A changed byte, a wrong size, a wrong schema, or a run sum that differs
    from `coverage.runs` gives exit 2 and no output file.
  - A missing `MANIFEST.txt` gives exit 2.
  - Verify: the file fails on `ea36fae`. Record the failed test names in
    `measure/runs/model_guide/red-1.2.txt`.
  - Evidence: commit 0f0b2df. `red-1.2.txt` holds the failed test names and
    exit 1. Each test fails with "production file is missing".
- [x] b42a234 1.3 Red. The preview and the publish gate. Write
  `harness/model-guide-tests/preview-gate.test.ts` and no other file.
  Normal cases:
  - `preview.sh` writes `real-work.html` and `real-work.json` into a temp
    preview folder, and the nav and the method note text of spec D16 are in
    the page.
  - `preview.sh` records the SHA-256 of each copied file of `docs/` in
    `preview-base.json`.
  Edge cases:
  - `preview.sh` leaves the temp `docs/` copy without a change.
  - `publish.ts` without an approval record, or with one wrong SHA-256,
    gives exit 2 and writes no file.
  - `publish.ts` refuses with exit 2 and names the file when a file of
    `docs/` changed after the preview.
  - Verify: the file fails on `ea36fae`. Record the failed test names in
    `measure/runs/model_guide/red-1.3.txt`.
  - Evidence: commit b42a234. `red-1.3.txt` holds the failed test names and
    exit 1. Each test fails with "production file is missing". Case 7 is an
    added success case for the publish copy.
- [x] f48787c 1.4 Green. Write `harness/model-guide/real-work.ts`. Touch no test file
  and no other file.
  - Evidence: commit f48787c. `real-work.test.ts` 19 passed, `input-check.test.ts`
    6 passed, each run alone with exit 0.
  - Verify: `cd harness && npx vitest run model-guide-tests/real-work.test.ts model-guide-tests/input-check.test.ts --configLoader native`
    passes.
- [x] b38d577 1.5 Green. Write `harness/model-guide/pages/real-work.html`. Touch no
  test file and no other file.
  - Evidence: commit b38d577. `real-work.test.ts` 19 passed with exit 0; the page
    holds the producer table, the checker table, and the work-type tables of spec D16.
  - Verify: `cd harness && npx vitest run model-guide-tests/real-work.test.ts --configLoader native`
    passes, and the page holds the tables of spec D16.
- [x] f36ebb1 1.6 Green. Write `harness/model-guide/preview.sh`. Touch no test file
  and no other file.
  - Evidence: commit f36ebb1 (plus the template one-line note fix it carries).
    `preview-gate.test.ts` 7 passed with exit 0; `git status --short docs/` prints nothing.
  - Verify: `cd harness && npx vitest run model-guide-tests/preview-gate.test.ts --configLoader native`
    passes, and `git status --short docs/` prints nothing.
- [x] 520e1b7 1.7 Green. Write `harness/model-guide/publish.ts`. Touch no test file
  and no other file.
  - Evidence: commit 520e1b7. `preview-gate.test.ts` 7 passed with exit 0;
    `git status --short docs/` prints nothing.
  - Verify: `cd harness && npx vitest run model-guide-tests/preview-gate.test.ts --configLoader native`
    passes, and `git status --short docs/` prints nothing.
- [x] 3a477f5 1.8 Checks. One code checker reads the diff against spec D16 and D21.
  - The checker confirms that no path writes under `docs/` without the
    approval record, that the rank uses no rating, and that the work-type
    tables use only the data of the export.
  - Verify: `measure/runs/model_guide/check-1.8.json` has status pass, or
    each blocking finding has a fix commit.
  - Evidence: reviews A, B, and C at 2131746
    (`measure/runs/model_guide/review-a-2131746.json`,
    `review-b-2131746.json`, `review-c-2131746.json`) found blockers A1 and
    A2. Fix commit 3a477f5 addresses each blocking finding. New reviews on
    the new HEAD follow.
- [x] ef2d16f 1.9 The preview with the real export.
  - Evidence: commit ef2d16f (PM manifest fallback) plus the plan-record
    commit 2131746. `measure/runs/model_guide/preview-1.9.txt` holds the
    command, exit 0, and the checked values.
  - Command:
    `harness/model-guide/preview.sh --export ~/Desktop/handoff/real-work-outcomes/real-work-outcomes-2026-11-14.json`.
  - Verify: `.tmp/model-guide-preview/real-work.html` shows the SHA-256
    `dae855cad4bcd29b0623d8a0b8d4eb75aa16a7ddd6688455735bf312df5464f2`,
    `generated_on` 2026-11-14, 1,798 runs, 2026-06-06 to 2026-11-13,
    50.6 %, and 71.7 % (spec acceptance 2). `git status --short docs/`
    prints nothing.
- [x] 25276eb 1.10 Red. Review fixes, round 1 (A1, A2, A3, B1, B2, B3, C2, C4).
  - Files: `harness/model-guide-tests/preview-gate.test.ts`,
    `harness/model-guide-tests/input-check.test.ts`, and
    `harness/model-guide-tests/leak-guard.test.ts`.
  - Evidence: `red-1.10.txt` holds the failed test names and exit 1.
- [x] 3a477f5 1.11 Green. Review fixes, round 1. Fix A1, A2, A3, B1, B2, C2, C4 in
  `harness/model-guide/` and the task 1.9 record (A4). Touch no test file.
  - Verify: run `preview-gate.test.ts`, `input-check.test.ts`, and
    `leak-guard.test.ts` with one worker.
  - Evidence: `preview-gate.test.ts` exit 0, `input-check.test.ts` exit 0,
    `real-work.test.ts` exit 0, and `leak-guard.test.ts` exit 0, each run
    alone with `--maxWorkers=1 --reporter=dot`. The role log is
    `measure/runs/model_guide/green-p1-43384ea.log`.
- [x] d632534 1.12 Red. Review fixes, round 2 (F12 to F20, F23).
  - Files: `harness/model-guide-tests/preview-gate.test.ts`.
  - Evidence: red-1.12.txt holds the failed test names and exit 1.
- [x] d262139 1.13 Green. Review fixes, round 2. Fix F12 to F21 and F23 in
  `harness/model-guide/`, and re-run the task 1.9 preview at the final HEAD.
  Touch no test file.
  - Verify: run `model-guide-tests/preview-gate.test.ts`,
    `model-guide-tests/input-check.test.ts`, and
    `model-guide-tests/real-work.test.ts` with one worker and the reporter set
    to dot.
  - Evidence: `preview-gate.test.ts` exit 0, `input-check.test.ts` exit 0,
    `real-work.test.ts` exit 0, and `leak-guard.test.ts` exit 0, each run
    alone with `--maxWorkers=1 --reporter=dot`. The role log is
    `measure/runs/model_guide/green-p1-885947e.log`. The task 1.9 preview
    re-run record is `measure/runs/model_guide/preview-1.13.txt`.

- [x] 563a263 1.14 Red. Review fixes, round 3 (A3-1/C3-1, A3-2/C3-3, A3-3, C3-2/A3-4, B2-1).
  - Files: `harness/model-guide-tests/preview-gate.test.ts`,
    `harness/model-guide-tests/input-check.test.ts`.
  - Evidence: `red-1.14.txt` holds the failed test names and exit 1.
- [x] e73023d 1.15 Green. Review fixes, round 3. Fix the five items in harness/model-guide/. Touch no test file.
  - F1 (A3-1/C3-1): preview.sh runs the input check into a temp folder first;
    a refused run leaves an existing preview folder byte-identical and no new
    folder, not even a created parent. F2 (A3-2/C3-3): real-work.ts checks the
    types of the coverage keys and `generated_on` in the schema check, before
    the run-sum check. F3 (A3-3): preview.sh refuses a symlink inside an
    existing preview folder with `preview: refused path <path>`, exit 2, no
    docs write. F4 (C3-2/A3-4): the nav insert keeps exactly one of each link.
    F5 (B2-1): publish.ts and preview.sh map an unreadable docs entry to a
    refusal line, exit 2, no stack trace.
  - Verify: run `model-guide-tests/preview-gate.test.ts`,
    `model-guide-tests/input-check.test.ts`,
    `model-guide-tests/real-work.test.ts`, and
    `model-guide-tests/leak-guard.test.ts` with one worker and the reporter
    set to dot; `bash -n harness/model-guide/preview.sh`.
  - Evidence: commit e73023d. Each of the four test files exits 0 when run
    alone with `--maxWorkers=1 --reporter=dot`; `bash -n
    harness/model-guide/preview.sh` exits 0. The role log is
    `measure/runs/model_guide/green-p1-eb85c0a.log`. The task 1.9 preview
    re-run record is `measure/runs/model_guide/preview-1.15.txt`.
- [x] 7682719 1.16 Red. Review fixes, round 4 (A4-1/C4-2, B3-1/A4-2, A4-3, A4-4/C4-3).
  - Files: `harness/model-guide-tests/preview-gate.test.ts`.
  - Evidence: `red-1.16.txt` holds the failed test names and exit 1
    (`Tests  9 failed | 76 passed (85)`); input-check.test.ts 15 passed,
    real-work.test.ts 19 passed, and leak-guard.test.ts 2 passed, each run
    alone with exit 0. The A3-3 test now asserts the exact refusal line
    (A4-4/C4-3) and passes at HEAD, so it pins the line text for Green.
- [x] 6553f5b 1.17 Green. Review fixes, round 4 (A4-1/C4-2, B3-1/A4-2, A4-3, A4-4/C4-3).
  - Files: `harness/model-guide/preview.sh`, `harness/model-guide/publish.ts`.
  - Evidence: the Red run at HEAD failed `Tests 9 failed | 76 passed (85)`,
    exit 1. After the fix, each file alone with one worker and the dot
    reporter exits 0: preview-gate 85 passed, input-check 15 passed,
    real-work 19 passed, leak-guard 2 passed; `bash -n
    harness/model-guide/preview.sh` exits 0. The role log is
    `measure/runs/model_guide/green-p1-6dc3b4f.log`. The task 1.9 preview
    re-run record is `measure/runs/model_guide/preview-1.17.txt`.

- [x] 825182a 1.18 Red. Adversarial record and test-owner fixes (ADV-12,
  ADV-13).
  - Files: `harness/model-guide-tests/leak-guard.test.ts`.
  - Evidence: the adversarial record f014ee8
    (`measure/runs/model_guide/adversarial-0acceea.json`,
    `adversarial.test.ts`, 49 tests, 22 failed on 0acceea) names ADV-12:
    the guard pushes the symlink line text `link <rel> <target>` as a
    relative path and reads it back, so a symlink in the folder throws
    ENOENT; and ADV-13: the needle match is case-sensitive, so an
    upper-case export SHA-256 passes.
  - Verify: run `leak-guard.test.ts` (exit 0) and `adversarial.test.ts`
    (the remaining failures name only ADV-1 to ADV-11), each alone with
    one worker and the reporter set to dot.
  - Evidence: commit 825182a. `leak-guard.test.ts` exits 0 (2 passed) on
    the real test folder. `adversarial.test.ts` went from 22 failed |
    27 passed (49) to 20 failed | 29 passed (49), exit 1: the ADV-12 and
    ADV-13 L tests pass, and every remaining failing test belongs to
    ADV-1 to ADV-11. The record is `measure/runs/model_guide/red-1.18.txt`
    (not staged).
- [x] 1cc5657 1.19 Green. Adversarial fixes ADV-1 to ADV-11 in
  `harness/model-guide/`. Touch no test file.
  - Evidence: fix SHAs 1cc5657 (publish.ts), f3d5843 (preview.sh),
    b7e24da (real-work.ts). Each file alone with one worker and the dot
    reporter exits 0 at b7e24da: preview-gate 85 passed, input-check 15
    passed, real-work 19 passed, leak-guard 2 passed, adversarial 49
    passed; `bash -n harness/model-guide/preview.sh` exits 0. The task 1.9
    preview re-run record is `measure/runs/model_guide/preview-1.19.txt`.
    The role log is `measure/runs/model_guide/green-p1-8eafbc3.log`.
  - Verify: run `preview-gate.test.ts`, `input-check.test.ts`,
    `real-work.test.ts`, `leak-guard.test.ts`, and `adversarial.test.ts`,
    each alone with one worker and the reporter set to dot.

- [x] b06ac41 1.20 Red. UX fixes U1, U3, U4 (ux-browser-2a9d421).
  - Files: `harness/model-guide-tests/preview-gate.test.ts`.
  - Evidence: commit b06ac41. The three new tests fail on 2a9d421 for the
    pinned reasons: U1 the source paragraph carries no wrap rule, U3 the
    `.table-wrap` tags carry no `tabindex`, `role`, or `aria-label`, U4 the
    active nav link carries no `aria-current="page"`. The existing
    preview-gate tests and the four companion files still pass. The record
    is `measure/runs/model_guide/red-1.20.txt` (not staged). U2 and U5 stay
    out of scope as nonblocking phase-acceptance items.
- [x] 7618b8c 1.21 Green. UX fixes U1, U3, U4 in `harness/model-guide/`.
  Touch no test file.
  - Evidence: commit 7618b8c. U1 gives the source paragraph
    `style="overflow-wrap: anywhere"` in `pages/real-work.html`; U3 gives
    every `.table-wrap` `tabindex="0"`, `role="region"`, and a table name in
    `aria-label` (the two role tables in `pages/real-work.html` and the
    work-type boxes in `preview.sh`); U4 adds `aria-current="page"` to the
    `./real-work.html` nav link only. The role log is
    `measure/runs/model_guide/green-p1-d344a21.log`. The task 1.9 preview
    re-run record is `measure/runs/model_guide/preview-1.21.txt`.
  - Verify: run `preview-gate.test.ts`, `input-check.test.ts`,
    `real-work.test.ts`, `leak-guard.test.ts`, and `adversarial.test.ts`,
    each alone with one worker and the reporter set to dot.

- [x] 530c73a 1.22 Red. Acceptance 5 "no pick yet" (PA1-1, phase-acceptance-80c17f5).
  - Evidence: commit 530c73a. The record is `measure/runs/model_guide/red-1.22.txt`
    (not staged). Ruling: each work type that appears in the export (the work_types
    keys of any all_time row, including rows on the unknown or other route) gets a
    section on the page.
- [x] 56a173b 1.23 Green. Acceptance 5 "no pick yet" in `harness/model-guide/`.
  Touch no test file.
  - Evidence: commit 56a173b. `real-work.ts` keeps every work-type name that
    appears in any all_time row, also on the unknown or other route, with an
    empty row list; the numeric row build still skips those routes, so the
    object stays the ADV-8 `Object.fromEntries` build. `preview.sh` renders
    one section per work_types key: an empty list gives the H3 heading and
    `no pick yet` with no table, and a filled list keeps the U3 attributes.
    The role log is `measure/runs/model_guide/green-p1-5993d28.log`. The
    task 1.9 preview re-run record is
    `measure/runs/model_guide/preview-1.23.txt`.
  - Verify: run `preview-gate.test.ts`, `input-check.test.ts`, `real-work.test.ts`,
    `leak-guard.test.ts`, and `adversarial.test.ts`, each alone with one worker and
    the reporter set to dot.

Verify (Phase 1): spec acceptance 2, 3, 4, 5, and 8 hold in the preview
folder.

## Phase 2: The print-audit block and the overview table (by Wed 2026-11-18)

Spec D17, D18, D19, FR-5, FR-6.

- [x] 721d77a 2.1 Red. The print-audit block. Write
  `harness/model-guide-tests/print-audit.test.ts`,
  `harness/model-guide-tests/preview-gate.test.ts`, and the fixture folders
  `harness/model-guide-tests/fixtures/print-audit/` and
  `harness/model-guide-tests/fixtures/page-guard/`.
  - Plan change (PA2-1): the widened file list cites PA2-1 of
    `measure/runs/model_guide/phase-acceptance-9cb95b6.json`. Task 2.1 needs
    `preview-gate.test.ts` for the four page guards G1 to G4.
  Normal cases:
  - The block shows 11 of 13 and 13 of 13, the key size 52, the error types
    with their counts, the checklist items of the mapped rows, the result of
    each run, and the bias note.
  - The input check of the hand-off file of spec OD6 passes on the file. It
    reads the SHA-256 from `MANIFEST.txt` and the shape of the file (spec
    D17).
  Edge cases:
  - A changed byte, a wrong SHA-256 in `MANIFEST.txt`, a missing top key, or
    a wrong count of `errors` rows gives exit 2 and no output file.
  - The file holds no key `pages`, `text`, or `file`; a test fails on any
    such key.
  - The page shows no line "Error types: not yet received.".
  - Verify: the file fails on the Phase 1 code. Record the failed test names
    in `measure/runs/model_guide/red-2.1.txt`.
  - Evidence: commit 721d77a holds both test files and both fixture folders.
    `measure/runs/model_guide/red-2.1.txt` holds the failed test names, the
    exit codes, the Tests lines, and the PA2-1 reason that G1 to G4 pass at
    the base.
- [x] 7da3eca 2.2 Red. The overview table. Write `harness/model-guide-tests/guide.test.ts`
  and the fixture folder `harness/model-guide-tests/fixtures/guide/`.
  - File list: the fixture folder holds the synthetic track A score file
    `review-scores-mini.json` and the base-line files `benchmark-mini.json`
    and `tracks-mini.json`. The test also reuses `fixtures/real-work-mini.json`
    and `fixtures/print-audit/print-audit-mini.json`.
  Normal cases:
  - The table has the six rows of spec D18 in that order.
  - The first source picks the first and the second choice. The evidence
    cell holds the source, the number, and the run count. Each row has its
    evidence date.
  - The base line shows beside the pick and never changes it.
  - The rows of app code, docs and ops, print books, and tooling use the
    work-type table.
  Edge cases:
  - No qualified model in the first source: the second source picks.
  - No qualified model in either source: "no pick yet: not enough evidence".
  - Evidence older than 14 days gives the mark `stale`; 14 days gives none.
  - A track A route with `incomplete` does not qualify.
  - Verify: the file fails on the Phase 1 code. Record the failed test names
    in `measure/runs/model_guide/red-2.2.txt`.
  - Evidence: commit 7da3eca holds the test file and the fixture folder
    `harness/model-guide-tests/fixtures/guide/`.
    `measure/runs/model_guide/red-2.2.txt` holds the failed test names, the
    exit codes, the Tests lines, and the two open spec decisions that the
    test leaves unpinned (the D18 role `red` filter, and the code review
    fallback before Phase 4).
- [x] b839dab 2.3 Red. The weekly update. Write `harness/model-guide-tests/update.test.ts` and add the two D18 ruling tests to `harness/model-guide-tests/guide.test.ts`.
  - File list: no new fixture folder. Both files reuse `fixtures/real-work-mini.json`, `fixtures/print-audit/`, and `fixtures/guide/`. The two commits are `b839dab` (tests) and this plan commit.
  Normal cases:
  - `update.sh` before the approval writes into the preview folder only.
  - `update.sh` after the approval writes the two data files into a temp
    `docs/assets/data/` and runs `git commit` with explicit paths only.
  Edge cases:
  - `update.sh` with a failed input check gives exit 2 and changes no file.
  - Ruling Q1 (spec D18): the test writing row uses the page B producer table as a whole, because `real-work.json` has no role key; its evidence cell starts with "page B producer".
  - Ruling Q2 (spec D18): the code review row shows "no pick yet: not enough evidence" while track A has no complete rank, even when the page B checker table has a qualified model; the checker table does not pick for code review before Phase 4.
  - Verify: the file fails on the Phase 1 code. Record the failed test names
    in `measure/runs/model_guide/red-2.3.txt`.
  - Evidence: commit b839dab holds `update.test.ts` and the two ruling tests
    in `guide.test.ts`. `measure/runs/model_guide/red-2.3.txt` holds the
    failed test names, the exit codes, and the Tests lines of the eight
    single-file runs.
- [x] 5a0350c 2.4 Green. Write `harness/model-guide/data/print-audit-2026-11.json` and
  the print-audit block of `harness/model-guide/pages/real-work.html`, plus
  that wiring. Touch no test file.
  - The data file comes from the hand-off file of spec OD6. The input check
    of spec D17 passes first: the SHA-256 from `MANIFEST.txt` and the shape
    of the file. The file holds no book text and no page.
  - File list: the tool `harness/model-guide/print-audit.ts` writes the data
    file, and the `print-audit_block` function of
    `harness/model-guide/preview.sh` renders the block into the template
    token `<!--MODEL-GUIDE:PRINT-AUDIT-->`. The block holds lists and no
    table, so the page guard PA1-1 reads no table after the work types.
  - Verify: `cd harness && npx vitest run model-guide-tests/print-audit.test.ts --configLoader native`
    passes, and `git status --short docs/` prints nothing.
  - Evidence: commit 5a0350c holds the tool, the data file, and the block
    wiring. `measure/runs/model_guide/green-p2-66c1759.log` holds the exit
    codes of the single-file runs and the OD6 input check.
- [x] 3fef9a8 2.4a Red. Re-pin the print-audit fixture to the real OD6 key shape (Green 2.4 shape note).
  - Ruling (D17): the error types are the severity classes blocker, major, minor with the count of rows of each; the checklist code is the `item` value; a run result is the row value under the route short key; a route result is `blockers_found` over `summary.key.blockers`.
  - Evidence: commit 3fef9a8 holds the fixture pair, `print-audit.test.ts`, the PA2-1 block of `preview-gate.test.ts`, and the real-shape assembly helper of `guide.test.ts` and `update.test.ts`. `measure/runs/model_guide/red-2.4a.txt` holds the single-file commands, their exit codes, their Tests lines, and each failed test name with the reason it fails at HEAD.
- [x] b8f9045 2.4b Green. Read only the real OD6 shape in print-audit.ts. Touch no test file.
  - The tool now reads one hand-off shape. A route value must be a string,
    a row holds id, severity, checklist (`item` and `text`), and one string
    per route short key, and a row carries no `type` and no `results` key.
    The old shape gives exit 2 with `input-check: errors`, and a route value
    that is not a string gives exit 2 with `input-check: keys`.
  - The rows of the output hold the fields id, severity, checklist (code and
    text), and results. `error_types` counts the severity classes. `routes`
    maps the route name to `blockers_found of summary.key.blockers`. A plain
    `__proto__` key in summary becomes no route and no row.
  - The data file `harness/model-guide/data/print-audit-2026-11.json` is
    refreshed from the hand-off file of SHA-256
    f52a7bbf0f4263a84a16dba02cb4ccf4c76b6f40d3e70110104ebbf6140a6e87.
    `preview.sh` did not change: the block already reads the new row shape.
  - Evidence: commit b8f9045 holds the tool and the data file.
    `measure/runs/model_guide/green-p2-dcaa77d.log` holds the single-file
    commands, their exit codes, and their Tests lines.
- [x] c99de30 2.5a Red. Fix the T4 starve cell of guide.test.ts (Green 2.5 block).
  - The starve cell is per export row. The Phase 1 merge joins the three
    print-books rows of model x/m, so the cell must keep the merged model
    under 10 results: `{ runs: 8, pass: 1, fail: 1 }` gives x/m n 6.
  - The docs-and-ops twin T5 keeps its cell and stays valid.
  - Verify: `cd harness && npx vitest run model-guide-tests/guide.test.ts --configLoader native --maxWorkers=1 --reporter=dot`
    and record the result in `measure/runs/model_guide/red-2.5a.txt`.
  - Evidence: commit c99de30 holds the one-line T4 cell fix.
    `measure/runs/model_guide/red-2.5a.txt` holds the single-file commands,
    their exit codes, their Tests lines, and each failed test name with the
    reason it fails at HEAD.
- [x] 9ecfa60 2.5 Green. Write `harness/model-guide/guide.ts`. Touch no test
  file and no other file.
  - The tool holds the pinned command line, the six D18 rows in order, the
    exact row keys, the evidence forms of page B, page B producer, track A,
    and print-audit, the evidence dates, the two base lines, the 10-run and
    complete-rank rules, and rulings Q1 and Q2.
  - The page-B tables are read into maps. A `__proto__` name stays an
    ordinary entry, so no hostile name becomes a row or a route.
  - An absent `--scores` flag or a missing score file gives the no-pick
    code review row and exit 0. A bad input gives exit 2 and one line.
  - The three page tests of task 2.6 still fail, because `preview.sh` does
    not render the table yet: "T5 page", "B8-1 page", and the page part of
    "D18 Q2".
  - Evidence: commit 9ecfa60 holds the tool.
    `measure/runs/model_guide/green-p2-9813d5f.log` holds the single-file
    command, its exit code, its Tests line, and the failed test names.
- [x] 61c99c1 2.6 Green. Write `harness/model-guide/pages/guide-section.html` and the
  overview edit of `harness/model-guide/preview.sh`, plus that wiring. Touch
  no test file.
  - `preview.sh` runs `guide.ts` during the preview, writes `model-guide.json`
    into the preview folder, and inserts the six D18 rows above the current
    hero from `pages/guide-section.html`. It reads the newest score file under
    `harness/model-guide/data/review-scores/` when one exists, and it passes
    no score file before Phase 4.
  - Each row shows the pick or "no pick yet: not enough evidence", the second
    choice, the evidence cell, the evidence date, and the base line beside the
    pick where one exists. A stale table shows the stale mark. A second
    preview over a published index keeps one section.
  - Every model name and every data text uses `html.escape`. The table sits in
    a `.table-wrap` with `tabindex="0"`, `role="region"`, and an aria-label;
    long text wraps at 390 px.
  - A temp repo copy that holds no build or tests data file keeps the page and
    omits the table. The real repo holds all three data files.
  - Verify: `cd harness && npx vitest run model-guide-tests/guide.test.ts --configLoader native`
    passes, and `git status --short docs/` prints nothing.
  - Evidence: commit 61c99c1 holds the section template and the preview edit.
    `measure/runs/model_guide/green-p2-38b24ce.log` holds the single-file
    commands, their exit codes, and their Tests lines.
- [x] 93f79f1 2.7a Red. Fix approve() and the U3 status check of update.test.ts (Green 2.7 block).
  - `approve(root)` commits the approval record before `update.sh` runs, so
    the record never shows up as an untracked `measure/` path in U2. U3
    reads `git status --short` once after the byte append and compares the
    run-end status with that string, because the fixture copy is dirty by
    design. The file also imports `rmSync`, which its cleanup hook used.
  - Verify: `cd harness && npx vitest run model-guide-tests/update.test.ts --configLoader native`
    passes with `harness/model-guide/update.sh` present.
  - Evidence: commit 93f79f1 holds the three fixes and no production file.
    `measure/runs/model_guide/red-2.7a.txt` holds the commands, the exit
    codes, and the Tests lines of each single-file run.
- [x] 1cc8792 2.7 Green. Write `harness/model-guide/update.sh`. Touch no test file
  and no other file.
  - Verify: `cd harness && npx vitest run model-guide-tests/update.test.ts --configLoader native`
    passes, and `git status --short docs/` prints nothing.
  - Evidence: commit 1cc8792 holds `harness/model-guide/update.sh`.
    `measure/runs/model_guide/green-p2-be59fe2.log` holds the command, its
    exit code, and its Tests line.
- [x] 70ebfc5 2.8 Checks. One code checker reads the diff against spec D17 to D19.
  - Verify: `measure/runs/model_guide/check-2.8.json` has status pass, or
    each blocking finding has a fix commit.
  - Evidence: `measure/runs/model_guide/check-2.8.json` holds status pass at
    e13413f (route `opencode-go/muse-spark-1.3-contributor#high`) and no
    open blocking finding. Every Phase 2 blocking finding has its fix
    commit: P2ADV-1 to P2ADV-5 in be41213, P2B2-1 and P2B2-2 in 38d1071,
    P2ADV2-1 in 2e4e641, and P2U1-1 in 70ebfc5.
  - Evidence: the five final audits at e13413f each hold status pass:
    `review-a-e13413f.json`, `review-b-e13413f.json`,
    `review-c-e13413f.json`, `adversarial-e13413f.json`, and
    `ux-browser-e13413f.json` under `measure/runs/model_guide/`.
  - Note: closeout gate item 3 (`git diff --name-only
    <phase_base_sha>..HEAD -- docs/` prints nothing) fails only on the
    daily publish commits 05acc8c and 119b06d, which are not Phase 2 work
    (nit P2A1-2).
  - Note: PM 2026-11-16 rewrote closeout gate item 3 to exclude the daily
    publish commits (subject starts with `Publish daily`, changes only
    `docs/assets/data/`), and answered Q6: the print-audit block names the
    full routes `kimi-code-plan-cn/k3.1-pro` and
    `claude-code/claude-sonnet-5-5#high`.
- [x] c205762 2.9 The preview with the table.
  - Evidence: `measure/runs/model_guide/preview-2.9.txt` holds the command,
    exit 0, and the six rows with their picks, second choices, evidence, and
    dates.
  - Command: `harness/model-guide/preview.sh --export <the 2026-11-14 file>`.
  - Verify: `.tmp/model-guide-preview/index.html` shows the table first,
    with six rows, picks or "no pick yet", evidence, and dates (spec
    acceptance 7). The orchestrator tells the PM that the preview is
    ready.
- [x] 9dd0833 2.10 Adversarial. Phase 2 adversarial tests.
  - `harness/model-guide-tests/adversarial-p2.test.ts` attacks the track A
    tie-break of spec D13, the newest score file of `preview.sh` and
    `update.sh`, the no-change rerun of spec D19, the flag validation of
    `guide.ts`, and a symlinked `docs/assets/data` of spec D21. Every git
    action and every script run happens in a temp repo.
  - Evidence: `measure/runs/model_guide/adversarial-6132fb7.json` holds 5
    blocking defects (P2ADV-1 to P2ADV-5) and 9 passing boundary pins.
- [x] be41213 2.11 Green. Adversarial fixes P2ADV-1 to P2ADV-5.
  - `guide.ts` breaks a worst-score tie by the higher worst blocker recall,
    then the higher median score, and refuses inherited flag names.
    `preview.sh` and `update.sh` take the newest score file by modification
    time. `update.sh` refuses a symlinked data path with exit 2 and exits 0
    with no commit on a no-change rerun.
  - Verify: `adversarial-p2.test.ts` and the eight required suites each
    exit 0 run alone, and `git status --short docs/` prints nothing.
  - Evidence: `measure/runs/model_guide/green-p2-9dd0833.log` holds the
    commands, the exit codes, the Tests lines, and the unchanged six rows
    of the task 2.9 preview.
- [x] 62b7433 2.12 Red. Review B round 2 tests (P2B2-1 file symlinks, P2B2-2 newline names).
  - Findings: `measure/runs/model_guide/review-b-3d42bf8.json`.
  - P2B2-1: the `update.sh` symlink guard checks only `docs`,
    `docs/assets`, and `docs/assets/data`, not the files it writes through
    (`docs/assets/data/real-work.json`, `docs/assets/data/model-guide.json`)
    and not the preview folder or its two target files before the approval.
  - P2B2-2: the `ls -1t | head -n 1` newest score file rule of
    `update.sh` and `preview.sh` is steered by a file name that holds a
    newline. Pinned contract: the truly newest file by modification time
    wins for both scripts.
  - Verify: `cd harness && npx vitest run model-guide-tests/update.test.ts --configLoader native`
    and the same line for `preview-gate.test.ts` fail on the two new
    findings, and the other required suites exit 0.
  - Evidence: commit 62b7433 holds the four tests in `update.test.ts` and
    the one test in `preview-gate.test.ts`.
    `measure/runs/model_guide/red-2.12.txt` holds the failed test names,
    the exit codes, and the Tests lines of each single-file run.
- [x] 38d1071 2.13 Green. Fix P2B2-1 and P2B2-2 in update.sh and preview.sh. Touch no test file.
  - `update.sh` refuses a symlink at every path it writes through: the
    three data folders, the two docs target files, the preview folder, and
    its two target files (exit 2, one refusal line, before any write).
    Both scripts pick the newest score file by whole-path modification time,
    so a newline in a name cannot steer the pick.
  - Verify: `update.test.ts` and `preview-gate.test.ts` exit 0 run alone,
    and the other required suites stay exit 0. `git status --short docs/`
    prints nothing.
  - Evidence: `measure/runs/model_guide/green-p2-313ab94.log` holds the
    commands, the exit codes, and the unchanged six rows of the task 2.9
    preview.
- [x] 5037e77 2.14 Red. Adversarial round 2 test (P2ADV2-1 symlinked .tmp parent).
  - Finding: `measure/runs/model_guide/adversarial-12e753b.json`. The
    refusal loop of `update.sh` checks `$PREVIEW_ABS` but not its parents
    inside the repo, so a symlinked `<repo>/.tmp` sends `mkdir -p` and both
    copies outside the repo with exit 0, against the `update.sh` header and
    spec D21.
  - Verify: `cd harness && npx vitest run model-guide-tests/update.test.ts --configLoader native`
    fails on the new test only, and `preview-gate.test.ts`,
    `adversarial-p2.test.ts`, and `guide.test.ts` each exit 0.
  - Evidence: commit 5037e77 holds the test `P2B2-1d` in
    `harness/model-guide-tests/update.test.ts`.
    `measure/runs/model_guide/red-2.14.txt` holds the failed test name, the
    exit codes, and the Tests lines of each single-file run.
- [x] 2e4e641 2.15 Green. Fix P2ADV2-1 in update.sh (refuse a symlink on every parent of the preview folder inside the repo). Touch no test file.
  - The -L refusal loop builds the chain of folders between the repo root
    and `$PREVIEW_ABS`, so a planted `<repo>/.tmp` link gives one line
    `update: refused path <path>` and exit 2 before the mktemp and the
    input check. A deeper preview path stays covered.
  - Verify: `update.test.ts` exits 0 with P2B2-1d green, and the other
    required suites stay exit 0. `git status --short docs/` prints nothing.
  - Evidence: `measure/runs/model_guide/green-p2-58811b2.log` holds the
    commands, the exit codes, and the unchanged six rows of the task 2.9
    preview.
- [x] a26cf96 2.16 Red. UX test for the print-audit bias note (P2U1-1).
  - Finding: `measure/runs/model_guide/ux-browser-b4fba01.json`. The block
    renders only the top-level `note` (the scope note), so
    `summary.bias_note` never reaches `real-work.html` and the string
    `wrote the answer key` appears 0 times in the page.
  - Spec D17: the block shows the two results, the error types with their
    counts, and the bias note. The tool header and spec D17 list the bias
    note as an output item of its own, beside the summary.
  - Verify: `cd harness && npx vitest run model-guide-tests/print-audit.test.ts --configLoader native`
    and the same line for `preview-gate.test.ts` fail on the new tests
    only, and `update.test.ts`, `adversarial-p2.test.ts`, and
    `guide.test.ts` each exit 0.
  - Evidence: commit a26cf96 holds the two tests in `print-audit.test.ts`
    and the one test in `preview-gate.test.ts`; no existing assertion and
    no fixture file changed.
    `measure/runs/model_guide/red-2.16.txt` holds the failed test names,
    the exit codes, the Tests lines of each single-file run, and the
    recorded contract decision on the output field `bias_note`.
- [x] 70ebfc5 2.17 Green. Show the bias note in the print-audit block (P2U1-1). Touch no test file.
  - `print-audit.ts` writes `bias_note` beside `summary` and `note`, from
    `summary.bias_note` when it is a string. `preview.sh`
    `print_audit_block` renders it, escaped, and keeps the top-level note
    line. The real data file is regenerated from the hand-off whose SHA-256
    matches its MANIFEST, and only the `bias_note` item changed.
  - Verify: `print-audit.test.ts` and `preview-gate.test.ts` exit 0 run
    alone, and the other required suites stay exit 0. `git status --short
    docs/` prints nothing.
  - Evidence: `measure/runs/model_guide/green-p2-8579399.log` holds the
    commands, the exit codes, and the unchanged six rows of the task 2.9
    preview.

Verify (Phase 2): page B and the overview table are in the preview folder by
Wed 2026-11-18. The code review row shows "no pick yet" until Phase 4.

## Phase 3: The track A review set and the scorer (by Thu 2026-11-19)

Spec D4 to D11, D13, FR-8 to FR-10, FR-12.

- [x] 84553cd 3.1 Red. The candidate diffs. Write
  `harness/model-guide-tests/pick-diffs.test.ts` and the fake `gh` under
  `harness/model-guide-tests/fixtures/fakes/`. Touch no other file.
  Normal cases:
  - `pick-diffs.ts` calls only `gh api` GET and lists the commits that meet
    each rule of spec D4, newest first.
  - The tool selects the diffs by the rules of D4 and skips each diff that a
    set already holds.
  Edge cases:
  - A merge commit, a date outside the range, a file count outside 1 to 8,
    a line count outside 40 to 400, a share of code lines below 60 %, a lock
    file, a binary file, a file under `dist/`, `build/`, or `generated/`, and
    a file over 2 000 lines each get a reason line and no selection.
  - Verify: the file fails on the Phase 2 code. Record the failed test names
    in `measure/runs/model_guide/red-3.1.txt`.
  - Evidence: `measure/runs/model_guide/red-3.1.txt` holds the command, the
    exit code, the failed test names, and the exact `$FAKE_GH_LOG` lines that
    the accepted run must make.
- [x] 2dda97b 3.2 Red. The set lint. Write `harness/model-guide-tests/review-set.test.ts`
  and the synthetic diffs and keys under
  `harness/model-guide-tests/fixtures/review/`. Touch no other file.
  Normal cases:
  - The lint passes a set that meets spec D5 to D8 and writes the public
    manifest with only the fields of spec D9.
  - The lint accepts the operator of each class of the catalog of spec D6.
  Edge cases:
  - A plant in a removed line, plants fewer than 8 lines apart, a plant over
    6 lines, a wrong hunk header, a wrong SHA-256, and a class or severity
    count below spec D8 each fail the lint.
  - An operator that is not in the catalog of its class fails the lint.
  - Verify: the file fails on the Phase 2 code. Record the failed test names
    in `measure/runs/model_guide/red-3.2.txt`.
  - Evidence: `measure/runs/model_guide/red-3.2.txt` holds the command, the
    exit code, and the failed test names. The fixture set holds 14 diffs and
    48 plants, and `fixtures/review/outputs/` holds the raw outputs that
    tasks 3.3 and 3.4 reuse.
- [x] cf3781d 3.3 Red. The scorer. Write `harness/model-guide-tests/review-score.test.ts`
  and no other file.
  Normal cases:
  - A finding in the window with an accepted class matches. The plant
    weight counts once.
  - The pass score follows spec D13: `max(0, 100 × F / W − 2 × X)`.
  - Blocker recall, the found, missed, and false-claim counts, and the
    counts by class and severity are in the pass record.
  - The rank uses the worst pass; a tie goes to the worst blocker recall,
    then to the median.
  Edge cases:
  - A line at `new_lines[0] - 3` and `new_lines[1] + 3` matches; one line
    further does not.
  - A wrong class at the right line does not match. No verdict makes it
    found.
  - A wrong line outside the window does not match. No verdict makes it
    found.
  - A finding between two plants matches the nearer one.
  - A second finding on a found plant is a duplicate and costs nothing.
  - Finding 31 and later are ignored.
  - No JSON block, invalid JSON, or a finding without `file` or `line`
    makes the review `invalid`, with 0 found and 0 false claims.
  - A score below 0 becomes 0.
  - An `unclear` verdict marks the pass `provisional`, and the route keeps
    its rank. Fewer than 3 complete passes gives `incomplete`.
  - The score file holds no `new_lines`, `witness`, `operator`, `file`, or
    finding text.
  - Verify: the file fails on the Phase 2 code. Record the failed test names
    in `measure/runs/model_guide/red-3.3.txt`.
  - Evidence: `measure/runs/model_guide/red-3.3.txt` holds the command, the
    exit code, the failed test names, and the W of the reused corpus. The
    test adds no fixture; it reuses the keys and outputs of task 3.2.
- [x] 5097acc 3.4 Red. The adjudication queue. Write
  `harness/model-guide-tests/adjudicate.test.ts` and no other file.
  Normal cases:
  - The queue writes one item per finding, with the id of the finding, and
    no route name.
  - The queue groups by file and a 3-line window.
  - `apply` maps `real-defect` to neutral and to the key, `false-claim` to
    a false claim, and `unclear` to `provisional`.
  - A verdict that the two judges do not share counts as `unclear`.
  Edge cases:
  - A group with two different claims holds two items and no shared verdict.
  - A finding with a wrong line or a wrong class never becomes found.
  - A disagreement never counts against the model.
  - Verify: the file fails on the Phase 2 code. Record the failed test names
    in `measure/runs/model_guide/red-3.4.txt`.
  - Evidence: `measure/runs/model_guide/red-3.4.txt` holds the command, the
    exit code, and the failed test names. The test reuses the task 3.2
    corpus and the task 3.3 verdict contract; it adds no fixture.
- [~] 3.5 Red. The leak check. Write `harness/model-guide-tests/leak-check.test.ts
  and no other file.
  Normal cases:
  - The leak check passes on a clean tree.
  Edge cases:
  - The leak check fails on a staged file with a key field, with the
    private folder path, or with a seeded line of 20 characters or more
    that is not in the source diff.
  - Verify: the file fails on the Phase 2 code. Record the failed test names
    in `measure/runs/model_guide/red-3.5.txt`.
- [ ] 3.6 Green. Write `harness/model-guide/pick-diffs.ts`. Touch no test
  file and no other file.
  - Verify: `cd harness && npx vitest run model-guide-tests/pick-diffs.test.ts --configLoader native`
    passes.
- [ ] 3.7 Green. Write `harness/model-guide/review-set.ts`. Touch no test
  file and no other file.
  - Verify: `cd harness && npx vitest run model-guide-tests/review-set.test.ts --configLoader native`
    passes.
- [ ] 3.8 Green. Write `harness/model-guide/review-score.ts`. Touch no test
  file and no other file.
  - Verify: `cd harness && npx vitest run model-guide-tests/review-score.test.ts --configLoader native`
    passes.
- [ ] 3.9 Green. Write `harness/model-guide/adjudicate.ts`. Touch no test
  file and no other file.
  - Verify: `cd harness && npx vitest run model-guide-tests/adjudicate.test.ts --configLoader native`
    passes.
- [ ] 3.10 Green. Write `harness/model-guide/leak-check.ts`. Touch no test
  file and no other file.
  - Verify: `cd harness && npx vitest run model-guide-tests/leak-check.test.ts --configLoader native`
    passes.
- [ ] 3.11 Green. Write `harness/model-guide/review-prompt.md`. Touch no test
  file and no other file.
  - Verify: the test files of Phases 1 to 3 pass.
- [ ] 3.12 Checks. One code checker reads the diff against spec D4 to D13
  and D22.
  - The checker confirms that no public output can hold a key field, that
    the lint checks the operator catalog, and that the rule of two judges
    holds.
  - Verify: `measure/runs/model_guide/check-3.12.json` has status pass, or
    each blocking finding has a fix commit.
- [ ] 3.13 The candidates. Run `pick-diffs.ts` for each source repo.
  - Store the lists in the private folder. Store nothing in the repository.
  - Verify: each list has 7 or more qualified commits. When a list has
    fewer, the orchestrator tells the PM and widens nothing without an
    answer.
- [ ] 3.14 The seeding (spec D5 to D8). The fixture author
  `claude-code/claude-opus-5-5[1m]#high` writes set `mg-2026-11a` in a fresh
  session, in the private folder only.
  - The session runs through `heavy-run.sh`. It gets the operator catalog of
    spec D6 and the candidate lists.
  - The choice of each diff is rule-based (spec D4). The author chooses no
    diff.
  - Verify: `review-set.ts lint mg-2026-11a` passes.
- [ ] 3.15 The public manifest, first write. Run
  `review-set.ts lint mg-2026-11a`. It writes
  `harness/model-guide/data/sets/mg-2026-11a.json` with the SHA-256 of each
  seeded diff and the counts. The key SHA-256 values wait for the apply of
  task 4.13.
  - Do not commit the manifest in this task. Its key SHA-256 values change
    after the apply (spec D9).
  - Verify: the lint passes, and the manifest holds no key field and no
    seeded line.
- [ ] 3.16 The pilot seeding (spec D5 to D8, D13). The fixture author
  `claude-code/claude-opus-5-5[1m]#high` writes set `mg-2026-11p` in a fresh
  session, in the private folder only.
  - The pilot set holds the first 6 qualified commits in the D4 order, with
    at least 12 plants. The author uses the method of D5 to D7.
  - The pilot set is separate from `mg-2026-11a`. A reseed makes `mg-2026-11p2`,
    and then `mg-2026-11p3`.
  - Verify: `review-set.ts lint mg-2026-11p` passes.

Verify (Phase 3): spec acceptance 9 holds.

## Phase 4: The runner and the first track A results (by Sun 2026-11-22)

Spec D12 to D15, D22, FR-11, FR-14, FR-15.

- [ ] 4.1 Red. The review runner. Write
  `harness/model-guide-tests/review-run.test.ts` and the fake `opencode`
  under `harness/model-guide-tests/fixtures/fakes/`. Touch no other file.
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
  - The trap stops the fake processes and removes the job folder.
  Edge cases:
  - A route that is not in `routes.json`, or whose `kind` is `metered`,
    gives exit 2 before any call.
  - A window at 70 % at the start gives no call. A window at 80 % during
    the pass stops it and leaves it open.
  - A transport error retries up to 2 times. Three failures leave the pass
    open and not complete.
  - A raw output with a credential value is deleted, and the pass stops.
  - A Go route with the region error of spec D22 is marked `region-blocked`,
    and the route gets no rank for that night.
  - No file is written in the repository or under `docs/`.
  - After each run, `ps -eo pid,args | grep '[f]ake-opencode'` prints no line.
  - Verify: the file fails on the Phase 3 code. Record the failed test names
    in `measure/runs/model_guide/red-4.1.txt`.
- [ ] 4.2 Red. The quota sources. Write
  `harness/model-guide-tests/quota.test.ts` and the fake quota scripts under
  `harness/model-guide-tests/fixtures/fakes/`. Touch no other file.
  Normal cases:
  - The read of each quota source of spec D15 gives the state of the route.
  - A source with every window below 70 % gives `ready`.
  - A window at 70 % gives `wait`, and no pass starts.
  Edge cases:
  - A quota error, a limit error, a read failure, a source with no value, a
    missing field, and a value that is not a number give `stopped`.
  - A route with no quota source runs at most 1 pass per night, and it stops
    at the first quota or limit error.
  - Verify: the file fails on the Phase 3 code. Record the failed test names
    in `measure/runs/model_guide/red-4.2.txt`.
- [ ] 4.3 Red. The provider credential. Write
  `harness/model-guide-tests/credential-provider.test.ts` and no other file.
  Normal cases:
  - `provider-credential.sh seed <p>` imports only the entry of provider
    `<p>` and prints no value.
  - `provider-credential.sh scan-values <p>` finds a value in a raw output.
  Edge cases:
  - A provider with no entry gives exit 2 and no value.
  - Verify: the file fails on the Phase 3 code. Record the failed test names
    in `measure/runs/model_guide/red-4.3.txt`.
- [ ] 4.4 Green. Write `harness/model-guide/quota.ts`. Touch no test file
  and no other file.
  - Verify: `cd harness && npx vitest run model-guide-tests/quota.test.ts --configLoader native`
    passes.
- [ ] 4.5 Green. Write `harness/model-guide/routes.json`. Touch no test file
  and no other file.
  - The file holds the routes of spec D12 with the quota source of spec D15,
    and the second judge of spec D11.
  - Verify: the test files of Phase 4 pass.
- [ ] 4.6 Green. Write `harness/model-guide/provider-credential.sh`. Touch no
  test file and no other file.
  - Verify: `cd harness && npx vitest run model-guide-tests/credential-provider.test.ts --configLoader native`
    passes.
- [ ] 4.7 Green. Write `harness/model-guide/review-run.sh`. Touch no test
  file and no other file. Do not change `harness/opencode-credential.sh` or
  `harness/opencode-host.sh`.
  - Verify: `cd harness && npx vitest run model-guide-tests/review-run.test.ts --configLoader native`
    passes.
  - Verify: `git diff --stat ea36fae -- harness/opencode-credential.sh harness/opencode-host.sh harness/provenance.ts harness/tests`
    prints nothing.
- [ ] 4.8 Green. Write `harness/model-guide/pages/review.html` and the
  review page edit of `harness/model-guide/preview.sh`, plus that wiring.
  Touch no test file.
  - Apply the Real work and Review nav links to every page when the Review
    page exists (review C4-1). Phase 1 keeps index.html only.
  - Verify: the test files of Phases 1 to 4 pass, and
    `git status --short docs/` prints nothing.
- [ ] 4.9 Checks. One code checker reads the diff against spec D12 to D15
  and D22.
  - The checker confirms the metered refusal, the 70 % and 80 % rules, the
    state of each route, the region rule, and the credential scan.
  - Verify: `measure/runs/model_guide/check-4.9.json` has status pass, or
    each blocking finding has a fix commit.
- [ ] 4.10 The route probe (spec D14). One call per route with a control
  diff, through `heavy-run.sh`, in the window of spec D15.
  - Record `reachable`, `unreachable`, or `region-blocked` with the error
    line in `measure/runs/model_guide/probe-4.10.txt`.
  - The orchestrator sends each `unreachable` route to the PM (owner
    question Q8).
  - Verify: each route of `routes.json` has one line in the file.
- [ ] 4.11 The pilot gate (spec D13, OD7). The pilot set `mg-2026-11p` runs
  on the two pilot routes with 2 passes each, on the nights of 2026-11-20 and
  2026-11-21.
  - The pilot set holds the first 6 qualified commits in the D4 order (task
    3.16).
  - The pilot routes are `minimax-cn-coding-plan/MiniMax-M3.1-Flash` and
    `kimi-code-plan-cn/kimi-for-coding#high`.
  - The pilot runs through `heavy-run.sh`, in the window of spec D15.
  - The worst-of-2 score of each pilot route goes into the score file.
  - A pilot pass counts as a main pass of the route when the ranked set
    `mg-2026-11a` holds the same diffs (spec D13). Each pilot route then
    needs 1 more pass, on the night of 2026-11-22.
  - Verify: the best worst-of-2 score minus the lowest worst-of-2 score is 20
    points or more, and the best worst-of-2 score is below 90. When a rule
    fails, the orchestrator seeds a harder set as `mg-2026-11p2` (task 3.16)
    and runs the pilot again. After 2 reseeds the orchestrator sends the set
    to the PM.
- [ ] 4.12 The passes. The nights of 2026-11-20, 2026-11-21, and 2026-11-22
  (02:00 to 06:00 +07). One pass per reachable route per night.
  - Command for each route:
    `heavy-run.sh harness/model-guide/review-run.sh --set mg-2026-11a --route <route>`.
  - The pass of a pilot route on 11-20 and 11-21 is the pilot pass of task
    4.11 (spec D13).
  - Verify: each reachable route has 3 complete passes, or the file
    `measure/runs/model_guide/passes-4.12.txt` names the reason (quota
    stop, region block, or open pass).
- [ ] 4.13 The adjudication (spec D11). Run `adjudicate.ts queue`, then one
  call per judge per diff through `heavy-run.sh`, and then `adjudicate.ts
  apply`.
  - The first judge is `claude-code/claude-opus-5-5[1m]#high`. The second
    judge is ByteDance Doubao, `volcengine-agent-plan/ark-code-latest` (spec
    D11). That family is not ranked. The second judge never reads the
    verdicts of the first judge.
  - The apply writes the key `real_defects` first. Then run
    `review-set.ts lint mg-2026-11a` again, so the manifest holds the key
    SHA-256 values. Run `leak-check.ts`. Commit
    `harness/model-guide/data/sets/mg-2026-11a.json` with an explicit path.
    The commit comes after the apply (spec D9).
  - The orchestrator sends the real-defect list to the PM as a hand-off.
  - Verify: each finding has a verdict of both judges, or it is left out and
    counts against no route. Each pass with an `unclear` verdict shows
    `provisional`, and its route keeps its rank. Each key SHA-256 in the
    manifest matches its private key file.
- [ ] 4.14 The score file and the review page.
  - Write `harness/model-guide/data/review-scores/mg-2026-11a.json`. Run
    `leak-check.ts`. Commit the file with an explicit path.
  - Run `preview.sh` again.
  - Verify: `.tmp/model-guide-preview/review.html` shows the rank by the
    worst pass, and the code review row of the table has a pick or "no pick
    yet" (spec acceptance 10 and 11).

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
  - The tool compares the current files of `docs/` with `preview-base.json`.
    On a drift it gives exit 2 and names each drifted file. The orchestrator
    builds the preview again and asks Daniel again.
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
