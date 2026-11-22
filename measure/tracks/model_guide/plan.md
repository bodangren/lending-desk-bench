# Implementation plan — model_guide

PM 2026-11-14: direction change.

This plan builds page B and the overview table first, then the track A
review set and the scorer, then the first track A runs, and then the publish
gate and the weekly update. Spec: `spec.md`. Base commit: `ea36fae`.

Revision 2, 2026-11-14: the findings F1 to F12 of the spec review round 1.
Revision 3, 2026-11-14: the findings F13 to F23 of the spec review round 2.
Revision 4, 2026-11-18: the PM ruling on the route blocker (tasks 4.9, 4.9a,
4.9b, and 4.10 to 4.12).
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
| `harness/model-guide/judge-run.sh` | judge runner (spec D11) |
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
- [x] 0959cc2 3.3a Red. The score file meets the guide.ts reader (Phase 2 contract)
  and D13 provisional passes. Change
  `harness/model-guide-tests/review-score.test.ts` so that `routes[].passes`
  is the array of the route's pass records, and add an end-to-end test with
  `guide.ts`. Add a `guide.test.ts` test that a route with 3 passes, one of
  them provisional, keeps its rank.
  - Verify: the new and changed tests fail at HEAD. Record the failed test
    names in `measure/runs/model_guide/red-3.3a.txt`.
  - Evidence: `measure/runs/model_guide/red-3.3a.txt` holds the two commands,
    the exit codes, the five failed test names, and the reason of each. The
    test adds no fixture.
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
- [x] 9483f01 3.5 Red. The leak check. Write `harness/model-guide-tests/leak-check.test.ts
  and no other file.
  Normal cases:
  - The leak check passes on a clean tree.
  Edge cases:
  - The leak check fails on a staged file with a key field, with the
    private folder path, or with a seeded line of 20 characters or more
    that is not in the source diff.
  - Verify: the file fails on the Phase 2 code. Record the failed test names
    in `measure/runs/model_guide/red-3.5.txt`.
  - Evidence: `measure/runs/model_guide/red-3.5.txt` holds the command, the
    exit code, and the failed test names. The test reuses the task 3.2
    corpus; it adds no fixture, and the 19-character boundary waits for a
    fixture the plan line does not allow.
- [x] d095a38 3.6 Green. Write `harness/model-guide/pick-diffs.ts`. Touch no test
  file and no other file.
  - Verify: `cd harness && npx vitest run model-guide-tests/pick-diffs.test.ts --configLoader native`
    passes.
  - Evidence: commit d095a38 holds the tool. `measure/runs/model_guide/green-p3-192da41.log`
    holds the exit codes of the three runs and the empty `docs/` status.
- [x] 2acd4fa 3.7 Green. Write `harness/model-guide/review-set.ts`. Touch no test
  file and no other file.
  - Verify: `cd harness && npx vitest run model-guide-tests/review-set.test.ts --configLoader native`
    passes.
  - Evidence: commit 2acd4fa holds the tool. `measure/runs/model_guide/green-p3-7e52d2e.log`
    holds the exit codes of the four runs and the empty `docs/` status.
- [x] f023951 3.8 Green. Write `harness/model-guide/review-score.ts`. Touch no test
  file and no other file.
  - Verify: `cd harness && npx vitest run model-guide-tests/review-score.test.ts --configLoader native`
    passes.
  - Evidence: commit f023951 holds the tool. `measure/runs/model_guide/green-p3-35be00c.log`
    holds the exit codes of the five runs and the empty `docs/` status.
- [x] fd96d3b 3.8a Green. review-score.ts writes the route passes as pass records;
  guide.ts counts a provisional pass (D13). Touch no test file.
  - Verify: `cd harness && npx vitest run model-guide-tests/review-score.test.ts --configLoader native`
    and `cd harness && npx vitest run model-guide-tests/guide.test.ts --configLoader native`
    pass.
  - Evidence: commit fd96d3b holds the two tools. `measure/runs/model_guide/green-p3-5fc37de.log`
    holds the exit codes of the eight runs and the empty `docs/` status.
- [x] fd42d41 3.9 Green. Write `harness/model-guide/adjudicate.ts`. Touch no test
  file and no other file.
  - Verify: `cd harness && npx vitest run model-guide-tests/adjudicate.test.ts --configLoader native`
    passes.
  - Evidence: commit fd42d41 holds the tool. `measure/runs/model_guide/green-p3-5eeceab.log`
    holds the exit codes of the six runs and the empty `docs/` status.
- [x] 9d7f3f2 3.10 Green. Write `harness/model-guide/leak-check.ts`. Touch no test
  file and no other file.
  - Verify: `cd harness && npx vitest run model-guide-tests/leak-check.test.ts --configLoader native`
    passes.
  - Evidence: commit 9d7f3f2 holds the tool. `measure/runs/model_guide/green-p3-6e49630.log`
    holds the exit codes of the seven runs and the empty `docs/` status.
- [x] d297316 3.11 Green. Write `harness/model-guide/review-prompt.md`. Touch no test
  file and no other file.
  - Verify: the test files of Phases 1 to 3 pass.
  - Evidence: commit d297316 holds the prompt. `measure/runs/model_guide/green-p3-17ebb29.log`
    holds the exit codes of the 14 runs and the empty `docs/` status. The leak
    check on a temp repo that stages only the prompt prints nothing.
- [x] 8fee6bb 3.12 Checks. One code checker reads the diff against spec D4 to D13
  and D22.
  - The checker confirms that no public output can hold a key field, that
    the lint checks the operator catalog, and that the rule of two judges
    holds.
  - Verify: `measure/runs/model_guide/check-3.12.json` has status pass, or
    each blocking finding has a fix commit.
  - Evidence: `measure/runs/model_guide/check-3.12.json` holds status pass
    at 78627f5 (route `opencode-go/muse-spark-1.3-contributor#high`) and no
    open blocking finding. Every Phase 3 blocking finding has its fix
    commit: P3A1-1 to P3A1-5 and P3C1-1 and P3C1-2 in 32980bc, P3B1-1 to
    P3B1-5 in 0fb247b, and P3X1-1 and P3X1-2 in 8fee6bb.
  - Evidence: the four final audits at d137057 each hold status pass:
    `review-a-d137057.json`, `review-b-d137057.json`,
    `review-c-d137057.json`, and `adversarial-d137057.json` under
    `measure/runs/model_guide/`.
- [x] 0a898f2 3.12a Red. Review round 1 tests, correctness (P3A1-1 claim ids,
  P3A1-2 window, P3A1-3/4 missed counts, P3A1-5 D7 key schema). Change
  `adjudicate.test.ts`, `review-score.test.ts`, and `review-set.test.ts`.
  - Verify: the new and changed tests fail at HEAD. Record the failed test
    names in `measure/runs/model_guide/red-3.12a.txt`.
  - Evidence: `measure/runs/model_guide/red-3.12a.txt` holds the four
    commands, the exit codes, the failed test names, and the changed id
    assertions. No committed fixture changed.
- [x] 869772e 3.12b Red. Review round 1 tests, security (P3B1-1 to P3B1-5).
  Change `leak-check.test.ts`, `review-set.test.ts`, `review-score.test.ts`,
  `adjudicate.test.ts`, and `pick-diffs.test.ts`.
  - Verify: the new tests fail at HEAD. Record the failed test names and the
    refusal lines in `measure/runs/model_guide/red-3.12b.txt`.
  - Evidence: `measure/runs/model_guide/red-3.12b.txt` holds the five
    commands, the exit codes, the 12 new failed test names, and the pinned
    refusal lines. No committed fixture changed.
- [x] 8af3874 3.12e Red. Fix the J2 index case of 3.12a (Green 3.12c block).
  - Verify: the case passes with the Green 3.12c changes in the tree.
    Record the result in `measure/runs/model_guide/red-3.12e.txt`.
  - Evidence: `measure/runs/model_guide/red-3.12e.txt` holds the reason of
    the fix and the result. The case now uses a plant match to move A
    between index 2 and index 1; the only failures left in
    adjudicate.test.ts are the three security cases of 3.12b.
- [x] 463136a 3.12f Red. Make the adversarial defect tests P3X1-1 and P3X1-2 fail
  first (it.fails to it).
  - Verify: only those two cases fail; adjudicate and review-set stay green.
    Record the result and the P3X1-2 refusal line in
    `measure/runs/model_guide/red-3.12f.txt`.
  - Evidence: `measure/runs/model_guide/red-3.12f.txt` holds the three
    commands, the exit codes, the two failed names, and the pinned
    `lint: plant-line:` line for P3X1-2.
- [x] 8fee6bb 3.12g Green. Fix P3X1-1 (queue dedup key = claim id) and P3X1-2 (lint
  refuses a plant off the diff lines). Touch no test file.
  - Evidence: commit 8fee6bb holds the two tools. `measure/runs/model_guide/green-p3-c9d60b9.log`
    holds the command output of each run and the empty `docs/` status.
- [x] d00169c 3.13a Red. pick-diffs reads a gh output over 1 MiB (ENOBUFS found in
  3.13). Add one test to `pick-diffs.test.ts` and the fake `gh` mode it needs.
  - Verify: the new tests fail at HEAD with `pick-diffs: gh api failed`, and
    the other pick-diffs tests stay green. Record the result in
    `measure/runs/model_guide/red-3.13a.txt`.
  - Evidence: `measure/runs/model_guide/red-3.13a.txt` holds the command,
    the exit code, the two failed names, and the fake pad modes. No large
    fixture is committed.
- [x] a4894ae 3.13b Green. Fix the pick-diffs output buffer. Touch no test file.
  - Evidence: commit a4894ae holds `harness/model-guide/pick-diffs.ts`. The
    single-file runs at a4894ae were pick-diffs 21 passed, review-set 18,
    review-score 25, adjudicate 20, leak-check 13, and guide 16, and
    `git --no-pager status --short docs/` printed nothing.
  - Evidence: the round 4 reviews A, B, and C and the round 3 adversarial
    audit at a4894ae each hold status pass: `review-a-a4894ae.json`,
    `review-b-a4894ae.json`, `review-c-a4894ae.json`, and
    `adversarial-a4894ae.json` under `measure/runs/model_guide/`.
- [x] 5a91775 3.13c Red. pick-diffs retries a transient gh error (found in the 3.13
  rerun). Add tests to `pick-diffs.test.ts` only, with a temp fake `gh`.
  - Verify: the new tests fail at HEAD, and the old pick-diffs tests and
    adversarial-p3 stay green. Record the result in
    `measure/runs/model_guide/red-3.13c.txt`.
  - Evidence: `measure/runs/model_guide/red-3.13c.txt` holds the two
    commands, the exit codes, the five failed names, and the retry contract.
    No fixture changed.
- [x] c867117 3.13d Green. Bounded retry of a transient gh error in pick-diffs. Touch
  no test file.
  - Evidence: commit c867117 holds `harness/model-guide/pick-diffs.ts`.
    `measure/runs/model_guide/green-p3-69ac213.log` holds the command output
    of the three runs, pick-diffs 26 passed, adversarial-p3 31, and
    review-set 18, and the empty `docs/` status.
- [x] 33e091d 3.13e Red. A bad retry wait value cannot hang pick-diffs (P3A5-1, P3B5-1).
  Add tests to `pick-diffs.test.ts` only.
  - Verify: each case fails at HEAD because the spawn times out; the old
    tests stay green. Record the result in
    `measure/runs/model_guide/red-3.13e.txt`.
  - Evidence: `measure/runs/model_guide/red-3.13e.txt` holds the command,
    the exit code, the three timed-out names, and the bounded-base contract.
- [x] faaca63 3.13f Green. Bound the retry wait of pick-diffs and document the env
  value and the stderr line in the header (P3A5-1, P3B5-1, P3C5-1). Touch no
  test file.
  - Evidence: commit faaca63 holds `harness/model-guide/pick-diffs.ts`.
    `measure/runs/model_guide/green-p3-3756ca1.log` holds the command output
    of the three runs, pick-diffs 29 passed, adversarial-p3 31, and
    review-set 18, and the empty `docs/` status.
- [x] 32980bc 3.12c Green. Fix the correctness findings of 3.12a. Touch no test file.
  - Evidence: commit 32980bc holds the three tools. `measure/runs/model_guide/green-p3-dc5c319.log`
    holds the exit codes of the four runs and the empty `docs/` status.
- [x] 0fb247b 3.12d Green. Fix the security findings of 3.12b. Touch no test file.
  - Evidence: commit 0fb247b holds the five tools. `measure/runs/model_guide/green-p3-a1a4e56.log`
    holds the command output of each run and the empty `docs/` status.
- [x] faaca63 3.13 The candidates. Run `pick-diffs.ts` for each source repo.
  - Store the lists in the private folder. Store nothing in the repository.
  - Verify: each list has 7 or more qualified commits. When a list has
    fewer, the orchestrator tells the PM and widens nothing without an
    answer.
  - Evidence: `measure/runs/model_guide/candidates-3.13.txt` holds the two
    commands, the exit codes, the attempt history, the output paths, and
    the counts: 702 qualified commits for
    Reading-Advantage-Thailand/reading-advantage-monorepo and 267 for
    bodangren/advantage-forge, each with 12 selected. Both lists are 7 or
    more, so no rule was widened.
- [x] faaca63 3.14 The seeding (spec D5 to D8). The fixture author is the author
  route of spec D5 (`openai/gpt-6.1-sol#high` with `--allow-codex`; PM
  2026-11-16; the run log names the route that wrote the set). The author
  writes set `mg-2026-11a` in a fresh session, in the private folder only.
  - The session runs through `heavy-run.sh`. It gets the operator catalog of
    spec D6 and the candidate lists.
  - The choice of each diff is rule-based (spec D4). The author chooses no
    diff.
  - The set takes the first 7 qualified commits of each repo in the D4
    order, newest first. The first 6 of each repo are seeded, and the 7th
    is a control diff with no plant. The ids are `mono-01` to `mono-07` and
    `forge-01` to `forge-07`; `mono-07` and `forge-07` are the controls.
  - Verify: `review-set.ts lint mg-2026-11a` passes.
  - Evidence: the lint exited 0 through `heavy-run.sh`. The set holds 14
    diffs: 12 seeded diffs and 2 controls. It holds 44 plants and 19
    blockers. Class counts: C1=3, C2=3, C3=4, C4=4, C5=3, C6=5, C7=3,
    C8=18, C9=1. The author route was `openai/gpt-6.1-sol#high`.
    `measure/runs/model_guide/seed-mg-2026-11a.log` records the commands,
    exit codes, counts, and the private-file self-check.
- [x] faaca63 3.15 The public manifest, first write. Run
  `review-set.ts lint mg-2026-11a`. It writes
  `harness/model-guide/data/sets/mg-2026-11a.json` with the SHA-256 of each
  seeded diff and the counts. The key SHA-256 values wait for the apply of
  task 4.13.
  - Do not commit the manifest in this task. Its key SHA-256 values change
    after the apply (spec D9).
  - Verify: the lint passes, and the manifest holds no key field and no
    seeded line.
  - Evidence: the lint wrote the manifest and exited 0. The manifest stays
    untracked and is not committed. The field check and `leak-check.ts`
    exited 0. `measure/runs/model_guide/seed-mg-2026-11a.log` records the
    commands and exit codes.
- [x] faaca63 3.16 The pilot seeding (spec D5 to D8, D13). The fixture author is the
  author route of spec D5 (`openai/gpt-6.1-sol#high` with `--allow-codex`; PM
  2026-11-16; the run log names the route that wrote the set). The author
  writes set `mg-2026-11p` in a fresh session, in the private folder only.
  - The pilot set holds the first 3 qualified commits of each repo in the
    D4 order, newest first, with at least 12 plants. These are `mono-01` to
    `mono-03` and `forge-01` to `forge-03` of `mg-2026-11a`. Each pilot
    seeded diff is a byte-identical copy of the same id in `mg-2026-11a`,
    with the same seeded-diff SHA-256. The key holds the same plants; only
    its `set_id` differs (spec D13; PM 2026-11-16).
  - The pilot set is separate from `mg-2026-11a`. A reseed makes
    `mg-2026-11p2`, and then `mg-2026-11p3`. Each reseed keeps the same 6
    source commits and seeds them again by the harder rule, unless the
    test-only rule of spec D4 fires. Each reseed then runs
    `npx tsx model-guide/seed-messages.ts <set_id> --private <dir>` from
    `harness/`, right after the seeding step: a set with no message file
    makes each pass and probe refuse.
  - Verify: `review-set.ts lint mg-2026-11p` passes.
  - Evidence: the lint exited 0 through `heavy-run.sh`. The set holds 6
    diffs, 20 plants, and 11 blockers. All 6 seeded copies match their twins
    and their keys by SHA-256. All 6 keys differ only in `set_id`.
    The author route was `openai/gpt-6.1-sol#high`.
    `measure/runs/model_guide/seed-mg-2026-11p.log` records the commands,
    exit codes, and counts. The manifest stays outside the repository at
    `/tmp/opencode/seed-11p/sets/mg-2026-11p.json`.

Verify (Phase 3): spec acceptance 9 holds.

## Phase 4: The runner and the first track A results (by Sun 2026-11-22)

Spec D12 to D15, D22, FR-11, FR-14, FR-15.

- [x] 4e00ec2 4.1 Red. The review runner. Write
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
  - Evidence: run on 2026-11-18 with `cd harness && npx vitest run
    model-guide-tests/review-run.test.ts --configLoader native
    --maxWorkers=1 --reporter=dot`. Exit 1, `Tests  23 failed (23)`. First
    failure line: `FAIL model-guide-tests/review-run.test.ts > P4 R1 the
    pass shape of the review runner > R1 calls the fake once for each diff,
    stores one raw output per diff in the private folder, and writes one
    pass record`. The message is `the review runner is missing:
    /home/daniebo/Desktop/lending-desk-bench/harness/model-guide/review-run.sh`.
    All 23 cases fail on the missing runner, so no case passes at the phase
    base (A4). The first run of the file failed in the temp quota server:
    the source string held a real newline inside a JavaScript string
    literal. The fix doubles the escapes, and the test commit holds it.
    After the run, `ps -eo pid,args | grep '[f]ake-opencode'` prints no
    line. Reuse decision: reuse the two untracked files of the stopped run,
    with the escape fix. See `measure/runs/model_guide/red-4.1.txt`.
  - The Red commits are 4e00ec2 (the test file and the fake) and f274fa8
    (the tool-path seam). The Red fix 8e111d2 makes R4 and R6 follow spec
    D12 to D15. Green 4.7 makes the file pass at 303f73d, so this row is
    `[x]`.
- [x] 2cb7efd 4.1a Red. Page B layout (spec D16 "Layout (PM P1 2026-11-16)"). Change
  the layout group G1 to G4 of `harness/model-guide-tests/preview-gate.test.ts`
  and add the cases of the new rules. Touch no other file.
  - G1 and G2: the source line (file name, SHA-256, generated date) and the
    coverage numbers sit in the "About this data" footer.
  - G3: a row with fewer than 10 results sits in the collapsed group
    "Too few runs to rank" with no rank number and never in the ranked table.
  - G4: a rate shows as a whole percent with no `(n=...)` suffix, an empty
    value shows an em dash, and the Runs column holds the count.
  - New cases: the top block gives one line per role group and per work type
    with the recommended model, its whole percent, and its result count, or
    "no pick yet"; a default table holds six columns or fewer (Model, Runs,
    Pass %, Blocking %, Rating, Trend) and a work-type table drops Blocking %;
    the other columns sit behind a "More columns" toggle; each work type sits
    in a tab or a collapsed section; a plain model name comes from
    `harness/model-guide/data/model-names.json`, and a key with no name shows
    its key without the plan prefix.
  - The data assertions of the page stay unchanged.
  - Verify: `cd harness && npx vitest run model-guide-tests/preview-gate.test.ts --configLoader native`
    fails only on the new layout cases.
  - Evidence: command `cd harness && npx vitest run model-guide-tests/preview-gate.test.ts --configLoader native --maxWorkers=1 --reporter=dot` exits 1 with `Tests  10 failed | 96 passed (106)`. The 10 failing cases and their one-line reasons: G1 `the page holds data-mg="about-footer": expected -1 to be greater than -1`; G2 same missing about-footer; G3 `producer holds a default table: expected undefined to be defined`; G4 `Producer roles holds a default table: expected undefined to be defined`; G5 `the page holds data-mg="top-block": expected -1 to be greater than -1`; G6 `the top block still has one line per group: expected [] to have a length of 4 but got +0`; G7 `Producer roles holds a default table: expected undefined to be defined`; G8 `the page holds data-mg="more-columns": expected -1 to be greater than -1`; G9 `app code is wrapped by a work-type hook: expected -1 to be greater than -1`; G10 `the committed model-names.json exists: expected false to be true`. All other 96 tests pass, so only the layout group changed. phase_base_sha 57baaaa364f968a2f44c6e14eb96f8a9d68beebf (Phase 4 strategy commit, test-strategy section 11); role_base_sha 952299400423bd0abc7ddcf9d45ddbf77da2c486 (HEAD before this Red role). Neither SHA was named in the task message; both were resolved from the repository.
  - Tests committed and failing: 10 failed, 96 passed (106) in preview-gate.test.ts (2026-11-17). The row closes when task 4.1b passes.
  - Closed by 4.1b: 106 passed; G5 fix 0576d2f.
