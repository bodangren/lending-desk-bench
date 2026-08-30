#!/usr/bin/env bash
set -u
cd /home/daniebo/Desktop/lending-desk-bench/harness
# Wait for the missing-models batch to finish (DONE marker in its log)
while ! grep -q "^DONE$" ../reports/missing-models.log 2>/dev/null; do
  sleep 60
done
source ./env.sh
WEEK=2026w35
for model in glm-5.3-flash minimax-m3 qwen3.6-plus; do
  slug=${model//./-}
  id="a-${slug}-${WEEK}"
  echo "======== START arm-a rerun opencode-go/$model -> $id ========"
  ./run.sh opencode-go "$model" a "$id" || echo "EXIT $? $id"
done
echo "ARM-A RERUNS DONE"
