# Implementation plan — weekly_update_fix

PM 2026-11-22: fix the weekly update before the next weekly export.

This plan fixes the four defects in Phase 1, then runs the first weekly update and
holds the deferred pilot gate in Phase 2. Spec: `spec.md`. Base commit: `0b75b9c`.
Due: Mon 2026-11-23.

Constraints for every role:

- Mark the one open task `[~]` before work starts. `[x]` needs a commit SHA on the
  first line of the task.
- Each Red task writes test files only and fails first at the base. Each Green task
  writes production files only and touches no test file.
- Run one test file at a time with `--maxWorkers=1`:
  `cd harness && npx vitest run model-guide-tests/<file> --configLoader native --maxWorkers=1 --reporter=dot`.
- No full suite outside 22:00-07:00. No heavy gates 02:00-06:00. No model call and no
  real quota endpoint in tests; use fakes and synthetic data in a temp folder.
- Stage files by explicit path: `git commit -m ... -- <paths>`. Never stage
  `.opencode/`, `harness/wt.txt`, `measure/runs/`, `.tmp/`, or `docs/` in this track.
  On an `index.lock` error, run the commit once more.
- No publish without the PM word. Safe-push only through the orchestrator.
- The evidence folder is `measure/runs/weekly_update_fix/` (not staged).

File map (every new file of this track):

| File | Role |
|---|---|
| `harness/model-guide-tests/update-approval.test.ts` | approval path and refusal (task 1.1) |
| `harness/model-guide-tests/update-pages.test.ts` | page refresh (task 1.2) |
| `harness/model-guide-tests/update-leak.test.ts` | leak check (task 1.3) |
| `harness/model-guide-tests/update-exec.test.ts` | executable bit and README wording (task 1.4) |
| `harness/model-guide/publish-approval.md` | stable approval record (task 1.1 Green) |

## Phase 1: Red and Green for items 1 to 4

Spec FR-1 to FR-5, EV1 to EV4.

- [ ] 1.1 Red and Green. The approval path and the named refusal (spec FR-1, FR-2).
  - Red: write `harness/model-guide-tests/update-approval.test.ts` and no other file.
    Pin that `update.sh` and `publish.ts` read `harness/model-guide/publish-approval.md`,
    that the old `measure/tracks/model_guide/` path appears in neither tool, and that
    `update.sh --docs` with no stable record prints `update: no approval record` on
    stdout, exits 2, and writes no file and makes no commit. Record the failed test
    names in `measure/runs/weekly_update_fix/red-1.1.txt`.
  - Green: write `harness/model-guide/publish-approval.md` as a copy of the archived
    record with the same six rows, and point both tools (with their header comments)
    at the stable path. Touch no test file.
  - Verify: `cd harness && npx vitest run model-guide-tests/update-approval.test.ts --configLoader native --maxWorkers=1 --reporter=dot`
    exits 0, and `rg -n "measure/tracks/model_guide/publish-approval" harness/model-guide/`
    prints no line.
- [ ] 1.2 Red and Green. The HTML refresh (spec FR-3, Review A 5 F2).
  - Red: write `harness/model-guide-tests/update-pages.test.ts` and no other file.
    Pin that after the approval `update.sh` rebuilds `index.html` and `real-work.html`
    through `preview.sh` and `guide.ts`, that the commit holds the two data files plus
    those pages by explicit path, that `docs/review.html` rebuilds only when the score
    file changed, and that a rerun with unchanged data exits 0 with no
    commit. Record the failed test names in `measure/runs/weekly_update_fix/red-1.2.txt`.
  - Green: rebuild the affected pages in `update.sh` and commit them with the data
    files. Touch no test file.
  - Verify: `cd harness && npx vitest run model-guide-tests/update-pages.test.ts --configLoader native --maxWorkers=1 --reporter=dot`
    exits 0, and `git status --short docs/` prints nothing.