- [x] c8041cc 4.1b Green. Page B layout (spec D16 "Layout (PM P1 2026-11-16)"). Write
  the page B render of `harness/model-guide/preview.sh` and the template
  `harness/model-guide/pages/real-work.html`. Add the committed data file
  `harness/model-guide/data/model-names.json` with a plain name for each model
  key. Touch no test file and no other file.
  - The look comes from `docs/assets/css/site.css`: the fonts, the card style,
    and the header of `docs/results.html`.
  - Verify: the test file of 4.1a passes.
  - Verify with `page-check` at 390, 980, and 1280 px: no horizontal page
    overflow, a wide table scrolls inside its own box with a visible hint, and
    the page is about 3 screens long at 1280 px.
  - Evidence: commit c8041cc. `cd harness && npx vitest run model-guide-tests/preview-gate.test.ts --configLoader native --maxWorkers=1 --reporter=dot` gives `Tests  106 passed (106)`, exit 0.
- [x] cca8fad 4.1e Red. Page B data source (spec D16 "Data source (PM 2026-11-17)").
  Write synthetic fixtures under `harness/model-guide-tests/fixtures/` (an
  outcomes file, an AA file, an allowed list, and a MANIFEST) and change only
  test files.
  - The cases cover rules 1 to 11: the input check gives exit 2 on a changed
    byte; the note stripping; both merges with the weighted means; the
    minimum of 5; the two rank orders; the net-score match with `byEffort`
    and a `-free` key; the mark "not for verdicts"; the mark "not allowed"
    and no pick for it; one top line per role in the given order; no
    work-type section; no producer pass rate; and the footer values.
  - The print-audit block shows plain names and no raw route key (spec D17,
    PM 2026-11-17).
  - The tests also cover `guide.ts` reading the new `real-work.json` (no
    `work_types`; D18 rows without a page B source) and `update.sh` with the
    manifest argument (spec D16 rule 12, D19). Red may change the existing
    test files of `guide.ts`, `update.sh`, `real-work.ts`, and
    `preview-gate.test.ts`, per test-strategy.md section 13
    (orchestrator 2026-11-17).
  - Verify: the new cases fail and the other cases pass. Record the failed
    test names in `measure/runs/model_guide/red-4.1e.txt`.
  - Evidence: the six commands of test-strategy 13.2, run one at a time on
    2026-11-17, each with `--configLoader native --maxWorkers=1
    --reporter=dot` from `harness/`:
    - `npx vitest run model-guide-tests/input-check.test.ts` exits 1 with
      `Tests  18 failed | 2 passed (20)`.
    - `npx vitest run model-guide-tests/real-work.test.ts` exits 1 with
      `Tests  12 failed (12)`.
    - `npx vitest run model-guide-tests/preview-gate.test.ts` exits 1 with
      `Tests  92 failed | 7 passed (99)`.
    - `npx vitest run model-guide-tests/guide.test.ts` exits 1 with
      `Tests  15 failed (15)`.
    - `npx vitest run model-guide-tests/update.test.ts` exits 1 with
      `Tests  5 failed | 4 passed (9)`.
    - `npx vitest run model-guide-tests/leak-check.test.ts` exits 0 with
      `Tests  22 passed (22)`.
    Every DS1 to DS21 case, the changed G cases, FX2, and the page cases fail
    for one reason: the tool still speaks the old `--input` or `--export`
    usage line. No case fails with a TypeError, a ReferenceError, a missing
    helper, or a syntax error. The guards FX1, FX3, and LG1 to LG3 pass.
  - Fix round r8: at ba3142a, `adversarial.test.ts` exited 0 with `Tests  46 passed (46)`; this round (RA2-1, RA2-2): guide 17 passed, preview-gate 99 passed, real-work 13 passed, input-check 23 passed, leak-check 22 passed, update 9 passed, adversarial 46 passed, every run exit 0.
  - Fix round r9 (RA3-1, RA3-2): `npx vitest run model-guide-tests/guide.test.ts` exits 0 with `Tests  17 passed (17)`; `npx vitest run model-guide-tests/preview-gate.test.ts` exits 0 with `Tests  99 passed (99)`.
  - Follow-up fixes (Mid Red, 2026-11-17): f205c80 keeps the manifest line of
    the omitted file in DS2, moves T6 to `2026-11-28` true and `2026-11-27`
    false, and bases P2ADV-14 on the export date `2026-10-20`; d94f549 stages
    the fixture MANIFEST line for the three DS1 flipped-byte cases and the DS2
    integrity-first case, returns `MANIFEST_COPY` from `updateRepo`, and names
    a page-b route in the adversarial negative-count case. The file then exits
    0 with `Tests  20 passed (20)`, `update.test.ts` with
    `Tests  9 passed (9)`, and `adversarial.test.ts` with
    `Tests  47 passed (47)`.
- [x] d25b556 4.1f Green. Implement the data source in `harness/model-guide/` (the
  page B tool `real-work.ts`, `preview.sh`, the template, `model-names.json`,
  `guide.ts`, and `update.sh`) (orchestrator 2026-11-17) and add the three
  dated data files and the MANIFEST. Make no design choice beyond the spec;
  send any open choice to the orchestrator.
  - The print-audit block of `preview.sh` shows the plain names of spec D17
    and no raw route key.
  - Verify: the 4.1e test file passes, the `guide.ts` and `update.sh` test
    files of 4.1e pass (orchestrator 2026-11-17), `leak-check.ts` passes,
    and `page-check` at 390, 980, and 1280 px shows no page overflow.
  - Evidence (2026-11-18, one file at a time from `harness/`, each with
    `--configLoader native --maxWorkers=1 --reporter=dot`, at HEAD d94f549):
    - `input-check.test.ts` exits 0 with `Tests  20 passed (20)`.
    - `real-work.test.ts` exits 0 with `Tests  12 passed (12)`.
    - `preview-gate.test.ts` exits 0 with `Tests  99 passed (99)`; the F20
      root-path case passes with the new parser.
    - `guide.test.ts` exits 0 with `Tests  15 passed (15)`.
    - `update.test.ts` exits 0 with `Tests  9 passed (9)`.
    - `leak-check.test.ts` exits 0 with `Tests  22 passed (22)`.
    - `adversarial.test.ts` exits 0 with `Tests  47 passed (47)`.
    - `adversarial-p2.test.ts` exits 0 with `Tests  13 passed (13)`.
    - `adversarial-p3.test.ts` exits 0 with `Tests  34 passed (34)`.
  - Commits: 4930b32 (real-work.ts), bc96827 (too-few order), a997185
    (preview.sh and the template), 5647f41 (guide.ts), 7a54b85 (update.sh and
    model-names.json), d25b556 (the three data files and the MANIFEST).
  - Data capture: the three files in `harness/model-guide/data/` and
    `MANIFEST-2026-11-17.txt`; the MANIFEST loop prints nothing;
    `git status --short docs/` prints nothing; `leak-check.ts` on the staged
    files exits 0; `bash harness/model-guide/preview.sh --manifest
    harness/model-guide/data/MANIFEST-2026-11-17.txt` exits 0 and the page
    holds 10 picks, two default tables with ranked rows, six `.table-wrap`
    boxes, the footer values (rows 217, routes 53, unknown rows 6, share
    2.8 %, dates 2026-11-17), no work-type hook, and no raw route key in the
    print-audit block.
  - Review remediation (2026-11-18, commit 065815b): RA-1 shows the plain
    names in the overview pick and second cells; RA-3 requires each MANIFEST
    line to name exactly `ra-outcomes-<D>.json`, `aa-reliability-<D>.json`, or
    `allowed-routes-<D>.json` for the manifest date; RA-4 lists every role of a
    merged row in the Roles cell; RA-5 states the stderr form of the
    input-check line. The nine runs at 065815b: `input-check.test.ts`
    `Tests  23 passed (23)`; `real-work.test.ts` `Tests  13 passed (13)`;
    `preview-gate.test.ts` `Tests  99 passed (99)`; `guide.test.ts`
    `Tests  17 passed (17)`; `update.test.ts` `Tests  9 passed (9)`;
    `leak-check.test.ts` `Tests  22 passed (22)`; `adversarial-p2.test.ts`
    `Tests  13 passed (13)`; `adversarial-p3.test.ts` `Tests  34 passed (34)`;
    `adversarial.test.ts` `Tests  2 failed | 45 passed (47)`. The two failures
    are Red-side: "X accepts a manifest path with spaces and unicode in the
    name" and "E escapes a hostile export file name in the source line" stage
    an outcomes file name that RA-3 must refuse. A Mid Red retry names the
    staged outcomes file `ra-outcomes-2026-10-20.json` in the unicode folder,
    and retires or re-aims the hostile file-name case. The preview on the real
    files exits 0 and `git status --short docs/` prints nothing.
  - Adversarial remediation (2026-11-18, commit cea0a90): ADV-1 gives the
    model column `min-width: 10em` and lets the number headers wrap; ADV-2
    puts a scroll hint after every `.table-wrap`; ADV-3 rounds a rate and a
    rework to 9 decimals before a rank comparison; ADV-4 keeps the raw
    weighted values in `real-work.json` and rounds once at display; ADV-5
    strips `[1m]` and `#<variant>` before the print-audit name lookup; ADV-6
    makes a direct AA model key win over an alias; ADV-7 reads `byEffort` by
    own key only. The ten runs at cea0a90: `adversarial-p4.test.ts`
    `Tests  18 passed (18)`; `real-work.test.ts` `Tests  13 passed (13)`;
    `preview-gate.test.ts` `Tests  99 passed (99)`; `guide.test.ts`
    `Tests  17 passed (17)`; `input-check.test.ts` `Tests  23 passed (23)`;
    `update.test.ts` `Tests  9 passed (9)`; `leak-check.test.ts`
    `Tests  22 passed (22)`; `adversarial.test.ts` `Tests  46 passed (46)`;
    `adversarial-p2.test.ts` `Tests  13 passed (13)`; `adversarial-p3.test.ts`
    `Tests  34 passed (34)`. The preview on the real files exits 0 and
    `git status --short docs/` prints nothing.
  - The `page-check` browser proof at 390, 980, and 1280 px stays with the
    orchestrator (test-strategy 13.9).
- [x] edc7372 4.1g Red. Checker rank by net score, pick labels, escapes "no data",
  overview text (spec D16 Data source C1 to C3, D18, PM 2026-11-18). Change
  only test files and fixtures under `harness/model-guide-tests/`.
  - Cases: the checker rank order incl. not-rated rows last and the ties; the
    sentence "A high pass % does not mean a good checker."; the
    About-this-data effort sentence; the gate pick follows the new order (a
    100 % pass row with a low net score does not pick); both top-line forms
    with "in this role"; Escapes "no data" when the escape sum is 0, and a
    number otherwise; the overview text says 5, not 10.
  - Verify: the new cases fail for missing behavior and the other cases pass.
    Record the failed names in `measure/runs/model_guide/red-4.1g.txt`.
  - Evidence: the four changed files run one at a time on 2026-11-18 with
    `--configLoader native --maxWorkers=1 --reporter=dot`.
    `real-work.test.ts` exits 1 with `Tests  4 failed | 10 passed (14)`,
    first failure DS7 (`expected '0' to be 'no data'`).
    `preview-gate.test.ts` exits 1 with `Tests  6 failed | 96 passed (102)`,
    first failure G3 (`Checker roles ranked rows`).
    `guide.test.ts` exits 1 with `Tests  1 failed | 17 passed (18)`,
    first failure DS26 (`to contain '5 tasks or runs'`).
    `adversarial-p4.test.ts` exits 1 with `Tests  7 failed | 11 passed (18)`,
    first failure ADV4-1 (`[ 'p1/alpha', '', '' ]`).
    The unchanged fixture consumers stay green: input-check 23,
    leak-check 22, update 9, adversarial 46, adversarial-p2 13,
    adversarial-p3 34, every run exit 0. No run carries a NameError, a
    TypeError, a ReferenceError, a syntax error, or a missing helper.
- [x] a86c872 4.1h Green. Implement 4.1g in `harness/model-guide/` (`real-work.ts`,
  `preview.sh`, `pages/real-work.html`, `pages/guide-section.html`,
  `guide.ts` if the checker order reaches it). Make no design choice beyond
  the spec; send any open choice to the orchestrator.
  - Verify: the 4.1g test files and all page B test files pass one at a time,
    and `page-check` at 390, 980, and 1280 px shows no page overflow.
  - Changes: the checker rank orders by the AA net score high first, a
    not-rated row after every rated row, then findings per run high first,
    then more runs, then the model key ascending (PM 2026-11-18); escapes
    leave the rank. A gate pick takes the checker rank order inside its role.
    Each top line is the sentence form with the label "in this role", and a
    line with no pick says exactly "no pick yet"; the role sits in the
    `data-role` attribute. `real-work.json` gains
    `coverage.escapes_total`, and the page shows "no data" in every Escapes
    cell while that total is 0. The Checker roles text carries "A high pass %
    does not mean a good checker.", and the About this data footer carries
    the effort-level sentence. `pages/guide-section.html` says a model needs
    5 tasks or runs. `guide.ts` does not change, because ruling Q2 keeps the
    checker table out of the Code review pick.
  - Evidence (2026-11-18, one file at a time from `harness/`, each with
    `--configLoader native --maxWorkers=1 --reporter=dot`, at HEAD a86c872):
    - `real-work.test.ts` exits 0 with `Tests  14 passed (14)`.
    - `preview-gate.test.ts` exits 0 with `Tests  102 passed (102)`.
    - `guide.test.ts` exits 0 with `Tests  18 passed (18)`.
    - `adversarial-p4.test.ts` exits 0 with `Tests  18 passed (18)`.
    - `input-check.test.ts` exits 0 with `Tests  23 passed (23)`.
    - `update.test.ts` exits 0 with `Tests  9 passed (9)`.
    - `leak-check.test.ts` exits 0 with `Tests  22 passed (22)`.
    - `adversarial.test.ts` exits 0 with `Tests  46 passed (46)`.
    - `adversarial-p2.test.ts` exits 0 with `Tests  13 passed (13)`.
    - `adversarial-p3.test.ts` exits 0 with `Tests  34 passed (34)`.
  - The preview on the real files exits 0 and `git status --short docs/`
    prints nothing. The ten top lines show the sentence forms, and the
    Escapes cells read "no data" because the real outcomes file holds no
    escape. The `page-check` browser proof stays with the orchestrator.
- [x] 9771edb 4.1i Red. Role labels on the top lines (spec D16 Top block, orchestrator
  2026-11-18). Change only test files under `harness/model-guide-tests/`.
  - Cases: each of the ten top lines starts with its role label and a colon,
    in the given order, for a pick and for "no pick yet".
  - Verify: the new cases fail for missing behavior. Record them in
    `measure/runs/model_guide/red-4.1i.txt`.
  - Evidence: the three top-line readers run one at a time on 2026-11-18
    with `--configLoader native --maxWorkers=1 --reporter=dot`.
    `real-work.test.ts` exits 1 with `Tests  2 failed | 12 passed (14)`,
    first failure DS13 (`expected 'prod-one 100 % in this role, 5 tasks' to
    be 'Red: prod-one 100 % in this role, 5 tasks'`).
    `preview-gate.test.ts` exits 1 with `Tests  1 failed | 101 passed (102)`,
    first failure G6 (same missing role label).
    `adversarial-p4.test.ts` exits 1 with `Tests  7 failed | 11 passed (18)`,
    first failure ADV4-1 (`red line starts with "Red: ", got "alpha 80 % in
    this role, 20 tasks"`). No run carries a NameError, a TypeError, a
    ReferenceError, or a syntax error.
- [x] 8805ea2 4.1j Green. Implement 4.1i in `harness/model-guide/preview.sh` (and the
  template if needed).
  - Verify: all page B test files pass one at a time; `page-check` at 390, 980,
    and 1280 px shows no page overflow.
  - Changes: `top_block` writes each line as "<role label>: <sentence>", with
    the labels Red, Green, Coder, Review A, Review B, Review C, Adversarial,
    Acceptance, Phase acceptance, Final acceptance, and a no-pick line as
    "<role label>: no pick yet". The role stays in the `data-role`
    attribute; the template is unchanged.
  - Evidence (2026-11-18, one file at a time from `harness/`, each with
    `--configLoader native --maxWorkers=1 --reporter=dot`, at HEAD 8805ea2):
    - `real-work.test.ts` exits 0 with `Tests  14 passed (14)`.
    - `preview-gate.test.ts` exits 0 with `Tests  102 passed (102)`.
    - `adversarial-p4.test.ts` exits 0 with `Tests  18 passed (18)`.
    - `guide.test.ts` exits 0 with `Tests  18 passed (18)`.
    - `input-check.test.ts` exits 0 with `Tests  23 passed (23)`.
    - `update.test.ts` exits 0 with `Tests  9 passed (9)`.
    - `leak-check.test.ts` exits 0 with `Tests  22 passed (22)`.
    - `adversarial.test.ts` exits 0 with `Tests  46 passed (46)`.
    - `adversarial-p2.test.ts` exits 0 with `Tests  13 passed (13)`.
    - `adversarial-p3.test.ts` exits 0 with `Tests  34 passed (34)`.
  - The preview on the real files exits 0 and `git status --short docs/`
    prints nothing. The `page-check` browser proof stays with the
    orchestrator.
- [x] 60e0da3 4.2 Red. The quota sources. Write
  `harness/model-guide-tests/quota.test.ts` and the temp fake quota source
  that the test writes, an in-process `node:http` server on `127.0.0.1:0`.
  It commits no fixture. Touch no other file (test-strategy section 6.2,
  change 1).
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
  - Evidence: run on 2026-11-18 with `cd harness && npx vitest run
    model-guide-tests/quota.test.ts --configLoader native --maxWorkers=1
    --reporter=dot`. Exit 1, `Tests  15 failed (15)`. First failure line:
    `FAIL model-guide-tests/quota.test.ts > Q1 the source path of each
    provider > Q1 reads GET /api/quota/<id> for the four providers of spec
    D15 and gives ready`. The message is `the quota tool is missing:
    /home/daniebo/Desktop/lending-desk-bench/harness/model-guide/quota.ts`.
    All 15 cases fail on the missing tool, so no case passes at the phase
    base (A4). Authoring check: the same file run against a throwaway
    prototype of `quota.ts` outside the repository, through the seam
    `MG_QUOTA_PROTO`, gives `Tests  15 passed (15)`, so the in-process
    quota source, the `openchamber` stub, and every assertion work. One
    authoring error was fixed first: the Q2 request count was 6, not 9.
    After the recorded run, `ps -eo pid,args | grep '[f]ake-opencode'`
    prints no line, no `vitest` or `quota` process stays alive, and no
    `mg-quota` temp folder stays under `/tmp`.
  - The Red commits are 60e0da3 (the test file) and dce6401 (the tool-path
    seam). Green 4.4 makes the file pass at 9c1dfa6, so this row is `[x]`.
- [x] f7e7da4 4.3 Red. The provider credential. Write
  `harness/model-guide-tests/credential-provider.test.ts` and no other file.
  Normal cases:
  - `provider-credential.sh seed <p>` imports only the entry of provider
    `<p>` and prints no value.
  - `provider-credential.sh scan-values <p>` finds a value in a raw output.
  Edge cases:
  - A provider with no entry gives exit 2 and no value.
  - Verify: the file fails on the Phase 3 code. Record the failed test names
    in `measure/runs/model_guide/red-4.3.txt`.
  - Evidence: run on 2026-11-18 with `cd harness && npx vitest run
    model-guide-tests/credential-provider.test.ts --configLoader native
    --maxWorkers=1 --reporter=dot`. Exit 1, `Tests  11 failed (11)`. First
    failure line: `FAIL model-guide-tests/credential-provider.test.ts > C1
    the seed > C1 seeds exactly the entry of the provider into the job
    store and prints no value`. The message is `the provider credential
    script is missing:
    /home/daniebo/Desktop/lending-desk-bench/harness/model-guide/provider-credential.sh`.
    All 11 cases fail on the missing script, so no case passes at the phase
    base (A4). The file holds no tool-path seam: `SCRIPT_SOURCE` is a fixed
    join. Authoring check: the same bytes of the test file were copied to a
    temp harness under `/tmp/opencode/val/harness` with a throwaway
    prototype of `provider-credential.sh`, and the run gave `Tests  11
    passed (11)`, so the temp fake, the temp repo, and every assertion
    work. One prototype defect was fixed first: the script must resolve
    `harness/opencode-host.sh` two levels up from
    `harness/model-guide/`. After the recorded run,
    `ps -eo pid,args | grep '[f]ake-opencode'` prints no line, and no
    `mg-cred` temp folder stays under `/tmp`.
  - Green 4.6 makes the file pass at 4d8f87c, so this row is `[x]`.
