# Test strategy — model_guide

This file covers Phase 1, Phase 2, Phase 3, and Phase 4 in full. It gives
Phase 5 a short section, so a later revision can extend it. Spec:
`spec.md`. Plan: `plan.md`. Anti-pattern catalog:
`measure/anti-patterns.md`.

Revision 2 (2026-11-15) adds Phase 2. It folds in the Phase 1 lessons:
PA2-1 (page-level facts of page B), PA1-1 (empty states), UX U1 (390 px),
and B8-1 (hostile name).

Revision 3 (2026-11-16) adds Phase 3. It folds in the Phase 2 acceptance
records: nit P2A1-2 (the daily publish commits in the `docs/` range) and the
Q6 ruling (the print-audit block names the full routes).

Revision 4 (2026-11-16) adds Phase 4 and the Phase 3 records. Phase 4
carries live model calls, credentials, and quota. The revision folds in
three defects that the Phase 3 real runs found and no fake caught: a 26 MB
`gh` output over the 1 MiB `spawnSync` default (ENOBUFS), one transient
`gh` error that stopped a one hour run, and an environment wait value
(`NaN`, `Infinity`) that hung `Atomics.wait`. Each Phase 4 tool that calls a
live service gets a test of large output, a transient error with a bounded
retry, and a bad environment value. Each live call gets a timeout.

Revision 5 (2026-11-17) adds section 13: Phase 4 tasks 4.1e and 4.1f, the
page B data source (PM 2026-11-17). Section 13.5 lists the older page B cases
that it changes or retires.

## 1. Risk of each phase

| Phase | Product | Risk | Reason |
|---|---|---|---|
| 1 Page B | `real-work.ts`, `real-work.html`, `preview.sh`, `publish.ts` | high | A new public data path and the publish gate land here. A wrong rate can become a pick. |
| 2 Print audit and table | `print-audit-2026-11.json`, `guide.ts`, `update.sh`, `guide-section.html` | high | The table names a model to the owner, and `update.sh` gains the first path that writes `docs/` after an approval. The print-audit file comes from a hand-off. |
| 3 Review set and scorer | `pick-diffs.ts`, `review-set.ts`, `review-score.ts`, `adjudicate.ts`, `leak-check.ts` | high | A wrong match or a wrong weight gives a wrong rank. A leaked key (spec D9) cannot be withdrawn. The phase also writes the first public facts of track A. |
| 4 Runner and first results | `review-run.sh`, `quota.ts`, `provider-credential.sh`, `routes.json`, `pages/review.html` | critical | The phase starts live model calls, reads the host credential store, and spends plan quota. A metered call costs money. A value in a raw output cannot be withdrawn. A wrong quota read wastes a night of the only three nights before the date. |
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

Risk: critical. The phase starts live model calls, reads the host credential
store, and spends plan quota. A metered call costs money. A value in a raw
output cannot be withdrawn. A wrong quota read wastes a night of the three
nights that remain before the date.

The Red lines run one at a time. Each line exits non-zero on the phase base
HEAD, because the module under test, or the case, is absent:

```bash
cd harness && npx vitest run model-guide-tests/review-run.test.ts --configLoader native --maxWorkers=1 --reporter=dot
cd harness && npx vitest run model-guide-tests/quota.test.ts --configLoader native --maxWorkers=1 --reporter=dot
cd harness && npx vitest run model-guide-tests/credential-provider.test.ts --configLoader native --maxWorkers=1 --reporter=dot
cd harness && npx vitest run model-guide-tests/preview-gate.test.ts --configLoader native --maxWorkers=1 --reporter=dot
```

The gate for `judge-run.test.ts` (task 4.13b) and `quota.test.ts` (task
4.4) is `cd harness && npx vitest run
model-guide-tests/<file>.test.ts --configLoader native --maxWorkers=1
--reporter=dot`. `bun test` times out J14b and Q5 on its 5 s cap.

Owners of the Red lines:

- Task 4.1 owns line 1, the fake `opencode`, and the one expected Mid Red
  gate deviation of section 3.4.
- Task 4.2 owns line 2. It commits no fixture.
- Task 4.3 owns line 3. It commits no fixture.
- Task 4.8a owns line 4. It adds the page cases V1 to V9 to
  `preview-gate.test.ts` and no other file. Task 4.8a is a plan change of
  section 6.2.

Each Red role records the failed test names in
`measure/runs/model_guide/red-4.1.txt`, `red-4.2.txt`, `red-4.3.txt`, and
`red-4.8a.txt`.

`GREEN_TEST_COMMAND` is the same four lines, one line at a time:

- Task 4.4 owns line 2.
- Task 4.5 owns lines 1, 2, and 3. `routes.json` has no test of its own, so
  the three Phase 4 files prove it.
- Task 4.6 owns line 3.
- Task 4.7 owns line 1.
- Task 4.8 owns line 4, and the three page files of Phases 1 and 2:
  `real-work.test.ts`, `guide.test.ts`, and `update.test.ts`.
- Task 4.9 owns no line. It is the checker.
- Tasks 4.10 to 4.14 own no line. They read the network or start a model,
  and they run through `heavy-run.sh`.

**Green gate.** Each cited line exits 0 on the task HEAD, with a labeled
`Tests  N passed` line (A3). Task 4.7 and task 4.8 also run
`git status --short docs/`, and it prints nothing. Every Green task runs
`ps -eo pid,args | grep '[f]ake-opencode'`, and it prints no line. Task 4.9
has a checker status of pass, or each blocking finding has a fix commit.

**Closeout gate.** On the final phase HEAD:

1. The four lines of `GREEN_TEST_COMMAND` exit 0.
2. `ps -eo pid,args | grep '[f]ake-opencode'` prints no line.
3. `git status --short docs/` prints nothing.
4. The `docs/` range check of section 2.2 item 3 prints nothing.
5. `git diff --stat <phase_base_sha>..HEAD -- harness/opencode-credential.sh harness/opencode-host.sh harness/provenance.ts harness/tests`
   prints nothing (spec D14, `harness/provenance.ts:71`). The checker reads
   the `test:meta:logic` exclude list of `harness/package.json` and confirms
   that it did not grow (A7).
6. `harness/model-guide/routes.json` holds the six rows of spec D12 in
   order, each with `family`, `route`, `kind`, `quota_provider`, and
   `quota_source`, and it holds no judge row: the judge routes live in
   `harness/model-guide/judges.json`, and the D11 fallback is "no ready
   route". The Hy row is present. No route of the file has `kind` `metered`.
7. Task 4.9 shows `measure/runs/model_guide/check-4.9.json` with status
   pass.
8. The Phase 1 to Phase 3 regression set passes, one file at a time:
   `real-work.test.ts`, `input-check.test.ts`, `preview-gate.test.ts`,
   `print-audit.test.ts`, `guide.test.ts`, `update.test.ts`,
   `pick-diffs.test.ts`, `review-set.test.ts`, `review-score.test.ts`,
   `adjudicate.test.ts`, and `leak-check.test.ts`.
9. `leak-check.ts` exits 0 on the final tree with `--private <dir>` and
   `--preview .tmp/model-guide-preview`. The only committed track A data
   files are `harness/model-guide/data/sets/mg-2026-11a.json` and
   `harness/model-guide/data/review-scores/mg-2026-11a.json`, each in its
   own commit with an explicit path, and each commit comes after the
   adjudication apply of task 4.13 (spec D9).
10. The records of tasks 4.10 to 4.14 exist: `probe-4.10.txt`,
    `passes-4.12.txt`, `pilot-4.11.txt`, `adjudicate-4.13.txt`, and the
    preview facts of task 4.14.

No Phase 4 test calls a model, reads the real shared store, or sends a
packet off the loopback interface. The closeout gate names explicit paths,
because the tracks `daily_model_schedule` and the nightly publish commit on
`main`.

Red and Green routes (recommendation only, the orchestrator picks): Red
`bailian-token-plan/qwen3.8-max#high`; Green
`opencode-go/muse-spark-1.3-contributor#high`. A role run is not a track A
pass, so a ranked route may serve a role (section 9.4).

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

### 3.4 Phase 4 fixtures and fakes

Phase 4 commits one fixture and writes every other fake as a temp script.
The reason is the Mid Red gate rule: `non_test_paths` in
`measure_interphase_checks.py` counts each committed path without a `.test.`
suffix and outside a `tests/` segment as a non-test file. Red 3.13c and
3.13e avoided the rule with temp fake scripts that the test writes.

**The one committed fixture: `fixtures/fakes/fake-opencode`.**

- It is a Bash executable with mode 0755. It reads `$FAKE_OPENCODE_SPEC`,
  a JSON file that the test writes. The spec holds one entry per call: the
  exit code, the stderr line, the number of stdout bytes, a pad byte count,
  a sleep in seconds, and the value string to print.
- It appends to `$FAKE_OPENCODE_LOG` its argv, the text of the file that
  `$OPENCODE_CONFIG` names, and the value of `$BENCH_OPENCODE_JOB`. It
  writes each line once, so a retry shows as a second line.
- It prints a canned JSON line on stdout, for example
  `{"type":"result","text":"..."}`.
- The test copies it to `<temp>/bin/fake-opencode` and sets
  `BENCH_OPENCODE_BIN` to that path. The path holds the text `fake-opencode`,
  so the `ps` case of task 4.1 finds a live child. `harness/opencode-host.sh`
  reads `BENCH_OPENCODE_BIN` (line 187) and `harness/opencode-credential.sh`
  reads it too (line 47), so the fake serves both.
- **Why committed.** The plan line of task 4.1 names the file, and the
  `ps -eo pid,args` case needs a stable argv text and an executable with a
  mode bit that the test does not build.
- **The expected Mid Red gate deviation.** Red 4.1 records one line in
  `red-4.1.txt`: `- harness/model-guide-tests/fixtures/fakes/fake-opencode`,
  with the reason "plan task 4.1 names this file; no product code reads it".
  The orchestrator accepts this one line and no other. Red 4.2, Red 4.3, and
  Red 4.8a commit no fixture, so their gate output holds no deviation.

**Temp fakes only (no committed file).**

- **The quota source.** A `node:http` server that the test starts on
  `127.0.0.1:0`. The test calls `quota.ts` with `--base http://127.0.0.1:<port>`,
  and it sets `BENCH_QUOTA_BASE` for `review-run.sh`. The precedent is
  `BENCH_DAILY_QUOTA_CMD` of `harness/cron-daily.sh:509`. The server logs
  each request path, so the test asserts the exact `/api/quota/<id>` value
  of each provider.
- **The port source.** A temp `openchamber` stub on `PATH` that prints
  `{"instances":[{"port":<port>}]}`, in the shape that
  `harness/cron-daily.sh:515` parses. The test writes it with
  `writeFileSync` and `chmodSync(0o755)`, as `pick-diffs.test.ts:445` does
  for its flaky `gh`.
- **The credential store.** A temp `opencode` stub through
  `BENCH_OPENCODE_BIN` that prints a small `auth export` JSON array with
  three entries: two providers and one entry of another kind. The job folder
  is a temp folder through `BENCH_OPENCODE_HOME`. The real home and the real
  shared store are never read.
- **The set and the keys.** Three temp diffs, each with a two-plant key, in
  the `model-guide-key/1` shape of spec D7. The tests never read
  `mg-2026-11a` or `mg-2026-11p`.
- **The page data.** The page cases V1 to V9 build the score document inline
  in `preview-gate.test.ts`, as that file builds `INDEX_HTML` inline. No new
  fixture file, so the line of task 4.8a stays true. The Phase 2 file
  `fixtures/review-scores-mini.json` stays unchanged, because `guide.test.ts`
  reads it.

