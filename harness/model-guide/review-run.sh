#!/usr/bin/env bash
# The review runner of the model guide (spec D10, D13, D14, D15, D22; FR-11;
# plan task 4.7).
#
# Usage:
#   harness/model-guide/review-run.sh --route <route> --set <set_id> \
#     --private <dir> [--date <YYYY-MM-DD>] [--probe]
#
# `--route`, `--set`, and `--private` are required. `--private` defaults to
# `$HOME/.local/share/lending-desk-bench/model-guide`. `--date` defaults to
# the local date. `--probe` runs the probe mode of spec D14 (PM 2026-11-18).
#
# The runner refuses, with one line `review-run: <check>` on stdout and exit
# 2, a flag without a value, a `--set` value that is not a plain id, a
# `--route` value with a parent segment, a route that `routes.json` does not
# hold, a route whose `kind` is not `plan` or `free`, a bad wait value, a set
# with no diff, and a diff with no message file. A refusal starts no job,
# makes no call, and writes no pass record.
#
# The message line of the prompt (spec D10 ruling 2026-11-18, task 4.13f
# B3/B4): the file `<private>/sets/<set_id>/messages/<diff_id>.txt` holds
# one line: the first line of the commit message of the source commit. A
# message file with a second line, a control character, a line over 1000
# bytes, or a link is a refusal, and so is a seeded diff that is a link. A
# refusal gives exit 2, one `review-run:` line on stdout, no call, and no
# pass record.
#
# The prompt of a call holds three parts in this order: `review-prompt.md`,
# the checked message line, and the seeded diff. The runner sends the
# checked line only, so a file with more text never reaches the model. The
# runner reads `diffs/` and `messages/` only; it never reads `src/`.
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
# `set_id`, `route`, `pass`, `date`, `state`, `diffs`, `outputs`, `errors`,
# `tokens`, and `tokens_complete`; it holds no `complete` field and no `rank`
# field. Each entry of `diffs` holds its `id` and its own `tokens` object.
#
# The token log of spec D13 (PM 2026-11-18, task 4.13w): the runner reads
# each token event of the json output. It reads the real
# `{"type":"step_finish",...,"part":{...,"tokens":...}}` event of the
# installed bundle, and it keeps the old
# `{"type":"step-finish","tokens":...}` event working. The tokens object
# holds `input`, `output`, `reasoning`, `cache.read`, and `cache.write`. The
# record holds the flat sums of every event with `total` equal to the sum of
# the five parts. A call with no token field adds 0 and sets
# `tokens_complete` false, and so does a token field that is not a number.
#
# Probe mode of spec D14 (PM 2026-11-18): `--probe` makes exactly one call on
# the first control diff of the set. A control diff is the first diff whose
# key holds no plant. The probe writes one record under
# `<private>/probes/<set_id>/` and no pass record and no raw output. It
# prints one line `<route> reachable|unreachable|region-blocked <error line
# or ->` on stdout and exits 0 for `reachable` and 3 for the two error
# states. A probe blocked by the quota rule or by the credential scan is
# a refusal: exit 2 with one `review-run:` line on stdout, no call, and no
# record. A held lock follows the lock refusal: exit 2 with one line on
# stderr.
#
# The rules of spec D15: the pass starts only when the quota state is
# `ready`. For every source but the Go plan, `ready` means every window is
# below 70 %, and the pass stops when a window reaches 80 %. For the Go plan
# (`quota_provider` `opencode-go`, PM 2026-11-19), `ready` means the 5h window
# is below 95 % and the weekly window is below 100 %. The pass stops at those
# same thresholds, and it never stops at 80 %. A route with no quota source
# runs at most 1 pass per night, and it stops at the first quota or limit
# error. The refusal of a second pass of the same date prints one line on
# stderr that starts `review-run:` and exits 2, with no call and no pass
# record.
#
# The rules of spec D14: the job folder comes from `opencode_host_begin`, and
# the trap of `opencode_host_cleanup` removes it. The seed copies the
# credential of the route provider only. Each call is
# `run --standalone --format json --model <route>` with the job store, the
# job config that denies every tool, and the prompt on stdin. Each raw output
# is scanned for the credential values of the provider before it is stored;
# a hit deletes the output and stops the pass.
#
# The live-server path of spec D14 (PM 2026-11-20, task 4.16): a pilot
# route reaches the model through one bench session on the OpenChamber API
# at BENCH_SERVER_BASE instead. The runner creates one session per call
# with the job root and the route model, sends the D10 prompt in a
# message, and reads the answer from the session messages. It makes no
# DELETE request, no seed call, and no auth call, and it scans the stored
# text for known key shapes. The probe lines, the exit codes, the record
# shapes, and the quota rules stay unchanged. A message send or wait past
# MG_CALL_TIMEOUT_S stops the call with one `review-run:` line and no
# pass record.
#
# The rules of spec D22: a Go route (`opencode-go/...`) that returns the
# region error ends the pass with the state `region-blocked`, one stored
# error line, no raw output, and no retry.
#
# Environment seams: `BENCH_QUOTA_BASE` (quota.ts), `BENCH_SERVER_BASE`
# (the live-server path, task 4.16), `MG_CALL_TIMEOUT_S`
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

# The folder of the checked message lines. The runner sends these lines, so
# the model never reads a second line of a message file.
MESSAGE_STAGE_DIR=""

# Removes the folder of the checked message lines. The trap calls it on
# every exit path, and a refusal calls it before the trap is armed.
drop_message_stage() {
  if [ -n "$MESSAGE_STAGE_DIR" ]; then
    rm -rf "$MESSAGE_STAGE_DIR" 2>/dev/null || true
    MESSAGE_STAGE_DIR=""
  fi
}

refuse() {
  drop_message_stage
  echo "review-run: $1"
  exit 2
}

# One line on stdout and exit 2: a probe refusal (spec D14 probe mode).
probe_refuse() {
  echo "review-run: the probe refused: $1"
  exit 2
}

# Prints the flat token sums of one raw output and a completeness flag:
# input<TAB>output<TAB>reasoning<TAB>cache_read<TAB>cache_write<TAB>0|1.
# It reads the token events of the output (spec D13, Tokens). Two shapes
# count: the old `{"type":"step-finish","tokens":{...}}` event, and the real
# `{"type":"step_finish",...,"part":{...,"tokens":{...}}}` event of the
# installed bundle (task 4.13w, Review A 2fdb8f8). A token field counts only
# when it is a non-negative safe integer, and any other value clears the flag
# (task 4.13y, Review B N17). A `step_finish` event with no tokens object
# clears the flag too (Review C N3). The sums cover every valid field of
# every matched event, and the flag is 1 only when all five fields count.
read_tokens() {
  local file="$1" out
  out="$(node -e '
const fs = require("node:fs");
let raw = "";
try { raw = fs.readFileSync(process.argv[1], "utf8"); } catch { raw = ""; }
const sum = { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 };
let seen = 0;
let complete = 1;
const isToken = (value) => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
const num = (value) => isToken(value) ? value : 0;
const object = (value) => (value && typeof value === "object" && !Array.isArray(value)) ? value : null;
for (const line of raw.split(/\r?\n/)) {
  const text = line.trim();
  if (!text.startsWith("{")) continue;
  let event;
  try { event = JSON.parse(text); } catch { continue; }
  if (!event) continue;
  let tokenEvent = false;
  let tokens = null;
  if (event.type === "step-finish") {
    tokenEvent = true;
    tokens = object(event.tokens);
  } else if (event.type === "step_finish") {
    tokenEvent = true;
    const part = object(event.part);
    tokens = part ? object(part.tokens) : null;
  }
  // The session message shape of the live-server path (task 4.16, spec
  // D14): one line holds a `parts` array with text, result, and
  // step_finish entries. Both token event shapes count, the same rule
  // as the event stream above.
  if (Array.isArray(event.parts)) {
    for (const entry of event.parts) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      if (entry.type !== "step-finish" && entry.type !== "step_finish") continue;
      tokenEvent = true;
      const bundle = object(entry.tokens);
      if (!bundle) { complete = 0; continue; }
      seen += 1;
      const entryCache = object(bundle.cache);
      if (!isToken(bundle.input)) complete = 0;
      if (!isToken(bundle.output)) complete = 0;
      if (!isToken(bundle.reasoning)) complete = 0;
      if (!entryCache || !isToken(entryCache.read) || !isToken(entryCache.write)) complete = 0;
      sum.input += num(bundle.input);
      sum.output += num(bundle.output);
      sum.reasoning += num(bundle.reasoning);
      if (entryCache) {
        sum.cache_read += num(entryCache.read);
        sum.cache_write += num(entryCache.write);
      }
    }
    continue;
  }
  if (!tokenEvent) continue;
  if (!tokens) { complete = 0; continue; }
  seen += 1;
  const cache = object(tokens.cache);
  if (!isToken(tokens.input)) complete = 0;
  if (!isToken(tokens.output)) complete = 0;
  if (!isToken(tokens.reasoning)) complete = 0;
  if (!cache || !isToken(cache.read) || !isToken(cache.write)) complete = 0;
  sum.input += num(tokens.input);
  sum.output += num(tokens.output);
  sum.reasoning += num(tokens.reasoning);
  if (cache) {
    sum.cache_read += num(cache.read);
    sum.cache_write += num(cache.write);
  }
}
// A field sum above 2^53 is no longer exact, so the flag clears even when
// every added field counted (task 4.15, Review B N27). A sum of exactly
// 2^53 - 1 still counts (ADV-P4C T1).
for (const key of ["input", "output", "reasoning", "cache_read", "cache_write"]) {
  if (!Number.isSafeInteger(sum[key])) complete = 0;
}
process.stdout.write([sum.input, sum.output, sum.reasoning, sum.cache_read, sum.cache_write, (seen > 0 && complete === 1) ? 1 : 0].join("\t"));
' "$file" 2>/dev/null)" || out=""
  if [[ "$out" =~ ^[0-9]+$'\t'[0-9]+$'\t'[0-9]+$'\t'[0-9]+$'\t'[0-9]+$'\t'[01]$ ]]; then
    printf '%s\n' "$out"
  else
    printf '0\t0\t0\t0\t0\t0\n'
  fi
}

