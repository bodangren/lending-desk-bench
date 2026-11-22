#!/usr/bin/env bash
# The weekly update of the model guide (spec D19, D21).
#
# Usage: update.sh <path of MANIFEST-<date>.txt>
# Run it with cwd <repo> (FR-5). <repo> is three levels above this script.
# The manifest is the `MANIFEST-<date>.txt` of spec D16 (Q-S1, Q-S2). The
# script reads the three dated data files next to it; the date in its name is
# the read date and the export date (Q-S4).
#
# The script runs the input check of real-work.ts first, into a temp folder
# outside the repo. It then writes real-work.json there, runs guide.ts to
# write model-guide.json there, and copies the two files to one folder.
#
# Before the approval record exists, the two files go into the preview
# folder only (<repo>/.tmp/model-guide-preview). The script reads no field
# of the approval record. The gate is the existence of the stable record
# <repo>/harness/model-guide/publish-approval.md (spec D21).
#
# The --docs flag asks for the docs write. With no stable record, --docs
# refuses with `update: no approval record` on stdout, exit 2, and no write.
# A plain run without --docs keeps the preview-only branch.
#
# After the approval, the two files go into <repo>/docs/assets/data/, and
# preview.sh and guide.ts rebuild docs/index.html and docs/real-work.html.
# docs/review.html joins them only when a score file changed. One git commit
# holds the data files plus the rebuilt pages, staged with explicit paths.
# Another dirty file stays uncommitted. The script never pushes. A rerun
# with unchanged data exits 0 and makes no commit.
#
# Before the commit, leak-check.ts scans the files of the run. A hit refuses
# with one `update: leak <path>` line on stdout, exit 2, and no commit.
#
# A symlink on any path this script writes through is refused with
# `update: refused path <path>` on stdout, exit 2, before any write, the
# same way preview.sh refuses a symlink under docs/. The paths are
# <repo>/docs, <repo>/docs/assets, <repo>/docs/assets/data, the two docs
# target files, the preview folder and each parent of it inside the repo,
# and its two target files.
#
# A failed input check prints the one `input-check: <check> <file>` line of
# the tool on stderr, exits 2, and writes no file into the repo: no docs
# write, no preview folder, no commit. A failed guide.ts run also writes
# nothing into the repo.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

