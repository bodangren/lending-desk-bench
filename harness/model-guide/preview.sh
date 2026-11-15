#!/usr/bin/env bash
# Build the model-guide preview folder from docs/ and the new pages (FR-7).
# Usage: preview.sh --export <file> [--preview <folder>]
# The default preview folder is <repo>/.tmp/model-guide-preview.
# It resolves relative --export and --preview values against the caller
# folder before it changes folders. It refuses an unsafe preview path with
# `preview: refused path <value>` on stdout, exit 2, before any write.
# It refuses a symlink inside an existing preview folder with
# `preview: refused path <path>` on stdout, exit 2, before any write; the
# path is the link. It refuses any symlink under docs/, and any other
# non-regular entry (for example a FIFO), with
# `preview: refused path <absolute path>` on stdout, exit 2, before any
# write; the link target stays byte-identical. It refuses an unreadable
# entry under docs/ (for example mode 000) with
# `preview: unreadable <path relative to the repo>` on stdout, exit 2,
# before any write; the docs root prints as `docs`. The scan never uses
# find, so an unreadable folder gives one refusal line, not a find error.
# It runs the input check into a temp folder first, so a refused run leaves
# an existing preview folder byte-identical and leaves no new folder behind,
# not even a parent that mkdir -p created. On success it copies docs/ into
# the preview folder, records the SHA-256 of each copied file in
# preview-base.json, adds the Real work and Review nav links to the preview
# index.html (links that already exist stay single), and renders
# real-work.html from the page template, the tool output, and the print-audit
# data file of spec D17. The print-audit block shows the totals, the two route
# results, the error types with their counts, the bias note, and the 52 rows
# with their checklist items and results. It shows no placeholder line. The
# fresh real-work.json and real-work.html win over any stale copies from docs/.
# It runs guide.ts next, writes model-guide.json into the preview folder, and
# renders the six rows of spec D18 from pages/guide-section.html inline into
# the preview index.html, before the current hero (FR-7, acceptance 7). Each
# row shows the pick or "no pick yet: not enough evidence", the second choice,
# the evidence cell, the evidence date, and the base line beside the pick. A
# stale table shows the stale mark. The table sits in a .table-wrap with
# tabindex="0", role="region", and an aria-label, and long text wraps at
# 390 px. Every model name and every data text is escaped with html.escape.
# The guide needs docs/assets/data/benchmark.json, docs/assets/data/
# tracks.json, and the print-audit data file. When one is absent the preview
# keeps the page and omits the table; the real repo holds all three. It reads
# the newest review score file under harness/model-guide/data/review-scores/
# when one exists, because Phase 4 creates that file. The newest file by
# modification time wins, and a name that holds a newline cannot split the
# choice. --today is the current date, so a live preview shows its own age.
# It writes no file under docs/. Exit 0 on success. Exit 2 when the input
# check of real-work.ts fails; it writes nothing near the preview folder in
# that case.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
EXPORT=""
PREVIEW_SET=""
PREVIEW=""

usage() {
  echo "usage: preview.sh --export <file> [--preview <folder>]" >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --export)
      [ $# -ge 2 ] || usage
      EXPORT="$2"; shift 2;;
    --preview)
      [ $# -ge 2 ] || usage
      PREVIEW_SET=1; PREVIEW="$2"; shift 2;;
    *) usage;;
  esac
done
[ -n "$EXPORT" ] || usage
if [ -z "$PREVIEW_SET" ]; then
  PREVIEW="$ROOT/.tmp/model-guide-preview"
elif [ -z "$PREVIEW" ]; then
  usage
fi

# Resolve against the caller folder before any cd; use only absolute paths
# after this point.
EXPORT_ABS="$(realpath -m -- "$EXPORT")"
PREVIEW_ABS="$(realpath -m -- "$PREVIEW")"

DOCS_REAL="$(realpath "$ROOT/docs")"
# Everything sits under the root path, so docs is under it.
if [ "$PREVIEW_ABS" = "/" ]; then
  echo "preview: refused path $PREVIEW"
  exit 2
