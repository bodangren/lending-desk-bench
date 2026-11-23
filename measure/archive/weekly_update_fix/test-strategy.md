# Test strategy — weekly_update_fix

This strategy tells Red, Green, the reviewers, the adversarial role, and the UX
role how the four fixes and the first weekly update are proved. Spec: `spec.md`.
Plan: `plan.md`. Track base: `0b75b9c`. Due Mon 2026-11-23.

No test reads the real private folder, the real export, the network, a model,
the real `docs/`, or the real quota endpoint. Phase 2 is the only step that
reads the PM export. It runs only after the PM sends that export.

## 1. Scope and risk

| Phase | Risk | Reason |
|---|---|---|
| 1 — Red and Green for items 1 to 4 | high | The changed script stages a public commit. It gates that commit on an approval record and a leak check. A false green ships stale data or a private field. |
| 2 — first weekly update and deferred pilot gate | critical | The first `--docs` run writes the live public pages and makes a real commit. A wrong run publishes a false claim. Row 4.11 stays deferred. |

Both phases use temp repos for proof. Only Phase 2 writes the real `docs/`.

## 2. Gate commands

Use this run template. Run one file at a time.

```bash
cd harness && npx vitest run model-guide-tests/<file> --configLoader native --maxWorkers=1 --reporter=dot
```

- `RED_TEST_COMMAND` (Phase 1): the four lines of section 3.2. Each line exits
  non-zero at the base commit.
- `GREEN_TEST_COMMAND` (Phase 1): the same four lines. Each line exits 0 at its
  task HEAD.
- `PROJECT_TESTS`: the four lines above plus the two regression files
  `model-guide-tests/update.test.ts` and `model-guide-tests/leak-check.test.ts`.
  Run one file at a time. Section 5 is a precondition. This is a scoped list,
  not the full suite.
- `PROJECT_LINT`: `bash -n` over every shell file of the tool folder.

```bash
for f in harness/model-guide/*.sh; do bash -n "$f" || exit 1; done
```

Parse the labeled vitest summary (`Tests  N passed`, `N failed`) and the JSON
report. Never grep a bare digit (A3).

## 3. Phase 1 — Red and Green for items 1 to 4

### 3.1 Fixtures, mocks, and live proof

- Build a temp repo with `mkdtempSync` under `tmpdir()`. Copy
  `harness/model-guide/` into `<root>/harness/model-guide/`. Link the real
  `node_modules`. Write a `.gitignore`. Run `git init` and one initial commit.
  Track each temp root in `roots` and remove all roots in `afterAll`.
- Export mock: copy `fixtures/page-b/` into `<root>/fixture-b/` for
  `MANIFEST-<date>.txt` and its three dated data files. Use `fixtures/guide/`
  for benchmark and tracks. Use `fixtures/print-audit/` for print-audit data.
- Approval mock: write `harness/model-guide/publish-approval.md` as a copy of
  the archived record with the same six rows. The tools read the stable path
  only.
- Score mock: write one synthetic file under
  `harness/model-guide/data/review-scores/` for the changed-score case. Omit it
  for the unchanged-score case.
- Private mock for the leak case: write `sets/<set_id>/diffs/` and `src/` with
  a synthetic seeded line of 20 characters or more. Never pass a real private
  path.
- Shell env: set `NO_COLOR=1`, `npm_config_loglevel=silent`, and a fake `HOME`.
  Delete `BENCH_TRACK` (A11).
- Live proof: spawn the real `update.sh`, `publish.ts`, `leak-check.ts`,
  `preview.sh`, or `guide.ts` in the temp repo. Read exit status, stdout, the
  git commit, and the file bytes. A source-text check alone closes no case.

### 3.2 Targeted Red command

Four lines. Run one line at a time. Record the failed test names in
`measure/runs/weekly_update_fix/red-1.1.txt`, `red-1.2.txt`, `red-1.3.txt`, and
`red-1.4.txt`.

