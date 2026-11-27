# Implementation plan — executor_input_limit_optional_20261127

PM decision 2026-11-27: light lane.

## Phase 1: Optional model API input limit

- [x] 1.1 Red tests: a model API entry with only context and output limits is accepted and its config limit holds exactly those keys.
  - Red commit d9defb9 (2026-11-27). phase_base_sha 3839ff7923af0ba3c658e0ffe0f5bed2cf2c2564; role_base_sha 3839ff7923af0ba3c658e0ffe0f5bed2cf2c2564 (supplied, equals HEAD). The phase base was resolved from the Phase 1 setup commit, as in model_guide plan evidence.
  - Red command: `heavy-run.sh -c "cd /home/daniebo/Desktop/lending-desk-bench/harness && ./node_modules/.bin/vitest run tests/meta/executor-model-route.test.ts --configLoader native --maxWorkers=1 --reporter=dot"` exits 1 with `Tests 2 failed | 79 passed (81)`.
  - Failure 1 names (a) in the helper: `N1/FR4: a two-key limit is accepted in entry mode: expected 2 to be +0`. Failure 2 names (a) in run.sh: `N1/FR1: a two-key limit must let the route reach config generation: expected false to be true`. All other 79 cases pass, including three-key limits, ref-list mode, and FR2 exact catalog bytes.
  - Regression gates pass, one at a time with --maxWorkers=1 through the same wrapper: preflight-model-api 35 passed; opencode-executor 21 passed; opencode-credential 21 passed; opencode-fixture 2 passed; opencode-recorded 24 passed; execution-identity 1 passed; opencode-host-isolation 11 passed. No fake server stayed after any run.
  - Files changed: harness/tests/meta/executor-model-route.test.ts only. No production file changed. Green commit 3d90121 closes this Red task. The committed Red test stayed unchanged.

- [x] 1.2 Green: the helper accepts input as optional.
  - Evidence: Green commit 3d90121; Red contract d9defb9; role_base_sha e17c5b2; phase_base_sha 3839ff7923af0ba3c658e0ffe0f5bed2cf2c2564.
  - harness/model-api-refs.py now requires context and output. It permits optional input and rejects every other key.
  - Every present limit value must be an integer from 0 through 2^53-1. The helper prints the original limit keys without null or invented input.
  - harness/run.sh needed no change. Its config generator copies the validated entry unchanged.
  - Targeted command: `heavy-run.sh -c "cd /home/daniebo/Desktop/lending-desk-bench/harness && ./node_modules/.bin/vitest run tests/meta/executor-model-route.test.ts --configLoader native --maxWorkers=1 --reporter=dot"` exits 0.

- [x] 1.3 Run the `executor_model_route` suite and the related regression gates.
  - Evidence: Green commit 3d90121. Each vitest gate ran alone with --maxWorkers=1 through heavy-run.sh and exited 0.
  - Gates: tests/meta/executor-model-route.test.ts; tests/meta/preflight-model-api.test.ts; tests/meta/opencode-executor.test.ts; tests/meta/opencode-credential.test.ts; tests/meta/opencode-fixture.test.ts; tests/meta/opencode-recorded.test.ts; tests/meta/execution-identity.test.ts; schedule-tests/opencode-host-isolation.test.ts.
  - Syntax gates: `bash -n harness/run.sh` and `python3 -I -m py_compile harness/model-api-refs.py` exit 0.
  - FR2 base=current for opencode-go/mimo-v2.6-pro: Arm A 5b04a4aa511bb1958f76fe0c2a7cca9d19d7e5f3e810cce3a6ece0e684c38dc2; Arm B d2486397c6bd5f4852a5c7db89bc2fdcde344c7183ce93f51aa5b2dd164c0d7a.
  - Live entry probes against the default API exit 0 for opencode-go/deepseek-v4.1-flash, opencode-go/minimax-m3.1-flash, and opencode-go/hungerg-free. The first two entries hold context and output. The hungerg-free entry holds context, input, and output.
  - The repository has no measure/doctor.sh. The orchestrator supplied the light-lane gate list.

- [x] 1.4 Real probe: omit.
  - Evidence: not needed, light lane; the change is covered by Green commit 3d90121 and the Red tests d9defb9.

- [ ] 1.5 Review A (light lane).
  - Review A checks the card's FR contract against the committed change.

- [ ] 1.6 Phase acceptance (light lane).
  - Phase acceptance checks that the gates exit 0 and no staged file lies outside harness/model-api-refs.py, harness/tests/meta/executor-model-route.test.ts, and the track files.
