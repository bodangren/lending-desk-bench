#!/usr/bin/env python3
"""
Export presentation data for the GitHub Pages site.

  python3 harness/export-site-data.py
  → docs/assets/data/benchmark.json
"""
from __future__ import annotations

import json
import re
import statistics
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "assets" / "data" / "benchmark.json"
GATE = 0.9

# Executor kinds. The provenance record of a run decides its kind; the run ID
# never does (spec FR-8). The ranking holds the OpenCode series only. The
# legacy Pi series stays on disk and is published as history.
EXECUTOR_OPENCODE = "opencode"
EXECUTOR_PI = "pi"
EXECUTOR_UNKNOWN = "unknown"
RANKED_SERIES = EXECUTOR_OPENCODE

_EXECUTOR_CACHE: dict[str, dict | None] = {}


def slugify(model_id: str) -> str:
    return model_id.replace(".", "-")


def _read_executor(artifacts: Path) -> dict | None:
    try:
        provenance = json.loads((artifacts / "provenance.json").read_text(encoding="utf8"))
    except (OSError, json.JSONDecodeError):
        return None
    executor = provenance.get("executor")
    if not isinstance(executor, dict):
        return None
    kind = executor.get("kind")
    if kind == EXECUTOR_OPENCODE:
        record = executor.get("opencode") or {}
        return {"kind": EXECUTOR_OPENCODE, "name": EXECUTOR_OPENCODE, "version": record.get("version")}
    if kind == "not-invoked":
        return {"kind": "not-invoked", "name": "not-invoked", "version": None}
    if isinstance(executor.get("pi"), dict):
        record = executor["pi"]
        return {"kind": EXECUTOR_PI, "name": EXECUTOR_PI, "version": record.get("version")}
    if isinstance(kind, str) and kind:
        return {"kind": kind, "name": kind, "version": None}
    return None


def read_executor(artifacts: Path) -> dict | None:
    """The executor identity of one run, read from its provenance record."""
    key = str(artifacts)
    if key not in _EXECUTOR_CACHE:
        _EXECUTOR_CACHE[key] = _read_executor(artifacts)
    return _EXECUTOR_CACHE[key]


def run_executor(run: Path) -> dict | None:
    return read_executor(run / "artifacts")


def run_series(run: Path) -> str:
    """The score series of one run.

    The executor kind comes from the provenance record of the run. A run with
    no provenance record has no executor kind. Such a run is no legacy Pi run,
    so it stays in the ranked series and its executor reads as unknown.
    """
    executor = run_executor(run)
    return executor["kind"] if executor else EXECUTOR_UNKNOWN


def is_ranked(executor: dict | None) -> bool:
    """True when a row belongs to the ranked series."""
    return (executor or {}).get("kind") in (RANKED_SERIES, EXECUTOR_UNKNOWN)


def series_runs(runs: list[Path], kind: str) -> list[Path]:
    """The runs of one score series.

    The ranked series holds the OpenCode runs and the runs that carry no
    executor record. The legacy Pi series is history and never ranks.
    """
    if kind == RANKED_SERIES:
        return [run for run in runs if run_series(run) in (RANKED_SERIES, EXECUTOR_UNKNOWN)]
    return [run for run in runs if run_series(run) == kind]


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
    # Batch runs end in -<week>-r<N> since bench_v2; older runs end in -<week>.
    run_id = re.compile(rf"^{re.escape(arm)}-{re.escape(slug)}-\d{{4}}w\d{{2}}(-r\d+)?$")
    found = []
    for path in runs_dir.iterdir():
        if run_id.match(path.name) and (path / "artifacts" / "score.json").exists():
            found.append(path)
    return sorted(found, key=lambda p: p.name)


WEEK_TOKEN = re.compile(r"-(\d{4}w\d{2})(?:-r\d+)?$")


def run_week(path: Path) -> str | None:
    match = WEEK_TOKEN.search(path.name)
    return match.group(1) if match else None


def load_score(path: Path) -> dict | None:
    try:
        return json.loads((path / "artifacts" / "score.json").read_text(encoding="utf8"))
    except (OSError, json.JSONDecodeError):
        return None


def valid_total(score: dict | None) -> float | None:
    if not score or score.get("valid") is not True:
        return None
    total = score.get("total")
    return float(total) if isinstance(total, (int, float)) else None


