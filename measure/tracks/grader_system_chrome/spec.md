# Grader browser: grade with the system Chrome and regrade the stale scores

Spec format: classic FR list. Track type: chore. Base commit: `c47707f`.

## Summary

The grader browser moves from the pinned Playwright headless shell to the
system Chrome. One harness commit makes the change. It holds six parts: the
browser channel, the browser record, the rescore guard, the pre-batch checks,
the stale mark, and the site field.

The change sets `runner_sha256` and `suite_sha256` to new values. Every
non-Pi score becomes `STALE-PROVENANCE` at the live check. The public site
keeps its persisted flags until a run writes a new `score.json`.

The cure is the regrade. The regrade runs the grade again on the current
harness. It makes no model call and spends no Go quota. This track adds no
run day and no cost.

## Owner requirement

Daniel answered "B" on 2026-11-04. The PM orchestrator relayed the word in
Tasks.

> B

The PM log row of 2026-11-04 05:29 ICT records the answer with its meaning.

> Daniel: "B" (grader browser moves to the system Chrome; runner + suite hashes change; all trusted scores stale, rerun)

The PM asked for four items: the harness change, the new hashes, the
stale-score marking, and the rerun order with its Go cost per day. The PM
asked that the order stay inside the daily budget and the 80 % guard. The PM
set one rule.

> No harness edit before the spec and plan are committed.

## Evidence

All facts come from the files on disk and from read-only commands on
2026-11-04.

- **EV1. The owner answer.** The PM log row of 2026-11-04 05:29 ICT records
  the answer "B" with the meaning above. The row names the four items that
  the PM asked this track for.
- **EV2. The cause.** The PM log row of 2026-11-03 21:21 ICT records the
  owner order: "Find every Playwright/Puppeteer browser cache on this machine
  and delete the Chromium builds older than 156.0.8078.73." The PM deleted
  `chromium_headless_shell-1234` (151.0.7922.34), `-1243` (153.0.8010.12),
  and `-1228`. The live day of 2026-11-04 stopped at 01:01:05 with
  `DAILY FAIL playwright: Chromium is missing`. The record sits in
  `measure/tracks/daily_model_schedule/plan.md` under task 5.4.
- **EV3. The pinned build.** `harness/node_modules/@playwright/test/package.json`
  holds version 1.62.1. `harness/node_modules/playwright-core/browsers.json`
  pins `chromium-headless-shell` at revision 1234 with `browserVersion`
  151.0.7922.34.
- **EV4. The launch points.** `harness/browser-check.ts:15` calls
  `chromium.launch()` with no channel. The `use` block of
  `harness/playwright.config.ts:24-36` holds no `channel`.
  `harness/grade.sh:149` writes an invalid record on a browser-check failure.
  `harness/grade.sh:234` and `:239` run the Playwright suite. The headless
  shell path checks sit at `harness/cron-daily.sh:356-360`,
  `harness/weekly.sh:23-29`, and `harness/rerun-deepseek-v41-w38.sh:17-18`.
  The test `harness/schedule-tests/daily-schedule-green.test.ts:76` fakes the
  headless shell path.
- **EV5. The hash lists.** `harness/provenance.ts:51-96` lists the
  `runner_sha256` files. The list holds `harness/browser-check.ts` at line 82
  and `harness/grade.sh` at line 53. The `suite_sha256` list starts at line
  97 and holds `harness/playwright.config.ts` at line 105. None of
  `harness/cron-daily.sh`, `harness/weekly.sh`, `harness/rescore-doctor.sh`,
  and `harness/export-site-data.py` sits in either list. The suite list holds
  no file of `harness/schedule-tests/`, so the test change of D4 moves no
  hash.
- **EV6. The live stale mark.** `harness/provenance-check.ts:52-53` compares
  the run hashes with the live hashes. A mismatch adds the reason "runner or
  suite provenance does not match this score implementation" at line 107.
  `harness/score-freshness.ts:214-218` then returns `STALE-PROVENANCE` with
  `rankable` false. `harness/summarize.sh:55`, `harness/batch.sh:123`, and
  `harness/plan-work.ts:137` use this live check. No code change is needed
  for this mark.
