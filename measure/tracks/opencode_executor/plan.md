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

## Phase 1: Investigate and contract

Read-only investigation of the host OpenCode 2. Phase 1 writes only files in
`measure/tracks/opencode_executor/`: `design.md`, redacted evidence, and
corrections to `spec.md`. Red starts only after task 1.9 is complete.

- [ ] 1.1 Headless run contract: confirm the flags `run --standalone --format
  json --auto --model opencode-go/<id>`. Record the exit codes for a provider
  error and for a timeout. Record the stdin behavior and the JSON event types.
  Confirm that `--auto` leaves no permission prompt. Use one tiny prompt with
  a free Go model in a throwaway container (spec FR-1).
- [x] 1.2 Cron self-check root cause: find the call that leaves the `tsx`
  output files (`score.json`, `candidate-contract.json`) empty under the
  crontab PATH. The 2026-10-18 reproduction failed 3 tests
  under the crontab PATH and passed 170 of 170 under the nvm PATH. Record the
  minimal fix (spec FR-9). [14b525a](evidence/task-1.2-cron-self-check.txt)
- [ ] 1.3 Credential export and import: record the redacted shape of `opencode
  auth export opencode`. Record how the active Console connection is
  selected. Import it with `opencode auth import --standalone` from stdin into
  an empty isolated store, with temporary XDG dirs and no model call. Record
  the store location. Confirm that the import leaves no other copy (spec
  FR-3).
- [ ] 1.4 Refresh and rotation: record the access-token lifetime from
  `expires`. Find a host refresh trigger that sends no prompt, if one exists.
  Confirm the import result when the refresh field is absent or inert.
  Confirm that the container cannot refresh and that the host login survives
  (spec FR-3).
- [x] 1.5 Isolation variables and config source: confirm how the generated
  config becomes the only config source (`OPENCODE_CONFIG`,
  `OPENCODE_CONFIG_CONTENT`, or the XDG config path). Confirm the effect of
  `OPENCODE_DISABLE_CLAUDE_CODE`, `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS`,
  `OPENCODE_DISABLE_AUTOUPDATE`, `OPENCODE_DISABLE_PROJECT_CONFIG`, and
  `OPENCODE_DISABLE_MODELS_FETCH` (spec FR-4). [d3ffe0c](evidence/task-1.5-isolation-and-config.txt)
- [~] 1.6 Skill path and arm proof: list the built-in skill IDs. Confirm
  five-skill discovery from a read-only mount through a `skills` config entry
  or the XDG skills path. Confirm the `skill` deny and allow rules. Name the
  commands that list skills, instruction files, MCP servers, and plugins
  without a model call (spec FR-4).
- [ ] 1.7 Container runtime needs: confirm that the binary starts in the
  pinned Node image. Record the helper downloads, such as ripgrep, language
  servers, and formatters. Record their executable needs under a `noexec`
  `/tmp`. Record the snapshot behavior and the network endpoints at startup.
  Select one helper supply method (spec FR-4).
- [ ] 1.8 Token usage format: record the event fields for input, output,
  reasoning, cache read, and cache write. Record whether they are per step or
  cumulative. Confirm whether subagent usage reaches the parent event stream.
  Save one redacted event stream from task 1.1 in the track directory (spec
  FR-7).
- [ ] 1.9 Design note: write `design.md`. It gives the confirmed command line,
  environment, mounts, config, and credential flow. It gives the field lists
  of identity schema 2 and provenance schema 7. It gives the usage mapping and
  the helper supply method. Record the owner answers to O1–O6. Correct
  `spec.md` where a fact differs.

## Phase 2: Test

Failing meta tests for the contract in `design.md`. No network, no real
model, no real credential (NFR-3).

- [ ] 2.1 Fake `opencode` fixture: replace the fake `pi` in
  `tests/meta/schema4-fixtures.ts` with a fake `opencode`. It prints a 2.x
  version. It captures its arguments, its environment names, and a stdin
  hash. It emits the fixed event stream from task 1.8 (spec FR-10).
- [ ] 2.2 Executor and isolation contract: extend
  `run-executor-provenance.test.ts`, `runtime-isolation.test.ts`,
  `runtime-isolation-completion.test.ts`, and `execution-identity.test.ts`.
  They prove the FR-1 command line, no Pi, and no `OPENCODE_API_KEY`. They
  prove private HOME and XDG dirs, no host mounts, and the generated config as
  the only config source. They prove Arm A (no `AGENTS.md`, no skills,
  `deny *`) and Arm B (fixture `AGENTS.md`, five snapshot skills). They prove
  that the arms differ only in that material (spec FR-1, FR-4).
- [ ] 2.3 Credential tests: only the Console connection reaches the
  container, without the refresh token. Delivery uses stdin. No token is in a
  process argument list, the environment, the artifacts, a log, or
  provenance. Staging is gone after success, failure, and timeout. A token
  that does not cover the run window stops the run before the agent. A
  secret-scan hit redacts the output and makes the run invalid (spec FR-3,
  NFR-1).