**Temp repo.** Each case of `review-run.test.ts` builds a temp repo the way
`harness/schedule-tests/rescore-guard.test.ts:71` does: `mkdtempSync`, a
`harness/` folder with copies of `review-run.sh`, `quota.ts`,
`provider-credential.sh`, `opencode-host.sh`, `opencode-credential.sh`, and
its own `harness/model-guide/routes.json`, a `docs/` tree, a `bin/` folder
with the fake, a `git init`, and a private `mkdtemp` folder. The job folder
lands in `<temp repo>/.tmp/`, because `opencode_host_begin` builds it under
`OPENCODE_HOST_ROOT` (`harness/opencode-host.sh:154`).

**Environment.** Every Phase 4 test sets `HOME`, `XDG_CONFIG_HOME`,
`XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `XDG_RUNTIME_DIR`,
`TMPDIR`, and `TZ` inside its temp folder, and it clears `BENCH_TRACK`
(spec A11). No test reads the real home folder.

**No network.** The only socket is the loopback server of the quota case. No
test calls `opencode`, `openchamber`, `curl`, `gh`, or a model.

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

### 4.4 Phase 4

Three files start at the phase base. The fourth set of cases lands in the
Phase 1 and 2 file `preview-gate.test.ts`. The runner rows R1 to R15 cover
every case of plan task 4.1, plus the three Phase 3 lesson cases: a large
output (R10), a transient error with a bounded retry (R7), and a bad
environment value (R8). Each live call has a timeout (R14, Q5).

| Group | File | What it proves | Falsification condition |
|---|---|---|---|
| R1 Pass shape | `review-run.test.ts` | A pass of a `plan` route with every window below 70 % calls the fake once for each diff of the set, stores one raw output for each diff in the private folder only, and writes one pass record with the state `open` or complete. | Skip one diff, or write one raw output outside the private folder. R1 must fail. |
| R2 Call shape | same file | Each call is `run --standalone --format json --model <route>`, and `$FAKE_OPENCODE_LOG` holds those five parts in that order for each call. | Drop `--standalone`, or put the model before the flags. R2 must fail. |
| R3 Deny list | same file | The job config that `$OPENCODE_CONFIG` names lists `read`, `edit`, `bash`, `webfetch`, `websearch`, `question`, `subagent`, and `skill`, each with the effect `deny`. The fake copies the config text into its log. | Remove one name, or set its effect to `allow`. R3 must fail, and the missing name is in the failure line. |
| R4 Route refusal | same file | A route that `routes.json` does not hold gives exit 2, one named line, an empty fake log, and no pass record. A route whose `kind` is `metered` (the temp file holds `deepseek/deepseek-flash#high`) gives the same result. | Accept any route name, or read a rank list in place of `routes.json` (A7). R4 must fail. |
| R5 70 % start | same file | A window at 70 % at the start gives no call, no raw output, and the state `wait`. At 69.9 % the pass starts. | Compare with `>` in place of `>=`, or start the pass and stop it after one call. R5 must fail at 70 %. |
| R6 80 % stop | same file | A window that reaches 80 % after the second diff stops the pass. The pass record holds the state `open`, the two stored outputs, and no complete marker. At 79 % the pass runs to the end. | Stop only at 100 %, or mark the pass complete. R6 must fail. |
| R7 Transient retry | same file | Two failures then one success give three log lines for the same diff, and the pass completes. Three failures give three lines, and the pass stays `open` and not complete. The retry wait is the pinned bounded base. | Retry a fourth time, or count a third failure as a model result. R7 must fail. |
| R8 Bad wait value | same file | `MG_RUN_RETRY_WAIT_MS` with `NaN`, `Infinity`, `-1`, and `1e999` gives the bounded base, or exit 2 with one named line. Each case ends inside the 20 s `spawnSync` timeout. | Pass the value to `Atomics.wait` without a bound. The case times out and fails (Phase 3 record 3). |
| R9 Value scan | same file | A raw output that holds a value of `provider-credential.sh scan-values` is deleted. The pass stops with one named line, and no copy of the value stays in the private folder or in the log file. | Store the output before the scan, or skip the scan. R9 must fail, and the test greps the whole temp tree for the value. |
| R10 Large output | same file | A 2 MiB raw output is stored whole, and a value in its last 1 000 bytes is found by the scan. | Cap the read at 1 MiB. The tail value escapes and R10 must fail (Phase 3 record 1). |
| R11 Region error | same file | A Go route whose stderr holds the region error of spec D22 ends with the state `region-blocked`, one stored error line, no raw output, and no rank for the night. The retry count stays at zero. | Treat the line as a transport error and retry three times, or leave the state `open`. R11 must fail. |
| R12 Trap | same file | A fake child that sleeps is stopped: `kill -0 <pid>` fails after the run, no `opencode-host-*` folder stays under `<temp repo>/.tmp/`, and `ps -eo pid,args \| grep '[f]ake-opencode'` prints no line. | Remove the trap, or use `kill -9` on the shell only. R12 must fail, and the child stays. |
| R13 No write | same file | The temp repo tree, with `.tmp/` excluded, is byte-identical after the run. The temp `docs/` tree is byte-identical. The private folder holds the outputs. | Write one file under the temp `docs/`, or write a pass record into the temp repo. R13 must fail. |
| R14 Call timeout | same file | The call timeout takes its value from `MG_CALL_TIMEOUT_S`, and its default is 600 s (spec D13). With 2 s and a fake that sleeps 30 s, the call ends as a transport error inside 10 s, and the trap still cleans. | Read the default from the wall clock only, or wait for the child. The case times out and fails. |
| R15 Path safety | same file | `--set ../x`, `--set a/b`, and `--route mega/../x` give exit 2 with one named line, and no folder appears outside the private root. | Join the value into a path without a check. A folder appears and R15 must fail. |
| Q1 Source path | `quota.test.ts` | Each provider of spec D15 reads `GET /api/quota/<id>` with the id of the table: `claude`, `kimi-for-coding`, `minimax-cn-coding-plan`, and `opencode-go`. The server log holds the four exact paths, and each read gives `ready`. | Use the provider name as the id, for example `claude-code`. Q1 must fail. |
| Q2 Thresholds | same file | 0, 40, and 69.9 give `ready`. 70, 70.1, and 100 give `wait`. Each value is a labeled number in the output. | Move the boundary to 71, or to 50. Q2 must fail. |
| Q3 Stopped cases | same file | A 500 answer, a limit error body, a closed port (read failure), `{"usage":{"windows":{}}}`, a window with no `usedPercent`, `usedPercent` as the string `"50"`, and `1e999` each give `stopped` with one named line. | Remove one branch, or accept a string value. Q3 must fail. |
| Q4 No source | same file | `nvidia`, `bailian-token-plan`, `volcengine-agent-plan`, and an `opencode` free route give the state `ready`, the label `cap` 1, and no request in the server log. | Read a URL for a provider with no source, or give the cap 3 (N of spec D13). Q4 must fail. |
| Q5 Read timeout | same file | A server that accepts the socket and never answers gives `stopped` with one named line inside 10 s. | Read without a timeout. The case times out and fails (Phase 3 record 3). |
| Q6 Large body | same file | A 2 MiB body with 200 windows is parsed, and the state follows the highest window. | Cap the body at 1 MiB. Q6 must fail. |
| Q7 Port source | same file | Without `--base`, the port comes from `openchamber status --json` through `instances[0].port`, in the shape of `harness/cron-daily.sh:515`. A port of 0, `"0"`, or 70000 gives `stopped`. | Hardcode 4096, or accept a port of 0. Q7 must fail. |
| Q8 Bad port output | same file | A stub that prints no JSON, invalid JSON, and an array in place of an object each give `stopped` with one named line, and no request. | Let an unparsable line reach `curl`. Q8 must fail. |
| C1 Seed one entry | `credential-provider.test.ts` | `provider-credential.sh seed <p>` writes exactly one entry into the temp job store, and it is the entry of `<p>`. The other two entries of the fake export stay out. Stdout is empty. | Import all entries, or print the payload. C1 must fail. |
| C2 Scan values | same file | `scan-values <p>` prints the access and orgID values of `<p>`, one per line, and it prints no value of another provider. It prints no `inert` line. The test compares the line count. | Print the access value only, or print every provider. C2 must fail. |
| C3 Provider with no entry | same file | A provider with no entry gives exit 2, one named line, no value on stdout, and a job store without a new entry. | Exit 0 with an empty store. C3 must fail. |
| C4 Transient export retry | same file | The first `auth export` call exits 1 with a notice on stderr, and the second prints the array. The seed exits 0, the log holds two calls, and `BENCH_CREDENTIAL_SEED_DELAYS=0` keeps the run short. | Run one call only, and C4 gives exit 2. C4 must fail. |
| C5 Bad env value | same file | `BENCH_CREDENTIAL_SEED_DELAYS=NaN`, `AGENT_TIMEOUT=Infinity`, and `AGENT_TIMEOUT=-1` each give exit 2 with one named line inside the 20 s timeout. | Let the value reach `sleep`. The case times out and fails (Phase 3 record 3). |
| C6 No value anywhere | same file | The value strings of the fake export appear in no file of the job folder, in no stderr line, and in no stdout line. The test greps the whole job folder. | Write the payload to a disk file (spec D14). C6 must fail. |
| C7 Large export | same file | A 2 MiB export with a long unknown field yields the same one-entry import. | Cap the read. C7 must fail (Phase 3 record 1). |
| V1 Page fields | `preview-gate.test.ts` | `review.html` holds the rank, the worst, median, and best score, the blocker recall, the false claims, the real defects, and the counts by class and severity of each route. Each number equals the value of the score document, and it is labeled. | Print a bare digit, or drop the median. V1 must fail. |
| V2 Incomplete | same file | A route with 2 complete passes shows the word `incomplete`, no rank number, and no worst score. | Rank two passes, or print `incomplete` as a boolean. V2 must fail. |
| V3 Provisional | same file | A pass with the state `provisional` stays complete, the route keeps its rank, and the page marks the pass `provisional`. | Drop the rank of a provisional route. V3 must fail. |
| V4 Pilot gate | same file | With `preview.sh --pilot-gate fail`, the page shows no rank for any route and one named line. With `pass`, or with no flag, it shows the rank. | Ignore the flag, and V4 must fail on the `fail` case. |
| V5 Set counts | same file | The page shows the manifest counts of the set: the diff count, the plant count, and the blocker count, each with its label, from `data/sets/<set_id>.json`. | Change one count in the temp manifest. The page cell must move. |
| V6 Method note | same file | The note names the set size, the weights 5, 2, and 1, the false-claim cost 2, N = 3, and the pilot gate. It is page output, not a markdown read. | Remove the note from the template. V6 must fail. |
| V7 No private field | same file | The page and `review.json` hold no `new_lines`, `witness`, `operator`, `file`, or line value, and no private folder path, at any depth. The scan reads exact key names (A7). | Add a `file` key to the page data. V7 must fail. A prose word must not fail. |
| V8 Nav link | same file | Each page of the preview holds one link to `./review.html` with the text `Review`, and one link to `./real-work.html`, and no duplicate. | Add the link twice, or drop it from one page. V8 must fail. |
| V9 No write | same file | The temp `docs/` tree is byte-identical after `preview.sh` runs with the review page. `preview-base.json` lists each copied `docs/` file. | Let `preview.sh` write `review.html` into the temp `docs/`. V9 must fail. |

**Notes on the Phase 4 groups.**

- **No base-passing guard.** All four Red lines fail at the phase base. The
  runner, the quota tool, and the credential helper do not exist, and
  `preview-gate.test.ts` fails on V1 to V9. No Phase 4 case passes at the
  base, so no claim rests on a vacuous pass (A4). The Phase 1 and Phase 2
  cases of `preview-gate.test.ts` must stay green through task 4.8a; the
  role reads the per-test lines, not only the exit code.
- **The lesson cases.** R8, R10, R14, Q5, Q6, C5, and C7 come from the three
  Phase 3 records. A later review that drops one of them must name the
  record that it refutes.
- **The 70 % and 80 % rules are two groups.** Q2 proves the state. R5 and R6
  prove that the runner obeys the state. One group without the other leaves
  a hole: a correct `wait` state that the runner ignores.
