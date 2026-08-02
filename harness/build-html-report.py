#!/usr/bin/env python3
"""
Build a presentation-oriented HTML brief for Lending Desk Bench.

  python3 harness/build-html-report.py
  → reports/index.html

Pulls:
  - functional scores from regrade results.json (soft-tier formula)
  - tokens / cost / thinking / wall time from original agent score.json
"""
from __future__ import annotations

import html
import json
import re
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPORTS = ROOT / "reports"
GATE = 0.9

# label, display model name, regrade path (results), agent path (usage) or None
MODELS: list[dict] = [
    {
        "label": "Reference (golden)",
        "short": "reference",
        "provider_model": "—",
        "arm": "a",
        "kind": "calibration",
        "regrade": "runs/rg-reference-20260802-1248",
        "agent": None,
        "note": "Golden overlay — upper bound for the suite, not a model.",
    },
    {
        "label": "DeepSeek V4 Flash",
        "short": "deepseek",
        "provider_model": "deepseek/deepseek-v4-flash",
        "arm": "a",
        "kind": "model",
        "regrade": "runs/rg-deepseek-v4-flash-20260802-1248",
        "agent": "runs/a-deepseek-v4-flash-r1",
        "note": "Best flash submission on this task.",
    },
    {
        "label": "Ling 3.0 Flash",
        "short": "ling",
        "provider_model": "openrouter/inclusionai/ling-3.0-flash:free",
        "arm": "a",
        "kind": "model",
        "regrade": "runs/rg-ling-3-0-flash-20260802-1307",
        "agent": "runs/a-ling-3.0-flash-r1",
        "note": "Stronger on form/auth paths than peers; weaker on probes.",
    },
    {
        "label": "GPT-5.6 Luna",
        "short": "gpt",
        "provider_model": "openrouter/openai/gpt-5.6-luna",
        "arm": "a",
        "kind": "model",
        "regrade": "runs/rg-gpt-5-6-luna-20260802-1307",
        "agent": "runs/a-gpt-5.6-luna-r1",
        "note": "Highest cost; strong catalogue/API, weak action/form path.",
    },
    {
        "label": "Qwen 3.7 Flash",
        "short": "qwen",
        "provider_model": "openrouter/qwen/qwen3.7-flash",
        "arm": "a",
        "kind": "model",
        "regrade": "runs/rg-qwen3-7-flash-20260802-1307",
        "agent": "runs/a-qwen3.7-flash-r1",
        "note": "Fast/cheap relative to GPT; similar form/action failures.",
    },
    {
        "label": "MiMo V2.5",
        "short": "mimo",
        "provider_model": "xiaomi/mimo-v2.5",
        "arm": "a",
        "kind": "model",
        "regrade": "runs/rg-mimo-v2-5-20260802-1307",
        "agent": "runs/a-mimo-v2.5-r1",
        "note": "Lowest cost; more probe and UI regressions.",
    },
]

# Incomplete matrix note: only one Arm B agent run exists in the corpus.
# Do NOT rank models with a missing arm as zero, and do NOT average A+B for
# the single model that has B — that would punish coverage, not quality.
ARM_B_NOTE = {
    "label": "Qwen 3.7 Flash (Arm B only — not ranked)",
    "model": "openrouter/qwen/qwen3.7-flash",
    "regrade": "runs/rg-qwen3-7-flash-b-20260802-1307",
    "agent": "runs/b-qwen3.7-flash-r1",
    "detail": (
        "Arm B = same prompt with AGENTS.md + five skills mounted. "
        "This is the only Arm B run in the current matrix; other models were Arm A only. "
        "It is reported as a one-off experiment, not folded into leaderboard totals."
    ),
}

DOMAIN_ORDER = ["A", "B", "C", "D", "E", "F", "G", "H", "M", "P"]

# Why each domain exists — for product/engineering audiences
DOMAIN_BRIEF: dict[str, dict[str, str]] = {
    "A": {
        "title": "Business rules",
        "why": "Pure domain logic with a fixed clock. If this is wrong, every status badge and filter lies.",
        "who": "Backend / domain correctness",
    },
    "B": {
        "title": "UI composition",
        "why": "Reusable card: link target, alt text, loan badge. Accessibility and list consistency start here.",
        "who": "Frontend / a11y",
    },
    "C": {
        "title": "Catalogue & data fetching",
        "why": "List page with search/category filters and parallel reads — the everyday App Router list pattern.",
        "who": "Full-stack product",
    },
    "D": {
        "title": "Detail & history",
        "why": "Dynamic route, not-found, metadata, loan history order/status — real multi-view product surface.",
        "who": "Full-stack product",
    },
    "E": {
        "title": "Interactive forms",
        "why": "Checkout/return UX: pending labels, optimistic UI, error display. Where “looks done” models often fail.",
        "who": "Frontend / UX",
    },
    "F": {
        "title": "Mutations & auth",
        "why": "Server Actions must authorize, validate, and persist. Security and state integrity.",
        "who": "Security / backend",
    },
    "G": {
        "title": "HTTP API contract",
        "why": "REST handler: filters, 4xx, conflict, freshness. Machine-consumable contract for the same domain.",
        "who": "API / integration",
    },
    "H": {
        "title": "Resilience UX",
        "why": "loading.tsx and error.tsx — streaming shell and failure boundaries users actually hit.",
        "who": "Reliability / UX",
    },
    "M": {
        "title": "Process closeout",
        "why": "Did the agent finish the phased plan and metadata? Proxy for following long instructions.",
        "who": "Agent ops / eval design",
    },
    "P": {
        "title": "Adversarial probes",
        "why": "Hidden checks: revalidation, races, waterfalls, N+1, credential leak. Catches “tests pass, production hurts”.",
        "who": "Staff eng / platform",
    },
    "ADV": {
        "title": "Advisory (not scored)",
        "why": "Optional React 19 idioms (useActionState / useOptimistic). Reported only — never in the total.",
        "who": "Framework preference signal",
    },
}

