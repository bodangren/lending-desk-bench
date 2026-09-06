#!/usr/bin/env bash
# Sunday 01:00 cron entry: refresh the Go model catalog, run the weekly matrix,
# then commit and push the site data so GitHub Pages updates.
#
#   0 1 * * 0 /home/daniebo/Desktop/lending-desk-bench/harness/cron-weekly.sh \
#     >> /home/daniebo/Desktop/lending-desk-bench/reports/cron-weekly.log 2>&1
#
# runs/ and reports/ are gitignored; only docs/ (the Pages site) is published.
# A failed batch aborts before publish. Re-running this script after a failed
# night is safe: batch.sh skips runs that already have trusted scores.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/.tmp" "$ROOT/reports"
exec 9>"$ROOT/.tmp/weekly-cron.lock"
flock -n 9 || { echo "weekly cron already running; exiting" >&2; exit 0; }

WEEK="$(date -u +%Gw%V)"
LOG="$ROOT/reports/weekly-cron-$WEEK.log"
MSG_FILE="$ROOT/.tmp/weekly-commit-msg.txt"
CATALOG="$ROOT/reports/go-catalog-$WEEK.json"

# This host never meets the preflight idle budget, so every run proceeds
# flagged under_load and no settling wait is spent before it. The meta
# self-check cannot complete here either (podman probes hang; see
# reports/weekly-2026w36-manual.log), so it is skipped with the documented
# warning. All results still publish; see score-freshness.ts.
export BENCH_IGNORE_LOAD="${BENCH_IGNORE_LOAD:-1}"
export BENCH_WAIT_FOR_IDLE="${BENCH_WAIT_FOR_IDLE:-0}"
export BENCH_SELFCHECK="${BENCH_SELFCHECK:-skip}"

{
  echo "CRON START $(date -Is) week=$WEEK"
  "$ROOT/harness/weekly.sh"
} 2>&1 | tee "$LOG"

cd "$ROOT"
git add docs/
if git diff --cached --quiet; then
  echo "CRON END $(date -Is) week=$WEEK — no site data changes to publish"
  exit 0
fi

# Surface catalog drift in the commit body: new endpoint models mean
# go-pricing.json needs a manual refresh from https://opencode.ai/docs/go/.
DRIFT="$(python3 - "$CATALOG" <<'PY' 2>/dev/null || true
import json, sys
try:
    diff = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(1)
extra = diff.get("extra") or []
missing = diff.get("missing") or []
if not extra and not missing:
    sys.exit(1)
print()
print("Catalog drift: refresh harness/go-pricing.json from https://opencode.ai/docs/go/")
if extra:
    print("- on endpoint, unpriced: " + ", ".join(extra))
if missing:
    print("- priced, gone from endpoint: " + ", ".join(missing))
PY
)"
{
  echo "Publish week $WEEK OpenCode Go results."
  printf '%s\n' "$DRIFT"
} > "$MSG_FILE"

git commit -F "$MSG_FILE"
PUSHED=""
for _ in 1 2 3; do
  if git push origin main; then PUSHED=1; break; fi
  sleep 60
done
if [ -z "$PUSHED" ]; then
  echo "git push failed after 3 attempts; commit is local" >&2
  exit 1
fi
echo "CRON END $(date -Is) week=$WEEK published"
