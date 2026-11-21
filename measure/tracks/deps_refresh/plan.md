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
- Full suites run only 22:00-07:00, one suite at a time with
  `--maxWorkers=1`, always through
  `/home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh`.
- The lock-file commit lands outside 02:00-07:00 local time.
- Stage files by explicit path. Never stage `.opencode/`,
  `tech-debt.md`, `harness/wt.txt`, `harness/model-guide/data/sets/`,
  or `measure/runs/`.
- The owner gates stay with Daniel: each push, and any deletion.

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

## Phase 2: Green — the updates and the lock file

- [ ] 2.1 The updates. Update every harness package to the latest
  version that works. Take minor and patch first. Take a new major
  only when the gates of task 3.1 pass with it. Else keep the old
  major and record its reason in this task.
  - Files: `harness/package.json`, `harness/package-lock.json`.
  - Verify: `cd harness && npm audit --audit-level=high` exits 0,
    or this task names each remaining critical or high item with
    its reason.
  - Verify: `git status --short` shows changes only in the two
    files above, plus any source file named here first.
  - Runs outside 02:00-06:00 (spec D7).

## Phase 3: Verify — gates, counts, residuals, push

- [ ] 3.1 The gates. Run each command through `heavy-run.sh`, only
  22:00-07:00, one at a time with `--maxWorkers=1`. Record each exit
  code and the test counts in this task.
  - Commands:
    - `HEAVY_MIN_AVAIL_MB=1500 /home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh -c 'cd harness && npm run test:unit'`
    - `HEAVY_MIN_AVAIL_MB=1500 /home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh -c 'cd harness && npm run test:meta:logic'`
    - `bun test harness/model-guide-tests/review-run.test.ts`
      through the wrapper (that file runs with bun).
    - `./node_modules/.bin/tsc --noEmit --skipLibCheck` with the
      explicit paths of each source file touched in task 2.1 (none
      when Green touched no source file).
  - Files: none.
  - Verify: every command exits 0. The log of each run sits under
    `measure/runs/deps_refresh/`.
  - Note: `harness/` has no lint script and no build script. The
    plan records that `npm run` offers neither entry. The meta
    suite stands in for the build (spec D6).
- [ ] 3.2 The after-audit counts and the residual list. Run
  `npm audit` in `harness/` and record the counts by level. List
  each remaining moderate or low advisory with its reason: no
  upstream fix, or a deferred breaking major from task 2.1.
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
  - Verify: the push succeeds.
  - Gate: Daniel says "push" first (owner gate).

## Human gates

- **Each push.** Daniel says "push" once per push. No role pushes
  without that word.
- **Any deletion.** No role deletes a file or a run directory without
  Daniel.

## Risks

- **A major breaks the harness.** Task 3.1 catches it. Task 2.1
  defers the major with its reason.
- **A night run reads a half-written tree.** Tasks 2.1 and 3.3 run
  outside 02:00-06:00.
- **The registry flaps.** Task 1.1 and task 3.2 record dated output.
  A rerun settles a flap.
- **The meta suite is slow.** It runs once, at night, through
  `heavy-run.sh`.
