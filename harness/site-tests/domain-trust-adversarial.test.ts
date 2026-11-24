import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CRITERIA, PROBES } from "../tests/criteria";
import { SPEC_MATRIX } from "../tests/spec-matrix";
import { UNMAPPED_CRITERIA } from "../tests/meta/spec-matrix-contract";

// Adversarial cases for the domain trust matrix (test strategy section 9).
// Each case tries to make the matrix lie. The file also holds the regression
// cases for the Review A fixes A-P3-1, A-P3-2, and A-P3-8.

const REPO = resolve(import.meta.dirname, "../..");
const HARNESS = resolve(REPO, "harness");
const EXPORT_SCRIPT = resolve(HARNESS, "export-site-data.py");
const DOMAIN_TRUST_SRC = resolve(HARNESS, "domain_trust.py");
const RESULTS_HTML = resolve(REPO, "docs/results.html");
const METHODOLOGY_HTML = resolve(REPO, "docs/methodology.html");
const SITE_JS = resolve(REPO, "docs/assets/js/site.js");
const PUBLISHED = resolve(REPO, "docs/assets/data/benchmark.json");
const PREVIEW = JSON.parse(readFileSync(resolve(REPO, "measure/tracks/domain_trust/preview.json"), "utf8")) as {
  n_min: number;
  probe_map: Record<string, { domain: string; kind: string }>;
};
// The track base commit is an ancestor of main. Its exporter has no domain trust code.
const TRACK_BASE = "6a237beb44c4cd49c91237fb85efb7f657c49d98";

type Json = Record<string, unknown>;
type Check = { id: string; kind: string; since: number; text: string };
type Rec = { revision?: number; results: Record<string, unknown> };

const DOMAINS = "ABCDEFGH".split("");
const VERDICTS = ["risk", "unproven", "unoptimized", "safe"];
const OUTPUTS = ["benchmark.json", "tracks.json", "bugfix.json"];
const ALL_IDS = [...Object.keys(CRITERIA), ...Object.keys(PROBES), "ADV.useActionState", "ADV.useOptimistic"];

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function withRoot<T>(root: string, body: (root: string) => T): T {
  try {
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Registry truth. The check lists come from the TypeScript registry and the
// golden probe map, never from harness/domain_trust.py.
// ---------------------------------------------------------------------------

function registryText(id: string): string {
  const row = SPEC_MATRIX.find((r) => r.primary === id);
  return row?.spec ?? UNMAPPED_CRITERIA[id] ?? PROBES[id]?.catches ?? "";
}

function registryChecks(): Record<string, Check[]> {
  const out: Record<string, Check[]> = Object.fromEntries(DOMAINS.map((d) => [d, [] as Check[]]));
  for (const [id, criterion] of Object.entries(CRITERIA)) {
    if (!/^[A-H]\./.test(id)) continue;
    out[id[0]].push({ id, kind: "spec", since: criterion.since ?? 1, text: registryText(id) });
  }
  for (const [id, entry] of Object.entries(PREVIEW.probe_map)) {
    out[entry.domain].push({ id, kind: entry.kind, since: 1, text: registryText(id) });
  }
  return out;
}

const REGISTRY_CHECKS = registryChecks();
const ALL_CHECKS = DOMAINS.flatMap((d) => REGISTRY_CHECKS[d].map((c) => ({ ...c, domain: d })));

// ---------------------------------------------------------------------------
// Python helpers
// ---------------------------------------------------------------------------

function pyCells(cases: Array<{ checks: unknown; records: unknown[]; n_min: number }>): Json[] {
  const code = [
    "import sys, json",
    `sys.path.insert(0, ${JSON.stringify(HARNESS)})`,
    "import domain_trust",
    "cases = json.load(sys.stdin)",
    "out = [domain_trust.domain_cells(c['checks'], c['records'], c['n_min']) for c in cases]",
    "print(json.dumps(out, sort_keys=True))",
  ].join("; ");
  const res = spawnSync("python3", ["-c", code], {
    cwd: HARNESS,
    encoding: "utf8",
    input: JSON.stringify(cases),
    maxBuffer: 256 * 1024 * 1024,
  });
  expect(res.status, `harness/domain_trust.py domain_cells failed: ${res.stderr}`).toBe(0);
  return JSON.parse(String(res.stdout)) as Json[];
}

function cellsOf(checks: unknown, records: unknown[], nMin = 2): Record<string, Json> {
  return pyCells([{ checks, records, n_min: nMin }])[0] as Record<string, Json>;
}

function check(id: string, kind: string, since = 1): Check {
  return { id, kind, since, text: `${id} text` };
}

// ---------------------------------------------------------------------------
// Independent oracle. It follows the spec definitions and the verdict rule.
// ---------------------------------------------------------------------------

function oracleCells(checks: Record<string, Check[]>, records: Rec[], nMin: number): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const d of DOMAINS) {
    const list = checks[d] ?? [];
    const failures: Array<{ id: string; kind: string; text: string; failed: number; graded: number }> = [];
    const gaps: Array<{ id: string; graded: number }> = [];
    const coverage: number[] = [];
    for (const c of list) {
      let graded = 0;
      let failed = 0;
      for (const r of records) {
        if (c.since > (r.revision ?? 1)) continue;
        const value = Object.hasOwn(r.results, c.id) ? r.results[c.id] : undefined;
        if (typeof value !== "boolean") continue;
        graded += 1;
        if (value === false) failed += 1;
      }
      coverage.push(graded);
      if (failed > 0) failures.push({ id: c.id, kind: c.kind, text: c.text, failed, graded });
      if (graded < nMin) gaps.push({ id: c.id, graded });
    }
    const hard = failures.some((f) => f.kind === "spec" || f.kind === "robustness");
    // A domain with no check holds no evidence. No evidence is never safe.
    const verdict = hard
      ? "risk"
      : list.length === 0 || gaps.length > 0
        ? "unproven"
        : failures.length > 0
          ? "unoptimized"
          : "safe";
    failures.sort((a, b) => b.failed - a.failed || byId(a, b));
    gaps.sort(byId);
    out[d] = {
      verdict,
      min_coverage: coverage.length ? Math.min(...coverage) : 0,
      failures,
      gaps: verdict === "unproven" ? gaps : [],
    };
  }
  return out;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Case = { checks: Record<string, Check[]>; records: Rec[]; n_min: number };

function genCase(rnd: () => number): Case {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const nMin = 1 + Math.floor(rnd() * 4);
  const pFail = pick([0, 0, 0.03, 0.12, 0.4]);
  const pMissing = pick([0, 0.05, 0.3]);
  const pJunk = pick([0, 0.05]);
  const sinces = pick([[1], [1, 1, 1, 2, 3]]);
  const checks: Record<string, Check[]> = {};
  for (const d of DOMAINS) {
    const count = rnd() < 0.08 ? 0 : 1 + Math.floor(rnd() * 4);
    checks[d] = Array.from({ length: count }, (_, i) => ({
      id: `${d}.c${i}`,
      kind: pick(["spec", "robustness", "performance"]),
      since: pick(sinces),
      text: `${d}.c${i} <b>"&'`,
    }));
  }
  const records = Array.from({ length: Math.floor(rnd() * 7) }, () => {
    const results: Record<string, unknown> = { "ADV.useActionState": false, "Z.extra": false };
    for (const list of Object.values(checks)) {
      for (const c of list) {
        if (rnd() < pMissing) continue;
        if (rnd() < pJunk) {
          results[c.id] = pick([null, "true", "false", 1, 0, [], {}]);
          continue;
        }
        results[c.id] = rnd() >= pFail;
      }
    }
    const record: Rec = { results };
    if (rnd() < 0.9) record.revision = pick([1, 2, 3]);
    return record;
  });
  return { checks, records, n_min: nMin };
}

// ---------------------------------------------------------------------------
// Temporary roots for the export
// ---------------------------------------------------------------------------

type CatalogModel = { name: string; batch?: boolean; highUsage?: boolean; requests?: number };

function pricingOf(models: Record<string, CatalogModel>): Json {
  return {
    schema: 1,
    source: "synthetic",
    retrieved: "2026-10-25",
    high_usage_min_requests_per_month: 7000,
    deepseek_rate: "off-peak",
    provider: "opencode-go",
    apis: { "openai-completions": { baseUrl: "https://example.invalid" } },
    aliases: {},
    models: Object.fromEntries(
      Object.entries(models).map(([id, m]) => [
        id,
        {
          name: m.name,
          api: "openai-completions",
          high_usage: m.highUsage ?? true,
          batch: m.batch ?? true,
          requests_per_month: m.requests ?? 10000,
          monthly_usage_usd: 15,
          rates: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
        },
      ]),
    ),
  };
}

type Shape = { companion?: boolean; marker?: boolean; registry?: boolean };

/** A full harness holds the companion, the registry files, and the generator marker. */
function makeRoot(pricing: Json, shape: Shape = {}): string {
  const { companion = true, marker = true, registry = true } = shape;
  const root = mkdtempSync(join(tmpdir(), "domain-trust-adv-"));
  mkdirSync(join(root, "harness/tests/meta"), { recursive: true });
  mkdirSync(join(root, "runs"), { recursive: true });
  cpSync(EXPORT_SCRIPT, join(root, "harness/export-site-data.py"));
  cpSync(resolve(HARNESS, "tests/criteria.ts"), join(root, "harness/tests/criteria.ts"));
  if (registry) {
    cpSync(resolve(HARNESS, "tests/spec-matrix.ts"), join(root, "harness/tests/spec-matrix.ts"));
    cpSync(resolve(HARNESS, "tests/meta/spec-matrix-contract.ts"), join(root, "harness/tests/meta/spec-matrix-contract.ts"));
  }
  if (companion) cpSync(DOMAIN_TRUST_SRC, join(root, "harness/domain_trust.py"));
  if (marker) writeFileSync(join(root, "harness/generate-model-pages.py"), "# full harness marker\n");
  writeJson(join(root, "harness/go-pricing.json"), pricing);
  return root;
}

/** The legacy partial workspace of bench-incremental.test.ts: exporter, criteria, and pricing only. */
function makePartialRoot(pricing: Json): string {
  return makeRoot(pricing, { companion: false, marker: false, registry: false });
}

/** Replace one text in a copied file. The call fails when the text is absent. */
function patchFile(root: string, rel: string, from: string | RegExp, to: string | ((match: string, ...groups: string[]) => string)): void {
  const path = join(root, rel);
  const before = readFileSync(path, "utf8");
  const after = before.replace(from, typeof to === "string" ? () => to : to);
  if (after === before) throw new Error(`patch target not found in ${rel}: ${String(from)}`);
  writeFileSync(path, after);
}

type RunOptions = {
  revision?: unknown;
  valid?: unknown;
  total?: number;
  executor?: "opencode" | "pi" | "none";
  results?: unknown;
  rawResults?: string;
};

function writeRun(root: string, runId: string, o: RunOptions = {}): void {
  const artifacts = join(root, "runs", runId, "artifacts");
  mkdirSync(artifacts, { recursive: true });
  writeJson(join(artifacts, "score.json"), {
    schema: 3,
    track: "build",
    run_id: runId,
    valid: "valid" in o ? o.valid : true,
    trusted: true,
    publishable: true,
    rankable: true,
    total: o.total ?? 70,
    fixture_revision: "revision" in o ? o.revision : 2,
  });
  if (o.rawResults !== undefined) writeFileSync(join(artifacts, "results.json"), o.rawResults);
  else if (o.results !== undefined) writeJson(join(artifacts, "results.json"), o.results);
  const executor = o.executor ?? "opencode";
  if (executor === "pi") {
    writeJson(join(artifacts, "provenance.json"), { track: "build", executor: { pi: { version: "test-pi" } } });
  } else if (executor === "opencode") {
    writeJson(join(artifacts, "provenance.json"), { track: "build", executor: { kind: "opencode", opencode: { version: "test" } } });
  }
}

function allPass(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...Object.fromEntries(ALL_IDS.map((id) => [id, true])), ...overrides };
}

