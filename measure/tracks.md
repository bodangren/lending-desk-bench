# Tracks registry

## Tracks in progress

## All tracks

| ID | Title | Type | Status | Created |
|---|---|---|---|---|
| ark_glm_flash_vs_evolving_20261128 | GLM-5.3 Flash against Doubao Seed Evolving on the Ark Agent Plan | Chore | completed | 2026-11-28 |
| runs_current_4models_20261127 | Current runs for deepseek-v4.1-flash, gpt-6-luna, minimax-m3.1-flash, and claude-haiku-5-5 | Chore | shelved, waits for the Go month reset 2026-12-18 | 2026-11-27 |
| runs_tests_track_20261127 | Tests runs for glm-5.3-flash, kimi-k2.7-code, mimo-v2.6-flash, and qwen3.8-flash | Chore | shelved, waits for the Go month reset 2026-12-18 | 2026-11-27 |
| runs_go_new_models_20261127 | Current runs for new Go models | Chore | shelved, not done (PM 2026-11-27) | 2026-11-27 |
| grader_system_chrome | Grader browser: grade with the system Chrome and regrade the stale scores | Chore | shelved, not done (PM 2026-11-27) | 2026-11-04 |
| bench_incremental | Incremental benchmark runs — new models and failures only | Feature | shelved, not done (PM 2026-11-27) | 2026-10-17 |
| bench_v2 | Benchmark v2 — validity, fixture r2, scoring rebalance | Feature | shelved, not done (PM 2026-11-27) | 2026-09-24 |
| bugfix_bench | Bug-fixing benchmark — lending_desk_bugfix | Feature | shelved, not done (PM 2026-11-27) | 2026-09-11 |
| harness_audit | Harness audit — verified grading defects | Bug | shelved, not done (PM 2026-11-27) | 2026-08-30 |
| opencode_host_isolation | OpenCode host isolation: no benchmark opencode uses the shared store | Bug | shelved, not done (PM 2026-11-27) | 2026-11-06 |
| rigor_a_h | Harder A–H criteria from interleavings, state sequences, and robustness variants | Feature | shelved, not done (PM 2026-11-27) | 2026-10-25 |

## Backlog

These items have no date and no track yet.

- **Replay track:** real past tasks with hidden tests (PM 2026-11-14, order item 7). No date.

## Shelved Tracks

- [ ] **Track: Current runs for deepseek-v4.1-flash, gpt-6-luna, minimax-m3.1-flash, and claude-haiku-5-5** — Status: shelved, waits for the Go month reset 2026-12-18 (PM 2026-11-28)
  - *Link: [runs_current_4models_20261127](./tracks/runs_current_4models_20261127/)*

- [ ] **Track: Tests runs for glm-5.3-flash, kimi-k2.7-code, mimo-v2.6-flash, and qwen3.8-flash** — Status: shelved, waits for the Go month reset 2026-12-18 (PM 2026-11-28)
  - *Link: [runs_tests_track_20261127](./tracks/runs_tests_track_20261127/)*

- [ ] **Track: Current runs for new Go models** — Status: shelved, not done (PM 2026-11-27)
  - *Link: [runs_go_new_models_20261127](./tracks/runs_go_new_models_20261127/)*

- [ ] **Track: Grader browser: grade with the system Chrome and regrade the stale scores** — Status: shelved, not done (PM 2026-11-27)
  - *Link: [grader_system_chrome](./tracks/grader_system_chrome/)*

- [ ] **Track: Incremental benchmark runs — new models and failures only** — Status: shelved, not done (PM 2026-11-27)
  - *Link: [bench_incremental](./tracks/bench_incremental/)*

- [ ] **Track: Benchmark v2 — validity, fixture r2, scoring rebalance** — Status: shelved, not done (PM 2026-11-27)
  - *Link: [bench_v2](./tracks/bench_v2/)*

- [ ] **Track: Bug-fixing benchmark — lending_desk_bugfix** — Status: shelved, not done (PM 2026-11-27)
  - *Link: [bugfix_bench](./tracks/bugfix_bench/)*

- [ ] **Track: Harness audit — verified grading defects** — Status: shelved, not done (PM 2026-11-27)
  - *Link: [harness_audit](./tracks/harness_audit/)*

- [ ] **Track: OpenCode host isolation: no benchmark opencode uses the shared store** — Status: shelved, not done (PM 2026-11-27)
  - *Link: [opencode_host_isolation](./tracks/opencode_host_isolation/)*

- [ ] **Track: Harder A–H criteria from interleavings, state sequences, and robustness variants** — Status: shelved, not done (PM 2026-11-27)
  - *Link: [rigor_a_h](./tracks/rigor_a_h/)*