def weekly_repeats(runs: list[Path]) -> dict[str, list[tuple[Path, dict]]]:
    """Valid records grouped by ISO week. Invalid and stale records never count."""
    by_week: dict[str, list[tuple[Path, dict]]] = {}
    for run in runs:
        week = run_week(run)
        score = load_score(run)
        if week and valid_total(score) is not None:
            by_week.setdefault(week, []).append((run, score))
    return by_week


def repeat_summary(week: str, reps: list[tuple[Path, dict]]) -> dict:
    """Headline = the lower median of the week's repeats, so it is a real run's total."""
    totals = sorted(valid_total(score) for _, score in reps)
    median = statistics.median_low(totals)
    return {
        "week": week,
        "n": len(totals),
        "median": round(median, 1),
        "worst": round(totals[0], 1),
        "best": round(totals[-1], 1),
        "totals": [round(t, 1) for t in totals],
        "runs": sorted(run.name for run, _ in reps),
    }


def representative(reps: list[tuple[Path, dict]]) -> Path:
    """The run whose total is the lower median of the week."""
    median = statistics.median_low(sorted(valid_total(score) for _, score in reps))
    return min((run for run, score in reps if valid_total(score) == median), key=lambda run: run.name)


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
    # CHANGE_CRITERIA (change track only) sits between the probes and the advisories.
    probes_part, rest = rest.split("export const CHANGE_CRITERIA", 1)
    adv_part = rest.split("export const ADVISORY", 1)[1]
    criteria = {k: int(v) for k, v in re.findall(r'"([^"]+)":\s*\{\s*tier:\s*(\d)', head)}
    probes = {k: int(v) for k, v in re.findall(r'"([^"]+)":\s*\{\s*tier:\s*(\d)', probes_part)}
    advisory = re.findall(r'"([^"]+)"', adv_part.split("];", 1)[0])
    return criteria, probes, advisory


CRITERIA, PROBES, ADVISORY = load_criteria()
SCORED = list(CRITERIA) + list(PROBES)
SATURATED_WEIGHT = 0.25


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
    source_rel = spec.get("agent") or regrade_rel
    executor = read_executor(ROOT / source_rel / "artifacts") or {
        "kind": EXECUTOR_UNKNOWN,
        "name": EXECUTOR_UNKNOWN,
        "version": None,
    }
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
    trust = None
    fixture_revision = None
    adherence = None
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
            # SCORING.md requires every trust flag before a record may be ranked, and
            # states that a result graded under host load must not be ranked. Carry the
            # flags to the page instead of publishing the totals bare.
            host = s.get("host") or {}
            trust = {
                "valid": bool(s.get("valid")),
                "trusted": bool(s.get("trusted")),
                "publishable": bool(s.get("publishable")),
                "rankable": bool(s.get("rankable")),
                "under_load": bool(host.get("under_load")),
            }
            fixture_revision = s.get("fixture_revision", 1)
            adherence = s.get("adherence")
            # The score record is authoritative for the axes. Its quality axis
            # carries the doctor penalty and its adherence axis the contract;
            # soft_score() above can see neither.
            axes = s.get("axes") or {}
            tiers_in = s.get("tiers") or {}
            if s.get("valid") and isinstance(axes.get("quality"), (int, float)) and s.get("total") is not None:
                metrics = {
                    "total": round(float(s["total"]), 1),
                    "completion": round(float(axes.get("completion", metrics["completion"])), 4),
                    "adversarial": round(float(axes.get("adversarial", metrics["adversarial"])), 4),
                    "adherence": round(float(axes.get("adherence", 1.0)), 4),
                    "quality": round(float(axes["quality"]), 4),
                    "weights": axes.get("weights"),
                    "tiers": {
                        t: {
                            "rate": round(float(tiers_in.get(t, {}).get("rate", metrics["tiers"][t]["rate"])), 4),
                            "scale": round(float(tiers_in.get(t, {}).get("scale", metrics["tiers"][t]["scale"])), 4),
                        }
                        for t in ("0", "1", "2")
                    },
                }

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
        "trust": trust,
        "fixture_revision": fixture_revision,
        "adherence": adherence,
        "executor": executor,
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
    """EMA and 4-week range over weekly medians, oldest week first.

    The trend and the range hold the ranked series only (spec FR-8).
    """
    runs = series_runs(runs, RANKED_SERIES)
    by_week = weekly_repeats(runs)
    if not by_week:
        return None
    weeks = sorted(by_week)
    medians = [statistics.median_low(sorted(valid_total(score) for _, score in by_week[week])) for week in weeks]
    last4 = medians[-4:]
    return {
        "ema": ema(medians),
        "min": min(last4),
        "max": max(last4),
        "n": len(medians),
        "weeks": weeks,
        "medians": [round(m, 1) for m in medians],
    }


