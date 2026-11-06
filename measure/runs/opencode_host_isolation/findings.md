# Findings of spec D12 — out of scope for opencode_host_isolation, one per line

- F1: `harness/tests/meta/run-executor-provenance.test.ts:52` expects provenance
  schema 6 and executor schema 1 (now 7 and 2), and `:115` expects a missing
  `execution-identity.json`.
- F2: `harness/tests/meta/runtime-isolation-completion.test.ts:316` expects
  `probe_pi_mounted: true`, but Pi is removed.
- F3: `harness/tests/meta/runtime-isolation.test.ts:17` — the container probe
  environment held host provider keys (`OPENCODE_API_KEY`, `XIAOMI_API_KEY`)
  of the calling session.
- F4: `harness/tests/meta/runtime-isolation.test.ts:248` — the real grade
  server probe exited 4 on 2026-11-06.
- F5: the stale `~/.local/state/opencode/service.json` of spec EV2; its removal
  is a human gate (Daniel).
- F6: the shared `~/.local/share/opencode/opencode.db` holds 7.1 GB; its
  clean-up is a human gate (Daniel).
- F7: `harness/execution-identity.ts:124` runs `<path> --version` for an agent
  identity; it stays unchanged because no production path reaches it (spec EV8).