ROUTE=""
SET_ID=""
PRIVATE="${HOME:-}/.local/share/lending-desk-bench/model-guide"
DATE="$(date +%F)"
PROBE=0
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
    --probe)
      PROBE=1
      shift
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

# The quota rule of the route (spec D15, PM 2026-11-19). The Go plan holds
# the provider `opencode-go`. It waits at 95 % of the 5h window or 100 % of
# the weekly window, and a pass stops at those same thresholds. Every other
# source waits at 70 % of any window, and a pass stops at 80 %. The Go rule
# keys on `quota_provider`, the one field quota.ts reads (task 4.13j N1).
GO_QUOTA_PROVIDER="opencode-go"
IS_GO_ROUTE=0
QUOTA_WAIT_TEXT="a window is 70 % or more"
QUOTA_STOP_TEXT="a window reached 80 %"
if [ "$QUOTA_PROVIDER" = "$GO_QUOTA_PROVIDER" ]; then
  IS_GO_ROUTE=1
  QUOTA_WAIT_TEXT="the 5h window reached 95 % or the weekly window reached 100 %"
  QUOTA_STOP_TEXT="the 5h window reached 95 % or the weekly window reached 100 %"
fi

# The live-server path of spec D14 (PM 2026-11-20, task 4.16). The pilot
# routes reach the model through one bench session on the OpenChamber API,
# with the base URL from BENCH_SERVER_BASE only. The base must stay on the
# loopback interface. A pilot route without a base, and any non-pilot
# route, keeps the isolated path below: the seed and `opencode run`.
is_pilot_route() {
  case "$ROUTE" in
    opencode-go/deepseek-v4.1-flash|opencode-go/hy4-flash-free#high|opencode-go/mimo-v2.6-flash|opencode-go/muse-spark-1.3-contributor#high)
      return 0 ;;
  esac
  case "$ROUTE" in
    opencode/*) [ "$ROUTE_KIND" = "free" ] && return 0 ;;
  esac
  return 1
}
LIVE_PATH=0
LIVE_BASE="${BENCH_SERVER_BASE:-}"
case "$LIVE_BASE" in
  *[![:space:]]*) ;;
  *) LIVE_BASE="" ;;
esac
LIVE_BASE="${LIVE_BASE%/}"
if [ -n "$LIVE_BASE" ]; then
  case "$LIVE_BASE" in
    http://127.0.0.1:*|http://localhost:*) ;;
    *) refuse "BENCH_SERVER_BASE must stay on the loopback interface" ;;
  esac
  if is_pilot_route; then
    LIVE_PATH=1
  fi
fi
# The provider, model, and variant of the route. The session create or the
# model-set call of the live path carries all three (spec D14).
ROUTE_PROVIDER="${ROUTE%%/*}"
ROUTE_REST="${ROUTE#*/}"
ROUTE_MODEL="$ROUTE_REST"
ROUTE_VARIANT=""
case "$ROUTE_REST" in
  *#*) ROUTE_MODEL="${ROUTE_REST%%#*}"; ROUTE_VARIANT="${ROUTE_REST##*#}" ;;
esac

# The project config of the live-server path: the job root holds a project
# config that denies every tool. A missing config is written with the deny
# list of the isolated job config. A config that is missing, unreadable,
# or missing one deny is a refusal before the first call (spec D14).
# Defined before the first use below, which runs at top level (task 4.16).
live_ensure_config() {
  local file="$JOB/opencode.json" missing="" rc=0
  if [ ! -f "$file" ] && [ ! -L "$file" ]; then
    printf '%s\n' '{"permission":{"read":"deny","edit":"deny","bash":"deny","webfetch":"deny","websearch":"deny","question":"deny","subagent":"deny","skill":"deny"}}' > "$file" \
      || refuse "the project config could not be written"
  fi
  missing="$(node -e '
const fs = require("node:fs");
let doc;
try { doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { process.exit(2); }
const perm = doc && typeof doc === "object" && !Array.isArray(doc) ? doc.permission : null;
if (!perm || typeof perm !== "object" || Array.isArray(perm)) process.exit(3);
const missing = [];
for (const tool of ["read", "edit", "bash", "webfetch", "websearch", "question", "subagent", "skill"]) {
  if (perm[tool] !== "deny") missing.push(tool);
}
if (missing.length > 0) { process.stdout.write(missing.join(",")); process.exit(4); }
' "$file" 2>/dev/null)" || rc=$?
  case "$rc" in
    0) return 0 ;;
    4) refuse "the project config does not deny every tool: $missing" ;;
    *) refuse "the project config is missing or unreadable" ;;
  esac
}

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
# The live path needs no local `opencode` binary: it reaches the model
# through the live API. The isolated path keeps the check.
if [ "$LIVE_PATH" != "1" ]; then
  if [ -z "$OPENCODE_BIN" ] || [ ! -x "$OPENCODE_BIN" ]; then
    refuse "the opencode binary is unavailable"
  fi
fi

# The page path of the run.
mkdir -p "$PRIVATE" || refuse "the private folder could not be made"
SET_DIR="$PRIVATE/sets/$SET_ID"
# The review input is the seeded diff of the set (spec D7). The `src/` folder
# holds the source diffs without the plants, so the runner never sends it to
# the model. The `diffs/<diff_id>.diff` files are the input, in name order.
if [ ! -d "$SET_DIR/diffs" ]; then
  refuse "the set has no diffs folder"