PALETTE = ["#8b9bb4", "#5b9fd4", "#3dd68c", "#f0c14b", "#e07a5f", "#9b7eda", "#f07178"]


def load_criteria() -> tuple[dict[str, int], dict[str, int], list[str]]:
    text = (ROOT / "harness/tests/criteria.ts").read_text(encoding="utf8")
    head, rest = text.split("export const PROBES", 1)
    probes_part, adv_part = rest.split("export const ADVISORY", 1)
    criteria = {k: int(v) for k, v in re.findall(r'"([^"]+)":\s*\{\s*tier:\s*(\d)', head)}
    probes = {k: int(v) for k, v in re.findall(r'"([^"]+)":\s*\{\s*tier:\s*(\d)', probes_part)}
    advisory = re.findall(r'"([^"]+)"', adv_part.split("];", 1)[0])
    return criteria, probes, advisory


CRITERIA, PROBES, ADVISORY = load_criteria()
SCORED_IDS = list(CRITERIA) + list(PROBES)
N_SCORED = len(SCORED_IDS)


def soft_scale(rate: float, gate: float = GATE) -> float:
    if rate >= gate:
        return 1.0
    if rate <= 0:
        return 0.0
    return rate / gate


def soft_score(passed: dict[str, bool]) -> dict:
    rates: dict[int, float] = {}
    for t in (0, 1, 2):
        ids = [k for k, v in CRITERIA.items() if v == t]
        rates[t] = (sum(1 for i in ids if passed.get(i)) / len(ids)) if ids else 1.0
    scale = {0: 1.0, 1: soft_scale(rates[0]), 2: soft_scale(rates[0]) * soft_scale(rates[1])}
    earned = sum(scale[t] for k, t in CRITERIA.items() if passed.get(k))
    completion = earned / len(CRITERIA)
    adv = sum(scale[t] for k, t in PROBES.items() if passed.get(k)) / len(PROBES)
    quality = completion
    total = round(100 * (0.6 * completion + 0.2 * adv + 0.2 * quality), 1)
    return {"total": total, "completion": completion, "adversarial": adv, "quality": quality, "rates": rates, "scale": scale}


def domain_of(cid: str) -> str:
    return "ADV" if cid.startswith("ADV.") else cid.split(".", 1)[0]


def fmt_int(n: int | float | None) -> str:
    if n is None:
        return "—"
    return f"{int(n):,}"


def fmt_tokens(n: int | None) -> str:
    if n is None:
        return "—"
    if n >= 1_000_000:
        return f"{n/1_000_000:.2f}M"
    if n >= 1_000:
        return f"{n/1_000:.1f}k"
    return str(n)


def fmt_usd(n: float | None) -> str:
    if n is None:
        return "—"
    if n == 0:
        return "$0"
    if n < 0.01:
        return f"${n:.4f}"
    return f"${n:.3f}"


def fmt_secs(n: float | int | None) -> str:
    if n is None:
        return "—"
    n = int(n)
    if n < 60:
        return f"{n}s"
    return f"{n//60}m {n%60:02d}s"


def load_row(spec: dict) -> dict | None:
    regrade = ROOT / spec["regrade"] / "artifacts"
    results_path = regrade / "results.json"
    if not results_path.exists():
        print(f"missing results: {results_path}")
        return None
    results = json.loads(results_path.read_text(encoding="utf8"))
    metrics = soft_score(results)

    scored_pass = sum(1 for i in SCORED_IDS if results.get(i) is True)
    scored_fail = sum(1 for i in SCORED_IDS if results.get(i) is False)
    adv_pass = sum(1 for i in ADVISORY if results.get(i) is True)

    by_domain: dict[str, dict] = {}
    for cid, ok in results.items():
        d = domain_of(cid)
        b = by_domain.setdefault(d, {"pass": 0, "fail": 0, "ids_fail": []})
        if ok:
            b["pass"] += 1
        else:
            b["fail"] += 1
            b["ids_fail"].append(cid)
    for b in by_domain.values():
        n = b["pass"] + b["fail"]
        b["rate"] = b["pass"] / n if n else 0.0
        b["ids_fail"].sort()

    usage = {
        "input": None, "output": None, "cacheRead": None, "cacheWrite": None,
        "totalTokens": None, "costUsd": None, "assistantTurns": None, "toolCalls": None,
    }
    thinking = "—"
    wall = None
    hist_total = None
    agent_model = spec["provider_model"]

    if spec["agent"]:
        agent_score = ROOT / spec["agent"] / "artifacts" / "score.json"
        if agent_score.exists():
            s = json.loads(agent_score.read_text(encoding="utf8"))
            u = s.get("usage") or {}
            for k in usage:
                if k in u:
                    usage[k] = u[k]
            thinking = s.get("thinking_requested") or "—"
            wall = s.get("time_on_task_seconds")
            hist_total = s.get("total")
            agent_model = s.get("model") or agent_model

    return {
        **spec,
        "results": results,
        "metrics": metrics,
        "scored_pass": scored_pass,
        "scored_fail": scored_fail,
        "scored_total": scored_pass + scored_fail,
        "adv_pass": adv_pass,
        "adv_total": len(ADVISORY),
        "by_domain": by_domain,
        "usage": usage,
        "thinking": thinking,
        "wall": wall,
        "hist_total": hist_total,
        "agent_model": agent_model,
    }


