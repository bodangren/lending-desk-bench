// The board-aware pick order of Phase 7 (spec D23) and the pick list of
// task 7.1d (spec D26, rewritten from the high-use rule of task 7.1c).
//
// The cases use synthetic files in a temporary root. They invoke the
// TypeScript picker and the Python oracle directly. The oracle is the
// independent copy of the selection rule. It takes the board file as its 7th
// positional argument and the exclude list of D26 as its 8th. No case starts
// a model, a job, a network request, or a write outside the temporary root.
//
// D26 interface: the top-level `pick_min_requests_per_month`,
// `requests_source`, `requests_read`; per model `requests_per_month`,
// `requests_unlimited`, `page_order`, and `superseded_by`. A model at or
// under the limit or superseded is never picked.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const HARNESS = join(ROOT, "harness");
const ORACLE = join(ROOT, "measure/archive/daily_model_schedule/pick-oracle.py");
const REAL_PRICING = join(HARNESS, "go-pricing.json");
const TMP_ROOT = "/tmp/opencode";
const DATE = "2026-11-16";
const D23 = "D23 board-aware pick order";
const D26 = "D26 pick list";

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
  expect(FAILED, "daily pick board check counters").toBe(FAIL_COUNT > 0 ? 1 : 0);
});

type Fixture = {
  root: string; home: string; pricing: string; catalog: string; served: string;
  runs: string; days: string; board: string;
};
type PickResult = { status: number | null; stdout: string; stderr: string; error: string };

function fixture(): Fixture {
  mkdirSync(TMP_ROOT, { recursive: true });
  const root = mkdtempSync(join(TMP_ROOT, "daily-pick-board-"));
  const home = join(root, "home");
  const pricing = join(root, "pricing.json");
  const catalog = join(root, "catalog.json");
  const served = join(root, "served.txt");
  const runs = join(root, "runs");
  const days = join(root, "reports/daily");
  const board = join(root, "benchmark.json");
  for (const dir of [home, runs, days]) mkdirSync(dir, { recursive: true });

  writePricing({ root, home, pricing, catalog, served, runs, days, board } as Fixture,
    ["fresh-model", "history-model", "ranked-model"]);
  writeFileSync(catalog, JSON.stringify({ live: ["fresh-model", "history-model", "ranked-model"] }));
  writeFileSync(served, "opencode-go/fresh-model\nopencode-go/history-model\nopencode-go/ranked-model\n");
  writeBoard({ root, home, pricing, catalog, served, runs, days, board } as Fixture,
    ["ranked-model"], ["history-model"]);
  return { root, home, pricing, catalog, served, runs, days, board };
}

function writePricing(f: Fixture, ids: string[]): void {
  const requests: Record<string, number> = { "fresh-model": 100, "history-model": 200, "ranked-model": 300 };
  const models: Record<string, unknown> = {};
  ids.forEach((id, index) => {
    models[id] = { name: id, api: "openai-completions", batch: true,
      requests_per_month: requests[id] ?? 1, page_order: index + 1, monthly_usage_usd: 15,
      rates: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 } };
  });
  writeFileSync(f.pricing, JSON.stringify({
    schema: 1, source: "test", retrieved: "2026-11-15", provider: "opencode-go",
    pick_min_requests_per_month: 1, requests_source: "https://opencode.ai/docs/console/go/",
    requests_read: "2026-11-15", deepseek_rate: "off-peak", aliases: {},
    apis: { "openai-completions": { baseUrl: "https://example.invalid" } }, models,
  }));
}

// A price table in the D26 shape of task 7.1d. `rpm` is `requests_per_month`;
// `unlimited` sets `requests_unlimited: true`; `order` is `page_order`;
// `supersededBy` sets `superseded_by`.
type ListSpec = { id: string; rpm?: number; unlimited?: boolean; order?: number; supersededBy?: string };

function writeListPricing(f: Fixture, specs: ListSpec[]): void {
  const models: Record<string, unknown> = {};
  for (const spec of specs) {
    const entry: Record<string, unknown> = { name: spec.id, api: "openai-completions", batch: true,
      monthly_usage_usd: 15, rates: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 } };
    if (spec.unlimited) entry.requests_unlimited = true;
    else entry.requests_per_month = spec.rpm ?? 0;
    if (spec.order !== undefined) entry.page_order = spec.order;
    if (spec.supersededBy) entry.superseded_by = spec.supersededBy;
    models[spec.id] = entry;
  }
  writeFileSync(f.pricing, JSON.stringify({
    schema: 1, source: "test", retrieved: "2026-11-15", provider: "opencode-go",
    pick_min_requests_per_month: 10000, requests_source: "https://opencode.ai/docs/console/go/",
    requests_read: "2026-11-15", deepseek_rate: "off-peak", aliases: {},
    apis: { "openai-completions": { baseUrl: "https://example.invalid" } }, models,
  }));
}

