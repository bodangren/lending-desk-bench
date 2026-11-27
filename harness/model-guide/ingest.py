#!/usr/bin/env python3
"""Daily ingest of real outcomes into the model guide inputs.

Read the outcomes database read-only. Validate the kept rows before any write.
Stage the dated files in the destination parent, scan them, then move them
into --out. This tool never writes the database and never calls update.sh.
A dry run writes into its own temp folder and makes no move.
"""

import argparse
import datetime
import hashlib
import json
import math
import os
import re
import shutil
import sqlite3
import sys
import tempfile

# Copied from outcomes_export.py. No write to the source project.
BANNED = re.compile(
    r"/home/|/Users/|ses_[A-Za-z0-9]{6,}|@|://|sk-[A-Za-z0-9]{8,}"
    r"|Bearer\s|BEGIN [A-Z ]*KEY|AKIA[0-9A-Z]{8,}|ghp_[A-Za-z0-9]{8,}")
ROUTE_MAX = 128
PROVIDER_RE = r"[a-z0-9][a-z0-9.-]{0,32}"
MODEL_SEG_RE = r"[A-Za-z0-9][A-Za-z0-9._:-]{0,48}"
MODEL_RE = MODEL_SEG_RE + r"(?:/" + MODEL_SEG_RE + r")?"
VARIANT_RE = r"[a-z0-9]{1,12}"
ROUTE_RE = re.compile(
    rf"(?P<provider>{PROVIDER_RE})/(?P<model>{MODEL_RE})"
    rf"(?:\[1m\])?(?:#{VARIANT_RE})?")
LEGACY_ROUTE_RE = re.compile(r"([^\[#]+)(\[1m\])?(#[a-z0-9]{1,12})?")
LEGACY_ROUTES = {
    "claude-sonnet-5-5": "claude-code/claude-sonnet-5-5",
    "muse-spark-1.3-contributor": "opencode-go/muse-spark-1.3-contributor",
}
LABEL_RE = re.compile(r"[a-z][a-z0-9-]{0,40}")
AXIS_RE = re.compile(r"[a-z][a-z0-9_-]{0,40}")
AA_LINK_RE = re.compile(r"https://artificialanalysis\.ai/\S*")
DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")

JOBS_DEFAULT = "/home/daniebo/Desktop/advantage-pr/scripts/jobs"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "data")
REFERENCE = os.path.join(DATA_DIR, "ra-outcomes-2026-11-17.json")


def refuse(reason):
    """One line on stdout, exit 2, before any write into the destination."""
    print(f"ingest: {reason}")
    raise SystemExit(2)


PATH_VARS = (
    "INGEST_OUTCOMES_JOBS", "INGEST_SCHEMA_REFERENCE", "INGEST_AA_SOURCE",
    "INGEST_ROUTES_CONFIG", "MODEL_GUIDE_PRIVATE_DIR",
    "RA_QUOTA_OUTCOMES", "OUTCOMES_OPENCODE_DB", "TASK_COST_DB", "TMPDIR",
)


def require_absolute_paths(out):
    """Refuse a relative path override before any read or write."""
    for name in PATH_VARS:
        value = os.environ.get(name)
        if value and not os.path.isabs(value):
            refuse(f"{name} must be absolute")
    if out and not os.path.isabs(out):
        refuse("output path must be absolute")


def load_jobs():
    folder = os.environ.get("INGEST_OUTCOMES_JOBS") or JOBS_DEFAULT
    if not os.path.isfile(os.path.join(folder, "outcomes_db.py")):
        refuse("no outcomes jobs folder")
    if folder not in sys.path:
        sys.path.insert(0, folder)
    import outcomes_db
    import outcomes_tasks
    return outcomes_db, outcomes_tasks


def assemble(outcomes_db, outcomes_tasks):
    """The exact assembly of the consumed 11-17 array, read-only."""
    path = outcomes_db.db_path()
    if not path or not os.path.isfile(path):
        refuse("no outcomes database")
    rows = outcomes_db.summarize(days=None, readonly=True, by_repo=False)

    con = outcomes_tasks.open_database()
    tasks = []
    if con is not None:
        try:
            tasks, _task_rows = outcomes_tasks.build_tasks(
                con, outcomes_tasks.DEFAULT_DAYS)
        except sqlite3.Error:
            tasks = []
        finally:
            con.close()
    downstream = outcomes_tasks.downstream(tasks)

    conn = outcomes_db.connect_ro(path)
    try:
        index = outcomes_tasks.run_index(conn)
        escaped = outcomes_tasks.escaped_findings(conn)
    finally:
        conn.close()
    escapes = outcomes_tasks.escape_counts(tasks, index, escaped)
    return rows, downstream, escapes


def allowed_fields():
    """The key set of the consumed 11-17 export, read before any write."""
    path = os.environ.get("INGEST_SCHEMA_REFERENCE") or REFERENCE
    try:
        with open(path, encoding="utf-8") as handle:
            doc = json.load(handle)
        keys = set()
        for row in doc:
            if isinstance(row, dict):
                keys.update(row.keys())
    except (OSError, ValueError):
        refuse("no schema reference")
    if not keys:
        refuse("no schema reference")
    return keys