def js(v: object) -> str:
    return json.dumps(v, ensure_ascii=False)


def load_arm_b_footnote() -> dict | None:
    """Optional incomplete-matrix footnote; never part of the ranked set."""
    spec = ARM_B_NOTE
    regrade = ROOT / spec["regrade"] / "artifacts" / "results.json"
    agent = ROOT / spec["agent"] / "artifacts" / "score.json"
    if not regrade.exists():
        return None
    results = json.loads(regrade.read_text(encoding="utf8"))
    metrics = soft_score(results)
    scored_pass = sum(1 for i in SCORED_IDS if results.get(i) is True)
    usage = {}
    thinking = wall = None
    if agent.exists():
        s = json.loads(agent.read_text(encoding="utf8"))
        usage = s.get("usage") or {}
        thinking = s.get("thinking_requested")
        wall = s.get("time_on_task_seconds")
    return {
        **spec,
        "metrics": metrics,
        "scored_pass": scored_pass,
        "scored_total": len(SCORED_IDS),
        "usage": usage,
        "thinking": thinking,
        "wall": wall,
    }


def render(rows: list[dict], arm_b: dict | None = None) -> str:
    generated = time.strftime("%Y-%m-%d %H:%M")
    colors = [PALETTE[i % len(PALETTE)] for i in range(len(rows))]
    model_rows = [r for r in rows if r["kind"] == "model"]

    if arm_b:
        u = arm_b.get("usage") or {}
        arm_b_html = f"""
    <div class="callout" style="margin-top:16px">
      <strong>Arm B (not ranked).</strong> {html.escape(arm_b['detail'])}
      <br/>One-off result for {html.escape(arm_b['model'])}:
      soft score <strong>{arm_b['metrics']['total']:.1f}</strong>,
      passes <strong>{arm_b['scored_pass']}/{arm_b['scored_total']}</strong>,
      reasoning <strong>{html.escape(str(arm_b.get('thinking') or '—'))}</strong>,
      cost <strong>{fmt_usd(u.get('costUsd'))}</strong>,
      wall <strong>{fmt_secs(arm_b.get('wall'))}</strong>.
      Do not average this into the Arm A leaderboard.
    </div>
"""
    else:
        arm_b_html = ""

    # Cost / efficiency numbers (models only)
    total_cost = sum((r["usage"]["costUsd"] or 0) for r in model_rows)
    total_in = sum((r["usage"]["input"] or 0) for r in model_rows)
    total_out = sum((r["usage"]["output"] or 0) for r in model_rows)
    total_cache = sum((r["usage"]["cacheRead"] or 0) for r in model_rows)

    def domain_rate(r: dict, d: str) -> float:
        return r["by_domain"].get(d, {}).get("rate", 0.0)

    # Leaderboard table
    lb = []
    for i, r in enumerate(rows, 1):
        u = r["usage"]
        is_ref = r["kind"] == "calibration"
        cost = "—" if is_ref else fmt_usd(u["costUsd"])
        tokens = "—" if is_ref else (
            f"<span title='input'>{fmt_tokens(u['input'])}</span> / "
            f"<span title='output'>{fmt_tokens(u['output'])}</span> / "
            f"<span title='cache read'>{fmt_tokens(u['cacheRead'])}</span>"
        )
        think = "—" if is_ref else html.escape(str(r["thinking"]))
        wall = "—" if is_ref else fmt_secs(r["wall"])
        hist = "—" if r["hist_total"] is None else f"{r['hist_total']}"
        pass_s = f"{r['scored_pass']}/{r['scored_total']}"
        lb.append(
            f"<tr class='{'ref' if is_ref else ''}'>"
            f"<td class='num'>{i}</td>"
            f"<td><span class='swatch' style='background:{colors[i-1]}'></span>"
            f"<strong>{html.escape(r['label'])}</strong>"
            f"<div class='sub'>{html.escape(r['agent_model'])}</div>"
            f"<div class='sub note-line'>{html.escape(r['note'])}</div></td>"
            f"<td class='num score'>{r['metrics']['total']:.1f}</td>"
            f"<td class='num muted'>{hist}</td>"
            f"<td class='num'><strong>{pass_s}</strong></td>"
            f"<td class='num'>{think}</td>"
            f"<td class='num mono'>{tokens}</td>"
            f"<td class='num'>{cost}</td>"
            f"<td class='num'>{wall}</td>"
            f"</tr>"
        )

    # Domain cards
    domain_cards = []
    for d in DOMAIN_ORDER:
        brief = DOMAIN_BRIEF[d]
        # best / worst model (exclude ref for "who struggled")
        rates = [(r["label"], domain_rate(r, d), r) for r in rows]
        best = max(rates, key=lambda x: x[1])
        worst_models = [x for x in rates if x[2]["kind"] == "model"]
        worst = min(worst_models, key=lambda x: x[1]) if worst_models else best
        bars = "".join(
            f"<div class='hbar-row'>"
            f"<span class='hbar-label'>{html.escape(r['short'])}</span>"
            f"<span class='hbar'><i style='width:{100*domain_rate(r,d):.0f}%;background:{colors[i]}'></i></span>"
            f"<span class='hbar-pct'>{100*domain_rate(r,d):.0f}%</span>"
            f"</div>"
            for i, r in enumerate(rows)
        )
        domain_cards.append(
            f"""
<article class="domain-card" id="domain-{d}">
  <header>
    <span class="badge">{d}</span>
    <div>
      <h3>{html.escape(brief['title'])}</h3>
      <p class="why">{html.escape(brief['why'])}</p>
      <p class="who">Audience signal: <strong>{html.escape(brief['who'])}</strong></p>
    </div>
  </header>
  <div class="domain-body">
    <div class="hbars">{bars}</div>
    <p class="sub">Best: <strong>{html.escape(best[0])}</strong> ({100*best[1]:.0f}%) ·
       Weakest model: <strong>{html.escape(worst[0])}</strong> ({100*worst[1]:.0f}%)</p>
  </div>
</article>
"""
        )

    # Efficiency chart data (models only)
    eff_labels = [r["short"] for r in model_rows]
    eff_cost = [r["usage"]["costUsd"] or 0 for r in model_rows]
    eff_score = [r["metrics"]["total"] for r in model_rows]
    eff_out = [r["usage"]["output"] or 0 for r in model_rows]
    eff_colors = [colors[rows.index(r)] for r in model_rows]

    domain_labels = DOMAIN_ORDER
    radar_all = []
    for i, r in enumerate(rows):
        radar_all.append({
            "label": r["short"],
            "data": [round(100 * domain_rate(r, d), 1) for d in domain_labels],
            "borderColor": colors[i],
            "backgroundColor": colors[i] + "33",
            "pointBackgroundColor": colors[i],
            "borderWidth": 2,
            "fill": r["kind"] == "calibration",
        })

    totals_labels = [r["short"] for r in rows]
    totals_data = [r["metrics"]["total"] for r in rows]

    # Per-model profile cards
    profiles = []
    for i, r in enumerate(rows):
        u = r["usage"]
        if r["kind"] == "calibration":
            meta_bits = "Calibration overlay · no API spend"
        else:
            meta_bits = (
                f"Reasoning: <strong>{html.escape(str(r['thinking']))}</strong> · "
                f"Wall: <strong>{fmt_secs(r['wall'])}</strong> · "
                f"Turns: <strong>{fmt_int(u['assistantTurns'])}</strong> · "
                f"Cost: <strong>{fmt_usd(u['costUsd'])}</strong>"
            )
        strengths = [d for d in DOMAIN_ORDER if domain_rate(r, d) >= 0.95]
        weaknesses = [d for d in DOMAIN_ORDER if domain_rate(r, d) < 0.75]
        fail_top = []
        for d in DOMAIN_ORDER:
            fail_top.extend(r["by_domain"].get(d, {}).get("ids_fail", []))
        fail_html = "".join(f"<code>{html.escape(x)}</code> " for x in fail_top[:18]) or "<span class='muted'>None</span>"
        if len(fail_top) > 18:
            fail_html += f"<span class='muted'>+{len(fail_top)-18} more</span>"

        token_block = ""
        if r["kind"] == "model":
            token_block = f"""
            <div class="stat-grid">
              <div class="stat"><span>Input tokens</span><strong>{fmt_tokens(u['input'])}</strong></div>
              <div class="stat"><span>Output tokens</span><strong>{fmt_tokens(u['output'])}</strong></div>
              <div class="stat"><span>Cache read</span><strong>{fmt_tokens(u['cacheRead'])}</strong></div>
              <div class="stat"><span>Cache write</span><strong>{fmt_tokens(u['cacheWrite'])}</strong></div>
              <div class="stat"><span>API cost</span><strong>{fmt_usd(u['costUsd'])}</strong></div>
              <div class="stat"><span>Tool calls</span><strong>{fmt_int(u['toolCalls'])}</strong></div>
            </div>
            """

        profiles.append(
            f"""
<article class="profile" id="profile-{html.escape(r['short'])}">
  <div class="profile-head">
    <h3><span class="swatch" style="background:{colors[i]}"></span>{html.escape(r['label'])}
      <span class="score-pill">{r['metrics']['total']:.1f}</span></h3>
    <p class="meta">{meta_bits}</p>
    <p class="sub">Passes <strong>{r['scored_pass']}/{r['scored_total']}</strong> scored checks
      · Advisory <strong>{r['adv_pass']}/{r['adv_total']}</strong> (unscored)</p>
  </div>
  <div class="profile-grid">
    <div class="chart-box radar"><canvas id="radar-{i}"></canvas></div>
    <div>
      {token_block}
      <p class="kv"><span>Strong domains (≥95%)</span><strong>{html.escape(', '.join(strengths) or '—')}</strong></p>
      <p class="kv"><span>Weak domains (&lt;75%)</span><strong>{html.escape(', '.join(weaknesses) or '—')}</strong></p>
      <h4>Failed checks</h4>
      <div class="fail-cloud">{fail_html}</div>
      <p class="sub" style="margin-top:10px">{html.escape(r['note'])}</p>
    </div>
  </div>
</article>
"""
        )

    chart_js = f"""
const COLORS = {js(colors)};
const DOMAIN_LABELS = {js(domain_labels)};
const gridColor = 'rgba(139,155,180,0.15)';
const tickColor = '#8b9bb4';
Chart.defaults.color = tickColor;
Chart.defaults.borderColor = gridColor;
Chart.defaults.font.family = '"IBM Plex Sans", system-ui, sans-serif';

new Chart(document.getElementById('chart-totals'), {{
  type: 'bar',
  data: {{
    labels: {js(totals_labels)},
    datasets: [{{
      label: 'Soft score',
      data: {js(totals_data)},
      backgroundColor: COLORS,
      borderRadius: 8,
      maxBarThickness: 52,
    }}]
  }},
  options: {{
    responsive: true, maintainAspectRatio: false,
    plugins: {{
      legend: {{ display: false }},
      title: {{ display: true, text: 'Functional score (soft tier gates, 0–100)', color: '#e7ecf3', font: {{ size: 15, weight: '600' }} }},
      tooltip: {{ callbacks: {{ label: (c) => ` ${{c.parsed.y.toFixed(1)}} / 100` }} }}
    }},
    scales: {{
      y: {{ beginAtZero: true, max: 100, grid: {{ color: gridColor }} }},
      x: {{ grid: {{ display: false }} }}
    }}
  }}
}});

new Chart(document.getElementById('chart-radar'), {{
  type: 'radar',
  data: {{ labels: DOMAIN_LABELS, datasets: {js(radar_all)} }},
  options: {{
    responsive: true, maintainAspectRatio: false,
    plugins: {{
      title: {{ display: true, text: 'Domain pass-rate profile', color: '#e7ecf3', font: {{ size: 15, weight: '600' }} }},
      legend: {{ position: 'bottom', labels: {{ boxWidth: 10 }} }}
    }},
    scales: {{
      r: {{
        min: 0, max: 100,
        ticks: {{ stepSize: 25, backdropColor: 'transparent' }},
        grid: {{ color: gridColor }},
        angleLines: {{ color: gridColor }},
        pointLabels: {{ color: '#e7ecf3', font: {{ size: 12, weight: '600' }} }}
      }}
    }}
  }}
}});

new Chart(document.getElementById('chart-cost'), {{
  type: 'bar',
  data: {{
    labels: {js(eff_labels)},
    datasets: [{{
      label: 'API cost (USD)',
      data: {js(eff_cost)},
      backgroundColor: {js(eff_colors)},
      borderRadius: 8,
      maxBarThickness: 48,
      yAxisID: 'y',
    }}, {{
      label: 'Soft score',
      data: {js(eff_score)},
      type: 'line',
      borderColor: '#e7ecf3',
      backgroundColor: '#e7ecf3',
      yAxisID: 'y1',
      tension: 0.25,
      pointRadius: 4,
    }}]
  }},
  options: {{
    responsive: true, maintainAspectRatio: false,
    plugins: {{
      title: {{ display: true, text: 'Cost vs score (agent runs)', color: '#e7ecf3', font: {{ size: 15, weight: '600' }} }},
      legend: {{ position: 'bottom' }}
    }},
    scales: {{
      y: {{ position: 'left', title: {{ display: true, text: 'USD' }}, grid: {{ color: gridColor }}, beginAtZero: true }},
      y1: {{ position: 'right', min: 0, max: 100, title: {{ display: true, text: 'Score' }}, grid: {{ drawOnChartArea: false }} }},
      x: {{ grid: {{ display: false }} }}
    }}
  }}
}});

new Chart(document.getElementById('chart-tokens'), {{
  type: 'bar',
  data: {{
    labels: {js(eff_labels)},
    datasets: [
      {{ label: 'Input', data: {js([r['usage']['input'] or 0 for r in model_rows])}, backgroundColor: '#5b9fd4', stack: 't' }},
      {{ label: 'Output', data: {js([r['usage']['output'] or 0 for r in model_rows])}, backgroundColor: '#f0c14b', stack: 't' }},
      {{ label: 'Cache read', data: {js([r['usage']['cacheRead'] or 0 for r in model_rows])}, backgroundColor: '#3dd68c88', stack: 't' }},
    ]
  }},
  options: {{
    responsive: true, maintainAspectRatio: false,
    plugins: {{
      title: {{ display: true, text: 'Token mix (agent runs)', color: '#e7ecf3', font: {{ size: 15, weight: '600' }} }},
      legend: {{ position: 'bottom' }},
      tooltip: {{ callbacks: {{ label: (c) => ` ${{c.dataset.label}}: ${{c.parsed.y.toLocaleString()}}` }} }}
    }},
    scales: {{
      x: {{ stacked: true, grid: {{ display: false }} }},
      y: {{ stacked: true, beginAtZero: true, grid: {{ color: gridColor }} }}
    }}
  }}
}});

{chr(10).join(
        f"""
