#!/usr/bin/env python3
"""Domain trust matrix data and verdict computation.

This module holds the probe map, the check text sources, and the pure verdict
function. It reads stored registry files and stored records only. It sends no
model call and uses the Python standard library only (spec NFR-1, NFR-5).
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# FR-1: one domain and one kind for each id of PROBES. This table mirrors the
# probe map of spec.md and the golden probe map of preview.json.
PROBE_MAP = {
    "P.searchparams-async": {"domain": "C", "kind": "robustness"},
    "P.hydration-clean": {"domain": "C", "kind": "robustness"},
    "P.filter-literal": {"domain": "C", "kind": "robustness"},
    "P.n-plus-one": {"domain": "C", "kind": "performance"},
    "P.dedup-item": {"domain": "D", "kind": "performance"},
    "P.retry-after-error": {"domain": "E", "kind": "robustness"},
    "P.no-key-leak": {"domain": "F", "kind": "robustness"},
    "P.stale-after-mutate": {"domain": "F", "kind": "robustness"},
    "P.action-race": {"domain": "F", "kind": "robustness"},
    "P.concurrent-checkout": {"domain": "G", "kind": "robustness"},
    "P.concurrent-return": {"domain": "G", "kind": "robustness"},
    "P.validate-before-io": {"domain": "G", "kind": "performance"},
    "P.auth-before-parse": {"domain": "G", "kind": "robustness"},
    "P.malformed-json": {"domain": "G", "kind": "robustness"},
    "P.axe-clean": {"domain": "B", "kind": "robustness"},
}

KINDS = ("spec", "robustness", "performance")
VERDICTS = ("risk", "unproven", "unoptimized", "safe")
DOMAINS = tuple("ABCDEFGH")
N_MIN = 2

# Each kind gets one sentence in the export rule (spec FR-4).
KIND_SENTENCES = {
    "spec": "A spec failure means the model missed a checkbox that the task spec states.",
    "robustness": "A robustness failure means a hidden probe found a defect that the spec does not list.",
    "performance": "A performance failure means a probe found wasted work, such as a repeated read.",
}


def _registry(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf8")


def criterion_since() -> dict[str, int]:
    """The A-H criteria and the fixture revision that first states each one."""
    text = _registry("harness/tests/criteria.ts")
    head = text.split("export const PROBES", 1)[0]
    found = {}
    for cid, body in re.findall(r'"([^"]+)":\s*\{([^}]*)\}', head):
        if not re.match(r"^[A-H]\.", cid):
            continue
        match = re.search(r"\bsince:\s*(\d+)", body)
        found[cid] = int(match.group(1)) if match else 1
    return found


def spec_text() -> dict[str, str]:
    """The checkbox text of each primary criterion, from SPEC_MATRIX."""
    text = _registry("harness/tests/spec-matrix.ts")
    body = text.split("export const SPEC_MATRIX", 1)[1]
    found = {}
    for spec, primary in re.findall(
        r'\{\s*id:\s*"[^"]+",\s*spec:\s*"([^"]*)",\s*primary:\s*"([^"]+)"', body
    ):
        found[primary] = spec
    return found


def unmapped_text() -> dict[str, str]:
    """The text of each criterion that has no SPEC_MATRIX row."""
    text = _registry("harness/tests/meta/spec-matrix-contract.ts")
    body = text.split("export const UNMAPPED_CRITERIA", 1)[1].split("};", 1)[0]
    return dict(re.findall(r'"([^"]+)":\s*"([^"]*)"', body))


def probe_text() -> dict[str, str]:
    """The text of each probe, from its catches field."""
    text = _registry("harness/tests/criteria.ts")
    body = text.split("export const PROBES", 1)[1].split("export const CHANGE_CRITERIA", 1)[0]
    return dict(re.findall(r'"([^"]+)":\s*\{\s*tier:\s*\d+,\s*catches:\s*"([^"]*)"', body))


def build_checks() -> dict[str, list[dict]]:
    """The full check list of each domain, with revisions and text.

    A check is a criterion of the domain or a probe that the map assigns to it.
    The text comes from the registry. This track writes no new check text.
    """
    since = criterion_since()
    spec = spec_text()
    unmapped = unmapped_text()
    catches = probe_text()
    checks = {domain: [] for domain in DOMAINS}
    for cid, revision in since.items():
        domain = cid.split(".", 1)[0]
        checks[domain].append({
            "id": cid,
            "kind": "spec",
            "since": revision,
            "text": spec.get(cid) or unmapped.get(cid) or cid,
        })
    for pid, entry in PROBE_MAP.items():
        checks[entry["domain"]].append({
            "id": pid,
            "kind": entry["kind"],
            "since": 1,
            "text": catches.get(pid) or pid,
        })
    return checks


def domain_cells(checks: dict, records: list, n_min: int) -> dict:
    """Compute the eight cells from check lists and counted records.

    A graded result needs a boolean value and a revision that states the check.
    A probe counts in every revision. A missing key or a non-boolean value is
    not graded and is never a failure.
    """
    out = {}
    for domain in DOMAINS:
        domain_checks = checks.get(domain) or []
        failures = []
        gaps = []
        coverages = []
        for check in domain_checks:
            cid = check["id"]
            kind = check["kind"]
            since = check.get("since", 1)
            graded = 0
            failed = 0
            for record in records:
                revision = record.get("revision", 1)
                if since > revision:
                    continue
                results = record.get("results") or {}
                if cid not in results:
                    continue
                value = results[cid]
                if not isinstance(value, bool):
                    continue
                graded += 1
                if value is False:
                    failed += 1
            coverages.append(graded)
            if failed:
                failures.append({
                    "id": cid,
                    "kind": kind,
                    "text": check.get("text", ""),
                    "failed": failed,
                    "graded": graded,
                })
            if graded < n_min:
                gaps.append({"id": cid, "graded": graded})
        min_coverage = min(coverages) if coverages else 0
        hard = [f for f in failures if f["kind"] in ("spec", "robustness")]
        if hard:
            verdict = "risk"
            gaps = []
        elif not domain_checks:
            # No check gives no evidence. A pass needs graded results.
            verdict = "unproven"
        elif gaps:
            verdict = "unproven"
        elif failures:
            verdict = "unoptimized"
        else:
            verdict = "safe"
        failures.sort(key=lambda f: (-f["failed"], f["id"]))
        gaps.sort(key=lambda g: g["id"])
        out[domain] = {
            "verdict": verdict,
            "min_coverage": min_coverage,
            "failures": failures,
            "gaps": gaps,
        }
    return out


def load_checks(checks: dict) -> dict:
    """The public check view of the export, without revision data."""
    return {
        domain: [
            {"id": c["id"], "kind": c["kind"], "text": c["text"]}
            for c in checks.get(domain, [])
        ]
        for domain in DOMAINS
    }