```bash
cd harness && npx vitest run model-guide-tests/update-approval.test.ts --configLoader native --maxWorkers=1 --reporter=dot
cd harness && npx vitest run model-guide-tests/update-pages.test.ts --configLoader native --maxWorkers=1 --reporter=dot
cd harness && npx vitest run model-guide-tests/update-leak.test.ts --configLoader native --maxWorkers=1 --reporter=dot
cd harness && npx vitest run model-guide-tests/update-exec.test.ts --configLoader native --maxWorkers=1 --reporter=dot
```

Task 1.1 owns line 1. Task 1.2 owns line 2. Task 1.3 owns line 3. Task 1.4
owns line 4. Section 5 widens tasks 1.1 and 1.2 before Red starts.

### 3.3 Test cases and falsification conditions

**`update-approval.test.ts` (task 1.1, FR-1, FR-2).**

| Case | Pins | Falsification condition |
|---|---|---|
| A1 | Neither tool nor its header names `measure/tracks/model_guide/publish-approval.md`. | Reintroduce the old path in either tool. The `rg` check prints a line. |
| A2 | `publish.ts` refuses with `publish: no approval record`, exit 2, when the stable record is absent. | Point `publish.ts` at the archive path. It finds the record and exits 0. |
| A3 | `update.sh --docs <manifest>` with no stable record prints `update: no approval record` on stdout, exits 2, writes no file, and makes no commit. | The script takes the preview-only branch, exits 0, or writes a preview file. |
| A4 | A plain run without `--docs` keeps the preview-only branch. Exit 0, no docs write, no commit. | A plain run commits data or writes under `docs/`. |
| A5 | The stable record holds the same six rows and SHA-256 values as the archived record. | Change or drop one row. The byte comparison fails. |

**`update-pages.test.ts` (task 1.2, FR-3).**

| Case | Pins | Falsification condition |
|---|---|---|
| P1 | The approved run commits the two data files plus `docs/index.html` and `docs/real-work.html`. | The commit holds only the two data files. |
| P2 | `docs/review.html` and `docs/assets/data/review.json` are in the commit when the score file changed, and out when it did not. | Either file is always in the commit or never in the commit. |
| P3 | The rebuild uses the existing `preview.sh` and `guide.ts` path. | A marker planted in fixture output is absent from the rebuilt page. |
| P4 | A rerun with unchanged data exits 0 and makes no commit. | A second commit appears. |
| P5 | Staging uses explicit paths only. An unrelated dirty file that is not an affected page stays uncommitted. | The commit holds the unrelated file. |
| P6 | A missing review template with a changed score refuses with `update: no review template`, exit 2, no write, and no commit. | The run exits 0 and commits the fresh score beside the stale page. |

**`update-leak.test.ts` (task 1.3, FR-4).**

| Case | Pins | Falsification condition |
|---|---|---|
| L1 | `update.sh` runs `leak-check.ts` over the commit set after the copy and before `git add`. | Plant a `new_lines` key in the staged data. Exit 0 and a commit appear. |
| L2 | A key-field, private-path, or seeded-line hit prints one `update: leak <path>` line, exits 2, and makes no commit. | The raw `leak-check:` finding reaches stdout, or a commit is made. |
| L3 | A clean commit set passes the check and commits. | The clean run is refused. |
| L4 | The check scans exactly the candidate files of the commit. | Plant a seeded line in a file outside the candidate set. The run passes. |

**`update-exec.test.ts` (task 1.4, FR-5).**

| Case | Pins | Falsification condition |
|---|---|---|
| E1 | `git ls-files -s harness/model-guide/update.sh` shows `100755`. | The mode stays `100644`. |
| E2 | The README command runs as written. | Clear the execute bit. The documented command fails. |
| E3 | The README states the preview-only branch and the docs branch separately. | The text names only the docs write. |
| E4 | The README commit claim names the two data files plus the rebuilt pages. | `rg -n "only those two paths" README.md` still prints a line. |

### 3.4 Green gate

1. Each line of `GREEN_TEST_COMMAND` exits 0 with a labeled pass summary.
2. `rg -n "measure/tracks/model_guide/publish-approval" harness/model-guide/`
   prints no line.
