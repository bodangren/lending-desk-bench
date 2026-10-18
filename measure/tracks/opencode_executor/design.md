# Design note — opencode_executor (Phase 1, task 1.9)

This note fixes the Phase 1 contract for the OpenCode executor.
Every fact cites a repo evidence file under
`measure/tracks/opencode_executor/evidence/` (short: "evidence/").
Facts with no evidence file are marked "unproven". The prompt
ledger is in section 8. The spec corrections are in section 9.

## 1. Confirmed command line and container environment

### 1.1 Command line

```
timeout <AGENT_TIMEOUT> opencode run --standalone --format json \
  --auto --model opencode-go/<id> "<prompt>" </dev/null
```

- The five flags work live: `--standalone` starts a private
  server, `--format json` prints NDJSON, `--auto` approves what
  the config does not deny, `--model` selects the model
  (evidence/task-1.1-headless-run.txt §3.1).
- A provider error exits 1 with `provider.no-route`
  (evidence/task-1.1-headless-run.txt §2.1).
- Unproven: the exit code after a `timeout` kill. The offline
  probe of §2.2 failed fast with `provider.no-route` before the
  20 s timeout fired (evidence/task-1.1-headless-run.txt §2.2).
  `/usr/bin/timeout` stays the entrypoint (spec FR-1). Phase 2
  tests the `AGENT_TIMEOUT` gate with the fake executor.
- stdin comes from `/dev/null`. The prompt is a command-line
  argument (evidence/task-1.1-headless-run.txt §3.2).
- The JSON event stream goes to `artifacts/session.json`. Stderr
  goes to `artifacts/session.err` (spec FR-1; the stream shape is
  in evidence/task-1.8-token-usage.txt §1).
- `run.sh` resolves the binary from `BENCH_OPENCODE_BIN` when it
  is set, otherwise with `command -v opencode` on the toolchain
  PATH (FR-9). It records the resolved real path, the
  `opencode --version` output, and the file SHA-256 (spec FR-2).

### 1.2 Podman argument list (the exact set)

```
podman run --rm -i --pull=never --read-only
  # -i connects the host stdin that carries the access-only
  # credential payload for the entry script's stdin import
  # (evidence/probe-stdin-import-and-models-fetch.txt §2, §6;
  #  without -i the import reads nothing and every graded run
  #  fails — review A R3)
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=512m
  --tmpfs /run/opencode:rw,nosuid,nodev,size=64m
  --cap-drop=ALL
  --security-opt=no-new-privileges
  --userns=keep-id
  --user "$(id -u):$(id -g)"
  --network slirp4netns:allow_host_loopback=false
  --mount type=bind,src=<candidate>,dst=/workspace,rw
  --mount type=bind,src=<fixture>/node_modules,dst=/workspace/node_modules,ro
  --mount type=bind,src=<resolved opencode>,dst=/usr/local/bin/opencode,ro
  --mount type=bind,src=<run>/rg,dst=/usr/local/bin/rg,ro
  --mount type=bind,src=harness/opencode-entry.sh,dst=/entry/opencode-entry.sh,ro
  --mount type=bind,src=<run>/executor/opencode.json,dst=/config/opencode.json,ro
  # Arm B only:
  --mount type=bind,src=<run>/executor/skills,dst=/opt/skills,ro
  --env HOME=/tmp/home --env XDG_CONFIG_HOME=/tmp/config
  --env XDG_DATA_HOME=/tmp/data --env XDG_STATE_HOME=/tmp/state
  --env XDG_CACHE_HOME=/tmp/cache
  --env OPENCODE_CONFIG=/config/opencode.json
  --env OPENCODE_DISABLE_PROJECT_CONFIG=1
  --env OPENCODE_DISABLE_CLAUDE_CODE=1
  --env OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1
  --env OPENCODE_DISABLE_AUTOUPDATE=1
  --env OPENCODE_DISABLE_MODELS_FETCH=1
  --workdir /workspace
  docker.io/library/node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3
  /entry/opencode-entry.sh
```

(evidence/task-1.7-container-runtime.txt §2, §7 for the flags and
the `/run/opencode` tmpfs; the mounts are this section's contract
and section 1.4; spec FR-4 carries the same set.) The hardening
flags `--read-only`, `--cap-drop=ALL`, `no-new-privileges`,
`--userns=keep-id`, `--user`, the `/tmp` tmpfs, the slirp4netns
network, and `--workdir /workspace` are the current
`harness/run.sh` set (lines 359–366) that spec FR-4 keeps. The
probe commands of evidence/probe-stdin-import-and-models-fetch.txt
§6 and evidence/probe-config-source-and-arm-configs.txt §2 ran
with subsets of this list and add no other argument.

### 1.3 Container environment

- `HOME=/tmp/home`, `XDG_CONFIG_HOME=/tmp/config`,
  `XDG_DATA_HOME=/tmp/data`, `XDG_STATE_HOME=/tmp/state`,
  `XDG_CACHE_HOME=/tmp/cache` (evidence/task-1.7-container-runtime.txt §2).
