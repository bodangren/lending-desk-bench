#!/usr/bin/env bash
# Serial reruns for 2026w35 runs with missing (invalid or never-graded) scores.
# Ids and failure reasons were confirmed against runs/*/artifacts/score.json first.
# Runs with BENCH_IGNORE_LOAD=1 per operator decision 2026-08-30: the host never
# settles (swap pinned ~3.9GB > 2000MB). Grading flags under_load records, then
# rescore-doctor.sh rebuilds score.json from the persisted results.json so the
# reruns become rankable, matching the current 2026w35 records.
set -u
cd /home/daniebo/Desktop/lending-desk-bench/harness
source ./env.sh
WEEK="${WEEK:-2026w35}"
export BENCH_WAIT_FOR_IDLE="${BENCH_WAIT_FOR_IDLE:-0}"
export BENCH_IGNORE_LOAD="${BENCH_IGNORE_LOAD:-1}"

# model|arm — mimo-v2.5 is the "mini-2.5" b arm
RUNS=(
  "hy3|a"
  "hy3|b"
  "glm-5.3-flash|a"
  "deepseek-v4-flash|b"
  "muse-spark-1.2-contributor|a"
  "qwen3.7-plus|b"
  "mimo-v2.5|b"
)

for entry in "${RUNS[@]}"; do
  IFS='|' read -r model arm <<< "$entry"
  slug=${model//./-}
  id="${arm}-${slug}-${WEEK}"
  echo "======== START rerun opencode-go/$model arm=$arm -> $id ========"
  if [ -f "../runs/$id/artifacts/score.json" ] && \
     ! ./node_modules/.bin/tsx score-freshness.ts "../runs/$id/artifacts/score.json" --rankable >/dev/null 2>&1; then
    echo "[$id] prior score is not rankable; old artifacts will be replaced by run.sh"
  fi
  THINKING=max AGENT_TIMEOUT="${AGENT_TIMEOUT:-3600}" \
    ./run.sh opencode-go "$model" "$arm" "$id" 2>&1 || echo "EXIT $? $id"
done
echo "RERUN MISSING DONE"