- **EV7. The site export.** `harness/export-site-data.py:367-377` copies the
  persisted flags `valid`, `trusted`, `publishable`, and `rankable` from
  `score.json`. The script calls no live check. The public site keeps the old
  scores as rankable until a run writes a new `score.json`.
- **EV8. The main risk.** `harness/cron-daily.sh:368-372` runs
  `WEEK=all ./rescore-doctor.sh` when `tsx provenance.ts --shell` differs
  from `reports/harness-hashes.sha`. `harness/cron-daily.sh:396` runs
  `WEEK="$WEEK" ./rescore-doctor.sh` after the batches.
  `harness/rescore-doctor.sh:1-14` rewrites the provenance with the current
  hashes and rebuilds `score.json` from the persisted `results.json`. The
  script runs no test. Its header states that a suite edit needs
  `regrade-run.sh`. The first live day after the harness commit would label
  every old non-Pi result of the build, bugfix, or change track as current
  under the new hashes. The stale mark of those results would disappear
  without a regrade. A tests-track result stays correct, because its grade
  used no browser. `opencode_executor` task 4.4 part 2
  (`WEEK=all ./rescore-doctor.sh`) has the same effect.
- **EV9. The regrade.** `harness/regrade-run.sh:1-18` (bench_v2 FR-10)
  regrades one run on the current harness. It grafts the agent files onto a
  fresh comparison tree. It runs the grade again with Vitest and Playwright.
  It moves the old artifacts to `artifacts.prev-<stamp>/` and restores them
  on a `grade.sh` exit 4. It skips runs with no candidate tree and legacy Pi
  runs (opencode_executor FR-8). `harness/regrade-all.sh` runs it for each
  run of `WEEKS`, with an optional `ONLY` prefix. A regrade makes no model
  call, so it spends no Go quota. A regrade starts a browser, so it is a
  heavy run. It goes only through
  `/home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh`.
- **EV10. The daily schedule and the budget.**
  `harness/systemd/lending-desk-daily.timer:5` holds
  `OnCalendar=Wed,Sun 01:00:00`. The next start is Sun 2026-11-08 01:00 +07.
  The start after that is Wed 2026-11-11. Each run day has 12 agent runs.
  `measure/tracks/daily_model_schedule/spec.md` EV11 and O1 give 1.07 USD per
  run day on average and 3.24 USD at the observed maximum. The week has
  about 2 run days. The Go guard (`harness/cron-daily.sh:166-303`) reads the
  Go weekly and monthly windows before each of the 4 track batches. It stops
  the day above 80 % or on an unreadable window. The Go quota at 05:3x ICT
  on 2026-11-04 was monthly 75.53 % (reset Sat 2026-11-21 20:44) and weekly
  8.68 % (reset Mon 2026-11-09 07:00). The daily pick
  (`harness/daily-pick.ts:135-163`) reads `last_test` from the day records in
  `reports/daily/`, not from score freshness. The hash change does not change
  the pick order.
- **EV11. The Pi history.** 95 legacy Pi runs exist.
  `measure/runs/daily_model_schedule/pi-day1.txt` holds `PI_RUNS=95`. The
  regrade and the rescore skip them. The `PI_CHECK` of
  `daily_model_schedule` needs their bytes to stay the same.
- **EV12. The system Chrome.** `/usr/bin/google-chrome` is a link to
  `/etc/alternatives/google-chrome`, which points to
  `/usr/bin/google-chrome-stable`, which points to
  `/opt/google/chrome/google-chrome`. That wrapper runs
  `/opt/google/chrome/chrome`. The version is `Google Chrome 153.0.8010.52`.
  The apt candidate is `156.0.8078.79-1`. The owner order makes builds
  older than 156.0.8078.73 old. An update needs `sudo`, which is the owner's
  step. Chrome updates through apt, so the browser version can change between
  2 grades with no hash change.