## Archived Tracks

- [x] **Track: GLM-5.3 Flash against Doubao Seed Evolving on the Ark Agent Plan**
  *Link: [ark_glm_flash_vs_evolving_20261128](./archive/ark_glm_flash_vs_evolving_20261128/)*
  *Build pair: GLM-5.3-Flash 96.2 (pass) against Doubao Seed Evolving 92.7 (pass). Daniel ended the trial 2026-11-28 16:00 after one Build run per model: GLM-5.3-Flash assigned, Doubao Seed Evolving shut off (9694713). Closed and archived 2026-11-28.*

- [x] **Track: Change-request benchmark — lending_desk_change**
  *Link: [change_bench](./archive/change_bench/)*
  *Change-request benchmark for lending_desk_change: change set c1, the X.* criteria, the variant tree, provenance, and calibration. Sources at e9fb565 and 2346ef0. Archived 2026-11-18 on a passing archive check (mechanical); no quality acceptance ran.*

- [x] **Track: Test-writing benchmark — lending_desk_tests**
  *Link: [tests_bench](./archive/tests_bench/)*
  *Test-writing benchmark for lending_desk_tests: mutant and set contracts, the tests candidate mode, the model-visible tree, oracle admission, grading, scoring, and calibration. Sources committed at e9fb565 and 2346ef0. Two task lines carry PM-deferred proof outside git. Archived 2026-11-18 on a passing archive check (mechanical); no quality acceptance ran.*

- [x] **Track: Refresh the OpenCode Go catalog and benchmark the new models**
  *Link: [go_catalog_w43](./archive/go_catalog_w43/)*
  *Refresh of the OpenCode Go catalog and benchmark of the new models: pricing table, recost of 230 stored scores, OpenCode executor, three new models, and the published results. Sources committed at f61a422, 8b6bf37, and 3ae55c6. One task line carries PM-deferred proof outside git. Completed 2026-10-25 and archived 2026-11-18 on a passing archive check (mechanical); no quality acceptance ran.*

- [x] **Track: Dependency refresh: update the harness packages and clear the audit**
  *Link: [deps_refresh](./archive/deps_refresh/)*
  *Dependency refresh: update the harness packages and clear the audit. The harness lock refresh fixed all six high advisories and left five moderate advisories with recorded reasons. All gates and the same-code A/B passed. The work was pushed at 6fdea72 and final acceptance passed at d67d668. Three plan-only nits (F6, F10, F11) stay open.*

- [x] **Track: Model guide: seeded-defect review, real-work outcomes, and the use-this-model table**
  *Link: [model_guide](./archive/model_guide/)*
  *Model guide: seeded-defect review, real-work outcomes, and the use-this-model table. Track A scored seeded defects from real diffs; page B published sanitized real-work outcomes; the overview table holds the use-this-model rows. Final acceptance passed at 3ba285f. The pilot gate (4.11) and the first weekly update (5.4) stay PM-deferred.*

- [x] **Track: Weekly update fix: approval path, page refresh, leak check, and executable bit**
  *Link: [weekly_update_fix](./archive/weekly_update_fix/)*
  *Weekly update fix: the stable approval path, the HTML refresh, the leak check, and the executable bit. The track also carries the moved model_guide rows 4.11 (deferred pilot gate) and 5.4 (the first weekly update).*
  *Closeout 2026-11-23: Phase 1 FR-1 to FR-5 passed; final acceptance at ae0c116. Phase 2 rows 2.1 and 2.2 stay PM-deferred until the board unfreezes. No push ran.*

- [x] **Track: Domain trust matrix: safe and risk domains for each model, with failure modes**
  *Link: [domain_trust](./archive/domain_trust/)*
  *Domain trust matrix: safe and risk domains for each model, with failure modes. The track publishes one verdict for each model and domain A-H, with the failure mode, next to the leaderboard. Final acceptance passed at 7aeaba8; the owner approved publication on 2026-11-25.*
  *Closeout 2026-11-25: 15 tasks complete with commit SHAs. Final acceptance passed at 7aeaba8 with 112 published cells verified. The 58-run preview replaced the first 34-run golden preview. Late findings are recorded in root tech-debt.md. The two site-test files read the old track path and need repointing (FA2-N1).*

- [x] **Track: Migrate the benchmark executor from Pi to OpenCode 2 with Console login**
  *Link: [opencode_executor](./archive/opencode_executor/)*
  *Migrate the benchmark executor from Pi to OpenCode 2 with Console login. Closed by PM 2026-11-27: not needed.*

- [x] **Track: Daily model schedule: one model per day, untested first, then the stalest**
  *Link: [daily_model_schedule](./archive/daily_model_schedule/)*
  *Daily model schedule: one model per day, untested first, then the stalest. Closed by PM 2026-11-27: not needed.*

