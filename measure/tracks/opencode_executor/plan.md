# Implementation plan — opencode_executor

Replaces the Pi executor with OpenCode 2 and the host Console login. It
supersedes in part bench_incremental: Phase 3 replaces the Pi-specific
executor staging in `plan-work.ts`. It depends on the `bench_v2` provenance,
freshness, and recost machinery.

Constraints for every role:

- Deadline: complete before the weekly cron on Sun 2026-10-25 01:00 (+08:00).
  The go/no-go decision is task 4.6, due 2026-10-24 18:00 (+08:00).
- `run.sh`, `execution-identity.ts`, `executor-attestation.ts`, `go-cost.ts`,
  `usage.ts`, `provenance-check.ts`, and `provenance-record.ts` are in the
  runner hash list. Edits make every existing run STALE-PROVENANCE until the
  weekly rescore. Legacy Pi runs are skipped by that rescore (FR-8).
- Before 2026-10-21 21:44 (+08:00), send at most two live prompts, each tiny,
  with a free Go model (NFR-4). Phase 1 uses them. Graded live runs wait for
  task 4.3.
- Never print, log, or commit a credential. Redact every credential field in
  evidence.
- Preserve unrelated dirty work. `harness/go-pricing.json` has an owner edit.
  Many untracked paths belong to other tracks. Stage files by explicit path
  only.
- Red (Phase 2) changes only test files under `harness/tests/` and files
  under `measure/`.
- Task 3.1 (Pi removal and fail-closed preflight) lands before task 3.8 (cron
  toolchain fix). Thus no commit on `main` lets the cron send Pi traffic.

Gate commands:

- `RED_TEST_COMMAND` and `GREEN_TEST_COMMAND`: `cd harness && npm run test:meta:logic`
- Adversarial gate: `cd harness && BENCH_TRACK=change npm run test:meta:logic`
- Cron rehearsal (FR-9): run the self-check from `env -i HOME="$HOME"
  PATH=/snap/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`
  through the toolchain setup that `cron-weekly.sh` uses.

Schedule (+08:00):

| Phase | Window |
|---|---|
| Phase 1: Investigate and contract | 2026-10-18 to 2026-10-19 |
| Phase 2: Test | 2026-10-19 to 2026-10-20 |
| Phase 3: Implement (Green) | 2026-10-20 to 2026-10-22 |
| Phase 4: Verify and document | 2026-10-22 to 2026-10-24 18:00 |

## Phase 1: Investigate and contract [checkpoint: 60f5762]

Read-only investigation of the host OpenCode 2. Phase 1 writes only files in
`measure/tracks/opencode_executor/`: `design.md`, redacted evidence, and
corrections to `spec.md`. Red starts only after task 1.9 is complete.

- [x] 1.1 Headless run contract: confirm the flags `run --standalone --format` f40b1a1
  `json --auto --model opencode-go/<id>`. Record the exit codes for a provider
  error and for a timeout (the timeout exit code stays unproven in Phase 1;
  the Phase 2 fake covers it). Record the stdin behavior and the JSON event types.
  Confirm that `--auto` leaves no permission prompt. Use one tiny prompt with
  a free Go model in a throwaway container (spec FR-1). [9a638b6](evidence/task-1.1-headless-run.txt)
  (evidence-fix turn: hash values removed, free-model claim corrected,
  addendum reworded)
- [x] 1.2 Cron self-check root cause: find the call that leaves the `tsx` 4fefda5
  output files (`score.json`, `candidate-contract.json`) empty under the
  crontab PATH. The 2026-10-18 reproduction failed 3 tests
  under the crontab PATH and passed 170 of 170 under the nvm PATH. Record the
  minimal fix (spec FR-9). [c643123](evidence/task-1.2-cron-self-check.txt)
