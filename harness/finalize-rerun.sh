#!/usr/bin/env bash
# Finalize the 2026w35 reruns: wait for all rerun batches, then rebuild scores
# and refresh the leaderboard. Mirrors weekly.sh's publish tail:
#   rescore-doctor.sh  -> score.json from persisted results.json (clears the
#                         BENCH_IGNORE_LOAD under_load flag the reruns carry)
#   recost.sh          -> pinned go pricing on every score record
#   export-site-data.py + generate-model-pages.py -> docs/ leaderboard
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
H="$ROOT/harness"
cd "$H" || exit 1
# shellcheck source=env.sh
source ./env.sh
LOG="$ROOT/reports/finalize-rerun.log"
exec > >(tee -a "$LOG") 2>&1

echo "FINALIZE START $(date -Is)"
while ! grep -q "^HY3 RETRIES DONE$" "$ROOT/reports/rerun-missing-2026w35.log" 2>/dev/null; do
  sleep 60
done
echo "reruns finished at $(date -Is)"

./rescore-doctor.sh; echo "rescore-doctor rc=$?"
./recost.sh || echo "recost failed rc=$?"
python3 export-site-data.py || echo "export-site-data failed rc=$?"
python3 generate-model-pages.py || echo "generate-model-pages failed rc=$?"
./summarize.sh || echo "summarize failed rc=$?"
echo "FINALIZE DONE $(date -Is)"
