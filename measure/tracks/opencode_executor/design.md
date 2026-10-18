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

### 1.2 Podman flags

```
podman run --rm --pull=never --read-only
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=512m
  --cap-drop=ALL
  --security-opt=no-new-privileges
  --userns=keep-id
  --network slirp4netns:allow_host_loopback=false
```

(evidence/task-1.7-container-runtime.txt §2; `--read-only` is the
existing `harness/run.sh` hardening.)

### 1.3 Container environment

- `HOME=/tmp/home`, `XDG_CONFIG_HOME=/tmp/config`,
  `XDG_DATA_HOME=/tmp/data`, `XDG_STATE_HOME=/tmp/state`,
  `XDG_CACHE_HOME=/tmp/cache` (evidence/task-1.7-container-runtime.txt §2).
- The entry script pre-creates these directories before the agent
  starts (evidence/task-1.7-container-runtime.txt §2, §7).
- `OPENCODE_CONFIG=/tmp/config/opencode/opencode.json` selects the
  generated config as the only config source.
  `OPENCODE_DISABLE_PROJECT_CONFIG=1` is the belt-and-braces switch.
  (evidence/task-1.5-isolation-and-config.txt §3.)
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
| OpenCode binary | `/usr/local/bin/opencode` | ro |
| Static `rg` binary | `/usr/local/bin/rg` | ro |
| Entry script `harness/opencode-entry.sh` | its container path | ro |
| Generated config | `/tmp/config/opencode/opencode.json` | ro |
| Arm B only: per-run skill snapshot | a discovered skills path | ro |

(evidence/task-1.7-container-runtime.txt §7; section 5 of this
note; spec FR-4.) The container never mounts a host home, a host
dotfile tree, `harness/`, or sibling runs (spec FR-4).

### 1.5 Config source and content

- Mechanism: `OPENCODE_CONFIG` points at the generated per-run
  config file. OpenCode loads that file and no other
  (evidence/task-1.5-isolation-and-config.txt §3).
- Content: no secret, no MCP server, no plugin, no `instructions`
  (spec FR-4). Permission rules:
  - deny `question` and deny `websearch` (O2),
  - deny `subagent` (O3),
  - Arm A: deny `skill *`;
  - Arm B: deny `skill *`, then allow the five IDs `measure`,
    `next-best-practices`, `vercel-react-best-practices`,
    `vercel-composition-patterns`, `build-graph`.
  (evidence/task-1.1-headless-run.txt §1;
  evidence/task-1.6-skill-path-and-arm-proof.txt §2, §4.)
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
- The host login survives: the refresh value compares
  `equal=true` before and after both prompts, and the host
  `auth.json` stays byte-identical
  (evidence/task-1.1-headless-run.txt §4; section 8 of this note).

### 2.2 Selected FR-3 run-window option (fail closed)

The batch preflight reads `expires` from the export. When
`expires` is earlier than now plus the run window
(`AGENT_TIMEOUT` plus 900 s), the preflight stops the batch
before any agent run. The reason line is "Console credential does
not cover the run window" (spec FR-3, NFR-6). The harness never
forces a host refresh: v2.0.32 has no refresh trigger without a
prompt. The weekly report prints a warning when `expires` is
within 7 days of the next Sunday. The operator renews the login
interactively with `opencode auth login` on the host.

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
`candidate_contract_schema`, `cohort_id`). The `executor` field
becomes the identity of section 3.1, and
`execution_identity_sha256` hashes it. `executor-cohort.json`
keeps its role: a frozen copy of the executor evidence for one
run. New execution files join the runner hash list: the entry
script, the credential helper, and the new usage parser (spec
FR-5).

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

The entry script runs `opencode session export <sessionID>` inside
the container after `opencode run` returns, and writes the JSON to
the run artifacts. The sessionID comes from the event stream. The
new parser reads `info.tokens` (whole-session totals) and
`info.cost`. Evidence: the offline probe
(evidence/task-1.8-token-usage.txt §5, §6;
evidence/offline-session-export.redacted.json). The store holds
the totals in the `session_v2` row of `opencode.db`
(`tokens_input`, `tokens_output`, `tokens_reasoning`,
`tokens_cache_read`, `tokens_cache_write`, `cost`). The message
rows hold no tokens.

### 4.4 Mapping to the `Usage` shape

```
info.tokens.input        →  input
info.tokens.output       →  output
info.tokens.reasoning    →  counted as output (spec FR-7)
info.tokens.cache.read   →  cacheRead
info.tokens.cache.write  →  cacheWrite
info.cost                →  costUsd (advisory)
```

`harness/usage.ts` parses the Pi transcript today. FR-7 needs a
new OpenCode parser for the export JSON, plain or `.gz` (spec
FR-7; evidence/task-1.8-token-usage.txt §4). The event stream
stays as a cross-check. Subagents are denied (O3), so the parser
needs no subagent mapping (evidence/task-1.8-token-usage.txt §3).

Open item for task 4.3: the offline probe proves the field shape
on a zero-token session. The first live smoke run confirms the
non-zero totals. Phase 2 tests each candidate source (task 2.5).

## 5. Helper supply method (task 1.7)

- The built-in `grep` tool needs ripgrep
  (evidence/task-1.7-container-runtime.txt §4.1).
- Source of the `rg` binary: the official ripgrep 15.1.0 release
  asset `ripgrep-15.1.0-x86_64-unknown-linux-musl.tar.gz`
  (static-pie ELF, SHA-256
  `ebeaf56f8a25e102e9419933423738b3a2a613a444fd749d695e15eba53f71f2`).
  The host distro `rg` does not run in the image: it needs
  `GLIBC_2.39`, the image is Debian 12 (glibc 2.36)
  (evidence/task-1.7-container-runtime.txt §9).
- Supply method: the harness keeps the static binary at
  `harness/vendor/rg`, copies it into the per-run artifact tree,
  and Podman bind-mounts it read-only at `/usr/local/bin/rg`.
  The noexec `/tmp` stays. The download path of the binary is
  never taken at run time
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
   prompt. The harness never forces a host refresh. The preflight
   stops the batch fail-closed when `expires` does not cover the
   run window (section 2.2 of this note).
6. FR-4 helper supply: the harness ships the static musl ripgrep
   15.1.0; the host distro `rg` does not run in the image
   (evidence/task-1.7-container-runtime.txt §9).
7. FR-5 identity: the identity adds the `helpers` field for the
   `rg` record (section 3.1 of this note).
8. FR-7 usage source: the parser reads the session export
   (`info.tokens`), not the event stream alone. The event stream
   can lack the final step's usage
   (evidence/task-1.8-token-usage.txt §1.3, §6).

The corrected `spec.md` carries these changes. Unproven items that
stay open: the container refresh path (task 4.3 or later), the
timeout-kill exit code (Phase 2 fake), and the non-zero export
totals (task 4.3).
