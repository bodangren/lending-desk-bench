# Implementation plan — grader_system_chrome

PM 2026-11-03: light lane

PM order 2026-11-28 16:35: starts after the harness_audit fixes. No new model runs and no paid route; build roles from ra-quota pick; Go paid models stay held until the 2026-12-18 reset.

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
  - R4 update (2026-11-08):
    - The harness commits of the track `opencode_host_isolation` changed
      both values after task 1.4. Its task 1.6 holds the Phase 1 history
      (`46edf4c`, then `18a942d`): `runner_sha256`
      `56c9d61d1f1fb9e75f11602b44b656827451eb07b90cc42c5b5c7e2b66cd6944`,
      `suite_sha256`
      `8a24205b405a9aae22cf2412d3fc9a40b4b3ffdb30e2a0c0cfa26c4405ee734d`.
    - Its Phase 4 commits `2536359` and `6d37c69` changed
      `harness/opencode-credential.sh` and `harness/go-cost.ts`. The
      current `runner_sha256` is
      `9d26e6c875288d4b8d1c25850673bc464e6aa58610676073a3030e36eb3395ef`.
      `suite_sha256` stays
      `8a24205b405a9aae22cf2412d3fc9a40b4b3ffdb30e2a0c0cfa26c4405ee734d`
      (task 4.4 of `opencode_host_isolation`, commit `5a855ec`).
    - The current AFTER values are these two values. The next live day and
      the rescore of tasks 2.3 and 2.4 see them.

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

- [x] 2.2 `2672686` The live days after `c50b836` graded on the system Chrome. The proof
  is the live day of 2026-11-25 (published 2026-11-26 as `162c7a2`, model
  `mimo-v2.6-pro`). Run `a-mimo-v2-6-pro-2026w48-r1` holds
  `artifacts/grader-browser.json` written 2026-11-25 19:42 with
  `{"schema":1,"channel":"chrome","version":"157.0.8103.78"}`. Run
  `b-mimo-v2-6-pro-2026w48-r1` holds the same record, written 2026-11-26 01:58.
  `reports/cron-daily.log` holds one `DAILY FAIL playwright` line, at line 3
  (2026-11-04), before the system Chrome move, and no such line after it.
  The `DAY_CHECK` and `PI_SHA` verify lines are dropped: the PM closed
  `daily_model_schedule` on 2026-11-27 ("not needed"), so that track runs no
  day check.
  - Lane: light. This task records the evidence.
- [x] 2.3 `13b970e` The pilot regrade. Regrade 1 public build run,
  `a-hy4-flash-free-2026w48-r2`, which shows 71.9 on the site now. The grader
  change `05c1975` changes the suite hash, so every stored grade before it is
  stale. Record the old total, the new total, and the wall time of the run.
  - Command: `HEAVY_MIN_AVAIL_MB=1500 /home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh -c 'cd harness && ./regrade-run.sh a-hy4-flash-free-2026w48-r2'`.
  - `regrade-run.sh` was read on 2026-11-28. It moves the previous artifacts to
    `runs/<run-id>/artifacts.prev-<stamp>/`, copies the transcript, execution
    identity, executor files, and diff forward, and grafts the agent files on
    the current fixture. It restores the previous artifacts when the graft or
    `grade.sh` fails. It calls no model: it builds the candidate and runs the
    local test suites.
  - Verify: the log holds one `[a-hy4-flash-free-2026w48-r2] REGRADED total=<n> valid=true` line.
  - Verify: this task holds the old total and the new total of the run. The
    old total comes from the `score.json` of `artifacts.prev-<stamp>/`.
  - Verify: this task holds the wall time of one regrade. The time of task 4.2
    uses that value.
  - Result (2026-11-28, checked before the call: lock free, timer 5 h 28 min away).
    Start 19:31:36, end 19:36:41 (+07). The log holds
    `[a-hy4-flash-free-2026w48-r2] REGRADED total=96 valid=true adherence=1`.
    Old total 71.9 (`artifacts.prev-20261128193524/score.json`). New total 96.
  - Wall time: 305 s for the whole call. The wait before the regrade started
    was about 224 s (start to the `artifacts.prev` stamp 19:35:24). The regrade
    itself took 77 s (`grading_seconds` 69).
  - `artifacts.prev-20261128193524/` exists. `execution-identity.json` and
    `session.json.gz` have the same checksums before and after, and no new
    transcript was written (the files date from 2026-11-28 12:13 and 12:20).
    The call made no model call.
  - The new total is 1.5 points above the diagnostic proof `rv-1128-hy4-1`
    (94.5). Both runs fail only `M.closeout` and `P.dedup-item`. The gap is the
    quality axis (0.983 against 0.833, from the doctor warnings). The change from
    the old total is the 13 criteria and 3 probes of the due-date locator
    (`05c1975`), which now pass.
  - Lane: light. One heavy run.
