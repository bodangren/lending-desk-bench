# Implementation plan — guide_code_review_20261127

PM decision 2026-11-27: light lane.

Pointer: `preflight_model_api` task 1.5 owns the review-data refresh for this card.

## Phase 1: Model guide code review row

- [x] 1.1 Complete three review passes for each GO route in `harness/model-guide/routes.json`.
  Evidence: `harness/model-guide/data/review-scores/mg-2026-11a.json` and `measure/runs/model_guide/review-refresh-2026-11-27.log`.

- [x] 1.2 Rank the routes from the complete review passes.
  Evidence: `harness/model-guide/data/review-scores/mg-2026-11a.json`.

- [x] 1.3 Publish the review-data refresh from `preflight_model_api` task 1.5.
  Evidence: `docs/assets/data/model-guide.json` and `docs/assets/data/review.json`.

- [x] 1.4 Publish the model guide and check the live site.
  Evidence: `fbb72b3` and `https://bodangren.github.io/lending-desk-bench/assets/data/model-guide.json`.

- [x] 1.5 Migrate the Claude review route to the current Claude Agent integration.
  Evidence: `harness/model-guide/routes.json`, `harness/model-guide/data/review-scores/mg-2026-11a.json`, `docs/assets/data/model-guide.json`, and `measure/runs/model_guide/claude-agent-refresh-2026-11-27.log`.

Quota wait times:
- `opencode-go/deepseek-v4.1-flash`: 2026-12-18T20:16:59+07:00
- `opencode-go/mimo-v2.6-flash`: 2026-12-18T20:16:59+07:00
