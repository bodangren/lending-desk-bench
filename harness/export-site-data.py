#!/usr/bin/env python3
"""
Export presentation data for the GitHub Pages site.

  python3 harness/export-site-data.py
  → docs/assets/data/benchmark.json
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "assets" / "data" / "benchmark.json"
GATE = 0.9

def slugify(model_id: str) -> str:
    return model_id.replace(".", "-")


def load_go_pricing() -> dict:
    return json.loads((ROOT / "harness/go-pricing.json").read_text(encoding="utf8"))


def batch_models(pricing: dict) -> list[tuple[str, dict]]:
    rows = [
        (mid, spec)
        for mid, spec in pricing.get("models", {}).items()
        if spec.get("high_usage") and spec.get("batch")
    ]
    rows.sort(key=lambda item: item[1].get("requests_per_month", 0), reverse=True)
    return rows


def find_arm_runs(arm: str, slug: str) -> list[Path]:
    runs_dir = ROOT / "runs"
    if not runs_dir.exists():
        return []
    # Run ids are "<arm>-<slug>-<iso-week>" (e.g. a-mimo-v2-5-2026w35). A bare
    # prefix match would also collect sibling slugs such as mimo-v2-5-pro or
    # deepseek-v4-flash-vision-exp, so require the week token boundary.
    run_id = re.compile(rf"^{re.escape(arm)}-{re.escape(slug)}-\d{{4}}w\d{{2}}$")
    found = []
    for path in runs_dir.iterdir():
        if run_id.match(path.name) and (path / "artifacts" / "score.json").exists():
            found.append(path)
    return sorted(found, key=lambda p: p.stat().st_mtime)


def ema(values: list[float], half_life: float = 2.0) -> float | None:
    if not values:
        return None
    alpha = 1 - 0.5 ** (1 / half_life)
    acc = values[0]
    for value in values[1:]:
        acc = alpha * value + (1 - alpha) * acc
    return round(acc, 1)

DOMAINS = {
    "A": {
        "title": "Business rules",
        "why": "Pure domain logic with a fixed clock. A wrong result gives wrong status badges and filter results.",
        "audience": "Backend / domain correctness",
    },
    "B": {
        "title": "UI composition",
        "why": "One reusable card: link, alt text, loan badge. Checks list consistency and accessibility.",
        "audience": "Frontend / accessibility",
    },
    "C": {
        "title": "Catalogue & data fetching",
        "why": "List page with search filters, category filters, and parallel reads. This is common App Router list work.",
        "audience": "Full-stack product",
    },
    "D": {
        "title": "Detail & history",
        "why": "Dynamic route, not-found page, metadata, ordered loan history with live status.",
        "audience": "Full-stack product",
    },
    "E": {
        "title": "Interactive forms",
        "why": "Checkout and return flows: pending labels, optimistic UI, error display.",
        "audience": "Frontend / UX",
    },
    "F": {
        "title": "Mutations & auth",
        "why": "Server Actions must authorize, validate, and persist correctly.",
        "audience": "Security / backend",
    },
    "G": {
        "title": "HTTP API contract",
        "why": "REST handler filters, status codes, conflicts, and data freshness.",
        "audience": "API / integration",
    },
    "H": {
        "title": "Resilience UX",
        "why": "loading.tsx and error.tsx: streaming shells and failure boundaries.",
        "audience": "Reliability / UX",
    },
    "M": {
        "title": "Process closeout",
        "why": "Did the agent finish the phased plan and the metadata?",
        "audience": "Agent ops / evaluation design",
    },
    "P": {
        "title": "Adversarial probes",
        "why": "Hidden checks: revalidation, races, waterfalls, N+1 queries, credential leaks.",
        "audience": "Staff engineering / platform",
    },
    "ADV": {
        "title": "Advisory (unscored)",
        "why": "React 19 form idioms (useActionState / useOptimistic). Never in the numeric total.",
        "audience": "Framework preference signal",
    },
}


def load_criteria():
    text = (ROOT / "harness/tests/criteria.ts").read_text(encoding="utf8")
    head, rest = text.split("export const PROBES", 1)
    probes_part, adv_part = rest.split("export const ADVISORY", 1)
    criteria = {k: int(v) for k, v in re.findall(r'"([^"]+)":\s*\{\s*tier:\s*(\d)', head)}
    probes = {k: int(v) for k, v in re.findall(r'"([^"]+)":\s*\{\s*tier:\s*(\d)', probes_part)}
    advisory = re.findall(r'"([^"]+)"', adv_part.split("];", 1)[0])
    return criteria, probes, advisory


CRITERIA, PROBES, ADVISORY = load_criteria()
SCORED = list(CRITERIA) + list(PROBES)


def soft_scale(rate: float) -> float:
    if rate >= GATE:
        return 1.0
    if rate <= 0:
        return 0.0
    return rate / GATE


def soft_score(passed: dict) -> dict:
    rates = {}
    for t in (0, 1, 2):
        ids = [k for k, v in CRITERIA.items() if v == t]
        rates[t] = (sum(1 for i in ids if passed.get(i)) / len(ids)) if ids else 1.0
    scale = {0: 1.0, 1: soft_scale(rates[0]), 2: soft_scale(rates[0]) * soft_scale(rates[1])}
    earned = sum(scale[t] for k, t in CRITERIA.items() if passed.get(k))
    completion = earned / len(CRITERIA)
    adversarial = sum(scale[t] for k, t in PROBES.items() if passed.get(k)) / len(PROBES)
    quality = completion
    total = round(100 * (0.6 * completion + 0.2 * adversarial + 0.2 * quality), 1)
    return {
        "total": total,
        "completion": round(completion, 4),
        "adversarial": round(adversarial, 4),
        "quality": round(quality, 4),
        "tiers": {
            "0": {"rate": round(rates[0], 4), "scale": 1.0},
            "1": {"rate": round(rates[1], 4), "scale": round(scale[1], 4)},
            "2": {"rate": round(rates[2], 4), "scale": round(scale[2], 4)},
        },
    }


def domain_of(cid: str) -> str:
    return "ADV" if cid.startswith("ADV.") else cid.split(".", 1)[0]


def load_entry(spec: dict) -> dict | None:
    # Prefer dedicated regrade dir; fall back to agent run (has results.json post-grade).
    regrade_rel = spec.get("regrade") or spec.get("agent")
    if not regrade_rel:
        print(f"skip {spec.get('id')}: no regrade/agent path")
        return None
    regrade = ROOT / regrade_rel / "artifacts"
    results_path = regrade / "results.json"
    if not results_path.exists():
        print(f"skip missing {results_path}")
        return None
    results = json.loads(results_path.read_text(encoding="utf8"))
    metrics = soft_score(results)
    scored_pass = sum(1 for i in SCORED if results.get(i) is True)
    scored_fail = sum(1 for i in SCORED if results.get(i) is False)
    by_domain = {}
    for cid, ok in results.items():
        d = domain_of(cid)
        b = by_domain.setdefault(d, {"pass": 0, "fail": 0, "failed": [], "passed": []})
        if ok:
            b["pass"] += 1
            b["passed"].append(cid)
        else:
            b["fail"] += 1
            b["failed"].append(cid)
    for b in by_domain.values():
        n = b["pass"] + b["fail"]
        b["rate"] = round(b["pass"] / n, 4) if n else 0.0
        b["passed"].sort()
        b["failed"].sort()

    usage = {
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0,
        "totalTokens": 0,
        "costUsd": 0.0,
        "assistantTurns": 0,
        "toolCalls": 0,
    }
    thinking = None
    wall = None
    hist_total = None
    go = None
    if spec.get("agent"):
        sp = ROOT / spec["agent"] / "artifacts" / "score.json"
        if sp.exists():
            s = json.loads(sp.read_text(encoding="utf8"))
            u = s.get("usage") or {}
            for k in usage:
                if k in u and u[k] is not None:
                    usage[k] = u[k]
            thinking = s.get("thinking_requested")
            wall = s.get("time_on_task_seconds")
            hist_total = s.get("total")
            go = s.get("go")

    return {
        "id": spec["id"],
        "name": spec["name"],
        "provider_model": spec["provider_model"],
        "arm": spec["arm"],
        "arm_label": "No Skills" if spec["arm"] == "a" else "Skills",
        "summary": spec["summary"],
        "score": metrics,
        "passes": {"passed": scored_pass, "failed": scored_fail, "total": scored_pass + scored_fail},
        "advisory": {
            "passed": sum(1 for i in ADVISORY if results.get(i)),
            "total": len(ADVISORY),
            "results": {i: bool(results.get(i)) for i in ADVISORY},
        },
        "domains": by_domain,
        "results": {k: bool(v) for k, v in results.items()},
        "usage": usage,
        "go": go,
        "thinking": thinking,
        "wall_seconds": wall,
        "historical_score": hist_total,
        "sources": {"regrade": spec["regrade"], "agent": spec.get("agent")},
    }


def spec_for(model_id: str, spec: dict, arm: str, run: Path) -> dict:
    rel = str(run.relative_to(ROOT))
    return {
        "id": model_id if arm == "a" else f"{model_id}-skills",
        "name": spec["name"] if arm == "a" else f"{spec['name']} (Skills)",
        "provider_model": f"opencode-go/{model_id}",
        "arm": arm,
        "regrade": rel,
        "agent": rel,
        "summary": "",
    }


def trend_for(runs: list[Path]) -> dict | None:
    totals = []
    for run in runs:
        score = json.loads((run / "artifacts" / "score.json").read_text(encoding="utf8"))
        total = score.get("total")
        if isinstance(total, (int, float)):
            totals.append(float(total))
    if not totals:
        return None
    last4 = totals[-4:]
    return {
        "ema": ema(totals),
        "min": min(last4),
        "max": max(last4),
        "n": len(totals),
    }


def latest_scored_run(runs: list[Path]) -> Path | None:
    for run in reversed(runs):
        if (run / "artifacts" / "results.json").exists() and (run / "artifacts" / "score.json").exists():
            total = json.loads((run / "artifacts" / "score.json").read_text(encoding="utf8")).get("total")
            if isinstance(total, (int, float)):
                return run
    return None


def main() -> None:
    pricing = load_go_pricing()
    models = []
    for model_id, spec in batch_models(pricing):
        slug = slugify(model_id)
        no_skills_runs = find_arm_runs("a", slug)
        skills_runs = find_arm_runs("b", slug)
        a_run = latest_scored_run(no_skills_runs)
        b_run = latest_scored_run(skills_runs)
        a_row = load_entry(spec_for(model_id, spec, "a", a_run)) if a_run else None
        b_row = load_entry(spec_for(model_id, spec, "b", b_run)) if b_run else None
        if not a_row and not b_row:
            continue
        primary = a_row or b_row
        row = {
            **primary,
            "id": model_id,
            "name": spec["name"],
            "no_skills": a_row,
            "skills": b_row,
            "trend": trend_for(no_skills_runs),
            "skills_trend": trend_for(skills_runs),
            "rank_score": primary["score"]["total"],
        }
        models.append(row)
    models.sort(key=lambda m: m["rank_score"], reverse=True)

    ref_path = ROOT / "runs/rg-reference-20260802-1248/artifacts/results.json"
    reference = None
    if ref_path.exists():
        results = json.loads(ref_path.read_text(encoding="utf8"))
        metrics = soft_score(results)
        reference = {
            "id": "reference",
            "name": "Reference (overlay)",
            "score": metrics,
            "passes": {
                "passed": sum(1 for i in SCORED if results.get(i)),
                "total": len(SCORED),
            },
        }

    payload = {
        "schema": 1,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "benchmark": {
            "name": "Lending Desk Bench",
            "tagline": "Can an OpenCode Go High Usage model finish a real App Router feature under a strict contract?",
            "purpose": (
                "The evaluation measures multi-file Next.js and React product work. "
                "The work matches practice in the Reading Advantage monorepo. "
                "The tasks are not trivia and not small demo apps."
            ),
            "audiences": [
                "Engineering leads who choose models for agent coding",
                "Evaluation and platform teams who measure cost and quality",
                "Staff engineers who check auth, race conditions, and App Router risks",
            ],
            "arms": {
                "a": "No Skills: the fixture and the prompt only. This is the primary comparison.",
                "b": "Skills: the same task with AGENTS.md and five skills.",
            },
            "scoring": {
                "weights": {"completion": 0.6, "adversarial": 0.2, "quality": 0.2},
                "tier_gate": GATE,
                "tier_mode": "soft",
                "scored_checks": len(SCORED),
                "advisory_checks": len(ADVISORY),
                "note": (
                    "Soft tiers scale higher-tier credit by lower-tier rates. "
                    "There is no binary rule at 90 percent Tier 0. "
                    "Advisory checks never affect totals. "
                    "Week 2026w35 grades ran under host load. "
                    "Treat these totals as diagnostic, not as a trusted ranking."
                ),
            },
        },
        "domains": DOMAINS,
        "criteria_tiers": CRITERIA,
        "probe_tiers": PROBES,
        "advisory_ids": ADVISORY,
        "reference": reference,
        "models": models,
        "experiments": {},
        "pricing": {
            "source": pricing.get("source"),
            "retrieved": pricing.get("retrieved"),
            "high_usage_min_requests_per_month": pricing.get("high_usage_min_requests_per_month"),
        },
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf8")
    print(f"wrote {OUT}")
    for m in models:
        go = m.get("go") or {}
        pct = go.get("monthly_pct")
        pct_s = f"{pct:.3f}%" if isinstance(pct, (int, float)) else "—"
        print(
            f"  {m['name']:22} score={m['score']['total']:5.1f} "
            f"pass={m['passes']['passed']}/{m['passes']['total']} "
            f"monthly={pct_s}"
        )


if __name__ == "__main__":
    main()
