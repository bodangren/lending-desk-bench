#!/usr/bin/env bash
# Reclaim disk from graded runs by deleting regenerable runtime trees.
#
#   ./cleanup.sh                    # every week older than the current one
#   WEEK=2026w36 ./cleanup.sh       # one specific week (current or past)
#   INCLUDE_CURRENT=1 ./cleanup.sh  # also drain the current week
#   DRY_RUN=1 ./cleanup.sh          # report sizes without deleting
#   UNGRADED=1 ./cleanup.sh         # include runs without artifacts/results.json
#
# After a week is published (export-site-data.py + generate-model-pages.py,
# committed by cron-weekly.sh) a run directory is only read by the site
# export, rescore-doctor.sh, and regrade.sh. All of them consume artifacts/
# plus the candidate's task files. The heavy runtime trees are safe to delete:
# the candidate contract (candidate-contract.ts) skips node_modules, .next and
# *.tsbuildinfo when hashing, and regrade.sh rehydrates dependencies from the
# fixture. weekly.sh calls this script after the site export, so past weeks
# drain automatically. Runs whose grading never finished (no results.json)
# keep everything unless UNGRADED=1.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNS="$ROOT/runs"
CUR_WEEK="$(date -u +%Gw%V)"
DRY="${DRY_RUN:-0}"

[ -d "$RUNS" ] || { echo "no runs directory at $RUNS" >&2; exit 1; }
if [ -n "${1:-}" ]; then
  TARGET="${1:?usage: cleanup.sh [week, e.g. 2026w36]}"
  [[ "$TARGET" =~ ^[0-9]{4}w[0-9]{2}$ ]] || { echo "week must look like 2026w36" >&2; exit 2; }
else
  TARGET=""
fi

freed_kb=0
n_runs=0
n_paths=0

for run in "$RUNS"/*/; do
  name="$(basename "$run")"
  week=""
  # Batch runs end in -<week>-r<N> since bench_v2; older runs end in -<week>.
  [[ "$name" =~ -([0-9]{4}w[0-9]{2})(-r[0-9]+)?$ ]] && week="${BASH_REMATCH[1]}"
  if [ -n "$TARGET" ]; then
    [ "$week" = "$TARGET" ] || continue
  else
    [ -n "$week" ] || continue
    if [ "$week" = "$CUR_WEEK" ] && [ "${INCLUDE_CURRENT:-0}" != "1" ]; then continue; fi
    [[ "$week" < "$CUR_WEEK" || "$week" = "$CUR_WEEK" ]] || continue
  fi
  if [ "${UNGRADED:-0}" != "1" ] && [ ! -f "$run/artifacts/results.json" ]; then
    echo "SKIP $name (no results.json; grading never finished)"
    continue
  fi
  run_kb=0
  for path in "$run/candidate/node_modules" "$run/candidate/.next" "$run/candidate/tsconfig.tsbuildinfo"; do
    if [ ! -e "$path" ] && [ ! -L "$path" ]; then continue; fi
    kb="$(du -sk -- "$path" 2>/dev/null | cut -f1)"
    kb="${kb:-0}"
    if [ "$DRY" = "1" ]; then
      echo "DRY $name  ${path#"$ROOT"/} (${kb}KB)"
    else
      rm -rf -- "$path" && echo "RM   $name  ${path#"$ROOT"/} (${kb}KB)"
    fi
    run_kb=$((run_kb + kb))
    n_paths=$((n_paths + 1))
  done
  if [ "$run_kb" -gt 0 ]; then
    freed_kb=$((freed_kb + run_kb))
    n_runs=$((n_runs + 1))
  fi
done

echo "CLEANUP DONE reclaimed=$((freed_kb / 1024))MB from ${n_paths} paths in ${n_runs} runs$([ "$DRY" = "1" ] && echo ' (dry run, nothing deleted)')"
