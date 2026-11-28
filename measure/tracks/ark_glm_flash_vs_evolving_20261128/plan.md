# Implementation plan — ark_glm_flash_vs_evolving_20261128

PM decision 2026-11-28: light lane.

The Ark Agent Plan routes are named in the guide quota data. The opencode runner of the harness holds no Ark provider yet, so the trial starts with the provider.

## Phase 1: Ark provider and A/B trial

- [x] 1.1 Add the provider `volcengine-agent-plan` to the opencode runner of `harness/run.sh`, `harness/batch.sh` and `harness/model-guide/review-run.sh` for the routes `volcengine-agent-plan/glm-5.3-flash` and `volcengine-agent-plan/doubao-seed-evolving`. Done when the harness tests of those runners pass and a dry preflight accepts both routes. Evidence: commit 9071b8595dcd300509e4b91d16d684fe1296ef21 — guard, preflight, credential, and review-run tests pass; dry preflight accepts both routes.

- [x] 1.1a Keep the two Ark trial routes out of the public model guide. Done when `routes.json` flags them `trial` and the guide builder skips them. Evidence: commit f3e63e247b03974a9518f3d76ff96d33cfe47fe7 — app-code, guide, and review-run tests pass alone through heavy-run; the preview guide and its index hold no volcengine or doubao text.

- [x] 1.1b Fix the Ark credential scan: an API-key entry holds its secret in `key`, so `scan-values` printed nothing and the first pilot run aborted before the agent started. Evidence: commit 4599d28 — credential-provider tests pass; the real store now gives one scan value.

- [~] 1.2 Run the A/B trial: the same tasks for both models, three runs per model per role, on the Build task, the docs-and-ops task and the code-review passes, scored with the existing scorers. Done when each run has its score, pass or fail, wall time, tokens and Ark credits recorded.
  Pass rule: the score record is valid, trusted, and rankable, and the typecheck and build gate passed. Run ids use the week token `ark1128*`, so no export reads them. Results: `ark-trial-2026-11-28.csv` in this card folder (the `reports/` folder is git-ignored; a local copy sits there).
  - Credits are counted by the `arkcli usage plan` reading before and after each run (the caps use this number). The tokens times rate over 10,000 figure is kept as a second column and is an estimate that Ark has not confirmed.
  - Pilot Build, GLM Flash: score 96.2, pass, agent 1228 s, 3,917,551 tokens. Reading delta 1,104.4 (1,606.0 to 2,710.4). Formula estimate 196.
  - Pilot Build, Evolving: score 92.7, pass, agent 1123 s, 3,650,228 tokens. Reading delta 2,014.6 (2,710.4 to 4,725.0). Formula estimate 913.
  - Void attempt, GLM Flash: agent 1179 s, 3,323,837 tokens. The provenance record failed (fix 8c2fe90) and the run was repeated. Reading delta 972.8 (4,578.9 to 5,551.7). Formula estimate 166.
  - Trial total so far by reading deltas: 4,091.8 (972.8 + 1,104.4 + 2,014.6). By formula: 1,275. Remaining of the 10,000 cap: 5,908.
  - Today (2026-11-28) the trial is at 4,091.8, over the 3,300 daily limit, and the 5h reading is about 5,274 (resets 17:57 +08). No run today. Resume 2026-11-29 after 06:00 +07.
  - Cost ratio, Evolving to GLM Flash: 1.8 by reading deltas, 4.7 by formula. The deltas of the pilots may hold other Ark users: the per-model counters show `glm-5-4` tokens (3.1M) in the Evolving window, and the usage posts with a delay. Judge the ratio from the clean pairs below.
  - Chosen counts (reading-delta costs, same count for both models): Build 1 per model (the pilots, done), docs-and-ops 1 per model, review passes 3 per model. Projected total 7,832 (4,092 + 3,119 + 621), headroom 2,168. Order: docs-and-ops pair on 2026-11-29 (about 3,119, inside 3,300); review passes on 2026-11-30. Start each run only when the 5h reading plus the pair estimate stays at or under 3,800, and the day total stays at or under 3,300. After the docs-and-ops pair, re-project from clean deltas (the trial is the only Ark user, checked against the per-model counters). If the room allows, add one pair of Build runs, then one pair of docs-and-ops runs, up to the 10,000 cap.

- [ ] 1.3 Keep the trial inside the PM limits of 2026-11-28 12:50: at most 10,000 Ark credits in total, 3,300 in a local day (+07), and 3,800 in any 5-hour window. Read `arkcli usage plan` before each run and skip a run that could pass a limit. Done when the credit total of the trial is recorded. Credits per run are the `arkcli usage plan` reading delta (before and after the run). The tokens times rate over 10,000 figure is kept as an estimate column only. The 3,800 limit means the 5h reading at the end of a run, while the trial is the only Ark user.

- [ ] 1.4 Send the readout to the PM: per role the score, pass rate, credits per run and credits per passing run, and one verdict line. Done when the PM has the readout.