- [x] 9c1dfa6 4.4 Green. Write `harness/model-guide/quota.ts`. Touch no test
  file and no other file.
  - Verify: `cd harness && npx vitest run model-guide-tests/quota.test.ts --configLoader native`
    passes.
  - Evidence: run on 2026-11-18 with `cd harness && npx vitest run
    model-guide-tests/quota.test.ts --configLoader native --maxWorkers=1
    --reporter=dot`. Exit 0, `Tests  15 passed (15)`. The tool reads
    `GET /api/quota/<id>` for the four sourced providers, gives `wait` at
    70 %, and gives `stopped` with one named line for each error case. The
    file holds the cap 1 for a provider with no source and the cap 3 for a
    provider with a source. After the run,
    `ps -eo pid,args | grep '[f]ake-opencode'` prints no line.
  - Fix commit 82a0e6a: `quota.ts` starts its work with `void main()` and no
    top-level await. The review runner copies the tool into a temp repo that
    holds no `type: module` package.json, and tsx then compiles the file as
    CJS. The file still passes `Tests  15 passed (15)`.
- [x] 7bf337a 4.5 Green. Write `harness/model-guide/routes.json`. Touch no
  test file and no other file.
  - The file holds the routes of spec D12 with the quota source of spec D15.
    It holds no second-judge route while the D11 fallback holds, and it holds
    the second judge when an allowed route replaces the fallback
    (PM 2026-11-17).
  - The file holds the Hy row of spec D12.
  - Verify: the test files of Phase 4 pass.
  - Evidence: the file holds the nine rows of the spec D12 list of
    2026-11-17, in order, each with
    exactly `family`, `route`, `kind`, `quota_provider`, and `quota_source`.
    The kinds are `plan` and `free` only. The Hy row `opencode/hy4-flash-free`
    is present with the quota source null. There is no second-judge row,
    because spec D11 keeps the fallback "no ready route" and no allowed
    route replaces it yet. The file holds no test of its own
    (test-strategy 2.4). At this HEAD `quota.test.ts` passes with
    `Tests  15 passed (15)`; `review-run.test.ts` and
    `credential-provider.test.ts` still fail for the missing modules of
    tasks 4.6 and 4.7. `credential-provider.test.ts` passes at the 4.6
    HEAD (11 passed). `review-run.test.ts` passes at the 4.7 HEAD with
    `Tests  23 passed (23)`, so the three Phase 4 files pass at 303f73d.
- [x] 4d8f87c 4.6 Green. Write `harness/model-guide/provider-credential.sh`.
  Touch no test file and no other file.
  - Verify: `cd harness && npx vitest run model-guide-tests/credential-provider.test.ts --configLoader native`
    passes.
  - Evidence: run on 2026-11-18 with `cd harness && npx vitest run
    model-guide-tests/credential-provider.test.ts --configLoader native
    --maxWorkers=1 --reporter=dot`. Exit 0, `Tests  11 passed (11)`. `seed`
    imports exactly the entry of the provider and prints no value, and
    `scan-values` prints the access value then the orgID. A provider with no
    entry gives exit 2 with one named line. The helper writes no credential
    value into any file, and it never prints one. `bash -n` on the script
    exits 0. After the run, `ps -eo pid,args | grep '[f]ake-opencode'`
    prints no line.
- [x] 303f73d 4.7 Green. Write `harness/model-guide/review-run.sh`. Touch no
  test file and no other file. Do not change `harness/opencode-credential.sh`
  or `harness/opencode-host.sh`.
  - Verify: `cd harness && npx vitest run model-guide-tests/review-run.test.ts --configLoader native`
    passes.
  - Verify: `git diff --stat 57baaaa364f968a2f44c6e14eb96f8a9d68beebf -- harness/opencode-credential.sh harness/opencode-host.sh harness/provenance.ts harness/tests`
    prints nothing (orchestrator 2026-11-18). The earlier value `ea36fae` is
    not an ancestor of `main`.
  - Evidence: run on 2026-11-18 with `cd harness && npx vitest run
    model-guide-tests/review-run.test.ts --configLoader native
    --maxWorkers=1 --reporter=dot`. Exit 0, `Tests  23 passed (23)`. The
    runner reads the quota before each pass and before each diff, stops at
    a window of 80 %, retries a transport error twice, marks a Go route with
    the region error `region-blocked`, and deletes a raw output that holds a
    credential value. The Red fix of task 4.1 is 8e111d2: the case R4 file
    no longer holds the unknown route, and R6 starts at 69.9 %. The
    `phase_base_sha` check above prints nothing. `bash -n` on the runner
    exits 0. After the run,
    `ps -eo pid,args | grep '[f]ake-opencode'` prints no line.
  - Fix 75b3b33 (ADV-R-8, orchestrator and PM 2026-11-18): the runner holds
    one exclusive `flock` for one route, one set, and one date, before the
    pass number and before any call. A second run that finds the lock held
    exits 2 with one stderr line that names the lock, makes no call, and
    writes no pass record. The trap releases the lock on every exit path.
    `adversarial-p4-runner.test.ts` exits 0 with `Tests  12 passed (12)`.
    `review-run.test.ts` keeps `Tests  23 passed (23)`, `quota.test.ts`
    keeps `Tests  15 passed (15)`, `credential-provider.test.ts` keeps
    `Tests  11 passed (11)`, and `preview-gate.test.ts` keeps `Tests  111
    passed (111)`. No quota server process and no fake `opencode` process
    stay.
  - Fix 448dbf9 (ADV-R-13, orchestrator 2026-11-18): the lock name and the
    output folder carry the first 12 hex characters of the SHA-256 of the
    full route string. Two routes that fold to one slug, for example
    `t/one#c` and `t-one#c`, keep their own lock and their own output
    folder. `adversarial-p4-runner.test.ts` exits 0 with `Tests  13 passed
    (13)`. `review-run.test.ts` keeps `Tests  23 passed (23)`, and
    `preview-gate.test.ts` keeps `Tests  111 passed (111)`. No quota server
    process and no fake `opencode` process stay. The pass record name keeps
    the plain slug, because the decision changes the lock and the output
    folder only.
  - Fix d820479 (ADV-R-14, orchestrator 2026-11-18): the pass record name
    carries the same 12-hex route tag, so it is
    `<date>-<slug>-<tag>-p<pass>.json`. The pass-number count and the
    one-pass "tonight" count use the slug plus tag. The record content does
    not change. No reader parses the pass record name: `review-score.ts`
    reads the key files and the `<outputs>/<diff_id>.txt` files,
    `preview.sh` reads the newest score file and the set manifest,
    `guide.ts` reads the score document, and the tests read each JSON file
    with a `state` field. `adversarial-p4-runner.test.ts` exits 0 with
    `Tests  14 passed (14)`. `review-run.test.ts` keeps `Tests  23 passed
    (23)`, `review-score.test.ts` keeps `Tests  25 passed (25)`, and
    `preview-gate.test.ts` keeps `Tests  111 passed (111)`.
- [x] 6be3894 4.8a Red. The review page. Add the page cases V1 to V9 of
  `measure/tracks/model_guide/test-strategy.md` section 4.4 to
  `harness/model-guide-tests/preview-gate.test.ts`. Touch no other file.
  - The cases cover the rank, the worst, median, and best score, the blocker
    recall, the false claims, the real defects, the counts by class and by
    severity, the `incomplete` and `provisional` words, the pilot gate, the
    set counts, the method note, the private-field scan, the nav link, and
    the empty `docs/` status.
  - Verify: the V cases fail at HEAD, and the Phase 1 and Phase 2 cases of
    the file stay green. Record the failed test names in
    `measure/runs/model_guide/red-4.8a.txt`.
  - Evidence: run on 2026-11-18 with `cd harness && npx vitest run
    model-guide-tests/preview-gate.test.ts --configLoader native
    --maxWorkers=1 --reporter=dot`. Exit 1, `Tests  9 failed | 102 passed
    (111)`. First failure line: `FAIL model-guide-tests/preview-gate.test.ts
    > the review page cases V1 to V9 of task 4.8a > V1: the page holds the
    rank, worst, median, best, blocker recall, false claims, real defects,
    and the counts by class and severity`. The message is `review.html is
    missing from the preview folder`. All nine V cases fail for the missing
    page, and the 102 Phase 1 to Phase 3 cases stay green (A4). V9 runs its
    docs snapshot, its `git status --short docs/`, and its preview-base
    check before the page check, and all three pass at the base, so the
    git path of the case is proven live. Authoring check: the same bytes of
    the test file ran in a temp harness under `/tmp/opencode/valp` with a
    prototype review page in a patched copy of `preview.sh`, and the run
    gave `Tests  9 passed | 102 skipped (111)`, exit 0. No env seam, no
    new fixture file, no production file, and no `docs/` file. The temp
    harness and the temp folders of the earlier review-run runs were
    removed after the run.
  - Green 4.8 makes the nine V cases pass at 8f8f42d, so this row is `[x]`.
- [x] 8f8f42d 4.8 Green. Write `harness/model-guide/pages/review.html` and
  the review page edit of `harness/model-guide/preview.sh`, plus that
  wiring. Touch no test file.
  - Apply the Real work and Review nav links to every page when the Review
    page exists (review C4-1). Phase 1 keeps index.html only.
  - Verify: the test files of Phases 1 to 4 pass, and
    `git status --short docs/` prints nothing.
  - Evidence: run on 2026-11-18, one file at a time from `harness/`, each
    with `--configLoader native --maxWorkers=1 --reporter=dot`:
    - `preview-gate.test.ts` exits 0 with `Tests  111 passed (111)`.
    - `real-work.test.ts` exits 0 with `Tests  14 passed (14)`.
    - `guide.test.ts` exits 0 with `Tests  18 passed (18)`.
    - `update.test.ts` exits 0 with `Tests  9 passed (9)`.
    - `leak-check.test.ts` exits 0 with `Tests  22 passed (22)`.
    - `adversarial.test.ts` exits 0 with `Tests  46 passed (46)`.
    - `adversarial-p2.test.ts` exits 0 with `Tests  13 passed (13)`.
    - `adversarial-p3.test.ts` exits 0 with `Tests  34 passed (34)`.
    - `adversarial-p4.test.ts` exits 0 with `Tests  24 passed (24)`.
    - `input-check.test.ts` exits 0 with `Tests  23 passed (23)`.
    - `quota.test.ts` exits 0 with `Tests  15 passed (15)`.
    - `credential-provider.test.ts` exits 0 with `Tests  11 passed (11)`.
    - `review-run.test.ts` exits 0 with `Tests  23 passed (23)`.
    - `bash -n harness/model-guide/preview.sh` exits 0, and
      `git status --short docs/` prints nothing.
    - The preview on the real files exits 0 with no stdout line and no
      stderr line. The real tree holds no score file, so the run removes a
      stale review page and writes none.
  - Changes: `pages/review.html` is the new page. `preview.sh` reads the
    newest score file under `harness/model-guide/data/review-scores/` and
    the public set manifest of that set, then writes `review.html` and
    copies the score file to `review.json`. The page shows the review table,
    the counts by class and severity, the passes, the set counts, and the
    method note. `--pilot-gate fail` hides every rank and prints one line
    `preview: pilot gate fail`. The pinned defaults are the newest score
    file, the sums over the passes of a route, the worst blocker recall as a
    whole percent, and the method note with `<n> diffs`.
- [x] 0ba6a28 4.9 Checks. One code checker reads the diff against spec D12 to D15
  and D22.
  - The checker confirms the metered refusal, the 70 % and 80 % rules, the
    state of each route, the region rule, and the credential scan.
  - Verify: `measure/runs/model_guide/check-4.9.json` has status pass, or
    each blocking finding has a fix commit.
  - Fix F1 (check-4.9.json, Red e60814a): the one-pass rule of a route with
    no quota source keys on an empty or null `quota_source`, not on an empty
    `quota_provider`. A second run of a no-source route for the same
    `--date` exits 2 before any call. It prints one stderr line
    `review-run: the route allows one pass per night and one pass already
    ran`, with empty stdout, and it writes no second pass record. Fix commit
    0ba6a28. `review-run.test.ts` exits 0 with `Tests  25 passed (25)`; the
    F2 case passes at the role base with no production change.
    `adversarial-p4-runner.test.ts` exits 0 with `Tests  14 passed (14)`,
    and `quota.test.ts` exits 0 with `Tests  15 passed (15)`. The second run
    of the checker holds status pass at 8e0c441
    (`measure/runs/model_guide/check-4.9-8e0c441.json`), so this row is
    `[x]`.
- [x] fe29d81 4.9a Red. Probe mode, token log, and the new routes.json (spec
  D12, D14, Tokens; PM 2026-11-18). Change only test files under
  `harness/model-guide-tests/` (`review-run.test.ts` and the fake `opencode`,
  which must emit token fields in its json events).
  - `--probe` makes one call on the first control diff and prints the probe
    line with the exit codes of D14.
  - The pass and probe records hold the tokens sums and per-diff tokens.
  - `tokens_complete` is false when a call has no token field.
  - `routes.json` holds none of the three removed routes and the pilot
    routes are present.
  - Verify: the new cases fail for missing behavior; record names in
    `measure/runs/model_guide/red-4.9a.txt`.
  - Evidence: run on 2026-11-18 with `cd harness && npx vitest run
    model-guide-tests/review-run.test.ts --configLoader native
    --maxWorkers=1 --reporter=dot`. Exit 1, `Tests  10 failed | 25 passed
    (35)`. First failure line: `FAIL model-guide-tests/review-run.test.ts >
    P4 probe mode, the token log, and routes.json (task 4.9a) > P1 the
    probe calls the first control diff once, prints reachable, and writes a
    probe record with the tokens`. The message is `review-run: unknown flag
    --probe`, `expected 2 to be 0`. The 10 new cases fail for missing
    behavior and the 25 earlier cases stay green (A4). The cases are P1 to
    P7 (probe), T1 and T2 (tokens), and J1 (routes.json). Because the fake
    changed, `adversarial-p4-runner.test.ts` ran too and gave `Tests  14
    passed (14)`, exit 0. The token event shape is
    `{"type":"step-finish","tokens":{"input","output","reasoning","cache":
    {"read","write"}}}`, and the record holds the flat sums with `total`
    equal to the sum of the five components. After the runs,
    `pgrep -af 'mg-.*quota-server'` and `ps -eo pid,args | grep
    '[f]ake-opencode'` print no line, and no `mg-*` folder stays under
    `/tmp`.
  - Green 4.9b makes the ten cases pass at 2f66531, so this row is `[x]`.
- [x] 2f66531 4.9b Green. Implement 4.9a in `harness/model-guide/review-run.sh`
  and `harness/model-guide/routes.json`. Make no design choice beyond the
  spec.
  - Verify: the Phase 4 test files pass one at a time; no `fake-opencode` or
    quota-server process stays.
  - Evidence: run on 2026-11-18, one file at a time from `harness/`, each
    with `--configLoader native --maxWorkers=1 --reporter=dot`:
    - `review-run.test.ts` exits 0 with `Tests  35 passed (35)`.
    - `adversarial-p4-runner.test.ts` exits 0 with `Tests  14 passed (14)`.
    - `quota.test.ts` exits 0 with `Tests  15 passed (15)`.
    - `credential-provider.test.ts` exits 0 with `Tests  11 passed (11)`.
    - `preview-gate.test.ts` exits 0 with `Tests  111 passed (111)`.
    - `guide.test.ts` exits 0 with `Tests  18 passed (18)`.
    - No quota server process, no `fake-opencode` process, and no `mg-*`
      temp folder stays. The check of the frozen paths from 57baaaa prints
      nothing.
  - Changes: `--probe` makes one call on the first control diff, the first
    diff whose key holds no plant. It writes one record under
    `<private>/probes/<set_id>/` and no pass record and no raw output. It
    prints `<route> reachable|unreachable|region-blocked <error line or ->`
    and exits 0 or 3. A probe blocked by the 70 % rule or by the credential
    scan is a refusal on stdout with exit 2, and a held lock keeps the lock
    refusal on stderr. The pass and probe records hold `tokens` with
    `input`, `output`, `reasoning`, `cache_read`, `cache_write`, and
    `total`, and each diff entry holds its own `tokens`. `tokens_complete`
    is false when a call has no token field. `routes.json` holds the six
    rows of spec D12 and none of the three removed routes. The model call
    is a background job with a watcher, so a SIGKILL of the runner leaves no
    call and no fake child; the load watch of `review-run.test.ts` requires
    it. Rows 4.9a and 4.9b are `[x]`.
- [x] 9983525 4.9c Red: the runner reviews the seeded diffs (spec D7). Change only
  `harness/model-guide-tests/review-run.test.ts`. Touch no production file.
  - Defect (orchestrator, 2026-11-18): `harness/model-guide/review-run.sh`
    line 242 builds the diff list from `$SET_DIR/src/*.diff`, and line 238
    checks the `src` folder. The `src` folder holds the source diffs
    (`review-set.ts` line 18, `leak-check.ts` line 38). The seeded diffs are
    in `diffs/` (spec D7). A pass sends unseeded code to the model, so every
    plant of a diff counts as missed.
  - The cases: S1 the pass sends the seeded copy of every diff to the model
    and no source-only text; S2 a diff that is only in `src/` gets no call and
    no entry in the pass record; S3 a set with an empty `diffs/` folder and a
    filled `src/` folder refuses with exit 2 and makes no call; S4 the probe
    uses the control diff of `diffs/` and its call holds the seeded copy.
  - The header comment of the test file named `src/<diff_id>.diff`. It names
    `diffs/<diff_id>.diff` now.
  - Verify: the four new cases fail for the runner reading `src/`, and the
    35 earlier cases stay green. Record the failed test names in
    `measure/runs/model_guide/red-4.9c.log`.
  - Evidence: run on 2026-11-18 with `bun test
    harness/model-guide-tests/review-run.test.ts` (the RED_TEST_COMMAND of
    this task). Exit 1, `35 pass`, `4 fail`, `Ran 39 tests across 1 file`.
    The same file with `cd harness && npx vitest run
    model-guide-tests/review-run.test.ts --configLoader native
    --maxWorkers=1 --reporter=dot` gives `Tests  4 failed | 35 passed (39)`.
    The four failing cases and their reasons: S1 `the call for d-01 holds no
    seeded diff`, and the call holds `+// SRC-ONLY-d-01`; S2 `the runner
    called the model for a diff of src/`, one call was expected and four
    came (one for `d-01` and three retries for the source-only `d-99`); S3
    `expected +0 to be 2`, because the runner called the model on the `src/`
    diff and did not refuse; S4 `the probe call holds no seeded diff`, and
    the call holds `+// SRC-ONLY-d-02`. The 35 earlier cases stay green, so
    only the new cases fail. The fake `opencode` only: `pgrep -af
    "fake-opencod[e]"` and `pgrep -af "quota-serve[r]"` print no line, and
    no `mg-*` folder stays under `/tmp`. phase_base_sha
    57baaaa364f968a2f44c6e14eb96f8a9d68beebf (the Phase 4 strategy commit,
    test-strategy section 11); role_base_sha
    f21bec211ab482ef0d721b7f1a3b0affbec52dee (the HEAD before this Red
    role). The task message named only the role base; the phase base came
    from the repository.
  - Fixture fix (Red, 2026-11-18, commit 193c4c2): the fixture of
    `adversarial-p4-runner.test.ts` wrote the diff into `sets/<set_id>/src`,
    so the runner that reads `diffs/` refused the set and 9 of the 14 cases
    failed. The fixture writes the seeded diff into `diffs/` now, and no
    assertion changed. With the uncommitted production fix of the Green role
    in place, that file gives `Tests  14 passed (14)`, and `bun test
    harness/model-guide-tests/review-run.test.ts` gives `39 pass` and
    `0 fail`.
- [x] 49af2be 4.9d Green. The runner reviews the seeded diffs (spec D7).
  `harness/model-guide/review-run.sh` reads
  `<private>/sets/<set_id>/diffs/*.diff` at the set check (line 241) and at
  the diff glob (line 245), so the pass and the probe both use the seeded
  diff. A set with no seeded diff is a refusal: exit 2, one `review-run:`
  line on stdout, no call, and no pass record. The `src/` copies never reach
  the model.
  - Verify: the four S cases and the 35 earlier cases pass; no
    `fake-opencode` or quota-server process stays.
  - Evidence: run on 2026-11-18, one file at a time:
    - `bun test harness/model-guide-tests/review-run.test.ts` exits 0 with
      `39 pass`, `0 fail`, `293 expect() calls`, and `Ran 39 tests across 1
      file` (64.06s).
    - `cd harness && npx vitest run
      model-guide-tests/adversarial-p4-runner.test.ts --configLoader native
      --maxWorkers=1 --reporter=dot` exits 0 with `Tests  14 passed (14)`
      and `Test Files  1 passed (1)` (67.16s). That file runs under vitest:
      its 2 MiB and trap cases exceed the 5 s default timeout of `bun
      test`, and `bun test` on it gives 5 timeouts at the role base too.
    - The same Red file exits 0 under vitest with `Tests  39 passed (39)`.
    - `pgrep -af "fake-opencod[e]"` and `pgrep -af "quota-serve[r]"` print
      no line, and no `mg-*` folder stays under `/tmp`.
  - Changes: `src` became `diffs` at the folder check and at the glob, and
    one comment says that `diffs/` is the review input (spec D7). The pass
    list and the probe list come from the same glob, so both modes read the
    seeded diff. Rows 4.9c and 4.9d are `[x]`.