- **The cap of one pass.** R4 and Q4 prove the labels; the runner's count of
  one pass per night for a route with no source is R5's `cap` field plus the
  `passes-4.12.txt` record. No test proves the night boundary, because the
  test has no clock (section 7).
- **The artifact rows.** V6 reads bytes of the generated page, so it proves
  that the generator ran. It does not prove the rendering; section 9.4 does.

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
  (PA2-1). Task 4.1 owns the fake `opencode`; task 4.8a adds cases to
  `preview-gate.test.ts`, and it adds no fixture file.
- **The runner uses the host isolation and the host store rules** (spec D14).
  `review-run.sh` sources `harness/opencode-host.sh` and calls
  `opencode_host_begin model-guide` and the cleanup trap. It stores each raw
  output in the private folder only, and it scans the output before the
  store. R9, R12, and R13 prove the three rules. `harness/opencode-host.sh`
  and `harness/opencode-credential.sh` stay byte-identical, because
  `harness/provenance.ts:71` puts them in the `runner_sha256` list. The
  closeout gate reads that diff.
- **No metered route, and no paid spend** (spec D12, D15). `routes.json` holds
  `kind` `plan` or `free` only. The runner refuses every other value before
  the first call. R4 proves the refusal, and closeout gate item 6 reads the
  file.
- **The quota rules are two thresholds** (spec D15). A pass starts only at
  `ready`, which means every window is below 70 %. A window at 80 % stops
  the pass and leaves it open. Q2, R5, and R6 prove the three clauses.
- **`quota.ts` reads one endpoint shape** (spec D15, FR-15). The URL is
  `http://127.0.0.1:<port>/api/quota/<id>`, the port comes from
  `openchamber status --json`, and the value is
  `usage.windows.<window>.usedPercent`. It reuses the field rules of
  `guard_read` in `harness/cron-daily.sh:507`. The seams are `--base <url>`
  and `BENCH_QUOTA_BASE`, so a test reaches a loopback server and no test
  reads the live endpoint. A provider with no source makes no request, and
  it gets the fixed cap of 1 pass per night.
- **The region rule is a state, not a retry** (spec D22). A Go route with the
  region error gets the state `region-blocked` and no rank for the night.
  R11 proves it, and task 4.10 records it for each Go route of the probe.
- **The credential helper prints no value** (spec D14, FR-11). It reads the
  shared store once per job folder, imports only the entry of the named
  provider, and writes no payload to a disk file. C1, C2, and C6 prove the
  three rules. The retry rule is the one of
  `harness/opencode-credential.sh:38`, and C4 proves it.
- **`routes.json` is a public contract** (spec D12). Its fields are `family`,
  `route`, `kind`, `quota_provider`, `quota_source`, and `ranked`. The
  runner, the checker, and the page read the file. A new field, or a rename,
  is a contract change, and checker 4.9 must name it.
- **The review page reads the Phase 3 score fields** (spec D13, FR-14).
  `review.html` and `review.json` hold the fields `set_id`, `passes`,
  `routes`, the state words `complete`, `incomplete`, and `provisional`,
  and the numbers `worst`, `median`, `best`, `worst_blocker_recall`, `rank`,
  `false_claims`, `real_defects`, `by_class`, and `by_severity`. A rename is
  a new contract. V1 to V3 assert the words and the labels.
- **The pilot gate reaches the page** (spec D13, FR-14). The score file holds
  no pilot field, so `preview.sh` takes `--pilot-gate pass|fail`, with the
  default `pass`. V4 proves the `fail` case. The orchestrator passes the
  verdict of task 4.11.
- **The set manifest stays the page's set-count source** (spec D9, D13). The
  page shows the counts of `data/sets/<set_id>.json`. The manifest is
  committed after the adjudication apply only, and closeout gate item 9
  reads that order.
- **Parallel work on main.** The tracks `daily_model_schedule` and the
  nightly publish commit on `main`. Every gate names explicit paths or the
  `docs/` range rule of section 2.2. No gate is a whole-tree
  `git status --short`.

## 6. Plan changes and spec conflicts

### 6.1 The plan 1.2 conflict with spec D17

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

### 6.2 Phase 4 plan changes

Two plan changes are needed before the Red tasks of Phase 4 start. Each one
follows the PA2-1 pattern: the orchestrator widens the line first, and the
Red role records the change.

**Change 1: task 4.2 names a fixture folder that it does not write.** The
line says "and the fake quota scripts under
`harness/model-guide-tests/fixtures/fakes/`". The quota source is an HTTP
endpoint, so the better fake is an in-process `node:http` server on
`127.0.0.1:0` plus a temp `openchamber` stub. That keeps the test hermetic,
it adds no second Mid Red gate deviation, and it keeps the loopback socket
inside the test. Default: the orchestrator changes the phrase to "and the
temp fake quota source that the test writes". Red 4.2 records the new
wording in `red-4.2.txt`. Task 4.3 needs no change, because its line already
says "and no other file".

**Change 2: no Red task owns the review page (task 4.8).** Task 4.8 writes
`pages/review.html` and the `preview.sh` wiring as a Green task, and its
verify line reads "the test files of Phases 1 to 4 pass". No test asserted
the page, so an empty `review.html` would pass. The change is applied in the
commit that adds this strategy: plan.md gains one Red row `4.8a` before row
4.8, and the row reads:

    - [ ] 4.8a Red. The review page. Add the page cases V1 to V9 of
      `measure/tracks/model_guide/test-strategy.md` section 4.4 to
      `harness/model-guide-tests/preview-gate.test.ts`. Touch no other file.
      Verify: the V cases fail at HEAD, and the Phase 1 and Phase 2 cases of
      the file stay green. Record the failed test names in
      `measure/runs/model_guide/red-4.8a.txt`.

No checkbox of an existing task moves, and no existing task text changes
except the one phrase of change 1. The alternative was a phase acceptance of
the page by hand, with no test. The Red row is the default, because FR-14
carries real logic: the rank, the `incomplete` row, the `provisional` word,
and the pilot gate. Without a test, the strategy would hold a vacuous spot
(A4).

**Assumption A4-1: the pilot verdict reaches `preview.sh`.** The score file
of spec D13 holds no pilot field, and FR-14 says a set that fails the pilot
gate has no rank on the page. Default: `preview.sh` takes
`--pilot-gate pass|fail`, with the default `pass`. The orchestrator passes
the verdict of task 4.11. A later field in the score file would replace the
flag, and that change names a new contract (section 5).

**Assumption A4-2: the first judge must not be a ranked family.** Plan task
4.13 takes the first judge from `ra-quota pick`. The first judge reads the
seeded source diffs, so a family of spec D12 that judges before its own
ranked passes could recognize a plant. Default: when the pick gives a family
of D12, the orchestrator takes the next family of the pick order that is
outside D12, or ByteDance Doubao, or `openai/gpt-6.1-sol#high` with
`--allow-codex` as the last resort (Daniel, 2026-11-06). The orchestrator
records the choice in `adjudicate-4.13.txt`.

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

Phase 4 splits the same way, and the split matters more here than in any
earlier phase.

- **Live behavior, offline.** R1 to R15, Q1 to Q8, C1 to C7, and V1 to V9
  start real product files as subprocesses, or call them in process, and
  they read the exit code, the written JSON, and the raw output. The fakes
  replace `opencode`, `openchamber`, and the quota endpoint. No case calls a
  model.
- **Artifact assertions.** V6 reads bytes of the generated page. It proves
  that the generator ran and wrote the text. It does not prove the
  rendering; the browser review of section 9.4 does.
- **Live artifact check.** Task 4.10, task 4.11, and task 4.14 read the real
  artifacts. They are acceptance checks on a live run, not unit tests.
- **The pilot report is a check, not a test.** Task 4.11 writes the per-kind
  table of spec D13 into `measure/runs/model_guide/pilot-4.11.txt`. The
  phase acceptance role recomputes the two worst-of-2 spreads from
  `data/review-scores/mg-2026-11p.json` and the private source diffs with a
  one-off `node -e` run. The report fails the check when a field is absent,
  or when a recomputed number differs from the report. The script reads the
  private folder, so it runs as a plain script, never as a model session.
- **What only a live run of tasks 4.10 to 4.12 can prove.** No fake proves
  these seven facts, and the strategy does not claim them from a test:
  1. The real `opencode` binary accepts `run --standalone --format json
     --model <route>` for each family, and it prints a parseable stream. R2
     proves only the argv contract.
  2. The real host credential of a provider seeds a fresh job store, and it
     seeds no other provider entry. C1 proves the code path with a fake
     export.
  3. The live quota endpoint answers for `claude`, `kimi-for-coding`,
     `minimax-cn-coding-plan`, and `opencode-go`, and the port of the live
     `openchamber status --json` is the one that answers. Q1 and Q7 prove
     the parser only.
  4. The reachability states of spec D14 hold for each route, including the
     region error text of spec D22 for the Go routes. Task 4.10 proves it.
  5. A pass that starts at 02:00 ends before 06:00 +07 with the 14 diffs of
     the set, the 600 s call timeout, and the retry budget. No test has a
     clock.
  6. A real answer does not trip the value scan. R9 proves a hit on a planted
     value; a false positive on a real answer would stop every pass, and only
     task 4.12 shows it.
  7. A real seeded-diff prompt fits the model context, and the model returns
     the fenced JSON block of spec D10. The prompt file is an artifact
     (task 3.11); the live run proves its shape.

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

Phase 4 adds three files, and it adds cases to a fourth. `review-run.test.ts`
fails from Red 4.1 until Green 4.7, the longest red span of the track, so no
role may read that file as a signal of a broken tree. `quota.test.ts` fails
from Red 4.2 until Green 4.4, and `credential-provider.test.ts` fails from
Red 4.3 until Green 4.6.

`preview-gate.test.ts` holds a mixed state from Red 4.8a until Green 4.8. Its
Phase 1 and Phase 2 cases (P1 to P4, T1, T4, T5, T11, N4, and G1 to G4) must
stay green, and the nine V cases of section 4.4 fail. The file therefore
exits non-zero, and that exit is intended. Each role reads the per-test
result lines of the two groups, never only the exit code. Green 4.8 makes the
whole file green.

The date plan keeps this span short. Red 4.1 starts on 2026-11-16. Red 4.2,
Red 4.3, and Red 4.8a run on 2026-11-17. Green 4.4 to 4.8 run on 2026-11-18,
and the probe of task 4.10 runs in the window of the night 2026-11-18 to
2026-11-19. No red file may survive into the first pass night of
2026-11-20.

The untracked `harness/model-guide/data/sets/mg-2026-11a.json` stays
untracked through Phase 4 until the adjudication apply of task 4.13 commits
it with an explicit path. That state is intended, and no role stages it
early (spec D9).

No role edits a test to reach a green aggregate run. The aggregate suite is
not a gate for Phase 1, Phase 2, Phase 3, or Phase 4; the gate is the
targeted lines of section 2. If a full-suite run happens after 22:00, a
failure outside these files is recorded in `measure/runs/model_guide/` and
sent to the orchestrator. It does not block the phase. A failure inside these
files blocks the phase. Before 22:00, a role runs one file at a time with
`--maxWorkers=1`.

## 9. Review applicability

