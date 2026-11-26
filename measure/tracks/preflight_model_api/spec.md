# Preflight model list from the OpenChamber API

Spec format: classic FR list. Track type: chore. Base commit: `162c7a2`.
Author model: `opencode-go/hy4-flash-free`. Lane: light.

## Summary

The batch preflight reads its model list from a stale local OpenCode binary
catalog. The catalog omits `opencode-go/hungerg-free`. The batch stops with
exit 3 before the first run. This track gives the preflight one source of
truth: the OpenChamber model API. The preflight keeps its fail-closed rule,
its retry rule, and its other checks.

## PM decision

The PM sent this decision on 2026-11-26. The order is exact.

> "PM orders: read the model list from the OpenChamber API on port 38307
> instead of the local binary. Never update the opencode binary. Never run the
> opencode CLI for the list."

The preflight must fail closed. The scored batch must start after the model
appears in the API list.

## Evidence

All facts come from files on disk and from one read-only API request on
2026-11-26. The author made the request with `python3` and `urllib`. No
`opencode` CLI call ran.

- **EV1. The current preflight.** `harness/batch.sh:351-373` holds the
  executor preflight. It checks the binary on PATH. It checks the version with
  `opencode_host_run --version`. It runs `opencode-credential.sh preflight`,
  then the pinned ripgrep check, then `opencode-credential.sh seed`. It then
  calls `opencode_host_run models --standalone` at `harness/batch.sh:362`, up
  to three times with a five-second delay. It greps the output for
  `FIRST_MODEL_REF` and exits 3 when the ref is absent.
- **EV2. The block.** `reports/batch-hungerg-free-2026w48.log` shows
  `PINNED MODEL hungerg-free`, then this line:
  `executor preflight failed: opencode models does not list opencode-go/hungerg-free`.
  The batch exited 3. No agent run started.
- **EV3. The API payload.** `GET http://127.0.0.1:38307/api/model` returned
  `{"location": {"directory": ...}, "data": [...]}` with 470 entries. The entry
  for `opencode-go/hungerg-free` has `status: "active"` and `enabled: true`.
  The entry for `opencode-go/hy4-flash-free` has the same two values. All 470
  entries carry `status: "active"` and `enabled: true`. Each usable entry holds
  `providerID` and `modelID` as strings.
- **EV4. The test home.** `harness/tests/meta/opencode-credential.test.ts`
  holds `batch preflight rejects a short credential before the first run
  directory`. The new test file goes beside it in `harness/tests/meta/`.
- **EV5. The other served list.** `harness/cron-daily.sh:472` calls
  `opencode_host_run models --standalone` to build the served list. This track
  does not edit that file. A follow-up must give that call the same source.

## Requirements

### FR1 — The API model list

The preflight takes the model list from the OpenChamber API. The environment
variable `BENCH_MODEL_API_BASE` sets the base URL. The default base URL is
`http://127.0.0.1:38307`. One small helper script in `harness/` performs the
read. The helper prints one `providerID/modelID` ref per line. The helper
prints no other text on stdout.

### FR2 — The fail-closed model check

The preflight accepts `FIRST_MODEL_REF` only when the API lists the same
`providerID` and `modelID` and the entry is not disabled. An entry is not
disabled when `enabled` is boolean `true` and `status` is the string `active`.
The preflight retries a transient helper failure up to three times. It waits
five seconds between attempts. A reachable API without the ref stops the batch
with exit 3 and this message:
`executor preflight failed: the model API does not list <ref>`. An unreachable
API after three failed attempts stops the batch with exit 3 and a distinct
message. The preflight never skips the check.

### FR3 — The changed call only

The preflight never calls `opencode_host_run models`. The binary presence
check, the `opencode_host_run --version` check, the ripgrep check, the
`opencode-credential.sh preflight` call, and the `opencode-credential.sh seed`
call stay unchanged.

### FR4 — The test seam

`BENCH_MODEL_API_BASE` can name a local JSON file or a local fake server. A
test needs no real API. A test needs no real `opencode` call for the list.

## Decisions

- **D1. The helper.** Add `harness/model-api-refs.py`. Run it as
  `python3 -I`. The repo already uses Python helpers for JSON work.
- **D2. The base value.** When `BENCH_MODEL_API_BASE` names an existing regular
  file, the helper reads the JSON payload from that file. In every other case
  the helper treats the value as a base URL and reads `${base%/}/api/model`.
  An unset or empty value uses `http://127.0.0.1:38307`.
- **D3. The helper exit codes.** Exit 0 means a valid list was printed. An
  empty list is a valid list. Exit 2 means the fetch, the parse, or the payload
  check failed. The helper prints nothing on stdout when it exits 2. It writes
  one short reason to stderr.
- **D4. The match.** The preflight uses `grep -qFx "$FIRST_MODEL_REF"` on the
  helper output. A substring match must not pass the check.
- **D5. A disabled entry.** The helper omits an entry when `enabled` is not
  boolean `true` or `status` is not `active`. An omitted ref uses the FR2
  message for a reachable API without the model.
- **D6. The unreachable message.** The distinct message is
  `executor preflight failed: the model API is unreachable at <base>`, where
  `<base>` is the effective `BENCH_MODEL_API_BASE` value.
- **D7. The retry scope.** The retry applies only to helper exit 2. A
  successful empty list stops the retry loop at once. No environment variable
  can skip the model check.
- **D8. The test file.** Write `harness/tests/meta/preflight-model-api.test.ts`
  beside `harness/tests/meta/opencode-credential.test.ts`.
- **D9. The delay seam.** A test puts a fake `sleep` on the PATH. The fake
  records the delay argument. No test waits five real seconds.
- **D10. The daily follow-up.** `harness/cron-daily.sh` stays untouched. Its
  served-list call at line 472 needs the same source in a follow-up. The next
  track must handle that call and keep the served-list retry rule.

## Acceptance criteria

- **AC1.** The preflight reads the model list through the helper. The default
  base URL is `http://127.0.0.1:38307`. No local binary catalog supplies the
  list.
- **AC2.** The preflight accepts a ref only for an entry with the same
  `providerID` and `modelID`, with `enabled: true` and `status: "active"`.
- **AC3.** The preflight retries a transient failure up to three times with a
  five-second delay. A reachable API without the ref stops with exit 3 and the
  FR2 message. An unreachable API stops with exit 3 and the D6 message. No
  path skips the check.
- **AC4.** `harness/batch.sh` holds no `opencode_host_run models` call. The
  binary check, the version check, the ripgrep check, the credential
  preflight, and the credential seed are unchanged.
- **AC5.** A test can set `BENCH_MODEL_API_BASE` to a local JSON file or a
  local fake server. The test calls no real API and no `opencode` binary.
- **AC6.** A batch pinned to `opencode-go/hungerg-free` passes the preflight
  when the API lists that model as active and enabled.

## Out of scope

- The served list in `harness/cron-daily.sh` (D10).
- Any change to the local OpenCode binary catalog or its version.
- Any `opencode` CLI call made to read the list.
- Any push of the commit.
