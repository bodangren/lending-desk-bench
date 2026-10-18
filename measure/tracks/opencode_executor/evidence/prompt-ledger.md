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
| 6 | 2026-10-18 11:47 | opencode-go/beam-free | none | no | `Reply with the word OK.` | 23 | 1 | evidence/task-1.8-token-usage.txt §5 (offline usage-source probe) |

Live row count: **2** (rows 4 and 5). Within NFR-4 budget (≤ 2).

O3 branch: **deny `subagent`**. The subagent ran its own session.
Its token usage is not in the parent event stream. See
evidence/task-1.8-token-usage.txt §3.

Go quota around the two live prompts (owner reading of the Go
quota before and after; `opencode-go/beam-free` is not in
`harness/go-pricing.json`):

- Monthly quota used: 90.79623% before, 90.79700% after.
- 5-hour quota used: 0.0000433% before, 0.00387% after.

The model is **not proven free**. The name suffix `-free` and the
`opencode models` listing do not prove a zero price, and
`harness/go-pricing.json` does not list the model. The measured
quota movement shows the cost was very small.

Container setup for all 6 runs (per task 1.7):
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

EXACT scan lines from the earlier session:
- `exact-scan values=6 hits=0` (raw-before.json, before prompt 1)
- `exact-scan values=6 hits=0` (raw-after.json, after prompt 1, before prompt 2)
- `exact-scan values=6 hits=0` (raw-after2.json, after prompt 2)

All three show `values>=1` (no vacuous scan) and `hits=0` (no token
leak in `measure/tracks/opencode_executor/` or
`measure/runs/opencode_executor/`). The raw input files lived only
in the deleted temporary folder.

Host refresh value (compared inside the credential frame; the
strategy prints only `equal=true` or `equal=false`):
- Before prompt 1 versus after prompt 1: `equal=true`
- Before prompt 1 versus after prompt 2: `equal=true`

Host Console connection: present on the host after all 6 runs
(see evidence/task-1.1-headless-run.txt §4).
