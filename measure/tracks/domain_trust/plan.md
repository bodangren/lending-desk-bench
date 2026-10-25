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

## Phase 1: Contract and setup

- [~] 1.1 Spec and plan: `spec.md`, `plan.md`, `preview.json`,
  `metadata.json`, `index.md`, and the registry rows in `measure/tracks.md`
  and `measure/index.md`. The strategy role of `rigor_a_h` wrote them on
  2026-10-25 and did not commit them. The orchestrator commits them and
  records the SHA here.
  - Verify: `jq -r '.models | length' measure/tracks/domain_trust/preview.json` prints `14`.
  - Verify: `jq '[.models[].runs | length] | add' measure/tracks/domain_trust/preview.json` prints `34`.
- [b] 1.2 Test strategy. Write `test-strategy.md`: the synthetic cases of
  FR-1 to FR-4, the exact `PREVIEW_CHECK` command, the probe map review, the
  browser review steps, and the review assignments. — deferred:strategy
  - Verify: `python3 ~/.agents/skills/measure-orchestrator/scripts/measure_interphase_checks.py role-gate --repo . --role strategy --track domain_trust --log-file measure/runs/domain_trust/strategy.log` prints `PASS: strategy gate passed`.
- [b] 1.3 Worktree. Create `../lending-desk-bench-trust` on the new branch
  `domain-trust` from the commit of task 1.2. Link `runs` to the `runs/`
  of `main`. Install the harness dependencies from the lockfile. Run the
  export in the worktree at the base, and record `LEADERBOARD_SHA` and
  `SIDE_SHA`. Record `BASE_HASH` and the `plan-work.ts --all` classes in
  `main`. — deferred:orchestrator
  - Verify: `git -C ../lending-desk-bench-trust rev-parse --abbrev-ref HEAD` prints `domain-trust`.
  - Verify: this task holds the four base values.

## Phase 2: Test (Red)

Run in the worktree. Red commits on the branch `domain-trust`.

- [b] 2.1 Test file `harness/site-tests/domain-trust.test.ts` with the cases
  of the test strategy. It spawns `python3` on a temporary root, as
  `harness/tests/meta/bench-incremental.test.ts` does. — deferred:mid-red
  - Verify: `TRUST_TEST` fails, and each failure names a missing function of `harness/domain_trust.py` or a missing field of the export block.
  - Verify: `PATH_CHECK` prints `PATH_CHECK=pass`.
- [b] 2.2 Red evidence. Run `TRUST_TEST`. Record the start time, the end
  time, the exit code, and the Vitest summary line in this task.
  — deferred:mid-red
  - Verify: the recorded exit code is not 0, and the recorded failures are only those of task 2.1.

## Phase 3: Implement (Green)

Run in the worktree. Green commits on the branch `domain-trust`.

- [b] 3.1 Module `harness/domain_trust.py`: the probe map, the kinds, the
  text sources, and the verdict function (spec FR-1, FR-2). Use the Python
  standard library only. — deferred:jr-green
  - Verify: the FR-1 and FR-2 cases of `TRUST_TEST` pass.
- [b] 3.2 Export: the `domain_trust` block and the `since` rule in
  `load_entry` (spec FR-3, FR-4). — deferred:jr-green
  - Verify: `TRUST_TEST` exits 0.
  - Verify: after `python3 harness/export-site-data.py` in the worktree, `FR3_CHECK` prints `true`, `PREVIEW_CHECK` passes, and `LEADERBOARD_SHA` and `SIDE_SHA` equal the values of task 1.3.
- [b] 3.3 Page and text: the section of `docs/results.html`, and the text in
  `docs/methodology.html` and `README.md` (spec FR-5, FR-6).
  — deferred:jr-green
  - Verify: `rg -n -i 'domain trust' README.md docs/methodology.html docs/results.html` prints at least 3 lines.
- [b] 3.4 Green gate. Run `TRUST_TEST` and `PATH_CHECK` in the worktree.
  Run `BASE_HASH` and `cd harness && npx tsx plan-work.ts --all` in `main`.
  — deferred:jr-green
  - Verify: `TRUST_TEST` exits 0, and `PATH_CHECK` prints `PATH_CHECK=pass`.
  - Verify: `BASE_HASH` in `main` prints the value of task 1.3, or the orchestrator names the other track that changed it. The work-list class of each track, arm, and model equals the class at task 1.3.
- [b] 3.5 Review A. Check the probe map against each probe test, and the
  verdict rule against the spec. Check `P.dedup-item` on two candidate trees
  (spec R2, R6). The role writes
  `measure/runs/domain_trust/review-a-<short head>.json`.
  — deferred:review-a
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
  `LEADERBOARD_SHA`. Merge `domain-trust`. Run the export again.
  — deferred:orchestrator
  - Verify: `LEADERBOARD_SHA` is equal before and after the merge. `jq -r '.domain_trust.rule.n_min' docs/assets/data/benchmark.json` prints the O1 answer.
  - Verify: `BASE_HASH` in `main` is equal before and after the merge.
- [b] 4.3 Doctor. In `main`, run `TRUST_TEST` and
  `cd harness && npm run test:meta:logic`. — deferred:jr-green
  - Verify: both commands exit 0.
