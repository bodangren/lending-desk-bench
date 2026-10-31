#!/usr/bin/env bash
# Daily model schedule (track daily_model_schedule): refresh the model list,
# pick one model, guard each batch, and publish the site data.
# The selector lives in harness/daily-pick.ts. The job owns writes and publishes.
#
# The schedule uses harness/systemd/lending-desk-daily.timer with Persistent=false.
# The matching service is harness/systemd/lending-desk-daily.service.
# Do not install these units in this track.
# The timer runs Wednesday and Sunday at 01:00 local time. Each day is a UTC date.
# The job publishes only docs/ and pushes only its own docs commit at its parent.
#
# Test seams: BENCH_RUNS_ROOT, BENCH_PRICING_PATH, BENCH_DAILY_DIR,
# BENCH_DAILY_DATE, BENCH_DAILY_CATALOG, BENCH_DAILY_SERVED,
# BENCH_DAILY_PUBLISH, BENCH_DAILY_LOCK, BENCH_DAILY_QUOTA_CMD,
# BENCH_DAILY_BATCH, BENCH_DAILY_POST, and BENCH_DAILY_SELECT.
# BENCH_DAILY_RUNNER is retired and is never started. Dry runs write no day
# record and make no model call.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
H="$ROOT/harness"

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
DRY_RUN=0
case " $* " in
  *" --dry-run "*) DRY_RUN=1 ;;
esac

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
  echo "DAILY FAIL toolchain: invalid date $DAY" >&2
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
trap 'rm -f "$PICK_OUT" "$RUNLIST_OUT" "$CATALOG_TMP" "$SERVED_TMP" "$MSG_FILE" "$RECORD_TMP" "$SELFCHECK_MARKER" 2>/dev/null' EXIT

# ---- Lock ----------------------------------------------------------------------
# The exclusive lock prevents overlap with weekly and daily jobs.
mkdir -p "$(dirname "$LOCK")"
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "DAILY SKIP lock held"
  echo "DAILY END $(date -Is)"
  exit 0
fi

# ---- Day record check ----------------------------------------------------------
RECORD="$DAYS_DIR/$DAY.json"
if [ -f "$RECORD" ]; then
  if ! node -e '
const r = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
if (typeof r.date !== "string" || !Array.isArray(r.run_ids)) process.exit(1);
' "$RECORD"; then
    echo "DAILY FAIL record: $RECORD is not a valid day record" >&2
    exit 2
  fi
fi

# ---- Catalog fetch (FR-1, D8) --------------------------------------------------
CATALOG="${BENCH_DAILY_CATALOG:-}"
if [ -z "$CATALOG" ]; then
  CATALOG_PATH="$ROOT/reports/go-catalog-$WEEK.json"
  if ! "$H/node_modules/.bin/tsx" "$H/go-cost.ts" --catalog > "$CATALOG_TMP" || [ ! -s "$CATALOG_TMP" ]; then
    echo "DAILY FAIL catalog: the catalog fetch failed" >&2
    exit 1
  fi
  if ! node -e '
const c = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
if (!Array.isArray(c.live) || c.live.length === 0 || !c.live.every(x => typeof x === "string")) process.exit(1);
' "$CATALOG_TMP"; then
    echo "DAILY FAIL catalog: the fetched catalog is empty, not JSON, or has no live models" >&2
    exit 1
  fi
  mv "$CATALOG_TMP" "$CATALOG_PATH"
  CATALOG="$CATALOG_PATH"
elif [ ! -s "$CATALOG" ] || ! node -e '
const c = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
if (!Array.isArray(c.live) || c.live.length === 0 || !c.live.every(x => typeof x === "string")) process.exit(1);
' "$CATALOG"; then
  echo "DAILY FAIL catalog: $CATALOG is empty, not JSON, or has no live models" >&2
  exit 1
fi

# ---- Served list ---------------------------------------------------------------
SERVED="${BENCH_DAILY_SERVED:-}"
if [ -z "$SERVED" ]; then
  SERVED_PATH="$ROOT/reports/go-served-$WEEK.txt"
  if ! opencode models > "$SERVED_TMP" || [ ! -s "$SERVED_TMP" ]; then
    echo "DAILY FAIL served: opencode models failed" >&2
    exit 1
  fi
  mv "$SERVED_TMP" "$SERVED_PATH"
  SERVED="$SERVED_PATH"