- [x] c5ea02c 4.9e Red: the message line in the prompt (spec D10 ruling 2026-11-18).
  Change only `harness/model-guide-tests/review-run.test.ts`. Touch no
  production file. (Red role base 154eb7d.)
  - The cases pin that the call stdin holds the prompt, the message line,
    and the seeded diff in that order (pass and probe), and the refusal for
    a missing or empty message file.
  - Verify: the new cases fail on the phase base HEAD, and the earlier cases
    stay green. Record the failed test names in
    `measure/runs/model_guide/red-4.9e.txt`.
  - Evidence (Red 154eb7d, 2026-11-18): `bun test
    harness/model-guide-tests/review-run.test.ts` exits 1 with `39 pass`
    and `4 fail` (43 tests). The failures are M1, M2 (no MSG-LINE marker in
    the call stdin), M3, M4 (exit 0, expected the exit-2 refusal). The 39
    earlier cases pass with the fixture-written message files. The record is
    `measure/runs/model_guide/red-4.9e.txt` (not staged). pgrep scans print
    no line. Row stays `[~]` until Green 4.9f flips it.
  - Evidence (Red remediation dd57da7, 2026-11-18): the adversarial fixture
    writes one non-empty message file per diff, and
    `adversarial-p4-runner.test.ts` exits 0 with `Tests  14 passed (14)`
    with Green's worktree changes in place. The seed-messages suite
    (`bun test harness/model-guide-tests/seed-messages.test.ts`) exits 1
    with `0 pass` and `9 fail`: every case fails with "production file is
    missing". The row was `[~]` until the Green commit 75f7419.
  - Evidence (Green 75f7419, 2026-11-18): the Green commit 75f7419
    implements this contract, and row 4.9f holds the gate counts. `bun test
    harness/model-guide-tests/review-run.test.ts` exits 0 with `43 pass` and
    `0 fail`, and `bun test
    harness/model-guide-tests/seed-messages.test.ts` exits 0 with `9 pass` and
    `0 fail`. This row is `[x]`.
- [x] 75f7419 4.9f Green: the message line in the prompt, the seeder, and the backfill
  (spec D10 ruling 2026-11-18).
  - Change `harness/model-guide/review-run.sh` to read the message file and
    put the line between the prompt and the seeded diff. Write the new tool
    `harness/model-guide/seed-messages.ts` (run from `harness/`):
    `npx tsx model-guide/seed-messages.ts <set_id> --private <dir>
    [--gh <path>]` (`--gh` defaults to `gh`). For each
    `<private>/sets/<set_id>/diffs/<diff_id>.diff` it reads
    `keys/<diff_id>.json` for `source.commit` and `source.repo`, runs
    `<gh> api repos/<owner>/<repo>/commits/<sha> --jq .commit.message`,
    and writes the first line of the message to
    `messages/<diff_id>.txt` (trailing newline, no other text). Exit 0
    prints one line `seed-messages: <n> written` on stdout. A missing key,
    a key with no commit or repo, a gh failure, or an empty first line
    gives exit 2 with one line `seed-messages: <diff_id> <check>` on
    stdout, and no message file is written for the whole run. The tool
    reads no file in `src/` and writes nothing outside `messages/`.
  - Run the backfill for both sets (`gh` read only):
    `npx tsx model-guide/seed-messages.ts mg-2026-11a` and
    `npx tsx model-guide/seed-messages.ts mg-2026-11p`.
  - Verify: list that each diff of both sets has one non-empty message file.
    The Red command exits 0.
  - Evidence (Green 75f7419, 2026-11-18): the gates run one at a time, and
    each exits 0.
    - `bun test harness/model-guide-tests/review-run.test.ts` exits 0 with
      `43 pass`, `0 fail`, `329 expect() calls`, and `Ran 43 tests across 1
      file` (61.62s).
    - `bun test harness/model-guide-tests/seed-messages.test.ts` exits 0 with
      `9 pass`, `0 fail`, `41 expect() calls`, and `Ran 9 tests across 1
      file` (3.31s).
    - `bun test harness/model-guide-tests/pick-diffs.test.ts` exits 0 with
      `29 pass`, `0 fail`, `220 expect() calls`, and `Ran 29 tests across 1
      file` (26.14s).
    - After each gate, `pgrep -af "fake-opencod[e]"` and `pgrep -af
      "quota-serve[r]"` print no line.
  - Backfill (Green 75f7419, 2026-11-18, `gh` read only): the run for
    `mg-2026-11a` prints `seed-messages: 14 written`, and the run for
    `mg-2026-11p` prints `seed-messages: 6 written`. The set `mg-2026-11a`
    holds 14 diff files and 14 non-empty message files, and the set
    `mg-2026-11p` holds 6 diff files and 6 non-empty message files. Every
    diff id has one message file, and every message file holds one line. The
    counts of the two sets match.
  - Changes: the file `harness/model-guide/review-run.sh`, the new file
    `harness/model-guide/seed-messages.ts`, and this plan row. The Red test
    file `harness/model-guide-tests/seed-messages.test.ts` is unchanged. The
    log is `measure/runs/model_guide/green-4.9f.log` (not staged).
  - phase_base_sha 57baaaa364f968a2f44c6e14eb96f8a9d68beebf; role_base_sha
    07418d21f073a3201055832dd5fbd82fa0e8a880; final Green HEAD 75f7419
    before this row, and the plan-evidence commit after it.
