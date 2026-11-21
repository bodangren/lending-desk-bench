# Implementation plan — deps_refresh

PM 2026-11-21: light lane, chore.

This plan updates the harness packages and clears the audit. Spec:
`spec.md`. Base commit: `7319344`.

Order: Red (record the failing audit), Green (updates and lock file),
verify (gates, after-audit counts, residual list, push).

Constraints for every role:

- The lane is the light lane. One maker. No checker of a different
  family is needed for a lock-file chore, but the gates still run.
- Touch `harness/package.json` and `harness/package-lock.json` only.
  A major that forces a source change needs a plan note first.
- Never touch `fixture/`, `reference*/`, `docs/`, `tech-debt.md`,
  `.opencode/`, `harness/wt.txt`, `harness/model-guide/data/sets/`,
  or `measure/runs/`.
- Never run `npm install` outside the Green task. Never change a
  package file outside Green.
- Full suites run only 22:00-01:30, one suite at a time with
  `--maxWorkers=1`, always through
  `/home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh`.
  Never run a heavy gate 02:00-06:00. A gate not done by 01:30
  stops and resumes the next evening.
- The lock-file commit lands outside 02:00-07:00 local time. Order:
  Green commit in the day, gates 22:00-01:30, then the push.
- The lock-file commit lands outside 02:00-07:00 local time.
- Stage files by explicit path. Never stage `.opencode/`,
  `tech-debt.md`, `harness/wt.txt`, `harness/model-guide/data/sets/`,
  or `measure/runs/`.
- The deletion gate stays with Daniel. The orchestrator runs the
  push through safe-push; no role pushes.

Marker use:

- `[ ]` marks an open task. The orchestrator adds `[~]` to the one
  open task.
- `[x]` needs a commit SHA on the first line of the task.

## Phase 1: Red — record the failing audit

- [ ] 1.1 The failing gate. Run the audit gate in `harness/` and
  record its output in this task: the exit code, the critical count,
  the high count, and the advisory names. The command must fail while
  any critical or high advisory remains.
  - Command: `cd harness && npm audit --audit-level=high`.
  - Files: none (read-only).
  - Verify: the exit code is not 0. This task holds the output.
  - Note: no checked-in test asserts this (spec D5). `npm audit`
    reads the live registry. A saved-report assertion would test a
    stale file, not the tree.
  - Base type-check (spec D6). Run the full-tree command from the
    repo root before Green:
    `./harness/node_modules/.bin/tsc --noEmit --skipLibCheck --module
    nodenext --moduleResolution nodenext --target es2022 --strict
    $(git ls-files 'harness/*.ts')`.
    At base `7319344` it exits 2 with 210 errors across 157 files
    (log: `measure/runs/deps_refresh/tsc-base-7319344.txt`). The
    strict rule compares diagnostic identities, not counts. Each
    identity is `<file>:<line>:<col> TS<code>`, made with:
    `./harness/node_modules/.bin/tsc --noEmit --skipLibCheck --module
    nodenext --moduleResolution nodenext --target es2022 --strict
    $(git ls-files 'harness/*.ts') 2>&1 | grep -oE
    '^[^(]+\([0-9]+,[0-9]+\): error TS[0-9]+' | sort -u >
    measure/runs/deps_refresh/tsc-base-ids-7319344.txt`.
    The base set file holds 210 lines. Green passes only when the
    after-Green set is a subset of this base set: `comm -13`
    base-file after-file prints nothing. When Green names a source
    change first, the identity drops line and col and keeps file,
    code, and message text instead.

## Phase 2: Green — the updates and the lock file

- [ ] 2.1 The updates. Update every harness package to the latest
  version that works. Take minor and patch first. Take a new major
  only when the gates of task 3.1 pass with it. Else keep the old
  major and record its reason in this task.
  - Deferral: keep `react-doctor` at 0.9.2 (spec D9). The bump to
    0.9.23 would change Axis 3 scores mid-cohort, so the moderate
    advisory stays open with that reason in task 3.2.
  - Files: `harness/package.json`, `harness/package-lock.json`.
  - Verify: `cd harness && npm audit --audit-level=high` exits 0,
    or this task names each remaining critical or high item with
    its reason.
  - Verify: `git status --short` shows changes only in the two
    files above, plus any source file named here first.
  - Runs outside 02:00-06:00 (spec D7).