elif [ ! -s "$SERVED" ]; then
  echo "DAILY FAIL served: $SERVED is empty" >&2
  exit 1
fi

# ---- Selection -----------------------------------------------------------------
# A selector seam supports exit-code tests. Production uses daily-pick.ts.
SELECT_RC=0
if [ -n "${BENCH_DAILY_SELECT:-}" ]; then
  "$BENCH_DAILY_SELECT" \
    --catalog "$CATALOG" --served "$SERVED" --date "$DAY" \
    --runs-root "$RUNS_ROOT" --pricing "$PRICING" --day-dir "$DAYS_DIR" \
    > "$PICK_OUT" || SELECT_RC=$?
else
  "$H/node_modules/.bin/tsx" "$H/daily-pick.ts" \
    --catalog "$CATALOG" --served "$SERVED" --date "$DAY" \
    --runs-root "$RUNS_ROOT" --pricing "$PRICING" --day-dir "$DAYS_DIR" \
    > "$PICK_OUT" || SELECT_RC=$?
fi
if [ "$SELECT_RC" -ne 0 ] && [ "$SELECT_RC" -ne 3 ]; then
  echo "DAILY FAIL pick: the selector exited $SELECT_RC" >&2
  exit "$SELECT_RC"
fi

if [ "$SELECT_RC" -eq 3 ]; then
  echo "DAILY PUBLISH none"
  echo "DAILY END $(date -Is)"
  exit 0
fi
MODEL="$(node -e '
process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).model ?? ""));
' "$PICK_OUT")"
if [ -z "$MODEL" ]; then
  echo "DAILY FAIL pick: the selector returned no model with exit 0" >&2
  exit 2
fi

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
  comparison_rc=0
  comparison="$(DAILY_GUARD_VALUE="$monthly_value" node -e '
const n = Number(process.env.DAILY_GUARD_VALUE);
if (!Number.isFinite(n)) process.exit(88);
if (n < 0) { process.stdout.write("below-zero"); process.exit(1); }
if (n > 80) { process.stdout.write("above-80"); process.exit(2); }
process.stdout.write("within");
' )" || comparison_rc=$?
  if [ "$comparison_rc" -eq 1 ] && [ "$comparison" = "below-zero" ]; then
    echo "DAILY SKIP go-guard: monthly value $monthly_value is below 0"
    GUARD_STOP="monthly value $monthly_value is below 0"
    return 1
  fi
  if [ "$comparison_rc" -eq 2 ] && [ "$comparison" = "above-80" ]; then
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

# ---- Dry run -------------------------------------------------------------------
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
      echo "DAILY FAIL dry-run: the $track batch dry run failed" >&2
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

# ---- Day record before the first batch (FR-6, D12) ------------------------------
# A resume keeps the original selection facts. Only run_ids and runner_exit
# change during the run; go_guard_stop records the current day's stop reason.
mkdir -p "$DAYS_DIR"
if [ -f "$RECORD" ]; then
  node -e '
const fs = require("node:fs");
const rec = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
rec.run_ids = [];
rec.runner_exit = null;
rec.go_guard_stop = null;
fs.writeFileSync(process.argv[2], JSON.stringify(rec, null, 2) + "\n");
' "$RECORD" "$RECORD_TMP" && mv "$RECORD_TMP" "$RECORD"
else
  node -e '
const fs = require("node:fs");
const pick = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
pick.run_ids = [];
pick.runner_exit = null;
pick.go_guard_stop = null;
fs.writeFileSync(process.argv[2], JSON.stringify(pick, null, 2) + "\n");
' "$PICK_OUT" "$RECORD_TMP" && mv "$RECORD_TMP" "$RECORD"
fi

# ---- Pre-batch post steps (D12 steps 1 to 3) ------------------------------------
if [ "$POST" != "0" ]; then
  cd "$H"
  PW_CHROME="$HOME/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell"
  if [ ! -x "$PW_CHROME" ] && ! ls "$HOME"/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell >/dev/null 2>&1; then
    echo "DAILY FAIL playwright: Chromium is missing" >&2
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

# ---- Four guarded track batches (D12 step 4) ------------------------------------
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
  fi
done
echo "DAILY RUNNER exit=$RUNNER_EXIT"

