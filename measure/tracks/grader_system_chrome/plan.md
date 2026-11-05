# Implementation plan — grader_system_chrome

PM 2026-11-03: light lane

This plan moves the grader browser to the system Chrome and regrades the
stale scores. Spec: `spec.md`. Base commit: `c47707f`.

Order: the harness change, then the proof on the system Chrome, then the
human gates, then the regrade, then the close.

Constraints for every role:

- The lane is the light lane. One maker and one checker. The checker sits in
  a different model family (PM rule 4: the family rule applies to code).
- Only the tests of the touched files run during the code change (PM rule 2).
  The full suite runs once at the end of the code phase, through
  `heavy-run.sh`.
- The track makes no model call and spends no Go quota (spec NFR-1, NFR-2).
- The track runs no `playwright install`, no `apt`, and no `sudo` (spec
  NFR-4).
- The pilot of task 2.3 waits only for task 1.4. Tasks 4.1 and 4.2 wait for
  task 3.1 (the Chrome update). No regrade waits for the page text of task
  3.2.
- A regrade never holds the daily lock. Task 4.3 names the lock check and
  the timer check of each regrade call.
- The owner gates stay with Daniel: the Chrome update with `sudo`, each
  push, the page text, and any deletion.
- Stage files by explicit path. Never stage `.opencode/` or `tech-debt.md`.

Marker use:

- `[ ]` marks an open task. The orchestrator adds `[~]` to the one open task
  and `[b]` to a task that waits for an owner or for an earlier task.
- `[x]` needs a commit SHA on the first line of the task.

## Phase 1: The harness change (D1 to D5, D11) [checkpoint: 96e4a48]

- [x] 1.1 `c50b836` The code change. Implement D1 to D5 in one commit. Touch these files
  and no others:
  - `harness/playwright.config.ts`: add `channel: "chrome"` to the `use` block.
  - `harness/browser-check.ts`: call `chromium.launch({ channel: "chrome" })`
    and return the version of the launched browser.
  - `harness/grade.sh`: write `artifacts/grader-browser.json` with
    `{"schema":1,"channel":"chrome","version":"<version>"}` for each grade
    that launches a browser. A tests-track grade launches no browser, so it
    writes no record.
  - `harness/rescore-doctor.sh`: add the guard of D3 before any write of a
    run. The guard reads the track of the run first. A tests-track run
    (the provenance `track` is `tests`, or the run id starts with `tt-`)
    passes the guard. A build, bugfix, or change run passes only with a
    record whose `channel` is `chrome`. Any other run prints one
    `SKIP <run> (graded before the system Chrome move; regrade needed)` line
    and changes nothing.
  - `harness/cron-daily.sh`: check the system Chrome instead of the headless
    shell path. Keep the prefix `DAILY FAIL playwright:` and the exit 2.
  - `harness/weekly.sh`: check the system Chrome. Remove the line that tells
    the operator to run `npx playwright install chromium`.
  - `harness/schedule-tests/daily-schedule-green.test.ts`: change the fake
    path of line 76 to the system Chrome path.
  - `harness/export-site-data.py`: add the data field `grader_browser` to each
    result. It holds `chrome` for a run with a record whose `channel` is
    `chrome`, `none` for a tests-track run, and `legacy-headless-shell` for a
    build, bugfix, or change run with no record. The value holds no revision
    number.
  Add the tests of the guard of D3 and of the record of D2 under
  `harness/schedule-tests/`. That directory sits outside the suite hash
  (spec EV5), so the tests move no hash.
  - Verify: `rg -n "channel" harness/playwright.config.ts` prints one line
    that holds `channel: "chrome"`.
  - Verify: `rg -n "executablePath" harness/` prints no line.
  - Verify: `rg -n "chromium_headless_shell" harness/cron-daily.sh
    harness/weekly.sh` prints no line.
  - Verify: `rg -n "playwright install chromium" harness/weekly.sh` prints no
    line.
  - Verify: `bash -n harness/cron-daily.sh harness/weekly.sh
    harness/rescore-doctor.sh harness/grade.sh` exits 0.
  - Verify: `cd harness && npx vitest run schedule-tests/ --configLoader native`
    exits 0 and prints a `Tests` line with no failed test.
  - Lane: light. The maker runs only the tests of the touched files.
  - Maker: `minimax-cn-coding-plan/MiniMax-M3.1-Flash`.
  - Verify output: `rg -n "channel" harness/playwright.config.ts` printed
    `28:    channel: "chrome",` and exited 0.
  - Verify output: `rg -n "executablePath" harness/` printed no line and
    exited 1.
  - Verify output: `rg -n "chromium_headless_shell" harness/cron-daily.sh
    harness/weekly.sh` printed no line and exited 1.
  - Verify output: `rg -n "playwright install chromium" harness/weekly.sh`
    printed no line and exited 1.
  - Verify output: `bash -n harness/cron-daily.sh harness/weekly.sh
    harness/rescore-doctor.sh harness/grade.sh` printed nothing and exited 0.
  - Verify output: `cd harness && npx vitest run schedule-tests/ --configLoader
    native` printed `Test Files 4 passed (4)` and `Tests 118 passed (118)` and
    exited 0. That run was outside the heavy-run wrapper. The maker changed
    `harness/playwright.config.ts` after it, so the maker ran each touched test
    file alone. `schedule-tests/grader-browser-record.test.ts` printed
    `Tests 4 passed (4)` and exited 0. `schedule-tests/rescore-guard.test.ts`
    printed `Tests 3 passed (3)` and exited 0.
    `schedule-tests/daily-schedule-green.test.ts` printed `Tests 4 passed (4)`
    and exited 0. No test ran inside the heavy-run wrapper.