fi
case "$DOCS_REAL" in
  "$PREVIEW_ABS"|"$PREVIEW_ABS"/*)
    echo "preview: refused path $PREVIEW"
    exit 2;;
esac
case "$PREVIEW_ABS" in
  "$DOCS_REAL"|"$DOCS_REAL"/*)
    echo "preview: refused path $PREVIEW"
    exit 2;;
esac

# Run the input check into a temp folder first. A refused run writes nothing
# near the preview folder: an existing preview folder stays byte-identical,
# and no new folder stays behind, not even a parent that mkdir -p created.
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

# The overview table needs the build and tests data files and the print-audit
# data file. A repo copy without one keeps the page and omits the table.
OVERVIEW=""
GUIDE_DATA="$ROOT/harness/model-guide/data"
if [ -f "$ROOT/docs/assets/data/benchmark.json" ] \
  && [ -f "$ROOT/docs/assets/data/tracks.json" ] \
  && [ -f "$GUIDE_DATA/print-audit-2026-11.json" ]; then
  OVERVIEW=1
fi
# The newest review score file, when Phase 4 wrote one. Without one track A
# has no rank, which guide.ts accepts. These lines are the shared rule with
# update.sh: the file with the newest modification time wins, and a name
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
if [ -n "$OVERVIEW" ]; then
  GUIDE_ARGS=(--real-work "$STAGING/real-work.json"
    --print-audit "$GUIDE_DATA/print-audit-2026-11.json"
    --benchmark "$ROOT/docs/assets/data/benchmark.json"
    --tracks "$ROOT/docs/assets/data/tracks.json"
    --today "$(date +%F)" --out "$STAGING")
  if [ -n "$SCORES" ]; then
    GUIDE_ARGS=(--real-work "$STAGING/real-work.json" --scores "$SCORES"
      --print-audit "$GUIDE_DATA/print-audit-2026-11.json"
      --benchmark "$ROOT/docs/assets/data/benchmark.json"
      --tracks "$ROOT/docs/assets/data/tracks.json"
      --today "$(date +%F)" --out "$STAGING")
  fi
  set +e
  npx tsx model-guide/guide.ts "${GUIDE_ARGS[@]}"
  GUIDE_STATUS=$?
  set -e
  if [ "$GUIDE_STATUS" -ne 0 ]; then
    # A bad data file must not stop the rest of the preview. The page keeps
    # the table out rather than show a pick that no source supports.
    echo "preview: no overview table (guide.ts exit $GUIDE_STATUS)"
  fi
fi

# Refuse a symlink inside an existing preview folder before any write: a
# planted link can point under docs/ and take the page write there.
if [ -d "$PREVIEW_ABS" ]; then
  PLANTED="$(find "$PREVIEW_ABS" -type l -print -quit 2>/dev/null || true)"
  if [ -n "$PLANTED" ]; then
    echo "preview: refused path $PLANTED"
    exit 2
  fi
fi

# Scan docs/ once, before any write, and report the first refusal: a symlink
# or another non-regular entry (a FIFO would hang the copy), or an entry that
# cannot be read. The scan lists each folder itself, so an unreadable folder
# gives one refusal line and not a find error. A bash walk is not used
# because readdir in Python reports each folder it cannot open.
SCAN="$(
python3 - "$ROOT" <<'PY'
import os
import stat
import sys

root = sys.argv[1]
docs = os.path.join(root, "docs")
refused = None
unreadable = None


def walk(path, rel):
    global refused, unreadable
    try:
        names = sorted(os.listdir(path))
    except OSError:
        if unreadable is None:
            unreadable = rel or "docs"
        return
    for name in names:
        full = os.path.join(path, name)
        child = f"{rel}/{name}" if rel else name
        try:
            info = os.lstat(full)
        except OSError:
            if unreadable is None:
                unreadable = child
            continue
        mode = info.st_mode
        if stat.S_ISLNK(mode):
            if refused is None:
                refused = full
        elif stat.S_ISDIR(mode):
            walk(full, child)
        elif stat.S_ISREG(mode):
            if not os.access(full, os.R_OK) and unreadable is None:
                unreadable = child
        elif refused is None:
            refused = full


try:
    root_info = os.lstat(docs)
except OSError:
    root_info = None
if root_info is None:
    if unreadable is None:
        unreadable = "docs"
elif stat.S_ISLNK(root_info.st_mode):
    refused = docs
elif not stat.S_ISDIR(root_info.st_mode):
    refused = docs
else:
    walk(docs, "docs")

if refused is not None:
    print("refused\t" + refused)
elif unreadable is not None:
    print("unreadable\t" + unreadable)
PY
)"
if [ -n "$SCAN" ]; then
  SCAN_KIND="${SCAN%%$'\t'*}"
  SCAN_VALUE="${SCAN#*$'\t'}"
  if [ "$SCAN_KIND" = "refused" ]; then
    echo "preview: refused path $SCAN_VALUE"
  else
    echo "preview: unreadable $SCAN_VALUE"
  fi
  exit 2
fi

mkdir -p "$PREVIEW_ABS"
# Copy docs/ so the fresh real-work.json and real-work.html win over stale
# copies that docs/ may hold.
cp -a "$ROOT/docs/." "$PREVIEW_ABS/"
cp "$STAGING/real-work.json" "$PREVIEW_ABS/real-work.json"
if [ -f "$STAGING/model-guide.json" ]; then
  cp "$STAGING/model-guide.json" "$PREVIEW_ABS/model-guide.json"
else
  rm -f "$PREVIEW_ABS/model-guide.json"
fi

export MODEL_GUIDE_ROOT="$ROOT"
export MODEL_GUIDE_PREVIEW="$PREVIEW_ABS"
export MODEL_GUIDE_TEMPLATE="$SCRIPT_DIR/pages/real-work.html"
export MODEL_GUIDE_GUIDE_TEMPLATE="$SCRIPT_DIR/pages/guide-section.html"
python3 - <<'PY'
import hashlib
import html
import json
import os

root = os.environ["MODEL_GUIDE_ROOT"]
preview = os.environ["MODEL_GUIDE_PREVIEW"]
template_path = os.environ["MODEL_GUIDE_TEMPLATE"]
guide_template_path = os.environ["MODEL_GUIDE_GUIDE_TEMPLATE"]


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def doc_files():
    docs = os.path.join(root, "docs")
    rels = []
    for base, _dirs, files in os.walk(docs):
        for name in files:
            full = os.path.join(base, name)
            rels.append(os.path.relpath(full, docs).replace(os.sep, "/"))
    return sorted(rels)


base = {
    "schema": "model-guide-preview-base/1",
    "docs": {rel: sha256_file(os.path.join(root, "docs", rel)) for rel in doc_files()},
}
with open(os.path.join(preview, "preview-base.json"), "w", encoding="utf-8") as handle:
    json.dump(base, handle, indent=2)
    handle.write("\n")

def overview_rows(page):
    """The six rows of spec D18 from model-guide.json, escaped.

    The pick cell carries the base line beside the pick when the tool wrote
    one. The base line never changes the pick.
    """
    rows = []
    for row in page.get("rows") or []:
        pick = html.escape(str(row.get("pick") or ""))
        base = row.get("base_line")
        if base is not None:
            pick = f'{pick}<br><span class="muted">base line {float(base):.1f}</span>'
        second = row.get("second")
        cells = [
            html.escape(str(row.get("kind") or "")),
            pick,
            html.escape(str(second)) if second is not None else "none",
            html.escape(str(row.get("evidence") or "")),
            html.escape(str(row.get("evidence_date") or "")),
        ]
        rows.append("<tr>" + "".join(f"<td>{cell}</td>" for cell in cells) + "</tr>")
    return "\n".join(rows)


def overview_stale(page):
    if not page.get("stale"):
        return ""
    return (
        '<p class="muted" data-stale="true">Stale: the newest evidence date is '
        "more than 14 days before today. Run the weekly update.</p>"
    )


def insert_overview(index_html):
    """Put the overview section first, above the current hero."""
    guide_path = os.path.join(preview, "model-guide.json")
    if not os.path.exists(guide_path) or not os.path.exists(guide_template_path):
        return index_html
    with open(guide_path, encoding="utf-8") as handle:
        page = json.load(handle)
    with open(guide_template_path, encoding="utf-8") as handle:
        section = handle.read()
    replacements = {
        "<!--MODEL-GUIDE:OVERVIEW-ROWS-->": overview_rows(page),
        "<!--MODEL-GUIDE:OVERVIEW-STALE-->": overview_stale(page),
    }
    for token, value in replacements.items():
        if token not in section:
            raise SystemExit(f"preview: guide template token is missing: {token}")
        section = section.replace(token, value)
    # A second preview over a published index keeps exactly one section.
    marker = 'id="model-guide"'
    if marker in index_html:
        start = index_html.rfind("<section", 0, index_html.find(marker))
        end = index_html.find("</section>", start)
        if start != -1 and end != -1:
            index_html = index_html[:start] + index_html[end + len("</section>"):]
    for anchor in ('<header class="hero', "<main", "</body>"):
        position = index_html.find(anchor)
        if position != -1:
            return index_html[:position] + section + "\n" + index_html[position:]
    return index_html + "\n" + section


index_path = os.path.join(preview, "index.html")
if os.path.exists(index_path):
    with open(index_path, encoding="utf-8") as handle:
        index_html = handle.read()
    before = index_html
    # A published index already holds the links; keep exactly one of each.
    missing = ""
    if 'href="./real-work.html"' not in index_html:
        missing += '<a href="./real-work.html">Real work</a>'
    if 'href="./review.html"' not in index_html:
        missing += '<a href="./review.html">Review</a>'
    if missing:
        index_html = index_html.replace(">Results</a>", f">Results</a>{missing}", 1)
    index_html = insert_overview(index_html)
    if index_html != before:
        with open(index_path, "w", encoding="utf-8") as handle:
            handle.write(index_html)


def rate_text(rate, places):
    if rate["value"] is None:
        return "no rate"
    return f"{rate['value']:.{places}f} (n={rate['n']})"


def main_row_text(cells):
    return "<tr>" + "".join(f"<td>{cell}</td>" for cell in cells) + "</tr>"


def main_rows(rows):
    out = []
    for row in rows:
        ratings = row.get("ratings", {})
        if ratings:
            ratings_text = "; ".join(
                f"{html.escape(axis)} {entry['mean']:.4f} (n={entry['n']})"
                for axis, entry in sorted(ratings.items())
            )
        else:
            ratings_text = "no ratings"
        checks = row.get("rater_checks", {})
        if checks.get("n", 0) == 0 or checks.get("agreement") is None:
            agreement_text = "no agreement value"
        else:
            agreement_text = f"{checks['agreement']:.4f} (n={checks['n']})"
        trend = row.get("trend", {})
        if trend.get("value") is None:
            trend_text = "no trend"
        else:
            trend_text = f"{trend['value']:.4f} (n={trend['n']})"
        out.append(main_row_text([
            str(row["rank"]),
            html.escape(row["model"]),
            html.escape(", ".join(row["routes"])),
            str(row["runs"]),
            str(row["pass"]),
            str(row["fail"]),
            str(row["error"]),
            str(row["no_result"]),
            str(row["blocking_findings"]),
            html.escape(rate_text(row["pass_rate"], 4)),
            html.escape(rate_text(row["blocking_rate"], 3)),
            html.escape(ratings_text),
            html.escape(agreement_text),
            html.escape(trend_text),
            "few runs" if row.get("few_runs") else "",
        ]))
    return "\n".join(out)


def work_tables(work_types):
    if not work_types:
        return "<p>no pick yet</p>"
    parts = []
    for name in sorted(work_types):
        rows = []
        for row in work_types[name]:
            rows.append(main_row_text([
                str(row["rank"]),
                html.escape(row["model"]),
                html.escape(", ".join(row["routes"])),
                str(row["runs"]),
                str(row["pass"]),
                str(row["fail"]),
                html.escape(rate_text(row["pass_rate"], 4)),
                "few runs" if row.get("few_runs") else "",
            ]))
        if not rows:
            parts.append(f"<h3>{html.escape(name)}</h3>\n<p>no pick yet</p>")
            continue
        parts.append(
            f"<h3>{html.escape(name)}</h3>\n"
            '<div class="table-wrap" tabindex="0" role="region"'
            f' aria-label="{html.escape(name)} table"><table>\n'
            "<thead><tr>"
            "<th scope=\"col\">Rank</th>"
            "<th scope=\"col\">Model</th>"
            "<th scope=\"col\">Routes</th>"
            "<th scope=\"col\">Runs</th>"
            "<th scope=\"col\">Pass</th>"
            "<th scope=\"col\">Fail</th>"
            "<th scope=\"col\">Pass rate</th>"
            "<th scope=\"col\">Mark</th>"
            "</tr></thead>\n<tbody>\n"
            + "\n".join(rows)
            + "\n</tbody>\n</table></div>"
        )
    return "\n".join(parts)


def print_audit_block():
    """The print-audit block of spec D17, built from the data file of FR-5.

    The block holds lists, not tables. A work-type table or the page guard of
    PA1-1 reads the page after the last work-type heading, so the block adds
    no table there.
    """
    path = os.path.join(root, "harness", "model-guide", "data", "print-audit-2026-11.json")
    try:
        with open(path, encoding="utf-8") as handle:
            audit = json.load(handle)
    except (OSError, ValueError):
        return "<p>The print audit data file is not in this preview.</p>"
    totals = audit.get("totals") or {}
    parts = [
        f"<p>The print audit of the seeded-error key: {int(totals.get('errors', 0))} "
        f"error rows, {int(totals.get('blockers', 0))} blockers. This data point is "
        "one calibration run of the audit. It is not a rank.</p>"
    ]
    routes = audit.get("routes") or {}
    if routes:
        found = "; ".join(
            f"{html.escape(str(name))} {html.escape(str(result))}"
            for name, result in routes.items()
        )
        parts.append(f"<p><strong>Blockers found:</strong> {found}.</p>")
    types = audit.get("error_types") or {}
    if types:
        entries = "\n".join(
            f"<dt>{html.escape(str(name))}</dt><dd>{int(count)}</dd>"
            for name, count in types.items()
        )
        parts.append(
            "<p><strong>Error types with their counts:</strong></p>\n<dl>\n"
            f"{entries}\n</dl>"
        )
    if isinstance(audit.get("note"), str):
        parts.append(f'<p class="muted">{html.escape(audit["note"])}</p>')
    rows = []
    for row in audit.get("errors") or []:
        items = "; ".join(
            f"{html.escape(str(item.get('code', '')))}: "
            f"{html.escape(str(item.get('text', '')))}"
            for item in (row.get("checklist") or [])
        )
        results = ", ".join(
            html.escape(str(value)) for value in (row.get("results") or [])
        )
        rows.append(
            f"<li>{html.escape(str(row.get('id', '')))} "
            f"({html.escape(str(row.get('severity', '')))}): "
            f"{items or 'no checklist item'}; results {results}.</li>"
        )
    if rows:
        parts.append(
            "<p><strong>The error rows, their checklist items, and the results:</strong></p>\n"
            "<ul>\n" + "\n".join(rows) + "\n</ul>"
        )
    return "\n".join(parts)


with open(os.path.join(preview, "real-work.json"), encoding="utf-8") as handle:
    page = json.load(handle)

source = page["source"]
source_html = (
    f"File {html.escape(source['file'])}, "
    f"SHA-256 {html.escape(source['sha256'])}, "
    f"generated {html.escape(source['generated_on'])}."
)

coverage = page["coverage"]
coverage_html = (
        "<dl>"
        f"<dt>Runs</dt><dd>{coverage['runs']:,}</dd>"
        f"<dt>Date range</dt><dd>{html.escape(coverage['first_run_date'])}"
        f" to {html.escape(coverage['last_run_date'])}</dd>"
        f"<dt>Share with a known model</dt><dd>{coverage['share_known_route'] * 100:.1f} %</dd>"
        f"<dt>Share with a result</dt><dd>{coverage['share_with_result'] * 100:.1f} %</dd>"
        f"<dt>Left-out paired duplicates</dt><dd>{coverage['paired_duplicates_left_out']}</dd>"
        f"<dt>Runs with route unknown</dt><dd>{coverage['unknown_runs']}</dd>"
        f"<dt>Runs with route other</dt><dd>{coverage['other_runs']}</dd>"
        "</dl>"
    )

with open(template_path, encoding="utf-8") as handle:
    template = handle.read()

replacements = {
    "<!--MODEL-GUIDE:SOURCE-->": source_html,
    "<!--MODEL-GUIDE:COVERAGE-->": coverage_html,
    "<!--MODEL-GUIDE:PRODUCER-ROWS-->": main_rows(page["producer"]),
    "<!--MODEL-GUIDE:CHECKER-ROWS-->": main_rows(page["checker"]),
    "<!--MODEL-GUIDE:WORK-TYPES-->": work_tables(page["work_types"]),
    "<!--MODEL-GUIDE:PRINT-AUDIT-->": print_audit_block(),
}
for token, value in replacements.items():
    if token not in template:
        raise SystemExit(f"preview: template token is missing: {token}")
    template = template.replace(token, value)

with open(os.path.join(preview, "real-work.html"), "w", encoding="utf-8") as handle:
    handle.write(template)
PY
