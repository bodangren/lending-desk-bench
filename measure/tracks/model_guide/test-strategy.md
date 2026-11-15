# Test strategy — model_guide

This file covers Phase 1, Phase 2, and Phase 3 in full. It gives Phases 4
and 5 a short section, so a later revision can extend it. Spec: `spec.md`.
Plan: `plan.md`. Anti-pattern catalog: `measure/anti-patterns.md`.

Revision 2 (2026-11-15) adds Phase 2. It folds in the Phase 1 lessons:
PA2-1 (page-level facts of page B), PA1-1 (empty states), UX U1 (390 px),
and B8-1 (hostile name).

Revision 3 (2026-11-16) adds Phase 3. It folds in the Phase 2 acceptance
records: nit P2A1-2 (the daily publish commits in the `docs/` range) and the
Q6 ruling (the print-audit block names the full routes).

## 1. Risk of each phase

| Phase | Product | Risk | Reason |
|---|---|---|---|
| 1 Page B | `real-work.ts`, `real-work.html`, `preview.sh`, `publish.ts` | high | A new public data path and the publish gate land here. A wrong rate can become a pick. |
| 2 Print audit and table | `print-audit-2026-11.json`, `guide.ts`, `update.sh`, `guide-section.html` | high | The table names a model to the owner, and `update.sh` gains the first path that writes `docs/` after an approval. The print-audit file comes from a hand-off. |
| 3 Review set and scorer | `pick-diffs.ts`, `review-set.ts`, `review-score.ts`, `adjudicate.ts`, `leak-check.ts` | high | A wrong match or a wrong weight gives a wrong rank. A leaked key (spec D9) cannot be withdrawn. The phase also writes the first public facts of track A. |
| 4 Runner and first results | `review-run.sh`, `quota.ts`, `provider-credential.sh`, `review.html` | critical | Live model calls, credentials, and quota spend. |
| 5 Publish | `publish-approval.md`, `publish.ts` run, weekly update | critical | A write under `docs/` reaches the public site on the next timer start (spec EV8). |

## 2. Gate commands

PM rule A-23 (2026-11-06): one test file at a time in the day, with
`--maxWorkers=1`. The full suite runs only after 22:00. An `index.lock`
error on a commit gets one more commit run. No phase gate is a full-suite
run.

### 2.1 Phase 1

Red command of task 1.1:

```bash
cd harness && npx vitest run model-guide-tests/real-work.test.ts --configLoader native --maxWorkers=1
```

Red command of task 1.2:

```bash
cd harness && npx vitest run model-guide-tests/input-check.test.ts --configLoader native --maxWorkers=1
```

Red command of task 1.3:

```bash
cd harness && npx vitest run model-guide-tests/preview-gate.test.ts --configLoader native --maxWorkers=1
```

`RED_TEST_COMMAND` (tasks 1.1 to 1.3) is these three lines. Run one line at
a time. Each line must exit non-zero on the base commit. Record the failed
test names in `measure/runs/model_guide/red-1.1.txt`, `red-1.2.txt`, and
`red-1.3.txt`.

`GREEN_TEST_COMMAND` (tasks 1.4 to 1.7). Run one line at a time:

```bash
cd harness && npx vitest run model-guide-tests/real-work.test.ts --configLoader native --maxWorkers=1
cd harness && npx vitest run model-guide-tests/input-check.test.ts --configLoader native --maxWorkers=1
cd harness && npx vitest run model-guide-tests/preview-gate.test.ts --configLoader native --maxWorkers=1
```

Task 1.4 owns the first two lines. Task 1.5 owns the first line. Tasks 1.6
and 1.7 own the third line. Each task also runs
`git status --short docs/`, and it must print nothing.

**Green gate.** Each line of `GREEN_TEST_COMMAND` exits 0 on the task HEAD.
Parse the labeled summary line (`Tests  N passed`), never a bare digit
(A3). Task 1.8 has a checker status of pass, or each blocking finding has
a fix commit.

**Closeout gate.** On the final phase HEAD:

1. `GREEN_TEST_COMMAND` exits 0 on each line.
2. `git status --short docs/` prints nothing.
3. `git diff --name-only <phase_base_sha>..HEAD -- docs/` prints nothing
   (spec D21).
4. `git diff --stat <phase_base_sha>..HEAD -- harness/provenance.ts harness/tests harness/opencode-host.sh harness/opencode-credential.sh`
   prints nothing. The new tests sit outside `harness/tests/`, so no suite
   hash moves.
5. Task 1.9 shows the five real values in
   `.tmp/model-guide-preview/real-work.html`: SHA-256 `dae855ca…64f2`,
   `generated_on` 2026-11-14, 1,798 runs, 2026-06-06 to 2026-11-13, 50.6 %,
   and 71.7 %.

Task 1.9 is the only step of the phase that reads the real export. It runs
`preview.sh`. No test reads the real file, the network, a model, or the real
`docs/`.

### 2.2 Phase 2

Risk: high.

Red command, one line at a time. Each line exits non-zero on the Phase 1
HEAD:

```bash
cd harness && npx vitest run model-guide-tests/print-audit.test.ts --configLoader native --maxWorkers=1
cd harness && npx vitest run model-guide-tests/guide.test.ts --configLoader native --maxWorkers=1
cd harness && npx vitest run model-guide-tests/update.test.ts --configLoader native --maxWorkers=1
cd harness && npx vitest run model-guide-tests/preview-gate.test.ts --configLoader native --maxWorkers=1
```

Owners of the Red lines:

- Task 2.1 owns line 1 and line 4. Line 1 fails on the absent
  `print-audit.test.ts`. Line 4 fails on the new print-audit block
  assertions. The four PA2-1 guard tests of section 4.2 pass at the base,
  and that is intended (see the note below).
- Task 2.2 owns line 2.
- Task 2.3 owns line 3.

`GREEN_TEST_COMMAND` is the same four lines, one per Green task:

- Task 2.4 owns line 1 and line 4.
- Task 2.5 owns line 2.
- Task 2.6 owns line 2 and line 4, plus `bash -n harness/model-guide/preview.sh`.
- Task 2.7 owns line 3, plus `bash -n harness/model-guide/update.sh`.

Each Green task also runs `git status --short docs/`, and it must print
nothing.

**The plan change for PA2-1.** Plan task 2.1 says "Write
`harness/model-guide-tests/print-audit.test.ts` and no other file". Task 2.1
now needs a second file. The orchestrator widens the 2.1 line before Red
starts, so that it names both `print-audit.test.ts` and
`preview-gate.test.ts`. The alternative is a new Red row `2.0`. The default
is the widened 2.1 line. The Red role of 2.1 records the change in
`measure/runs/model_guide/red-2.1.txt` and names PA2-1. Without this change,
task 2.1 breaks its own file rule (A5).

**Green gate.** Each of the four lines exits 0 on the task HEAD, with a
labeled `Tests  N passed` line. `git status --short docs/` prints nothing.
`guide.ts` passes a pinned `--today` value (section 4.2, T6). Task 2.8 has a
checker status of pass, or each blocking finding has a fix commit.

**Closeout gate.** On the final phase HEAD:

1. The four lines of `GREEN_TEST_COMMAND` exit 0.
2. `git status --short docs/` prints nothing.
3. The `docs/` range check prints nothing. The range excludes the daily
   publish commits (PM 2026-11-16, nit P2A1-2). A commit leaves the range
   only when its subject starts with `Publish daily` AND it changes only
   paths under `docs/assets/data/`. Any other commit that touches `docs/`
   prints and fails the gate. The exact form:

   ```bash
   git rev-list <phase_base_sha>..HEAD -- docs/ | while read -r c; do
     subj=$(git log -1 --format=%s "$c")
     other=$(git show --pretty=format: --name-only "$c" \
       -- ':(exclude)docs/assets/data/' | grep -c .)
     case "$subj" in "Publish daily"*) [ "$other" -eq 0 ] && continue ;; esac
     echo "$c $subj"
   done
   ```

   Run it in `bash` without `set -e`: `grep -c .` exits 1 on a zero match,
   and that is the wanted value, not an error.
4. `git diff --stat <phase_base_sha>..HEAD -- harness/provenance.ts harness/tests harness/opencode-host.sh harness/opencode-credential.sh harness/model-guide/preview.sh`
   prints nothing for the first four paths. `preview.sh` may change, so the
   checker reads its diff and confirms that the copy and scan code did not
   move.
5. Task 2.8 shows the checker JSON at `measure/runs/model_guide/check-2.8.json`.
6. Task 2.9 shows the real preview facts in `.tmp/model-guide-preview/`:
   `index.html` holds the six-row table above the hero, with a pick or
   `no pick yet: not enough evidence` in each row, an evidence cell, and an
   evidence date; the code review row says "no pick yet" until Phase 4.
   `real-work.html` holds the print-audit block: 52, 13, `11 of 13`,
   `13 of 13`, the error types with counts, the bias note, and the line
   that the data point is one calibration run and not a rank.

Task 2.9 is the only step of the phase that reads the real hand-off files.
No test reads them.

### 2.3 Phase 3

Risk: high. A wrong match or a wrong weight gives a wrong rank (spec D13).
A leaked key (spec D9) is permanent: a committed key cannot be withdrawn.
The phase starts no model, spends no quota, and writes no page. It does
write the first public facts of track A, so a wrong field becomes a public
contract.

Red command, one line at a time. Each line exits non-zero on the Phase 2
HEAD, because the module under test does not exist:

```bash
cd harness && npx vitest run model-guide-tests/pick-diffs.test.ts --configLoader native --maxWorkers=1 --reporter=dot
cd harness && npx vitest run model-guide-tests/review-set.test.ts --configLoader native --maxWorkers=1 --reporter=dot
cd harness && npx vitest run model-guide-tests/review-score.test.ts --configLoader native --maxWorkers=1 --reporter=dot
cd harness && npx vitest run model-guide-tests/adjudicate.test.ts --configLoader native --maxWorkers=1 --reporter=dot
cd harness && npx vitest run model-guide-tests/leak-check.test.ts --configLoader native --maxWorkers=1 --reporter=dot
```

Owners of the Red lines:

- Task 3.1 owns line 1, and the fake `gh` under `fixtures/fakes/`.
- Task 3.2 owns line 2, and the synthetic diffs and keys under
  `fixtures/review/`.
- Task 3.3 owns line 3.
- Task 3.4 owns line 4.
- Task 3.5 owns line 5.

Each Red role records the failed test names in
`measure/runs/model_guide/red-3.1.txt` to `red-3.5.txt`.

Tasks 3.3 and 3.4 reuse the `fixtures/review/` files of task 3.2. Their
plan lines say "and no other file". A new fixture in 3.3 or 3.4 is a plan
change, and the orchestrator widens the line first, as PA2-1 did. The file
`leak-check.test.ts` is new. It is not the Phase 1 file `leak-guard.test.ts`,
and no role adds cases to `leak-guard.test.ts`.

`GREEN_TEST_COMMAND` is the same five lines, one per Green task:

- Task 3.6 owns line 1.
- Task 3.7 owns line 2, plus `git status --short docs/`, which prints
  nothing.
- Task 3.8 owns line 3.
- Task 3.9 owns line 4.
- Task 3.10 owns line 5.
- Task 3.11 owns no line. The prompt is an artifact (section 7).
- Tasks 3.13 to 3.16 own no line. They read the network or start a model,
  and they run through `heavy-run.sh`.

**Green gate.** Each of the five lines exits 0 on the task HEAD, with a
labeled `Tests  N passed` line (A3). `git status --short docs/` prints
nothing. Task 3.12 has a checker status of pass, or each blocking finding
has a fix commit.

**Closeout gate.** On the final phase HEAD:

1. The five lines of `GREEN_TEST_COMMAND` exit 0.
2. `git status --short docs/` prints nothing.
3. The `docs/` range check of section 2.2 item 3 prints nothing.
4. `git diff --stat <phase_base_sha>..HEAD -- harness/provenance.ts harness/tests harness/opencode-host.sh harness/opencode-credential.sh harness/model-guide/routes.json`
   prints nothing. Phase 3 creates no route file (plan 4.5 owns it). The
   `test:meta:logic` exclude list of `harness/package.json` is unchanged;
   the checker reads that diff (A7).
5. Task 3.12 shows `measure/runs/model_guide/check-3.12.json` with status
   pass.
6. Task 3.13 shows one candidate list for each source repo of spec EV7 in
   the private folder, each with 7 or more qualified commits. No list is in
   the repository.
7. Tasks 3.14 and 3.16 show a lint pass for `mg-2026-11a` and `mg-2026-11p`.
   Task 3.15 writes `harness/model-guide/data/sets/mg-2026-11a.json` and
   does not commit it. No set manifest is committed in Phase 3.
   `git status --porcelain -- harness/model-guide/data/sets/` shows untracked
   entries for `mg-2026-11a.json` and `mg-2026-11p.json` only, and no other
   path. Both files hold no key field and no seeded line (spec acceptance 9).
8. `leak-check.ts` exits 0 on the final tree.

Item 3 replaces a bare `git diff --name-only <phase_base_sha>..HEAD -- docs/`
check. The nightly publish job commits `docs/` on main, and those commits are
not Phase 3 work. The rule is the same as the Phase 2 rule.

Model families for the routes (recommendation only, the orchestrator picks):
Red `bailian-token-plan/qwen3.8-max#high`; Green
`opencode-go/muse-spark-1.3-contributor#high`. The two families differ. Both
served Phase 2 roles through a plan quota. The first is not in the D12
ranked list, and the second is; a role run is not a track A pass, so a ranked
route may serve a role.

### 2.4 Phase 4

Risk: critical.

Red command shape, one line at a time: `review-run.test.ts`,
`quota.test.ts`, and `credential-provider.test.ts`, each with
`--configLoader native --maxWorkers=1`. Red tasks 4.1 to 4.3 own one file
each. `GREEN_TEST_COMMAND` is the same lines, one per Green task 4.4, 4.6,
and 4.7; task 4.8 reuses the Phase 1 and Phase 4 lines.

Green gate: each line exits 0; `ps -eo pid,args | grep '[f]ake-opencode'`
prints no line. Closeout gate: the lines exit 0, the task 4.9 checker
pass, and `git diff --stat <phase_base_sha>..HEAD -- harness/opencode-credential.sh harness/opencode-host.sh`
prints nothing. Tasks 4.10 to 4.14 run through `heavy-run.sh` in the quota
window of spec D15.

