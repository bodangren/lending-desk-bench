# Implementation plan — preflight_model_api

PM 2026-11-26: light lane.

This plan moves the batch preflight model list to the OpenChamber API. The
batch keeps its fail-closed check. The batch no longer reads the local binary
catalog for the model list. Spec: `spec.md`. Base commit: `162c7a2`.

Order: Red tests, Green code, Review A, Phase acceptance.

Constraints for every role:

- The lane is light. There is no Review B. There is no Review C. There is no
  adversarial test. There is no final acceptance. There is no closeout.
- No role runs the `opencode` or `openchamber` CLI. No role updates the
  OpenCode binary. No role reads the shared OpenCode store.
- No role edits `harness/cron-daily.sh`. The served-list call at line 472 needs
  the same source in a follow-up (spec D10).
- No role touches these uncommitted files: `harness/model-guide/ingest.py`,
  `harness/model-guide/ingest.sh`, `harness/schedule-tests/ingest.test.ts`,
  `harness/model-guide/update.sh`, `harness/model-guide-tests/update.test.ts`,
  `harness/cron-daily.sh`, `README.md`, `docs/assets/data/*`, `.opencode/`,
  `harness/wt.txt`.
- Stage files by explicit path. No role pushes the commit.
- Each gate runs one test file with `--maxWorkers=1`. Every task in this phase
  uses the same gate command:
  `cd harness && ./node_modules/.bin/vitest run tests/meta/preflight-model-api.test.ts --configLoader native --maxWorkers=1`

Marker use:

- `[ ]` marks an open task. The orchestrator adds `[~]` to the one open task.
- `[x]` needs a commit SHA on the first line of the task.

## Phase 1: Preflight model list from the OpenChamber API (spec FR1 to FR4)

- [x] 1.1 The Red tests (spec FR1 to FR4). Red commits 9c9b6ed and 4f4e3ad (r2 fake-server harness fix).
  Write `harness/tests/meta/preflight-model-api.test.ts`. Put the file beside
  `harness/tests/meta/opencode-credential.test.ts`. Touch this test file and no
  other file.
  - The test copies the scripts that it runs into a temp repo. The test sets
    `BENCH_MODEL_API_BASE` to a local JSON file or a local fake server. A fake
    `opencode` on the PATH records each call. A fake `sleep` records the delay
    argument. The test writes nothing under the real `.tmp/`, `runs/`, or
    `reports/`.
  - Cover these behaviours: one listed active ref passes; a ref with
    `enabled: false` fails; a ref with a different `status` fails; a reachable
    API without the ref prints the FR2 message; a transient failure retries up
    to three times with a five-second delay; a failed API after the retries
    prints the D6 message; no `opencode models` call appears; the version
    check, the ripgrep check, and the credential calls stay in place.
  - Gate: `cd harness && ./node_modules/.bin/vitest run tests/meta/preflight-model-api.test.ts --configLoader native --maxWorkers=1`
    exits non-zero on the base code. Each failure names a missing rule of
    FR1 to FR4.
  - Verify: no test calls a real API, a real `opencode` binary, a browser, or a
    model.
  - Red evidence (2026-11-26, base `f377765`): the gate above exits 1. See
    `measure/runs/preflight_model_api/red-f377765.log` for the full output.
    Every failure names its FR rule (FR1 helper/default, FR2/D4 exact match, FR2/D5 disabled omit,
    FR2/D6 unreachable message, FR2/D7 retry/exit-2, FR3 no-models-call plus
    unchanged checks, FR4 file/fake-server seam, AC6 hungerg-free). The helper
    `harness/model-api-refs.py` does not exist yet and `harness/batch.sh` still
    calls `opencode_host_run models --standalone`, so the failures are the
    expected missing-behavior proofs, not broken tests.
  - Red r2 evidence (2026-11-26, commit 4f4e3ad, test file only): the FR4
    fake-server case uses async spawn so its in-process server can answer.
    The other 11 assertions still name the missing FR rules on base code.

