#!/usr/bin/env bash
# One-off: rescore all 2026w35 runs with the patched react-doctor (relocated scan).
# Regenerates provenance (runner/suite hashes) then rebuilds score.json from the
# persisted results.json — no agent re-runs, no test re-runs.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; H="$ROOT/harness"
cd "$H" || exit 1
TSX="$H/node_modules/.bin/tsx"

mapfile -t HASHES < <("$TSX" provenance.ts --shell)
RUNNER_HASH="${HASHES[0]%%$'\t'*}"; SUITE_HASH="${HASHES[0]#*$'\t'}"
echo "runner=$RUNNER_HASH suite=$SUITE_HASH"

for ART in "$ROOT"/runs/*-2026w35/artifacts; do
  RUN_ID="$(basename "$(dirname "$ART")")"
  CAND="$ROOT/runs/$RUN_ID/candidate"
  [ -d "$CAND" ] || { echo "SKIP $RUN_ID (no candidate)"; continue; }
  [ -f "$ART/results.json" ] || { echo "SKIP $RUN_ID (no results.json)"; continue; }
  [ -f "$ART/candidate-contract.json" ] || { echo "SKIP $RUN_ID (no contract)"; continue; }
  [ -f "$ART/execution-identity.json" ] || { echo "SKIP $RUN_ID (no identity)"; continue; }
  [ -f "$ART/executor-cohort.json" ] || { echo "SKIP $RUN_ID (no cohort)"; continue; }

  ARM="${RUN_ID:0:1}"
  SLUG="${RUN_ID:2}"; SLUG="${SLUG%-2026w35}"
  MODEL_ID="${SLUG//-/.}"
  # slug dots->hyphens reversal is imperfect for ids containing hyphens; map explicitly:
  case "$SLUG" in
    glm-5-3-flash) MODEL_ID="glm-5.3-flash" ;;
    gpt-5-6-luna) MODEL_ID="gpt-5.6-luna" ;;
    deepseek-v4-flash) MODEL_ID="deepseek-v4-flash" ;;
    deepseek-v4-flash-vision-exp) MODEL_ID="deepseek-v4-flash-vision-exp" ;;
    muse-spark-1-2-contributor) MODEL_ID="muse-spark-1.2-contributor" ;;
    qwen3-6-plus) MODEL_ID="qwen3.6-plus" ;;
    qwen3-7-plus) MODEL_ID="qwen3.7-plus" ;;
    qwen3-8-flash) MODEL_ID="qwen3.8-flash" ;;
    longcat-2-0) MODEL_ID="longcat-2.0" ;;
    mimo-v2-5) MODEL_ID="mimo-v2.5" ;;
    mimo-v2-5-pro) MODEL_ID="mimo-v2.5-pro" ;;
    minimax-m3) MODEL_ID="minimax-m3" ;;
    minimax-m2-7) MODEL_ID="minimax-m2.7" ;;
    hy3) MODEL_ID="hy3" ;;
  esac

  CONTRACT="$("node" -e 'const c=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(`${c.candidate_sha256}\t${c.fixture_protected_sha256}`)' "$ART/candidate-contract.json")"
  CAND_HASH="${CONTRACT%%$'\t'*}"; FIX_HASH="${CONTRACT#*$'\t'}"
  IDENTITY_HASH="$("$TSX" execution-identity.ts --fingerprint "$ART/execution-identity.json")" || { echo "FAIL $RUN_ID (identity fp)"; continue; }

  ARM_VALUE="$ARM" RUN_ID_VALUE="$RUN_ID" MODE_VALUE="agent" MODEL_VALUE="opencode-go/$MODEL_ID" \
    CANDIDATE_HASH="$CAND_HASH" FIXTURE_HASH="$FIX_HASH" RUNNER_HASH="$RUNNER_HASH" SUITE_HASH="$SUITE_HASH" \
    ISOLATED_VALUE="true" IDENTITY_PATH="$ART/execution-identity.json" COHORT_PATH="$ART/executor-cohort.json" \
    IDENTITY_HASH="$IDENTITY_HASH" node -e 'const fs=require("node:fs"); const e=process.env; const executor=JSON.parse(fs.readFileSync(e.IDENTITY_PATH,"utf8")),cohort=JSON.parse(fs.readFileSync(e.COHORT_PATH,"utf8")); console.log(JSON.stringify({ schema: 4, run_id: e.RUN_ID_VALUE, arm: e.ARM_VALUE, model: e.MODEL_VALUE, mode: e.MODE_VALUE, candidate_sha256: e.CANDIDATE_HASH, fixture_protected_sha256: e.FIXTURE_HASH, runner_sha256: e.RUNNER_HASH, suite_sha256: e.SUITE_HASH, agent_isolated: true, candidate_contract_schema: 1, cohort_id: cohort.id, executor_cohort: cohort, executor, execution_identity_sha256: e.IDENTITY_HASH }));' \
    > "$ART/provenance.json" || { echo "FAIL $RUN_ID (provenance write)"; continue; }

  OLD_TOTAL="$(node -e 'try{console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).total)}catch{console.log("none")}' "$ART/score.json")"
  OLD_WALL="$(node -e 'try{const t=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).time_on_task_seconds;console.log(Number.isFinite(t)?t:0)}catch{console.log(0)}' "$ART/score.json")"
  CANDIDATE="$CAND" ARTIFACTS="$ART" AGENT_EXIT=0 \
    WALL_SECONDS="$OLD_WALL" GRADING_SECONDS=0 MODEL="opencode-go/$MODEL_ID" ARM="$ARM" RUN_ID="$RUN_ID" THINKING=max \
    GATE_BLOCKED=0 "$TSX" score.ts > "$ART/score.json.new" 2>"$ART/score-rescore.err" || { echo "FAIL $RUN_ID (score.ts)"; tail -2 "$ART/score-rescore.err"; rm -f "$ART/score.json.new"; continue; }

  VALID="$(node -e 'const s=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));console.log(s.valid===true?"valid":"INVALID:"+JSON.stringify(s.invalid_reasons))' "$ART/score.json.new")"
  if [[ "$VALID" == valid ]]; then
    mv "$ART/score.json.new" "$ART/score.json"
    NEW_TOTAL="$(node -e 'const s=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));console.log(`${s.total} q=${s.axes.quality} pen=${s.doctor.penalty_over_reference} w=${s.doctor.warnings}`)' "$ART/score.json")"
    echo "OK   $RUN_ID  $OLD_TOTAL -> $NEW_TOTAL"
  else
    echo "FAIL $RUN_ID ($VALID)"; rm -f "$ART/score.json.new"
  fi
done
echo "RESCORE DONE"
