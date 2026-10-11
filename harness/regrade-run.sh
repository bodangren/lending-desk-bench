#!/usr/bin/env bash
# Regrade one historical agent run on the current harness (bench_v2 FR-10).
#
#   ./regrade-run.sh <run-id>
#
# The agent's writable files are grafted onto a fresh current comparison tree
# (fixture/, or the track's regenerated variant), so every regraded run shares one
# ruler with new runs. The agent's original tree stays in candidate-original/.
# Contract violations come from the run's own original verdict (its
# candidate-contract.json against the fixture revision it ran on): comparing an
# r1 tree with the r2 fixture would report the revision's own edits as violations.
#
# The previous artifacts move to artifacts.prev-<stamp>/. The transcript,
# execution identity, executor cohort, and diff are copied forward. If grading
# fails for a harness reason (grade.sh exit 4), the previous artifacts come back.
# Runs whose agent produced nothing, or whose tree has a hard violation, are
# skipped and keep their record.
set -uo pipefail
RUN_ID="${1:?usage: regrade-run.sh <run-id>}"
[[ "$RUN_ID" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$ ]] || { echo "unsafe run id: $RUN_ID" >&2; exit 2; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; H="$ROOT/harness"
# shellcheck source=env.sh
source "$H/env.sh"
TSX="$H/node_modules/.bin/tsx"
WORK="$ROOT/runs/$RUN_ID"; OUT="$WORK/artifacts"
[ -d "$OUT" ] || { echo "SKIP $RUN_ID (no artifacts)"; exit 0; }

case "$RUN_ID" in
  bf-*) TRACK=bugfix; SET_FILE=bug-set.json;    SET_DEFAULT="$H/bugfix/sets/v1.json";      GENERATOR="$H/bugfix/make-variant.ts" ;;
  tt-*) TRACK=tests;  SET_FILE=mutant-set.json; SET_DEFAULT="$H/tests-track/sets/m1.json"; GENERATOR="$H/tests-track/make-variant.ts" ;;
  ch-*) TRACK=change; SET_FILE=change-set.json; SET_DEFAULT="$H/change/sets/c1.json";      GENERATOR="$H/change/make-variant.ts" ;;
  *)    TRACK=build;  SET_FILE="";              SET_DEFAULT="";                            GENERATOR="" ;;
esac

ORIGINAL="$WORK/candidate"
[ -d "$WORK/candidate-original" ] && ORIGINAL="$WORK/candidate-original"
[ -d "$ORIGINAL" ] || { echo "SKIP $RUN_ID (no candidate tree)"; exit 0; }