### 2.5 Phase 5

Risk: critical.

Phase 5 has no Red task and no new test file. Its gate replays the refusal
cases of `preview-gate.test.ts` and adds live checks:

```bash
cd harness && npx vitest run model-guide-tests/preview-gate.test.ts --configLoader native --maxWorkers=1
cd harness && npx tsx model-guide/publish.ts --preview .tmp/model-guide-preview
```

Green gate: the first line exits 0, and the second line exits 2 while the
approval record is absent. Closeout gate: the approval record exists, the
second line exits 0 only after Daniel's word, the drift check names each
drifted file and writes nothing, `leak-check.ts` passes, and the commit
holds only the explicit `docs/` paths.

## 3. Fixtures and fakes

All fixtures are synthetic. They live in
`harness/model-guide-tests/fixtures/`. No fixture holds a real export byte,
a real hand-off byte, a book page, or a book line.

### 3.1 Phase 1 fixtures

- `real-work-mini.json` uses the `real-work-outcomes/1` shape of spec EV2.
  Top keys: `schema`, `generated_on`, `definitions`, `coverage`, `weekly`,
  `all_time`. A `weekly` row holds `route`, `role`, `week`, `runs`, `pass`,
  `fail`, `error`, `no_result`, `blocking_findings`, `ratings`,
  `rater_checks`. An `all_time` row holds `work_types` in place of `week`.
- `MANIFEST.txt` holds the SHA-256 and the size of `real-work-mini.json`.
  A helper asserts that the committed pair agrees. A fixture edit without a
  manifest edit fails that helper.
- The fixture covers these routes: `x/m`, `x/m#high`, `x/m[1m]#high`,
  `y/m` (the same model on a second provider), `unknown`, and `other`. It
  covers a producer role and a checker role. It covers the four work types
  of spec D18. It holds one `rater_checks` value with `n` 0 and one with
  `n` above 0.
- The fixture holds `coverage.runs` equal to the sum of `weekly` and to the
  sum of `all_time`. A mismatch fails the input check for the wrong reason
  in every normal case.
- `preview-gate.test.ts` builds a temp repo, as
  `harness/schedule-tests/rescore-guard.test.ts` does. The temp repo holds
  a synthetic `docs/` tree with a known `index.html`, a known
  `assets/css/site.css`, and a known `assets/data/benchmark.json`. It holds
  a copy of `preview.sh` and `publish.ts`, a synthetic export, and a temp
  preview folder. The test snapshots the temp `docs/` tree before and after
  each run.

### 3.2 Phase 2 fixtures

- `fixtures/print-audit/print-audit-mini.json` and its `MANIFEST.txt`. The
  shape follows spec D17: top keys `source`, `note`, `routes`, `summary`,
  `errors`. It holds 52 synthetic `errors` rows. 13 of them are blockers.
  43 rows hold 1 to 3 checklist items and 9 rows hold none. Each item holds
  a synthetic `code` and `text`. The two route results are 11 of 13 and 13
  of 13. It holds a `summary` and a `bias_note`. It holds no book content.
- The print-audit fixture holds one hostile error-type name and one hostile
  checklist `text`. The name holds a double quote and an angle bracket, for
  example `"><img src=x onerror=alert(1)>`. The text holds a key named
  `__proto__`. Both are rendered if the page escapes nothing (B8-1, T11).
- `fixtures/page-guard/real-work-page.json` and its `MANIFEST.txt`. It is a
  small export with `coverage.runs` 1,285, so the page must print a
  thousands comma. It holds a sentinel `generated_on` of 2026-10-20, so a
  page that hardcodes the real date fails. It holds one row with 9 results
  and one with 10. Its sums agree, so the input check passes.
- `fixtures/review-scores-mini.json` follows the shape of spec D13. It
  holds one route with 3 complete passes and one route with 2 passes and
  the state `incomplete`.
- `fixtures/benchmark-mini.json` holds a `build` score and a `tests` score.
  The base line uses them and never picks (spec D18).
- The guide tests reuse `real-work-mini.json` and `print-audit-mini.json`.
  `update.test.ts` builds a temp repo as `preview-gate.test.ts` does, with a
  temp `docs/assets/data/`, a temp preview folder, and a temp git repo for
  the explicit-path commit case.
- No test reads the real `docs/`, the real hand-off files, the network, a
  model, or the private folder. One guard case scans the test folder for the
  hand-off folder names. Each needle is built from two parts, so the guard
  does not match its own text.

### 3.3 Phase 3 fixtures

- `fixtures/fakes/gh` is the only network edge. The executable appends its
  argv and the HTTP method to `$FAKE_GH_LOG`, and it prints a canned JSON
  body from `fixtures/fakes/gh-commits.json`. It exits 3 on a verb other
  than `api`, and 1 on an unknown path. Each test puts its folder first on
  `PATH`, then asserts the exact log lines.
- `fixtures/review/` holds one synthetic source diff, the seeded diffs, and
  the keys of spec D7. `src-01.diff` holds `+` and `-` lines with the `L<n>`
  prefixes of D10. `seed-01.diff` changes only `+` lines. The test computes
  `seeded_diff_sha256` with `node:crypto` from the fixture file, so a stale
  constant cannot pass.
- The keys cover one case each: a plant in a removed line, two plants 7
  lines apart, a plant of 7 lines, a wrong hunk header, a wrong SHA-256, a
  valid operator for each class, and one operator outside the catalog of its
  class.
- The review outputs cover: a valid block with 1 finding; a finding at
  `new_lines[0] - 3` and at `new_lines[1] + 3`; a finding one line further
  out; a wrong class at the right line; two findings between two plants; a
  duplicate finding; 31 findings; no block; invalid JSON; a finding with no
  `line`; and a finding with an absolute path.
- One set fixture meets D8: 12 diffs, 6 from each source repo, 3 to 5 plants
  each, 40 to 60 plants, 14 or more blockers, each class C1 to C7 with 3 or
  more plants, C8 and C9 with 1 or more, and 2 controls. One pilot fixture
  meets D13: 6 diffs and 12 or more plants.
- The private root is a `mkdtemp` folder. Each write command takes
  `--private <dir>`. No test reads or writes the real private folder. One
  guard builds the folder name from two parts, as the Phase 1 guard does.
- Dates are explicit. The manifest creation date comes from a fixture value
  or a `--created` value, never the wall clock.

## 4. Test groups and falsification

### 4.1 Phase 1