- **EV13. The waiting tasks.** `daily_model_schedule` task 5.4 is `[b]` until
  a live day grades. `opencode_executor` task 4.4 part 2 and task 4.3 wait
  for a grader browser. `opencode_executor` task 4.4 part 1 (dry run and
  preflight, no browser) starts after this spec.
- **EV14. The BEFORE hashes.** The read-only command
  `cd harness && ./node_modules/.bin/tsx provenance.ts --shell` printed these
  values on 2026-11-04 with exit 0.

  ```
  3e5a4c64c9bcd0b30d6143389c8e96b9a80d955681df7b072c394db937ab29ea	451652e5e03ee1d3030014c527bff7714740b96a38756853d5fc68276c522ae6
  ```

  The first field is `runner_sha256`. The second field is `suite_sha256`.
- **EV15. The measured run counts.** A count script over `runs/` ran with
  `python3 -I` on 2026-11-04. It skipped the names that start with `.`. It
  read the executor rule of `harness/regrade-run.sh:30-39`. Its output
  carries the label "persisted flags, 2026-11-04". These counts are the
  persisted flags. They are not the live freshness state.

  ```
  LABEL: persisted flags, 2026-11-04
  (a) all run directories: 547
  (b) legacy Pi runs: 95
  (c) non-Pi runs: 452
  (d) non-Pi runs with candidate/ or candidate-original/: 335
  (e) non-Pi runs with candidate/ and all four flags true: 17
  (e) by track:
    build   8
    bugfix  0
    tests   9
    change  0
    canary  0
  (e) by ISO week token:
    2026w43      17
  (f) grading_seconds > 0, in hours, over the runs of (e):
    n    = 1
    mean = 0.0717
    median = 0.0717
    max  = 0.0717
    sum  = 0.0717
  ```

  The 17 runs of (e) hold 13 distinct model and track pairs over 9 distinct
  models. One run of the 17 has a `grading_seconds` value above 0. That run
  holds 258 s. A wider read over all 234 runs with a `grading_seconds` value
  gives a mean of 110.4 s, a median of 130.5 s, and a max of 374.0 s.
- **EV16. The regrade size.** A second read-only script applied the skip
  rules of `harness/regrade-run.sh` to the 547 run directories on 2026-11-04.
  It counted 160 curable runs. Of these, 30 run ids match the pattern of
  `harness/regrade-all.sh`, so the script reaches them. The other 130 have no
  week token or a name outside the pattern. The 30 reachable runs sit in 3
  weeks: 2026w38 build 10, 2026w39 build 2, and 2026w43 build 8 with tests
  10. The 4 runs of week 2026w41 are canary runs. Their names fall outside
  the pattern, so the script leaves them alone.

  The wider read of EV15 gives a mean grading time of 110.4 s. The 30
  reachable runs at that mean give about 0.9 h of grading. A regrade also
  copies the agent tree and installs its dependencies, so its wall time is
  longer than its grading time. The pilot of D7 step 1 measures that wall
  time.

## Definitions

- **Grader browser.** The browser that runs the Playwright suite of a grade.
  Today it is the pinned headless shell of revision 1234. After this track it
  is the system Chrome.
- **System Chrome.** The Chrome binary at `/opt/google/chrome/chrome`. The
  launcher `/usr/bin/google-chrome` runs it through the wrapper
  `/opt/google/chrome/google-chrome`.
- **Live check.** The freshness test that compares the run hashes with the
  live hashes. It is the code of `harness/provenance-check.ts` and
  `harness/score-freshness.ts`.
- **Persisted flags.** The four flags `valid`, `trusted`, `publishable`, and
  `rankable` as they stand in the `score.json` of a run. The site shows these
  flags.
- **Curable run.** A run that `harness/regrade-run.sh` can grade again. It
  has a candidate tree, a model and an arm, an execution identity, and no
  hard contract violation on record.
