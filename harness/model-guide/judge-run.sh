#!/usr/bin/env bash
# The judge runner of the model guide (spec D11; FR-12; plan tasks 4.13a/4.13b).
#
# Usage:
#   harness/model-guide/judge-run.sh --set <set_id> --route <route> \
#     --judge a|b [--private <dir>] [--start-test]
#
# `--set`, `--route`, and `--judge` are required. `--private` defaults to
# `$HOME/.local/share/lending-desk-bench/model-guide`, the default of
# `review-run.sh`.
#
# The route list of the run (spec D11, PM 2026-11-18): `judges.json` holds
# the judge routes, and the runner accepts a route only from that file. A
# review-only route of `routes.json` is a refusal: exit 2, one `judge-run:`
# line on stdout, no call, and no judge file. A missing `judges.json` file is
# a refusal too. The runner never reads `routes.json`, and `review-run.sh`
# never reads `judges.json`.
#
# The judge rows hold no `kind` field: a judge route is a subscription route.
# A judge row that holds a `kind` keeps the check of `routes.json` (a kind of
# `plan` or `free`).
#
# A judge row with an empty `quota_provider` or `quota_source`, or a tab in
# a field, is a refusal: exit 2, one `judge-run:` line on stdout, no call,
# and no judge file (task 4.13f, review B2).
#
# The input is `<private>/sets/<set_id>/adjudication/queue.json`, the queue of
# `adjudicate.ts queue`. One model call runs per group. A group is one diff,
# one file, one 3-line window, and the claims of every route. The prompt holds
# the seeded diff `<private>/sets/<set_id>/diffs/<diff_id>.diff` and the items
# of the group (id, line, file, class, severity, title, reason). The prompt
# holds no route name, no route slug, and no text of a judge file: the runner
# never reads a judge file, so the second judge never reads the verdicts of
# the first judge (spec D11).
#
# The answer is the last fenced json block that is a flat object. Only the ids
# of the group with a value of `real-defect`, `false-claim`, or `unclear` are
# kept. Any other id and any other value are dropped. A group with no valid
# block adds no verdict, so `adjudicate.ts apply` reads it as `unclear`.
#
# The output is `<private>/sets/<set_id>/adjudication/judge-<a|b>.json`, the
# flat map that `adjudicate.ts apply` reads, and the run record
# `<private>/sets/<set_id>/adjudication/judge-<a|b>-run.json`. The run record
# holds `set_id`, `judge`, `route`, `date`, `state` (`complete` or `open`),
# `groups` (each with an `id`, a `state`, and a `tokens` object), `judged_by`
# (the finding id to the route that judged it), `tokens` (the five flat sums
# and their `total`), and `tokens_complete`.
#
# The map `judged_by` holds the finding ids that hold a verdict only. A
# complete group whose answer drops an id leaves that id out of the map
# (task 4.13f, review C7).
#
# A missing queue, an empty queue, a queue that does not parse, and a bad
# `--judge` value are refusals: exit 2, one `judge-run:` line on stdout, no
# call, and no judge file.
#
# `--start-test` makes exactly one call on a fixed built-in sample group and
# no set data. It prints `<route> ready|not-ready <error line or ->` on
# stdout, exits 0 for ready and 3 for not-ready, and writes no judge file.
#
# The safety rules of `review-run.sh` hold: the job folder of
# `opencode_host_begin` with its own `OPENCODE_HOME`, the call
# `run --standalone --format json --model <route>`, the job config that
# denies every tool, the credential value scan before an answer is used, the
# flock lock of one set, one judge, and one date, the quota rules of spec D15
# (no start at 70 %, stop at 80 % of a window; the Go plan waits at 95 % of
# the 5h window or 100 % of the weekly window and stops at those thresholds,
# PM 2026-11-19), the watcher of the call, and the token log of the
# `step-finish` and real `step_finish` events (spec D13, task 4.13w).
#
# Environment seams: `BENCH_QUOTA_BASE` (quota.ts) and `MG_CALL_TIMEOUT_S`
# (default 600). The runner reads no real home folder, sends no packet off the
# loopback interface, and writes in the private folder and the job folder
# only.
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUIDE="$ROOT/harness/model-guide"
JUDGES_FILE="$GUIDE/judges.json"
QUOTA_TOOL="$GUIDE/quota.ts"
CREDENTIAL_HELPER="$GUIDE/provider-credential.sh"

if [ -n "${BENCH_OPENCODE_BIN:-}" ]; then
  OPENCODE_BIN="$BENCH_OPENCODE_BIN"
else
  OPENCODE_BIN="$(command -v opencode || true)"
fi

refuse() {
  echo "judge-run: $1"
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
  // The native assistant message of the live path (task 4.16 r3, Review A
  // F14): the token use sits beside the content in the top-level `tokens`
  // field. Both token event shapes count, the same rule as above.
  if (event.type === "assistant" && object(event.tokens)) {
    tokenEvent = true;
    tokens = object(event.tokens);
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
JUDGE=""
PRIVATE="${HOME:-}/.local/share/lending-desk-bench/model-guide"
START_TEST=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --route|--set|--judge|--private)
      [ "$#" -ge 2 ] || refuse "$1 needs a value"
      case "$1" in
        --route) ROUTE="$2" ;;
        --set) SET_ID="$2" ;;
        --judge) JUDGE="$2" ;;
        --private) PRIVATE="$2" ;;
      esac
      shift 2
      ;;
    --start-test)
      START_TEST=1
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
case "$JUDGE" in
  a|b) ;;
  *) refuse "the judge value is not a or b: ${JUDGE:--}" ;;
esac

case "$SET_ID" in
  *..*) refuse "the set id holds a parent segment" ;;
esac
if ! [[ "$SET_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  refuse "the set id is not a plain id"
fi
case "$ROUTE" in
  *..*) refuse "the route value holds a parent segment" ;;
esac

MG_CALL_TIMEOUT="${MG_CALL_TIMEOUT_S:-600}"
if ! [[ "$MG_CALL_TIMEOUT" =~ ^[0-9]+$ ]]; then
  refuse "MG_CALL_TIMEOUT_S must be a whole number of seconds"
fi

# The date of the run record and of the lock, in UTC.
DATE="$(date -u +%F)"

# The route list of the run (spec D11, PM 2026-11-18). `judges.json` holds
# the judge routes, and the runner accepts a route only from that file. A
# missing `judges.json` file is a refusal: the runner never falls back to
# `routes.json`.
[ -f "$JUDGES_FILE" ] || refuse "judges.json is missing"

# The route row of the list: kind, quota provider, quota source. A field that
# the row does not hold is the placeholder `-`, so the three fields keep
# their place in the row. A row with an empty quota field, or a tab in a
# field, exits 5 and is a refusal.
route_rc=0
route_row="$(node -e '
const fs = require("node:fs");
const [file, route] = process.argv.slice(1);
let doc;
try { doc = JSON.parse(fs.readFileSync(file, "utf8")); } catch { process.exit(4); }
const list = Array.isArray(doc) ? doc : (doc && Array.isArray(doc.routes) ? doc.routes : []);
const row = list.find((entry) => entry && entry.route === route);
if (!row) process.exit(3);
for (const key of ["quota_provider", "quota_source"]) {
  const value = row[key];
  if (typeof value !== "string" || value === "") process.exit(5);
}
for (const key of Object.keys(row)) {
  const value = row[key];
  if (typeof value === "string" && value.includes("\t")) process.exit(5);
}
const field = (value) => (typeof value === "string" && value !== "" ? value : "-");
process.stdout.write([field(row.kind), field(row.quota_provider), field(row.quota_source)].join("\t"));
' "$JUDGES_FILE" "$ROUTE")" || route_rc=$?
case "$route_rc" in
  0) ;;
  3) refuse "the route is not in judges.json" ;;
  5) refuse "the judge row holds an empty quota field or a tab" ;;
  *) refuse "judges.json is unreadable" ;;