new Chart(document.getElementById('radar-{i}'), {{
  type: 'radar',
  data: {{
    labels: DOMAIN_LABELS,
    datasets: [{{
      data: {[round(100*domain_rate(r,d),1) for d in domain_labels]},
      borderColor: '{colors[i]}',
      backgroundColor: '{colors[i]}44',
      pointBackgroundColor: '{colors[i]}',
      borderWidth: 2,
      fill: true,
    }}]
  }},
  options: {{
    responsive: true, maintainAspectRatio: false,
    plugins: {{ legend: {{ display: false }} }},
    scales: {{ r: {{
      min: 0, max: 100,
      ticks: {{ display: false }},
      grid: {{ color: gridColor }},
      angleLines: {{ color: gridColor }},
      pointLabels: {{ color: '#c5d0e0', font: {{ size: 11 }} }}
    }} }}
  }}
}});
"""
        for i, r in enumerate(rows)
    )}
"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Lending Desk Bench — Evaluation brief</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js"></script>
<style>
  :root {{
    --bg: #0c1017; --panel: #151c28; --text: #e8eef7; --muted: #8b9bb4;
    --line: #273246; --accent: #6eb0e0; --good: #3dd68c; --warn: #f0c14b; --bad: #f07178;
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0;
    font: 15px/1.5 "Source Sans 3", "IBM Plex Sans", system-ui, sans-serif;
    background: var(--bg); color: var(--text);
  }}
  .wrap {{ max-width: 1180px; margin: 0 auto; padding: 0 24px 64px; }}
  header.hero {{
    padding: 40px 0 28px;
    border-bottom: 1px solid var(--line);
    margin-bottom: 28px;
  }}
  header.hero .kicker {{
    color: var(--accent); font-size: 12px; font-weight: 700;
    letter-spacing: .12em; text-transform: uppercase; margin: 0 0 10px;
  }}
  header.hero h1 {{ margin: 0 0 12px; font-size: 32px; line-height: 1.15; font-weight: 700; }}
  header.hero .lede {{ font-size: 17px; color: #c5d0e0; max-width: 70ch; margin: 0 0 18px; }}
  .meta-row {{ display: flex; flex-wrap: wrap; gap: 10px; }}
  .chip {{
    background: #1c2638; border: 1px solid var(--line); color: var(--muted);
    padding: 6px 10px; border-radius: 999px; font-size: 12px;
  }}
  .chip strong {{ color: var(--text); }}
  nav.toc {{
    position: sticky; top: 0; z-index: 10;
    background: rgba(12,16,23,.92); backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--line);
    padding: 10px 0; margin: 0 -24px 28px; padding-left: 24px; padding-right: 24px;
    font-size: 13px; color: var(--muted);
  }}
  nav.toc a {{ color: var(--accent); text-decoration: none; margin-right: 14px; }}
  section {{
    background: var(--panel); border: 1px solid var(--line);
    border-radius: 14px; padding: 22px 24px; margin-bottom: 20px;
  }}
  section h2 {{ margin: 0 0 8px; font-size: 20px; }}
  section .section-lede {{ color: var(--muted); margin: 0 0 16px; max-width: 75ch; }}
  h3 {{ margin: 0 0 8px; font-size: 16px; }}
  h4 {{ margin: 14px 0 6px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }}
  .two {{ display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }}
  .three {{ display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }}
  @media (max-width: 900px) {{ .two, .three {{ grid-template-columns: 1fr; }} }}
  .callout {{
    background: #101826; border-left: 3px solid var(--accent);
    padding: 12px 14px; border-radius: 0 10px 10px 0; color: #b7c3d6; margin: 0 0 16px;
  }}
  .callout strong {{ color: var(--text); }}
  table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
  th, td {{ padding: 9px 8px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }}
  th {{ color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }}
  td.num, th.num {{ text-align: right; font-variant-numeric: tabular-nums; }}
  td.score {{ font-size: 18px; font-weight: 700; }}
  td.mono {{ font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 12px; }}
  tr.ref {{ background: rgba(139,155,180,.06); }}
  .sub {{ color: var(--muted); font-size: 12px; margin-top: 2px; }}
  .note-line {{ font-style: italic; }}
  .swatch {{ display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 7px; }}
  .chart-box {{
    height: 320px; background: #101826; border: 1px solid var(--line);
    border-radius: 12px; padding: 12px; position: relative;
  }}
  .chart-box.radar {{ height: 260px; }}
  .chart-box.sm {{ height: 280px; }}
  .kpi {{
    background: #101826; border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px;
  }}
  .kpi .label {{ color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }}
  .kpi .value {{ font-size: 26px; font-weight: 700; margin-top: 4px; }}
  .kpi .hint {{ color: var(--muted); font-size: 12px; margin-top: 4px; }}
  .domain-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }}
  @media (max-width: 800px) {{ .domain-grid {{ grid-template-columns: 1fr; }} }}
  .domain-card {{ background: #101826; border: 1px solid var(--line); border-radius: 12px; padding: 14px; }}
  .domain-card header {{ display: flex; gap: 12px; margin-bottom: 10px; }}
  .domain-card h3 {{ margin: 0 0 4px; }}
  .domain-card .why {{ margin: 0; color: #c5d0e0; font-size: 13px; }}
  .domain-card .who {{ margin: 6px 0 0; color: var(--muted); font-size: 12px; }}
  .badge {{
    flex: 0 0 auto; width: 34px; height: 34px; border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    background: #243247; color: var(--accent); font-weight: 800;
  }}
  .hbar-row {{ display: grid; grid-template-columns: 72px 1fr 40px; gap: 8px; align-items: center; margin: 4px 0; font-size: 12px; }}
  .hbar {{ height: 8px; background: #243247; border-radius: 99px; overflow: hidden; }}
  .hbar i {{ display: block; height: 100%; border-radius: 99px; }}
  .hbar-pct {{ text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; }}
  .hbar-label {{ color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }}
  .profile {{ margin-bottom: 14px; }}
  .profile-head {{ margin-bottom: 12px; }}
  .profile-grid {{ display: grid; grid-template-columns: 280px 1fr; gap: 16px; }}
  @media (max-width: 800px) {{ .profile-grid {{ grid-template-columns: 1fr; }} }}
  .score-pill {{
    display: inline-block; margin-left: 8px; padding: 2px 10px; border-radius: 999px;
    background: #243247; font-size: 14px; vertical-align: middle;
  }}
  .stat-grid {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }}
  .stat {{ background: #101826; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }}
  .stat span {{ display: block; color: var(--muted); font-size: 11px; }}
  .stat strong {{ font-size: 15px; }}
  .kv {{
    display: flex; justify-content: space-between; gap: 10px;
    background: #101826; border-radius: 8px; padding: 8px 10px; margin: 0 0 6px; font-size: 13px;
  }}
  .kv span {{ color: var(--muted); }}
  .fail-cloud code {{
    display: inline-block; margin: 2px 4px 2px 0; padding: 2px 6px;
    background: #2a1c22; color: #f5a8ad; border-radius: 4px; font-size: 11px;
  }}
  .meta {{ color: #c5d0e0; margin: 4px 0; }}
  footer {{ color: var(--muted); font-size: 12px; margin-top: 28px; padding-top: 16px; border-top: 1px solid var(--line); }}
  ul.plain {{ margin: 8px 0; padding-left: 18px; color: #c5d0e0; }}
  ul.plain li {{ margin: 4px 0; }}
  a {{ color: var(--accent); }}
</style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <p class="kicker">Reading Advantage · Agent evaluation</p>
    <h1>Lending Desk Bench</h1>
    <p class="lede">
      A hermetic benchmark for whether a coding agent can finish a real App Router feature
      the way we ship work in the Reading Advantage monorepo: strict TypeScript contracts,
      server actions, route handlers, filters, optimistic UI, and authorization — not a toy todo app.
    </p>
    <div class="meta-row">
      <span class="chip">Generated <strong>{html.escape(generated)}</strong></span>
      <span class="chip">Suite <strong>{N_SCORED} scored checks</strong> + {len(ADVISORY)} advisory</span>
      <span class="chip">Matrix API spend <strong>{fmt_usd(total_cost)}</strong></span>
      <span class="chip">Tokens in/out/cache <strong>{fmt_tokens(total_in)} / {fmt_tokens(total_out)} / {fmt_tokens(total_cache)}</strong></span>
      <span class="chip">Reasoning default <strong>max</strong></span>
    </div>
  </header>

  <nav class="toc">
    <a href="#audience">Who &amp; why</a>
    <a href="#leaderboard">Leaderboard</a>
    <a href="#efficiency">Cost &amp; tokens</a>
    <a href="#domains">Domains</a>
    <a href="#profiles">Per model</a>
    <a href="#method">Method</a>
  </nav>

  <section id="audience">
    <h2>What this is for</h2>
    <p class="section-lede">
      Flash-class models are cheap and fast. This bench asks whether they can do the kind of
      multi-file product work we actually assign agents: extend an existing Next.js app without
      inventing new files, match an existing conventions slice, and pass executable product tests.
    </p>
    <div class="three">
      <div class="kpi">
        <div class="label">Primary question</div>
        <div class="value" style="font-size:16px;line-height:1.35;font-weight:600">
          Can this model complete a constrained full-stack feature end-to-end?
        </div>
      </div>
      <div class="kpi">
        <div class="label">Who should care</div>
        <div class="value" style="font-size:16px;line-height:1.35;font-weight:600">
          Eng leads picking agent models; eval builders; platform teams cost-controlling AI coding.
        </div>
      </div>
      <div class="kpi">
        <div class="label">Not designed for</div>
        <div class="value" style="font-size:16px;line-height:1.35;font-weight:600">
          Trivia, single-function puzzles, or “write a blog from scratch” demos.
        </div>
      </div>
    </div>
    <div class="callout" style="margin-top:16px">
      <strong>Audience map.</strong>
      Product eng cares about domains C–E (pages &amp; forms). Security cares about F &amp; P (auth, races, leaks).
      Platform cares about cost/tokens vs score. Agent-ops cares about M (did it finish the plan) and Arm A vs B (skills on/off).
    </div>
    <ul class="plain">
      <li><strong>This leaderboard is Arm A only</strong> (fixture + prompt; no skills). That is the fair head-to-head.</li>
      <li><strong>Scores</strong> are functional quality of the code (regraded on the current harness with soft tier gates).</li>
      <li><strong>Tokens / cost / reasoning / wall time</strong> come from the original agent session that wrote the code.</li>
      <li><strong>Arm B</strong> (skills mounted) is designed as a second experimental condition. Only one such run exists in this corpus; it is not mixed into the ranking below.</li>
    </ul>
  </section>

  <section id="leaderboard">
    <h2>Leaderboard</h2>
    <p class="section-lede">
      Soft total = product quality under the current suite. Passes = scored checks green
      (criteria + adversarial probes; advisory excluded). Historical = original score.json total under the old hard tier gate.
    </p>
    <div class="chart-box" style="margin-bottom:16px"><canvas id="chart-totals"></canvas></div>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th class="num">#</th>
            <th>System</th>
            <th class="num">Soft score</th>
            <th class="num">Hist.</th>
            <th class="num">Passes</th>
            <th class="num">Reasoning</th>
            <th class="num">Tokens in / out / cache</th>
            <th class="num">API cost</th>
            <th class="num">Wall</th>
          </tr>
        </thead>
        <tbody>{''.join(lb)}</tbody>
      </table>
    </div>
    <p class="sub" style="margin-top:10px">
      Reference is a golden overlay, not a model. All model rows are Arm A.
    </p>
    {arm_b_html}
  </section>

  <section id="efficiency">
    <h2>Cost, tokens, and efficiency</h2>
    <p class="section-lede">
      From original agent transcripts (not regrades). Use this when the question is
      “points per dollar” or “did max reasoning burn tokens usefully?”
    </p>
    <div class="three" style="margin-bottom:16px">
      <div class="kpi">
        <div class="label">Matrix API cost</div>
        <div class="value">{fmt_usd(total_cost)}</div>
        <div class="hint">Sum of model arms in this report</div>
      </div>
      <div class="kpi">
        <div class="label">Output tokens</div>
        <div class="value">{fmt_tokens(total_out)}</div>
        <div class="hint">Generation volume across models</div>
      </div>
      <div class="kpi">
        <div class="label">Cache reads</div>
        <div class="value">{fmt_tokens(total_cache)}</div>
        <div class="hint">Prompt-cache hits (provider-reported)</div>
      </div>
    </div>
    <div class="two">
      <div class="chart-box sm"><canvas id="chart-cost"></canvas></div>
      <div class="chart-box sm"><canvas id="chart-tokens"></canvas></div>
    </div>
    <div class="callout" style="margin-top:16px">
      <strong>Read the chart carefully.</strong> GPT spent the most (~{fmt_usd(next((r['usage']['costUsd'] for r in model_rows if r['short']=='gpt'), 0))})
      for a mid-pack functional score. DeepSeek is near-reference quality at a fraction of that cost.
      MiMo is cheapest but leaves more product gaps. Cost without quality is vanity; quality without cost is incomplete for ops decisions.
    </div>
  </section>

  <section id="domains">
    <h2>Domains — what they are and why they matter</h2>
    <p class="section-lede">
      Each letter is a cluster of executable checks tied to a real product surface in the lending app.
      Pass rate is the fraction of checks green in that cluster (not the weighted score).
    </p>
    <div class="chart-box" style="margin-bottom:16px"><canvas id="chart-radar"></canvas></div>
    <div class="domain-grid">
      {''.join(domain_cards)}
    </div>
    <div class="callout" style="margin-top:16px" id="advisory">
      <strong>Advisory (unscored).</strong>
      <code>ADV.useActionState</code> and <code>ADV.useOptimistic</code> only ask whether the form used those React 19 APIs.
      They are <em>not</em> in the product spec and <em>never</em> change the total. They answer “did the model prefer modern idioms?”
      without punishing a correct older implementation. In this matrix only the reference passes both.
    </div>
  </section>

  <section id="profiles">
    <h2>Per-model brief</h2>
    <p class="section-lede">Radar = domain pass rates. Token/cost block = original agent session.</p>
    {''.join(profiles)}
  </section>

  <section id="method">
    <h2>Method (short)</h2>
    <ul class="plain">
      <li>Task: complete the <code>/items</code> slice of a Next.js 16 / React 19 equipment-lending app from stubs, matching the existing <code>/members</code> conventions.</li>
      <li>Isolation: agent runs in a container with only the fixture visible; harness &amp; reference are hidden.</li>
      <li>Grading: typecheck → build → unit + API + Playwright (incl. error boundary) → soft-tier score (60% completion, 20% probes, 20% quality).</li>
      <li>Soft tiers: higher tiers always contribute, scaled by lower-tier rates (no binary cliff at 90% Tier 0).</li>
      <li>This page mixes <strong>regraded functional quality</strong> (current suite) with <strong>original run economics</strong> (tokens, cost, reasoning level, wall time).</li>
      <li>Not a publishable agent ranking unless scores are trusted, provenance-current, agent-isolated, and graded on a quiet host.</li>
    </ul>
  </section>

  <footer>
    Rebuild: <code>python3 harness/build-html-report.py</code>
    · Source: regrade <code>results.json</code> + agent <code>score.json</code> usage
    · Chart.js via CDN
  </footer>
</div>
<script>
{chart_js}
</script>
</body>
</html>
"""