- [x] 1.2 `77ddbf5` The checker review. The checker sits in a different model family
  from the maker. It reads the commit of task 1.1 against spec D1 to D5 and
  spec FR-1 to FR-4. It writes
  `measure/runs/grader_system_chrome/check-1.2.json` with `status: pass` and
  no blocking finding.
  - Verify: the file shows `status: pass` and 0 blocking findings.
  - Verify: the plan records the maker model and the checker model, and the
    two sit in different families.
  - Lane: light. The checker changes no code.
  - Checker model: `claude-code/claude-sonnet-5-5#high` (Anthropic family).
  - Maker model: `minimax-cn-coding-plan/MiniMax-M3.1-Flash` (MiniMax family).
  - The two models sit in different families.
  - Result: `measure/runs/grader_system_chrome/check-1.2.json` shows
    `status: pass`, `retry_recommendation: none`, 0 blocking findings, and 6
    non-blocking findings (F1 to F6).
  - F1 is fixed in this commit. The SHA now sits on the first line of task 1.1.
  - F2 to F6 go to a later follow-up:
    - F2 the guard reads the record before the track. The outcome does not
      change. The comment at `harness/rescore-doctor.sh:32-36` does not match
      the code.
    - F3 the guard tests cover only `WEEK=all` and the `a-` and `tt-` prefixes.
    - F4 no test for the `grader_browser` field or the missing-Chrome path.
    - F5 stale `ms-playwright` advice at `harness/weekly.sh:28`.
    - F6 the `BENCH_SYSTEM_CHROME` override is not in the spec.
- [x] 1.3 `13b4526` The full suite once through `heavy-run.sh`. Run the full suite once
  at the end of the code phase. The command runs inside the heavy-run
  wrapper, so that one heavy job holds the machine.
  - Command: `HEAVY_MIN_AVAIL_MB=1500 /home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh -c 'cd harness && npx vitest run schedule-tests/ --configLoader native && npm run test:meta:logic'`.
  - Verify: the run exits 0, and the log holds a `Tests` line with no failed
    test for each of the two suites.
  - Verify: the log of the run sits at
    `measure/runs/grader_system_chrome/full-suite-1.3.log`.
  - Lane: light. One heavy run.
  - Maker: `minimax-cn-coding-plan/MiniMax-M3.1-Flash`.
  - The run went inside the heavy-run wrapper with
    `HEAVY_MIN_AVAIL_MB=1500`. The exit code was 0.
  - The schedule-tests suite printed `Test Files  4 passed (4)` and
    `Tests  118 passed (118)`. The wall time was 590.17 s.
  - The test:meta:logic suite printed `Test Files  30 passed (30)` and
    `Tests  238 passed (238)`. The wall time was 346.54 s.
  - Log: `measure/runs/grader_system_chrome/full-suite-1.3.log`.