esac
IFS=$'\t' read -r ROUTE_KIND QUOTA_PROVIDER QUOTA_SOURCE <<< "$route_row"
if [ "$ROUTE_KIND" = "-" ]; then ROUTE_KIND=""; fi
if [ "$QUOTA_PROVIDER" = "-" ]; then QUOTA_PROVIDER=""; fi
if [ "$QUOTA_SOURCE" = "-" ]; then QUOTA_SOURCE=""; fi
# A judge route is a subscription route (spec D11). The judge rows hold no
# `kind` field, so the kind check runs only for a row that holds one.
if [ -n "$ROUTE_KIND" ]; then
  case "$ROUTE_KIND" in
    plan|free) ;;
    *) refuse "the route kind is not plan or free: $ROUTE_KIND" ;;
  esac
fi

# The live-server path of spec D14 (PM 2026-11-20, task 4.16). A pilot
# route reaches the model through one bench session on the OpenChamber API.
# A pilot route needs BENCH_SERVER_BASE: an unset value refuses before any
# seed call, so a pilot route never enters isolated seeding. An explicitly
# empty value takes the local default http://127.0.0.1:38307 (task 4.16 r4,
# Review A F15). A non-pilot route keeps the isolated path below. The
# runner never reads `routes.json`.
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
LIVE_BASE=""
if is_pilot_route; then
  if [ "${BENCH_SERVER_BASE+set}" != "set" ]; then
    refuse "a pilot route needs BENCH_SERVER_BASE"
  fi
  LIVE_PATH=1
  LIVE_RAW_BASE="${BENCH_SERVER_BASE:-http://127.0.0.1:38307}"
  case "$LIVE_RAW_BASE" in
    *[![:space:]]*) ;;
    *) LIVE_RAW_BASE="http://127.0.0.1:38307" ;;
  esac
  # The base is one http origin on the loopback interface, with no userinfo
  # and an explicit port. A URL with a userinfo part names another host, so
  # the parse refuses it before any request (task 4.16 r3, Review A F18).
  LIVE_BASE="$(node -e '
const raw = process.argv[1];
let url;
try { url = new URL(raw); } catch { process.exit(2); }
if (url.protocol !== "http:") process.exit(2);
if (url.username !== "" || url.password !== "") process.exit(2);
if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") process.exit(2);
if (url.pathname !== "/" && url.pathname !== "") process.exit(2);
const port = url.port === "" ? 80 : Number(url.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) process.exit(2);
process.stdout.write("http://" + url.hostname + ":" + port);
' "$LIVE_RAW_BASE" 2>/dev/null)" || refuse "BENCH_SERVER_BASE must be a loopback http URL"
  [ -n "$LIVE_BASE" ] || refuse "BENCH_SERVER_BASE must be a loopback http URL"
fi
# The provider, model, and variant of the route. The session create of the
# live path carries all three (spec D14).
ROUTE_PROVIDER="${ROUTE%%/*}"
ROUTE_REST="${ROUTE#*/}"
ROUTE_MODEL="$ROUTE_REST"
ROUTE_VARIANT=""
case "$ROUTE_REST" in
  *#*) ROUTE_MODEL="${ROUTE_REST%%#*}"; ROUTE_VARIANT="${ROUTE_REST##*#}" ;;
esac

# The quota rule of the route (spec D15, PM 2026-11-19). The Go plan holds
# the provider `opencode-go`. It waits at 95 % of the 5h window or 100 % of
# the weekly window, and a run stops at those same thresholds. Every other
# source waits at 70 % of any window, and a run stops at 80 %. The Go rule
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

# The tools of the run.
TSX=""
for candidate in "$ROOT/harness/node_modules/.bin/tsx" "$ROOT/node_modules/.bin/tsx"; do
  if [ -x "$candidate" ]; then TSX="$candidate"; break; fi
done
if [ -z "$TSX" ]; then TSX="$(command -v tsx || true)"; fi
[ -n "$TSX" ] || refuse "tsx is unavailable"
[ -f "$QUOTA_TOOL" ] || refuse "quota.ts is missing"
[ -x "$CREDENTIAL_HELPER" ] || refuse "provider-credential.sh is missing"
# The live path needs no local `opencode` binary: it reaches the model
# through the live API. The isolated path keeps the check.
if [ "$LIVE_PATH" != "1" ]; then
  if [ -z "$OPENCODE_BIN" ] || [ ! -x "$OPENCODE_BIN" ]; then
    refuse "the opencode binary is unavailable"
  fi
fi

mkdir -p "$PRIVATE" || refuse "the private folder could not be made"
SET_DIR="$PRIVATE/sets/$SET_ID"
ADJ_DIR="$SET_DIR/adjudication"
JUDGE_FILE="$ADJ_DIR/judge-$JUDGE.json"
RECORD_FILE="$ADJ_DIR/judge-$JUDGE-run.json"

TMP_ROOT="${TMPDIR:-/tmp}"
mkdir -p "$TMP_ROOT" 2>/dev/null || true
TMP_DIR="$TMP_ROOT/mg-judge-$JUDGE.$$"
TMP_VALUES="$TMP_ROOT/mg-judge-values.$$"
TMP_QUOTA_ERR="$TMP_ROOT/mg-judge-quota-err.$$"
( umask 077; mkdir -p "$TMP_DIR"; : > "$TMP_VALUES"; : > "$TMP_QUOTA_ERR" )

JOB=""
JOB_CONFIG=""
CALL_PID=""
WATCHDOG_PID=""
LOCKED=0
# The job root that the live path made itself. A preset root keeps this
# empty, so a missing project config is a refusal (task 4.16 r3 F19).
LIVE_JOB_CREATED=""

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
    line="judge-run: INFRA stopped daemon $pid"
    echo "$line" >&2
    INFRA_LIST="${INFRA_LIST}${INFRA_LIST:+$'\n'}${line}"
  done
}

