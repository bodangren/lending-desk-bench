#!/usr/bin/env bash
# Build the model-guide preview folder from docs/ and the new pages (FR-7).
# Usage: preview.sh --manifest <file> [--preview <folder>]
# The default preview folder is <repo>/.tmp/model-guide-preview.
# The manifest is the `MANIFEST-<date>.txt` of spec D16 (Q-S1, Q-S2): the
# input check of `real-work.ts` reads the three dated data files next to it,
# and the read date and the export date are the date in its name (Q-S4).
# It resolves relative --manifest and --preview values against the caller
# folder before it changes folders. It refuses an unsafe preview path with
# `preview: refused path <value>` on stdout, exit 2, before any write. The
# path refusal runs before the flag check, so a run that names the root path
# stops on the path and never starts a tool.
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
# data file of spec D17.
# Page B shows the two tables of spec D16: the producer table with the
# default columns Model, Tasks, First-round accept %, Rework, Cleanup %, and
# Tokens per accepted task, and the checker table with Model, Runs, Pass %,
# Findings per run, Escapes, and Net score. The More columns toggle holds the
# default columns plus Routes, Roles, Accepted, and AA net score. The
# "Too few tasks" group holds the rows below the minimum of 5 with no rank.
# The row marks "not allowed" and "not for verdicts" are attributes. The
# print-audit block shows the totals, the route results as plain names from
# data/model-names.json, the error types with their counts, the scope note,
# the bias note of `summary.bias_note`, and the 52 rows with their checklist
# items and results. It shows no placeholder line and no raw route key. The
# About this data footer lists the three source files with their SHA-256 and
# the read date, and the coverage numbers.
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
MANIFEST=""
PREVIEW_SET=""
PREVIEW=""
ODD=0

usage() {
  echo "usage: preview.sh --manifest <file> [--preview <folder>]" >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --manifest)
      [ $# -ge 2 ] || usage
      [ -n "$2" ] || usage
      MANIFEST="$2"; shift 2;;
    --preview)
      [ $# -ge 2 ] || usage
      [ -n "$2" ] || usage
      PREVIEW_SET=1; PREVIEW="$2"; shift 2;;
    *)
      # A token that names no flag of this version: the path refusal below
      # keeps its priority, and the usage line follows when the path is safe.
      ODD=1; shift;;
  esac
done
if [ -z "$PREVIEW_SET" ]; then
  PREVIEW="$ROOT/.tmp/model-guide-preview"
fi

# Resolve against the caller folder before any cd; use only absolute paths
# after this point.
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

[ "$ODD" -eq 0 ] || usage
[ -n "$MANIFEST" ] || usage
MANIFEST_ABS="$(realpath -m -- "$MANIFEST")"

# Run the input check into a temp folder first. A refused run writes nothing
# near the preview folder: an existing preview folder stays byte-identical,
# and no new folder stays behind, not even a parent that mkdir -p created.
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
export MODEL_GUIDE_MANIFEST="$MANIFEST_ABS"
python3 - <<'PY'
import hashlib
import html
import json
import math
import os

root = os.environ["MODEL_GUIDE_ROOT"]
preview = os.environ["MODEL_GUIDE_PREVIEW"]
template_path = os.environ["MODEL_GUIDE_TEMPLATE"]
guide_template_path = os.environ["MODEL_GUIDE_GUIDE_TEMPLATE"]
manifest_path = os.environ["MODEL_GUIDE_MANIFEST"]

DASH = "\u2013"


def esc(value):
    return html.escape(str(value))


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

def model_names():
    """The plain model names of spec D17 and D18 (data/model-names.json)."""
    path = os.path.join(root, "harness", "model-guide", "data", "model-names.json")
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


NAMES = model_names()


def model_name(key):
    """A plain name. A key with no name shows without its plan prefix."""
    name = NAMES.get(key)
    if isinstance(name, str) and name.strip():
        return name
    _head, sep, tail = str(key).partition("/")
    return tail if sep else str(key)


def audit_name(key):
    """The plain name of a print-audit route key.

    The rule is the page B model key rule (ADV-5, D17): the key loses `[1m]`
    and a `#<variant>` suffix before the model-names.json lookup, and a key
    with no name drops its plan prefix.
    """
    return model_name(str(key).replace("[1m]", "").split("#")[0])


