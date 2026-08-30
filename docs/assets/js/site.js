/**
 * Shared utilities for Lending Desk Bench Pages site.
 */
export const COLORS = [
  "#5b9fd4",
  "#3dd68c",
  "#f0c14b",
  "#e07a5f",
  "#9b7eda",
  "#6eb6ef",
  "#f07178",
];

export const DOMAIN_ORDER = ["A", "B", "C", "D", "E", "F", "G", "H", "M", "P"];

let _dataPromise = null;

export function loadData() {
  if (!_dataPromise) {
    _dataPromise = fetch(new URL("../data/benchmark.json", import.meta.url), { cache: "no-cache" })
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load benchmark.json (${r.status})`);
        return r.json();
      });
  }
  return _dataPromise;
}

export function fmtTokens(n) {
  if (n == null) return "—";
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

export function fmtUsd(n) {
  if (n == null) return "—";
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

export function fmtMonthlyPct(n) {
  if (n == null) return "—";
  return `${Number(n).toFixed(2)}%`;
}

export function fmtSecs(n) {
  if (n == null) return "—";
  n = Math.round(n);
  if (n < 60) return `${n}s`;
  return `${Math.floor(n / 60)}m ${String(n % 60).padStart(2, "0")}s`;
}

export function pct(x) {
  return `${Math.round(100 * x)}%`;
}

export function fmtPct1(x) {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${(100 * x).toFixed(1)}%`;
}

export function cacheHitRate(usage) {
  if (!usage) return null;
  const promptTokens = (usage.cacheRead || 0) + (usage.input || 0);
  if (!promptTokens) return null;
  return (usage.cacheRead || 0) / promptTokens;
}

export function initSortable(table, { initialKey = null, initialDir = -1, renumber = false } = {}) {
  const ths = [...table.querySelectorAll("thead th[data-col]")];
  const tbody = table.querySelector("tbody");
  if (!tbody) return;

  const valueFor = (tr, key) => {
    const raw = tr.getAttribute(`data-sort-${key}`);
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw.toLowerCase();
  };

  const apply = (key, dir) => {
    const rows = [...tbody.querySelectorAll("tr")];
    rows.sort((a, b) => {
      const va = valueFor(a, key);
      const vb = valueFor(b, key);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
    rows.forEach((r) => tbody.appendChild(r));
    if (renumber) {
      rows.forEach((r, i) => {
        const first = r.querySelector("td");
        if (first) first.textContent = String(i + 1);
      });
    }
    ths.forEach((th) => {
      if (th.dataset.col === key) {
        th.setAttribute("aria-sort", dir < 0 ? "descending" : "ascending");
      } else {
        th.removeAttribute("aria-sort");
      }
    });
  };

  ths.forEach((th) => {
    th.classList.add("sortable");
    th.addEventListener("click", () => {
      const dir = th.getAttribute("aria-sort") === "descending" ? 1 : -1;
      apply(th.dataset.col, dir);
    });
  });

  if (initialKey) apply(initialKey, initialDir);
}

export function domainRate(model, d) {
  return model.domains?.[d]?.rate ?? 0;
}

export function modelColor(i) {
  return COLORS[i % COLORS.length];
}

export function setActiveNav() {
  const path = location.pathname.replace(/\/$/, "") || "/";
  document.querySelectorAll(".nav-links a").forEach((a) => {
    const href = a.getAttribute("href") || "";
    const clean = href.replace(/^\.\//, "/").replace(/\/$/, "") || "/";
    // pages live under docs/
    let active = false;
    if (href.endsWith("index.html") || href === "./" || href === "/") {
      active = /\/(docs)?\/?$|\/index\.html$/.test(path) || path.endsWith("/lending-desk-bench");
    } else if (href.includes("methodology")) {
      active = path.includes("methodology");
    } else if (href.includes("results")) {
      active = path.includes("results");
    } else if (href.includes("models")) {
      active = path.includes("models");
    }
    a.classList.toggle("active", active);
  });
}

export function chartDefaults() {
  const tick = "#8b9bb0";
  const grid = "rgba(139,155,176,0.15)";
  if (typeof Chart !== "undefined") {
    Chart.defaults.color = tick;
    Chart.defaults.borderColor = grid;
    Chart.defaults.font.family = '"DM Sans", "Segoe UI", system-ui, sans-serif';
  }
  return { tick, grid };
}

export function mountError(el, err) {
  el.innerHTML = `<div class="error">Could not load benchmark data: ${escapeHtml(String(err.message || err))}</div>`;
}

export function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function pageShell({ title, active, body }) {
  // not used — static HTML shells; kept for future
  return { title, active, body };
}