- [x] 2.4 `2672686` The rescore SKIP lines. `grep -c "graded before the system Chrome move; regrade needed" reports/cron-daily.log` printed 139 on 2026-11-28 (above 0).
  - Lane: light. A read-only check.

## Phase 3: The human gates

- [x] 3.1 `2672686` The Chrome update. `google-chrome --version` printed
  `Google Chrome 157.0.8103.78` on 2026-11-28. The apt update had run. No
  `sudo` step was needed.
  - Lane: light. A read-only check.
- [x] 3.2 `2672686` The page text. Not needed. The regrade replaces the stale scores, so
  no stale-mark text goes on the pages (PM 2026-11-28).
  - Lane: light. No change.

## Phase 4: The regrade (D7, D8)

- [x] 4.1 `2672686` The regrade list. Read on 2026-11-28 with no write to a run. The
  runs are those that feed a public score in `docs/assets/data/`:
  `benchmark.json` (models, both arms, repeat runs, history rows),
  `tracks.json`, and `bugfix.json`. `real-work.json`, `review.json`, and
  `model-guide.json` read no grade of a run; the model guide reads the Build
  scores of `benchmark.json` and follows them. The stale check is
  `harness/score-freshness.ts --many` on the score of each run, through
  `heavy-run.sh`. It returned `STALE-PROVENANCE` (runner or suite hash does not
  match) for each of the 145 runs.
  - Measured wall time of a grade: 60 to 217 s, median 78 s (build log to
    collection record) over 9 recent runs of 2026w48 and `rv-1128-*`. The
    list of 82 runs is 1.8 to 4.9 hours of grade time before graft and doctor
    time. The pilot of task 2.3 sets the real value.
  - To regrade (82 runs, newest first). Columns: run id, track, stored total of the run before the regrade.
    a-hungerg-free-2026w48-r3 | build | 95.7
    b-hungerg-free-2026w48-r3 | build | 100
    a-mimo-v2-6-pro-2026w48-r3 | build | 94.7
    b-mimo-v2-6-pro-2026w48-r3 | build | 98
    a-hy4-flash-free-2026w48-r3 | build | 63.3
    b-hy4-flash-free-2026w48-r3 | build | 97.2
    a-hungerg-free-2026w48-r2 | build | 95.2
    b-hungerg-free-2026w48-r2 | build | 99.5
    a-mimo-v2-6-pro-2026w48-r2 | build | 71.5
    b-mimo-v2-6-pro-2026w48-r2 | build | 96.8
    a-hy4-flash-free-2026w48-r2 | build | 71.9
    b-hy4-flash-free-2026w48-r2 | build | 97.7
    a-hungerg-free-2026w48-r1 | build | 92.8
    b-hungerg-free-2026w48-r1 | build | 95.8
    a-mimo-v2-6-pro-2026w48-r1 | build | 94.5
    b-mimo-v2-6-pro-2026w48-r1 | build | 98.5
    a-hy4-flash-free-2026w48-r1 | build | 92.8
    b-hy4-flash-free-2026w48-r1 | build | 98.3
    bf-a-mimo-v2-6-pro-2026w48-r1 | bugfix | 100
    bf-b-mimo-v2-6-pro-2026w48-r1 | bugfix | 100
    ch-a-mimo-v2-6-pro-2026w48-r1 | change | 100
    ch-b-mimo-v2-6-pro-2026w48-r1 | change | 100
    a-qwen3-8-flash-2026w47-r3 | build | 94.8
    b-qwen3-8-flash-2026w47-r3 | build | 98.2
    a-qwen3-8-flash-2026w47-r2 | build | 95.2
    b-qwen3-8-flash-2026w47-r2 | build | 97.5
    a-qwen3-8-flash-2026w47-r1 | build | 96.5
    b-qwen3-8-flash-2026w47-r1 | build | 97.5
    bf-a-qwen3-8-flash-2026w47-r1 | bugfix | 100
    bf-b-qwen3-8-flash-2026w47-r1 | bugfix | 100
    ch-a-qwen3-8-flash-2026w47-r1 | change | 100
    ch-b-qwen3-8-flash-2026w47-r1 | change | 100
    a-mimo-v2-6-flash-2026w46-r3 | build | 95
    b-mimo-v2-6-flash-2026w46-r3 | build | 95.8
    a-muse-spark-1-3-contributor-2026w46-r3 | build | 93.7
    b-muse-spark-1-3-contributor-2026w46-r3 | build | 92.8
    a-glm-5-3-flash-2026w46-r3 | build | 89.8
    b-glm-5-3-flash-2026w46-r3 | build | 96.7
    a-mimo-v2-6-flash-2026w46-r2 | build | 91.7
    b-mimo-v2-6-flash-2026w46-r2 | build | 97.8
    a-muse-spark-1-3-contributor-2026w46-r2 | build | 93.8
    b-muse-spark-1-3-contributor-2026w46-r2 | build | 95.2
    a-glm-5-3-flash-2026w46-r2 | build | 90.8
    b-glm-5-3-flash-2026w46-r2 | build | 93.8
    a-mimo-v2-6-flash-2026w46-r1 | build | 95.7
    b-mimo-v2-6-flash-2026w46-r1 | build | 97.7
    a-muse-spark-1-3-contributor-2026w46-r1 | build | 93.8
    b-muse-spark-1-3-contributor-2026w46-r1 | build | 96.2
    a-glm-5-3-flash-2026w46-r1 | build | 89.9
    b-glm-5-3-flash-2026w46-r1 | build | 93.4
    bf-a-beam-free-2026w46-r1 | bugfix | 100
    bf-b-beam-free-2026w46-r1 | bugfix | 100
    bf-a-glm-5-3-flash-2026w46-r1 | bugfix | 100
    bf-b-glm-5-3-flash-2026w46-r1 | bugfix | 100
    bf-a-iceman-contributor-free-2026w46-r1 | bugfix | 100
    bf-b-iceman-contributor-free-2026w46-r1 | bugfix | 100
    bf-a-mimo-v2-6-flash-2026w46-r1 | bugfix | 100
    bf-b-mimo-v2-6-flash-2026w46-r1 | bugfix | 100
    bf-a-muse-spark-1-3-contributor-2026w46-r1 | bugfix | 100
    bf-b-muse-spark-1-3-contributor-2026w46-r1 | bugfix | 100
    bf-b-kimi-k2-7-code-2026w46-r1 | bugfix | 96.4
    bf-a-kimi-k2-7-code-2026w46-r1 | bugfix | 92.9
    ch-a-beam-free-2026w46-r1 | change | 100
    ch-b-beam-free-2026w46-r1 | change | 100
    ch-a-glm-5-3-flash-2026w46-r1 | change | 100
    ch-b-glm-5-3-flash-2026w46-r1 | change | 100
    ch-a-iceman-contributor-free-2026w46-r1 | change | 100
    ch-b-iceman-contributor-free-2026w46-r1 | change | 100
    ch-a-kimi-k2-7-code-2026w46-r1 | change | 100
    ch-b-kimi-k2-7-code-2026w46-r1 | change | 100
    ch-a-mimo-v2-6-flash-2026w46-r1 | change | 100
    ch-b-mimo-v2-6-flash-2026w46-r1 | change | 100
    ch-a-muse-spark-1-3-contributor-2026w46-r1 | change | 100
    ch-b-muse-spark-1-3-contributor-2026w46-r1 | change | 100
    a-deepseek-v4-1-flash-2026w43-r1 | build | 95
    b-deepseek-v4-1-flash-2026w43-r1 | build | 97.7
    a-gpt-6-luna-2026w43-r1 | build | 94.5
    b-gpt-6-luna-2026w43-r1 | build | 98.7
    a-minimax-m3-1-flash-2026w43-r1 | build | 91.1
    b-minimax-m3-1-flash-2026w43-r1 | build | 96.7
    a-claude-haiku-5-5-2026w43-r1 | build | 88.9
    b-claude-haiku-5-5-2026w43-r1 | build | 97.7
  - Cannot be regraded (35 runs). Reason for each: legacy Pi executor.
    `regrade-run.sh` prints one `SKIP` line and keeps every artifact byte.
    b-mimo-v2-6-flash-2026w39 | build | 95
    a-mimo-v2-6-flash-2026w39 | build | 7.9
    b-qwen3-8-flash-2026w38 | build | 30.3
    b-muse-spark-1-3-contributor-2026w38 | build | 93.7
    b-mimo-v2-5-2026w38 | build | 91
    b-longcat-2-0-2026w38 | build | 76.9
    b-gpt-5-6-luna-2026w38 | build | 95
    b-glm-5-3-flash-2026w38 | build | 57.2
    a-muse-spark-1-3-contributor-2026w38 | build | 92.7
    a-muse-spark-1-2-contributor-2026w38 | build | 89.3
    a-mimo-v2-5-2026w38 | build | 86.1
    a-longcat-2-0-2026w38 | build | 90.1
    a-glm-5-3-flash-2026w38 | build | 90.4
    a-deepseek-v4-1-flash-2026w38 | build | 90.9
    bf-a-qwen3-8-flash-2026w37 | bugfix | 100
    bf-a-qwen3-7-plus-2026w37 | bugfix | 89.4
    bf-a-qwen3-6-plus-2026w37 | bugfix | 92.7
    bf-a-omen-alpha-2026w37 | bugfix | 100
    bf-a-muse-spark-1-3-contributor-2026w37 | bugfix | 98.9
    bf-a-muse-spark-1-2-contributor-2026w37 | bugfix | 100
    bf-a-minimax-m3-2026w37 | bugfix | 96.4
    bf-a-minimax-m2-7-2026w37 | bugfix | 58.7
    bf-a-minimax-m2-5-2026w37 | bugfix | 85.3
    bf-a-mimo-v2-5-pro-2026w37 | bugfix | 76.9
    bf-a-mimo-v2-5-2026w37 | bugfix | 96.4
    bf-a-longcat-2-0-2026w37 | bugfix | 86
    bf-a-gpt-5-6-luna-2026w37 | bugfix | 100
    bf-a-glm-5-3-flash-2026w37 | bugfix | 96.4
    bf-a-deepseek-v4-flash-vision-exp-2026w37 | bugfix | 100
    bf-a-deepseek-v4-1-flash-2026w37 | bugfix | 100
    b-qwen3-7-plus-2026w37 | build | 62.7
    a-qwen3-8-flash-2026w37 | build | 94.3
    a-qwen3-7-plus-2026w37 | build | 62.8
    a-hy3-2026w37 | build | 84.3
    a-gpt-5-6-luna-2026w37 | build | 89.5
  - Needs no regrade (28 runs). The `tests` and `docs-and-ops` grades launch no
    browser, and no changed test file reaches them, so their totals cannot
    move. Their stale label clears with `rescore-doctor.sh`, which runs no
    test and no browser (step of task 4.2).
    tt-b-mimo-v2-6-pro-2026w48-r1 | tests | 94.1
    tt-a-mimo-v2-6-pro-2026w48-r1 | tests | 96.7
    tt-b-qwen3-8-flash-2026w47-r1 | tests | 28.3
    tt-a-qwen3-8-flash-2026w47-r1 | tests | 96.8
    tt-b-muse-spark-1-3-contributor-2026w46-r1 | tests | 92.5
    tt-b-mimo-v2-6-flash-2026w46-r1 | tests | 96
    tt-b-kimi-k2-7-code-2026w46-r1 | tests | 98.5
    tt-b-iceman-contributor-free-2026w46-r1 | tests | 89.9
    tt-b-glm-5-3-flash-2026w46-r1 | tests | 87.7
    tt-a-muse-spark-1-3-contributor-2026w46-r1 | tests | 90.9
    tt-a-mimo-v2-6-flash-2026w46-r1 | tests | 0
    tt-a-kimi-k2-7-code-2026w46-r1 | tests | 0
    tt-a-iceman-contributor-free-2026w46-r1 | tests | 80.1
    tt-a-glm-5-3-flash-2026w46-r1 | tests | 0
    tt-a-beam-free-2026w46-r1 | tests | 96.3
    tt-b-muse-spark-1-2-contributor-2026w43-r1 | tests | 93.9
    tt-b-mimo-v2-5-2026w43-r1 | tests | 91.6
    tt-b-deepseek-v4-1-flash-2026w43-r1 | tests | 98
    tt-a-minimax-m3-1-flash-2026w43-r1 | tests | 93.2
    tt-a-gpt-6-luna-2026w43-r1 | tests | 93.5
    tt-a-gpt-5-6-luna-2026w43-r1 | tests | 79.4
    tt-a-claude-haiku-5-5-2026w43-r1 | tests | 98.7
    do-b-muse-spark-1-3-contributor-2026w48-r1 | docs-and-ops | 100
    do-b-hy4-flash-free-2026w48-r1 | docs-and-ops | 100
    do-b-hungerg-free-2026w48-r1 | docs-and-ops | 98.3
    do-a-muse-spark-1-3-contributor-2026w48-r1 | docs-and-ops | 99.3
    do-a-hy4-flash-free-2026w48-r1 | docs-and-ops | 100
    do-a-hungerg-free-2026w48-r1 | docs-and-ops | 100
  - Lane: light. A read-only list.
