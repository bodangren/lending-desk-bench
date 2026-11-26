# Tracks registry

## Tracks in progress

- [~] **Track: Daily real-world ingest**
  - *Link: [ingest_daily_20261127](tracks/ingest_daily_20261127/)*

- [~] **Track: Model guide code review row**
  - *Link: [guide_code_review_20261127](tracks/guide_code_review_20261127/)*

- [ ] **Track: Model guide app code row**
  - *Link: [guide_app_code_20261127](tracks/guide_app_code_20261127/)*

- [ ] **Track: Model guide docs and ops row**
  - *Link: [guide_docs_ops_20261127](tracks/guide_docs_ops_20261127/)*

- [ ] **Track: Publish the 2026-11-25 daily results**
  - *Link: [publish_daily_1125_20261127](tracks/publish_daily_1125_20261127/)*

- [ ] **Track: Current runs for deepseek-v4.1-flash, gpt-6-luna, minimax-m3.1-flash, and claude-haiku-5-5**
  - *Link: [runs_current_4models_20261127](tracks/runs_current_4models_20261127/)*

- [ ] **Track: Tests runs for glm-5.3-flash, kimi-k2.7-code, mimo-v2.6-flash, and qwen3.8-flash**
  - *Link: [runs_tests_track_20261127](tracks/runs_tests_track_20261127/)*

- [ ] **Track: Current runs for new Go models**
  - *Link: [runs_go_new_models_20261127](tracks/runs_go_new_models_20261127/)*

- [~] **Track: Preflight model list from the OpenChamber API**
  - *Link: [preflight_model_api](tracks/preflight_model_api/)*

- [x] **Track: Executor model route for catalog-missing Console models**
  - *Link: [executor_model_route_20261126](tracks/executor_model_route_20261126/)*

- [ ] **Track: Grader browser: grade with the system Chrome and regrade the stale scores**
  - *Link: [grader_system_chrome](tracks/grader_system_chrome/)*

## All tracks

| ID | Title | Type | Status | Created |
|---|---|---|---|---|
| ingest_daily_20261127 | Daily real-world ingest | Chore | in-progress | 2026-11-27 |
| guide_code_review_20261127 | Model guide code review row | Chore | in-progress | 2026-11-27 |
| guide_app_code_20261127 | Model guide app code row | Chore | pending | 2026-11-27 |
| guide_docs_ops_20261127 | Model guide docs and ops row | Chore | pending | 2026-11-27 |
| publish_daily_1125_20261127 | Publish the 2026-11-25 daily results | Chore | pending | 2026-11-27 |
| runs_current_4models_20261127 | Current runs for deepseek-v4.1-flash, gpt-6-luna, minimax-m3.1-flash, and claude-haiku-5-5 | Chore | pending | 2026-11-27 |
| runs_tests_track_20261127 | Tests runs for glm-5.3-flash, kimi-k2.7-code, mimo-v2.6-flash, and qwen3.8-flash | Chore | pending | 2026-11-27 |
| runs_go_new_models_20261127 | Current runs for new Go models | Chore | pending | 2026-11-27 |
| harness_audit | Harness audit — verified grading defects | Bug | pending | 2026-08-30 |
| bugfix_bench | Bug-fixing benchmark — lending_desk_bugfix | Feature | in-progress — sources committed at e9fb565; task 6.5 is open and no [x] task carries a SHA | 2026-09-11 |
| bench_v2 | Benchmark v2 — validity, fixture r2, scoring rebalance | Feature | in-progress | 2026-09-24 |
| bench_incremental | Incremental benchmark runs — new models and failures only | Feature | paused — superseded in part by opencode_executor (Pi executor staging in plan-work.ts) | 2026-10-17 |
| rigor_a_h | Harder A–H criteria from interleavings, state sequences, and robustness variants | Feature | paused — PM 2026-11-14: no new difficulty work on the build track | 2026-10-25 |
| grader_system_chrome | Grader browser: grade with the system Chrome and regrade the stale scores | Chore | pending | 2026-11-04 |
| opencode_host_isolation | OpenCode host isolation: no benchmark opencode uses the shared store | Bug | pending — spec check 1.0 next; deadline Sat 2026-11-07 23:00 +07; owner question O1 open | 2026-11-06 |
| preflight_model_api | Preflight model list from the OpenChamber API | Chore | in-progress — light lane, author `opencode-go/hy4-flash-free`; spec and plan written 2026-11-26 | 2026-11-26 |
| executor_model_route_20261126 | Executor model route for catalog-missing Console models | Chore | complete — light lane, phase 1 accepted at 7b6f063; artifact measure/runs/executor_model_route_20261126/phase-acceptance-7b6f063.json | 2026-11-26 |

## Backlog

These items have no date and no track yet.

- **Replay track:** real past tasks with hidden tests (PM 2026-11-14, order item 7). No date.

## Archived Tracks

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
