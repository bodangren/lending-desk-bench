#!/usr/bin/env bash
# Regrade the current model matrix + reference against today's harness.
# Serial only: concurrent grades thrash Playwright and void timing probes.
#
#   ./regrade-matrix.sh
#   BENCH_IGNORE_LOAD=1 ./regrade-matrix.sh   # if host stays busy
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
H="$ROOT/harness"
STAMP=$(date +%Y%m%d-%H%M)
export BENCH_WAIT_FOR_IDLE="${BENCH_WAIT_FOR_IDLE:-900}"
LOG="$ROOT/reports/regrade-matrix-${STAMP}.log"
mkdir -p "$ROOT/reports"
exec > >(tee -a "$LOG") 2>&1

# source-run-id|dest-suffix|provider|model|arm
# Use "__reference__" as source to apply the golden reference/ overlay (not a model run).
ENTRIES=(
  "__reference__|reference|local|reference|a"
  "a-deepseek-v4-flash-r1|deepseek-v4-flash|deepseek|deepseek-v4-flash|a"
  "a-gpt-5.6-luna-r1|gpt-5.6-luna|openrouter|openai/gpt-5.6-luna|a"
  "a-qwen3.7-flash-r1|qwen3.7-flash|openrouter|qwen/qwen3.7-flash|a"
  "a-mimo-v2.5-r1|mimo-v2.5|xiaomi|mimo-v2.5|a"
  "a-mimo-v2.5|mimo-v2.5-orig|xiaomi|mimo-v2.5|a"
  "a-ling-3.0-flash-r1|ling-3.0-flash|openrouter|inclusionai/ling-3.0-flash:free|a"
  "b-qwen3.7-flash-r1|qwen3.7-flash-b|openrouter|qwen/qwen3.7-flash|b"
  "a-deepseek-v4-flash|deepseek-v4-flash-orig|deepseek|deepseek-v4-flash|a"
  "a-gpt-5.6-luna|gpt-5.6-luna-broken|openai-codex|gpt-5.6-luna|a"
)

ok=0
fail=0
skip=0
SUMMARY_TSV="$ROOT/reports/regrade-matrix-${STAMP}.tsv"
printf 'source\tdest\tstatus\ttotal\tvalid\n' > "$SUMMARY_TSV"

for entry in "${ENTRIES[@]}"; do
  IFS='|' read -r src suffix provider model arm <<< "$entry"
  # Run IDs allow only [A-Za-z0-9_-] — model slugs with dots (gpt-5.6) must be sanitized.
  safe_suffix=$(printf '%s' "$suffix" | tr -c 'A-Za-z0-9_-' '-')
  dest="rg-${safe_suffix}-${STAMP}"
  echo ""
  echo "======== REGRADE $src -> $dest ========"

  if [ "$src" = "__reference__" ]; then
    export AGENT_SKIP=1
    export OVERLAY="$ROOT/reference"
    if "$H/run.sh" "$provider" "$model" "$arm" "$dest"; then
      rc=0
    else
      rc=$?
    fi
    unset AGENT_SKIP OVERLAY
  else
    if [ ! -d "$ROOT/runs/$src/candidate" ]; then
      echo "[matrix] SKIP $src (no candidate)"
      skip=$((skip + 1))
      printf '%s\t%s\t%s\t%s\t%s\n' "$src" "-" "MISSING" "-" "-" >> "$SUMMARY_TSV"
      continue
    fi
    if "$H/regrade.sh" "$src" "$dest" "$provider" "$model" "$arm"; then
      rc=0
    else
      rc=$?
    fi
  fi

  if [ "$rc" -eq 0 ] || [ -f "$ROOT/runs/$dest/artifacts/score.json" ]; then
    total=$(python3 -c "import json; print(json.load(open('$ROOT/runs/$dest/artifacts/score.json')).get('total'))" 2>/dev/null || echo "?")
    valid=$(python3 -c "import json; print(json.load(open('$ROOT/runs/$dest/artifacts/score.json')).get('valid'))" 2>/dev/null || echo "?")
    if [ "$rc" -eq 0 ]; then
      echo "[matrix] OK $dest total=$total valid=$valid"
      ok=$((ok + 1))
      printf '%s\t%s\t%s\t%s\t%s\n' "$src" "$dest" "OK" "$total" "$valid" >> "$SUMMARY_TSV"
    else
      echo "[matrix] SCORED_WITH_EXIT $dest rc=$rc total=$total valid=$valid"
      fail=$((fail + 1))
      printf '%s\t%s\t%s\t%s\t%s\n' "$src" "$dest" "EXIT-$rc" "$total" "$valid" >> "$SUMMARY_TSV"
    fi
  else
    echo "[matrix] FAIL $dest exit=$rc"
    fail=$((fail + 1))
    printf '%s\t%s\t%s\t%s\t%s\n' "$src" "$dest" "FAIL-$rc" "-" "-" >> "$SUMMARY_TSV"
  fi
done

echo ""
echo "======== MATRIX DONE ok=$ok fail=$fail skip=$skip ========"
echo "TSV: $SUMMARY_TSV"
echo "LOG: $LOG"

python3 "$H/build-report.py" --stamp "$STAMP" || {
  echo "[matrix] build-report.py failed; summarize only" >&2
}
"$H/summarize.sh" || true
