import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Red tests for plan task 1.1: the merge and the rates of page B (spec D16,
 * FR-1 to FR-3, FR-7). They call the planned tool `harness/model-guide/real-work.ts`.
 *
 * Pinned command-line interface:
 *   cd harness && npx tsx model-guide/real-work.ts --input <export.json> --out <folder>
 * Exit 0: writes `<folder>/real-work.json`. Exit 2: writes no output file, and
 * prints one line `input-check: <check>` on stdout. The checks are sha256,
 * size, schema, run-sum, and manifest.
 *
 * Pinned output file `real-work.json`, schema `model-guide-real-work/1`:
 *   source: { file, sha256, generated_on }
 *   coverage: { runs, first_run_date, last_run_date, share_known_route,
 *               share_with_result, paired_duplicates_left_out,
 *               unknown_runs, other_runs }  (the input keys plus the last two)
 *   producer: Row[] and checker: Row[]  (sorted by rank, then model)
 *   work_types: { <work type>: WorkRow[] }  (sorted by rank, then model)
 * Row: { model, routes[], runs, pass, fail, error, no_result,
 *        blocking_findings, pass_rate{value,n}, blocking_rate{value,n},
 *        ratings{<axis>:{mean,n}}, rater_checks{n,agreed,agreement},
 *        trend{value,n}, few_runs, can_pick, rank }
 * WorkRow: { model, routes[], runs, pass, fail, pass_rate{value,n},
 *            few_runs, can_pick, rank }
 *
 * Rules that the output must hold:
 * - The model key removes `#<variant>` and `[1m]` only. The provider stays.
 * - pass_rate = pass / (pass + fail + error), rounded to 4 decimals.
 *   Its n is pass + fail + error. no_result stays out of the rate.
 * - blocking_rate = blocking_findings / (pass + fail + error), rounded to 3
 *   decimals. Its n is pass + fail + error.
 * - producer rank: higher pass_rate, then lower blocking_rate.
 *   checker rank: higher pass_rate only. A rating never moves a rank.
 * - few_runs is true when pass_rate.n < 10. A few_runs row ranks below every
 *   row without the mark. can_pick is pass_rate.n >= 10.
 * - work-type pass_rate = pass / (pass + fail), rounded to 4 decimals. Its n
 *   is pass + fail. A work-type row sums the rows of its model and work type.
 *   The rank is the higher rate, then the higher n. A few_runs work row cannot
 *   pick.
 * - trend = pass / (pass + fail + error) over the last 4 ISO weeks present in
 *   `weekly`, with n = pass + fail + error of those weeks.
 * - `unknown` and `other` are in no table. The coverage block holds their runs.
 *
 * The fixture is synthetic. No test reads the real export, the real docs/, a
 * model, the network, or the private folder.
 */

const HARNESS = resolve(import.meta.dirname, "..");
const TOOL = join(HARNESS, "model-guide", "real-work.ts");
const FIXTURE = join(import.meta.dirname, "fixtures", "real-work-mini.json");
const MINI = JSON.parse(readFileSync(FIXTURE, "utf8"));

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `model-guide-real-work-${tag}-`));
  roots.push(dir);
  return dir;
}

function requireProduction(): void {
  if (!existsSync(TOOL)) throw new Error(`production file is missing: ${TOOL}`);
}

function env(): NodeJS.ProcessEnv {
  const copy = { ...process.env, NO_COLOR: "1" };
  delete copy.BENCH_TRACK;
  return copy;
}

function runTool(input: string, out: string) {
  requireProduction();
  return spawnSync("npx", ["tsx", "model-guide/real-work.ts", "--input", input, "--out", out], {
    cwd: HARNESS, env: env(), encoding: "utf8", timeout: 60_000,
  });
}

function outputOf(result: ReturnType<typeof runTool>, out: string) {
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const file = join(out, "real-work.json");
  expect(existsSync(file), `missing output file: ${file}`).toBe(true);
  return JSON.parse(readFileSync(file, "utf8"));
}

