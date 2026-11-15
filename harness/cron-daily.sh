#!/usr/bin/env bash
# Daily model schedule (track daily_model_schedule): refresh the model list,
# pick one model, guard each batch, and publish the site data.
# The selector lives in harness/daily-pick.ts. The job owns writes and publishes.
#
# The schedule uses harness/systemd/lending-desk-daily.timer with Persistent=false.
# The matching service is harness/systemd/lending-desk-daily.service.
# Do not install these units in this track.
# The timer runs every night at 01:00 local time. Each day is a UTC date.
# The job commits only docs/ and pushes main as a fast-forward (D16). A guard
# stop with zero runs still publishes the site data (D15).
# Exit codes of a live run (D19): 0 for a full day with a passed push, 3 for a
# skip, and 1, 2, 130, or 143 for a failure. A live run sends one line to the
# PM at the end of the EXIT path (D17). A dry run sends nothing.
#
# Test seams: BENCH_RUNS_ROOT, BENCH_PRICING_PATH, BENCH_DAILY_DIR,
# BENCH_DAILY_DATE, BENCH_DAILY_CATALOG, BENCH_DAILY_SERVED,
# BENCH_DAILY_PUBLISH, BENCH_DAILY_LOCK, BENCH_DAILY_QUOTA_CMD,
# BENCH_DAILY_BATCH, BENCH_DAILY_POST, BENCH_DAILY_SELECT,
# BENCH_DAILY_NOTIFY_CMD, BENCH_DAILY_PM_CONFIG, BENCH_DAILY_CGROUP_FILE, and
# BENCH_DAILY_NOTIFY_LIVE. BENCH_DAILY_NOTIFY_CMD names an executable. The job
# runs it with the notice line as its only argument. Without it, the real send
# runs only in the timer unit (the cgroup file holds lending-desk-daily.service)
# or with BENCH_DAILY_NOTIFY_LIVE=1, which marks the line HAND (D20).
# BENCH_DAILY_RUNNER is retired and is never started. Dry runs write no day
# record and make no model call.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
H="$ROOT/harness"
# shellcheck source=opencode-host.sh
source "$H/opencode-host.sh"

# ---- Toolchain -----------------------------------------------------------------
if ! command -v node >/dev/null 2>&1 || [ "$(command -v node)" = "/snap/bin/node" ]; then
  # shellcheck source=toolchain.sh
  source "$H/toolchain.sh"
fi

echo "DAILY START $(date -Is)"

DAY="${BENCH_DAILY_DATE:-$(date -u +%F)}"
DAYS_DIR="${BENCH_DAILY_DIR:-$ROOT/reports/daily}"
RUNS_ROOT="${BENCH_RUNS_ROOT:-$ROOT/runs}"
PRICING="${BENCH_PRICING_PATH:-$H/go-pricing.json}"
LOCK="${BENCH_DAILY_LOCK:-$ROOT/.tmp/weekly-cron.lock}"
BATCH="${BENCH_DAILY_BATCH:-$H/batch.sh}"
PUBLISH="${BENCH_DAILY_PUBLISH:-1}"
POST="${BENCH_DAILY_POST:-1}"
# The daily self-check is the logic meta suite by default (spec D9), the same
# as cron-weekly.sh. An explicit caller value stays.
export BENCH_SELFCHECK="${BENCH_SELFCHECK:-logic}"
DRY_RUN=0
case " $* " in
  *" --dry-run "*) DRY_RUN=1 ;;
esac

# ---- Notice state (D17, D19) -----------------------------------------------------
# The EXIT path reads these values and sends one line for a live run. A dry run
# keeps exit 0 on a skip. A live skip exits 3.
LAST_FAIL=""
SKIP_REASON=""
PUSH_DONE=0
PUSH_OLD=""
PUSH_NEW=""
PUSH_COMMITS=0
N_RUNS=0
SKIP_RC=3
if [ "$DRY_RUN" = "1" ]; then SKIP_RC=0; fi

# ---- Catch-up state (D22, D25, D26, D27) -----------------------------------------
# The D26 pick list is active only when the price table declares its minimum.
# Otherwise the job keeps the single-model flow and the notice fields of
# Phase 6, so the older tests stay byte-for-byte.
LIST_MODE=0
MODEL=""
NEW_FLAG="no"
BOARD=""
BOARD_NEW=0
DUE=0
LOCAL_DATE=""
EXCLUDED=""
MODELS_RAN=0
NOTICE_SENT=0
LAST_START="${BENCH_DAILY_LAST_START:-20:00}"
MAX_MODELS="${BENCH_DAILY_MAX_MODELS:-12}"

# A failure line. The notice of a failed run quotes the last one.
daily_fail() {
  LAST_FAIL="$1"
  echo "DAILY FAIL $1" >&2
}

# The ISO week token of the day. Run ids and the selection carry this token.
WEEK="$(node -e '
const d = new Date(process.argv[1] + "T00:00:00Z");
if (Number.isNaN(d.getTime())) process.exit(1);
const day = d.getUTCDay() || 7;
d.setUTCDate(d.getUTCDate() + 4 - day);
const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
const week = Math.ceil(((d.getTime() - start.getTime()) / 86400000 + 1) / 7);
process.stdout.write(d.getUTCFullYear() + "w" + String(week).padStart(2, "0"));
' "$DAY")" || {
  daily_fail "toolchain: invalid date $DAY"
  exit 2
}
export WEEK