| Phase | Review B security | Review C UX/API | Adversarial testing | UX browser review |
|---|---|---|---|---|
| 1 | yes: publish gate, no `docs/` write, no real export bytes in the repo | yes: CLI exit codes of `real-work.ts`, `preview.sh`, `publish.ts` | yes: malformed export, drift, approval shortcuts | yes: section 9.1 |
| 2 | yes: no book text, no page, no file name in the print-audit data; no real hand-off byte in the repo; `update.sh` writes two explicit paths | yes: `guide.ts` output shape and its `--today` value, `update.sh` paths and exit codes, the HTML escape of a hand-off name | yes: changed byte, wrong manifest SHA, missing top key, 51 rows, stale boundary, incomplete route, hostile name, empty sources | yes: section 9.2: the overview table and the print-audit block |
| 3 | yes: leak check, score-file fields, no token or private path in the repo | yes for the API: subcommand names, exit codes, manifest and score field sets, the `--private` flag; no for UX | yes: wrong line, wrong class, judge disagreement, 31 findings, invalid JSON, hostile `set_id` | no: section 9.3 |
| 4 | yes: credentials, quota, metered refusal, the value scan, the private outputs, the trap | yes for the API: the `review-run.sh` flags and exit codes, the states `ready`, `wait`, `stopped`, and `region-blocked`, the `routes.json` fields, the `quota.ts` output, the `provider-credential.sh` subcommands, and `preview.sh --pilot-gate`; yes for UX on `review.html` | yes: quota states, retries, region block, value scan, hostile route and set values, large output, bad env value | yes: section 9.4, `review.html` |
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

### 9.4 Phase 4 review applicability and the secrecy rule

- **Review A applies.** The phase product is `review-run.sh`, `quota.ts`,
  `provider-credential.sh`, `routes.json`, and `pages/review.html`. The code
  review reads them against spec D12 to D15, D22, FR-11, FR-14, and FR-15.
- **Review B (security) applies, and it is the most important review of the
  phase.** It covers four rules. The runner imports only the entry of the
  named provider, and it writes no credential value to a disk file
  (spec D14). It scans each raw output before the store, and it deletes a
  hit. It stores raw outputs in the private folder only. It refuses a
  metered route before the first call, so no paid spend happens (spec D12).
- **Review C (UX/API) applies at the API and at the page.** At the API: the
  flags and exit codes of `review-run.sh`, `quota.ts`, and
  `provider-credential.sh`; the four state words; the `routes.json` field
  set; the `quota.ts` output fields `state` and `cap`; and
  `preview.sh --pilot-gate`. At the page: the structure of `review.html`.
- **Adversarial testing applies.** It covers these values and states: a
  window at exactly 70 % and at 69.9 %; a window that crosses 80 % in the
  middle of a pass; a quota body with no `usedPercent`, with a string value,
  and with `1e999`; a closed port; a server that never answers; a 2 MiB body;
  a 2 MiB raw output; a transient failure of 1, 2, and 3 calls; `NaN`,
  `Infinity`, `-1`, and `1e999` in each wait value; a region error on a
  non-Go route; a route name with `../`; a `--set` value with a slash; a fake
  child that ignores SIGTERM; a value string at the end of a large output;
  and a manifest count that differs from the set.
- **The UX browser review applies.** Task 4.8 adds `review.html`, so the
  page change needs the check of UX round 1 item U1. Start the server in the
  repo root and open `http://127.0.0.1:8766/review.html`:

  ```bash
  python3 -m http.server 8766 --bind 127.0.0.1 --directory .tmp/model-guide-preview
  ```

  Check 1280 px and 390 px. Check that the table shows the rank, the worst,
  median, and best score, the blocker recall, the false claims, the real
  defects, and the counts by class and severity, each with its label. Check
  that a route with fewer than 3 passes shows `incomplete` and no rank
  number, and that the code review row of `index.html` now shows a pick or
  the words `no pick yet: not enough evidence`. Check that the page needs no
  horizontal scroll at 390 px, that the nav holds one `Review` link, and that
  the method note is readable at 390 px. A missing 390 px check blocks the
  phase.
- **The checker of task 4.9 applies.** One code checker reads the diff
  against spec D12 to D15 and D22. It confirms the metered refusal, the
  70 % and 80 % rules, the state of each route, the region rule, the
  credential scan, the `routes.json` field set, and the page fields of
  section 5. A finding goes into `check-4.9.json` and into the handoff of the
  checker role.

**The secrecy rule for the audit roles.** Reviews A, B, and C, the
adversarial role, the phase acceptance role, and checker 4.9 read no file of
the private folder: no key, no seeded diff, no source diff, no raw output,
no adjudication note, and no verdict file. The reason is the one of spec D9
and D11: a model that reads a key can compute a plant, and a family of
spec D12 that reads a plant could find it in its own ranked pass.

- A role that reads no private file may run on any family.
- A role that reads one private file runs on a family outside D12. The
  allowed families are `openai/gpt-6.1-sol#high` with `--allow-codex` as the
  last resort (Daniel, 2026-11-06), ByteDance Doubao
  `volcengine-agent-plan/ark-code-latest` after 2026-11-22, and a family that
  the routes file marks `ranked: false`.
- The Phase 4 checks that need private data are task 4.13 (the two judges
  read the seeded source diffs and the queue, and the apply reads the keys)
  and task 4.14 (the score tool reads the keys and the raw outputs). The
  pilot report check of section 7 reads the private source diffs. All three
  run as scripts, or on a family outside D12, and never in the session of a
  ranked route.
- The probe file, the pass file, and the pilot report hold route names and
  error lines. They hold no key, no plant, and no credential value, so a
  review role may read them.

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
| 4 | A2, adapted: a pass that spends quota or money without a gate | R4 refuses a route outside `routes.json` and a route whose `kind` is `metered` before the first call. R5 starts no pass at 70 %. R6 stops a pass at 80 %. | Delete the `kind` check, or start a pass at 70 %. R4 or R5 must fail. |
| 4 | A3 digit-only count | Every number is labeled: `Tests  N passed`, `state: <word>`, `cap: 1`, `worst`, `median`, `best`, `blocker_recall`, `false_claims`, `real_defects`, and the `by_class` and `by_severity` keys. The state is a word, never a boolean. | Replace a state check with a digit or a truthy test. The case must pass on an empty record. |
| 4 | A4 vacuous pass | No Phase 4 case passes at the base. R6 requires the word `open` and no complete marker. V2 requires the word `incomplete` and no rank number. R9 greps the whole temp tree for the value. | Empty the fake log and the private folder. R1, R9, and V1 must fail, not pass. |
| 4 | A5 false plan claim | Each Red and Green task cites its line and its labeled summary. The two plan changes of section 6.2 change no checkbox of an existing task. Tasks 4.10 to 4.14 cite the record files they write. | Run the cited line. A non-zero exit with an `[x]` mark is a false claim. An empty `probe-4.10.txt` line is a false claim. |
| 4 | A6 registry overstatement | No "complete" status before the passes of task 4.12 exist and checker 4.9 passes. The page shows `incomplete` for a route with fewer than 3 passes (spec D13). | Compare the registry note with the first open Phase 4 task. |
| 4 | A7 over-broad filter | The route filter reads the `route` field of `routes.json`, never a word in a table. V7 and the leak check match exact key names. The `harness/package.json` exclude list is frozen. | Add a route name that holds the text of a ranked route as a substring. The runner must refuse it. |
| 4 | A11 inherited environment | Every test pins `HOME`, the `XDG_*` paths, `TMPDIR`, and `TZ`, and it clears `BENCH_TRACK`. The fake binaries are first on `PATH` or set through `BENCH_OPENCODE_BIN`. Run each file once with `BENCH_TRACK=change`. | Set `BENCH_TRACK=change`. The verdict must not move. Leave `HOME` unpinned. C6 must fail on the real store. |
| 4 | A12 checker and `[b]` task | No Phase 4 task is `[b]`. Task 5.2 is the only `[b]` task of the track, and it is in Phase 5. The orchestrator counts the `[b]` tasks by hand before it trusts a closeout candidate. | Read the status command. A closeout candidate with one `[b]` task is not ready. |
| 4 | A13 ignored artifact | `ps`, `kill -0`, and the folder check prove the trap, and they read the live process table, not `git diff`. `.tmp/` is ignored, so R13 compares a hash tree inside the test. | Leave one fake child, or write one file into the temp `docs/`. R12 or R13 must fail. |
| 4 | A14 stale registry note | The orchestrator moves the registry note after the Phase 4 commit, and the note names the first open task of the phase. | Compare the note with the first open Phase 4 task. |
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

For Phase 4, the orchestrator captures the value directly after the commit
`docs(model_guide): test strategy for Phase 4 and Phase 3 records`, and
before Red task 4.1 starts. Run `git rev-parse HEAD` once, on that commit,
and store the value.

```bash
git rev-parse HEAD            # -> phase_base_sha for Phase 4
```

The accepted Phase 3 HEAD `17c1069` and the `role_base_sha` of this revision,
`5feedcf32c118bead3632920b604fcc377ed7db3`, both predate the strategy
commit. Neither one is the Phase 4 base. A value that predates the strategy
commit fails closeout gate item 5, because the closeout diff would then hold
the strategy commit itself.

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

Phase 4, one block per task:

- **4.1, 4.2, 4.3, and 4.8a** record the command, the exit code, the failed
  test names, and the plan change of section 6.2 in `red-4.1.txt`,
  `red-4.2.txt`, `red-4.3.txt`, and `red-4.8a.txt`. Task 4.1 also records
  the one Mid Red gate line of section 3.4 and the `$FAKE_OPENCODE_LOG` lines
  of one run. Task 4.8a also records the per-test result lines of the Phase 1
  and Phase 2 cases, because the file as a whole is red.
- **4.4, 4.5, 4.6, 4.7, and 4.8** record the command, the labeled
  `Tests  N passed` line, the empty `git status --short docs/` output, and
  the empty `ps -eo pid,args | grep '[f]ake-opencode'` output. Task 4.7 also
  records the frozen-path diff of plan task 4.7, and task 4.8 the four page
  lines.
- **4.9** records the path `measure/runs/model_guide/check-4.9.json`, its
  status, and each blocking finding with its fix commit.
- **4.10** records one line for each route of `routes.json` in
  `probe-4.10.txt`: the route, the state `reachable`, `unreachable`, or
  `region-blocked`, the error line, the quota state at the start, and the
  date. The orchestrator sends each `unreachable` route to the PM (owner
  question Q8).
- **4.11** records `pilot-4.11.txt` with the two worst-of-2 scores of each
  pilot route, the found, missed, and false-claim counts, the per-kind table
  for the test-only diffs and the code diffs, the two spread values, the two
  gate rules, and the verdict. The acceptance role records the recomputation
  of the two spreads.
- **4.12** records `passes-4.12.txt`: one line for each route and each night,
  with the pass number, the state, and the score, or the reason
  `quota stop`, `region block`, or `open pass`.
- **4.13** records `adjudicate-4.13.txt`: the queue count, the two judge
  routes and their families, the count of agreed verdicts of each kind, the
  count of findings left out, the apply exit code, the second lint line, the
  leak-check exit code, and the manifest commit SHA. The first judge follows
  assumption A4-2 of section 6.2.
- **4.14** records the score file path, the leak-check exit code, its commit
  SHA, and the preview facts: the rank order, the worst score of each route,
  the `incomplete` rows, and the code review row of the table.

### 12.1 Phase 3 records

Phase 3 was accepted at `17c1069`
(`measure/runs/model_guide/phase-acceptance-17c1069.json`). The record holds
no blocking finding. The Phase 3 real runs found three defects that no fake
caught, and revision 4 of this strategy turns each one into a Phase 4 case:

1. **A 26 MB `gh` output over the 1 MiB `spawnSync` default (ENOBUFS).** The
   fix raised the output buffer (task 3.13b). The Phase 4 lesson: each tool
   that calls a live service gets a large-output case (R10, Q6, C7).
2. **One transient `gh` error that stopped a one hour run.** The fix added a
   bounded retry (task 3.13d). The Phase 4 lesson: each live call gets a
   bounded retry case (R7, C4).
3. **An environment wait value of `NaN` and `Infinity` that hung
   `Atomics.wait`.** The fix bounded the base of the wait (task 3.13f). The
   Phase 4 lesson: each wait value gets a bad-value case (R8, C5), and every
   spawn has a timeout (R14, Q5).

The Red tasks 3.13c and 3.13e wrote their fakes as temp scripts, because the
Mid Red gate counts a file under `fixtures/fakes/` as a non-test file. That
record is the reason for the single committed fixture and the recorded
deviation of section 3.4.

