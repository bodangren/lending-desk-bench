#!/usr/bin/env bash
# Weekly OpenCode Go matrix: catalog, one No Skills + one Skills run per High Usage model,
# recost, then refresh the public site.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
H="$ROOT/harness"
# shellcheck source=env.sh
source "$H/env.sh"
cd "$H"
WEEK="${WEEK:-$(date -u +%Gw%V)}"
export WEEK
export ARMS="${ARMS:-a b}"
export REPS="${REPS:-1}"
export BENCH_WAIT_FOR_IDLE="${BENCH_WAIT_FOR_IDLE:-1800}"
mkdir -p "$ROOT/reports"
echo "WEEKLY START $(date -Is) week=$WEEK"
if "$H/node_modules/.bin/tsx" "$H/go-cost.ts" --catalog > "$ROOT/reports/go-catalog-$WEEK.json"; then
  echo "catalog wrote reports/go-catalog-$WEEK.json"
else
  echo "catalog fetch failed; continue with the pinned table" >&2
fi
./batch.sh
./recost.sh
python3 "$H/export-site-data.py"
python3 "$H/generate-model-pages.py"
echo "WEEKLY END $(date -Is) week=$WEEK"
