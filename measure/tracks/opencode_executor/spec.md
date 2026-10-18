# Migrate the benchmark executor from Pi to OpenCode 2 with Console login — opencode_executor

## Summary

The benchmark runs each model through Pi with an OpenCode Go API key. OpenCode
expired the owner's Go API keys after an attack on 2026-10-18. This track
replaces Pi with OpenCode 2, the program that OpenCode users run. The executor
uses the Console login that the host OpenCode already holds. No API key is
used. OpenCode runs start a new score series. Pi runs stay on disk as
labeled history. The track also repairs the weekly self-check, which has
stopped every weekly batch since 2026w39.

Deadline: the work must be complete before the weekly cron runs on
Sun 2026-10-25 01:00 (+08:00).

## Why

- The benchmark recommends low-cost models to OpenCode users. The executor
  must be the OpenCode those users run.
- The owner judges that Go usage must come from the OpenCode harness itself.
  The owner does not accept the ban risk of Go traffic from Pi.
- The weekly cron has not run a model since at least 2026w39. Every track
  batch stopped at the harness self-check in w39, w41, and w42.

## Owner decisions (fixed)

1. Executor: OpenCode 2, the latest installed version. The harness never pins
   a version. Each run records the live version and the binary SHA-256 in its
   provenance.
2. Credential: the Console login that the host OpenCode holds. No API key. The
   harness copies only the required auth into the container, or provides it
   through a volume.
3. The cron stays enabled. The track must be complete before Sunday
   2026-10-25 01:00 (+08:00).

## Definitions

- **Executor.** The agent program that drives the model inside the container.
- **Console credential.** The OAuth record of the `opencode` integration
  ("OpenCode Console") in the host OpenCode store. Fields: `access`,
  `refresh`, `expires`; server `https://opencode.ai/console`; `orgID` with a
  `wrk_` or `org_` prefix.
- **Host store.** The credential store of the host OpenCode. OpenCode 2.x owns
  this store. It is not `~/.local/share/opencode/auth.json`.
- **Isolated store.** The OpenCode credential store inside one run container.
- **Container credential.** The reduced copy of the Console credential that
  the harness gives to one container.
- **Run window.** `AGENT_TIMEOUT` (default 3600 s) plus a 900 s margin.
- **Score series.** The runs that rank together. Each executor kind has its
  own series: `opencode` or `pi`.
- **Legacy Pi run.** A run whose provenance executor records Pi.
- **Ambient environment.** The environment variables of the process that
  classifies, rescores, or attests a run.

## Established facts (verified on this host, 2026-10-18)

Phase 1 must confirm every item that this list marks "to confirm".

- `opencode --version` prints `opencode v2.0.32`. The `opencode` command is a
  symlink to
  `/home/daniebo/.nvm/versions/node/v24.19.0/lib/node_modules/@opencode/cli/bin/opencode.exe`.
  That file is an x86-64 ELF executable of 211,842,528 bytes. Its SHA-256 is
  `489b51816a77809e841310e80c88e834c28c19ad1639e12ba8a19f08b47ab607`. The
  file changed on 2026-10-18 at 07:11, so the binary changes without notice.
- `opencode run` accepts `--standalone`, `--format default|json`, `--auto`,
  `--model provider/model#variant`, `--agent`, `--title`, and `--thinking`.
  `--auto` approves every permission that a rule does not deny.
- `opencode auth export [target]` prints stored credentials, secrets
  included, as JSON. `opencode auth import [file]` imports that JSON and
  reads stdin when the file is omitted. The v2.0.32 help text lists
  `--standalone` for these subcommands, but the binary's flag parser
  rejects it: `Unrecognized flag: --standalone in command opencode auth`
  (task 1.3 evidence). The import inside a container works without the
  flag. A running OpenCode also serves `GET /api/credential` and
  `POST /api/credential` (OpenChamber `lib/opencode/auth.js`, per the
  owner).