- The entry script pre-creates these directories before the agent
  starts (evidence/task-1.7-container-runtime.txt §2, §7).
- `OPENCODE_CONFIG=/config/opencode.json` (the section 1.2 bind
  mount) adds the generated config as a document. It does not
  suppress the XDG directory source. The isolation is the empty
  private `XDG_CONFIG_HOME` tmpfs directory plus
  `OPENCODE_DISABLE_PROJECT_CONFIG=1`. The preflight checks
  that the private config directory holds no config document
  and that the generated config parses as JSON.
  (evidence/probe-config-source-and-arm-configs.txt §3, §5.)
- Confirmed disable flags, all set by the entry script:
  `OPENCODE_DISABLE_PROJECT_CONFIG=1`,
  `OPENCODE_DISABLE_CLAUDE_CODE=1`,
  `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1`,
  `OPENCODE_DISABLE_AUTOUPDATE=1`,
  `OPENCODE_DISABLE_MODELS_FETCH=1`
  (evidence/task-1.5-isolation-and-config.txt §4;
  evidence/task-1.7-container-runtime.txt §6).
- The binary prints its version and runs `debug paths`, `mcp
  list`, `plugin list`, `stats`, and `models` with no network
  (evidence/task-1.7-container-runtime.txt §3, §6).

### 1.4 Mounts

| Mount | Destination | Mode |
|---|---|---|
| Candidate tree | `/workspace` | rw |
| `fixture/node_modules` | `/workspace/node_modules` | ro |
| Resolved OpenCode binary (`BENCH_OPENCODE_BIN` or PATH) | `/usr/local/bin/opencode` | ro |
| Per-run copy of the static `rg` binary | `/usr/local/bin/rg` | ro |
| Entry script `harness/opencode-entry.sh` | `/entry/opencode-entry.sh` | ro |
| Generated config `artifacts/executor/opencode.json` | `/config/opencode.json` | ro |
| Arm B only: per-run skill snapshot `artifacts/executor/skills/` | `/opt/skills` | ro |

(evidence/task-1.7-container-runtime.txt §7; section 5 of this
note; spec FR-4.) The container never mounts a host home, a host
dotfile tree, `harness/`, or sibling runs (spec FR-4).

### 1.5 Config source and content

- Mechanism: `OPENCODE_CONFIG=/config/opencode.json` points at
  the generated per-run config. The config key shape (one shape
  for both arms, probe-confirmed):
  `$schema`, `model` (the string `opencode-go/<id>`), `skills`
  (Arm B only: `{paths: ["/opt/skills"]}`), `instructions`
  (Arm B only: `["/workspace/AGENTS.md"]`, the R4 mechanism of
  this note), and `permissions`
  (the rule list below). `debug config` normalizes the model
  string to `{providerID, model}` and `skills.paths` to a flat
  array; both forms load
  (evidence/probe-config-source-and-arm-configs.txt §1, §2).
- Isolation rule (probe-corrected): `OPENCODE_CONFIG` ADDS a
  config document. It does not suppress the XDG directory
  source. A planted config in `$XDG_CONFIG_HOME/opencode/` is
  read as a second document
  (evidence/probe-config-source-and-arm-configs.txt §3). The
  isolation is the empty private `XDG_CONFIG_HOME` tmpfs
  directory plus `OPENCODE_DISABLE_PROJECT_CONFIG=1`. Two
  preflight checks follow: the private config directory holds
  no config document, and the generated config parses as JSON
  (an invalid config loads silently, §5 of the same file).
- Content: no secret, no MCP server, no plugin. Arm A has no
  `instructions` entry. Arm B adds
  `instructions: ["/workspace/AGENTS.md"]` so the fixture
  `AGENTS.md` loads while
  `OPENCODE_DISABLE_PROJECT_CONFIG=1` stays set in both arms
  (review A R4;
  evidence/probe-agents-md-and-skill-activation.txt §1, §2).
  Self-update is off through
  `OPENCODE_DISABLE_AUTOUPDATE=1`. Permission rules, both arms:
  deny `question` (O2-side), deny `websearch` (O2), deny
  `subagent` (O3), deny `read` and `edit` on the isolated store
  path `/tmp/data/**` (spec FR-4), deny `skill *`;
  Arm B adds `allow` rules for the five ids `measure`,
  `next-best-practices`, `vercel-react-best-practices`,
  `vercel-composition-patterns`, `build-graph`, plus the
  `skills.paths` entry.
- Probe proof (no prompt, offline): with the empty private XDG
  directory, `opencode debug config` lists exactly one document
  per arm: Arm A with the six deny rules and no skills entry,
  Arm B with the six deny rules, the five allow rules, and the
  skills paths
  (evidence/probe-config-source-and-arm-configs.txt §2).
