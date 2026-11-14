// The board-aware pick order of Phase 7 (spec D23).
//
// The cases use synthetic files in a temporary root. They invoke the
// TypeScript picker and the Python oracle directly. No case starts a model,
// a job, a network request, or a write outside the temporary root.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const HARNESS = join(ROOT, "harness");
const TMP_ROOT = "/tmp/opencode";
const DATE = "2026-11-16";
const D23 = "D23 board-aware pick order";

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

  writePricing({ root, pricing } as Fixture, ["fresh-model", "history-model", "ranked-model"]);
  writeFileSync(catalog, JSON.stringify({ live: ["fresh-model", "history-model", "ranked-model"] }));
  writeFileSync(served, "opencode-go/fresh-model\nopencode-go/history-model\nopencode-go/ranked-model\n");
  writeBoard({ root, board } as Fixture, ["ranked-model"], ["history-model"]);
  return { root, home, pricing, catalog, served, runs, days, board };
}

function writePricing(f: Fixture, ids: string[]): void {
  const requests: Record<string, number> = { "fresh-model": 100, "history-model": 200, "ranked-model": 300,
    "history-old": 50, "history-new": 10 };
  const models: Record<string, unknown> = {};
  for (const id of ids) {
    models[id] = { name: id, api: "openai-completions", high_usage: true, batch: true,
      requests_per_month: requests[id] ?? 1, monthly_usage_usd: 15,
      rates: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 } };
  }
  writeFileSync(f.pricing, JSON.stringify({
    schema: 1, source: "test", retrieved: "2026-11-14", provider: "opencode-go",
    high_usage_min_requests_per_month: 1, deepseek_rate: "off-peak", aliases: {},
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

function baseEnv(f: Fixture): Record<string, string> {
  return { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: f.home, TSX_DISABLE_CACHE: "1" };
}

function runTs(f: Fixture, board: string | null): PickResult {
  const args = [
    join(HARNESS, "daily-pick.ts"), "--catalog", f.catalog, "--served", f.served,
    "--date", DATE, "--runs-root", f.runs, "--pricing", f.pricing, "--day-dir", f.days,
  ];
  if (board !== null) args.push("--board", board);
  const r = spawnSync(join(HARNESS, "node_modules/.bin/tsx"), args, {
    cwd: HARNESS, env: baseEnv(f), encoding: "utf8", timeout: 20_000, maxBuffer: 4 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error?.message ?? "" };
}

function runOracle(f: Fixture, board: string | null): PickResult {
  const args = [];
  if (board !== null) args.push("--board", board);
  args.push(f.catalog, f.served, f.pricing, f.runs, f.days, DATE);
  const r = spawnSync("python3", ["-I", join(HARNESS, "pick-oracle.py"), ...args], {
    cwd: HARNESS, env: baseEnv(f), encoding: "utf8", timeout: 20_000, maxBuffer: 4 * 1024 * 1024,
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

function labeled(result: PickResult, prefix: string): string {
  return result.stdout.split(/\r?\n/).find(line => line.startsWith(prefix)) ?? "";
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
  });

  caseOf("P2 the TypeScript picker selects group 1 and marks it new", f => {
    const result = runTs(f, f.board);
    expect(result.error, `${D23}: the TypeScript picker must run`).toBe("");
    expect(result.status, `${D23}: the TypeScript picker must accept --board\n${result.stderr}`).toBe(0);
    const output = JSON.parse(result.stdout) as { model: string; group: number; new: boolean };
    expect(output.model, `${D23}: group 1 must come first`).toBe("fresh-model");
    expect(output.group, `${D23}: the JSON must name group 1`).toBe(1);
    expect(output.new, `${D23}: group 1 must be new`).toBe(true);
    expect(result.stderr, `${D23}: the DAILY_PICK line must end with the group fields`).toBe(
      "DAILY_PICK date=2026-11-16 model=fresh-model reason=untested last_test=none candidates=3 eligible=3 untested=3 group=1 new=yes\n",
    );
  });

  caseOf("P3 the Python oracle selects group 1 and marks it new", f => {
    const result = runOracle(f, f.board);
    expect(result.error, `${D23}: harness/pick-oracle.py must run`).toBe("");
    expect(result.status, `${D23}: the oracle must accept --board\n${result.stderr}`).toBe(0);
    expect(result.stdout, `${D23}: the oracle line must end with the group fields`).toBe(
      "PICK_ORACLE date=2026-11-16 model=fresh-model reason=untested last_test=none candidates=3 eligible=3 untested=3 group=1 new=yes\n",
    );
  });

  caseOf("P4 the TypeScript and Python labeled lines stay equal", f => {
    const ts = runTs(f, f.board);
    const oracle = runOracle(f, f.board);
    expect(ts.status, `${D23}: the TypeScript picker must accept --board\n${ts.stderr}`).toBe(0);
    expect(oracle.status, `${D23}: the oracle must accept --board\n${oracle.stderr}`).toBe(0);
    const tsLine = labeled(ts, "DAILY_PICK ");
    const oracleLine = labeled(oracle, "PICK_ORACLE ");
    expect(tsLine.replace(/^DAILY_PICK /, ""), `${D23}: both labeled lines must stay equal`).toBe(
      oracleLine.replace(/^PICK_ORACLE /, ""),
    );
  });

  caseOf("P5 group 2 wins before group 3 and remains new", f => {
    writeFileSync(f.catalog, JSON.stringify({ live: ["history-model", "ranked-model"] }));
    writeFileSync(f.served, "opencode-go/history-model\nopencode-go/ranked-model\n");
    writeBoard(f, ["ranked-model"], ["history-model"]);
    const ts = runTs(f, f.board);
    const oracle = runOracle(f, f.board);
    expect(ts.status, `${D23}: the TypeScript picker must accept the group 2 case\n${ts.stderr}`).toBe(0);
    expect(oracle.status, `${D23}: the oracle must accept the group 2 case\n${oracle.stderr}`).toBe(0);
    const output = JSON.parse(ts.stdout) as { model: string; group: number; new: boolean };
    expect(output.model, `${D23}: group 2 must win before group 3`).toBe("history-model");
    expect(output.group, `${D23}: the JSON must name group 2`).toBe(2);
    expect(output.new, `${D23}: group 2 must remain new`).toBe(true);
    expect(labeled(ts, "DAILY_PICK ").replace(/^DAILY_PICK /, ""), `${D23}: both lines must stay equal`)
      .toBe(labeled(oracle, "PICK_ORACLE ").replace(/^PICK_ORACLE /, ""));
  });

  caseOf("P6 group 3 is selected only when groups 1 and 2 are empty", f => {
    writeFileSync(f.catalog, JSON.stringify({ live: ["ranked-model"] }));
    writeFileSync(f.served, "opencode-go/ranked-model\n");
    writeBoard(f, ["ranked-model"], []);
    const ts = runTs(f, f.board);
    const oracle = runOracle(f, f.board);
    expect(ts.status, `${D23}: the TypeScript picker must accept the group 3 case\n${ts.stderr}`).toBe(0);
    expect(oracle.status, `${D23}: the oracle must accept the group 3 case\n${oracle.stderr}`).toBe(0);
    const output = JSON.parse(ts.stdout) as { model: string; group: number; new: boolean };
    expect(output.model, `${D23}: group 3 holds the ranked model`).toBe("ranked-model");
    expect(output.group, `${D23}: the JSON must name group 3`).toBe(3);
    expect(output.new, `${D23}: group 3 must not be new`).toBe(false);
    expect(labeled(ts, "DAILY_PICK ").replace(/^DAILY_PICK /, ""), `${D23}: both lines must stay equal`)
      .toBe(labeled(oracle, "PICK_ORACLE ").replace(/^PICK_ORACLE /, ""));
  });

  caseOf("P7 group 2 keeps the stalest rule", f => {
    writePricing(f, ["history-old", "history-new", "ranked-model"]);
    writeFileSync(f.catalog, JSON.stringify({ live: ["history-old", "history-new", "ranked-model"] }));
    writeFileSync(f.served, "opencode-go/history-old\nopencode-go/history-new\nopencode-go/ranked-model\n");
    writeBoard(f, ["ranked-model"], ["history-old", "history-new"]);
    plantRun(f, "a-history-old-2026w45-r1", "history-old", "2026w45");
    plantRun(f, "a-history-new-2026w46-r1", "history-new", "2026w46");
    const ts = runTs(f, f.board);
    const oracle = runOracle(f, f.board);
    expect(ts.status, `${D23}: the TypeScript picker must accept the stalest case\n${ts.stderr}`).toBe(0);
    expect(oracle.status, `${D23}: the oracle must accept the stalest case\n${oracle.stderr}`).toBe(0);
    const output = JSON.parse(ts.stdout) as { model: string; group: number; new: boolean };
    expect(output.model, `${D23}: group 2 must keep the stalest order`).toBe("history-old");
    expect(output.group, `${D23}: the JSON must name group 2`).toBe(2);
    expect(output.new, `${D23}: group 2 must remain new`).toBe(true);
    expect(labeled(ts, "DAILY_PICK ").replace(/^DAILY_PICK /, ""), `${D23}: both lines must stay equal`)
      .toBe(labeled(oracle, "PICK_ORACLE ").replace(/^PICK_ORACLE /, ""));
  });
});