- [x] 1.4 `c50b836` The AFTER hashes. Run the hash command right after the harness
  commit. Record both values in this task. They differ from the BEFORE values
  of spec EV14.
  - Command: `cd harness && ./node_modules/.bin/tsx provenance.ts --shell`.
  - Verify: the command exits 0 and prints two hashes.
  - Verify: the two values differ from
    `3e5a4c64c9bcd0b30d6143389c8e96b9a80d955681df7b072c394db937ab29ea` and
    `451652e5e03ee1d3030014c527bff7714740b96a38756853d5fc68276c522ae6`.
  - Verify: this task holds the two AFTER values and the commit SHA of the
    harness commit.
  - Lane: light. A read-only command.
  - AFTER `runner_sha256`:
    `f199cfb475061a01225ced93e01167b405e0202f9dc45282f8d4a0d044da0365`.
  - AFTER `suite_sha256`:
    `08d6ae6d7515e506b841111e2ffe7b3bc5d3f69c8da676f65c7b46bc8b2af20b`.
  - The command printed both values on one line, separated by a tab, and
    exited 0.
  - The two AFTER values differ from the two BEFORE values of spec EV14.

## Phase 2: The proof on the system Chrome

- [x] 2.1 `96e4a48` The browser check. Run the browser check on the current harness.
  It launches the system Chrome and prints `browser ready`. The command runs
  through `heavy-run.sh`, because it launches a browser.
  - Command: `HEAVY_MIN_AVAIL_MB=1500 /home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh -c 'cd harness && npx tsx browser-check.ts'`.
  - Verify: the command exits 0 and prints `browser ready`.
  - Lane: light. One browser launch.
  - The check ran on 2026-11-06. The start time was 01:51:45 ICT. The end
    time was 01:52:32 ICT.
  - The exit status was 0.
  - The log holds the line `browser ready`.
  - The record JSON line reads
    `{"schema":1,"channel":"chrome","version":"153.0.8010.52"}`.
  - The channel is `chrome`. The version is `153.0.8010.52`.
  - The version matches the value of spec EV12. The Chrome update of task 3.1
    stays open. The check of D4 tests no version.
  - Log: `measure/runs/grader_system_chrome/browser-check-2.1.log`.
  - The baseline table of task 2.4 sits at
    `measure/runs/grader_system_chrome/score-baseline-2.1.tsv`.
  - The SHA-256 of that table is
    `6a09bad4950f3c3a2ed25f65fbf29b1f43d2695b62d50250d3d3f438004edb6b`.
  - The table holds 311 runs and 1 header line. The counts per track: build
    209, bugfix 77, tests 25, change 0.
  - The counts per executor kind: non-pi 218, pi 93.
  - The harness commit `96e4a48` holds the code of the check. The task made no
    code change.
- [ ] 2.2 The first live day. The live day grades with the system Chrome.
  The self-check and the canary of the batch run inside the batch
  (`harness/batch.sh:204-346`). The day record names the model and the run
  ids. Right after this live day, the orchestrator runs the gates of
  `daily_model_schedule` task 5.4 and closes it there.
  - Verify: `reports/cron-daily.log` holds one `DAILY GO-GUARD weekly=<n>
    monthly=<m>` line before each of the 4 batches.
  - Verify: `reports/cron-daily.log` holds no `DAILY FAIL playwright` line.
  - Verify: `DAY_CHECK <day>` prints `DAY_CHECK=pass model=<id> runs=<n>
    harness=<n>` and exits 0.
  - Verify: `PI_SHA day2` prints `PI_RUNS=95` and a `PI_SHA=` line with 64
    hex characters. `PI_CHECK day0 day2` prints `PI_CHECK=pass`.
  - Lane: light. The live day runs on its own timer. This task records it.
- [ ] 2.3 The pilot regrade. Run the step 1 of D7. Regrade 1
  persisted-rankable build run of week 2026w43. No trusted bugfix or change
  run exists, and the tests track needs no browser proof. Record the old
  total and the new total of the run.
  - Command: `HEAVY_MIN_AVAIL_MB=1500 /home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh -c 'cd harness && ./regrade-run.sh <run-id>'`.
  - Verify: the log holds one `[<run-id>] REGRADED total=<n> valid=true` line.
  - Verify: this task holds the old total and the new total of the run. The
    old total comes from the `score.json` of `artifacts.prev-<stamp>/`.
  - Verify: this task holds the wall time of one regrade. The day count of
    task 4.2 uses that value and the measured run count of spec EV16.
  - Lane: light. One heavy run.
