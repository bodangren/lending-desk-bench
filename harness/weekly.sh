#!/usr/bin/env bash
# Weekly OpenCode Go matrix: catalog, No Skills + Skills runs per High Usage model on
# all four tracks, recost, then refresh the public site. Repeats per track come from
# batch.sh (build 3, others 1); set REPS to override every track.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
H="$ROOT/harness"
# shellcheck source=env.sh
source "$H/env.sh"
cd "$H"
WEEK="${WEEK:-$(date -u +%Gw%V)}"
export WEEK
export ARMS="${ARMS:-a b}"
export BENCH_WAIT_FOR_IDLE="${BENCH_WAIT_FOR_IDLE:-1800}"
mkdir -p "$ROOT/reports"
echo "WEEKLY START $(date -Is) week=$WEEK"
# Fail closed if Playwright Chromium is missing — otherwise every B/C/D/E/F
# criterion fails and scores cluster ~20% (w36, w38; caused by cache_cleanup).
PW_CHROME="$HOME/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell"
if [ ! -x "$PW_CHROME" ]; then
  # version dir may drift; accept any installed headless shell
  if ! ls "$HOME"/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell >/dev/null 2>&1; then
    echo "FATAL: Playwright Chromium missing at ~/.cache/ms-playwright — refuse to batch (would publish ~20% fake scores)." >&2
    echo "Fix: cd harness && npx playwright install chromium" >&2
    echo "Also ensure cache_cleanup.sh does NOT wipe ms-playwright." >&2
    exit 2
  fi
fi

if "$H/node_modules/.bin/tsx" "$H/go-cost.ts" --catalog > "$ROOT/reports/go-catalog-$WEEK.json"; then
  echo "catalog wrote reports/go-catalog-$WEEK.json"
else
  echo "catalog fetch failed; continue with the pinned table" >&2
fi
# Build track first, then the bugfix, tests, and change tracks. rescore/recost/site
# cover all four. A failed self-check or canary stops that track only.
FAILED_TRACKS=""
mkdir -p "$ROOT/.tmp"
export BENCH_SELFCHECK_MARKER="$ROOT/.tmp/selfcheck-pass-$WEEK-$$"
rm -f "$BENCH_SELFCHECK_MARKER"
for track in build bugfix tests change; do
  if ! BENCH_TRACK="$track" ./batch.sh; then
    echo "WEEKLY: $track batch failed; its previous published rows stay unchanged" >&2
    FAILED_TRACKS="$FAILED_TRACKS $track"
  fi
done
# Rebuild score.json from persisted results with current harness hashes; drops
# the under_load flag batch runs carry under BENCH_IGNORE_LOAD=1.
WEEK="$WEEK" ./rescore-doctor.sh
./recost.sh
python3 "$H/export-site-data.py"
python3 "$H/generate-model-pages.py"
# Published: drain past weeks' regenerable runtime trees (node_modules etc.).
# artifacts/ and the candidate task files stay for rescore/regrade/audit.
./cleanup.sh
echo "WEEKLY END $(date -Is) week=$WEEK${FAILED_TRACKS:+ failed tracks:$FAILED_TRACKS}"
