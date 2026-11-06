#!/usr/bin/env bash
# Console credential helper for the OpenCode executor (FR-3).
#
# Source: `opencode auth export` on the host. The helper never reads
# a credential file and never prints a token value except the access-only
# container payload that `export` writes on stdout.
#
#   seed          Internal: copy the Console credential of the shared store
#                 into the job store of the job folder. One read of the shared
#                 store per job folder. Nothing on stdout. Exit 0, or 2 on a
#                 failure.
#   export        Access-only Console payload on stdout, one JSON array, one
#                 line (JSON.stringify(payload) + "\n"). Exit 0, or 2 on any
#                 selection or expiry failure.
#   check-window  Nothing when the credential covers the run window
#                 (AGENT_TIMEOUT + 900 s). One reason line and exit 3 when it
#                 does not. Exit 2 when the export itself is invalid.
#   warn          One warning line when the credential expires within seven
#                 days, nothing otherwise. Exit 0 always.
#   preflight     Internal: one export drives both the weekly warning line and
#                 the run-window check, so a batch preflight costs one
#                 `auth export` call in the normal case. Exit 3 with the reason
#                 line on failure.
#   scan-values   Internal: the credential values the runner scans run output
#                 for (access, orgID), one per line. Exit 0/2.
#
# The helper uses the job store of the job folder (spec D4). Only the seed
# reads the shared store. The seed runs once per job folder. Every other mode
# runs the seed first when the job folder holds no seeded marker.
#
# The export call retries. On this host `opencode auth export` sometimes
# prints a plugin notice and no JSON. The retry rule matches the one for
# `opencode models`: three calls in total, five seconds apart. A missing
# credential never retries: it fails closed at once.
set -euo pipefail
MODE="${1:?usage: opencode-credential.sh <seed|export|check-window|warn|preflight|scan-values>}"
case "$MODE" in
  seed|export|check-window|warn|preflight|scan-values) ;;
  *) echo "unknown subcommand: $MODE" >&2; exit 2 ;;
esac
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=opencode-host.sh
source "$ROOT/harness/opencode-host.sh"
if [ -n "${BENCH_OPENCODE_BIN:-}" ]; then
  OPENCODE_BIN="$BENCH_OPENCODE_BIN"
else
  OPENCODE_BIN="$(command -v opencode || true)"
fi
if [ -z "$OPENCODE_BIN" ] || [ ! -x "$OPENCODE_BIN" ]; then
  echo "opencode binary is unavailable (set BENCH_OPENCODE_BIN or put opencode on PATH)" >&2
  exit 2
fi
AGENT_TIMEOUT="${AGENT_TIMEOUT:-3600}"
if ! [[ "$AGENT_TIMEOUT" =~ ^[0-9]+$ ]]; then
  echo "AGENT_TIMEOUT must be a non-negative integer number of seconds" >&2
  exit 2
fi
EXPORT_ATTEMPTS="${BENCH_CREDENTIAL_EXPORT_ATTEMPTS:-3}"
if ! [[ "$EXPORT_ATTEMPTS" =~ ^[1-9]$ ]]; then
  echo "BENCH_CREDENTIAL_EXPORT_ATTEMPTS must be a positive integer" >&2
  exit 2