- **Heavy run.** A job that starts a browser. It runs only through
  `/home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh`.
- **Run day.** A Wednesday or a Sunday on which the daily job runs at 01:00
  local time.
- **Regrade slot.** One heavy-run slot. It holds one ISO week of regrades.

## Design decisions

Each decision below is a default by the orchestrator, 2026-11-04. The PM can
change it.

1. **D1. The browser.** The `use` block of `harness/playwright.config.ts` sets
   `channel: "chrome"`. `harness/browser-check.ts` calls
   `chromium.launch({ channel: "chrome" })`. No file sets `executablePath`.
   The track runs no `playwright install`.
2. **D2. The browser record.** `harness/browser-check.ts` also returns the
   version of the launched browser (`browser.version()`).
   `harness/grade.sh` writes a new artifact `artifacts/grader-browser.json`
   with `{"schema":1,"channel":"chrome","version":"<version>"}` for each
   grade that launches a browser. The version is a record, not a freshness
   input. A Chrome update does not make a score stale. The tests track
   launches no browser (`harness/grade.sh:146-147`), so its grade writes no
   record. The guard of D3 reads the track of the run first, so a tests-track
   run needs no record.
3. **D3. The rescore guard.** `harness/rescore-doctor.sh` reads the track of
   the run first. A tests-track run (the provenance `track` is `tests`, or the
   run id starts with `tt-`) passes the guard, because its grade launches no
   browser and its results do not depend on the browser. A run of the build,
   bugfix, or change track passes the guard only with a record whose `channel`
   is `chrome`. Any other run prints one
   `SKIP <run> (graded before the system Chrome move; regrade needed)` line
   and changes nothing. The check runs before any write. The guard lands in
   the same commit as D1, so no live day can see the new hashes without it.
4. **D4. The pre-batch checks.** `harness/cron-daily.sh:356-360` and
   `harness/weekly.sh:23-29` check the system Chrome instead of the
   headless shell path. The check tests that the system Chrome binary exists
   and runs. It tests no version, so the live day does not wait for the
   update of D9. `cron-daily.sh` keeps the prefix `DAILY FAIL playwright:`
   and exits 2. `weekly.sh` stops telling the operator to run
   `npx playwright install chromium`. The fake path in
   `harness/schedule-tests/daily-schedule-green.test.ts:76` changes to the
   system Chrome path. The old rerun scripts stay unchanged, because their
   removal waits for the owner.
5. **D5. The stale mark.** After the harness commit, the live check marks
   every old non-Pi score `STALE-PROVENANCE` (EV6, no change). The guard of
   D3 keeps that mark until a regrade. `harness/export-site-data.py` adds a
   data field `grader_browser` to each result. The field holds `chrome` for a
   run with a record whose `channel` is `chrome`, `none` for a tests-track
   run, and `legacy-headless-shell` for a build, bugfix, or change run with
   no record. The Pi runs sit in the last group. The value holds no revision
   number, because older runs used other headless shell revisions. The
   visible page text for the mark goes to the PM first, then to Daniel for a
   look check, because `docs/` is the public site. Until the PM gives the
   text, the pages change nothing.
6. **D6. The cure.** The cure is the regrade only (`regrade-run.sh`,
   `regrade-all.sh`). This track runs no agent and makes no model call. It
   adds 0 USD and 0 % Go quota per day. A run that the regrade cannot cure
   (no candidate tree, hard violation, Pi) keeps its stale mark. The daily
   schedule tests its model again in the normal untested-then-stalest order,
   inside the existing budget of EV10 and the 80 % guard. This track adds no
   run day.
