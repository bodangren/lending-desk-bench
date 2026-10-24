#!/usr/bin/env bash
# Console credential helper for the OpenCode executor (FR-3).
#
# Source: `opencode auth export opencode` on the host. The helper never reads
# a credential file and never prints a token value except the access-only
# container payload that `export` writes on stdout.
#
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
#                 for (access, refresh, orgID), one per line. Exit 0/2.
#
# The export call retries. On this host `opencode auth export` sometimes
# prints a plugin notice and no JSON. The retry rule matches the one for
# `opencode models`: three calls in total, five seconds apart. A missing
# credential never retries: it fails closed at once.
set -euo pipefail
MODE="${1:?usage: opencode-credential.sh <export|check-window|warn|preflight|scan-values>}"
case "$MODE" in
  export|check-window|warn|preflight|scan-values) ;;
  *) echo "unknown subcommand: $MODE" >&2; exit 2 ;;
esac
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

# The export is selected and validated in one Node pass so the payload keeps
# the field order of `opencode auth export` exactly. A leading notice line
# before the JSON array is tolerated.
read_selection() {
  MODE="$MODE" AGENT_TIMEOUT="$AGENT_TIMEOUT" \
    REASON="Console credential does not cover the run window" node -e '
const fs = require("node:fs");
const mode = process.env.MODE;
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
    const values = [value.access, value.refresh, value.metadata && value.metadata.orgID]
      .filter((entry) => typeof entry === "string" && entry.length > 0);
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

# One export, one selection pass. A retryable export failure (exit 2) runs
# again. A window failure (exit 3) stops at once.
attempt=1
while :; do
  export_rc=0
  "$OPENCODE_BIN" auth export opencode 2>/dev/null | read_selection || export_rc=$?
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
