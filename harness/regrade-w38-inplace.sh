#!/usr/bin/env bash
# In-place regrade for 2026w38 after restoring Playwright Chromium.
# Same approach as reports/regrade-w36-inplace-20260911-2017.log:
# call grade.sh on each existing candidate (no agent re-run).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
H="$ROOT/harness"
# shellcheck source=env.sh
source "$H/env.sh"
cd "$H"
export BENCH_IGNORE_LOAD="${BENCH_IGNORE_LOAD:-1}"
export BENCH_WAIT_FOR_IDLE="${BENCH_WAIT_FOR_IDLE:-0}"
LOG="$ROOT/reports/regrade-w38-inplace-$(date +%Y%m%d-%H%M).log"
mkdir -p "$ROOT/reports"
exec > >(tee -a "$LOG") 2>&1
echo "REGRADE-W38 START $(date -Is) log=$LOG"

pick_ports() {
  local api e2e
  for ((i=0; i<500; i++)); do
    api=$((39000 + RANDOM % 2000))
    e2e=$((api + 1))
    if ! ss -ltnH "sport = :$api" 2>/dev/null | grep -q . \
       && ! ss -ltnH "sport = :$e2e" 2>/dev/null | grep -q .; then
      echo "$api $e2e"
      return 0
    fi
  done
  return 1
}

ok=0; fail=0; skip=0
mapfile -t RUNS < <(python3 - <<'PY'
import json
from pathlib import Path
root = Path("/home/daniebo/Desktop/lending-desk-bench/runs")
for d in sorted(root.glob("*2026w38")):
    if not (d / "candidate").is_dir():
        continue
    score = d / "artifacts" / "score.json"
    model = arm = wall = None
    if score.exists() and score.stat().st_size:
        try:
            s = json.load(open(score))
            model = s.get("model")
            arm = s.get("arm")
            wall = s.get("time_on_task_seconds") or 0
        except Exception:
            pass
    # fallbacks from run id: a-foo-2026w38 / b-foo-2026w38
    name = d.name
    if arm not in ("a", "b"):
        arm = name[0] if name[:2] in ("a-", "b-") else "a"
    if not model:
        # best-effort from score sibling or skip
        print(f"SKIP|{name}|missing-model", flush=True)
        continue
    print(f"{name}|{model}|{arm}|{int(wall or 0)}")
PY
)

for row in "${RUNS[@]}"; do
  IFS='|' read -r run_id model arm wall <<< "$row"
  if [[ "$row" == SKIP\|* ]] || [[ "$run_id" == SKIP* ]]; then
    echo "======== SKIP $row ========"
    skip=$((skip+1))
    continue
  fi
  ports=$(pick_ports) || { echo "FATAL no free ports"; exit 2; }
  api=${ports%% *}; e2e=${ports##* }
  echo ""
  echo "======== REGRADE $run_id model=$model arm=$arm wall=$wall ports=$api/$e2e ========"
  if API_PORT="$api" E2E_PORT="$e2e" BENCH_IGNORE_LOAD=1 \
      ./grade.sh "$run_id" "$model" "$arm" "$wall"; then
    ok=$((ok+1))
    echo "======== RC=0 $run_id ========"
  else
    rc=$?
    fail=$((fail+1))
    echo "======== RC=$rc $run_id ========"
  fi
done

echo ""
echo "REGRADE-W38 MATRIX ok=$ok fail=$fail skip=$skip"
echo "=== rescore-doctor ==="
WEEK=2026w38 ./rescore-doctor.sh
echo "=== recost ==="
./recost.sh
echo "=== export-site-data ==="
python3 ./export-site-data.py
echo "=== generate-model-pages ==="
python3 ./generate-model-pages.py
echo "=== publish docs ==="
cd "$ROOT"
git add docs/
if git diff --cached --quiet; then
  echo "NO_SITE_CHANGES"
else
  git commit -m "$(cat <<'MSG'
Republish 2026w38 OpenCode Go results with browser grading restored.

Daily cache_cleanup had been wiping ~/.cache/ms-playwright, so every
browser-graded criterion (B, C, D, E, F) failed and scores clustered ~20%.
Re-graded valid 2026w38 candidates in place after reinstalling Chromium;
ms-playwright wipe removed from cache_cleanup.sh.
MSG
)"
  for i in 1 2 3; do
    if git push origin main; then echo PUSHED; break; fi
    sleep 30
  done
fi
echo "REGRADE-W38 END $(date -Is)"