- Arm contract probe (no prompt, offline, fresh container per
  arm; review A R1, R4): the server API proves the arm contract.
  `opencode serve` needs authentication; the probe sets
  `OPENCODE_SERVER_PASSWORD` to a synthetic value and uses HTTP
  Basic. The working no-prompt skill probe is
  `POST /api/experimental/session/{id}/skill` with
  `resume: null`: Arm B returns 204 for exactly the five ids and
  404 for an unmounted id; Arm A returns 404 for all five.
  `GET /api/skill` never lists the mounted skills, so it is not
  the probe. The R4 watcher probe shows the Arm B `instructions`
  entry loads with the flag set
  (evidence/probe-agents-md-and-skill-activation.txt §1–§3).
  One fresh container per config is still required:
  a second invocation in one container reuses the first
  config through the background service
  (evidence/probe-config-source-and-arm-configs.txt §4).
- Resolved permission rules: `GET /api/agent` shows the agent
  DEFAULT permissions only (the `build` agent shows
  `question: allow` even with the config deny). The resolved
  config rules are visible only through `opencode debug config`
  and `GET /api/config`
  (evidence/probe-agents-md-and-skill-activation.txt §4).
- Open contract risk (review A R1, owner decision pending): the
  activation endpoint returns 204 for the built-in skills
  `opencode` and `report` in BOTH arms, even with
  `deny skill *`, and in Arm A the activation appended the full
  built-in skill content to the session. The permission filter
  that removes built-ins from the model-visible skill list
  (`SkillInstructions.load`, the `b9` filter) is static evidence
  only. This puts the Arm A "no skills" contract at risk at
  tool-call time. No workaround is chosen here: a workaround
  would change the arm contract, and the owner decides that.
  Task 4.3 must test the enforcement at tool-call time on the
  live smoke runs (Arm A: no `skill` part in the export; Arm B:
  a `skill` part for one of the five ids and for no built-in
  id). The strategy role amends task 4.3
  (evidence/probe-agents-md-and-skill-activation.txt §3, §4).
- Machine-readable arm records (test-strategy.md amendment 4,
  review handoff H12). Green writes these records in tasks 4.2
  and 4.3 from the raw probe output, and archives the records and
  the raw output under `reports/`. Task 4.2 writes one line per
  arm and skill id in the exact form
  `skill-probe arm=<a|b> id=<id> status=<http status>` (16 lines:
  the five Arm B ids, the unmounted control `pdf`, and the
  built-ins `opencode` and `report` in both arms). Task 4.3
  writes one line per enforcement probe in the exact form
  `enforce arm=<a|b> probe=<name> attempt=<yes|no>
  status=<completed|denied|error|none>` (10 lines: Arm A probes
  `websearch`, `question`, `subagent`, `skill-opencode`,
  `skill-report`, `skill-measure`; Arm B probes `websearch`,
  `question`, `subagent`, plus the positive control
  `skill-measure`, which must complete). The line forms are
  copied from test-strategy.md section 7; the strategy check
  commands read exactly these forms.
- Removed operator interface (spec FR-3, FR-7, FR-10):
  `BENCH_PI_ROOT`, `BENCH_PROVIDER_ENV`, `OPENCODE_API_KEY`, the
  `.env.local` key, and `--models-json` are gone. The container
  never receives `OPENCODE_API_KEY`.
- Arm proof without a model call: `opencode debug config`,
  `opencode mcp list`, `opencode plugin list`,
  `opencode debug paths` (evidence/task-1.6-skill-path-and-arm-proof.txt §5).

## 2. Credential flow (FR-3)

### 2.1 Confirmed facts

- Export: `opencode auth export opencode` on the host prints one
  JSON array. It holds one active Console connection:
  `integrationID` `opencode`, label `Workspace1`, `active: true`,
  method `device`. There is no ambiguity
  (evidence/task-1.3-1.4-credential.txt §4, §5;
  evidence/auth-export.shape.json).
- v2.0.32 rejects `opencode auth --standalone` with
  `Unrecognized flag: --standalone in command opencode auth`
  (evidence/task-1.3-1.4-credential.txt §6).
- The import inside the container works without the flag:
  `opencode auth import /tmp/cred.json` into the empty isolated
  store exits 0 and prints "Imported 1 credential"
  (evidence/task-1.1-headless-run.txt §2.3, §3.5;
  evidence/task-1.3-1.4-credential.txt §13.1).
- The access-only copy with `refresh="inert"` is accepted, and a
  live model call works with it
  (evidence/task-1.3-1.4-credential.txt §13.1, §13.2).
- The token is valid for 29 days: `expires` is
  2026-11-17 07:29:12 +08:00
  (evidence/task-1.3-1.4-credential.txt §10).
- No refresh trigger sends no prompt. The `auth` subcommands are
  `list`, `login`, `logout`, `export`, `import`, `switch`. None
  refreshes (evidence/task-1.3-1.4-credential.txt §10).