7. **D7. The regrade order.** The order has 3 steps. (1) A pilot: regrade 1
   persisted-rankable build run of week 2026w43. Record the old and the new
   totals. (2) Regrade week 2026w43 and all its reachable runs (EV16: build
   8 and tests 10). Those runs hold all 17 persisted-rankable runs of EV15.
   The pilot run of step 1 is one of them, so it is graded again. Its second
   old total comes from the first `artifacts.prev-<stamp>/`.
   (3) Regrade all other curable weeks, newest first: 2026w39, then 2026w38.
   One ISO week takes one heavy-run slot (`WEEKS=<week> ./regrade-all.sh`
   through `heavy-run.sh`). Storytime roles take the slots first (PM rule 1).
   A regrade never holds the daily lock, because a held lock would stop the
   live day. A regrade starts only when `flock -n <lock> true` exits 0 on the
   daily lock (`BENCH_DAILY_LOCK`, default `$ROOT/.tmp/weekly-cron.lock`,
   `harness/cron-daily.sh:34`) and `systemctl --user list-timers
   lending-desk-daily.timer` shows the next start more than 4 hours away.
   One `heavy-run.sh` call stops at `HEAVY_RUN_TIMEOUT_S` (default 5400 s,
   `/home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh:38-43`).
   When the pilot wall time times the run count of a week is more than 80
   minutes, the week runs as separate calls by prefix (`ONLY=a-`, `ONLY=b-`,
   `ONLY=tt-`), one heavy-run call each. After each week, record the OK,
   FAIL, and SKIP counts, and run `PI_CHECK`. It must print `PI_CHECK=pass`.
   The day count comes from the measured run count of EV16 and the measured
   grading time of EV15. The pilot of step 1 gives the wall time of one
   regrade. The runs per day = the hours of one heavy-run slot divided by
   that wall time. The day count = the reachable run count divided by the
   runs per day.
8. **D8. The score change report.** For each regraded run, record the old and
   the new total. The new total comes from the
   `[<run-id>] REGRADED total=<n> valid=<bool>` line of the log. The old
   total comes from the `score.json` of `artifacts.prev-<stamp>/`. Per track,
   record the mean and the max absolute change. List each run with a change of
   more than 5 points. The orchestrator sends this report to the PM before the
   next live day publishes the regraded scores, because the public numbers
   change.
9. **D9. The Chrome version.** Ask Daniel, through the PM, to update the
   system Chrome to 156.0.8078.79 or newer with `sudo` before the regrade of
   D7 step 2. The harness change and the live day do not wait for it. The
   steps 2 and 3 of D7 wait for it.
10. **D10. The lanes.** This spec and plan are the light lane. The harness
    change of D1 to D5 is a small code change on the light lane, with one
    maker and one checker of a different model family (PM rule 4: the family
    rule applies to code). Only the tests of the touched files run during the
    change (PM rule 2). The full suite runs once at the end of the code
    phase, through `heavy-run.sh`.
11. **D11. The hashes.** The spec records the BEFORE values of EV14. The plan
    records the AFTER values (`tsx provenance.ts --shell`) right after the
    harness commit. The plan records the `reports/harness-hashes.sha` value
    after the next live day.
12. **D12. The order with the other tracks.** The target: the harness commit
    lands before Sun 2026-11-08 01:00 +07, so that the live day can grade
    and close `daily_model_schedule` task 5.4. Else the next live day is Wed
    2026-11-11. `opencode_executor` task 4.4 part 2 runs only after the
    step 3 of D7 ends. With D3, an earlier rescore relabels no build, bugfix,
    or change result, but the task waits so its record stays clear.

## Functional requirements

### FR-1 — The grader browser is the system Chrome

- The `use` block of `harness/playwright.config.ts` sets `channel: "chrome"`.
  `harness/browser-check.ts` calls `chromium.launch({ channel: "chrome" })`.
  No file of the harness sets `executablePath`. The track runs no
  `playwright install`.
- **Check.** `rg -n "channel" harness/playwright.config.ts` prints one line
  that holds `channel: "chrome"`. `rg -n "executablePath" harness/` prints
  no line. The browser-check command runs through `heavy-run.sh`, because it
  launches a browser. `cd harness && npx tsx browser-check.ts` prints
  `browser ready` and exits 0.

### FR-2 — The browser record

