# Implementation plan — guide_code_review_20261127

PM decision 2026-11-27: light lane.

Pointer: `preflight_model_api` task 1.5 owns the review-data refresh for this card.

## Phase 1: Model guide code review row

- [x] 1.1 Complete three review passes for each GO route in `harness/model-guide/routes.json`.
  Result: fbb72b3, 80fd940.
  Evidence: `harness/model-guide/data/review-scores/mg-2026-11a.json` and `measure/runs/model_guide/review-refresh-2026-11-27.log`.

- [x] 1.2 Rank the routes from the complete review passes.
  Result: fbb72b3, 80fd940.
  Evidence: `harness/model-guide/data/review-scores/mg-2026-11a.json`.

- [x] 1.3 Publish the review-data refresh from `preflight_model_api` task 1.5.
  Result: fbb72b3, c86efd1, ea3851d.
  Evidence: `docs/assets/data/model-guide.json` and `docs/assets/data/review.json`.

- [x] 1.4 Publish the model guide and check the live site.
  Result: fbb72b3, 80fd940.
  Evidence: live `review.json` SHA-256 `4df97c1132e725d90a9b6a94533085299d44dbd98c4f62d19c432f6d8db4bc27`; live `model-guide.json` SHA-256 `32abec93033349d7861e76088b9d4c0edcf817a6fe95a856a50a53546fb94c28`.

- [x] 1.5 Migrate the Claude review route to the current Claude Agent integration.
  Result: 80fd940, ea3851d.
  Evidence: `harness/model-guide/routes.json`, `harness/model-guide/data/review-scores/mg-2026-11a.json`, `docs/assets/data/model-guide.json`, and `measure/runs/model_guide/claude-agent-refresh-2026-11-27.log`.

- [x] 1.6 Make preview-gate P2B2-2 independent of the real review data.
  Result: 69db7b1.
  Evidence: `harness/model-guide-tests/preview-gate.test.ts`.

## Backlog

- [ ] 1.7 Passes for `deepseek-v4.1-flash` and `mimo-v2.6-flash`: run when `ra-quota` shows GO for `opencode-go`.
