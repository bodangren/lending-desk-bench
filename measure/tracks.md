# Tracks registry

## Tracks in progress

- [~] **Track: Migrate the benchmark executor from Pi to OpenCode 2 with Console login**
  - *Link: [opencode_executor](tracks/opencode_executor/)*

- [x] **Track: Refresh the OpenCode Go catalog and benchmark the new models**
  - *Link: [go_catalog_w43](tracks/go_catalog_w43/)*

- [~] **Track: Domain trust matrix: safe and risk domains for each model, with failure modes**
  - *Link: [domain_trust](tracks/domain_trust/)*

- [~] **Track: Daily model schedule: one model per day, untested first, then the stalest**
  - *Link: [daily_model_schedule](tracks/daily_model_schedule/)*

- [ ] **Track: Grader browser: grade with the system Chrome and regrade the stale scores**
  - *Link: [grader_system_chrome](tracks/grader_system_chrome/)*

- [ ] **Track: Model guide: seeded-defect review, real-work outcomes, and the use-this-model table**
  - *Link: [model_guide](tracks/model_guide/)*

## All tracks

| ID | Title | Type | Status | Created |
|---|---|---|---|---|
| harness_audit | Harness audit — verified grading defects | Bug | pending | 2026-08-30 |
| bugfix_bench | Bug-fixing benchmark — lending_desk_bugfix | Feature | in-progress — sources committed at e9fb565; task 6.5 is open and no [x] task carries a SHA | 2026-09-11 |
| bench_v2 | Benchmark v2 — validity, fixture r2, scoring rebalance | Feature | in-progress | 2026-09-24 |
| tests_bench | Test-writing benchmark — lending_desk_tests | Feature | sources committed at e9fb565 — the plan marks all tasks [x], but no task carries a SHA | 2026-09-24 |
| bench_incremental | Incremental benchmark runs — new models and failures only | Feature | paused — superseded in part by opencode_executor (Pi executor staging in plan-work.ts) | 2026-10-17 |
| opencode_executor | Migrate the benchmark executor from Pi to OpenCode 2 with Console login | Feature | in-progress | 2026-10-18 |
| go_catalog_w43 | Refresh the OpenCode Go catalog and benchmark the new models | Feature | complete | 2026-10-24 |
| rigor_a_h | Harder A–H criteria from interleavings, state sequences, and robustness variants | Feature | paused — PM 2026-11-14: no new difficulty work on the build track | 2026-10-25 |
| domain_trust | Domain trust matrix: safe and risk domains for each model, with failure modes | Feature | pending — strategy done; Phase 1 worktree next; owner decisions O1 and O2 open | 2026-10-25 |
| daily_model_schedule | Daily model schedule: one model per day, untested first, then the stalest | Feature | pending — O1 approved with 3 conditions 2026-10-31 (spec D11–D14); Phase 4b reviews next (task 4b.4); Phase 4 Review C and acceptance run with Phase 4b | 2026-10-25 |
| grader_system_chrome | Grader browser: grade with the system Chrome and regrade the stale scores | Chore | pending | 2026-11-04 |
| opencode_host_isolation | OpenCode host isolation: no benchmark opencode uses the shared store | Bug | pending — spec check 1.0 next; deadline Sat 2026-11-07 23:00 +07; owner question O1 open | 2026-11-06 |
| model_guide | Model guide: seeded-defect review, real-work outcomes, and the use-this-model table | Feature | pending — spec review round 1 revised 2026-11-14 (F1 to F12); the re-review (task 0.3) and then Red task 1.1 come next; page B preview due Wed 2026-11-18; track A first results due Sun 2026-11-22 | 2026-11-14 |

## Backlog

These items have no date and no track yet.

- **Replay track:** real past tasks with hidden tests (PM 2026-11-14, order item 7). No date.

## Archived Tracks

- [x] **Track: Change-request benchmark — lending_desk_change**
  *Link: [change_bench](./archive/change_bench/)*
  *Change-request benchmark for lending_desk_change: change set c1, the X.* criteria, the variant tree, provenance, and calibration. Sources at e9fb565 and 2346ef0. Archived 2026-11-18 on a passing archive check (mechanical); no quality acceptance ran.*
