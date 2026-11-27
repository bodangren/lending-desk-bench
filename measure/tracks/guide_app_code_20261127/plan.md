# Implementation plan — guide_app_code_20261127

PM decision 2026-11-27: light lane.

## Phase 1: Model guide app code row

- [x] 1.1 Let the guide select routes from the build-track scores.
  Result: `dcc014e`; the app code row names the selected route of each session family.
  - Pick: `opencode-go/hungerg-free`. Second: `opencode-go/deepseek-v4.1-flash`.
  - The evidence cell names Claude Sonnet, MiniMax, DeepSeek, Hy, Go, Hungerg, and GPT Sol.

- [b] deferred:pm 1.2 Run the build track for the selected routes.
  Result: every runnable selected route already has a current Build score.
  - `opencode-go/hungerg-free`: Build `95.2`, week `2026w48`.
  - `opencode-go/hy4-flash-free#high`: Build `71.9`, week `2026w48`.
  - `opencode-go/minimax-m3.1-flash`: Build `91.1`, week `2026w43`.
  - `opencode-go/muse-spark-1.3-contributor#high`: Build `93.8`, week `2026w46`.
  - [ ] `opencode-go/deepseek-v4.1-flash`: Build `95.0`, week `2026w43`; quota plan `opencode-go-bulk` shows WAIT until `2026-12-18T20:16:59+07:00`.
  - [ ] `opencode-go/mimo-v2.6-flash`: Build `95.0`, week `2026w46`; quota plan `opencode-go-bulk` shows WAIT until `2026-12-18T20:16:59+07:00`.
  - [b] deferred:pm `claude-agent/sonnet#high`: `harness/run.sh:28-30` rejects provider `claude-agent` with `unsupported agent provider: claude-agent (only opencode-go runs agents)`.
  - [b] deferred:pm `minimax-cn-coding-plan/MiniMax-M3.1-Flash`: `harness/run.sh:28-30` rejects provider `minimax-cn-coding-plan` with `unsupported agent provider: minimax-cn-coding-plan (only opencode-go runs agents)`.
  - [b] deferred:pm `openai/gpt-6.2-sol#high`: `harness/run.sh:28-30` rejects provider `openai` with `unsupported agent provider: openai (only opencode-go runs agents)`.

- [x] 1.3 Refresh `docs/assets/data/model-guide.json`.
  Result: `47eca4b`; the live app code row uses the current Build scores.
  - Live pick: `opencode-go/hungerg-free`. Live second: `opencode-go/deepseek-v4.1-flash`.
  - Live `evidence_date`: `2026-11-27`. Live `base_line`: `95.2`.
  - `model-guide.json`, `real-work.json`, `review.json`, `index.html`, `real-work.html`, and `review.html` match the published bytes.
