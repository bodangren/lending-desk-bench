# Implementation plan — runs_go_new_models_20261127

PM decision 2026-11-27: light lane.

## Phase 1: Current runs for new Go models

- [x] 1.1 Add a current run for `hungerg-free`. Result: `71ab861`.
  Live `docs/models/hungerg-free.html` and `docs/assets/data/benchmark.json`.

- [x] 1.2 Add a current run for `hy4-flash-free`. Result: `575f36b`.
  Live `generated_at` `2026-11-27T13:07:21`.
  - Route: `opencode-go/hy4-flash-free`. Quota plan `opencode-go-hy-free` shows GO.
  - Trusted Build totals: `a-hy4-flash-free-2026w48-r1` `92.8`; `a-hy4-flash-free-2026w48-r2` `71.9`; `a-hy4-flash-free-2026w48-r3` `63.3`.
  - Trusted Build totals: `b-hy4-flash-free-2026w48-r1` `98.3`; `b-hy4-flash-free-2026w48-r2` `97.7`; `b-hy4-flash-free-2026w48-r3` `97.2`.
  - Arm means: arm a `76.0`; arm b `97.7333`.
  - Published medians: Build `71.9`; Skills `97.7`.
  - Publication gates: preview gate and complete-candidate leak check preceded the push.
  - Live evidence: `benchmark.json`, `tracks.json`, `bugfix.json`, `model-guide.json`, `real-work.json`, `review.json`, `index.html`, `real-work.html`, `review.html`, and `models/hy4-flash-free.html` match the published bytes.
  - Batch log: `reports/batch-hy4-flash-free-2026w48.log`.

- [ ] 1.3 Add a current run for `qwen4-max`.
  Runs when `ra-quota` shows GO for `opencode-go`: `2026-12-18T20:16:59+07:00`.
  `harness/batch.sh --model qwen4-max` exits 2: `--model qwen4-max is not a priced model in harness/go-pricing.json`.

- [ ] 1.4 Add a current run for `longcat-2.5`.
  Runs when `ra-quota` shows GO for `opencode-go`: `2026-12-18T20:16:59+07:00`.
  `harness/batch.sh --model longcat-2.5` exits 2: `--model longcat-2.5 is not a priced model in harness/go-pricing.json`.