- `harness/browser-check.ts` returns the version of the launched browser.
  `harness/grade.sh` writes `artifacts/grader-browser.json` with
  `{"schema":1,"channel":"chrome","version":"<version>"}` for each grade that
  launches a browser. A tests-track grade launches no browser, so it writes
  no record. The record is not a freshness input. A Chrome update does not
  make a score stale.
- **Check.** A graded build, bugfix, or change run holds
  `runs/<run-id>/artifacts/grader-browser.json` with `schema` 1 and `channel`
  `chrome`. A tests-track run holds no such file. The freshness check on
  that run reads no field of that file.

### FR-3 — The rescore guard

- `harness/rescore-doctor.sh` reads the track of the run first. A
  tests-track run (the provenance `track` is `tests`, or the run id starts
  with `tt-`) passes the guard. A run of the build, bugfix, or change track
  passes the guard only with a record whose `channel` is `chrome`. Any other
  run prints one
  `SKIP <run> (graded before the system Chrome move; regrade needed)` line
  and changes nothing. The check runs before any write of the run.
- The guard lands in the same commit as FR-1.
- **Check.** A build, bugfix, or change run without the record keeps the
  bytes of its `score.json` after `WEEK=all ./rescore-doctor.sh`. The log
  holds one `SKIP <run> (graded before the system Chrome move; regrade
  needed)` line for that run. A tests-track run passes the guard.

### FR-4 — The pre-batch checks

- `harness/cron-daily.sh:356-360` and `harness/weekly.sh:23-29` check the
  system Chrome instead of the headless shell path. The check tests no
  version. `cron-daily.sh` keeps the prefix `DAILY FAIL playwright:` and
  exits 2. `weekly.sh` stops telling the operator to run
  `npx playwright install chromium`. The fake path in
  `harness/schedule-tests/daily-schedule-green.test.ts:76` names the system
  Chrome path. The old rerun scripts stay unchanged.
- **Check.** `rg -n "chromium_headless_shell" harness/cron-daily.sh
  harness/weekly.sh` prints no line. `rg -n "playwright install chromium"
  harness/weekly.sh` prints no line.

### FR-5 — The stale mark

- The live check marks every old non-Pi score `STALE-PROVENANCE` after the
  harness commit (EV6). The guard of FR-3 holds that mark until a regrade.
  `harness/export-site-data.py` adds a data field `grader_browser` to each
  result. The field holds `chrome` for a run with a record whose `channel` is
  `chrome`, `none` for a tests-track run, and `legacy-headless-shell` for a
  build, bugfix, or change run with no record. The visible page text waits
  for the PM and then for Daniel.
- **Check.** `cd harness && npx tsx score-freshness.ts <run>/artifacts/score.json`
  prints a JSON line that holds `"state":"STALE-PROVENANCE"` and
  `"rankable":false`.

### FR-6 — The cure is the regrade

- The regrade (`regrade-run.sh`, `regrade-all.sh`) is the only cure. The
  track runs no agent and makes no model call. It adds 0 USD and 0 % Go quota
  per day. A run that the regrade cannot cure keeps its stale mark.
- **Check.** `harness/regrade-run.sh` starts no agent, and the regrade log
  holds no `opencode` start line. For each regraded run, `cmp` shows that the
  copied-forward files (`execution-identity.json`, `executor-cohort.json`,
  and the transcript) in `artifacts/` equal the copies in
  `artifacts.prev-<stamp>/`.

### FR-7 — The regrade order

- The order has 3 steps (D7). Step 1 regrades 1 persisted-rankable build run
  of week 2026w43. Step 2 regrades week 2026w43 and all its reachable runs.
  Step 3 regrades all other curable weeks, newest first: 2026w39, then
  2026w38. One ISO week takes one heavy-run slot. Storytime roles take the
  slots first. A regrade never holds the daily lock, and it starts only when
  the next live day starts more than 4 hours away.
- After each week, the plan records the OK, FAIL, and SKIP counts, and runs
  `PI_CHECK`. It must print `PI_CHECK=pass`.