- A container refresh did not happen in Phase 1. The access token
  was valid, so no renewal ran. "The container cannot refresh"
  stays unproven (evidence/task-1.1-headless-run.txt §5).
- The host login survives: the proof is the refresh-value
  comparison inside the credential frame, `equal=true` before
  versus after both prompts. The host `auth.json` file metadata
  alone is not proof (its mtime predates the runs). The record
  never stores the compared value
  (evidence/task-1.1-headless-run.txt §4; section 8 of this
  note; review A-N3).
- Stdin import is proven, no prompt: with `podman run -i`, stdin
  from the access-only copy, the command
  `opencode auth import` (no file argument) exits 0 and prints
  "Imported 1 credential". A following `opencode auth list`
  prints one table row (integration, label, state `stored`) and
  no token values
  (evidence/probe-stdin-import-and-models-fetch.txt §2).
  The section 1.2 argument set carries `-i` for this reason:
  the harness delivers the access-only payload on the Podman
  stdin of every graded run, and the entry script consumes it
  there (review A R3).
- Container credential payload (access-only copy, keys only;
  the harness never records values):
  `[ { id, integrationID, label, active, value: { type: "oauth",
  methodID, refresh: <inert placeholder>, access, expires,
  metadata } } ]`. The copy replaces `refresh` with the inert
  placeholder; every other key is the exported value
  (evidence/probe-stdin-import-and-models-fetch.txt §1;
  evidence/auth-export.shape.json for the redacted shape).
- `OPENCODE_DISABLE_MODELS_FETCH=1` stays in the confirmed
  disable set: one fresh container per configuration, the flag
  set from the container start, the imported access-only
  credential, and the network on. With the flag, `opencode
  models` exits 0 and lists 30 `opencode-go/*` ids,
  `opencode-go/beam-free` included. Without the flag it lists
  29–30. The difference and the 28 of the earlier probe are live
  catalog drift, not a flag effect
  (evidence/probe-stdin-import-and-models-fetch.txt §7).
  This also proves the FR-2 preflight can check a scheduled
  `opencode-go/<id>` with `opencode models` without a prompt.
  Retry rule (test-strategy.md row 2.7, review handoff H10): the
  preflight retries a transient exit 1 of `opencode models` up to
  2 times, with a 5 s delay between attempts (3 calls in total).
  The R2 probe saw one transient failure in 4 frames per
  configuration, and every failure passed on the next attempt, so
  2 retries cover the observed flakiness
  (evidence/probe-stdin-import-and-models-fetch.txt §7). A
  successful list that lacks the scheduled model stops the batch
  at once, with no retry: a missing model is not transient. After
  the last failed attempt, the batch stops before any agent run
  (fail closed, NFR-6).

### 2.2 Selected FR-3 run-window option (fail closed)

The check runs twice, with the same reason line both times. The
batch preflight reads `expires` from the export once, before the
first run. Each run checks again before the agent starts:
`expires` must cover now plus the run window (`AGENT_TIMEOUT`
plus 900 s). A serial batch of 228 runs can outlive a token that
covered the first run window, so one batch check is not enough.
When either check fails, the stop is fail-closed and the reason
line is "Console credential does not cover the run window"
(spec FR-3, NFR-6). The helper `harness/opencode-credential.sh`
does the export, the selection, the access-only copy, and both
window checks. The harness never forces a host refresh: v2.0.32
has no refresh trigger without a prompt. The operator renews the
login interactively with `opencode auth login` on the host.

Weekly expiry warning (one rule, the same in `spec.md`): when
`expires` is within 7 days of the report time, the weekly report
prints one warning line with the `expires` time. The warning
never stops the batch and never changes a run verdict; only the
run-window check of this section stops a run.

### 2.3 Other options (not selected)

- Warning only, no stop: the batch would run on a token that can
  expire mid-run. This breaks NFR-6.
- Host-service fallback for the import: a second writer to one
  rotating refresh token. This breaks the FR-3 single-writer rule
  (evidence/task-1.3-1.4-credential.txt §6).
- Wait for an OpenCode release that restores `auth --standalone`.
  The deadline does not allow it.

## 3. Identity schema 2 and provenance schema 7 (FR-5)

### 3.1 Execution identity, schema 2 (`kind: "opencode"`)

```
schema: 2
kind: "opencode"
run_id: string
arm: "a" | "b"
opencode: { path, sha256, version }        // resolved binary
image_reference: string
image_identity: string
model_ref: "opencode-go/<id>"
variant: string | null                     // null: no #variant (O1)
config_sha256: string                      // artifacts/executor/opencode.json
entry_sha256: string                      // harness/opencode-entry.sh
helpers: { rg: { path, sha256, version } } // section 5 of this note
skills: { <id>: <tree sha256> }            // Arm B; {} in Arm A
skill_tree_sha256: string
runtime_flags: string[]                    // no secret
runtime_flags_sha256: string
cli_flags: string[]                        // no secret
cli_flags_sha256: string
credential: { integration: "opencode", method: "oauth",
              refresh_token_delivered: false }
```

