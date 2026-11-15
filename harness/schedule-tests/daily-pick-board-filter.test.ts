// The board filter of the D26 picker (PM ruling 2026-11-16, task 7.9).
//
// Daniel's rule (2026-11-15): "pick candidates only from the OpenCode Go
// high-use list". The picker candidate set is the set of go-pricing models
// with `high_usage: true` and `batch: true` — the same filter as
// `batch_models` in `harness/export-site-data.py` — and then the existing
// D26 rules apply (request floor, latest family version only). A free or
// `requests_unlimited` model with `high_usage: false` is never picked.
//
// Two contracts:
//   F1 the picker never picks a free requests_unlimited model with
//      high_usage=false and batch=false, even when it would rank first.
//   F2 shared rule: every model the picker can return for the real
//      harness/go-pricing.json is in batch_models of export-site-data.py.
//
// Every case invokes the TypeScript picker on synthetic files in a temporary
// root with a temporary HOME. The F2 case loads `batch_models` from the real
// export script with python3 importlib; the module has a `__main__` guard, so
// the import runs no export and writes no file. No case starts a model, a
// fetch, a network request, a write under docs/, the real home, systemd, or
// the lock of the running unit.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const HARNESS = join(ROOT, "harness");
const REAL_PRICING = join(HARNESS, "go-pricing.json");
const EXPORT_SCRIPT = join(HARNESS, "export-site-data.py");
const TMP_ROOT = "/tmp/opencode";
const DATE = "2026-11-16";

let FAILED = 0;
let PASS_COUNT = 0;
let FAIL_COUNT = 0;
const RESULTS: string[] = [];
function pass(label: string) { PASS_COUNT++; RESULTS.push(`PASS: ${label}`); }
function fail(label: string, error: unknown) {
  FAILED = 1; FAIL_COUNT++;
  RESULTS.push(`FAIL: ${label}: ${error instanceof Error ? error.message : String(error)}`);
}

function caseOf(label: string, body: (f: Fixture) => void | Promise<void>, timeout = 30_000) {
  it(label, async () => {
    console.log(`=== ${label} ===`);
    const f = fixture();
    try { await body(f); pass(label); }
    catch (error) { fail(label, error); throw error; }
    finally { rmSync(f.root, { recursive: true, force: true }); }
  }, timeout);
}

afterAll(() => {
  for (const result of RESULTS) console.log(result);
  console.log(`=== Total: ${PASS_COUNT + FAIL_COUNT} checks (PASS=${PASS_COUNT}, FAIL=${FAIL_COUNT}) ===`);
  expect(FAILED, "daily pick board filter check counters").toBe(FAIL_COUNT > 0 ? 1 : 0);
});

type Fixture = { root: string; home: string; catalog: string; served: string; runs: string; days: string; board: string };
type PickResult = { status: number | null; stdout: string; stderr: string; error: string };

function fixture(): Fixture {
  mkdirSync(TMP_ROOT, { recursive: true });
  const root = mkdtempSync(join(TMP_ROOT, "daily-pick-board-filter-"));
  const home = join(root, "home");
  const catalog = join(root, "catalog.json");
  const served = join(root, "served.txt");
  const runs = join(root, "runs");
  const days = join(root, "reports/daily");
  const board = join(root, "benchmark.json");
  for (const dir of [home, runs, days]) mkdirSync(dir, { recursive: true });
  writeFileSync(board, JSON.stringify({ schema: 1, models: [], history: { models: [] } }, null, 2) + "\n");
  return { root, home, catalog, served, runs, days, board };
}

function baseEnv(f: Fixture): Record<string, string> {
  return { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: f.home, TSX_DISABLE_CACHE: "1" };
}

