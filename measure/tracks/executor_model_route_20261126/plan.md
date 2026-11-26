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

- [x] 1.1 The Red tests (spec FR1 to FR5); tests `c108b2e`; evidence `bca5ced`; regression fixtures `615a3c5`; phase base `147a5f8`; role base `64c36e2`
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
  - Red evidence: base commit `147a5f8`; role base `64c36e2`; Red commit `c108b2e`. The gate exits non-zero on the base code. See `measure/runs/executor_model_route_20261126/red-64c36e2.log`.
  - Test-maintenance note (Red r3): `preflight-model-api.test.ts` and `opencode-executor.test.ts` give their fake binaries the catalog needle for the model under test (JS comment, inert on base), so the Green route takes the present-model path and preflight retry counts and exact config bytes stay unchanged. No assertion weakened.

- [x] 1.2 The Green implementation (spec FR1 to FR5); role base `615a3c5`; Green commit `68cfaaa`
  Add the entry mode to `harness/model-api-refs.py`. Change only the config
  generation block of `harness/run.sh`. Follow decisions D1 to D5.
  - Keep the binary check, the version check, the ripgrep check, the credential
    preflight, and the credential seed unchanged.
  - Keep the existing ref-list mode of the helper unchanged.
  - Gate: `cd harness && ./node_modules/.bin/vitest run tests/meta/executor-model-route.test.ts --configLoader native --maxWorkers=1`
    exits 0.
  - Regression gates, one file at a time:
    - `cd harness && ./node_modules/.bin/vitest run tests/meta/preflight-model-api.test.ts --configLoader native --maxWorkers=1`
      exits 0. See `measure/runs/executor_model_route_20261126/green-bca5ced.log`.
    - `cd harness && ./node_modules/.bin/vitest run tests/meta/opencode-executor.test.ts --configLoader native --maxWorkers=1`
      exits 0.
    - `cd harness && ./node_modules/.bin/vitest run tests/meta/execution-identity.test.ts --configLoader native --maxWorkers=1`
      exits 0.
  - Verify: `bash -n harness/run.sh` exits 0. No `curl` call appears in the
    config block. The helper prints no `baseURL`, header, or token.
  - Green evidence: role base `615a3c5`; Green commit `68cfaaa`.
    - The four gate commands exit 0. See `measure/runs/executor_model_route_20261126/green-bca5ced.log` for each command and its output.
    - `bash -n harness/run.sh` and `python3 -I -m py_compile harness/model-api-refs.py` exit 0.

## Phase 1: Review A r1 remediation (F1-F8)

Review A artifact: `measure/runs/executor_model_route_20261126/review-a-d426d0d.json`
(verdict fail). The amended `spec.md` is the source of truth for this section.

