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

MODELS = [
    {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash",
        "provider_model": "deepseek/deepseek-v4-flash",
        "arm": "a",
        "regrade": "runs/rg-deepseek-v4-flash-20260802-1248",
        "agent": "runs/a-deepseek-v4-flash-r1",
        "summary": "Best flash result on this task — near-reference functional quality at very low cost.",
    },
    {
        "id": "inkling-small",
        "name": "Inkling Small",
        "provider_model": "openrouter/thinkingmachines/inkling-small",
        "arm": "a",
        # Agent-run grade (results.json); no separate soft regrade path yet.
        "regrade": "runs/a-inkling-small-r1",
        "agent": "runs/a-inkling-small-r1",
        "summary": "Strong second place: perfect Tier 0, high Tier 1 — competitive quality at modest cost.",
    },
    {
        "id": "ling-3.0-flash",
        "name": "Ling 3.0 Flash",
        "provider_model": "openrouter/inclusionai/ling-3.0-flash:free",
        "arm": "a",
        "regrade": "runs/rg-ling-3-0-flash-20260802-1307",
        "agent": "runs/a-ling-3.0-flash-r1",
        "summary": "Competitive mid-pack score; relatively stronger on forms/auth than peers, weaker on probes.",
    },
    {
        "id": "gpt-5.6-luna",
        "name": "GPT-5.6 Luna",
        "provider_model": "openrouter/openai/gpt-5.6-luna",
        "arm": "a",
        "regrade": "runs/rg-gpt-5-6-luna-20260802-1307",
        "agent": "runs/a-gpt-5.6-luna-r1",
        "summary": "Highest API spend and output volume; strong catalogue/API surface, weaker mutation/form path.",
    },
    {
        "id": "doubao-seed-2-1-turbo",
        "name": "Doubao Seed 2.1 Turbo",
        "provider_model": "vocengine-coding/doubao-seed-2-1-turbo",
        "arm": "a",
        "regrade": "runs/a-doubao-seed-2-1-turbo-r1",
        "agent": "runs/a-doubao-seed-2-1-turbo-r1",
        "summary": "Mid-pack on Ark Coding Plan; solid gate pass with zero billed cost on this plan path.",
    },
    {
        "id": "qwen-3.7-flash",
        "name": "Qwen 3.7 Flash",
        "provider_model": "openrouter/qwen/qwen3.7-flash",
        "arm": "a",
        "regrade": "runs/rg-qwen3-7-flash-20260802-1307",
        "agent": "runs/a-qwen3.7-flash-r1",
        "summary": "Solid mid-pack; large input/cache footprint. Arm B experiment is separate and not averaged in.",
    },
    {
        "id": "minimax-m2-7",
        "name": "MiniMax M2.7",
        "provider_model": "minimax-cn/MiniMax-M2.7",
        "arm": "a",
        "regrade": "runs/a-minimax-m2-7-r2",
        "agent": "runs/a-minimax-m2-7-r2",
        "summary": "CN coding-plan path; mid-lower pack with efficient token use after auth fix.",
    },
    {
        "id": "gemini-3.5-flash-lite",
        "name": "Gemini 3.5 Flash Lite",
        "provider_model": "openrouter/google/gemini-3.5-flash-lite",
        "arm": "a",
        "regrade": "runs/a-gemini-3-5-flash-lite-r1",
        "agent": "runs/a-gemini-3-5-flash-lite-r1",
        "summary": "Gate-passing lite model; higher spend for this score band, weaker Tier 0 than leaders.",
    },
    {
        "id": "mimo-v2.5",
        "name": "MiMo V2.5",
        "provider_model": "xiaomi/mimo-v2.5",
        "arm": "a",
        "regrade": "runs/rg-mimo-v2-5-20260802-1307",
        "agent": "runs/a-mimo-v2.5-r1",
        "summary": "Cheapest run; more regressions on probes and interactive UI.",
    },
]

# Optional footnote only — not in ranked models list
ARM_B = {
    "id": "qwen-3.7-flash-arm-b",
    "name": "Qwen 3.7 Flash (Arm B experiment)",
    "provider_model": "openrouter/qwen/qwen3.7-flash",
    "arm": "b",
    "regrade": "runs/rg-qwen3-7-flash-b-20260802-1307",
    "agent": "runs/b-qwen3.7-flash-r1",
    "summary": "Only Arm B run in this corpus (skills mounted). Not ranked against Arm A models.",
}