def is_number(value):
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value))


def route_parts(route):
    if not isinstance(route, str):
        return None
    at = route.find(" (")
    if at < 0:
        core, note = route, ""
    else:
        core, note = route[:at], route[at:]
        if not note.endswith(")") or not note[2:-1].strip():
            return None
    if BANNED.search(core):
        return None
    return core, note


def valid_route(core):
    return (isinstance(core, str) and len(core) <= ROUTE_MAX
            and ROUTE_RE.fullmatch(core) is not None)


def legacy_route(core):
    match = LEGACY_ROUTE_RE.fullmatch(core)
    if match is None:
        return None
    base = LEGACY_ROUTES.get(match.group(1))
    if base is None:
        return None
    return base + (match.group(2) or "") + (match.group(3) or "")


def normalize_routes(rows):
    if not isinstance(rows, list):
        refuse("outcomes are not an array")
    kept = []
    skipped = 0
    mapped = 0
    for row in rows:
        if not isinstance(row, dict):
            refuse("row is not an object")
        parts = route_parts(row.get("route"))
        if parts is None:
            skipped += 1
            continue
        core, note = parts
        if core == "unknown" or valid_route(core):
            kept.append(row)
            continue
        canonical = legacy_route(core)
        if canonical is None:
            skipped += 1
            continue
        row["route"] = canonical + note
        mapped += 1
        kept.append(row)
    return kept, skipped, mapped


def merge_then_normalize(outcomes_tasks, rows, downstream, escapes):
    outcomes_tasks.merge(rows, downstream, escapes)
    return normalize_routes(rows)


def check_rows(rows):
    """Validate every field and nested key before any write."""
    if not isinstance(rows, list):
        refuse("outcomes are not an array")
    fields = allowed_fields()
    for row in rows:
        if not isinstance(row, dict):
            refuse("row is not an object")
        if not set(row).issubset(fields):
            refuse("unexpected field")

        parts = route_parts(row.get("route"))
        if parts is None:
            refuse("invalid route")
        core, _note = parts
        if core != "unknown" and not valid_route(core):
            refuse("invalid route")

        role = row.get("role")
        if not isinstance(role, str) or BANNED.search(role) \
                or not LABEL_RE.fullmatch(role):
            refuse("invalid role")

        for key, value in row.items():
            if key in ("route", "role"):
                continue
            if key == "ratings":
                if not isinstance(value, dict):
                    refuse("invalid ratings")
                for axis, score in value.items():
                    if not isinstance(axis, str) or BANNED.search(axis) \
                            or not AXIS_RE.fullmatch(axis):
                        refuse("invalid rating key")
                    if not is_number(score):
                        refuse("invalid rating value")
            elif key == "kind":
                if value not in ("producer", "gate"):
                    refuse("invalid kind")
            elif value is not None and not isinstance(value, bool) \
                    and not is_number(value):
                refuse("invalid value")


def read_bytes(path, label):
    try:
        with open(path, "rb") as handle:
            return handle.read()
    except OSError:
        refuse(f"no {label}")


class DuplicateKey(ValueError):
    """A decoded object holds one key more than once."""


def unique_object(pairs):
    """Build an object, refusing a repeated key at any depth."""
    out = {}
    for key, value in pairs:
        if key in out:
            raise DuplicateKey()
        out[key] = value
    return out


def parse_json(raw, label, unique=False):
    try:
        return json.loads(raw.decode("utf-8"),
                          object_pairs_hook=unique_object if unique else None)
    except DuplicateKey:
        refuse("aa reliability duplicate key")
    except (UnicodeError, ValueError):
        refuse(f"{label} is not JSON")


def decoded_strings(node):
    """Every key and string value of a decoded document."""
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for key, value in node.items():
            yield key
            yield from decoded_strings(value)
    elif isinstance(node, list):
        for value in node:
            yield from decoded_strings(value)


def scan_decoded(doc, label, aa_links=False):
    """Scan decoded strings, not the serialized text. Only an AA link may
    carry "://", and it must be the whole string."""
    for text in decoded_strings(doc):
        if not isinstance(text, str):
            continue
        if "://" not in text and not BANNED.search(text):
            continue
        if aa_links and AA_LINK_RE.fullmatch(text):
            if BANNED.search(text.replace("://", "", 1)):
                refuse(f"{label} leak")
            continue
        refuse(f"{label} leak")


def load_aa():
    """Copy the reliability file byte for byte after a decoded scan."""
    path = os.environ.get("INGEST_AA_SOURCE") or os.path.expanduser(
        "~/.config/ra-quota/aa-reliability.json")
    raw = read_bytes(path, "aa reliability")
    doc = parse_json(raw, "aa reliability", unique=True)
    if not isinstance(doc, dict) or not isinstance(doc.get("models"), dict):
        refuse("aa reliability has no models")
    scan_decoded(doc, "aa reliability", aa_links=True)
    return raw


