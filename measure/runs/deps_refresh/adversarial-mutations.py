import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path("/home/daniebo/Desktop/lending-desk-bench")
OUT = ROOT / "measure/runs/deps_refresh"
PLAN = (ROOT / "measure/tracks/deps_refresh/plan.md").read_text()
AUDIT = json.loads((OUT / "adversarial-audit-new.json").read_text())
BASE = OUT / "tsc-base-ids-7319344.txt"
assert hashlib.sha256(BASE.read_bytes()).hexdigest() == "68dbc06cb7e2e131cf461472b89b9bcbb5537a012d1c7bf2b779bb5d92ad4e2e"

# Use the exact comparison block from the plan, without a replacement comparator.
compare = PLAN.split('[ -s "$BASE" ]', 1)[1].split('echo "OK:', 1)[0]
compare = '[ -s "$BASE" ]' + compare
with tempfile.TemporaryDirectory(prefix="deps-gate-", dir="/home/daniebo/.cache/opencode") as temp:
    temp = Path(temp)
    ids = temp / "after.txt"
    ids.write_bytes((OUT / "tsc-after-ids.txt").read_bytes())
    env = {**os.environ, "BASE": str(BASE), "IDS": str(ids)}
    clean = subprocess.run(["bash", "-c", compare], env=env, text=True, capture_output=True)
    assert clean.returncode == 0, clean
    synthetic = "harness/zz-never-do-not.ts(999,1): error TS9999"
    diagnostic_filter = re.search(r"grep -oE '([^']+)'", PLAN).group(1)
    filtered = subprocess.run(
        ["grep", "-oE", diagnostic_filter],
        input=synthetic + ": never ignore this banned diagnostic\n",
        text=True, capture_output=True,
    )
    assert filtered.returncode == 0 and filtered.stdout.strip() == synthetic, filtered
    print("A7_DIAGNOSTIC_FILTER_PRESERVES_NEVER_AND_DO_NOT=PASS")
    ids.write_text("".join(sorted(set(ids.read_text().splitlines(keepends=True) + [synthetic + "\n"]))))
    changed = subprocess.run(["bash", "-c", compare], env=env, text=True, capture_output=True)
    assert changed.returncode == 1 and synthetic in changed.stdout, changed
    print("TSC_CLEAN_EXIT=0")
    print("TSC_MUTATION_EXIT=1")
    print(changed.stdout.strip())
    fixture = temp / "measure/tracks/probe"
    fixture.mkdir(parents=True)
    (fixture / "plan.md").write_text("## Phase 1: Probe\n\n- [~] 1.1 First task\n- [~] 1.2 Second task\n")
    checker = "/home/daniebo/.agents/skills/measure-orchestrator/scripts/measure_interphase_checks.py"
    markers = subprocess.run(
        ["python3", checker, "status", "--repo", str(temp), "--track", "^probe$"],
        text=True, capture_output=True,
    )
    assert markers.returncode == 0, markers
    assert "incomplete_phases: 1" in markers.stdout and "(2/2 remaining)" in markers.stdout, markers
    assert "closeout_candidates: 0" in markers.stdout, markers
    print("A4_ALL_TILDE_FIXTURE=INCOMPLETE")
    print(markers.stdout.strip())

# RESIDUAL_GATE is a written review rule, not a repository executable.
# Evaluate that rule independently against the live audit and a plan copy.
section = PLAN.split("- Residual list, one row per moderate advisory:", 1)[1].split("No low advisory", 1)[0]
rows = {}
for line in section.splitlines():
    match = re.match(r"\s*- ([^ ]+) \(", line)
    if match:
        name = match.group(1)
        rows[name] = line
    elif rows:
        rows[name] += " " + line.strip()
required = {name for name, entry in AUDIT["vulnerabilities"].items() if entry["severity"] in {"moderate", "low"}}

def residual_gate(entries):
    failures = []
    for name in sorted(required):
        row = entries.get(name, "")
        if ": " not in row:
            failures.append(name)
            continue
        reason = row.split(": ", 1)[1]
        if not any(token in reason for token in ("score comparability", "under spec D9", "same reason")):
            failures.append(name)
    return failures

assert residual_gate(rows) == [], residual_gate(rows)
mutated = {**rows, "deslop-js": "     - deslop-js (moderate, range all versions):"}
assert residual_gate(mutated) == ["deslop-js"], residual_gate(mutated)
print("RESIDUAL_WRITTEN_RULE_CLEAN=PASS")
print("RESIDUAL_REASON_REMOVAL=FAIL deslop-js")
print("RESIDUAL_NOTE=This probe evaluates the written rule. The repository has no executable residual gate.")

claims = re.findall(r"PASS=\d+.*FAIL=0|all checks pass", PLAN, flags=re.I)
assert not claims, claims
print("A5_LITERAL_FALSE_CLAIM_PATTERNS=0")
