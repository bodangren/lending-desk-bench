# Implementation plan — domain_trust

This plan publishes one verdict for each model and domain A–H, with the
failure mode, next to the leaderboard. It reads stored records only. Spec:
`spec.md`. Golden preview: `preview.json`. Base commit: `e449c63`.

Order: contract and setup, then tests (Red), then implementation (Green),
then reviews, then the owner gate and the merge.

Constraints for every role:

- Send no model call (spec NFR-1).
- Do not edit `harness/tests/`, `fixture/`, a reference tree, or a
  runner-hash file (spec NFR-2).
- Phases 2 and 3 happen only in the worktree `../lending-desk-bench-trust`
  on the branch `domain-trust` (spec NFR-8). Do not merge before task 4.1
  records O2 (spec NFR-7).
- Preserve unrelated dirty work. Stage files by explicit path only.

Marker use:

- `[~]` marks the task that is open now.
- `[b]` with a trailing `deferred:<owner>` marks a task that waits for an
  earlier task or for an owner decision. The orchestrator changes it to `[~]`
  when its phase opens.
- `[x]` needs a commit SHA in the task line.
- While a `[b]` task remains, exactly one task is `[~]`. Its first line
  does not hold the word `deferred`. When the `[~]` task closes, the same
  edit marks the next task `[~]`. Reason: anti-pattern A12. The status
  checker reads no `[b]` task, so a plan with only `[x]` and `[b]` tasks
  shows as a closeout candidate. Run `STATUS_CHECK` after each marker
  change.

Gate commands:

- `TRUST_TEST`: `cd harness && npx vitest run site-tests/domain-trust.test.ts`
- `BASE_HASH` (run in `main` only): `cd harness && npx tsx provenance.ts --shell`
- `PATH_CHECK` (run in the worktree):
  `test -z "$(git diff --name-only "$(git merge-base main HEAD)" HEAD | grep -vE '^(harness/domain_trust\.py|harness/export-site-data\.py|harness/site-tests/|docs/|README\.md|measure/)')" && echo PATH_CHECK=pass`
- `LEADERBOARD_SHA`:
  `jq -S 'del(.generated_at, .domain_trust) | walk(if type == "object" then del(.domains) else . end)' docs/assets/data/benchmark.json | sha256sum`
- `SIDE_SHA`:
  `for f in tracks bugfix; do jq -S 'del(.generated_at)' "docs/assets/data/$f.json"; done | sha256sum`
- `FR3_CHECK`:
  `jq -e '[.history.models[] | (.no_skills, .skills) | select(. != null) | select((.fixture_revision // 1) < 2) | .domains.E.failed[]?] | map(select(. == "E.labels" or . == "E.error-announced")) | length == 0' docs/assets/data/benchmark.json`
- `PREVIEW_CHECK`: a comparison of `domain_trust.models` with
  `measure/tracks/domain_trust/preview.json`. The test strategy gives the
  exact command. It compares each verdict, each failure count, and each run
  list.
- `FR3_GUARD`: stops `FR3_CHECK` from passing on an empty history.
  `jq -e '[.history.models[] | (.no_skills, .skills) | select(. != null) | select((.fixture_revision // 1) < 2)] | length > 0' docs/assets/data/benchmark.json`
- `PI_SHA <name>` (run in `main`; anti-pattern A13): hashes each
  `score.json`, `results.json`, and `provenance.json` of every legacy Pi
  record. A Pi record has an `executor.pi` object in its provenance. The
  command stops on an empty list. It prints `PI_RUNS=<n>` and
  `PI_SHA=<hash>`, and it writes both lines to
  `measure/runs/domain_trust/pi-<name>.txt`. `PATH_CHECK` cannot see these
  files, because `.gitignore` ignores `runs/`.
  `for p in runs/*/artifacts/provenance.json; do jq -e '.executor.pi | type == "object"' "$p" >/dev/null 2>&1 && echo "${p%/provenance.json}"; done | sort > .tmp/trust-pi-artifacts.txt; test -s .tmp/trust-pi-artifacts.txt && { echo "PI_RUNS=$(wc -l < .tmp/trust-pi-artifacts.txt)"; while read -r a; do for f in score.json results.json provenance.json; do if [ -f "$a/$f" ]; then sha256sum "$a/$f"; fi; done; done < .tmp/trust-pi-artifacts.txt | sha256sum | sed 's/ .*//; s/^/PI_SHA=/'; } | tee measure/runs/domain_trust/pi-<name>.txt`
