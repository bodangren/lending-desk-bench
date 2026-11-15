// The real-data pick list of task 7.1d (spec D26, FR-22).
//
// The case reads the REAL `harness/go-pricing.json` and applies the D26
// on-list rule: a model is on the list when `requests_unlimited` is true or
// `requests_per_month` is more than `pick_min_requests_per_month`, and the
// model holds no `superseded_by`. The on-list set must equal the 13 models
// of EV32 in the EV32 order: unlimited first, then the counts highest
// first, with equal counts in `page_order` order. It fails on the stale
// table and passes after the Green data update of task 7.2.
//
// G3 applies the board filter of D26 (PM ruling 2026-11-16, task 7.9):
// against the public-board fixture the oracle picks the first high-use,
// batch, latest-version model with no board row, and never beam-free.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const HARNESS = join(ROOT, "harness");
const ORACLE = join(ROOT, "measure/tracks/daily_model_schedule/pick-oracle.py");
const PRICING = join(HARNESS, "go-pricing.json");
const TMP_ROOT = "/tmp/opencode";

const ON_LIST_IN_ORDER = [
  "beam-free", "iceman-contributor-free", "longcat-2.5-free",
  "muse-spark-1.3-contributor", "deepseek-v4.1-flash", "mimo-v2.6-flash",
  "glm-5.3-flash", "qwen3.8-flash", "gpt-6-luna", "minimax-m3.1-flash",
  "claude-haiku-5-5", "mimo-v2.6-pro", "hy4",
];
const SUPERSEDED = [
  "muse-spark-1.2-contributor", "mimo-v2.5", "mimo-v2.5-pro", "longcat-2.0",
  "qwen3.7-plus", "hy3", "gpt-5.6-luna", "minimax-m3",
];
const UNDER_LIMIT = ["kimi-k2.7-code", "hy4-preview"];
const BOARD_ON = [
  "deepseek-v4.1-flash", "mimo-v2.6-flash", "gpt-6-luna", "muse-spark-1.3-contributor",
  "minimax-m3.1-flash", "glm-5.3-flash", "claude-haiku-5-5",
];
// Under the board filter of D26 (PM 2026-11-16) these are the on-list models
// that are high_usage=true, batch=true, and have no board row: the oracle
// must pick the first of them in list order, never a free model.
const TO_RUN_OFF_BOARD = ["qwen3.8-flash", "mimo-v2.6-pro"];

let FAILED = 0;
let PASS_COUNT = 0;
let FAIL_COUNT = 0;
const RESULTS: string[] = [];
function pass(label: string) { PASS_COUNT++; RESULTS.push(`PASS: ${label}`); }
function fail(label: string, error: unknown) {
  FAILED = 1; FAIL_COUNT++;
  RESULTS.push(`FAIL: ${label}: ${error instanceof Error ? error.message : String(error)}`);
}

afterAll(() => {
  for (const result of RESULTS) console.log(result);
  console.log(`=== Total: ${PASS_COUNT + FAIL_COUNT} checks (PASS=${PASS_COUNT}, FAIL=${FAIL_COUNT}) ===`);
  expect(FAILED, "go pick list check counters").toBe(FAIL_COUNT > 0 ? 1 : 0);
});

function onList(pricing: Record<string, any>): string[] {
  const min = pricing.pick_min_requests_per_month;
  if (min !== 10000) throw new Error(`pick_min_requests_per_month must be 10000, got ${JSON.stringify(min)}`);
  if (pricing.requests_read !== "2026-11-15") {
    throw new Error(`requests_read must be "2026-11-15", got ${JSON.stringify(pricing.requests_read)}`);
  }
  if (pricing.requests_source !== "https://opencode.ai/docs/console/go/") {
    throw new Error(`requests_source must name the Go plan page, got ${JSON.stringify(pricing.requests_source)}`);
  }
  const models = pricing.models as Record<string, any>;
  const rows = Object.entries(models).filter(([, spec]) => {
    if (spec.superseded_by) return false;
    if (spec.requests_unlimited === true) return true;
    return typeof spec.requests_per_month === "number" && spec.requests_per_month > min;
  });
  rows.sort(([, a], [, b]) => {
    const au = a.requests_unlimited === true ? 0 : 1;
    const bu = b.requests_unlimited === true ? 0 : 1;
    if (au !== bu) return au - bu;
    if (au === 0) return (a.page_order ?? 0) - (b.page_order ?? 0);
    if ((b.requests_per_month ?? 0) !== (a.requests_per_month ?? 0)) {
      return (b.requests_per_month ?? 0) - (a.requests_per_month ?? 0);
    }
    return (a.page_order ?? 0) - (b.page_order ?? 0);
  });
  return rows.map(([id]) => id);
}