TMP_DIR="$ROOT/.tmp"
mkdir -p "$TMP_DIR"
PICK_OUT="$TMP_DIR/daily-pick-$$"
RUNLIST_OUT="$TMP_DIR/daily-runlist-$$"
CATALOG_TMP="$TMP_DIR/daily-catalog-$$"
SERVED_TMP="$TMP_DIR/daily-served-$$"
MSG_FILE="$TMP_DIR/daily-commit-msg-$$"
RECORD_TMP="$DAYS_DIR/.daily-record-$$"
SELFCHECK_MARKER="$TMP_DIR/selfcheck-pass-$WEEK-$$"

# The notice of D17. A live run sends one line: PUBLISH for exit 0 after a
# push, SKIP for exit 3, and FAIL for every other non-zero exit. The line holds
# only the labels of this job, never a credential or command output. A failed
# send prints a short reason and never changes the exit status. The gate of D20
# comes before the real send: the seam first, then the VITEST rule, then the
# timer unit or the live flag.
daily_notify() {
  local rc="$1" line="" reason="" rows="$N_RUNS" pm="" pm_config="" cgroup_file="" send_rc=0 fields=""
  if [ "$DRY_RUN" = "1" ]; then return 0; fi
  if [ "$NOTICE_SENT" = "1" ]; then return 0; fi
  # D25: the PUBLISH and SKIP lines end with the model, the new flag, the board
  # length read again after the export, and the due count. The FAIL line ends
  # with the model. The list mode appends them; Phase 6 lines stay as they were.
  if [ "$LIST_MODE" = "1" ]; then
    BOARD_NEW="$(board_count "$BOARD")"
    fields=" model=${MODEL:-none} new=$NEW_FLAG board=$BOARD_NEW due=$DUE"
  fi
  if [ "$rc" -eq 0 ] && [ "$PUSH_DONE" = "1" ]; then
    line="lending-desk-daily PUBLISH $DAY $PUSH_NEW range=$PUSH_OLD..$PUSH_NEW commits=$PUSH_COMMITS rows=$rows$fields"
  elif [ "$rc" -eq 3 ] && [ -n "$SKIP_REASON" ]; then
    if [ "$PUSH_DONE" = "1" ]; then
      line="lending-desk-daily SKIP $DAY exit=3: $SKIP_REASON; publish=$PUSH_NEW range=$PUSH_OLD..$PUSH_NEW commits=$PUSH_COMMITS rows=$rows$fields"
    else
      line="lending-desk-daily SKIP $DAY exit=3: $SKIP_REASON; publish=none rows=$rows$fields"
    fi
  elif [ "$rc" -ne 0 ]; then
    reason="${LAST_FAIL:-no DAILY FAIL line}"
    if [ "$LIST_MODE" = "1" ]; then
      line="lending-desk-daily FAIL $DAY exit=$rc: ${reason:0:150} log=reports/cron-daily.log model=${MODEL:-none}"
    else
      line="lending-desk-daily FAIL $DAY exit=$rc: ${reason:0:150} log=reports/cron-daily.log"
    fi
  else
    return 0
  fi
  line="${line:0:300}"
  if [ -n "${BENCH_DAILY_NOTIFY_CMD:-}" ]; then
    echo "DAILY NOTIFY $line"
    "$BENCH_DAILY_NOTIFY_CMD" "$line" >/dev/null 2>&1 || send_rc=$?
    if [ "$send_rc" -ne 0 ]; then echo "DAILY NOTIFY failed: the notice command exited $send_rc"; fi
    return 0
  fi
  if [ -n "${VITEST:-}" ]; then
    echo "DAILY NOTIFY skipped: test"
    return 0
  fi
  # The real send needs the timer unit or the live flag (D20). An agent shell
  # inherits INVOCATION_ID, so only the cgroup shows the timer unit. A line
  # that the live flag sends from outside the unit says HAND.
  cgroup_file="${BENCH_DAILY_CGROUP_FILE:-/proc/self/cgroup}"
  if [ -f "$cgroup_file" ] && grep -qF "/lending-desk-daily.service" "$cgroup_file" 2>/dev/null; then
    :
  elif [ "${BENCH_DAILY_NOTIFY_LIVE:-}" = "1" ]; then
    line="lending-desk-daily HAND ${line#lending-desk-daily }"
    line="${line:0:300}"
  else
    echo "DAILY NOTIFY skipped: not the timer unit"
    return 0
  fi
  echo "DAILY NOTIFY $line"
  pm_config="${BENCH_DAILY_PM_CONFIG:-$HOME/.config/ra-slots/config.json}"
  if [ ! -f "$pm_config" ]; then
    echo "DAILY NOTIFY failed: no PM config file"
    return 0
  fi
  pm="$(node -e '
try {
  const c = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  if (typeof c.pmSession === "string") process.stdout.write(c.pmSession);
} catch {}
' "$pm_config" 2>/dev/null)"
  if [ -z "$pm" ]; then
    echo "DAILY NOTIFY failed: no pmSession in the PM config"
    return 0
  fi
  timeout 30 openchamber session send --session "$pm" --dir /home/daniebo/Desktop/advantage-pr --prompt "$line" >/dev/null 2>&1 || send_rc=$?
  if [ "$send_rc" -eq 124 ]; then
    echo "DAILY NOTIFY failed: the send timed out"
  elif [ "$send_rc" -ne 0 ]; then
    echo "DAILY NOTIFY failed: openchamber exited $send_rc"
  fi
  return 0
}

