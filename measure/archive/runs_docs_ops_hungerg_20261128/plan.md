# Implementation plan — runs_docs_ops_hungerg_20261128

PM decision 2026-11-28: light lane.

The docs-and-ops track holds runs for the hy4-flash-free and muse routes. The hungerg-free route waits in the plan Backlog of the guide card for the provider rate limit to end. This card holds that run, the hand check of the documentation verdicts, and the publication.

## Phase 1: Docs and ops runs for hungerg-free

- [x] 1.1 Add the docs-and-ops runs for `opencode-go/hungerg-free` on arm A and arm B. Result: `do-a-hungerg-free-2026w48-r1` total `100`, `do-b-hungerg-free-2026w48-r1` total `98.3`. Both scores read fresh, trusted, publishable and rankable. Commit `e41b663`. — e41b663
  Done when both arms hold a run, each score reads fresh, trusted, publishable and rankable, and the plan holds the run ids and the totals.
  Run through `heavy-run.sh` with `BENCH_TRACK=docs-and-ops` and one batch at a time. Start no other batch.
  Command: `cd harness && BENCH_TRACK=docs-and-ops ARMS='a b' ./batch.sh --model hungerg-free` through `heavy-run.sh`.
  The batch ended with two runs ok and none failed. The canary of the docs-and-ops track passed before the first run.
  Batch log: `reports/batch-do-hungerg-free-2026w48.log`.
  The live freshness checker `harness/score-freshness.ts --many` called both scores `TRUSTED` and rankable. The candidate contract, the provenance, the score, the host and the collection read current.
  The temp export of `harness/export-site-data.py` wrote the docs-and-ops track with the two new rows of `opencode-go/hungerg-free`.

- [x] 1.2a Add Red tests: the release restoration check of `harness/docs-and-ops/grade-docs-ops.ts` accepts the contract fact sentence of `harness/docs-and-ops/model-visible/track/spec.md:36` ("Rollback restores the previous release and does not delete loan records.") and keeps rejecting inversions (keeps the current release; does not restore the previous release; restores the previous release by deleting loan records). Done when the tests fail on the current grader for the contract sentence only. Red commit `10abaf0`. — 10abaf0
  Red: `harness/tests/meta/docs-ops-wording.test.ts` describe `review-a r6 F13`; restoration cases `contract sentence`, `contract sentence with never`, `restore joined with and` fail on `D.sections.rollback`; guard cases `current release kept`, `restoration denied`, `bare denial`, `restore by deleting`, `new release deployed` stay rejected. Log `measure/runs/runs_docs_ops_hungerg_20261128/red-1.2a.log`.

- [x] 1.2b Repair the release recogniser (finding F13 of `tech-debt.md`, the case of 1.2a). Done when the 1.2a tests and the existing docs-and-ops grader tests pass. Result: `604d841`. Log: `measure/runs/runs_docs_ops_hungerg_20261128/green-1.2b.log`. — 604d841
  Remediation r2: `9f379df`. The loan-bound negation repair and Review A regressions are recorded in `measure/runs/runs_docs_ops_hungerg_20261128/green-1.2b.log`. — 9f379df
  Review A r2 F3 and F4 routed to tech-debt.md by orchestrator decision 2026-11-28; evidence measure/runs/runs_docs_ops_hungerg_20261128/review-a-88abf98.json.

- [x] 1.2c Regrade every docs-and-ops run under `runs/` with `harness/regrade-run.sh` and record the totals. Result: six runs regraded one at a time through `heavy-run.sh` on the grader `9f379df`; the control run `do-a-oracle-green-2026w99-r1` stayed untouched. Totals: `do-a-hy4-flash-free-2026w48-r1` `100`, `do-b-hy4-flash-free-2026w48-r1` `100`, `do-a-muse-spark-1-3-contributor-2026w48-r1` `99.3`, `do-b-muse-spark-1-3-contributor-2026w48-r1` `100`, `do-a-hungerg-free-2026w48-r1` `100`, `do-b-hungerg-free-2026w48-r1` `100`. Only `do-b-hungerg-free-2026w48-r1` changed, from `98.3` to `100`. `harness/score-freshness.ts --many` read every score `TRUSTED` and rankable; each score is valid and publishable. — 9f379df
  Done when each score reads fresh, trusted and rankable, and the plan holds the totals.