- [~] 4.2 The regrade. Regrade the 82 runs of task 4.1, newest first, one run
  for each `heavy-run.sh` call, with no model call. Keep the rule of task 4.3
  before each call.
  - Command: `HEAVY_MIN_AVAIL_MB=1500 /home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh -c 'cd harness && ./regrade-run.sh <run-id>'`.
  - Verify: the log of each run holds a `[<run-id>] REGRADED total=<n> valid=<bool>` line.
  - After the last run: `HEAVY_MIN_AVAIL_MB=1500 /home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh -c 'cd harness && WEEK=all ./rescore-doctor.sh'`
    clears the stale label of the 28 `tests` and `docs-and-ops` runs.
  - Verify: `harness/score-freshness.ts --many` on the 4.1 list shows no
    `STALE-PROVENANCE` for a regraded run, a `tests` run, or a `docs-and-ops` run.
  - Verify: this task holds the OK, FAIL, and SKIP counts.
  - Record of each call (run id | lock check | timer left | REGRADED line | old total). The lock check and the timer read of task 4.3 are in each line.
    a-hy4-flash-free-2026w48-r2 | lock rc 0 | timer left 5h28m | REGRADED total=96 valid=true | old 71.9 (pilot, task 2.3)
    a-hungerg-free-2026w48-r3 | lock rc 0 | timer left 5h22m | REGRADED total=96.2 valid=true adherence=1 | old 95.7 | wall 102s
    b-hungerg-free-2026w48-r3 | lock rc 0 | timer left 5h20m | REGRADED total=100 valid=true adherence=1 | old 100 | wall 217s
    a-mimo-v2-6-pro-2026w48-r3 | lock rc 0 | timer left 5h16m | REGRADED total=96.2 valid=true adherence=1 | old 94.7 | wall 264s
    b-mimo-v2-6-pro-2026w48-r3 | lock rc 0 | timer left 5h12m | REGRADED total=98.5 valid=true adherence=1 | old 98 | wall 149s
    a-hy4-flash-free-2026w48-r3 | lock rc 0 | timer left 5h10m | REGRADED total=91.1 valid=true adherence=0.5 | old 63.3 | wall 75s
    b-hy4-flash-free-2026w48-r3 | lock rc 0 | timer left 5h08m | REGRADED total=98.7 valid=true adherence=1 | old 97.2 | wall 85s
    a-hungerg-free-2026w48-r2 | lock rc 0 | timer left 5h07m | REGRADED total=96.2 valid=true adherence=1 | old 95.2 | wall 91s
    b-hungerg-free-2026w48-r2 | lock rc 0 | timer left 5h05m | REGRADED total=100 valid=true adherence=1 | old 99.5 | wall 96s
    a-mimo-v2-6-pro-2026w48-r2 | lock rc 0 | timer left 5h04m | REGRADED total=96.2 valid=true adherence=1 | old 71.5 | wall 87s
    b-mimo-v2-6-pro-2026w48-r2 | lock rc 0 | timer left 5h02m | REGRADED total=100 valid=true adherence=1 | old 96.8 | wall 72s
    b-hy4-flash-free-2026w48-r2 | lock rc 0 | timer left 5h01m | REGRADED total=98.7 valid=true adherence=1 | old 97.7 | wall 73s
    a-hungerg-free-2026w48-r1 | lock rc 0 | timer left 5h00m | REGRADED total=94.8 valid=true adherence=1 | old 92.8 | wall 109s
    b-hungerg-free-2026w48-r1 | lock rc 0 | timer left 4h58m | REGRADED total=95.2 valid=true adherence=1 | old 95.8 | wall 81s
    a-mimo-v2-6-pro-2026w48-r1 | lock rc 0 | timer left 4h57m | REGRADED total=95 valid=true adherence=1 | old 94.5 | wall 83s
    b-mimo-v2-6-pro-2026w48-r1 | lock rc 0 | timer left 4h55m | REGRADED total=100 valid=true adherence=1 | old 98.5 | wall 79s
    a-hy4-flash-free-2026w48-r1 | lock rc 0 | timer left 4h54m | REGRADED total=93.8 valid=true adherence=1 | old 92.8 | wall 96s
    b-hy4-flash-free-2026w48-r1 | lock rc 0 | timer left 4h52m | REGRADED total=98.7 valid=true adherence=1 | old 98.3 | wall 91s
    bf-a-mimo-v2-6-pro-2026w48-r1 | lock rc 0 | timer left 4h51m | REGRADED total=100 valid=true adherence=1 | old 100 | wall 103s
    bf-b-mimo-v2-6-pro-2026w48-r1 | lock rc 0 | timer left 4h49m | REGRADED total=100 valid=true adherence=1 | old 100 | wall 145s
    ch-a-mimo-v2-6-pro-2026w48-r1 | lock rc 0 | timer left 4h47m | REGRADED total=100 valid=true adherence=1 | old 100 | wall 120s
    ch-b-mimo-v2-6-pro-2026w48-r1 | lock rc 0 | timer left 4h45m | REGRADED total=100 valid=true adherence=1 | old 100 | wall 314s
    a-qwen3-8-flash-2026w47-r3 | lock rc 0 | timer left 4h40m | REGRADED total=96 valid=true adherence=1 | old 94.8 | wall 244s
    b-qwen3-8-flash-2026w47-r3 | lock rc 0 | timer left 4h36m | REGRADED total=98.7 valid=true adherence=1 | old 98.2 | wall 85s
    a-qwen3-8-flash-2026w47-r2 | lock rc 0 | timer left 4h34m | REGRADED total=96.2 valid=true adherence=1 | old 95.2 | wall 106s
    b-qwen3-8-flash-2026w47-r2 | lock rc 0 | timer left 4h32m | REGRADED total=98.5 valid=true adherence=1 | old 97.5 | wall 73s
    a-qwen3-8-flash-2026w47-r1 | lock rc 0 | timer left 4h31m | REGRADED total=97.5 valid=true adherence=1 | old 96.5 | wall 91s
    b-qwen3-8-flash-2026w47-r1 | lock rc 0 | timer left 4h30m | REGRADED total=98.7 valid=true adherence=1 | old 97.5 | wall 181s
    bf-a-qwen3-8-flash-2026w47-r1 | lock rc 0 | timer left 4h27m | REGRADED total=100 valid=true adherence=1 | old 100 | wall 103s
    bf-b-qwen3-8-flash-2026w47-r1 | lock rc 0 | timer left 4h25m | REGRADED total=100 valid=true adherence=1 | old 100 | wall 124s
    ch-a-qwen3-8-flash-2026w47-r1 | lock rc 0 | timer left 4h23m | REGRADED total=100 valid=true adherence=1 | old 100 | wall 141s
    ch-b-qwen3-8-flash-2026w47-r1 | lock rc 0 | timer left 4h20m | REGRADED total=100 valid=true adherence=1 | old 100 | wall 121s
    a-mimo-v2-6-flash-2026w46-r3 | lock rc 0 | timer left 4h18m | REGRADED total=96.2 valid=true adherence=1 | old 95 | wall 118s
    b-mimo-v2-6-flash-2026w46-r3 | lock rc 0 | timer left 4h16m | REGRADED total=97.3 valid=true adherence=1 | old 95.8 | wall 107s
    a-muse-spark-1-3-contributor-2026w46-r3 | lock rc 0 | timer left 4h15m | REGRADED total=94.7 valid=true adherence=1 | old 93.7 | wall 92s
    b-muse-spark-1-3-contributor-2026w46-r3 | lock rc 0 | timer left 4h13m | REGRADED total=94.8 valid=true adherence=1 | old 92.8 | wall 74s
    a-glm-5-3-flash-2026w46-r3 | lock rc 0 | timer left 4h12m | REGRADED total=92.4 valid=true adherence=0.5 | old 89.8 | wall 91s
    b-glm-5-3-flash-2026w46-r3 | lock rc 0 | timer left 4h10m | REGRADED total=98.7 valid=true adherence=1 | old 96.7 | wall 95s
    a-mimo-v2-6-flash-2026w46-r2 | lock rc 0 | timer left 4h09m | REGRADED total=93.7 valid=true adherence=1 | old 91.7 | wall 84s
    b-mimo-v2-6-flash-2026w46-r2 | lock rc 0 | timer left 4h07m | REGRADED total=98.7 valid=true adherence=1 | old 97.8 | wall 100s
    a-muse-spark-1-3-contributor-2026w46-r2 | lock rc 0 | timer left 4h06m | REGRADED total=94.8 valid=true adherence=1 | old 93.8 | wall 82s
    b-muse-spark-1-3-contributor-2026w46-r2 | lock rc 0 | timer left 4h04m | REGRADED total=97.2 valid=true adherence=1 | old 95.2 | wall 80s
    a-glm-5-3-flash-2026w46-r2 | lock rc 0 | timer left 4h03m | REGRADED total=92.3 valid=true adherence=0.5 | old 90.8 | wall 80s
    b-glm-5-3-flash-2026w46-r2 | lock rc 0 | timer left 4h02m | REGRADED total=94.8 valid=true adherence=0.5 | old 93.8 | wall 124s
    a-mimo-v2-6-flash-2026w46-r1 | lock rc 0 | timer left 4h00m | REGRADED total=96.2 valid=true adherence=1 | old 95.7 | wall 174s
  - Stopped 2026-11-28 21:02 (+07): the timer left was 3h57m before `b-mimo-v2-6-flash-2026w46-r1`. 45 runs are done (including the pilot), 37 remain. No FAIL and no SKIP. The list continues after 06:00 (+07).
  - PM order 2026-11-28 22:35: the 21:00 stop, the 02:00 to 06:00 stop, and the 4-hour timer rule no longer apply. The lock check stays before each call. Second block, 2026-11-28 22:32 to 23:43 (+07), one run for each `heavy-run.sh` call. No exit 75, no FAIL, no SKIP:
    b-mimo-v2-6-flash-2026w46-r1 | lock rc 0 | REGRADED total=98.7 valid=true | old 97.7
    a-muse-spark-1-3-contributor-2026w46-r1 | lock rc 0 | REGRADED total=94.8 valid=true | old 93.8
    b-muse-spark-1-3-contributor-2026w46-r1 | lock rc 0 | REGRADED total=97.2 valid=true | old 96.2
    a-glm-5-3-flash-2026w46-r1 | lock rc 0 | REGRADED total=92.4 valid=true | old 89.9
    b-glm-5-3-flash-2026w46-r1 | lock rc 0 | REGRADED total=94.9 valid=true | old 93.4
    bf-a-beam-free-2026w46-r1 | lock rc 0 | REGRADED total=100 valid=true | old 100
    bf-b-beam-free-2026w46-r1 | lock rc 0 | REGRADED total=100 valid=true | old 100
    bf-a-glm-5-3-flash-2026w46-r1 | lock rc 0 | REGRADED total=100 valid=true | old 100
    bf-b-glm-5-3-flash-2026w46-r1 | lock rc 0 | REGRADED total=100 valid=true | old 100
    bf-a-iceman-contributor-free-2026w46-r1 | lock rc 0 | REGRADED total=100 valid=true | old 100
    bf-b-iceman-contributor-free-2026w46-r1 | lock rc 0 | REGRADED total=100 valid=true | old 100
    bf-a-mimo-v2-6-flash-2026w46-r1 | lock rc 0 | REGRADED total=100 valid=true | old 100
    bf-b-mimo-v2-6-flash-2026w46-r1 | lock rc 0 | REGRADED total=100 valid=true | old 100
    bf-a-muse-spark-1-3-contributor-2026w46-r1 | lock rc 0 | REGRADED total=100 valid=true | old 100
    bf-b-muse-spark-1-3-contributor-2026w46-r1 | lock rc 0 | REGRADED total=100 valid=true | old 100
    bf-b-kimi-k2-7-code-2026w46-r1 | lock rc 0 | REGRADED total=96.4 valid=true | old 96.4
    bf-a-kimi-k2-7-code-2026w46-r1 | lock rc 0 | REGRADED total=92.9 valid=true | old 92.9
    ch-a-beam-free-2026w46-r1 | lock rc 0 | REGRADED total=100 valid=true | old 100
    ch-b-beam-free-2026w46-r1 | lock rc 0 | REGRADED total=100 valid=true | old 100
    ch-a-glm-5-3-flash-2026w46-r1 | lock rc 0 | REGRADED total=100 valid=true | old 100
    ch-b-glm-5-3-flash-2026w46-r1 | lock rc 0 | REGRADED total=100 valid=true | old 100
    ch-a-iceman-contributor-free-2026w46-r1 | lock rc 0 | REGRADED total=100 valid=true | old 100
    ch-b-iceman-contributor-free-2026w46-r1 | lock rc 0 | REGRADED total=100 valid=true | old 100
    ch-a-kimi-k2-7-code-2026w46-r1 | lock rc 0 | REGRADED total=100 valid=true | old 100
    ch-b-kimi-k2-7-code-2026w46-r1 | lock rc 0 | REGRADED total=100 valid=true | old 100
    ch-a-mimo-v2-6-flash-2026w46-r1 | lock rc 0 | REGRADED total=100 valid=true | old 100
    ch-b-mimo-v2-6-flash-2026w46-r1 | lock rc 0 | REGRADED total=100 valid=true | old 100
    ch-a-muse-spark-1-3-contributor-2026w46-r1 | lock rc 0 | REGRADED total=100 valid=true | old 100
    ch-b-muse-spark-1-3-contributor-2026w46-r1 | lock rc 0 | REGRADED total=100 valid=true | old 100
    a-deepseek-v4-1-flash-2026w43-r1 | lock rc 0 | REGRADED total=96 valid=true | old 95
    b-deepseek-v4-1-flash-2026w43-r1 | lock rc 0 | REGRADED total=98.7 valid=true | old 97.7
    a-gpt-6-luna-2026w43-r1 | lock rc 0 | REGRADED total=96 valid=true | old 94.5
    b-gpt-6-luna-2026w43-r1 | lock rc 0 | REGRADED total=98.7 valid=true | old 98.7
    a-minimax-m3-1-flash-2026w43-r1 | lock rc 0 | REGRADED total=92.4 valid=true | old 91.1
    b-minimax-m3-1-flash-2026w43-r1 | lock rc 0 | REGRADED total=98.7 valid=true | old 96.7
    a-claude-haiku-5-5-2026w43-r1 | lock rc 0 | REGRADED total=89.9 valid=true | old 88.9
    b-claude-haiku-5-5-2026w43-r1 | lock rc 0 | REGRADED total=98.7 valid=true | old 97.7
  - The 82 runs of the list are regraded, all `valid=true`. After the last run, `WEEK=all ./rescore-doctor.sh` ran through `heavy-run.sh` (log `.tmp/gsc/logs/rescore-doctor.log`). The totals of the 82 runs did not change in the rescore.
  - Lane: light. One heavy run for each regrade.
