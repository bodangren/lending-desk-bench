# Test strategy — model_guide

This strategy covers Phase 1 in full. It gives Phases 2 to 5 a short section,
so a later revision can extend it. Spec: `spec.md`. Plan: `plan.md`.
Anti-pattern catalog: `measure/anti-patterns.md`.

## 1. Risk of each phase

| Phase | Product | Risk | Reason |
|---|---|---|---|
| 1 Page B | `real-work.ts`, `real-work.html`, `preview.sh`, `publish.ts` | high | A new public data path and the publish gate land here. A wrong rate can become a pick. |
| 2 Print audit and table | `print-audit-2026-11.json`, `guide.ts`, `update.sh` | high | The table states a recommendation to the owner. The print-audit file comes from a hand-off. |
| 3 Review set and scorer | `pick-diffs.ts`, `review-set.ts`, `review-score.ts`, `adjudicate.ts`, `leak-check.ts` | high | A wrong score gives a wrong rank. A leak makes the set unusable. |
| 4 Runner and first results | `review-run.sh`, `quota.ts`, `provider-credential.sh`, `review.html` | critical | Live model calls, credentials, and quota spend. |
| 5 Publish | `publish-approval.md`, `publish.ts` run, weekly update | critical | A write under `docs/` reaches the public site on the next timer start (spec EV8). |

## 2. Gate commands

PM rule A-23 (2026-11-06): one test file at a time in the day, with
`--maxWorkers=1`. The full suite runs only after 22:00. An `index.lock`
error on a commit gets one more commit run.

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

Red command shape, one line at a time:

```bash
cd harness && npx vitest run model-guide-tests/print-audit.test.ts --configLoader native --maxWorkers=1
cd harness && npx vitest run model-guide-tests/guide.test.ts --configLoader native --maxWorkers=1
cd harness && npx vitest run model-guide-tests/update.test.ts --configLoader native --maxWorkers=1
```

Red task 2.1 owns the first line, 2.2 the second, 2.3 the third. Each line
fails on the Phase 1 HEAD. `GREEN_TEST_COMMAND` is the same three lines,
one per Green task 2.4, 2.5, and 2.7. Task 2.6 owns the second line.

Green gate: the three lines exit 0, and `git status --short docs/` prints
nothing. Closeout gate: same lines on the final HEAD, the task 2.8 checker
pass, and task 2.9 shows six table rows in
`.tmp/model-guide-preview/index.html`, above the hero, with a pick or "no
pick yet: not enough evidence", an evidence cell, and a date.

### 2.3 Phase 3

Risk: high.

Red command shape, one line at a time: `pick-diffs.test.ts`,
`review-set.test.ts`, `review-score.test.ts`, `adjudicate.test.ts`, and
`leak-check.test.ts`, each with `--configLoader native --maxWorkers=1`.
Red tasks 3.1 to 3.5 own one file each. `GREEN_TEST_COMMAND` is the same
lines, one per Green task 3.6 to 3.10; task 3.11 carries no test file.

Green gate: each line exits 0. Closeout gate: same lines, the task 3.12
checker pass, task 3.13 writes the candidate lists to the private folder,
and task 3.14 and 3.16 `lint` passes. Tasks 3.13, 3.14, and 3.16 read the
network or start a model. They are not tests, and they run through
`heavy-run.sh`.

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
`harness/model-guide-tests/fixtures/`.

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
- No test reads the real `docs/`, the real hand-off file, the network, a
  model, or the private folder. One guard case scans the test folder for
  the hand-off folder name. The needle is built from two parts, so the
  guard does not match its own text.

## 4. Phase 1 test groups and falsification

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

Each group proves live behavior. A group that reads the fixture and asserts
the fixture against itself is vacuous and does not count (A4).

## 5. Architecture guardrails and changed contracts

- **No write under `docs/` before Phase 5** (spec D21). The preview tool
  writes the preview folder only. P2, the `git status --short docs/` check,
  and the closeout diff prove it.
- **Publish gate.** It refuses without an approval record, on a wrong
  SHA-256, and on drift (spec D21, FR-7). P3 and P4 prove the refusals.
- **Rank uses no rating** (spec D16). M3 proves it.
- **Work-type tables use only export data** (spec D16, D18). M4 proves it.
- **Merge joins only `#variant` and `[1m]` rows of one route** (owner
  decision Q5, OD4). M1 proves it.
- **Changed contracts.** The export schema `real-work-outcomes/1` is
  external. The tool refuses another schema; it does not adapt. The file
  `harness/provenance.ts` holds the `runner_sha256` and `suite_sha256`
  lists. No file of those lists changes. `docs/` belongs to the daily job
  (spec EV8). The worktree root below `harness/` is the only place that the
  tests write, and only in a temp folder.
- **Secrecy.** Phase 1 reads no key, no seeded diff, and no credential
  value. The page holds no finding text.

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

## 7. Artifact tests and live-behavior tests

- **Live behavior.** M1 to M6 call `real-work.ts`. I1 and I2 start the tool
  as a subprocess and read its exit code. P1 to P4 start `preview.sh` and
  `publish.ts` in a temp repo and compare the temp tree before and after.
