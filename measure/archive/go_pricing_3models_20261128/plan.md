# Implementation plan — go_pricing_3models_20261128

PM decision 2026-11-28: light lane.

Problem: the daily job skipped because the price table does not hold the new Go models. An unpriced model can never be a candidate.

## Phase 1: Go price table for the new Go models

- [x] 1.1 Add the new Go models to `harness/go-pricing.json` with source and read date. Result: `gemini-4-argon`, `longcat-2.5`, and `qwen4-max` with the live rates, the monthly usage, the flags, the source URL, and the read date `2026-11-28`. Commit `a6b0b99`, push range `f506637..a6b0b99`. — a6b0b99
  Done when the table holds `gemini-4-argon`, `longcat-2.5`, and `qwen4-max` with the live rates, the monthly usage, the flags, the source URL, and the read date `2026-11-28`, and holds the `opencode-go/<id>` alias lines the other models have.
  Read the live model list at `https://opencode.ai/inference/go/v1/models` and the Go plan page at `https://opencode.ai/console/go`. Derive `high_usage` from `high_usage_min_requests_per_month` and `batch` from the pick list of the same table. Leave the Go quota guard of D12 unchanged.
  Live read 2026-11-28. Every value of the PM order matches the live source.
  `gemini-4-argon`: name "Gemini 4 Argon", api `google-generate-content`, rates input 2.0, output 10.0, cache read 0.1, cache write 0, monthly usage 30 USD, requests a month 2830, `high_usage: false`, `batch: false`. The audio input price is 2.0. The discount of 50 percent runs through `2026-11-30`, and the price multiplier 2 starts on `2026-12-01`; the entry holds the current price and the multiplier date.
  `longcat-2.5`: name "LongCat-2.5", api `openai-completions`, rates input 0.3, output 1.2, cache read 0.006, cache write 0, monthly usage 60 USD, requests a month 57000, `high_usage: true`, `batch: true`, `page_order: 25`.
  `qwen4-max`: name "Qwen4 Max", api `anthropic-messages`, rates input 1.5, output 4.5, cache read 0.075, cache write 1.875, monthly usage 15 USD, requests a month 2315, `high_usage: false`, `batch: false`. The cache write price 1.875 is the five minute entry of the live price; the one hour entry is 3.
  Requests a month: the Go plan page lists the estimated requests per five hours, and the table holds five times that value. The page rounds the five-hour number to the next ten, so each monthly value sits near the page value.
  Flag rule. `high_usage` is true when the requests a month are above `high_usage_min_requests_per_month`, which is 7000. Every entry of the table with a request count follows that rule. `batch` is true for the paid models of the pick list, the set above `pick_min_requests_per_month`, which is 10000, without a `superseded_by`. Hy4 and MiniMax M3 are the hand-set exceptions of the table. `gemini-4-argon` and `qwen4-max` hold fewer requests than the pick floor, so both stay off the pick list.
  The api field names the native route of the model. No production code reads the field or the api map. The OpenCode Go provider catalog holds `longcat-2.5` and `qwen4-max`, and no entry for `gemini-4-argon`; the Console serves that model on the paid OpenCode route only.
  Gates, each alone through `heavy-run.sh`: `schedule-tests/go-pick-list.test.ts`, `schedule-tests/daily-pick-board.test.ts`, `schedule-tests/daily-pick-board-filter.test.ts`, `schedule-tests/daily-heavy-steps.test.ts`, `tests/meta/go-cost.test.ts`, `tests/meta/bench-incremental.test.ts`. Three fail at the phase base and at the parent commit, before the change. `go-pick-list` pins the on-list set of the table. `daily-pick-board` reads the oracle at the path `measure/tracks/daily_model_schedule/pick-oracle.py`, which the archive move removed. `go-cost` reads the request count of the unlimited free models, which hold zero. The change adds no failure to any gate.

- [x] 1.2 Dry run `daily-pick.ts` and record the Sunday pick. Result: no model, candidates 8, eligible 0, untested 0, exit 3. Commit `a6b0b99`, push range `f506637..a6b0b99`. — a6b0b99
  Done when the dry run for `2026-11-29` names the model, the candidate count, the eligible count, the Go quota guard result, and the reason for a skip. Start no batch.
  Command: `harness/node_modules/.bin/tsx harness/daily-pick.ts --catalog reports/go-catalog-2026w48.json --served reports/go-served-2026w48.txt --date 2026-11-29 --runs-root runs --pricing harness/go-pricing.json --day-dir reports/daily --board docs/assets/data/benchmark.json`. The pick reads only. It starts no run, no batch, and no push, and it writes no quota value.
  The Go quota guard of D12 passes. The weekly window reads 50.1 percent and the monthly window reads 70.5 percent, under the weekly stop at 80 and the monthly stop at 100.
  The skip reason: every candidate is on the public board, so the set of new models is empty, and three candidates also ran in the week.
  The change moves `longcat-2.5` from the unpriced list to the unservable list. The Console serves `opencode-go/longcat-2.5-free`, and the Go docs ask for the Global region in the workspace privacy settings for LongCat 2.5, which is hosted in China. The change moves `gemini-4-argon` to the gone list, because the account catalog holds no Go entry for it. `qwen4-max` is priced, live, and served, and holds fewer requests than the pick floor, so it is not a candidate.
  The dry run with the parent table gives the same counts, with `longcat-2.5` and `qwen4-max` on the unpriced list.

- [x] 1.3 Commit the price table and the card. Result: commit `a6b0b99`, push range `f506637..a6b0b99`. — a6b0b99
  Done when the commit holds `harness/go-pricing.json` and the card files, and the task line holds the commit SHA.
