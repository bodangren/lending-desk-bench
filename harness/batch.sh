#!/usr/bin/env bash
# Serial OpenCode Go batch. One model at a time so the machine isn't saturated.
#
#   ARMS="a b" ./batch.sh
#   WEEK=2026w35 ARMS="a b" REPS=1 ./batch.sh
#
# Arm a = No Skills. Arm b = Skills. Default is both arms.
# Run ids are "<track-prefix><arm>-<slug>-<iso-week>-r<N>", e.g.
# a-mimo-v2-5-2026w40-r1. Dots in model ids become hyphens. Every run carries the
# -r<N> suffix, also when the track runs one repeat, so the export parses one form.
# Historical ids without a suffix count as r1.
#
# One run per model and arm cannot rank the top group: the same model moved 10
# points between weeks and up to 87 points between arms on single failures.
# The build track therefore repeats 3 times by default. The other tracks repeat
# once, so the weekly batch still ends in about two days on this host.
#   REPS           overrides every track
#   REPS_BUILD     default 3
#   REPS_BUGFIX    default 1
#   REPS_TESTS     default 1
#   REPS_CHANGE    default 1
#
# The model list comes from harness/go-pricing.json (high_usage && batch).
# Incremental scheduling (bench_incremental): by default the batch runs the
# plan-work.ts work list — only new models (no agent run for this track and
# arm) and failing models (fewer trusted runs than the track's repeat count).
#   FORCE=1        restores the full pricing matrix (exact-ID skip still applies)
#   --dry-run /    print the planned run ids and exit; no self-check, canary,
#   BENCH_DRY_RUN=1  or agent runs
# A scheduled model runs its full track reps; failing models get the same reps
# as new models. The work list never writes run artifacts.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")"
# shellcheck source=env.sh
source "./env.sh"

DRY_RUN=0
case " $* " in
  *" --dry-run "*) DRY_RUN=1 ;;
esac
[ "${BENCH_DRY_RUN:-0}" = "1" ] && DRY_RUN=1

# Work-list rows (plan-work.ts JSON) -> model ids, new or failing, in order.
work_list_models() {
  node -e '
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  let payload;
  try { payload = JSON.parse(raw); } catch { process.exit(2); }
  const rows = Array.isArray(payload)
    ? payload
    : payload.classifications ?? payload.work_list ?? payload.entries ?? [];
  const seen = new Set();
  for (const row of rows) {
    if (row && (row.class === "new" || row.class === "failing") && typeof row.model === "string" && !seen.has(row.model)) {
      seen.add(row.model);
      process.stdout.write(row.model + "\n");
    }
  }
});
'
}

ARMS="${ARMS:-a b}"
WEEK="${WEEK:-$(date -u +%Gw%V)}"
# Track: build (default), bugfix, tests, or change. One batch grades one track;
# the weekly script runs all four. Each non-build track has a run-id prefix so
# the tracks can coexist in runs/.
TRACK="${BENCH_TRACK:-build}"
case "$TRACK" in
  build)  TRACK_PREFIX="";    TRACK_REPS="${REPS_BUILD:-3}" ;;
  bugfix) TRACK_PREFIX="bf-"; TRACK_REPS="${REPS_BUGFIX:-1}" ;;
  tests)  TRACK_PREFIX="tt-"; TRACK_REPS="${REPS_TESTS:-1}" ;;
  change) TRACK_PREFIX="ch-"; TRACK_REPS="${REPS_CHANGE:-1}" ;;
  *) echo "BENCH_TRACK must be build, bugfix, tests, or change" >&2; exit 2 ;;
esac
export BENCH_TRACK="$TRACK"
REPS="${REPS:-$TRACK_REPS}"
[[ "$REPS" =~ ^[1-9]$ ]] || { echo "REPS must be an integer from 1 to 9" >&2; exit 2; }
# A busy host voids the timing-sensitive assertions, so wait for it to settle rather
# than burning the whole queue on preflight failures. run.sh/preflight.sh read this.
export BENCH_WAIT_FOR_IDLE="${BENCH_WAIT_FOR_IDLE:-1800}"

is_current_trusted_score() {
  local score="$1"
  ./node_modules/.bin/tsx score-freshness.ts "$score" --rankable >/dev/null 2>&1
}