# ---- Post-batch steps (D12 steps 5 to 9) ----------------------------------------
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
  echo "DAILY FAIL run-list: the run list exited $RL_RC" >&2
  exit 1
fi
N_RUNS="$(node -e 'process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).length));' "$RUNLIST_OUT")"
echo "DAILY RUNS $N_RUNS"

# ---- Day record after the batches -----------------------------------------------
node -e '
const fs = require("node:fs");
const rec = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
rec.run_ids = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
rec.runner_exit = Number(process.argv[3]);
rec.go_guard_stop = process.argv[4] || null;
fs.writeFileSync(process.argv[5], JSON.stringify(rec, null, 2) + "\n");
' "$RECORD" "$RUNLIST_OUT" "$RUNNER_EXIT" "$GUARD_STOP" "$RECORD_TMP" && mv "$RECORD_TMP" "$RECORD"

# A guard stop is a clean skip, even when it stops before the first batch.
if [ "$RUNNER_EXIT" -ne 0 ]; then
  echo "DAILY PUBLISH none"
  echo "DAILY END $(date -Is)"
  exit "$RUNNER_EXIT"
fi
if [ "$N_RUNS" -eq 0 ]; then
  if [ -n "$GUARD_STOP" ]; then
    echo "DAILY PUBLISH none"
    echo "DAILY END $(date -Is)"
    exit 0
  fi
  echo "DAILY FAIL runs: the runner produced no runs" >&2
  echo "DAILY PUBLISH none"
  echo "DAILY END $(date -Is)"
  exit 1
fi
if [ "$PUBLISH" = "0" ]; then
  echo "DAILY PUBLISH skipped"
  echo "DAILY END $(date -Is)"
  exit 0
fi

# ---- Publish (FR-8, D10, D13) ---------------------------------------------------
cd "$ROOT"
git add docs/
if git diff --cached --quiet -- docs/; then
  echo "DAILY PUBLISH none"
  echo "DAILY END $(date -Is)"
  exit 0
fi

# The body reports excluded models from the full day record, including on resume.
node -e '
const fs = require("node:fs");
const record = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const pick = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const reason = pick.reason === "resume" ? "resume" : record.reason;
const lines = ["Publish daily " + record.date + " OpenCode Go results: " + record.model + " (" + reason + ").", ""];
const ex = record.excluded ?? {};
for (const key of ["unpriced", "gone", "unservable"]) {
  if ((ex[key] ?? []).length) lines.push(key.charAt(0).toUpperCase() + key.slice(1) + ": " + ex[key].join(", "));
}
fs.writeFileSync(process.argv[3], lines.join("\n") + "\n");
' "$RECORD" "$PICK_OUT" "$MSG_FILE"
if ! git commit -F "$MSG_FILE" -- docs/; then
  echo "DAILY FAIL publish: the commit of docs/ failed" >&2
  echo "DAILY PUBLISH none"
  echo "DAILY END $(date -Is)"
  exit 1
fi

DOCS_SHA="$(git rev-parse HEAD)"
PARENT_SHA="$(git rev-parse HEAD^ )"
if ! git fetch origin; then
  echo "DAILY PUSH skipped: fetch failed"
  echo "DAILY PUBLISH skipped"
  echo "DAILY END $(date -Is)"
  exit 0
fi
REMOTE_SHA="$(git rev-parse --verify origin/main 2>/dev/null || true)"
if [ -z "$REMOTE_SHA" ] || [ "$REMOTE_SHA" != "$PARENT_SHA" ]; then
  OTHER_LOCAL="$(git rev-list --count origin/main..HEAD~1 2>/dev/null || echo 0)"
  if [ "$OTHER_LOCAL" -ge 1 ]; then
    echo "DAILY PUSH skipped: $OTHER_LOCAL other local commits"
  else
    echo "DAILY PUSH skipped: origin/main moved"
  fi
  echo "DAILY PUBLISH skipped"
  echo "DAILY END $(date -Is)"
  exit 0
fi
PUSHED=""
for _ in 1 2 3; do
  if git push origin "${DOCS_SHA}:main"; then PUSHED=1; break; fi
  sleep 60
done
if [ -z "$PUSHED" ]; then
  echo "DAILY FAIL publish: git push failed after 3 attempts; the commit is local" >&2
  exit 1
fi
echo "DAILY PUBLISH $(git rev-parse --short "$DOCS_SHA")"
echo "DAILY END $(date -Is)"