The Phase 3 records also fix two forms that Phase 4 must keep: the role log
`dispositions:` line takes only spec-review ids of the form `F<n>`, so an
audit finding goes into the handoff and never into that line; and a date in
a test or a record comes from a value, never from the wall clock.

## 13. Phase 4 tasks 4.1e and 4.1f: page B data source

Revision 5, 2026-11-17. This section covers Red task 4.1e and Green task 4.1f.
Source: spec D16 "Data source (PM 2026-11-17)" rules 1 to 11, D17, D18, FR-1 to
FR-5, and acceptance 2 to 5 and 13. The PM replaced the page B input on
2026-11-17. This section replaces the page B meaning of sections 3.1, 4.1, 4.2,
and 4.4 where section 13.5 says so. `phase_base_sha` stays
`57baaaa364f968a2f44c6e14eb96f8a9d68beebf`, the commit of the Phase 4
strategy. This section starts no new phase.

### 13.1 Risk, scope, and plan changes

Risk: task 4.1e is high. Task 4.1f is high. Phase 4 stays critical. The pair
starts no model, reads no credential, and spends no quota. The risk is the data
path. The data reaches a public page and later the overview table. A wrong
weight, a wrong filter, or a wrong date becomes a public pick.

| Risk | Cause | Covered by |
|---|---|---|
| RS1 | A wrong weight gives a plausible but wrong rate. | DS5 |
| RS2 | A null value counts as zero. | DS6 |
| RS3 | The pick ignores the minimum, `not allowed`, or the net score. | DS8, DS12, DS13 |
| RS4 | A top line reuses a table row and not the row of its role. | DS13 |
| RS5 | A wrong AA match gives a wrong net score and a wrong verdict right. | DS11 |
| RS6 | A data file changes and the tool still reads it, or the MANIFEST names a path outside its folder. | DS1, DS2, DS3 |
| RS7 | A route note is free text from role runs. The page and the leak check must treat it as hostile. | DS21, LG1 to LG3 |
| RS8 | The new input breaks the other test files and `guide.ts`. | 13.5, 13.8 |
| RS9 | The 390 px width rule needs a browser. | DS19, 13.9 |
| RS10 | The print-audit block keeps a raw route key. | DS20 |
| RS11 | A hardcoded date or count passes on the real files only. | DS18, FX1, FX3 |

**Plan changes.** The orchestrator widens the plan lines before Red 4.1e
starts (the PA2-1 pattern). The Red role records each change in `red-4.1e.txt`.
No checkbox of an existing task moves.

- **PC-1. Widen row 4.1e.** The row says "change only test files". Red 4.1e
  may change `input-check.test.ts`, `real-work.test.ts`,
  `preview-gate.test.ts`, `leak-check.test.ts`, `guide.test.ts`,
  `update.test.ts`, `adversarial.test.ts`, `adversarial-p2.test.ts`,
  `adversarial-p3.test.ts`, and the folder `fixtures/`. It changes no other
  file. The Verify line becomes: the cases of DS1 to DS21, the changed G
  cases, and the cases that only stage page B data fail at the base; the
  cases that need no page B data pass; LG1 to LG3 pass by design.
- **PC-2. Add rows 4.1g (Red) and 4.1h (Green) after 4.1f (default).** They
  move `guide.ts`, `update.sh`, and `pages/guide-section.html` to the new
  `real-work.json` and to the D18 source table. Reason: `guide.ts` refuses a
  `real-work.json` that has no `work_types` object, and `update.sh` still calls
  `real-work.ts --input`. Neither file is in the 4.1e or 4.1f row. Question
  Q-S11 holds the alternative.
- **PC-3. Widen row 4.1f Verify** to the Green gate of section 13.2.

### 13.2 Commands, owners, and gates

PM rule A-23 holds: one test file at a time, `--maxWorkers=1`, no full suite
before 22:00. Red 4.1e owns these lines. Run one line at a time:

```bash
cd harness && npx vitest run model-guide-tests/input-check.test.ts --configLoader native --maxWorkers=1 --reporter=dot
cd harness && npx vitest run model-guide-tests/real-work.test.ts --configLoader native --maxWorkers=1 --reporter=dot
cd harness && npx vitest run model-guide-tests/preview-gate.test.ts --configLoader native --maxWorkers=1 --reporter=dot
cd harness && npx vitest run model-guide-tests/leak-check.test.ts --configLoader native --maxWorkers=1 --reporter=dot
```

Lines 1 to 3 exit non-zero at the role base. Line 4 exits 0, because LG1 to
LG3 are base-passing guards (section 13.7). The files `guide.test.ts`,
`update.test.ts`, and the three `adversarial*.test.ts` files change only in
their page B staging helpers and the `update.sh` argument form. The Red role
runs each one time and records the per-test lines.

`red-4.1e.txt` holds five lists: the failed names grouped by DS id, the
base-passing guards, the cases that fail only because the CLI and the staging
changed, the cases tagged `[guide-bound]` (section 13.8), and the fixture
files that Red committed. Every Red case title starts with its group id, for
example `DS5: ...`. The Mid Red gate counts a file under
`harness/model-guide-tests/fixtures/` as a test path (`is_tests_fixture` in
`measure_interphase_checks.py`), so the new fixtures need no recorded
deviation. The Red role confirms this with the gate output and records any
other line.

**Green gate (task 4.1f).** Green changes no test file. All of these hold:

1. Lines 1, 2, and 4 exit 0, each with a labeled `Tests  N passed` line (A3).
2. Line 3 runs with the filter
   `-t '^(?!.*\[guide-bound\])'` and exits 0. A run without the filter fails
   exactly on the tagged names of `red-4.1e.txt`, and on no other name.
3. `bash -n harness/model-guide/preview.sh` exits 0.
4. `git status --short docs/` prints nothing.
5. `git diff --stat 57baaaa364f968a2f44c6e14eb96f8a9d68beebf..HEAD -- harness/provenance.ts harness/tests harness/opencode-host.sh harness/opencode-credential.sh`
   prints nothing.
6. The MANIFEST agrees with the files. This loop prints nothing:

   ```bash
   cd harness/model-guide/data && while read -r sha size name; do
     [ "$(sha256sum "$name" | cut -d' ' -f1)" = "$sha" ] \
       && [ "$(stat -c %s "$name")" = "$size" ] || echo "BAD $name"
   done < MANIFEST-2026-11-17.txt
   ```

7. Green stages the three files and the MANIFEST by explicit path, and
   `leak-check.ts` exits 0 before the commit (section 13.7). A finding stops
   Green. Green never edits a data file to pass the check.
8. The live check of section 13.9 holds on the real files.

**Data capture (task 4.1f).** Green creates the three files in
`harness/model-guide/data/`: the output of `ra-quota outcomes --json`, a copy of
the AA file, and a file with the two fields `allowedRoutes` and
`orchestratorRoutes` of `~/.config/ra-quota/routes.json`. Green writes the
MANIFEST after the capture, with the `sha256sum` and the byte size of each
file. Green adds a plain name to `model-names.json` only for a key of the real
outcomes file whose public name is sure. A key with no sure name stays unnamed.

**Closeout of the pair.** Three conditions hold. The Green gate holds. Reviews
A, B, C, the adversarial role, and the browser review of section 13.11 have a
status of pass, or each blocking finding has a fix commit. The red list of the
aggregate suite equals the `[guide-bound]` list (section 13.8).

**`phase_base_sha` and `role_base_sha`.** The Phase 4 base is already
captured. It is the commit of the Phase 4 strategy, `57baaaa364f968a2f44c6e14eb96f8a9d68beebf`,
and it stays. The orchestrator captures the `role_base_sha` of Red 4.1e with
one `git rev-parse HEAD`, directly after the commit
`measure(model_guide): strategy for page B data source (4.1e, 4.1f)` and before
Red 4.1e starts. The `role_base_sha` of Green 4.1f is the HEAD after the Red
commit. A value that predates this commit is not valid.

### 13.3 The synthetic fixture

All data is synthetic. Red commits four files under
`harness/model-guide-tests/fixtures/page-b/`. The sentinel date is
`2026-10-20`. A page that hardcodes `2026-11-17` fails on it.

- `ra-outcomes-2026-10-20.json`: a JSON array of the rows below. Each row holds
  the real fields: `route`, `role`, `runs`, `pass`, `fail`, `error`,
  `no_verdict`, `open`, `decided`, `coverage`, `ratings` (`{}`), `findings`,
  `escaped_findings`, `kind`, and for a producer `tasks`, `accepted`,
  `first_round_rate`, `mean_rework_rounds`, `cleanup_share`,
  `tokens_per_accepted`, and for a gate `escapes`.
- `aa-reliability-2026-10-20.json`: `schema`, `source.readDate`, `models`.
- `allowed-routes-2026-10-20.json`: `allowedRoutes` and `orchestratorRoutes`.
- `MANIFEST-2026-10-20.txt`: one line for each file, `<sha256>  <size>  <name>`,
  with two spaces between the fields. This is the `sha256sum` form with a size,
  the form that `real-work.ts` already reads as its fallback. The tool ignores
  every other line. The read date is the date in the MANIFEST name.

The tests never read the real dated files. Test helpers stage the fixtures into
`<temp repo>/fixture-b/`, mutate them in memory, and write a new MANIFEST with
a fresh SHA-256 and size (the `stageFixture` pattern of `preview-gate.test.ts`).
A tool-level case that wants a stale MANIFEST writes it by hand.

**Producer rows.** Columns: route, role, tasks/accepted, first-round rate,
rework, cleanup, tokens. `null` means a JSON null.

```
t1/prod-one#high                       green   10/8   .5   1.0   .2    300000
t1/prod-one[1m]#high                   red      5/2   1.0  0.0   0.0   500000
t1/prod-one#high (ra-quota pick; substitution for t1/x)
                                       green    5/5   .8   4.0   null  null
t1/prod-one#high                       record   3/0   null null  null  null
t1/prod-zero                           green    0/0   null null  null  null
t1/prod-two                            green   12/8   .5   1.0   .1    200000
t1/prod-two  (note here)               green    8/4   .5   1.0   .1    200000
t1/prod-three#high                     green   25/16  .5   1.0   .15   250000
t1/prod-four                           green    6/4   .5   0.5   .3    100000
t1/prod-five                           green    4/4   .75  0.2   0.0   90000
t1/prod-six                            green    5/2   .2   2.0   .5    400000
t1/prod-seven                          green    9/0   null null  null  null
t1/prod-eight                          green   30/28  .9   0.1   .05   150000
t1/prod-nine                           red      8/4   .25  1.0   .1    120000
t2/prod-two                            green   11/8   .6   0.3   .05   180000
t1/prod-strat                          strategy 6/6   .75  0.0   0.0   50000
```

**Gate rows.** Columns: route, role, decided (runs), pass, findings, escapes.
Each row has `fail` equal to decided minus pass and `error` 0. The `no_verdict`
and `open` counts fill `runs`.

```
t1/gate-one#high           review-a           6 (8)  5   9  1
t1/gate-one#low            review-a           4      4   2  0
t1/gate-one                review-b           5      3   5  2
t1/gate-two[1m]            review-a           7      7   3  0
t1/gate-two                spec-review        5      5   1  0
t1/gate-two                phase-acceptance   5      4   2  0
opencode/gate-three-free   review-a           6      6   0  0
t1/gate-four               review-a           9      9   4  1
t1/gate-five               review-a          20     20   1  0
t1/gate-six                review-c           7      7   0  0
t1/gate-seven              review-c           5      5   0  0
t1/gate-eight              adversarial        8      8   0  0
t1/gate-nine               adversarial       10     10   2  0
t1/gate-eleven             review-b           4      4   0  0
t1/gate-twelve             review-b           3 (9)  3   0  0  (no_verdict 3, open 3)
t1/"><img src=x onerror=alert(1)>   review-a  5      1   0  0
t1/__proto__               review-b           6      1   0  0
unknown                    review-a          50 (60) 50  7  0  (no_verdict 5, open 5)
unknown                    adversarial       30 (40) 30  3  0  (no_verdict 5, open 5)
```