- [ ] 2.4 Provenance and attestation: prove the schema 7 fields. Prove that
  attestation reads only the recorded executor. A fake upgrade at the
  recorded path keeps an earlier run attested and not stale. A changed skill
  or config snapshot makes the run invalid. Adversarial ambient values give
  byte-identical `plan-work.ts --all` output and the same freshness verdicts.
  The variables are `BENCH_SKILL_ROOT`, `BENCH_AGENT_IMAGE`,
  `BENCH_EXECUTOR_RUNTIME_FLAGS`, `BENCH_EXECUTOR_CLI_FLAGS`,
  `BENCH_OPENCODE_BIN`, `BENCH_PI_ROOT`, `HOME`, and `PATH`. This carries the
  bench_incremental review A finding (spec FR-5, FR-6).
- [ ] 2.5 Cost: `usage.ts` parses the fixed event stream, plain and `.gz`,
  with the confirmed reasoning and subagent mapping. The recost equals the
  `go-pricing.json` formula. The no-output-token gate reads the new parser
  (spec FR-7).
- [ ] 2.6 History and site: the rescore and the regrade print a SKIP line for
  legacy Pi runs and keep their `score.json` bytes. The runs stay out of the
  work list, the ranking, the trend, and the Skills delta. `run.sh` refuses
  to replace a Pi run directory. Site rows show the executor name and version
  (spec FR-8).
- [ ] 2.7 Cron and preflight: the weekly toolchain setup resolves `node`,
  `npm`, and `opencode` independently of the crontab PATH. A missing binary
  or a missing Console credential stops the batch before the first agent run.
  No run directory is created (spec FR-2, FR-9).
- [ ] 2.8 Red evidence: run both gate commands. Record the start time, the end
  time, the exit codes, and the Vitest summaries in this plan. Record the
  failing tests per task.

## Phase 3: Implement (Green)

- [ ] 3.1 Remove every Pi path: `env.sh`, `run.sh`, `go-cost.ts`
  `--models-json`, and the `/opt/pi` mount of the container probe. Add the
  fail-closed executor preflight to `batch.sh` (spec FR-2, FR-10, NFR-6).
- [ ] 3.2 OpenCode container run in `run.sh`: binary resolution, the entry
  script `harness/opencode-entry.sh`, and the generated config. Add the
  per-run skill snapshot, the private HOME and XDG dirs, and the helper
  supply method (spec FR-1, FR-2, FR-4).
- [ ] 3.3 Console credential helper: export, selection, run-window check,
  host refresh, and access-only copy. Add the stdin delivery, the cleanup
  trap, and the secret scan with redaction (spec FR-3, NFR-1).
- [ ] 3.4 Execution identity schema 2, provenance schema 7, the executor
  cohort, and the runner hash list (spec FR-5).
- [ ] 3.5 Recorded-executor attestation in `executor-attestation.ts` and
  `provenance-check.ts`. Remove `withRecordedExecutorEnvironment` from
  `plan-work.ts` (spec FR-6).
- [ ] 3.6 OpenCode parser in `usage.ts`. Connect it to the `run.sh` gates and
  to `score.ts` (spec FR-7).
- [ ] 3.7 History: add the Pi SKIP to `rescore-doctor.sh` and the regrade
  scripts. Add the Pi run guard to `run.sh` and the executor series filter to
  `plan-work.ts`. Add the executor display and the series filter to
  `export-site-data.py` and `generate-model-pages.py` (spec FR-8).
- [ ] 3.8 Weekly toolchain in `cron-weekly.sh` with the task 1.2 fix, and the
  `CRON START` tool-path log (spec FR-9).
- [ ] 3.9 Green evidence: both gate commands and the cron rehearsal exit 0.
  Record their summaries in this plan. Record the runner and suite hashes
  before and after the phase.

## Phase 4: Verify and document

- [ ] 4.1 Run both gate commands and the cron rehearsal on the final HEAD.
  Record the exit codes and the Vitest summaries.
- [ ] 4.2 Container probe without a model call for Arm A and Arm B. Archive
  the output under `reports/` (spec FR-4).
- [ ] 4.3 Live smoke after 2026-10-21 21:44 (+08:00): one build-track run per
  arm with one low-cost batch model. Check the valid score, the schema 7
  provenance, and the recost. Check that the secret scan is clean and that
  the host Console login works (spec acceptance criteria).
- [ ] 4.4 Host dry run: `BENCH_DRY_RUN=1 ./batch.sh` per track prints the
  OpenCode work list. The executor preflight passes on the host. `WEEK=all
  ./rescore-doctor.sh` prints SKIP for legacy Pi runs, and their `score.json`
  checksums do not change.
- [ ] 4.5 Documentation: `README.md`, `SCORING.md`, `PLAN.md`, and
  `measure/index.md` (spec FR-11).
- [ ] 4.6 Go/no-go by 2026-10-24 18:00 (+08:00): the owner confirms cron
  readiness, and this plan records the decision. On no-go, the preflight
  keeps the Sunday batch fail-closed: no Pi traffic and no agent runs.