- [x] 1.3 Credential export and import: record the redacted shape of `opencode` 0a35187
  `auth export opencode`. Record how the active Console connection is
  selected. Import it into an empty isolated store, with temporary XDG
  dirs and no model call (v2.0.32 rejects `--standalone` for `auth`; the
  stdin import and the file import both work without the flag —
  review-fix probe). Record
  the store location. Confirm that the import leaves no other copy (spec
  FR-3). [9a638b6](evidence/task-1.3-1.4-credential.txt); the stdin import and models-fetch probes: (evidence/probe-stdin-import-and-models-fetch.txt) (v2.0.32
  --standalone limitation: see evidence; evidence-fix turn: hash
  values removed, addendum reworded — a container refresh stays
  unproven)
- [x] 1.4 Refresh and rotation: record the access-token lifetime from f40b1a1
  `expires`. Find a host refresh trigger that sends no prompt, if one exists.
  Confirm the import result when the refresh field is absent or inert.
  Confirm that the container cannot refresh and that the host login survives
  (spec FR-3). [cef5b13](evidence/task-1.3-1.4-credential.txt)
- [x] 1.5 Isolation variables and config source: confirm how the 0a35187
  generated config reaches the container (`OPENCODE_CONFIG`,
  `OPENCODE_CONFIG_CONTENT`, or the XDG config path), and that
  `OPENCODE_CONFIG` adds a document without suppressing the XDG source.
  Confirm the effect of
  `OPENCODE_DISABLE_CLAUDE_CODE`, `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS`,
  `OPENCODE_DISABLE_AUTOUPDATE`, `OPENCODE_DISABLE_PROJECT_CONFIG`, and
  `OPENCODE_DISABLE_MODELS_FETCH` (spec FR-4). [d3ffe0c](evidence/task-1.5-isolation-and-config.txt); the flag and arm probes: (evidence/probe-agents-md-and-skill-activation.txt), (evidence/probe-stdin-import-and-models-fetch.txt)
- [x] 1.6 Skill path and arm proof: list the built-in skill IDs. Confirm 1c767b8
  five-skill discovery from a read-only mount through a `skills` config entry
  or the XDG skills path. Confirm the `skill` deny and allow rules. Name the
  commands that list skills, instruction files, MCP servers, and plugins
  without a model call (spec FR-4). [8f25f19](evidence/task-1.6-skill-path-and-arm-proof.txt); the skill activation probe: (evidence/probe-agents-md-and-skill-activation.txt)
- [x] 1.7 Container runtime needs: confirm that the binary starts in the 0a35187
  pinned Node image. Record the helper downloads, such as ripgrep, language
  servers, and formatters. Record their executable needs under a `noexec`
  `/tmp`. Record the snapshot behavior and the network endpoints at startup.
  Select one helper supply method (spec FR-4). [15c1805](evidence/task-1.7-container-runtime.txt); the ripgrep source check: (evidence/ripgrep-tarball-source.txt)
  (design turn: host rg fails in the image; the supply source becomes
  the static musl build, see evidence §9)
- [x] 1.8 Token usage format: record the event fields for input, output, 4fefda5
  reasoning, cache read, and cache write. Record whether they are per step or
  cumulative. Confirm whether subagent usage reaches the parent event stream.
  Save one redacted event stream from task 1.1 in the track directory (spec
  FR-7). [9a638b6](evidence/task-1.8-token-usage.txt) (evidence-fix turn: O3
  becomes deny subagent; final-step usage finding; offline usage-source probe)
- [x] 1.9 Design note: write `design.md`. It gives the confirmed command line, 0a35187
  environment, mounts, config, and credential flow. It gives the field lists
  of identity schema 2 and provenance schema 7. It gives the usage mapping and
  the helper supply method. Record the owner answers to O1–O6. Correct
  `spec.md` where a fact differs. [c15b603](design.md)

### Phase 1 gate evidence (jr-green, evidence-fix turn, 2026-10-18)

- P1 composite, run with
  `PHASE_BASE_SHA=d27d414cfeb8474ca89f8ef0722d16f1edb128e1` from the
  repo root:
  - start: 2026-10-18T11:59:58+08:00; end: 2026-10-18T12:01:04+08:00.
  - exit code: 0 (all three parts of the `&&` chain passed: the
    commit-range check, the SECRET_SCAN, and the meta suite).
  - labeled Vitest lines: `Test Files  26 passed (26)`,
    `Tests  170 passed (170)`.
