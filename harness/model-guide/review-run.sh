#!/usr/bin/env bash
# The review runner of the model guide (spec D10, D13, D14, D15, D22; FR-11;
# plan task 4.7).
#
# Usage:
#   harness/model-guide/review-run.sh --route <route> --set <set_id> \
#     --private <dir> [--date <YYYY-MM-DD>]
#
# `--route`, `--set`, and `--private` are required. `--private` defaults to
# `$HOME/.local/share/lending-desk-bench/model-guide`. `--date` defaults to
# today in UTC.
#
# The runner refuses, with one line `review-run: <check>` on stdout and exit
# 2, a flag without a value, a `--set` value that is not a plain id, a
# `--route` value with a parent segment, a route that `routes.json` does not
# hold, a route whose `kind` is not `plan` or `free`, a bad wait value, and a
# set with no diff. A refusal starts no job, makes no call, and writes no
# pass record.
#
# It holds one exclusive lock for one route, one set, and one date, before the
# pass number and before any call (ADV-R-8). A second run that finds the lock
# held exits 2 with one line on stderr that names the lock. It makes no call
# and writes no pass record. The trap releases the lock on every exit path.
# The lock name, the output folder, and the pass record name carry the first
# 12 hex characters of the SHA-256 of the full route string, so two routes
# that fold to one slug stay apart (ADV-R-13, ADV-R-14).
#
# Every other run writes one pass record in the private folder. Its `state`
# is `complete`, `open`, `wait`, or `region-blocked`. The record holds
# `set_id`, `route`, `pass`, `date`, `state`, `diffs`, `outputs`, and
# `errors`; it holds no `complete` field and no `rank` field.
#
# The rules of spec D15: the pass starts only when the quota state is
# `ready` (every window below 70 %). The pass stops when a window reaches
# 80 %. A route with no quota source runs at most 1 pass per night, and it
# stops at the first quota or limit error.
#
# The rules of spec D14: the job folder comes from `opencode_host_begin`, and
# the trap of `opencode_host_cleanup` removes it. The seed copies the
# credential of the route provider only. Each call is
# `run --standalone --format json --model <route>` with the job store, the
# job config that denies every tool, and the prompt on stdin. Each raw output
# is scanned for the credential values of the provider before it is stored;
# a hit deletes the output and stops the pass.
#
# The rules of spec D22: a Go route (`opencode-go/...`) that returns the
# region error ends the pass with the state `region-blocked`, one stored
# error line, no raw output, and no retry.
#
# Environment seams: `BENCH_QUOTA_BASE` (quota.ts), `MG_CALL_TIMEOUT_S`
# (default 600), and `MG_RUN_RETRY_WAIT_MS` (default 5000, a whole number; a
# bad value is refused). The runner reads no real home folder, sends no
# packet off the loopback interface, and writes in the private folder and
# the job folder only.
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUIDE="$ROOT/harness/model-guide"
ROUTES_FILE="$GUIDE/routes.json"
PROMPT_FILE="$GUIDE/review-prompt.md"
QUOTA_TOOL="$GUIDE/quota.ts"
CREDENTIAL_HELPER="$GUIDE/provider-credential.sh"

if [ -n "${BENCH_OPENCODE_BIN:-}" ]; then
  OPENCODE_BIN="$BENCH_OPENCODE_BIN"
else
  OPENCODE_BIN="$(command -v opencode || true)"
fi

refuse() {
  echo "review-run: $1"
  exit 2
}

ROUTE=""
SET_ID=""
PRIVATE="${HOME:-}/.local/share/lending-desk-bench/model-guide"
DATE="$(date +%F)"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --route|--set|--private|--date)
      [ "$#" -ge 2 ] || refuse "$1 needs a value"
      case "$1" in
        --route) ROUTE="$2" ;;
        --set) SET_ID="$2" ;;
        --private) PRIVATE="$2" ;;
        --date) DATE="$2" ;;
      esac
      shift 2
      ;;
    *)
      refuse "unknown flag $1"
      ;;
  esac
done

[ -n "$ROUTE" ] || refuse "--route is required"
[ -n "$SET_ID" ] || refuse "--set is required"
[ -n "$PRIVATE" ] || refuse "--private is required"

case "$SET_ID" in
  *..*) refuse "the set id holds a parent segment" ;;