- **Check.** The regrade log of each week holds a line
  `REGRADE-ALL END <time> ok=<n> not-ok=<n> skipped=<n>`. `PI_CHECK` prints
  `PI_CHECK=pass`.

### FR-8 — The score change report

- For each regraded run, the report holds the old total and the new total.
  The old total comes from the `score.json` of `artifacts.prev-<stamp>/`. The
  new total comes from the `[<run-id>] REGRADED total=<n> valid=<bool>` line
  of the log. Per track, the report holds the mean change and the max
  absolute change. The report lists each run with a change of more than 5
  points. The orchestrator sends the report to the PM before the next live
  day publishes the regraded scores.
- **Check.** The report holds one old total and one new total for each
  regraded run. The list of runs with a change of more than 5 points matches
  the report.

### FR-9 — The hashes

- The spec holds the BEFORE values of EV14. The plan holds the AFTER values
  right after the harness commit. The plan holds the
  `reports/harness-hashes.sha` value after the next live day.
- **Check.** `cd harness && ./node_modules/.bin/tsx provenance.ts --shell`
  prints two hashes. Both differ from the values of EV14. After the next
  live day, `reports/harness-hashes.sha` holds the same two values.

### FR-10 — The order with the other tracks

- The harness commit lands before Sun 2026-11-08 01:00 +07, so that the live
  day can grade and close `daily_model_schedule` task 5.4. That close happens
  on that live day, not after the regrade. Else the next live day is Wed
  2026-11-11. `opencode_executor` task 4.4 part 2 runs only after the
  step 3 of D7 ends.
- **Check.** The plan records the commit SHA of the harness commit and the
  date of the next live day. The plan records the day that closed
  `daily_model_schedule` task 5.4.

### FR-11 — The Chrome version

- The owner updates the system Chrome to 156.0.8078.79 or newer with `sudo`
  before the regrade of the step 2 of D7. The harness change and the live
  day do not wait for that update.
- **Check.** `google-chrome --version` prints a version of 156.0.8078.79 or
  newer before the step 2 of D7 starts.

### FR-12 — The lanes

- The spec and the plan are the light lane. The harness change of D1 to D5 is
  a small code change on the light lane, with one maker and one checker of a
  different model family. Only the tests of the touched files run during the
  change. The full suite runs once at the end of the code phase, through
  `heavy-run.sh`.
- **Check.** The plan records the model of the maker and the model of the
  checker. The two models sit in different families. The plan records the
  full-suite run through `heavy-run.sh`.

## Non-functional requirements

- **NFR-1 No model call.** This track sends no model call. The regrade calls
  no model. The tests, the dry runs, and the browser check send no prompt.
- **NFR-2 No Go quota.** This track spends 0 % of the Go weekly window and
  0 % of the Go monthly window.
- **NFR-3 The Pi history stays the same.** Each legacy Pi record keeps every
  byte. The regrade and the rescore skip it.
- **NFR-4 No browser install.** The track runs no `playwright install` and no
  `apt`. The owner runs the Chrome update of D9 with `sudo`.
- **NFR-5 The public site waits.** No push of `docs/` happens before the
  page text gate of D5.
- **NFR-6 The change stays out of the fixture.** The change touches no file
  of `fixture/` or `reference*/`.

## Owner decisions

| ID | Decision | Proposed default | Answer |
|---|---|---|---|
| O1 | Move the grader browser to the system Chrome. The owner answered "B" (Tasks, 2026-11-04 05:29 ICT, relayed by the PM orchestrator). The choice moves `runner_sha256` and `suite_sha256`, and makes every trusted score stale. The cure is the regrade. The regrade makes no model call and spends no Go quota. | Approve the plan of D1 to D12 and the order of D7. | answered 2026-11-04 — Daniel answered "B" (Tasks, 2026-11-04 05:29 ICT, relayed by the PM orchestrator), exact in quotation: "B". Rules: D1 to D12. |
| O2 | The version of the system Chrome before the regrade of the step 2 of D7. The apt candidate is 156.0.8078.79-1. The owner order of 2026-11-03 makes builds older than 156.0.8078.73 old. | The owner runs `sudo apt-get install -y google-chrome-stable` before the step 2 of D7. The harness change and the live day do not wait for it. | open — the PM asks the owner |