- EXACT scan, one credential frame over
  `measure/tracks/opencode_executor` and
  `measure/runs/opencode_executor` (2026-10-18, before the gate):
  `exact-scan values=6 hits=0`.

### Phase 1 gate evidence (jr-green, review-remediation turn, 2026-10-18)

Run after the review remediation commit `f40b1a1` and its plan
evidence `55540ef`.

- P1 composite, run with
  `PHASE_BASE_SHA=d27d414cfeb8474ca89f8ef0722d16f1edb128e1` from
  the repo root:
  - start: 2026-10-18T13:20:01+08:00; end: 2026-10-18T13:21:20+08:00.
  - exit code: 0 (the commit-range check, the SECRET_SCAN, and
    the meta suite all passed).
  - labeled Vitest lines: `Test Files  26 passed (26)`,
    `Tests  170 passed (170)`.
- EXACT scan, one credential frame over
  `measure/tracks/opencode_executor` and
  `measure/runs/opencode_executor` (2026-10-18, after the gate):
  `exact-scan values=6 hits=0`.

### Phase 1 gate evidence (jr-green, re-review remediation turn, 2026-10-18)

Run after the re-review remediation commit `9740328` and its
plan evidence `ba8de93`. The RB-11 complete-frame re-run of the
stdin-import probe (same day, about 13:50) also ended with an
in-frame EXACT scan: `exact-scan values=6 hits=0`
(evidence/probe-stdin-import-and-models-fetch.txt section 6).

- P1 composite, run with
  `PHASE_BASE_SHA=d27d414cfeb8474ca89f8ef0722d16f1edb128e1` from
  the repo root:
  - start: 2026-10-18T13:51:07+08:00; end: 2026-10-18T13:52:26+08:00.
  - exit code: 0 (the commit-range check, the SECRET_SCAN, and
    the meta suite all passed).
  - labeled Vitest lines: `Test Files  26 passed (26)`,
    `Tests  170 passed (170)`.
- EXACT scan, one credential frame over
  `measure/tracks/opencode_executor` and
  `measure/runs/opencode_executor` (2026-10-18, after the gate):
  `exact-scan values=6 hits=0`.

### Phase 1 gate evidence (jr-green, review-a-remediation turn, 2026-10-18)

Run after the review-fix commits `7371164` (R3), `21e8c09` (R2),
`1c767b8` (R4 and R1 probe evidence), `4fefda5` (R4 and R1
contract corrections, NR1, NR2, NR3, NR5, NR6), and the plan
evidence `b3fd306`.

- P1 composite, run with
  `PHASE_BASE_SHA=d27d414cfeb8474ca89f8ef0722d16f1edb128e1` from
  the repo root:
  - start: 2026-10-18T14:59:09+08:00; end: 2026-10-18T15:00:21+08:00.
  - exit code: 0 (the commit-range check, the SECRET_SCAN, and
    the meta suite all passed).
  - labeled Vitest lines: `Test Files  26 passed (26)`,
    `Tests  170 passed (170)`.
- EXACT scan, one credential frame over
  `measure/tracks/opencode_executor` and
  `measure/runs/opencode_executor` (2026-10-18T15:00:35+08:00,
  after the gate): `exact-scan values=6 hits=0`.

### Phase 1 gate evidence (jr-green, strategy-handoff turn, 2026-10-18)

Run after the H10 and H12 fix commit `aee15f5` and its plan
evidence `cb3c54e`, on top of the strategy amendment 4 commit
`9e5d3bb`.

- P1 composite, run with
  `PHASE_BASE_SHA=d27d414cfeb8474ca89f8ef0722d16f1edb128e1` from
  the repo root:
  - start: 2026-10-18T15:11:54+08:00; end: 2026-10-18T15:12:52+08:00.
  - exit code: 0 (the commit-range check, the SECRET_SCAN, and
    the meta suite all passed).
  - labeled Vitest lines: `Test Files  26 passed (26)`,
    `Tests  170 passed (170)`.
