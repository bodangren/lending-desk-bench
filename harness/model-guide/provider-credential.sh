#!/usr/bin/env bash
# The credential helper of the review routes (spec D14; plan task 4.6).
#
#   provider-credential.sh seed <provider>
#   provider-credential.sh scan-values <provider>
#
# `seed` reads the shared store with one `opencode auth export` call, retried
# on a transient failure with the waits of `BENCH_CREDENTIAL_SEED_DELAYS`
# (default `5 15 30 60`), and imports the one active entry whose `provider`
# field is `<provider>` into the job store with `opencode auth import`. The
# payload goes over the pipe of the import call; it never touches a disk.
# stdout is empty.
#
# `scan-values` reads the job store, selects the entry of `<provider>`, and
# prints its values, one per line: the access value, then the metadata
# orgID. It prints no `inert` line and no value of another provider. The
# runner scans each raw output with these values before it stores the output.
#
# Every error is one line on stderr `provider-credential: <reason>` and exit
# 2. stdout holds no error text and no credential value, except the values of
# `scan-values`. The helper reads the job folder that the runner started with
# `opencode_host_begin`; it never starts one. The helper writes no credential
# value into any file (spec D14).
set -euo pipefail

MODE="${1:-}"
PROVIDER="${2:-}"
if [ "$MODE" != "seed" ] && [ "$MODE" != "scan-values" ]; then
  echo "provider-credential: the mode must be seed or scan-values" >&2
  exit 2
fi
if [ -z "$PROVIDER" ]; then
  echo "provider-credential: no provider" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=../opencode-host.sh
source "$ROOT/harness/opencode-host.sh"

refuse() {
  echo "provider-credential: $1" >&2
  exit 2
}

if [ -z "${BENCH_OPENCODE_HOME:-}" ] || [ ! -d "$BENCH_OPENCODE_HOME" ]; then
  refuse "no job folder: start one with opencode_host_begin"
fi
FOLDER="$BENCH_OPENCODE_HOME"
if [ -n "${BENCH_OPENCODE_BIN:-}" ]; then
  OPENCODE_BIN="$BENCH_OPENCODE_BIN"
else
  OPENCODE_BIN="$(command -v opencode || true)"
fi
if [ -z "$OPENCODE_BIN" ] || [ ! -x "$OPENCODE_BIN" ]; then
  refuse "the opencode binary is unavailable"
fi

# The two environment values are checked before any `opencode` call, so a bad
# value cannot reach `sleep` or `timeout` (test-strategy R8 and C5).
AGENT_TIMEOUT="${AGENT_TIMEOUT:-3600}"
if ! [[ "$AGENT_TIMEOUT" =~ ^[0-9]+$ ]]; then
  refuse "AGENT_TIMEOUT must be a non-negative integer number of seconds"
fi
SEED_DELAYS="${BENCH_CREDENTIAL_SEED_DELAYS:-5 15 30 60}"
if ! [[ "$SEED_DELAYS" =~ ^[0-9]+( [0-9]+)*$ ]]; then
  refuse "BENCH_CREDENTIAL_SEED_DELAYS must be a list of whole seconds"
