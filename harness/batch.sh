#!/usr/bin/env bash
# Serial OpenCode Go batch. One model at a time so the machine isn't saturated.
#
#   ARMS="a b" ./batch.sh
#   WEEK=2026w35 ARMS="a b" REPS=1 ./batch.sh
#
# Arm a = No Skills. Arm b = Skills. Default is both arms, one run each.
# Run ids are "<arm>-<slug>-<iso-week>", e.g. a-mimo-v2-5-2026w35.
# Dots in model ids become hyphens. A second same-week rep appends -rN.
#
# The model list comes from harness/go-pricing.json (high_usage && batch).
set -u
cd "$(dirname "${BASH_SOURCE[0]}")"
# shellcheck source=env.sh
source "./env.sh"

ARMS="${ARMS:-a b}"
REPS="${REPS:-1}"
WEEK="${WEEK:-$(date -u +%Gw%V)}"
# A busy host voids the timing-sensitive assertions, so wait for it to settle rather
# than burning the whole queue on preflight failures. run.sh/preflight.sh read this.
export BENCH_WAIT_FOR_IDLE="${BENCH_WAIT_FOR_IDLE:-1800}"

is_current_trusted_score() {
  local score="$1"
  ./node_modules/.bin/tsx score-freshness.ts "$score" --rankable >/dev/null 2>&1
}

mapfile -t MODELS < <(./node_modules/.bin/tsx go-cost.ts --batch-lines)
if [ "${#MODELS[@]}" -eq 0 ]; then
  echo "go-cost.ts emitted no batch models" >&2
  exit 2
fi

NARMS=$(echo "$ARMS" | wc -w)
TOTAL=$(( ${#MODELS[@]} * REPS * NARMS ))
echo "BATCH START $(date -Is) — ${#MODELS[@]} models x arms[$ARMS] x ${REPS} reps = ${TOTAL} runs"
N=0; OK=0; FAIL=0; SKIP=0

for rep in $(seq 1 "$REPS"); do
  for arm in $ARMS; do
    for entry in "${MODELS[@]}"; do
      IFS='|' read -r provider model slug <<< "$entry"
      run_id="${arm}-${slug}-${WEEK}"
      if [ "$REPS" -gt 1 ]; then run_id="${run_id}-r${rep}"; fi
      N=$((N+1))

      score="../runs/$run_id/artifacts/score.json"
      if [ "${FORCE:-0}" != "1" ]; then
        if is_current_trusted_score "$score"; then
          echo "[$N/$TOTAL] SKIP $run_id (current trusted, publishable score)"
          SKIP=$((SKIP+1)); continue
        elif [ -e "$score" ]; then
          echo "[$N/$TOTAL] RE-RUN $run_id (score is invalid, stale, blocked, or untrusted)"
        fi
      fi

      echo "=================================================================="
      echo "[$N/$TOTAL] START $(date -Is)  $provider/$model  arm=$arm rep=$rep -> $run_id"
      THINKING=max AGENT_TIMEOUT="${AGENT_TIMEOUT:-3600}" \
        ./run.sh "$provider" "$model" "$arm" "$run_id" 2>&1
      rc=$?
      if [ $rc -eq 0 ]; then OK=$((OK+1)); else FAIL=$((FAIL+1)); fi
      echo "[$N/$TOTAL] END   $(date -Is)  $run_id exit=$rc"
    done
  done
done

echo "=================================================================="
echo "BATCH COMPLETE $(date -Is) — ${OK} ok, ${FAIL} failed, ${SKIP} skipped of ${TOTAL}"
./summarize.sh