function writeBoard(f: Fixture, ranked: string[], history: string[]): void {
  writeFileSync(f.board, JSON.stringify({
    schema: 1,
    models: ranked.map((id) => ({ id })),
    history: { models: history.map((id) => ({ id })) },
  }, null, 2) + "\n");
}

function writeLive(f: Fixture, ids: string[]): void {
  writeFileSync(f.catalog, JSON.stringify({ live: ids }));
  writeFileSync(f.served, ids.map((id) => `opencode-go/${id}`).join("\n") + "\n");
}

function baseEnv(f: Fixture): Record<string, string> {
  return { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: f.home, TSX_DISABLE_CACHE: "1" };
}

function runTs(f: Fixture, board: string | null, pricing: string = f.pricing, exclude: string[] = []): PickResult {
  const args = [
    join(HARNESS, "daily-pick.ts"), "--catalog", f.catalog, "--served", f.served,
    "--date", DATE, "--runs-root", f.runs, "--pricing", pricing, "--day-dir", f.days,
  ];
  if (board !== null) args.push("--board", board);
  if (exclude.length) args.push("--exclude", exclude.join(","));
  const r = spawnSync(join(HARNESS, "node_modules/.bin/tsx"), args, {
    cwd: HARNESS, env: baseEnv(f), encoding: "utf8", timeout: 20_000, maxBuffer: 4 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error?.message ?? "" };
}

function runOracle(f: Fixture, board: string | null, pricing: string = f.pricing, exclude: string[] = []): PickResult {
  const args = [f.catalog, f.served, pricing, f.runs, f.days, DATE];
  if (board !== null) args.push(board);
  // Without a board, an empty 7th argument keeps the exclude list in the 8th
  // slot. The oracle treats an empty board argument as no board.
  else if (exclude.length) args.push("");
  if (exclude.length) args.push(exclude.join(","));
  const r = spawnSync("python3", ["-I", ORACLE, ...args], {
    cwd: ROOT, env: baseEnv(f), encoding: "utf8", timeout: 20_000, maxBuffer: 4 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error?.message ?? "" };
}

function plantRun(f: Fixture, id: string, model: string, week: string): void {
  const artifacts = join(f.runs, id, "artifacts");
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(artifacts, "provenance.json"), JSON.stringify({
    executor: { kind: "opencode" }, model: `opencode-go/${model}`, arm: "a", track: "build",
  }));
}

// The TypeScript picker prints its labeled line to stderr (case P1 pins it
// there and pins stdout to the JSON). The oracle prints its line to stdout.
// Read each line from the pinned stream.
function labeled(result: PickResult, prefix: string, stream: "stdout" | "stderr" = "stdout"): string {
  return result[stream].split(/\r?\n/).find(line => line.startsWith(prefix)) ?? "";
}

describe("daily pick board order", () => {
  caseOf("P1 output without --board stays byte-for-byte unchanged", f => {
    const ts = runTs(f, null);
    expect(ts.error, `${D23}: the TypeScript picker must run`).toBe("");
    expect(ts.status, `${D23}: the TypeScript picker must keep its exit code\n${ts.stderr}`).toBe(0);
    expect(ts.stdout, `${D23}: the TypeScript stdout must stay unchanged`).toBe(
      '{"schema":1,"date":"2026-11-16","week":"2026w47","model":"ranked-model","reason":"untested","last_test":null,"counts":{"live":3,"candidates":3,"eligible":3,"untested":3},"excluded":{"unpriced":[],"gone":[],"unservable":[],"this_week":[]},"order":[{"model":"ranked-model","last_test":null,"requests_per_month":300},{"model":"history-model","last_test":null,"requests_per_month":200},{"model":"fresh-model","last_test":null,"requests_per_month":100}]}\n',
    );
    expect(ts.stderr, `${D23}: the TypeScript line must stay unchanged`).toBe(
      "DAILY_PICK date=2026-11-16 model=ranked-model reason=untested last_test=none candidates=3 eligible=3 untested=3\n",
    );
    const oracle = runOracle(f, null);
    expect(oracle.error, `${D23}: the oracle must run`).toBe("");
    expect(oracle.status, `${D23}: the oracle must keep its exit code\n${oracle.stderr}`).toBe(0);
    expect(oracle.stdout, `${D23}: the oracle stdout must stay unchanged`).toBe(
      "PICK_ORACLE date=2026-11-16 model=ranked-model reason=untested last_test=none candidates=3 eligible=3 untested=3\n",
    );
  });

  caseOf("P2 the TypeScript picker selects the first new model in the list order", f => {
    const result = runTs(f, f.board);
    expect(result.error, `${D23}: the TypeScript picker must run`).toBe("");
    expect(result.status, `${D23}: the TypeScript picker must accept --board\n${result.stderr}`).toBe(0);
    const output = JSON.parse(result.stdout) as { model: string; group: number; new: boolean };
    expect(output.model, `${D26}: the list order must pick the highest-count new model`).toBe("history-model");
    expect(output.group, `${D26}: the JSON must name group 2`).toBe(2);
    expect(output.new, `${D26}: a history model must be new`).toBe(true);
    expect(result.stderr, `${D23}: the DAILY_PICK line must end with the group fields`).toBe(
      "DAILY_PICK date=2026-11-16 model=history-model reason=untested last_test=none candidates=3 eligible=2 untested=2 group=2 new=yes\n",
    );
  });

  caseOf("P3 the Python oracle selects the first new model in the list order", f => {
    const result = runOracle(f, f.board);
    expect(result.error, `${D23}: measure/archive/daily_model_schedule/pick-oracle.py must run`).toBe("");
    expect(result.status, `${D23}: the oracle must accept the board argument\n${result.stderr}`).toBe(0);
    expect(result.stdout, `${D23}: the oracle line must end with the group fields`).toBe(
      "PICK_ORACLE date=2026-11-16 model=history-model reason=untested last_test=none candidates=3 eligible=2 untested=2 group=2 new=yes\n",
    );
  });

  caseOf("P4 the TypeScript and Python labeled lines stay equal", f => {
    const ts = runTs(f, f.board);
    const oracle = runOracle(f, f.board);
    expect(ts.status, `${D23}: the TypeScript picker must accept --board\n${ts.stderr}`).toBe(0);
    expect(oracle.status, `${D23}: the oracle must accept the board argument\n${oracle.stderr}`).toBe(0);
    const tsLine = labeled(ts, "DAILY_PICK ", "stderr");
    const oracleLine = labeled(oracle, "PICK_ORACLE ");
    expect(tsLine.replace(/^DAILY_PICK /, ""), `${D23}: both labeled lines must stay equal`).toBe(
      oracleLine.replace(/^PICK_ORACLE /, ""),
    );
  });

  caseOf("P5 a model on the board is never picked", f => {
    writeListPricing(f, [
      { id: "ranked-model", rpm: 999999, order: 1 },
      { id: "fresh-model", rpm: 20000, order: 2 },
    ]);
    writeLive(f, ["ranked-model", "fresh-model"]);
    writeBoard(f, ["ranked-model"], []);
    const ts = runTs(f, f.board);
    const oracle = runOracle(f, f.board);
    expect(ts.status, `${D26}: the TypeScript picker must accept the board case\n${ts.stderr}`).toBe(0);
    expect(oracle.status, `${D26}: the oracle must accept the board case\n${oracle.stderr}`).toBe(0);
    const output = JSON.parse(ts.stdout) as { model: string; group: number; new: boolean };
    expect(output.model, `${D26}: a board model must never be picked`).toBe("fresh-model");
    expect(output.group, `${D26}: the JSON must name group 1`).toBe(1);
    expect(output.new, `${D26}: group 1 must be new`).toBe(true);
    expect(labeled(ts, "DAILY_PICK ", "stderr").replace(/^DAILY_PICK /, ""), `${D26}: both lines must stay equal`)
      .toBe(labeled(oracle, "PICK_ORACLE ").replace(/^PICK_ORACLE /, ""));
  });

  caseOf("P6 no new model gives exit 3", f => {
    writeListPricing(f, [{ id: "ranked-model", rpm: 999999, order: 1 }]);
    writeLive(f, ["ranked-model"]);
    writeBoard(f, ["ranked-model"], []);
    const ts = runTs(f, f.board);
    const oracle = runOracle(f, f.board);
    expect(ts.status, `${D26}: a night with no new model must exit 3\n${ts.stderr}`).toBe(3);
    expect(oracle.status, `${D26}: the oracle must exit 3\n${oracle.stderr}`).toBe(3);
    const output = JSON.parse(ts.stdout) as { model: string | null };
    expect(output.model, `${D26}: the output must name no model`).toBeNull();
    expect(labeled(oracle, "PICK_ORACLE "), `${D26}: the oracle must name no model`).toContain("model=none");
  });

  caseOf("P7 a history model counts as new", f => {
    writeListPricing(f, [
      { id: "history-model", rpm: 40000, order: 1 },
      { id: "ranked-model", rpm: 999999, order: 2 },
    ]);
    writeLive(f, ["history-model", "ranked-model"]);
    writeBoard(f, ["ranked-model"], ["history-model"]);
    const ts = runTs(f, f.board);
    const oracle = runOracle(f, f.board);
    expect(ts.status, `${D26}: the TypeScript picker must accept the history case\n${ts.stderr}`).toBe(0);
    expect(oracle.status, `${D26}: the oracle must accept the history case\n${oracle.stderr}`).toBe(0);
    const output = JSON.parse(ts.stdout) as { model: string; group: number; new: boolean };
    expect(output.model, `${D26}: a history model must be picked`).toBe("history-model");
    expect(output.group, `${D26}: the JSON must name group 2`).toBe(2);
    expect(output.new, `${D26}: a history model must be new`).toBe(true);
    expect(labeled(ts, "DAILY_PICK ", "stderr").replace(/^DAILY_PICK /, ""), `${D26}: both lines must stay equal`)
      .toBe(labeled(oracle, "PICK_ORACLE ").replace(/^PICK_ORACLE /, ""));
  });

  caseOf("Q1 a model at or under 10,000 requests is never picked", f => {
    writeListPricing(f, [
      { id: "at-limit-model", rpm: 10000, order: 1 },
      { id: "under-limit-model", rpm: 5000, order: 2 },
    ]);
    writeLive(f, ["at-limit-model", "under-limit-model"]);
    const ts = runTs(f, null);
    const oracle = runOracle(f, null);
    expect(ts.status, `${D26}: a night with no on-list model must exit 3\n${ts.stderr}`).toBe(3);
    expect(oracle.status, `${D26}: the oracle must exit 3\n${oracle.stderr}`).toBe(3);
    const output = JSON.parse(ts.stdout) as { model: string | null };
    expect(output.model, `${D26}: a model at or under the limit must never be picked`).toBeNull();
    expect(labeled(oracle, "PICK_ORACLE "), `${D26}: the oracle must name no model`).toContain("model=none");
  });

  caseOf("Q2 a superseded model with the highest count is never picked", f => {
    writeListPricing(f, [
      { id: "old-version", rpm: 900000, order: 1, supersededBy: "new-version" },
      { id: "new-version", rpm: 20000, order: 2 },
      { id: "other-model", rpm: 30000, order: 3 },
    ]);
    writeLive(f, ["old-version", "new-version", "other-model"]);
    const ts = runTs(f, null);
    const oracle = runOracle(f, null);
    expect(ts.status, `${D26}: the TypeScript picker must keep its exit code\n${ts.stderr}`).toBe(0);
    expect(oracle.status, `${D26}: the oracle must keep its exit code\n${oracle.stderr}`).toBe(0);
    const output = JSON.parse(ts.stdout) as { model: string; order: Array<{ model: string }> };
    expect(output.model, `${D26}: a superseded model must never be picked`).toBe("other-model");
    expect(output.order.map((row) => row.model), `${D26}: the order must hold no superseded model`)
      .toEqual(["other-model", "new-version"]);
    expect(labeled(ts, "DAILY_PICK ", "stderr").replace(/^DAILY_PICK /, ""), `${D26}: both lines must stay equal`)
      .toBe(labeled(oracle, "PICK_ORACLE ").replace(/^PICK_ORACLE /, ""));
  });

  caseOf("Q3 the unlimited models come first", f => {
    writeListPricing(f, [
      { id: "unlimited-a", unlimited: true, order: 1 },
      { id: "unlimited-b", unlimited: true, order: 2 },
      { id: "counted-model", rpm: 999999, order: 3 },
    ]);
    writeLive(f, ["unlimited-a", "unlimited-b", "counted-model"]);
    const ts = runTs(f, null);
    const oracle = runOracle(f, null);
    expect(ts.status, `${D26}: the TypeScript picker must keep its exit code\n${ts.stderr}`).toBe(0);
    expect(oracle.status, `${D26}: the oracle must keep its exit code\n${oracle.stderr}`).toBe(0);
    const output = JSON.parse(ts.stdout) as { model: string; order: Array<{ model: string }> };
    expect(output.model, `${D26}: the first unlimited model must be picked`).toBe("unlimited-a");
    expect(output.order.map((row) => row.model), `${D26}: the unlimited models must come first`)
      .toEqual(["unlimited-a", "unlimited-b", "counted-model"]);
    expect(labeled(ts, "DAILY_PICK ", "stderr").replace(/^DAILY_PICK /, ""), `${D26}: both lines must stay equal`)
      .toBe(labeled(oracle, "PICK_ORACLE ").replace(/^PICK_ORACLE /, ""));
  });

  caseOf("Q4 equal counts keep the page row order", f => {
    writeListPricing(f, [
      { id: "row-x", rpm: 50000, order: 3 },
      { id: "row-y", rpm: 50000, order: 1 },
      { id: "row-z", rpm: 50000, order: 2 },
    ]);
    writeLive(f, ["row-x", "row-y", "row-z"]);
    const ts = runTs(f, null);
    const oracle = runOracle(f, null);
    expect(ts.status, `${D26}: the TypeScript picker must keep its exit code\n${ts.stderr}`).toBe(0);
    expect(oracle.status, `${D26}: the oracle must keep its exit code\n${oracle.stderr}`).toBe(0);
    const output = JSON.parse(ts.stdout) as { model: string; order: Array<{ model: string }> };
    expect(output.model, `${D26}: the lowest page_order must win the tie`).toBe("row-y");
    expect(output.order.map((row) => row.model), `${D26}: equal counts must keep the page row order`)
      .toEqual(["row-y", "row-z", "row-x"]);
    expect(labeled(ts, "DAILY_PICK ", "stderr").replace(/^DAILY_PICK /, ""), `${D26}: both lines must stay equal`)
      .toBe(labeled(oracle, "PICK_ORACLE ").replace(/^PICK_ORACLE /, ""));
  });

  caseOf("Q5 kimi-k2.7-code and hy4-preview are never picked", f => {
    writeLive(f, ["kimi-k2.7-code", "hy4-preview"]);
    const ts = runTs(f, null, REAL_PRICING);
    expect(ts.error, `${D26}: the TypeScript picker must run`).toBe("");
    expect(ts.status, `${D26}: a night with no on-list model must exit 3\n${ts.stderr}`).toBe(3);
    const output = JSON.parse(ts.stdout) as { model: string | null };
    expect(output.model, `${D26}: kimi-k2.7-code and hy4-preview must never be picked`).toBeNull();
    expect(ts.stdout, `${D26}: the output must not name kimi-k2.7-code`).not.toContain("kimi-k2.7-code");
    const oracle = runOracle(f, null, REAL_PRICING);
    expect(oracle.status, `${D26}: the oracle must exit 3\n${oracle.stderr}`).toBe(3);
    expect(labeled(oracle, "PICK_ORACLE "), `${D26}: the oracle must name no model`).toContain("model=none");
  });

  caseOf("Q6 the exclude flag keeps the tried models out", f => {
    writeListPricing(f, [
      { id: "alpha-model", rpm: 30000, order: 1 },
      { id: "beta-model", rpm: 20000, order: 2 },
    ]);
    writeLive(f, ["alpha-model", "beta-model"]);
    const ts = runTs(f, null, f.pricing, ["alpha-model"]);
    expect(ts.error, `${D26}: the TypeScript picker must run`).toBe("");
    expect(ts.status, `${D26}: the TypeScript picker must accept --exclude\n${ts.stderr}`).toBe(0);
    const output = JSON.parse(ts.stdout) as { model: string };
    expect(output.model, `${D26}: the excluded model must stay out of the pick`).toBe("beta-model");
    const oracle = runOracle(f, null, f.pricing, ["alpha-model"]);
    expect(oracle.status, `${D26}: the oracle must accept the exclude list\n${oracle.stderr}`).toBe(0);
    expect(labeled(oracle, "PICK_ORACLE "), `${D26}: the oracle must pick the same model`).toContain("model=beta-model");
    expect(labeled(ts, "DAILY_PICK ", "stderr").replace(/^DAILY_PICK /, ""), `${D26}: both lines must stay equal`)
      .toBe(labeled(oracle, "PICK_ORACLE ").replace(/^PICK_ORACLE /, ""));
  });
});
