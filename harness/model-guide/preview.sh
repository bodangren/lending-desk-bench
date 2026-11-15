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
# real-work.html from the page template and the tool output. The fresh
# real-work.json and real-work.html win over any stale copies from docs/.
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

export MODEL_GUIDE_ROOT="$ROOT"
export MODEL_GUIDE_PREVIEW="$PREVIEW_ABS"
export MODEL_GUIDE_TEMPLATE="$SCRIPT_DIR/pages/real-work.html"
python3 - <<'PY'
import hashlib
import html
import json
import os

root = os.environ["MODEL_GUIDE_ROOT"]
preview = os.environ["MODEL_GUIDE_PREVIEW"]
template_path = os.environ["MODEL_GUIDE_TEMPLATE"]


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

index_path = os.path.join(preview, "index.html")
if os.path.exists(index_path):
    with open(index_path, encoding="utf-8") as handle:
        index_html = handle.read()
    # A published index already holds the links; keep exactly one of each.
    missing = ""
    if 'href="./real-work.html"' not in index_html:
        missing += '<a href="./real-work.html">Real work</a>'
    if 'href="./review.html"' not in index_html:
        missing += '<a href="./review.html">Review</a>'
    if missing:
        index_html = index_html.replace(">Results</a>", f">Results</a>{missing}", 1)
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
    "<!--MODEL-GUIDE:PRINT-AUDIT-->": "",
}
for token, value in replacements.items():
    if token not in template:
        raise SystemExit(f"preview: template token is missing: {token}")
    template = template.replace(token, value)

with open(os.path.join(preview, "real-work.html"), "w", encoding="utf-8") as handle:
    handle.write(template)
PY