3. `git ls-files -s harness/model-guide/update.sh` shows `100755`.
4. `rg -n "only those two paths" README.md` prints no line.
5. `git status --short docs/` prints nothing after every Green task.
6. `PROJECT_TESTS` exits 0 on each line, including the two regression files.

### 3.5 Closeout gate

1. The Green gate passes.
2. `PROJECT_LINT` exits 0.
3. `git diff --name-only <phase_base_sha>..HEAD -- docs/` prints nothing. Phase 1
   never writes the real `docs/`.
4. `git diff --stat <phase_base_sha>..HEAD -- harness/tests` prints nothing. The
   new tests sit outside `harness/tests/`, so no suite hash moves. The only
   allowed `preview.sh` change is Green commit `00d9013`, which reads passes
   held inside a route when the top-level `passes` array is absent; a read-only
   preview run matches `docs/review.html` and `docs/assets/data/review.json`
   byte for byte.
5. The plan holds one `[~]` task while two `[b]` tasks remain. A closeout
   candidate with `[b] > 0` is rejected (A12).
6. The three review records exist: Review B, Review C, and adversarial.

### 3.6 Review role applicability — Phase 1

| Role | Applies | Focus |
|---|---|---|
| Review A (correctness) | yes | The approval path, the page refresh, and the README wording (FR-1, FR-3, FR-5). |
| Review B (security) | yes | The leak-check wiring and the stable approval record. The record is the consent artifact. A consent-blind publish is A2. |
| Review C (CLI and exit codes) | yes | The `--docs` flag, the exit 2 refusals, the usage line, mode `100755`, and the README command. |
| Adversarial testing | yes | Section 6. |
| UX browser review | no | The tests rebuild pages in temp repos and read HTML as text. The real pages do not change. The same `preview.sh` and `guide.ts` path had a browser look in the model_guide track. The browser check belongs to Phase 2. |

### 3.7 Anti-pattern defense — Phase 1

| Anti-pattern | Defense | Refutation |
|---|---|---|
| A2 consent-blind publish | A3, L1, L2: refuse without the record and check leaks before `git add`. | Delete the record and plant a key field. Both runs must exit 2 with no commit. |
| A3 digit-only count | Parse the labeled vitest summary and JSON report. | A gate that greps a bare digit passes on a date line. The labeled parse fails. |
| A4 vacuous pass | P1, P4: require a commit-count delta of exactly 1 on the approved run and 0 on the rerun. | A test that only checks "no error" passes when the script does nothing. |
| A5 false claim | E1 to E4 tie the README and mode claims to executed commands. | Run each cited command. A non-zero exit makes the claim false. |
| A7 over-broad filter | A1 uses the exact old path, not a bare "approval" token. No exclude list grows. | A filter with a bare English token drops a real banned line. |
| A9 archived path drift | The tools read the stable path. The archive is read only when Green copies it. | A test that points at the archive path fails after the next move. |
| A11 inherited env | Delete `BENCH_TRACK`. Fake `HOME`. Adversarial case 7 runs under `BENCH_TRACK=change`. | Verdicts change when the environment changes. |
| A12 `[b]` blind spot | Closeout item 5 counts `[b]` tasks by hand. | The status tool lists a closeout candidate with two `[b]` tasks. |
| A13 ignored-artifact blind spot | Hash the temp tree outside `.git` and `node_modules`. Include ignored `.tmp/` and `runs/` files. | A changed ignored file leaves `git diff` clean. The hash check fails. |

## 4. Phase 2 — first weekly update and deferred pilot gate

Risk: critical. Both tasks are `[b]`. Red writes no test file in this phase.

### 4.1 Targeted Red command

The Red state is a fail-closed readiness guard. It fails while the PM export is
absent or the pilot task is not deferred.

```bash
# PHASE2_READY_CHECK — run from the repo root; set EXPORT_MANIFEST first
test -f "$EXPORT_MANIFEST" && echo "PHASE2_READY_CHECK=pass" || { echo "PHASE2_READY_CHECK=fail no export"; exit 1; }
grep -q '^- \[b\] 2.2' measure/tracks/weekly_update_fix/plan.md && echo "PILOT_STAYS_DEFERRED=pass" || exit 1
```