- EXACT scan, one credential frame over
  `measure/tracks/opencode_executor` and
  `measure/runs/opencode_executor` (2026-10-18T15:13:15+08:00,
  after the gate): `exact-scan values=6 hits=0`.

### Phase 1 gate evidence (jr-green, review-b-remediation turn, 2026-10-18)

Run after the RB-13 and M1–M9 remediation commit `0a35187` and
its plan evidence `60f5762`.

- P1 composite, run with
  `PHASE_BASE_SHA=d27d414cfeb8474ca89f8ef0722d16f1edb128e1` from
  the repo root:
  - start: 2026-10-18T15:29:42+08:00; end: 2026-10-18T15:30:40+08:00.
  - exit code: 0 (the commit-range check, the SECRET_SCAN, and
    the meta suite all passed).
  - labeled Vitest lines: `Test Files  26 passed (26)`,
    `Tests  170 passed (170)`.
- EXACT scan, one credential frame over
  `measure/tracks/opencode_executor` and
  `measure/runs/opencode_executor` (2026-10-18T15:31:03+08:00,
  after the gate): `exact-scan values=6 hits=0`.

## Phase 2: Test [checkpoint: 4599177]

Failing meta tests for the contract in `design.md`. No network, no real
model, no real credential (NFR-3).

- [x] 2.1 Fake `opencode` fixture: replace the fake `pi` in dcca6ec
  `tests/meta/schema4-fixtures.ts` with a fake `opencode`. It prints a 2.x
  version. It captures its arguments, its environment names, and a stdin
  hash. It emits the fixed event stream and writes the fixed session
  export of `design.md` section 4, so the usage parser reads the export,
  not the stream (spec FR-1, FR-7).
  - Red command: `cd harness && npm run test:meta:logic`.
    Start: 2026-10-18T15:52:51+08:00. End: 2026-10-18T15:53:55+08:00. Exit: 1.
    `Test Files  1 failed | 26 passed (27)`; `Tests  1 failed | 171 passed (172)`.
    Failure: `the runner invokes the fake OpenCode and creates its capture file`.
    The runner still invokes Pi. The fake fixture test passes. All 170 existing tests pass.
    `legacy-pi-fixtures.ts` preserves the existing schema-6 assertions during Red.
- [x] 2.2 Executor and isolation contract: extend d54639b
  `run-executor-provenance.test.ts`, `runtime-isolation.test.ts`,
  `runtime-isolation-completion.test.ts`, and `execution-identity.test.ts`.
  They prove the FR-1 command line, no Pi, and no `OPENCODE_API_KEY`. They
  prove private HOME and XDG dirs, no host mounts, and the config-source
  isolation of spec FR-4: `OPENCODE_CONFIG` adds the generated config as a
  document, and the isolation is the empty private XDG config directory plus
  `OPENCODE_DISABLE_PROJECT_CONFIG=1`. They prove Arm A (no `AGENTS.md`, no
  skills, the six deny rules of `design.md` section 1.5, `skill *` among
  them) and Arm B (fixture `AGENTS.md` through the `instructions` entry,
  five snapshot skills, the five allow rules, and the `skills.paths`
  entry). They prove
  that the arms differ only in that material (spec FR-1, FR-4).
  - Gate assertions live in `harness/tests/meta/opencode-executor.test.ts`.
    The frozen exclude list stays unchanged. Existing Pi assertions stay unchanged.
    The fake Podman records the actual arguments and the candidate state.
    It translates mounted paths when it runs the entry script. It starts no container.
  - Targeted command: `cd harness && BENCH_META=1 npx vitest run tests/meta/opencode-executor.test.ts --maxWorkers=1`.
    Exit: 1. `Test Files  1 failed (1)`; `Tests  20 failed | 1 passed (21)`.
  - Red command: `cd harness && npm run test:meta:logic`.
    Start: 2026-10-18T15:57:01+08:00. End: 2026-10-18T15:58:16+08:00. Exit: 1.
    `Test Files  2 failed | 26 passed (28)`; `Tests  21 failed | 172 passed (193)`.
    The 20 new executor failures prove the missing command, mounts, environment, config, variant, and skill snapshots.
    The task 2.1 capture test also fails. All 170 existing tests pass.
    Arm A already removes `AGENTS.md` and has no snapshot. That control passes without a false Red assertion.
    The role log records each failing name and its missing behavior.
