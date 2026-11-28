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

- [ ] 1.2c Regrade every docs-and-ops run under `runs/` with `harness/regrade-run.sh` and record the totals. Done when each score reads fresh, trusted and rankable, and the plan holds the totals.

- [ ] 1.2 Check the documentation grading of those runs by hand against the open grader findings F10 to F14 in `tech-debt.md`, section `2026-11-27 guide_docs_ops`. The arm B run carries a wrong verdict on `D.sections.rollback`, and the deduction moves the total. Continues after task 1.2c.
  Done when every verdict of the release, rollback, loan-record preservation and loan-state boundary checks is correct for the text of the run, with the deciding sentence quoted for each check.
  Arm A, `do-a-hungerg-free-2026w48-r1`. Release restoration, verdict correct: the runbook says "Restore the previous release artifact and its deployment configuration using the platform rollback procedure."
  Arm A. Loan-record preservation, verdict correct: the runbook says "Do not delete or reset loan records as part of the rollback."
  Arm A. Loan-state boundary, verdict correct: the runbook says "A returned loan remains returned even after its due date.", "The loan is open and `dueAt` is strictly before `now`." and "The loan is open and `dueAt` is from `now` through the next 48 hours, inclusive."
  Arm B, `do-b-hungerg-free-2026w48-r1`. Release restoration, verdict wrong: the runbook says "Rollback restores the previous release and does not delete loan records." That sentence is the required fact of the track contract. The line is `harness/docs-and-ops/model-visible/track/spec.md:36`.
  Arm B. The release recogniser reads the sentence as one clause, finds the negation of the deletion verb, and skips the clause. The check then fails. That is finding F13 of `tech-debt.md`: the rollback recogniser rejects correct instructions.
  Arm B. Loan-record preservation, verdict correct: the runbook says "Rollback restores the previous release and does not delete loan records." and "retain any externally managed loan state when performing a release rollback."
  Arm B. Loan-state boundary, verdict correct: the runbook says "A returned loan stays returned after its due date.", "An open loan is `overdue` when its due time is strictly before `now`." and "An open loan is `due-soon` from `now` through the next 48 hours, including both boundaries."
  The wrong verdict moves the total. The documentation axis of arm B holds 22 of 23 checks, and the total is 98.3. With the check passed the total is 100.
  The runs stay unpublished until the recogniser is repaired. The owner is the grader repair. The file is `harness/docs-and-ops/grade-docs-ops.ts` and the finding is F13 of `tech-debt.md`.

- [ ] 1.3 Publish the runs through the normal publication. The task waits on task 1.2, because the grader deduction of arm B is wrong. Continues after task 1.2c.
  Done when the published paths hold the new docs-and-ops rows, the live data matches the commit bytes, and the plan holds the publication commit and the push range.