- [x] **Track: Daily real-world ingest**
  *Link: [ingest_daily_20261127](./archive/ingest_daily_20261127/)*
  *Daily real-world ingest: the ingest code, trust rule A, legacy outcome mapping, timer enablement, and the live guide check. Live evidence in plan.md. Closed 2026-11-27 and archived 2026-11-27 by the PM board review.*

- [x] **Track: Model guide app code row** — The app code row names its pick from the current Build scores.
  *Link: [guide_app_code_20261127](./archive/guide_app_code_20261127/)*
  *Model guide app code row: route selection from the current Build scores and the refreshed app code row. Closed by PM decision 2026-11-27 and archived 2026-11-27 by the PM board review.*

- [x] **Track: Publish the 2026-11-25 daily results**
  *Link: [publish_daily_1125_20261127](./archive/publish_daily_1125_20261127/)*
  *Publish the 2026-11-25 daily results: publication for mimo-v2.6-pro and the live site check. Daily results at 162c7a2; live evidence in plan.md. Closed 2026-11-27 and archived 2026-11-27 by the PM board review.*

- [x] **Track: Executor model API input limit is optional** — The helper accepts a model API entry whose limit holds context and output only.
  *Link: [executor_input_limit_optional_20261127](./archive/executor_input_limit_optional_20261127/)*
  *Executor model API input limit is optional: light lane, phase acceptance at 4a727d4; artifact measure/runs/executor_input_limit_optional_20261127/phase-acceptance-4a727d4.json. Closed 2026-11-27 and archived 2026-11-27 by the PM board review.*

- [x] **Track: Preflight model list from the OpenChamber API**
  *Link: [preflight_model_api](./archive/preflight_model_api/)*
  *Preflight model list from the OpenChamber API: review-data refresh at fbb72b3 and live evidence at 80fd940. Closed 2026-11-27 and archived 2026-11-27 by the PM board review.*

- [x] **Track: Executor model route for catalog-missing Console models**
  *Link: [executor_model_route_20261126](./archive/executor_model_route_20261126/)*
  *Executor model route for catalog-missing Console models: light lane, phase acceptance at 7b6f063; artifact measure/runs/executor_model_route_20261126/phase-acceptance-7b6f063.json. Closed 2026-11-27 and archived 2026-11-27 by the PM board review.*

- [x] **Track: Model guide code review row**
  *Link: [guide_code_review_20261127](./archive/guide_code_review_20261127/)*
  *Model guide code review row: review passes, route ranking, publication, and the live site check. The deepseek-v4.1-flash and mimo-v2.6-flash passes sit in the plan Backlog and run when ra-quota shows GO for opencode-go. Closed 2026-11-27 and archived 2026-11-27 by the PM board review.*

- [x] **Track: Model guide docs and ops row** — The guide has a docs and ops row from the docs-and-ops track.
  *Link: [guide_docs_ops_20261127](./archive/guide_docs_ops_20261127/)*
  *Model guide docs and ops row: the docs-and-ops fixture, grader and registration, the session routes, and the published docs and ops row. Phase acceptance passed at 071a4d1; publication at 656207d. The hungerg-free run moved to runs_docs_ops_hungerg_20261128. Closed 2026-11-27 and archived 2026-11-27 by the PM board review.*

- [x] **Track: Go price table for the new Go models** — The price table holds gemini-4-argon, longcat-2.5, and qwen4-max.
  *Link: [go_pricing_3models_20261128](./archive/go_pricing_3models_20261128/)*
  *Go price table for the new Go models: the live rates, the monthly usage, the flags, the source URL, the read date, and the alias lines. The price table commit is a6b0b99; the dry run for 2026-11-29 names no model. The LongCat 2.5 route needs the Global region in the workspace privacy settings. Closed 2026-11-28 and archived 2026-11-28 by the PM board review.*

- [x] **Track: Repair the schedule tests after the price table and archive moves**
  *Link: [schedule_test_repair_20261128](./archive/schedule_test_repair_20261128/)*
  *The schedule tests follow the archived oracle path and the current on-list data.*

- [x] **Track: Docs and ops runs for hungerg-free** — The docs-and-ops track has hungerg-free runs.
  *Link: [runs_docs_ops_hungerg_20261128](./archive/runs_docs_ops_hungerg_20261128/)*
  *Docs and ops runs for hungerg-free: the grader repair for the release recogniser, the regrade of the docs-and-ops runs, the hand check of the documentation verdicts, and the publication at 7442133. Closed 2026-11-28 and archived 2026-11-28 by the PM board review.*