- [x] 71adc88 4.13a Red: the judge runner (spec D11).
  - The new tool is `harness/model-guide/judge-run.sh`. The test file is
    `harness/model-guide-tests/judge-run.test.ts`. Touch no other file.
  - Usage: `judge-run.sh --set <set_id> --route <route> --judge a|b
    [--private <dir>] [--start-test]`. The default private folder is the one
    of `review-run.sh`.
  - Input: `<private>/sets/<set_id>/adjudication/queue.json`. The tool makes
    one model call per group. A group is one diff, one file, one 3-line
    window, and the claims of every route. The prompt holds the seeded diff
    `<private>/sets/<set_id>/diffs/<diff_id>.diff` and the items of the group
    (id, line, claim fields). The prompt holds no route name, no slug, and no
    text of any judge file. The second judge never reads the verdicts of the
    first judge, and neither judge sees a route name.
  - The answer: the tool takes the last fenced ```json block that is a flat
    object. It keeps only the ids of that group with a value of
    `real-defect`, `false-claim`, or `unclear`. It drops any other id and any
    other value. A group with no valid block adds no verdict, so `apply`
    treats it as `unclear`.
  - Output: `<private>/sets/<set_id>/adjudication/judge-<a|b>.json`, the flat
    map that `adjudicate.ts apply` reads, and the run record
    `<private>/sets/<set_id>/adjudication/judge-<a|b>-run.json`. The run
    record holds `set_id`, `judge`, `route`, `date`, `state` (`complete` or
    `open`), `groups` (each with an `id`, a `state`, and a `tokens` object),
    `judged_by` (the finding id to the route that judged it), `tokens`
    (`input`, `output`, `reasoning`, `cache_read`, `cache_write`, `total`),
    and `tokens_complete`.
  - The safety rules of `review-run.sh` hold: the job folder of
    `opencode_host_begin` with its own `OPENCODE_HOME`, the call
    `run --standalone --format json --model <route>`, the job config that
    denies every tool, the credential value scan, the flock lock of one set,
    one judge, and one date, the quota rules of spec D15, the watcher of the
    call, and the token log of the `step-finish` events.
  - A missing queue, an empty queue, and a bad `--judge` value give exit 2,
    one `judge-run:` line on stdout, no call, and no file.
  - `--start-test` makes exactly one call on a fixed built-in sample group and
    no set data. It prints `<route> ready|not-ready <error line or ->`, exits
    0 for ready and 3 for not-ready, and writes no judge file.
  - Verify: `cd harness && npx vitest run
    model-guide-tests/judge-run.test.ts --configLoader native
    --maxWorkers=1 --reporter=dot` fails on the Phase 4 code. Record the
    failed test names in `measure/runs/model_guide/red-4.13a.txt`.
  - Evidence: commit 71adc88 holds the test file and this plan row. The Red
    command `cd harness && npx vitest run
    model-guide-tests/judge-run.test.ts --configLoader native
    --maxWorkers=1 --reporter=dot` exits 1 with `Tests  18 failed (18)` and
    `Test Files  1 failed (1)`. Every case fails with the same reason: "the
    judge runner is missing:
    /home/daniebo/Desktop/lending-desk-bench/harness/model-guide/judge-run.sh".
    No case passes at the role base, so no claim rests on a vacuous pass (A4).
    The 18 failed names are J1, J1b, J2, J3, J4, J5, J6, J7, J8, J9, J10, J11
    (two cases), J12, J13, J13b, J14, and J14b. The record is
    `measure/runs/model_guide/red-4.13a.log` (not staged).
  - The test-bug check: a scratch runner, written outside the repository and
    deleted before the commit, made all 18 cases pass. The scratch proved that
    the failures come from the missing tool and not from a test bug. The
    scratch file is not part of the track.
  - The orphan check: `pgrep -af "fake-opencod[e]"` and `pgrep -af
    "quota-serve[r]"` print no line, and no `mg-judge-*` folder stays under
    `/tmp`.
  - phase_base_sha 57baaaa364f968a2f44c6e14eb96f8a9d68beebf (the Phase 4
    strategy commit, test-strategy section 11); role_base_sha
    4bdbd3f5f145f1cfe5a817766b162cf8da51dbd4 (the HEAD before this Red role).
- [x] 61449ae 4.13b Green: the judge runner (spec D11).
  - `harness/model-guide/judge-run.sh` holds the contract of row 4.13a. It
    reads `<private>/sets/<set_id>/adjudication/queue.json`, makes one call
    per group, and writes `judge-<a|b>.json` plus `judge-<a|b>-run.json`.
  - The prompt holds the seeded diff of the group and its items (id, line,
    file, class, severity, title, reason). It holds no route name, no slug,
    and no text of a judge file: the runner reads no judge file.
  - The answer parse takes the last fenced json block that is a flat object,
    keeps the ids of the group with a value of `real-defect`, `false-claim`,
    or `unclear`, and drops other ids and other values.
  - The safety rules of `review-run.sh` hold: the job folder of
    `opencode_host_begin` with its own `OPENCODE_HOME`, the call
    `run --standalone --format json --model <route>`, the job config that
    denies every tool, the credential value scan, the flock lock of one set,
    one judge, and one date, the quota rules of spec D15, the watcher of the
    call, and the token log of the `step-finish` events.
  - A missing queue, an empty queue, and a bad `--judge` value give exit 2,
    one `judge-run:` line on stdout, no call, and no file. `--start-test`
    makes one call on a built-in sample group and prints
    `<route> ready|not-ready <error line or ->`.
  - The Red tests are unchanged: the implementation commit touches
    `judge-run.sh` only.
  - Verify: the Red command exits 0, and the two live gates pass, one at a
    time.
  - Evidence: run on 2026-11-18, after the Red command failed with
    `Tests  18 failed (18)` at the role base.
    - `cd harness && npx vitest run
      model-guide-tests/judge-run.test.ts --configLoader native
      --maxWorkers=1 --reporter=dot` exits 0 with `Tests  18 passed (18)`
      and `Test Files  1 passed (1)` (39.19s).
    - `bun test harness/model-guide-tests/review-run.test.ts` exits 0 with
      `39 pass`, `0 fail`, `293 expect() calls`, and `Ran 39 tests across 1
      file` (64.28s).
    - `cd harness && npx vitest run
      model-guide-tests/adversarial-p4-runner.test.ts --configLoader native
      --maxWorkers=1 --reporter=dot` exits 0 with `Tests  14 passed (14)`
      and `Test Files  1 passed (1)` (66.06s).
    - After each gate, `pgrep -af "fake-opencod[e]"` and `pgrep -af
      "quota-serve[r]"` print no line, and no `mg-judge*` folder stays under
      `/tmp`.
  - Changes: the new file `harness/model-guide/judge-run.sh` (mode 755) and
    this plan row. No other file changed, and no shared helper was extracted.
    The log is `measure/runs/model_guide/green-4.13b.log` (not staged).
  - phase_base_sha 57baaaa364f968a2f44c6e14eb96f8a9d68beebf; role_base_sha
    80869bdc6bd546da446d2c86312e0076d70cbe1e; final Green HEAD 61449ae
    before this row, and the plan-evidence commit after it.
- [x] c5ea02c 4.13c Red: the judge route list (spec D11, PM 2026-11-18). Change only
  `harness/model-guide-tests/judge-run.test.ts`. Touch no production file. (Red role base 154eb7d.)
  - The cases pin the accept/refuse rule: `judge-run.sh` accepts each route
    of `judges.json` (the two named judges and the Claude seat); it refuses
    a review-only route of `routes.json` and a route that neither file
    holds, with exit 2, one `judge-run:` line, and no call;
    `review-run.sh` never reads `judges.json`.
  - Verify: `cd harness && npx vitest run
    model-guide-tests/judge-run.test.ts --configLoader native
    --maxWorkers=1 --reporter=dot` fails on the new cases and passes the 18
    earlier cases. Record the failed test names in
    `measure/runs/model_guide/red-4.13c.txt`.
  - Evidence (Red 154eb7d, 2026-11-18): the Red command exits 1 with
    `Tests  2 failed | 19 passed (21)`. The failures are J15 (judge route
    refused: "judge-run: the route is not in routes.json") and J16
    (review-only route accepted at HEAD). J16b (unknown route refused)
    passes at HEAD and stays as a guard. The 18 earlier cases pass; the
    builder gained the opt-in `judgesRoutes` field with no assertion
    change. The record is `measure/runs/model_guide/red-4.13c.txt` (not
    staged). pgrep scans print no line. Row stays `[~]` until Green 4.13d
    flips it. No pick-diffs case: its design has no diff_id mapping (see
    the handoff).
  - Evidence (Red remediation dd57da7, 2026-11-18): the shared fixture
    always writes a temp `judges.json` holding the fixture route, with no
    assertion changed; the 18 earlier cases pass with Green's worktree
    changes in place. New J17 (no `judges.json`, route from `routes.json`
    refused) fails against Green's routes.json fallback with exit 0,
    expected 2. The Red command exits 1 with
    `Tests  1 failed | 21 passed (22)`. The row was `[~]` until the Green
    commit 75f7419.
  - Evidence (Green 75f7419, 2026-11-18): the Green commit 75f7419
    implements this contract, and row 4.13d holds the gate counts. The Red
    command exits 0 with `Tests  22 passed (22)`. This row is `[x]`.
- [x] 75f7419 4.13d Green: the judge route list (spec D11, PM 2026-11-18).
  - Write `harness/model-guide/judges.json` with the three judge routes,
    each with a `quota_provider` and a `quota_source`. Change `judge-run.sh`
    to accept a route only from `judges.json`. `routes.json` stays the six
    review routes.
  - Verify: the Red command exits 0.
  - Evidence (Green 75f7419, 2026-11-18): the gates run one at a time, and
    each exits 0.
    - `cd harness && npx vitest run
      model-guide-tests/judge-run.test.ts --configLoader native
      --maxWorkers=1 --reporter=dot` exits 0 with `Tests  22 passed (22)`
      and `Test Files  1 passed (1)` (44.36s).
    - `bun test harness/model-guide-tests/review-run.test.ts` exits 0 with
      `43 pass`, `0 fail`, `329 expect() calls`, and `Ran 43 tests across 1
      file` (61.62s).
    - `cd harness && npx vitest run
      model-guide-tests/adversarial-p4-runner.test.ts --configLoader native
      --maxWorkers=1 --reporter=dot` exits 0 with `Tests  14 passed (14)`
      and `Test Files  1 passed (1)` (65.77s).
    - After each gate, `pgrep -af "fake-opencod[e]"` and `pgrep -af
      "quota-serve[r]"` print no line.
  - Changes: the new file `harness/model-guide/judges.json`, the file
    `harness/model-guide/judge-run.sh`, and this plan row. The Red test file
    `harness/model-guide-tests/judge-run.test.ts` is unchanged. The log is
    `measure/runs/model_guide/green-4.9f.log` (not staged).
  - phase_base_sha 57baaaa364f968a2f44c6e14eb96f8a9d68beebf; role_base_sha
    07418d21f073a3201055832dd5fbd82fa0e8a880; final Green HEAD 75f7419
    before this row, and the plan-evidence commit after it.
- [x] 5db6a32 4.13e Red: hardening after Reviews A, B, C (edee50b). Change only
  test files under `harness/model-guide-tests/`. Touch no production file.
  One bullet pins each test:
  - (B2) `judge-run.sh` refuses a `judges.json` row with an empty
    `quota_provider` or `quota_source`, or a tab in a field. A test reads
    the committed `harness/model-guide/judges.json`.
  - (B3) `review-run.sh` refuses a message file with a second line, a
    control character, or a line over 1000 bytes. The call sends only the
    checked line.
  - (B4) `review-run.sh` refuses a message file or a seeded diff that is a
    symlink.
  - (B5, R3) `seed-messages.ts` refusals: a set id with `/` or `..`, a
    linked `messages/` folder, the set id given twice, an unknown flag, a
    flag with no value, a missing set folder, a set with no diff.
  - (C7) `judged_by` holds only ids with a verdict.
  - (R1) Test P2 pins the probe transport-retry ceiling at 3 calls.
  - (N3) The footer row count of `real-work.ts` equals the outcomes array
    length (Q-S5).
  - (N8) The gate of the decision-role picks is an AA net score above 0
    (PM 2026-11-18), in `real-work.ts` (`NET_SCORE_GATE`), `guide.ts`, and
    `preview-gate.test.ts`.
  - Verify: each new case fails on the phase base HEAD, and the earlier
    cases stay green. Record the failed test names in
    `measure/runs/model_guide/red-4.13e.txt`.
  - Evidence (Red 5db6a32, 2026-11-18): every bullet holds at least one
    case; no case was missing, so no new case was added. Failing new or
    updated cases: J18, J18b, J18c, J19, M5 to M9, DS12, DS13, DS26
    row-count, G6, ADV4-7, ADV4-21. Guards that hold at HEAD: J18d
    (committed `judges.json`), P2b (probe retry ceiling is exactly 3
    calls), the 8 SM4 cases (B5/R3 arg-level refusals already
    implemented), the DS26 net-0 case. `guide.test.ts` stays green: its
    N8 change is the pick-rule comment only (`guide.ts` stays decoupled
    per the test strategy). The three A4 timeouts under `bun test
    preview-gate.test.ts` are a pre-existing runner artifact (each case
    takes `(ctx)`, which bun reads as a never-called done callback);
    those cases are untouched. The N8 ">= 20" to "above 0" assertion
    changes are recorded in `red-4.13e.txt`. pgrep scans print no line.
    Row was `[~]` until Green 4.13f flipped it on 2026-11-19.
- [x] 9ae4e51 4.13f Green: hardening after Reviews A, B, C (edee50b). Implement row
  4.13e in `harness/model-guide/` (`judge-run.sh`, `review-run.sh`,
  `seed-messages.ts`, `real-work.ts`, `guide.ts`). Fix the `review-run.sh`
  header so `--date` says local date (R4). This Green runs after the probe
  of 2026-11-19 ends (after 06:00 +07), because the probe reads
  `review-run.sh` from this worktree.
  - Verify: each gate runs one at a time, and each exits 0.
    - `cd harness && npx vitest run model-guide-tests/judge-run.test.ts --configLoader native --maxWorkers=1 --reporter=dot`
    - `cd harness && npx vitest run model-guide-tests/quota.test.ts --configLoader native --maxWorkers=1 --reporter=dot`
    - `cd harness && npx vitest run model-guide-tests/adversarial-p4-runner.test.ts --configLoader native --maxWorkers=1 --reporter=dot`
    - `bun test harness/model-guide-tests/review-run.test.ts`
    - `bun test harness/model-guide-tests/seed-messages.test.ts`
    - `bun test harness/model-guide-tests/real-work.test.ts`
    - `bun test harness/model-guide-tests/guide.test.ts`
    - `bun test harness/model-guide-tests/preview-gate.test.ts`
    - After each gate, `pgrep -af "fake-opencod[e]"` and `pgrep -af
      "quota-serve[r]"` print no line.
  - Evidence (Green 9ae4e51 and aef521d, 2026-11-19): each gate ran alone,
    and each exited 0.
    - `bun test harness/model-guide-tests/review-run.test.ts` gives 49 pass
      and 0 fail.
    - `cd harness && npx vitest run model-guide-tests/judge-run.test.ts
      --configLoader native --maxWorkers=1 --reporter=dot` gives 27 pass and
      0 fail.
    - `bun test harness/model-guide-tests/real-work.test.ts` gives 16 pass
      and 0 fail.
    - `bun test harness/model-guide-tests/guide.test.ts` gives 18 pass and
      0 fail.
    - `bun test harness/model-guide-tests/preview-gate.test.ts` gives 108
      pass and 3 fail. The three fails are the A4 bun timeouts, a
      pre-existing runner artifact. The same file under vitest gives 111
      pass and 0 fail.
    - `cd harness && npx vitest run model-guide-tests/adversarial-p4.test.ts
      --configLoader native --maxWorkers=1 --reporter=dot` gives 24 pass and
      0 fail.
    - `cd harness && npx vitest run
      model-guide-tests/adversarial-p4-runner.test.ts --configLoader native
      --maxWorkers=1 --reporter=dot` gives 14 pass and 0 fail.
    - `bun test harness/model-guide-tests/seed-messages.test.ts` gives 17
      pass and 0 fail.
    - The gates of row 4.13f and the extra gates also pass: `quota.test.ts`
      gives 15, `input-check.test.ts` gives 23, `adversarial.test.ts` gives
      46, `adversarial-p2.test.ts` gives 13, `adversarial-p3.test.ts` gives
      34, `update.test.ts` gives 9, and `leak-guard.test.ts` with
      `review-score.test.ts` gives 27.
    - After each gate, the two pgrep scans print no line.
  - Changes: the file `harness/model-guide/review-run.sh` (commit aef521d),
    the files `harness/model-guide/judge-run.sh`,
    `harness/model-guide/real-work.ts`, `harness/model-guide/guide.ts`, and
    `harness/model-guide/pages/real-work.html` (commit 9ae4e51), and this
    plan row. The Red test files under `harness/model-guide-tests/` are
    unchanged. The log is `measure/runs/model_guide/green-4.13f.log` (not
    staged).
  - phase_base_sha 57baaaa364f968a2f44c6e14eb96f8a9d68beebf; role_base_sha
    242fe529b26f9d1a4e132f407a2036567c7e3011; final Green HEAD 9ae4e51
    before this row, and the plan-evidence commit after it.
- [x] 0861c05 4.13g Red: the Go plan thresholds (PM order 2026-11-19, spec D15).
  Change only `harness/model-guide-tests/quota.test.ts`,
  `harness/model-guide-tests/review-run.test.ts`, and
  `harness/model-guide-tests/judge-run.test.ts`. Touch no production file.
  - `quota.ts` must give `ready` for `opencode-go` at 5h 94 % and week
    99 %, and `wait` at 5h 95 % or week 100 %. Another source still gives
    `wait` at 70 %.
  - `review-run.sh` must start a pass and a probe on a Go route at week
    97 % with a low 5h, and refuse both at week 100 %. The pass must stop
    before the next diff at the Go thresholds, but not at 80 %. Another
    source still stops at 80 %.
  - `judge-run.sh` must follow the same start, probe, and stop rules.
  - The earlier cases that pin 70/80 on a Go route move to a non-Go
    source: Q2 and Q6 (`kimi-code-plan-cn`), R5, R6, and P6
    (`kimi-code-plan-cn`), and J11 (`kimi-code-plan-cn`).
  - The tests use the existing fake quota server with per-window values.
  - Verify: each Red command fails on the new cases, and the other cases
    stay green. Record the failed test names in
    `measure/runs/model_guide/red-4.13g.txt`. Run one file at a time:
    `cd harness && npx vitest run model-guide-tests/quota.test.ts
    --configLoader native --maxWorkers=1 --reporter=dot`; `bun test
    harness/model-guide-tests/review-run.test.ts`; `cd harness && npx
    vitest run model-guide-tests/judge-run.test.ts --configLoader native
    --maxWorkers=1 --reporter=dot`. After each run, `pgrep -af
    "fake-opencod[e]"` and `pgrep -af "quota-serve[r]"` print no line.
  - Evidence: Red test commit 0861c05. `quota.test.ts` exits 1 with
    `Tests 2 failed | 15 passed (17)`; `review-run.test.ts` exits 1 with
    `49 pass` and `3 fail`; `judge-run.test.ts` exits 1 with `Tests 3
    failed | 27 passed (30)`. The failed names are Q9 and Q10, G1, G2,
    and G3 of the review runner, and G1, G2, and G3 of the judge runner.
    The record is `measure/runs/model_guide/red-4.13g.txt` (not staged).
    The two pgrep scans print no line at the end of each run. Green 4.13h
    (94fef2f) flipped the row on 2026-11-19. ADV-R-2 commit bae1884: the huge
    w199 85 case runs on kimi-code-plan-cn; adversarial-p4-runner.test.ts
    exits 0 with `Tests 14 passed (14)` at HEAD. G2 fix 4b4054c: G2 gets
    an explicit per-test timeout (`}, 120_000);`, no assertion change;
    `bun test harness/model-guide-tests/review-run.test.ts` gives 52 pass
    0 fail, and both pgrep scans print nothing.
- [x] 94fef2f 4.13h Green: the Go plan thresholds (PM order 2026-11-19, spec D15).
  Change `harness/model-guide/quota.ts`,
  `harness/model-guide/review-run.sh`, and
  `harness/model-guide/judge-run.sh`. Touch no test file.
  - `quota.ts` gives `ready` for `opencode-go` below 5h 95 % and week
    100 %, and `wait` at or above them. Other sources keep 70 % and 80 %.
  - The runners start no pass, probe, or judge call on a Go route at 5h
    95 % or more or week 100 % or more. They stop a pass at the same
    thresholds, but not at 80 %. Other sources keep 70 % and 80 %.
  - Verify: the three Red commands exit 0, one file at a time. The two
    pgrep scans print no line.
  - Then re-probe the 2 Go pilot routes in the 02:00-06:00 window. This
    step runs after this commit, at 02:00 +07 on 2026-11-19. The
    orchestrator owns it.
  - Evidence (Green 94fef2f, 2026-11-19): each gate ran alone, and each
    exited 0.
    - `cd harness && npx vitest run model-guide-tests/quota.test.ts
      --configLoader native --maxWorkers=1 --reporter=dot` gives
      `Tests 17 passed (17)`.
    - `bun test harness/model-guide-tests/review-run.test.ts` gives 52 pass
      and 0 fail.
    - `cd harness && npx vitest run model-guide-tests/judge-run.test.ts
      --configLoader native --maxWorkers=1 --reporter=dot` gives
      `Tests 30 passed (30)`.
    - `cd harness && npx vitest run
      model-guide-tests/adversarial-p4-runner.test.ts --configLoader native
      --maxWorkers=1 --reporter=dot` gives `Tests 14 passed (14)`.
    - After each gate, the two pgrep scans print no line. The scan
      `ps -eo pid,args | grep '[f]ake-opencode'` prints no line too, and
      `git status --short docs/` prints nothing.
  - Changes: the files `harness/model-guide/quota.ts`,
    `harness/model-guide/review-run.sh`, and
    `harness/model-guide/judge-run.sh` (commit 94fef2f), and this plan row.
    The Red test files under `harness/model-guide-tests/` are unchanged. The
    log is `measure/runs/model_guide/green-4.13h.log` (not staged).
  - phase_base_sha 57baaaa364f968a2f44c6e14eb96f8a9d68beebf; role_base_sha
    3c4e4623c67f1e14c8ab75b2e6b007b5183f2eae; final Green HEAD 94fef2f
    before this row, and the plan-evidence commit after it.
- [x] 6a3f586 4.13i Red: the live Go quota answer (Review A cc8afbd F1, F2;
  Review B cc8afbd B2, N2). Change only
  `harness/model-guide-tests/quota.test.ts` and
  `harness/model-guide-tests/review-run.test.ts`. Touch no production file.
  - `quota.test.ts` serves the real window set of GET
    `/api/quota/opencode-go` (`5h`, `weekly`, `monthly` as numbers, plus a
    null `credits_balance`): Q11 gives ready at 5h 50 / weekly 97 / monthly
    89 and wait at weekly 100 or 5h 95. Q12 skips a null window and gives
    stopped when no usable window exists. Q13 skips a string or negative
    value beside usable windows and stops when it is the only window (NaN
    arrives as null over JSON, pinned by Q12). Q14 keeps the 70 rule for
    `kimi-code-plan-cn` with the real key names. Q15 (Review B B2) gives
    stopped for `opencode-go` when `5h` or `weekly` is absent, even beside
    a usable window, and for `day` only.
  - `review-run.test.ts` G4 starts a Go pass with the real window set at
    weekly 97 and refuses at weekly 100, beside the old day/week fake. Old
    fakes that do not match the live shape: `goBody` and `windowsBody` in
    `quota.test.ts`, `QUOTA_SERVER_SOURCE` in `review-run.test.ts`, and the
    judge-run fake bodies (unchanged; a later row moves them).
  - Verify: each Red command fails on the new cases, and the other cases
    stay green. Record the failed test names in
    `measure/runs/model_guide/red-4.13i.txt`. Run one file at a time:
    `cd harness && npx vitest run model-guide-tests/quota.test.ts
    --configLoader native --maxWorkers=1 --reporter=dot`; `bun test
    harness/model-guide-tests/review-run.test.ts`. After each run, `pgrep
    -af "fake-opencod[e]"` and `pgrep -af "quota-serve[r]"` print no line.
  - Evidence: Red test commit 6a3f586. `quota.test.ts` exits 1 with
    `Tests 7 failed | 17 passed (24)`; the failed names are Q11 (three
    cases), Q12, Q13, Q14, and Q15, each stopped or ready against the
    defect (F1: the `weekly` key is unread and the null window stops the
    read). `review-run.test.ts` exits 1 with `52 pass` and `1 fail`; the
    failed name is G4 (0 model calls at weekly 97 %: the null window stops
    the read). Conversion bb1fa68 (same row, no new task): every
    opencode-go fake body serves the live window names `5h`, `weekly`,
    `monthly` plus a null `credits_balance`, with the same percentages.
    `quota.test.ts`: Q1 serves the live set to opencode-go only, Q7
    likewise; Q9/Q10 serve it with the week value moved to `weekly` (the
    three `["week"]` label assertions now read `["weekly"]`; every
    percentage, state, and count is unchanged). The three runner files
    serve the live set when the request path is `/api/quota/opencode-go`
    and keep `5h`/`day`/`week` for the other sources, so the kimi cases
    are untouched and no assertion changed in these three files. Evidence
    after conversion (every failure is F1/F2): `quota.test.ts` exits 1
    with `Tests 11 failed | 13 passed (24)` (Q1, Q7, Q9, Q10 plus the
    seven 4.13i cases). `review-run.test.ts` exits 1 with `25 pass` and
    `28 fail` (the Go-gated R1, R2, R3, R7 x2, R9, R10, R11, R12, R13,
    fake-binary, P1, P2, P3, P5, P7, T1, T2, S1, S2, S4, M1, M2, P2b plus
    G1, G2, G3, G4). `judge-run.test.ts` exits 1 with `Tests 20 failed |
    10 passed (30)` (every Go fixture: J1 x2, J2, J3, J4, J5, J6, J7, J8,
    J10, J12, J13 x2, J14 x2, J15, J19, G1, G2, G3); the kimi J11 cases
    stay green. Stay-green at HEAD is impossible for a converted Go case:
    a week-100 refusal needs the `week` key the live source never sends
    (F1), and a week-97 start needs a usable read the null window blocks
    (F2). `adversarial-p4-runner.test.ts` exits 1 with `Tests 5 failed | 9
    passed (14)` (ADV-R-1, R-3, R-5, R-7, R-8). After each run the two
    pgrep scans print no line. The record is
    `measure/runs/model_guide/red-4.13i.txt` (not staged); the conversion
    evidence is appended to `measure/runs/model_guide/red-4.13i.log`.
- [x] 34d6be2 4.13j Green: the live Go quota answer (Review A cc8afbd F1, F2;
  Review B cc8afbd B2, N2). Change `harness/model-guide/quota.ts` and the
  spec D15 text. Touch no test file.
  - F1: read the week window under the live key `weekly` in the Go branch
    of `stateOf` (keep `week` only if the PM orders a fallback).
  - F2: skip a window whose usedPercent is null or not a number; keep
    `stopped` for an answer with no usable window at all. B2: for
    `opencode-go`, both `5h` and `weekly` must be finite numbers, else
    `stopped`. N2: a negative usedPercent is not usable. N1: the runners
    key the Go rule on `quota_source` but `quota.ts` keys it on
    `quota_provider`; derive both from one field, or refuse a row where the
    two disagree.
  - Update the spec D15 example and the `quota.ts` doc comment to the live
    keys (`5h`, `weekly`, `monthly`, and a null `credits_balance`).
  - Verify: the two Red commands exit 0, one file at a time. The two pgrep
    scans print no line.
  - Evidence: implementation commit 34d6be2. F1: the Go branch reads
    `weekly`. F2 and N2: `parseAnswer` skips a window whose `usedPercent` is
    null, not a number, or negative, and gives `stopped` only when no usable
    window is left. B2: the Go branch requires the `5h` and the `weekly` name
    and gives `stopped` when either is absent; a present but unusable window
    is skipped, as Q13 pins. N1: `review-run.sh` and `judge-run.sh` key the
    Go rule on `quota_provider`, the field `quota.ts` reads. The `quota.ts`
    doc comment and spec D15 hold the live keys. Gates: `quota.test.ts` 24
    passed (24); `review-run.test.ts` 53 pass and 0 fail (bun);
    `judge-run.test.ts` 30 passed (30); `adversarial-p4-runner.test.ts` 14
    passed (14). Each run left no `fake-opencode` and no `quota-server`
    process. The live read at `127.0.0.1:38307` gives `state: ready` and the
    live window set 5h 4.43 / weekly 1.77 / monthly 0.89. phase_base_sha
    57baaaa364f968a2f44c6e14eb96f8a9d68beebf; role_base_sha
    84857378fe693da61e9fb074fd37983805c3eb6f. The log is
    `measure/runs/model_guide/green-4.13j.log` (not staged).
- [x] afef66e 4.13k Red: Go needs usable 5h and weekly values (Review B e9e7d36 B2).
- [x] 8ce8964 4.13l Green: Go needs usable 5h and weekly values (Review B e9e7d36
  B2; Review A e9e7d36 F3). `harness/model-guide/quota.ts` now reads the usable
  window map, not the answer names, for `opencode-go`. It gives `stopped` when
  the 5h value or the weekly value is not a finite number of 0 or more. The
  non-Go rule is unchanged: an unusable window is skipped, so Q12 stays
  `ready` on a null `credits_balance`. Spec D15 and FR-15 hold the same rule;
  the D15 Go sentence says usable values, not names. No test file changed.
  Gates: `quota.test.ts` 26 passed (26); `review-run.test.ts` 53 pass and 0
  fail (bun); `judge-run.test.ts` 30 passed (30). Each run left no
  `fake-opencode` and no `quota-server` process. The live read of
  `127.0.0.1:38307` gives `state: ready` with an empty stderr.
  phase_base_sha 57baaaa364f968a2f44c6e14eb96f8a9d68beebf; role_base_sha
  5085d9b162a60559e4bf415fb0f33cb91a627b98. The log is
  `measure/runs/model_guide/green-4.13l.log` (not staged).
- [x] 93c0dcf 4.13m Red: every opencode call of the credential helper is standalone (PM stop order 2026-11-19).
- [x] a70e410 4.13n Green: every opencode call of the credential helper is
  standalone (PM stop order 2026-11-19). `harness/model-guide/provider-credential.sh`
  adds `--standalone` to the seed `auth export` (line 147), the seed
  `auth import` (line 179), and the `scan-values` `auth export` (line 187).
  The argument shape is unchanged. Every other real opencode call of
  `harness/model-guide/*.sh` already holds the flag (`review-run.sh:594` run,
  `judge-run.sh:381` run). `harness/opencode-host.sh` holds only the
  `opencode_host_run` wrapper and no invocation of its own. No test file
  changed. Gates: `credential-provider.test.ts` 16 passed (16);
  `review-run.test.ts` 53 pass and 0 fail (bun); `judge-run.test.ts` 30
  passed (30); `adversarial-p4-runner.test.ts` 14 passed (14). Each run left
  no `fake-opencode` and no `quota-server` process. Red before the fix was
  2 failed | 14 passed (ST1, ST2). phase_base_sha
  57baaaa364f968a2f44c6e14eb96f8a9d68beebf; role_base_sha
  38919fdf9a57d41a588de1bf3cab15ad554af25b. The log is
  `measure/runs/model_guide/green-4.13n.log` (not staged).
- [x] 8fca0e3 4.13o Red: the daemon guard of the runners (PM decision 2026-11-19, point 3).
  The contract applies to review-run.sh, judge-run.sh, and the probe mode.
  1. After each pass, each probe, and each judge run, and on every exit path (trap), the runner finds every process whose args hold `serve --service` and whose HOME or cwd is under the job root of this run (BENCH_OPENCODE_HOME or the folder of opencode_host_begin). It stops each one with TERM, then KILL after 5 s. It writes one line to stderr, `<runner>: INFRA stopped daemon <pid>`. It writes the same text to the run record or pass record in an `infra` field, as an array of strings.
  2. The runner never touches a process outside the job root.
  3. Guard point 3 (seed HOME; live seed proof 02:4x; `measure/runs/model_guide/proof-real-home-export.txt`): before each opencode call, the runner or helper refuses any call whose HOME is outside the job root, except one export form. The seed makes exactly one real-HOME call, `auth export <provider> --standalone`, with the HOME of the test process and no other subcommand. The import call has the job HOME and `--standalone`. `scan-values` exports from the job HOME. Any other real-HOME call is refused. That one export runs with timeout 60 and with its cwd in an empty folder outside any git repo (for example a folder under the job root tmp that holds no .git). The fake records HOME, cwd, the parent timeout argv, and argv for each call. Seed succeeds when the fake's real-HOME store holds the provider entry.
  Tests: the failing cases live in `harness/model-guide-tests/review-run.test.ts` and `harness/model-guide-tests/judge-run.test.ts` (daemon kill, INFRA stderr and record, decoy survival, seed export HOME/argv/cwd/timeout, single-exempt inventory, empty-shared refusal). The fake gains a daemon-spawn mode, HOME/cwd/parent logging, and shared/job export stores.
  - Evidence (Red fix 28543bd, 2026-11-19, after the Green 4.13p block, Option A; four test-only fixes, no production file changed): D1 and JD1 drop the `procCmdline` and `procHome` assertions on the stopped daemon and keep `isAlive` false, the one INFRA stderr line with the fake daemon pid, the `infra` record field, and the decoy check; D3 gets a per-test timeout of `25_000`; S1 and JS1 count only exports whose HOME is the real fixture HOME; S2 seeds the job store as S3 and S4 do. Gates at HEAD, one file at a time: `bun test harness/model-guide-tests/review-run.test.ts` exits 1 with `56 pass` and `6 fail` (D1, probe D2, D3, S1, S5, R1; each fails only on the missing 4.13o behavior: no INFRA line, no real-HOME seed export, exit 0 instead of the empty-store refusal; S2 passes at HEAD because no guard trips yet, and it pins the success path Green must keep); `cd harness && npx vitest run model-guide-tests/judge-run.test.ts --configLoader native --maxWorkers=1 --reporter=dot` exits 1 with `Tests 4 failed | 30 passed (34)` (JD1, JS1, JS2, JR1, same missing-behavior reasons). After each run no `fake-opencode`, no `quota-server`, and no `serve --service` process stays. phase_base_sha 57baaaa364f968a2f44c6e14eb96f8a9d68beebf; role_base_sha 5697381bb049e08da66932a23366d2e4f764cacd. Row stays `[~]` until Green 4.13p flips it.
- [x] 62a805b 4.13p Green: the daemon guard of the runners (PM decision 2026-11-19, point 3).
  Implements the 4.13o contract in `harness/model-guide/review-run.sh`, `harness/model-guide/judge-run.sh`, and `harness/model-guide/provider-credential.sh`: the `serve --service` guard with TERM then KILL after 5 s on every exit path, the `<runner>: INFRA stopped daemon <pid>` stderr line and the `infra` record field, the job-root scoping that never touches an outside process, the single real-HOME `auth export <provider> --standalone` seed export (timeout 60, cwd in an empty folder outside any git repo), job-HOME import/run/scan-values, and the refusal (exit 2, one `<runner>:` line, no call, no record) of any other outside-HOME call and of a seed whose shared store holds no entry. Touch no test file.
  `provider-credential.sh` makes the one real-HOME seed export through
  `run_seed_export`: `timeout 60 env -u OPENCODE_DB
  OPENCODE_DISABLE_AUTOUPDATE=1 "$OPENCODE_BIN" auth export <provider>
  --standalone`, with its cwd in an empty `mktemp -d` folder that it removes
  after the call. The import and the `scan-values` export keep the job HOME,
  and `check_job_home` refuses a call HOME outside the job root. The seed
  reads the shared store, so an empty shared store refuses the run.
  `review-run.sh` and `judge-run.sh` add `stop_daemons`: it selects every
  `serve --service` process whose HOME or cwd is under the job root, sends
  TERM, then KILL after 5 s, writes `<runner>: INFRA stopped daemon <pid>` on
  stderr, and writes the same text in the `infra` array of the pass, probe,
  or run record. The guard runs before each record is written and in the EXIT
  trap, so every exit path stops the daemons of the run. It never touches a
  process outside the job root. No test file changed. Gates, one at a time:
  `bun test harness/model-guide-tests/review-run.test.ts` 62 pass (62);
  `judge-run.test.ts` 34 passed (34); `credential-provider.test.ts` 16 passed
  (16); `adversarial-p4-runner.test.ts` 14 passed (14); `quota.test.ts` 26
  passed (26). Each run left no `fake-opencode`, no `quota-server`, and no
  `serve --service` process. Red before the fix was 56 pass and 6 fail (D1,
  D2, D3, S1, S5, R1) and 4 failed and 30 passed (JD1, JS1, JS2, JR1).
  phase_base_sha 57baaaa364f968a2f44c6e14eb96f8a9d68beebf; role_base_sha
  e35ccf6b966a10bf8fd87f69793ee8c47e5c4ae7. The log is
  `measure/runs/model_guide/green-4.13p.log` (not staged).
- [x] 82bf1c3 4.13q Red: the daemon and HOME guards on real process shapes (Reviews A, B c46161f).
  Sources: `measure/runs/model_guide/review-a-c46161f.json` (F1, N2, N3, N4), `review-b-c46161f.json` (F1-F5), the live probe `measure/runs/model_guide/probe-4.10.txt` (points 7, 8). phase_base_sha 57baaaa364f968a2f44c6e14eb96f8a9d68beebf; role_base_sha c46161fb858de0883cf304a7dfc40f0afd486e64.
  F1: the fake daemon uses a real argv split (`<bin> serve --service <tag>` as NUL-separated entries, spawned with node -e, not `exec -a "<one string>"`). D1, D2, D3, JD1 fail at HEAD because the guard reads the raw string. Each carries a shape pin (raw entries hold serve + --service apart, no joined entry) that passes at HEAD.
  F2: a process whose HOME or cwd is `<job-root>/../outside/...` resolves outside the job root and survives; a sibling `<job-root>-other` survives (D4, JD2 fail at HEAD: the guard kills the `..` decoys).
  F3: no test. Green rule in 4.13r with the reason.
  F4/N4: the seed export cwd has no git repo in any parent folder, even when TMPDIR points inside a repo (C11, S6, JS3 fail at HEAD: the recorded cwd sits under the TMPDIR git root; assert with the fake's recorded cwd and `git -C <cwd> rev-parse`).
  F5/N2: the HOME guard resolves the real path of the call HOME and refuses a HOME outside the resolved job root (H1 job-home symlink out of the root, H2 relative job folder fail at HEAD with exit 0 instead of refusal; both run scan-values with a both-keys store entry so the scan reaches the guard at HEAD).
  N3: `daemon_pid_alive` honors BENCH_OPENCODE_PROC the same as `daemon_pids` does (N3 tests extract the production function verbatim and run it against a fake proc tree; fail at HEAD).
  Point 7: every fake export entry uses the live shape (`integrationID`, `active`, `value` with type/key/access/refresh, no `provider` field); seed and scan-values select by `integrationID === <provider>` and `active === true`; an entry with only a `provider` field is not selected (C8); two active entries of one integrationID refuse `ambiguous` (C9 seed, C10 scan-values). Converted cases: C1, C4, C7 (assertion provider to integrationID). Behavior-changed with no text edit: C2, C6, ST1 to ST3, the fake-binary test, S2 to S4, JS1.
  Point 8: the Go quota reads through ra-quota. BENCH_RA_QUOTA names the source (tests point it at a fake double). Q16a fresh lastgood (< 6 h) plus a hanging API gives ready from the reading; Q16b the same with 5h 96 gives wait; Q16c a stale reading (>= 6 h) gives stopped naming the stale reading; Q16d a missing reading gives stopped naming the missing reading. The fake double attempts the hanging API with a short timeout, then falls back to RA_QUOTA_LASTGOOD; the hanging fake API pins both fallback cases.
  Files: review-run.test.ts, judge-run.test.ts, credential-provider.test.ts, quota.test.ts, fixtures/fakes/fake-opencode. New cases fail at HEAD; earlier cases stay green. Every helper process cleans up in afterAll. Commands, one file at a time: `bun test harness/model-guide-tests/review-run.test.ts`; `cd harness && npx vitest run model-guide-tests/judge-run.test.ts --configLoader native --maxWorkers=1 --reporter=dot`; `cd harness && npx vitest run model-guide-tests/credential-provider.test.ts --configLoader native --maxWorkers=1 --reporter=dot`; `cd harness && npx vitest run model-guide-tests/quota.test.ts --configLoader native --maxWorkers=1 --reporter=dot`. After each run, pgrep for fake-opencod[e], quota-serve[r], and "serve --servic[e]" shows nothing of mine.
  Evidence: commit 82bf1c3; `measure/runs/model_guide/red-4.13q.log` (not staged). Row stays `[~]` until Green 4.13r flips it.
  Evidence (Mid Red Option B, orchestrator ruling on the Green 4.13r block): commit b021698. The fake daemon writes its own raw /proc/self/cmdline entries at spawn to `<daemonPath>.argv.json` (JSON array, in the fixture folder); D1, D2, D3, JD1 read that file after the run and assert at least 3 entries with serve and --service as separate entries (adjacent, no joined entry). The isAlive-false, INFRA line, infra field, and decoy checks stay. Red gates at HEAD (0e0f4a2 plus b021698), one file at a time: `bun test harness/model-guide-tests/review-run.test.ts` exits 1 with 56 pass / 9 fail (D1, D2, D3, D4, N3, S2, S3, S4, S6; D1/D2/D3 fail only on the missing guard INFRA line, the spawn argv pins pass); `cd harness && npx vitest run model-guide-tests/judge-run.test.ts --configLoader native --maxWorkers=1 --reporter=dot` exits 1 with 33 passed / 4 failed (JD1, JD2, JS3, N3; JD1 fails only on the missing guard INFRA line). Throwaway copy under /tmp/opencode/red-check (cp -r of harness, patch -p1 of green-4.13r.candidate.patch, copy deleted after): D1, D2, D3 pass (filtered bun runs, 1 pass each), JD1 passes (1 passed / 36 skipped), full review-run 65 pass / 0 fail, full judge-run 37 passed (37). After each run the pgrep scans for fake-opencod[e], quota-serve[r], and serve --servic[e] show nothing of mine. phase_base_sha 57baaaa364f968a2f44c6e14eb96f8a9d68beebf; role_base_sha 0e0f4a22303748c6643434adef581d3d09411cef.
- [x] 427098d 4.13r Green: the daemon and HOME guards on real process shapes (Reviews A, B c46161f).
  Implements the 4.13q contract in `harness/model-guide/` (review-run.sh, judge-run.sh, provider-credential.sh, quota.ts). Touch no test file.
  F1: normalize the cmdline before matching (NUL to space, or split on NUL and require the serve/--service token pair) in `daemon_pids` of both runners. Keep the fake's real split.
  F2: resolve HOME and cwd with realpath before the under() comparison in both runners.
  F3 (the starttime check before KILL) has no test yet. A test through BENCH_OPENCODE_PROC is possible and goes to the hardening row before closeout.
  F4: `run_seed_export` resolves the git top-level of `${TMPDIR:-/tmp}`; when it sits inside a work tree the export falls back to /tmp, so the recorded cwd never sits under a git root.
  F5: `check_job_home` (and the runner `case` guards) resolve with realpath and refuse a non-absolute path or a path outside the resolved job root.
  N3: keep the names and shapes of `daemon_pid_alive` and `daemon_pids`; the N3 tests extract them verbatim from both runners.
  Point 7: SELECT_JS selects `entry.integrationID === provider && entry.active === true`; two active entries refuse with an `ambiguous` named line; entries with only a `provider` field never match.
  Point 8: `quota.ts --provider opencode-go` reads ra-quota only when BENCH_RA_QUOTA names it (quota.ts:407-421). quota.ts keeps no default path. The production drivers `probe-4.10.sh` and `night-4.11.sh` set the production source (outside the repo, since 2026-11-19 06:2x). They export `BENCH_RA_QUOTA=/home/daniebo/Desktop/advantage-pr/scripts/jobs/ra-quota` and `RA_QUOTA_LASTGOOD=/tmp/ra-quota-lastgood.json`. They read the Go quota with `timeout 90 ra-quota status --json`. The read is read-only and prints every plan. The tool reads `.["opencode-go"].windows` percents. The tool requires usable 5h and weekly values. Else it gives stopped and names the gap. It applies the 95/100 thresholds. It gives stopped and names a stale (>= 6 h) or missing last-good reading. When BENCH_RA_QUOTA is unset, the tool uses the API path through BENCH_QUOTA_BASE or the `openchamber status` port. The production drivers (outside the repo) set BENCH_QUOTA_BASE and BENCH_RA_QUOTA.
  Gates, one file at a time: review-run.test.ts, judge-run.test.ts, credential-provider.test.ts, quota.test.ts exit 0; each pgrep scan prints nothing of mine. The log is `measure/runs/model_guide/green-4.13r.log` (not staged).
  Evidence (Green): commit 427098d applies the candidate patch to `review-run.sh`, `judge-run.sh`, `provider-credential.sh` and `quota.ts` only (no test file, no plan edit in that commit). Pre-fix run of the targeted Red command at role_base_sha 42bdece: `bun test harness/model-guide-tests/review-run.test.ts` exits 1 with 56 pass / 9 fail (D1, D2, D3, D4, N3, S2, S3, S4, S6). Gates at HEAD, one at a time: `bun test harness/model-guide-tests/review-run.test.ts` 65 pass (65); `cd harness && npx vitest run model-guide-tests/judge-run.test.ts --configLoader native --maxWorkers=1 --reporter=dot` 37 passed (37); `credential-provider.test.ts` 22 passed (22); `quota.test.ts` 30 passed (30); `adversarial-p4-runner.test.ts` 14 passed (14). Each run left no `fake-opencode`, no `quota-server`, and no `serve --service` process. F3 has no test; the pre-KILL starttime check lands in both runners, with the reason in the task text above. phase_base_sha 57baaaa364f968a2f44c6e14eb96f8a9d68beebf; role_base_sha 42bdece8953ce3b25e230fd234e4698c30044d60.
- [x] 56ab786 4.13s Adversarial tests after ee48a25 (adversarial-p4b.test.ts).
  The file runs 7 failing and 5 passing at the audited HEAD ee48a25. The
  seven DEFECT pins are AJ1, AQ1, AQ2, AD1, AD2, AH1, and AM1; the five
  guard pins are AQ3, AQ4, AQ5, AD3, and AD4. The audit result is
  `measure/runs/model_guide/adversarial-ee48a25.json` (not staged).
- [x] 8b34bbd 4.13t Green: fixes for ADV-P4B-1..6.
  Implements the 4.13s findings in `harness/model-guide/judge-run.sh`,
  `harness/model-guide/review-run.sh`, `harness/model-guide/quota.ts`, and
  `harness/model-guide/review-score.ts`. Touch no test file.
  ADV-P4B-1: three readers read a raw output: `judge-run.sh` reads the judge
  verdict, `review-score.ts` reads the findings in `readFindings`, and
  `adjudicate.ts` reads the findings in `readFindings`. Each one decodes the
  `--format json` event stream before the fence logic. A real `opencode
  run` event is `{"type":"text",...,"part":{"type":"text","text":"..."}}`,
  and the answer is the joined text blocks; a plain answer passes through
  unchanged. The AJ1 `{"type":"result","text":...}` fixture shape is
  supported too. The event-shape source is the `opencode run` JSON writer in
  the installed `@opencode/cli` bundle (`bin/opencode.exe`, the
  `JSON.stringify({type, timestamp, sessionID, ...n})` writer of the text and
  step events), confirmed by the committed session exports under
  `runs/*/artifacts/session.json` (`part.type` holds `step-finish`). No
  separate shared module: the committed adversarial fixture copies only
  `judge-run.sh` and `quota.ts` into its temp repo, so the decoder lives in
  both the runner and the scorer.
  ADV-P4B-2: a last-good `fetchedAt` more than 60 s in the future counts as
  missing, so a future-dated or millisecond-scale reading gives `stopped`.
  ADV-P4B-3: `daemon_pids` splits the cmdline on NUL and requires a `serve`
  token and a `--service` token; `observe --service` no longer matches.
  ADV-P4B-4: the guard sends no KILL when no starttime was recorded.
  ADV-P4B-5: the HOME guard covers home, config, data, state, cache, runtime,
  and tmp; each path must resolve inside the resolved job root.
  ADV-P4B-6: a diff id must match `^[A-Za-z0-9._-]+$`; a hostile name refuses
  before the lock, any call, and any record.
  Gates at the implementation commit 8b34bbd, one file at a time:
  `cd harness && npx vitest run model-guide-tests/adversarial-p4b.test.ts
  --configLoader native --maxWorkers=1 --reporter=dot` 12 passed (12);
  `bun test harness/model-guide-tests/review-run.test.ts` 65 pass / 0 fail;
  `judge-run.test.ts` 37 passed (37); `credential-provider.test.ts` 22 passed
  (22); `quota.test.ts` 30 passed (30); `adversarial-p4-runner.test.ts` 14
  passed (14); `review-score.test.ts` 25 passed (25). Each run left no
  `fake-opencode`, no `quota-server`, and no `serve --service` process. The
  log is `measure/runs/model_guide/green-4.13t.log` (not staged).
  phase_base_sha 57baaaa364f968a2f44c6e14eb96f8a9d68beebf; role_base_sha
  56ab786658576437cf4f373252be2a76f5951130.
- [x] 05bb618 4.13u Red: the queue and the scorer read the real event stream (Review C 2fdb8f8).
  - `harness/model-guide-tests/adjudicate.test.ts` gains a `4.13u` block with
    three cases: an event-stream raw output gives the same queue items as the
    same answer in plain text, JSON-escaped newlines and quotes read the same
    as plain text, and a plain-text raw output still queues. The stream helper
    splits the fenced answer over 2 `{"type":"text",...,"part":{"type":"text",
    "text":"..."}}` events with step and tool events mixed in, which is the
    real shape that `review-run.sh` stores. The first two cases fail at HEAD
    because `readFindings` of `adjudicate.ts:216-232` parses the raw text, so
    the queue holds no item for a real stream; the plain-text case passes.
  - `harness/model-guide-tests/review-score.test.ts` gains a `4.13u` block with
    two cases: an event-stream input scores the same as the same answer in
    plain text, and a plain-text output still scores. Both pass at HEAD: this
    is a guard that pins the `decodeAnswerText` decoder of
    `review-score.ts:233-266`. By reasoning (no production file changed): if
    the decoder is removed, the raw stream keeps its JSON escapes around the
    fenced block, the fence slice fails `JSON.parse`, the review turns
    `invalid`, and `invalid_reviews` becomes 1 instead of 0, so the equality
    case fails.
  - Verify, one file at a time:
    `cd harness && npx vitest run model-guide-tests/adjudicate.test.ts
    --configLoader native --maxWorkers=1 --reporter=dot` exits 1 with
    `Tests  2 failed | 21 passed (23)`; the 2 failures are the `4.13u`
    event-stream cases, and every earlier case stays green.
    `cd harness && npx vitest run model-guide-tests/review-score.test.ts
    --configLoader native --maxWorkers=1 --reporter=dot` exits 0 with
    `Tests  27 passed (27)`; the 2 new `4.13u` cases pass at HEAD as the
    decoder guard.
  - Evidence: commit 05bb618. The record is
    `measure/runs/model_guide/red-4.13u.log` (not staged). Row stays `[x]`
    for Red; Green task 4.13v follows. Deviation: Red marked this row `[x]`,
    not `[~]`; the row keeps `[x]` with the Red commit SHA.
  phase_base_sha 57baaaa364f968a2f44c6e14eb96f8a9d68beebf; role_base_sha
  2fdb8f8f5be14c395f4883fcc2a143d1bf7e9d41.
- [x] bc0391f 4.13v Green: the queue and the scorer read the real event stream (Review C 2fdb8f8).
  `harness/model-guide/adjudicate.ts` gains `decodeAnswerText`, a copy of
  `review-score.ts:233-266`, and `readFindings` of `adjudicate.ts:216-232`
  calls it before the fence parse. `review-score.ts` changes only its
  decoder comment, which now names the three readers. The copy stays, not a
  shared module, because the committed adversarial fixture copies only
  `judge-run.sh` and `quota.ts` into its temp repo. A plain-text raw output
  still queues. No test file changed.
  Gates at the implementation commit bc0391f, one file at a time:
  `cd harness && npx vitest run model-guide-tests/adjudicate.test.ts
  --configLoader native --maxWorkers=1 --reporter=dot` 23 passed (23);
  `review-score.test.ts` 27 passed (27); `adversarial-p4b.test.ts` 12 passed
  (12); `bun test harness/model-guide-tests/review-run.test.ts` 65 pass / 0
  fail; `judge-run.test.ts` 37 passed (37). Before the fix the adjudicate
  file gave 2 failed | 21 passed (23). A `bun test review-run.test.ts` of
  another session ran at the same time; its transient `quota-server`
  processes sat under that session's parent, and no `fake-opencode` or
  `quota-server` of this role remained after each gate. The log is
  `measure/runs/model_guide/green-4.13v.log` (not staged).
  Review C N2 of row 4.13t is fixed in this plan commit: the row names the
  three readers of a raw output. Red marked row 4.13u `[x]`, not `[~]`; the
  row keeps `[x] 05bb618` and records the deviation.
  phase_base_sha 57baaaa364f968a2f44c6e14eb96f8a9d68beebf; role_base_sha
  0f426b171ae319955e3c4c3270c988dc05c97605.
- [x] 943f9f7 4.13w Red: the token log reads the real step_finish event (Review A 2fdb8f8).
  - The defect (Review A 2fdb8f8): `read_tokens` of both runners matches the
    fake event shape `step-finish` with top-level `event.tokens`, but the
    installed bundle prints `step_finish` with the tokens in `part.tokens`
    (`input`, `output`, `reasoning`, `cache.read`, `cache.write`).
  - Write failing tests in `review-run.test.ts` (pass and probe records hold
    the summed real tokens with `tokens_complete: true`), in
    `judge-run.test.ts` (the same for the run record, plus the verdict read
    from the real `text` event shape), and a parity test (the same stream
    decodes to the same answer text in `review-score.ts`, `adjudicate.ts`,
    and `judge-run.sh`).
  - Verify, one file at a time: `bun test
    harness/model-guide-tests/review-run.test.ts`; `cd harness && npx vitest
    run model-guide-tests/judge-run.test.ts --configLoader native
    --maxWorkers=1 --reporter=dot`; the parity file. After each run, pgrep
    for fake-opencod[e] and quota-serve[r] shows nothing of mine.
  - Evidence: the Red commit holds the test files and this plan row. The
    record is `measure/runs/model_guide/red-4.13w.log` (not staged). Green
    4.13x flipped this row to `[x]`.
- [x] f88f9b6 4.13x Green: the token log reads the real step_finish event (Review A 2fdb8f8).
  `read_tokens` in `harness/model-guide/review-run.sh` and in
  `harness/model-guide/judge-run.sh` reads two event shapes: the old
  `{"type":"step-finish","tokens":{...}}` event and the real
  `{"type":"step_finish",...,"part":{...,"tokens":{...}}}` event of the
  installed bundle. The sums cover every matched event. `tokens_complete` is
  true only when all five fields of every matched event are numbers. No test
  file changed, and no test was wrong. Gates at the implementation commit
  f88f9b6, one file at a time: `bun test
  harness/model-guide-tests/review-run.test.ts` 68 pass, 0 fail;
  `model-guide-tests/judge-run.test.ts` 39 passed (39);
  `model-guide-tests/decode-parity.test.ts` 3 passed (3);
  `model-guide-tests/adjudicate.test.ts` 23 passed (23);
  `model-guide-tests/review-score.test.ts` 27 passed (27);
  `model-guide-tests/adversarial-p4b.test.ts` 12 passed (12). Before the
  fix the review-run file gave 65 pass, 3 fail (W1, W2, W3). After each run,
  pgrep for fake-opencod[e] and quota-serve[r] showed nothing. The log is
  `measure/runs/model_guide/green-4.13x.log` (not staged).
  phase_base_sha 57baaaa364f968a2f44c6e14eb96f8a9d68beebf; role_base_sha
  c5942e67d23944eb4e386c54fc9e6017c5e29c34.
- [x] c294988 4.13y Red: error-line key scan, strict token numbers, stdout error events (Review B ff4e009 N16 N17 N18 N20, Review C N3).
- [x] 6e50a2b 4.13z Green: error-line key scan, strict token numbers, stdout error events (Review B ff4e009 N16 N17 N18 N20, Review C N3).
  Implements the 4.13y contract in `harness/model-guide/review-run.sh` and
  `harness/model-guide/judge-run.sh`. The new `error_line_of` reads the
  stdout `{"type":"error",...}` event of the installed bundle first and the
  first stderr line second (Review B N20). It scans that source with
  `scan_output` and prints the fixed text "the error output held a
  credential value" on a hit (Review B N16). The probe line, the probe
  record `error`, the pass record `errors`, the judge `--start-test` line,
  and the judge run record `errors` all carry the fixed text.
  `is_region_error` reads the same error event. `read_tokens` counts only a
  non-negative safe integer (Review B N17), and a `step_finish` event with
  no tokens object clears `tokens_complete` (Review C N3). The judge run
  record now holds the `errors` array. No test file changed, and no test was
  wrong.
  Gates at the implementation commit 6e50a2b, one file at a time: `bun test
  harness/model-guide-tests/review-run.test.ts` 81 pass, 0 fail;
  `model-guide-tests/judge-run.test.ts` 40 passed (40);
  `model-guide-tests/decode-parity.test.ts` 3 passed (3);
  `model-guide-tests/adversarial-p4-runner.test.ts` 14 passed (14);
  `model-guide-tests/adversarial-p4b.test.ts` 12 passed (12). Before the fix
  the review-run file gave 70 pass, 11 fail (Y1 to Y7 and Y10 to Y13), and
  the judge file gave 39 passed, 1 failed (JY1). After each run, pgrep for
  fake-opencod[e] and quota-serve[r] showed nothing. The log is
  `measure/runs/model_guide/green-4.13z.log` (not staged).
  phase_base_sha 57baaaa364f968a2f44c6e14eb96f8a9d68beebf; role_base_sha
  6f6628526508cb2f2014ed794f2b239d023031f1.
- [x] 62126e2 4.13aa Red: no raw error line on a failed scan, scan the decoded text, pin the stdout and start-test scan paths (Review B f26965d N22 N23 N25, Review A NA1 NA2, Review C N1).
- [x] b795f32 4.13ab Green: no raw error line on a failed scan, scan the decoded text, pin the stdout and start-test scan paths (Review B f26965d N22 N23 N25, Review A NA1 NA2, Review C N1).
  Implements the 4.13aa contract in `harness/model-guide/review-run.sh` and
  `harness/model-guide/judge-run.sh`. `error_line_of` prints the fixed text
  "the error output held a credential value" when `scan_output` exits 2, so
  a failed scan never prints the raw error line (Review B N22, Review A NA2,
  Review C N1). When the byte scan of the source finds no value, it scans
  the decoded error-event text too, so a JSON-escaped key with a quote, a
  backslash, or a control character still gives the fixed text (Review B
  N23). The probe line, the probe record `error`, the pass record `errors`,
  the judge output line, the judge run record `errors`, and the
  `--start-test` line all carry the fixed text. No test file changed, and no
  test was wrong.
  Gates at the implementation commit b795f32, one file at a time: `bun test
  harness/model-guide-tests/review-run.test.ts` 86 pass, 0 fail;
  `model-guide-tests/judge-run.test.ts` 45 passed (45);
  `model-guide-tests/decode-parity.test.ts` 3 passed (3);
  `model-guide-tests/adversarial-p4-runner.test.ts` 14 passed (14);
  `model-guide-tests/adversarial-p4b.test.ts` 12 passed (12). Before the fix
  the review-run file gave 82 pass, 4 fail (AA1, AA2, AA3, AA5), and the
  judge file gave 42 passed, 3 failed (JA1, JA2, JA3). After each run, pgrep
  for fake-opencod[e] and quota-serve[r] showed nothing. The log is
  `measure/runs/model_guide/green-4.13ab.log` (not staged).
  phase_base_sha 57baaaa364f968a2f44c6e14eb96f8a9d68beebf; role_base_sha
  9e7672f4d79b1b6b2e799d111f862d7e47e46dd1.
Verify (Phase 4): the runner, the judge runner, and the page pass their tests, Reviews A, B, and C, and the adversarial tests. The live runs moved to Phase 4b (PM 2026-11-19).

## Phase 4b: The live runs and the first track A results (by Sun 2026-11-22)

Moved from Phase 4 by the PM on 2026-11-19, so that Phase 4 acceptance covers the runner code only.

- [ ] 4.10 The route probe (spec D14 "Probe mode (PM 2026-11-18)"). One call
  per pilot route on the first control diff of `mg-2026-11a`, through
  `heavy-run.sh`, in the window 02:00 to 06:00 +07 on 2026-11-19. The pilot
  routes are `opencode-go/deepseek-v4.1-flash`,
  `opencode-go/hy4-flash-free#high` (PM 2026-11-20), and
  `opencode-go/mimo-v2.6-flash`, in that D12 order. No non-pilot route
  gets a probe until the PM approves after the pilot token report (Q1, PM
  2026-11-18). The probe of 2026-11-19 runs after 4.9f and before 4.11;
  its control diff `forge-07` has a message file. It tests reachability
  only.
  - Command for each route:
    `heavy-run.sh harness/model-guide/review-run.sh --set mg-2026-11a --probe --route <route>`.
  - The probe writes no pass record and no stored raw output beyond the
    probe record. It prints `<route> reachable|unreachable|region-blocked
    <error line or ->`.
  - Record each line in `measure/runs/model_guide/probe-4.10.txt`.
  - The orchestrator sends each `unreachable` route to the PM (owner
    question Q8).
  - Verify: each of the 3 pilot routes has one line in the file.