function runPicker(f: Fixture, pricing: string): PickResult {
  const args = [
    join(HARNESS, "daily-pick.ts"), "--catalog", f.catalog, "--served", f.served,
    "--date", DATE, "--runs-root", f.runs, "--pricing", pricing, "--day-dir", f.days,
    "--board", f.board,
  ];
  const r = spawnSync(join(HARNESS, "node_modules/.bin/tsx"), args, {
    cwd: HARNESS, env: baseEnv(f), encoding: "utf8", timeout: 20_000, maxBuffer: 4 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error?.message ?? "" };
}

/** The ids of `batch_models` from the real export script, loaded with importlib. */
function batchModels(f: Fixture): string[] {
  const script = [
    "import importlib.util, json, sys",
    `spec = importlib.util.spec_from_file_location("export_site_data", sys.argv[1])`,
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    'pricing = json.load(open(sys.argv[2], encoding="utf8"))',
    'print(json.dumps([mid for mid, _ in module.batch_models(pricing)]))',
  ].join("\n");
  const r = spawnSync("python3", ["-I", "-c", script, EXPORT_SCRIPT, REAL_PRICING], {
    cwd: ROOT, env: { PATH: "/usr/bin:/bin", HOME: f.home }, encoding: "utf8", timeout: 20_000,
  });
  if (r.status !== 0) throw new Error(`batch_models load failed (exit ${r.status}): ${r.stderr}`);
  return JSON.parse((r.stdout ?? "").trim()) as string[];
}

describe("daily pick board filter", () => {
  caseOf("F1 the picker never picks a free requests_unlimited model with high_usage=false and batch=false", f => {
    // The free model is unlimited, so the current list order ranks it first.
    const pricing = join(f.root, "pricing.json");
    writeFileSync(pricing, JSON.stringify({
      schema: 1, source: "test", retrieved: DATE, provider: "opencode-go",
      pick_min_requests_per_month: 10000,
      requests_source: "https://opencode.ai/docs/console/go/", requests_read: "2026-11-15",
      deepseek_rate: "off-peak", aliases: {},
      apis: { "openai-completions": { baseUrl: "https://example.invalid" } },
      models: {
        "free-model": { name: "free-model", api: "openai-completions",
          requests_unlimited: true, high_usage: false, batch: false, page_order: 1,
          monthly_usage_usd: 15, rates: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 } },
        "paid-model": { name: "paid-model", api: "openai-completions",
          requests_per_month: 50000, high_usage: true, batch: true, page_order: 2,
          monthly_usage_usd: 15, rates: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 } },
      },
    }));
    writeFileSync(f.catalog, JSON.stringify({ live: ["free-model", "paid-model"] }));
    writeFileSync(f.served, "opencode-go/free-model\nopencode-go/paid-model\n");
    const r = runPicker(f, pricing);
    expect(r.error, "the TypeScript picker must run").toBe("");
    expect(r.status, `the pick must succeed\n${r.stderr}`).toBe(0);
    const output = JSON.parse(r.stdout) as { model: string; order: Array<{ model: string }> };
    expect(output.model, `D26 board filter (PM 2026-11-16): a free high_usage=false batch=false model must never be picked, got ${output.model}`).toBe("paid-model");
    expect(output.order.map((row) => row.model), `D26 board filter: the free model must stay out of the candidate set`)
      .toEqual(["paid-model"]);
  });

  caseOf("F2 shared rule: every model the picker can return for the real go-pricing.json is in batch_models of export-site-data.py", f => {
    const shared = batchModels(f);
    expect(shared.length, "batch_models of export-site-data.py must return a non-empty list").toBeGreaterThan(0);
    const pricing = JSON.parse(readFileSync(REAL_PRICING, "utf8")) as { models: Record<string, unknown> };
    const ids = Object.keys(pricing.models);
    writeFileSync(f.catalog, JSON.stringify({ live: ids }));
    writeFileSync(f.served, ids.map((id) => `opencode-go/${id}`).join("\n") + "\n");
    const r = runPicker(f, REAL_PRICING);
    expect(r.error, "the TypeScript picker must run").toBe("");
    expect(r.status, `the pick must succeed on the real table\n${r.stderr}`).toBe(0);
    const output = JSON.parse(r.stdout) as { model: string | null; order: Array<{ model: string }> };
    const returned = output.order.map((row) => row.model);
    // The order must be non-empty, or the subset check below passes on nothing.
    expect(returned.length, "the picker must return at least one candidate for the real table").toBeGreaterThan(0);
    const sharedSet = new Set(shared);
    const offenders = returned.filter((id) => !sharedSet.has(id));
    expect(offenders, `D26 board filter (PM 2026-11-16): every model the picker can return must be in batch_models of export-site-data.py; offenders: ${offenders.join(", ")}`)
      .toEqual([]);
    expect(output.model, "the pick itself must be in batch_models").not.toBeNull();
    expect(sharedSet.has(output.model as string), `the pick ${output.model} must be in batch_models of export-site-data.py`).toBe(true);
  });
});