Falsification: the guard prints pass when no export exists, or when row 4.11
is not deferred. Do not run `update.sh --docs` until the guard passes.

### 4.2 Live behavior proof (task 2.1)

Run these two commands in this order after the PM sends the export.

```bash
cd harness && npx tsx model-guide/leak-check.ts --private "$PRIVATE_DIR" --repo .. --preview ../.tmp/model-guide-preview
harness/model-guide/update.sh --docs "$EXPORT_MANIFEST"
```

Proof expectations:

1. `docs/assets/data/real-work.json` and `docs/assets/data/model-guide.json`
   show the new read date.
2. `docs/index.html` and `docs/real-work.html` show the new data.
   `docs/review.html` joins them only when the score file changed.
3. The commit holds only those paths by explicit path.
   `git show --name-only --format= HEAD` equals the expected set, sorted.
4. `update.sh` makes no push. The orchestrator pushes with safe-push.
5. A rerun with unchanged data makes no commit.
6. Record both commands, exit codes, labeled output, and the commit SHA in
   `measure/runs/weekly_update_fix/weekly-update-1.txt`.

### 4.3 Green gate and closeout gate

**Green gate.**

1. Both commands of section 4.2 exit 0.
2. The data files and the rebuilt pages show the new values.
3. The commit path set is exact. No extra path appears.
4. Row 4.11 stays `[b]`.

**Closeout gate.**

1. The Green gate passes.
2. `git diff --name-only <phase_base_sha>..HEAD -- docs/` shows exactly the
   data files and the affected pages. Any other path fails the gate.
3. `PROJECT_LINT` exits 0.
4. `grep -c '^- \[b\]' measure/tracks/weekly_update_fix/plan.md` is at least 1.
   The pilot gate has not run. A closeout candidate with `[b] > 0` is not ready
   (A12).
5. The registry note names the deferred pilot gate (A14).

### 4.4 Review role applicability — Phase 2

| Role | Applies | Focus |
|---|---|---|
| Review A (correctness) | yes | Compare each rebuilt page with the new data files. |
| Review B (security) | yes | Leak-check exit 0 and the approval record before the real write. |
| Review C (CLI and exit codes) | yes | The `--docs` run, both exit codes, and the commit path set. |
| Adversarial testing | no new cases | Reuse the Phase 1 cases against the live data. |
| UX browser review | yes | The first real run writes the live public pages. Check the new read date and data, no console error, and no horizontal overflow at 390 px. This is the browser check that Phase 1 omits. |

### 4.5 Anti-pattern defense — Phase 2

| Anti-pattern | Defense | Refutation |
|---|---|---|
| A3 digit-only count | Read the labeled `Tests  N passed` line and the data dates as values. | A digit grep passes on a year in the manifest name. |
| A4 vacuous pass | The commit path set must be non-empty and exact. | A no-op run produces no commit and passes a "no error" check. |
| A5 false claim | Each Verify item records its command and labeled output. | A cited command exits non-zero. |
| A6 registry overstatement | The registry note claims "done" only with the commit SHA present. | The note says complete while the update commit is missing. |
| A11 inherited env | Run the live checks with a scrubbed `BENCH_TRACK`. | A leaked value changes the read date or the row set. |
| A12 `[b]` blind spot | Closeout item 4 counts `[b]` tasks. | The status tool offers closeout while row 4.11 is deferred. |
| A13 ignored-artifact blind spot | Hash the protected data files and the preview files before and after the run. | A change in an ignored preview file leaves `git diff` clean. |
| A14 stale registry note | Closeout item 5 compares the note with row 4.11. | The note names a completed pilot gate. |

## 5. Changed-contract risk: the committed `update.test.ts`

The committed `harness/model-guide-tests/update.test.ts` pins the old contract.
It writes the approval record at `measure/tracks/model_guide/publish-approval.md`.
Its U2 case expects a commit with only the two data files. Phase 1 Green changes
both facts. That file therefore fails after Green unless the Red role refreshes
it.

