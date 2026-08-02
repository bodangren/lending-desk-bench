#!/usr/bin/env bash
# Regrade an existing candidate tree under the *current* harness.
#
#   ./regrade.sh <source-run-id> <dest-run-id> [provider] [model] [arm]
#
# Copies the source candidate's writable task files onto a fresh fixture,
# records overlay (diagnostic, non-rankable) provenance, and runs grade.sh.
# Use this when:
#   - the harness/suite has changed and historical scores are STALE-PROVENANCE
#   - you need functional totals without re-invoking a model (no API key)
#
# Destination run ids must be new or disposable: run.sh deletes dest first.
# Never point dest at a source run you still want to keep.
set -euo pipefail

SRC_ID="${1:?usage: regrade.sh <source-run-id> <dest-run-id> [provider] [model] [arm]}"
DEST_ID_RAW="${2:?}"
PROVIDER="${3:-local}"
MODEL="${4:-regrade}"
ARM="${5:-a}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
H="$ROOT/harness"
SRC="$ROOT/runs/$SRC_ID/candidate"

# Run IDs are [A-Za-z0-9_-] only. Sanitize dots from model slugs (e.g. gpt-5.6).
DEST_ID=$(printf '%s' "$DEST_ID_RAW" | tr -c 'A-Za-z0-9_-' '-')
DEST_ID=${DEST_ID//--/-}
DEST_OVERLAY="$ROOT/runs/$DEST_ID-overlay-src"
if [ "$DEST_ID" != "$DEST_ID_RAW" ]; then
  echo "[regrade] sanitized dest id: $DEST_ID_RAW -> $DEST_ID" >&2
fi

# Dest must match run.sh's id pattern (no dots). Source may contain dots — older
# batch runs used model slugs like a-gpt-5.6-luna-r1 as directory names.
RUN_ID_PATTERN='^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'
SRC_PATH_PATTERN='^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
[[ "$DEST_ID" =~ $RUN_ID_PATTERN ]] || {
  echo "unsafe dest run id: $DEST_ID" >&2
  exit 2
}
[[ "$SRC_ID" =~ $SRC_PATH_PATTERN && "$SRC_ID" != "." && "$SRC_ID" != ".." ]] || {
  echo "unsafe source run id: $SRC_ID" >&2
  exit 2
}
[[ "$SRC_ID" != "$DEST_ID" ]] || {
  echo "source and dest run ids must differ (dest is wiped by run.sh)" >&2
  exit 2
}
[ -d "$SRC" ] || {
  echo "missing source candidate: $SRC" >&2
  exit 2
}
case "$ARM" in a|b) ;; *) echo "arm must be a or b" >&2; exit 2 ;; esac

# Materialize an overlay directory containing only the writable task files from
# the source submission (plus measure closeout if present).
rm -rf "$DEST_OVERLAY"
mkdir -p "$DEST_OVERLAY"
WRITABLE=(
  "src/lib/loans.ts"
  "src/components/item-card.tsx"
  "src/actions/loans.ts"
  "app/items/page.tsx"
  "app/items/[id]/page.tsx"
  "app/items/[id]/checkout-form.tsx"
  "app/api/loans/route.ts"
  "app/items/loading.tsx"
  "app/items/error.tsx"
  "measure/tracks/lending_desk/plan.md"
  "measure/tracks/lending_desk/metadata.json"
)
copied=0
for rel in "${WRITABLE[@]}"; do
  if [ -f "$SRC/$rel" ]; then
    mkdir -p "$(dirname "$DEST_OVERLAY/$rel")"
    cp "$SRC/$rel" "$DEST_OVERLAY/$rel"
    copied=$((copied + 1))
  fi
done
[ "$copied" -gt 0 ] || {
  echo "source candidate has no writable task files" >&2
  exit 2
}

# Harness evolution backfill (diagnostic regrades only):
# The fixture contract later required `export const dynamic = "force-dynamic"` on the
# loans route. Historical model submissions often omit it and then fail the public-API
# contract before any product suite runs. Re-inject that single contract export when
# missing so regrades measure product behavior, not fixture drift. Do not invent
# missing product exports (PATCH, ReturnButton, etc.).
route="$DEST_OVERLAY/app/api/loans/route.ts"
if [ -f "$route" ] && ! grep -qE 'export[[:space:]]+const[[:space:]]+dynamic' "$route"; then
  printf '\nexport const dynamic = "force-dynamic";\n' >> "$route"
  echo "[regrade] backfilled route dynamic export (fixture contract)"
fi
# Candidates that exported dynamic on the detail page (not in fixture) fail surface equality.
detail="$DEST_OVERLAY/app/items/[id]/page.tsx"
if [ -f "$detail" ] && ! grep -qE 'export[[:space:]]+const[[:space:]]+dynamic' "$ROOT/fixture/app/items/[id]/page.tsx"; then
  if grep -qE 'export[[:space:]]+const[[:space:]]+dynamic' "$detail"; then
    # portable strip (no GNU sed -i assumptions beyond common Linux)
    tmp=$(mktemp)
    grep -vE 'export[[:space:]]+const[[:space:]]+dynamic' "$detail" > "$tmp"
    mv "$tmp" "$detail"
    echo "[regrade] stripped non-contract dynamic export from detail page"
  fi
fi

echo "[regrade] $SRC_ID -> $DEST_ID ($copied writable files, provider=$PROVIDER model=$MODEL arm=$ARM)"

# Prefer a quiet host; if the operator set BENCH_IGNORE_LOAD, grade will flag under_load.
export BENCH_WAIT_FOR_IDLE="${BENCH_WAIT_FOR_IDLE:-600}"
export AGENT_SKIP=1
export OVERLAY="$DEST_OVERLAY"

set +e
"$H/run.sh" "$PROVIDER" "$MODEL" "$ARM" "$DEST_ID"
rc=$?
set -e

# Keep the temporary overlay for audit; compress space later if needed.
echo "[regrade] finished $DEST_ID exit=$rc (overlay kept at runs/${DEST_ID}-overlay-src)"
exit "$rc"