- `opencode auth list` shows the `opencode` integration ("OpenCode Console")
  with one OAuth connection. It shows no `opencode-go` integration. With that
  login, `opencode models` lists 30 `opencode-go/*` models.
- Model variants differ per model. Examples: `mimo-v2.5` has none;
  `deepseek-v4.1-flash` has `low,high,max`; `minimax-m3` has
  `none,thinking`. An unknown variant is a model-resolution error.
- OpenCode V2 documentation states:
  - Skill sources: `~/.config/opencode/skills`, `~/.claude/skills`,
    `~/.agents/skills`, the project `.opencode/skills`, `.claude/skills`, and
    `.agents/skills`, plus `skills` config entries. Built-in skills exist.
  - A `skill` permission rule with `deny` hides a skill and rejects its load.
  - OpenCode loads the global `AGENTS.md` and each project `AGENTS.md` up to
    the project root. V2 does not read `CLAUDE.md`.
    `OPENCODE_DISABLE_PROJECT_CONFIG=1` skips project `AGENTS.md` discovery.
  - Config merges `/etc/opencode`, the global config, and every
    `opencode.json(c)` from the working directory to the filesystem root.
  - The `update` config field controls self-updates.
  - With no matching permission rule, OpenCode asks. The `build` agent allows
    the `question` tool.
- The binary contains these environment names. Their V2 behavior is to
  confirm: `OPENCODE_CONFIG`, `OPENCODE_CONFIG_CONTENT`,
  `OPENCODE_CONFIG_DIR`, `OPENCODE_DISABLE_AUTOUPDATE`,
  `OPENCODE_DISABLE_CLAUDE_CODE`, `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS`,
  `OPENCODE_DISABLE_MODELS_FETCH`, `OPENCODE_MODELS_PATH`,
  `OPENCODE_DISABLE_FILEWATCHER`.
