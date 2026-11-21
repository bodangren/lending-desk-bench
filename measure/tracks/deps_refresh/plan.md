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
  An update that needs a source change stops and defers with its
  reason in task 2.1. No source edit lands in this chore.
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

- [x] f420571 1.1 The failing gate. Run the audit gate in `harness/` and
  record its output in this task: the exit code, the critical count,
  the high count, and the advisory names. The command must fail while
  any critical or high advisory remains.
  - Command: `cd harness && npm audit --audit-level=high`.
  - Files: none (read-only).
  - Verify: the exit code is not 0. This task holds the output.
  - Note: no checked-in test asserts this (spec D5). `npm audit`
    reads the live registry. A saved-report assertion would test a
    stale file, not the tree.
  - Base type-check (spec D6). Task 3.1 holds the one check
    script. Run it before Green with
    `RAW=measure/runs/deps_refresh/tsc-base-raw.txt` and
    `IDS=measure/runs/deps_refresh/tsc-base-ids-7319344.txt`, then
    record in this task the tsc exit code (2), the raw error-line
    count (210), and the identity count (210 lines).
  - Red record 2026-11-21 14:12 +07. The audit gate failed as
    required. Command: `cd harness && npm audit --audit-level=high`.
    Exit code: 1.
  - Audit counts by level: critical 0, high 6, moderate 7, low 0,
    total 13. The counts come from `npm audit --json` metadata.
  - High advisory names (6): brace-expansion, fast-uri, nanoid,
    source-map-js, vite, zod. Each name comes from the audit
    report section headers.
  - Full JSON saved to
    `measure/runs/deps_refresh/audit-before-b4c2e45.json`. That
    file is an ignored artifact. It is not staged or committed.
  - Base type-check rerun at this base with
    `RAW=measure/runs/deps_refresh/tsc-base-raw.txt` and
    `IDS=measure/runs/deps_refresh/tsc-base-ids-7319344.txt`:
    tsc exit 2, 210 error lines, 210 identities. The identity
    file is LC_ALL=C sorted and unique. SHA-256:
    `68dbc06cb7e2e131cf461472b89b9bcbb5537a012d1c7bf2b779bb5d92ad4e2e`.
    The rerun hash matches the pre-rerun hash, so the rerun
    changed nothing.
  - Unrelated dirty paths at Red time (preserved, never staged):
    `.opencode/`, `harness/model-guide/data/sets/`,
    `harness/wt.txt`, `tech-debt.md`. All were untracked user
    work. No package file changed. No install ran.

## Phase 2: Green — the updates and the lock file

- [ ] 2.1 The updates. Update every harness package to the latest
  version that works. Take minor and patch first. Take a new major
  only when the gates of task 3.1 pass with it. Else keep the old
  major and record its reason in this task. Green makes no source
  edit: an update that needs a source change stops here, keeps the
  old version, and records the deferred update with its reason.
  - Deferral: keep `react-doctor` at 0.9.2 (spec D9). The bump to
    0.9.23 would change Axis 3 scores mid-cohort, so the moderate
    advisory stays open with that reason in task 3.2.
  - Files: `harness/package.json`, `harness/package-lock.json`.
  - Verify: `cd harness && npm audit --audit-level=high` exits 0,
    or this task names each remaining critical or high item with
    its reason.
  - Verify: `git status --short` shows changes only in the two
    files above.
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
    - The full-tree type-check, one bash block, from the repo root.
      The check passes only when this block exits 0. It runs in the
      day, not through `heavy-run.sh`; it needs no browser and no
      suite.
  ```bash
  set -o pipefail
  RAW=${RAW:-measure/runs/deps_refresh/tsc-after-raw.txt}
  IDS=${IDS:-measure/runs/deps_refresh/tsc-after-ids.txt}
  BASE=measure/runs/deps_refresh/tsc-base-ids-7319344.txt
  ./harness/node_modules/.bin/tsc --noEmit --skipLibCheck \
    --module nodenext --moduleResolution nodenext \
    --target es2022 --strict \
    $(git ls-files 'harness/*.ts') > "$RAW" 2>&1
  TSC_EXIT=$?
  grep -oE '^[^(]+\([0-9]+,[0-9]+\): error TS[0-9]+' \
    "$RAW" > "$IDS.tmp"
  IDS_RAW_COUNT=$(wc -l < "$IDS.tmp")
  ERR_COUNT=$(grep -cE ': error TS[0-9]+' "$RAW" || true)
  if [ "$TSC_EXIT" -eq 0 ]; then
    [ ! -s "$IDS.tmp" ] && [ "$ERR_COUNT" -eq 0 ] \
      || { echo "FAIL: clean run left diagnostics"; exit 1; }
  elif [ "$TSC_EXIT" -eq 2 ]; then
    [ "$ERR_COUNT" -eq "$IDS_RAW_COUNT" ] \
      || { echo "FAIL: $ERR_COUNT error lines but $IDS_RAW_COUNT identities"; exit 1; }
    [ "$IDS_RAW_COUNT" -gt 0 ] \
      || { echo "FAIL: exit 2 with empty identity set"; exit 1; }
  else
    echo "FAIL: tsc exited $TSC_EXIT"; exit 1
  fi
  LC_ALL=C sort -u "$IDS.tmp" > "$IDS"; rm -f "$IDS.tmp"
  [ -s "$BASE" ] || { echo "FAIL: base identity file missing or empty"; exit 1; }
  [ -f "$IDS" ] || { echo "FAIL: after identity file missing"; exit 1; }
  NEW=$(LC_ALL=C comm --check-order -13 "$BASE" "$IDS") || { echo "FAIL: comm exited $?"; exit 1; }
  [ -z "$NEW" ] \
    || { echo "FAIL: new diagnostics:"; echo "$NEW"; exit 1; }
  echo "OK: tsc exit $TSC_EXIT, $ERR_COUNT error lines, $(wc -l < "$IDS") identities"
  ```
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
  - Files: the two lock-scope files.
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
