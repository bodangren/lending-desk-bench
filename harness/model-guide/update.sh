#!/usr/bin/env bash
# The weekly update of the model guide (spec D19, D21).
#
# Usage: update.sh <export file>
# Run it with cwd <repo> (FR-5). <repo> is three levels above this script.
#
# The script runs the input check of real-work.ts first, into a temp folder
# outside the repo. It then writes real-work.json there, runs guide.ts to
# write model-guide.json there, and copies the two files to one folder.
#
# Before the approval record exists, the two files go into the preview
# folder only (<repo>/.tmp/model-guide-preview). The script reads no field
# of the approval record. The gate is the existence of
# <repo>/measure/tracks/model_guide/publish-approval.md (spec D21).
#
# After the approval, the two files go into <repo>/docs/assets/data/, and
# one git commit holds exactly these two paths, staged with explicit paths.
# Another dirty file stays uncommitted. The script never pushes.
#
# A failed input check prints the one `input-check: <check>` line of the
# tool on stdout, exits 2, and writes no file into the repo: no docs write,
# no preview folder, no commit. A failed guide.ts run also writes nothing
# into the repo.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ $# -ne 1 ]; then
  echo "usage: update.sh <export file>" >&2
  exit 2
fi

# Resolve against the caller folder before any cd; use absolute paths only
# after this point.
EXPORT_ABS="$(realpath -m -- "$1")"
PREVIEW_ABS="$ROOT/.tmp/model-guide-preview"
DATA_ABS="$ROOT/docs/assets/data"
GUIDE_DATA="$ROOT/harness/model-guide/data"
APPROVAL="$ROOT/measure/tracks/model_guide/publish-approval.md"
REAL_WORK_OUT="$ROOT/docs/assets/data/real-work.json"
MODEL_GUIDE_OUT="$ROOT/docs/assets/data/model-guide.json"

# The input check and both tools write here first. A refused run leaves the
# repo byte-identical.
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

cd "$ROOT/harness"
set +e
npx tsx model-guide/real-work.ts --input "$EXPORT_ABS" --out "$STAGING"
STATUS=$?
set -e
if [ "$STATUS" -ne 0 ]; then
  exit "$STATUS"
fi

# The newest review score file, when Phase 4 wrote one. Without one track A
# has no rank, which guide.ts accepts.
SCORES=""
for candidate in "$GUIDE_DATA"/review-scores/*.json; do
  if [ -f "$candidate" ]; then
    SCORES="$candidate"
  fi
done

GUIDE_ARGS=(--real-work "$STAGING/real-work.json"
  --print-audit "$GUIDE_DATA/print-audit-2026-11.json"
  --benchmark "$DATA_ABS/benchmark.json"
  --tracks "$DATA_ABS/tracks.json"
  --today "$(date +%F)" --out "$STAGING")
if [ -n "$SCORES" ]; then
  GUIDE_ARGS=(--scores "$SCORES" "${GUIDE_ARGS[@]}")
fi

set +e
npx tsx model-guide/guide.ts "${GUIDE_ARGS[@]}"
GUIDE_STATUS=$?
set -e
if [ "$GUIDE_STATUS" -ne 0 ]; then
  exit "$GUIDE_STATUS"
fi

if [ ! -f "$APPROVAL" ]; then
  mkdir -p "$PREVIEW_ABS"
  cp "$STAGING/real-work.json" "$PREVIEW_ABS/real-work.json"
  cp "$STAGING/model-guide.json" "$PREVIEW_ABS/model-guide.json"
  exit 0
fi

mkdir -p "$DATA_ABS"
cp "$STAGING/real-work.json" "$REAL_WORK_OUT"
cp "$STAGING/model-guide.json" "$MODEL_GUIDE_OUT"

cd "$ROOT"
git add -- "$REAL_WORK_OUT" "$MODEL_GUIDE_OUT"
git commit -q -m "data(model-guide): weekly model guide update" \
  -- "$REAL_WORK_OUT" "$MODEL_GUIDE_OUT"
