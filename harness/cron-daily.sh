#!/usr/bin/env bash
# Daily model schedule (track daily_model_schedule): refresh the model list,
# pick one model — untested first, then the stalest — run it through the
# weekly path, and publish the site data. The selection rule lives in
# harness/daily-pick.ts; this script owns every write and every publish.
#
#   0 1 * * * /home/daniebo/Desktop/lending-desk-bench/harness/cron-daily.sh \
#     >> /home/daniebo/Desktop/lending-desk-bench/reports/cron-daily.log 2>&1
#
# The crontab line waits for the owner decision O1 (spec.md); this track does
# not install it. Each day is a UTC date. runs/ and reports/ are gitignored;
# only docs/ (the Pages site) is published, and only when the runner passed.
#
# Test seams (spec NFR-6): BENCH_RUNS_ROOT, BENCH_PRICING_PATH,
# BENCH_DAILY_DIR, BENCH_DAILY_DATE, BENCH_DAILY_CATALOG, BENCH_DAILY_SERVED,
# BENCH_DAILY_RUNNER (default harness/weekly.sh), BENCH_DAILY_PUBLISH (0
# skips the commit and the push), BENCH_DAILY_LOCK (default the shared
# .tmp/weekly-cron.lock of the weekly cron). Without them the job uses the
# real paths. A dry run writes no day record and calls no runner.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
H="$ROOT/harness"

# ---- Toolchain -----------------------------------------------------------------
# FR-9: under the crontab PATH, node resolves to the snap dispatcher, which
# breaks tsx. Fall back to the operator nvm toolchain when node is missing or
# is the snap dispatcher.
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
RUNNER="${BENCH_DAILY_RUNNER:-$H/weekly.sh}"
PUBLISH="${BENCH_DAILY_PUBLISH:-1}"
DRY_RUN=0
case " $* " in
  *" --dry-run "*) DRY_RUN=1 ;;
esac

# The ISO week token of the day; the runner and the batch runs carry it.
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
trap 'rm -f "$PICK_OUT" "$RUNLIST_OUT" "$CATALOG_TMP" "$SERVED_TMP" "$MSG_FILE" "$RECORD_TMP" 2>/dev/null' EXIT

# ---- Lock ----------------------------------------------------------------------
# The shared lock of the weekly cron (D9): the daily job and a weekly run
# never run at the same time. A held lock is a clean skip, not a failure.
mkdir -p "$(dirname "$LOCK")"
exec 9>"$LOCK"
if ! flock -n -s 9; then
  echo "DAILY SKIP lock held"
  echo "DAILY END $(date -Is)"
  exit 0
fi

# ---- Day record check ----------------------------------------------------------
# A broken record must stop the job before any new selection or run (FR-6).
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
# Each fetch goes to a temporary file and moves into place only on success, so
# a failed fetch never leaves an empty or partial list behind (EV2).
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
else
  if [ ! -s "$CATALOG" ] || ! node -e '
const c = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
if (!Array.isArray(c.live) || c.live.length === 0 || !c.live.every(x => typeof x === "string")) process.exit(1);
' "$CATALOG"; then
    echo "DAILY FAIL catalog: $CATALOG is empty, not JSON, or has no live models" >&2
    exit 1
  fi
fi

# ---- Served list ----------------------------------------------------------------
SERVED="${BENCH_DAILY_SERVED:-}"
if [ -z "$SERVED" ]; then
  SERVED_PATH="$ROOT/reports/go-served-$WEEK.txt"
  if ! opencode models > "$SERVED_TMP" || [ ! -s "$SERVED_TMP" ]; then
    echo "DAILY FAIL served: opencode models failed" >&2
    exit 1
  fi
  mv "$SERVED_TMP" "$SERVED_PATH"
  SERVED="$SERVED_PATH"
else
  if [ ! -s "$SERVED" ]; then
    echo "DAILY FAIL served: $SERVED is empty" >&2
    exit 1
  fi
fi

# ---- Selection -------------------------------------------------------------------
# The selector prints the DAILY_PICK line on stderr exactly once and the full
# JSON object on stdout. Exit 2 is an input fault, exit 3 is no eligible model.
SELECT_RC=0
"$H/node_modules/.bin/tsx" "$H/daily-pick.ts" \
  --catalog "$CATALOG" --served "$SERVED" --date "$DAY" \
  --runs-root "$RUNS_ROOT" --pricing "$PRICING" --day-dir "$DAYS_DIR" \
  > "$PICK_OUT" || SELECT_RC=$?
