# Implementation plan — guide_code_review_20261127

PM decision 2026-11-27: light lane.

Pointer: `preflight_model_api` task 1.5 owns the review-data refresh for this card.

## Phase 1: Model guide code review row

- [~] 1.1 Complete three review passes for each route in `harness/model-guide/routes.json`.
  Done when each route has three complete pass records.

- [ ] 1.2 Rank the routes from the complete review passes.
  Done when the review data holds the route ranking.

- [ ] 1.3 Publish the review-data refresh from `preflight_model_api` task 1.5.
  Done when `docs/assets/data/model-guide.json` contains the ranked code review row.

- [ ] 1.4 Publish the model guide and check the live site.
  Done when the live code review row matches the published route ranking.