fi
shopt -s nullglob
DIFF_PATHS=("$SET_DIR/diffs"/*.diff)
shopt -u nullglob
[ "${#DIFF_PATHS[@]}" -gt 0 ] || refuse "the set has no diff"

# The message line of each diff (spec D10 ruling 2026-11-18, task 4.13f
# B3/B4). The file `messages/<diff_id>.txt` holds one line: the first line of
# the commit message of the source commit of that diff. A file with a second
# line, a control character, a line over 1000 bytes, or a link is a refusal.
# A seeded diff that is a link is a refusal too.
MESSAGE_DIR="$SET_DIR/messages"
MESSAGE_STATE=""
MESSAGE_TEXT=""
MESSAGE_MAX_BYTES=1000

# The folder of the checked message lines. Each line is written there, and
# the call sends that file, so the model reads the checked line only.
MESSAGE_STAGE_DIR="${TMPDIR:-/tmp}/mg-review-msg.$$"
mkdir -p "$MESSAGE_STAGE_DIR" 2>/dev/null || refuse "the message stage folder could not be made"

# Reads the message line of one diff into MESSAGE_TEXT. It sets MESSAGE_STATE
# to `ok`, `missing`, `empty`, `a symlink`, `a second line`, `a control
# character`, or `over 1000 bytes`, and it returns 1 for the bad states.
read_message_line() {
  local diff_id="$1" file line rest bytes
  MESSAGE_TEXT=""
  file="$MESSAGE_DIR/${diff_id}.txt"
  if [ -L "$file" ]; then
    MESSAGE_STATE="a symlink"
    return 1
  fi
  if [ ! -f "$file" ]; then
    MESSAGE_STATE="missing"
    return 1
  fi
  line="$(head -n 1 "$file" 2>/dev/null || true)"
  line="${line%$'\r'}"
  # The text after the first line must be empty, so the file holds one line.
  rest="$(tail -n +2 "$file" 2>/dev/null || true)"
  if [ -n "$rest" ]; then
    MESSAGE_STATE="a second line"
    return 1
  fi
  # A control character never reaches the model. The class covers ASCII
  # controls, and the three named bytes cover the Unicode controls that
  # stay valid text under LC_ALL=C (task 4.15, Review B N21): U+202E, U+0085,
  # and U+200B.
  if [[ "$line" == *[[:cntrl:]]* ]]; then
    MESSAGE_STATE="a control character"
    return 1
  fi
  if [[ "$line" == *$'\xe2\x80\xae'* || "$line" == *$'\xc2\x85'* || "$line" == *$'\xe2\x80\x8b'* ]]; then
    MESSAGE_STATE="a control character"
    return 1
  fi
  # The count is a byte count, because the runner sets LC_ALL=C.
  bytes=${#line}
  if [ "$bytes" -gt "$MESSAGE_MAX_BYTES" ]; then
    MESSAGE_STATE="over ${MESSAGE_MAX_BYTES} bytes"
    return 1
  fi
  if [ -z "${line//[[:space:]]/}" ]; then
    MESSAGE_STATE="empty"
    return 1
  fi
  MESSAGE_STATE="ok"
  MESSAGE_TEXT="$line"
  return 0
}

# The message file of every diff of the set. A bad message file or a linked
# seeded diff is a refusal before the lock, before the quota read, and
# before any call, so the refusal leaves no call and no pass record.
for diff_path in "${DIFF_PATHS[@]}"; do
  diff_id="${diff_path##*/}"
  diff_id="${diff_id%.diff}"
  # A diff id must be a plain id, like the set id. A newline in the name
  # reaches the tab-and-newline pass record and splits the row, so the
  # runner refuses it before the lock and before any call (task 4.13t,
  # ADV-P4B-6). The message names no id, so a hostile name cannot add a
  # second line.
  case "$diff_id" in
    *..*) refuse "a diff id holds a parent segment" ;;
  esac
  if ! [[ "$diff_id" =~ ^[A-Za-z0-9._-]+$ ]]; then
    refuse "a diff id is not a plain id"
  fi
  if [ -L "$diff_path" ]; then
    refuse "the seeded diff of ${diff_id} is a symlink"
  fi
  if ! read_message_line "$diff_id"; then
    refuse "the message file of ${diff_id} is ${MESSAGE_STATE}"
  fi
  printf '%s\n' "$MESSAGE_TEXT" > "$MESSAGE_STAGE_DIR/${diff_id}.txt" \
    || refuse "the checked message line of ${diff_id} could not be written"
done

RUN_SLUG="$(printf '%s' "$ROUTE" | tr -cs 'A-Za-z0-9._-' '-')"
# Two different routes can fold to one slug, for example `t/one#c` and
# `t-one#c`. The first 12 hex characters of the SHA-256 of the full route
# string keep each route apart (ADV-R-13).
ROUTE_TAG="$(printf '%s' "$ROUTE" | sha256sum | cut -c1-12)"

JOB=""
JOB_CONFIG=""
DIFF_ROWS=()
TOKENS_ALL=1
OUTPUT_LIST=""
ERROR_LIST=""
OUT_DIR=""
STATE="complete"
STOP=0
LOCKED=0
CALL_PID=""
WATCHDOG_PID=""

# The INFRA lines of the daemon guard (plan task 4.13o): one line per
# `serve --service` process that the guard stopped under the job root.
INFRA_LIST=""

# A process is alive when it exists and is no zombie. BENCH_OPENCODE_PROC
# points the read at a fake process table (task 4.13q N3).
daemon_pid_alive() {
  local proc stat
  proc="${BENCH_OPENCODE_PROC:-/proc}"
  stat="$(cat "$proc/$1/stat" 2>/dev/null)" || return 1
  stat="${stat##*) }"
  case "$stat" in
    Z*|X*) return 1 ;;
    *) return 0 ;;
  esac
}

# The starttime of a process: field 22 of its stat line (plan task 4.13r F3).
daemon_starttime() {
  local proc stat
  proc="${BENCH_OPENCODE_PROC:-/proc}"
  stat="$(cat "$proc/$1/stat" 2>/dev/null)" || return 1
  stat="${stat##*) }"
  local -a fields
  read -r -a fields <<< "$stat"
  printf '%s\n' "${fields[19]:-}"
}

# The pids of the daemons of this run: the argv holds a `serve` token and a
# `--service` token adjacent in that order, and the process belongs to the
# job root. The `BENCH_OPENCODE_JOB` marker in the process environ names the
# owning job: when it is present it must resolve to the job root (task 4.15,
# Review A F1). A process with no marker falls back to the HOME and cwd
# check below. The cmdline is NUL separated, so the tokens are compared one
# by one; a joined substring would match a decoy such as `observe --service`
# (task 4.13t, ADV-P4B-3). The executable path never decides: the live
# daemon prints argv[0] as an absolute path outside every job root.
# Resolved paths and a path-boundary compare keep a `..` decoy and a
# sibling folder safe (task 4.13r F2). A process of another run never
# matches, so the guard never stops a process of another run.
daemon_pids() {
  local root="$1"
  node -e '
const fs = require("node:fs");
const base = String(process.argv[1]).replace(/\/+$/, "");
const proc = String(process.argv[2] || "/proc").replace(/\/+$/, "");
const real = (path) => {
  if (!path) return "";
  try { return fs.realpathSync(path); } catch { return ""; }
};
const baseReal = real(base);
const under = (path, root) => path !== "" && root !== "" && (path === root || path.startsWith(root + "/"));
const pids = [];
let names = [];
try { names = fs.readdirSync(proc); } catch { names = []; }
for (const name of names) {
  if (!/^[0-9]+$/.test(name)) continue;
  let tokens = [];
  try { tokens = fs.readFileSync(proc + "/" + name + "/cmdline", "utf8").split("\0"); } catch { continue; }
  let adjacent = false;
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    if (tokens[i] === "serve" && tokens[i + 1] === "--service") { adjacent = true; break; }
  }
  if (!adjacent) continue;
  let home = "";
  let job = "";
  try {
    for (const line of fs.readFileSync(proc + "/" + name + "/environ", "utf8").split("\0")) {
      const at = line.indexOf("=");
      const key = at === -1 ? line : line.slice(0, at);
      const value = at === -1 ? "" : line.slice(at + 1);
      if (key === "HOME") home = value;
      else if (key === "BENCH_OPENCODE_JOB") job = value;
    }
  } catch { home = ""; job = ""; }
  if (job !== "" && real(job) !== baseReal) continue;
  let cwd = "";
  try { cwd = fs.readlinkSync(proc + "/" + name + "/cwd"); } catch { cwd = ""; }
  if (!under(real(home), baseReal) && !under(real(cwd), baseReal)) continue;
  pids.push(name);
}
process.stdout.write(pids.join("\n"));
' "$root" "${BENCH_OPENCODE_PROC:-/proc}" 2>/dev/null || true
}

# The daemon guard of plan task 4.13o: it stops every daemon under the job
# root with TERM, then KILL after 5 s. Each stopped pid gives one stderr line
# and one entry of INFRA_LIST. The guard runs after each pass, each probe, and
# each judge run, and on every exit path.
stop_daemons() {
  local root="${1:-}" pids pid waited alive line now
  [ -n "$root" ] || return 0
  pids="$(daemon_pids "$root")"
  [ -n "$pids" ] || return 0
  local -A started_at=()
  for pid in $pids; do
    started_at["$pid"]="$(daemon_starttime "$pid" 2>/dev/null || true)"
    kill -TERM "$pid" 2>/dev/null || true
  done
  waited=0
  while [ "$waited" -lt 5 ]; do
    alive=0
    for pid in $pids; do
      if daemon_pid_alive "$pid"; then alive=1; break; fi
    done
    [ "$alive" = "1" ] || break
    sleep 1
    waited=$(( waited + 1 ))
  done
  # F3: a pid can be reused inside the TERM-to-KILL window. KILL only when the
  # starttime is still the one recorded at TERM. With no recorded starttime
  # the identity is unknown, so the guard sends no KILL (task 4.13t,
  # ADV-P4B-4).
  for pid in $pids; do
    if daemon_pid_alive "$pid"; then
      [ -n "${started_at[$pid]:-}" ] || continue
      now="$(daemon_starttime "$pid" 2>/dev/null || true)"
      if [ "$now" != "${started_at[$pid]}" ]; then continue; fi
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
  waited=0
  while [ "$waited" -lt 20 ]; do
    alive=0
    for pid in $pids; do
      if daemon_pid_alive "$pid"; then alive=1; break; fi
    done
    [ "$alive" = "1" ] || break
    sleep 0.1
    waited=$(( waited + 1 ))
  done
  for pid in $pids; do
    # A pid whose start time changed since TERM is a reused pid of another
    # process, so the guard logs no INFRA line for it (task 4.15, Review B
    # N9). A pid with no readable start time keeps its line: a stopped
    # daemon has no stat entry, and that is the expected outcome.
    now="$(daemon_starttime "$pid" 2>/dev/null || true)"
    if [ -n "${started_at[$pid]:-}" ] && [ -n "$now" ] && [ "$now" != "${started_at[$pid]}" ]; then
      continue
    fi
    line="review-run: INFRA stopped daemon $pid"
    echo "$line" >&2
    INFRA_LIST="${INFRA_LIST}${INFRA_LIST:+$'\n'}${line}"
  done
}