on_exit() {
  stop_daemons "$JOB"
  if [ "${BENCH_OPENCODE_HOST_OWNER:-0}" = "1" ]; then
    opencode_host_cleanup >&2 2>/dev/null || true
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
  rm -f "${TMP_VALUES:-}" "${TMP_QUOTA_ERR:-}" 2>/dev/null || true
  rm -rf "${TMP_DIR:-}" 2>/dev/null || true
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

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

# The job folder of spec D14, the job config that denies every tool, and the
# seed of the route provider only. A failure stops the run before any call.
start_job() {
  # The live-server path keeps the job root outside every git repo (spec
  # D14): the default host folder sits under $ROOT/.tmp, inside the
  # repository, so an unset BENCH_OPENCODE_HOME is defaulted to a fresh
  # folder under TMPDIR. A preset value is kept as is (group L11 pins a
  # preset-free run with the session outside the repo). The folder
  # survives the run: group L11 asserts the session directory exists.
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
  # The HOME guard of plan tasks 4.13o and 4.13r F5: every call of the run
  # holds the job HOME. The one real-HOME call is the seed export of the
  # helper. The job root must be absolute, and the two paths are compared
  # after realpath resolution on a path boundary.
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
  local sub sub_real link_hit
  for sub in home config data state cache runtime tmp; do
    sub_real="$(realpath -m "$JOB/$sub" 2>/dev/null || true)"
    case "$sub_real" in
      "$JOB_REAL"|"$JOB_REAL"/*) ;;
      *)
        if [ "$sub" = "home" ]; then
          refuse "the job HOME is outside the job root"
        fi
        refuse "the job $sub folder is outside the job root"
        ;;
    esac
    # A symlink at or below a call path leaves the job too (task 4.15,
    # Review B N10). The realpath check above covers the top level only, so
    # every level at and below the call path is walked for a link. The walk
    # stops at the first hit, so no pipe can raise SIGPIPE 141 under
    # `set -euo pipefail` (task 4.15, Review B G2).
    if [ -e "$JOB/$sub" ] || [ -L "$JOB/$sub" ]; then
      link_hit="$(find "$JOB/$sub" -mindepth 0 -type l -print -quit 2>/dev/null)"
      if [ -n "$link_hit" ]; then
        refuse "the job $sub folder holds a symlink out of the job root"
      fi
    fi
  done
  # The session directory is the job root, and the job root stays outside
  # every git repo (spec D14). A preset root inside a repo is refused
  # before the first call.
  if [ "$LIVE_PATH" = "1" ] && command -v git >/dev/null 2>&1; then
    if git -C "$JOB_REAL" rev-parse --show-toplevel >/dev/null 2>&1; then
      refuse "the job root is inside a git repo"
    fi
  fi
  # The project config of the live-server path comes before the first call:
  # the judge call never runs on a refused deny (spec D14).
  if [ "$LIVE_PATH" = "1" ]; then
    command -v curl >/dev/null 2>&1 || refuse "curl is unavailable"
    live_ensure_config
  fi
  if [ "$LIVE_PATH" != "1" ] && [ -n "$QUOTA_PROVIDER" ]; then
    # The refusal carries the closed-list seed reason of the helper
    # (task 4.15); any other helper text keeps the bare refusal.
    if ! seed_out="$("$CREDENTIAL_HELPER" seed "$QUOTA_PROVIDER" 2>&1 > /dev/null)"; then
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
  fi
}

# Runs one model call with the job store of the job folder. The call is a
# background job with a watcher. When the runner dies without its trap (for
# example on SIGKILL), the watcher stops the call, so no model call outlives
# the runner (PM load watch).
run_model_call() {
  local prompt_path="$1" raw_path="$2" err_path="$3" rc=0
  local parent=$$ watchdog=0
  timeout --kill-after=1 "$MG_CALL_TIMEOUT" \
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
      < "$prompt_path" > "$raw_path" 2> "$err_path" &
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
# runner creates the session with `location.directory` set to the job root
# and the route model, checks the returned location, sends the judge prompt
# in a message, waits for the native assistant message to complete, and
# reads the answer text and the top-level token field from that message. It
# makes no DELETE request, no seed call, and no auth call. The stored text
# is scanned for known key shapes before it is stored. The quota rules of
# D15, the lines and exit codes, and the record shapes stay unchanged.

# The project config of the live-server path: the job root holds a project
# config that denies every tool. The runner writes the config only in a job
# root that it made itself. A preset root must already hold the config: a
# missing config, an unreadable config, or one allowed tool is a refusal
# before the first call (spec D14, task 4.16 r3 F19).
live_ensure_config() {
  local file="$JOB/opencode.json" missing="" rc=0
  if [ ! -f "$file" ] && [ ! -L "$file" ]; then
    if [ -n "${LIVE_JOB_CREATED:-}" ]; then
      printf '%s\n' '{"permission":{"read":"deny","edit":"deny","bash":"deny","webfetch":"deny","websearch":"deny","question":"deny","subagent":"deny","skill":"deny"}}' > "$file" \
        || refuse "the project config could not be written"
    else
      refuse "the project config is missing or unreadable"
    fi
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

# The HTTP code of the last live call.
LIVE_HTTP_CODE=""

# The one deadline of a live call, in seconds since the epoch, set at call
# entry. Every request of the call uses the time that is left (task 4.16 r4,
# Review A F13). Live calls run one at a time, so the shell globals hold.
LIVE_DEADLINE=0
LIVE_CALL_START=0
LIVE_TIMEOUT=1

# Sets LIVE_TIMEOUT to the whole seconds left before LIVE_DEADLINE. Returns
# 1, with no timeout, when the deadline has passed, so no request starts
# after it (task 4.16 r6, Review A F13).
live_remaining() {
  local now left
  now="$(date +%s)"
  left=$(( LIVE_DEADLINE - now ))
  if [ "$left" -lt 1 ]; then return 1; fi
  LIVE_TIMEOUT="$left"
  return 0
}

# One live request with the time left. $1 takes the body file, $2 the
# curl error file, and the rest takes the curl arguments. Sets
# LIVE_HTTP_CODE to the HTTP code. Returns 126 when the deadline has passed
# and no request runs, 124 on a timeout (curl exit 28), 0 when the request
# ran, and 1 when curl could not run at all.
live_curl() {
  local out="$1" err="$2"
  shift 2
  : > "$out" 2>/dev/null || return 1
  : > "$err" 2>/dev/null || return 1
  local rc=0 code="000"
  live_remaining || return 126
  code="$(curl -sS --max-time "$LIVE_TIMEOUT" "$@" -o "$out" -w '%{http_code}' 2>"$err")" || rc=$?
  if [ "$rc" -eq 28 ]; then
    return 124
  fi
  if [ "$rc" -ne 0 ]; then
    return 1
  fi
  LIVE_HTTP_CODE="$code"
  return 0
}

# Creates one bench session for one call. The body carries the job root in
# `location.directory` and the provider, model, and variant of the route.
# The returned session must name the job root as its location, else the run
# refuses before the first message (task 4.16 r3, Review A F12). Sets
# LIVE_SESSION to the session id. Returns 124 on a timeout and 1 on any
# other failure.
live_session_create() {
  local body="$1" out="$2" err="$3" rc=0 record="" shown=""
  node -e '
const fs = require("node:fs");
const [file, directory, provider, id, variant] = process.argv.slice(1);
const record = { location: { directory }, model: { providerID: provider, id } };
if (variant !== "") record.model.variant = variant;
fs.writeFileSync(file, JSON.stringify(record) + "\n");
' "$body" "$JOB_REAL" "$ROUTE_PROVIDER" "$ROUTE_MODEL" "$ROUTE_VARIANT" 2>/dev/null || return 1
  live_curl "$out" "$err" -X POST -H 'content-type: application/json' -H "x-opencode-directory: $JOB_REAL" --data @"$body" "$LIVE_BASE/api/session" || return $?
  case "$LIVE_HTTP_CODE" in
    2*) ;;
    *) return 1 ;;
  esac
  record="$(node -e '
const fs = require("node:fs");
let doc;
try { doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { process.exit(1); }
const data = doc && typeof doc === "object" && doc.data && typeof doc.data === "object" && !Array.isArray(doc.data) ? doc.data : doc;
const id = data && typeof data.id === "string" ? data.id : "";
const location = data && typeof data.location === "object" && !Array.isArray(data.location) ? data.location : null;
const shown = location && typeof location.directory === "string" ? location.directory : "";
if (id === "") process.exit(1);
process.stdout.write(id + "\t" + shown);
' "$out" 2>/dev/null)" || return 1
  LIVE_SESSION=""
  IFS=$'\t' read -r LIVE_SESSION shown <<< "$record"
  [ -n "$LIVE_SESSION" ] || return 1
  shown="${shown%/}"
  if [ "$shown" != "$JOB_REAL" ]; then
    refuse "the session location is not the job root"
  fi
  return 0
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

# Decodes one message list body ($1) into the synthesis event stream ($2),
# with the native model error text in the file $3. The page is newest
# first. The newest assistant message governs the answer: a newest partial
# message blocks every older completed message and every older tool-calls
# step until it reaches a terminal state (`time.completed`, or a `finish`
# other than `tool-calls`). The message carries its text in `content[]` and
# its token use in the top-level `tokens` field (task 4.16 r6, Review A
# F20). Prints one status line `<empty|partial|complete|error>\t<count>`;
# only a complete record with text or a result writes the synthesis. Text
# fragments rejoin with the empty string, because the API splits streamed
# text at an arbitrary character (task 4.16 r3, Review A F13, F14, F17).
live_synthesize() {
  node -e '
const fs = require("node:fs");
let doc;
try { doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { process.exit(1); }
const list = Array.isArray(doc) ? doc : (doc && typeof doc === "object" && Array.isArray(doc.data) ? doc.data : null);
if (!list) process.exit(1);
let newest = null;
const session = process.argv[4] || "";
const start = Number(process.argv[5]);
for (const message of list) {
  if (!message || typeof message !== "object" || Array.isArray(message)) continue;
  const assistant = (message.info && typeof message.info === "object" && message.info.role === "assistant") || message.type === "assistant";
  if (!assistant) continue;
  const info = message.info && typeof message.info === "object" ? message.info : null;
  const owner = message.sessionID !== undefined ? message.sessionID : (info ? info.sessionID : undefined);
  if (session !== "" && owner !== undefined && owner !== session) continue;
  const stamp = message.time && typeof message.time === "object" ? message.time : (info && info.time && typeof info.time === "object" ? info.time : null);
  if (start > 0 && !(stamp && typeof stamp.created === "number" && stamp.created >= start)) continue;
  newest = message; break;
}
if (!newest) { process.stdout.write("empty\t0\n"); process.exit(0); }
const error = newest.error && typeof newest.error === "object" && !Array.isArray(newest.error) ? newest.error : null;
if (error) {
  const data = error.data && typeof error.data === "object" && !Array.isArray(error.data) ? error.data : null;
  const text = typeof error.message === "string" ? error.message
    : data && typeof data.message === "string" ? data.message : "the model returned an error";
  try { fs.writeFileSync(process.argv[3], text.split(/\r?\n/)[0] + "\n"); } catch {}
  process.stdout.write("error\t0\n");
  process.exit(0);
}
const time = newest.time && typeof newest.time === "object" && !Array.isArray(newest.time) ? newest.time : null;
const toolCalls = newest.finish === "tool-calls";
const finished = typeof newest.finish === "string" && newest.finish !== "";
const terminal = !toolCalls && ((time && typeof time.completed === "number" && Number.isFinite(time.completed)) || finished);
if (!terminal) { process.stdout.write("partial\t0\n"); process.exit(0); }
const collection = Array.isArray(newest.parts) ? newest.parts : (Array.isArray(newest.content) ? newest.content : []);
const lines = [];
const texts = [];
const results = [];
for (const entry of collection) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
  if (entry.type === "text" && typeof entry.text === "string") texts.push(entry.text);
  else if (entry.type === "result" && typeof entry.text === "string") results.push(entry.text);
}
const tokens = newest.tokens && typeof newest.tokens === "object" && !Array.isArray(newest.tokens) ? newest.tokens : null;
if (tokens) lines.push(JSON.stringify({ type: "step_finish", part: { tokens } }));
if (texts.length > 0) lines.unshift(JSON.stringify({ type: "text", part: { type: "text", text: texts.join("") } }));
if (results.length > 0) lines.push(JSON.stringify({ type: "result", text: results.join("") }));
const count = texts.length + results.length;
const status = count > 0 ? "complete" : "partial";
try { fs.writeFileSync(process.argv[2], lines.length > 0 ? lines.join("\n") + "\n" : ""); } catch {}
process.stdout.write(status + "\t" + String(count) + "\n");
' "$1" "$2" "$3" "$4" "$5" 2>/dev/null
}

# Waits for the native answer of one bench session. $1 takes the session
# id, $2 the staging file, and $3 the error file. It polls the message list
# until the newest terminal answer appears, an error appears, or the one
# deadline of the call (LIVE_DEADLINE, set at call entry) ends. An empty
# list and a partial answer get no shorter window (task 4.16 r4, Review A
# F13). Returns 0 with the synthesis in $2, 3 with the model error text in
# $3, 4 when the deadline ends without a terminal answer, and 1 on a failed
# read (Review A F16, F17).
live_wait_answer() {
  local session="$1" staging="$2" err_path="$3" resp err state now rc=0
  resp="${staging}.msgs"
  err="${staging}.merr"
  while true; do
    # No request starts after the deadline, and no completion is accepted
    # after it (task 4.16 r6, Review A F13).
    now="$(date +%s)"
    if [ "$now" -ge "$LIVE_DEADLINE" ]; then
      : > "$staging"
      rm -f "${staging}.error" "$resp" "$err"
      return 4
    fi
    rc=0
    live_get_messages "$session" "$resp" "$err" || rc=$?
    if [ "$rc" -eq 126 ]; then
      : > "$staging"
      rm -f "${staging}.error" "$resp" "$err"
      return 4
    fi
    if [ "$rc" -ne 0 ]; then
      # A failed read is a failure, not a success: the real status of the
      # read stays and the call stops here (task 4.16 r3, Review A F16).
      cat "$err" >> "$err_path" 2>/dev/null || true
      rm -f "$resp" "$err" "$staging" "${staging}.error"
      return 1
    fi
    state="$(live_synthesize "$resp" "$staging" "${staging}.error" "$session" "$(( LIVE_CALL_START * 1000 ))" 2>/dev/null | head -n 1)" || state=""
    case "$state" in
      complete*) state="complete" ;;
      error*) state="error" ;;
      partial*) state="partial" ;;
      empty*) state="empty" ;;
      *) state="fail" ;;
    esac
    rm -f "$resp" "$err"
    case "$state" in
      complete)
        now="$(date +%s)"
        if [ "$now" -ge "$LIVE_DEADLINE" ]; then
          : > "$staging"
          rm -f "${staging}.error"
          return 4
        fi
        rm -f "${staging}.error"
        return 0
        ;;
      error)
        cat "${staging}.error" >> "$err_path" 2>/dev/null || true
        rm -f "$staging" "${staging}.error"
        return 3
        ;;
      fail)
        rm -f "$staging" "${staging}.error"
        return 1
        ;;
      empty|partial)
        ;;
    esac
    sleep 2
  done
}

# One model call on the live-server path: one bench session per call with
# the job root and the route model, one prompt in a message, and the native
# answer from the session messages. $1 takes the prompt file, $2 the
# staging file, and $3 the error file. The one deadline is set here, at
# call entry, and every request uses the time that is left. Writes the
# synthesis stream to $2. Returns 0 with the answer, 3 for a native model
# error of a Go route (the region error), 124 on a send timeout, 4 when the
# deadline ends without a terminal answer, and 1 on any other failure. The
# caller keeps the single-attempt rule of the isolated path: the judge
# makes one call per group.
live_model_call() {
  local prompt="$1" staging="$2" err_path="$3"
  local s_body="$staging.sbody" s_resp="$staging.sresp" s_err="$staging.serr" send_resp="$staging.send" rc=0
  LIVE_CALL_START="$(date +%s)"
  LIVE_DEADLINE=$(( LIVE_CALL_START + MG_CALL_TIMEOUT ))
  : > "$err_path" 2>/dev/null || return 1
  LIVE_SESSION=""
  live_session_create "$s_body" "$s_resp" "$s_err" || rc=$?
  if [ "$rc" -eq 126 ]; then
    rm -f "$s_body" "$s_resp" "$s_err" "$send_resp"
    return 4
  fi
  if [ "$rc" -ne 0 ]; then
    if [ "$rc" -ne 124 ] && is_live_region_error "$s_resp" "$s_err"; then
      cat "$s_err" >> "$err_path" 2>/dev/null || true
      rm -f "$s_body" "$s_resp" "$s_err" "$send_resp"
      return 3
    fi
    cat "$s_err" >> "$err_path" 2>/dev/null || true
    rm -f "$s_body" "$s_resp" "$s_err" "$send_resp"
    return "$rc"
  fi
  rc=0
  live_send_prompt "$LIVE_SESSION" "$prompt" "$s_body" "$send_resp" "$s_err" || rc=$?
  if [ "$rc" -eq 126 ]; then
    rm -f "$s_body" "$s_resp" "$s_err" "$send_resp"
    return 4
  fi
  if [ "$rc" -ne 0 ]; then
    if [ "$rc" -ne 124 ] && is_live_region_error "$s_resp" "$s_err"; then
      cat "$s_err" >> "$err_path" 2>/dev/null || true
      rm -f "$s_body" "$s_resp" "$s_err" "$send_resp"
      return 3
    fi
    cat "$s_err" >> "$err_path" 2>/dev/null || true
    rm -f "$s_body" "$s_resp" "$s_err" "$send_resp"
    return "$rc"
  fi
  # The answer: the newest terminal assistant message up to the deadline.
  rc=0
  live_wait_answer "$LIVE_SESSION" "$staging" "$err_path" || rc=$?
  rm -f "$s_body" "$s_resp" "$s_err" "$send_resp"
  case "$rc" in
    0|3|4|124) return "$rc" ;;
    *) return 1 ;;
  esac
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

# The built-in sample group of `--start-test`. It holds no set data.
write_sample_prompt() {
  local path="$1"
  cat > "$path" <<'SAMPLE'
You judge one code review finding of one small window of one changed file.

The finding below names a defect on a line of the change that follows. Judge
the finding from the change alone. Read no file and run no command.

Answer with one fenced json block. The block maps the id below to exactly one
of these three values:
  real-defect   the change holds the defect that the finding names
  false-claim   the change holds no such defect
  unclear       the change cannot settle the finding
Use no other key and no other value.

## The findings of this window

- id: sample#C0a1b2c3d4e5f
  line: 12
  file: src/sample.ts
  class: C1
  severity: minor
  title: The sample claim of the start test
  reason: The sample reason of the start test.

## The change

--- a/src/sample.ts
+++ b/src/sample.ts
@@ -10,4 +10,4 @@
 export const first = 1;
-export const sample = 1;
+export const sample = 2;
 export const third = 3;
SAMPLE
}

# The start test: exactly one call on the sample group, no set data, no judge
# file. It prints one line and returns 0 for ready and 3 for not-ready.
run_start_test() {
  local prompt="$TMP_DIR/sample.txt" raw="$TMP_DIR/sample.out" err="$TMP_DIR/sample.err"
  local error_line="" rc=0
  read_quota
  if [ "$QUOTA_STATE" = "wait" ]; then
    echo "$ROUTE not-ready $QUOTA_WAIT_TEXT"
    return 3
  fi
  if [ "$QUOTA_STATE" = "stopped" ]; then
    echo "$ROUTE not-ready the quota read stopped: $QUOTA_REASON"
    return 3
  fi
  write_sample_prompt "$prompt"
  start_job
  if [ "$LIVE_PATH" = "1" ]; then
    # One bench session for the sample, with the answer read from the
    # session messages. A timeout stops the start test with no file.
    live_model_call "$prompt" "$raw" "$err" || rc=$?
    if [ "$rc" -eq 124 ]; then
      rm -f "$raw" "$err"
      echo "judge-run: the message send timed out"
      return 2
    fi
  else
    run_model_call "$prompt" "$raw" "$err" || rc=$?
  fi
  if [ "$rc" -ne 0 ] || { [ "$LIVE_PATH" != "1" ] && [ ! -s "$raw" ]; }; then
    error_line="$(error_line_of "$raw" "$err" "the model call failed")"
    echo "$ROUTE not-ready $error_line"
    return 3
  fi
  echo "$ROUTE ready -"
  return 0
}

if [ "$START_TEST" = "1" ]; then
  start_status=0
  run_start_test || start_status=$?
  exit "$start_status"
fi

# The exclusive lock of one set, one judge, and one date. It comes before the
# queue read and before any call. A second run that finds the lock held exits
# 2 with one line on stderr and writes no judge file.
LOCK_DIR="$PRIVATE/.locks"
mkdir -p "$LOCK_DIR" || refuse "the lock folder could not be made"
LOCK_FILE="$LOCK_DIR/judge-${SET_ID}-${JUDGE}-${DATE}.lock"
if ! : >> "$LOCK_FILE" 2>/dev/null; then
  refuse "the lock file could not be made"
fi
exec 9>>"$LOCK_FILE"
if ! flock -n 9; then
  echo "judge-run: the lock for set $SET_ID, judge $JUDGE, date $DATE is held" >&2
  exit 2
fi
LOCKED=1

QUEUE_FILE="$ADJ_DIR/queue.json"
if [ ! -f "$QUEUE_FILE" ]; then
  refuse "the queue is missing: $QUEUE_FILE"
fi

# The queue holds the groups. Each group gives one prompt file with its own
# seeded diff and its own items, and one line of the index: the group number,
# the group id, and the ids of its items.
PROMPT_DIR="$TMP_DIR/prompts"
queue_rc=0
node -e '
const fs = require("node:fs");
const path = require("node:path");
const [queueFile, setDir, outDir] = process.argv.slice(1);
let doc = null;
try { doc = JSON.parse(fs.readFileSync(queueFile, "utf8")); } catch { process.exit(4); }
if (!doc || typeof doc !== "object" || Array.isArray(doc) || !Array.isArray(doc.groups)) process.exit(4);
if (doc.groups.length === 0) process.exit(5);
fs.mkdirSync(outDir, { recursive: true });
const text = (value) => (typeof value === "string" ? value : "");
const index = [];
for (let i = 0; i < doc.groups.length; i += 1) {
  const group = doc.groups[i];
  if (!group || typeof group !== "object" || Array.isArray(group)) process.exit(4);
  if (!Array.isArray(group.items) || group.items.length === 0) process.exit(4);
  const diffId = text(group.diff_id);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(diffId)) process.exit(4);
  let diff = "";
  try { diff = fs.readFileSync(path.join(setDir, "diffs", diffId + ".diff"), "utf8"); } catch { process.exit(6); }
  const file = text(group.file);
  const idList = [];
  const lines = [];
  for (const item of group.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) process.exit(4);
    const id = text(item.id);
    if (id === "") process.exit(4);
    idList.push(id);
    const claim = (item.claim && typeof item.claim === "object" && !Array.isArray(item.claim)) ? item.claim : {};
    lines.push("- id: " + id);
    lines.push("  line: " + String(typeof item.line === "number" ? item.line : 0));
    lines.push("  file: " + file);
    lines.push("  class: " + text(claim.class));
    lines.push("  severity: " + text(claim.severity));
    lines.push("  title: " + text(claim.title));
    lines.push("  reason: " + text(claim.reason));
  }
  const body = [
    "You judge code review findings of one small window of one changed file.",
    "",
    "The findings below name a defect on a line of the change that follows.",
    "Judge each finding from the change alone. Read no file and run no command.",
    "",
    "Answer with one fenced json block. The block maps every id below to exactly",
    "one of these three values:",
    "  real-defect   the change holds the defect that the finding names",
    "  false-claim   the change holds no such defect",
    "  unclear       the change cannot settle the finding",
    "Use no other key and no other value.",
    "",
    "## The findings of this window",
    "",
    ...lines,
    "",
    "## The change",
    "",
    diff,
  ];
  fs.writeFileSync(path.join(outDir, "g-" + String(i) + ".txt"), body.join("\n") + "\n");
  index.push([String(i), text(group.id), idList.join(",")].join("\t"));
}
fs.writeFileSync(path.join(outDir, "index.tsv"), index.join("\n") + "\n");
' "$QUEUE_FILE" "$SET_DIR" "$PROMPT_DIR" || queue_rc=$?
case "$queue_rc" in
  0) ;;
  5) refuse "the queue holds no group" ;;
  6) refuse "the queue names a diff that the set does not hold" ;;
  *) refuse "the queue does not parse" ;;
esac

GROUP_IDS=()
GROUP_ITEM_IDS=()
TOTAL_GROUPS=0
while IFS=$'\t' read -r g_idx g_id g_ids; do
  [ -n "$g_idx" ] || continue
  GROUP_IDS[g_idx]="$g_id"
  GROUP_ITEM_IDS[g_idx]="$g_ids"
  TOTAL_GROUPS=$(( g_idx + 1 ))
done < "$PROMPT_DIR/index.tsv"
[ "$TOTAL_GROUPS" -gt 0 ] || refuse "the queue holds no group"

ADJ_DIR_OK=0
mkdir -p "$ADJ_DIR" || refuse "the adjudication folder could not be made"
ADJ_DIR_OK=1
VERDICT_DIR="$TMP_DIR/verdicts"
mkdir -p "$VERDICT_DIR" || refuse "the verdict folder could not be made"

# The rows of the run record: index, group id, state, the five token sums, the
# ids of the items.
GROUP_ROWS=()
STATE="complete"
TOKENS_ALL=1
STOP=0
ERRORS=""

add_row() {
  GROUP_ROWS+=("$1"$'\t'"$2"$'\t'"$3"$'\t'"$4"$'\t'"$5"$'\t'"$6"$'\t'"$7"$'\t'"$8"$'\t'"$9")
}

write_files() {
  local rows
  rows="$(printf '%s\n' "${GROUP_ROWS[@]}")"
  node -e '
const fs = require("node:fs");
const a = process.argv.slice(1);
const judgeFile = a[0], recordFile = a[1], set = a[2], judge = a[3], route = a[4], date = a[5], state = a[6], rowsText = a[7], verdictDir = a[8], complete = a[9], infraText = a[10], errorsText = a[11];
const num = (value) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
const totals = { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 };
const groups = [];
const judged = {};
const verdicts = {};
for (const row of rowsText.split("\n")) {
  if (row === "") continue;
  const parts = row.split("\t");
  const tokens = {
    input: num(parts[3]),
    output: num(parts[4]),
    reasoning: num(parts[5]),
    cache_read: num(parts[6]),
    cache_write: num(parts[7]),
  };
  tokens.total = tokens.input + tokens.output + tokens.reasoning + tokens.cache_read + tokens.cache_write;
  for (const key of ["input", "output", "reasoning", "cache_read", "cache_write"]) totals[key] += tokens[key];
  groups.push({ id: parts[1], state: parts[2], tokens });
  const ids = String(parts[8] === undefined ? "" : parts[8]).split(",").filter((id) => id !== "");
  let map = {};
  try { map = JSON.parse(fs.readFileSync(verdictDir + "/v-" + parts[0] + ".json", "utf8")); } catch { map = {}; }
  if (!map || typeof map !== "object" || Array.isArray(map)) map = {};
  for (const key of Object.keys(map)) verdicts[key] = map[key];
  // The map `judged_by` holds the finding ids that hold a verdict only.
  if (parts[2] === "complete") {
    for (const id of ids) {
      if (Object.hasOwn(map, id)) judged[id] = route;
    }
  }
}
totals.total = totals.input + totals.output + totals.reasoning + totals.cache_read + totals.cache_write;
// A run with no verdict writes no judge file: a failed read or a native
// error must not publish an empty verdict file (task 4.16 r3, F16, F17).
// A stopped run that already read a verdict keeps its file (J11).
if (Object.keys(verdicts).length > 0) fs.writeFileSync(judgeFile, JSON.stringify(verdicts, null, 2) + "\n");
const doc = {
  set_id: set,
  judge,
  route,
  date,
  state,
  groups,
  judged_by: judged,
  tokens: totals,
  tokens_complete: complete === "1",
};
const infra = String(infraText === undefined ? "" : infraText).split("\n").filter((line) => line !== "");
if (infra.length > 0) doc.infra = infra;
// The error lines of the run (task 4.13y, Review B N16): the same fixed
// text covers a credential value in the error output, so the record holds
// no value.
const errors = String(errorsText === undefined ? "" : errorsText).split("\n").filter((line) => line !== "");
if (errors.length > 0) doc.errors = errors;
fs.writeFileSync(recordFile, JSON.stringify(doc, null, 2) + "\n");
' "$JUDGE_FILE" "$RECORD_FILE" "$SET_ID" "$JUDGE" "$ROUTE" "$DATE" "$STATE" "$rows" "$VERDICT_DIR" "$TOKENS_ALL" "$INFRA_LIST" "$ERRORS" \
    || refuse "the judge files could not be written"
}

GROUP_INDEX=0
while [ "$GROUP_INDEX" -lt "$TOTAL_GROUPS" ]; do
  group_id="${GROUP_IDS[$GROUP_INDEX]}"
  group_ids="${GROUP_ITEM_IDS[$GROUP_INDEX]}"

  if [ "$STOP" = "1" ]; then
    add_row "$GROUP_INDEX" "$group_id" "open" 0 0 0 0 0 "$group_ids"
    GROUP_INDEX=$(( GROUP_INDEX + 1 ))
    continue
  fi

  # The quota read before each group (spec D15). A window of 70 % or more
  # stops the run before the call, and a window of 80 % or more stops it
  # after the previous group. The Go plan waits at 95 % of the 5h window or
  # 100 % of the week window, and it stops at those thresholds, never at 80 %.
  read_quota
  if [ "$QUOTA_STATE" = "stopped" ]; then
    ERRORS="${ERRORS}${ERRORS:+$'\n'}quota: $QUOTA_REASON"
    STATE="open"
    STOP=1
    add_row "$GROUP_INDEX" "$group_id" "open" 0 0 0 0 0 "$group_ids"
    GROUP_INDEX=$(( GROUP_INDEX + 1 ))
    continue
  fi
  if [ "$QUOTA_STATE" = "wait" ]; then
    ERRORS="${ERRORS}${ERRORS:+$'\n'}quota: $QUOTA_WAIT_TEXT"
    STATE="open"
    STOP=1
    add_row "$GROUP_INDEX" "$group_id" "open" 0 0 0 0 0 "$group_ids"
    GROUP_INDEX=$(( GROUP_INDEX + 1 ))
    continue
  fi
  if [ "$IS_GO_ROUTE" != "1" ] && [ -n "$QUOTA_MAX" ] && [ "$(printf '%s\n' "$QUOTA_MAX" | awk '{ print ($1 >= 80) ? 1 : 0 }')" = "1" ]; then
    ERRORS="${ERRORS}${ERRORS:+$'\n'}quota: $QUOTA_STOP_TEXT"
    STATE="open"
    STOP=1
    add_row "$GROUP_INDEX" "$group_id" "open" 0 0 0 0 0 "$group_ids"
    GROUP_INDEX=$(( GROUP_INDEX + 1 ))
    continue
  fi

  if [ -z "$JOB" ]; then
    start_job
  fi

  PROMPT="$PROMPT_DIR/g-$GROUP_INDEX.txt"
  RAW="$TMP_DIR/raw-$GROUP_INDEX.txt"
  ERR_FILE="$TMP_DIR/err-$GROUP_INDEX.txt"
  call_rc=0
  if [ "$LIVE_PATH" = "1" ]; then
    # One bench session per group, with the answer read from the session
    # messages up to the call timeout. A timeout stops the run with no
    # judge file (spec D14).
    live_model_call "$PROMPT" "$RAW" "$ERR_FILE" || call_rc=$?
    if [ "$call_rc" -eq 124 ]; then
      rm -f "$RAW" "$ERR_FILE"
      echo "judge-run: the message send timed out"
      exit 2
    fi
    if [ "$call_rc" -eq 4 ]; then
      # The deadline ended without a terminal answer. The run stops with no
      # judge file (task 4.16 r4, Review A F13).
      rm -f "$RAW" "$ERR_FILE"
      echo "judge-run: the model answer did not complete"
      exit 2
    fi
  else
    run_model_call "$PROMPT" "$RAW" "$ERR_FILE" || call_rc=$?
  fi
  # An empty answer is no response, not a model result. The live path
  # never settles an empty answer here: the wait ends with a timeout
  # instead, so the rule keeps the isolated path only.
  if [ "$call_rc" -eq 0 ] && [ "$LIVE_PATH" != "1" ] && [ ! -s "$RAW" ]; then
    call_rc=125
  fi
  if [ "$call_rc" -ne 0 ]; then
    error_line="$(error_line_of "$RAW" "$ERR_FILE" "the model call failed")"
    rm -f "$RAW" "$ERR_FILE"
    TOKENS_ALL=0
    ERRORS="${ERRORS}${ERRORS:+$'\n'}the model call failed on group ${group_id}: ${error_line}"
    echo "judge-run: the model call failed on group ${group_id}: ${error_line}; the run stops"
    STATE="open"
    STOP=1
    add_row "$GROUP_INDEX" "$group_id" "open" 0 0 0 0 0 "$group_ids"
    GROUP_INDEX=$(( GROUP_INDEX + 1 ))
    continue
  fi

  # The credential value scan, before the answer is parsed.
  scan_rc=0
  scan_output "$RAW" || scan_rc=$?
  if [ "$scan_rc" -eq 2 ]; then
    rm -f "$RAW" "$ERR_FILE"
    TOKENS_ALL=0
    ERRORS="${ERRORS}${ERRORS:+$'\n'}the credential value scan failed on group ${group_id}"
    echo "judge-run: the credential value scan failed on group ${group_id}; the run stops"
    STATE="open"
    STOP=1
    add_row "$GROUP_INDEX" "$group_id" "open" 0 0 0 0 0 "$group_ids"
    GROUP_INDEX=$(( GROUP_INDEX + 1 ))
    continue
  fi
  if [ "$scan_rc" -eq 0 ]; then
    rm -f "$RAW" "$ERR_FILE"
    TOKENS_ALL=0
    ERRORS="${ERRORS}${ERRORS:+$'\n'}a credential value was found in the answer of group ${group_id}"
    echo "judge-run: a credential value was found in the answer of group ${group_id}; the run stops"
    STATE="open"
    STOP=1
    add_row "$GROUP_INDEX" "$group_id" "open" 0 0 0 0 0 "$group_ids"
    GROUP_INDEX=$(( GROUP_INDEX + 1 ))
    continue
  fi

  tokens_row="$(read_tokens "$RAW")"
  IFS=$'\t' read -r tok_in tok_out tok_re tok_cr tok_cw tok_ok <<< "$tokens_row"
  if [ "$tok_ok" != "1" ]; then TOKENS_ALL=0; fi

  # The verdicts: the last fenced json block that is a flat object, and only
  # the ids of this group with one of the three verdict values. The answer
  # text is decoded from the `--format json` event stream first (task 4.13t,
  # ADV-P4B-1): a real `opencode run` prints one JSON event per line, so the
  # fenced block is a JSON string inside a text event and holds no real
  # newline. A plain answer passes through unchanged. The same decoder lives
  # in `review-score.ts`; the committed adversarial fixture copies only this
  # runner and `quota.ts` into its temp repo, so a separate shared module
  # cannot reach both.
  node -e '
const fs = require("node:fs");
const [rawPath, idsText, outPath] = process.argv.slice(1);
let raw = "";
try { raw = fs.readFileSync(rawPath, "utf8"); } catch { raw = ""; }
const parts = [];
const resultParts = [];
// The fragments of one session message (task 4.16): the API splits
// streamed text at an arbitrary character, so the fragments rejoin
// exactly only with the empty string. Event-stream texts hold whole
// lines and keep the newline join below.
const msgParts = [];
const msgResults = [];
for (const line of raw.split(/\r?\n/)) {
  const text = line.trim();
  if (!text.startsWith("{")) continue;
  let event;
  try { event = JSON.parse(text); } catch { continue; }
  if (!event || typeof event !== "object" || Array.isArray(event)) continue;
  const part = event.part;
  if (event.type === "text" && part && typeof part === "object" && typeof part.text === "string") {
    parts.push(part.text);
    continue;
  }
  if (event.type === "result" && typeof event.text === "string") resultParts.push(event.text);
  // The session message shape of the live-server path (task 4.16, spec
  // D14): one line holds a `parts` array with text, result, and token
  // entries. A text entry wins over a result entry, and a result-only
  // payload still decodes, the same rule as the event stream above.
  const collection = Array.isArray(event.parts) ? event.parts
    : (Array.isArray(event.content) ? event.content : null);
  if (collection !== null) {
    for (const entry of collection) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      if (entry.type === "text" && typeof entry.text === "string") msgParts.push(entry.text);
      else if (entry.type === "result" && typeof entry.text === "string") msgResults.push(entry.text);
    }
    continue;
  }
}
// A `result` branch never wins over the text events: the joined text
// events already hold the answer, so a forged result event after the text
// answer is refused (task 4.15, Review A N13, P5). A result-only stream
// still decodes from the result event (ADV-P4B AJ1). One answer for all
// three decoders: review-score.ts and adjudicate.ts read the same way.
// Message fragments rejoin with the empty string (task 4.16): the split
// is at an arbitrary character, so a newline join would corrupt the text.
const joined = msgParts.length > 0 ? msgParts.join("") : (parts.length > 0 ? parts.join("\n") : (msgResults.length > 0 ? msgResults.join("") : (resultParts.length > 0 ? resultParts.join("\n") : raw)));
// A forged `result` branch smuggled as a text line never reaches the
// verdict scan: the fence pattern would swallow the rest of that line and
// poison the first block (task 4.15, Review A N13). Only nested lines are
// refused, so a top-level result event still decodes.
const answer = joined.split("\n").filter((line) => {
  if (!line.trim().startsWith("{")) return true;
  try {
    const doc = JSON.parse(line.trim());
    return !(doc && typeof doc === "object" && !Array.isArray(doc) && doc.type === "result");
  } catch {
    return true;
  }
}).join("\n");
const ids = idsText.split(",").filter((id) => id !== "");
const allowed = ["real-defect", "false-claim", "unclear"];
let chosen = null;
const pattern = /```json[^\n]*\n([\s\S]*?)```/g;
let match;
while ((match = pattern.exec(answer)) !== null) {
  let doc = null;
  try { doc = JSON.parse(match[1].trim()); } catch { continue; }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) continue;
  chosen = doc;
}
const map = {};
if (chosen !== null) {
  for (const id of ids) {
    const value = chosen[id];
    if (typeof value === "string" && allowed.includes(value)) map[id] = value;
  }
}
fs.writeFileSync(outPath, JSON.stringify(map) + "\n");
' "$RAW" "$group_ids" "$VERDICT_DIR/v-$GROUP_INDEX.json" || {
    rm -f "$RAW" "$ERR_FILE"
    TOKENS_ALL=0
    ERRORS="${ERRORS}${ERRORS:+$'\n'}the answer of group ${group_id} did not parse"
    echo "judge-run: the answer of group ${group_id} did not parse; the run stops"
    STATE="open"
    STOP=1
    add_row "$GROUP_INDEX" "$group_id" "open" 0 0 0 0 0 "$group_ids"
    GROUP_INDEX=$(( GROUP_INDEX + 1 ))
    continue
  }
  rm -f "$RAW" "$ERR_FILE"
  add_row "$GROUP_INDEX" "$group_id" "complete" "$tok_in" "$tok_out" "$tok_re" "$tok_cr" "$tok_cw" "$group_ids"
  GROUP_INDEX=$(( GROUP_INDEX + 1 ))
done

stop_daemons "$JOB"
write_files
exit 0