- [ ] 1.3 Red and Green. The leak check (spec FR-4, Review B 5 F1).
  - Red: write `harness/model-guide-tests/update-leak.test.ts` and no other file.
    Pin that `update.sh` runs `leak-check.ts` over the files it is about to commit and
    that a leak hit refuses with one line, exit 2, and no commit. Record the failed
    test names in `measure/runs/weekly_update_fix/red-1.3.txt`.
  - Green: run `leak-check.ts` in `update.sh` after the copy and before `git add`.
    Touch no test file.
  - Verify: `cd harness && npx vitest run model-guide-tests/update-leak.test.ts --configLoader native --maxWorkers=1 --reporter=dot`
    exits 0, and `git status --short docs/` prints nothing.
- [ ] 1.4 Red and Green. The executable bit and the README wording (spec FR-5,
  Review C 5 F1, Review A 5 F3).
  - Red: write `harness/model-guide-tests/update-exec.test.ts` and no other file.
    Pin that `harness/model-guide/update.sh` carries the execute bit, that the README
    weekly-update section states the preview-only branch and the docs branch separately,
    and that the README commit claim names the two data files plus the rebuilt pages.
    Record the failed test names in `measure/runs/weekly_update_fix/red-1.4.txt`.
  - Green: run `git update-index --chmod=+x -- harness/model-guide/update.sh` and fix
    the README wording, including the commit-path claim. Touch no test file. The README change is the Review A 5 F3
    wording fix owned by this item, not a docs content change.
  - Verify: `cd harness && npx vitest run model-guide-tests/update-exec.test.ts --configLoader native --maxWorkers=1 --reporter=dot`
    exits 0, `git ls-files -s harness/model-guide/update.sh` shows `100755`,
    and `rg -n "only those two paths" README.md` prints no line.

Verify (Phase 1): spec FR-1 to FR-5 hold, each with its targeted test file green.

## Phase 2: The first weekly update and the deferred pilot gate

Moved rows 4.11 and 5.4 of `measure/archive/model_guide/plan.md` (PM 2026-11-22).

- [b] 2.1 The first weekly update (row 5.4). When the PM sends the next export, run
  `harness/model-guide/update.sh --docs <path of MANIFEST-<date>.txt>`.
  - PM 2026-11-22: the track does not wait for a recurring task. The weekly update job runs `harness/model-guide/update.sh --docs <path of MANIFEST-<date>.txt>` when the PM sends an export; README.md section 'Model guide weekly update' records the job.
  - Row 5.4 is the closing task of this track: the first weekly update run with the
    fixed `update.sh` when the PM sends the export.
  - Verify: `docs/assets/data/real-work.json` and `docs/assets/data/model-guide.json`
    show the new read date, the rebuilt pages show the new data, `leak-check.ts` exits 0,
    and the commit holds only the data files plus those pages by explicit path. The
    command is `cd harness && npx tsx model-guide/leak-check.ts --private <private> --repo .. --preview ../.tmp/model-guide-preview`,
    then the `update.sh` run.
- [b] 2.2 Deferred: the pilot gate (row 4.11). It needs the PM word for new nights
  before it runs. Copied text from `measure/archive/model_guide/plan.md`:
  - [b] 4.11 deferred (PM 2026-11-22) The pilot gate (spec D13, OD7). The pilot set `mg-2026-11p` runs (deferred:PM)
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
    - Deferred (PM 2026-11-22): the pilot set mg-2026-11p never got its 2 passes per route (nights 1 and 2 gave no pass: probe refusals, then the BENCH_SERVER_BASE refusal). The PM ruled no extra nights; one pass per route on mg-2026-11a is enough to see if a route is far off, and each route shows incomplete: 1 of 3 passes. The D13 spread check and the D4 change did not run; they wait for the next set.

Verify (Phase 2): the first weekly update ran with the fixed `update.sh`, and row 4.11
stays deferred until the PM gives the word for new nights.