# Identity and history from the previous record.
IFS=$'\t' read -r MODEL ARM MODE REVISION AGENT_EXIT WALL THINKING SKIP_REASON < <(node -e '
const fs=require("node:fs"), dir=process.argv[1];
const read=(name)=>{ try { return JSON.parse(fs.readFileSync(dir+"/"+name,"utf8")); } catch { return {}; } };
const p=read("provenance.json"), s=read("score.json");
const reasons=[...(s.invalid_reasons||[]), s.invalid||""].join(" ");
const skip=/no changes|no output tokens|provenance could not|variant generation/.test(reasons) ? reasons.replace(/\s+/g," ").slice(0,80) : "";
const model=p.model||s.model||"", arm=p.arm||s.arm||"";
process.stdout.write([model, arm, p.mode||"agent", Number.isInteger(p.fixture_revision)?p.fixture_revision:1,
  Number.isInteger(s.agent_exit)?s.agent_exit:0, Number.isFinite(s.time_on_task_seconds)?s.time_on_task_seconds:0,
  s.thinking_requested||"max", skip||"-"].join("\t")+"\n");' "$OUT")
[ "$SKIP_REASON" = "-" ] || { echo "SKIP $RUN_ID (agent run produced no gradeable work: $SKIP_REASON)"; exit 0; }
[ -n "$MODEL" ] && [[ "$ARM" =~ ^[ab]$ ]] || { echo "SKIP $RUN_ID (no model or arm on record)"; exit 0; }
[ -s "$OUT/execution-identity.json" ] && [ -s "$OUT/executor-cohort.json" ] || { echo "SKIP $RUN_ID (no execution identity)"; exit 0; }

# The original verdict: the contract as the run was graded, on its own revision.
VIOLATION_CLASS=$(node -e '
const fs=require("node:fs");
let c; try { c=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); } catch { process.stdout.write("none"); process.exit(0); }
if (c.valid===true) { process.stdout.write("none"); process.exit(0); }
const reasons=c.reasons||[];
const hard=reasons.some((r)=>/symlink|unsupported filesystem entry|nested runtime directory|contains \.git|root must be|directory is missing/.test(r));
if (hard) { process.stdout.write("hard"); process.exit(0); }
const soft=new Set(c.soft||[]);
for (const r of reasons) {
  if (/adds file/.test(r)) soft.add("files_added");
  if (/missing fixture file/.test(r)) soft.add("files_missing");
  if (/modified protected/.test(r)) soft.add("protected_modified");
  if (/public export|public API inspection/.test(r)) soft.add("surface_changed");
  if (/compiler suppression/.test(r)) soft.add("ts_suppression");
  if (/test files exceed/.test(r)) soft.add("test_limits");
}
fs.writeFileSync(process.argv[2], JSON.stringify({ schema: 1, source: "original-verdict", fixture_revision: Number(process.argv[3]), reasons, soft: [...soft].sort(), hard: [] }, null, 2)+"\n");
process.stdout.write("soft");' "$OUT/candidate-contract.json" "$WORK/.regrade-violation.json" "$REVISION")
[ "$VIOLATION_CLASS" = "hard" ] && { echo "SKIP $RUN_ID (hard contract violation on record)"; exit 0; }

STAMP=$(date +%Y%m%d%H%M%S)
PREV="$WORK/artifacts.prev-$STAMP"
mv "$OUT" "$PREV"
mkdir -p "$OUT"
for keep in session.json.gz session.json session.err execution-identity.json executor-cohort.json candidate.diff pi-agent; do
  [ -e "$PREV/$keep" ] && cp -a "$PREV/$keep" "$OUT/$keep"
done
[ -s "$WORK/.regrade-violation.json" ] && mv "$WORK/.regrade-violation.json" "$OUT/contract-violation.json"

restore_previous() {
  echo "[$RUN_ID] $1; restoring the previous artifacts" >&2
  rm -rf "$OUT"; mv "$PREV" "$OUT"
  # The agent's tree stays in candidate-original; a later attempt grafts again.
  rm -rf "$WORK/candidate/node_modules" "$WORK/candidate/.next"
  exit 4
}

# Comparison tree: the current fixture, or the track's variant regenerated from
# the run's own frozen set.
ROOT_TREE="$ROOT/fixture"
if [ "$TRACK" != build ]; then
  SET_PATH="$SET_DEFAULT"
  [ -s "$PREV/$SET_FILE" ] && SET_PATH="$PREV/$SET_FILE"
  cp "$SET_PATH" "$OUT/$SET_FILE"
  rm -rf "$WORK/variant"
  "$TSX" "$GENERATOR" --out "$WORK/variant" --set "$OUT/$SET_FILE" > "$OUT/variant-manifest.json" \
    || restore_previous "variant generation failed"
  ROOT_TREE="$WORK/variant"
fi

# Graft: the agent's regular writable files onto a fresh comparison tree.
if [ "$ORIGINAL" = "$WORK/candidate" ]; then
  rm -rf "$WORK/candidate-original"
  mv "$WORK/candidate" "$WORK/candidate-original"
  ORIGINAL="$WORK/candidate-original"
fi
rm -rf "$WORK/candidate"
"$TSX" "$H/candidate-contract.ts" --graft "$ROOT_TREE" "$ORIGINAL" "$WORK/candidate" --track "$TRACK" > "$OUT/graft.json" \
  || restore_previous "graft failed"
FROM_SHA=$("$TSX" "$H/candidate-contract.ts" "$ROOT_TREE" "$ORIGINAL" --track "$TRACK" 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).candidate_sha256||"")}catch{}})')
[[ "$FROM_SHA" =~ ^[a-f0-9]{64}$ ]] || restore_previous "original tree could not be hashed"
printf '{"reason":"regrade","from_candidate_sha256":"%s","from_fixture_revision":%s}\n' "$FROM_SHA" "$REVISION" > "$OUT/graft-provenance.json"

CONTRACT_RC=0
"$TSX" "$H/candidate-contract.ts" "$ROOT_TREE" "$WORK/candidate" --track "$TRACK" > "$OUT/candidate-contract.json" || CONTRACT_RC=$?
if [ "$CONTRACT_RC" -ne 0 ] && [ "$CONTRACT_RC" -ne 3 ]; then restore_previous "grafted candidate is not gradeable"; fi

GRAFT_JSON="$OUT/graft-provenance.json" RUN_ID="$RUN_ID" ARM="$ARM" MODEL="$MODEL" MODE="$MODE" BENCH_TRACK="$TRACK" \
  FIXTURE_REVISION="$REVISION" "$TSX" "$H/provenance-record.ts" "$OUT" || restore_previous "provenance could not be written"

pick_port() {
  local port
  for _ in $(seq 1 400); do
    port=$((41000 + RANDOM % 8000))
    if ! ss -ltnH "sport = :$port" 2>/dev/null | grep -q .; then echo "$port"; return 0; fi
  done
  return 1
}
API_PORT=$(pick_port) || restore_previous "no free port"
E2E_PORT=$(pick_port) || restore_previous "no free port"
[ "$API_PORT" != "$E2E_PORT" ] || E2E_PORT=$((API_PORT + 1))

echo "[$RUN_ID] regrade track=$TRACK model=$MODEL arm=$ARM revision=$REVISION contract=$VIOLATION_CLASS"
RC=0
AGENT_EXIT="$AGENT_EXIT" THINKING="$THINKING" API_PORT="$API_PORT" E2E_PORT="$E2E_PORT" BENCH_TRACK="$TRACK" \
  "$H/grade.sh" "$RUN_ID" "$MODEL" "$ARM" "$WALL" || RC=$?
# Drain the private dependency copy: 442MB per regraded run would fill the disk.
rm -rf "$WORK/candidate/node_modules" "$WORK/candidate/.next"
if [ "$RC" -eq 4 ] || [ "$RC" -eq 2 ]; then restore_previous "grade.sh stopped with exit $RC"; fi
node -e 'const s=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); console.log(`[${s.run_id ?? process.argv[2]}] REGRADED total=${s.total} valid=${s.valid} adherence=${s.adherence?.contract ?? "-"} ${(s.invalid_reasons||[]).slice(0,2).join("; ")}`);' "$OUT/score.json" "$RUN_ID"
exit "$RC"