# The EXIT path. The notice goes last, after the OpenCode job folder cleanup,
# so a signal stop sends its line too.
daily_exit() {
  local rc=$?
  rm -f "$PICK_OUT" "$RUNLIST_OUT" "$CATALOG_TMP" "$SERVED_TMP" "$MSG_FILE" "$RECORD_TMP" "$SELFCHECK_MARKER" 2>/dev/null
  opencode_host_cleanup
  daily_notify "$rc"
}
trap daily_exit EXIT

# ---- Night rule helpers (D22, D26) ----------------------------------------------
# The board length: the length of `models` in the board file. A missing board
# counts as zero, as does a board without a models array.
board_count() {
  node -e '
const fs = require("node:fs");
try {
  const b = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const models = Array.isArray(b && b.models) ? b.models : [];
  process.stdout.write(String(models.length));
} catch { process.stdout.write("0"); }
' "$1"
}

# The local date at job start, and whether it is a Wednesday or a Sunday.
run_day_of() {
  node -e '
const d = new Date(process.argv[1] + "T00:00:00Z");
if (Number.isNaN(d.getTime())) process.exit(1);
const day = d.getUTCDay();
process.stdout.write(day === 0 || day === 3 ? "yes" : "no");
' "$1"
}

# DUE = 4 plus the number of Wednesdays and Sundays after 2026-10-25, up to and
# including the local date.
due_count() {
  node -e '
const fs = require("node:fs");
const end = new Date(process.argv[1] + "T00:00:00Z");
if (Number.isNaN(end.getTime())) process.exit(1);
const day = new Date(Date.UTC(2026, 9, 25));
let count = 0;
for (;;) {
  day.setUTCDate(day.getUTCDate() + 1);
  if (day > end) break;
  const weekday = day.getUTCDay();
  if (weekday === 0 || weekday === 3) count += 1;
}
process.stdout.write(String(4 + count));
' "$1"
}

# D26: a model is on the pick list when `requests_unlimited` is true or
# `requests_per_month` is more than the table minimum, and it holds no
# `superseded_by`.
model_on_list() {
  node -e '
const fs = require("node:fs");
const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const spec = (p.models || {})[process.argv[2]];
if (!spec || typeof spec !== "object") process.exit(1);
if (spec.superseded_by) process.exit(1);
if (spec.requests_unlimited === true) process.exit(0);
const min = p.pick_min_requests_per_month;
const rpm = spec.requests_per_month;
process.exit(typeof min === "number" && Number.isFinite(min) && typeof rpm === "number" && rpm > min ? 0 : 1);
' "$PRICING" "$1"
}

# One notice per model cycle (D27). The send consumes the notice state, so the
# EXIT path does not repeat the line of a finished model.
send_notice() {
  local rc="$1"
  NOTICE_SENT=0
  daily_notify "$rc"
  NOTICE_SENT=1
  PUSH_DONE=0
  PUSH_OLD=""
  PUSH_NEW=""
  PUSH_COMMITS=0
  N_RUNS=0
  SKIP_REASON=""
  LAST_FAIL=""
}

# The model cycle ended. A MAX_MODELS stop ends the job with the D27 line.
after_model() {
  MODELS_RAN=$((MODELS_RAN + 1))
  if [ -n "$MODEL" ]; then EXCLUDED="${EXCLUDED:+$EXCLUDED,}$MODEL"; fi
  if [ "$LIST_MODE" = "1" ] && [ "$MODELS_RAN" -ge "$MAX_MODELS" ]; then
    echo "DAILY STOP max-models $MODELS_RAN"
    echo "DAILY END $(date -Is)"
    exit 0
  fi
}

# No new list model is left. The first cycle is the pinned skip; a later cycle
# is the D27 caught-up stop. The Phase 6 text keeps the older reason.
no_model_end() {
  if [ "$MODELS_RAN" -eq 0 ]; then
    if [ "$LIST_MODE" = "1" ]; then
      echo "DAILY SKIP no high-use model"
      SKIP_REASON="no high-use model"
    else
      echo "DAILY SKIP no eligible model"
      SKIP_REASON="no eligible model"
    fi
    echo "DAILY PUBLISH none"
    echo "DAILY END $(date -Is)"
    exit "$SKIP_RC"
  fi
  echo "DAILY STOP caught up"
  echo "DAILY END $(date -Is)"
  exit 0
}

# ---- Lock ----------------------------------------------------------------------
# The exclusive lock prevents overlap with weekly and daily jobs.
mkdir -p "$(dirname "$LOCK")"
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "DAILY SKIP lock held"
  echo "DAILY END $(date -Is)"
  SKIP_REASON="lock held"
  exit "$SKIP_RC"
fi

# ---- OpenCode host isolation (spec D1, D6, D8) ---------------------------------
# This job owns one OpenCode job folder. The line below is the spec D8 line; a
# dry run prints it too. The traps of spec D6 make the EXIT trap run on signals.
if ! opencode_host_begin daily; then
  daily_fail "opencode-home: the OpenCode job folder could not be made"
  exit 1
fi
echo "DAILY OPENCODE_HOME $BENCH_OPENCODE_HOME"
trap 'exit 130' INT
trap 'exit 143' TERM

# ---- Day record check ----------------------------------------------------------
RECORD="$DAYS_DIR/$DAY.json"
if [ -f "$RECORD" ]; then
  if ! node -e '
const r = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
if (typeof r.date !== "string" || !Array.isArray(r.run_ids)) process.exit(1);
' "$RECORD"; then
    daily_fail "record: $RECORD is not a valid day record"
    exit 2
  fi
fi

