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

- [x] fc9ec99 2.1 The updates. Update every harness package to the latest
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
  - Green r2 record 2026-11-21 14:25 +07. The commit lands in the
    day. Time is outside 02:00-07:00 (spec D7, FR-6). This record
    supersedes the r1 record after Review A.
  - Review A failed r1. Source: Review A
    (openai/gpt-6-luna, `review-a-618eb0a.json`). Finding: axe-core,
    @playwright/test, and vitest can change scored probe or suite
    outcomes inside the cohort. The orchestrator ruled on
    2026-11-21 to restore the three pins.
  - Commands run in r2: `npm install`, then `npm audit fix` (no
    `--force`), then `npm audit --audit-level=high`, then `npm audit
    --json`, then the plan task 3.1 type-check block, then one quick
    vitest file.
  - Direct package versions after r2 (exact pins kept):
    - @playwright/test 1.62.1 (restored from 1.65.1).
    - @types/node 26.6.6 (kept from 26.1.2 in r1).
    - axe-core 4.13.0 (restored from 4.14.1).
    - react-doctor 0.9.2 (unchanged).
    - tsx 4.23.15 (kept from 4.23.1 in r1).
    - typescript 5.9.3 (unchanged).
    - vitest 4.1.10 (restored from 4.1.12).
  - Reverts and reasons:
    - axe-core back to 4.13.0. Reason: score comparability within
      the cohort (Review A, orchestrator 2026-11-21). Neither 4.13.0
      nor 4.14.1 carries an advisory.
    - @playwright/test back to 1.62.1. Reason: score comparability
      within the cohort (Review A, orchestrator 2026-11-21). Neither
      1.62.1 nor 1.65.1 carries an advisory.
    - vitest back to 4.1.10. Reason: score comparability within the
      cohort (Review A, orchestrator 2026-11-21). The high advisories
      stay fixed through transitive lock updates inside the range
      that vitest 4.1.10 allows. Ruling 2 did not need vitest 4.1.12
      for a high advisory. The vitest and @vitest/mocker moderate
      advisories stay listed below with this reason.
  - Kept updates and reasons (orchestrator ruling 3): @types/node
    26.6.6 and tsx 4.23.15 do not touch scored output. Both checks
    passed, so both stay.
  - Decision deferred:pm resolved (PM 2026-11-21): vite 8.3.8
    accepted in the vitest scoring path; condition in task 3.1. PM
    reason: "it fixes a high advisory, it is a minor bump inside
    the range vitest 4.1.10 allows, and the board is frozen since
    11-16, so no live cohort moves."
  - Deferred updates and reasons:
    - react-doctor stays 0.9.2. Deferred under spec D9. Its 0.9.23
      bump changes Axis 3 scores mid-cohort.
    - typescript stays 5.9.3. It is the latest 5.x. The 7.0.2 bump
      is a new major. The task 3.1 gates have not run, so 7.0.2 is
      deferred with that reason.
    - vitest major 5.1.1 is deferred. It is a new major. The task
      3.1 gates have not run, so 5.1.1 is deferred with that reason.
  - No source edit was needed. No package needed a source change.
  - The six Red high advisories still resolve to fixed versions:
    - brace-expansion 5.0.13 (vulnerable 4.0.0-5.0.11).
    - fast-uri 3.1.9 (vulnerable 3.0.0-3.1.8).
    - nanoid 3.3.20 (vulnerable below 3.3.18).
    - source-map-js 1.2.4 (vulnerable 1.0.0-1.2.1).
    - vite 8.3.8 (vulnerable 8.2.0-8.2.2).
    - zod 4.6.7 (vulnerable below 4.6.6).
  - Green audit gate. Command: `cd harness && npm audit
    --audit-level=high`. This is the same command as Red. Exit 0.
    Counts from `npm audit --json`: critical 0, high 0, moderate 5,
    low 0, info 0, total 5. Advisory names: @vitest/mocker,
    deslop-js, minimatch, react-doctor, vitest.
    - @vitest/mocker and vitest (moderate): vitest stays at 4.1.10
      for score comparability within the cohort (Review A,
      orchestrator 2026-11-21). The fix needs vitest 4.1.12.
    - deslop-js, minimatch, and react-doctor (moderate): react-doctor
      stays at 0.9.2 under spec D9. The bump to 0.9.23 would change
      Axis 3 scores mid-cohort.
    No critical or high item remains.
  - Type-check. The task 3.1 block ran once in the day with default
    paths. Output: `OK: tsc exit 2, 210 error lines, 210 identities`.
    Block exit 0. No new identity versus the base file
    `tsc-base-ids-7319344.txt`. The base file hash is unchanged from
    the Red record. Ignored after artifacts:
    `measure/runs/deps_refresh/tsc-after-raw.txt` and
    `measure/runs/deps_refresh/tsc-after-ids.txt`.
  - Quick runner check. Command: `cd harness && npx vitest run
    model-guide-tests/decode-parity.test.ts --configLoader native
    --maxWorkers=1 --reporter=dot`. Exit 0 with vitest 4.1.10. One
    test file passed; eight tests passed. No full suite ran. The
    unit, meta, and bun gates stay in task 3.1 at night.
  - Playwright. @playwright/test is back at 1.62.1, the base version.
    The task 3.1 Playwright version check and e2e spec are not
    needed. No runner move remains to verify.
  - Scope. Commit fc9ec99 changes only `harness/package.json` and
    `harness/package-lock.json`. No source file, no fixture file, no
    new script, and no new dependency changed. The frozen meta
    exclude list is unchanged. Lock file resolved hosts are only
    `registry.npmjs.org`. Unrelated untracked paths (`.opencode/`,
    `tech-debt.md`, `harness/wt.txt`,
    `harness/model-guide/data/sets/`) were preserved and never
    staged. This plan record lands in a separate commit, so the SHA
    on the task line is the implementation commit, not its own
    commit.

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
    - Re-score as a same-code A/B at one commit (PM 2026-11-21
      vite condition). HEAD at check time is the only code. The A/B
      tests the complete dependency refresh: the base
      `harness/package.json` and `harness/package-lock.json`
      against the refreshed pair, not the lock alone. The direct
      pins for @types/node and tsx differ too, and tsx drives the
      regrade tooling. The run is `a-deepseek-v4-1-flash-2026w43-r1`:
      build track, executor kind `opencode`, valid score, candidate
      tree present. System Chrome and browser timing stay a shared
      residual risk: both sides use the same unpinned browser back
      to back, so one pair cannot rule out a timing flake. The block
      records the Chrome version. Any difference stops the track,
      and the orchestrator reports both score files to the PM.
  ```bash
  set -euo pipefail
  B=/tmp/opencode/deps-ab/base
  N=/tmp/opencode/deps-ab/new
  R=/home/daniebo/Desktop/lending-desk-bench
  ID=a-deepseek-v4-1-flash-2026w43-r1
  OUT=$R/measure/runs/deps_refresh/rescore-ab
  H=/home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh
  [ ! -e /tmp/opencode/deps-ab ] || { echo "FAIL: old A/B state exists; ask the orchestrator"; exit 1; }
  mkdir -p "$OUT"
  google-chrome --version > "$OUT/chrome-version.txt"
  git -C "$R" worktree add --detach "$B" HEAD
  git -C "$R" worktree add --detach "$N" HEAD
  [ "$(git -C "$B" rev-parse HEAD)" = "$(git -C "$R" rev-parse HEAD)" ] \
    || { echo "FAIL: base worktree HEAD"; exit 1; }
  [ "$(git -C "$N" rev-parse HEAD)" = "$(git -C "$R" rev-parse HEAD)" ] \
    || { echo "FAIL: new worktree HEAD"; exit 1; }
  git -C "$R" show b4c2e45:harness/package-lock.json > "$B/harness/package-lock.json"
  git -C "$R" show b4c2e45:harness/package.json > "$B/harness/package.json"
  DIFF=$(git -C "$B" diff --name-only -- harness/ | LC_ALL=C sort | tr '\n' ' ')
  [ "$DIFF" = "harness/package-lock.json harness/package.json " ] \
    || { echo "FAIL: base worktree diff: $DIFF"; exit 1; }
  mkdir -p "$B/runs" "$N/runs"
  cp -a "$R/runs/$ID" "$B/runs/"
  cp -a "$R/runs/$ID" "$N/runs/"
  [ -s "$B/runs/$ID/artifacts/score.json" ] && [ -s "$B/runs/$ID/artifacts/provenance.json" ] \
    || { echo "FAIL: base copy incomplete"; exit 1; }
  [ -s "$N/runs/$ID/artifacts/score.json" ] && [ -s "$N/runs/$ID/artifacts/provenance.json" ] \
    || { echo "FAIL: new copy incomplete"; exit 1; }
  (cd "$B/harness" && npm ci) && (cd "$B/fixture" && npm ci)
  (cd "$N/harness" && npm ci) && (cd "$N/fixture" && npm ci)
  (cd "$B/harness" && npm ls --depth=0) > "$OUT/npm-ls-base.txt" 2>&1 \
    || { echo "FAIL: npm ls base"; exit 1; }
  (cd "$N/harness" && npm ls --depth=0) > "$OUT/npm-ls-new.txt" 2>&1 \
    || { echo "FAIL: npm ls new"; exit 1; }
  [ "$(node -p "require('$B/harness/node_modules/vite/package.json').version")" = "8.2.0" ] \
    || { echo "FAIL: base vite version"; exit 1; }
  [ "$(node -p "require('$N/harness/node_modules/vite/package.json').version")" = "8.3.8" ] \
    || { echo "FAIL: new vite version"; exit 1; }
  [ "$(node -p "require('$B/harness/node_modules/vitest/package.json').version")" = "4.1.10" ] \
    || { echo "FAIL: base vitest version"; exit 1; }
  [ "$(node -p "require('$N/harness/node_modules/vitest/package.json').version")" = "4.1.10" ] \
    || { echo "FAIL: new vitest version"; exit 1; }
  regrade() {
    local W="$1" LOG="$2" RC=0
    HEAVY_MIN_AVAIL_MB=1500 "$H" -c "cd $W && ./harness/regrade-run.sh $ID" > "$LOG" 2>&1 || RC=$?
    [ "$RC" -eq 0 ] || { echo "FAIL: regrade exit $RC in $W; see $LOG"; exit 1; }
    grep -q "^\[$ID\] REGRADED total=" "$LOG" || { echo "FAIL: no REGRADED line; see $LOG"; exit 1; }
    grep -q "SKIP" "$LOG" && { echo "FAIL: SKIP in $LOG"; exit 1; } || true
    ls -d "$W/runs/$ID"/artifacts.prev-* > /dev/null 2>&1 \
      || { echo "FAIL: no artifacts.prev in $W"; exit 1; }
    [ "$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).reason)' \
      "$W/runs/$ID/artifacts/graft-provenance.json")" = "regrade" ] \
      || { echo "FAIL: graft reason in $W"; exit 1; }
  }
  extract() {
    node -e 'const fs=require("node:fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); \
      process.stdout.write(JSON.stringify({axes:s.axes,total:s.total},null,2)+"\n");' "$1" > "$2"
  }
  regrade "$B" "$OUT/regrade-base.log"
  regrade "$N" "$OUT/regrade-new-1.log"
  HB=$(cd "$B" && ./harness/node_modules/.bin/tsx harness/provenance.ts --shell | cut -f1)
  HN=$(cd "$N" && ./harness/node_modules/.bin/tsx harness/provenance.ts --shell | cut -f1)
  [ -n "$HB" ] && [ "$HB" = "$HN" ] || { echo "FAIL: runner hash differs: $HB vs $HN"; exit 1; }
  extract "$B/runs/$ID/artifacts/score.json" "$OUT/base-axes.json"
  extract "$N/runs/$ID/artifacts/score.json" "$OUT/new-axes.json"
  cp "$B/runs/$ID/artifacts/score.json" "$OUT/base-score.json"
  cp "$N/runs/$ID/artifacts/score.json" "$OUT/new-score.json"
  diff "$OUT/base-axes.json" "$OUT/new-axes.json" > "$OUT/diff.txt" \
    || { echo "FAIL: axes or total differ; see $OUT/diff.txt $OUT/base-score.json $OUT/new-score.json"; exit 1; }
  echo "OK: A/B axes and total identical"
  ```
      - Window: 22:00-01:30 like the other gates. The A/B that does
        not finish by 01:30 stops and resumes the next evening.
        Cost: two `npm ci` runs plus two regrades. The worktrees
        under `/tmp/opencode/deps-ab/` stay until the orchestrator
        asks Daniel about removal (deletion gate). `git worktree
        list` records them.
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