| Group | File | What it proves | Falsification condition |
|---|---|---|---|
| M1 Merge | `real-work.test.ts` | `x/m`, `x/m#high`, and `x/m[1m]#high` merge into `x/m` by sums, and the row lists its routes. `y/m` stays a second row. `unknown` and `other` merge with nothing. | Change the merge to join two providers, or to drop the `[1m]` part only. M1 must fail. |
| M2 Rates | same file | Pass rate is `pass / (pass + fail + error)`. `no_result` is out of the rate and in its own field. Each rate carries its run count. | Add `no_result` to the denominator, or drop the count. M2 must fail. |
| M3 Rank | same file | Producer rank uses pass rate, then the lower blocking rate. Checker rank uses pass rate only. A rating never changes a rank. | Change a rating alone in the fixture. The row order must not move. A moved row fails M3. |
| M4 Work type | same file | A work-type rate is `pass / (pass + fail)`, with the result count beside it. A work-type row sums its role rows. The rank uses the rate, then the count. Only `runs`, `pass`, and `fail` are inputs. | Add a `blocking_findings` key to a `work_types` value. The cell must not change. A changed cell fails M4. |
| M5 Small sample | same file | A row with 9 results gets `few runs` and goes below a row with 10. A row with 10 has no mark. A work-type row with fewer than 10 results cannot pick. A `pass + fail` of 0 has no rate. | Set the threshold to 9, or count export `runs`. M5 must fail. |
| M6 Coverage and trend | same file | The coverage block holds the runs, the date range, the two shares, the left-out duplicates, and the `unknown` and `other` runs. The trend uses the last 4 ISO weeks. | Shift the trend window to 5 weeks. M6 must fail. |
| I1 Accept | `input-check.test.ts` | The check passes on the fixture pair, and the output keeps the file name, the SHA-256, and `generated_on`. | Change one byte of the fixture copy. I1 must not pass. |
| I2 Refuse | same file | A changed byte, a wrong size, a wrong schema, a run sum that differs from `coverage.runs`, and a missing `MANIFEST.txt` each give exit 2, one named check line, and no output file. | Remove one refusal branch from the tool. I2 must fail. |
| P1 Preview | `preview-gate.test.ts` | `preview.sh` writes `real-work.html` and `real-work.json` into the temp preview folder. The nav and the method note text are in the page. `preview-base.json` holds the SHA-256 of each copied `docs/` file. | Drop one `preview-base.json` entry. P1 must fail. |
| P2 No write | same file | The temp `docs/` tree is byte-identical after `preview.sh`. | Let `preview.sh` write one file into the temp `docs/`. P2 must fail. |
| P3 Refuse publish | same file | `publish.ts` gives exit 2 and writes no file without an approval record, and with one wrong SHA-256. | Remove the approval read. P3 must fail. |
| P4 Drift | same file | `publish.ts` gives exit 2, names the drifted file, and writes nothing when a `docs/` file changed after the preview. | Skip the `preview-base.json` compare. P4 must fail. |

### 4.2 Phase 2

| Group | File | What it proves | Falsification condition |
|---|---|---|---|
| N1 Print-audit accept | `print-audit.test.ts` | The input check of spec D17 passes on the synthetic pair. It reads the SHA-256 from `MANIFEST.txt` and checks the top keys and the 52 rows. The output file holds 52, 13, `11 of 13`, `13 of 13`, the type counts, the checklist items of the mapped rows, the result of each run, the summary, and the bias note. | Delete the top-key read. N1 must fail. |
| N2 Print-audit refuse | same file | A changed byte, a wrong SHA-256 in `MANIFEST.txt`, a missing top key, and 51 `errors` rows each give exit 2, one named check line, and no output file. | Remove one refusal branch. N2 must fail. |
| N3 No page content | same file | The output file holds no key `pages`, `text`, or `file` at any depth, and no book line. The `checklist` items hold only a `code` and a `text` that the fixture supplies. | Add a `pages` key. N3 must fail. |
| N4 No placeholder | same file and `preview-gate.test.ts` | The string `Error types: not yet received.` is absent from the tool output and from the page. The block always shows the error types. | Add the placeholder line to the template. N4 must fail. |
| T1 Print-audit block | `preview-gate.test.ts` | The generated `real-work.html` holds the block: 52, 13, `11 of 13`, `13 of 13`, each type with its count, the bias note, and the line that this is one calibration run and not a rank. | Remove the block from the template. T1 must fail. |
| T2 Rows and columns | `guide.test.ts` | `model-guide.json` holds the six rows of spec D18 in order, each row with the five columns, a source name, a number, a run count, and an evidence date. | Reorder two rows, or drop the evidence date. T2 must fail. |
| T3 Pick rule | same file | The first source picks the first and the second choice from its rank. A model needs 10 runs or more (10 results for a work type) or a complete track A rank. The base line shows beside the pick and never changes it. | Make the base line pick, or lower the threshold to 9. T3 must fail. |
| T4 Second source | same file | When the first source has no qualified model, the second source picks. The row names the second source in its evidence cell. | Remove the fallback. T4 must fail. |
| T5 No pick yet | same file and `preview-gate.test.ts` | When neither source has a qualified model, the cell says `no pick yet: not enough evidence`. The page shows the same words for the code review row before Phase 4. | Print an empty cell, or a model name. T5 must fail. |
| T6 Stale | `guide.test.ts` | A table whose newest evidence date is 15 days before the pinned `--today` value shows `stale`. At 14 days it shows no mark. The tool takes `--today`, so the verdict does not move with the wall clock. | Read the wall clock, or set the boundary at 15. T6 must fail on a fixed fixture or on the next day. |
| T7 Incomplete | same file | A track A route with 2 passes and the state `incomplete` does not qualify and gets no rank. A route with 3 complete passes qualifies. | Let an incomplete route pick. T7 must fail. |
| U1 Update before approval | `update.test.ts` | `update.sh` writes `real-work.json` and `model-guide.json` into the preview folder only. The temp `docs/` tree is byte-identical after the run. | Let the script write one file under `docs/`. U1 must fail. |
| U2 Update after approval | same file | With an approval record, the script writes the two data files into the temp `docs/assets/data/` and runs `git commit` with those two paths only. `git show --name-only` lists no other path. | Stage `docs/` as a folder. U2 must fail. |
| U3 Update refusal | same file | A failed input check gives exit 2, one named line, and a byte-identical temp tree. | Skip the input check. U3 must fail. |
| T11 Hostile name | `preview-gate.test.ts` | A hand-off text with a double quote and an angle bracket, and a key named `__proto__`, reach the HTML escaped. The page holds no raw `<img`. A plain `__proto__` key does not add a route or a row. | Remove the escape. T11 must fail. |
| G1 Source line | `preview-gate.test.ts` | The generated page holds `generated 2026-10-20` from the page-guard fixture. The value comes from `generated_on`. | Hardcode a date in the template. G1 must fail on the sentinel. |
| G2 Coverage block | same file | The coverage block holds `1,285` (a thousands comma), 2026-10-01 and 2026-11-01, and both shares as percents with one decimal (38.9 % and 77.8 %). | Drop the comma format, or print the share as a fraction. G2 must fail. |
| G3 Few runs | same file | Each producer, checker, and work-type row with `few_runs` true in `real-work.json` shows `few runs` in its own HTML row. A row with 10 results shows none. | Mark every row, or mark none. G3 must fail. |
| G4 Run count | same file | Each rate cell ends with ` (n=<pass_rate.n>)`, and the integer equals the JSON value. | Drop the count from one table. G4 must fail. |

**Note on the four guard groups G1 to G4.** They are page-level regression
guards from PA2-1. They pass at the Phase 1 HEAD, because the behavior
landed in Phase 1 and the live preview proves it. A guard test that passes
at the base is not a Red test. Its proof is its falsification condition:
the sentinel fixture value, or the removal of the format from the template.
Red 2.1 records the base result as `pass` for G1 to G4 and `fail` for T1,
N4 (the page part), and T11. The checker 2.8 confirms that each guard reads
the generated file and not the fixture.