- `PI_CHECK <a> <b>` (run in `main`): file `<a>` must hold a `PI_RUNS`
  value above 0 and a 64-digit `PI_SHA`. File `<b>` must be byte-identical
  to file `<a>`. Otherwise the command exits non-zero.
  `grep -qE '^PI_RUNS=[1-9][0-9]*$' measure/runs/domain_trust/pi-<a>.txt && grep -qE '^PI_SHA=[0-9a-f]{64}$' measure/runs/domain_trust/pi-<a>.txt && cmp -s measure/runs/domain_trust/pi-<a>.txt measure/runs/domain_trust/pi-<b>.txt && echo PI_CHECK=pass`
- `METHOD_CHECK`: reads the section `id="domain-trust"` of
  `docs/methodology.html` and the paragraphs of `README.md`. It checks the
  contents of spec FR-6. The test strategy gives the exact command. It
  prints `METHOD_CHECK=pass probes=15 verdicts=4 kinds=3`.
- `STATUS_CHECK` (anti-pattern A12): run it from the root of the tree whose
  plan changed. It exits non-zero when the plan has a `[b]` task and the
  status command lists the track as a closeout candidate. It also exits
  non-zero when the plan has a `[b]` task and not exactly one `[~]` task.
  `p=measure/tracks/domain_trust/plan.md; b=$(grep -c '^- \[b\]' "$p"); w=$(grep -c '^- \[~\]' "$p"); s=$(python3 ~/.agents/skills/measure-orchestrator/scripts/measure_interphase_checks.py status --repo . --track '^domain_trust$') && { [ "$b" -eq 0 ] || { [ "$w" -eq 1 ] && printf '%s\n' "$s" | grep -qx 'closeout_candidates: 0'; }; } && echo "STATUS_CHECK=pass blocked=$b open=$w"`

## Phase 1: Contract and setup

- [x] 1.1 Spec and plan: `spec.md`, `plan.md`, `preview.json`, `metadata.json`, `index.md`, and the registry rows in `measure/tracks.md` and `measure/index.md`. 07b4df8
  The strategy role of `rigor_a_h` wrote them on
  2026-10-25 and did not commit them. The orchestrator commits them and
  records the SHA here. The audit of 4bc286a found seven findings, fixed at
  c73b6d6.
  - Verify: `jq -r '.models | length' measure/tracks/domain_trust/preview.json` prints `14`.
  - Verify: `jq '[.models[].runs | length] | add' measure/tracks/domain_trust/preview.json` prints `34`.
- [x] 1.2 Test strategy. Write `test-strategy.md`: the synthetic cases of FR-1 to FR-4, the exact `PREVIEW_CHECK` command, the probe map review, the browser review steps, and the review assignments. 22f1a0d
  The strategy role wrote
  `test-strategy.md` and the log `measure/runs/domain_trust/strategy.log`
  on 2026-10-25. Commit 22f1a0d holds `test-strategy.md` and the matching
  edits of `plan.md` and `index.md`. It does not hold the log. The log
  stays on disk only, in `main` at the path above, because `.gitignore`
  ignores `runs/` (line 11). On 2026-10-25, its SHA-256 was
  `246d2be6b7d5e16efad170bcc22f8401c0678053a78669dc00833b45607ab051`.
  - Verify: `git show --name-only --format= 22f1a0d` lists `measure/tracks/domain_trust/test-strategy.md`.
  - Verify: `python3 ~/.agents/skills/measure-orchestrator/scripts/measure_interphase_checks.py role-gate --repo . --role strategy --track domain_trust --log-file measure/runs/domain_trust/strategy.log` prints `PASS: strategy gate passed`.