fi
read -r -a SEED_WAITS <<< "$SEED_DELAYS"
SEED_ATTEMPTS=$(( ${#SEED_WAITS[@]} + 1 ))

mkdir -p "$FOLDER/tmp"
ERR_FILE="$FOLDER/tmp/provider-credential-export.$$.err"
SEL_FILE="$FOLDER/tmp/provider-credential-select.$$.err"
IMPORT_ERR_FILE="$FOLDER/tmp/provider-credential-import.$$.err"
cleanup() {
  rm -f "$ERR_FILE" "$SEL_FILE" "$IMPORT_ERR_FILE"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
( umask 077; : > "$ERR_FILE"; : > "$SEL_FILE"; : > "$IMPORT_ERR_FILE" )

# One `opencode` call of the job store. The environment of the call points
# every path at the job folder, the same as `opencode_host_run`.
run_opencode() {
  timeout "$AGENT_TIMEOUT" env -u OPENCODE_DB \
    HOME="$FOLDER/home" \
    XDG_CONFIG_HOME="$FOLDER/config" \
    XDG_DATA_HOME="$FOLDER/data" \
    XDG_STATE_HOME="$FOLDER/state" \
    XDG_CACHE_HOME="$FOLDER/cache" \
    XDG_RUNTIME_DIR="$FOLDER/runtime" \
    TMPDIR="$FOLDER/tmp" \
    OPENCODE_DISABLE_AUTOUPDATE=1 \
    BENCH_OPENCODE_JOB="$FOLDER" \
    "$OPENCODE_BIN" "$@"
}

# One selection pass over the export on stdin. The mode names the answer:
# `seed` writes the one-entry payload of the import, `scan` writes the values
# of the entry, one per line. A selection failure writes its reason to SEL_FILE
# and exits 3; the reason text is never printed.
SELECT_JS='
const fail = (message) => { process.stderr.write(message + "\n"); process.exit(3); };
const provider = process.env.MG_PROVIDER || "";
const mode = process.env.MG_MODE || "";
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end <= start) fail("auth export did not print a JSON array");
  let data;
  try { data = JSON.parse(raw.slice(start, end + 1)); } catch { fail("auth export did not print valid JSON"); }
  if (!Array.isArray(data)) fail("auth export did not print a JSON array");
  const active = data.filter((entry) =>
    entry && typeof entry === "object" && entry.provider === provider && entry.active === true);
  if (active.length === 0) fail("the store holds no active entry of provider " + provider);
  const entry = active[0];
  const value = entry.value;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("the entry of provider " + provider + " holds no value");
  }
  if (mode === "seed") {
    // The job store holds the access value only; the refresh value is inert
    // (spec D14, the same rule as the Console credential helper).
    process.stdout.write(JSON.stringify([{ ...entry, value: { ...value, refresh: "inert" } }]) + "\n");
    return;
  }
  const usable = (text) => typeof text === "string" && text !== "" && text !== "inert";
  const lines = [];
  if (usable(value.access)) lines.push(value.access);
  const metadata = value.metadata;
  if (metadata && typeof metadata === "object" && usable(metadata.orgID)) lines.push(metadata.orgID);
  for (const line of lines) process.stdout.write(line + "\n");
});
'

# The seed: up to N = waits + 1 calls of `auth export`, with the waits of
# SEED_DELAYS between calls. It prints the one-entry payload on stdout.
read_seed_payload() {
  local attempt=1 rc sel_rc out payload
  while :; do
    rc=0
    out="$(run_opencode auth export 2>"$ERR_FILE")" || rc=$?
    sel_rc=0
    payload=""
    if [ "$rc" -eq 0 ]; then
      payload="$(printf '%s\n' "$out" | MG_PROVIDER="$PROVIDER" MG_MODE=seed node -e "$SELECT_JS" 2>"$SEL_FILE")" || sel_rc=$?
    fi
    if [ "$rc" -eq 0 ] && [ "$sel_rc" -eq 0 ] && [ -n "$payload" ]; then
      printf '%s\n' "$payload"
      return 0
    fi
    # A non-zero exit, an empty answer, and a selection pass that names no
    # JSON array are the transient classes. A selection failure that names a
    # fixed state of the store fails closed after this call.
    local retry=0
    if [ "$rc" -ne 0 ]; then
      retry=1
    elif [ "$sel_rc" -ne 0 ] && grep -q "did not print" "$SEL_FILE" 2>/dev/null; then
      retry=1
    elif [ "$sel_rc" -eq 0 ] && [ -z "$payload" ]; then
      retry=1
    fi
    if [ "$retry" -eq 1 ] && [ "$attempt" -lt "$SEED_ATTEMPTS" ]; then
      sleep "${SEED_WAITS[$((attempt - 1))]}"
      attempt=$(( attempt + 1 ))
      continue
    fi
    return 2
  done
}

if [ "$MODE" = "seed" ]; then
  payload="$(read_seed_payload)" || refuse "the credential seed failed"
  if ! printf '%s\n' "$payload" | run_opencode auth import > /dev/null 2>"$IMPORT_ERR_FILE"; then
    refuse "the credential import failed"
  fi
  exit 0
fi

# scan-values reads the job store and prints the values of one entry.
rc=0
out="$(run_opencode auth export 2>"$ERR_FILE")" || rc=$?
if [ "$rc" -ne 0 ]; then
  refuse "the job store read failed"
fi
sel_rc=0
values="$(printf '%s\n' "$out" | MG_PROVIDER="$PROVIDER" MG_MODE=scan node -e "$SELECT_JS" 2>"$SEL_FILE")" || sel_rc=$?
if [ "$sel_rc" -ne 0 ]; then
  refuse "the store holds no entry of provider $PROVIDER"
fi
if [ -n "$values" ]; then
  printf '%s\n' "$values"
fi
exit 0