Each group proves live behavior. A group that reads the fixture and asserts
the fixture against itself is vacuous and does not count (A4). Every
"no data", empty-state, and refusal clause of spec D17 to D19 has its own
group above: N4, T5, T6, T7, U1, U3, and G3.

### 4.3 Phase 3

| Group | File | What it proves | Falsification condition |
|---|---|---|---|
| PK1 Candidate list | `pick-diffs.test.ts` | The tool calls `gh api` GET only, and it lists the commits that meet each rule of D4, newest first. Each test asserts the exact `$FAKE_GH_LOG` lines. | Change the order, or let a merge commit through. PK1 must fail. |
| PK2 Each refusal | same file | A merge commit, a date outside 2026-08-01 to 2026-11-13, a file count outside 1 to 8, a line count outside 40 to 400, a code share below 60 %, a lock file, a binary file, a path under `dist/`, `build/`, or `generated/`, and a file over 2 000 lines each give one reason line and no selection. | Remove one rule. The matching case must fail. |
| PK3 Selection | same file | The tool takes the first qualified commits, skips each diff that a set holds, and stops at the D8 count. | Drop the skip. The held-diff case must fail. |
| PK4 No other call | same file | The fake log holds `api` entries only. No `pr`, `repo`, `clone`, `git`, or local checkout call happens. | Call `gh pr list`. PK4 must fail. |
| S1 Lint accept | `review-set.test.ts` | A set that meets D5 to D8 passes, and the manifest holds the fields of D9 and no other field. | Add one field to the fixture key and keep it in the manifest. S1 must fail. |
| S2 Plant refusals | same file | A plant in a removed line, plants fewer than 8 lines apart, a plant over 6 lines, a wrong hunk header, a wrong SHA-256, and a class or severity count below D8 each fail with one named line and exit 2, and write no manifest. | Remove one branch. S2 must fail. |
| S3 Operator catalog | same file | One operator of each class passes. An operator that is not in the catalog of its class fails, and the line names the class and the operator. | Accept a C3 operator in a C1 plant. S3 must fail. |
| S4 Count profile | same file | The D8 counts apply to `mg-2026-11a`. A `mg-2026-11p*` id uses the D13 pilot counts: 6 diffs and 12 or more plants. | Apply the D8 count to the pilot id. S4 must fail, and task 3.16 could not pass. |
| S5 Manifest secrecy | same file | The manifest holds no `new_lines`, `witness`, `operator`, `file`, line, or plant text. Each SHA-256 is 64 hex characters. | Add `new_lines` to the manifest writer. S5 must fail. |
| R1 Match | `review-score.test.ts` | A finding in the window with an accepted class matches, and the plant weight counts once. A second finding on a found plant is neutral. The max is 30 findings. | Count a duplicate twice. R1 must fail. |
| R2 Window edges | same file | `new_lines[0] - 3` and `new_lines[1] + 3` match. One line further does not. A wrong class at the right line does not match, and no verdict makes it found. A finding between two plants matches the nearer one. | Widen the window to 4. R2 must fail. |
| R3 Score | same file | `max(0, 100 × F / W − 2 × X)`, with one decimal. A negative result is 0. The record holds blocker recall, the found, missed, and false-claim counts, and the counts by class and severity. | Use the sum of weights of all plants for `F`. R3 must fail. A found blocker counts 5. |
| R4 Invalid and states | same file | No JSON block, invalid JSON, or a finding without `file` or `line` makes the review `invalid` with 0 found and 0 false claims. An `unclear` verdict marks the pass `provisional` and keeps the rank. Fewer than 3 complete passes gives `incomplete`. | Let an invalid review count its findings. R4 must fail. Treat `provisional` as incomplete. R4 must fail. |
| R5 Rank | same file | The rank uses the worst pass. A tie goes to the worst blocker recall, then to the median. A route with 2 complete passes has no rank. | Rank on the best pass. R5 must fail. |
| R6 Score-file shape | same file | The score file holds no `new_lines`, `witness`, `operator`, `file`, line, or finding text at any depth. | Add a `file` key. R6 must fail. |
| J1 Queue units | `adjudicate.test.ts` | One item per finding, each with its finding id, grouped by file and a 3-line window. A group with two different claims holds two items and no shared verdict. | Group the two claims under one verdict. J1 must fail. |
| J2 Apply | same file | `real-defect` maps to neutral and to the key. `false-claim` maps to a false claim. `unclear` maps to `provisional`. A verdict that the two judges do not share counts as `unclear`. | Count a disagreement as a false claim. J2 must fail. |
| J3 Blind queue | same file | The queue file holds no route name, and it holds no verdict of the other judge. | Write the route name into the item. J3 must fail. |
| J4 No rescue | same file | A finding with a wrong line or a wrong class never becomes found through `apply`. A disagreement never counts against the model. | Add a `plant:<id>` rescue. J4 must fail. |
| K1 Clean pass | `leak-check.test.ts` | A clean staged tree exits 0. | Fail on the clean tree. K1 proves the check reads a real tree. |
| K2 Key field | same file | A staged file with `new_lines`, `witness`, or `operator` exits 2 with one named line. | Remove one field from the scan. K2 must fail. |
| K3 Private path | same file | A staged file with the private folder path exits 2. | Skip the path scan. K3 must fail. |
| K4 Seeded line | same file | A seeded line of 20 characters or more that is not in the source diff exits 2. The same line, when the source diff holds it, does not fail. A line of 19 characters does not fail. | Match a bare prefix, or a 19-character line. K4 must fail. |
| K5 Docs and preview | same file | A file under `docs/` or under the preview folder is scanned even when it is not staged (FR-10). Such a file with a key field, the private path, or a seeded line exits 2. | Scan the staged set only. K5 must fail. |

**Guard cases.** G5 to G9 are the Phase 3 guard cases. They run inside the
five files above, and each one fails at the Phase 2 HEAD, because the module
under test is absent. They are Red cases, not base-passing guards, and the
Red roles record them as `fail`.

- **G5 exactness (A7).** K4 and S5 match exact field names and the private
  path. The word "witness" in prose does not fail K4. A 19-character line
  does not fail K4.
- **G6 network shape.** PK4 reads the fake log. Any call other than `api`
  fails.
- **G7 no secret field.** S5 and R6 scan exact key names at any depth. A
  value that holds the word "operator" does not fail.
- **G8 blindness.** J3 reads the queue file. A route name in the item
  fails.
- **G9 environment.** Every file passes under `BENCH_TRACK=change` with a
  pinned `TZ`, and the private root is a `mkdtemp` folder.

**No base-passing guard.** Phase 3 declares no case that passes at the Phase
2 HEAD. A case that passes at the base needs its own label and its own
falsification condition, as G1 to G4 do. The Phase 3 files have none, so no
empty-state claim rests on a vacuous pass (A4).

## 5. Architecture guardrails and changed contracts

- **No write under `docs/` before Phase 5** (spec D21). The preview tool
  writes the preview folder only. P2, U1, the `git status --short docs/`
  check, and the closeout diff prove it.
- **`update.sh` writes only two files, with explicit paths** (spec D19).
  U2 proves the two paths and no other path.
- **Publish gate.** It refuses without an approval record, on a wrong
  SHA-256, and on drift (spec D21, FR-7). P3 and P4 prove the refusals.