**AA file.** The key is the AA model key. A value is `netScore`, and `byEffort`
and `aliases` when named. `prod-one` 40.4, `byEffort.high` 44.4.
`gate-one` 18.5, `byEffort.high` 41.5, `byEffort.low` 12.5. `gate-two-canon`
33.3, `aliases` `["gate-two"]`. `gate-three` 22.2. `gate-four` 28.4.
`gate-five` with `rated: false` and no `netScore`. `gate-six` 19.9.
`gate-seven` 20. `gate-nine` 50.5. No entry for `gate-eight`, the hostile
key, `__proto__`, or the other producers. The values have one decimal at most,
so no case depends on a trailing zero.

**Allowed file.** `allowedRoutes`: `t1/prod-one`, `t1/prod-two`,
`t1/prod-three#high`, `t1/prod-four`, `t1/prod-five`, `t1/prod-six`,
`t1/prod-seven`, `t1/prod-nine`, `t1/prod-strat`, `t1/gate-one`,
`opencode/gate-three-free`, `t1/gate-four`, `t1/gate-five`, `t1/gate-six`,
`t1/gate-seven`, `t1/gate-eight`, `t1/gate-eleven`, `t1/gate-twelve`.
`orchestratorRoutes`: `t1/gate-two[1m]`. These models are not allowed:
`t1/prod-eight`, `t2/prod-two`, `t1/gate-nine`, the hostile key, and
`t1/__proto__`.

**Arithmetic.** Rates avoid a half at the whole-percent step, so rounding
cannot decide a case. Equal rates use values that a binary float holds
exactly (.5, .25, .75). A python oracle at `/tmp/opencode/strategy-4.1e/oracle.py`
checked every expected value below on 2026-11-17. The Red role recomputes them
by hand and writes the formula in a comment beside each constant.

**Expected producer table** (merged by model key over the producer roles; rank
order; `prod-zero` has no row):

| Rank | Key | Tasks | First-round | Rework | Cleanup | Tokens | Mark |
|---|---|---|---|---|---|---|---|
| 1 | `t1/prod-eight` | 30 | 90 % | 0.1 | 5 % | 150k | not allowed |
| 2 | `t1/prod-strat` | 6 | 75 % | 0.0 | 0 % | 50k | |
| 3 | `t1/prod-one` | 23 | 67 % | 1.5 | 13 % | 340k | |
| 4 | `t2/prod-two` | 11 | 60 % | 0.3 | 5 % | 180k | not allowed |
| 5 | `t1/prod-four` | 6 | 50 % | 0.5 | 30 % | 100k | |
| 6 | `t1/prod-three` | 25 | 50 % | 1.0 | 15 % | 250k | |
| 7 | `t1/prod-two` | 20 | 50 % | 1.0 | 10 % | 200k | |
| 8 | `t1/prod-nine` | 8 | 25 % | 1.0 | 10 % | 120k | |
| 9 | `t1/prod-six` | 5 | 20 % | 2.0 | 50 % | 400k | |

"Too few tasks": `t1/prod-five` (4 tasks) and `t1/prod-seven` (9 tasks, all
cells empty, dashes). The More columns view holds the AA net score
of `t1/prod-one` as 44.4 (the variant `high` has the most tasks).

**Expected checker table** (merged by model key over the gate roles; rank
order; the merged `unknown` row has 80 runs and no rank):

| Rank | Key | Runs | Pass | Findings/run | Escapes | Net score | Mark |
|---|---|---|---|---|---|---|---|
| 1 | `t1/gate-five` | 20 | 100 % | 0.05 | 0 | not rated | not for verdicts |
| 2 | `t1/gate-nine` | 10 | 100 % | 0.20 | 0 | 50.5 | not allowed |
| 3 | `t1/gate-eight` | 8 | 100 % | 0.00 | 0 | not rated | not for verdicts |
| 4 | `t1/gate-six` | 7 | 100 % | 0.00 | 0 | 19.9 | |
| 5 | `opencode/gate-three-free` | 6 | 100 % | 0.00 | 0 | 22.2 | |
| 6 | `t1/gate-seven` | 5 | 100 % | 0.00 | 0 | 20 | |
| 7 | `t1/gate-four` | 9 | 100 % | 0.44 | 1 | 28.4 | |
| 8 | `t1/gate-two` | 17 | 94 % | 0.35 | 0 | 33.3 | |
| 9 | `t1/gate-one` | 15 | 80 % | 1.07 | 3 | 41.5 | |
| 10 | the hostile key | 5 | 20 % | 0.00 | 0 | not rated | |
| 11 | `t1/__proto__` | 6 | 17 % | 0.00 | 0 | not rated | |

"Too few tasks": `t1/gate-eleven` (4 runs) and `t1/gate-twelve` (3 runs, not
9). The hostile key and `t1/__proto__` row marks are not asserted.

**Expected top block** (each line uses only the rows of its role):

| Role | Pick | Rate | Count |
|---|---|---|---|
| Red | `t1/prod-one` | 100 % | 5 |
| Green | `t1/prod-one` | 62 % | 15 |
| Coder | no pick yet | | |
| Review A | `t1/gate-two` | 100 % | 7 |
| Review B | `t1/gate-one` | 60 % | 5 |
| Review C | `t1/gate-seven` | 100 % | 5 |
| Adversarial | no pick yet | | |
| Acceptance | no pick yet | | |
| Phase acceptance | `t1/gate-two` | 80 % | 5 |
| Final acceptance | no pick yet | | |

**Expected footer.** Row count 35. Route count 30 (32 without the note strip).
`unknown` rows 2. `unknown` share 5.7 %. Read date and export date
`2026-10-20`. Three file names, each with the SHA-256 that the test computes
from the staged file.

### 13.4 Test groups and falsification

Groups DS1 to DS3 live in `input-check.test.ts`. DS4 to DS13 live in
`real-work.test.ts` and read the page through `preview.sh`. DS14 to DS21 live in
`preview-gate.test.ts`. A file builds the page one time from the base fixture
and shares it, and it builds a variant only for a mutation case. The tests
assert the page and the exit codes, and they pin no field of `real-work.json`,
because the spec names none. Every assertion on a computed value reads a
`data-mg` hook (section 13.6) and parses a labeled value (A3).

| Group | What it proves | Falsification condition |
|---|---|---|
| DS1 Integrity | For each of the three files, one flipped byte (size and JSON validity unchanged) gives exit 2, the one stdout line `input-check: sha256 <file name>`, and no `real-work.json`. A MANIFEST size of plus or minus 1 with the right SHA-256 gives `input-check: size <file name>`. | Skip the SHA-256 read of one file. The case for that file must fail. |
| DS2 Order and refusals | A flipped byte that also breaks the JSON gives `sha256`, not `json` (integrity before parse). A right SHA-256 with invalid JSON gives `json`. No MANIFEST gives `manifest`. A MANIFEST with no line for one file gives `manifest <file name>`. A MANIFEST line that names `../x` or `a/b` gives `manifest`, and a decoy outside the folder is never read. A missing data file gives `input`. A wrong top-level shape gives `schema <file name>`. The shapes are an outcomes file that is not an array, an AA file with no `models` object, and an allowed file that lacks an array. A missing, an empty, or an unknown flag gives one usage line on stderr, empty stdout, and exit 2. Each refusal writes no file, leaves an existing preview folder byte-identical, and leaves the temp `docs/` byte-identical. | Parse before the hash, accept a path with a slash, or exit 1 with a stack trace. The matching case must fail. |
| DS3 No copy | After a passing run, no file under the preview folder or the temp repo, outside `fixture-b/`, has the name of an input file or the bytes of one. | Copy one input file into the preview folder. DS3 must fail. |
| DS4 Strip and trim | The rows `t1/prod-one#high (ra-quota pick; ...)` and `t1/prod-two  (note here)` merge into their models: `t1/prod-two` shows 20 tasks, and no model key holds the text ` (` or `ra-quota`. The footer route count is 30. | Do not strip the note. The route count is 32, `t1/prod-two` shows 12 tasks, and a stray row appears. |
| DS5 Producer merge | `t1/prod-one` shows 23 tasks, 67 %, 1.5, 13 %, and 340k. | Use an unweighted rate (77 %), a task weight for the rate (70 %), an unweighted rework (1.7), or an unweighted token mean (400k). Each fails. |
| DS6 Null handling | The null cleanup and token cells of two `t1/prod-one` rows leave the average denominators. The model `t1/prod-seven` shows a dash in every average cell. The row `t1/prod-zero` has no row in any table. | Count a null as zero. Cleanup moves off 13 % and tokens move off 340k. A `prod-zero` row appears. |
| DS7 Checker merge | `t1/gate-one` shows 15 runs (the sum of `decided`), 80 %, 1.07, and 3 escapes. `t1/gate-two` shows 17, 94 %, 0.35, 0. `t1/gate-twelve` shows 3 runs. | Count `runs` in place of `decided`. `t1/gate-twelve` shows 9 and ranks. |
| DS8 Minimum 5 | 5 tasks or runs rank (`prod-six`, `gate-seven`). 4 do not (`prod-five`, `gate-eleven`). `prod-seven` has 9 tasks and no rate, so it sits in "Too few tasks". | Use 4 or 6 as the minimum. A boundary row moves. |
| DS9 Producer rank | The `data-rank` order is the table above. A tie in the rate goes to the lower rework (`prod-four` before `prod-three`). A tie in both goes to more tasks (`prod-three` before `prod-two`). | Drop one tie-break level. The row order changes. |
| DS10 Checker rank | The `data-rank` order is the table above. A tie in the pass % goes to fewer escapes (`gate-four` after every row with 0 escapes, though it has 9 runs). Then more runs (`gate-five`, then `gate-nine`, `gate-eight`, `gate-six`, `gate-three-free`, `gate-seven`). The `unknown` row has no `data-rank`. | Sort on runs first, or rank `unknown`. The order changes. |
| DS11 AA match | `t1/gate-one` shows 41.5 (`byEffort.high`, the variant with the most runs), not 18.5 or 12.5. `gate-two` shows 33.3 (an alias). `gate-three-free` shows 22.2 (the `-free` suffix). `gate-five` and `gate-eight` show `not rated` (`rated: false`, no entry). `prod-one` shows 44.4 in More columns. | Read the primary row for `gate-one`. Skip the alias or the suffix. Each case fails. |
| DS12 Marks | `data-mark="not-for-verdicts"` on `gate-five` and `gate-eight` (not rated). None on `gate-six` (19.9) or `gate-seven` (20). `data-mark="not-allowed"` on `gate-nine`, `prod-eight`, and `t2/prod-two`. `gate-one` and `gate-two` carry no mark. The mark is the attribute, not a word of the prose. | Mark a rated row with a net score above 0. Lose the mark of an unrated row. Treat `t2/prod-two` as allowed because `t1/prod-two` is. |
| DS13 Top block | The ten lines of the table in section 13.3, in the given order, one line for each role. Red shows 100 % and 5 (the Red rows only), and Green shows 62 % and 15, not the table row (67 %, 23). Green skips the not-allowed rank 1 (`prod-eight`). Review A skips the rank 1 `gate-five` (not for verdicts). Review B picks `gate-one` (60 %, 5 runs, net 18.5), the only qualifying row in that role. Review C picks `gate-seven` (net 20) over `gate-six` (net 19.9). Adversarial says no pick yet, though two rows rank. No line names a `small`, `strategy`, `record`, or `spec-review` role. | Pick rank 1 without the filters. Use the table-level variant for Review B. Reuse the table row for a role. Add a line for `strategy`. Each fails. |
| DS14 No work type | The page holds no `data-mg="work-type"`, no heading `Work types`, and no heading that names `app code`, `docs and ops`, `print books`, `tooling`, or `other`. The check reads headings and hooks, not prose. | Render a work-type section, or an empty one with "no pick yet". DS14 must fail. |
| DS15 No producer pass rate | The producer section has no header that matches `/pass/i`, in the default table or in More columns. The checker table has no `Blocking %` and no `Blockers per run` header. | Add `Pass %` to the producer table. DS15 must fail. |
| DS16 Columns and formats | The default headers equal the two lists of section 13.6, in order. Rates are `^\d+\s*%$`. Rework is `^\d+\.\d$`. Findings per run is `^\d+\.\d{2}$` with no `%`. Tokens is `^\d+k$`. A null average is the dash `–`. Tasks, Runs, and Escapes are integers. No cell holds `(n=`. | Show a rate with a decimal, show findings per run as a percent, or print an empty value as a sentence. Each fails. |
| DS17 Names and routes | A row shows a plain name (the key without its plan prefix when `model-names.json` has no name). A key that the names file holds shows its name, and the raw key is absent from the model cell. The default table has no `Routes` header, and the More columns view holds the routes. `t1/prod-two` and `t2/prod-two` are two rows with the same plain name and two different `data-model-key` values. | Merge the two providers, or show a Routes column. Each fails. |
| DS18 Footer | `data-mg="about-footer"` is below the first table and holds three `footer-file` items, each with its file name and a 64 hex SHA-256 equal to the SHA-256 of the staged file. It holds the read date and the export date `2026-10-20` and not `2026-11-17`, the row count 35, the route count 30, the `unknown` row count 2, and the `unknown` share 5.7 %. It holds the merge method note of `METHOD_NOTE`. | Hardcode a date or a count, or show the share as a fraction. Each fails on the sentinel. |
| DS19 Width (artifact) | The page `<style>` gives the number cells `white-space: nowrap`, and the `model-name` cell has no `white-space: nowrap` and no fixed `width` or `max-width`. This case reads the CSS text. It does not prove the rendering (section 13.9). | Add `white-space: nowrap` to the model cell. DS19 must fail. |
| DS20 Print-audit names | A data file written into the temp repo with the keys `kimi-code-plan-cn/k3.1-pro` (`11 of 13`), `claude-code/claude-sonnet-5-5#high` (`13 of 13`), and `opencode-go/synthetic-unknown` shows `Kimi K3.1 Pro` and `Claude Sonnet 5.5` (names read from `model-names.json`, the `#high` suffix mapped to its model key) and `synthetic-unknown` (no plan prefix). Each `data-mg="audit-result"` item pairs its name with its `x of y`. The block holds none of the raw keys, no `#high`, and no `kimi-code-plan-cn` or `claude-code` text. | Print `html.escape(route key)`, as `preview.sh` does today. DS20 must fail. |
| DS21 Hostile text | The hostile route reaches the HTML escaped, and the page holds no raw `<img`. The row `t1/__proto__` is an ordinary row. The page still shows the expected row counts, so no prototype key changed a table. | Remove the escape, or store rows in a plain object keyed by the route. DS21 must fail. |
| FX1 Fixture agrees | The MANIFEST of `fixtures/page-b/` equals the SHA-256 and size of the three files. | Edit one fixture and keep the MANIFEST. FX1 must fail. |
| FX2 Not vacuous | Before a format check, a case asserts the row counts: 9 ranked and 2 too-few producer rows, 11 ranked and 2 too-few checker rows, and 10 top lines. | Empty the fixture. FX2 must fail, not pass (A4). |
| FX3 No real data | A guard scans `harness/model-guide-tests/**/*.ts` for the real dated file names. It builds each needle from two parts, so it does not match itself. | Name a real file in a test. FX3 must fail. |

