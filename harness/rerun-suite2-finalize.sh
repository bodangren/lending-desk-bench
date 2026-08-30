#!/usr/bin/env bash
# Fresh agent reruns for the two records stuck with under_load=true, graded
# against the settled criteria suite (C.summary/P.no-waterfall dropped).
# Then rebuild scores and refresh the leaderboard.
set -u
cd /home/daniebo/Desktop/lending-desk-bench/harness
source ./env.sh
WEEK=2026w35
export BENCH_WAIT_FOR_IDLE=0
export BENCH_IGNORE_LOAD=1

for entry in "glm-5.3-flash|a" "deepseek-v4-flash|b"; do
  IFS='|' read -r model arm <<< "$entry"
  slug=${model//./-}
  id="${arm}-${slug}-${WEEK}"
  echo "======== START suite2 rerun opencode-go/$model arm=$arm -> $id ========"
  THINKING=max AGENT_TIMEOUT="${AGENT_TIMEOUT:-3600}" \
    ./run.sh opencode-go "$model" "$arm" "$id" 2>&1 || echo "EXIT $? $id"
done
echo "SUITE2 RERUNS DONE"

./rescore-doctor.sh; echo "rescore-doctor rc=$?"
./recost.sh || echo "recost failed rc=$?"
python3 export-site-data.py || echo "export-site-data failed rc=$?"
python3 generate-model-pages.py || echo "generate-model-pages failed rc=$?"
./summarize.sh || echo "summarize failed rc=$?"
echo "SUITE2 FINALIZE DONE"
