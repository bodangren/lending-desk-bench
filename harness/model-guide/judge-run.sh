#!/usr/bin/env bash
# The judge runner of the model guide (spec D11; FR-12; plan tasks 4.13a/4.13b).
#
# Usage:
#   harness/model-guide/judge-run.sh --set <set_id> --route <route> \
#     --judge a|b [--private <dir>] [--start-test]
#
# `--set`, `--route`, and `--judge` are required. `--private` defaults to
# `$HOME/.local/share/lending-desk-bench/model-guide`, the default of
# `review-run.sh`. `--route` must be a row of `routes.json` with a `kind` of
# `plan` or `free`, so a judge call is a subscription call.
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
# (no start at 70 %, stop at 80 % of a window), the watcher of the call, and
# the token log of the `step-finish` events (spec D13).
#
# Environment seams: `BENCH_QUOTA_BASE` (quota.ts) and `MG_CALL_TIMEOUT_S`
# (default 600). The runner reads no real home folder, sends no packet off the
# loopback interface, and writes in the private folder and the job folder
# only.
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUIDE="$ROOT/harness/model-guide"
ROUTES_FILE="$GUIDE/routes.json"
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
# It reads the `step-finish` json events of the output (spec D13, Tokens).
read_tokens() {
  local file="$1" out
  out="$(node -e '
const fs = require("node:fs");
let raw = "";
try { raw = fs.readFileSync(process.argv[1], "utf8"); } catch { raw = ""; }
const sum = { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 };
let seen = 0;
const num = (value) => (typeof value === "number" && Number.isFinite(value)) ? value : 0;
for (const line of raw.split(/\r?\n/)) {
  const text = line.trim();
  if (!text.startsWith("{")) continue;
  let event;
  try { event = JSON.parse(text); } catch { continue; }
  if (!event || event.type !== "step-finish") continue;
  const tokens = event.tokens;
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) continue;
  seen += 1;
  sum.input += num(tokens.input);
  sum.output += num(tokens.output);
  sum.reasoning += num(tokens.reasoning);
  const cache = tokens.cache;
  if (cache && typeof cache === "object" && !Array.isArray(cache)) {
    sum.cache_read += num(cache.read);
    sum.cache_write += num(cache.write);
  }
}
process.stdout.write([sum.input, sum.output, sum.reasoning, sum.cache_read, sum.cache_write, seen > 0 ? 1 : 0].join("\t"));
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

# The route row of `routes.json`: kind, quota provider.
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
if [ -z "$OPENCODE_BIN" ] || [ ! -x "$OPENCODE_BIN" ]; then
  refuse "the opencode binary is unavailable"
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

on_exit() {
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
  # shellcheck source=../opencode-host.sh
  source "$ROOT/harness/opencode-host.sh"
  if ! opencode_host_begin model-guide >&2; then
    refuse "the job folder could not be made"
  fi
  JOB="$BENCH_OPENCODE_HOME"
  JOB_CONFIG="$JOB/opencode.json"
  printf '%s\n' '{"permission":{"read":"deny","edit":"deny","bash":"deny","webfetch":"deny","websearch":"deny","question":"deny","subagent":"deny","skill":"deny"}}' > "$JOB_CONFIG"
  if [ -n "$QUOTA_PROVIDER" ]; then
    if ! "$CREDENTIAL_HELPER" seed "$QUOTA_PROVIDER" > /dev/null; then
      refuse "the provider credential seed failed"
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

# 0: a value of the provider was found. 1: no value. 2: the scan failed.
scan_output() {
  local file="$1" raw_values
  raw_values="$("$CREDENTIAL_HELPER" scan-values "$QUOTA_PROVIDER" 2>/dev/null)" || return 2
  printf '%s\n' "$raw_values" | grep -v '^[[:space:]]*$' > "$TMP_VALUES" || true
  [ -s "$TMP_VALUES" ] || return 1
  if grep -F -q -f "$TMP_VALUES" "$file"; then return 0; fi
  return 1
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
    echo "$ROUTE not-ready a quota window is 70 % or more"
    return 3
  fi
  if [ "$QUOTA_STATE" = "stopped" ]; then
    echo "$ROUTE not-ready the quota read stopped: $QUOTA_REASON"
    return 3
  fi
  write_sample_prompt "$prompt"
  start_job
  run_model_call "$prompt" "$raw" "$err" || rc=$?
  if [ "$rc" -ne 0 ] || [ ! -s "$raw" ]; then
    error_line="$(head -n 1 "$err" 2>/dev/null || true)"
    [ -n "$error_line" ] || error_line="the model call failed"
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
const judgeFile = a[0], recordFile = a[1], set = a[2], judge = a[3], route = a[4], date = a[5], state = a[6], rowsText = a[7], verdictDir = a[8], complete = a[9];
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
  if (parts[2] === "complete") { for (const id of ids) judged[id] = route; }
}
totals.total = totals.input + totals.output + totals.reasoning + totals.cache_read + totals.cache_write;
fs.writeFileSync(judgeFile, JSON.stringify(verdicts, null, 2) + "\n");
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
fs.writeFileSync(recordFile, JSON.stringify(doc, null, 2) + "\n");
' "$JUDGE_FILE" "$RECORD_FILE" "$SET_ID" "$JUDGE" "$ROUTE" "$DATE" "$STATE" "$rows" "$VERDICT_DIR" "$TOKENS_ALL" \
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
  # after the previous group.
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
    ERRORS="${ERRORS}${ERRORS:+$'\n'}quota: a window is 70 % or more"
    STATE="open"
    STOP=1
    add_row "$GROUP_INDEX" "$group_id" "open" 0 0 0 0 0 "$group_ids"
    GROUP_INDEX=$(( GROUP_INDEX + 1 ))
    continue
  fi
  if [ -n "$QUOTA_MAX" ] && [ "$(printf '%s\n' "$QUOTA_MAX" | awk '{ print ($1 >= 80) ? 1 : 0 }')" = "1" ]; then
    ERRORS="${ERRORS}${ERRORS:+$'\n'}quota: a window reached 80 %"
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
  run_model_call "$PROMPT" "$RAW" "$ERR_FILE" || call_rc=$?
  # An empty answer is no response, not a model result.
  if [ "$call_rc" -eq 0 ] && [ ! -s "$RAW" ]; then
    call_rc=125
  fi
  if [ "$call_rc" -ne 0 ]; then
    error_line="$(head -n 1 "$ERR_FILE" 2>/dev/null || true)"
    [ -n "$error_line" ] || error_line="the model call failed"
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
  # the ids of this group with one of the three verdict values.
  node -e '
const fs = require("node:fs");
const [rawPath, idsText, outPath] = process.argv.slice(1);
let raw = "";
try { raw = fs.readFileSync(rawPath, "utf8"); } catch { raw = ""; }
const ids = idsText.split(",").filter((id) => id !== "");
const allowed = ["real-defect", "false-claim", "unclear"];
let chosen = null;
const pattern = /```json[^\n]*\n([\s\S]*?)```/g;
let match;
while ((match = pattern.exec(raw)) !== null) {
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

write_files
exit 0