fi
# The helper is an owner when no job folder exists. A job that owns the folder
# cleans it up when it ends. The owner sets the traps of spec D6.
opencode_host_begin credential || {
  echo "opencode-credential: the OpenCode job folder could not be made" >&2
  exit 2
}
trap 'opencode_host_cleanup' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# The export is selected and validated in one Node pass so the payload keeps
# the field order of `opencode auth export` exactly. A leading notice line
# before the JSON array is tolerated.
#
# SELECT_MODE names the mode of the selection. It is "export" for the seed
# payload and the mode of the call for every job store read.
read_selection() {
  SELECT_MODE="${SELECT_MODE:-$MODE}" AGENT_TIMEOUT="$AGENT_TIMEOUT" \
    REASON="Console credential does not cover the run window" node -e '
const fs = require("node:fs");
const mode = process.env.SELECT_MODE;
const reason = process.env.REASON;
const fail = (message) => { console.error("opencode-credential: " + message); process.exit(2); };
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end <= start) { fail("auth export did not print a JSON array"); return; }
  let data;
  try { data = JSON.parse(raw.slice(start, end + 1)); } catch { fail("auth export did not print valid JSON"); return; }
  if (!Array.isArray(data)) { fail("auth export did not print a JSON array"); return; }
  const connections = data.filter((entry) =>
    entry && entry.integrationID === "opencode" && entry.active === true);
  if (mode === "warn") {
    // The window check fails closed elsewhere; a malformed export must not
    // stop the weekly warning path.
    if (connections.length !== 1) return;
  } else if (connections.length === 0) {
    fail("no active Console (opencode) connection in the host store"); return;
  } else if (connections.length > 1) {
    fail("ambiguous: two or more active Console (opencode) connections"); return;
  }
  const connection = connections[0];
  const value = connection && connection.value;
  const expires = value ? value.expires : undefined;
  if (typeof expires !== "number" || !Number.isFinite(expires) || !Number.isInteger(expires) || expires < 0) {
    fail("Console credential expires field is missing or invalid"); return;
  }
  if (mode === "export") {
    const payload = [{ ...connection, value: { ...value, refresh: "inert" } }];
    process.stdout.write(JSON.stringify(payload) + "\n");
    return;
  }
  if (mode === "scan-values") {
    // The job store holds "inert" as the refresh value. The word "inert" in a
    // transcript is no leak (spec D5).
    const values = [value.access, value.refresh, value.metadata && value.metadata.orgID]
      .filter((entry) => typeof entry === "string" && entry.length > 0 && entry !== "inert");
    for (const entry of values) process.stdout.write(entry + "\n");
    return;
  }
  const windowMs = (Number(process.env.AGENT_TIMEOUT) + 900) * 1000;
  const remainingMs = expires - Date.now();
  if (mode === "warn") {
    if (remainingMs <= 7 * 24 * 3600 * 1000) {
      process.stdout.write("WARNING: Console credential expires at " + new Date(expires).toISOString() +
        "; renew the host login with: opencode auth login\n");
    }
    return;
  }
  if (mode === "preflight" && remainingMs <= 7 * 24 * 3600 * 1000) {
    process.stdout.write("WARNING: Console credential expires at " + new Date(expires).toISOString() +
      "; renew the host login with: opencode auth login\n");
  }
  if (remainingMs < windowMs) {
    process.stdout.write(reason + "\n");
    process.exitCode = 3;
  }
});
'
}

# The seed of D4. It reads the shared store once and imports the access-only
# payload into the job store. The payload never touches a disk. The job folder
# holds the seeded marker after a successful run.
#
# The function prints the seed payload on stdout when this process performed
# the seed, and nothing when the job folder was already seeded. The calling
# mode then selects that payload instead of a second job-store read, so one
# helper process makes at most one `auth export` call. A process of an already
# seeded folder reads the job store with opencode_host_run.
seed_credential() {
  local folder="$BENCH_OPENCODE_HOME"
  if [ -f "$folder/seeded" ]; then return 0; fi
  (
    exec 8>"$folder/seed.lock" || exit 2
    flock 8 || exit 2
    if [ -f "$folder/seeded" ]; then exit 0; fi
    attempt=1
    while :; do
      rc=0
      output="$(timeout 60 env -u OPENCODE_DB OPENCODE_DISABLE_AUTOUPDATE=1 \
        BENCH_OPENCODE_JOB="$folder" "$OPENCODE_BIN" auth export --standalone opencode 2>/dev/null \
        | SELECT_MODE=export read_selection 2>&1)" || rc=$?
      if [ "$rc" -eq 0 ] && [ -n "$output" ]; then break; fi
      if [ "$rc" -ne 2 ] || [ "$attempt" -ge "$EXPORT_ATTEMPTS" ]; then
        if [ -n "$output" ]; then printf '%s\n' "$output" >&2; else
          echo "opencode-credential: the Console credential seed failed" >&2
        fi
        exit 2
      fi
      attempt=$((attempt + 1))
      sleep 5
    done
    if ! printf '%s\n' "$output" | opencode_host_run auth import --standalone > /dev/null; then
      echo "opencode-credential: the Console credential seed failed" >&2
      exit 2
    fi
    printf 'seeded\n' > "$folder/seeded"
    # The access-only payload: the refresh value is "inert" (spec D4, D5).
    printf '%s\n' "$output"
    exit 0
  )
}

if [ "$MODE" = "seed" ]; then
  # The mode `seed` prints nothing and exits 0 on success (spec D4).
  seed_credential > /dev/null || exit 2
  exit 0
fi

# Every other mode reads the job store. The seed runs first when the job folder
# holds no seeded marker. A payload of this process's own seed is selected in
# place of a second job-store read.
seed_payload="$(seed_credential)" || exit 2

# One export, one selection pass. A retryable export failure (exit 2) runs
# again. A window failure (exit 3) stops at once.
attempt=1
while :; do
  export_rc=0
  if [ -n "$seed_payload" ]; then
    printf '%s\n' "$seed_payload" | read_selection
  else
    opencode_host_run auth export --standalone opencode | read_selection
  fi || export_rc=$?
  if [ "$export_rc" -eq 0 ]; then
    exit 0
  fi
  if [ "$export_rc" -ne 2 ]; then
    exit "$export_rc"
  fi
  if [ "$MODE" = "warn" ]; then
    # The warning path never stops the weekly report.
    exit 0
  fi
  if [ "$attempt" -ge "$EXPORT_ATTEMPTS" ]; then
    exit 2
  fi
  attempt=$((attempt + 1))
  sleep 5
done
