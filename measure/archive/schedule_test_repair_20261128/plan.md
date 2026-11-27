# Implementation plan — schedule_test_repair_20261128

PM handoff 2026-11-28: light lane.

Problem: two schedule tests fail for reasons outside the behavior they test.

## Phase 1: Repair the schedule test fixtures

- [x] 1.1 Point the schedule tests at the archived pick oracle and pin the current on-list set. Result: commit `9bdb08b1b85183065647e6ba5ebda9b4f1b71ae8`.
  Done when every harness reference to the old oracle path names the archive path, the oracle file exists there, and the pinned on-list set matches the real price table under the existing sort rule.
  Change only the test files. Keep the exact set and order comparison. Report any other case that fails without changing it.
  Gates, each alone through `heavy-run.sh`: `schedule-tests/daily-pick-board.test.ts`, `schedule-tests/go-pick-list.test.ts`, `schedule-tests/daily-pick-board-filter.test.ts`, `schedule-tests/daily-heavy-steps.test.ts`.

- [x] 1.2 Update the G3 board-filter pins to the current agreed pick and off-board set. Result: commit `b5afb759deede1be4691461508a5088f9ce6813d`.
  Done when the oracle and `harness/daily-pick.ts` agree on the same fixture and the test pins the agreed values with exact comparisons. Both pick `hungerg-free` on the fixture board and print matching lines. The gates through `heavy-run.sh` pass.
