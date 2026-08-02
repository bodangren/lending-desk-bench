#!/usr/bin/env python3
"""Build reports/REPORT-<stamp>.md from regrade matrix TSV + score artifacts."""
from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPORTS = ROOT / "reports"


def is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def load_score(run_id: str) -> dict | None:
    path = ROOT / "runs" / run_id / "artifacts" / "score.json"
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def load_results(run_id: str) -> dict[str, bool]:
    path = ROOT / "runs" / run_id / "artifacts" / "results.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf8"))
        if not isinstance(data, dict):
            return {}
        return {str(k): bool(v) for k, v in data.items() if isinstance(v, bool)}
    except Exception:
        return {}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stamp", required=True)
    args = parser.parse_args()
    stamp = args.stamp
    tsv = REPORTS / f"regrade-matrix-{stamp}.tsv"
    if not tsv.exists():
        raise SystemExit(f"missing {tsv}")

    rows: list[dict] = []
    for line in tsv.read_text(encoding="utf8").splitlines()[1:]:
        if not line.strip():
            continue
        source, dest, status, total_token, valid_token = line.split("\t")
        entry: dict = {
            "source": source,
            "dest": dest,
            "status": status,
            "total_token": total_token,
            "valid_token": valid_token,
        }
        if dest and dest != "-":
            score = load_score(dest)
            results = load_results(dest)
            if score:
                entry["score"] = score
            if results:
                fails = sorted(k for k, v in results.items() if not v)
                entry["failures"] = fails
                entry["fail_count"] = len(fails)
                entry["pass_count"] = sum(1 for v in results.values() if v)
                entry["result_count"] = len(results)
        rows.append(entry)

    REPORTS.mkdir(parents=True, exist_ok=True)
    json_path = REPORTS / f"regrade-matrix-{stamp}.json"
    json_path.write_text(
        json.dumps({"stamp": stamp, "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "rows": rows}, indent=2)
        + "\n",
        encoding="utf8",
    )

    # Markdown report
    lines: list[str] = []
    lines.append(f"# Lending Desk Bench — Report {stamp}")
    lines.append("")
    lines.append(f"Generated: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append("")
    lines.append("## Method")
    lines.append("")
    lines.append(
        "Existing model candidates were **regraded** under the current harness without re-invoking models "
        "(no API keys required). Each regrade:"
    )
    lines.append("")
    lines.append("1. Starts from the clean `fixture/` tree")
    lines.append("2. Overlays the source candidate's nine task files + Measure closeout")
    lines.append("3. Records **overlay** provenance (`mode=overlay`, non-isolated)")
    lines.append("4. Runs typecheck → build → unit/API/e2e suites → score")
    lines.append("")
    lines.append(
        "These totals are **functional diagnostics**. They are **not** trusted/rankable model rankings "
        "because no agent was re-run in the isolated container (`CALIBRATION` / non-isolated overlay). "
        "Use them to compare *what the candidate code does today* against a green reference."
    )
    lines.append("")
    lines.append("## Functional ranking (diagnostic)")
    lines.append("")
    scored = [
        r
        for r in rows
        if r.get("score")
        and is_number(r["score"].get("total"))
        and r["score"].get("valid") is True
    ]
    scored.sort(key=lambda r: r["score"]["total"], reverse=True)

    lines.append("| Rank | Source | Dest | Model | Arm | Total | Completion | Adversarial | Quality | Fails | Host |")
    lines.append("|---:|---|---|---|:---:|---:|---:|---:|---:|---:|---|")
    for i, r in enumerate(scored, 1):
        s = r["score"]
        axes = s.get("axes") or {}
        host = s.get("host") or {}
        load = "under_load" if host.get("under_load") else "ok"
        lines.append(
            f"| {i} | `{r['source']}` | `{r['dest']}` | {s.get('model','?')} | {s.get('arm','?')} | "
            f"**{s['total']:.1f}** | {axes.get('completion', 0):.0%} | {axes.get('adversarial', 0):.0%} | "
            f"{axes.get('quality', 0):.2f} | {r.get('fail_count', '—')} | {load} |"
        )
    if not scored:
        lines.append("| — | — | — | — | — | — | — | — | — | — | no valid scores |")

    lines.append("")
    lines.append("## Per-run failures")
    lines.append("")
    for r in scored:
        fails = r.get("failures") or []
        s = r["score"]
        lines.append(f"### `{r['source']}` → `{r['dest']}` — **{s['total']:.1f}**")
        lines.append("")
        if not fails:
            lines.append("All collected criteria/probes/advisories passed.")
        else:
            lines.append(f"{len(fails)} failure(s):")
            lines.append("")
            for f in fails:
                lines.append(f"- `{f}`")
        lines.append("")

    lines.append("## Matrix status")
    lines.append("")
    lines.append("| Source | Dest | Status | Total | Valid |")
    lines.append("|---|---|---|---:|---|")
    for r in rows:
        lines.append(
            f"| `{r['source']}` | `{r['dest']}` | {r['status']} | {r['total_token']} | {r['valid_token']} |"
        )

    lines.append("")
    lines.append("## How to re-run")
    lines.append("")
    lines.append("```bash")
    lines.append("cd harness")
    lines.append("./regrade-matrix.sh")
    lines.append("./summarize.sh")
    lines.append("```")
    lines.append("")
    lines.append("For a trusted *rankable* matrix, use `./batch.sh` with provider keys on a quiet host.")
    lines.append("")

    md_path = REPORTS / f"REPORT-{stamp}.md"
    md_path.write_text("\n".join(lines) + "\n", encoding="utf8")
    # Always-latest pointer
    (REPORTS / "REPORT.md").write_text(md_path.read_text(encoding="utf8"), encoding="utf8")
    print(f"wrote {json_path}")
    print(f"wrote {md_path}")
    print(f"wrote {REPORTS / 'REPORT.md'}")


if __name__ == "__main__":
    main()