def latest_week_entry(model_id: str, spec: dict, arm: str, runs: list[Path]) -> dict | None:
    """The row for the latest week with a valid repeat: lower-median run, plus repeat stats."""
    by_week = weekly_repeats(runs)
    if not by_week:
        return None
    week = max(by_week)
    reps = [(run, score) for run, score in by_week[week] if (run / "artifacts" / "results.json").exists()]
    if not reps:
        return None
    entry = load_entry(spec_for(model_id, spec, arm, representative(reps)))
    if entry:
        entry["repeats"] = repeat_summary(week, reps)
    return entry


def paired_skills_delta(models: list[dict]) -> dict | None:
    """One paired Skills delta: mean over models of median(B) - median(A) in a shared week.

    The pairs hold the ranked series only (spec FR-8).
    """
    pairs = []
    for model in models:
        a, b = model.get("no_skills"), model.get("skills")
        if not a or not b:
            continue
        if not is_ranked(a.get("executor")):
            continue
        if not is_ranked(b.get("executor")):
            continue
        ra, rb = a.get("repeats") or {}, b.get("repeats") or {}
        if ra.get("week") and ra.get("week") == rb.get("week"):
            pairs.append({
                "id": model["id"],
                "week": ra["week"],
                "delta": round(rb["median"] - ra["median"], 1),
                "executor": (a.get("executor") or {}).get("kind"),
            })
    if not pairs:
        return None
    deltas = [pair["delta"] for pair in pairs]
    return {
        "n": len(pairs),
        "mean": round(statistics.fmean(deltas), 1),
        "median": round(statistics.median(deltas), 1),
        "improved": sum(1 for d in deltas if d > 0),
        "worse": sum(1 for d in deltas if d < 0),
        "pairs": pairs,
    }


TRACK_PREFIXES = {"bugfix": "bf-", "tests": "tt-", "change": "ch-"}
TRACK_EVIDENCE = {"bugfix": "repair", "tests": "mutation", "change": "change"}


def load_track_rows(track: str, series: str = RANKED_SERIES) -> list[dict]:
    """Rows for one variant track: the latest week per model and arm, repeats grouped.

    The default series is the ranked one. The legacy Pi series is loaded as
    history and never ranks (spec FR-8).
    """
    runs_dir = ROOT / "runs"
    if not runs_dir.exists():
        return []
    pattern = re.compile(rf"^{TRACK_PREFIXES[track]}([ab])-([a-z0-9-]+?)-(\d{{4}}w\d{{2}})(-r\d+)?$")
    grouped: dict[tuple[str, str], list[Path]] = {}
    for path in runs_dir.iterdir():
        match = pattern.match(path.name)
        if match and (path / "artifacts" / "score.json").exists():
            grouped.setdefault((match.group(2), match.group(1)), []).append(path)
    rows = []
    for (slug, arm), paths in sorted(grouped.items()):
        paths = series_runs(sorted(paths, key=lambda p: p.name), series)
        if not paths:
            continue
        by_week = weekly_repeats(paths)
        by_week = {week: [(run, score) for run, score in reps if score.get("track") == track] for week, reps in by_week.items()}
        by_week = {week: reps for week, reps in by_week.items() if reps}
        if not by_week:
            continue
        week = max(by_week)
        reps = by_week[week]
        run = representative(reps)
        score = load_score(run) or {}
        host = score.get("host") or {}
        evidence = score.get(TRACK_EVIDENCE[track]) or {}
        rows.append({
            "run_id": score.get("run_id") or run.name,
            "model": score.get("model"),
            "slug": slug,
            "arm": arm,
            "arm_label": "No Skills" if arm == "a" else "Skills",
            "week": week,
            "fixture_revision": score.get("fixture_revision", 1),
            "total": round(float(score["total"]), 1),
            "repeats": repeat_summary(week, reps),
            "axes": score.get("axes"),
            "adherence": score.get("adherence"),
            "class_rates": evidence.get("class_rates"),
            "request_rates": evidence.get("request_rates"),
            "bugs": evidence.get("bugs"),
            "tests": evidence.get("tests"),
            "churn_lines": score.get("churn_lines"),
            "trend": trend_for(paths) if series == RANKED_SERIES else None,
            "executor": run_executor(run) or {
                "kind": EXECUTOR_UNKNOWN,
                "name": EXECUTOR_UNKNOWN,
                "version": None,
            },
            "ranked": series == RANKED_SERIES,
            "trust": {
                "valid": bool(score.get("valid")),
                "trusted": bool(score.get("trusted")),
                "publishable": bool(score.get("publishable")),
                "rankable": bool(score.get("rankable")),
                "under_load": bool(host.get("under_load")),
            },
        })
    rows.sort(key=lambda row: row["total"], reverse=True)
    return rows


