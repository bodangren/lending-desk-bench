#!/usr/bin/env bash
# Retry Hy3 arms after rerun-missing.sh finishes, now that go-pricing.json pins
# maxTokens=32768 (the 16384 default truncated hy3 turns before any write).
# Up to 3 attempts per arm; a run.sh exit 0 means the run graded successfully.
set -u
cd /home/daniebo/Desktop/lending-desk-bench/harness
source ./env.sh
WEEK="${WEEK:-2026w35}"
export BENCH_WAIT_FOR_IDLE=0
export BENCH_IGNORE_LOAD=1

while ! grep -q "^RERUN MISSING DONE$" ../reports/rerun-missing-2026w35.log 2>/dev/null; do
  sleep 60
done

for arm in a b; do
  id="${arm}-hy3-${WEEK}"
  for attempt in 1 2 3; do
    echo "======== HY3 RETRY $arm attempt=$attempt -> $id ========"
    if THINKING=max AGENT_TIMEOUT="${AGENT_TIMEOUT:-3600}" \
       ./run.sh opencode-go hy3 "$arm" "$id" 2>&1; then
      echo "[$id] attempt=$attempt graded; stopping retries"
      break
    else
      echo "EXIT $? $id attempt=$attempt"
    fi
  done
done
echo "HY3 RETRIES DONE"