- [ ] 4.3 The daily lock and the timer. A regrade must not hold the daily
  lock, because a held lock would stop the live day. Before each regrade
  call, run `flock -n <lock> true`. The lock path is `BENCH_DAILY_LOCK`,
  which defaults to `$ROOT/.tmp/weekly-cron.lock`
  (`harness/cron-daily.sh:34`). The command must exit 0. Then read
  `systemctl --user list-timers lending-desk-daily.timer`, and start the
  regrade only when the next start is more than 4 hours away. Start no
  regrade from 02:00 to 06:00 (+07). One `heavy-run.sh` call stops at
  `HEAVY_RUN_TIMEOUT_S` (default 5400 s).
  - Verify: the plan records the lock check and the timer read of each
    regrade call.
  - Verify: no regrade held the daily lock, and no regrade started within 4
    hours of a live day.
  - Lane: light. A read-only check.
- [ ] 4.4 The score change report. For each regraded public run, record the
  old total and the new total. The new total comes from the
  `[<run-id>] REGRADED total=<n> valid=<bool>` line of the log. The old total
  comes from the `score.json` of `artifacts.prev-<stamp>/`. List each run with
  a change of more than 5 points.
  - Verify: the report holds one old total and one new total for each
    regraded run.
  - Verify: the list of runs with a change of more than 5 points matches the
    report.
  - First block (2026-11-28): `a-hy4-flash-free-2026w48-r3` 63.3 to 91.1,
    `a-mimo-v2-6-pro-2026w48-r2` 71.5 to 96.2, and the pilot
    `a-hy4-flash-free-2026w48-r2` 71.9 to 96. All other regraded runs moved
    3.2 points or less.
  - Verify: the report reaches the PM, with each changed public score listed.
  - Lane: light. A text report.