DOCS=0
if [ $# -eq 0 ]; then
  echo "usage: update.sh <path of MANIFEST-<date>.txt>" >&2
  exit 2
fi
if [ "$1" = "--docs" ]; then
  DOCS=1
  shift
fi
if [ $# -ne 1 ]; then
  echo "usage: update.sh <path of MANIFEST-<date>.txt>" >&2
  exit 2
fi

# Resolve against the caller folder before any cd; use absolute paths only
# after this point.
MANIFEST_ABS="$(realpath -m -- "$1")"
PREVIEW_ABS="$ROOT/.tmp/model-guide-preview"
DATA_ABS="$ROOT/docs/assets/data"
GUIDE_DATA="$ROOT/harness/model-guide/data"
APPROVAL="$ROOT/harness/model-guide/publish-approval.md"
REAL_WORK_OUT="$ROOT/docs/assets/data/real-work.json"
MODEL_GUIDE_OUT="$ROOT/docs/assets/data/model-guide.json"
INDEX_OUT="$ROOT/docs/index.html"
REAL_WORK_PAGE="$ROOT/docs/real-work.html"
REVIEW_PAGE="$ROOT/docs/review.html"

# A docs write needs the stable consent record. Refuse before any write.
if [ "$DOCS" -eq 1 ] && [ ! -f "$APPROVAL" ]; then
  echo "update: no approval record"
  exit 2
fi

# Refuse a symlink on any path this script writes through, before any write
# (spec D21), the same way preview.sh refuses a symlink under docs/: the
# three data folders, the two docs target files, the preview folder and each
# parent of it inside the repo, and its two target files. A linked name
# takes a write outside its folder.
PREVIEW_CHAIN=()
NEXT="$PREVIEW_ABS"
while [ "$NEXT" != "$ROOT" ] && [ "$NEXT" != "/" ] && [ "$NEXT" != "." ]; do
  PREVIEW_CHAIN=("$NEXT" "${PREVIEW_CHAIN[@]}")
  NEXT="${NEXT%/*}"
done
for path in "$ROOT/docs" "$ROOT/docs/assets" "$DATA_ABS" "$REAL_WORK_OUT" \
  "$MODEL_GUIDE_OUT" "${PREVIEW_CHAIN[@]}" "$PREVIEW_ABS/real-work.json" \
  "$PREVIEW_ABS/model-guide.json"; do
  if [ -L "$path" ]; then
    echo "update: refused path $path"
    exit 2
  fi
done

# The input check and both tools write here first. A refused run leaves the
# repo byte-identical.
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

cd "$ROOT/harness"
set +e
npx tsx model-guide/real-work.ts --manifest "$MANIFEST_ABS" --out "$STAGING"
STATUS=$?
set -e
if [ "$STATUS" -ne 0 ]; then
  exit "$STATUS"
fi

# The newest review score file, when Phase 4 wrote one. Without one track A
# has no rank, which guide.ts accepts. These lines are the shared rule with
# preview.sh: the file with the newest modification time wins, and a name
# that holds a newline cannot split the choice, because the test compares
# whole paths.
newest_score_file() {
  local folder="$1"
  local candidate newest=""
  [ -d "$folder" ] || return 0
  for candidate in "$folder"/*.json; do
    [ -f "$candidate" ] || continue
    if [ -z "$newest" ] || [ "$candidate" -nt "$newest" ]; then
      newest="$candidate"
    fi
  done
  printf '%s' "$newest"
}
SCORES="$(newest_score_file "$GUIDE_DATA/review-scores")"

# The review page joins the commit only when the newest score file holds a new
# result: a route with three complete passes. A file with only incomplete
# routes keeps the old review page out of the weekly commit.
score_has_complete_route() {
  local file="$1"
  [ -n "$file" ] && [ -f "$file" ] || return 1
  python3 - "$file" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        doc = json.load(handle)
except (OSError, ValueError):
    raise SystemExit(1)
routes = doc.get("routes") if isinstance(doc, dict) else None
raise SystemExit(0 if any(
    isinstance(row, dict) and row.get("state") == "complete"
    for row in (routes or [])
) else 1)
PY
}
INCLUDE_REVIEW=0
if score_has_complete_route "$SCORES"; then
  INCLUDE_REVIEW=1
fi

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

# Rebuild the affected pages through the first-publish path. preview.sh reads
# the same export and tools and writes only into the staging preview folder,
# so the docs branch adds no untracked folder to the repo.
PAGES_PREVIEW="$STAGING/preview"
set +e
bash "$SCRIPT_DIR/preview.sh" --manifest "$MANIFEST_ABS" --preview "$PAGES_PREVIEW"
PREVIEW_STATUS=$?
set -e
if [ "$PREVIEW_STATUS" -ne 0 ]; then
  exit "$PREVIEW_STATUS"
fi
# A second preview over an already built index leaves blank lines before the
# guide section. Collapse them so a rerun with unchanged data is byte-stable.
python3 - "$PAGES_PREVIEW/index.html" <<'PY'
import re
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    text = handle.read()
text = re.sub(
    r'\n(?:[ \t]*\n)+(?=<section[^>]*id="model-guide")',
    '\n',
    text,
)
with open(path, "w", encoding="utf-8") as handle:
    handle.write(text)
PY
cp "$PAGES_PREVIEW/index.html" "$INDEX_OUT"
cp "$PAGES_PREVIEW/real-work.html" "$REAL_WORK_PAGE"
REVIEW_PATH=""
if [ "$INCLUDE_REVIEW" -eq 1 ] && [ -f "$PAGES_PREVIEW/review.html" ]; then
  cp "$PAGES_PREVIEW/review.html" "$REVIEW_PAGE"
  REVIEW_PATH="$REVIEW_PAGE"
fi

# Run the leak check over the commit set before git add. The raw finding never
# reaches stdout: one `update: leak <path>` line is the public refusal.
PRIVATE_DIR="$ROOT/.tmp/model-guide-private"
set +e
LEAK_OUT="$(cd "$ROOT/harness" && npx tsx model-guide/leak-check.ts \
  --private "$PRIVATE_DIR" --repo "$ROOT" --preview "$PAGES_PREVIEW" 2>/dev/null)"
LEAK_STATUS=$?
set -e
if [ "$LEAK_STATUS" -ne 0 ]; then
  FIRST="$(printf '%s\n' "$LEAK_OUT" | head -n 1)"
  LEAK_TARGET="${FIRST#*: }"
  LEAK_TARGET="${LEAK_TARGET#*: }"
  LEAK_PATH="${LEAK_TARGET%% *}"
  echo "update: leak $LEAK_PATH"
  exit 2
fi

cd "$ROOT"
COMMIT_PATHS=("$REAL_WORK_OUT" "$MODEL_GUIDE_OUT" "$INDEX_OUT" "$REAL_WORK_PAGE")
if [ -n "$REVIEW_PATH" ]; then
  COMMIT_PATHS+=("$REVIEW_PATH")
fi
git add -- "${COMMIT_PATHS[@]}"
# A weekly rerun with unchanged data exits 0 and makes no commit (spec D19).
if git diff --cached --quiet -- "${COMMIT_PATHS[@]}"; then
  exit 0
fi
git commit -q -m "data(model-guide): weekly model guide update" \
  -- "${COMMIT_PATHS[@]}"