- [ ] 4.11 The pilot gate (spec D13, OD7). The pilot set `mg-2026-11p` runs
  on the three pilot routes with 2 passes each, on the nights of 2026-11-20 and
  2026-11-21.
  - The pilot set holds the first 3 qualified commits of each repo in the
    D4 order, newest first (task 3.16).
  - The pilot routes are `opencode-go/hy4-flash-free#high`
    (PM 2026-11-20), `opencode-go/deepseek-v4.1-flash`, and
    `opencode-go/mimo-v2.6-flash` (PM 2026-11-18). No Claude route and no
    MiniMax route is in the pilot (PM 2026-11-18).
  - The pilot runs through `heavy-run.sh`, in the window of spec D15.
  - The worst-of-2 score of each pilot route goes into the score file.
  - The report gives, for each pilot route, the found, missed, and
    false-claim counts and the worst-of-2 score of each diff kind: the
    test-only diffs and the code diffs. The test-only diffs show no spread
    when the best worst-of-2 score of the kind minus the lowest worst-of-2
    score of the kind is below 20 points (spec D13).
  - When the test-only diffs show no spread, the orchestrator applies the D4
    change and sends it to the PM before the ranked runs. Each repo then
    gives at most 2 test-only diffs in its 7, and the ranked set gets the id
    `mg-2026-11b` (spec D4, D8).
  - Each reseed (`mg-2026-11p2`, then `mg-2026-11p3`) and the `mg-2026-11b`
    set run `npx tsx model-guide/seed-messages.ts <set_id> --private <dir>`
    from `harness/` right after the seeding step: a set with no message
    file makes each pass and probe refuse.
  - A pilot pass counts as a main pass of the route when the ranked set
    `mg-2026-11a` holds the same diffs (spec D13). Each pilot route then
    needs 1 more pass, on the night of 2026-11-22.
  - Verify: the best worst-of-2 score minus the lowest worst-of-2 score is 20
    points or more, and the best worst-of-2 score is below 90. When a rule
    fails, the orchestrator seeds a harder set as `mg-2026-11p2` (task 3.16)
    and runs the pilot again. After 2 reseeds the orchestrator sends the set
    to the PM.