- [x] 2.3 Credential tests: only the Console connection reaches the 765e478
  container, without the refresh token. Delivery uses stdin. No token is in a
  process argument list, the environment, the artifacts, a log, or
  provenance. Staging is gone after success, failure, and timeout. A token
  that does not cover the run window stops the run before the agent. A
  secret-scan hit redacts the output and makes the run invalid (spec FR-3,
  NFR-1).
  - Partial Red coverage: `harness/tests/meta/opencode-credential.test.ts` checks the stdin hash against the expected access-only payload.
    The fake Podman currently receives empty stdin. The remaining credential cases still need tests.
  - Red command: `cd harness && npm run test:meta:logic`, with an OpenCode tripwire first on `PATH`.
    Start: 2026-10-18T15:59:59+08:00. End: 2026-10-18T16:01:20+08:00. Exit: 1.
    `Test Files  3 failed | 26 passed (29)`; `Tests  22 failed | 172 passed (194)`.
    New failure: `streams only the selected Console access payload to Podman stdin, with an inert refresh`.
    The 21 failures from tasks 2.1 and 2.2 remain. All 170 existing tests pass.
    The tripwire has no `HIT` file.
  - Adversarial command: `cd harness && BENCH_TRACK=change npm run test:meta:logic`, with the same tripwire.
    Start: 2026-10-18T16:01:20+08:00. End: 2026-10-18T16:02:42+08:00. Exit: 1.
    `Test Files  3 failed | 26 passed (29)`; `Tests  22 failed | 172 passed (194)`.
    The JSON reports contain the same 22 failing names. All 170 existing tests pass. The tripwire stays unhit.
  - Completed Red coverage adds invalid expiry cases, connection selection, foreign integrations, staging, interruption, batch checks, warning boundaries, and output redaction.
    The signal tests require the start marker and non-empty staging before they send a signal.
    At HEAD, staging is absent. These tests fail at that explicit prerequisite, rather than claim an interruption result.
    A planted-canary control proves that the leak scanner detects a hit.
  - R1: `cd harness && npm run test:meta:logic`.
    Start: 2026-10-18T16:16:34+08:00. End: 2026-10-18T16:19:50+08:00. Exit: 1.
    `Test Files  3 failed | 26 passed (29)`; `Tests  41 failed | 173 passed (214)`.
  - R3: `cd harness && BENCH_TRACK=change npm run test:meta:logic`.
    Start: 2026-10-18T16:19:50+08:00. End: 2026-10-18T16:23:04+08:00. Exit: 1.
    `Test Files  3 failed | 26 passed (29)`; `Tests  41 failed | 173 passed (214)`.
    Both JSON reports contain the same failing names. All 170 existing tests pass.
    Twenty credential tests fail for missing behavior. The scanner control passes.