- [x] 1.3 Worktree. be540e9 Create `../lending-desk-bench-trust` on the new branch
  `domain-trust` from the current `main` HEAD, and record that SHA as
  `BASE_COMMIT` in this task. Link `runs` to the `runs/`
  of `main`. Install the harness dependencies from the lockfile. Run the
  export in the worktree at the base, and record `LEADERBOARD_SHA` and
  `SIDE_SHA`. Record `BASE_HASH` and the `plan-work.ts --all` classes in
  `main`. Run `PI_SHA base` in `main`, and record its two lines.
  `BASE_COMMIT=6a237beb44c4cd49c91237fb85efb7f657c49d98`.
  `LEADERBOARD_SHA=36f72b340703ec87bf641b2807319cf61a18195ba38e011b0f83127bdbb773ff`.
  `SIDE_SHA=82c2566b731eabd763094d9a820177f09525ba181fb09019ed6a9f3d465111bb`.
  `BASE_HASH=8985c00fffce2659005d6e020cf5befb683ce7776d92611d10ddbbcd6621a2a0 cda02445726e6821f7afdc862dd3787e4a275f4d38e674bd1d350502febf4cb7`.
  Work-list classes: `120 row(s) over 4 track(s) — new 45, failing 75, current 0`.
  `PI_RUNS=95`. `PI_SHA=7af106ad9198808345513e893633ea8dbf07eedc8f65defb8c3ccc1d606a771d`.
  - Verify: `git -C ../lending-desk-bench-trust rev-parse --abbrev-ref HEAD` prints `domain-trust`.
  - Verify: this task holds the five base values: `LEADERBOARD_SHA`, `SIDE_SHA`, `BASE_HASH`, the work-list classes, and the `PI_RUNS` and `PI_SHA` lines.
  - Verify: `STATUS_CHECK` prints `STATUS_CHECK=pass blocked=<n> open=1`.

## Phase 2: Test (Red)

Run in the worktree. Red commits on the branch `domain-trust`.

- [x] 2.1 Test file `harness/site-tests/domain-trust.test.ts` with the cases c0ee4a4
  of the test strategy. It spawns `python3` on a temporary root, as
  `harness/tests/meta/bench-incremental.test.ts` does.
  - Verify: `TRUST_TEST` fails, and each failure names a missing function of `harness/domain_trust.py` or a missing field of the export block.
  - Verify: `PATH_CHECK` prints `PATH_CHECK=pass`.
- [x] 2.2 Red evidence c0ee4a4. Run `TRUST_TEST`. Record the start time, the end
  time, the exit code, and the Vitest summary line in this task.
  Red run started 2026-11-24T09:07:55Z and ended 2026-11-24T09:07:57Z with
  exit code 1. Vitest summary: `Test Files 1 failed (1)` and
  `Tests 17 failed (17)`. Command: `cd harness && npx vitest run
  site-tests/domain-trust.test.ts --maxWorkers=1`. All 17 failures name
  `harness/domain_trust.py` (`PROBE_MAP`, `domain_cells`) or the
  `domain_trust` export block.
  Retry r2: Green found two test defects. D1: `requireProbeMap` read
  `sys.argv[1]` with no argument, so FR-1 cases raised IndexError before the
  import. The fix embeds the harness path in the script text. D2: the arm-a
  revision 1 record used an OpenCode executor, so the history entry came from
  the revision 2 record and the FR-3 assertion contradicted the spec. The fix
  makes the arm-a revision 1 record a Pi record with `E.submits: false` and
  keeps the arm-b revision 2 record as OpenCode. Red rerun in a clean copy
  (`git archive HEAD` plus the fixed test, no `domain_trust.py`): start
  2026-11-24T09:20:53Z, end 2026-11-24T09:20:55Z, exit 1, `Test Files
  1 failed (1)`, `Tests 17 failed (17)`, no IndexError. Against Green's
  uncommitted module the fixed test passes 17/17 (report only).
  - Verify: the recorded exit code is not 0, and the recorded failures are only those of task 2.1.

## Phase 3: Implement (Green)

Run in the worktree. Green commits on the branch `domain-trust`.

- [x] 3.1 Module `harness/domain_trust.py`: the probe map, the kinds, the be5a8a8
  text sources, and the verdict function (spec FR-1, FR-2). Use the Python
  standard library only.
  - Verify: the FR-1 and FR-2 cases of `TRUST_TEST` pass.
  - Evidence 2026-11-24: `TRUST_TEST` exits 0 with `Tests 17 passed (17)`.