function runOk(input: string, tag: string) {
  const out = tempDir(tag);
  return outputOf(runTool(input, out), out);
}

/** A copy of the fixture with a mutation and a manifest that matches the copy. */
function stagedCopy(mutate: (doc: any) => void): string {
  const dir = tempDir("staged");
  const doc = JSON.parse(readFileSync(FIXTURE, "utf8"));
  mutate(doc);
  const file = join(dir, "real-work-mini.json");
  const text = JSON.stringify(doc);
  writeFileSync(file, text);
  const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
  writeFileSync(join(dir, "MANIFEST.txt"), [
    `sha256: ${sha}`,
    `size: ${Buffer.byteLength(text)}`,
    "source-commit: none (synthetic fixture, 2026-11-14)",
    `row-counts: weekly_rows ${doc.weekly.length}, all_time_rows ${doc.all_time.length}`,
    "",
  ].join("\n"));
  return file;
}

function row(rows: any[], model: string) {
  const found = rows.find((item) => item.model === model);
  expect(found, `row ${model}`).toBeDefined();
  return found;
}

function order(rows: any[]): string[] {
  return rows.map((item) => item.model);
}

describe("page B merge and rates", () => {
  it("merges the three route variants of one model by sums and lists the routes", () => {
    const page = runOk(FIXTURE, "m1");
    const merged = row(page.producer, "x/m");
    expect([...merged.routes].sort()).toEqual(["x/m", "x/m#high", "x/m[1m]#high"]);
    expect(merged.runs).toBe(38);
    expect(merged.pass).toBe(18);
    expect(merged.fail).toBe(12);
    expect(merged.error).toBe(0);
    expect(merged.no_result).toBe(8);
    expect(merged.blocking_findings).toBe(3);
  });

  it("keeps the same model on two providers as two rows", () => {
    const page = runOk(FIXTURE, "m1b");
    expect(order(page.producer)).toContain("x/m");
    expect(order(page.producer)).toContain("y/m");
    expect(page.producer.filter((item: any) => item.model === "x/m")).toHaveLength(1);
    expect(row(page.producer, "x/m").routes).not.toContain("y/m");
    expect(row(page.producer, "y/m").routes).toEqual(["y/m"]);
  });

  it("keeps unknown and other out of the ranks and unmerged", () => {
    const page = runOk(FIXTURE, "m1c");
    expect(order(page.producer)).not.toContain("unknown");
    expect(order(page.producer)).not.toContain("other");
    expect(order(page.checker)).not.toContain("unknown");
    expect(order(page.checker)).not.toContain("other");
    expect(page.producer.some((item: any) => item.routes.includes("unknown"))).toBe(false);
    expect(page.coverage.unknown_runs).toBe(120);
    expect(page.coverage.other_runs).toBe(3);
  });

  it("computes the pass rate without no_result and keeps no_result in its own field", () => {
    const page = runOk(FIXTURE, "m2");
    const producer = row(page.producer, "y/m");
    expect(producer.pass_rate.value).toBeCloseTo(0.6, 6);
    expect(producer.pass_rate.n).toBe(40);
    expect(producer.no_result).toBe(4);
    expect(producer.pass_rate.value).not.toBeCloseTo(24 / 44, 6);
    expect(producer.blocking_rate.value).toBeCloseTo(0, 6);
    expect(producer.blocking_rate.n).toBe(40);
  });

  it("carries the run count beside each rate", () => {
    const page = runOk(FIXTURE, "m2b");
    expect(row(page.producer, "x/m").pass_rate.n).toBe(30);
    expect(row(page.producer, "x/m").blocking_rate.n).toBe(30);
    expect(row(page.producer, "z/m").pass_rate.n).toBe(15);
    expect(row(page.checker, "x/m").pass_rate.n).toBe(24);
    expect(row(page.checker, "y/m").blocking_rate.n).toBe(20);
  });

  it("ranks producers by pass rate then by the lower blocking rate", () => {
    const page = runOk(FIXTURE, "m3");
    expect(order(page.producer)).toEqual(["z/m", "y/m", "x/m", "w/m"]);
    expect(page.producer.map((item: any) => item.rank)).toEqual([1, 2, 3, 4]);
    expect(row(page.producer, "y/m").pass_rate.value)
      .toBeCloseTo(row(page.producer, "x/m").pass_rate.value, 6);
    expect(row(page.producer, "y/m").blocking_rate.value)
      .toBeLessThan(row(page.producer, "x/m").blocking_rate.value);
  });

  it("ranks checkers by pass rate only", () => {
    const page = runOk(FIXTURE, "m3b");
    expect(order(page.checker)).toEqual(["x/m", "y/m"]);
    expect(row(page.checker, "x/m").pass_rate.value)
      .toBeGreaterThan(row(page.checker, "y/m").pass_rate.value);
    expect(row(page.checker, "x/m").blocking_rate.value)
      .toBeGreaterThan(row(page.checker, "y/m").blocking_rate.value);
  });

  it("does not move a rank when a rating changes alone", () => {
    const before = runOk(FIXTURE, "m3c");
    const staged = stagedCopy((doc) => {
      const ym = doc.all_time.find((item: any) => item.route === "y/m" && item.role === "green");
      ym.ratings = { correctness: { mean: 5, n: 10 } };
      const zm = doc.all_time.find((item: any) => item.route === "z/m");
      zm.ratings = { correctness: { mean: 1, n: 10 } };
    });
    const after = runOk(staged, "m3d");
    expect(order(after.producer)).toEqual(order(before.producer));
    expect(after.producer.map((item: any) => item.rank))
      .toEqual(before.producer.map((item: any) => item.rank));
  });

  it("shows the mean of each axis with its n", () => {
    const page = runOk(FIXTURE, "m3e");
    const merged = row(page.producer, "x/m");
    expect(merged.ratings.correctness.mean).toBeCloseTo(4.7, 6);
    expect(merged.ratings.correctness.n).toBe(10);
    expect(merged.ratings.other.mean).toBeCloseTo(4.4, 6);
    expect(merged.ratings.other.n).toBe(5);
  });

  it("computes a work-type rate as pass over pass plus fail with the result count", () => {
    const page = runOk(FIXTURE, "m4");
    const work = row(page.work_types["app code"], "x/m");
    expect(work.pass_rate.value).toBeCloseTo(0.8, 6);
    expect(work.pass_rate.n).toBe(20);
    expect(work.runs).toBe(22);
    expect(work.pass).toBe(16);
    expect(work.fail).toBe(4);
  });

  it("sums the role rows of a route and work type", () => {
    const page = runOk(FIXTURE, "m4b");
    const work = row(page.work_types["app code"], "x/m");
    expect(work.routes.sort()).toEqual(["x/m", "x/m#high", "x/m[1m]#high"]);
    expect(work.runs).toBe(10 + 8 + 4);
    expect(work.pass).toBe(8 + 6 + 2);
    expect(work.fail).toBe(2 + 2 + 0);
  });

  it("ranks work types by rate then by the higher result count", () => {
    const page = runOk(FIXTURE, "m4c");
    expect(order(page.work_types["app code"])).toEqual(["x/m", "y/m", "z/m", "w/m"]);
    expect(order(page.work_types["tooling"])).toEqual(["y/m", "x/m"]);
    expect(order(page.work_types["print books"])).toEqual(["y/m", "x/m"]);
    expect(row(page.work_types["app code"], "x/m").pass_rate.n).toBe(20);
    expect(row(page.work_types["app code"], "y/m").pass_rate.n).toBe(10);
  });

  it("uses only runs, pass, and fail of a work type", () => {
    const before = runOk(FIXTURE, "m4d");
    const staged = stagedCopy((doc) => {
      for (const item of doc.all_time) {
        if (item.work_types?.["app code"]) item.work_types["app code"].blocking_findings = 99;
        if (item.work_types?.["app code"]) item.work_types["app code"].error = 7;
      }
    });
    const after = runOk(staged, "m4e");
    expect(row(after.work_types["app code"], "x/m").pass_rate.value).toBeCloseTo(0.8, 6);
    expect(order(after.work_types["app code"])).toEqual(order(before.work_types["app code"]));
  });

  it("marks 9 results with few runs and 10 without it, and puts the mark below", () => {
    const staged = stagedCopy((doc) => {
      const z = doc.all_time.find((item: any) => item.route === "z/m" && item.role === "coder");
      z.pass = 7;
      z.fail = 3;
      z.error = 0;
      z.no_result = 8;
    });
    const page = runOk(staged, "m5");
    expect(row(page.producer, "w/m").pass_rate.n).toBe(9);
    expect(row(page.producer, "w/m").few_runs).toBe(true);
    expect(row(page.producer, "w/m").can_pick).toBe(false);
    expect(row(page.producer, "z/m").pass_rate.n).toBe(10);
    expect(row(page.producer, "z/m").few_runs).toBe(false);
    expect(row(page.producer, "z/m").can_pick).toBe(true);
    expect(order(page.producer).indexOf("w/m"))
      .toBeGreaterThan(order(page.producer).indexOf("z/m"));
  });

  it("marks a work type under 10 results and makes it unable to pick", () => {
    const page = runOk(FIXTURE, "m5b");
    const z = row(page.work_types["docs and ops"], "z/m");
    expect(z.pass_rate.n).toBe(5);
    expect(z.pass_rate.value).toBeCloseTo(1, 6);
    expect(z.few_runs).toBe(true);
    expect(z.can_pick).toBe(false);
    expect(row(page.work_types["docs and ops"], "y/m").few_runs).toBe(false);
    expect(row(page.work_types["docs and ops"], "y/m").can_pick).toBe(true);
  });

  it("gives no rate to a work type with no result", () => {
    const page = runOk(FIXTURE, "m5c");
    const work = row(page.work_types["print books"], "x/m");
    expect(work.pass_rate.value).toBeNull();
    expect(work.pass_rate.n).toBe(0);
    expect(work.few_runs).toBe(true);
    expect(work.can_pick).toBe(false);
  });

  it("shows no agreement value when rater_checks.n is 0", () => {
    const page = runOk(FIXTURE, "m5d");
    expect(row(page.producer, "y/m").rater_checks.n).toBe(0);
    expect(row(page.producer, "y/m").rater_checks.agreement).toBeNull();
    expect(row(page.producer, "x/m").rater_checks.n).toBe(5);
    expect(row(page.producer, "x/m").rater_checks.agreed).toBe(4);
    expect(row(page.producer, "x/m").rater_checks.agreement).toBeCloseTo(0.8, 6);
  });

  it("puts the coverage numbers in the coverage block", () => {
    const page = runOk(FIXTURE, "m6");
    expect(page.coverage).toMatchObject(MINI.coverage);
    expect(page.coverage.runs).toBe(285);
    expect(page.coverage.first_run_date).toBe("2026-09-28");
    expect(page.coverage.last_run_date).toBe("2026-11-08");
    expect(page.coverage.share_known_route).toBeCloseTo(0.568, 6);
    expect(page.coverage.share_with_result).toBeCloseTo(0.842, 6);
    expect(page.coverage.paired_duplicates_left_out).toBe(4);
    expect(page.coverage.unknown_runs).toBe(120);
    expect(page.coverage.other_runs).toBe(3);
  });

  it("computes the 4-week pass rate from the last 4 ISO weeks", () => {
    const page = runOk(FIXTURE, "m6b");
    const trend = row(page.producer, "x/m").trend;
    expect(trend.n).toBe(18);
    expect(trend.value).toBeCloseTo(13 / 18, 6);
    expect(trend.value).not.toBeCloseTo(0.6, 6);
  });
});