- [x] 1.4 Red round (tests: F2, F3, F4, F5, F6, F7, F1 behavioural via the real `run.sh` with fake executors); red `3605150`; evidence `bbda943`; fixtures `9d9c07a`
  Extend `harness/tests/meta/executor-model-route.test.ts`. Update the shared
  fake executor in `harness/tests/meta/opencode-run-fixtures.ts` and its direct
  callers. Touch no production code.
  - Exercise the real `run.sh` with fake executors for both catalog states.
    Assert exact config bytes, both identity records, the script status, the
    stderr reason, config absence on failure, and no credential staging.
  - Make the shared fake executor catalog-present by default. Add an explicit
    missing-model option. Give every caller a local API seam. No test touches
    the real default API.
  - Cover provider-scoped catalog membership, binary read and parse errors,
    malformed `name` and `limit`, the whole-read deadline, duplicate rows, and
    the first active and enabled row.
  - Make the redirect target return a valid payload. Assert no call reaches
    the target. Treat an empty stderr as a failure, not a one-line reason.
  - Gate: `cd harness && ./node_modules/.bin/vitest run tests/meta/executor-model-route.test.ts --configLoader native --maxWorkers=1`
    exits non-zero on the current code. Each failure names F1 to F7.
  - Affected suite gates, one file at a time:
    - `cd harness && ./node_modules/.bin/vitest run tests/meta/opencode-executor.test.ts --configLoader native --maxWorkers=1`
    - `cd harness && ./node_modules/.bin/vitest run tests/meta/preflight-model-api.test.ts --configLoader native --maxWorkers=1`
    - `cd harness && ./node_modules/.bin/vitest run tests/meta/opencode-credential.test.ts --configLoader native --maxWorkers=1`
    - `cd harness && ./node_modules/.bin/vitest run tests/meta/opencode-fixture.test.ts --configLoader native --maxWorkers=1`
    - `cd harness && ./node_modules/.bin/vitest run tests/meta/opencode-recorded.test.ts --configLoader native --maxWorkers=1`
    - `cd harness && ./node_modules/.bin/vitest run schedule-tests/opencode-host-isolation.test.ts --configLoader native --maxWorkers=1`
  - Verify: no test runs Podman, calls a real model, or calls the real API.
  - Red evidence: record the gate logs under
    `measure/runs/executor_model_route_20261126/`. Pin no test counts.
  - Red evidence: the route gate failed on the pre-Green code. The failures
    covered F1, F4, F5, F6, and F7. The affected suites passed on that code.
    See `measure/runs/executor_model_route_20261126/red-r4-1c78039.log` and
    `measure/runs/executor_model_route_20261126/red-r5-bbda943.log`.
  - Fixture note: the shared fake executor defaults to a provider-scoped
    catalog object and a local API seam. The host-isolation fake carries the
    same catalog shape. The recorded session export trips the NFR-1 leak gate,
    so full agent runs exit after the route completes.

- [x] 1.5 Green round (code: F1, F4, F5, F6, F7, F8); role base `9d9c07a`; Green commit `dc157c4`
  Change `harness/model-api-refs.py` and the config block of `harness/run.sh`.
  Follow the amended FR1 to FR5 and D1 to D9.
  - Resolve the entry and write the config before credential staging. Install
    the credential cleanup trap before staging when staging must stay first.
    Exit the script with 2 and one reason on a helper or config failure. Leave
    no staging and no config on that path.
  - Validate `name` and `limit`. Pass the entry through stdin or a temp file
    inside `$OUT/executor`. Enforce the deadline after each read, including
    EOF and draining.
  - Scope the catalog scan to the requested provider object. Treat a read or
    parse error as an error, not a miss. Stream the binary.
  - Select the first active and enabled matching row. Keep both helper modes
    on the same rule.
  - Gate: `cd harness && ./node_modules/.bin/vitest run tests/meta/executor-model-route.test.ts --configLoader native --maxWorkers=1`
    exits 0.
  - Regression gates, one file at a time:
    - `cd harness && ./node_modules/.bin/vitest run tests/meta/preflight-model-api.test.ts --configLoader native --maxWorkers=1`
    - `cd harness && ./node_modules/.bin/vitest run tests/meta/opencode-executor.test.ts --configLoader native --maxWorkers=1`
    - `cd harness && ./node_modules/.bin/vitest run tests/meta/execution-identity.test.ts --configLoader native --maxWorkers=1`
    - `cd harness && ./node_modules/.bin/vitest run tests/meta/opencode-credential.test.ts --configLoader native --maxWorkers=1`
    - `cd harness && ./node_modules/.bin/vitest run tests/meta/opencode-fixture.test.ts --configLoader native --maxWorkers=1`
    - `cd harness && ./node_modules/.bin/vitest run tests/meta/opencode-recorded.test.ts --configLoader native --maxWorkers=1`
    - `cd harness && ./node_modules/.bin/vitest run schedule-tests/opencode-host-isolation.test.ts --configLoader native --maxWorkers=1`
  - Verify: `bash -n harness/run.sh` exits 0.
    `python3 -I -m py_compile harness/model-api-refs.py` exits 0. No `curl`
    call appears in the config block.
  - Green evidence: role base `9d9c07a`; Green commit `dc157c4`. Every required
    gate and both syntax checks exit 0. See
    `measure/runs/executor_model_route_20261126/green-r4-bbda943.log`.
  - FR2 evidence: catalog-present config bytes keep the audited hashes for both
    arms. A catalog-missing config has another hash, so the derived cohort ID
    can change.

- [~] 1.6 Evidence and phase acceptance (light lane).
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
