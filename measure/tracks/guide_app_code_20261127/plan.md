# Implementation plan — guide_app_code_20261127

PM decision 2026-11-27: light lane.

## Phase 1: Model guide app code row

- [~] 1.1 Let the guide select routes from the build-track scores.
  Done when the app code row names the selected Go flash, MiniMax, DeepSeek, Claude Sonnet, and Codex routes.

- [ ] 1.2 Run the build track for the selected routes.
  Done when each selected route has current build-track scores.
  - [ ] `opencode-go/deepseek-v4.1-flash`: quota plan `opencode-go-bulk` shows WAIT until `2026-12-18T20:16:59+07:00`.
  - [ ] `opencode-go/mimo-v2.6-flash`: quota plan `opencode-go-bulk` shows WAIT until `2026-12-18T20:16:59+07:00`.
  - [b] deferred:pm `claude-agent/sonnet#high`: `harness/run.sh:28-30` rejects provider `claude-agent` with `unsupported agent provider: claude-agent (only opencode-go runs agents)`.
  - [b] deferred:pm `minimax-cn-coding-plan/MiniMax-M3.1-Flash`: `harness/run.sh:28-30` rejects provider `minimax-cn-coding-plan` with `unsupported agent provider: minimax-cn-coding-plan (only opencode-go runs agents)`.
  - [b] deferred:pm `openai/gpt-6.2-sol#high`: `harness/run.sh:28-30` rejects provider `openai` with `unsupported agent provider: openai (only opencode-go runs agents)`.

- [ ] 1.3 Refresh `docs/assets/data/model-guide.json`.
  Done when the app code row uses the current build-track scores.
