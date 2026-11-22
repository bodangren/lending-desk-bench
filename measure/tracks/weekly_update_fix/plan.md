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

- [x] 00d9013c8f7ae1b9b29db9dfd5053bb1a62db432 1.1 Red and Green. The approval path and the named refusal (spec FR-1, FR-2).
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
  - Green (2026-11-22, commit 53510bb): `update-approval.test.ts` exit 0, Tests 5 passed. The path `rg` prints no line. The stable record is byte-identical to the archived record and parses under the publish.ts fields.
  - Green r4 (2026-11-22, commit c4d70a1): `update-approval.test.ts` exit 0, Tests 5 passed, A5 included. The stable record keeps the archived `approved_by`, `date` and six `files:` rows and carries the PM weekly rule plus provenance above `files:`. A read-only check confirms the publish.ts fields still parse.
  - Green r6 (2026-11-23, commit 00d9013): `update-approval.test.ts` exit 0, Tests 6 passed with F1. A flagless run with the record present stays preview-only.
  - Red (2026-11-22): wrote `update-approval.test.ts` (A1-A5). The red command
    exits non-zero: A1, A2, A3, A5 fail and A4 passes. Both tools still name
    the old track path, `--docs` is unrecognized, and the stable record is
    missing. Also refreshed `update.test.ts` to the new contract: `APPROVAL`
    and `approve()` now point at `harness/model-guide/publish-approval.md`,
    since the old path contradicts FR-1. U1, U3, UP1 stay unchanged, and the
    refreshed U2 fails while the rest passes. Red r2 (2026-11-22): moved
    the publish fixtures of preview-gate.test.ts and adversarial-p5.test.ts
    to write the stable path as well as the old path, so both files pass at
    HEAD and the breakage run with the stable-reading tool fails without
    the stable write, as Green's proof showed. Red r3 (2026-11-22): moved
    the publish fixtures of adversarial.test.ts to the stable path as well,
    so all 46 cases pass at HEAD and the neutralized run fails with the
    shadowing sha256 refusal. Red r4 (2026-11-22): excluded the real
    approval record from every tool-folder fixture copy, so no-record cases
    still see no record once Green adds the real record; consent cases keep
    writing their own fixture record. Red r5 (2026-11-22): changed A5 to
    the PM weekly refresh contract, so the stable record keeps the archived
    consent lines and rows and carries the rule text with its provenance;
    A5 fails for the missing rule text while A1-A4 pass. Red r6
    (2026-11-22): added F1 to pin the flag-selected branch in both record
    states and switched U2 to `--docs`; F1 fails because a flagless
    approved run still writes docs, while A1-A4 and U2 pass.
- [x] 60e24f163ec4bcd393c6415d0424a0d978dc6fee 1.2 Red and Green. The HTML refresh (spec FR-3, Review A 5 F2).
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
  - Green (2026-11-22, commit 53510bb): `update-pages.test.ts` exit 0, Tests 6 passed. `git status --short docs/` prints nothing.
  - Green r6 (2026-11-23, commit 00d9013): `update-pages.test.ts` exit 0, Tests 11 passed with F2a, F2b, F7, F9a and F9b. The commit holds exactly the files whose bytes changed. A changed score rebuilds review.html and review.json; an unchanged score leaves both alone. A missing overview template refuses before any write. A commit prints one `update: committed <path>` line per path; a no-op prints `update: no change`.
  - Green r7 (2026-11-23, commit 60e24f1): `update-pages.test.ts` exit 0, Tests 12 passed with F15. A missing review template with a changed score refuses before any write or commit. The guard sits beside the overview-template guard and shares the early score-decision result.
  - Red (2026-11-22): wrote `update-pages.test.ts` (P1, P2a, P2b, P3, P4, P5).
    The red command exits non-zero: all six fail because `update.sh` rejects
    `--docs` with the usage error. Also refreshed `update.test.ts` U2 to the
    new contract: the commit set is the two data files plus `index.html` and
    `real-work.html`, and the unrelated dirty file is `methodology.html`,
    since Green rebuilds `index.html`. The old two-path set and the dirty
    `index.html` contradict FR-3. Red r3 (2026-11-22): moved the approve
    fixture of adversarial-p2.test.ts to the stable path as well, and
    P2ADV-3 now passes `--docs` for its docs write. P2ADV-3 fails at HEAD
    until Green wires `--docs`, while every other case of the file passes.
    Red r6 (2026-11-22): added F2a and F2b for the score-change rebuild
    rule with exact commit sets and the rendered score, F7 for the
    missing-overview refusal that also pins the F5 renderer half, and F9a
    and F9b for the commit log lines; all five fail for the missing
    behavior while P1-P5 pass. Red r7 (2026-11-22): corrected F2a to
    assert the second commit as the byte-measured changed files including
    the rebuilt review outputs, and F2b to commit the score input in
    setup; both still fail for the stale review rendering. Red r8
    (2026-11-23): added F15 beside F7 for the missing review template
    with a changed score, which refuses before any write or commit; F15
    fails with a stale commit while every other case passes.
