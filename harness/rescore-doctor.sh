#!/usr/bin/env bash
# Rescore runs for one week with current harness code: regenerate provenance
# (runner/suite hashes) then rebuild score.json from the persisted results.json
# — no agent re-runs, no test re-runs. This also drops the BENCH_IGNORE_LOAD
# under_load flag the batch runs carry, matching the 2026w35 finalize flow.
#
#   WEEK=2026w36 ./rescore-doctor.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; H="$ROOT/harness"
cd "$H" || exit 1
TSX="$H/node_modules/.bin/tsx"
WEEK="${WEEK:-$(date -u +%Gw%V)}"

mapfile -t HASHES < <("$TSX" provenance.ts --shell)
RUNNER_HASH="${HASHES[0]%%$'\t'*}"; SUITE_HASH="${HASHES[0]#*$'\t'}"
echo "runner=$RUNNER_HASH suite=$SUITE_HASH week=$WEEK"

# slug -> model id map derived from go-pricing.json (slug is the id with dots
# replaced by hyphens; a hyphen in the id would make the reversal ambiguous).
node -e 'const p=require(process.argv[1]).models; for (const id of Object.keys(p)) console.log(id.replaceAll(".","-")+"\t"+id);' \
  "$H/go-pricing.json" > "$H/.tmp-rescore-model-map.txt" || exit 1

for ART in "$ROOT"/runs/*-"$WEEK"/artifacts; do
  [ -d "$ART" ] || { echo "no runs for week $WEEK"; exit 0; }
  RUN_ID="$(basename "$(dirname "$ART")")"
  if [[ "$RUN_ID" =~ ^([ab])-(.+)-$WEEK(-r[0-9]+)?$ ]]; then
    ARM="${BASH_REMATCH[1]}"; SLUG="${BASH_REMATCH[2]}"
  else
    echo "SKIP $RUN_ID (run id not <arm>-<slug>-$WEEK)"; continue
  fi
  MODEL_ID="$(awk -F'\t' -v s="$SLUG" '$1==s{print $2; exit}' "$H/.tmp-rescore-model-map.txt")"
  if [ -z "$MODEL_ID" ]; then
    MODEL_ID="${SLUG//-/.}"
    echo "WARN $RUN_ID: slug not in go-pricing.json, guessing model id $MODEL_ID"
  fi
  CAND="$ROOT/runs/$RUN_ID/candidate"
  [ -d "$CAND" ] || { echo "SKIP $RUN_ID (no candidate)"; continue; }
  [ -f "$ART/results.json" ] || { echo "SKIP $RUN_ID (no results.json)"; continue; }
  [ -f "$ART/candidate-contract.json" ] || { echo "SKIP $RUN_ID (no contract)"; continue; }
  [ -f "$ART/execution-identity.json" ] || { echo "SKIP $RUN_ID (no identity)"; continue; }
  [ -f "$ART/executor-cohort.json" ] || { echo "SKIP $RUN_ID (no cohort)"; continue; }

  CONTRACT="$(node -e 'const c=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(`${c.candidate_sha256}\t${c.fixture_protected_sha256}`)' "$ART/candidate-contract.json")"
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
rm -f "$H/.tmp-rescore-model-map.txt"
echo "RESCORE DONE"