on_exit() {
  stop_daemons "$JOB"
  if [ "${BENCH_OPENCODE_HOST_OWNER:-0}" = "1" ]; then
    opencode_host_cleanup >&2 || true
  fi
  if [ -n "${WATCHDOG_PID:-}" ]; then
    kill -TERM "$WATCHDOG_PID" 2>/dev/null || true
  fi
  if [ -n "${CALL_PID:-}" ]; then
    kill -TERM "$CALL_PID" 2>/dev/null || true
  fi
  if [ "$LOCKED" = "1" ]; then
    flock -u 9 2>/dev/null || true
    exec 9>&-
  fi
  rm -f "${TMP_VALUES:-}" "${TMP_QUOTA_ERR:-}" "${TMP_QUOTA_ERR:-}.line" 2>/dev/null || true
  drop_message_stage
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

# Spec D15: a route with no quota source runs at most 1 pass per night. The
# row says "no source" with a null `quota_source`, and quota.ts gives the cap
# 1 for that row, so the guard keys on the source (task 4.9 F1). The refusal
# follows the lock refusal: exit 2, one line on stderr, and no pass record.
if [ -z "$QUOTA_SOURCE" ] && [ -d "$PASS_DIR" ]; then
  tonight="$(find "$PASS_DIR" -maxdepth 1 -name "${DATE}-${RUN_SLUG}-${ROUTE_TAG}-p*.json" 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$tonight" -ne 0 ]; then
    echo "review-run: the route allows one pass per night and one pass already ran" >&2
    exit 2
  fi
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

# Writes the one pass record of the run. Each row of DIFF_ROWS holds the diff
# id and its flat token sums; the record holds the sums and the entries
# (spec D13, Tokens, PM 2026-11-18).
write_record() {
  local state="$1" rows
  mkdir -p "$PASS_DIR" || refuse "the pass folder could not be made"
  rows="$(printf '%s\n' "${DIFF_ROWS[@]}")"
  node -e '
const fs = require("node:fs");
const [file, set, route, pass, date, state, rows, outputs, errors, complete, infraText] = process.argv.slice(1);
const list = (text) => text.split("\n").filter((line) => line !== "");
const num = (value) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
const totals = { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 };
const diffs = [];
for (const row of list(rows)) {
  const parts = row.split("\t");
  const tokens = {
    input: num(parts[1]),
    output: num(parts[2]),
    reasoning: num(parts[3]),
    cache_read: num(parts[4]),
    cache_write: num(parts[5]),
  };
  tokens.total = tokens.input + tokens.output + tokens.reasoning + tokens.cache_read + tokens.cache_write;
  for (const key of ["input", "output", "reasoning", "cache_read", "cache_write"]) totals[key] += tokens[key];
  diffs.push({ id: parts[0], tokens });
}
totals.total = totals.input + totals.output + totals.reasoning + totals.cache_read + totals.cache_write;
const doc = {
  set_id: set,
  route,
  pass: Number(pass),
  date,
  state,
  diffs,
  outputs: list(outputs),
  errors: list(errors),
  tokens: totals,
  tokens_complete: complete === "1",
};
const infra = list(infraText);
if (infra.length > 0) doc.infra = infra;
fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
' "$PASS_FILE" "$SET_ID" "$ROUTE" "$PASS_NO" "$DATE" "$state" "$rows" "$OUTPUT_LIST" "$ERROR_LIST" "$TOKENS_ALL" "$INFRA_LIST"
}

# The first quota read of the pass (spec D15). A probe blocked by the quota
# rule is a refusal, not a pass (spec D14 probe mode, PM 2026-11-18).
read_quota
if [ "$PROBE" = "1" ]; then
  if [ "$QUOTA_STATE" = "wait" ]; then
    probe_refuse "the quota state is wait: $QUOTA_WAIT_TEXT"
  fi
  if [ "$QUOTA_STATE" = "stopped" ]; then
    probe_refuse "the quota state is stopped: ${QUOTA_REASON}"
  fi
else
  if [ "$QUOTA_STATE" = "wait" ]; then
    write_record "wait"
    exit 0
  fi
  if [ "$QUOTA_STATE" = "stopped" ]; then
    ERROR_LIST="quota: $QUOTA_REASON"
    write_record "open"
    exit 0
  fi
fi

# The job folder of spec D14. The live-server path keeps the job root
# outside every git repo (spec D14): the default host folder sits under
# $ROOT/.tmp, inside the repository, so an unset BENCH_OPENCODE_HOME is
# defaulted to a fresh folder under TMPDIR. A preset value is kept as is
# (group L2 pins a preset with a refused deny). The folder survives the
# run: group L1 asserts the session directory still exists afterwards.
LIVE_JOB_CREATED=""
if [ "$LIVE_PATH" = "1" ] && [ -z "${BENCH_OPENCODE_HOME:-}" ]; then
  if ! LIVE_JOB_NEW="$(mktemp -d "${TMPDIR:-/tmp}/opencode-live-XXXXXX" 2>/dev/null)"; then
    refuse "the live job folder could not be made"
  fi
  BENCH_OPENCODE_HOME="$LIVE_JOB_NEW"
  export BENCH_OPENCODE_HOME
  LIVE_JOB_CREATED="$LIVE_JOB_NEW"
fi
# shellcheck source=../opencode-host.sh
source "$ROOT/harness/opencode-host.sh"
if ! opencode_host_begin model-guide >&2; then
  refuse "the job folder could not be made"
fi
JOB="$BENCH_OPENCODE_HOME"
JOB_CONFIG="$JOB/opencode.json"
if [ "$LIVE_PATH" = "1" ]; then
  # The live path checks the project config below, after the HOME guard.
  # It never overwrites a config that the job root already holds.
  :
else
  printf '%s\n' '{"permission":{"read":"deny","edit":"deny","bash":"deny","webfetch":"deny","websearch":"deny","question":"deny","subagent":"deny","skill":"deny"}}' > "$JOB_CONFIG"
fi

