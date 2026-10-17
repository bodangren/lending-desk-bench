#!/usr/bin/env bash
# Weekly OpenCode Go matrix: catalog fetch, recost if the pinned price table
# changed, rescore if the harness hashes changed, then No Skills + Skills runs
# per High Usage model on all four tracks (plan-work.ts work list per track),
# recost, then refresh the public site. Repeats per track come from batch.sh
# (build 3, others 1); set REPS to override every track.
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

# Recost first if the pinned price table changed (bench_incremental FR-4): a
# price edit is a pure go-pricing.json operation over existing score.json
# files and schedules no agent runs. The marker under reports/ records the
# last-seen sha256 after each recost decision.
PRICE_SHA="$(sha256sum "$H/go-pricing.json" | cut -d" " -f1)"
PRICE_MARKER="$ROOT/reports/go-pricing.sha"
if [ ! -f "$PRICE_MARKER" ] || [ "$(cat "$PRICE_MARKER")" != "$PRICE_SHA" ]; then
  echo "PRICING CHANGED — recost every score.json from harness/go-pricing.json"
  ./recost.sh
fi
printf "%s\n" "$PRICE_SHA" > "$PRICE_MARKER"

# Rescore next if the harness hashes changed (bench_incremental FR-3): a
# scoring-only harness change cures provenance staleness for every run with
# persisted results, across all weeks, without an agent re-run. A
# suite-content change stays an operator decision (regrade-run.sh /
# regrade-all.sh, or FORCE=1); the rescore never decides that.
HASHES="$("$H/node_modules/.bin/tsx" "$H/provenance.ts" --shell)"
HASH_MARKER="$ROOT/reports/harness-hashes.sha"
if [ ! -f "$HASH_MARKER" ] || [ "$(cat "$HASH_MARKER")" != "$HASHES" ]; then
  echo "HARNESS HASHES CHANGED — rescore-doctor WEEK=all (cure provenance staleness)"
  WEEK=all ./rescore-doctor.sh
fi
printf "%s\n" "$HASHES" > "$HASH_MARKER"

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