- **Artifact assertions.** The nav, the method note, and the table header
  checks read bytes of the generated page. They prove that the generator
  ran and wrote the text. They do not prove that a browser renders the
  page. The browser review proves the rendering.
- **Live artifact check.** Task 1.9 reads the preview of the real export.
  It is an acceptance check on the real artifact, not a unit test.
- **No documentation test.** The method note is page output. A test that
  only reads a markdown file proves no product behavior and does not count.

## 8. Intentionally-red aggregate suite

The three test files exist from the Red tasks and fail until task 1.7. That
state is intended. No role edits a test to reach a green aggregate run. The
aggregate suite is not a gate for Phase 1; the gate is the targeted lines
of section 2.1. If a full-suite run happens after 22:00, a failure outside
these files is recorded in `measure/runs/model_guide/` and sent to the
orchestrator. It does not block Phase 1. A failure inside the three files
blocks the phase.

## 9. Review applicability

| Phase | Review B security | Review C UX/API | Adversarial testing | UX browser review |
|---|---|---|---|---|
| 1 | yes: publish gate, no `docs/` write, no real export bytes in the repo | yes: CLI exit codes of `real-work.ts`, `preview.sh`, `publish.ts` | yes: malformed export, drift, approval shortcuts | yes: see below |
| 2 | yes: no book text, no page, no file name in the print-audit data | yes: `guide.ts` output shape, `update.sh` paths | yes: stale table, empty source, drift | yes: table and print-audit block |
| 3 | yes: leak check, score file fields | no: no product route | yes: wrong line, wrong class, judge disagreement | no: no page in Phase 3 |
| 4 | yes: credentials, quota, metered refusal | no: no product route | yes: quota states, retries, region block, value scan | yes: `review.html` |
| 5 | yes: approval record, drift, explicit paths | no: no new CLI | yes: missing approval, wrong SHA, drift | yes: the published pages |

**Phase 1 browser review.** It applies. The page is new, and it shows
rates, marks, and a method note. The preview folder is
`.tmp/model-guide-preview/`. `preview.sh` copies `docs/` into it, so
`assets/css/site.css` resolves. Start a static server in the repo root:

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

## 10. Anti-pattern coverage

A1 and A8 are retired. A9 and A10 do not apply now: no track is archived,
and the repo has no `measure/generate.sh` and no `.git/hooks/pre-commit`.

| Phase | Anti-pattern | Defense | Falsification |
|---|---|---|---|
| 1 | A2, adapted: approval-blind publish gate | P3 requires exit 2 without an approval record and with a wrong SHA-256 | Delete the approval read. P3 must fail. |
| 1 | A3 digit-only count | Gates parse the labeled `Tests  N passed` line. Page checks compare computed cells, not digits. | Replace a cell check with a digit search. The case must pass on an empty page; then the guard is gone. |
| 1 | A4 vacuous pass | P2 and P3 assert "writes nothing". M5 requires a mark on 9 and no mark on 10. | Empty the fixture. M1 to M6 must fail, not pass. |
| 1 | A5 false plan claim | A plan line quotes the labeled line and its command. | Run the cited line. A non-zero exit with an `[x]` mark is a false claim. |
| 1 | A11 inherited environment | Tests pin the temp root and read no `BENCH_TRACK`. Run `real-work.test.ts` once with `BENCH_TRACK=change`. | Set `BENCH_TRACK=change`. The verdict must not move. |
| 1 | A13 ignored artifact | `.tmp/` is ignored. Every snapshot compares SHA-256 values inside the test, not `git diff`. | Change one byte in the temp `docs/`. P2 must fail. |
| 1 | A14 stale registry note | The orchestrator moves the registry note after the phase commit. | Compare the registry note with the first open plan task. |
| 2 | A2, A3, A4 | The input check of spec D17 refuses a wrong SHA-256, a missing top key, and a wrong `errors` count. `update.sh` writes only the two data files. | Remove one refusal. The refusal case must fail. |
| 2 | A11, A13 | The table test pins its input files. The `docs/` diff stays empty. | Change the input date only. The `stale` mark must move. |
| 3 | A2 and A7, secrecy | `leak-check.ts` test uses a staged file with a key field, the private path, and a 20-character seeded line. The filter matches exact field names, not bare words. | Add one exact key field. The leak check must fail. Add only the word "witness" in prose. It must not fail. |
| 3 | A4 | A wrong line and a wrong class never count as found. A score below 0 becomes 0. | Add a verdict that rescues a wrong-line finding. The case must fail. |
| 3 | A5, A11 | The score file holds no finding text. The test reads no environment value. | Run with `BENCH_TRACK=change`. The verdict must not move. |
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

The same rule holds for each later phase: capture the value after the
strategy revision commit of that phase, and before its first Red task.

## 12. Evidence to record

Task 1.1, 1.2, and 1.3 record the Red summary lines and the failed test
names. Task 1.4 to 1.7 record the green summary line and the
`git status --short docs/` output. Task 1.8 records the checker JSON path.
Task 1.9 records the five real values and the preview path.
