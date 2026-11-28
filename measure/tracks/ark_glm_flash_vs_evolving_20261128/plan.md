# Implementation plan — ark_glm_flash_vs_evolving_20261128

PM decision 2026-11-28: light lane.

The Ark Agent Plan routes are named in the guide quota data. The opencode runner of the harness holds no Ark provider yet, so the trial starts with the provider.

## Phase 1: Ark provider and A/B trial

- [x] 1.1 Add the provider `volcengine-agent-plan` to the opencode runner of `harness/run.sh`, `harness/batch.sh` and `harness/model-guide/review-run.sh` for the routes `volcengine-agent-plan/glm-5.3-flash` and `volcengine-agent-plan/doubao-seed-evolving`. Done when the harness tests of those runners pass and a dry preflight accepts both routes. Evidence: commit 9071b8595dcd300509e4b91d16d684fe1296ef21 — guard, preflight, credential, and review-run tests pass; dry preflight accepts both routes.

- [x] 1.1a Keep the two Ark trial routes out of the public model guide. Done when `routes.json` flags them `trial` and the guide builder skips them. Evidence: commit f3e63e247b03974a9518f3d76ff96d33cfe47fe7 — app-code, guide, and review-run tests pass alone through heavy-run; the preview guide and its index hold no volcengine or doubao text.

- [x] 1.1b Fix the Ark credential scan: an API-key entry holds its secret in `key`, so `scan-values` printed nothing and the first pilot run aborted before the agent started. Evidence: commit 4599d28 — credential-provider tests pass; the real store now gives one scan value.

- [~] 1.2 Run the A/B trial: the same tasks for both models, three runs per model per role, on the Build task, the docs-and-ops task and the code-review passes, scored with the existing scorers. Done when each run has its score, pass or fail, wall time, tokens and Ark credits recorded.
  Pass rule: the score record is valid, trusted, and rankable, and the typecheck and build gate passed. Run ids use the week token `ark1128*`, so no export reads them. Results: `ark-trial-2026-11-28.csv` in this card folder (the `reports/` folder is git-ignored; a local copy sits there).
  - Pilot Build, GLM Flash: score 96.2, pass, agent 1228 s, 3,917,551 tokens, about 196 credits (plan reading 1,606 to 2,710 on the 5h window, 1,104 including other sessions).
  - Pilot Build, Evolving: score 92.7, pass, agent 1123 s, 3,650,228 tokens, about 913 credits (plan reading 2,710 to 4,725 on the 5h window, 2,015 including other sessions).
  - Void attempt, GLM Flash: the agent ran 1179 s, 3,323,837 tokens, about 166 credits; the provenance record failed on the Ark credential descriptor (fix 8c2fe90). The run was repeated.
  - Trial credits so far: about 1,275 (166 + 196 + 913). Stop for 2026-11-28 by PM order; resume 2026-11-29 after 06:00 +07.

- [ ] 1.3 Keep the trial inside the PM limits of 2026-11-28 12:50: at most 10,000 Ark credits in total, 3,300 in a local day (+07), and 3,800 in any 5-hour window. Read `arkcli usage plan` before each run and skip a run that could pass a limit. Done when the credit total of the trial is recorded. Credits per run are the run tokens times the model rate over 10,000 (rate 0.5 for GLM Flash, 2.5 for Evolving); the plan readings before and after each run are kept beside them, but they include other sessions on the same plan.

- [ ] 1.4 Send the readout to the PM: per role the score, pass rate, credits per run and credits per passing run, and one verdict line. Done when the PM has the readout.