- [ ] 2.4 The rescore SKIP lines on that live day. The live day runs
  `rescore-doctor.sh` twice (spec EV8). The guard holds each old build,
  bugfix, or change score.
  - Verify: `grep -c "graded before the system Chrome move; regrade needed"
    reports/cron-daily.log` prints a count above 0.
  - Verify: an old non-Pi BUILD run keeps the bytes of its `score.json` after
    the live day.
  - Verify: the legacy tests-track runs get a new `score.json` from the
    rescore. That is expected, because their grade used no browser.
  - Lane: light. A read-only check.

## Phase 3: The human gates

- [ ] 3.1 The Chrome update. Ask Daniel, through the PM, to update the system
  Chrome to 156.0.8078.79 or newer with `sudo`. The steps 2 and 3 of D7 wait
  for it. The harness change and the live day do not wait for it.
  - Verify: `google-chrome --version` prints a version of 156.0.8078.79 or
    newer.
  - Verify: this task records the date and the version of the update.
  - Lane: light. The owner runs the command. No role runs `sudo`.
- [ ] 3.2 The page text. The PM gives the visible text for the stale mark of
  D5. Then Daniel reads the page and gives the look check. The pages change
  nothing before both answers.
  - Verify: the plan records the text of the PM and the date of the look
    check.
  - Verify: no push of `docs/` happened before that date.
  - Lane: light. A human gate.

## Phase 4: The regrade (D7, D8)

- [ ] 4.1 The step 2 of D7. Regrade week 2026w43 and all its reachable runs.
  Spec EV16 gives build 8 and tests 10. Those runs hold all 17
  persisted-rankable runs of EV15. The task waits for the Chrome update of
  task 3.1. The pilot run of task 2.3 is one of these runs, so it is graded
  again.
  - Command: `HEAVY_MIN_AVAIL_MB=1500 /home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh -c 'cd harness && WEEKS=2026w43 ./regrade-all.sh'`.
  - Verify: the log holds a `[<run-id>] REGRADED total=<n> valid=true` line
    for each regraded run.
  - Verify: the log holds a line
    `REGRADE-ALL END <time> ok=<n> not-ok=<n> skipped=<n>`.
  - Verify: `PI_CHECK <a> <b>` prints `PI_CHECK=pass`.
  - Verify: this task holds the OK, FAIL, and SKIP counts of the week.
  - Verify: the pilot wall time of task 2.3 times the run count of the week
    is more than 80 minutes. Then the week runs as 3 calls: `ONLY=a-`,
    `ONLY=b-`, and `ONLY=tt-`, one heavy-run call each.
  - Lane: light. One heavy run, or 3 when the week splits.
- [ ] 4.2 The step 3 of D7. Regrade all other curable weeks, newest first:
  week 2026w39, then week 2026w38. Spec EV16 gives 2026w39 build 2 and
  2026w38 build 10. The task waits for the Chrome update of task 3.1.
  - Command: `HEAVY_MIN_AVAIL_MB=1500 /home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh -c 'cd harness && WEEKS=<week> ./regrade-all.sh'` for each week.
  - Verify: the log of each week holds a line
    `REGRADE-ALL END <time> ok=<n> not-ok=<n> skipped=<n>`.
  - Verify: `PI_CHECK <a> <b>` prints `PI_CHECK=pass` after each week.
  - Verify: the pilot wall time of task 2.3 times the run count of the week
    is more than 80 minutes. Then the week runs as 2 calls: `ONLY=a-` and
    `ONLY=b-`, one heavy-run call each.
  - Verify: this task holds the OK, FAIL, and SKIP counts of each week and
    the day count of the whole regrade. The day count = the reachable run
    count of spec EV16 (30) divided by the runs per day. The runs per day =
    the hours of one heavy-run slot divided by the wall time of one regrade
    from task 2.3.
  - Lane: light. One heavy run per week, or 2 when the week splits.
