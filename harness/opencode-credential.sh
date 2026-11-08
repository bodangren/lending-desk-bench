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
# prints a plugin notice and no JSON. The seed retry rule is spec D16: up to
# N = waits + 1 calls, with the waits of BENCH_CREDENTIAL_SEED_DELAYS between
# calls (default 5 15 30 60 seconds). The job-store read loop keeps its own
# rule of three calls in total, five seconds apart.
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
# cleans it up when it ends. The owner sets the traps of spec D6. The cleanup
# and sweep lines of the helper go to stderr (check-1.3 F4): the export mode
# must hold only the JSON payload on stdout, because a direct
# `tsx go-cost.ts --catalog` parses the whole stdout with JSON.parse.
opencode_host_begin credential >&2 || {
  echo "opencode-credential: the OpenCode job folder could not be made" >&2
  exit 2
}
trap 'opencode_host_cleanup >&2' EXIT
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

# The seed of D4 and the back-off of D16. It reads the shared store and
# imports the access-only payload into the job store. The payload never
# touches a disk. The job folder holds the seeded marker after a successful
# run.
#
# The seed makes up to N = waits + 1 calls of the D3 export order, with the
# waits of BENCH_CREDENTIAL_SEED_DELAYS between calls. The stderr of each
# `opencode` call goes to a mode-600 file in the tmp/ subfolder of the job
# folder; the helper tests it only for the fixed reason texts and removes it
# after each call. The stdout and the stderr text of `opencode` never reach
# a terminal.
#
# The function prints the seed payload on stdout when this process performed
# the seed, and nothing when the job folder was already seeded. The calling
# mode then selects that payload instead of a second job-store read, so one
# helper process makes at most one `auth export` call. A process of an already
# seeded folder reads the job store with opencode_host_run.
seed_credential() {
  local folder="$BENCH_OPENCODE_HOME" delays
  delays="${BENCH_CREDENTIAL_SEED_DELAYS:-5 15 30 60}"
  if ! [[ "$delays" =~ ^[0-9]+( [0-9]+)*$ ]]; then
    echo "BENCH_CREDENTIAL_SEED_DELAYS must be a list of whole seconds" >&2
    return 2
  fi
  local -a seed_waits
  read -r -a seed_waits <<< "$delays"
  local seed_total=$(( ${#seed_waits[@]} + 1 ))
  if [ -f "$folder/seeded" ]; then return 0; fi
  (
    exec 8>"$folder/seed.lock" || exit 2
    flock 8 || exit 2
    if [ -f "$folder/seeded" ]; then exit 0; fi
    seed_err_file="$folder/tmp/seed-export.$$.err"
    seed_sel_file="$folder/tmp/seed-select.$$.err"
    mkdir -p "$folder/tmp"
    attempt=1
    while :; do
      ( umask 077; : > "$seed_err_file"; : > "$seed_sel_file" )
      op_rc=0
      # Spec D3 fallback order (diagnosis d91ede6): the first order
      # `auth export --standalone opencode` failed in the task-2.1 preflight
      # with the runtime line "Location plugins did not finish activating" on
      # each of the 3 retries, while `auth export opencode --standalone`
      # exited 0 against the shared store. The stderr goes to the file, never
      # to a terminal (spec D16).
      seed_stdout="$(timeout 60 env -u OPENCODE_DB OPENCODE_DISABLE_AUTOUPDATE=1 \
        BENCH_OPENCODE_JOB="$folder" "$OPENCODE_BIN" auth export opencode --standalone 2>"$seed_err_file")" || op_rc=$?
      sel_rc=0
      seed_output=""
      if [ "$op_rc" -eq 0 ]; then
        seed_output="$(printf '%s\n' "$seed_stdout" | SELECT_MODE=export read_selection 2>"$seed_sel_file")" || sel_rc=$?
      fi
      if [ "$op_rc" -eq 0 ] && [ "$sel_rc" -eq 0 ] && [ -n "$seed_output" ]; then
        rm -f "$seed_err_file" "$seed_sel_file"
        break
      fi
      echo "opencode-credential: seed attempt $attempt/$seed_total failed: $(seed_reason "$op_rc")" >&2
      rm -f "$seed_err_file" "$seed_sel_file"
      # A failed `opencode` call retries until N calls (spec D16). A selection
      # failure means the shared store holds no usable credential, so it fails
      # closed at once (the fail-closed rule for a missing credential, D4).
      if [ "$op_rc" -ne 0 ] && [ "$attempt" -lt "$seed_total" ]; then
        sleep "${seed_waits[$((attempt - 1))]}"
        attempt=$((attempt + 1))
        continue
      fi
      echo "opencode-credential: the Console credential seed failed" >&2
      exit 2
    done
    if ! printf '%s\n' "$seed_output" | opencode_host_run auth import --standalone > /dev/null; then
      echo "opencode-credential: the Console credential seed failed" >&2
      exit 2
    fi
    printf 'seeded\n' > "$folder/seeded"
    # The access-only payload: the refresh value is "inert" (spec D4, D5).
    printf '%s\n' "$seed_output"
    exit 0
  )
}

# The reason of one failed seed call (spec D16, the ordered list). op_rc is the
# `opencode` exit status; the two err files hold the stderr of the `opencode`
# call and of the selection pass. The files are read, never printed.
seed_reason() {
  local op_rc="$1"
  if [ "$op_rc" -eq 124 ]; then printf 'timeout'
  elif grep -q "did not finish activating" "$seed_err_file" 2>/dev/null; then printf 'plugins did not finish activating'
  elif grep -q "ServiceUnavailableError" "$seed_err_file" 2>/dev/null; then printf 'service unavailable'
  elif [ "$op_rc" -ne 0 ]; then printf 'exit %s' "$op_rc"
  elif grep -q "no active Console" "$seed_sel_file" 2>/dev/null; then printf 'no active Console connection'
  else printf 'no JSON array'
  fi
}

if [ "$MODE" = "seed" ]; then
  # The mode `seed` prints nothing and exits 0 on success (spec D4).
  seed_credential > /dev/null || exit 2
  exit 0
fi

# Every other mode reads the job store. The seed runs first when the job folder
# holds no seeded marker. A payload of this process's own seed is selected in
# place of a second job-store read.
if [ "$MODE" = "warn" ]; then
  # The warning path never stops the weekly report (check-1.3 F6): a seed
  # failure changes nothing. The mode below then reads the job store, and a
  # read failure still exits 0.
  seed_payload="$(seed_credential)" || seed_payload=""
else
  seed_payload="$(seed_credential)" || exit 2
fi

# One export, one selection pass. A retryable export failure (exit 2) runs
# again. A window failure (exit 3) stops at once.
attempt=1
while :; do
  export_rc=0
  if [ -n "$seed_payload" ]; then
    printf '%s\n' "$seed_payload" | read_selection
  else
    opencode_host_run auth export opencode --standalone | read_selection
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