# The HOME guard of plan tasks 4.13o and 4.13r F5: every call of the run holds
# the job HOME. The one real-HOME call is the seed export inside
# provider-credential.sh. The job root must be absolute, and the two paths are
# compared after realpath resolution on a path boundary.
case "$JOB" in
  /*) ;;
  *) refuse "the job root must be an absolute path" ;;
esac
# The call paths of the job folder: HOME, and the XDG folders of the call
# (task 4.13t, ADV-P4B-5). The root resolves first, so the extracted guard
# block carries its own root. Each path must resolve inside the job root,
# so a preset folder with a symlink out of the root refuses the run.
JOB_REAL="$(realpath "$JOB" 2>/dev/null || true)"
[ -n "$JOB_REAL" ] || refuse "the job root could not be resolved"
for CALL_SUB in home config data state cache runtime tmp; do
  CALL_SUB_REAL="$(realpath -m "$JOB/$CALL_SUB" 2>/dev/null || true)"
  case "$CALL_SUB_REAL" in
    "$JOB_REAL"|"$JOB_REAL"/*) ;;
    *)
      if [ "$CALL_SUB" = "home" ]; then
        refuse "the job HOME is outside the job root"
      fi
      refuse "the job $CALL_SUB folder is outside the job root"
      ;;
  esac
  # A symlink at or below a call path leaves the job too (task 4.15,
  # Review B N10). The realpath check above covers the top level only, so
  # every level at and below the call path is walked for a link. The walk
  # stops at the first hit, so no pipe can raise SIGPIPE 141 under
  # `set -euo pipefail` (task 4.15, Review B G2).
  if [ -e "$JOB/$CALL_SUB" ] || [ -L "$JOB/$CALL_SUB" ]; then
    link_hit="$(find "$JOB/$CALL_SUB" -mindepth 0 -type l -print -quit 2>/dev/null)"
    if [ -n "$link_hit" ]; then
      refuse "the job $CALL_SUB folder holds a symlink out of the job root"
    fi
  fi
done

# The session directory is the job root, and the job root stays outside
# every git repo (spec D14). A preset root inside a repo is refused before
# the first call.
if [ "$LIVE_PATH" = "1" ] && command -v git >/dev/null 2>&1; then
  if git -C "$JOB_REAL" rev-parse --show-toplevel >/dev/null 2>&1; then
    refuse "the job root is inside a git repo"
  fi
fi

# The project config of the live-server path comes before the first call:
# the seed and the model call never run on a refused deny (spec D14).
if [ "$LIVE_PATH" = "1" ]; then
  command -v curl >/dev/null 2>&1 || refuse "curl is unavailable"
  live_ensure_config
fi

# The seed of the route provider only. A failure stops the run before any
# model call (spec D14). The refusal carries the closed-list seed reason of
# the helper (task 4.15); any other helper text keeps the bare refusal.
# The live path makes no seed and no auth call (spec D14).
if [ "$LIVE_PATH" != "1" ] && ! seed_out="$("$CREDENTIAL_HELPER" seed "$QUOTA_PROVIDER" 2>&1 > /dev/null)"; then
  seed_line="${seed_out%%$'\n'*}"
  case "$seed_line" in
    "provider-credential: the store holds no active entry of provider "*|\
    "provider-credential: the store holds two active entries of provider "*": ambiguous")
      refuse "the provider credential seed failed: ${seed_line#provider-credential: }"
      ;;
    *)
      refuse "the provider credential seed failed"
      ;;
  esac
fi

# Runs one model call with the job store of `opencode_host_run`. The call is
# a background job with a watcher. When the runner dies without its trap (for
# example on SIGKILL), the watcher stops the call, so no model call outlives
# the runner (PM load watch).
run_model_call() {
  local message_path="$1" diff_path="$2" raw_path="$3" err_path="$4" rc=0
  local parent=$$ watchdog=0
  cat "$PROMPT_FILE" "$message_path" "$diff_path" | timeout --kill-after=1 "$MG_CALL_TIMEOUT" \
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
      > "$raw_path" 2> "$err_path" &
  CALL_PID=$!
  (
    while kill -0 "$parent" 2>/dev/null; do sleep 0.2; done
    kill -TERM "$CALL_PID" 2>/dev/null || true
    sleep 1
    kill -KILL "$CALL_PID" 2>/dev/null || true
  ) &
  watchdog=$!
  WATCHDOG_PID=$watchdog
  wait "$CALL_PID" || rc=$?
  CALL_PID=""
  kill -TERM "$watchdog" 2>/dev/null || true
  WATCHDOG_PID=""
  wait "$watchdog" 2>/dev/null || true
  return "$rc"
}

# --- The live-server path (task 4.16, spec D14) ---------------------------
# The pilot routes reach the model through one bench session on the
# OpenChamber API at BENCH_SERVER_BASE. One bench session per call: the
# runner creates the session with the job root in `directory` and the
# provider, model, and variant of the route, sets the model, sends the D10
# prompt in a message, and reads the answer text and the token use from
# the session message parts. It makes no DELETE request, no seed call, and
# no auth call. The stored text is scanned for known key shapes before it
# is stored. The quota rules of D15, the probe lines and exit codes, and
# the record shapes stay unchanged.

# The project config check lives above, before the first use (task 4.16):
# live_ensure_config is defined next to the live-path route parsing.

# The HTTP code of the last live call.
LIVE_HTTP_CODE=""

# One live request with the call timeout. $1 takes the body file, $2 the
# curl error file, and the rest takes the curl arguments. Sets
# LIVE_HTTP_CODE to the HTTP code. Returns 124 on a timeout (curl exit
# 28), 0 when the request ran, and 1 when curl could not run at all.
live_curl() {
  local out="$1" err="$2"
  shift 2
  : > "$out" 2>/dev/null || return 1
  : > "$err" 2>/dev/null || return 1
  local rc=0 code="000"
  code="$(curl -sS --max-time "$MG_CALL_TIMEOUT" "$@" -o "$out" -w '%{http_code}' 2>"$err")" || rc=$?
  if [ "$rc" -eq 28 ]; then
    return 124
  fi
  if [ "$rc" -ne 0 ]; then
    return 1
  fi
  LIVE_HTTP_CODE="$code"
  return 0
}

# Creates one bench session for one call: the directory is the job root,
# and the body carries the provider, model, and variant of the route.
# Sets LIVE_SESSION to the session id. Returns 124 on a timeout and 1 on
# any other failure.
live_session_create() {
  local body="$1" out="$2" err="$3" rc=0
  node -e '
const fs = require("node:fs");
const [file, directory, provider, model, variant] = process.argv.slice(1);
fs.writeFileSync(file, JSON.stringify({ directory, provider, model, variant }) + "\n");
' "$body" "$JOB_REAL" "$ROUTE_PROVIDER" "$ROUTE_MODEL" "$ROUTE_VARIANT" 2>/dev/null || return 1
  live_curl "$out" "$err" -X POST -H 'content-type: application/json' -H "x-opencode-directory: $JOB_REAL" --data @"$body" "$LIVE_BASE/api/session" || return $?
  case "$LIVE_HTTP_CODE" in
    2*) ;;
    *) return 1 ;;
  esac
  LIVE_SESSION=""
  LIVE_SESSION="$(node -e '
const fs = require("node:fs");
let doc;
try { doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { process.exit(1); }
const data = doc && typeof doc === "object" && doc.data && typeof doc.data === "object" && !Array.isArray(doc.data) ? doc.data : doc;
const id = data && typeof data.id === "string" ? data.id : "";
if (id === "") process.exit(1);
process.stdout.write(id);
' "$out" 2>/dev/null)" || return 1
  [ -n "$LIVE_SESSION" ] || return 1
  return 0
}

# Sets the model of one bench session to the provider, model, and variant
# of the route. Returns 124 on a timeout and 1 on any other failure.
live_session_model() {
  local session="$1" body="$2" out="$3" err="$4"
  node -e '
const fs = require("node:fs");
const [file, provider, id, variant] = process.argv.slice(1);
const model = { providerID: provider, id };
if (variant !== "") model.variant = variant;
fs.writeFileSync(file, JSON.stringify({ model }) + "\n");
' "$body" "$ROUTE_PROVIDER" "$ROUTE_MODEL" "$ROUTE_VARIANT" 2>/dev/null || return 1
  live_curl "$out" "$err" -X POST -H 'content-type: application/json' -H "x-opencode-directory: $JOB_REAL" --data @"$body" "$LIVE_BASE/api/session/$session/model" || return $?
  case "$LIVE_HTTP_CODE" in
    2*) return 0 ;;
    *) return 1 ;;
  esac
}

# The region error of spec D22 on the live path. It applies to a Go route
# only, like is_region_error of the isolated path.
is_live_region_error() {
  case "$ROUTE" in
    opencode-go/*) ;;
    *) return 1 ;;
  esac
  grep -qiE 'not available in your region|not supported in your region' "$1" "$2" 2>/dev/null
}

# Sends one prompt text to one bench session. $1 takes the session id, $2
# the prompt file, $3 a body scratch file, $4 the response file, and $5
# the error file. A transport error writes the API error text as the
# first error line, so error_line_of reads it. Returns 124 on a timeout
# and 1 on any other failure.
live_send_prompt() {
  local session="$1" prompt="$2" body="$3" out="$4" err="$5" message="" rc=0
  node -e '
const fs = require("node:fs");
const [file, promptFile] = process.argv.slice(1);
fs.writeFileSync(file, JSON.stringify({ text: fs.readFileSync(promptFile, "utf8") }) + "\n");
' "$body" "$prompt" 2>/dev/null || return 1
  live_curl "$out" "$err" -X POST -H 'content-type: application/json' -H "x-opencode-directory: $JOB_REAL" --data @"$body" "$LIVE_BASE/api/session/$session/prompt" || return $?
  case "$LIVE_HTTP_CODE" in
    2*) return 0 ;;
  esac
  message="$(node -e '
const fs = require("node:fs");
let doc;
try { doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { process.exit(1); }
if (typeof doc === "string") { process.stdout.write(doc.split(/\r?\n/)[0]); return; }
const docObj = doc && typeof doc === "object" && !Array.isArray(doc) ? doc : null;
const text = docObj && typeof docObj.error === "string" ? docObj.error
  : docObj && typeof docObj.message === "string" ? docObj.message : "";
if (text === "") process.exit(1);
process.stdout.write(text.split(/\r?\n/)[0]);
' "$out" 2>/dev/null || true)"
  if [ -n "$message" ]; then
    printf '%s\n' "$message" > "$err" 2>/dev/null || true
  fi
  return 1
}

# GETs the message list of one bench session into $2, with curl errors in
# $3. Returns 124 on a timeout and 1 on any other failure.
live_get_messages() {
  local session="$1" out="$2" err="$3"
  live_curl "$out" "$err" -H "x-opencode-directory: $JOB_REAL" "$LIVE_BASE/api/session/$session/message" || return $?
  case "$LIVE_HTTP_CODE" in
    2*) return 0 ;;
    *) return 1 ;;
  esac
}

# Decodes one message list body ($1) into the synthesis event stream ($2):
# one text event with the whole answer, one result event with the whole
# result branch, and one step_finish event per token bundle. Only an
# assistant message counts, by its role or its type. The fragments of one
# answer rejoin with the empty string: the API splits streamed text at
# an arbitrary character, so one event per fragment would corrupt the JSON
# when the decoders join event texts with a newline (task 4.16, group L4).
# Prints the count of text and result parts. A forged result branch never
# wins over the text parts: the synthesis keeps both shapes apart, and the
# readers apply the text-wins rule (task 4.15, Review A N13).
live_synthesize() {
  node -e '
const fs = require("node:fs");
let doc;
try { doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { process.exit(1); }
const list = Array.isArray(doc) ? doc : (doc && typeof doc === "object" && Array.isArray(doc.data) ? doc.data : null);
if (!list) process.exit(1);
const lines = [];
const texts = [];
const results = [];
let textsCount = 0;
for (const message of list) {
  if (!message || typeof message !== "object" || Array.isArray(message)) continue;
  const assistant = (message.info && typeof message.info === "object" && message.info.role === "assistant") || message.type === "assistant";
  if (!assistant) continue;
  const collection = Array.isArray(message.parts) ? message.parts : (Array.isArray(message.content) ? message.content : []);
  for (const entry of collection) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    if (entry.type === "text" && typeof entry.text === "string") {
      texts.push(entry.text);
      textsCount += 1;
    } else if (entry.type === "result" && typeof entry.text === "string") {
      results.push(entry.text);
      textsCount += 1;
    } else if ((entry.type === "step_finish" || entry.type === "step-finish") && entry.tokens && typeof entry.tokens === "object" && !Array.isArray(entry.tokens)) {
      lines.push(JSON.stringify({ type: "step_finish", part: { tokens: entry.tokens } }));
    }
  }
}
if (texts.length > 0) lines.unshift(JSON.stringify({ type: "text", part: { type: "text", text: texts.join("") } }));
if (results.length > 0) lines.push(JSON.stringify({ type: "result", text: results.join("") }));
fs.writeFileSync(process.argv[2], lines.length > 0 ? lines.join("\n") + "\n" : "");
process.stdout.write(String(textsCount));
' "$1" "$2" 2>/dev/null
}

# Waits for the answer of one bench session: it polls the message list
# until an assistant text arrives or the wait ends. $1 takes the session
# id, $2 the staging file, and $3 the wait in seconds (0 reads once).
# Returns 0 with the synthesis in $2, 125 with an empty file when no text
# arrived on a single read, 124 when the wait ran out, and 1 on a
# transport failure.
live_wait_answer() {
  local session="$1" staging="$2" wait_secs="$3" resp err count deadline now rc=0
  resp="${staging}.msgs"
  err="${staging}.merr"
  deadline=$(( $(date +%s) + wait_secs ))
  while true; do
    count=0
    if ! live_get_messages "$session" "$resp" "$err"; then
      rc=$?
      # A failed poll inside a wait is transient: the API answered the
      # send, so the loop keeps polling until the wait ends.
      if [ "$wait_secs" -gt 0 ]; then
        now="$(date +%s)"
        if [ "$now" -ge "$deadline" ]; then
          rm -f "$resp" "$err"
          : > "$staging" 2>/dev/null || true
          return 124
        fi
        sleep 2
        continue
      fi
      rm -f "$resp" "$err"
      return "$rc"
    fi
    count="$(live_synthesize "$resp" "$staging" 2>/dev/null || echo 0)"
    case "$count" in
      ''|*[!0-9]*) count=0 ;;
    esac
    rm -f "$resp" "$err"
    if [ "$count" -gt 0 ]; then
      return 0
    fi
    if [ "$wait_secs" -le 0 ]; then
      return 125
    fi
    now="$(date +%s)"
    if [ "$now" -ge "$deadline" ]; then
      return 124
    fi
    sleep 2
  done
}

# One model call on the live-server path: one bench session per call with
# the job root and the route model, the D10 prompt in a message, and the
# answer from the session messages. $1 takes the message line file, $2
# the seeded diff, $3 the staging file, $4 the error file, and $5 the wait
# in seconds for the answer. Writes the synthesis stream to $3. Returns 0
# with the answer, 3 for the region error of a Go route, 124 on a
# timeout, and 1 on any other failure. The caller retries the transport
# failure, up to 3 calls in total.
live_model_call() {
  local message_path="$1" diff_path="$2" staging="$3" err_path="$4" wait_secs="$5"
  local prompt="$staging.prompt" s_body="$staging.sbody" s_resp="$staging.sresp" s_err="$staging.serr" send_resp="$staging.send" rc=0
  : > "$err_path" 2>/dev/null || return 1
  cat "$PROMPT_FILE" "$message_path" "$diff_path" > "$prompt" 2>/dev/null || return 1
  LIVE_SESSION=""
  live_session_create "$s_body" "$s_resp" "$s_err" || rc=$?
  if [ "$rc" -eq 124 ]; then
    rm -f "$prompt" "$s_body" "$s_resp" "$s_err" "$send_resp"
    return 124
  fi
  if [ "$rc" -eq 0 ]; then
    live_session_model "$LIVE_SESSION" "$s_body" "$s_resp" "$s_err" || rc=$?
    if [ "$rc" -eq 124 ]; then
      rm -f "$prompt" "$s_body" "$s_resp" "$s_err" "$send_resp"
      return 124
    fi
  fi
  if [ "$rc" -eq 0 ]; then
    live_send_prompt "$LIVE_SESSION" "$prompt" "$s_body" "$send_resp" "$s_err" || rc=$?
    if [ "$rc" -eq 124 ]; then
      rm -f "$prompt" "$s_body" "$s_resp" "$s_err" "$send_resp"
      return 124
    fi
  fi
  if [ "$rc" -ne 0 ]; then
    if is_live_region_error "$s_resp" "$s_err"; then
      cat "$s_err" >> "$err_path" 2>/dev/null || true
      rm -f "$prompt" "$s_body" "$s_resp" "$s_err" "$send_resp"
      return 3
    fi
    cat "$s_err" >> "$err_path" 2>/dev/null || true
    rm -f "$prompt" "$s_body" "$s_resp" "$s_err" "$send_resp"
    return 1
  fi
  # The answer: the session messages up to the wait.
  rc=0
  live_wait_answer "$LIVE_SESSION" "$staging" "$wait_secs" || rc=$?
  if [ "$rc" -eq 124 ]; then
    rm -f "$prompt" "$s_body" "$s_resp" "$s_err" "$send_resp"
    return 124
  fi
  if [ "$rc" -eq 1 ]; then
    cat "$s_err" >> "$err_path" 2>/dev/null || true
    rm -f "$prompt" "$s_body" "$s_resp" "$s_err" "$send_resp"
    return 1
  fi
  if [ "$rc" -eq 125 ]; then
    # No text on a single read (the probe): an empty synthesis settles
    # the call. The pass waits, so it never settles here.
    : > "$staging" 2>/dev/null || true
    rm -f "$prompt" "$s_body" "$s_resp" "$s_err" "$send_resp"
    return 0
  fi
  if is_live_region_error "$staging" "$err_path"; then
    rm -f "$prompt" "$s_body" "$s_resp" "$s_err" "$send_resp"
    return 3
  fi
  rm -f "$prompt" "$s_body" "$s_resp" "$s_err" "$send_resp"
  return 0
}

# The known credential key shapes of the live-server path (task 4.16, spec
# D14). No value list exists on this path, so the scan matches shapes, not
# values. The runner calls no `scan-values` seam on the live path.
LIVE_KEY_SHAPE='sk-[A-Za-z0-9_-]{20,}|xox[bap]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}'
live_key_shape_hit() {
  grep -Eq "$LIVE_KEY_SHAPE" "$1" 2>/dev/null
}

# 0: a value of the provider was found. 1: no value. 2: the scan failed.
scan_output() {
  local file="$1" raw_values live_rc=0
  if [ "${LIVE_PATH:-0}" = "1" ]; then
    live_key_shape_hit "$file" || live_rc=$?
    case "$live_rc" in
      0) return 0 ;;
      1) return 1 ;;
      *) return 2 ;;
    esac
  fi
  raw_values="$("$CREDENTIAL_HELPER" scan-values "$QUOTA_PROVIDER" 2>/dev/null)" || return 2
  printf '%s\n' "$raw_values" | grep -v '^[[:space:]]*$' > "$TMP_VALUES" || true
  [ -s "$TMP_VALUES" ] || return 1
  if grep -F -q -f "$TMP_VALUES" "$file"; then return 0; fi
  return 1
}

# The text that replaces an error line holding a credential value
# (task 4.13y, Review B ff4e009 N16, N20).
ERROR_KEY_TEXT="the error output held a credential value"

# The text of an error line whose value scan failed. It differs from the
# found-key text (task 4.15, Review B N31).
ERROR_SCAN_TEXT="the error output could not be scanned"

# The first line of the last stdout `{"type":"error",...}` event of one call
# (task 4.13y, Review B ff4e009 N20). In `--format json` the installed
# bundle writes every error as this event on stdout and skips the stderr
# printer. Prints no line when the output holds no error event.
error_event_text() {
  local out_path="$1"
  [ -s "$out_path" ] || return 0
  node -e '
const fs = require("node:fs");
let raw = "";
try { raw = fs.readFileSync(process.argv[1], "utf8"); } catch { raw = ""; }
const first = (value) => String(value).split(/\r?\n/)[0];
let text = "";
for (const line of raw.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) continue;
  let event;
  try { event = JSON.parse(trimmed); } catch { continue; }
  if (!event || typeof event !== "object" || Array.isArray(event)) continue;
  if (event.type !== "error") continue;
  const err = event.error;
  if (err && typeof err === "object" && !Array.isArray(err)) {
    if (typeof err.message === "string") text = first(err.message);
    else if (err.data && typeof err.data === "object" && typeof err.data.message === "string") text = first(err.data.message);
  } else if (typeof err === "string") {
    text = first(err);
  }
}
process.stdout.write(text);
' "$out_path" 2>/dev/null || true
}

# The joined messages of every stdout `{"type":"error",...}` event of one
# call (task 4.15, ADV-P4C-1). A credential value split across two error
# events forms no single file line, so the joined text is scanned too.
error_all_events_text() {
  local out_path="$1"
  [ -s "$out_path" ] || return 0
  node -e '
const fs = require("node:fs");
let raw = "";
try { raw = fs.readFileSync(process.argv[1], "utf8"); } catch { raw = ""; }
const first = (value) => String(value).split(/\r?\n/)[0];
const texts = [];
for (const line of raw.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) continue;
  let event;
  try { event = JSON.parse(trimmed); } catch { continue; }
  if (!event || typeof event !== "object" || Array.isArray(event)) continue;
  if (event.type !== "error") continue;
  const err = event.error;
  if (err && typeof err === "object" && !Array.isArray(err)) {
    if (typeof err.message === "string") texts.push(first(err.message));
    else if (err.data && typeof err.data === "object" && typeof err.data.message === "string") texts.push(first(err.data.message));
  } else if (typeof err === "string") {
    texts.push(first(err));
  }
}
process.stdout.write(texts.join(""));
' "$out_path" 2>/dev/null || true
}

# The error line of one failed call (task 4.13y, Review B ff4e009 N16, N20).
# It reads the stdout error event of the installed bundle first and the
# first stderr line second. A credential value in that source gives the
# fixed text, so no private folder or output holds the value.
error_line_of() {
  local out_path="$1" err_path="$2" fallback="$3" line="" source="" scan_rc=0 all_events=""
  line="$(error_event_text "$out_path")"
  if [ -n "$line" ]; then
    source="$out_path"
  else
    line="$(head -n 1 "$err_path" 2>/dev/null || true)"
    source="$err_path"
  fi
  if [ -z "$line" ]; then
    printf '%s\n' "$fallback"
    return 0
  fi
  # An error line over 500 bytes never reaches a record whole (task 4.15,
  # N26). The cap is 499 content bytes, so the printed line with its
  # newline stays within 500 bytes. A bounded substring keeps the function
  # total under `set -euo pipefail`: a pipe into head can raise SIGPIPE 141
  # (task 4.15, Review B N26b).
  line="${line:0:499}"
  if [ -s "$source" ]; then
    scan_output "$source" || scan_rc=$?
    # A scan that fails must not fall back to the raw line (task 4.13ab,
    # Review B f26965d N22, Review A NA2, Review C N1). Fail closed, with a
    # text of its own that differs from the found-key text (task 4.15, N31).
    if [ "$scan_rc" -eq 2 ]; then
      printf '%s\n' "$ERROR_SCAN_TEXT"
      return 0
    fi
    if [ "$scan_rc" -eq 0 ]; then
      printf '%s\n' "$ERROR_KEY_TEXT"
      return 0
    fi
    # The file bytes hold a JSON-escaped key, so scan the decoded error
    # text too (task 4.13ab, Review B f26965d N23).
    if [ -s "$TMP_VALUES" ] && printf '%s\n' "$line" | grep -F -q -f "$TMP_VALUES"; then
      printf '%s\n' "$ERROR_KEY_TEXT"
      return 0
    fi
    # A value split across two stdout error events forms no file line, so
    # scan the joined messages of every error event too (task 4.15, ADV-P4C-1).
    if [ -s "$TMP_VALUES" ]; then
      all_events="$(error_all_events_text "$out_path" 2>/dev/null || true)"
      if [ -n "$all_events" ] && printf '%s' "$all_events" | grep -F -q -f "$TMP_VALUES"; then
        printf '%s\n' "$ERROR_KEY_TEXT"
        return 0
      fi
    fi
    # The live-server path holds no value list, so the decoded error text
    # is scanned for known key shapes too (task 4.16, spec D14).
    if [ "${LIVE_PATH:-0}" = "1" ]; then
      if printf '%s' "$line" | grep -Eq "$LIVE_KEY_SHAPE" 2>/dev/null; then
        printf '%s\n' "$ERROR_KEY_TEXT"
        return 0
      fi
    fi
  fi
  printf '%s\n' "$line"
}

# The region error of spec D22. It applies to a Go route only. It reads the
# stdout error event of the installed bundle first (task 4.13y, Review B
# ff4e009 N20) and the error file second.
is_region_error() {
  local err_path="$1" out_path="${2:-}" text=""
  case "$ROUTE" in
    opencode-go/*) ;;
    *) return 1 ;;
  esac
  if [ -n "$out_path" ] && [ -s "$out_path" ]; then
    text="$(error_event_text "$out_path")"
    if [ -n "$text" ] && printf '%s\n' "$text" | grep -qiE 'not available in your region|not supported in your region'; then
      return 0
    fi
  fi
  grep -qiE 'not available in your region|not supported in your region' "$err_path" 2>/dev/null
}

# Writes the probe record of one probe under <private>/probes/<set_id>/
# (spec D14 probe mode, PM 2026-11-18). The record holds the tokens of the
# call and its state, and no raw output.
write_probe_record() {
  local state="$1" diff_id="$2" row="$3" error_line="$4" dir file
  dir="$PRIVATE/probes/$SET_ID"
  mkdir -p "$dir" || probe_refuse "the probe folder could not be made"
  file="$dir/${DATE}-${RUN_SLUG}-${ROUTE_TAG}.json"
  node -e '
const fs = require("node:fs");
const [file, set, route, diff, date, state, row, error, infraText] = process.argv.slice(1);
const parts = row.split("\t");
const num = (value) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
const tokens = {
  input: num(parts[0]),
  output: num(parts[1]),
  reasoning: num(parts[2]),
  cache_read: num(parts[3]),
  cache_write: num(parts[4]),
};
tokens.total = tokens.input + tokens.output + tokens.reasoning + tokens.cache_read + tokens.cache_write;
const doc = {
  set_id: set,
  route,
  diff,
  date,
  state,
  tokens,
  tokens_complete: parts[5] === "1",
};
if (error !== "") doc.error = error;
const infra = String(infraText === undefined ? "" : infraText).split("\n").filter((line) => line !== "");
if (infra.length > 0) doc.infra = infra;
fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
' "$file" "$SET_ID" "$ROUTE" "$diff_id" "$DATE" "$state" "$row" "$error_line" "$INFRA_LIST"
}

# The probe: exactly one call on the first control diff of the set, a diff
# whose key holds no plant (spec D14 probe mode, PM 2026-11-18). It prints
# one line `<route> <state> <error line or ->` and returns 0 for reachable
# and 3 for unreachable or region-blocked. A blocked probe is a refusal.
run_probe() {
  local control="" control_id="" control_message="" diff_path diff_id key plants
  for diff_path in "${DIFF_PATHS[@]}"; do
    diff_id="${diff_path##*/}"
    diff_id="${diff_id%.diff}"
    key="$SET_DIR/keys/${diff_id}.json"
    [ -f "$key" ] || continue
    plants="$(node -e '