- [ ] 4.3 The daily lock and the timer. A regrade must not hold the daily
  lock, because a held lock would stop the live day. Before each regrade
  call, run `flock -n <lock> true`. The lock path is `BENCH_DAILY_LOCK`,
  which defaults to `$ROOT/.tmp/weekly-cron.lock`
  (`harness/cron-daily.sh:34`). The command must exit 0. Then read
  `systemctl --user list-timers lending-desk-daily.timer`, and start the
  regrade only when the next start is more than 4 hours away. One
  `heavy-run.sh` call stops at `HEAVY_RUN_TIMEOUT_S` (default 5400 s,
  `/home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh:38-43`).
  - Verify: the plan records the lock check and the timer read of each
    regrade call.
  - Verify: no regrade held the daily lock, and no regrade started within 4
    hours of a live day.
  - Lane: light. A read-only check.
- [ ] 4.4 The score change report of D8. For each regraded run, record the old
  total and the new total. The new total comes from the
  `[<run-id>] REGRADED total=<n> valid=<bool>` line of the log. The old
  total comes from the `score.json` of `artifacts.prev-<stamp>/`. Per track,
  record the mean change and the max absolute change. List each run with a
  change of more than 5 points.
  - Verify: the report holds one old total and one new total for each
    regraded run.
  - Verify: the list of runs with a change of more than 5 points matches the
    report.
  - Verify: the report reaches the PM before the next live day publishes the
    regraded scores.
  - Lane: light. A text report.

## Phase 5: The close

- [ ] 5.1 The final counts. Count the regraded runs as OK, FAIL, and SKIP.
  Count the runs that keep their stale mark, and give the reason of each:
  no candidate tree, hard violation, Pi, or no reachable week.
  - Verify: the four counts match the logs of task 4.1 and task 4.2.
  - Verify: the reason of each stale run names one of the four reasons.
  - Lane: light. A read-only count.
- [ ] 5.2 The report to the PM. Send the report of D8 to the PM.
  - Verify: the plan records the date of the send.
  - Lane: light. A text report.
- [ ] 5.3 The hand-off of the open tasks. The open tasks of spec EV13 are
  `opencode_executor` task 4.4 part 2 and task 4.3. Both wait for a grader
  browser. They start now, in this order: 4.4 part 2, then 4.3.
  - Verify: the plan records the date of the hand-off to the PM.
  - Verify: `opencode_executor` task 4.4 part 1 (dry run and preflight, no
    browser) has started, because it waits only for this spec.
  - Lane: light. A text hand-off.

## Human gates

- **The Chrome update.** Daniel runs `sudo apt-get install -y
  google-chrome-stable` after task 3.1 starts. No role runs `sudo`. The
  steps 2 and 3 of D7 wait for it.
- **Each push.** A push of `docs/` publishes the public site. Daniel scans the
  range and says "push" once per push. No role pushes without that word.
- **The page text.** The PM gives the visible text of D5. Daniel then reads
  the page and gives the look check. The pages change nothing before both
  answers.
- **Any deletion.** The removal of the old rerun scripts, of the headless
  shell cache, and of any run directory waits for Daniel. This track deletes
  no file.

## Risks

- **The system Chrome renders and times pages differently.** The new headless
  mode of Chrome can change a rendered page and a page load time. The totals
  of a regraded run can move. The report of D8 gives each change, and the
  report reaches the PM before the numbers go public.
- **The system Chrome updates itself.** Chrome updates through apt. The
  browser version can change between 2 grades with no hash change. The record
  of D2 keeps the version of each grade, and no freshness check reads it.
- **The heavy-run time competes with Storytime.** A regrade starts a browser
  and takes the one heavy slot of the machine. The Storytime roles take the
  slots first (PM rule 1). The regrade waits for a free slot.
- **The AFTER hash can change again.** Another harness commit can land
  between the harness commit and the next live day. The plan then records the
  new AFTER values and names the other commit.
- **The rescore relabels the old scores.** The rescore rewrites the
  provenance with the current hashes and runs no test. The guard of D3 lands
  in the same commit as D1, so no live day can see the new hashes without
  the guard.
- **The tests track labels itself current.** On the first live day, the
  rescore labels the legacy tests-track runs as current. This is correct,
  because their grade used no browser.
- **The site shows the old numbers.** The export copies the persisted flags.
  The site keeps the old scores as rankable until a run writes a new
  `score.json`. The gate of D5 holds the page text.
- **The Chrome update waits.** The owner runs the update with `sudo`. The
  steps 2 and 3 of D7 wait for it, so the regrade runs on one browser
  version.