- [x] 2.4 Provenance and attestation: prove the schema 7 fields. Prove that 4599177
  attestation reads only the recorded executor. A fake upgrade at the
  recorded path keeps an earlier run attested and not stale. A changed skill
  or config snapshot makes the run invalid. Adversarial ambient values give
  byte-identical `plan-work.ts --all` output and the same freshness verdicts.
  The variables are `BENCH_SKILL_ROOT`, `BENCH_AGENT_IMAGE`,
  `BENCH_EXECUTOR_RUNTIME_FLAGS`, `BENCH_EXECUTOR_CLI_FLAGS`,
  `BENCH_OPENCODE_BIN`, `BENCH_PI_ROOT`, `HOME`, and `PATH`. This carries the
  bench_incremental review A finding (spec FR-5, FR-6).
  - `opencode-recorded.test.ts` covers the writer, the run identity, recorded snapshots, source drift, upgrades, and all 16 adversarial values.
    The fixture uses schema-7 input records with real candidate bindings and local skill and config snapshots.
    It obtains scores from the production scorer. It does not invent trusted verdicts.
    Node and tsx use absolute paths. Each subprocess receives an explicit environment.
  - The matrix requires `new`, `failing`, and `current` rows before it can pass.
    At HEAD, schema-7 records stay stale and the current control remains failing.
    The matrix tests report this missing prerequisite. They still execute the adversarial comparisons.
    The sensitivity test also fails because snapshot corruption does not change classification.
  - Targeted command: `cd harness && BENCH_META=1 npx vitest run tests/meta/opencode-recorded.test.ts --maxWorkers=1`.
    Exit: 1. `Test Files  1 failed (1)`; `Tests  24 failed (24)`.
  - R1, with the OpenCode tripwire: `cd harness && npm run test:meta:logic`.
    Start: 2026-10-18T16:29:33+08:00. End: 2026-10-18T16:33:51+08:00. Exit: 1.
    `Test Files  4 failed | 26 passed (30)`; `Tests  65 failed | 173 passed (238)`.
  - R3, with the same tripwire: `cd harness && BENCH_TRACK=change npm run test:meta:logic`.
    Start: 2026-10-18T16:33:51+08:00. End: 2026-10-18T16:38:07+08:00. Exit: 1.
    `Test Files  4 failed | 26 passed (30)`; `Tests  65 failed | 173 passed (238)`.
    Both JSON reports contain the same 65 failing names. Every failure is an expected assertion failure.
    All 170 existing tests pass. The OpenCode tripwire stays unhit in both runs.
- [b] 2.5 Cost: `usage.ts` parses the fixed session export, plain and (deferred:owner)
  `.gz`, with the FR-7 mapping of `design.md` section 4 (reasoning counts
  as output; no subagent mapping — O3 denies `subagent`). The event
  stream stays a cross-check. The recost equals the
  `go-pricing.json` formula. The no-output-token gate reads the new
  parser, and a missing or empty export makes the run invalid
  (spec FR-7). (deferred:owner — the Green work in task 3.6 carries this
  contract; the Red test is skipped under the 2026-10-24 deadline)
- [b] 2.6 History and site: the rescore and the regrade print a SKIP line for (deferred:owner)
  legacy Pi runs and keep their `score.json` bytes. The runs stay out of the
  work list, the ranking, the trend, and the Skills delta. `run.sh` refuses
  to replace a Pi run directory. Site rows show the executor name and version
  (spec FR-8). (deferred:owner — the Green work in tasks 3.7 and 3.8 carries
  this contract; the Red test is skipped under the 2026-10-24 deadline)
- [b] 2.7 Cron and preflight: the weekly toolchain setup resolves `node`, (deferred:owner)
  `npm`, and `opencode` independently of the crontab PATH. A missing binary
  or a missing Console credential stops the batch before the first agent run.
  No run directory is created (spec FR-2, FR-9). (deferred:owner — the Green
  work in tasks 3.1 and 3.8 carries this contract; the Red test is skipped
  under the 2026-10-24 deadline)
- [b] 2.8 Red evidence: run both gate commands. Record the start time, the end (deferred:owner)
  time, the exit codes, and the Vitest summaries in this plan. Record the
  failing tests per task. (deferred:owner — the gate evidence lands in task
  3.9)

## Phase 3: Implement (Green) [checkpoint: f61a422]

- [x] 3.1 Remove every Pi path: `env.sh`, `run.sh`, `go-cost.ts` f61a422
  `--models-json`, and the `/opt/pi` mount of the container probe. Add the
  fail-closed executor preflight to `batch.sh` (spec FR-2, FR-10, NFR-6).
  - The runtime slice landed on 2026-10-24: `env.sh`, `run.sh`, the container
    probe, and the `batch.sh` preflight are done. The `go-cost.ts`
    `--models-json` removal landed with task 3.6.