# The pricing menu honors BENCH_PRICING_PATH (a dry run may exercise a
# synthetic table); plan-work.ts --batch-lines delegates the line format to
# go-cost.ts batchLines, so it is identical to `go-cost.ts --batch-lines`.
PRICING_PATH="${BENCH_PRICING_PATH:-$PWD/go-pricing.json}"
mapfile -t ALL_LINES < <(./node_modules/.bin/tsx plan-work.ts --batch-lines --pricing "$PRICING_PATH")
if [ "${#ALL_LINES[@]}" -eq 0 ]; then
  echo "go-pricing.json has no batch models" >&2
  exit 2
fi

declare -A LINE_BY_MODEL=()
for entry in "${ALL_LINES[@]}"; do
  IFS='|' read -r _provider _model _slug <<< "$entry"
  LINE_BY_MODEL["$_model"]="$entry"
done

if [ "${FORCE:-0}" = "1" ]; then
  # Escape hatch: the pre-bench_incremental behavior, every batch model.
  MODELS=("${ALL_LINES[@]}")
  echo "FORCE=1 — full pricing matrix: ${#MODELS[@]} models"
else
  # Work list (bench_incremental FR-2): schedule only new and failing models
  # for this track. The selector is hermetic; the scrub keeps the batch's own
  # BENCH_TRACK export from reaching it at all.
  WORK_JSON="$(env -u BENCH_TRACK ./node_modules/.bin/tsx plan-work.ts --work-list "$TRACK")" || {
    echo "plan-work.ts failed to produce the work list for $TRACK" >&2
    exit 2
  }
  MODELS=()
  while IFS= read -r model; do
    [ -n "$model" ] || continue
    entry="${LINE_BY_MODEL[$model]:-}"
    if [ -z "$entry" ]; then
      echo "work-list model has no pricing line: $model" >&2
      exit 2
    fi
    MODELS+=("$entry")
  done < <(work_list_models <<< "$WORK_JSON")
  echo "WORK LIST $TRACK — ${#MODELS[@]} of ${#ALL_LINES[@]} batch models to schedule"
fi