describe("go pick list", () => {
  it("computes the D26 on-list set from the real table", () => {
    console.log("=== G1 the on-list set equals the 13 models of EV32 in order ===");
    const root = mkdtempSync(join(TMP_ROOT, "go-pick-list-"));
    try {
      const pricing = JSON.parse(readFileSync(PRICING, "utf8"));
      const onListIds = onList(pricing);
      if (JSON.stringify(onListIds) !== JSON.stringify(ON_LIST_IN_ORDER)) {
        throw new Error(`on-list mismatch:\n  got:  ${onListIds.join(", ")}\n  want: ${ON_LIST_IN_ORDER.join(", ")}`);
      }
      pass("G1 the on-list set equals the 13 models of EV32 in order");

      console.log("=== G2 the superseded and under-limit models are off the list ===");
      for (const id of [...SUPERSEDED, ...UNDER_LIMIT]) {
        if (onListIds.includes(id)) throw new Error(`${id} must stay off the pick list`);
      }
      pass("G2 the superseded and under-limit models are off the list");

      console.log("=== G3 the oracle picks the first high-use batch model off the board, never beam-free ===");
      const catalog = join(root, "catalog.json");
      const served = join(root, "served.txt");
      const board = join(root, "benchmark.json");
      const runs = join(root, "runs");
      const days = join(root, "reports/daily");
      mkdirSync(runs, { recursive: true });
      mkdirSync(days, { recursive: true });
      writeFileSync(catalog, JSON.stringify({ live: ON_LIST_IN_ORDER }));
      writeFileSync(served, ON_LIST_IN_ORDER.map((id) => `opencode-go/${id}`).join("\n") + "\n");
      writeFileSync(board, JSON.stringify({
        schema: 1,
        models: BOARD_ON.map((id) => ({ id })),
        history: { models: [] },
      }, null, 2) + "\n");
      const r = spawnSync("python3", ["-I", ORACLE, catalog, served, PRICING, runs, days, "2026-11-16", board], {
        cwd: ROOT, encoding: "utf8", timeout: 20_000,
      });
      const line = (r.stdout ?? "").trim();
      if (r.status !== 0) throw new Error(`the oracle must exit 0, got ${r.status}: ${line}\n${r.stderr}`);
      if (!line.includes("model=qwen3.8-flash")) {
        throw new Error(`D26 board filter (PM 2026-11-16): the oracle must pick qwen3.8-flash, the first high-use batch model with no board row: ${line}`);
      }
      if (line.includes("beam-free")) {
        throw new Error(`D26 board filter (PM 2026-11-16): the oracle must never pick beam-free (high_usage=false, batch=false): ${line}`);
      }
      const qwen = (pricing.models as Record<string, any>)["qwen3.8-flash"];
      if (!(qwen.high_usage === true && qwen.batch === true)) {
        throw new Error(`the expected pick qwen3.8-flash must hold high_usage=true and batch=true in the real table`);
      }
      const onBoardFilter = (id: string): boolean => {
        const spec = (pricing.models as Record<string, any>)[id];
        return spec.high_usage === true && spec.batch === true;
      };
      const toRun = ON_LIST_IN_ORDER.filter((id) => !BOARD_ON.includes(id) && onBoardFilter(id));
      if (JSON.stringify(toRun) !== JSON.stringify(TO_RUN_OFF_BOARD)) {
        throw new Error(`off-board high-use batch set mismatch: ${toRun.join(", ")}`);
      }
      pass("G3 the oracle picks the first high-use batch model off the board, never beam-free");
    } catch (error) { fail("go pick list", error); throw error; }
    finally { rmSync(root, { recursive: true, force: true }); }
  }, 30_000);
});