The not-invoked record becomes `{schema: 2, kind: "not-invoked",
run_id, arm, reason: "AGENT_SKIP=1"}`. Schema 2 grows from the
schema 1 shape in `harness/execution-identity.ts` (lines 23–41):
`pi` becomes `opencode`, and `helpers`, `model_ref`, `variant`,
`config_sha256`, `entry_sha256`, and `credential` are new.

### 3.2 Provenance, schema 7

`PROVENANCE_SCHEMA` becomes 7. The record keeps every schema 6
field of `harness/provenance-record.ts` (schema, track,
fixture_revision, the run binding fields,
`contract_violation_sha256`, `graft`, `run_id`, `arm`, `model`,
`mode`, `candidate_sha256`, `fixture_protected_sha256`,
`runner_sha256`, `suite_sha256`, `agent_isolated`,
`candidate_contract_schema`, `cohort_id`, `executor_cohort`).
The `executor` field becomes the identity of section 3.1, and
`execution_identity_sha256` hashes it. `executor-cohort.json`
keeps its role: a frozen copy of the executor evidence for one
run. New execution files join the runner hash list: the entry
script, the credential helper `harness/opencode-credential.sh`,
and the new usage parser (spec FR-5).
FR-8 site rows: `export-site-data.py` and
`generate-model-pages.py` take the executor name and version
from the provenance executor identity (`opencode.version` for
OpenCode runs, `pi.version` for the legacy schema 1 rows).
Phase 3 wires this from `provenance.json`, not from
`score.json`.

## 4. Usage mapping and usage source (FR-7)

### 4.1 Event fields (per step)

`step_finish.tokens` holds `input`, `output`, `reasoning`,
`cache.read`, `cache.write`; `step_finish.part` holds `cost`
(advisory). The fields are per step, not cumulative
(evidence/task-1.8-token-usage.txt §2).

### 4.2 Finding: the final step can lack usage

Neither live stream has a `step_finish` for its last step. The
`--format json` stream can lack token usage for the final step.
The stream alone is not a complete usage source
(evidence/task-1.8-token-usage.txt §1.3).

### 4.3 Selected usage source

The usage source is the session export, in this order of
precedence:

1. **Source of truth: the session export.** The entry script runs
   `opencode session export <sessionID>` inside the container
   after `opencode run` returns, and writes the JSON to
   `artifacts/executor/session-export.json` (plain; the parser
   also accepts the `.gz` form). The sessionID rule (review A
   NR3): the entry script reads
   `opencode session list` in the isolated store and selects the
   session only when the list holds exactly one row. A fresh
   container holds exactly one session
   (evidence/task-1.8-token-usage.txt §5.2, §5.3). If the list
   holds two or more rows (for example a subagent session, which
   is possible only when the O3 `subagent` deny has no effect),
   the newest row can be the subagent session and the export
   would silently drop the parent totals, so the run is invalid
   (fail closed, NFR-6). The rule never picks the newest row of
   a multi-row list.
2. **Cross-check only: the event stream.** `artifacts/session.json`
   can lack the final step's usage (§4.2 of this note), so it
   never feeds the `Usage` record. Task 4.3 cross-checks the
   export totals against the stream. Subagents are denied (O3),
   so no subagent mapping exists.

Order against the agent timeout: `timeout` wraps only the
`opencode run` command. The export step runs after the wrapped
command returns. It is expected to run also after a `timeout`
kill, because the session row exists from the start. This is an
inference from a run that failed with `provider.no-route`, not
from a kill (the offline probe exported a session whose run had
failed, evidence/task-1.8-token-usage.txt §5); the kill case
stays unproven until the Phase 2 fake covers it (review A NR6).
"Missing or empty export" is defined as: the artifact file is
absent, has 0 bytes, is not valid JSON (for the `.gz` form: not
valid gzip, or the decompressed text is not valid JSON), or has
no `info.tokens` object. Each case makes the run invalid (fail
closed, NFR-6). The parser returns zero usage only when
`info.tokens` exists and every field is 0 or absent; a
zero-usage run is not invalid by this rule alone.

The export artifact holds `messages` with assistant text and
tool output. It stays inside the run directory, which is never
committed. The parser reads `info` only (`tokens`, `cost`,
`model`), never `messages` (review B RB-4).

Evidence for the shape: evidence/task-1.8-token-usage.txt §5, §6;
evidence/offline-session-export.redacted.json. The store holds
the same totals in the `session_v2` row of `opencode.db`
(`tokens_input`, `tokens_output`, `tokens_reasoning`,
`tokens_cache_read`, `tokens_cache_write`, `cost`). The message
rows hold no tokens.