- [x] 1.2 The Green implementation (spec FR1 to FR4). Commits 394eac7, 04d3950c, and 7857f41.
  Add `harness/model-api-refs.py`. Run it as `python3 -I`. Change only the
  model-list block of `harness/batch.sh`. Follow decisions D1 to D9. The same
  commit adapts three callers of the copied batch:
  `harness/tests/meta/opencode-credential-fixtures.ts`,
  `harness/schedule-tests/daily-heavy-steps.test.ts`, and
  `harness/schedule-tests/opencode-host-isolation.test.ts`.
  - Keep the binary check, the version check, the ripgrep check,
    `opencode-credential.sh preflight`, and `opencode-credential.sh seed`
    unchanged.
  - Gate: `cd harness && ./node_modules/.bin/vitest run tests/meta/preflight-model-api.test.ts --configLoader native --maxWorkers=1`
    exits 0.
  - Verify: `grep -n "models --standalone" harness/batch.sh` prints no line.
    The helper prints refs only and uses exit 2 for a failed read.
    `harness/cron-daily.sh` is untouched.
  - Green evidence (2026-11-26, phase_base_sha f377765, role_base_sha 4f4e3ad,
    implementation commit 394eac7): `harness/model-api-refs.py` reads
    BENCH_MODEL_API_BASE as a local file or a base URL, prints only refs that
    are active and enabled, and exits 2 with one stderr line on a failed read.
    The batch model-list block runs it as `python3 -I`, retries helper exit 2
    in `for attempt in 1 2 3` with `sleep 5`, matches with `grep -qFx`, and
    prints the FR2 or D6 message. The binary, version, ripgrep, credential
    preflight, and credential seed checks stay unchanged.
    The targeted command exits 0 with no uncaught error. See
    `measure/runs/preflight_model_api/green-4f4e3ad.log` for the full output.
    `grep -n "models --standalone" harness/batch.sh` prints no line.
    `bash -n harness/batch.sh` exits 0.
  - Fixture adaptations in commit 394eac7, with the reason for each:
    `harness/tests/meta/opencode-credential-fixtures.ts` now copies `.py`
    helpers and sets BENCH_MODEL_API_BASE to a local JSON payload. Reason: the
    batch reads the list through the helper, so a fixture that copies batch.sh
    must copy the helper and supply the seam. Without both, the batch exits 3
    before the agent runs.
    `harness/schedule-tests/daily-heavy-steps.test.ts` copies the helper in
    copyHarnessFiles and sets the same seam. The reason is the same.
    `harness/schedule-tests/opencode-host-isolation.test.ts` copies the helper,
    sets the seam, and replaces its old assertion that the batch called
    `opencode models` with an assertion that the batch exits 0 and prints
    `EXECUTOR PREFLIGHT PASS` from the API list. Reason: FR3 removes that call.
    The isolation, `--version`, and seed assertions stay unchanged.
  - Other batch-related tests were run one file at a time with --maxWorkers=1;
    each exits 0. See `measure/runs/preflight_model_api/green-4f4e3ad.log` for
    the file list and the full output.
  - Green r3 evidence (2026-11-26, phase_base_sha f377765, role_base_sha 1730380,
    implementation commit 04d3950c): F1 restricts the source to a regular file
    or an http(s) base and rejects redirects and other schemes. F2 caps file
    and HTTP reads at 4 MiB and checks a 10 s deadline between reads. Connection
    setup stays bounded by the socket timeout, so this is not a strict wall-clock
    limit on the whole fetch. HTTP reads use `read1` so a slow drip cannot block
    a buffered fill. F3
    validates both IDs before printing and skips a malformed entry. F4 treats
    decode, nesting, and encoding failures as exit 2 with empty stdout and one
    stderr line, and prints no ref until the whole payload is validated. F5
    retries only helper exit 2; any other nonzero exit stops at once with no
    delay and the distinct message `the model API helper exited <code>`.
    The targeted command exits 0 with no uncaught error. See
    `measure/runs/preflight_model_api/green-1730380.log` for the full output.
    No fixture changed in 04d3950c; the three fixture adaptations belong to
    394eac7 and are listed in the scope of this task.
  - Green r4 evidence (2026-11-26, phase_base_sha f377765, role_base_sha c6e83ae,
    implementation commit 7857f41): F8 widens the model ID pattern to letters,
    digits, `. _ : @ + - / ~ [ ]`. The provider pattern stays unchanged. The F3
    exclusions for control characters, whitespace, empty IDs, and line forging
    stay in force. F9 wraps URL parsing, so a malformed base exits 2 with empty
    stdout and one stderr line; the batch then retries three times with two
    five-second delays and prints the D6 line. F10 is kept as a nit: the r3
    wording above now says the deadline is checked between reads and that
    connection setup stays bounded by the socket timeout, not by a strict
    wall-clock limit. No code changed for F10. The targeted command exits 0
    with no uncaught error. See `measure/runs/preflight_model_api/green-c6e83ae.log`
    for the full output. No fixture changed in 7857f41.

- [x] 1.3 Review A (light lane). Audited HEAD 68c00d3; artifact measure/runs/preflight_model_api/review-a-68c00d3.json (verdict pass). Review A fix commits 04d3950 and 7857f41.
  A reviewer audits the diff against FR1 to FR4 and decisions D1 to D9. The
  reviewer changes no code. The reviewer reports each finding with the fix or
  the reason to keep it.
  - Gate: `cd harness && ./node_modules/.bin/vitest run tests/meta/preflight-model-api.test.ts --configLoader native --maxWorkers=1`
    exits 0.
  - Verify: each blocking finding has a fix in a later commit.

- [x] 1.4 Phase acceptance (light lane). Audited HEAD cab1a87; artifact measure/runs/preflight_model_api/phase-acceptance-cab1a87-r2.json (product audit pass).
  Check the phase on the immutable HEAD. Check that each completed task line
  carries a commit SHA. Check the staged paths against the allowed file list.
  - Gate: `cd harness && ./node_modules/.bin/vitest run tests/meta/preflight-model-api.test.ts --configLoader native --maxWorkers=1`
    exits 0.
  - Verify: no staged file lies outside this phase. No push ran.

- [x] 1.5 Review-data refresh. Result: fbb72b3, c86efd1, 80fd940 (review ranking refresh, live check passed).
  Refresh the model-guide review ranking and check the live data.