# ---- Night rule, heavy path, and pick list mode (D21, D22, D24, D26) ------------
# The catch-up line comes before any catalog fetch (D22). The REST lines of the
# older text are retired by D27: the job runs the loop on every night.
LOCAL_DATE="${BENCH_DAILY_LOCAL_DATE:-$(date +%F)}"
if ! RUN_DAY="$(run_day_of "$LOCAL_DATE")"; then
  daily_fail "date: invalid local date $LOCAL_DATE"
  exit 2
fi
BOARD="${BENCH_DAILY_BOARD:-$ROOT/docs/assets/data/benchmark.json}"
BOARD_N="$(board_count "$BOARD")"
if ! DUE="$(due_count "$LOCAL_DATE")"; then
  daily_fail "date: invalid local date $LOCAL_DATE"
  exit 2
fi
echo "DAILY CATCHUP local=$LOCAL_DATE run_day=$RUN_DAY board=$BOARD_N due=$DUE"

# D24: BENCH_DAILY_HEAVY names the selected path; VITEST selects an empty path;
# otherwise the production path. The job prints the selection once and passes
# both variables to every batch.
if [ -n "${BENCH_DAILY_HEAVY:-}" ]; then
  HEAVY="$BENCH_DAILY_HEAVY"
elif [ -n "${VITEST:-}" ]; then
  HEAVY=""
else
  HEAVY="/home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh"
fi
export BENCH_HEAVY="$HEAVY"
export BENCH_MEM_FLOOR_MB=1500
if [ -n "$HEAVY" ]; then
  echo "DAILY HEAVY $HEAVY"
else
  echo "DAILY HEAVY skipped: test"
fi

# D26: the pick list is active only when the price table declares its minimum.
if node -e '
const p = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
const min = p.pick_min_requests_per_month;
process.exit(typeof min === "number" && Number.isFinite(min) ? 0 : 1);
' "$PRICING" 2>/dev/null; then
  LIST_MODE=1
fi

# ---- Catalog fetch (FR-1, D8) --------------------------------------------------
CATALOG="${BENCH_DAILY_CATALOG:-}"
if [ -z "$CATALOG" ]; then
  CATALOG_PATH="$ROOT/reports/go-catalog-$WEEK.json"
  if ! "$H/node_modules/.bin/tsx" "$H/go-cost.ts" --catalog > "$CATALOG_TMP" || [ ! -s "$CATALOG_TMP" ]; then
    daily_fail "catalog: the catalog fetch failed"
    exit 1
  fi
  if ! node -e '
const c = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
if (!Array.isArray(c.live) || c.live.length === 0 || !c.live.every(x => typeof x === "string")) process.exit(1);
' "$CATALOG_TMP"; then
    daily_fail "catalog: the fetched catalog is empty, not JSON, or has no live models"
    exit 1
  fi
  mv "$CATALOG_TMP" "$CATALOG_PATH"
  CATALOG="$CATALOG_PATH"
elif [ ! -s "$CATALOG" ] || ! node -e '
const c = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
if (!Array.isArray(c.live) || c.live.length === 0 || !c.live.every(x => typeof x === "string")) process.exit(1);
' "$CATALOG"; then
  daily_fail "catalog: $CATALOG is empty, not JSON, or has no live models"
  exit 1
fi

# ---- Served list ---------------------------------------------------------------
SERVED="${BENCH_DAILY_SERVED:-}"
if [ -z "$SERVED" ]; then
  SERVED_PATH="$ROOT/reports/go-served-$WEEK.txt"
  if ! "$H/opencode-credential.sh" seed; then
    daily_fail "served: the Console credential seed failed"
    exit 1
  fi
  # D15/FR-11: retry the served list, the same rule as batch.sh — up to 3
  # calls in total, 5 s apart, while a call exits non-zero or writes an empty
  # list. A non-empty list stops the retry at once.
  served_ok=""
  for attempt in 1 2 3; do
    if opencode_host_run models --standalone > "$SERVED_TMP" && [ -s "$SERVED_TMP" ]; then
      served_ok=1
      break
    fi
    [ "$attempt" -lt 3 ] && sleep 5
  done
  if [ "$served_ok" != "1" ]; then
    daily_fail "served: opencode models failed"
    exit 1
  fi
  mv "$SERVED_TMP" "$SERVED_PATH"
  SERVED="$SERVED_PATH"
elif [ ! -s "$SERVED" ]; then
  daily_fail "served: $SERVED is empty"
  exit 1
fi

# ---- Selection -----------------------------------------------------------------
# A selector seam supports exit-code tests. Production uses daily-pick.ts. The
# job always passes the board file (D23), and the tried models as the exclude
# list of D26.
select_model() {
  SELECT_RC=0
  local pick_args=(--catalog "$CATALOG" --served "$SERVED" --date "$DAY"
    --runs-root "$RUNS_ROOT" --pricing "$PRICING" --day-dir "$DAYS_DIR")
  if [ -n "$BOARD" ]; then pick_args+=(--board "$BOARD"); fi
  if [ -n "$EXCLUDED" ]; then pick_args+=(--exclude "$EXCLUDED"); fi
  if [ -n "${BENCH_DAILY_SELECT:-}" ]; then
    "$BENCH_DAILY_SELECT" "${pick_args[@]}" > "$PICK_OUT" || SELECT_RC=$?
  else
    "$H/node_modules/.bin/tsx" "$H/daily-pick.ts" "${pick_args[@]}" > "$PICK_OUT" || SELECT_RC=$?
  fi
}

