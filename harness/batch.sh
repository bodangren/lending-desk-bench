#!/usr/bin/env bash
# Serial batch. One model at a time so the machine isn't saturated.
#
#   ./batch.sh                    # arms from $ARMS (default "a"), $REPS reps (default 1)
#   ARMS="a b" REPS=5 ./batch.sh
#
# Run ids are "<arm>-<slug>-r<n>", e.g. a-deepseek-v4-flash-r1. The -r suffix is NOT
# cosmetic: run.sh opens with `rm -rf runs/$RUN_ID`, so reusing a bare id such as
# a-deepseek-v4-flash would delete the 2026-07-31 submission that the regrades depend on.
#
# Provider notes:
#   - OpenAI models go through openrouter, not the openai-codex provider: that one
#     authenticates with a ChatGPT OAuth token, and a lapsed token fails the run without
#     failing the command (see a-gpt-5.6-luna, 2026-07-31 — it scored 2.9 against an
#     untouched fixture). run.sh now aborts with exit 3 when the diff is empty.
#   - deepseek and xiaomi keep their native providers: those are plain API keys, and both
#     produced real usage data on 2026-07-31.
#
# Slugs verified against the openrouter catalogue on 2026-07-31, re-verified 2026-08-01
# against GET /api/v1/models. Note the qwen id is `qwen3.7-flash`, not `qwen-3.7-flash`.
#
# ling-3.0-flash IS published only as `:free`. Dropping the suffix was tried on
# 2026-08-01 and openrouter does not resolve it — the catalogue holds ling-2.6-1t,
# ling-2.6-flash and ling-3.0-flash:free, and nothing else matching "ling". `pi` does
# not fail on an unknown id; it warns "not found for provider, using custom model id"
# to stderr, returns a single empty turn, and exits 0. That produced run
# a-ling-3.0-flash-r1: gate green, every criterion false, total 3.1, cost $0.
# Verify against the catalogue before changing this line.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")"

ARMS="${ARMS:-a}"
REPS="${REPS:-1}"
# A busy host voids the timing-sensitive assertions, so wait for it to settle rather
# than burning the whole queue on preflight failures. run.sh/preflight.sh read this.
export BENCH_WAIT_FOR_IDLE="${BENCH_WAIT_FOR_IDLE:-1800}"

is_current_trusted_score() {
  local score="$1"
  ./node_modules/.bin/tsx score-freshness.ts "$score" --rankable >/dev/null 2>&1
}

# provider|model|slug
MODELS=(
  "deepseek|deepseek-v4-flash|deepseek-v4-flash"
  "openrouter|openai/gpt-5.6-luna|gpt-5.6-luna"
  "openrouter|qwen/qwen3.7-flash|qwen3.7-flash"
  "openrouter|inclusionai/ling-3.0-flash:free|ling-3.0-flash"
  "xiaomi|mimo-v2.5|mimo-v2.5"
)

NARMS=$(echo "$ARMS" | wc -w)
TOTAL=$(( ${#MODELS[@]} * REPS * NARMS ))
echo "BATCH START $(date -Is) — ${#MODELS[@]} models x arms[$ARMS] x ${REPS} reps = ${TOTAL} runs"
N=0; OK=0; FAIL=0; SKIP=0

for rep in $(seq 1 "$REPS"); do
  for arm in $ARMS; do
    for entry in "${MODELS[@]}"; do
      IFS='|' read -r provider model slug <<< "$entry"
      run_id="${arm}-${slug}-r${rep}"
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