- [x] 4.12 The passes. The nights of 2026-11-20, 2026-11-21, and 2026-11-22
  (02:00 to 06:00 +07). One pass per reachable pilot route per night.
  Nights 1 and 2 run `mg-2026-11p` (the pilot pass of task 4.11); night 3
  runs `mg-2026-11a`. No non-pilot route gets a pass until the PM approves
  after the pilot token report (Q1, PM 2026-11-18).
  - Command for each route:
    `heavy-run.sh harness/model-guide/review-run.sh --set <set_id> --route <route>`.
  - The pass of a pilot route on 11-20 and 11-21 is the pilot pass of task
    4.11 (spec D13).
  - Night limits (spec D15, PM 2026-11-19): the night limit for Go routes
    is 5h 95 % / week 100 %. The orchestrator stops the night's Go runs when
    the 5-hour window is at 95 % or more or the weekly window is at 100 %.
    The runner's own rules (no start at 70 %, stop at 80 % of a window) stay
    and are stricter for one route; the night limit covers the whole night.
  - Verify: each reachable pilot route has 3 complete passes, or the file
    `measure/runs/model_guide/passes-4.12.txt` names the reason (quota
    stop, region block, or open pass). Each line of the file names
    `exit=<rc>` and `state=<state>` of the pass record.
  - Night 3 result (2026-11-22, set `mg-2026-11a`, HEAD 6306874, PM
    2026-11-22). `opencode-go/deepseek-v4.1-flash`: state complete, 14 of
    14 answers, 553,085 tokens. Its exit 2 came from `heavy-run.sh`.
    A PM coder edited that file in place at 02:29-02:41 while the job
    ran. The PM holds the pass valid.
    `opencode-go/hy4-flash-free#high`: exit 0, state complete, 14 of
    14 answers, 320,193 tokens. `opencode-go/mimo-v2.6-flash`: exit 2
    (`the model answer did not complete`), no record, 1 of 14 answers.
    Night 1 was not reachable in probe-4.10. Night 2 refused with `a
    pilot route needs BENCH_SERVER_BASE`. The driver fixed that refusal
    on 2026-11-21. Night 3 gave an incomplete MiMo answer. No extra
    nights run. One pass per route shows if a route is far off. Each
    rank carries the note `one pass`. Evidence:
    `measure/runs/model_guide/passes-4.12.txt`.