def load_routes():
    """The two route arrays of the current config, not an old dated file."""
    path = os.environ.get("INGEST_ROUTES_CONFIG") or os.path.expanduser(
        "~/.config/ra-quota/routes.json")
    doc = parse_json(read_bytes(path, "routes config"), "routes config")
    if not isinstance(doc, dict):
        refuse("no routes config")
    out = {}
    for key in ("allowedRoutes", "orchestratorRoutes"):
        value = doc.get(key)
        if not isinstance(value, list) or not value:
            refuse(f"no {key}")
        routes = []
        for route in value:
            if not isinstance(route, str) or BANNED.search(route) \
                    or not valid_route(route):
                refuse(f"invalid {key}")
            routes.append(route)
        out[key] = routes
    scan_decoded(out, "allowed routes")
    return (json.dumps(out, indent=2) + "\n").encode("utf-8")


def manifest_line(name, data):
    return f"{hashlib.sha256(data).hexdigest()}  {len(data)}  {name}\n"


def file_set(date, rows, aa_raw, routes_raw, skipped, mapped):
    """The three dated files, the manifest, and any private log line."""
    files = [
        (f"ra-outcomes-{date}.json",
         (json.dumps(rows, indent=2) + "\n").encode("utf-8")),
        (f"aa-reliability-{date}.json", aa_raw),
        (f"allowed-routes-{date}.json", routes_raw),
    ]
    manifest = f"MANIFEST-{date}.txt"
    data = dict(files)
    data[manifest] = "".join(manifest_line(name, body)
                             for name, body in files).encode("utf-8")
    if skipped or mapped:
        data[f"ingest-{date}.log"] = (
            f"ingest: skipped routes {skipped}; mapped legacy routes {mapped}\n"
        ).encode("utf-8")
    return data


def without_route_notes(rows):
    """The private note text is not part of the public-source scan."""
    out = []
    for row in rows:
        item = dict(row)
        item["route"] = route_parts(item["route"])[0]
        out.append(item)
    return out


def scan_staged(data, manifest):
    """Scan every staged string before the private files move."""
    for name, body in data.items():
        if name == manifest:
            # The manifest holds only hashes, sizes and base names.
            if BANNED.search(body.decode("utf-8")):
                refuse("manifest leak")
            continue
        if name.startswith("ingest-") and name.endswith(".log"):
            if BANNED.search(body.decode("utf-8")):
                refuse("ingest log leak")
            continue
        doc = parse_json(body, name)
        if name.startswith("ra-outcomes-"):
            doc = without_route_notes(doc)
        scan_decoded(doc, name,
                     aa_links=(name.startswith("aa-reliability-")))


def require_private_output(out):
    root = os.path.realpath(os.path.join(SCRIPT_DIR, "..", ".."))
    target = os.path.realpath(out)
    if os.path.commonpath((root, target)) == root:
        refuse("output path must be private")
    if os.path.exists(target):
        stat = os.stat(target)
        if stat.st_uid != os.getuid() or stat.st_mode & 0o077:
            refuse("output path must be private")


def main():
    parser = argparse.ArgumentParser(description="ingest real outcomes")
    parser.add_argument("--date", default=os.environ.get("INGEST_DATE")
                        or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d"))
    parser.add_argument("--out", default="")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    require_absolute_paths(args.out)
    if not DATE_RE.fullmatch(args.date):
        refuse("invalid date")
    try:
        datetime.date.fromisoformat(args.date)
    except ValueError:
        refuse("invalid date")
    out = args.out
    if not out and args.dry_run:
        out = tempfile.mkdtemp(prefix="model-guide-ingest-")
    if not out:
        refuse("no output folder")
    require_private_output(out)

    stage = None
    if not args.dry_run:
        # The staging folder shares the destination filesystem, so os.replace
        # never crosses a device boundary (no EXDEV in the daily run).
        parent = os.path.dirname(os.path.abspath(out))
        os.makedirs(parent, exist_ok=True)
        stage = tempfile.mkdtemp(dir=parent, prefix=".ingest-stage-")

    try:
        outcomes_db, outcomes_tasks = load_jobs()
        rows, downstream, escapes = assemble(outcomes_db, outcomes_tasks)
        rows, skipped, mapped = merge_then_normalize(
            outcomes_tasks, rows, downstream, escapes)
        check_rows(rows)
        aa_raw = load_aa()
        routes_raw = load_routes()
        target = stage if stage is not None else out
        os.makedirs(target, exist_ok=True, mode=0o700)
        data = file_set(args.date, rows, aa_raw, routes_raw, skipped, mapped)
        for name, body in data.items():
            fd = os.open(os.path.join(target, name),
                         os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "wb") as handle:
                handle.write(body)
        scan_staged(data, f"MANIFEST-{args.date}.txt")
        if stage is not None:
            os.makedirs(out, exist_ok=True, mode=0o700)
            for name in data:
                os.replace(os.path.join(stage, name), os.path.join(out, name))
        stale_log = os.path.join(out, f"ingest-{args.date}.log")
        if not skipped and not mapped and os.path.exists(stale_log):
            os.remove(stale_log)
        print(f"ingest: rows {len(rows)}")
        print(f"ingest: out {out}")
    finally:
        if stage is not None:
            shutil.rmtree(stage, ignore_errors=True)


if __name__ == "__main__":
    main()
