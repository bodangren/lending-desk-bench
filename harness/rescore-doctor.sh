#!/usr/bin/env bash
# Rescore runs for one week with current harness code: rewrite provenance with
# the current runner/suite hashes, then rebuild score.json from the persisted
# results.json — no agent re-runs, no test re-runs. Covers all four tracks.
#
#   WEEK=2026w36 ./rescore-doctor.sh
#
# Each run keeps its own identity from its provenance.json: model, arm, mode,
# fixture revision, and graft record. The executor is attested against the Pi
# binary the run recorded, so a week graded before a Pi upgrade still rescores
# (executor-attestation.ts). A score.json is replaced only by a valid record.
# A suite edit that changes what the tests assert needs regrade-run.sh instead:
# a rescore reuses the old results.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; H="$ROOT/harness"
cd "$H" || exit 1
TSX="$H/node_modules/.bin/tsx"
WEEK="${WEEK:-$(date -u +%Gw%V)}"
echo "rescore week=$WEEK $("$TSX" provenance.ts)"

shopt -s nullglob
for ART in "$ROOT"/runs/*-"$WEEK"/artifacts "$ROOT"/runs/*-"$WEEK"-r[0-9]*/artifacts; do
  RUN_ID="$(basename "$(dirname "$ART")")"
  if [[ "$RUN_ID" =~ ^(bf-|tt-|ch-)?([ab])-(.+)-$WEEK(-r[0-9]+)?$ ]]; then
    case "${BASH_REMATCH[1]}" in
      bf-) TRACK=bugfix ;; tt-) TRACK=tests ;; ch-) TRACK=change ;; *) TRACK=build ;;
    esac
  else
    echo "SKIP $RUN_ID (run id not [prefix]<arm>-<slug>-$WEEK[-rN])"; continue
  fi
  CAND="$ROOT/runs/$RUN_ID/candidate"
  [ -d "$CAND" ] || { echo "SKIP $RUN_ID (no candidate)"; continue; }
  for needed in results.json provenance.json execution-identity.json executor-cohort.json; do
    [ -f "$ART/$needed" ] || { echo "SKIP $RUN_ID (no $needed)"; continue 2; }
  done
  ROOT_TREE="$ROOT/fixture"
  [ "$TRACK" != build ] && ROOT_TREE="$ROOT/runs/$RUN_ID/variant"
  [ -d "$ROOT_TREE" ] || { echo "SKIP $RUN_ID (no comparison tree)"; continue; }

  # The run's own identity, fixture revision, and graft record.
  IFS=$'\t' read -r MODEL ARM MODE REVISION < <(node -e 'const p=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); process.stdout.write([p.model, p.arm, p.mode, Number.isInteger(p.fixture_revision) ? p.fixture_revision : 1].join("\t")+"\n");' "$ART/provenance.json")
  GRAFT="$ART/.rescore-graft.json"
  node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (p.graft) fs.writeFileSync(process.argv[2], JSON.stringify(p.graft)); else fs.rmSync(process.argv[2], { force: true });' "$ART/provenance.json" "$GRAFT"

  CONTRACT_RC=0
  "$TSX" candidate-contract.ts "$ROOT_TREE" "$CAND" --track "$TRACK" > "$ART/candidate-contract.json" || CONTRACT_RC=$?
  if [ "$CONTRACT_RC" -ne 0 ] && [ "$CONTRACT_RC" -ne 3 ]; then echo "FAIL $RUN_ID (candidate contract exit $CONTRACT_RC)"; continue; fi

  cp "$ART/provenance.json" "$ART/provenance.json.prev"
  GRAFT_ENV=()
  [ -s "$GRAFT" ] && GRAFT_ENV=("GRAFT_JSON=$GRAFT")
  if ! env "${GRAFT_ENV[@]}" RUN_ID="$RUN_ID" ARM="$ARM" MODEL="$MODEL" MODE="$MODE" BENCH_TRACK="$TRACK" \
      FIXTURE_REVISION="$REVISION" "$TSX" provenance-record.ts "$ART" 2> "$ART/score-rescore.err"; then
    echo "FAIL $RUN_ID (provenance write)"; tail -2 "$ART/score-rescore.err"
    mv "$ART/provenance.json.prev" "$ART/provenance.json"; continue
  fi
  rm -f "$GRAFT"

  OLD_TOTAL="$(node -e 'try{console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).total)}catch{console.log("none")}' "$ART/score.json")"
  OLD_WALL="$(node -e 'try{const t=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).time_on_task_seconds;console.log(Number.isFinite(t)?t:0)}catch{console.log(0)}' "$ART/score.json")"
  CANDIDATE="$CAND" ARTIFACTS="$ART" VARIANT="$ROOT/runs/$RUN_ID/variant" BENCH_TRACK="$TRACK" AGENT_EXIT=0 \
    WALL_SECONDS="$OLD_WALL" GRADING_SECONDS=0 MODEL="$MODEL" ARM="$ARM" RUN_ID="$RUN_ID" THINKING=max \
    GATE_BLOCKED=0 "$TSX" score.ts > "$ART/score.json.new" 2>>"$ART/score-rescore.err" || {
      echo "FAIL $RUN_ID (score.ts)"; tail -2 "$ART/score-rescore.err"; rm -f "$ART/score.json.new"
      mv "$ART/provenance.json.prev" "$ART/provenance.json"; continue; }

  VALID="$(node -e 'const s=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));console.log(s.valid===true?"valid":"INVALID:"+JSON.stringify(s.invalid_reasons))' "$ART/score.json.new")"
  if [[ "$VALID" == valid ]]; then
    mv "$ART/score.json.new" "$ART/score.json"
    rm -f "$ART/provenance.json.prev"
    NEW_TOTAL="$(node -e 'const s=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));console.log(`${s.total} adherence=${s.adherence?.contract} q=${s.axes.quality}`)' "$ART/score.json")"
    echo "OK   $RUN_ID  $OLD_TOTAL -> $NEW_TOTAL"
  else
    echo "FAIL $RUN_ID ($VALID)"; rm -f "$ART/score.json.new"
    mv "$ART/provenance.json.prev" "$ART/provenance.json"
  fi
done
echo "RESCORE DONE"