Open item for task 4.3: the offline probe proves the field shape
on a zero-token session. The first live smoke run confirms the
non-zero totals.

### 4.4 Mapping to the `Usage` shape

The parser returns the `Usage` shape of `harness/usage.ts`
(lines 6–11). One export file in, one record out:

```
info.tokens.input        →  input
info.tokens.output       →  output
info.tokens.reasoning    →  added to output (Usage.output =
                            info.tokens.output + reasoning)
info.tokens.cache.read   →  cacheRead
info.tokens.cache.write  →  cacheWrite
totalTokens              →  input + output + reasoning +
                            cache.read + cache.write
info.cost                →  costUsd (advisory, rounded like the
                            Pi parser: *1e6 and back)
info.model.providerID    →  provider
info.model.id            →  model  (the export key name;
                                  `debug config` calls the same
                                  field `model`)
messages                 →  assistantTurns: count of assistant
                            messages; toolCalls: count of
                            tool-call parts; turns: count of
                            user messages (the prompt count).
                            Phase 2 tests these counts against
                            a fixture export with known values.
export file size         →  logBytes
```

The reasoning rule (spec FR-7): `Usage.output` counts reasoning
tokens as output. The live2 stream supports this: its reasoning
value (32) is larger than its output value (31), so the stream
carries reasoning as a separate field
(evidence/task-1.8-token-usage.txt §2; review A-N12).

`harness/usage.ts` keeps the Pi transcript parser for legacy
regrades. FR-7 adds the OpenCode export parser next to it.

## 5. Helper supply method (task 1.7)

- The built-in `grep` tool needs ripgrep
  (evidence/task-1.7-container-runtime.txt §4.1).
- Source of the `rg` binary: the official ripgrep 15.1.0 release
  asset. The host distro `rg` does not run in the image: it needs
  `GLIBC_2.39`, the image is Debian 12 bookworm (glibc 2.36)
  (evidence/task-1.7-container-runtime.txt §9).
- Source policy (verified this phase, review A-N11):
  - Download command:
    `curl -fsSL -o ripgrep.tar.gz
    https://github.com/BurntSushi/ripgrep/releases/download/15.1.0/ripgrep-15.1.0-x86_64-unknown-linux-musl.tar.gz`
  - Tarball SHA-256:
    `1c9297be4a084eea7ecaedf93eb03d058d6faae29bbc57ecdaf5063921491599`.
  - Upstream check: the release publishes
    `ripgrep-15.1.0-x86_64-unknown-linux-musl.tar.gz.sha256`;
    its value equals the computed tarball hash (verified,
    2026-10-18; evidence/ripgrep-tarball-source.txt §2).
  - Extracted binary `rg` SHA-256:
    `ebeaf56f8a25e102e9419933423738b3a2a613a444fd749d695e15eba53f71f2`
    (`ripgrep 15.1.0 (rev af60c2de9d)`, static-pie, verified to
    exec in the pinned image).
- No binary is vendored into the repository in this phase. The
  operator setup downloads the tarball, checks it against the
  upstream `.sha256` file, extracts the binary, and stores it
  outside the repository. The preflight verifies the extracted
  binary SHA-256 before each batch and stops the batch on a
  mismatch. `run.sh` copies the binary into the per-run artifact
  tree, and Podman bind-mounts that copy read-only at
  `/usr/local/bin/rg`. The noexec `/tmp` stays. The download
  never happens at run time
  (evidence/task-1.7-container-runtime.txt §4.4, §9).
- The identity records the helper: `helpers.rg =
  { path, sha256, version: "15.1.0" }` (section 3.1). The
  harness verifies the SHA-256 before each batch in the preflight
  and stops the batch on a mismatch.

## 6. Cron toolchain and REHEARSAL (FR-9)

- The weekly entry point defines its own toolchain: the sourceable
  file `harness/toolchain.sh`. `cron-weekly.sh` sources it before
  `weekly.sh`. It makes `node`, `npm`, and `opencode` resolve to
  the operator nvm toolchain, not to the snap dispatcher
  (evidence/task-1.2-cron-self-check.txt §4, §5, §6).
- Node discovery rule for `toolchain.sh` (review A NR2): when
  `NVM_DIR` is unset (REHEARSAL runs under `env -i`, which
  removes it), the script uses the default `${HOME}/.nvm`. The
  script reads the nvm `default` alias at
  `$NVM_DIR/alias/default`. A full-version alias value (for
  example `v24.19.0`) selects `$NVM_DIR/versions/node/<value>`.
  A partial alias value (for example `24`, the current host
  value, with `v24.19.0` the only installed version) selects the
  newest installed directory under `$NVM_DIR/versions/node` whose
  name matches `v<value>.*`. No match stops the script (fail
  closed). The script then prepends that `bin` directory to
  `PATH`. It never hard-codes a version path such as
  `versions/node/v24.19.0/bin`, because a version path breaks
  after a Node upgrade. A test can point `NVM_DIR` at a synthetic
  tree (a `alias/default` file plus a `versions/node/<v>/bin`
  directory) and check the resolved `node`, for both a
  full-version and a partial alias value. `npm` resolves from
  the same `bin` directory. `opencode` resolves from the PATH
  that remains after the prepend (the operator nvm global bin).