esac
if ! [[ "$SET_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  refuse "the set id is not a plain id"
fi
case "$ROUTE" in
  *..*) refuse "the route value holds a parent segment" ;;
esac
if ! [[ "$DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  refuse "the date is not YYYY-MM-DD"
fi

MG_CALL_TIMEOUT="${MG_CALL_TIMEOUT_S:-600}"
if ! [[ "$MG_CALL_TIMEOUT" =~ ^[0-9]+$ ]]; then
  refuse "MG_CALL_TIMEOUT_S must be a whole number of seconds"
fi
MG_RETRY_WAIT="${MG_RUN_RETRY_WAIT_MS:-5000}"
if ! [[ "$MG_RETRY_WAIT" =~ ^[0-9]+$ ]]; then
  refuse "MG_RUN_RETRY_WAIT_MS must be a whole number of milliseconds"
fi
RETRY_WAIT_SECONDS="$(printf '%d.%03d' $((MG_RETRY_WAIT / 1000)) $((MG_RETRY_WAIT % 1000)))"

# The route row of `routes.json`: kind, quota provider, quota source.
[ -f "$ROUTES_FILE" ] || refuse "routes.json is missing"
route_rc=0
route_row="$(node -e '
const fs = require("node:fs");
const [file, route] = process.argv.slice(1);
let doc;
try { doc = JSON.parse(fs.readFileSync(file, "utf8")); } catch { process.exit(4); }
const list = Array.isArray(doc) ? doc : (doc && Array.isArray(doc.routes) ? doc.routes : []);
const row = list.find((entry) => entry && entry.route === route);
if (!row) process.exit(3);
const field = (value) => (typeof value === "string" ? value : "");
process.stdout.write([field(row.kind), field(row.quota_provider), field(row.quota_source)].join("\t"));
' "$ROUTES_FILE" "$ROUTE")" || route_rc=$?
case "$route_rc" in
  0) ;;
  3) refuse "the route is not in routes.json" ;;
  *) refuse "routes.json is unreadable" ;;
esac
IFS=$'\t' read -r ROUTE_KIND QUOTA_PROVIDER QUOTA_SOURCE <<< "$route_row"
case "$ROUTE_KIND" in
  plan|free) ;;
  *) refuse "the route kind is not plan or free: $ROUTE_KIND" ;;
esac

# The tools of the run.
TSX=""
for candidate in "$ROOT/harness/node_modules/.bin/tsx" "$ROOT/node_modules/.bin/tsx"; do
  if [ -x "$candidate" ]; then TSX="$candidate"; break; fi
done
if [ -z "$TSX" ]; then TSX="$(command -v tsx || true)"; fi
[ -n "$TSX" ] || refuse "tsx is unavailable"
[ -f "$QUOTA_TOOL" ] || refuse "quota.ts is missing"
[ -x "$CREDENTIAL_HELPER" ] || refuse "provider-credential.sh is missing"
[ -f "$PROMPT_FILE" ] || refuse "review-prompt.md is missing"
if [ -z "$OPENCODE_BIN" ] || [ ! -x "$OPENCODE_BIN" ]; then
  refuse "the opencode binary is unavailable"
fi

# The page path of the run.
mkdir -p "$PRIVATE" || refuse "the private folder could not be made"
SET_DIR="$PRIVATE/sets/$SET_ID"
if [ ! -d "$SET_DIR/src" ]; then
  refuse "the set has no src folder"
