# Tracks registry

## Tracks in progress

- [~] **Track: Migrate the benchmark executor from Pi to OpenCode 2 with Console login**
  - *Link: [opencode_executor](tracks/opencode_executor/)*

- [~] **Track: Domain trust matrix: safe and risk domains for each model, with failure modes**
  - *Link: [domain_trust](tracks/domain_trust/)*

- [~] **Track: Daily model schedule: one model per day, untested first, then the stalest**
  - *Link: [daily_model_schedule](tracks/daily_model_schedule/)*

- [ ] **Track: Grader browser: grade with the system Chrome and regrade the stale scores**
  - *Link: [grader_system_chrome](tracks/grader_system_chrome/)*

## All tracks

| ID | Title | Type | Status | Created |
|---|---|---|---|---|
| harness_audit | Harness audit — verified grading defects | Bug | pending | 2026-08-30 |
| bugfix_bench | Bug-fixing benchmark — lending_desk_bugfix | Feature | in-progress — sources committed at e9fb565; task 6.5 is open and no [x] task carries a SHA | 2026-09-11 |
| bench_v2 | Benchmark v2 — validity, fixture r2, scoring rebalance | Feature | in-progress | 2026-09-24 |
| bench_incremental | Incremental benchmark runs — new models and failures only | Feature | paused — superseded in part by opencode_executor (Pi executor staging in plan-work.ts) | 2026-10-17 |
| opencode_executor | Migrate the benchmark executor from Pi to OpenCode 2 with Console login | Feature | in-progress | 2026-10-18 |
| rigor_a_h | Harder A–H criteria from interleavings, state sequences, and robustness variants | Feature | paused — PM 2026-11-14: no new difficulty work on the build track | 2026-10-25 |
| domain_trust | Domain trust matrix: safe and risk domains for each model, with failure modes | Feature | pending — strategy done; Phase 1 worktree next; owner decisions O1 and O2 open | 2026-10-25 |
| daily_model_schedule | Daily model schedule: one model per day, untested first, then the stalest | Feature | pending — O1 approved with 3 conditions 2026-10-31 (spec D11–D14); Phase 4b reviews next (task 4b.4); Phase 4 Review C and acceptance run with Phase 4b | 2026-10-25 |
| grader_system_chrome | Grader browser: grade with the system Chrome and regrade the stale scores | Chore | pending | 2026-11-04 |
| opencode_host_isolation | OpenCode host isolation: no benchmark opencode uses the shared store | Bug | pending — spec check 1.0 next; deadline Sat 2026-11-07 23:00 +07; owner question O1 open | 2026-11-06 |

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