DOMAINS = {
    "A": {
        "title": "Business rules",
        "why": "Pure domain logic with a fixed clock. Wrong here means every status badge and filter lies.",
        "audience": "Backend / domain correctness",
    },
    "B": {
        "title": "UI composition",
        "why": "Reusable card: link, alt text, loan badge. List consistency and accessibility.",
        "audience": "Frontend / a11y",
    },
    "C": {
        "title": "Catalogue & data fetching",
        "why": "List page with search/category filters and parallel reads — everyday App Router list work.",
        "audience": "Full-stack product",
    },
    "D": {
        "title": "Detail & history",
        "why": "Dynamic route, not-found, metadata, ordered loan history with live status.",
        "audience": "Full-stack product",
    },
    "E": {
        "title": "Interactive forms",
        "why": "Checkout/return UX: pending labels, optimistic UI, error display.",
        "audience": "Frontend / UX",
    },
    "F": {
        "title": "Mutations & auth",
        "why": "Server Actions must authorize, validate, and persist correctly.",
        "audience": "Security / backend",
    },
    "G": {
        "title": "HTTP API contract",
        "why": "REST handler filters, status codes, conflicts, freshness.",
        "audience": "API / integration",
    },
    "H": {
        "title": "Resilience UX",
        "why": "loading.tsx and error.tsx — streaming shells and failure boundaries.",
        "audience": "Reliability / UX",
    },
    "M": {
        "title": "Process closeout",
        "why": "Did the agent finish the phased plan and metadata?",
        "audience": "Agent ops / eval design",
    },
    "P": {
        "title": "Adversarial probes",
        "why": "Hidden checks: revalidation, races, waterfalls, N+1, credential leak.",
        "audience": "Staff eng / platform",
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

    return {
        "id": spec["id"],
        "name": spec["name"],
        "provider_model": spec["provider_model"],
        "arm": spec["arm"],
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
        "thinking": thinking,
        "wall_seconds": wall,
        "historical_score": hist_total,
        "sources": {"regrade": spec["regrade"], "agent": spec.get("agent")},
    }


def main() -> None:
    models = []
    for spec in MODELS:
        row = load_entry(spec)
        if row:
            models.append(row)
    models.sort(key=lambda m: m["score"]["total"], reverse=True)

    arm_b = load_entry(ARM_B)

    ref_path = ROOT / "runs/rg-reference-20260802-1248/artifacts/results.json"
    reference = None
    if ref_path.exists():
        results = json.loads(ref_path.read_text(encoding="utf8"))
        metrics = soft_score(results)
        reference = {
            "id": "reference",
            "name": "Reference (golden overlay)",
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
            "tagline": "Can a flash-class coding agent finish a real App Router feature under a strict contract?",
            "purpose": (
                "Hermetic evaluation of multi-file Next.js / React product work matching "
                "Reading Advantage monorepo practice — not trivia or greenfield toys."
            ),
            "audiences": [
                "Engineering leads choosing models for agentic coding",
                "Eval / platform teams measuring cost vs quality",
                "Staff engineers who care about auth, races, and App Router pitfalls",
            ],
            "arms": {
                "a": "Fixture + prompt only (no skills). Primary fair comparison.",
                "b": "Same task with AGENTS.md + five skills. Experimental; not averaged into Arm A rankings when incomplete.",
            },
            "scoring": {
                "weights": {"completion": 0.6, "adversarial": 0.2, "quality": 0.2},
                "tier_gate": GATE,
                "tier_mode": "soft",
                "scored_checks": len(SCORED),
                "advisory_checks": len(ADVISORY),
                "note": (
                    "Soft tiers scale higher-tier credit by lower-tier rates "
                    "(no binary cliff at 90% Tier 0). Advisory checks never affect totals."
                ),
            },
        },
        "domains": DOMAINS,
        "criteria_tiers": CRITERIA,
        "probe_tiers": PROBES,
        "advisory_ids": ADVISORY,
        "reference": reference,
        "models": models,
        "experiments": {"arm_b": arm_b},
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf8")
    print(f"wrote {OUT}")
    for m in models:
        u = m["usage"]
        print(
            f"  {m['name']:22} score={m['score']['total']:5.1f} "
            f"pass={m['passes']['passed']}/{m['passes']['total']} "
            f"cost=${u['costUsd']:.4f}"
        )


if __name__ == "__main__":
    main()