## Acceptance criteria

1. **AC-1** The grader browser is the system Chrome, and no file sets
   `executablePath` (FR-1).
2. **AC-2** Each grade that launches a browser writes
   `artifacts/grader-browser.json`, no freshness check reads that file, and
   a tests-track grade writes no record (FR-2).
3. **AC-3** `rescore-doctor.sh` skips each build, bugfix, or change run
   without the record, passes each tests-track run, and changes nothing
   (FR-3).
4. **AC-4** The pre-batch checks name the system Chrome, and `weekly.sh` names
   no `playwright install` command (FR-4).
5. **AC-5** The live check marks each old non-Pi score `STALE-PROVENANCE`,
   and the site export adds the field `grader_browser` with `chrome`,
   `none`, or `legacy-headless-shell` (FR-5).
6. **AC-6** The regrade starts no agent, and the copied-forward files of each
   regraded run equal their copies in `artifacts.prev-<stamp>/` (FR-6).
7. **AC-7** The regrade order of D7 runs week by week, and `PI_CHECK` prints
   `PI_CHECK=pass` after each week (FR-7).
8. **AC-8** The score change report holds the old and the new total of each
   regraded run, and it reaches the PM before the next live day publishes the
   regraded scores (FR-8).
9. **AC-9** The AFTER hashes differ from the BEFORE values of EV14, and
   `reports/harness-hashes.sha` holds the same values after the next live day
   (FR-9).
10. **AC-10** The harness commit lands before Sun 2026-11-08 01:00 +07, and
    the live day closes `daily_model_schedule` task 5.4 (FR-10).
11. **AC-11** The system Chrome holds version 156.0.8078.79 or newer before
    the step 2 of D7 (FR-11).
12. **AC-12** The maker and the checker sit in different model families, and
    the full suite ran once through `heavy-run.sh` (FR-12).

## Out of scope

- A change of the scoring formula, of the axis weights, or of
  `SATURATED_WEIGHT`.
- A new run day. The daily schedule keeps Wed and Sun at 01:00.
- A change of the price table or of the model list.
- The removal of the old rerun scripts. Their removal waits for the owner.
- A version gate in the pre-batch check. The check tests no version.
- A visible page text for the stale mark before the gate of D5.

## Risks

- **R1 The system Chrome renders and times pages differently.** The new
  headless mode of Chrome can change a rendered page and a page load time. The
  totals of a regraded run can move. The report of D8 gives each change.
- **R2 The system Chrome updates itself.** Chrome updates through apt. The
  browser version can change between 2 grades with no hash change. The record
  of D2 keeps the version of each grade, and it is no freshness input.
- **R3 The heavy-run time competes with Storytime.** A regrade starts a
  browser. The slots go to Storytime first (PM rule 1). The regrade waits.
- **R4 The AFTER hash can change again.** Another harness commit can land
  between the harness commit and the next live day. The plan then records the
  new AFTER values and names the other commit.
- **R5 The rescore relabels the old scores.** The rescore rewrites the
  provenance with the current hashes and runs no test. Without the guard of
  D3, the first live day would cure the stale mark without a regrade. The
  guard lands in the same commit as D1.
- **R6 The tests track labels itself current.** On the first live day, the
  rescore labels the legacy tests-track runs as current. This is correct,
  because their grade used no browser.
- **R7 The site shows the old numbers.** The export copies the persisted
  flags. The site keeps the old scores as rankable until a run writes a new
  `score.json`. The gate of D5 holds the page text.
- **R8 The Chrome update waits.** The owner runs the update with `sudo`. The
  step 2 and the step 3 of D7 wait for it, so the regrade runs on one
  browser version.
