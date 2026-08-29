#!/usr/bin/env bash
# Rewrite go economics on existing score.json files from the pinned price table.
# Does not re-run agents or change functional totals.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
H="$ROOT/harness"
TSX="$H/node_modules/.bin/tsx"
if [ ! -x "$TSX" ]; then
  echo "harness tsx is missing; run npm ci in harness/" >&2
  exit 2
fi
if [ "$#" -gt 0 ]; then
  paths=("$@")
else
  shopt -s nullglob
  paths=("$ROOT"/runs/*/artifacts/score.json)
  shopt -u nullglob
fi
n=0
for path in "${paths[@]}"; do
  [ -f "$path" ] || continue
  "$TSX" "$H/go-cost.ts" --patch-score "$path" >/dev/null
  n=$((n + 1))
done
echo "recosted $n score.json files from harness/go-pricing.json"
