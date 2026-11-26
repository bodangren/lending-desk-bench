#!/usr/bin/env bash
# Daily ingest for the model guide (queue item 1). No model call.
# A dry run writes only to a temporary folder and never calls update.sh.
# A plain run writes the dated files into the private model-guide input and
# calls update.sh --docs. The repository receives only the rebuilt public files.
set -euo pipefail

if [ "${INGEST_ENABLED:-}" != "1" ]; then
  echo "ingest: set INGEST_ENABLED=1"
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "${TMPDIR:-}" in
  ""|/*) ;;
  *)
    echo "ingest: TMPDIR must be absolute"
    exit 2 ;;
esac
DATE="${INGEST_DATE:-$(date -u +%F)}"
DRY=0
if [ $# -eq 1 ] && [ "$1" = "--dry-run" ]; then
  DRY=1
elif [ $# -ne 0 ]; then
  echo "usage: ingest.sh [--dry-run]" >&2
  exit 2
fi

ARGS=(--date "$DATE")
if [ "$DRY" = "1" ]; then
  OUT="$(mktemp -d "${TMPDIR:-/tmp}/model-guide-ingest.XXXXXX")"
  ARGS+=(--dry-run)
else
  PRIVATE_DIR="${MODEL_GUIDE_PRIVATE_DIR:-$HOME/.local/share/lending-desk-bench/model-guide}"
  OUT="$PRIVATE_DIR/input"
fi
ARGS+=(--out "$OUT")

python3 "$SCRIPT_DIR/ingest.py" "${ARGS[@]}"
if [ "$DRY" = "0" ]; then
  UPDATE_ARGS=(--docs)
  if [ "${INGEST_NO_COMMIT:-}" = "1" ]; then
    UPDATE_ARGS+=(--no-commit)
  fi
  bash "$SCRIPT_DIR/update.sh" "${UPDATE_ARGS[@]}" "$OUT/MANIFEST-$DATE.txt"
fi