- REHEARSAL command (test-strategy.md section 2, unchanged; the
  file name is confirmed by task 1.2):

```
env -i HOME="$HOME" PATH=/snap/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin bash -c 'set -eu; cd /home/daniebo/Desktop/lending-desk-bench/harness; . ./toolchain.sh; . ./env.sh; env -u BENCH_TRACK npm run --silent test:meta:logic'
```

- `CRON START` logs the resolved paths and versions of `node`,
  `npm`, and `opencode` (spec FR-9).

## 7. Owner answers O1–O6

- **O1 — Variant: default.** The run adds no `#variant`.
  `score.json` records `default` in `thinking_requested`. Evidence:
  the offline run records `variant: "default"` in
  `evidence/offline-session-export.redacted.json`.
- **O2 — Web tools: deny `websearch`, keep `webfetch`.** The
  config gains a `websearch` deny rule
  (evidence/task-1.1-headless-run.txt §1).
- **O3 — Subagents: deny `subagent`.** The subagent ran its own
  session. Its token usage is not in the parent event stream. The
  config denies the `subagent` tool
  (evidence/task-1.8-token-usage.txt §3).
- **O4 — First week size: full matrix.** The first OpenCode week
  schedules all 228 runs (19 batch models, 2 arms, 6 repeats
  across the tracks). The batch is serial.
- **O5 — Arm B skill drift: per-run snapshot.** The harness copies
  the five skill folders per run. Pinning the skill source happens
  in a later track.
- **O6 — Publish after a failed week: out of scope.** The owner
  decides this outside this track.

Review-turn owner decisions (2026-10-18, about 13:10 +08:00):

- **RB-1 exposure accepted.** The refresh-token hash values in
  the git history (added in `52beaa3`, removed from the files in
  `9a638b6`) and the short-lived access-only copy under `/tmp`
  (turn 4, first Green session): the owner accepts them with no
  action. The history is published unchanged by the next cron
  push. See `evidence/protocol-incident-2026-10-18.md`.
- **Free-model deviation accepted.** `opencode-go/beam-free` is
  not proven free. The Go monthly quota moved from 90.79623% to
  90.79700% over the 2 live prompts. The owner accepts the
  deviation from the NFR-4 free-model rule (section 8 of this
  note records the quota numbers).

## 8. Prompt ledger (NFR-4)

Ledger for every `opencode run` command, live or not. This table
replaces `evidence/prompt-ledger.md`.

| # | Time (+08:00) | Model | Network | Live | Prompt text | Prompt bytes | Exit code | Evidence |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-10-18 11:28 | opencode-go/nonexistent-model | none | no | `hi` | 2 | 1 | evidence/task-1.1-headless-run.txt §2.1 |
| 2 | 2026-10-18 11:28 | opencode-go/beam-free | none | no | `hi` | 2 | 1 | evidence/task-1.1-headless-run.txt §2.2 (timeout 20) |
| 3 | 2026-10-18 11:30 | opencode-go/beam-free | none | no | `Reply with the word OK.` | 23 | 1 | evidence/task-1.1-headless-run.txt §2.3 (import + run, --network=none) |
| 4 | 2026-10-18 11:32 | opencode-go/beam-free | slirp4netns | **yes** | `Reply with the word OK.` | 23 | 0 | evidence/live1-event-stream.redacted.json; evidence/task-1.1-headless-run.txt §3 |
| 5 | 2026-10-18 11:33 | opencode-go/beam-free | slirp4netns | **yes** | `Use the task tool once to run a subagent that replies OK. Then reply DONE.` | 74 | 0 | evidence/live2-event-stream.redacted.json; evidence/task-1.8-token-usage.txt §1.2, §3 |
| 6 | 2026-10-18 11:47 | opencode-go/beam-free | none | no | `Reply with the word OK.` | 23 | 1 | evidence/task-1.8-token-usage.txt §5 (offline usage-source probe) |
| 7 | 2026-10-18 14:42 | opencode-go/nonexistent-model | none | no | `hi` | 2 | 1 | evidence/probe-agents-md-and-skill-activation.txt §1 (R4 exploration; the unreadable-AGENTS.md run) |
| 8 | 2026-10-18 14:47 | opencode-go/nonexistent-model | none | no | `hi` | 2 | 1 | evidence/probe-agents-md-and-skill-activation.txt §1 row A (flag set) |
| 9 | 2026-10-18 14:48 | opencode-go/nonexistent-model | none | no | `hi` | 2 | 1 | evidence/probe-agents-md-and-skill-activation.txt §1 row B (no flag) |
| 10 | 2026-10-18 14:49 | opencode-go/nonexistent-model | none | no | `hi` | 2 | 1 | evidence/probe-agents-md-and-skill-activation.txt §1 row D (flag + `instructions` entry) |