- [x] 00d9013c8f7ae1b9b29db9dfd5053bb1a62db432 1.3 Red and Green. The leak check (spec FR-4, Review B 5 F1).
  - Red: write `harness/model-guide-tests/update-leak.test.ts` and no other file.
    Pin that `update.sh` runs `leak-check.ts` over the files it is about to commit and
    that a leak hit refuses with one line, exit 2, and no commit. Record the failed
    test names in `measure/runs/weekly_update_fix/red-1.3.txt`.
  - Green: run `leak-check.ts` in `update.sh` after the copy and before `git add`.
    Touch no test file.
  - Verify: `cd harness && npx vitest run model-guide-tests/update-leak.test.ts --configLoader native --maxWorkers=1 --reporter=dot`
    exits 0, and `git status --short docs/` prints nothing.
  - Green (2026-11-22, commit 53510bb): `update-leak.test.ts` exit 0, Tests 4 passed. `git status --short docs/` prints nothing.
  - Green r6 (2026-11-23, commit 00d9013): `update-leak.test.ts` exit 0, Tests 6 passed with L1, L2, L4, F4a and F4b. The scan covers exactly the candidate files in a throwaway repo and uses `MODEL_GUIDE_PRIVATE_DIR` with the real default. A missing private input on `--docs` prints `update: no private input`. A refusal leaves docs/ byte-identical. An unrelated staged file does not refuse.
  - Green r9 (2026-11-23, commit dbed5ee): `adversarial-wuf.test.ts` exit 0, 17 passed, including the F1 empty, file and missing private-input cases and the default seeded-input scan. The guard on `--docs` now requires `<private>/sets/<set>/diffs/*.diff` to hold a seeded line of at least 20 characters absent from its `src` diff, and prints `update: no private input` before any write or commit. Red r9 gave every docs fixture a synthetic private input of that shape.
  - Red (2026-11-22): wrote `update-leak.test.ts` (L1-L4). The red command
    exits non-zero: all four fail. L1, L2, and L4 see no `update: leak`
    refusal, and L3 sees no commit, because `update.sh` has no `--docs`
    flag and no leak-check wiring. The plants use key fields only, so no
    private folder is needed. Red r6 (2026-11-22): rewrote L1, L2, and L4
    because the scan now covers exactly the candidate files, so hits moved
    into the committed review.json through the score chain and the
    unrelated staged hit must pass; added F4a and F4b for the env private
    input and its missing-input refusal; L1, L2, L4, F4a, and F4b fail for
    the missing wiring while L3 passes, and L1 also pins docs/
    byte-identical for the F5 leak half. Red r9 (2026-11-23): gave every
    --docs fixture a synthetic seeded private input of the leak-check
    shape instead of an empty folder, fixed the F1 empty case to compare
    the commit set against the pre-run HEAD snapshot, and added a
    default-input scan case; the new F1 empty case fails for the missing
    seeded-input guard while every other case passes.