# ---- Go quota guard (D12) -------------------------------------------------------
# Read from the seam or from the OpenChamber local endpoint. A live read uses
# only the first instance port and only GET /api/quota/opencode-go.
guard_read() {
  local raw="" rc=0 port="" parse="" weekly_state="" weekly_value="" monthly_state="" monthly_value="" comparison="" comparison_rc=0
  if [ -n "${BENCH_DAILY_QUOTA_CMD:-}" ]; then
    raw="$("$BENCH_DAILY_QUOTA_CMD")" || rc=$?
  else
    local status=""
    status="$(timeout 10s openchamber status --json)" || rc=$?
    if [ "$rc" -eq 0 ]; then
      port="$(printf '%s' "$status" | node -e '
let s = ""; process.stdin.on("data", c => s += c); process.stdin.on("end", () => {
  try {
    const x = JSON.parse(s);
    const p = x.instances?.[0]?.port;
    if ((typeof p === "number" && Number.isInteger(p) && p > 0 && p < 65536)
      || (typeof p === "string" && /^[0-9]+$/.test(p) && Number(p) > 0 && Number(p) < 65536)) process.stdout.write(String(p));
  } catch {}
});
')"
      if [ -z "$port" ]; then rc=1; else
        raw="$(curl --max-time 10 --noproxy '*' -fsS "http://127.0.0.1:$port/api/quota/opencode-go")" || rc=$?
      fi
    fi
  fi
  if [ "$rc" -ne 0 ] || [ -z "${raw//[[:space:]]/}" ]; then
    echo "DAILY SKIP go-guard: read failed"
    GUARD_STOP="read failed"
    return 1
  fi
  parse="$(printf '%s' "$raw" | node -e '
let s = ""; process.stdin.on("data", c => s += c); process.stdin.on("end", () => {
  try {
    const x = JSON.parse(s);
    const w = x?.usage?.windows?.weekly;
    const m = x?.usage?.windows?.monthly;
    const state = value => {
      if (!value || !Object.prototype.hasOwnProperty.call(value, "usedPercent") || value.usedPercent === null) return ["missing", ""];
      if (typeof value.usedPercent !== "number" || !Number.isFinite(value.usedPercent)) return ["invalid", ""];
      return ["valid", JSON.stringify(value.usedPercent)];
    };
    const [ws, wv] = state(w);
    const [ms, mv] = state(m);
    process.stdout.write([ws, wv, ms, mv].join("\t"));
  } catch { process.stdout.write("read-failed"); }
});
')" || parse="read-failed"
  case "$parse" in
    read-failed)
      echo "DAILY SKIP go-guard: read failed"
      GUARD_STOP="read failed"
      return 1
      ;;
  esac
  IFS=$'\t' read -r weekly_state weekly_value monthly_state monthly_value <<< "$parse"
  case "$weekly_state" in
    missing)
      echo "DAILY SKIP go-guard: missing field"
      GUARD_STOP="missing field"
      return 1
      ;;
    invalid)
      echo "DAILY SKIP go-guard: not a number"
      GUARD_STOP="not a number"
      return 1
      ;;
    valid) ;;
    *)
      echo "DAILY SKIP go-guard: read failed"
      GUARD_STOP="read failed"
      return 1
      ;;
  esac
  comparison_rc=0
  comparison="$(DAILY_GUARD_VALUE="$weekly_value" node -e '
const n = Number(process.env.DAILY_GUARD_VALUE);
if (!Number.isFinite(n)) process.exit(88);
if (n < 0) { process.stdout.write("below-zero"); process.exit(1); }
if (n > 80) { process.stdout.write("above-80"); process.exit(2); }
process.stdout.write("within");
' )" || comparison_rc=$?
  if [ "$comparison_rc" -eq 1 ] && [ "$comparison" = "below-zero" ]; then
    echo "DAILY SKIP go-guard: weekly value $weekly_value is below 0"
    GUARD_STOP="weekly value $weekly_value is below 0"
    return 1
  fi
  if [ "$comparison_rc" -eq 2 ] && [ "$comparison" = "above-80" ]; then
    echo "DAILY SKIP go-guard: weekly used $weekly_value percent"
    GUARD_STOP="weekly used $weekly_value percent"
    return 1
  fi
  if [ "$comparison_rc" -ne 0 ] || [ "$comparison" != "within" ]; then
    echo "DAILY SKIP go-guard: read failed"
    GUARD_STOP="read failed"
    return 1
  fi
  case "$monthly_state" in
    missing)
      echo "DAILY SKIP go-guard: monthly missing field"
      GUARD_STOP="monthly missing field"
      return 1
      ;;
    invalid)
      echo "DAILY SKIP go-guard: monthly not a number"
      GUARD_STOP="monthly not a number"
      return 1
      ;;
    valid) ;;
    *)
      echo "DAILY SKIP go-guard: read failed"
      GUARD_STOP="read failed"
      return 1
      ;;
  esac
  # D18, amended on 2026-11-15: the monthly stop is "at or above 100".
  comparison_rc=0
  comparison="$(DAILY_GUARD_VALUE="$monthly_value" node -e '
const n = Number(process.env.DAILY_GUARD_VALUE);
if (!Number.isFinite(n)) process.exit(88);
if (n < 0) { process.stdout.write("below-zero"); process.exit(1); }
if (n >= 100) { process.stdout.write("at-or-above-100"); process.exit(2); }
process.stdout.write("within");
' )" || comparison_rc=$?
  if [ "$comparison_rc" -eq 1 ] && [ "$comparison" = "below-zero" ]; then
    echo "DAILY SKIP go-guard: monthly value $monthly_value is below 0"
    GUARD_STOP="monthly value $monthly_value is below 0"
    return 1
  fi
  if [ "$comparison_rc" -eq 2 ] && [ "$comparison" = "at-or-above-100" ]; then
    echo "DAILY SKIP go-guard: monthly used $monthly_value percent"
    GUARD_STOP="monthly used $monthly_value percent"
    return 1
  fi
  if [ "$comparison_rc" -ne 0 ] || [ "$comparison" != "within" ]; then
    echo "DAILY SKIP go-guard: read failed"
    GUARD_STOP="read failed"
    return 1
  fi
  echo "DAILY GO-GUARD weekly=$weekly_value monthly=$monthly_value"
  return 0
}

