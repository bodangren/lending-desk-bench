# Implementation plan — executor_model_route_20261126

PM 2026-11-26: light lane. One phase.

This plan gives `run.sh` a route for Console models absent from the pinned
binary catalog. A catalog-present model keeps its current config bytes. Spec:
`spec.md`. Base commit: `147a5f8`.

Order: Red tests, Green code, evidence and phase acceptance.

Constraints for every role:

- The lane is light. There is no Review B. There is no Review C. There is no
  adversarial test. There is no final acceptance. There is no closeout.
- No role runs the `opencode` or `openchamber` CLI. No role updates the
  OpenCode binary. No role reads the shared OpenCode store.
- No role runs Podman in a test. No test calls a real model or a real API.
- No role starts a scored batch. No role writes a score or publishes one.
- No role edits `harness/cron-daily.sh`. No role touches these uncommitted
  files: `harness/model-guide/ingest.py`, `harness/model-guide/ingest.sh`,
  `harness/schedule-tests/ingest.test.ts`, `harness/model-guide/update.sh`,
  `harness/model-guide-tests/update.test.ts`, `README.md`, `.gitignore`,
  `docs/assets/data/*`, `.opencode/`, `harness/wt.txt`.
- Stage files by explicit path. No role pushes the commit.
- Each gate runs one test file with `--maxWorkers=1`. The gate commands are:
  - New track gate:
    `cd harness && ./node_modules/.bin/vitest run tests/meta/executor-model-route.test.ts --configLoader native --maxWorkers=1`
  - Preflight regression gate:
    `cd harness && ./node_modules/.bin/vitest run tests/meta/preflight-model-api.test.ts --configLoader native --maxWorkers=1`
  - `run.sh` unit gate:
    `cd harness && ./node_modules/.bin/vitest run tests/meta/opencode-executor.test.ts --configLoader native --maxWorkers=1`
  - Identity gate:
    `cd harness && ./node_modules/.bin/vitest run tests/meta/execution-identity.test.ts --configLoader native --maxWorkers=1`

Marker use:

- `[ ]` marks an open task. The orchestrator adds `[~]` to the one open task.
- `[x]` needs a commit SHA on the first line of the task.

## Phase 1: Executor model route for catalog-missing models (spec FR1 to FR5)

- [ ] 1.1 The Red tests (spec FR1 to FR5).
  Write `harness/tests/meta/executor-model-route.test.ts`. Put the file beside
  `harness/tests/meta/preflight-model-api.test.ts`. Touch this test file and
  no other file.
  - The test copies the scripts that it runs into a temp repo. It sets
    `BENCH_OPENCODE_BIN` to a fake binary file. It sets
    `BENCH_MODEL_API_BASE` to a local JSON file or a local fake server. It
    writes nothing under the real `.tmp/`, `runs/`, or `reports/`.
  - Cover these behaviours: a missing model adds the three-field provider
    block; a present model gets identical config bytes, no providers key, and
    no API call; a disabled entry, an inactive entry, a missing entry, a failed
    API, and malformed JSON each exit 2 with one reason and no config; a
    malformed provider ID or model ID exits 2; the config holds no secret,
    token, `baseURL`, or header; the identity and cohort records build in both
    cases.
  - Gate: `cd harness && ./node_modules/.bin/vitest run tests/meta/executor-model-route.test.ts --configLoader native --maxWorkers=1`
    exits non-zero on the base code. Each failure names a missing rule of
    FR1 to FR5.
  - Verify: no test calls Podman, a real API, a real `opencode` binary, a
    browser, or a model.
  - Red evidence: record the gate output, the base commit SHA, and the Red
    commit SHA on this task line when Red ends.

- [ ] 1.2 The Green implementation (spec FR1 to FR5).
  Add the entry mode to `harness/model-api-refs.py`. Change only the config
  generation block of `harness/run.sh`. Follow decisions D1 to D5.
  - Keep the binary check, the version check, the ripgrep check, the credential
    preflight, and the credential seed unchanged.
  - Keep the existing ref-list mode of the helper unchanged.
  - Gate: `cd harness && ./node_modules/.bin/vitest run tests/meta/executor-model-route.test.ts --configLoader native --maxWorkers=1`
    exits 0.
  - Regression gates, one file at a time:
    - `cd harness && ./node_modules/.bin/vitest run tests/meta/preflight-model-api.test.ts --configLoader native --maxWorkers=1`
      exits 0 with 35 passing tests.
    - `cd harness && ./node_modules/.bin/vitest run tests/meta/opencode-executor.test.ts --configLoader native --maxWorkers=1`
      exits 0.
    - `cd harness && ./node_modules/.bin/vitest run tests/meta/execution-identity.test.ts --configLoader native --maxWorkers=1`
      exits 0.
  - Verify: `bash -n harness/run.sh` exits 0. No `curl` call appears in the
    config block. The helper prints no `baseURL`, header, or token.
  - Green evidence: record the gate outputs, the role base SHA, and the Green
    commit SHA on this task line when Green ends.

- [ ] 1.3 Evidence and phase acceptance (light lane).
  Check the phase on the immutable HEAD. Check that each completed task line
  carries a commit SHA. Check the staged paths against the allowed file list.
  The orchestrator runs one real probe after Green. The probe uses the same
  Podman arguments and env as a scored run. It writes no run folder and no
  score. No role starts a scored batch.
  - Gate: `cd harness && ./node_modules/.bin/vitest run tests/meta/executor-model-route.test.ts --configLoader native --maxWorkers=1`
    exits 0.
  - Regression gates, one file at a time:
    - `cd harness && ./node_modules/.bin/vitest run tests/meta/preflight-model-api.test.ts --configLoader native --maxWorkers=1`
      exits 0.
    - `cd harness && ./node_modules/.bin/vitest run tests/meta/opencode-executor.test.ts --configLoader native --maxWorkers=1`
      exits 0.
    - `cd harness && ./node_modules/.bin/vitest run tests/meta/execution-identity.test.ts --configLoader native --maxWorkers=1`
      exits 0.
  - Verify: the probe output is recorded under `measure/runs/executor_model_route_20261126/`.
    The log names the model, the exit code, and the reply text. No run folder
    and no published score exists for this track. No staged file lies outside
    this phase. No push ran.