fi
shopt -s nullglob
DIFF_PATHS=("$SET_DIR/src"/*.diff)
shopt -u nullglob
[ "${#DIFF_PATHS[@]}" -gt 0 ] || refuse "the set has no diff"

RUN_SLUG="$(printf '%s' "$ROUTE" | tr -cs 'A-Za-z0-9._-' '-')"
# Two different routes can fold to one slug, for example `t/one#c` and
# `t-one#c`. The first 12 hex characters of the SHA-256 of the full route
# string keep each route apart (ADV-R-13).
ROUTE_TAG="$(printf '%s' "$ROUTE" | sha256sum | cut -c1-12)"

JOB=""
JOB_CONFIG=""
DIFF_LIST=""
OUTPUT_LIST=""
ERROR_LIST=""
OUT_DIR=""
STATE="complete"
STOP=0
LOCKED=0

on_exit() {
  if [ "${BENCH_OPENCODE_HOST_OWNER:-0}" = "1" ]; then
    opencode_host_cleanup >&2 || true
  fi
  if [ "$LOCKED" = "1" ]; then
    flock -u 9 2>/dev/null || true
    exec 9>&-
  fi
  rm -f "${TMP_VALUES:-}" "${TMP_QUOTA_ERR:-}" "${TMP_QUOTA_ERR:-}.line" 2>/dev/null || true
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# The exclusive lock of one route, one set, and one date (ADV-R-8). It comes
# before the pass number and before any call. A second run that finds the
# lock held exits 2 with one line on stderr and writes no pass record.
LOCK_DIR="$PRIVATE/.locks"
mkdir -p "$LOCK_DIR" || refuse "the lock folder could not be made"
LOCK_FILE="$LOCK_DIR/review-${SET_ID}-${RUN_SLUG}-${ROUTE_TAG}-${DATE}.lock"
if ! : >> "$LOCK_FILE" 2>/dev/null; then
  refuse "the lock file could not be made"
fi
exec 9>>"$LOCK_FILE"
if ! flock -n 9; then
  echo "review-run: the lock for route $ROUTE, set $SET_ID, date $DATE is held" >&2
  exit 2
fi
LOCKED=1

PASS_DIR="$PRIVATE/passes/$SET_ID"
PASS_NO=1
if [ -d "$PASS_DIR" ]; then
  existing="$(find "$PASS_DIR" -maxdepth 1 -name "*-${RUN_SLUG}-${ROUTE_TAG}-p*.json" 2>/dev/null | wc -l | tr -d ' ')"
  PASS_NO=$(( existing + 1 ))
fi
PASS_FILE="$PASS_DIR/${DATE}-${RUN_SLUG}-${ROUTE_TAG}-p${PASS_NO}.json"

# Spec D15: a route with no quota source runs at most 1 pass per night.
if [ -z "$QUOTA_PROVIDER" ] && [ -d "$PASS_DIR" ]; then
  tonight="$(find "$PASS_DIR" -maxdepth 1 -name "${DATE}-${RUN_SLUG}-${ROUTE_TAG}-p*.json" 2>/dev/null | wc -l | tr -d ' ')"
  [ "$tonight" -eq 0 ] || refuse "the route allows one pass per night and one pass already ran"
fi

TMP_ROOT="${TMPDIR:-/tmp}"
mkdir -p "$TMP_ROOT" 2>/dev/null || true
TMP_VALUES="$TMP_ROOT/mg-review-values.$$"
TMP_QUOTA_ERR="$TMP_ROOT/mg-review-quota-err.$$"
( umask 077; : > "$TMP_VALUES"; : > "$TMP_QUOTA_ERR" )

# Prints the state, the cap, and the highest window of the quota read.
read_quota() {
  QUOTA_STATE="ready"
  QUOTA_CAP=1
  QUOTA_MAX=""
  QUOTA_REASON=""
  if [ -z "$QUOTA_PROVIDER" ]; then return 0; fi
  local out rc=0 parsed
  out="$("$TSX" "$QUOTA_TOOL" --provider "$QUOTA_PROVIDER" 2>"$TMP_QUOTA_ERR")" || rc=$?
  if [ "$rc" -ne 0 ] || [ -z "$out" ]; then
    QUOTA_STATE="stopped"
    QUOTA_CAP=3
    QUOTA_REASON="the quota tool failed"
    return 0
  fi
  parsed="$(printf '%s' "$out" | node -e '
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  const line = raw.split(/\r?\n/).map((entry) => entry.trim()).find((entry) => entry.startsWith("{"));
  if (!line) process.exit(1);
  let doc;
  try { doc = JSON.parse(line); } catch { process.exit(1); }
  const values = Object.values(doc.windows || {}).filter((value) => typeof value === "number" && Number.isFinite(value));
  const max = values.length === 0 ? "" : String(Math.max(...values));
  process.stdout.write([String(doc.state || ""), String(doc.cap ?? ""), max].join("\t"));
})' 2>/dev/null)" || parsed=""
  if [ -z "$parsed" ]; then
    QUOTA_STATE="stopped"
    QUOTA_CAP=3
    QUOTA_REASON="the quota answer did not parse"
    return 0
  fi
  IFS=$'\t' read -r QUOTA_STATE QUOTA_CAP QUOTA_MAX <<< "$parsed"
  if [ "$QUOTA_STATE" = "stopped" ]; then
    QUOTA_REASON="$(head -n 1 "$TMP_QUOTA_ERR" 2>/dev/null || true)"
    [ -n "$QUOTA_REASON" ] || QUOTA_REASON="the quota source stopped"
  fi
  return 0
}

# Writes the one pass record of the run.
write_record() {
  local state="$1"
  mkdir -p "$PASS_DIR" || refuse "the pass folder could not be made"
  node -e '
const fs = require("node:fs");
const [file, set, route, pass, date, state, diffs, outputs, errors] = process.argv.slice(1);
const list = (text) => text.split("\n").filter((line) => line !== "");
const doc = {
  set_id: set,
  route,
  pass: Number(pass),
  date,
  state,
  diffs: list(diffs),
  outputs: list(outputs),
  errors: list(errors),
};
fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
' "$PASS_FILE" "$SET_ID" "$ROUTE" "$PASS_NO" "$DATE" "$state" "$DIFF_LIST" "$OUTPUT_LIST" "$ERROR_LIST"
}

# The first quota read of the pass (spec D15).
read_quota
if [ "$QUOTA_STATE" = "wait" ]; then
  write_record "wait"
  exit 0
fi
if [ "$QUOTA_STATE" = "stopped" ]; then
  ERROR_LIST="quota: $QUOTA_REASON"
  write_record "open"
  exit 0
fi

# The job folder of spec D14.
# shellcheck source=../opencode-host.sh
source "$ROOT/harness/opencode-host.sh"
if ! opencode_host_begin model-guide >&2; then
  refuse "the job folder could not be made"
fi
JOB="$BENCH_OPENCODE_HOME"
JOB_CONFIG="$JOB/opencode.json"
printf '%s\n' '{"permission":{"read":"deny","edit":"deny","bash":"deny","webfetch":"deny","websearch":"deny","question":"deny","subagent":"deny","skill":"deny"}}' > "$JOB_CONFIG"

# The seed of the route provider only. A failure stops the run before any
# model call (spec D14).
if ! "$CREDENTIAL_HELPER" seed "$QUOTA_PROVIDER" > /dev/null; then
  refuse "the provider credential seed failed"
fi

# Runs one model call with the job store of `opencode_host_run`.
run_model_call() {
  local diff_path="$1" raw_path="$2" err_path="$3" rc=0
  cat "$PROMPT_FILE" "$diff_path" | timeout --kill-after=1 "$MG_CALL_TIMEOUT" \
    env -u OPENCODE_DB \
      HOME="$JOB/home" \
      XDG_CONFIG_HOME="$JOB/config" \
      XDG_DATA_HOME="$JOB/data" \
      XDG_STATE_HOME="$JOB/state" \
      XDG_CACHE_HOME="$JOB/cache" \
      XDG_RUNTIME_DIR="$JOB/runtime" \
      TMPDIR="$JOB/tmp" \
      OPENCODE_DISABLE_AUTOUPDATE=1 \
      OPENCODE_CONFIG="$JOB_CONFIG" \
      BENCH_OPENCODE_JOB="$JOB" \
      "$OPENCODE_BIN" run --standalone --format json --model "$ROUTE" \
      > "$raw_path" 2> "$err_path" || rc=$?
  return "$rc"
}

# 0: a value of the provider was found. 1: no value. 2: the scan failed.
scan_output() {
  local file="$1" raw_values
  raw_values="$("$CREDENTIAL_HELPER" scan-values "$QUOTA_PROVIDER" 2>/dev/null)" || return 2
  printf '%s\n' "$raw_values" | grep -v '^[[:space:]]*$' > "$TMP_VALUES" || true
  [ -s "$TMP_VALUES" ] || return 1
  if grep -F -q -f "$TMP_VALUES" "$file"; then return 0; fi
  return 1
}

# The region error of spec D22. It applies to a Go route only.
is_region_error() {
  local err_path="$1"
  case "$ROUTE" in
    opencode-go/*) ;;
    *) return 1 ;;
  esac
  grep -qiE 'not available in your region|not supported in your region' "$err_path" 2>/dev/null
}

DIFF_LIST=""
for diff_path in "${DIFF_PATHS[@]}"; do
  diff_id="${diff_path##*/}"
  diff_id="${diff_id%.diff}"
  DIFF_LIST="${DIFF_LIST}${DIFF_LIST:+$'\n'}${diff_id}"

  # The quota read before each diff (spec D15). The pass stops at 80 %.
  read_quota
  if [ "$QUOTA_STATE" = "stopped" ]; then
    ERROR_LIST="${ERROR_LIST}${ERROR_LIST:+$'\n'}quota: $QUOTA_REASON"
    STATE="open"
    STOP=1
    break
  fi
  if [ -n "$QUOTA_MAX" ] && [ "$(printf '%s\n' "$QUOTA_MAX" | awk '{ print ($1 >= 80) ? 1 : 0 }')" = "1" ]; then
    ERROR_LIST="${ERROR_LIST}${ERROR_LIST:+$'\n'}quota: a window reached 80 %"
    STATE="open"
    STOP=1
    break
  fi

  if [ -z "$OUT_DIR" ]; then
    OUT_DIR="$PRIVATE/outputs/$SET_ID/${DATE}-${RUN_SLUG}-${ROUTE_TAG}-p${PASS_NO}"
    mkdir -p "$OUT_DIR" || refuse "the output folder could not be made"
  fi
  STAGING="$OUT_DIR/.incoming-${diff_id}"
  ERR_FILE="$OUT_DIR/.incoming-${diff_id}.err"

  attempt=1
  call_rc=1
  stored=""
  while [ "$attempt" -le 3 ]; do
    call_rc=0
    run_model_call "$diff_path" "$STAGING" "$ERR_FILE" || call_rc=$?
    # An empty answer is no response (spec D13), not a model result.
    if [ "$call_rc" -eq 0 ] && [ ! -s "$STAGING" ]; then
      call_rc=125
    fi
    if [ "$call_rc" -eq 0 ]; then
      break
    fi
    if is_region_error "$ERR_FILE"; then
      error_line="$(head -n 1 "$ERR_FILE" 2>/dev/null || true)"
      [ -n "$error_line" ] || error_line="the model is not available in your region"
      rm -f "$STAGING" "$ERR_FILE"
      ERROR_LIST="${ERROR_LIST}${ERROR_LIST:+$'\n'}${error_line}"
      STATE="region-blocked"
      STOP=1
      break 2
    fi
    rm -f "$STAGING" "$ERR_FILE"
    if [ "$attempt" -lt 3 ]; then
      sleep "$RETRY_WAIT_SECONDS"
      attempt=$(( attempt + 1 ))
      continue
    fi
    ERROR_LIST="${ERROR_LIST}${ERROR_LIST:+$'\n'}transport error on ${diff_id} after 3 calls"
    STATE="open"
    STOP=1
    break 2
  done

  if [ "$STOP" -eq 1 ]; then break; fi
  if [ "$call_rc" -ne 0 ]; then
    STATE="open"
    STOP=1
    break
  fi

  # The scan of spec D14, before the output is stored.
  scan_rc=0
  scan_output "$STAGING" || scan_rc=$?
  if [ "$scan_rc" -eq 2 ]; then
    rm -f "$STAGING" "$ERR_FILE"
    ERROR_LIST="${ERROR_LIST}${ERROR_LIST:+$'\n'}the credential value scan failed on ${diff_id}"
    echo "review-run: the credential value scan failed on ${diff_id}; the pass stops"
    STATE="open"
    STOP=1
    break
  fi
  if [ "$scan_rc" -eq 0 ]; then
    rm -f "$STAGING" "$ERR_FILE"
    ERROR_LIST="${ERROR_LIST}${ERROR_LIST:+$'\n'}a credential value was found in the raw output of ${diff_id}"
    echo "review-run: a credential value was found in the raw output of ${diff_id}; the pass stops"
    STATE="open"
    STOP=1
    break
  fi
  stored="$OUT_DIR/${diff_id}.txt"
  mv "$STAGING" "$stored"
  rm -f "$ERR_FILE"
  OUTPUT_LIST="${OUTPUT_LIST}${OUTPUT_LIST:+$'\n'}${stored}"
done

write_record "$STATE"
exit 0
