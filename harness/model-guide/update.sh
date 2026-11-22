#!/usr/bin/env bash
# The weekly update of the model guide (spec D19, D21; PM refresh rule).
#
# Usage: update.sh [--docs] <path of MANIFEST-<date>.txt>
# Run it with cwd <repo>. <repo> is three levels above this script. The
# manifest is the `MANIFEST-<date>.txt` of spec D16 (Q-S1, Q-S2). The script
# reads the three dated data files next to it; the date in its name is the
# read date and the export date (Q-S4).
#
# A flagless run is preview-only in both record states. The two data files go
# into <repo>/.tmp/model-guide-preview; no file under docs/ changes and no
# commit runs. --docs asks for the docs write. With no stable record it refuses
# with `update: no approval record` on stdout, exit 2, and no write. With no
# private input it refuses with `update: no private input` on stdout, exit 2.
#
# The stable record is <repo>/harness/model-guide/publish-approval.md (the
# archived consent copy). The script reads no field of the record; the gate is
# its existence. The private input defaults to
# $HOME/.local/share/lending-desk-bench/model-guide and MODEL_GUIDE_PRIVATE_DIR
# overrides it.
#
# A docs run builds the full candidate set in a staging folder: the two data
# files, index.html, real-work.html, and the two review outputs when the
# consumed score differs from the published baseline. It renders through
# preview.sh and guide.ts. A missing overview template refuses before any
# write. leak-check.ts scans exactly the candidate files. Only after the render
# and leak checks pass does the script copy candidates into docs/. A refusal
# leaves docs/ byte-identical and makes no commit.
#
# One git commit holds the data files plus the rebuilt pages, staged with
# explicit paths. An unrelated dirty file stays uncommitted. The script never
# pushes. A commit prints `update: committed <path>` per committed path; a
# no-op prints `update: no change` and exits 0.
#
# A symlink on any path this script writes through is refused with
# `update: refused path <path>` on stdout, exit 2, before any write. A failed
# input check prints the one `input-check: <check> <file>` line of the tool on
# stderr, exits 2, and writes no file into the repo.
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
REVIEW_JSON_OUT="$ROOT/docs/assets/data/review.json"
INDEX_OUT="$ROOT/docs/index.html"
REAL_WORK_PAGE="$ROOT/docs/real-work.html"
REVIEW_PAGE="$ROOT/docs/review.html"
PRIVATE_DIR="${MODEL_GUIDE_PRIVATE_DIR:-$HOME/.local/share/lending-desk-bench/model-guide}"

# The newest review score file wins. The whole-path comparison keeps a name
# with a newline from splitting the choice.
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

# The review outputs join the candidate set when the consumed score differs
# from the published baseline. Without a published score, a complete route is
# the new result worth publishing.
PUBLISH_REVIEW=0
PUBLISH_SCORE=0
if [ -n "$SCORES" ]; then
  if [ -f "$REVIEW_JSON_OUT" ]; then
    if ! cmp -s "$SCORES" "$REVIEW_JSON_OUT"; then
      PUBLISH_REVIEW=1
      PUBLISH_SCORE=1
    fi
  elif score_has_complete_route "$SCORES"; then
    PUBLISH_REVIEW=1
  fi
fi

# A real private input holds seeded-line data. Replicate the folder rule of
# leak-check.ts: <private>/sets/<set>/diffs/*.diff must carry a line of at
# least 20 characters that its src/ counterpart does not carry.
private_has_seeded_input() {
  local dir="$1"
  [ -d "$dir" ] || return 1
  python3 - "$dir" <<'PY'
import os
import re
import sys

root = sys.argv[1]
sets_dir = os.path.join(root, "sets")
if not os.path.isdir(sets_dir):
    raise SystemExit(1)


def body(path):
    out = []
    try:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                match = re.match(r"^L(?:\d+|---) [-+](.*)$", line.rstrip("\n"))
                if match:
                    out.append(match.group(1))
    except OSError:
        pass
    return out


for name in sorted(os.listdir(sets_dir)):
    set_dir = os.path.join(sets_dir, name)
    if not os.path.isdir(set_dir):
        continue
    diffs_dir = os.path.join(set_dir, "diffs")
    if not os.path.isdir(diffs_dir):
        continue
    for diff in sorted(os.listdir(diffs_dir)):
        if not diff.endswith(".diff"):
            continue
        source = set(body(os.path.join(set_dir, "src", diff)))
        for text in body(os.path.join(diffs_dir, diff)):
            if len(text) >= 20 and text not in source:
                raise SystemExit(0)
raise SystemExit(1)
PY
}

# A docs write needs the consent record, a real private input, the guide
# section template and, when a review page will be built, the review template.
# Refuse before any write.
if [ "$DOCS" -eq 1 ] && [ ! -f "$APPROVAL" ]; then
  echo "update: no approval record"
  exit 2
fi
if [ "$DOCS" -eq 1 ] && ! private_has_seeded_input "$PRIVATE_DIR"; then
  echo "update: no private input"
  exit 2