- [x] 1.2 Check the documentation grading of those runs by hand against the open grader findings F10 to F14 in `tech-debt.md`, section `2026-11-27 guide_docs_ops`. Evidence: hand check of the documentation verdicts on the regraded hungerg runs, all correct. — 9f379df
  Done when every verdict of the release, rollback, loan-record preservation and loan-state boundary checks is correct for the text of the run, with the deciding sentence quoted for each check.
  Arm A, `do-a-hungerg-free-2026w48-r1`, `D.sections.rollback` pass, correct. Release restoration: "Restore the previous release artifact and its deployment configuration using the platform rollback procedure." Loan-record preservation: "Do not delete or reset loan records as part of the rollback."
  Arm A, `D.loan.boundary` pass, correct: "A returned loan remains returned even after its due date.", "The loan is open and `dueAt` is strictly before `now`." and "The loan is open and `dueAt` is from `now` through the next 48 hours, inclusive."
  Arm B, `do-b-hungerg-free-2026w48-r1`, `D.sections.rollback` pass, correct. Release restoration and loan-record preservation: "Rollback restores the previous release and does not delete loan records." This is the contract sentence of `harness/docs-and-ops/model-visible/track/spec.md:36`. The sentence "retain any externally managed loan state when performing a release rollback." adds the preservation.
  Arm B, `D.loan.boundary` pass, correct: "A returned loan stays returned after its due date.", "An open loan is `overdue` when its due time is strictly before `now`." and "An open loan is `due-soon` from `now` through the next 48 hours, including both boundaries."
  Both runs pass every documentation check, so no verdict is a wrong pass or a wrong deduction. The runbook of arm B is byte-identical to the one graded before the grader repair. Review A r2 F3, F4 and F5 are in `tech-debt.md`.

- [x] 1.3 Publish the runs through the normal publication. Publication commit `7442133`, push range `7f95ce5..7442133`. Live `generated_at` `2026-11-28T11:06:30`. — 7442133
  Published paths: `docs/assets/data/benchmark.json`, `docs/assets/data/tracks.json`, `docs/assets/data/model-guide.json`, `docs/index.html`. Method: throwaway worktree at `origin/main`; every outgoing path on the `PUBLISH_ALLOW` list of `harness/cron-daily.sh`; complete-candidate leak scan RC 0; `harness/model-guide/preview.sh` RC 0; one commit; fast-forward push.
  Live `tracks.json` holds the docs-and-ops rows `do-a-hungerg-free-2026w48-r1` `100.0`, `do-b-hungerg-free-2026w48-r1` `100.0`, `do-a-hy4-flash-free-2026w48-r1` `100.0`, `do-b-hy4-flash-free-2026w48-r1` `100.0`, `do-a-muse-spark-1-3-contributor-2026w48-r1` `99.3`, `do-b-muse-spark-1-3-contributor-2026w48-r1` `100.0`.
  The guide row for docs and ops reads pick `opencode-go/hungerg-free`, second `opencode-go/hy4-flash-free`, evidence `track A: total 100.0 (n=1)`, evidence date `2026-11-28`. The pick and the second changed: before, hy4-flash-free and muse-spark-1.3-contributor. The totals tie at `100.0`, and the model id breaks the tie.
  SHA-256 of each live path equals the commit bytes. `benchmark.json` `15f1fef9cd96f0729bfe362f932b8b9eb7bbd9ae1e84ae6c0d633787b092644e`; `tracks.json` `587769e43ddf8c3bb4316ccd4e5ac19e1e4216c3481f4d1d3f496ac4f79611a5`; `model-guide.json` `166449bc182b4d83176db63fe7f432adb41215e675ab09d04ef5ee441d7119ca`; `index.html` `aadb06bef1b6a1baafe72da533335dae4f7e75cc83ee64cc2dd9682d8567a19f`.
  No control run `do-a-oracle-*` is public. No `volcengine-agent-plan` route or Ark run is in a published file: the guide was built with the route list of `80fd940`, because `routes.json` at `9071b85` names the Ark routes.
  Done when the published paths hold the new docs-and-ops rows, the live data matches the commit bytes, and the plan holds the publication commit and the push range.