- [~] 4.13 The adjudication (spec D11). Run `adjudicate.ts queue`, then one
  call per judge per diff through `heavy-run.sh`, and then `adjudicate.ts
  apply`.
  - The first judge is `kimi-code-plan-cn/k3.1-pro#high` and the second
    judge is `opencode-go/muse-spark-1.3-contributor#high` (PM 2026-11-18),
    never through a subagent and never an Opus subagent (owner routing
    rule). A start test of each judge runs before its first judge call,
    through the model_guide runner path (`heavy-run.sh` and
    `opencode run --standalone` with the job's own `OPENCODE_HOME`). When
    Kimi is unreachable or out of quota at judge time,
    `claude-code/claude-sonnet-5-5#max` takes its seat, but only when
    Claude is under pace. Else the D11 fallback holds for that finding: the
    finding is left out. The second judge never reads the verdicts of the
    first judge.
  - Code (PM 2026-11-22): add the Sol row to `judges.json` and put
    `openai/gpt-6.1-sol#high` on the `judge-run.sh` live path. Update
    test J18d. Work it through Red and Green.
  - Red (2026-11-22, phase_base_sha 7d7d218d00a95d9d2856173b8136b6ace4a5,
    role_base_sha 7f92b17e4bd1d9ac96eada7b833e3d4b0247aa78): test-only
    changes in `harness/model-guide-tests/judge-run.test.ts`. J18d now
    expects the four judge routes and pins the Sol row quota fields
    (`openai` / `codex`). New S1 pins the Sol live start test (one
    session create with the Sol model, the deny config, no seed call,
    no isolated `opencode run`, and the `/api/quota/codex` read) and
    new S2 pins the unset-base refusal (exit 2 with
    `judge-run: a pilot route needs BENCH_SERVER_BASE`). Red line
    `cd harness && npx vitest run model-guide-tests/judge-run.test.ts --configLoader native --maxWorkers=1 --reporter=dot`
    exits 1 with `Tests 3 failed | 60 passed (63)`; the failures are
    J18d, S1, and S2 only, each for the missing Sol seat (no Sol row
    in `judges.json`, no live path, and `quota.ts` refuses the
    `openai` provider). Quota item: `npx tsx model-guide/quota.ts
    --provider openai` exits 2 with `the provider openai is not in the
    spec D15 table`, so S1 names the `codex` read. Scan item: the live
    path calls no `scan-values` seam (`judge-run.sh` near line 1148
    and 1165), so no scan test was added. No production path changed.
    Row stays `[~]` until Green flips it.
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
  - The orchestrator records the scope ruling of the D18 second source for
    the Code review row: `guide.ts` `fromTrackA` gives no pick when the
    track A rank is empty.
  - Scope (PM 2026-11-22): each rank carries the note `one pass`. Row
    4.14 builds the score file and the local preview only. The board
    stays frozen. Nothing is published without a PM word.
  - Verify: `.tmp/model-guide-preview/review.html` shows the rank by the
    worst pass, and the code review row of the table has a pick or "no pick
    yet" (spec acceptance 10 and 11).

- [~] 4.15 The backlog of nonblocking findings (PM round cap 2026-11-19). Work it after the night run of 2026-11-22, through Red and Green.
  - Review B c0a26d7: N30 (the probe region branch and the judge --start-test stdout-event paths have no failing test), N31 (a failed scan and a found key print the same text), N32 (the quota reason line is printed unscanned), and the carried N5, N9 to N13, N15, N20, N21, N24, N26 to N29.
  - Review A c0a26d7: F1 (the probe region branch stdout-event scan path has no failing test), F2 (the orphan-scan flake under concurrent load).
  - Review C c0a26d7: the process-table guard cannot tell another session's fake from its own.
  - Adversarial c0a26d7 (bd967a7): ADV-P4C-1 (a value split across two stdout error events leaks its tail into the runner stdout and the private judge record; pinned as it.skip in adversarial-p4c.test.ts).
  - Verify: each finding has a failing-first test or a recorded PM ruling.
  - Red evidence (2026-11-19, measure/runs/model_guide/red-4.15.txt): phase_base_sha and role_base_sha 7d7d218d00a95d9d619d2856173b8136b6ace4a5. Six Red lines, one file at a time. Line 1 `bun test harness/model-guide-tests/review-run.test.ts` exit 1, `87 pass` / `9 fail` (N21, N10, N11, N9, N26, N27, N28, N31 x2; N30/F1 is a guard whose breakage proof is mutation r6 of review-b-c0a26d7.json). Line 2 `cd harness && npx vitest run model-guide-tests/judge-run.test.ts --configLoader native --maxWorkers=1 --reporter=dot` exit 1, `Tests 2 failed | 46 passed (48)` (N31 JA1, JA2; N30 is a guard, breakage proof mutation j7). Line 3 same form on quota.test.ts exit 1, `1 failed | 30 passed (31)` (N32 raw reason reached stderr). Line 4 same form on adversarial-p4-runner.test.ts exit 1, `1 failed | 14 passed (15)` (P4B-C1 foreign process). Line 5 same form on adversarial-p4c.test.ts exit 1, `1 failed | 12 passed (13)` (E1 un-skipped, tail `dential-value-0123456789`). Line 6 `bun test harness/model-guide-tests/decode-parity.test.ts` exit 1, `3 pass` / `1 fail` (N13 forged result branch). pgrep printed nothing of mine. Red changes test files only; no production path and no frozen path changed. Row stays `[~]` until Green flips it.
  - Red r2 (2026-11-20, role_base_sha 6c42e434e47a3c5458c7ff87ec5259b0df075cce): Green could not pass P4B-C1 because the old case planted a foreign sleep and asserted on `ps` with no production code. The case was rewritten only in adversarial-p4-runner.test.ts. Option A (full clean run with a foreign fake alive) passed at HEAD, so Option B was used: a synthetic proc table through `BENCH_OPENCODE_PROC` with a local pid and a foreign pid; assert only the local pid is selected. Red line `cd harness && npx vitest run model-guide-tests/adversarial-p4-runner.test.ts --configLoader native --maxWorkers=1 --reporter=dot` exits 1 with `Tests 1 failed | 14 passed (15)`; the failure is `expected [ '810001', '810002' ] to not include '810002'`. The other 14 cases pass. Row stays `[~]`.
  - Red r3 (2026-11-20, role_base_sha 6e3e226153acaa08c944a81be154935e81024768): Green stopped on a Red contradiction. Old AA1 and AA2 in review-run.test.ts and old JA1 and JA2 in judge-run.test.ts asserted the found-key text on a broken scan, while the new N31 cases asserted the distinct failed-scan text on the same setup. Only those four old cases were updated to expect `the error output could not be scanned`; every other assertion, including the no-key-leak checks, stays. A scan of both files found no other case with the conflict; cases that plant a real found key keep `the error output held a credential value`. Red lines: `bun test harness/model-guide-tests/review-run.test.ts` exit 1, `85 pass` / `11 fail` (AA1 and AA2 newly fail, the nine P4b failures remain); `cd harness && npx vitest run model-guide-tests/judge-run.test.ts --configLoader native --maxWorkers=1 --reporter=dot` exit 1, `Tests 4 failed | 44 passed (48)` (JA1 and JA2 newly fail, the two N31 failures remain). No production path changed. Row stays `[~]`.
  - Green 4.15a (2026-11-20, implementation 6bcb0e5): 14 of 15 cases fixed, no test file changed. Evidence `measure/runs/model_guide/green-4.15.txt` at that HEAD: review-run 95 pass / 1 fail (N27 only). One case stayed red: N27 expected tokens_complete false with per-field sums of 5e15, exactly below 2^53, while T1 pinned that sums of exactly 2^53-1 stay complete. The per-field rule kept T1. Red r4 then fixed the N27 fixture.
  - Green 4.15b (2026-11-20, role_base_sha 4364289cf995336f3aedb1cb76168f597791a85a): Red r4 fixed the N27 fixture; Green changed no production file. All nine files pass one at a time on implementation 6bcb0e5: review-run 96 passed, judge-run 48 passed, quota 31 passed, adversarial-p4-runner 15 passed, adversarial-p4c 13 passed, decode-parity 4 passed, adjudicate 23 passed, review-score 27 passed, adversarial-p4b 12 passed. Evidence `measure/runs/model_guide/green-4.15.txt`. Row stays `[~]`; it closes after the night run per the PM round cap.
  - Green 4.15c (2026-11-20, role_base_sha e78aa08727a76908cfefb8ff0343840b96a14f8f): Review A F1 removed the exe-path filter and scoped daemon_pids on the BENCH_OPENCODE_JOB marker, keeping adjacency and the HOME and cwd checks; both runner copies stay byte-identical. Evidence `measure/runs/model_guide/green-4.15.txt`: adversarial-p4-runner 16 passed, judge-run 50 passed, review-run 96 passed, adversarial-p4b 12 passed, adversarial-p4c 13 passed; leak-check exit 0. Row stays `[~]`.
  - Green 4.15d (2026-11-20, role_base_sha c42ee3665665978bfd53d8256192396c60bdc06f): seed reason and the hy4 Go route. The helper refuses a fixed empty or foreign store with the closed-list no-entry reason after one export call; both runners carry it on the seed refusal line; routes.json holds opencode-go/hy4-flash-free#high (Hy, plan, opencode-go). Evidence `measure/runs/model_guide/green-4.15.txt`: credential-provider 24 passed, review-run 97 passed, judge-run 50 passed, quota 31 passed, adversarial-p4-runner 16 passed, adversarial-p4b 12 passed, adversarial-p4c 13 passed; leak-check exit 0. Row stays `[~]`.
  - Green 4.15e (2026-11-20, role_base_sha 51bd94b07389c9ff5a35263e825f118a9a0a5357): Review B contract fixes. error_line_of uses a bounded substring (no SIGPIPE pipe) and the symlink walk stops at the first hit; the guard block now carries its own root resolution. Evidence `measure/runs/model_guide/green-4.15.txt`: review-run 100 passed, judge-run 50 passed, adversarial-p4-runner 16 passed, adversarial-p4c 13 passed, credential-provider 24 passed, review-score 27 passed, adjudicate 23 passed; decode-parity 4 passed 1 failed (P5 judge leg only). The P5 judge leg was deliberately left red: a text-wins precedence fixes P5 but breaks committed J1, which pins result-wins on the same text-plus-result shape (proven on a scratch copy, then restored). Mid Red owns the J1/P5 reconciliation. Row stays `[~]`.
  - Green 4.15f (2026-11-20, role_base_sha 1e16812697644c9ecbcb528ca240874931dd9ca3): judge decoder parity. Red aligned J1/J2 to text-wins, so the judge drops a top-level result branch when text parts exist and keeps result-only streams decoding; one answer for all three decoders. Evidence `measure/runs/model_guide/green-4.15.txt`: decode-parity 5 passed, adversarial-p4c 13 passed, adversarial-p4b 12 passed, judge-run 50 passed, adjudicate 23 passed, review-score 27 passed; leak-check exit 0. Row stays `[~]`.
  - Red r4 (2026-11-20, role_base_sha 9d06c673ca86c044862d8fc9fadbab54d994c2b6): Only the N27 fixture changed. Both token fields are now 1e16, above 2^53; the assert that tokens_complete is false stays, and T1 of adversarial-p4c.test.ts is untouched. Red line `bun test harness/model-guide-tests/review-run.test.ts` exits 0 with `96 pass` / `0 fail`, 96 tests. N27 passes on Green's HEAD, so this retry is gap closing. No production path changed. Row stays `[~]` until the phase closeout.
  - Red r5 (2026-11-20, role_base_sha ff64dab8cb45fa087e64db3e2f90035331267a4a): Review A F1 found that the new executable-path filter in daemon_pids drops the live opencode.exe daemon, whose argv[0] is an absolute path outside every job root. Added P4B-L1 in adversarial-p4-runner.test.ts and P4B-J1 in judge-run.test.ts: a synthetic proc entry with that absolute exe path, serve and --service, and HOME and cwd inside the job root must be selected. Rewrote P4B-C1 and added P4B-J2 so the foreign entry differs by the BENCH_OPENCODE_JOB marker in /proc/<pid>/environ and its own temp root, not by the executable path; both entries use the live exe path. The judge cases pin the byte-identical judge copy, which these properties did not cover before. Red lines: adversarial-p4-runner.test.ts `Tests 2 failed | 14 passed (16)` (P4B-L1 and P4B-C1, both `expected [] to include`); judge-run.test.ts `Tests 2 failed | 48 passed (50)` (P4B-J1 and P4B-J2). No production path changed. Row stays `[~]`.
  - Red r6 (2026-11-20, role_base_sha a85ff6ec17d5ead7b9377b177f11efb9072763f0): The probe refused both Go routes with the generic seed text; the PM diagnostic found an empty auth export array. Added SR1 and SR2 in credential-provider.test.ts (empty store and an entry of another integrationID): exit 2, one named line `provider-credential: the store holds no active entry of provider <provider>`, no generic text, one export call, no value text. Added R-SR1 in review-run.test.ts: the runner's one refusal line must name `the provider credential seed failed: the store holds no active entry of provider opencode-go`. Red r6 also moved the hy4 pilot route in J1 to `opencode-go/hy4-flash-free#high` (family Hy, kind plan, quota_provider and quota_source opencode-go) and put the old route in the gone list; no other test file named it. Red lines: `bun test harness/model-guide-tests/review-run.test.ts` exit 1, `95 pass` / `2 fail` (J1, R-SR1); `cd harness && npx vitest run model-guide-tests/credential-provider.test.ts --configLoader native --maxWorkers=1 --reporter=dot` exit 1, `Tests 2 failed | 22 passed (24)` (SR1, SR2). No production path or data file changed. Row stays `[~]`.
  - Red r7 (2026-11-20, role_base_sha c0e8db545caeeea99bfe1a61eeafff8be59c99b5): Review B rejected the pass on contract gaps. Tests only. N26 gained a full runner-path case (300 KB stderr line: exit 0, one record, one bounded 1-500 byte error line) and N26b, which runs error_line_of under the runner's own `set -euo pipefail` and fails at base with the SIGPIPE abort. N10/G2 presets 20 000 symlinks under JOB/data and asserts exit 2 with the named refusal, not 141; it fails at base. N27 now uses two safe 2^53-1 fields whose sum passes 2^53; it passes at base because the sum check landed, and a scratch copy with that check neutralized made it fail. N13 P5 puts the forged result event after the valid text events for all three readers; the judge diverges at base. F7 foreign-marker fixtures in adversarial-p4-runner.test.ts and judge-run.test.ts now share HOME, cwd, and argv and differ only by BENCH_OPENCODE_JOB; they pass at base and fail in scratch copies with the marker filter neutralized. Red lines: review-run `98 pass` / `2 fail` (N26b, G2); adversarial-p4-runner `Tests 16 passed (16)`; judge-run `Tests 50 passed (50)`; decode-parity `4 pass` / `1 fail` (P5). No production path changed. Row stays `[~]`.
  - Red r8 (2026-11-20, role_base_sha 5a722ecde7dbd865b02b9e28d4102cf651d6f761): Green fixed N26b and G2 and stopped on the decoder conflict. PM decision: text-wins. The conflicting case named J1 is in adversarial-p4c.test.ts, not judge-run.test.ts. Aligned J1 and J2 in adversarial-p4c.test.ts: each now puts the real verdict in a text event and a forged verdict in a result event and expects the text verdict; J2 keeps its hostile lines. ADV-P4B AJ1 is result-only and keeps its result expectation. judge-run.test.ts has no result-event case and needed no edit. Red lines: adversarial-p4c `Tests 2 failed | 11 passed (13)` (J1, J2, both received the forged real-defect); judge-run `Tests 50 passed (50)`. No production path changed. Row stays `[~]`.
- [~] 4.16 The live-server path (spec D14 "Live-server path (PM 2026-11-20)"). Work it through Red and Green. Finish before the night of 2026-11-22 02:00. `review-run.sh` and `judge-run.sh` reach a pilot route through a bench session. The runner creates the session on the OpenChamber API (port 38307). Its directory is the job root. Its model is the model of the route. The runner confirms the tool deny first. It sends the D10 prompt. It waits for the answer with the call timeout. It reads the answer text from the session messages. It reads the tokens from the session messages. It deletes nothing. This path makes no seed and no auth call. The probe and pass records stay the same. The lines and the exit codes stay the same. Night 2 (2026-11-21) may skip.
  - Green evidence (2026-11-20, measure/runs/model_guide/green-4.16.txt, role_base_sha 73e4787911e7597e83cc47259bc4dcacf84e70cd, implementation commit 1b0646b). Both runners use `BENCH_SERVER_BASE` for one bench session per call: session create with the job root and the route model, the eight-deny config checked first, the D10 prompt in a message, and the answer and token sums from the message parts. No seed, no auth call, no DELETE, no `opencode run`, and a key-shape scan. The isolated path and the non-pilot routes stay. One file at a time: review-run 111 pass 1 fail; judge-run `Tests 51 passed (51)`; decode-parity 8 pass; quota `Tests 32 passed (32)`; credential-provider `Tests 24 passed (24)`; adversarial-p4-runner 16, p4b 12, p4c 13, p4d 21 passed 6 skipped; adjudicate 23; review-score 27. `bash -n` passes on both runners; leak-check exits 0; `git status --short docs/` prints nothing. The one failure is the first half of L9: quotaPercent 70 on the Go pilot route expects `wait`, but D15 and quota.ts give `ready` below 95 % of 5h and 100 % of weekly, and L9-G pins that rule (a loopback fake at 70/70 gives `state ready`). This is a Red conflict, not a Green gap; the default fix is quotaPercent 95 for that fixture. Row stays `[~]`.
  - Green completion (2026-11-20 r2, role_base_sha eba61cf40ff8dcea106183507bd652dbf3cf4fc0, implementation commit 1b0646b). Red fixed the L9 fixture to quotaPercent 95 in 0f12249, and `bun test harness/model-guide-tests/review-run.test.ts` now exits 0 with `112 pass` / `0 fail` (833 expect() calls). No production file changed. The full gate passes on this HEAD: judge-run `Tests 51 passed (51)`, decode-parity 8 pass, quota `Tests 32 passed (32)`, credential-provider `Tests 24 passed (24)`, adversarial-p4-runner 16, p4b 12, p4c 13, p4d 21 passed 6 skipped, adjudicate 23, review-score 27, `bash -n` on both runners, leak-check exit 0, and `git status --short docs/` empty. Row stays `[~]`; the orchestrator flips it after the phase gate.
  - Green completion (2026-11-20 r3, role_base_sha ea3b86ca05f24808ae5d7c865255d3142bcc1ef1, implementation commits 7b51c40 and 0f560b2). The two runners now use the native API shapes: session create with `location.directory` and the nested model, a location check, a wait for completion within the call deadline, top-level native tokens, a failed GET as a failure, native `message.error` classification, a parsed loopback base with no userinfo, and the config refusals. Evidence `measure/runs/model_guide/green-4.16.txt`: review-run `122 pass` / `0 fail`; judge-run `Tests 54 passed (54)`; decode-parity 8 pass; quota `Tests 32 passed (32)`; credential-provider `Tests 24 passed (24)`; adversarial-p4-runner 16, p4b 12, p4c 13, p4d 21 passed 6 skipped; adjudicate 23; review-score 27; `bash -n` on both runners; leak-check exit 0; `git status --short docs/` empty. An unset `BENCH_SERVER_BASE` keeps the isolated path, and an explicitly empty value takes the default `http://127.0.0.1:38307`; this is what F15 pins, and it keeps the isolated suites off the live API. The scheduled callers must set the variable for a pilot run. The judge file is written only with at least one verdict. Row stays `[~]`; the orchestrator flips it after the phase gate.
  - Green completion (2026-11-20 r4, role_base_sha 363743259c6c8acf3dbc7b021db4e14b322078af, implementation commit 2a7800c). One deadline per live call from call entry, with each request using the time left and no separate empty window; an unset `BENCH_SERVER_BASE` on a pilot route refuses with one named line and exit 2 before any seed call, while an explicitly empty value keeps the default `http://127.0.0.1:38307`; the newest-first message page selects the newest terminal assistant answer and its tokens; the review pass stores the plain answer text. Evidence `measure/runs/model_guide/green-4.16.txt`: judge-run `Tests 59 passed (59)`; decode-parity 8 pass; quota `Tests 32 passed (32)`; credential-provider `Tests 24 passed (24)`; adjudicate 23; review-score 27; review-run 49 pass / 79 fail. All six review r4 cases and all five judge r4 cases pass. The failures are Red conflicts in stale fixtures, not Green gaps: the F15 refusal makes the isolated-path fixtures that name a pilot route fail with `review-run: a pilot route needs BENCH_SERVER_BASE` (review-run R1 to R14 and the other isolated blocks; adversarial-p4-runner 6, p4b 2, p4c 5, p4d 6); the one-deadline rule makes the live fixtures with an empty page wait the full 600 s and hit the 20 s spawn timeout (L1, L3 x2, L6 transient, L7, L9, L10); and L10 (empty probe reachable) contradicts r4 F13 (empty probe unreachable). Row stays `[~]`.
  - Green completion (2026-11-20 r5, role_base_sha 220be28bddb7e5af1ec15f7ab4f2dbfa2c02b06a, implementation commit 2a7800c). Red closed the three r4 conflicts in e7bdf7e, fd69500, 764ffb5, and 9f01204; no production file changed. Each file ran once, one at a time, all exit 0: review-run `128 pass` / `0 fail` (913 expect() calls); judge-run `Tests 59 passed (59)`; decode-parity 8 pass; quota `Tests 32 passed (32)`; credential-provider `Tests 24 passed (24)`; adversarial-p4-runner 16; adversarial-p4b 12; adversarial-p4c 13; adversarial-p4d 21 passed 6 skipped; adjudicate 23; review-score 27. `bash -n` on both runners passes. Row stays `[~]`; the orchestrator flips it after the phase gate.
  - Green completion (2026-11-20 r6, role_base_sha b9a0fbc7477a705e8b438fae9155b39a05ab3cb7, implementation commit c202290). Red added the r6 cases in d601806. The live wait checks expiry before each request and before it accepts a completion, with no one-second clamp; the newest assistant message governs the answer, so a newest partial blocks every older terminal message and older tool-calls step; the isolated path stores the raw output whole again, and only the live path decodes the plain answer. Each file ran once, one at a time, all exit 0: review-run `130 pass` / `0 fail` (922 expect() calls); judge-run `Tests 61 passed (61)`; decode-parity 8; quota 32; credential-provider 24; adversarial-p4-runner 16; p4b 12; p4c 13; p4d 21 passed 6 skipped; adjudicate 23; review-score 27. `bash -n` on both runners passes. Row stays `[~]`; the orchestrator flips it after the phase gate.
  - Red evidence (2026-11-20, measure/runs/model_guide/red-4.16.txt): phase_base_sha and role_base_sha 7d7d218d00a95d9d619d2856173b8136b6ace4a5 and ce3e7c0d0d38e7ff1c6231416295ef80c6775905. Four targeted lines, one file at a time. Line 1 `bun test harness/model-guide-tests/review-run.test.ts` exit 1, `100 pass` / `12 fail` (L1, L2, L3 x2, L4, L5, L6 x2, L7, L8, L9, L10; all fail because no session create reaches the fake server). Line 2 `cd harness && npx vitest run model-guide-tests/judge-run.test.ts --configLoader native --maxWorkers=1 --reporter=dot` exit 1, `Tests 1 failed | 50 passed (51)` (L11). Line 3 `bun test harness/model-guide-tests/decode-parity.test.ts` exit 1, `3 fail` / `5 pass` (new L4 cases; the decoders do not read message parts). Line 4 `cd harness && npx vitest run model-guide-tests/quota.test.ts --configLoader native --maxWorkers=1 --reporter=dot` exit 0, `Tests 32 passed (32)`; the new L9-G case is a declared guard, because the quota rules are unchanged. Its breakage proof is the Go 5h boundary of Q9. Each runner case starts a node:http server on port 0 through BENCH_SERVER_BASE and stops it in afterEach and finally. No case names port 38307. Eight old seed cases moved to a synthetic non-pilot route; J15 now loops over the two non-Go judge routes; credential-provider and adversarial-p4d are untouched. R12 and R14 gained a 60 s case timeout under bun; no assertion changed. No production path or frozen path changed. Row stays `[~]` until Green flips it.
  - Red r2 evidence (2026-11-20, gap closing, measure/runs/model_guide/red-4.16-r2.log): role_base_sha da0d807748de3e67d28ac3a51693b1698d7e8f5f, after Green 1b0646b and da0d807. Green's log named one Red conflict: the wait half of L9 used the non-Go 70 % boundary. D15 and quota.ts give a Go route wait at 5h 95 % or weekly 100 %, which L9-G pins. Only that fixture moved to quotaPercent 95; the ready half stays at 10 % and no other case changed. Red line `bun test harness/model-guide-tests/review-run.test.ts` exit 0, `112 pass` / `0 fail`. The corrected case passes, so the round is gap closing rather than false Red. Two neutralized-code runs prove the case fails when the covered quota gate is broken: forcing QUOTA_STATE=ready makes the 95 % half create a live session, and forcing QUOTA_STATE=wait makes the 10 % half create none. The runner file was restored after both runs. Row stays `[~]`; it closes after the acceptance run.
  - Red r3 evidence (2026-11-20, measure/runs/model_guide/red-4.16-31fe9a0.log): role_base_sha 31fe9a01678d37cf27ccb3465ba895ddb6f62d91, after Review A 31fe9a0 findings F12 to F19. The fake HTTP server now uses the real API shapes: session create sends `location.directory` and a nested model, and the message GET returns a native assistant record with `content[]`, top-level `tokens`, `time.completed`, `finish`, and `error`. L1 and L11 assert the real create shape. L4 and judge L11 assert native tokens. New cases pin the returned location check (F12), completion and partial answers (F13), the default loopback base on a pilot route (F15), failed message GETs (F16), native region errors (F17), the userinfo URL refusal (F18), and missing config, L5 text, and probe DELETE (F19). Targeted lines: review-run exit 1, `113 pass` / `9 fail`; judge-run exit 1, `Tests 4 failed | 50 passed (54)`; decode-parity exit 1, `Tests 1 failed | 7 passed (8)`. Three new cases pass at the base and are declared guards with falsifications. No production path changed. Row stays `[~]`; it closes after the acceptance run.
  - Red r4 evidence (2026-11-20, measure/runs/model_guide/red-4.16-5f01ef9.log): role_base_sha 5f01ef93c68f7afe6b2889ea36aafb12a85ef1e5, after Review A r2 findings F13, F15, and F20. New cases pin one deadline from call entry with an answer at 11 s inside a 30 s budget, a late completion, and an empty probe answer (F13); a fail-closed unset base with exit 2, one named line, and no seed call (F15); and a newest-first native page that selects the newest terminal answer and its tokens, plus an older partial behind a newer final (F20). Targeted lines: review-run exit 1, `123 pass` / `5 fail`; judge-run exit 1, `Tests 5 failed | 54 passed (59)`. The review-run late-completion case passes at the base and is a declared guard with a falsification. A probe of adversarial-p4d with a non-pilot route broke its two seed-reason cases, so the pilot route was restored and the file left unchanged. No production path changed. Row stays `[~]`; it closes after the acceptance run.
  - Red r5 evidence (2026-11-20, gap closing, measure/runs/model_guide/red-4.16-r5.log): role_base_sha 0f6240796719f11afb15f468dd06732d6e5b3da2, after Green 2a7800c and 0f62407. The isolated fixtures of review-run, adversarial-p4-runner, p4b, p4c, and p4d now name the synthetic non-pilot Go route opencode-go/isolated-nonpilot#high in their temp routes.json. Live fixtures get one native completed answer by default, so the one-deadline rule no longer hits the spawn timeout. R10 checks that a 2 MiB read writes no oversized raw file. L10 keeps a reachable probe with a default answer, while the r4 F13 empty-page case stays unreachable. All six targeted lines exit 0: review-run 128 pass; adversarial-p4-runner 16, p4b 12, p4c 13, p4d 21 passed 6 skipped; judge-run 59 passed with no test change. Three scratch neutralizations proved the changes break the affected cases and were restored byte-identically. No production path changed. Row stays `[~]`; it closes after the acceptance run.
  - Red r6 evidence (2026-11-20, measure/runs/model_guide/red-4.16-a87c29c.log): role_base_sha a87c29c5ded286f9e315020ca09ed14636548d77, after Review A r3 findings F13, F20, and F21. The fake servers now record request timestamps. New cases pin expiry at the first GET after the deadline (F13) and a newest partial that blocks an older completed answer (F20), in both runners. R10 is restored to the r4 contract of test-strategy.md:695: on the non-pilot isolated path the stored 2 MiB output keeps its tail and its whole size. Targeted lines: review-run exit 1, `127 pass` / `3 fail`; judge-run exit 1, `Tests 2 failed | 59 passed (61)`. All five failed names are the new or restored cases; no unrelated case fails. No production path changed. Row stays `[~]`; it closes after the acceptance run.
  - Judge path (PM 2026-11-20): only the pilot routes and the live Go judge route use the live-server path; the Kimi K3.1 Pro and Sonnet judges stay on their path.
  - Red r7 evidence (2026-11-20, measure/runs/model_guide/red-4.16-90edb7b.log): role_base_sha 90edb7b7a136c8862ef4cc3f573efb32b3b21425. The three skipped adversarial cases are enabled with their asserts unchanged. P4E-1 rejects an answer with a foreign sessionID, P4E-2 rejects an answer whose native time.created predates the prompt, and P4E-3 refuses to treat finish=tool-calls as a final answer. Each case runs for both runners. Row stays `[~]`; it closes after the acceptance run.
  - Red r8 evidence (2026-11-21, measure/runs/model_guide/red-4.16-dabc9c3.log): role_base_sha dabc9c3571a8b7e990d6ab3566f6c4e711f811b6. Ruling: orchestrator 2026-11-21, option 1. The live-server message helpers default created to the fixture time and completed to created + 1; an explicit created stays as given, so P4E-2 stays old. The fake stamps the default at message-read time, which is at or after the call start. F20 ordering fixtures keep their order with a read-stamp offset. With Green's working-tree runners all three files pass: review-run 130 pass, judge-run 61, adversarial-p4e 54. At the committed runners in a throwaway copy, review-run 130 and judge-run 61 pass, and adversarial-p4e has only the six intended P4E failures. The copy was deleted. No assert was weakened. Row stays `[~]`; it closes after the acceptance run.
   - Green completion (2026-11-21 r8, role_base_sha 672e85afbb21559bd5844d3b56deee52b2f0438c, implementation commit a1a5312). Both runners reject a message whose native session owner is a foreign session, and skip a message whose native time.created predates the call start. A message with no owner passes the owner check. finish=tool-calls is not terminal, even with time.completed set. Evidence (one file at a time, measure/runs/model_guide/green-4.16-dabc9c3.log): review-run `130 pass` / `0 fail`; judge-run `Tests 61 passed (61)`; adversarial-p4e `54 pass` / `0 fail`; decode-parity `8 pass` / `0 fail`; leak-check `22 pass` / `0 fail`; `bash -n` on both runners; `git status --short docs/` empty. The shared live_* functions are byte-identical between the runners, except live_model_call, which already differed at the Red base by design. Row stays `[~]`; it closes after the acceptance run.
  - Green completion (2026-11-21 r9, role_base_sha 364a39c959735d8ab3f047abe5b4a30ec36b6c81, implementation commit a05a0f4). Both runners sum the tokens of every current-call assistant step, once per message id. A current-call step with no token bundle sets tokens_complete to false. The answer selection and the P4E-1 to P4E-3 rules stay the same. The shared live_synthesize block is identical in both runners. Evidence (measure/runs/model_guide/green-4.16-364a39c.log, provisional): review-run `130 pass` / `0 fail` on attempt 2; attempt 1 failed one timing case (F19 L5, send timeout, 729 ms) and attempt 2 passed with no code change; judge-run `Tests 61 passed (61)`; adversarial-p4f `48 passed` / `14 skipped` / `0 fail`; adversarial-p4e `54 pass` / `0 fail`; decode-parity `8 pass` / `0 fail`; `bash -n` on both runners. The skipped cases A-F1, P4F-2, and P4F-3 go to backlog row 4.15. Row stays `[~]`; it closes after the acceptance run.
Verify (Phase 4b): the track A first results are in the preview folder by Sun 2026-11-22.

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
  `harness/model-guide/update.sh <path of MANIFEST-<date>.txt>`.
  - Verify: `docs/assets/data/real-work.json` and
    `docs/assets/data/model-guide.json` show the new read date and the three
    file SHA-256 values, and the commit holds only those two paths.

Verify (Phase 5): the site shows page B, the review page, and the overview
table, and each table shows its evidence date.

## Backlog note

The replay track (real past tasks with hidden tests) is in the "Backlog"
section of `measure/tracks.md` with no date. This plan has no task for it.