# ---- The catch-up loop (D22, D26, D27) -------------------------------------------
# One job run repeats the model cycle while a new list model exists, the guard
# passes before the model, the local time is before the last start, and fewer
# than the maximum number of models ran.
while :; do
  select_model
  if [ "$SELECT_RC" -eq 3 ]; then
    no_model_end
  fi
  if [ "$SELECT_RC" -ne 0 ]; then
    daily_fail "pick: the selector exited $SELECT_RC"
    exit "$SELECT_RC"
  fi
  MODEL="$(node -e '
process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).model ?? ""));
' "$PICK_OUT")"
  NEW_FLAG="$(node -e '
process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).new === true ? "yes" : "no");
' "$PICK_OUT")"
  if [ -z "$MODEL" ]; then
    daily_fail "pick: the selector returned no model with exit 0"
    exit 2
  fi
  NOTICE_SENT=0
  # The safety net of D26: a pick that ignores the exclude list never runs a
  # model twice in one job run.
  case ",$EXCLUDED," in
    *",$MODEL,"*) no_model_end ;;
  esac
  if [ "$LIST_MODE" = "1" ]; then
    if [ "$MODELS_RAN" -ge "$MAX_MODELS" ]; then
      echo "DAILY STOP max-models $MODELS_RAN"
      echo "DAILY END $(date -Is)"
      exit 0
    fi
    NOW="${BENCH_DAILY_NOW:-$(date +%H:%M)}"
    if [[ ! "$NOW" < "$LAST_START" ]]; then
      echo "DAILY STOP last-start $LAST_START"
      echo "DAILY END $(date -Is)"
      exit 0
    fi
    # D26: the chosen model must be on the pick list. The job never falls back
    # to a model outside the list.
    if ! model_on_list "$MODEL"; then
      echo "DAILY SKIP not high-use: $MODEL"
      SKIP_REASON="not high-use: $MODEL"
      echo "DAILY END $(date -Is)"
      exit "$SKIP_RC"
    fi
  fi
  if [ -n "$HEAVY" ] && [ ! -x "$HEAVY" ]; then
    daily_fail "heavy: heavy-run.sh is missing"
    echo "DAILY END $(date -Is)"
    exit 2
  fi

  # ---- Dry run -----------------------------------------------------------------
  # One guard read precedes the four planned batch dry runs. It never calls a model.
  if [ "$DRY_RUN" = "1" ]; then
    GUARD_STOP=""
    if ! guard_read; then
      echo "DAILY DRY-RUN planned=0"
      echo "DAILY END $(date -Is)"
      exit 0
    fi
    PLANNED=0
    for track in build bugfix tests change; do
      track_out="$(BENCH_TRACK="$track" "$BATCH" --dry-run --model "$MODEL" 2>&1)" || {
        daily_fail "dry-run: the $track batch dry run failed"
        exit 1
      }
      printf '%s\n' "$track_out"
      track_n="$(printf '%s\n' "$track_out" | grep -c 'DRY-RUN START')"
      PLANNED=$((PLANNED + track_n))
    done
    echo "DAILY DRY-RUN planned=$PLANNED"
    echo "DAILY END $(date -Is)"
    exit 0
  fi

  # ---- Day record before the first batch (FR-6, D12) ----------------------------
  # A resume keeps the original selection facts. Only run_ids and runner_exit
  # change during the run; go_guard_stop records the current day's stop reason.
  # The D27 models array keeps one entry per model of the day.
  mkdir -p "$DAYS_DIR"
  if [ -f "$RECORD" ]; then
    node -e '
const fs = require("node:fs");
const rec = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
rec.run_ids = [];
rec.runner_exit = null;
rec.go_guard_stop = null;
if (process.argv[3] === "1" && !Array.isArray(rec.models)) rec.models = [];
fs.writeFileSync(process.argv[2], JSON.stringify(rec, null, 2) + "\n");
' "$RECORD" "$RECORD_TMP" "$LIST_MODE" && mv "$RECORD_TMP" "$RECORD"
  else
    node -e '