def overview_rows(page):
    """The six rows of spec D18 from model-guide.json, escaped.

    The pick cell and the second cell show the plain model names of
    data/model-names.json, with a `#variant` route mapped to its model key
    (RA-1). The no-pick words stay as they are. The pick cell carries the
    base line beside the pick when the tool wrote one. The base line never
    changes the pick.
    """
    rows = []
    for row in page.get("rows") or []:
        pick_value = str(row.get("pick") or "")
        # The pick cells show the plain names of D18, the same names page B
        # uses. "no pick yet: not enough evidence" stays as it is (RA-1).
        pick = html.escape(
            pick_value
            if pick_value.startswith("no pick yet")
            else audit_name(pick_value)
        )
        base = row.get("base_line")
        if base is not None:
            pick = f'{pick}<br><span class="muted">base line {float(base):.1f}</span>'
        second = row.get("second")
        second_text = audit_name(second) if second is not None else None
        cells = [
            html.escape(str(row.get("kind") or "")),
            pick,
            html.escape(second_text) if second_text is not None else "none",
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


def pct(value):
    """A whole percent. An empty value is an en dash (spec D16)."""
    if not isinstance(value, (int, float)):
        return DASH
    return f"{int(math.floor(float(value) * 100 + 0.5))} %"


def one_decimal(value):
    if not isinstance(value, (int, float)):
        return DASH
    return f"{float(value):.1f}"


def two_decimals(value):
    if not isinstance(value, (int, float)):
        return DASH
    return f"{float(value):.2f}"


def tokens_text(value):
    if not isinstance(value, (int, float)):
        return DASH
    return f"{int(round(float(value) / 1000))}k"


def net_text(value):
    if not isinstance(value, (int, float)):
        return "not rated"
    return f"{float(value):g}"


def integer(value):
    if not isinstance(value, (int, float)):
        return DASH
    return str(int(value))


# The escape total of the outcomes file; the page sets it before it renders.
ESCAPES_TOTAL = 0


def escapes_text(value):
    """An Escapes cell. With no escape in the outcomes file every cell shows
    "no data", because there is no escape data yet (D16, PM 2026-11-18)."""
    if ESCAPES_TOTAL == 0:
        return "no data"
    return integer(value)


def table_head(heads):
    cells = []
    for index, head in enumerate(heads):
        # The first column is the model name column (ADV-1).
        extra = ' class="model-cell"' if index == 0 else ""
        cells.append(f'<th scope="col"{extra}>{esc(head)}</th>')
    return "<thead><tr>" + "".join(cells) + "</tr></thead>"


def table_wrap(aria, table_html):
    """A scroll box with its own hint, so a wide table shows the hint and a
    table that fits keeps it hidden (ADV-2, D16 Width)."""
    return (
        f'<div class="table-wrap" tabindex="0" role="region" '
        f'aria-label="{esc(aria)}">{table_html}</div>'
        '<p class="scroll-hint">Scroll sideways for more \u2192</p>'
    )


def mark_html(row):
    parts = []
    if not row.get("allowed", True):
        parts.append('<span class="mark" data-mark="not-allowed">not allowed</span>')
    if row.get("not_for_verdicts"):
        parts.append('<span class="mark" data-mark="not-for-verdicts">not for verdicts</span>')
    return "".join(parts)


def model_cell(row):
    routes = ", ".join(str(route) for route in (row.get("routes") or []))
    rank = row.get("rank")
    badge = f'<span class="rank">#{int(rank)}</span> ' if isinstance(rank, int) else ""
    name = esc(model_name(row.get("model") or ""))
    return (
        f'<td class="model-cell" data-mg="model-name" title="{esc(routes)}">'
        f'{badge}{name}{mark_html(row)}</td>'
    )


def data_row(row, cells, ranked):
    attrs = f'data-model-key="{esc(row.get("model") or "")}"'
    rank = row.get("rank")
    if ranked and isinstance(rank, int):
        attrs += f' data-rank="{int(rank)}"'
    return f"<tr {attrs}>" + "".join(cells) + "</tr>"


def producer_cells(row):
    first = row.get("first_round") or {}
    return [
        model_cell(row),
        f'<td class="num">{integer(row.get("tasks"))}</td>',
        f'<td class="num">{pct(first.get("value"))}</td>',
        f'<td class="num">{one_decimal(row.get("mean_rework"))}</td>',
        f'<td class="num">{pct(row.get("cleanup_share"))}</td>',
        f'<td class="num">{tokens_text(row.get("tokens_per_accepted"))}</td>',
    ]


def checker_cells(row):
    rate = row.get("pass_rate") or {}
    return [
        model_cell(row),
        f'<td class="num">{integer(row.get("runs"))}</td>',
        f'<td class="num">{pct(rate.get("value"))}</td>',
        f'<td class="num">{two_decimals(row.get("findings_per_run"))}</td>',
        f'<td class="num">{escapes_text(row.get("escapes"))}</td>',
        f'<td class="num">{net_text(row.get("net_score"))}</td>',
    ]


def producer_more_cells(row):
    first = row.get("first_round") or {}
    return producer_cells(row) + [
        f'<td class="routes">{esc(", ".join(str(route) for route in (row.get("routes") or [])))}</td>',
        f'<td class="routes">{esc(", ".join(str(role) for role in (row.get("roles") or [])))}</td>',
        f'<td class="num">{integer(row.get("accepted"))}</td>',
        f'<td class="num">{net_text(row.get("net_score"))}</td>',
    ]


def checker_more_cells(row):
    return checker_cells(row) + [
        f'<td class="routes">{esc(", ".join(str(route) for route in (row.get("routes") or [])))}</td>',
        f'<td class="routes">{esc(", ".join(str(role) for role in (row.get("roles") or [])))}</td>',
    ]


PRODUCER_HEADS = [
    "Model",
    "Tasks",
    "First-round accept %",
    "Rework",
    "Cleanup %",
    "Tokens per accepted task",
]
CHECKER_HEADS = ["Model", "Runs", "Pass %", "Findings per run", "Escapes", "Net score"]
PRODUCER_MORE_HEADS = PRODUCER_HEADS + ["Routes", "Roles", "Accepted", "AA net score"]
CHECKER_MORE_HEADS = CHECKER_HEADS + ["Routes", "Roles"]


def section_body(aria, rows, heads, more_heads, cells_of, more_cells_of):
    """The ranked table, the Too few tasks group, and the More columns toggle.

    The More columns table keeps the default columns first, so every data row
    of the section reads the same number cells in the same positions.
    """
    rows = rows or []
    ranked = [row for row in rows if isinstance(row.get("rank"), int)]
    few = [row for row in rows if not isinstance(row.get("rank"), int)]
    parts = []
    if ranked:
        body = "".join(data_row(row, cells_of(row), True) for row in ranked)
        parts.append(table_wrap(f"{aria} table", f'<table class="data" data-mg="default-table">'
                                f"{table_head(heads)}<tbody>{body}</tbody></table>"))
    else:
        parts.append('<p class="muted">No model meets the minimum of 5 yet.</p>')
    if few:
        body = "".join(data_row(row, cells_of(row), False) for row in few)
        few_table = f"<table>{table_head(heads)}<tbody>{body}</tbody></table>"
        parts.append(
            '<details class="few-tasks" data-mg="too-few">'
            "<summary>Too few tasks</summary>\n"
            + table_wrap(f"{aria}: too few tasks", few_table)
            + "\n</details>"
        )
    if rows:
        body = "".join(data_row(row, more_cells_of(row), False) for row in rows)
        more_table = f"<table>{table_head(more_heads)}<tbody>{body}</tbody></table>"
        parts.append(
            '<details class="more-columns" data-mg="more-columns">'
            "<summary>More columns</summary>\n"
            + table_wrap(f"{aria}: more columns", more_table)
            + "\n</details>"
        )
    return "\n".join(parts)


ROLE_LABELS = {
    "red": "Red",
    "green": "Green",
    "coder": "Coder",
    "review-a": "Review A",
    "review-b": "Review B",
    "review-c": "Review C",
    "adversarial": "Adversarial",
    "acceptance": "Acceptance",
    "phase-acceptance": "Phase acceptance",
    "final-acceptance": "Final acceptance",
}


def top_block(top):
    """The ten role lines of spec D16 Top block (PM 2026-11-18).

    Each line starts with its role label and a colon. A producer line is
    "<label>: <name> <rate> % in this role, <count> tasks"; a gate line is
    "<label>: <name> <pass rate> % pass in this role, <count> runs, net
    <net score>". A line with no pick is "<label>: no pick yet". The role
    also sits in the data-role attribute.
    """
    parts = []
    for item in top or []:
        role = str(item.get("role") or "")
        label = esc(ROLE_LABELS.get(role, role))
        pick = item.get("pick")
        if not isinstance(pick, dict):
            parts.append(
                f'<li data-mg="pick" data-role="{esc(role)}">{label}: no pick yet</li>'
            )
            continue
        name = esc(model_name(pick.get("model") or ""))
        if item.get("kind") == "gate":
            text = (
                f'{label}: {name} {pct(pick.get("rate"))} pass in this role, '
                f'{integer(pick.get("count"))} runs, net {net_text(pick.get("net_score"))}'
            )
        else:
            text = (
                f'{label}: {name} {pct(pick.get("rate"))} in this role, '
                f'{integer(pick.get("count"))} tasks'
            )
        parts.append(
            f'<li data-mg="pick" data-role="{esc(role)}" '
            f'data-model-key="{esc(pick.get("model") or "")}">{text}</li>'
        )
    return "\n".join(parts)


def print_audit_block():
    """The print-audit block of spec D17, built from the data file of FR-5.

    The block holds lists, not tables. A route result shows a plain model
    name, never the raw route key. The block holds no placeholder line.
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
        items = "\n".join(
            f'<li data-mg="audit-result">{esc(audit_name(name))} {esc(result)}</li>'
            for name, result in routes.items()
        )
        parts.append(
            "<p><strong>Blockers found:</strong></p>\n<ul class=\"audit-results\">\n"
            f"{items}\n</ul>"
        )
    types = audit.get("error_types") or {}
    if types:
        entries = "\n".join(
            f"<dt>{esc(name)}</dt><dd>{int(count)}</dd>"
            for name, count in types.items()
        )
        parts.append(
            "<p><strong>Error types with their counts:</strong></p>\n<dl>\n"
            f"{entries}\n</dl>"
        )
    if isinstance(audit.get("note"), str):
        parts.append(f'<p class="muted">{esc(audit["note"])}</p>')
    summary = audit.get("summary")
    bias_note = summary.get("bias_note") if isinstance(summary, dict) else None
    if isinstance(bias_note, str):
        parts.append(f'<p class="muted"><strong>Bias note:</strong> {esc(bias_note)}</p>')
    rows = []
    for row in audit.get("errors") or []:
        items = "; ".join(
            f"{esc(item.get('code', ''))}: {esc(item.get('text', ''))}"
            for item in (row.get("checklist") or [])
        )
        results = ", ".join(esc(value) for value in (row.get("results") or []))
        rows.append(
            f"<li>{esc(row.get('id', ''))} ({esc(row.get('severity', ''))}): "
            f"{items or 'no checklist item'}; results {results}.</li>"
        )
    if rows:
        parts.append(
            '<details class="audit-rows">'
            "<summary>The error rows, their checklist items, and the results</summary>\n"
            "<ul>\n" + "\n".join(rows) + "\n</ul>\n</details>"
        )
    return "\n".join(parts)


def footer_files(files):
    parts = []
    for entry in files or []:
        name = str(entry.get("name") or "")
        parts.append(
            f'<li data-mg="footer-file" data-file="{esc(name)}">'
            f'<span class="footer-name" data-mg="footer-name">{esc(name)}</span>'
            f'<span class="footer-sha256" data-mg="footer-sha256">'
            f'{esc(entry.get("sha256") or "")}</span></li>'
        )
    return "\n".join(parts)


with open(os.path.join(preview, "real-work.json"), encoding="utf-8") as handle:
    page = json.load(handle)

source = page.get("source") or {}
coverage = page.get("coverage") or {}
ESCAPES_TOTAL = coverage.get("escapes_total") or 0

with open(template_path, encoding="utf-8") as handle:
    template = handle.read()

replacements = {
    "<!--MODEL-GUIDE:TOP-BLOCK-->": top_block(page.get("top")),
    "<!--MODEL-GUIDE:PRODUCER-TABLE-->": section_body(
        "Producer roles",
        page.get("producer"),
        PRODUCER_HEADS,
        PRODUCER_MORE_HEADS,
        producer_cells,
        producer_more_cells,
    ),
    "<!--MODEL-GUIDE:CHECKER-TABLE-->": section_body(
        "Checker roles",
        page.get("checker"),
        CHECKER_HEADS,
        CHECKER_MORE_HEADS,
        checker_cells,
        checker_more_cells,
    ),
    "<!--MODEL-GUIDE:PRINT-AUDIT-->": print_audit_block(),
    "<!--MODEL-GUIDE:FOOTER-FILES-->": footer_files(source.get("files")),
    "<!--MODEL-GUIDE:FOOTER-READ-DATE-->": esc(source.get("read_date") or ""),
    "<!--MODEL-GUIDE:FOOTER-EXPORT-DATE-->": esc(source.get("export_date") or ""),
    "<!--MODEL-GUIDE:FOOTER-ROWS-->": integer(coverage.get("rows")),
    "<!--MODEL-GUIDE:FOOTER-ROUTES-->": integer(coverage.get("routes")),
    "<!--MODEL-GUIDE:FOOTER-UNKNOWN-ROWS-->": integer(coverage.get("unknown_rows")),
    "<!--MODEL-GUIDE:FOOTER-UNKNOWN-SHARE-->": (
        f'{float(coverage.get("unknown_share") or 0):.1f} %'
    ),
}
for token, value in replacements.items():
    if token not in template:
        raise SystemExit(f"preview: template token is missing: {token}")
    template = template.replace(token, value)

with open(os.path.join(preview, "real-work.html"), "w", encoding="utf-8") as handle:
    handle.write(template)
PY