- [x] 3.2 Export: the `domain_trust` block and the `since` rule in be5a8a8 7c5a825
  `load_entry` (spec FR-3, FR-4). faa4103

  - Verify: `TRUST_TEST` exits 0.
  - Verify: after `python3 harness/export-site-data.py` in the worktree, `FR3_GUARD` and `FR3_CHECK` print `true`, `PREVIEW_CHECK` prints `PREVIEW_CHECK=pass models=14 cells=112`, and `LEADERBOARD_SHA` and `SIDE_SHA` equal the values of task 1.3.
  - Evidence 2026-11-24: `TRUST_TEST` exits 0 with `Tests 17 passed (17)`.
    `python3 harness/export-site-data.py` exits 0. `FR3_GUARD=true` and
    `FR3_CHECK=true`. `PREVIEW_CHECK=pass models=14 cells=112` with exit 0.
    `LEADERBOARD_SHA=36f72b340703ec87bf641b2807319cf61a18195ba38e011b0f83127bdbb773ff`
    and `SIDE_SHA=82c2566b731eabd763094d9a820177f09525ba181fb09019ed6a9f3d465111bb`,
    both equal to task 1.3. Commit be5a8a8 holds the module and the export
    block. Commit 7c5a825 holds the preview refresh from 58 stored runs. Green
    did not edit `preview.json`.
  - Review A fix A-P3-1 (faa4103): the exporter loads `domain_trust.py` from
    its own directory by path. When the companion is absent in a partial
    workspace, the export keeps its old byte-identical output and writes no
    `domain_trust` block. `bench-incremental.test.ts` exits 0 with
    `Tests 5 passed (5)`. `daily-pick-board-filter.test.ts` exits 0 with
    `Tests 2 passed (2)`. A partial-root run compared with the export at
    `c4560f2` printed `PARTIAL_NO_BLOCK=true` and
    `PARTIAL_BYTE_IDENTICAL=true`. `TRUST_TEST` still exits 0 with
    `Tests 17 passed (17)`.
- [x] 3.3 Page and text: the section of `docs/results.html`, and the text in a1d3be9
  `docs/methodology.html` and `README.md` (spec FR-5, FR-6). faa4103 The
  methodology section has `id="domain-trust"` and holds the rule as static
  HTML. It gives the verdict rule as an ordered list and the probe map as
  a table. Record the `METHOD_CHECK` line in this task.
  - Verify: `METHOD_CHECK` exits 0 and prints `METHOD_CHECK=pass probes=15 verdicts=4 kinds=3` (spec FR-6, AC-6).
  - Verify: `rg -n 'Domain trust' docs/results.html` prints at least 1 line.
  - Evidence 2026-11-24: `METHOD_CHECK=pass probes=15 verdicts=4 kinds=3` with
    exit 0. `rg -n 'Domain trust' docs/results.html` prints 3 lines.
  - Review A fix A-P3-2 (faa4103): the failure list reads `rule.n_min` and the
    `checks` map from the export. It prints the kind and meaning with the
    graded count and the threshold as separate values. No graded check is
    called "not graded". The hy3 C line is
    `P.n-plus-one — performance: per-row query inside the list render — graded 1 of 2 needed — failed 1`.
    All 17 cells with sub-threshold failures or gaps use the same form.
    `PAGE_DESCRIBE_CHECK=pass`, `AFFECTED_CELLS=17`, `COVERAGE_LABELS=251`.
    Words stay in every cell, so color never carries the meaning alone.