const fs = require("node:fs");
let doc = {};
try { doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { process.exit(1); }
const plants = Array.isArray(doc.plants) ? doc.plants : [];
process.stdout.write(String(plants.length));
' "$key" 2>/dev/null)" || continue
    if [ "$plants" = "0" ]; then
      control="$diff_path"
      control_id="$diff_id"
      break
    fi
  done
  if [ -z "$control" ]; then
    probe_refuse "the set holds no control diff"
  fi
  control_message="$MESSAGE_STAGE_DIR/${control_id}.txt"

  local probe_dir="$PRIVATE/probes/$SET_ID"
  mkdir -p "$probe_dir" || probe_refuse "the probe folder could not be made"
  local staging="$probe_dir/.incoming-${control_id}"
  local err_file="$probe_dir/.incoming-${control_id}.err"
  local attempt=1 rc=0 state="" error_line="" row=""

  while [ "$attempt" -le 3 ]; do
    rc=0
    if [ "$LIVE_PATH" = "1" ]; then
      # One bench session per call, with a single message read. A timeout
      # stops the probe with no record (spec D14). An empty read settles
      # as reachable: the API answered, so the route is live (task
      # 4.16, groups L6 and L10). The single read keeps the probe inside
      # the spawn budget when the API holds no message yet.
      live_model_call "$control_message" "$control" "$staging" "$err_file" 0 || rc=$?
      if [ "$rc" -eq 124 ]; then
        rm -f "$staging" "$err_file"
        probe_refuse "the message send timed out"
      fi
      if [ "$rc" -eq 125 ]; then
        rc=0
      fi
    else
      run_model_call "$control_message" "$control" "$staging" "$err_file" || rc=$?
    fi
    # An empty answer is no response (spec D13), not a model result. The
    # live probe settles an empty read as reachable, so the rule keeps
    # the isolated path only.
    if [ "$rc" -eq 0 ] && [ "$LIVE_PATH" != "1" ] && [ ! -s "$staging" ]; then
      rc=125
    fi
    if [ "$rc" -eq 0 ]; then
      state="reachable"
      error_line=""
      break
    fi
    if is_region_error "$err_file" "$staging"; then
      error_line="$(error_line_of "$staging" "$err_file" "the model is not available in your region")"
      state="region-blocked"
      break
    fi
    error_line="$(error_line_of "$staging" "$err_file" "the model call failed")"
    rm -f "$staging" "$err_file"
    if [ "$attempt" -lt 3 ]; then
      sleep "$RETRY_WAIT_SECONDS"
      attempt=$(( attempt + 1 ))
      continue
    fi
    state="unreachable"
    break
  done

  if [ "$state" = "reachable" ]; then
    local scan_rc=0
    scan_output "$staging" || scan_rc=$?
    if [ "$scan_rc" -eq 2 ]; then
      rm -f "$staging" "$err_file"
      probe_refuse "the credential value scan failed"
    fi
    if [ "$scan_rc" -eq 0 ]; then
      rm -f "$staging" "$err_file"
      probe_refuse "a credential value was found in the raw output"
    fi
    row="$(read_tokens "$staging")"
    rm -f "$staging" "$err_file"
  else
    rm -f "$staging" "$err_file"
    row="$(printf '0\t0\t0\t0\t0\t0')"
  fi

  stop_daemons "$JOB"
  write_probe_record "$state" "$control_id" "$row" "$error_line"
  if [ "$state" = "reachable" ]; then
    echo "$ROUTE reachable -"
    return 0
  fi
  echo "$ROUTE $state $error_line"
  return 3
}

