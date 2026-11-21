#!/usr/bin/env bash
set -euo pipefail
W=$1
OUT=$2
SIDE=$3
HOUR=$(date +%H)
if (( 10#$HOUR >= 2 && 10#$HOUR < 6 )); then
  echo "FAIL: the night window is closed"
  exit 1
fi
echo "START=$(date -Is)"
cd "$W/harness"
npm ci > "$OUT/$SIDE-npm-ci.log" 2>&1
npm ls --depth=0 > "$OUT/$SIDE-npm-ls.txt" 2>&1
cd "$W"
BENCH_TRACK=build ./harness/node_modules/.bin/tsx "$OUT/scan.mjs" "$W" "$OUT" "$SIDE"
echo "END=$(date -Is)"