- [x] 3.2 OpenCode container run in `run.sh`: binary resolution, the entry f61a422
  script `harness/opencode-entry.sh`, and the generated config. Add the
  per-run skill snapshot, the private HOME and XDG dirs, and the helper
  supply method (spec FR-1, FR-2, FR-4).
  - `harness/opencode-entry.sh` imports the credential from its standard
    input, selects the track prompt from the candidate tree, runs the agent
    with `run --standalone --format json --auto --model opencode-go/<id>`, and
    exports the session.
  - `harness/fetch-rg.sh` installs the pinned static musl ripgrep 15.1.0
    outside the repository. The runner copies it into the run artifacts.
  - The export travels through the candidate mount. One pipe write cannot
    carry a 700 KB export. The runner moves the file into the run artifacts
    before the candidate contract settles.
- [x] 3.3 Console credential helper `harness/opencode-credential.sh`: f61a422
  export, selection, run-window check (batch preflight and before each
  agent run), access-only copy, and the weekly 7-day expiry warning
  (the warning never stops the batch). Add the stdin delivery, the
  cleanup trap, and the secret scan with redaction (spec FR-3, NFR-1,
  `design.md` section 2).
  - The helper retries the export three times with five seconds between the
    calls. The host `opencode auth export` printed a plugin notice and no
    JSON on 2026-10-25 at 01:14. The retry rule matches the one for
    `opencode models`.
- [x] 3.4 Execution identity schema 2, provenance schema 7, the executor f61a422
  cohort, and the runner hash list (spec FR-5).
- [x] 3.5 Recorded-executor attestation in `executor-attestation.ts` and f61a422
  `provenance-check.ts`. Remove `withRecordedExecutorEnvironment` from
  `plan-work.ts` (spec FR-6).
- [x] 3.6 OpenCode parser in `usage.ts`. Connect it to the `run.sh` gates and f61a422
  to `score.ts` (spec FR-7).
- [x] 3.7 History: add the Pi SKIP to `rescore-doctor.sh` and the regrade f61a422
  scripts. Add the Pi run guard to `run.sh` and the executor series filter to
  `plan-work.ts`. Add the executor display and the series filter to
  `export-site-data.py` and `generate-model-pages.py` (spec FR-8).
  - The site and script slice landed on 2026-10-25. The `run.sh` guard and the
    `plan-work.ts` series filter stay open for the TypeScript slice.
  - `rescore-doctor.sh` and `regrade-run.sh` read the executor kind from the
    provenance record of the run. A legacy Pi run prints one SKIP line and keeps
    its bytes. `regrade-all.sh` prints the same SKIP line and counts the run as
    skipped.
  - `export-site-data.py` reads the executor identity from `provenance.json` of
    each run. It never reads the run ID. The leaderboard, the EMA trend, the
    4-week range, and the paired Skills delta hold the OpenCode rows only. The
    legacy Pi rows move to a new `history` section and carry `ranked: false`.
  - `generate-model-pages.py` writes a page for every ranked model and every
    history model. A page shows the executor name and version. A page with only
    history shows a labeled history block and states that it is not ranked.
  - Evidence: `WEEK=all ./rescore-doctor.sh` printed 93 SKIP lines for legacy Pi
    runs and no FAIL line. The sha256 of every legacy Pi `score.json` stayed the
    same before and after the rescore. `python3 export-site-data.py` wrote 0
    ranked models and 18 history models. The cron rehearsal exited 0.
  - The `run.sh` Pi guard and the `plan-work.ts` series filter landed on
    2026-10-25. `run.sh` refuses to replace a run directory whose provenance
    records a legacy Pi executor. `plan-work.ts` keeps a legacy Pi run out of
    the work list.
- [x] 3.8 Weekly toolchain in `cron-weekly.sh` with the task 1.2 fix, and the f61a422
  `CRON START` tool-path log (spec FR-9).
  - `cron-weekly.sh` sources `harness/toolchain.sh` before `harness/weekly.sh`.
    The script stops when the toolchain cannot resolve a Node directory.
  - After the `CRON START` line the script logs one line per tool. The line
    holds the resolved path and the version of `node`, `npm`, and `opencode`.
  - Evidence: under the crontab PATH the log showed the operator nvm paths
    `node v24.19.0`, `npm 11.17.0`, and `opencode v2.1.4`. The rehearsal with
    `env -i` and the crontab PATH exited 0 with 30 test files and 238 tests
    passed.