Before Red starts, the orchestrator widens tasks 1.1 and 1.2 so that the Red
role also edits `update.test.ts`. The refresh does four things:

1. Point `APPROVAL` and `approve()` at `harness/model-guide/publish-approval.md`.
2. Extend the U2 commit path set to the two data files plus the rebuilt pages.
3. Replace the "unrelated dirty `docs/index.html`" case with a file that is not
   an affected page. Green rebuilds `index.html` and commits it.
4. Keep U1, U3, and UP1 unchanged.

Falsification: run `PROJECT_TESTS` after Green. A stale assertion fails. A pass
with the stale file present proves the refresh did not run.

## 6. Adversarial cases — Phase 1

The adversarial role adds cases to the four test files. Each case tries to make
a wrong update pass.

1. Delete the stable record and run `--docs`. Require exit 2, no write, no
   commit.
2. Mutate a tool back to the archive path. The A1 path check must catch it.
3. Plant a `new_lines` key in the staged data. Require exit 2 and no commit.
4. Plant a seeded line of 20 characters or more. Require exit 2 and no commit.
5. Add an unrelated dirty file. It must stay out of the commit.
6. Change only the score file. `review.html` rebuilds. Change nothing. It does
   not rebuild.
7. Run with `BENCH_TRACK=change`. Verdicts must not change.
8. Change an ignored artifact under `.tmp/` or `runs/` while `git diff` is clean.
   The hash check must see it.

Write `measure/runs/weekly_update_fix/adversarial-<short head>.json`.

## 7. Intentionally-red aggregate suite handling

After Red writes the four files, the aggregate suite is intentionally red. Do
not run the full suite to inspect that state. Run one targeted file at a time
and record each exit status and each failed test name.

Do not weaken a test, widen an exclude list, or add a skip to reach green (A7).
`PROJECT_TESTS` is the scoped file list of section 2. It is never a bare
`npx vitest run`. No heavy gate runs in the window from 02:00 to 06:00.

## 8. Artifact tests and live behavior tests

| Artifact or documentation test | Live behavior test |
|---|---|
| Path `rg` checks in A1 and Green gate item 2 | Refusal and commit cases A2 to A4, P1 to P5, L1 to L4 |
| SHA-256 and six-row check A5 | Subprocess runs of `publish.ts`, `update.sh`, and `leak-check.ts` |
| Mode check E1 and README checks E2 to E4 | Git commit inspection in temp repos |
| Plan marker count and registry note | The real `--docs` run of Phase 2 |

An artifact test cannot close a live requirement. A path check alone does not
prove that the refusal works. A live test cannot replace the mode check or the
README check. Both classes are required.

## 9. `phase_base_sha` capture point

Commit this file with an explicit path:

```bash
git add -- measure/tracks/weekly_update_fix/test-strategy.md
git commit -m "measure(weekly_update_fix): test strategy" -- measure/tracks/weekly_update_fix/test-strategy.md
```

Directly after that commit, and before Red task 1.1 starts, the orchestrator
runs `git rev-parse HEAD` once and stores the value as the immutable
`phase_base_sha` for Phase 1.

The supplied role_base_sha and the track base `0b75b9c` both predate this
commit. Neither is a valid phase base. A SHA from before the strategy commit is
rejected. For Phase 2, capture a new value at the start of Phase 2, after any
Phase 2 strategy refresh and before task 2.1 runs. This file names no value.

## 10. Evidence to record

- Tasks 1.1 to 1.4: the Red summary line, the failed test names, and the Green
  summary line for the owned file.
- Task 1.4: the `git ls-files -s` line and the README `rg` result.
- Phase 1 closeout: the six gate results of section 3.5.
- Phase 2 task 2.1: the two commands, exit codes, labeled output, and commit
  SHA in `weekly-update-1.txt`.
- Phase 2 task 2.2: the `[b]` marker and the PM ruling that keeps it deferred.