const fs = require("node:fs");
const pick = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
pick.run_ids = [];
pick.runner_exit = null;
pick.go_guard_stop = null;
if (process.argv[3] === "1") pick.models = [];
fs.writeFileSync(process.argv[2], JSON.stringify(pick, null, 2) + "\n");
' "$PICK_OUT" "$RECORD_TMP" "$LIST_MODE" && mv "$RECORD_TMP" "$RECORD"
  fi

  # ---- Pre-batch post steps (D12 steps 1 to 3) ----------------------------------
  if [ "$POST" != "0" ]; then
    cd "$H"
    # The grader browser is the system Chrome (spec D4). The Playwright chrome
    # channel uses /opt/google/chrome/chrome on Linux. The check tests that the
    # binary exists and runs. It tests no version, so the live day does not wait
    # for the Chrome update.
    PW_CHROME="${BENCH_SYSTEM_CHROME:-/opt/google/chrome/chrome}"
    if [ ! -x "$PW_CHROME" ] || ! "$PW_CHROME" --version >/dev/null 2>&1; then
      daily_fail "playwright: the system Chrome is missing or does not run at $PW_CHROME"
      exit 2
    fi
    PRICE_SHA="$(sha256sum "$H/go-pricing.json" | cut -d' ' -f1)"
    PRICE_MARKER="$ROOT/reports/go-pricing.sha"
    if [ ! -f "$PRICE_MARKER" ] || [ "$(cat "$PRICE_MARKER")" != "$PRICE_SHA" ]; then
      ./recost.sh
    fi
    mkdir -p "$ROOT/reports"
    printf '%s\n' "$PRICE_SHA" > "$PRICE_MARKER"
    HASHES="$("$H/node_modules/.bin/tsx" "$H/provenance.ts" --shell)"
    HASH_MARKER="$ROOT/reports/harness-hashes.sha"
    if [ ! -f "$HASH_MARKER" ] || [ "$(cat "$HASH_MARKER")" != "$HASHES" ]; then
      WEEK=all ./rescore-doctor.sh
    fi
    printf '%s\n' "$HASHES" > "$HASH_MARKER"
  fi

  # ---- Four guarded track batches (D12 step 4) ----------------------------------
  RUNNER_EXIT=0
  GUARD_STOP=""
  export BENCH_SELFCHECK_MARKER="$SELFCHECK_MARKER"
  rm -f "$BENCH_SELFCHECK_MARKER"
  for track in build bugfix tests change; do
    if ! guard_read; then
      break
    fi
    BENCH_TRACK="$track" "$BATCH" --model "$MODEL"
    BATCH_RC=$?
    if [ "$BATCH_RC" -ne 0 ] && [ "$RUNNER_EXIT" -eq 0 ]; then
      RUNNER_EXIT="$BATCH_RC"
      # The first failed batch gives the reason of the FAIL notice (D17).
      daily_fail "runner: the $track batch exited $BATCH_RC"
      # D27: a failed batch stops the tracks of this model; the next model or
      # the harness failure decides the job.
      if [ "$LIST_MODE" = "1" ]; then break; fi
    fi
  done
  echo "DAILY RUNNER exit=$RUNNER_EXIT"

  # ---- Post-batch steps (D12 steps 5 to 9) --------------------------------------
  if [ "$POST" != "0" ]; then
    cd "$H"
    WEEK="$WEEK" ./rescore-doctor.sh
    ./recost.sh
    python3 "$H/export-site-data.py"
    python3 "$H/generate-model-pages.py"
    ./cleanup.sh
  fi

  # ---- Run list ------------------------------------------------------------------
  RL_RC=0
  "$H/node_modules/.bin/tsx" "$H/daily-pick.ts" \
    --day-runs "$MODEL" --week "$WEEK" --runs-root "$RUNS_ROOT" --pricing "$PRICING" \
    > "$RUNLIST_OUT" || RL_RC=$?
  if [ "$RL_RC" -ne 0 ]; then
    daily_fail "run-list: the run list exited $RL_RC"
    exit 1
  fi
  N_RUNS="$(node -e 'process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).length));' "$RUNLIST_OUT")"
  echo "DAILY RUNS $N_RUNS"

  # ---- Day record after the batches ----------------------------------------------
  node -e '
const fs = require("node:fs");
const rec = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const ids = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const exitText = process.argv[3];
const guardText = process.argv[4] || null;
rec.runner_exit = Number(exitText);
rec.go_guard_stop = guardText;
if (process.argv[6] === "1") {
  const pick = JSON.parse(fs.readFileSync(process.argv[7], "utf8"));
  const reason = pick.reason === "resume" ? (rec.reason ?? null) : (pick.reason ?? null);
  const entry = { model: pick.model ?? rec.model ?? null, reason, run_ids: ids,
    runner_exit: Number(exitText), go_guard_stop: guardText };
  const models = Array.isArray(rec.models) ? rec.models.slice() : [];
  const last = models.length - 1;
  if (last >= 0 && models[last].model === entry.model) { models[last] = entry; } else { models.push(entry); }
  rec.models = models;
  const all = [];
  for (const row of models) {
    for (const id of (Array.isArray(row.run_ids) ? row.run_ids : [])) {
      if (!all.includes(id)) all.push(id);
    }
  }
  rec.run_ids = all;
} else {
  rec.run_ids = ids;
}
fs.writeFileSync(process.argv[5], JSON.stringify(rec, null, 2) + "\n");
' "$RECORD" "$RUNLIST_OUT" "$RUNNER_EXIT" "$GUARD_STOP" "$RECORD_TMP" "$LIST_MODE" "$PICK_OUT" && mv "$RECORD_TMP" "$RECORD"

  # ---- Failure and skip decisions (D19, D27) -------------------------------------
  if [ "$RUNNER_EXIT" -ne 0 ]; then
    if [ "$LIST_MODE" = "1" ] && [ "$N_RUNS" -gt 0 ]; then
      # A model-level failure: one FAIL notice, and the loop goes on.
      daily_fail "model: $MODEL produced no valid run"
      echo "DAILY PUBLISH none"
      send_notice "$RUNNER_EXIT"
      after_model
      continue
    fi
    echo "DAILY PUBLISH none"
    if [ "$LIST_MODE" = "1" ]; then
      # A harness-level failure: one FAIL notice and the job stops.
      send_notice "$RUNNER_EXIT"
      echo "DAILY END $(date -Is)"
      exit 1
    fi
    echo "DAILY END $(date -Is)"
    exit "$RUNNER_EXIT"
  fi
  if [ "$N_RUNS" -eq 0 ] && [ -z "$GUARD_STOP" ]; then
    daily_fail "runs: the runner produced no runs"
    echo "DAILY PUBLISH none"
    if [ "$LIST_MODE" = "1" ]; then
      send_notice 1
      echo "DAILY END $(date -Is)"
      exit 1
    fi
    echo "DAILY END $(date -Is)"
    exit 1
  fi
  # A guard stop is a skip (D19). It still runs the publish below (D15), also
  # when it stops before the first batch.
  if [ -n "$GUARD_STOP" ]; then
    SKIP_REASON="go-guard $GUARD_STOP"
  fi
  if [ "$PUBLISH" = "0" ]; then
    echo "DAILY PUBLISH skipped"
    if [ "$LIST_MODE" = "1" ]; then
      if [ -n "$SKIP_REASON" ]; then
        send_notice 3
        echo "DAILY END $(date -Is)"
        exit 3
      fi
      after_model
      echo "DAILY END $(date -Is)"
      exit 0
    fi
    echo "DAILY END $(date -Is)"
    if [ -n "$SKIP_REASON" ]; then exit 3; fi
    exit 0
  fi

