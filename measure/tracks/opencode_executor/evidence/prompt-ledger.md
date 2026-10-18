# Prompt ledger (NFR-4) — Phase 1

Ledger for every `opencode run` command, live or not. Task 1.9
moves this table into `design.md` (the design.md ledger replaces
this file).

| # | Time (+08:00) | Model | Network | Live | Prompt text | Prompt bytes | Exit code | Evidence file |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-10-18 11:28 | opencode-go/nonexistent-model | none | no | `hi` | 2 | 1 | evidence/task-1.1-headless-run.txt §2.1 |
| 2 | 2026-10-18 11:28 | opencode-go/beam-free | none | no | `hi` | 2 | 1 | evidence/task-1.1-headless-run.txt §2.2 (timeout 20) |
| 3 | 2026-10-18 11:30 | opencode-go/beam-free | none | no | `Reply with the word OK.` | 23 | 1 | evidence/task-1.1-headless-run.txt §2.3 (import + run, --network=none) |
| 4 | 2026-10-18 11:32 | opencode-go/beam-free | slirp4netns | **yes** | `Reply with the word OK.` | 23 | 0 | evidence/live1-event-stream.redacted.json; evidence/task-1.1-headless-run.txt §3 |
| 5 | 2026-10-18 11:33 | opencode-go/beam-free | slirp4netns | **yes** | `Use the task tool once to run a subagent that replies OK. Then reply DONE.` | 74 | 0 | evidence/live2-event-stream.redacted.json; evidence/task-1.8-token-usage.txt §1.2, §3 |

Live row count: **2** (rows 4 and 5). Within NFR-4 budget (≤ 2).

O3 branch: **allow `subagent`**. The subagent's token usage is
aggregated into the parent step's `step_finish.tokens`. See
evidence/task-1.8-token-usage.txt §3.

Free-model source citation (NFR-4):
- Model: `opencode-go/beam-free` (rows 4 and 5).
- Source: `opencode models` lists the model with the suffix
  `-free`. The OpenCode Go plan (source
  `https://opencode.ai/docs/go/`) includes a free tier.
  The harness's `harness/go-pricing.json` does not list
  `beam-free` (it lists 28 other opencode-go/* models with
  non-zero rates). The pricing file documents paid models; the
  free model is covered by the Go plan's free tier.

Container setup for all 5 runs (per task 1.7):
- Image: `docker.io/library/node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3` (pinned)
- Opencode binary: read-only bind-mount at `/usr/local/bin/opencode`
- ripgrep binary: read-only bind-mount at `/usr/local/bin/rg`
- Generated config: read-only bind-mount at
  `/tmp/config/opencode/opencode.json`, selected via `OPENCODE_CONFIG`
- HOME + XDG: private tmpfs under `/tmp`
- Podman flags: `--rm --pull=never --cap-drop=ALL --security-opt=no-new-privileges --userns=keep-id`
- Access-only credential: `refresh="inert"`, fed via
  `opencode auth import /tmp/cred.json` in the container (inert
  refresh is accepted by the v2.0.32 import subcommand)

EXACT scan lines from this turn:
- `exact-scan values=6 hits=0` (raw-before.json, before prompt 1)
- `exact-scan values=6 hits=0` (raw-after.json, after prompt 1, before prompt 2)
- `exact-scan values=6 hits=0` (raw-after2.json, after prompt 2)

All three show `values>=1` (no vacuous scan) and `hits=0` (no token
leak in `measure/tracks/opencode_executor/` or
`measure/runs/opencode_executor/`).

Host refresh value (SHA-256 of the refresh token, not the value):
- Before: `3d82602539a8549c9841745d91f03e8c8560bfd99381f2fd21064286d6207c64`
- After prompt 1: `3d82602539a8549c9841745d91f03e8c8560bfd99381f2fd21064286d6207c64` (equal)
- After prompt 2: `3d82602539a8549c9841745d91f03e8c8560bfd99381f2fd21064286d6207c64` (equal)

Host Console connection: present on the host after all 5 runs
(see evidence/task-1.1-headless-run.txt §4).