def main() -> None:
    rows: list[dict] = []
    for spec in MODELS:
        row = load_row(spec)
        if row:
            rows.append(row)
    if not rows:
        raise SystemExit("no runs loaded")
    # Keep calibration first visually; rank models by score. Arm B is never in this set.
    ref = [r for r in rows if r["kind"] == "calibration"]
    models = sorted([r for r in rows if r["kind"] == "model"], key=lambda r: r["metrics"]["total"], reverse=True)
    ordered = ref + models
    arm_b = load_arm_b_footnote()
    REPORTS.mkdir(parents=True, exist_ok=True)
    out = REPORTS / "index.html"
    out.write_text(render(ordered, arm_b=arm_b), encoding="utf8")
    print(f"wrote {out} ({out.stat().st_size:,} bytes)")
    print(f"{'label':28} {'score':>6} {'pass':>8} {'think':>6} {'cost':>9} {'in':>8} {'out':>8}")
    for r in ordered:
        u = r["usage"]
        print(
            f"{r['label'][:28]:28} {r['metrics']['total']:6.1f} "
            f"{r['scored_pass']}/{r['scored_total']:>3} "
            f"{str(r['thinking'])[:6]:>6} "
            f"{fmt_usd(u['costUsd']) if r['kind']=='model' else '—':>9} "
            f"{fmt_tokens(u['input']) if r['kind']=='model' else '—':>8} "
            f"{fmt_tokens(u['output']) if r['kind']=='model' else '—':>8}"
        )
    if arm_b:
        u = arm_b.get("usage") or {}
        print(
            f"(footnote Arm B only)      {arm_b['metrics']['total']:6.1f} "
            f"{arm_b['scored_pass']}/{arm_b['scored_total']:>3} "
            f"{str(arm_b.get('thinking') or '—')[:6]:>6} "
            f"{fmt_usd(u.get('costUsd')):>9}"
        )


if __name__ == "__main__":
    main()