# ---- Publish (FR-8, D10, D15, D16) --------------------------------------------
# This section sits at column 0 inside the loop: case 6.4.3 pins the exact
# text of the three commands below.
cd "$ROOT"
git add docs/
if git diff --cached --quiet -- docs/; then
  echo "DAILY PUBLISH none"
  if [ -z "$SKIP_REASON" ]; then SKIP_REASON="no docs change"; fi
  if [ "$LIST_MODE" = "1" ]; then
    send_notice 3
    echo "DAILY END $(date -Is)"
    exit 3
  fi
  echo "DAILY END $(date -Is)"
  exit 3
fi

# The publish runs on main only. A detached HEAD counts as the branch `detached`.
BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || true)"
if [ -z "$BRANCH" ]; then BRANCH="detached"; fi
if [ "$BRANCH" != "main" ]; then
  daily_fail "publish: the branch is $BRANCH, not main"
  echo "DAILY END $(date -Is)"
  exit 1
fi

# The body reports excluded models from the full day record, including on resume.
# A guard stop with zero runs gets the one-line message of D15.
node -e '
const fs = require("node:fs");
const record = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const pick = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (Number(process.argv[4]) === 0 && process.argv[5]) {
fs.writeFileSync(process.argv[3], "Publish daily " + record.date + " site data: no new runs (go-guard: " + process.argv[5] + ").\n");
process.exit(0);
}
const reason = pick.reason === "resume" ? "resume" : record.reason;
const lines = ["Publish daily " + record.date + " OpenCode Go results: " + record.model + " (" + reason + ").", ""];
const ex = record.excluded ?? {};
for (const key of ["unpriced", "gone", "unservable"]) {
if ((ex[key] ?? []).length) lines.push(key.charAt(0).toUpperCase() + key.slice(1) + ": " + ex[key].join(", "));
}
fs.writeFileSync(process.argv[3], lines.join("\n") + "\n");
' "$RECORD" "$PICK_OUT" "$MSG_FILE" "$N_RUNS" "$GUARD_STOP"
if ! git commit -F "$MSG_FILE" -- docs/; then
  daily_fail "publish: the commit of docs/ failed"
  echo "DAILY PUBLISH none"
  echo "DAILY END $(date -Is)"
  exit 1
fi

# The push is a fast-forward (D16). It carries every local commit between
# origin/main and the docs commit, and it never forces.
DOCS_SHA="$(git rev-parse HEAD)"
if ! git fetch origin; then
  daily_fail "push: fetch failed; the commit is local"
  echo "DAILY END $(date -Is)"
  exit 1
fi
REMOTE_SHA="$(git rev-parse --verify origin/main 2>/dev/null || true)"
if [ -z "$REMOTE_SHA" ] || ! git merge-base --is-ancestor "$REMOTE_SHA" "$DOCS_SHA"; then
  daily_fail "push: origin/main is not an ancestor of the docs commit; the commit is local"
  echo "DAILY END $(date -Is)"
  exit 1
fi
PUSHED=""
for _ in 1 2 3; do
  if git push origin "${DOCS_SHA}:main"; then PUSHED=1; break; fi
  sleep 60
  done
  if [ -z "$PUSHED" ]; then
    daily_fail "publish: git push failed after 3 attempts; the commit is local"
    echo "DAILY END $(date -Is)"
    exit 1
  fi
  PUSH_OLD="$(git rev-parse --short "$REMOTE_SHA")"
  PUSH_NEW="$(git rev-parse --short "$DOCS_SHA")"
  PUSH_COMMITS="$(git rev-list --count "$REMOTE_SHA..$DOCS_SHA")"
  PUSH_DONE=1
  echo "DAILY PUSH $PUSH_OLD..$PUSH_NEW commits=$PUSH_COMMITS"
  echo "DAILY PUBLISH $PUSH_NEW"
  if [ -n "$SKIP_REASON" ]; then
    if [ "$LIST_MODE" = "1" ]; then
      send_notice 3
      echo "DAILY END $(date -Is)"
      exit 3
    fi
    echo "DAILY END $(date -Is)"
    exit 3
  fi
  if [ "$LIST_MODE" = "1" ]; then
    # One PUBLISH notice per model, then the next model of the day.
    send_notice 0
    after_model
    continue
  fi
  echo "DAILY END $(date -Is)"
  exit 0
done
