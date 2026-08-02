#!/usr/bin/env bash
# Table of every scored run, newest last, with trust flags.
#   ./summarize.sh
#
# Status comes from the recorded validity, provenance, suite, and host-trust fields.
# Legacy or incomplete records fail closed and are excluded from ranking.
# UNDER-LOAD means the host was contended while timing-sensitive assertions ran.
# GATE-BLOCKED zero is displayed as status, never ranked.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")"
python3 - <<'PY'
import datetime, glob, json, math, os, subprocess

def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

def describe_reasons(reasons):
    return ", ".join(str(reason) for reason in reasons[:3]) or "record is incomplete"

def live_freshnesses(paths):
    invalid = {"state": "INVALID", "reasons": ["freshness checker failed"]}
    if not paths:
        return {}
    try:
        completed = subprocess.run(
            ["./node_modules/.bin/tsx", "score-freshness.ts", "--many", *paths],
            capture_output=True, text=True, check=False,
        )
        if completed.returncode != 0:
            return {os.path.abspath(path): invalid for path in paths}
        payload = json.loads(completed.stdout)
        if not isinstance(payload, list):
            return {os.path.abspath(path): invalid for path in paths}
        return {
            entry["score_path"]: entry
            for entry in payload
            if isinstance(entry, dict) and isinstance(entry.get("score_path"), str)
        }
    except Exception as error:
        return {
            os.path.abspath(path): {"state": "INVALID", "reasons": [f"freshness checker error: {error}"]}
            for path in paths
        }

def classify(record, freshness):
    state = freshness.get("state")
    reasons = freshness.get("reasons")
    note = describe_reasons(reasons) if isinstance(reasons, list) else "freshness record is incomplete"
    if state == "TRUSTED":
        return "TRUSTED", ""
    if state == "GATE-BLOCKED":
        return state, "explicit gate-blocked zero"
    if state == "STALE-PROVENANCE":
        return state, note or "live provenance is stale"
    if state == "CALIBRATION":
        return state, note or "diagnostic overlay or non-isolated run"
    if state == "UNDER-LOAD":
        return state, note or "host was contended during grading"
    if state == "UNTRUSTED":
        return state, note or "record is not live-rankable"
    return "INVALID", note

def existing_score_paths():
    paths = []
    for path in glob.glob("../runs/*/artifacts/score.json"):
        try:
            paths.append((os.path.getmtime(path), path))
        except FileNotFoundError:
            continue
    return [path for _, path in sorted(paths)]

records = []
paths = existing_score_paths()
freshness_by_path = live_freshnesses(paths)
for path in paths:
    run = path.split("/")[-3]
    try:
        when = datetime.datetime.fromtimestamp(os.path.getmtime(path)).strftime("%m-%d %H:%M")
        with open(path, encoding="utf8") as handle:
            record = json.load(handle)
    except FileNotFoundError:
        continue
    except Exception as error:
        records.append({"run": run, "model": "UNREADABLE", "state": "INVALID", "total": None, "when": "unknown", "note": str(error)[:60]})
        continue
    state, note = classify(record, freshness_by_path.get(os.path.abspath(path), {"state": "INVALID", "reasons": ["freshness result is missing"]}))
    records.append({"run": run, "model": str(record.get("model", "?")), "state": state, "total": record.get("total"), "when": when, "note": note})

if not records:
    print("  no scored runs found"); raise SystemExit

run_width = max(len(row["run"]) for row in records)
model_width = max(len(row["model"]) for row in records)
print(f"  {'run':<{run_width}}  {'model':<{model_width}}  {'state':<18}  {'total':>8}  {'scored':<11}  note")
print(f"  {'-'*run_width}  {'-'*model_width}  {'-'*18}  {'-'*8}  {'-'*11}  {'-'*4}")
def format_total(row):
    state, total = row["state"], row["total"]
    if state == "TRUSTED" and is_number(total):
        return f"{total:.1f}"
    if state == "GATE-BLOCKED":
        return "0.0"
    # Diagnostic regrades (overlay / calibration) still carry functional totals.
    if state in ("CALIBRATION", "UNDER-LOAD", "UNTRUSTED") and is_number(total):
        return f"~{total:.1f}"
    return "—"

for row in records:
    total = format_total(row)
    print(f"  {row['run']:<{run_width}}  {row['model']:<{model_width}}  {row['state']:<18}  {total:>8}  {row['when']:<11}  {row['note']}")

ranked = [row for row in records if row["state"] == "TRUSTED" and is_number(row["total"])]
if ranked:
    print("\n  Trusted publishable ranking")
    for index, row in enumerate(sorted(ranked, key=lambda row: row["total"], reverse=True), 1):
        print(f"  {index:>2}. {row['model']} ({row['run']}) — {row['total']:.1f}")
else:
    print("\n  No trusted publishable totals to rank.")

# Functional comparison for diagnostic regrades (overlay / regrade path).
diagnostic = [
    row for row in records
    if row["state"] in ("CALIBRATION", "UNDER-LOAD", "UNTRUSTED") and is_number(row["total"])
]
if diagnostic:
    print("\n  Diagnostic functional ranking (not publishable — overlay/regrade or under-load)")
    for index, row in enumerate(sorted(diagnostic, key=lambda row: row["total"], reverse=True), 1):
        print(f"  {index:>2}. {row['model']} ({row['run']}) — {row['total']:.1f}  [{row['state']}]")

nonpublishable = [row for row in records if row["state"] != "TRUSTED"]
if nonpublishable:
    print(f"\n  {len(nonpublishable)} record(s) excluded from trusted ranking (stale, invalid, gate-blocked, or diagnostic).")
PY