if [ "$PROBE" = "1" ]; then
  probe_status=0
  run_probe || probe_status=$?
  exit "$probe_status"
fi

for diff_path in "${DIFF_PATHS[@]}"; do
  diff_id="${diff_path##*/}"
  diff_id="${diff_id%.diff}"
  message_path="$MESSAGE_STAGE_DIR/${diff_id}.txt"

  # The quota read before each diff (spec D15). A pass with another plan
  # stops at 80 % of a window. A pass with the Go plan stops at 95 % of the
  # 5h window or 100 % of the week window, and it never stops at 80 %.
  read_quota
  if [ "$QUOTA_STATE" = "stopped" ]; then
    ERROR_LIST="${ERROR_LIST}${ERROR_LIST:+$'\n'}quota: $QUOTA_REASON"
    STATE="open"
    STOP=1
    break
  fi
  if [ "$IS_GO_ROUTE" = "1" ]; then
    if [ "$QUOTA_STATE" = "wait" ]; then
      ERROR_LIST="${ERROR_LIST}${ERROR_LIST:+$'\n'}quota: $QUOTA_STOP_TEXT"
      STATE="open"
      STOP=1
      break
    fi
  elif [ -n "$QUOTA_MAX" ] && [ "$(printf '%s\n' "$QUOTA_MAX" | awk '{ print ($1 >= 80) ? 1 : 0 }')" = "1" ]; then
    ERROR_LIST="${ERROR_LIST}${ERROR_LIST:+$'\n'}quota: $QUOTA_STOP_TEXT"
    STATE="open"
    STOP=1
    break
  fi

  # This diff is attempted: its record entry starts at zero tokens.
  DIFF_ROWS+=("${diff_id}"$'\t'"0"$'\t'"0"$'\t'"0"$'\t'"0"$'\t'"0"$'\t'"0")
  row_index=$(( ${#DIFF_ROWS[@]} - 1 ))

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
    if [ "$LIVE_PATH" = "1" ]; then
      # One bench session per call, with a single message read after the
      # send. The call timeout guards the send (curl --max-time, group
      # L5). An empty read settles without a retry: groups L1 and L9 pin
      # exactly one session per diff, so the wait cannot outlast the
      # spawn budget and the call cannot retry. The answer already
      # arrived when the send returned, or the stored empty output
      # records the miss downstream.
      live_model_call "$message_path" "$diff_path" "$STAGING" "$ERR_FILE" 0 || call_rc=$?
      if [ "$call_rc" -eq 124 ]; then
        rm -f "$STAGING" "$ERR_FILE"
        refuse "the message send timed out"
      fi
      if [ "$call_rc" -eq 125 ]; then
        call_rc=0
      fi
    else
      run_model_call "$message_path" "$diff_path" "$STAGING" "$ERR_FILE" || call_rc=$?
    fi
    # An empty answer is no response (spec D13), not a model result. The
    # live path settles the single read above (possibly empty) without a
    # retry, so the rule keeps the isolated path only.
    if [ "$call_rc" -eq 0 ] && [ "$LIVE_PATH" != "1" ] && [ ! -s "$STAGING" ]; then
      call_rc=125
    fi
    if [ "$call_rc" -eq 0 ]; then
      break
    fi
    if is_region_error "$ERR_FILE" "$STAGING"; then
      error_line="$(error_line_of "$STAGING" "$ERR_FILE" "the model is not available in your region")"
      rm -f "$STAGING" "$ERR_FILE"
      TOKENS_ALL=0
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
    TOKENS_ALL=0
    ERROR_LIST="${ERROR_LIST}${ERROR_LIST:+$'\n'}transport error on ${diff_id} after 3 calls"
    STATE="open"
    STOP=1
    break 2
  done

  if [ "$STOP" -eq 1 ]; then break; fi
  if [ "$call_rc" -ne 0 ]; then
    TOKENS_ALL=0
    STATE="open"
    STOP=1
    break
  fi

  # The scan of spec D14, before the output is stored.
  scan_rc=0
  scan_output "$STAGING" || scan_rc=$?
  if [ "$scan_rc" -eq 2 ]; then
    rm -f "$STAGING" "$ERR_FILE"
    TOKENS_ALL=0
    ERROR_LIST="${ERROR_LIST}${ERROR_LIST:+$'\n'}the credential value scan failed on ${diff_id}"
    echo "review-run: the credential value scan failed on ${diff_id}; the pass stops"
    STATE="open"
    STOP=1
    break
  fi
  if [ "$scan_rc" -eq 0 ]; then
    rm -f "$STAGING" "$ERR_FILE"
    TOKENS_ALL=0
    ERROR_LIST="${ERROR_LIST}${ERROR_LIST:+$'\n'}a credential value was found in the raw output of ${diff_id}"
    echo "review-run: a credential value was found in the raw output of ${diff_id}; the pass stops"
    STATE="open"
    STOP=1
    break
  fi
  # The token log of spec D13: the sums of this diff and its completeness.
  tokens_row="$(read_tokens "$STAGING")"
  IFS=$'\t' read -r tok_in tok_out tok_re tok_cr tok_cw tok_ok <<< "$tokens_row"
  DIFF_ROWS[$row_index]="${diff_id}"$'\t'"${tok_in}"$'\t'"${tok_out}"$'\t'"${tok_re}"$'\t'"${tok_cr}"$'\t'"${tok_cw}"$'\t'"${tok_ok}"
  if [ "$tok_ok" != "1" ]; then TOKENS_ALL=0; fi
  stored="$OUT_DIR/${diff_id}.txt"
  mv "$STAGING" "$stored"
  rm -f "$ERR_FILE"
  OUTPUT_LIST="${OUTPUT_LIST}${OUTPUT_LIST:+$'\n'}${stored}"
done

stop_daemons "$JOB"
write_record "$STATE"
exit 0
