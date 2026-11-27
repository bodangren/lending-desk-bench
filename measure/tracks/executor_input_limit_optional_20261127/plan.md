# Implementation plan — executor_input_limit_optional_20261127

PM decision 2026-11-27: light lane.

## Phase 1: Optional model API input limit

- [~] 1.1 Red tests: a model API entry with only context and output limits is accepted and its config limit holds exactly those keys.
  - Red commit d9defb9 (2026-11-27). phase_base_sha 3839ff7923af0ba3c658e0ffe0f5bed2cf2c2564; role_base_sha 3839ff7923af0ba3c658e0ffe0f5bed2cf2c2564 (supplied, equals HEAD). The phase base was resolved from the Phase 1 setup commit, as in model_guide plan evidence.
  - Red command: `heavy-run.sh -c "cd /home/daniebo/Desktop/lending-desk-bench/harness && ./node_modules/.bin/vitest run tests/meta/executor-model-route.test.ts --configLoader native --maxWorkers=1 --reporter=dot"` exits 1 with `Tests 2 failed | 79 passed (81)`.
  - Failure 1 names (a) in the helper: `N1/FR4: a two-key limit is accepted in entry mode: expected 2 to be +0`. Failure 2 names (a) in run.sh: `N1/FR1: a two-key limit must let the route reach config generation: expected false to be true`. All other 79 cases pass, including three-key limits, ref-list mode, and FR2 exact catalog bytes.
  - Regression gates pass, one at a time with --maxWorkers=1 through the same wrapper: preflight-model-api 35 passed; opencode-executor 21 passed; opencode-credential 21 passed; opencode-fixture 2 passed; opencode-recorded 24 passed; execution-identity 1 passed; opencode-host-isolation 11 passed. No fake server stayed after any run.
  - Files changed: harness/tests/meta/executor-model-route.test.ts only. No production file changed. Row stays [~] until Green flips 1.2.

- [ ] 1.2 Green: the helper accepts input as optional.

- [ ] 1.3 Run the `executor_model_route` suite and the related regression gates.

- [ ] 1.4 Real probe: omit.
