# Implementation plan — runs_docs_ops_hungerg_20261128

PM decision 2026-11-28: light lane.

The docs-and-ops track holds runs for the hy4-flash-free and muse routes. The hungerg-free route waits in the plan Backlog of the guide card for the provider rate limit to end. This card holds that run, the hand check of the documentation verdicts, and the publication.

## Phase 1: Docs and ops runs for hungerg-free

- [~] 1.1 Add the docs-and-ops runs for `opencode-go/hungerg-free` on arm A and arm B.
  Done when both arms hold a run, each score reads fresh, trusted, publishable and rankable, and the plan holds the run ids and the totals.
  Run through `heavy-run.sh` with `BENCH_TRACK=docs-and-ops` and one batch at a time. Start no other batch.

- [ ] 1.2 Check the documentation grading of those runs by hand against the open grader findings F10 to F14 in `tech-debt.md`, section `2026-11-27 guide_docs_ops`.
  Done when every verdict of the release, rollback, loan-record preservation and loan-state boundary checks is correct for the text of the run, with the deciding sentence quoted for each check.

- [ ] 1.3 Publish the runs through the normal publication.
  Done when the published paths hold the new docs-and-ops rows, the live data matches the commit bytes, and the plan holds the publication commit and the push range.