- Go documentation (https://opencode.ai/docs/go/): a client must send typical
  coding-agent traffic, its own User-Agent, and a stable `x-opencode-session`
  header. A request without the header gets HTTP 400 `MissingSessionID`
  (owner, 2026-10-18). OpenCode sends these headers natively.
- Pi is wired into these harness files:
  - `run.sh`: Pi agent dir staging, Podman arguments,
    `pi --print --mode json --no-session`, and the arm flags;
  - `env.sh`: `BENCH_PI_ROOT` discovery;
  - `execution-identity.ts`: `resolvePi`;
  - `executor-attestation.ts`: the recorded and live Pi executor;
  - `go-cost.ts`: `emitPiModelsJson`;
  - `usage.ts`: the Pi transcript parser;
  - `plan-work.ts`: `withRecordedExecutorEnvironment`;
  - `runtime-container-probe.cjs`: the `/opt/pi` mount checks;
  - `rescore-doctor.sh` (comments) and `regrade-run.sh` (`pi-agent` keep
    list).
- These meta tests fake a `pi` binary or check Pi evidence:
  `schema4-fixtures.ts`, `runtime-isolation.test.ts`,
  `runtime-isolation-completion.test.ts`, `execution-identity.test.ts`,
  `executor-attestation.test.ts`, `executor-provenance.test.ts`, and
  `run-executor-provenance.test.ts`.
- `harness/provenance.ts` puts `run.sh`, `execution-identity.ts`,
  `executor-attestation.ts`, `go-cost.ts`, `usage.ts`, `provenance-check.ts`,
  and `provenance-record.ts` in the runner hash list. An edit to any of them
  makes every existing run STALE-PROVENANCE until a rescore.
- The crontab PATH is
  `/snap/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`.
  Under it, `node` is `/snap/bin/node` (snap Node 24.22.0). The nvm bin
  directory, which holds Node 24.19.0, `npm`, `opencode`, and `pi`, is absent.
- Reproduction on 2026-10-18: `npm run test:meta:logic` under `env -i` with
  the crontab PATH fails 3 tests: `grade-exit.test.ts` (2) and
  `runner-safety.test.ts` (1), "Unexpected end of JSON input". Under the nvm
  PATH the same suite passes 170 of 170. In each failure, a JSON file that a
  `tsx` script writes is empty: `score.json` from `score.ts` (two tests, one
  of them at `grade.sh` line 108) or `candidate-contract.json` from
  `candidate-contract.ts` (one test). The exact failing calls are
  `"${TSX}" score.ts > score.json` (`grade.sh` line 108) and
  `"${TSX}" candidate-contract.ts` (`grade.sh` line 129); `tsx` starts
  with `#!/usr/bin/env node`, so the snap `node` in `PATH` breaks both.
- The cron rescore marks many arm-B runs INVALID with "executor attestation:
  live executor differs from recorded executor". The attestation re-hashes
  the host skill folders under `BENCH_SKILL_ROOT` at rescore time. Probable
  cause: the `measure` skill folder holds `.measure-install`, which an hourly
  cron job (`install-measure-skill`, minute 17) rewrites. To confirm.
- After the w42 week, in which every track batch failed, the cron published
  commit `96b3498`. It changed `docs/assets/data/` by +3839 and −11573 lines.
- bench_incremental Phase 3 review A found one blocking defect: an ambient
  `BENCH_SKILL_ROOT` flips run classification. `plan-work.ts` lines 107–111
  stage the skill root only when `runs/<id>/live-executor/skills` exists, and
  no real run has that folder. This track replaces that Pi-specific code.
- `PLAN.md` line 3 says "Keep Pi as the agent."
- The OpenCode Go monthly quota is at about 91% until 2026-10-21 21:44
  (+08:00).

## Functional requirements

### FR-1 — Headless OpenCode execution

- `run.sh` runs OpenCode 2 in the existing rootless Podman container. No
  harness path starts Pi.
- Target command (Phase 1 confirms the flags):
  `timeout <AGENT_TIMEOUT> <opencode> run --standalone --format json --auto
  --model opencode-go/<id> "<prompt>"`, with stdin from `/dev/null`.
- `--standalone` gives the run a private server. The run never connects to a
  host background service.
- The JSON event stream goes to `artifacts/session.json`. Stderr goes to
  `artifacts/session.err`.
- Every token that the run spends must be in the run artifacts. The usage
  record is the session export at `artifacts/executor/session-export.json`
  (FR-7). The event stream can lack the final step's usage, so it is a
  cross-check only. A missing export makes the run invalid.
- `--auto` approves every permission that the generated config does not
  deny. No permission prompt can stop a run.
- `AGENT_TIMEOUT` (default 3600 s) and the `/usr/bin/timeout` entrypoint stay.
- `<id>` is the `go-pricing.json` model key. An agent run accepts only the
  `opencode-go` provider. Overlay runs (`AGENT_SKIP=1`) keep their current
  behavior.
- Variant (O1, fixed): the run uses the model's default variant and adds
  no `#variant`. `score.json` records `default` in `thinking_requested`.
- Tools: the `build` agent defaults, with `deny` rules for `question` (no
  client can answer it) and `websearch` (O2, fixed: the Console web
  search is outside the Go plan; `webfetch` stays allowed).
- Subagents (O3, fixed): the config denies `subagent`. The subagent runs
  its own session, and its token usage is not in the parent event stream
  (task 1.8 evidence).
- The "agent produced no changes" and "agent emitted no output tokens" gates
  stay. They read the OpenCode usage from FR-7.

### FR-2 — Executor resolution and preflight

- New runs use the latest installed OpenCode. The harness never pins,
  installs, or upgrades OpenCode.
- `run.sh` resolves the binary from `BENCH_OPENCODE_BIN` when it is set.
  Otherwise it uses `command -v opencode` on the toolchain PATH (FR-9). It
  records the resolved real path.
- Before the agent starts, the harness records the `opencode --version`
  output and the SHA-256 of the resolved file.
- `batch.sh` runs an executor preflight before its first agent run. The
  preflight sends no prompt. It checks that:
  - the binary resolves and reports a 2.x version;
  - the Console credential exists in the host store (FR-3);
  - `opencode models` lists the first scheduled `opencode-go/<id>`.
- A failed preflight stops the batch before any agent run, with one clear
  error line. No run directory is created.

### FR-3 — Console credential delivery

- Source: the host store, through `opencode auth export opencode` (Phase 1
  confirms the call). The harness uses no API key. The harness removes the
  `OPENCODE_API_KEY` path, the `.env.local` key, the provider-key allowlist,
  and `BENCH_PROVIDER_ENV`. The container never receives `OPENCODE_API_KEY`.
- Selection: only the Console OAuth connection of the `opencode` integration
  leaves the host store. Other integrations never leave it. If the host has
  more than one Console connection, the harness uses the active one. It
  stops when the active one is ambiguous.
- Token rotation design:
  1. **Run-window check, fail closed.** v2.0.32 has no refresh trigger
     that sends no prompt, so the harness never forces a host refresh.
     The check runs twice, with the same reason line both times: once
     in the batch preflight, and again before each agent run. Each
     check compares `expires` with now plus the run window
     (`AGENT_TIMEOUT` plus 900 s). A serial batch can outlive a token
     that covered the first run window. If the token does not cover
     the run window, the run stops before the agent. The reason is
     "Console credential does not cover the run window". The weekly
     report warns when `expires` is within 7 days. The operator
     renews the login interactively on the host.
  2. **Access-only copy.** The container credential omits the refresh token.
     If the import requires the field, the harness writes an inert
     placeholder. The container OpenCode cannot refresh, so it cannot rotate
     the token and cannot log out the host OpenCode.
  3. **Rejected design: full copy with write-back.** Two stores that hold one
     rotating refresh token race. A rotation in the container makes the host
     copy invalid.
- Delivery: the harness streams the container credential on the container
  stdin. A read-only entry script (`harness/opencode-entry.sh`) imports it
  into the empty isolated store with `opencode auth import` (no
  `--standalone`; v2.0.32 rejects that flag for `auth`, and the import
  into the empty isolated store works without it). Then it starts
  `opencode run` with stdin from `/dev/null`.
- Fallback delivery, only if Phase 1 shows that stdin import fails: one 0600
  file in a 0700 directory under
  `$XDG_RUNTIME_DIR/lending-desk-bench/<run-id>/`, mounted read-only. The
  `run.sh` EXIT trap removes it on success, failure, and timeout.
- The credential never sits under the repository, `runs/`, or the candidate.
- The isolated store lives only on the container tmpfs. `podman run --rm`
  and the tmpfs remove it when the container stops. After each run, the
  harness verifies that no staging path remains.
- The secret never appears in a process argument list, in an exported host
  environment variable, in a log, in `provenance.json`, or in `score.json`.
- Provenance records only `{integration: "opencode", method: "oauth",
  refresh_token_delivered: false}`. It never records the `orgID` or a token.
- After each run, the host Console connection still works. The host refresh
  token changes only when the host OpenCode refreshes it.

### FR-4 — Isolation and arm contract

- The container sets `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`,
  `XDG_STATE_HOME`, and `XDG_CACHE_HOME` to private paths on the container
  tmpfs.
- The container mounts only these host paths, read-only unless
  stated (the full argument list is in `design.md` section 1.2):
  - the candidate tree, read-write, at `/workspace`;
  - the fixture `node_modules`, read-only, at
    `/workspace/node_modules`;
  - the resolved OpenCode binary file, read-only, at
    `/usr/local/bin/opencode`;
  - the per-run copy of the static ripgrep helper, read-only, at
    `/usr/local/bin/rg`;
  - the entry script, read-only, at `/entry/opencode-entry.sh`;
  - the generated config `artifacts/executor/opencode.json`,
    read-only, at `/config/opencode.json`;
  - Arm B only: the per-run skill snapshot
    `artifacts/executor/skills/`, read-only, at `/opt/skills`.
- The container never mounts the host home directory or a host dotfile tree.
  This includes `~/.config/opencode`, `~/.local/share/opencode`,
  `~/.cache/opencode`, `~/.claude`, and `~/.agents`. It also never mounts
  `harness/`, the reference trees, or sibling runs.
- The harness writes one OpenCode config per run to
  `artifacts/executor/opencode.json`. The file holds no secret. The
  container reads it as its only config document. `OPENCODE_CONFIG`
  adds a document and does not suppress the XDG directory source,
  so the isolation is the empty private `XDG_CONFIG_HOME` tmpfs
  directory plus `OPENCODE_DISABLE_PROJECT_CONFIG=1`. The
  preflight checks that the private config directory holds no
  config document and that the generated config parses as JSON
  (Phase 1 probe, 2026-10-18).
- Config content:
  - self-updates disabled;
  - no MCP servers, no added plugins, no `references`;
    no `instructions` in Arm A — Arm B adds one `instructions`
    entry for the fixture `AGENTS.md` (see Arm B);
  - the arm permission rules below and the `deny` rules from FR-1;
  - `deny` rules for `read` and `edit` on the isolated store path, as an
    extra barrier (the shell tool can still read it; see NFR-1).
- The container sets each confirmed disable flag for Claude Code
  compatibility, Claude skills, and auto-update. The harness uses no flag
  that Phase 1 does not confirm.
- The owner's global `AGENTS.md`, agents, MCP servers, plugins, and
  Claude-compatibility discovery never load.
- **Arm A (No Skills):** the workspace has no `AGENTS.md` (the current
  move-out behavior stays). The container mounts no skill. The config has a
  `skill` rule `deny *`, which also removes built-in skills. The run has no
  context files.
- **Arm B (Skills):** the fixture `AGENTS.md` stays. The Arm B
  config adds `instructions: ["/workspace/AGENTS.md"]` so the
  fixture `AGENTS.md` loads while
  `OPENCODE_DISABLE_PROJECT_CONFIG=1` stays set in both arms
  (Phase 1 probe, 2026-10-18). The container mounts
  exactly the five skills `measure`, `next-best-practices`,
  `vercel-react-best-practices`, `vercel-composition-patterns`, and
  `build-graph`, read-only, in a path that OpenCode discovers. The config has
  `skill` rules `deny *`, then `allow` for each of the five IDs.
- Arm B mounts a per-run skill snapshot. The harness copies the five folders
  from `BENCH_SKILL_ROOT` to `artifacts/executor/skills/<id>/` before the
  agent starts. The host folders are never mounted.
- Both arms use the same image, binary, environment, and entry
  script. The two configs differ only in the skill rules, the Arm
  B `skills.paths` entry, and the Arm B `instructions` entry. The
  arms differ only in the config, the skill mounts, and the
  presence of the candidate `AGENTS.md`.
- The current hardening stays: `--read-only`, `--cap-drop=ALL`,
  `no-new-privileges`, `--userns=keep-id`, `slirp4netns` with
  `allow_host_loopback=false`, `--pull=never`, and the digest-pinned image.
- OpenCode needs the ripgrep helper for its built-in `grep` tool. The
  harness ships the static musl ripgrep 15.1.0 release binary
  (`ripgrep-15.1.0-x86_64-unknown-linux-musl`, static-pie) and bind-mounts
  it read-only at `/usr/local/bin/rg`. The host distro `rg` does not run
  in the image (glibc mismatch, task 1.7 evidence §9). The preflight
  verifies the helper SHA-256 before each batch.
- A container probe without a model call proves the arm contract. Its output
  shows the config sources, the skills, the instruction files, the MCP
  servers, and the plugins for each arm.

### FR-5 — Provenance schema 7

- `PROVENANCE_SCHEMA` becomes 7. The execution identity becomes schema 2
  with `kind: "opencode"`. It records:
  - `opencode`: `{path, sha256, version}`;
  - `image_reference` and `image_identity`;
  - `model_ref` (`opencode-go/<id>`) and `variant` (or `null`);
  - `config_sha256` of `artifacts/executor/opencode.json`;
  - `entry_sha256` of the entry script;
  - `helpers`: `{rg: {path, sha256, version}}` of the shipped ripgrep;
  - `skills` (`{id: tree sha256}`), `skill_tree_sha256`, and the snapshot at
    `artifacts/executor/skills/<id>/`;
  - `runtime_flags`, `runtime_flags_sha256`, `cli_flags`, and
    `cli_flags_sha256`, with no secret in any array;
  - `credential`: `{integration, method, refresh_token_delivered}`.
- `executor-cohort.json` keeps its role: a frozen copy of the executor
  evidence for one run.
- New harness files that change execution join the runner hash list. This
  includes the entry script, the credential helper, and the usage parser.
- Schema 6 records stay readable so that the harness can label Pi history.
  `provenance-record.ts` never writes a Pi executor again.

### FR-6 — Version policy and attestation

- An OpenCode version change does not make earlier runs stale. A release
  never forces a rerun and never invalidates history.
- Each run keeps the OpenCode version it ran with. The site shows it.
- Attestation checks only the executor that the run recorded:
  - the internal consistency of the identity (run ID, arm, field formats,
    flag hashes, skill-tree hash, arm skill contract);
  - equality of the frozen cohort and the identity;
  - a fresh hash of the run's own skill snapshot and config snapshot, which
    must equal the recorded hashes.
- Attestation never resolves a live binary, a live skill folder, or a live
  image. It never reads `BENCH_SKILL_ROOT`, `BENCH_AGENT_IMAGE`,
  `BENCH_EXECUTOR_RUNTIME_FLAGS`, `BENCH_EXECUTOR_CLI_FLAGS`,
  `BENCH_OPENCODE_BIN`, `BENCH_PI_ROOT`, `HOME`, or `PATH`.
- `plan-work.ts` loses `withRecordedExecutorEnvironment` and the
  `live-executor/skills` staging. Classification depends only on `runs/`,
  `go-pricing.json`, and the harness hashes.
- Acceptance criterion carried from bench_incremental review A: an ambient
  value of any variable above never changes attestation, freshness, or
  classification.

### FR-7 — Cost

- `usage.ts` reads the OpenCode session export that the entry script
  writes after the run (`opencode session export <sessionID>`), plain or
  `.gz`. The whole-session totals come from `info.tokens`: `input`,
  `output`, `reasoning`, `cache.read`, and `cache.write`. The
  `--format json` event stream can lack the usage of the final step, so
  it is a cross-check only (task 1.8 evidence). The parser returns the
  current `Usage` shape.
- Reasoning tokens count as output tokens. Phase 1 resolved the open
  conditional: the event stream carries `reasoning` as a separate field
  (task 1.8 evidence section 2). `Usage.output` is the export's
  `output` plus `reasoning`.
- `go-cost.ts` recosts from that usage with the same `go-pricing.json`
  formula. `recostUsage` and the formula stay unchanged.
- The harness removes `emitPiModelsJson` and `--models-json`.
- The OpenCode cost figure stays advisory in `usage.costUsd`. Published
  economics use only the `go-pricing.json` recost.
- `recost.sh` keeps working on OpenCode and Pi records.

### FR-8 — History and site

- The harness finds the score series from the provenance executor kind. It
  never uses the run ID for this.
- Legacy Pi runs stay on disk. `rescore-doctor.sh` and the regrade scripts
  skip them with a SKIP line, so their `score.json` files stay unchanged.
  Only `recost.sh` still rewrites their `go` block after a price change, per
  the `PLAN.md` History rule. `plan-work.ts` does not count them.
- `run.sh` refuses to replace a run directory whose provenance records Pi.
- OpenCode runs start a new series. In the first OpenCode week, the work list
  classifies every batch model as `new` (open question O4).
- Site data and pages:
  - each row shows the executor name and version;
  - the leaderboard, the EMA trend, the 4-week range, and the Skills delta
    use OpenCode rows only;
  - model pages show Pi results in a separate labeled history block that is
    not ranked;
  - the methodology page states the executor change, its date, and its
    reason.
- This follows the `PLAN.md` History rule: "Do not rank them as Go results."

### FR-9 — Weekly self-check under cron

- Phase 1 finds the exact call that leaves the `tsx` output files empty
  under the crontab PATH.
- The weekly entry point defines its own toolchain. It does not depend on the
  crontab PATH. Under cron, `node`, `npm`, and `opencode` resolve to the same
  files as in the operator shell.
- `CRON START` logs the resolved paths and versions of `node`, `npm`, and
  `opencode`.
- A rehearsal from `env -i` with the crontab PATH runs the self-check in the
  same way as `cron-weekly.sh`. It must exit 0.

### FR-10 — Pi removal and meta tests

- No harness path starts Pi or stages Pi files. This includes the
  `BENCH_PI_ROOT` discovery in `env.sh`, the Pi agent dir, `models.json`, and
  `auth.json` staging in `run.sh`, and the `/opt/pi` mount in the container
  probe.
- The meta tests replace the fake `pi` with a fake `opencode`. The fake:
  - prints a 2.x version;
  - writes its argument list, its environment names, and a hash of its stdin
    to a capture file;
  - emits a fixed `--format json` event stream with token usage;
  - never opens a network connection.
- The gate commands stay:
  - `cd harness && npm run test:meta:logic`
  - `cd harness && BENCH_TRACK=change npm run test:meta:logic`

### FR-11 — Documentation

- `README.md`: "Install once", "Run a model", "Provider credentials", and
  "Isolation and candidate contract" describe OpenCode, the Console login,
  and the token risk from NFR-1.
- `SCORING.md`: "Validity and provenance" describes schema 7, the
  recorded-executor attestation, the version policy, and the score series.
- `PLAN.md`: line 3 names OpenCode as the agent. The "Change", "History", and
  "Files" sections drop Pi and the API key.
- `measure/index.md` lists this track's spec, plan, and design note.

## Non-functional requirements

- **NFR-1 — Security.** The model runs shell commands in the same container
  as OpenCode. It can read the container credential in the isolated store.
  The owner accepts Console auth with this risk. The harness reduces the
  exposure:
  - the container gets an access token only, never the refresh token;
  - the token lives only in the isolated store on the container tmpfs, for
    one run window;
  - the token is never in the candidate, the artifacts, a log, provenance,
    `score.json`, or the site data;
  - after each run, a secret scan checks the candidate tree, `artifacts/`,
    `session.json`, and `session.err` for the access token and the refresh
    token. A hit redacts every occurrence and makes the run invalid. The
    reason is "Console credential reached run output". A report line
    records the hit without the token;
  - the residual risk stays: during a run the model can read the access token
    and can send it over the network. The token expires at the end of its
    lifetime. `README.md` states this risk.
- **NFR-2 — Hermeticity.** Attestation, freshness, and classification depend
  only on the runs tree, the pricing table, and the harness hashes (A11
  class).
- **NFR-3 — Meta tests.** Meta tests use no network, no real model, and no
  real credential.
- **NFR-4 — Quota.** Before 2026-10-21 21:44 (+08:00), the track sends at most
  two live prompts, each tiny, with a free Go model. Graded live smoke runs
  happen after that time.
- **NFR-5 — Go client contract.** Model traffic comes from OpenCode itself,
  with its native User-Agent and `x-opencode-session` header. The harness
  adds no proxy and rewrites no header.
- **NFR-6 — Fail closed.** If the executor is not ready, the batch preflight
  stops the batch before any agent run. The harness never falls back to Pi.

## Acceptance criteria

- One live build-track run per arm, with one low-cost batch model, produces a
  valid graded `score.json` with schema 7 provenance and a recost `go` block.
- After those runs, the host Console login still works. Its refresh token
  changed only through a host refresh.
- The secret scan finds no token in the candidate trees, the artifacts, the
  logs, the provenance, or the site data.
- The container probe shows the Arm A and Arm B contracts from FR-4.
- Under adversarial ambient values for every variable in FR-6,
  `plan-work.ts --all` prints byte-identical JSON, and freshness verdicts do
  not change.
- After a fake OpenCode upgrade at the recorded path, an earlier run keeps
  its attestation and its freshness state.
- `WEEK=all ./rescore-doctor.sh` leaves the `score.json` files of legacy Pi
  runs byte-identical. The site labels those runs and does not rank them.
- The FR-9 rehearsal exits 0. Both gate commands in FR-10 exit 0.
- `BENCH_DRY_RUN=1 ./batch.sh` prints an OpenCode work list, and the executor
  preflight passes on the host.
- `README.md`, `SCORING.md`, `PLAN.md`, and `measure/index.md` match the
  implementation.

## Out of scope

- Version pins, installs, or upgrades of OpenCode.
- API-key credentials and agent runs through other providers. This includes
  the Xiaomi PAYG path for `mimo-v2.6-pro` from `tech-debt.md`.
- Rescore or regrade of legacy Pi runs under the new executor.
- The fixture, the criteria, the scoring weights, and the run-ID format.
- Grading inside the container (`tech-debt.md`, 2026-09-24).
- The content of `harness/go-pricing.json` (the owner has an uncommitted
  edit) and the catalog drift refresh.
- The cron schedule and the remaining bench_incremental tasks.

## Open questions for the owner — answered (2026-10-18)

Phase 1 recorded the owner answers in `design.md` section 7. The
questions below are restated with their recorded answers.

- **O1 — Variant (fixed: default).** The run uses the model's
  default variant and adds no `#variant`. `score.json` records
  `default` in `thinking_requested`.
- **O2 — Web tools (fixed: deny `websearch`, keep `webfetch`).**
  Console web search is outside the Go plan. `webfetch` stays
  allowed per the owner decision of 2026-09-24.
- **O3 — Subagents (fixed: deny).** The subagent runs its own
  session. Its token usage is not in the parent event stream, so
  the config denies `subagent` (task 1.8 evidence).
- **O4 — First week size (fixed: full matrix).** The first
  OpenCode week schedules the full matrix: 19 batch models,
  2 arms, and 6 repeats across the tracks, 228 runs. The batch
  is serial, and the next week continues from the work list.
- **O5 — Arm B skill drift (fixed: per-run snapshot).** The
  harness copies the five skill folders per run. Pinning the
  skill source happens in a later track (`tech-debt.md`
  option 1).
- **O6 — Publish after a failed week (out of scope).** The owner
  decides this outside this track.

## Related tech debt (`tech-debt.md`)

- 2026-09-22 — Arm-B skill `next-best-practices` is a frozen external
  dependency (O5).
- 2026-09-22 — Stale Pi builds break every OpenCode Go run (this track
  removes Pi).
- 2026-09-24 — `rescore-doctor.sh` without `BENCH_PI_ROOT` reports every
  valid run as invalid (FR-6 removes the live resolution).
- 2026-09-24 — Weekly batch length (O4).
- 2026-09-24 — Public repository and answer material (O2).