fi
if [ "$DOCS" -eq 1 ] && [ ! -f "$SCRIPT_DIR/pages/guide-section.html" ]; then
  echo "update: no overview template"
  exit 2
fi
if [ "$DOCS" -eq 1 ] && [ "$PUBLISH_REVIEW" -eq 1 ] \
  && [ ! -f "$SCRIPT_DIR/pages/review.html" ]; then
  echo "update: no review template"
  exit 2
fi

# Refuse a symlink on any path this script writes through, before any write.
PREVIEW_CHAIN=()
NEXT="$PREVIEW_ABS"
while [ "$NEXT" != "$ROOT" ] && [ "$NEXT" != "/" ] && [ "$NEXT" != "." ]; do
  PREVIEW_CHAIN=("$NEXT" "${PREVIEW_CHAIN[@]}")
  NEXT="${NEXT%/*}"
done
for path in "$ROOT/docs" "$ROOT/docs/assets" "$DATA_ABS" "$REAL_WORK_OUT" \
  "$MODEL_GUIDE_OUT" "$REVIEW_JSON_OUT" "$INDEX_OUT" "$REAL_WORK_PAGE" \
  "$REVIEW_PAGE" "${PREVIEW_CHAIN[@]}" "$PREVIEW_ABS/real-work.json" \
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

# A flagless run keeps the preview-only branch in both record states.
if [ "$DOCS" -eq 0 ]; then
  mkdir -p "$PREVIEW_ABS"
  cp "$STAGING/real-work.json" "$PREVIEW_ABS/real-work.json"
  cp "$STAGING/model-guide.json" "$PREVIEW_ABS/model-guide.json"
  exit 0
fi

# Render the full candidate set in staging. preview.sh writes only there.
PAGES_PREVIEW="$STAGING/preview"
set +e
bash "$SCRIPT_DIR/preview.sh" --manifest "$MANIFEST_ABS" --preview "$PAGES_PREVIEW"
PREVIEW_STATUS=$?
set -e
if [ "$PREVIEW_STATUS" -ne 0 ]; then
  exit "$PREVIEW_STATUS"
fi
# A second preview over a built index leaves blank lines before the section.
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
if ! grep -q 'id="model-guide"' "$PAGES_PREVIEW/index.html"; then
  echo "update: no overview template"
  exit 2
fi

CAND="$STAGING/candidates"
mkdir -p "$CAND/docs/assets/data"
cp "$STAGING/real-work.json" "$CAND/docs/assets/data/real-work.json"
cp "$STAGING/model-guide.json" "$CAND/docs/assets/data/model-guide.json"
cp "$PAGES_PREVIEW/index.html" "$CAND/docs/index.html"
cp "$PAGES_PREVIEW/real-work.html" "$CAND/docs/real-work.html"
COMMIT_REL=(
  "docs/assets/data/model-guide.json"
  "docs/assets/data/real-work.json"
  "docs/index.html"
  "docs/real-work.html"
)
if [ "$PUBLISH_REVIEW" -eq 1 ]; then
  cp "$PAGES_PREVIEW/review.html" "$CAND/docs/review.html"
  COMMIT_REL+=("docs/review.html")
fi
if [ "$PUBLISH_SCORE" -eq 1 ]; then
  cp "$PAGES_PREVIEW/review.json" "$CAND/docs/assets/data/review.json"
  COMMIT_REL+=("docs/assets/data/review.json")
elif [ "$PUBLISH_REVIEW" -eq 1 ]; then
  # The rendered score is still a candidate for the leak scan before it
  # becomes a published baseline.
  cp "$PAGES_PREVIEW/review.json" "$CAND/docs/assets/data/review.json"
fi

# Scan exactly the candidate files in a throwaway repo. The raw finding never
# reaches stdout: one `update: leak <path>` line is the public refusal.
set +e
LEAK_OUT="$(cd "$ROOT/harness" && npx tsx model-guide/leak-check.ts \
  --private "$PRIVATE_DIR" --repo "$CAND" 2>/dev/null)"
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

# All checks passed. Change docs/ only now, by explicit path.
mkdir -p "$DATA_ABS"
for rel in "${COMMIT_REL[@]}"; do
  cp "$CAND/$rel" "$ROOT/$rel"
done
COMMIT_PATHS=()
for rel in "${COMMIT_REL[@]}"; do
  COMMIT_PATHS+=("$ROOT/$rel")
done

cd "$ROOT"
git add -- "${COMMIT_PATHS[@]}"
CHANGED="$(git diff --cached --name-only -- "${COMMIT_PATHS[@]}" | LC_ALL=C sort)"
if [ -z "$CHANGED" ]; then
  echo "update: no change"
  exit 0
fi
git commit -q -m "data(model-guide): weekly model guide update" \
  -- "${COMMIT_PATHS[@]}"
while IFS= read -r path; do
  echo "update: committed $path"
done <<< "$CHANGED"