- [x] 3.4 Green gate. Run `TRUST_TEST` and `PATH_CHECK` in the worktree. 96a9197
  Run `BASE_HASH` and `cd harness && npx tsx plan-work.ts --all` in `main`.
  Run `PI_SHA green` and `PI_CHECK base green` in `main`.
  - Verify: `TRUST_TEST` exits 0, and `PATH_CHECK` prints `PATH_CHECK=pass`.
  - Verify: `BASE_HASH` in `main` prints the value of task 1.3, or the orchestrator names the other track that changed it. The work-list class of each track, arm, and model equals the class at task 1.3.
  - Verify: `PI_CHECK base green` prints `PI_CHECK=pass` (spec FR-7).
  - Evidence 2026-11-24: `TRUST_TEST` exits 0 with `Tests 17 passed (17)`.
    `PATH_CHECK=pass`. In `main`, `BASE_HASH` prints
    `8985c00fffce2659005d6e020cf5befb683ce7776d92611d10ddbbcd6621a2a0
    cda02445726e6821f7afdc862dd3787e4a275f4d38e674bd1d350502febf4cb7`,
    equal to task 1.3. `plan-work.ts --all` prints `120 row(s) over 4
    track(s) — new 45, failing 75, current 0`, equal to task 1.3.
    `PI_RUNS=95` and
    `PI_SHA=7af106ad9198808345513e893633ea8dbf07eedc8f65defb8c3ccc1d606a771d`.
    `PI_CHECK=pass`. `METHOD_CHECK=pass probes=15 verdicts=4 kinds=3`.
    Commit 96a9197 holds the export output that closes this gate. The plan
    evidence is committed in a separate commit after this edit.
 - Gate deviation (PM 2026-11-24, option A): the checker counts a task as deferred only when its first line holds "deferred". The plan rule A12 forbids that word on the open task. The two rules conflict (PM routes the checker fix to Measure).
 - jr-green gate run 1, HEAD 6faaf42834588cf58796b8bfd245d161e8f44108, 3.5 marked [~]: FAIL: current phase still has 1 non-deferred incomplete tasks.
 - jr-green gate run 2, HEAD d967f349eda33bef164710cf3bc741245c0c1da4, 3.5 marked [b] deferred:review-a: PASS: jr-green gate passed.
 - Both runs: baseline c4560f2e3078ef2b0b1869a4fe0597df792f3372, GREEN_TEST_COMMAND = TRUST_TEST, log measure/runs/domain_trust/green-p3-r3.log.
- [~] 3.5 Review A. Check the probe map against each probe test, and the
  verdict rule against the spec. Check `P.dedup-item` on two candidate trees
  (spec R2, R6). The role writes
  `measure/runs/domain_trust/review-a-<short head>.json`.
  - Verify: the review file shows `status: pass`, or each finding has a fix commit on the branch.
- [b] 3.6 Adversarial tests. Write synthetic records that try to make the
  matrix lie. Examples: `safe` on missing evidence, an unstated check as a
  failure, rows in score order, and a dropped probe.
  — deferred:adversarial-testing
  - Verify: the role writes `measure/runs/domain_trust/adversarial-<short head>.json`, and `TRUST_TEST` exits 0 with the added cases.
- [b] 3.7 UX browser review of `docs/results.html` at desktop and mobile
  widths (spec FR-5, NFR-6). — deferred:ux-browser-review
  - Verify: the review file in `measure/runs/domain_trust/` shows `status: pass` and names its screenshots.

## Phase 4: Owner gate and merge

- [b] 4.1 Owner decisions O1 and O2. Show the owner the matrix of the branch
  export and the screenshots of task 3.7. Record each answer and its date in
  the spec table. — deferred:owner
  - Verify: `rg -n '^\| O1 \|.*\| [0-9]+ 20[0-9]{2}-[0-9]{2}-[0-9]{2}' measure/tracks/domain_trust/spec.md` prints 1 line.
  - Verify: `rg -n '^\| O2 \|.*\| (approved|declined) 20[0-9]{2}-[0-9]{2}-[0-9]{2}' measure/tracks/domain_trust/spec.md` prints 1 line.
- [b] 4.2 Merge and export. When O2 is approved, set `n_min` to the O1
  answer. In `main`, run the export at the old code and record
  `LEADERBOARD_SHA`. Merge `domain-trust`. Run the export again. Run
  `PI_SHA merged` and `PI_CHECK base merged`. — deferred:orchestrator
  - Verify: `LEADERBOARD_SHA` is equal before and after the merge. `jq -r '.domain_trust.rule.n_min' docs/assets/data/benchmark.json` prints the O1 answer.
  - Verify: `BASE_HASH` in `main` is equal before and after the merge.
  - Verify: `PI_CHECK base merged` prints `PI_CHECK=pass` (spec FR-7).
- [b] 4.3 Doctor. In `main`, run `TRUST_TEST` and
  `cd harness && npm run test:meta:logic`. — deferred:jr-green
  - Verify: both commands exit 0.