# ---- Dry run ------------------------------------------------------------------
# Print the planned run ids (work list or full matrix) and exit. No self-check,
# no canary, no agent runs, no writes under runs/.
if [ "$DRY_RUN" = "1" ]; then
  NARMS=$(echo "$ARMS" | wc -w)
  TOTAL=$(( ${#MODELS[@]} * REPS * NARMS ))
  echo "BATCH START (dry run) $(date -Is) — ${#MODELS[@]} models x arms[$ARMS] x ${REPS} reps = ${TOTAL} runs"
  N=0
  for rep in $(seq 1 "$REPS"); do
    for arm in $ARMS; do
      for entry in "${MODELS[@]}"; do
        IFS='|' read -r provider model slug <<< "$entry"
        run_id="${TRACK_PREFIX}${arm}-${slug}-${WEEK}-r${rep}"
        N=$((N+1))
        echo "[$N/$TOTAL] DRY-RUN START $(date -Is)  $provider/$model  arm=$arm rep=$rep -> $run_id"
      done
    done
  done
  echo "=================================================================="
  echo "BATCH COMPLETE (dry run) $(date -Is) — ${TOTAL} planned runs; nothing executed"
  exit 0
fi

# ---- Harness self-check ------------------------------------------------------
# Neither of these ran in the grading path before. The meta suite polices the
# criteria, the spec matrix and the control manifest. The sensitivity controls
# prove that each test fails when its target behaviour breaks. Without them a
# criterion written from reference/ rather than from spec.md could not be
# detected, and several were not: see measure/tracks/harness_audit/spec.md.
#
# BENCH_SELFCHECK: meta (default) | logic | full | skip
#   meta  -> the meta suite plus the representative control set (--fast)
#   logic -> the meta suite without the Podman isolation tests, and no controls;
#            for hosts where the Podman probes cannot complete. The canary below
#            still proves the grading path end to end.
#   full  -> the meta suite plus every declared control (--all); use monthly,
#            after a task rotation, because each control costs one graded run
#   skip  -> neither; the batch prints a warning and grades anyway
SELFCHECK="${BENCH_SELFCHECK:-meta}"
case "$SELFCHECK" in
  meta|logic|full|skip) ;;
  *) echo "BENCH_SELFCHECK must be meta, logic, full or skip" >&2; exit 2 ;;
esac

# weekly.sh runs four track batches in one session. The meta suite does not
# depend on the track, so a pass marker from the first batch covers the rest.
if [ -n "${BENCH_SELFCHECK_MARKER:-}" ] && [ -f "$BENCH_SELFCHECK_MARKER" ] && [ "$SELFCHECK" != skip ]; then
  echo "SELF-CHECK already passed in this weekly session ($BENCH_SELFCHECK_MARKER)"
elif [ "$SELFCHECK" = skip ]; then
  echo "WARNING: harness self-check skipped; these results are not calibrated"
else
  meta_script="test:meta"
  if [ "$SELFCHECK" = logic ]; then meta_script="test:meta:logic"; fi
  echo "SELF-CHECK $(date -Is) — $meta_script"
  # The self-check is track-neutral: the meta suite grades build-track fixtures,
  # so a non-build BENCH_TRACK exported for the batch must not leak into it.
  if ! env -u BENCH_TRACK npm run --silent "$meta_script" > "meta-selfcheck.log" 2>&1; then
    echo "harness self-check failed: the meta suite did not pass" >&2
    echo "see harness/meta-selfcheck.log" >&2
    exit 3
  fi

  if [ "$SELFCHECK" != logic ]; then
    control_scope="--fast"
    if [ "$SELFCHECK" = full ]; then control_scope="--all"; fi
    echo "SELF-CHECK $(date -Is) — sensitivity controls $control_scope"
    if ! ./node_modules/.bin/tsx verify-controls.ts "$control_scope"; then
      echo "harness self-check failed: a sensitivity control did not break its targets" >&2
      exit 3
    fi
  fi
  echo "SELF-CHECK PASS $(date -Is)"
  if [ -n "${BENCH_SELFCHECK_MARKER:-}" ]; then touch "$BENCH_SELFCHECK_MARKER"; fi
fi

# ---- Canary --------------------------------------------------------------------
# Grade the track's calibration candidate through the normal run.sh/grade.sh path
# before any model run. It must be valid and score 100. A broken browser, a
# drained dependency tree, or a suite edit that fails correct code stops the batch
# here instead of publishing a week of harness failures as model scores.
#   BENCH_CANARY=0 skips it with a warning.
if [ "${BENCH_CANARY:-1}" = "0" ]; then
  echo "WARNING: canary skipped; a harness failure would be scored as model results"
else
  canary_id="canary-${TRACK}-${WEEK}-$(date +%s)"
  echo "CANARY $(date -Is) — $canary_id"
  case "$TRACK" in
    build)  AGENT_SKIP=1 OVERLAY="$PWD/../reference" ./run.sh local reference a "$canary_id" > "canary.log" 2>&1 ;;
    bugfix) AGENT_SKIP=1 BENCH_BUG_SET=clean ./run.sh local reference a "$canary_id" > "canary.log" 2>&1 ;;
    tests)  AGENT_SKIP=1 OVERLAY="$PWD/tests-track/oracle-overlay" ./run.sh local oracle a "$canary_id" > "canary.log" 2>&1 ;;
    change) AGENT_SKIP=1 OVERLAY="$PWD/../reference-change" ./run.sh local reference-change a "$canary_id" > "canary.log" 2>&1 ;;
  esac
  canary_score="../runs/$canary_id/artifacts/score.json"
  if ! node -e 'const s=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); process.exit(s.valid===true && s.total===100 ? 0 : 1);' "$canary_score" 2>/dev/null; then
    echo "canary failed: $canary_id did not score a valid 100; see harness/canary.log and $canary_score" >&2
    exit 3
  fi
  # Keep the evidence, drop the 400MB dependency copy.
  rm -rf "../runs/$canary_id/candidate/node_modules" "../runs/$canary_id/candidate/.next"
  echo "CANARY PASS $(date -Is)"
fi

NARMS=$(echo "$ARMS" | wc -w)
TOTAL=$(( ${#MODELS[@]} * REPS * NARMS ))
echo "BATCH START $(date -Is) — ${#MODELS[@]} models x arms[$ARMS] x ${REPS} reps = ${TOTAL} runs"
N=0; OK=0; FAIL=0; SKIP=0

for rep in $(seq 1 "$REPS"); do
  for arm in $ARMS; do
    for entry in "${MODELS[@]}"; do
      IFS='|' read -r provider model slug <<< "$entry"
      run_id="${TRACK_PREFIX}${arm}-${slug}-${WEEK}-r${rep}"
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