### 13.5 Existing tests: change, retire, or keep

The names G1 to G10 below mean the ten layout cases of task 4.1a in
`preview-gate.test.ts`. They do not mean the PA2-1 guards of section 4.2. Red
owns the final decision for each case inside these rules. Red may merge or
split cases. Red keeps one case for each DS row and its falsification
condition.

| Existing case | Decision |
|---|---|
| G1 source line in the footer | Change. The footer lists the three files, each with its SHA-256, and the read date. It stays below the first table. |
| G2 coverage in the footer | Change. The footer holds the row count, route count, `unknown` rows, `unknown` share, and export date (DS18). |
| G3 "Too few runs to rank" | Change. The minimum is 5, the group label is "Too few tasks", and it applies to both tables. The old label must be absent. |
| G4 whole percent, dash, Runs count | Change. Use the formats of DS16. |
| G5 one top line per role group and work type | Replace by DS13: ten lines in the given order. |
| G6 "no pick yet" in the top block | Change. Per role, for four causes: no row, below the minimum, not allowed, not for verdicts. |
| G7 six columns or fewer, work type drops Blocking % | Change. The two exact lists of section 13.6. The work-type clause retires. |
| G8 More columns toggle | Change. The producer toggle holds `Routes`, `Roles`, `Accepted`, and `AA net score`. The default tables hide them. |
| G9 work type in a tab or a collapsed section | Retire. DS14 replaces it. |
| G10 plain names | Keep the assertions. Stage the keys by an in-memory edit of the new outcomes fixture. |
| T1 (two cases), T11, N4, P2U1-1 (print-audit block) | Keep the assertions. The mini fixture holds names with no plan prefix, so the assertions hold. Only the staging helper changes. DS20 adds the prefixed keys. |
| `Acceptance 5` (two cases), `B2` numeric coverage, `it.each(REQUIRED_COVERAGE_KEYS)`, `it.each(A32_CASES)` | Retire. They test the old export schema or the work-type section. DS1, DS2, and DS14 replace them. |
| `B2` script value in a route name | Change. Use the hostile row (DS21). |
| P1 (writes page B, nav, method note), F12 to F15, F19, F20, A1 to A4, B1 to B3, C2 to C4, the symlink and unreadable groups, U1, U3, U4 | Keep. Only the helpers change: `--export` becomes `--manifest`, `PREVIEW_USAGE`, `populateRepo`, `stageFixture`, and the fixture paths. U1 retargets the footer file list (the SHA-256 needs an overflow-wrap rule). |
| P2B2-2 newline score name | Keep the intent. Tag `[guide-bound]`. |

Other files:

| File | Decision |
|---|---|
| `input-check.test.ts` (I1, I2) | Rewrite as DS1 to DS3. The old export cases retire. |
| `real-work.test.ts` (M1 to M6) | Rewrite as DS4 to DS13. The old export cases retire. |
| `guide.test.ts` | Decouple. The tests stop running `real-work.ts`. They read a committed snapshot of the old tool output, `fixtures/guide/real-work-legacy.json`, that Red makes once with the old tool at the role base. `guide.ts` is unchanged, so these tests stay green. Row 4.1g replaces the snapshot. |
| `update.test.ts`, the `update.sh` cases of `adversarial-p2.test.ts` | Migrate to `update.sh <MANIFEST path>` (spec D19) and `fixtures/page-b/`. Tag `[guide-bound]`. |
| `adversarial.test.ts`, `adversarial-p3.test.ts`, the `preview.sh` cases of `adversarial-p2.test.ts` | Keep. Only the staging helpers change. |
| `print-audit.test.ts`, `review-score.test.ts`, `leak-guard.test.ts` | No change. |

Red deletes an old fixture (`real-work-mini.json`, `MANIFEST.txt`,
`page-guard/`) only when `rg` finds no reference in `harness/`. A fixture that
a file still names stays, and row 4.1g removes it.

### 13.6 The `data-mg` hook contract

The tests find a table by its `<h2>`, `Producer roles` or `Checker roles`, and
then by `data-mg="default-table"`. They find every other element by the hooks
below. A hook sits as an attribute of the element. The text of the element is the
value. These hooks are new or changed. The hooks of task 4.1a not named here
stay as they are.

| Hook | Contract |
|---|---|
| `top-block` | Exactly 10 `pick` items, in the order of section 13.3, before the first table. |
| `pick` | One item for each role. It carries `data-role` (`red`, `green`, `coder`, `review-a`, `review-b`, `review-c`, `adversarial`, `acceptance`, `phase-acceptance`, `final-acceptance`). A pick carries `data-model-key`. |
| `pick-name`, `pick-rate`, `pick-count` | Inside a pick. The name is the plain name. The rate matches `^\d+\s*%$`. The count is an integer. |
| `pick-none` | Inside a line with no pick. Its text is `no pick yet`. The line has no `data-model-key`. |
| `default-table` | Exactly two. Producer headers: `Model`, `Tasks`, `First-round accept %`, `Rework`, `Cleanup %`, `Tokens per accepted task`. Checker headers: `Model`, `Runs`, `Pass %`, `Findings per run`, `Escapes`, `Net score`. |
| `data-model-key`, `data-rank` | On each data `<tr>` of a table or a too-few group. `data-rank` only on a row that has 5 or more tasks or runs and a rate. |
| `model-name` | The cell with the plain name. The routes sit in a `title` or a second line. |
| `mark` | An element inside the row. It carries `data-mark="not-allowed"` or `data-mark="not-for-verdicts"`. The text is the same words. |
| `too-few` | A `<details>` under each table. Its summary text is `Too few tasks`. Its rows have no `data-rank`. |
| `more-columns` | The producer toggle. Summary `More columns`. It lists `Routes`, `Roles`, `Accepted`, `AA net score`. |
| `about-footer` | Below the tables. It holds the hooks that follow and the method note. |
| `footer-file`, `footer-name`, `footer-sha256` | Three `footer-file` items with `data-file="<name>"`. Each holds one `footer-name` and one `footer-sha256`. |
| `footer-read-date`, `footer-export-date`, `footer-rows`, `footer-routes`, `footer-unknown-rows`, `footer-unknown-share` | One element for each value. The share matches `^\d+(\.\d)?\s*%$`. |
| `audit-result` | In the print-audit block. One item for each route result. The text is the plain name and `x of y`. |
| `work-type` | Absent. |

### 13.7 Leak-check coverage of the three dated files

`leak-check.ts` scans each staged file, each file under `docs/`, and each file
under the preview folder. It parses a JSON text and finds a `new_lines`,
`witness`, or `operator` key at any depth. It finds the private folder path and
a seeded line of 20 characters or more in any text. The three dated files and
the MANIFEST are staged files at the commit of task 4.1f, so the tool covers
them with no code change. These guards prove it. They pass at the role base,
and each has a falsification condition (A4).

- **LG1 Clean.** In `leak-check.test.ts`, a temp git repo stages the four
  `fixtures/page-b/` files. Exit 0.
- **LG2 Key fields.** One run for each of the three JSON files. A key
  `operator` added to a row of the outcomes array, a key `operator` inside a
  `models` entry, and a top-level key `witness` in the allowed file each give
  exit 2 and the line `leak-check: key-field: <path> <key>`. The array shape
  matters, because the outcomes file is a top-level array. A route note that
  holds the word `operator` as prose does not fail (A7).
  Falsification: skip array roots. The outcomes case must fail.
- **LG3 Path and seeded line.** A route note that holds the private folder path
  gives `private-path`. A route note that holds a seeded line of 20 characters
  or more gives `seeded-line`. A 19-character line passes. The MANIFEST text is
  scanned the same way.

The live check on the real files runs two times. First, Green stages the four
files by explicit path and runs
`cd harness && npx tsx model-guide/leak-check.ts --private "$HOME/.local/share/lending-desk-bench/model-guide" --repo .. --preview ../.tmp/model-guide-preview`.
It exits 0 before the commit. Second, the closeout check scans the committed
files in a throwaway repo, because the tool reads the index and a committed file
is no longer staged:

```bash
t=$(mktemp -d); git -C "$t" init -q
cp harness/model-guide/data/{ra-outcomes,aa-reliability,allowed-routes}-2026-11-17.json \
   harness/model-guide/data/MANIFEST-2026-11-17.txt "$t"/
git -C "$t" add -A
(cd harness && npx tsx model-guide/leak-check.ts --private "$HOME/.local/share/lending-desk-bench/model-guide" --repo "$t")
```