- [x] c4d70a19f655817b6cf8aecf25a6f304b4a8f262 1.4 Red and Green. The executable bit and the README wording (spec FR-5,
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
  - Green (2026-11-22, commit 53510bb): `update-exec.test.ts` exit 0, Tests 5 passed. `git ls-files -s harness/model-guide/update.sh` shows `100755`. `rg -n "only those two paths" README.md` prints no line.
  - Green r4 (2026-11-22, commit c4d70a1): `update-exec.test.ts` exit 0, Tests 6 passed with E6. The README weekly-update section holds the PM weekly refresh rule and the page-look sentence.
  - Red (2026-11-22): wrote `update-exec.test.ts` (E1-E5). The red command
    exits non-zero: E1, E2, E3, E4 fail and E5 passes. The index mode is
    `100644`, the direct exec fails, and the README still claims only those
    two paths with no `--docs` branch. The README command already has no
    `bash` prefix. Red r5 (2026-11-22): added E6 to pin the PM weekly
    refresh rule in the README section; E6 fails for the missing rule text
    while E1-E5 pass.

Verify (Phase 1): spec FR-1 to FR-5 hold, each with its targeted test file green.

Green evidence (2026-11-22, implementation commit 53510bb184ef9575ebf833509560021d0820d61a): every file below exited 0 with `--maxWorkers=1 --reporter=dot`. `update-approval` 5 passed, `update-pages` 6 passed, `update-leak` 4 passed, `update-exec` 5 passed, `update` 9 passed, `preview-gate` 122 passed, `adversarial-p5` 5 passed, `adversarial` 46 passed, `adversarial-p2` 13 passed, `adversarial-p4-runner` 16 passed, `adversarial-p4` 24 passed, `adversarial-p4g` 4 passed, `guide` 18 passed, `real-work` 16 passed. `bash -n` on `update.sh` and `preview.sh` exited 0. The `preview-gate` case P2B2-2 preview is a pre-existing mtime-tie flake: it failed in 3 runs and passed in 2 runs on this tree, and it also failed in 1 of 3 runs at the untouched role base 8fdbcf1. The final `preview-gate` run exited 0.

Green r4 evidence (2026-11-22, commit c4d70a19f655817b6cf8aecf25a6f304b4a8f262): the nine files of the r5 Green line each exited 0 with `--maxWorkers=1 --reporter=dot`. `update-approval` 5 passed, `update-exec` 6 passed, `update` 9 passed, `update-pages` 6 passed, `update-leak` 4 passed, `preview-gate` 122 passed, `adversarial-p5` 5 passed, `adversarial` 46 passed, `adversarial-p2` 13 passed. `bash -n` on `update.sh` and `preview.sh` exited 0. No `docs/` change and no push.

Green r6 evidence (2026-11-23, implementation commit 00d9013c8f7ae1b9b29db9dfd5053bb1a62db432): the nine files of the review-fix Green line each exited 0 with `--maxWorkers=1 --reporter=dot`. `update-approval` 6 passed, `update-pages` 11 passed, `update-leak` 6 passed, `update-exec` 6 passed, `update` 9 passed, `preview-gate` 122 passed on its first run, `adversarial-p5` 5 passed, `adversarial` 46 passed, `adversarial-p2` 13 passed. `bash -n` on `update.sh` and `preview.sh` exited 0. The index still shows mode `100755`. No `docs/` change and no push. `preview.sh` changed only to read passes held inside a route when the score file has no top-level `passes` array; F2a's incomplete score fixture needs that path.

Green r7 evidence (2026-11-23, implementation commit 60e24f163ec4bcd393c6415d0424a0d978dc6fee): the nine files of the Green line each exited 0 with `--maxWorkers=1 --reporter=dot`. `update-pages` 12 passed, `update-approval` 6 passed, `update-leak` 6 passed, `update-exec` 6 passed, `update` 9 passed, `preview-gate` 122 passed on its first run, `adversarial-p5` 5 passed, `adversarial` 46 passed, `adversarial-p2` 13 passed. `bash -n` on `update.sh` and `preview.sh` exited 0. The index still shows mode `100755`. `preview.sh` did not change in this round. No `docs/` change and no push.

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
