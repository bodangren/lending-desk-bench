# Implementation plan — runs_go_new_models_20261127

PM decision 2026-11-27: light lane.

## Phase 1: Current runs for new Go models

- [x] 1.1 Add a current run for `hungerg-free`.
  Result: `71ab861`; live `docs/models/hungerg-free.html` and `docs/assets/data/benchmark.json`.

- [~] 1.2 Add a current run for `hy4-flash-free`.
  Route: `opencode-go/hy4-flash-free`. Quota plan `opencode-go-hy-free` shows GO.
  Run the Build batch with arms a and b through `heavy-run.sh`, publish the generated files, and check the live site.

- [ ] 1.3 Add a current run for `qwen4-max`.
  Runs when `ra-quota` shows GO for `opencode-go`: `2026-12-18T20:16:59+07:00`.
  `harness/batch.sh --model qwen4-max` exits 2: `--model qwen4-max is not a priced model in harness/go-pricing.json`.

- [ ] 1.4 Add a current run for `longcat-2.5`.
  Runs when `ra-quota` shows GO for `opencode-go`: `2026-12-18T20:16:59+07:00`.
  `harness/batch.sh --model longcat-2.5` exits 2: `--model longcat-2.5 is not a priced model in harness/go-pricing.json`.