The role reads only the exit code and the output lines of the script, never a
file of the private folder (section 9.4).

### 13.8 Intentionally-red aggregate-suite handling

The default is a hard cutover. The page B tool and `preview.sh` drop `--input`
and `--export`, because the spec says the new input replaces the old one. A
cutover makes red every case that stages page B data, from the Red commit until
Green 4.1f. That state is intended.

| State | Red | Green |
|---|---|---|
| After Red 4.1e | `input-check.test.ts`, `real-work.test.ts`, DS cases and changed G cases of `preview-gate.test.ts`, every case that only stages page B data, and the `[guide-bound]` cases. | `leak-check.test.ts`, `guide.test.ts`, `print-audit.test.ts`, `review-score.test.ts`, and the cases that need no page B data. |
| After Green 4.1f | The `[guide-bound]` cases only: the cases that assert `model-guide.json` or the overview section of `index.html`, and every `update.sh` case. | Every other case. |
| After Green 4.1h | None. The tag leaves the test files with row 4.1g. | All. |

`preview.sh` keeps its tolerant guide step. After 4.1f, `guide.ts` exits 2 on
the new `real-work.json`, and `preview.sh` prints `preview: no overview table
(guide.ts exit 2)` and exits 0. The preview of 2026-11-18 then has no overview
table until row 4.1h. The Phase 4 closeout needs all files green and
`rg -n '\[guide-bound\]' harness/model-guide-tests` printing nothing. The
untracked `review-run.test.ts` and `fake-opencode` of task 4.1 stay red or
untracked as section 8 says, and this pair does not touch them. No role edits
a test to reach green. A Green role that finds a failure outside the tagged
list stops and sends the name to the orchestrator.

### 13.9 Artifact tests and live-behavior proof

- **Live behavior (offline).** DS1 to DS3 start `real-work.ts` or `preview.sh`
  as a subprocess and read the exit code, the stdout line, and the tree. DS4 to
  DS13 and DS15 to DS18 and DS20 and DS21 run `preview.sh` in a temp repo and
  read the hooks of the generated page. No case starts a model, reads the
  network, or reads the real dated files.
- **Artifact.** DS19 reads CSS text. It proves that the rule is in the page. It
  does not prove the width. DS14 reads headings and hooks and proves the
  generator output.
- **No documentation test.** A test that reads `spec.md` or `plan.md` does not
  count.
- **Live check of task 4.1f, on the real files.** Green builds the preview with
  `bash harness/model-guide/preview.sh --manifest harness/model-guide/data/MANIFEST-2026-11-17.txt`.
  It exits 0. `real-work.html` holds 10 pick items and two default tables with
  at least one ranked row each, the footer values of DS18 for the real files
  (three file names, three SHA-256 values, `2026-11-17`, the row count, the
  route count, the `unknown` count and share), no `data-mg="work-type"`, and no
  raw route key in the print-audit block. `git status --short docs/` prints
  nothing.
- **Browser proof.** The orchestrator runs `page-check` on
  `.tmp/model-guide-preview/real-work.html` at 390, 980, and 1280 px. At 390 px,
  each `model-name` cell of the two default tables renders in 2 lines or fewer.
  The line count is the rendered height minus the padding, divided by the line
  height. The page has no horizontal overflow. The SHA-256 values wrap inside the
  footer. The top block fits one screen. A wide table scrolls inside its own box
  with the visible hint. The page is about 3 screens long at 1280 px.
- **What no fake proves.** The real `ra-quota outcomes --json` shape, the real
  route notes, and the real AA aliases only appear in the live check. DS4 and
  DS11 prove the rules on synthetic rows. The live check proves that the real
  rows do not trip them (for example a route note with a nested bracket).

### 13.10 Architecture guardrails and changed contracts

- **No write under `docs/`** (spec D21). `preview.sh` writes the preview folder
  only. `git status --short docs/` and DS2 prove it.
- **The page B tool reads three files and one MANIFEST, and it writes no input
  file.** DS3 proves it. The tool uses no wall clock for the footer, and it
  makes no network call.
- **Integrity before parse.** The tool checks the SHA-256 and the size of a file
  before it parses the file. DS2 proves the order.
- **A MANIFEST name is a base name.** A name with a slash or `..` gives exit 2.
- **The rank uses no rating and no producer pass rate** (spec D16). DS15 proves
  it.
- **A pick needs an allowed model, the minimum, and for a gate role a net score
  above 0** (spec D16, D18). DS8, DS12, and DS13 prove it.
- **Changed contracts.** The CLI of `real-work.ts` and `preview.sh` changes
  (Q-S1). The MANIFEST has three lines (Q-S2). The `real-work.json` shape
  changes, and `guide.ts` reads the old shape until row 4.1h. The hook contract
  of section 13.6 becomes the test interface of the page. `model-guide.json`
  keeps its schema in this pair. The checker names each contract change in its
  record.
- **Frozen paths.** `harness/provenance.ts`, `harness/tests`,
  `harness/opencode-host.sh`, and `harness/opencode-credential.sh` do not
  change. The `test:meta:logic` exclude list of `harness/package.json` does not
  grow (A7).

### 13.11 Review applicability

| Review | Applies | Focus |
|---|---|---|
| Review A (code) | Yes | `real-work.ts`, `preview.sh`, `pages/real-work.html`, `model-names.json`, and the three data files, against rules 1 to 11 and D17. |
| Review B (security) | Yes | The route note is hostile text and must reach the HTML escaped. The MANIFEST names base names only. The tool checks a hash before it parses. No read outside the data folder. The three public files pass `leak-check.ts`. No real byte in a test. No `docs/` write. |
| Review C (UX/API) | Yes | The flags, the usage lines, the exit codes, and the `input-check:` lines. The column names, the marks, `not rated`, and the top block text. Two rows with the same plain name (`prod-two` on two providers) must show their routes in a second line or a tooltip. |
| Adversarial testing | Yes | A flipped byte in each file, a size of plus or minus 1, a MANIFEST with a path, a missing line, a duplicate line, a symlinked data file, an outcomes row with a null `decided`, a negative or a fractional `tasks`, a `first_round_rate` above 1, a route with `#` twice, a route that is only a note, a `routes.json` with an empty list, a net score of `NaN` as a string, and a 2 MiB outcomes file. These probes pin nothing the spec leaves open. A finding goes to the orchestrator. |
| UX browser review | Yes | On `.tmp/model-guide-preview/real-work.html` built from the real files: widths 390, 980, and 1280 px, the model-name cell lines (section 13.9), the top block on one screen at 390 px, the footer SHA-256 wrap, the marks, the More columns toggle, and the scroll hint. A missing 390 px check blocks the pair. |

The review roles read no file of the private folder (section 9.4).

### 13.12 Anti-pattern coverage

A1 and A8 are retired. A9 and A10 do not apply. A12 does not apply: no task of
the pair is `[b]`.

| Anti-pattern | Defense | Falsification |
|---|---|---|
| A2, adapted: a data path with no integrity gate | DS1 and DS2 refuse a changed byte, a wrong size, and a missing MANIFEST line for each file, and DS2 checks the order. | Remove the SHA-256 read of one file. The case for that file must fail. |
| A3 digit-only count | Gates parse `Tests  N passed`. Every page value comes from a hook and a labeled parse: `footer-rows`, `pick-count`, `data-rank`. | Replace a hook read with a digit search. The case must pass on an empty page. FX2 then fails. |
| A4 vacuous pass | FX2 asserts the row counts before a format check. LG1 to LG3 are labeled base-passing guards with a falsification condition. Each DS row names a falsification. | Empty the fixture. FX2, DS5, and DS13 must fail, not pass. |
| A5 false plan claim | Each Red and Green record cites its command and its labeled line. The `[guide-bound]` list is in `red-4.1e.txt`. | Run the cited line. A non-zero exit with an `[x]` mark is a false claim. |
| A6, A14 registry notes | The orchestrator moves the registry note after the commits, and it names the first open task. | Compare the note with the first open Phase 4 task. |
| A7 over-broad filter | A mark is an attribute. The note strip cuts at the first ` (` and no other character. The leak scan reads exact key names. The `-t` filter excludes only the tag. | Put the word `operator` in a route note as prose. LG2 must pass. Put `(` with no space before it in a route. The key must stay whole. |
| A11 inherited environment | Each file pins `HOME`, `TZ`, and `TMPDIR`, clears `BENCH_TRACK`, and takes every date from the fixture. Run each file one time with `BENCH_TRACK=change`. | Set `BENCH_TRACK=change`. No verdict moves. |
| A13 ignored artifact | The preview folder is ignored. DS2 and DS3 compare SHA-256 trees inside the test, not `git diff`. The data files are tracked, and the MANIFEST loop proves them. | Change one byte in a temp data file. DS1 must fail. |

### 13.13 Open questions and defaults

The spec is silent on these points. The track continues with each default. The
Red role pins the default in a test only where section 13.4 says so.

- **Q-S1. The CLI.** Default: `real-work.ts --manifest <MANIFEST-date.txt> --out <folder>`
  and `preview.sh --manifest <MANIFEST-date.txt> [--preview <folder>]`. The
  usage lines are `usage: real-work.ts --manifest <file> --out <folder>` and
  `usage: preview.sh --manifest <file> [--preview <folder>]`. `update.sh` takes
  the positional manifest of D19. Alternative with less churn: keep the flag
  name `--export` and give it the MANIFEST path.
- **Q-S2. The MANIFEST.** Default: `<sha256>  <size>  <file name>`, one line for
  each of `ra-outcomes-<date>.json`, `aa-reliability-<date>.json`, and
  `allowed-routes-<date>.json`. The date comes from the MANIFEST name.
- **Q-S3. The refusal line.** Default: `input-check: <check> <file name>` with
  the check words `manifest`, `input`, `sha256`, `size`, `json`, and `schema`,
  exit 2, and no output file. The `schema` check refuses a wrong top-level type
  only.
- **Q-S4. The dates.** Default: the read date and the export date are the date
  in the MANIFEST name.
- **Q-S5. The coverage.** Default: the row count is the length of the outcomes
  array. The route count is the number of distinct stripped route strings,
  `unknown` included. The `unknown` share is the `unknown` rows divided by the
  row count, with one decimal.
- **Q-S6. The pick.** Default: the first row of the rank order that passes the
  filters (allowed, the minimum, and for a gate role a net score above
  0). A not-allowed rank 1 does not make "no pick yet" when a later row
  passes.
- **Q-S7. The AA lookup.** Default: the `models` block only. The net score
  format is not pinned (the tests parse a number). A tie in the variant run
  count is not pinned.
- **Q-S8. The mark `not for verdicts`.** Default: on the rows of the checker
  table only. The tests assert nothing about it on producer rows.
- **Q-S9. A producer row with 5 tasks or more and no rate.** Default: it sits in
  "Too few tasks" with dashes. A model whose rate rows have an accepted sum of 0
  has no rate.
- **Q-S10. The `unknown` row.** Default: the page shows it or hides it. It has no
  rank, it never picks, and the tests do not pin its place.
- **Q-S11. The `guide.ts` and `update.sh` follow-up (plan gap).** Default: the
  orchestrator adds rows 4.1g and 4.1h (PC-2) before the 2026-11-18 preview.
  Alternative: fold the two files into 4.1e and 4.1f. That removes the
  `[guide-bound]` state and makes both roles larger.
- **Q-S12. The old export path.** Default: a hard cutover, with no legacy flag
  and no legacy template.
- **Q-S13. The print-audit names.** Default: the page maps the route keys to
  plain names, and the data file `print-audit-2026-11.json` keeps its raw route
  keys. D17 can also read as "the file holds plain names". That reading changes
  `print-audit.ts` and `print-audit.test.ts`.