## Phase 3: Verify — gates, counts, residuals, push

- [ ] 3.1 The gates. Run each command through `heavy-run.sh`, only
  22:00-01:30, one at a time with `--maxWorkers=1`. Record each exit
  code, each gate timestamp, and the test counts in this task. A
  gate not done by 01:30 stops and resumes the next evening.
  - Commands:
    - `HEAVY_MIN_AVAIL_MB=1500 /home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh -c 'cd harness && npm run test:unit'`
    - `HEAVY_MIN_AVAIL_MB=1500 /home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh -c 'cd harness && npm run test:meta:logic'`
    - `bun test harness/model-guide-tests/review-run.test.ts`
      through the wrapper (that file runs with bun).
    - The full-tree type-check from the repo root:
      `./harness/node_modules/.bin/tsc --noEmit --skipLibCheck
      --module nodenext --moduleResolution nodenext --target es2022
      --strict $(git ls-files 'harness/*.ts') 2>&1 | grep -oE
      '^[^(]+\([0-9]+,[0-9]+\): error TS[0-9]+' | sort -u >
      measure/runs/deps_refresh/tsc-after-ids.txt`.
      Then `comm -13
      measure/runs/deps_refresh/tsc-base-ids-7319344.txt
      measure/runs/deps_refresh/tsc-after-ids.txt` must print
      nothing: the after-Green identity set is a subset of the base
      set, so no new diagnostic appears. Fewer errors are allowed.
      This command runs in the day, not through `heavy-run.sh`; it
      needs no browser and no suite.
    - Only when `@playwright/test` moved in task 2.1 (spec D9):
      `./node_modules/.bin/playwright --version` from `harness/`,
      plus one named e2e spec (`tests/e2e/probes.spec.ts`) through
      `heavy-run.sh`. The config uses system Chrome, so no browser
      download runs.
  - Files: none.
  - Verify: every command exits 0, except the type-check, which
    passes under its no-new-errors rule. The log of each run sits
    under `measure/runs/deps_refresh/`.
  - Note: `harness/` has no lint script and no build script. The
    plan records that `npm run` offers neither entry. The meta
    suite stands in for the build (spec D6).
- [ ] 3.2 The after-audit counts and the residual list. Run
  `npm audit` in `harness/` and record the counts by level. List
  each remaining moderate or low advisory with its reason: no
  upstream fix, a deferred breaking major from task 2.1, or the
  deferred `react-doctor` 0.9.23 bump (spec D9).
  - Files: none (this task holds the list).
  - Verify: every moderate or low row of the audit output has a
    matching row here with a reason.
  - Verify: `git diff --name-only` of the Green commit shows no
    `fixture/` path.
- [ ] 3.3 The push. Commit the Green change and push it. The commit
  lands outside 02:00-07:00 local time. This task records the commit
  SHA, the commit timestamp, and the push date.
  - Files: the two lock-scope files, plus any source file named in
    task 2.1.
  - Verify: the timestamp sits outside the night window.
  - Push path: the orchestrator runs
    `/home/daniebo/Desktop/advantage-pr/scripts/jobs/safe-push
    /home/daniebo/Desktop/lending-desk-bench`, dry run first with
    `--dry-run`, run alone, never chained. No role pushes.
  - Exit 2 (deploy push): stop and report the range and the app
    list to the PM. Exit 3 (secret or file over 50 MB) or exit 4
    (not fast-forward): stop and report to the PM. Never force.

## Human gates

- **Any deletion.** No role deletes a file or a run directory without
  Daniel.

## Risks

- **A major breaks the harness.** Task 3.1 catches it. Task 2.1
  defers the major with its reason.
- **A night run reads a half-written tree.** Tasks 2.1 and 3.3 run
  outside 02:00-06:00. Task 3.1 gates run only 22:00-01:30.
- **The registry flaps.** Task 1.1 and task 3.2 record dated output.
  A rerun settles a flap.
- **The meta suite is slow.** It runs once, at night, through
  `heavy-run.sh`.