def main() -> None:
    pricing = load_go_pricing()
    models = []
    history_models = []
    for model_id, spec in batch_models(pricing):
        slug = slugify(model_id)
        arm_runs = {
            "a": find_arm_runs("a", slug),
            "b": find_arm_runs("b", slug),
        }
        # The ranking holds the OpenCode series only (spec FR-8).
        ranked_runs = {arm: series_runs(runs, RANKED_SERIES) for arm, runs in arm_runs.items()}
        a_row = latest_week_entry(model_id, spec, "a", ranked_runs["a"])
        b_row = latest_week_entry(model_id, spec, "b", ranked_runs["b"])
        if a_row or b_row:
            primary = a_row or b_row
            if a_row:
                a_row["ranked"] = True
            if b_row:
                b_row["ranked"] = True
            row = {
                **primary,
                "id": model_id,
                "name": spec["name"],
                "no_skills": a_row,
                "skills": b_row,
                "trend": trend_for(ranked_runs["a"]),
                "skills_trend": trend_for(ranked_runs["b"]),
                "rank_score": primary["score"]["total"],
                "ranked": True,
            }
            models.append(row)
        # History: the legacy Pi series. It is labeled and never ranked.
        pi_runs = {arm: series_runs(runs, EXECUTOR_PI) for arm, runs in arm_runs.items()}
        pi_a = latest_week_entry(model_id, spec, "a", pi_runs["a"])
        pi_b = latest_week_entry(model_id, spec, "b", pi_runs["b"])
        if pi_a or pi_b:
            if pi_a:
                pi_a["ranked"] = False
            if pi_b:
                pi_b["ranked"] = False
            history_models.append({
                "id": model_id,
                "name": spec["name"],
                "provider_model": f"opencode-go/{model_id}",
                "executor": (pi_a or pi_b).get("executor"),
                "ranked": False,
                "no_skills": pi_a,
                "skills": pi_b,
            })
    models.sort(key=lambda m: m["rank_score"], reverse=True)

    # The newest build canary is the reference calibration: it must score 100.
    reference = None
    canaries = sorted((ROOT / "runs").glob("canary-build-*"), key=lambda p: p.name)
    for canary in reversed(canaries):
        score = load_score(canary)
        results_path = canary / "artifacts" / "results.json"
        if valid_total(score) is None or not results_path.exists():
            continue
        results = json.loads(results_path.read_text(encoding="utf8"))
        reference = {
            "id": "reference",
            "name": "Reference (canary)",
            "run_id": canary.name,
            "score": {"total": valid_total(score), **{k: v for k, v in (score.get("axes") or {}).items() if k != "weights"}},
            "passes": {
                "passed": sum(1 for i in SCORED if results.get(i)),
                "total": len(SCORED),
            },
            "executor": read_executor(canary / "artifacts"),
            "ranked": False,
        }
        break

    pi_versions = sorted({
        version
        for entry in history_models
        for row in (entry.get("no_skills"), entry.get("skills"))
        for version in [((row or {}).get("executor") or {}).get("version")]
        if version
    })
    history = {
        "executor": {"kind": EXECUTOR_PI, "name": EXECUTOR_PI},
        "versions": pi_versions,
        "label": "History: Pi executor (not ranked)",
        "note": (
            "These runs used the Pi executor. They stay on disk and are published as "
            "history. The leaderboard, the EMA trend, the 4-week range, and the paired "
            "Skills delta use OpenCode rows only."
        ),
        "models": history_models,
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
                "weights": {"completion": 0.55, "adversarial": 0.2, "adherence": 0.15, "quality": 0.1},
                "saturated_weight": SATURATED_WEIGHT,
                "tier_gate": GATE,
                "tier_mode": "soft",
                "scored_checks": len(SCORED),
                "advisory_checks": len(ADVISORY),
                "note": (
                    "Each total is the lower median of the week's repeated runs; the worst "
                    "run and the repeat count are shown beside it. Soft tiers scale "
                    "higher-tier credit by lower-tier rates. Checks that every competent "
                    "model passes weigh a quarter. Adherence grades the file contract and "
                    "the plan closeout. Advisory checks never affect totals. A row marked "
                    "Unranked failed a trust flag in SCORING.md."
                ),
            },
            "executor": {
                "series": RANKED_SERIES,
                "name": RANKED_SERIES,
                "note": (
                    "The ranking holds OpenCode rows only. Every row shows the executor "
                    "name and version it ran with. Legacy Pi rows are published as "
                    "history and never rank."
                ),
            },
            "skills_delta": paired_skills_delta(models),
        },
        "domains": DOMAINS,
        "criteria_tiers": CRITERIA,
        "probe_tiers": PROBES,
        "advisory_ids": ADVISORY,
        "reference": reference,
        "models": models,
        "history": history,
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
    track_weights = {
        "bugfix": {"repair": 0.45, "regression": 0.2, "robustness": 0.15, "adherence": 0.1, "quality": 0.1},
        "tests": {"kill": 0.6, "validity": 0.2, "adherence": 0.1, "quality": 0.1},
        "change": {"change": 0.45, "regression": 0.25, "robustness": 0.1, "adherence": 0.1, "quality": 0.1},
    }
    tracks = {track: load_track_rows(track) for track in TRACK_PREFIXES}
    track_history = {track: load_track_rows(track, EXECUTOR_PI) for track in TRACK_PREFIXES}
    tracks_out = OUT.parent / "tracks.json"
    tracks_out.write_text(json.dumps({
        "schema": 1,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "executor": {
            "series": RANKED_SERIES,
            "name": RANKED_SERIES,
            "note": (
                "The track tables hold OpenCode rows only. Every row shows the executor "
                "name and version it ran with."
            ),
        },
        "tracks": {
            track: {"weights": track_weights[track], "models": rows}
            for track, rows in tracks.items()
        },
        "history": {
            "executor": {"kind": EXECUTOR_PI, "name": EXECUTOR_PI},
            "label": "History: Pi executor (not ranked)",
            "note": (
                "These runs used the Pi executor. They stay on disk and are published as "
                "history. The track tables rank OpenCode rows only."
            ),
            "tracks": {
                track: {"weights": track_weights[track], "models": rows}
                for track, rows in track_history.items()
            },
        },
    }, indent=2) + "\n", encoding="utf8")
    print(f"wrote {tracks_out} ({', '.join(f'{t}={len(r)}' for t, r in tracks.items())})")
    # bugfix.json keeps its schema-1 shape for existing readers.
    bugfix_out = OUT.parent / "bugfix.json"
    bugfix_out.write_text(json.dumps({
        "schema": 1,
        "track": "bugfix",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "scoring": {"weights": track_weights["bugfix"]},
        "executor": {
            "series": RANKED_SERIES,
            "name": RANKED_SERIES,
        },
        "models": tracks["bugfix"],
        "history": {
            "executor": {"kind": EXECUTOR_PI, "name": EXECUTOR_PI},
            "label": "History: Pi executor (not ranked)",
            "models": track_history["bugfix"],
        },
    }, indent=2) + "\n", encoding="utf8")
    for m in models:
        go = m.get("go") or {}
        pct = go.get("monthly_pct")
        pct_s = f"{pct:.3f}%" if isinstance(pct, (int, float)) else "—"
        print(
            f"  {m['name']:22} score={m['score']['total']:5.1f} "
            f"pass={m['passes']['passed']}/{m['passes']['total']} "
            f"monthly={pct_s}"
        )
    print(
        f"history (Pi executor, not ranked): {len(history_models)} models, "
        f"{', '.join(f'{t}={len(r)}' for t, r in track_history.items())}"
    )


if __name__ == "__main__":
    main()
