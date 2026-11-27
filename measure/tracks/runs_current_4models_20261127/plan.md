# Implementation plan — runs_current_4models_20261127

PM decision 2026-11-27: light lane.

## Phase 1: Current Lending, Bugfix, and Change runs

- [ ] 1.1 Add a current run for `deepseek-v4.1-flash` on Lending, Bugfix, and Change.
  Runs when `ra-quota` shows GO for `opencode-go`: `2026-12-18T20:16:59+07:00`.

- [ ] 1.2 Add a current run for `gpt-6-luna` on Lending, Bugfix, and Change.
  Runs when `ra-quota` shows GO for `opencode-go`: `2026-12-18T20:16:59+07:00`.

- [ ] 1.3 Add a current run for `minimax-m3.1-flash` on Lending, Bugfix, and Change.
  Runs when `ra-quota` shows GO for `opencode-go`: `2026-12-18T20:16:59+07:00`.
  Plan route `minimax-cn-coding-plan/MiniMax-M3.1-Flash` requires provider support in `harness/run.sh` and `minimax-cn-coding-plan` credential staging. The agent-provider guard accepts `opencode-go` and `local`; the credential stage exports the OpenCode Console connection. Evidence: `harness/run.sh:28-30,903-922` and `harness/model-guide/provider-credential.sh`.

- [b] 1.4 Add a current run for `claude-haiku-5-5` on Lending, Bugfix, and Change. deferred:backlog.
  PM decision 2026-11-27: the Claude plan has no spend gate.
  Exact provider refusal: `unsupported agent provider: claude-agent (only opencode-go runs agents)`.
  Exact OpenCode Go preflight refusal: `executor preflight failed: the model API does not list opencode-go/claude-haiku-5-5`.
  The live API lists `opencode/claude-haiku-5-5` with nonzero rates. The Claude plan quota is GO.
  The week-43 runs used `opencode-go/claude-haiku-5-5` with the `opencode` OAuth integration.
  Required change: add a `claude-agent` provider branch in `harness/run.sh`.
  - Allow `claude-agent` at `harness/run.sh:28-30`.
  - Seed and scan with `harness/model-guide/provider-credential.sh` at `harness/run.sh:905-924`.
  - Record the `claude-agent` credential integration at `harness/run.sh:392`.
  - Permit the Claude Code provider path at `harness/run.sh:993-994`.
  - Skip the Console window check for `claude-agent` at `harness/run.sh:1176-1183`.
  - Enforce the Claude plan quota in the batch preflight.
  - Add the pinned route and provider-specific preflight at `harness/batch.sh:157-170,353-392`.