- **Rank uses no rating** (spec D16). M3 proves it.
- **Work-type tables use only export data** (spec D16, D18). M4 proves it.
- **The base line never picks** (spec D18). T3 proves it.
- **The print-audit block is one data point, not a rank** (spec D17). T1
  proves the wording, and N1 proves the two results.
- **Merge joins only `#variant` and `[1m]` rows of one route** (owner
  decision Q5, OD4). M1 proves it.
- **Changed contracts.** The export schema `real-work-outcomes/1` is
  external. The tool refuses another schema; it does not adapt. The
  print-audit hand-off shape of spec D17 is external too. The file
  `harness/provenance.ts` holds the `runner_sha256` and `suite_sha256`
  lists. No file of those lists changes. `docs/` belongs to the daily job
  (spec EV8). The worktree root below `harness/` is the only place that the
  tests write, and only in a temp folder. `model-guide.json` becomes a
  public data contract at the first publish. Its row order and its field
  names are fixed here. A change to either one is a new contract, and the
  checker 2.8 must name it.
- **`preview.sh` is shared with Phase 1.** Phase 2 edits it to add the
  overview table. P1 to P4 and the Phase 1 copy checks must stay green
  after the edit. The closeout gate reads the `preview.sh` diff.
- **Secrecy.** Phase 2 reads no key, no seeded diff, and no credential
  value. The page holds no book text, no page, and no file name (spec D17).
- **Track A secrecy is the top contract of Phase 3** (spec D9). The
  repository holds only `data/sets/<set_id>.json` and
  `data/review-scores/<set_id>.json`. Both field sets are closed. A new
  field is a contract change, and checker 3.12 must name it. The seeded
  diffs, the keys, the raw outputs, and the adjudication notes stay in the
  private folder. S5, R6, J3, and K1 to K5 prove it.
- **The score file is the Phase 4 page input.** `review.html` (spec D13,
  FR-14) reads the field names and the state words `invalid`,
  `provisional`, and `incomplete` that Phase 3 fixes here. A later rename is
  a new contract. The state words are asserted as words, not as booleans
  (A3).
- **The manifest is the page's set-count source** (spec D13). Its per-diff
  SHA-256 values must equal the seeded diffs, so the lint recomputes the
  hunk headers and the SHA-256 values. It does not trust the key
  (S2).
- **`pick-diffs.ts` reads no local checkout and calls no other verb than
  `gh api` GET** (spec D4). The finding has no local `git` call, and no
  token in argv or in a log line (PK4, G6). The fake `gh` replaces the real
  binary on `PATH`.
- **A write command needs an explicit `--private <dir>`.** A missing value
  gives exit 2 with a named line. Without the flag no test can be hermetic,
  and a test would touch the real private folder (A11, A13).
- **`harness/model-guide/routes.json` is Phase 4's file** (plan 4.5).
  Phase 3 must not create it. The checker reads the file list, not the
  whole tree.
- **One test file per Red task, and one fixture owner.** Task 3.1 owns the
  fake `gh`, task 3.2 owns `fixtures/review/`, and tasks 3.3 and 3.4 reuse
  it. A new fixture in 3.3 or 3.4 needs the plan line widened first
  (PA2-1).
- **Parallel work on main.** The tracks `daily_model_schedule` and the
  nightly publish commit on `main`. Every gate names explicit paths or the
  `docs/` range rule of section 2.2. No gate is a whole-tree
  `git status --short`.

## 6. The plan 1.2 conflict with spec D17

Plan task 1.2 names "a wrong size, a wrong schema" among its edge cases.
Spec D17 (finding F13) dropped the size check and the schema-key check for
the print-audit file only. The page B export keeps both checks. Spec D16
"Input check" says the tool stops when "the SHA-256 or the size differs from
the manifest, when `schema` is not `real-work-outcomes/1`, or when a run sum
differs from `coverage.runs`". Spec EV2 gives the schema value. Thus I2
tests the size check and the schema check on the page B export, and task
1.2 is correct. No test asserts a size field or a schema key for the
print-audit file.

The Phase 2 print-audit check follows the same split. N1 and N2 test the
SHA-256 from `MANIFEST.txt`, the top keys, and the 52-row count. They test
no size and no schema key, as spec D17 states.

## 7. Artifact tests and live-behavior tests

- **Live behavior.** M1 to M6 call `real-work.ts`. I1 and I2 start the tool
  as a subprocess and read its exit code. P1 to P4 start `preview.sh` and
  `publish.ts` in a temp repo and compare the temp tree before and after.
  N1 to N4 start the print-audit tool as a subprocess. U1 to U3 start
  `update.sh` in a temp repo with a temp git repo and read the exit code and
  the tree. T1, T5, T11, and G1 to G4 run `preview.sh` on a synthetic export
  and read the bytes of the generated page.
- **Artifact assertions.** The nav, the method note, the table header, the
  print-audit block, and the four guard groups read bytes of the generated
  page. They prove that the generator ran and wrote the text. They do not
  prove that a browser renders the page. The browser review proves the
  rendering.
- **Live artifact check.** Task 1.9 and task 2.9 read the preview of the
  real files. They are acceptance checks on the real artifact, not unit
  tests.
- **No documentation test.** The method note and the bias note are page
  output. A test that only reads a markdown file proves no product behavior
  and does not count.
- **No real hand-off byte.** No test may read the OD6 file. N1 and N2 use
  the synthetic pair only. Task 2.4 copies the real values into the data
  file, and task 2.9 reads the preview.

Phase 3 splits the same way.

- **Live behavior.** `review-set.test.ts`, `adjudicate.test.ts`,
  `leak-check.test.ts`, and `pick-diffs.test.ts` start the tool as a
  subprocess in a temp repo and read the exit code and the written JSON.
  `review-score.test.ts` calls the scorer in process with a fixture key and
  a fixture output, and it reads the pass record. Each assertion reads the
  tool output, not the fixture text.
- **Artifact.** `review-prompt.md` (task 3.11) is an artifact. No test
  asserts its prose, because a test that reads the file and asserts a
  string proves no product behavior (A4). Its one behavior-bearing item,
  the fenced JSON block of D10, is proven by the Phase 4 runner, which
  passes the file to the model. Checker 3.12 reads the file as an artifact
  and records that fact.
- **No documentation test.** A test that only reads `spec.md`, `plan.md`,
  or a record file does not count in any phase.

## 8. Intentionally-red aggregate suite

The Phase 1 files exist from the Red tasks and fail until task 1.7. That
state is intended. The three Phase 2 files do not exist before task 2.1,
2.2, and 2.3. From then on they fail until their Green tasks. The four
guard groups G1 to G4 pass at the base by design, and the new print-audit
page cases in `preview-gate.test.ts` fail.

The five Phase 3 files do not exist before tasks 3.1 to 3.5. Each one fails
on the absent module until its Green task. No Phase 3 case passes at the
base (section 4.3). The Phase 1 and Phase 2 files stay green and are not
part of the Phase 3 gate. The untracked
`harness/model-guide/data/sets/mg-2026-11a.json` of task 3.15 is intended
and is not committed there.

No role edits a test to reach a green aggregate run. The aggregate suite is
not a gate for Phase 1 or Phase 2; the gate is the targeted lines of
section 2. If a full-suite run happens after 22:00, a failure outside these
files is recorded in `measure/runs/model_guide/` and sent to the
orchestrator. It does not block the phase. A failure inside these files
blocks the phase. Before 22:00, a role runs one file at a time with
`--maxWorkers=1`.

