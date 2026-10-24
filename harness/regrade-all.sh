#!/usr/bin/env bash
# Regrade every historical agent run of the given weeks on the current harness,
# one run at a time (bench_v2 FR-10). Calibration, control, canary, and ad hoc
# runs are left alone. A legacy Pi run keeps every artifact byte: the script
# prints one SKIP line and leaves the run untouched (spec FR-8).
#
#   WEEKS="2026w37 2026w38 2026w39" ./regrade-all.sh
#   ONLY="bf-" WEEKS=2026w37 ./regrade-all.sh      # one track prefix
#
# Then refresh the site: python3 export-site-data.py && python3 generate-model-pages.py
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; H="$ROOT/harness"
WEEKS="${WEEKS:?set WEEKS, e.g. WEEKS=\"2026w37 2026w38\"}"
mkdir -p "$ROOT/reports"
LOG="$ROOT/reports/regrade-all-$(date +%Y%m%d-%H%M).log"
exec > >(tee -a "$LOG") 2>&1
echo "REGRADE-ALL START $(date -Is) weeks=[$WEEKS] only=${ONLY:-all} log=$LOG"

# The executor kind of one run, from its provenance record (spec FR-8).
executor_kind() {
  node -e '
const fs=require("node:fs");
let p; try { p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); } catch { process.stdout.write("unknown"); process.exit(0); }
const ex=p.executor||{};
if (typeof ex.kind==="string" && ex.kind) { process.stdout.write(ex.kind); process.exit(0); }
if (ex.pi) { process.stdout.write("pi"); process.exit(0); }
process.stdout.write("unknown");' "$1"
}

ok=0; fail=0; skip=0
for week in $WEEKS; do
  for dir in "$ROOT"/runs/*-"$week" "$ROOT"/runs/*-"$week"-r[0-9]*; do
    [ -d "$dir" ] || continue
    run_id="$(basename "$dir")"
    [[ "$run_id" =~ ^(bf-|tt-|ch-)?[ab]-.+-${week}(-r[0-9]+)?$ ]] || continue
    if [ -n "${ONLY:-}" ] && [[ "$run_id" != "$ONLY"* ]]; then continue; fi
    if [ "$(executor_kind "$dir/artifacts/provenance.json")" = "pi" ]; then
      echo "SKIP $run_id (legacy Pi executor; artifacts left unchanged)"
      skip=$((skip + 1))
      continue
    fi
    echo "======== $(date -Is) $run_id"
    rc=0
    out="$("$H/regrade-run.sh" "$run_id" 2>&1)" || rc=$?
    printf '%s\n' "$out"
    if [[ "$out" == SKIP* ]]; then skip=$((skip + 1))
    elif [ "$rc" -eq 0 ]; then ok=$((ok + 1))
    else fail=$((fail + 1)); fi
  done
done
echo "REGRADE-ALL END $(date -Is) ok=$ok not-ok=$fail skipped=$skip"
