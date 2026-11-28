# Implementation plan — ark_glm_flash_vs_evolving_20261128

PM decision 2026-11-28: light lane.

The Ark Agent Plan routes are named in the guide quota data. The opencode runner of the harness holds no Ark provider yet, so the trial starts with the provider.

## Phase 1: Ark provider and A/B trial

- [x] 1.1 Add the provider `volcengine-agent-plan` to the opencode runner of `harness/run.sh`, `harness/batch.sh` and `harness/model-guide/review-run.sh` for the routes `volcengine-agent-plan/glm-5.3-flash` and `volcengine-agent-plan/doubao-seed-evolving`. Done when the harness tests of those runners pass and a dry preflight accepts both routes. Evidence: commit 9071b8595dcd300509e4b91d16d684fe1296ef21 — guard, preflight, credential, and review-run tests pass; dry preflight accepts both routes.

- [x] 1.1a Keep the two Ark trial routes out of the public model guide. Done when `routes.json` flags them `trial` and the guide builder skips them. Evidence: commit f3e63e247b03974a9518f3d76ff96d33cfe47fe7 — app-code, guide, and review-run tests pass alone through heavy-run; the preview guide and its index hold no volcengine or doubao text.

- [x] 1.1b Fix the Ark credential scan: an API-key entry holds its secret in `key`, so `scan-values` printed nothing and the first pilot run aborted before the agent started. Evidence: commit 4599d28 — credential-provider tests pass; the real store now gives one scan value.

- [x] 1.2 Run the A/B trial on the Build task, scored with the existing scorer. Result: GLM-5.3-Flash scored 96.2 (pass) and Doubao Seed Evolving scored 92.7 (pass). Credits by formula: 196 against 913. Credits by reading delta: 1,104 against 2,015 (the deltas may include use by other Ark sessions). Evidence: `ark-trial-2026-11-28.csv` in this card folder.
  Pass rule: the score record is valid, trusted, and rankable, and the typecheck and build gate passed. Run ids use the week token `ark1128*`, so no export reads them.
  - Pilot Build, GLM Flash: score 96.2, pass, agent 1228 s, 3,917,551 tokens. Reading delta 1,104.4. Formula estimate 196.
  - Pilot Build, Evolving: score 92.7, pass, agent 1123 s, 3,650,228 tokens. Reading delta 2,014.6. Formula estimate 913.
  - Void attempt, GLM Flash: agent 1179 s, 3,323,837 tokens. The provenance record failed (fix 8c2fe90) and the run was repeated. Reading delta 972.8. Formula estimate 166.
  - Trial ended by Daniel's decision 2026-11-28 16:00 after one Build run per model. GLM-5.3-Flash is assigned. Doubao Seed Evolving is shut off.

- [x] 1.3 Keep the trial inside the PM limits of 2026-11-28 12:50. Result: trial total 4,091.8 credits by reading deltas (1,275 by formula), inside the 10,000 cap.

- [x] 1.4 Send the readout to the PM. Evidence: PM readout, Daniel decision 2026-11-28 16:00 (the PM message is the readout).

- [x] 1.5 Shut off the route `volcengine-agent-plan/doubao-seed-evolving` in the harness and keep `volcengine-agent-plan/glm-5.3-flash`. Evidence: commit 9694713787131d1678b00d58e6ec32a2b06df481 — app-code, runner-safety, preflight-model-api, and review-run tests pass alone through heavy-run.
