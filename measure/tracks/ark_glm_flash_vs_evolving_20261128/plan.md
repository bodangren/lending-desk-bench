# Implementation plan — ark_glm_flash_vs_evolving_20261128

PM decision 2026-11-28: light lane.

The Ark Agent Plan routes are named in the guide quota data. The opencode runner of the harness holds no Ark provider yet, so the trial starts with the provider.

## Phase 1: Ark provider and A/B trial

- [~] 1.1 Add the provider `volcengine-agent-plan` to the opencode runner of `harness/run.sh`, `harness/batch.sh` and `harness/model-guide/review-run.sh` for the routes `volcengine-agent-plan/glm-5.3-flash` and `volcengine-agent-plan/doubao-seed-evolving`. Done when the harness tests of those runners pass and a dry preflight accepts both routes.

- [ ] 1.2 Run the A/B trial: the same tasks for both models, three runs per model per role, on the Build task, the docs-and-ops task and the code-review passes, scored with the existing scorers. Done when each run has its score, pass or fail, wall time, tokens and Ark credits recorded.

- [ ] 1.3 Keep the trial inside 15,000 Ark credits. Done when the credit total of the trial is recorded from `arkcli usage plan` readings before and after each run.

- [ ] 1.4 Send the readout to the PM: per role the score, pass rate, credits per run and credits per passing run, and one verdict line. Done when the PM has the readout.