- [ ] 4.5 The publication. Rebuild the site data with the export the harness
  uses: `python3 harness/export-site-data.py` and
  `python3 harness/generate-model-pages.py`, then the model-guide builder
  (`harness/model-guide/update.sh`, preview first, then `--docs --no-commit`),
  which keeps the trial routes out (`guide.ts` skips them). Check that no Ark
  or trial text reaches `docs/`: `rg -n -i "ark1128|doubao-seed-evolving" docs/`
  prints no new line, and the trial routes stay out of the guide rows.
  Commit `docs/` with explicit paths and push.
  - Verify: the live `benchmark.json`
    (`https://bodangren.github.io/lending-desk-bench/assets/data/benchmark.json`)
    shows the new totals.
  - Verify: the live `generated_at` is newer than the end of the last regrade.
  - Lane: light. The PM order of 2026-11-28 16:35 covers the publication.

## Phase 5: The close

- [ ] 5.1 The final counts. Count the regraded runs as OK, FAIL, and SKIP.
  Count the runs that keep their stale mark, and give the reason of each:
  no candidate tree, hard violation, Pi, or no reachable week.
  - Verify: the four counts match the logs of task 4.2.
  - Verify: the reason of each stale run names one of the four reasons.
  - Lane: light. A read-only count.
- [ ] 5.2 The report to the PM. Send the report of task 4.4 to the PM.
  - Verify: the plan records the date of the send.
  - Lane: light. A text report.
- [x] 5.3 `2672686` The hand-off of the open tasks. Not needed. The PM closed
  `opencode_executor` on 2026-11-27.
  - Lane: light. No change.

## Human gates

- **Daniel's rule of 2026-11-27.** Only money, deletion, a new public claim or
  date, and Thai text stop work. The PM order of 2026-11-28 16:35 covers the
  publication of the regraded scores. Each changed public score is listed to
  the PM (task 4.4).
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
- **The daily rescore relabels a Chrome grade.** `rescore-doctor.sh` rewrites
  the provenance with the current hashes and reuses the old results. A run with
  a Chrome record passes its guard, so a rescore can mark an old grade as
  current after the suite change of `05c1975`. Regrade the Chrome-graded runs
  of task 4.1 before the next run day.