## 9. Review applicability

| Phase | Review B security | Review C UX/API | Adversarial testing | UX browser review |
|---|---|---|---|---|
| 1 | yes: publish gate, no `docs/` write, no real export bytes in the repo | yes: CLI exit codes of `real-work.ts`, `preview.sh`, `publish.ts` | yes: malformed export, drift, approval shortcuts | yes: section 9.1 |
| 2 | yes: no book text, no page, no file name in the print-audit data; no real hand-off byte in the repo; `update.sh` writes two explicit paths | yes: `guide.ts` output shape and its `--today` value, `update.sh` paths and exit codes, the HTML escape of a hand-off name | yes: changed byte, wrong manifest SHA, missing top key, 51 rows, stale boundary, incomplete route, hostile name, empty sources | yes: section 9.2: the overview table and the print-audit block |
| 3 | yes: leak check, score-file fields, no token or private path in the repo | yes for the API: subcommand names, exit codes, manifest and score field sets, the `--private` flag; no for UX | yes: wrong line, wrong class, judge disagreement, 31 findings, invalid JSON, hostile `set_id` | no: section 9.3 |
| 4 | yes: credentials, quota, metered refusal | no: no product route | yes: quota states, retries, region block, value scan | yes: `review.html` |
| 5 | yes: approval record, drift, explicit paths | no: no new CLI | yes: missing approval, wrong SHA, drift | yes: the published pages |

### 9.1 Phase 1 browser review

It applies. The page is new, and it shows rates, marks, and a method note.
The preview folder is `.tmp/model-guide-preview/`. `preview.sh` copies
`docs/` into it, so `assets/css/site.css` resolves. Start a static server
in the repo root:

```bash
python3 -m http.server 8766 --bind 127.0.0.1 --directory .tmp/model-guide-preview
```

Set `PROJECT_DEV_URL=http://127.0.0.1:8766/real-work.html`. Use this URL
when the page loads `real-work.json` with `fetch`. When the page inlines its
data, the path `file:///home/daniebo/Desktop/lending-desk-bench/.tmp/model-guide-preview/real-work.html`
also works; use the server URL as the default. Check widths of 1280 px and
390 px. Check that each rate shows its run count, that the `few runs` mark
is a word, that the producer and checker tables are separate, and that the
page needs no horizontal scroll at 390 px.

### 9.2 Phase 2 browser review

It applies. The phase changes two pages.

- **The overview table on `index.html`.** Open
  `http://127.0.0.1:8766/index.html`. Check that the table is the first
  block above the hero, that it holds the six rows in order, and that each
  row shows a pick or `no pick yet: not enough evidence`, an evidence cell,
  and a date. Check 1280 px and 390 px. The table must need no horizontal
  scroll at 390 px: it either stacks or scrolls inside its own box. Check
  that a `few runs` pick is not shown as a pick.
- **The print-audit block on `real-work.html`.** Open
  `http://127.0.0.1:8766/real-work.html`. Check that the block shows 52, 13,
  `11 of 13`, `13 of 13`, the error types with counts, the bias note, and
  the line that this is one calibration run and not a rank. Check that the
  block holds no book text, no page, and no file name, and that the
  placeholder line is absent. Check 1280 px and 390 px.

A page change needs this check, per UX round 1 item U1. The Review C role
runs it and records the two widths. A missing 390 px check blocks the
phase.

### 9.3 Phase 3 review reasons

- **Review A applies.** The five tools are the product of the phase. A code
  review reads them against spec D4 to D13 and D22.
- **Review B (security) applies.** The phase owns the secrecy rule of D9:
  the leak check, no token in argv or in a log line, no private folder path
  in the repository, and no network edge except the fake `gh`.
- **Review C (UX/API) applies at the API only.** The CLI subcommand names,
  the exit codes, the manifest and score field sets, and the `--private`
  flag are a contract. The score file becomes the Phase 4 page input, so a
  field error here becomes a page contract there. The phase adds no page, so
  the UX part does not apply.
- **Adversarial testing applies.** It covers a wrong line, a wrong class, a
  judge disagreement, a duplicate finding, 31 findings, invalid JSON, a
  hostile `set_id` such as `../x`, a key with a `__proto__` name, and a
  nested key field in the manifest.
- **The UX browser review does not apply.** Phase 3 adds no page and
  changes no page byte. The preview of task 2.9 is unchanged, and no score
  file lands in the repository during the phase, so the code review row of
  the Phase 2 table cannot move. The first page that reads the score file is
  `review.html` in Phase 4 (spec D13, FR-14); the manifest counts reach a
  page there too. If a Green role changes `preview.sh` or a template, the
  browser review becomes required, in the form of section 9.2.

## 10. Anti-pattern coverage

A1 and A8 are retired. A9 and A10 do not apply now: no track is archived,
and the repo has no `measure/generate.sh` and no `.git/hooks/pre-commit`.
A12 does not apply to Phase 2 or Phase 3: no task of either phase is `[b]`,
so no closeout-candidate reading can go wrong.