Live row count: **2** (rows 4 and 5). Within the NFR-4 budget of 2.

Go quota around the two live prompts (owner reading of the Go
quota, before and after):

- Monthly quota used: 90.79623% before, 90.79700% after.
- 5-hour quota used: 0.0000433% before, 0.00387% after.

`opencode-go/beam-free` is not in `harness/go-pricing.json`. The
model is **not proven free**. The quota movement shows the cost
was very small.

Host refresh value: `equal=true` before versus after prompt 1,
and `equal=true` before prompt 1 versus after prompt 2
(evidence/task-1.1-headless-run.txt §4). The value itself is not
recorded.

## 9. Spec corrections

Phase 1 confirmed these differences from `spec.md`:

1. Established fact "`opencode auth export`/`import` … Both accept
   `--standalone`": wrong for v2.0.32. The flag parser rejects
   `--standalone` for the `auth` subcommand
   (evidence/task-1.3-1.4-credential.txt §6).
2. FR-1 variant: open question O1 is fixed. The run adds no
   `#variant`; `score.json` records `default`.
3. FR-1 tools: O2 is fixed (deny `websearch`) and O3 is fixed
   (deny `subagent`; the subagent usage is not in the parent event
   stream, evidence/task-1.8-token-usage.txt §3).
4. FR-3 delivery: the import inside the container runs without
   `--standalone` on the empty isolated store.
5. FR-3 rotation step 1: v2.0.32 has no refresh trigger without a
   prompt. The harness never forces a host refresh. The window
   check runs twice: once in the batch preflight and again before
   each agent run. Both stops are fail-closed with the same
   reason line (section 2.2 of this note).
6. FR-4 helper supply: the harness ships the static musl ripgrep
   15.1.0; the host distro `rg` does not run in the image
   (evidence/task-1.7-container-runtime.txt §9).
7. FR-5 identity: the identity adds the `helpers` field for the
   `rg` record (section 3.1 of this note).
8. FR-7 usage source: the parser reads the session export
   (`info.tokens`), not the event stream alone. The event stream
   can lack the final step's usage
   (evidence/task-1.8-token-usage.txt §1.3, §6).
9. FR-4 config source: `OPENCODE_CONFIG` adds a document and does
   not suppress the XDG directory source. The isolation is the
   empty private XDG tmpfs directory plus
   `OPENCODE_DISABLE_PROJECT_CONFIG=1`. The preflight checks
   that the private config directory holds no document
   (evidence/probe-config-source-and-arm-configs.txt §3).
10. FR-2 preflight: `opencode models` with the imported
    credential lists the `opencode-go/*` ids, with and without
    `OPENCODE_DISABLE_MODELS_FETCH=1`, each in a fresh container
    with the flag set from the first command
    (evidence/probe-stdin-import-and-models-fetch.txt §7).
11. FR-3 stdin delivery: `opencode auth import` with no file
    argument reads the container stdin and prints
    "Imported 1 credential"
    (evidence/probe-stdin-import-and-models-fetch.txt §2).
12. FR-4 Arm B instruction loading: with
    `OPENCODE_DISABLE_PROJECT_CONFIG=1` set in both arms, project
    `AGENTS.md` discovery is off, so the Arm B generated config
    adds `instructions: ["/workspace/AGENTS.md"]`. The fixture
    `AGENTS.md` stays in the candidate tree; the workspace mount
    carries it. Proven by the watcher probe
    (evidence/probe-agents-md-and-skill-activation.txt §1, §2).
    This corrects the FR-4 config-content line "no
    `instructions`" and the arm-difference lines of the spec.
13. FR-4 arm difference: the two configs differ in the skill
    rules, the Arm B `skills.paths` entry, and the Arm B
    `instructions` entry. The arms differ in the config, the
    skill mounts, and the candidate `AGENTS.md` presence. This
    corrects the spec sentence "The two configs differ only in
    the skill rules" (review A NR5).
14. FR-4 skill probe: `GET /api/skill` does not list the mounted
    skills in any form tried. The no-prompt skill probe for task
    4.2 is `POST /api/experimental/session/{id}/skill` with
    `resume: null` (review A R1;
    evidence/probe-agents-md-and-skill-activation.txt §3).

The corrected `spec.md` carries these changes. Unproven items that
stay open: the container refresh path (task 4.3 or later), the
timeout-kill exit code (Phase 2 fake), the non-zero export
totals (task 4.3), the tool-call-time enforcement of the deny
rules and the model-visible absence of the built-in skills in
Arm A (task 4.3; the open contract risk of section 1.5), and the
`.measure-install` drift of the host `measure` skill folder
(spec line 144; Phase 4 by agreement, review A NR7).
