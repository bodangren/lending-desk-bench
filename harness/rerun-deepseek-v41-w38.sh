#!/usr/bin/env bash
# Fresh agent re-run for deepseek-v4.1-flash arms a+b (2026w38), then publish if scored.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
H="$ROOT/harness"
source "$H/env.sh"
cd "$H"
export WEEK=2026w38
export BENCH_IGNORE_LOAD="${BENCH_IGNORE_LOAD:-1}"
export BENCH_WAIT_FOR_IDLE="${BENCH_WAIT_FOR_IDLE:-0}"
export BENCH_SELFCHECK="${BENCH_SELFCHECK:-skip}"
LOG="$ROOT/reports/rerun-deepseek-v41-flash-w38-$(date +%Y%m%d-%H%M).log"
mkdir -p "$ROOT/reports"
exec > >(tee -a "$LOG") 2>&1
echo "RERUN START $(date -Is) log=$LOG"

PW="$HOME/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell"
if [ ! -x "$PW" ] && ! ls "$HOME"/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell >/dev/null 2>&1; then
  echo "FATAL: Playwright Chromium missing" >&2
  exit 2
fi

ok=0; fail=0
for arm in a b; do
  run_id="${arm}-deepseek-v4-1-flash-2026w38"
  echo ""
  echo "======== RUN $run_id ========"
  if THINKING=max AGENT_TIMEOUT="${AGENT_TIMEOUT:-3600}" \
      ./run.sh opencode-go deepseek-v4.1-flash "$arm" "$run_id"; then
    ok=$((ok+1))
    echo "======== RC=0 $run_id ========"
  else
    rc=$?
    fail=$((fail+1))
    echo "======== RC=$rc $run_id ========"
  fi
done

echo "RERUN MATRIX ok=$ok fail=$fail"

# Only publish if at least one valid score exists
python3 - <<'PY'
import json, sys
from pathlib import Path
ok=0
for r in ["a-deepseek-v4-1-flash-2026w38","b-deepseek-v4-1-flash-2026w38"]:
  p=Path(f"/home/daniebo/Desktop/lending-desk-bench/runs/{r}/artifacts/score.json")
  if not p.exists() or p.stat().st_size==0:
    print(r, "no score"); continue
  s=json.load(open(p))
  print(r, "total=", s.get("total"), "valid=", s.get("valid"), "publishable=", s.get("publishable"))
  if s.get("total") is not None and s.get("valid") is not False:
    ok+=1
sys.exit(0 if ok else 1)
PY
scored=$?
if [ "$scored" -ne 0 ]; then
  echo "No scored runs — skip publish"
  echo "RERUN END $(date -Is) published=0"
  exit 1
fi

echo "=== rescore-doctor ==="
WEEK=2026w38 ./rescore-doctor.sh
echo "=== recost ==="
./recost.sh
echo "=== export ==="
python3 ./export-site-data.py
python3 ./generate-model-pages.py
cd "$ROOT"
git add docs/
if git diff --cached --quiet; then
  echo "NO_SITE_CHANGES"
else
  git commit -m "Publish DeepSeek V4.1 Flash 2026w38 re-run."
  for i in 1 2 3; do
    if git push origin main; then echo PUSHED; break; fi
    sleep 30
  done
fi
echo "RERUN END $(date -Is) published=1"