| Phase | Anti-pattern | Defense | Falsification |
|---|---|---|---|
| 1 | A2, adapted: approval-blind publish gate | P3 requires exit 2 without an approval record and with a wrong SHA-256 | Delete the approval read. P3 must fail. |
| 1 | A3 digit-only count | Gates parse the labeled `Tests  N passed` line. Page checks compare computed cells, not digits. | Replace a cell check with a digit search. The case must pass on an empty page; then the guard is gone. |
| 1 | A4 vacuous pass | P2 and P3 assert "writes nothing". M5 requires a mark on 9 and no mark on 10. | Empty the fixture. M1 to M6 must fail, not pass. |
| 1 | A5 false plan claim | A plan line quotes the labeled line and its command. | Run the cited line. A non-zero exit with an `[x]` mark is a false claim. |
| 1 | A11 inherited environment | Tests pin the temp root and read no `BENCH_TRACK`. Run `real-work.test.ts` once with `BENCH_TRACK=change`. | Set `BENCH_TRACK=change`. The verdict must not move. |
| 1 | A13 ignored artifact | `.tmp/` is ignored. Every snapshot compares SHA-256 values inside the test, not `git diff`. | Change one byte in the temp `docs/`. P2 must fail. |
| 1 | A14 stale registry note | The orchestrator moves the registry note after the phase commit. | Compare the registry note with the first open plan task. |
| 2 | A2, adapted: approval-blind weekly writer | U1 requires the preview folder and a byte-identical `docs/` before the approval. U2 requires the approval record and the two explicit paths. | Delete the approval read from `update.sh`. U1 must fail. Stage `docs/`. U2 must fail. |
| 2 | A3 digit-only count | Gates parse `Tests  N passed`. The page checks compare a labeled value: `1,285` next to `runs`, ` (n=<int>)` from the JSON, `38.9 %`. No bare digit search. | Replace a cell check with a digit search. The case must pass on an empty page. |
| 2 | A4 vacuous pass | G1 to G4 use the sentinel fixture (2026-10-20, 1,285) and the JSON count. T5 requires a real "no pick yet". N2 requires four refusals. | Hardcode the page date or the run count. G1 to G4 must fail. Empty the guide inputs. T2 and T5 must fail, not pass. |
| 2 | A5 false plan claim | Task 2.1 lists both test files after the plan change. Each task cites its command and its labeled line. Task 2.9 cites the preview path and the shown values. | Run the cited line. A non-zero exit with an `[x]` mark is a false claim. A 2.1 `[x]` with one test file named is a false claim. |
| 2 | A7 over-broad filter | The `pages`/`text`/`file` scan reads exact key names at any depth. It does not match bare words. | Add a key named `text`. N3 must fail. Put the word "text" in a value. N3 must pass. |
| 2 | A11 inherited environment | The guide tests pin `--today` and the temp root, and read no `BENCH_TRACK`. Run `guide.test.ts` once with `BENCH_TRACK=change`. | Set `BENCH_TRACK=change`. The verdict must not move. Set no `--today`. T6 must fail. |
| 2 | A13 ignored artifact | `.tmp/` is ignored. U1 and U3 compare hashes of the temp tree inside the test, not `git diff`. | Change one byte in the temp `docs/`. U1 must fail. |
| 2 | A14 stale registry note | The orchestrator moves the registry note after the Phase 2 commit. | Compare the registry note with the first open Phase 2 task. |
| 3 | A2, adapted: a public-fact write with no leak gate | The manifest and the score file are the only public writes, and the lint plus `leak-check.ts` gate them. K2 to K5 fail on a key field, the private path, or a seeded line. | Remove the leak check from the path before a track A data commit. A key field in the manifest must fail the gate. |
| 3 | A3 digit-only count | Every count is a labeled integer: `blockers_found`, `summary.key.blockers`, `Tests  N passed`. The score is a parsed number with one decimal. | Replace a count check with a bare digit search. It must pass on an empty object. |
| 3 | A4 vacuous pass | No Phase 3 case passes at the base. A wrong line or a wrong class never counts as found. An invalid review has 0 found and 0 false claims. K1 proves the clean tree is a real tree. | Add a verdict that rescues a wrong-line finding, or empty the key. R1, R2, and J4 must fail, not pass. |
| 3 | A5 false plan claim | Each Red and Green task cites its single-file command and its labeled line. Task 3.15 says "do not commit", and the gate allows the two untracked set manifests. | Run the cited line. A non-zero exit with an `[x]` mark is a false claim. A committed manifest at 3.15 is a false claim. |
| 3 | A6 registry overstatement | No "complete" status before the lint exits 0 and checker 3.12 passes. | Compare the registry note with the first open Phase 3 task. |
| 3 | A7 over-broad filter | The field scans match exact key names at any depth and the exact private path. Prose does not fail. The `harness/package.json` exclude list is frozen. | Widen K4 to the bare word "witness". It must still pass on prose and fail on the field. |
| 3 | A11 inherited environment | `--private` is explicit, `TZ` is pinned, the date is explicit, and the fake `gh` is first on `PATH`. Run each file once with `BENCH_TRACK=change`. | Set `BENCH_TRACK=change`. The verdict must not move. |
| 3 | A13 ignored artifact | The private root is a `mkdtemp` folder. The tests compare SHA-256 values inside the test, not with `git diff`. | Change one byte of the seeded diff. S2 and R1 must fail. |
| 3 | A14 stale registry note | The orchestrator moves the registry note after the Phase 3 commit. | Compare the note with the first open Phase 3 task. |
| 4 | A3, A4 | A window at 70 % gives no call. Three transport failures leave the pass open and not complete. | Count an open pass as complete. The rank case must fail. |
| 4 | A7, A11, A12 | The route filter reads `routes.json`, not a word match. The fake child holds `fake-opencode`. A `[b]` task is not a closeout candidate. | Add a route outside `routes.json`. The runner must refuse it. |
| 4 | A13 | `ps` shows no fake child after the run, and the temp tree is clean. | Leave one fake child. The trap case must fail. |
| 5 | A2, A5 | The publish runs only with the record, and the commit holds explicit paths. | Publish with no record. It must exit 2. |
| 5 | A13, A14 | The drift check hashes each current `docs/` file. The registry note names the publish state. | Change one `docs/` file after the preview. Publish must exit 2 and name it. |

## 11. `phase_base_sha` capture point

The orchestrator captures `phase_base_sha` directly after the commit that
adds this strategy file and closes Phase 0 tasks 0.2 and 0.3. The capture
runs before Red task 1.1 starts. A value that predates the strategy commit
is not valid.

```bash
git rev-parse HEAD            # -> phase_base_sha
```

The same rule holds for each later phase. For Phase 2, the orchestrator
captures the value directly after the commit `docs(model_guide): test
strategy for Phase 2`, and before Red task 2.1 starts. This file names no
value, because the value does not exist before that commit. The accepted
Phase 1 HEAD is the `role_base_sha` of this revision, not the Phase 2 base.

For Phase 3, the orchestrator captures the value directly after the commit
`docs(model_guide): test strategy for Phase 3 and Phase 2 records`, and
before Red task 3.1 starts. Run `git rev-parse HEAD` once, on that commit,
and store the value. The accepted Phase 2 HEAD, and the `role_base_sha` of
this revision, predate the strategy commit. Neither one is the Phase 3 base.

## 12. Evidence to record

Phase 1: task 1.1, 1.2, and 1.3 record the Red summary lines and the failed
test names. Task 1.4 to 1.7 record the green summary line and the
`git status --short docs/` output. Task 1.8 records the checker JSON path.
Task 1.9 records the five real values and the preview path.

Phase 2: task 2.1, 2.2, and 2.3 record the Red summary lines and the failed
test names in `red-2.1.txt`, `red-2.2.txt`, and `red-2.3.txt`. Task 2.1
also records the base result of G1 to G4 and the plan change for PA2-1.
Task 2.4 to 2.7 record the green summary line and the
`git status --short docs/` output. Task 2.8 records the checker JSON path.
Task 2.9 records the six rows, the picks or the "no pick yet" words, the
evidence dates, the print-audit values, and the preview path. The OD6 facts
for task 2.4 are the path
`~/Desktop/handoff/a23-print-audit-error-types/print-audit-error-types-v13.json`,
the SHA-256 `f52a7bbf0f4263a84a16dba02cb4ccf4c76b6f40d3e70110104ebbf6140a6e87`,
52 rows, 13 blockers, 43 rows with 1 to 3 checklist items, and 9 rows with
none. The strategy re-checked the hash on 2026-11-15; it matches.

Phase 3: tasks 3.1 to 3.5 record the Red summary lines, the exit codes, and
the failed test names in `red-3.1.txt` to `red-3.5.txt`. Task 3.1 also
records the `$FAKE_GH_LOG` lines of one run. Tasks 3.6 to 3.10 record the
Green summary line, the command, and `git status --short docs/`. Task 3.11
records the prompt file and the fact that no test reads it. Task 3.12
records the checker JSON path. Task 3.13 records the two candidate lists in
the private folder and the count of qualified commits for each. Tasks 3.14,
3.15, and 3.16 record the lint line, the manifest path, and the
`git status --porcelain -- harness/model-guide/data/sets/` line. The
strategy records the count rule of S4 as an assumption: D8 for
`mg-2026-11a`, the D13 pilot counts for `mg-2026-11p*`.