- [x] 3.9 Green evidence: both gate commands and the cron rehearsal exit 0. f61a422
  Record their summaries in this plan. Record the runner and suite hashes
  before and after the phase.
  - Gate command, 2026-10-25 02:47 to 02:53 (+08:00):
    `cd harness && npm run test:meta:logic` printed
    `Test Files  30 passed (30)` and `Tests  238 passed (238)`. Exit 0.
  - Adversarial gate, 2026-10-25 02:57 to 03:05 (+08:00):
    `cd harness && BENCH_TRACK=change npm run test:meta:logic` printed
    `Test Files  30 passed (30)` and `Tests  238 passed (238)`. Exit 0.
  - Cron rehearsal, 2026-10-25 03:05 to 03:12 (+08:00): the design.md
    section 6 command with `env -i` and the crontab PATH printed
    `Test Files  30 passed (30)` and `Tests  238 passed (238)`. Exit 0.
  - Live evidence, 2026-10-25: the first OpenCode run of the week
    `tt-a-gpt-6-luna-2026w43-r1` produced a valid, trusted, publishable score
    of 93.5. The build-track run `a-gpt-6-luna-2026w43-r1` produced 94.5.
  - The runner hash covers `harness/opencode-entry.sh`,
    `harness/opencode-credential.sh`, `harness/toolchain.sh`, and
    `harness/usage.ts`. The suite hash covers every file under
    `harness/tests`.

## Phase 4: Verify and document

- [x] 4.1 Run both gate commands and the cron rehearsal on the final HEAD. 31c6972
  Record the exit codes and the Vitest summaries.
  - On the final HEAD, 2026-10-25 04:06 to 04:19 (+08:00): the logic gate and
    the adversarial gate each printed `Test Files  30 passed (30)` and
    `Tests  238 passed (238)`. The cron rehearsal printed the same summary and
    exited 0.
- [~] 4.2 Container probe without a model call for Arm A and Arm B. Archive
  the output under `reports/` (spec FR-4). The probe writes the 16-line
  `skill-probe` record in the form `skill-probe arm=<a|b> id=<id>
  status=<http status>` and keeps the per-arm startup logs for the
  watcher check (test-strategy.md section 7).
- [ ] 4.3 Live smoke after 2026-10-21 21:44 (+08:00): one build-track run per
  arm with one low-cost batch model. Check the valid score, the schema 7
  provenance, and the recost. Check that the secret scan is clean and that
  the host Console login works (spec acceptance criteria). Run the 10
  `enforce` probes of test-strategy.md section 7 with the Arm B positive
  control (`skill-measure` must complete), and write the record in the
  form `enforce arm=<a|b> probe=<name> attempt=<yes|no>
  status=<completed|denied|error|none>`. Check that the graded Arm A run
  has no `skill` part and that the Arm B run has `skill` parts only for
  the five ids. A loaded Arm A skill fails the task and goes to the
  owner (the owner-decision rule).
  - The live runs happened: six build-track runs and three tests-track runs
    graded valid, trusted, publishable scores on 2026-10-25. The enforce
    probe records are still open.
- [ ] 4.4 Host dry run: `BENCH_DRY_RUN=1 ./batch.sh` per track prints the
  OpenCode work list. The executor preflight passes on the host. `WEEK=all
  ./rescore-doctor.sh` prints SKIP for legacy Pi runs, and their `score.json`
  checksums do not change.
- [x] 4.5 Documentation: `README.md`, `SCORING.md`, `PLAN.md`, and f61a422
  `measure/index.md` (spec FR-11).
  - The four files describe OpenCode 2, the Console login, the token risk,
    provenance schema 7, the recorded-executor attestation, the version
    policy, and the two score series. `docs/methodology.html` states the
    executor change with its date and its reason.
- [ ] 4.6 Go/no-go by 2026-10-24 18:00 (+08:00): the owner confirms cron
  readiness, and this plan records the decision. On no-go, the preflight
  keeps the Sunday batch fail-closed: no Pi traffic and no agent runs.
  - The deadline passed. The Sunday cron ran the OpenCode executor and
    produced valid OpenCode scores. The owner still records the decision.