if [ "$SELECT_RC" -eq 2 ] || [ "$SELECT_RC" -gt 3 ]; then
  echo "DAILY FAIL pick: the selector exited $SELECT_RC" >&2
  exit "$SELECT_RC"
fi

MODEL="$(node -e '
process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).model ?? ""));
' "$PICK_OUT")"

if [ "$SELECT_RC" -eq 3 ] || [ -z "$MODEL" ]; then
  # Rule 6: no candidate is eligible. Run no model, publish nothing.
  echo "DAILY PUBLISH none"
  echo "DAILY END $(date -Is)"
  exit 0
fi

# ---- Dry run ---------------------------------------------------------------------
# The planned run ids of the day's model on the four tracks, then the count.
# No day record, nothing under reports/, no runner call.
if [ "$DRY_RUN" = "1" ]; then
  PLANNED=0
  for track in build bugfix tests change; do
    track_out="$(BENCH_TRACK="$track" bash "$H/batch.sh" --dry-run --model "$MODEL" 2>&1)" || {
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

# ---- Day record before the runner (FR-6) -----------------------------------------
# Written before the first batch call, so a second run of the job on the same
# day resumes this model instead of selecting a second one.
mkdir -p "$DAYS_DIR"
node -e '
const fs = require("node:fs");
const pick = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
pick.run_ids = [];
pick.runner_exit = null;
fs.writeFileSync(process.argv[2], JSON.stringify(pick, null, 2) + "\n");
' "$PICK_OUT" "$RECORD_TMP" && mv "$RECORD_TMP" "$RECORD"

# ---- Runner -----------------------------------------------------------------------
RUNNER_EXIT=0
WEEK="$WEEK" "$RUNNER" --model "$MODEL"
RUNNER_EXIT=$?
echo "DAILY RUNNER exit=$RUNNER_EXIT"

# ---- Run list ----------------------------------------------------------------------
RL_RC=0
"$H/node_modules/.bin/tsx" "$H/daily-pick.ts" \
  --day-runs "$MODEL" --week "$WEEK" --runs-root "$RUNS_ROOT" --pricing "$PRICING" \
  > "$RUNLIST_OUT" || RL_RC=$?
if [ "$RL_RC" -ne 0 ]; then
  echo "DAILY FAIL run-list: the run list exited $RL_RC" >&2
  exit 1
fi
N_RUNS="$(node -e '
process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).length));
' "$RUNLIST_OUT")"
echo "DAILY RUNS $N_RUNS"

# ---- Day record after the runner ----------------------------------------------------
node -e '
const fs = require("node:fs");
const pick = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
pick.run_ids = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
pick.runner_exit = Number(process.argv[3]);
fs.writeFileSync(process.argv[4], JSON.stringify(pick, null, 2) + "\n");
' "$PICK_OUT" "$RUNLIST_OUT" "$RUNNER_EXIT" "$RECORD_TMP" && mv "$RECORD_TMP" "$RECORD"

# ---- Publish (FR-8, D10) ------------------------------------------------------------
if [ "$RUNNER_EXIT" -ne 0 ]; then
  echo "DAILY PUBLISH none"
  echo "DAILY END $(date -Is)"
  exit "$RUNNER_EXIT"
fi
if [ "$PUBLISH" = "0" ]; then
  echo "DAILY PUBLISH skipped"
  echo "DAILY END $(date -Is)"
  exit 0
fi

cd "$ROOT"
git add docs/
if git diff --cached --quiet; then
  echo "DAILY PUBLISH none"
  echo "DAILY END $(date -Is)"
  exit 0
fi

# The commit body reports each unpriced, gone, and unservable model, so the
# operator sees which models need a price refresh or an executor fix.
node -e '
const fs = require("node:fs");
const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const lines = ["Publish daily " + p.date + " OpenCode Go results: " + p.model + " (" + p.reason + ").", ""];
const ex = p.excluded ?? {};
for (const key of ["unpriced", "gone", "unservable"]) {
  if ((ex[key] ?? []).length) lines.push(key.charAt(0).toUpperCase() + key.slice(1) + ": " + ex[key].join(", "));
}
fs.writeFileSync(process.argv[2], lines.join("\n") + "\n");
' "$PICK_OUT" "$MSG_FILE"
git commit -F "$MSG_FILE"
PUSHED=""
for _ in 1 2 3; do
  if git push origin main; then PUSHED=1; break; fi
  sleep 60
done
if [ -z "$PUSHED" ]; then
  echo "DAILY FAIL publish: git push failed after 3 attempts; the commit is local" >&2
  exit 1
fi
echo "DAILY PUBLISH $(git rev-parse --short HEAD)"
echo "DAILY END $(date -Is)"