function allFail(): Record<string, unknown> {
  return Object.fromEntries(ALL_IDS.map((id) => [id, false]));
}

type Run = SpawnSyncReturns<string>;

function runExport(root: string, cwd = root): Run {
  return spawnSync("python3", [join(root, "harness/export-site-data.py")], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function readJsonFile(path: string): Json {
  return JSON.parse(readFileSync(path, "utf8")) as Json;
}

function exportAll(root: string): { payload: Json; block: Json } {
  const res = runExport(root);
  expect(res.status, `export must exit 0: ${res.stderr}`).toBe(0);
  const payload = readJsonFile(join(root, "docs/assets/data/benchmark.json"));
  return { payload, block: payload.domain_trust as Json };
}

// A fixed clock makes two exports comparable byte for byte.
const FROZEN_RUNNER = [
  "import runpy, sys, time",
  "time.strftime = lambda fmt, *a: sys.argv[2]",
  "runpy.run_path(sys.argv[1], run_name='__main__')",
].join("\n");

function runFrozen(root: string, script: string, stamp = "2000-01-01T00:00:00"): Record<string, string> {
  const res = spawnSync("python3", ["-c", FROZEN_RUNNER, script, stamp], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  expect(res.status, `frozen export must exit 0: ${res.stderr}`).toBe(0);
  return Object.fromEntries(OUTPUTS.map((name) => [name, readFileSync(join(root, "docs/assets/data", name), "utf8")]));
}

function seedOutputs(root: string): Record<string, string> {
  const dir = join(root, "docs/assets/data");
  mkdirSync(dir, { recursive: true });
  const seeded = Object.fromEntries(OUTPUTS.map((name) => [name, JSON.stringify({ sentinel: name }) + "\n"]));
  for (const [name, text] of Object.entries(seeded)) writeFileSync(join(dir, name), text);
  return seeded;
}

function readOutputs(root: string): Record<string, string | null> {
  return Object.fromEntries(
    OUTPUTS.map((name) => {
      const path = join(root, "docs/assets/data", name);
      return [name, existsSync(path) ? readFileSync(path, "utf8") : null];
    }),
  );
}

function rowsOf(block: Json): Map<string, Json> {
  return new Map((block.models as Json[]).map((m) => [m.id as string, m]));
}

// ---------------------------------------------------------------------------
// Invariants of the published rule. They hold for each export of any records.
// ---------------------------------------------------------------------------

function assertBlockInvariants(block: Json, label: string): void {
  const rule = block.rule as Json;
  const nMin = rule.n_min as number;
  expect(block.schema, `${label}: schema`).toBe(1);
  expect(Number.isInteger(nMin) && nMin >= 1, `${label}: rule.n_min is a positive integer, got ${String(nMin)}`).toBe(true);
  expect(rule.verdicts, `${label}: rule.verdicts keep the precedence order`).toEqual(VERDICTS);
  const checks = block.checks as Record<string, Json[]>;
  expect(Object.keys(checks), `${label}: checks hold the domains A to H`).toEqual(DOMAINS);
  const info = new Map<string, Json>();
  for (const d of DOMAINS) {
    expect(checks[d].length, `${label}: domain ${d} holds a check`).toBeGreaterThan(0);
    for (const c of checks[d]) {
      expect(["spec", "robustness", "performance"], `${label}: kind of ${String(c.id)}`).toContain(c.kind);
      expect(String(c.text ?? "").trim(), `${label}: text of ${String(c.id)}`).not.toBe("");
      expect(info.has(c.id as string), `${label}: check id ${String(c.id)} appears once`).toBe(false);
      info.set(c.id as string, { ...c, domain: d });
    }
  }
  const models = block.models as Json[];
  const ids = models.map((m) => m.id as string);
  expect(ids, `${label}: rows sort by id`).toEqual([...ids].sort());
  expect(new Set(ids).size, `${label}: each row id is unique`).toBe(ids.length);
  for (const m of models) {
    const id = m.id as string;
    const runs = m.runs as Json;
    const total = runs.total as number;
    const runIds = runs.run_ids as string[];
    const slug = id.replaceAll(".", "-").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^[ab]-${slug}-\\d{4}w\\d{2}(-r\\d+)?$`);
    expect(runIds.length, `${label}: ${id} run_ids length equals total`).toBe(total);
    expect(runIds, `${label}: ${id} run_ids are sorted and unique`).toEqual([...new Set(runIds)].sort());
    expect(runIds.every((r) => pattern.test(r)), `${label}: ${id} run ids match the model slug`).toBe(true);
    expect(runs.arm_a, `${label}: ${id} arm_a`).toBe(runIds.filter((r) => r.startsWith("a-")).length);
    expect(runs.arm_b, `${label}: ${id} arm_b`).toBe(runIds.filter((r) => r.startsWith("b-")).length);
    expect((runs.opencode as number) + (runs.pi as number), `${label}: ${id} executor counts fit the total`).toBeLessThanOrEqual(total);
    const cells = m.cells as Record<string, Json>;
    expect(Object.keys(cells), `${label}: ${id} cells hold the domains A to H`).toEqual(DOMAINS);
    for (const d of DOMAINS) {
      const where = `${label}: ${id} ${d}`;
      const cell = cells[d];
      const failures = cell.failures as Json[];
      const gaps = cell.gaps as Json[];
      const minCoverage = cell.min_coverage as number;
      expect(VERDICTS, `${where}: verdict`).toContain(cell.verdict);
      expect(Number.isInteger(minCoverage) && minCoverage >= 0 && minCoverage <= total, `${where}: min_coverage ${minCoverage} fits 0..${total}`).toBe(true);
      expect(failures.map((f) => f.id), `${where}: failures sort by failed, then id`).toEqual(
        [...(failures as Array<{ id: string; failed: number }>)].sort((a, b) => b.failed - a.failed || byId(a, b)).map((f) => f.id),
      );
      for (const f of failures) {
        const listed = info.get(f.id as string);
        expect(listed?.domain, `${where}: failure ${String(f.id)} belongs to the domain`).toBe(d);
        expect(f.kind, `${where}: failure ${String(f.id)} kind`).toBe(listed?.kind);
        expect(f.text, `${where}: failure ${String(f.id)} text`).toBe(listed?.text);
        const counts = `${String(f.failed)}/${String(f.graded)} of ${total}`;
        expect(
          (f.failed as number) >= 1 && (f.failed as number) <= (f.graded as number) && (f.graded as number) <= total,
          `${where}: failure ${String(f.id)} counts ${counts}`,
        ).toBe(true);
        expect(minCoverage, `${where}: min_coverage never exceeds the coverage of ${String(f.id)}`).toBeLessThanOrEqual(f.graded as number);
      }
      for (const g of gaps) {
        expect(info.get(g.id as string)?.domain, `${where}: gap ${String(g.id)} belongs to the domain`).toBe(d);
        expect(
          (g.graded as number) < nMin && (g.graded as number) <= total,
          `${where}: gap ${String(g.id)} has coverage ${String(g.graded)} below ${nMin}`,
        ).toBe(true);
      }
      const hard = failures.some((f) => f.kind === "spec" || f.kind === "robustness");
      if (cell.verdict === "risk") {
        expect(hard, `${where}: risk needs a spec or robustness failure`).toBe(true);
        expect(gaps, `${where}: a risk cell lists no gap`).toEqual([]);
      } else {
        expect(hard, `${where}: a ${String(cell.verdict)} cell holds no spec or robustness failure`).toBe(false);
      }
      if (cell.verdict === "unproven") {
        expect(gaps.length > 0, `${where}: unproven needs a gap`).toBe(true);
        expect(minCoverage, `${where}: min_coverage is the lowest gap`).toBe(Math.min(...gaps.map((g) => g.graded as number)));
      }
      if (cell.verdict === "unoptimized" || cell.verdict === "safe") {
        expect(gaps, `${where}: no gap in a ${String(cell.verdict)} cell`).toEqual([]);
        expect(minCoverage, `${where}: ${String(cell.verdict)} needs coverage of ${nMin}`).toBeGreaterThanOrEqual(nMin);
      }
      if (cell.verdict === "unoptimized") {
        expect(
          failures.length > 0 && failures.every((f) => f.kind === "performance"),
          `${where}: unoptimized holds performance failures only`,
        ).toBe(true);
      }
      if (cell.verdict === "safe") expect(failures, `${where}: a safe cell lists no failure`).toEqual([]);
    }
  }
}

// ---------------------------------------------------------------------------
// The results page, run without a browser. The real results.html script and
// the real site.js run against a small document stub.
// ---------------------------------------------------------------------------

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
  ...args: string[]
) => (...values: unknown[]) => Promise<unknown>;

type Page = { table: string; failures: string; main: string };

async function renderResults(trust: unknown): Promise<Page> {
  const html = readFileSync(RESULTS_HTML, "utf8");
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
  const importStatement = /import\s*\{([\s\S]*?)\}\s*from\s*"\.\/assets\/js\/site\.js";/.exec(script);
  expect(importStatement, "results.html imports its helpers from assets/js/site.js").not.toBeNull();
  const body = script.replace(importStatement![0], `const {${importStatement![1]}} = __site;`);
  const site = (await import(pathToFileURL(SITE_JS).href)) as Record<string, unknown>;
  const elements = new Map<string, { innerHTML: string; hidden?: boolean }>();
  const element = (key: string) => {
    if (!elements.has(key)) elements.set(key, { innerHTML: "" });
    return elements.get(key)!;
  };
  const document = {
    getElementById: (id: string) => element(`#${id}`),
    querySelector: (selector: string) => element(selector),
    querySelectorAll: () => [],
  };
  const payload = {
    schema: 1,
    generated_at: "2026-11-24T00:00:00",
    models: [],
    history: { models: [] },
    domains: {},
    benchmark: { skills_delta: null },
    domain_trust: trust,
  };
  const helpers = {
    ...site,
    loadData: async () => payload,
    setActiveNav: () => undefined,
    initSortable: () => undefined,
    chartDefaults: () => ({ grid: "" }),
  };
  await new AsyncFunction("document", "__site", "Chart", body)(document, helpers, undefined);
  const main = element("#main").innerHTML;
  expect(main.includes("Could not load benchmark data"), `results.html must render: ${main}`).toBe(false);
  return { table: element("#trust-table").innerHTML, failures: element("#trust-failures").innerHTML, main };
}

function tagNames(html: string): string[] {
  return [...html.matchAll(/<\s*\/?\s*([a-zA-Z][\w-]*)/g)].map((m) => m[1].toLowerCase());
}

/** The text of an HTML fragment, with the entities that escapeHtml writes turned back. */
function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}

function listItems(html: string): string[] {
  return [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
}

function tableCells(html: string): string[] {
  return [...html.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => plain(m[1]));
}

function rowNames(html: string): string[] {
  return [...html.matchAll(/<th scope="row">([\s\S]*?)<div/g)].map((m) => plain(m[1]));
}

const WORD: Record<string, string> = { safe: "safe", unproven: "unproven", unoptimized: "Safe, not optimized", risk: "risk" };

/** The page shows each cell as a word, keeps the row order, and lists each cell that is not safe once. */
function assertPageShowsBlock(page: Page, block: Json, label: string): void {
  const models = block.models as Json[];
  const expectedWords = models.flatMap((m) => DOMAINS.map((d) => WORD[(m.cells as Record<string, Json>)[d].verdict as string]));
  expect(tableCells(page.table), `${label}: each cell shows its verdict as a word, in row order`).toEqual(expectedWords);
  expect(rowNames(page.table), `${label}: rows keep the order of the export`).toEqual(models.map((m) => String(m.name)));
  const items = listItems(page.failures).map(plain);
  const expectedItems = models.flatMap((m) =>
    DOMAINS.filter((d) => (m.cells as Record<string, Json>)[d].verdict !== "safe").map(
      (d) => `${String(m.name)} — ${d} ${WORD[(m.cells as Record<string, Json>)[d].verdict as string]}`,
    ),
  );
  expect(items.length, `${label}: the failure list names each cell that is not safe`).toBe(expectedItems.length);
  expectedItems.forEach((prefix, i) => {
    expect(items[i].startsWith(prefix), `${label}: item ${i} starts with "${prefix}", got "${items[i]}"`).toBe(true);
  });
}

// ===========================================================================
// 1. The verdict function
// ===========================================================================

describe("domain trust adversarial: the verdict function cannot lie", () => {
  it("never gives safe to no record or to one record at N_MIN 2 (case 1)", () => {
    const checks = Object.fromEntries(DOMAINS.map((d) => [d, [check(`${d}.one`, "spec"), check(`${d}.two`, "robustness")]]));
    const clean = { revision: 1, results: Object.fromEntries(DOMAINS.flatMap((d) => [[`${d}.one`, true], [`${d}.two`, true]])) };
    const none = cellsOf(checks, [], 2);
    const lone = cellsOf(checks, [clean], 2);
    for (const d of DOMAINS) {
      expect(none[d], `no record, domain ${d}`).toEqual({
        verdict: "unproven",
        min_coverage: 0,
        failures: [],
        gaps: [{ id: `${d}.one`, graded: 0 }, { id: `${d}.two`, graded: 0 }],
      });
      expect(lone[d], `one record, domain ${d}`).toEqual({
        verdict: "unproven",
        min_coverage: 1,
        failures: [],
        gaps: [{ id: `${d}.one`, graded: 1 }, { id: `${d}.two`, graded: 1 }],
      });
    }
  });

  it("gets no evidence from a value that is not a boolean, or from a record with no results (case 1)", () => {
    const checks = { A: [check("A.one", "spec"), check("A.two", "spec")] };
    const junk = [null, "true", "false", 1, 0, [], {}, "yes"].map((v) => ({ revision: 2, results: { "A.one": v, "A.two": v } }));
    const records = [...junk, { revision: 2, results: null }, { revision: 2 }, { revision: 2, results: {} }];
    expect(cellsOf(checks, records, 2).A).toEqual({
      verdict: "unproven",
      min_coverage: 0,
      failures: [],
      gaps: [{ id: "A.one", graded: 0 }, { id: "A.two", graded: 0 }],
    });
  });

  it("never gives safe to a domain that holds no check (case 1)", () => {
    const clean = { revision: 2, results: allPass() };
    const out = cellsOf({}, [clean, clean, clean], 2);
    for (const d of DOMAINS) {
      expect(out[d], `domain ${d} with no check`).toEqual({ verdict: "unproven", min_coverage: 0, failures: [], gaps: [] });
    }
  });

  it("never counts an unstated check as a failure or as coverage (case 2)", () => {
    const checks = {
      E: [check("E.submits", "spec", 1), check("E.labels", "spec", 2), check("E.error-announced", "spec", 2)],
    };
    const record = (revision: number | undefined, labels: boolean, announced: boolean): Json => ({
      ...(revision === undefined ? {} : { revision }),
      results: { "E.submits": true, "E.labels": labels, "E.error-announced": announced },
    });
    const gaps = (n: number) => [{ id: "E.error-announced", graded: n }, { id: "E.labels", graded: n }];
    const unproven = (n: number) => ({ verdict: "unproven", min_coverage: n, failures: [], gaps: gaps(n) });
    expect(cellsOf(checks, [record(1, false, false), record(1, false, false), record(1, false, false)]).E, "revision 1 false").toEqual(unproven(0));
    expect(cellsOf(checks, [record(1, true, true), record(1, true, true), record(1, true, true)]).E, "revision 1 true is no coverage").toEqual(unproven(0));
    expect(cellsOf(checks, [record(undefined, false, false), record(undefined, false, false)]).E, "no revision means revision 1").toEqual(unproven(0));
    expect(
      cellsOf(checks, [record(1, false, false), record(1, false, false), record(2, true, true)]).E,
      "one revision 2 record gives one graded result",
    ).toEqual(unproven(1));
    expect(
      cellsOf(checks, [record(2, false, true), record(2, true, true)]).E,
      "a revision 2 failure counts at the boundary of since",
    ).toEqual({
      verdict: "risk",
      min_coverage: 2,
      failures: [{ id: "E.labels", kind: "spec", text: "E.labels text", failed: 1, graded: 2 }],
      gaps: [],
    });
    const later = { E: [check("E.later", "spec", 3)] };
    expect(cellsOf(later, [{ revision: 2, results: { "E.later": false } }, { revision: 2, results: { "E.later": false } }]).E, "since 3 at revision 2").toEqual({
      verdict: "unproven",
      min_coverage: 0,
      failures: [],
      gaps: [{ id: "E.later", graded: 0 }],
    });
  });

  it("ignores a false value in a key that no check list holds (case 3)", () => {
    const checks = { A: [check("A.one", "spec"), check("A.two", "spec")] };
    const record = (extra: Json): Json => ({ revision: 2, results: { "A.one": true, "A.two": true, ...extra } });
    const noise = { "Z.unknown": false, "P.in-no-list": false, "A.not-listed": false, "A.one.extra": false, "a.one": false };
    expect(cellsOf(checks, [record(noise), record(noise)])).toEqual(cellsOf(checks, [record({}), record({})]));
    expect(cellsOf(checks, [record(noise), record(noise)]).A.verdict).toBe("safe");
  });

  it("keeps ADV, M, and X keys out of every cell, with the real check lists (case 4)", () => {
    const poison = { "ADV.useActionState": false, "ADV.useOptimistic": false, "M.closeout": false, "M.metadata-valid": false, "M.plan-complete": false, "X.anything": false };
    const records = [0, 1].map(() => ({ revision: 2, results: allPass(poison) }));
    const out = cellsOf(REGISTRY_CHECKS, records, 2);
    for (const d of DOMAINS) {
      expect(out[d], `domain ${d}`).toEqual({ verdict: "safe", min_coverage: 2, failures: [], gaps: [] });
    }
    for (const c of ALL_CHECKS) {
      expect(/^(ADV|M|X)\./.test(c.id), `registry check list holds no ${c.id}`).toBe(false);
    }
  });

  it("gives each hard failure the risk verdict and lists it first when it fails most (precedence)", () => {
    const checks = {
      G: [check("G.401", "spec"), check("P.validate-before-io", "performance"), check("P.malformed-json", "robustness")],
    };
    const records = [
      { revision: 2, results: { "G.401": true, "P.validate-before-io": false, "P.malformed-json": false } },
      { revision: 2, results: { "G.401": true, "P.validate-before-io": false, "P.malformed-json": true } },
      { revision: 2, results: { "G.401": false, "P.validate-before-io": false, "P.malformed-json": true } },
    ];
    const cell = cellsOf(checks, records, 2).G;
    expect(cell.verdict, "a performance failure never softens a hard failure").toBe("risk");
    expect((cell.failures as Json[]).map((f) => [f.id, f.kind, f.failed, f.graded])).toEqual([
      ["P.validate-before-io", "performance", 3, 3],
      ["G.401", "spec", 1, 3],
      ["P.malformed-json", "robustness", 1, 3],
    ]);
  });

  it("does not change its inputs and gives the same answer when called again (pure function)", () => {
    const rnd = mulberry32(0x5eed);
    const cases = [
      { checks: REGISTRY_CHECKS, records: [0, 1, 2].map((i) => ({ revision: 2, results: allPass(i === 0 ? { "G.401": false, "P.dedup-item": false } : {}) })), n_min: 2 },
      ...Array.from({ length: 40 }, () => genCase(rnd)),
    ];
    const code = [
      "import copy, json, sys",
      `sys.path.insert(0, ${JSON.stringify(HARNESS)})`,
      "import domain_trust",
      "out = []",
      "for case in json.load(sys.stdin):",
      "    before = copy.deepcopy(case)",
      "    first = domain_trust.domain_cells(case['checks'], case['records'], case['n_min'])",
      // The input check follows the first call. Two calls could undo a change.
      "    unchanged = case == before",
      "    second = domain_trust.domain_cells(case['checks'], case['records'], case['n_min'])",
      "    out.append({'unchanged': unchanged, 'same': first == second})",
      "print(json.dumps(out))",
    ].join("\n");
    const res = spawnSync("python3", ["-c", code], { encoding: "utf8", input: JSON.stringify(cases), maxBuffer: 64 * 1024 * 1024 });
    expect(res.status, `harness/domain_trust.py domain_cells failed: ${res.stderr}`).toBe(0);
    const out = JSON.parse(res.stdout) as Array<{ unchanged: boolean; same: boolean }>;
    expect(out.length, "each case ran").toBe(cases.length);
    expect(out.filter((o) => !o.unchanged).length, "cases whose input changed").toBe(0);
    expect(out.filter((o) => !o.same).length, "cases whose second answer differs").toBe(0);
  });

  it("imports only the standard library and no network or process module (NFR-1, NFR-5)", () => {
    const code = [
      "import ast, json, sys",
      "found = {}",
      "for path in sys.argv[1:]:",
      "    names = set()",
      "    for node in ast.walk(ast.parse(open(path, encoding='utf8').read())):",
      "        if isinstance(node, ast.Import):",
      "            names.update(a.name.split('.')[0] for a in node.names)",
      "        elif isinstance(node, ast.ImportFrom) and node.level == 0:",
      "            names.add((node.module or '').split('.')[0])",
      "    found[path] = sorted(names)",
      "print(json.dumps({'found': found, 'outside': {p: sorted(n for n in v if n not in sys.stdlib_module_names) for p, v in found.items()}}))",
    ].join("\n");
    const res = spawnSync("python3", ["-c", code, DOMAIN_TRUST_SRC, EXPORT_SCRIPT], { encoding: "utf8" });
    expect(res.status, `import scan failed: ${res.stderr}`).toBe(0);
    const scan = JSON.parse(res.stdout) as { found: Record<string, string[]>; outside: Record<string, string[]> };
    const forbidden = ["socket", "ssl", "http", "urllib", "ftplib", "smtplib", "xmlrpc", "asyncio", "subprocess", "requests", "httpx", "aiohttp"];
    for (const [path, names] of Object.entries(scan.found)) {
      expect(names.length, `${path} must import something`).toBeGreaterThan(0);
      expect(scan.outside[path], `${path} imports a module outside the standard library`).toEqual([]);
      expect(names.filter((n) => forbidden.includes(n)), `${path} imports a network or process module`).toEqual([]);
    }
  });

  it("matches an independent oracle on 300 seeded random cases and ignores the record order (property)", () => {
    const rnd = mulberry32(0xd0a1);
    const cases = Array.from({ length: 300 }, () => genCase(rnd));
    const reversed = cases.map((c) => ({ ...c, records: [...c.records].reverse() }));
    const actual = pyCells([...cases, ...reversed].map((c) => ({ checks: c.checks, records: c.records, n_min: c.n_min })));
    const mismatches: string[] = [];
    const histogram = new Map<string, number>();
    cases.forEach((c, i) => {
      const want = oracleCells(c.checks, c.records, c.n_min);
      for (const d of DOMAINS) histogram.set(String(want[d].verdict), (histogram.get(String(want[d].verdict)) ?? 0) + 1);
      for (const [label, got] of [["as given", actual[i]], ["reversed", actual[i + cases.length]]] as const) {
        for (const d of DOMAINS) {
          if (!isDeepStrictEqual((got as Record<string, Json>)[d], want[d])) {
            mismatches.push(`case ${i} ${label} domain ${d} n_min ${c.n_min}: got ${JSON.stringify((got as Record<string, Json>)[d])} want ${JSON.stringify(want[d])}`);
          }
        }
      }
    });
    expect(mismatches.slice(0, 3), `${mismatches.length} cells differ from the oracle`).toEqual([]);
    for (const verdict of VERDICTS) {
      expect(histogram.get(verdict) ?? 0, `the random cases must reach the verdict ${verdict}`).toBeGreaterThanOrEqual(30);
    }
  });
});

// ===========================================================================
// 2. The export: each check reaches its own cell
// ===========================================================================

describe("domain trust adversarial: each check reaches its own cell", () => {
  let root = "";
  let block: Json = {};
  const modelOf = (i: number) => `chk-${String(i).padStart(3, "0")}`;

  beforeAll(() => {
    const models = Object.fromEntries(ALL_CHECKS.map((_, i) => [modelOf(i), { name: `Check ${i}` }]));
    root = makeRoot(pricingOf(models));
    ALL_CHECKS.forEach((target, i) => {
      // Even models run under Pi and odd models under OpenCode. Both executors count.
      const executor = i % 2 ? "opencode" : "pi";
      writeRun(root, `a-${modelOf(i)}-2026w40-r1`, { executor, total: 80, results: allPass({ [target.id]: false }) });
      writeRun(root, `a-${modelOf(i)}-2026w40-r2`, { executor, total: 90, results: allPass() });
    });
    block = exportAll(root).block;
  });

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("lists the registry check lists with the registry kind and text, and no ADV, M, or X id (dropped probe)", () => {
    const checks = block.checks as Record<string, Json[]>;
    for (const d of DOMAINS) {
      const want = REGISTRY_CHECKS[d].map((c) => ({ id: c.id, kind: c.kind, text: c.text })).sort(byId);
      const got = [...checks[d]].map((c) => ({ id: c.id as string, kind: c.kind as string, text: c.text as string })).sort(byId);
      expect(got, `export checks of domain ${d}`).toEqual(want);
    }
    for (const c of ALL_CHECKS) {
      expect(c.text, `registry text of ${c.id} must exist`).not.toBe("");
      expect(c.text, `the text of ${c.id} must not fall back to its id`).not.toBe(c.id);
    }
    const probeIds = Object.keys(PROBES).sort();
    const listedProbes = DOMAINS.flatMap((d) => checks[d].filter((c) => c.kind !== "spec").map((c) => c.id as string)).sort();
    expect(listedProbes, "each probe of PROBES is listed once and no other probe").toEqual(probeIds);
  });

  it("puts a single failure of any check in its own cell and in no other cell (case 6)", () => {
    const rows = rowsOf(block);
    expect(rows.size, "one row for each model").toBe(ALL_CHECKS.length);
    const bad: string[] = [];
    ALL_CHECKS.forEach((target, i) => {
      const row = rows.get(modelOf(i));
      const cells = (row?.cells ?? {}) as Record<string, Json>;
      const runs = (row?.runs ?? {}) as Json;
      const wantRuns = i % 2 ? { total: 2, opencode: 2, pi: 0, arm_a: 2, arm_b: 0 } : { total: 2, opencode: 0, pi: 2, arm_a: 2, arm_b: 0 };
      for (const [key, value] of Object.entries(wantRuns)) {
        if (runs[key] !== value) bad.push(`${target.id}: runs.${key} is ${String(runs[key])}, want ${value}`);
      }
      for (const d of DOMAINS) {
        const want =
          d === target.domain
            ? {
                verdict: target.kind === "performance" ? "unoptimized" : "risk",
                min_coverage: 2,
                failures: [{ id: target.id, kind: target.kind, text: target.text, failed: 1, graded: 2 }],
                gaps: [],
              }
            : { verdict: "safe", min_coverage: 2, failures: [], gaps: [] };
        if (!isDeepStrictEqual(cells[d], want)) bad.push(`${target.id} in ${d}: got ${JSON.stringify(cells[d])}`);
      }
    });
    expect(bad.slice(0, 5), `${bad.length} cells are wrong`).toEqual([]);
  });

  it("keeps the rule invariants on the export of every check", () => {
    assertBlockInvariants(block, "per-check export");
  });

  it("shows each of these cells on the page with a word and one failure-list item", async () => {
    assertPageShowsBlock(await renderResults(block), block, "per-check export");
  });
});

// ===========================================================================
// 3. The export: evidence, order, and the since rule
// ===========================================================================

describe("domain trust adversarial: the export cannot lie about its evidence", () => {
  it("sorts rows by id, never by score, run count, catalog order, request volume, or name (case 5)", () => {
    const fixture: Record<string, { name: string; requests: number; score: number; runs: number }> = {
      "m-delta": { name: "Whisky", requests: 20000, score: 70, runs: 5 },
      "m-echo": { name: "Victor", requests: 50000, score: 85, runs: 4 },
      "m-bravo": { name: "Yodel", requests: 10000, score: 95, runs: 1 },
      "m-alpha": { name: "Zeta", requests: 30000, score: 80, runs: 3 },
      "m-charlie": { name: "Xray", requests: 40000, score: 60, runs: 2 },
    };
    const entries = Object.entries(fixture);
    const orderBy = (key: (e: (typeof entries)[number]) => number | string, desc: boolean) =>
      [...entries].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * (desc ? -1 : 1)).map(([id]) => id);
    const want = ["m-alpha", "m-bravo", "m-charlie", "m-delta", "m-echo"];
    const rival = {
      catalog: entries.map(([id]) => id),
      requests: orderBy((e) => e[1].requests, true),
      scoreDesc: orderBy((e) => e[1].score, true),
      scoreAsc: orderBy((e) => e[1].score, false),
      runsDesc: orderBy((e) => e[1].runs, true),
      runsAsc: orderBy((e) => e[1].runs, false),
      name: orderBy((e) => e[1].name, false),
      idDesc: [...want].reverse(),
    };
    for (const [label, order] of Object.entries(rival)) {
      expect(order, `the fixture order by ${label} must differ from the id order`).not.toEqual(want);
    }
    withRoot(makeRoot(pricingOf(Object.fromEntries(entries.map(([id, m]) => [id, { name: m.name, requests: m.requests }])))), (root) => {
      for (const [id, m] of entries) {
        for (let k = 1; k <= m.runs; k += 1) writeRun(root, `a-${id}-2026w40-r${k}`, { total: m.score, results: allPass() });
      }
      const { block } = exportAll(root);
      expect((block.models as Json[]).map((m) => m.id), "rows sort by id").toEqual(want);
      assertBlockInvariants(block, "order export");
    });
  });

  it("counts only valid records of catalog models with results, and adds no failure from the rest (case 7)", () => {
    const pricing = pricingOf({
      "trust-alpha": { name: "Trust Alpha" },
      "trust-ghost": { name: "Trust Ghost" },
      "trust-unbatched": { name: "Unbatched", batch: false },
      "trust-lowusage": { name: "Low usage", highUsage: false },
    });
    withRoot(makeRoot(pricing), (root) => {
      writeRun(root, "a-trust-alpha-2026w40-r1", { results: allPass() });
      writeRun(root, "a-trust-alpha-2026w40-r2", { results: allPass() });
      // Each run below would give risk in every domain if the export counted it.
      writeRun(root, "a-trust-alpha-2026w41-r1", { valid: false, results: allFail() });
      writeRun(root, "a-trust-alpha-2026w41-r2", { valid: "true", results: allFail() });
      writeRun(root, "a-trust-alpha-2026w41-r3", { valid: 1, results: allFail() });
      writeRun(root, "a-trust-alpha-2026w41-r4", { valid: null, results: allFail() });
      // A valid score with no usable results sits in an older week. The leaderboard reads only the newest week.
      writeRun(root, "a-trust-alpha-2026w39-r5", { results: undefined });
      writeRun(root, "a-trust-alpha-2026w39-r6", { rawResults: "{ not json" });
      writeRun(root, "a-trust-alpha-pro-2026w40-r1", { results: allFail() });
      writeRun(root, "a-trust-alpha-2026w40-extra", { results: allFail() });
      writeRun(root, "a-trust-alpha-2026w4-r1", { results: allFail() });
      writeRun(root, "a-trust-alpha-2026w401-r1", { results: allFail() });
      writeRun(root, "c-trust-alpha-2026w40-r1", { results: allFail() });
      writeRun(root, "bf-trust-alpha-2026w40-r1", { results: allFail() });
      writeRun(root, "tt-trust-alpha-2026w40-r1", { results: allFail() });
      writeRun(root, "ch-trust-alpha-2026w40-r1", { results: allFail() });
      // A catalog model with invalid runs only gets no row. A model outside the catalog gets none.
      writeRun(root, "a-trust-ghost-2026w40-r1", { valid: false, results: allFail() });
      writeRun(root, "a-trust-ghost-2026w40-r2", { results: undefined });
      writeRun(root, "a-trust-unbatched-2026w40-r1", { results: allFail() });
      writeRun(root, "a-trust-lowusage-2026w40-r1", { results: allFail() });
      writeRun(root, "a-trust-outside-2026w40-r1", { results: allFail() });
      const { block } = exportAll(root);
      const models = block.models as Json[];
      expect(models.map((m) => m.id), "only trust-alpha gets a row").toEqual(["trust-alpha"]);
      expect((models[0].runs as Json).run_ids, "only the two valid runs count").toEqual(["a-trust-alpha-2026w40-r1", "a-trust-alpha-2026w40-r2"]);
      for (const d of DOMAINS) {
        expect((models[0].cells as Record<string, Json>)[d], `domain ${d}`).toEqual({ verdict: "safe", min_coverage: 2, failures: [], gaps: [] });
      }
      assertBlockInvariants(block, "evidence export");
    });
  });

  it("counts every week, both arms, and both executors, with old run ids and with new ones", () => {
    withRoot(makeRoot(pricingOf({ "trust-alpha": { name: "Trust Alpha" } })), (root) => {
      writeRun(root, "a-trust-alpha-2026w37", { executor: "pi", revision: 1, total: 60, results: allPass({ "P.n-plus-one": false }) });
      writeRun(root, "a-trust-alpha-2026w43-r1", { results: allPass() });
      writeRun(root, "a-trust-alpha-2026w43-r2", { results: allPass() });
      writeRun(root, "b-trust-alpha-2026w38-r1", { executor: "pi", results: allPass() });
      writeRun(root, "b-trust-alpha-2026w43-r1", { results: allPass() });
      const { block } = exportAll(root);
      const row = rowsOf(block).get("trust-alpha") as Json;
      expect(row.runs, "run counts").toEqual({
        total: 5,
        opencode: 3,
        pi: 2,
        arm_a: 3,
        arm_b: 2,
        run_ids: [
          "a-trust-alpha-2026w37",
          "a-trust-alpha-2026w43-r1",
          "a-trust-alpha-2026w43-r2",
          "b-trust-alpha-2026w38-r1",
          "b-trust-alpha-2026w43-r1",
        ],
      });
      expect((row.cells as Record<string, Json>).C, "the failure of the week 37 Pi record counts").toEqual({
        verdict: "unoptimized",
        min_coverage: 5,
        failures: [
          { id: "P.n-plus-one", kind: "performance", text: registryText("P.n-plus-one"), failed: 1, graded: 5 },
        ],
        gaps: [],
      });
      assertBlockInvariants(block, "weeks export");
    });
  });

  it("applies the since rule to the matrix and to the domain block of ranked, history, and Skills entries (case 2)", () => {
    const catalog = pricingOf({
      "trust-alpha": { name: "Trust Alpha" },
      "trust-beta": { name: "Trust Beta", requests: 9000 },
      "trust-gamma": { name: "Trust Gamma", requests: 8000 },
    });
    withRoot(makeRoot(catalog), (root) => {
      const unstated = { "E.labels": false, "E.error-announced": false };
      // Revision 1 records state neither check. Both arms and both executors hold them as false.
      writeRun(root, "a-trust-alpha-2026w40-r1", { revision: 1, results: allPass(unstated) });
      writeRun(root, "b-trust-alpha-2026w40-r1", { revision: 1, results: allPass(unstated) });
      writeRun(root, "a-trust-beta-2026w40-r1", { revision: 1, executor: "pi", results: allPass(unstated) });
      writeRun(root, "b-trust-beta-2026w40-r1", { revision: 1, executor: "pi", results: allPass(unstated) });
      // A revision 2 record states both. Its false value is a failure, and the entry keeps it.
      writeRun(root, "a-trust-gamma-2026w40-r1", { revision: 2, total: 80, results: allPass({ "E.labels": false }) });
      writeRun(root, "a-trust-gamma-2026w40-r2", { revision: 2, total: 90, results: allPass() });
      const { payload, block } = exportAll(root);
      const rows = rowsOf(block);
      const unprovenE = {
        verdict: "unproven",
        min_coverage: 0,
        failures: [],
        gaps: [{ id: "E.error-announced", graded: 0 }, { id: "E.labels", graded: 0 }],
      };
      expect((rows.get("trust-alpha")?.cells as Record<string, Json>).E, "alpha, revision 1 records").toEqual(unprovenE);
      expect((rows.get("trust-beta")?.cells as Record<string, Json>).E, "beta, revision 1 Pi records").toEqual(unprovenE);
      expect((rows.get("trust-gamma")?.cells as Record<string, Json>).E, "gamma, revision 2 records").toEqual({
        verdict: "risk",
        min_coverage: 2,
        failures: [{ id: "E.labels", kind: "spec", text: registryText("E.labels"), failed: 1, graded: 2 }],
        gaps: [],
      });
      const entries: Array<[string, Json]> = [];
      for (const m of payload.models as Json[]) {
        for (const arm of ["no_skills", "skills"]) if (m[arm]) entries.push([`${String(m.id)} ${arm}`, m[arm] as Json]);
      }
      for (const m of (payload.history as Json).models as Json[]) {
        for (const arm of ["no_skills", "skills"]) if (m[arm]) entries.push([`${String(m.id)} history ${arm}`, m[arm] as Json]);
      }
      expect(entries.map(([label]) => label).sort(), "the export holds each ranked, history, and Skills entry").toEqual([
        "trust-alpha no_skills",
        "trust-alpha skills",
        "trust-beta history no_skills",
        "trust-beta history skills",
        "trust-gamma no_skills",
      ]);
      for (const [label, entry] of entries) {
        const domainE = ((entry.domains as Record<string, Json>).E ?? { failed: [], passed: [] }) as { failed: string[]; passed: string[] };
        const named = [...domainE.failed, ...domainE.passed].filter((id) => id === "E.labels" || id === "E.error-announced");
        if (label.startsWith("trust-gamma")) {
          expect(domainE.failed, `${label}: a revision 2 entry keeps the failed E.labels`).toContain("E.labels");
          expect(domainE.passed, `${label}: a revision 2 entry keeps the passed E.error-announced`).toContain("E.error-announced");
        } else {
          expect(named, `${label}: a revision 1 entry lists no unstated check`).toEqual([]);
        }
      }
    });
  });

  it("stamps the N_MIN that it used into the rule and into every cell", () => {
    const source = readFileSync(DOMAIN_TRUST_SRC, "utf8");
    expect(/^N_MIN = \d+$/m.test(source), "harness/domain_trust.py must define N_MIN on one line").toBe(true);
    for (const nMin of [1, 3]) {
      withRoot(makeRoot(pricingOf({ "trust-alpha": { name: "Trust Alpha" } })), (root) => {
        patchFile(root, "harness/domain_trust.py", /^N_MIN = \d+$/m, `N_MIN = ${nMin}`);
        writeRun(root, "a-trust-alpha-2026w40-r1", { results: allPass() });
        writeRun(root, "a-trust-alpha-2026w40-r2", { results: allPass() });
        const { block } = exportAll(root);
        expect((block.rule as Json).n_min, `rule.n_min at N_MIN ${nMin}`).toBe(nMin);
        const cells = (rowsOf(block).get("trust-alpha") as Json).cells as Record<string, Json>;
        for (const d of DOMAINS) {
          if (nMin === 1) {
            expect(cells[d], `domain ${d} at N_MIN 1`).toEqual({ verdict: "safe", min_coverage: 2, failures: [], gaps: [] });
          } else {
            expect(cells[d].verdict, `domain ${d} at N_MIN 3`).toBe("unproven");
            expect(cells[d].min_coverage, `domain ${d} coverage at N_MIN 3`).toBe(2);
            expect((cells[d].gaps as Json[]).map((g) => g.graded), `domain ${d} gaps at N_MIN 3`).toEqual(
              REGISTRY_CHECKS[d].map(() => 2),
            );
          }
        }
        assertBlockInvariants(block, `N_MIN ${nMin} export`);
      });
    }
  });

  it("keeps ADV, M, and unlisted keys out of every exported cell (cases 3 and 4)", () => {
    withRoot(makeRoot(pricingOf({ "trust-alpha": { name: "Trust Alpha" } })), (root) => {
      const noise = {
        "ADV.useActionState": false,
        "ADV.useOptimistic": false,
        "M.closeout": false,
        "M.metadata-valid": false,
        "M.plan-complete": false,
        "A.unlisted": false,
        "P.unmapped-probe": false,
        "Z.unlisted": false,
      };
      writeRun(root, "a-trust-alpha-2026w40-r1", { results: allPass(noise) });
      writeRun(root, "a-trust-alpha-2026w40-r2", { results: allPass(noise) });
      const { block } = exportAll(root);
      const cells = (rowsOf(block).get("trust-alpha") as Json).cells as Record<string, Json>;
      for (const d of DOMAINS) {
        expect(cells[d], `domain ${d}`).toEqual({ verdict: "safe", min_coverage: 2, failures: [], gaps: [] });
      }
      assertBlockInvariants(block, "noise export");
    });
  });

  it("gives the same block under two different clocks, so no time value enters the block (NFR-4)", () => {
    withRoot(makeRoot(pricingOf({ "trust-alpha": { name: "Trust Alpha" } })), (root) => {
      writeRun(root, "a-trust-alpha-2026w40-r1", { results: allPass({ "P.axe-clean": false }) });
      writeRun(root, "a-trust-alpha-2026w40-r2", { executor: "pi", results: allPass() });
      const script = join(root, "harness/export-site-data.py");
      const early = JSON.parse(runFrozen(root, script, "2000-01-01T00:00:00")["benchmark.json"]) as Json;
      const late = JSON.parse(runFrozen(root, script, "2031-12-31T23:59:59")["benchmark.json"]) as Json;
      expect(late.generated_at, "the two clocks differ").not.toBe(early.generated_at);
      expect(JSON.stringify(late.domain_trust), "the block does not depend on the clock").toBe(JSON.stringify(early.domain_trust));
    });
  });

  it("gives the same block for one set of records exported twice", () => {
    withRoot(makeRoot(pricingOf({ "trust-alpha": { name: "Trust Alpha" } })), (root) => {
      writeRun(root, "a-trust-alpha-2026w40-r1", { results: allPass({ "P.axe-clean": false }) });
      writeRun(root, "a-trust-alpha-2026w40-r2", { executor: "pi", results: allPass() });
      writeRun(root, "b-trust-alpha-2026w41-r1", { results: allPass({ "G.401": false }) });
      const first = exportAll(root).block;
      const second = exportAll(root).block;
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    });
  });
});

// ===========================================================================
// 4. The page
// ===========================================================================

const POISON = {
  name: '<img src=x onerror=alert(5)>" onmouseover="alert(6)',
  spec: "<img src=x onerror=alert(1)>",
  unmapped: "<script>alert(3)</script>",
  catches: "<svg onload=alert(4)>",
  id: "A.<img src=x onerror=alert(2)>",
};

function craftedBlock(nMin: number): Json {
  const safe = { verdict: "safe", min_coverage: 2, failures: [], gaps: [] };
  const listed = (id: string, kind: string, text: string) => ({ id, kind, text });
  const failure = (id: string, kind: string, text: string, failed: number, graded: number) => ({ id, kind, text, failed, graded });
  const models = ["gamma-one", "alpha-two"].map((id, index) => ({
    id,
    name: `Model ${id}`,
    runs: { total: 2 + index, opencode: 1, pi: 1 + index, arm_a: 1, arm_b: 1 + index, run_ids: [`a-${id}-2026w40`, `b-${id}-2026w40`] },
    cells: {
      A: safe,
      B: safe,
      C: {
        verdict: "unproven",
        min_coverage: 0,
        failures: [failure("P.n-plus-one", "performance", "per-row query inside the list render", 1, 1)],
        gaps: [
          { id: "C.empty", graded: 0 },
          { id: "C.renders", graded: 1 },
          { id: "P.n-plus-one", graded: 1 },
        ],
      },
      D: {
        verdict: "unoptimized",
        min_coverage: 2,
        failures: [failure("P.dedup-item", "performance", "same record read twice in one request", 2, 2)],
        gaps: [],
      },
      E: safe,
      F: {
        verdict: "risk",
        min_coverage: 2,
        failures: [
          failure("F.auth-checkout", "spec", "checkout needs the staff key", 3, 3),
          failure("P.action-race", "robustness", "two checkout actions at the same time", 1, 3),
        ],
        gaps: [],
      },
      G: safe,
      H: safe,
    },
  }));
  return {
    schema: 1,
    rule: { n_min: nMin, verdicts: VERDICTS, kinds: { spec: "s", robustness: "r", performance: "p" } },
    checks: {
      A: [],
      B: [],
      C: [
        listed("C.empty", "spec", "empty catalogue result"),
        listed("C.renders", "spec", "Items heading"),
        listed("P.n-plus-one", "performance", "per-row query inside the list render"),
      ],
      D: [listed("P.dedup-item", "performance", "same record read twice in one request")],
      E: [],
      F: [
        listed("F.auth-checkout", "spec", "checkout needs the staff key"),
        listed("P.action-race", "robustness", "two checkout actions at the same time"),
      ],
      G: [],
      H: [],
    },
    models,
  };
}

describe("domain trust adversarial: the page cannot lie", () => {
  it("renders the rule paragraph, its limit on safe, and a link that reaches the methodology section", async () => {
    const page = await renderResults(craftedBlock(2));
    const text = plain(page.main);
    expect(text, "the section says what safe means").toContain("no failure in the checks that ran");
    expect(page.main, "the section links to the methodology section").toContain('href="./methodology.html#domain-trust"');
    expect(/<section\b[^>]*\bid="domain-trust"/.test(readFileSync(METHODOLOGY_HTML, "utf8")), "methodology.html holds the section that the link names").toBe(true);
  });

  it("labels a graded check below N_MIN as graded N of M needed, never as not graded (A-P3-2)", async () => {
    for (const nMin of [2, 3]) {
      const page = await renderResults(craftedBlock(nMin));
      const items = listItems(page.failures).map(plain);
      expect(items.length, `two models give six items at N_MIN ${nMin}`).toBe(6);
      for (const item of items) expect(item, "no item calls a check not graded").not.toMatch(/not graded/i);
      const c = items[0];
      expect(c, "C line starts with the model and the verdict").toMatch(/^Model gamma-one — C unproven/);
      expect(c, "the failed probe shows its coverage and its failure count").toMatch(
        new RegExp(`P\\.n-plus-one[^·]*performance[^·]*per-row query inside the list render[^·]*graded 1 of ${nMin} needed[^·]*failed 1`),
      );
      expect(c, "a gap with one graded result").toMatch(new RegExp(`C\\.renders[^,]*spec[^,]*Items heading[^,]*graded 1 of ${nMin} needed`));
      expect(c, "a gap with no graded result").toMatch(new RegExp(`C\\.empty[^,]*spec[^,]*empty catalogue result[^,]*graded 0 of ${nMin} needed`));
      expect(items[1], "D line").toMatch(new RegExp(`D Safe, not optimized.*P\\.dedup-item[^·]*graded 2 of ${nMin} needed[^·]*failed 2`));
      expect(items[2], "F line names both failures with kind and meaning").toMatch(
        new RegExp(
          `F risk.*F\\.auth-checkout[^,]*spec[^,]*checkout needs the staff key[^,]*graded 3 of ${nMin} needed[^,]*failed 3.*P\\.action-race[^,]*robustness[^,]*two checkout actions at the same time[^,]*graded 3 of ${nMin} needed[^,]*failed 1`,
        ),
      );
    }
  });

  it("shows each verdict as a word, keeps the export row order, and lists each cell that is not safe once", async () => {
    const block = craftedBlock(2);
    assertPageShowsBlock(await renderResults(block), block, "crafted block");
    // The crafted rows run gamma before alpha. A page that sorts by name would swap them.
    expect(rowNames((await renderResults(block)).table)).toEqual(["Model gamma-one", "Model alpha-two"]);
  });

  it("shows HTML in a model name, a check text, and a check id as text (case 8)", async () => {
    // The poison enters through the places that feed the page: the registry files and the catalog.
    const exportBlock = (poison: boolean): Json =>
      withRoot(makeRoot(pricingOf({ "trust-alpha": { name: poison ? POISON.name : "Trust Alpha" } })), (root) => {
        if (poison) {
          patchFile(root, "harness/tests/spec-matrix.ts", /spec:\s*"[^"]*"(,\s*primary:\s*"A\.returned")/, (_m, tail) => `spec: "${POISON.spec}"${tail}`);
          patchFile(root, "harness/tests/meta/spec-matrix-contract.ts", /"F\.auth-return":\s*"[^"]*"/, `"F.auth-return": "${POISON.unmapped}"`);
          patchFile(root, "harness/tests/criteria.ts", /("P\.no-key-leak":\s*\{\s*tier:\s*\d+,\s*catches:\s*)"[^"]*"/, (_m, head) => `${head}"${POISON.catches}"`);
          patchFile(root, "harness/tests/criteria.ts", /(export const CRITERIA[^\n]*=\s*\{\n)/, (_m, head) => `${head}  "${POISON.id}": { tier: 1, spec: "A" },\n`);
        }
        const failing = { "A.returned": false, "F.auth-return": false, "P.no-key-leak": false, ...(poison ? { [POISON.id]: false } : {}) };
        writeRun(root, "a-trust-alpha-2026w40-r1", { results: allPass(failing) });
        writeRun(root, "a-trust-alpha-2026w40-r2", { results: allPass(failing) });
        return exportAll(root).block;
      });
    const benignBlock = exportBlock(false);
    const poisonBlock = exportBlock(true);
    const poisoned = JSON.stringify(poisonBlock);
    for (const fragment of [POISON.spec, POISON.unmapped, POISON.catches, POISON.id]) {
      expect(poisoned.includes(JSON.stringify(fragment).slice(1, -1)), `the export must carry the poison ${fragment} to the page`).toBe(true);
    }
    const benign = await renderResults(benignBlock);
    const page = await renderResults(poisonBlock);
    for (const [label, html] of [["table", page.table], ["failure list", page.failures]] as const) {
      expect(/<(img|script|svg)\b/i.test(html), `the ${label} holds no injected element`).toBe(false);
      expect(/<[^>]*\son[a-z]+\s*=/i.test(html), `the ${label} holds no event handler in a tag`).toBe(false);
    }
    expect(tagNames(page.table), "the table keeps the element sequence of the benign page").toEqual(tagNames(benign.table));
    expect(tagNames(page.failures), "the failure list keeps the element sequence of the benign page").toEqual(tagNames(benign.failures));
    expect(page.failures, "a check text shows as text").toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(page.failures, "a split check text shows as text").toContain("&lt;script&gt;alert(3)&lt;/script&gt;");
    expect(page.failures, "a probe text shows as text").toContain("&lt;svg onload=alert(4)&gt;");
    expect(page.failures, "a check id shows as text").toContain("A.&lt;img src=x onerror=alert(2)&gt;");
    expect(page.table, "a model name shows as text").toContain("&lt;img src=x onerror=alert(5)&gt;&quot; onmouseover=&quot;alert(6)");
    expect(page.failures, "a model name shows as text in the list").toContain("&lt;img src=x onerror=alert(5)&gt;&quot; onmouseover=&quot;alert(6)");
  });
});

// ===========================================================================
// 5. Review A regressions
// ===========================================================================

describe("domain trust adversarial: Review A regressions", () => {
  const pricing = pricingOf({ "trust-alpha": { name: "Trust Alpha" } });
  const seedRuns = (root: string): void => {
    writeRun(root, "a-trust-alpha-2026w40-r1", { results: allPass() });
    writeRun(root, "a-trust-alpha-2026w40-r2", { results: allPass() });
  };
  const message = (res: Run): string => `${res.stderr}${res.stdout}`;

  it("A-P3-8: a full harness without domain_trust.py exits non-zero, names it, and leaves each output unchanged", () => {
    withRoot(makeRoot(pricing, { companion: false }), (root) => {
      seedRuns(root);
      const seeded = seedOutputs(root);
      const res = runExport(root);
      expect(res.status, message(res)).toBeGreaterThan(0);
      expect(message(res), "the error names the missing companion").toContain("domain_trust.py");
      expect(readOutputs(root), "each output keeps its bytes").toEqual(seeded);
    });
  });

  it("A-P3-8: a full harness without domain_trust.py writes no file when no output existed", () => {
    withRoot(makeRoot(pricing, { companion: false }), (root) => {
      seedRuns(root);
      const res = runExport(root);
      expect(res.status, message(res)).toBeGreaterThan(0);
      expect(readOutputs(root), "no output appears").toEqual({ "benchmark.json": null, "tracks.json": null, "bugfix.json": null });
    });
  });

  const brokenCompanions: Array<[string, string, boolean]> = [
    ["a syntax error", "def broken(:\n", true],
    ["a merge conflict marker", "<<<<<<< HEAD\nN_MIN = 2\n=======\nN_MIN = 3\n>>>>>>> branch\n", true],
    ["an error at import", "raise RuntimeError('boom')\n", true],
    ["a missing dependency", "import a_module_that_does_not_exist\n", true],
    ["an empty file", "", false],
    ["a module without build_checks", "def criterion_since():\n    return {}\n", false],
  ];
  it.each(brokenCompanions)("A-P3-8: a full harness with %s in domain_trust.py exits non-zero and leaves each output unchanged", (_label, source, names) => {
    withRoot(makeRoot(pricing), (root) => {
      seedRuns(root);
      writeFileSync(join(root, "harness/domain_trust.py"), source);
      const seeded = seedOutputs(root);
      const res = runExport(root);
      expect(res.status, message(res)).toBeGreaterThan(0);
      expect(message(res), "the error names the companion").toContain(names ? "domain_trust.py" : "domain_trust");
      expect(readOutputs(root), "each output keeps its bytes").toEqual(seeded);
    });
  });

  it("A-P3-1: a partial workspace gives the same bytes as the base exporter and holds no domain_trust block", () => {
    const base = spawnSync("git", ["-C", REPO, "show", `${TRACK_BASE}:harness/export-site-data.py`], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    expect(base.status, `the base exporter must be readable at ${TRACK_BASE}: ${base.stderr}`).toBe(0);
    const catalog = pricingOf({ "trust-alpha": { name: "Trust Alpha" }, "trust-beta": { name: "Trust Beta", requests: 9000 } });
    const seed = (root: string): void => {
      // A revision 1 record with false unstated checks keeps its false failures in the legacy export.
      writeRun(root, "a-trust-alpha-2026w40-r1", { revision: 1, executor: "pi", results: allPass({ "E.labels": false, "P.axe-clean": false }) });
      writeRun(root, "a-trust-alpha-2026w41-r1", { revision: 2, results: allPass() });
      writeRun(root, "b-trust-beta-2026w41-r1", { revision: 2, total: 88, results: allPass({ "G.401": false }) });
    };
    const baseOutputs = withRoot(makePartialRoot(catalog), (root) => {
      writeFileSync(join(root, "harness/export-site-data.py"), base.stdout);
      seed(root);
      return runFrozen(root, join(root, "harness/export-site-data.py"));
    });
    const partialOutputs = withRoot(makePartialRoot(catalog), (root) => {
      seed(root);
      return runFrozen(root, join(root, "harness/export-site-data.py"));
    });
    expect("domain_trust" in JSON.parse(partialOutputs["benchmark.json"]), "the partial export holds no domain_trust block").toBe(false);
    for (const name of OUTPUTS) expect(partialOutputs[name], `${name} keeps every byte of the base export`).toBe(baseOutputs[name]);
  });

  it("A-P3-1: a partial workspace equals the full export without its block when the since rule has no effect", () => {
    const catalog = pricingOf({ "trust-alpha": { name: "Trust Alpha" }, "trust-beta": { name: "Trust Beta", requests: 9000 } });
    const seed = (root: string): void => {
      writeRun(root, "a-trust-alpha-2026w40-r1", { executor: "pi", results: allPass({ "E.labels": false, "P.axe-clean": false }) });
      writeRun(root, "b-trust-alpha-2026w41-r1", { results: allPass() });
      writeRun(root, "a-trust-beta-2026w41-r1", { total: 88, results: allPass({ "G.401": false }) });
    };
    const partial = withRoot(makePartialRoot(catalog), (root) => {
      seed(root);
      return runFrozen(root, join(root, "harness/export-site-data.py"));
    });
    const full = withRoot(makeRoot(catalog), (root) => {
      seed(root);
      return runFrozen(root, join(root, "harness/export-site-data.py"));
    });
    const fullPayload = JSON.parse(full["benchmark.json"]) as Json;
    expect("domain_trust" in fullPayload, "the full export holds the block").toBe(true);
    delete fullPayload.domain_trust;
    expect(JSON.parse(partial["benchmark.json"]), "the partial export differs from the full export by the block only").toEqual(fullPayload);
    expect(partial["tracks.json"], "tracks.json").toBe(full["tracks.json"]);
    expect(partial["bugfix.json"], "bugfix.json").toBe(full["bugfix.json"]);
  });

  it("A-P3-8: the full-harness marker is harness/generate-model-pages.py and no lookalike", () => {
    withRoot(makePartialRoot(pricing), (root) => {
      seedRuns(root);
      writeFileSync(join(root, "harness/generate-model-pages.py"), "");
      const seeded = seedOutputs(root);
      const res = runExport(root);
      expect(res.status, "the marker alone makes a partial workspace fail closed").toBeGreaterThan(0);
      expect(message(res)).toContain("domain_trust.py");
      expect(readOutputs(root)).toEqual(seeded);
    });
    withRoot(makePartialRoot(pricing), (root) => {
      seedRuns(root);
      for (const name of ["weekly.sh", "cron-weekly.sh", "cron-daily.sh", "generate-model-pages.py.bak", "generate_model_pages.py", "export-site-data.py.orig"]) {
        writeFileSync(join(root, "harness", name), "");
      }
      mkdirSync(join(root, "docs"), { recursive: true });
      writeFileSync(join(root, "docs/generate-model-pages.py"), "");
      writeFileSync(join(root, "generate-model-pages.py"), "");
      const res = runExport(root);
      expect(res.status, `a lookalike is no marker: ${message(res)}`).toBe(0);
      expect("domain_trust" in readJsonFile(join(root, "docs/assets/data/benchmark.json"))).toBe(false);
    });
  });

  it("A-P3-8: the marker and the companion load from the exporter's own directory, not the working directory", () => {
    const elsewhere = mkdtempSync(join(tmpdir(), "domain-trust-cwd-"));
    try {
      mkdirSync(join(elsewhere, "harness"));
      writeFileSync(join(elsewhere, "harness/generate-model-pages.py"), "");
      withRoot(makePartialRoot(pricing), (root) => {
        seedRuns(root);
        const res = runExport(root, elsewhere);
        expect(res.status, `a marker under the working directory is no marker: ${message(res)}`).toBe(0);
        expect("domain_trust" in readJsonFile(join(root, "docs/assets/data/benchmark.json"))).toBe(false);
      });
      withRoot(makeRoot(pricing, { companion: false }), (root) => {
        seedRuns(root);
        const res = runExport(root, tmpdir());
        expect(res.status, "a full harness run from another directory still fails closed").toBeGreaterThan(0);
        expect(message(res)).toContain("domain_trust.py");
      });
      withRoot(makeRoot(pricing), (root) => {
        seedRuns(root);
        const res = runExport(root, tmpdir());
        expect(res.status, `a full harness run from another directory still exports: ${message(res)}`).toBe(0);
        expect(readJsonFile(join(root, "docs/assets/data/benchmark.json")).domain_trust, "the block is present").toBeDefined();
      });
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  function importExporter(root: string): Run {
    const script = [
      "import importlib.util, json, sys",
      'spec = importlib.util.spec_from_file_location("export_site_data", sys.argv[1])',
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      'pricing = json.load(open(sys.argv[2], encoding="utf8"))',
      "print(json.dumps({'models': [m for m, _ in module.batch_models(pricing)], 'companion': module.domain_trust is not None}))",
    ].join("\n");
    return spawnSync("python3", ["-I", "-c", script, join(root, "harness/export-site-data.py"), join(root, "harness/go-pricing.json")], {
      cwd: tmpdir(),
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      encoding: "utf8",
    });
  }

  it("A-P3-1: an isolated importlib caller loads the exporter and its companion by path", () => {
    withRoot(makeRoot(pricing), (root) => {
      const res = importExporter(root);
      expect(res.status, `isolated import of a full harness: ${res.stderr}`).toBe(0);
      expect(JSON.parse(res.stdout.trim()), "the companion loads and the catalog reads").toEqual({ models: ["trust-alpha"], companion: true });
    });
    withRoot(makePartialRoot(pricing), (root) => {
      const res = importExporter(root);
      expect(res.status, `isolated import of a partial workspace: ${res.stderr}`).toBe(0);
      expect(JSON.parse(res.stdout.trim()), "the partial workspace loads with no companion").toEqual({ models: ["trust-alpha"], companion: false });
    });
    withRoot(makeRoot(pricing, { companion: false }), (root) => {
      const res = importExporter(root);
      expect(res.status, "an isolated import of a full harness without the companion fails closed").toBeGreaterThan(0);
      expect(`${res.stderr}${res.stdout}`).toContain("domain_trust.py");
    });
  });
});

// ===========================================================================
// 6. The published artifact
// ===========================================================================

describe("domain trust adversarial: the published artifact", () => {
  const published = readJsonFile(PUBLISHED);

  it("holds a block whose cells follow the published rule", () => {
    expect(published.domain_trust, "docs/assets/data/benchmark.json must hold domain_trust").toBeDefined();
    assertBlockInvariants(published.domain_trust as Json, "published block");
    expect(((published.domain_trust as Json).rule as Json).n_min, "the published threshold is the O1 answer of the preview").toBe(PREVIEW.n_min);
  });

  it("lists no unstated check in the domain block of any entry with fixture revision 1", () => {
    const entries: Array<[string, Json]> = [];
    for (const m of (published.models as Json[]) ?? []) {
      for (const arm of ["no_skills", "skills"]) if (m[arm]) entries.push([`${String(m.id)} ${arm}`, m[arm] as Json]);
    }
    for (const m of ((published.history as Json).models as Json[]) ?? []) {
      for (const arm of ["no_skills", "skills"]) if (m[arm]) entries.push([`${String(m.id)} history ${arm}`, m[arm] as Json]);
    }
    const revisionOne = entries.filter(([, e]) => ((e.fixture_revision as number | null) ?? 1) < 2);
    expect(revisionOne.length, "the published export must hold a revision 1 entry, or the check is empty").toBeGreaterThan(0);
    const stated = (Object.entries(CRITERIA) as Array<[string, { since?: number }]>).filter(([, c]) => (c.since ?? 1) > 1).map(([id]) => id);
    expect(stated.length, "the registry must hold an unstated check").toBeGreaterThan(0);
    for (const [label, entry] of revisionOne) {
      const named = Object.values(entry.domains as Record<string, { failed?: string[]; passed?: string[] }>)
        .flatMap((b) => [...(b.failed ?? []), ...(b.passed ?? [])])
        .filter((id) => stated.includes(id));
      expect(named, `${label} is a revision 1 entry`).toEqual([]);
    }
  });

  it("shows the published block on the real page with a word in each cell", async () => {
    const block = published.domain_trust as Json;
    assertPageShowsBlock(await renderResults(block), block, "published block");
  });

  it("names each probe of the live map in the methodology table, with its domain and kind, and no other probe", () => {
    const map = spawnSync(
      "python3",
      ["-c", `import sys, json; sys.path.insert(0, ${JSON.stringify(HARNESS)}); import domain_trust; print(json.dumps(domain_trust.PROBE_MAP))`],
      { encoding: "utf8" },
    );
    expect(map.status, `harness/domain_trust.py PROBE_MAP: ${map.stderr}`).toBe(0);
    const live = JSON.parse(map.stdout) as Record<string, { domain: string; kind: string }>;
    const page = readFileSync(METHODOLOGY_HTML, "utf8");
    const section = /<section\b[^>]*\bid="domain-trust"[^>]*>([\s\S]*?)<\/section>/.exec(page)?.[1] ?? "";
    const rows = [...section.matchAll(/<tr>\s*<td>(P\.[^<]+)<\/td>\s*<td>([A-H])<\/td>\s*<td>([a-z]+)<\/td>\s*<\/tr>/g)].map((m) => [m[1], m[2], m[3]]);
    expect(rows.map((r) => r[0]).sort(), "the methodology table names each live probe once").toEqual(Object.keys(live).sort());
    for (const [id, domain, kind] of rows) {
      expect({ domain, kind }, `methodology row of ${id}`).toEqual(live[id]);
    }
  });
});

// ===========================================================================
// 7. The guard tests catch drift (case 6)
// ===========================================================================

describe("domain trust adversarial: the FR-1 guard catches drift", () => {
  type Nested = { status: number | null; output: string };

  /** Run the unchanged FR-1 test file against a copy of the registry and the module that a mutation edits. */
  function runGuard(mutate: (tree: string) => void): Nested {
    const tree = mkdtempSync(join(tmpdir(), "domain-trust-mutant-"));
    try {
      for (const dir of ["harness/site-tests", "harness/tests/meta", "measure/tracks/domain_trust"]) mkdirSync(join(tree, dir), { recursive: true });
      cpSync(resolve(HARNESS, "site-tests/domain-trust.test.ts"), join(tree, "harness/site-tests/domain-trust.test.ts"));
      for (const rel of ["tests/criteria.ts", "tests/spec-matrix.ts", "tests/meta/spec-matrix-contract.ts", "domain_trust.py", "export-site-data.py", "vitest.config.ts", "package.json"]) {
        cpSync(resolve(HARNESS, rel), join(tree, "harness", rel));
      }
      cpSync(resolve(REPO, "measure/tracks/domain_trust/preview.json"), join(tree, "measure/tracks/domain_trust/preview.json"));
      symlinkSync(resolve(HARNESS, "node_modules"), join(tree, "harness/node_modules"), "dir");
      mutate(tree);
      // The child run must not inherit the worker state of this run.
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(VITEST|TEST$)/.test(key)));
      const res = spawnSync(process.execPath, [resolve(HARNESS, "node_modules/vitest/vitest.mjs"), "run", "site-tests/domain-trust.test.ts", "--maxWorkers=1"], {
        cwd: join(tree, "harness"),
        env: { ...env, RESULT_FILE: join(tree, "result.json"), NO_COLOR: "1", FORCE_COLOR: "0" },
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      return { status: res.status, output: `${res.stdout}\n${res.stderr}` };
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  }

  const edit = (tree: string, rel: string, from: string | RegExp, to: string | ((match: string, ...groups: string[]) => string)): void =>
    patchFile(tree, rel, from, to);

  it("passes on an unchanged copy, so a failure below comes from the mutation", () => {
    const control = runGuard(() => undefined);
    expect(control.status, control.output).toBe(0);
  }, 120_000);

  it("fails when a probe drops from PROBES and the map keeps it (case 6)", () => {
    const run = runGuard((tree) => edit(tree, "harness/tests/criteria.ts", /\n\s*"P\.dedup-item":[^\n]*\n/, "\n"));
    expect(run.status, "the FR-1 test must fail").not.toBe(0);
    expect(run.output).toContain("PROBE_MAP keys must equal PROBES keys");
  }, 120_000);

  it("fails when a probe joins PROBES and the map lacks it (case 6)", () => {
    const run = runGuard((tree) =>
      edit(tree, "harness/tests/criteria.ts", /export const PROBES[^\n]*=\s*\{\n/, (head) => `${head}  "P.new-scenario": { tier: 1, catches: "a new hidden defect" },\n`),
    );
    expect(run.status, "the FR-1 test must fail").not.toBe(0);
    expect(run.output).toContain("PROBE_MAP keys must equal PROBES keys");
  }, 120_000);

  it("fails when the module drops a probe from the map (case 6)", () => {
    const run = runGuard((tree) => edit(tree, "harness/domain_trust.py", /\n\s*"P\.axe-clean": \{[^\n]*\n/, "\n"));
    expect(run.status, "the FR-1 test must fail").not.toBe(0);
    expect(run.output).toContain("PROBE_MAP keys must equal PROBES keys");
  }, 120_000);

  it("fails when the module moves a probe to another domain, or flips its kind", () => {
    const moved = runGuard((tree) => edit(tree, "harness/domain_trust.py", '"P.axe-clean": {"domain": "B"', '"P.axe-clean": {"domain": "C"'));
    expect(moved.status, "a moved probe must fail the golden map").not.toBe(0);
    expect(moved.output).toContain("must equal preview probe_map");
    const flipped = runGuard((tree) => edit(tree, "harness/domain_trust.py", '"P.dedup-item": {"domain": "D", "kind": "performance"}', '"P.dedup-item": {"domain": "D", "kind": "robustness"}'));
    expect(flipped.status, "a flipped kind must fail the golden map").not.toBe(0);
    expect(flipped.output).toContain("must equal preview probe_map");
  }, 120_000);
});
