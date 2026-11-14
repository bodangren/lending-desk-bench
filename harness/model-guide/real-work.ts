/** Page B data tool (spec D16, FR-1 to FR-3).
 *
 * Usage:
 *   npx tsx model-guide/real-work.ts --input <export.json> --out <folder>
 *
 * Exit 0 writes `<folder>/real-work.json` with schema
 * `model-guide-real-work/1`. Exit 2 writes no output file and prints one
 * line `input-check: <check>` on stdout. The checks run in this order:
 * manifest, sha256, size, schema, run-sum. The tool never copies the input
 * file into the repository.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const PRODUCER_ROLES = new Set([
  "green",
  "red",
  "coder",
  "small",
  "strategy",
  "record",
]);
const CHECKER_ROLES = new Set([
  "review-a",
  "review-b",
  "review-c",
  "adversarial",
  "acceptance",
  "phase-acceptance",
  "final-acceptance",
]);

function refuse(check: string): never {
  process.stdout.write(`input-check: ${check}\n`);
  process.exit(2);
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Remove the `#<variant>` part and the `[1m]` part. The provider stays. */
function modelKey(route: string): string {
  return route.replace(/\[1m\]/g, "").split("#")[0];
}

function num(row: any, key: string): number {
  const value = row?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseArgs(argv: string[]): { input: string; out: string } {
  let input = "";
  let out = "";
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--input") input = argv[i + 1] ?? "";
    if (argv[i] === "--out") out = argv[i + 1] ?? "";
  }
  if (!input || !out) {
    process.stderr.write("usage: real-work.ts --input <file> --out <folder>\n");
    process.exit(2);
  }
  return { input, out };
}

function readManifestLine(text: string, key: string): string | null {
  const match = text.match(new RegExp(`^${key}: (.+)$`, "m"));
  return match ? match[1].trim() : null;
}

interface Accum {
  model: string;
  routes: Set<string>;
  runs: number;
  pass: number;
  fail: number;
  error: number;
  noResult: number;
  blocking: number;
  ratingSum: Map<string, number>;
  ratingN: Map<string, number>;
  raterN: number;
  raterAgreed: number;
}

function newAccum(model: string): Accum {
  return {
    model,
    routes: new Set(),
    runs: 0,
    pass: 0,
    fail: 0,
    error: 0,
    noResult: 0,
    blocking: 0,
    ratingSum: new Map(),
    ratingN: new Map(),
    raterN: 0,
    raterAgreed: 0,
  };
}

function addRow(acc: Accum, row: any): void {
  acc.routes.add(row.route);
  acc.runs += num(row, "runs");
  acc.pass += num(row, "pass");
  acc.fail += num(row, "fail");
  acc.error += num(row, "error");
  acc.noResult += num(row, "no_result");
  acc.blocking += num(row, "blocking_findings");
  const ratings = row.ratings ?? {};
  for (const axis of Object.keys(ratings)) {
    const mean = ratings[axis]?.mean;
    const n = ratings[axis]?.n;
    if (typeof mean === "number" && typeof n === "number" && n > 0) {
      acc.ratingSum.set(axis, (acc.ratingSum.get(axis) ?? 0) + mean * n);
      acc.ratingN.set(axis, (acc.ratingN.get(axis) ?? 0) + n);
    }
  }
  acc.raterN += num(row.rater_checks, "n");
  acc.raterAgreed += num(row.rater_checks, "agreed");
}

function main(): void {
  const { input, out } = parseArgs(process.argv.slice(2));

  const manifestPath = join(dirname(input), "MANIFEST.txt");
  if (!existsSync(manifestPath)) refuse("manifest");
  const manifest = readFileSync(manifestPath, "utf8");

  const bytes = readFileSync(input);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (readManifestLine(manifest, "sha256") !== sha256) refuse("sha256");
  if (readManifestLine(manifest, "size") !== String(bytes.length)) {
    refuse("size");
  }

  const doc = JSON.parse(bytes.toString("utf8"));
  if (doc.schema !== "real-work-outcomes/1") refuse("schema");
  const weekly = Array.isArray(doc.weekly) ? doc.weekly : [];
  const allTime = Array.isArray(doc.all_time) ? doc.all_time : [];
  const weeklyRuns = weekly.reduce((sum: number, r: any) => sum + num(r, "runs"), 0);
  const allTimeRuns = allTime.reduce((sum: number, r: any) => sum + num(r, "runs"), 0);
  if (weeklyRuns !== num(doc.coverage, "runs")) refuse("run-sum");
  if (allTimeRuns !== num(doc.coverage, "runs")) refuse("run-sum");

  const weeks = [...new Set(weekly.map((r: any) => r.week))].sort();
  const last4 = new Set(weeks.slice(-4));

  const producer = new Map<string, Accum>();
  const checker = new Map<string, Accum>();
  for (const row of allTime) {
    if (row.route === "unknown" || row.route === "other") continue;
    const key = modelKey(row.route);
    if (PRODUCER_ROLES.has(row.role)) {
      if (!producer.has(key)) producer.set(key, newAccum(key));
      addRow(producer.get(key)!, row);
    } else if (CHECKER_ROLES.has(row.role)) {
      if (!checker.has(key)) checker.set(key, newAccum(key));
      addRow(checker.get(key)!, row);
    }
  }

  const trendOf = (key: string, group: Set<string>): { value: number | null; n: number } => {
    let pass = 0;
    let fail = 0;
    let error = 0;
    for (const row of weekly) {
      if (!last4.has(row.week)) continue;
      if (!group.has(row.role)) continue;
      if (modelKey(row.route) !== key) continue;
      pass += num(row, "pass");
      fail += num(row, "fail");
      error += num(row, "error");
    }
    const n = pass + fail + error;
    return { value: n === 0 ? null : pass / n, n };
  };

  const toRow = (acc: Accum, group: Set<string>, rankByBlocking: boolean) => {
    const n = acc.pass + acc.fail + acc.error;
    const ratings: Record<string, { mean: number; n: number }> = {};
    for (const [axis, sum] of acc.ratingSum) {
      const axisN = acc.ratingN.get(axis) ?? 0;
      if (axisN > 0) ratings[axis] = { mean: round4(sum / axisN), n: axisN };
    }
    return {
      model: acc.model,
      routes: [...acc.routes].sort(),
      runs: acc.runs,
      pass: acc.pass,
      fail: acc.fail,
      error: acc.error,
      no_result: acc.noResult,
      blocking_findings: acc.blocking,
      pass_rate: { value: n === 0 ? null : round4(acc.pass / n), n },
      blocking_rate: { value: n === 0 ? null : round3(acc.blocking / n), n },
      ratings,
      rater_checks: {
        n: acc.raterN,
        agreed: acc.raterAgreed,
        agreement: acc.raterN === 0 ? null : round4(acc.raterAgreed / acc.raterN),
      },
      trend: trendOf(acc.model, group),
      few_runs: n < 10,
      can_pick: n >= 10,
      rank: 0,
      rankByBlocking,
    };
  };

  const sortMain = (rows: ReturnType<typeof toRow>) => {
    const rateOf = (r: (typeof rows)[number]) => r.pass_rate.value;
    rows.sort((a, b) => {
      if (a.few_runs !== b.few_runs) return a.few_runs ? 1 : -1;
      const ra = rateOf(a);
      const rb = rateOf(b);
      if (ra === null && rb === null) return a.model < b.model ? -1 : 1;
      if (ra === null) return 1;
      if (rb === null) return -1;
      if (rb !== ra) return rb - ra;
      if (a.rankByBlocking && b.rankByBlocking) {
        const ba = a.blocking_rate.value ?? 0;
        const bb = b.blocking_rate.value ?? 0;
        if (ba !== bb) return ba - bb;
      }
      return a.model < b.model ? -1 : 1;
    });
    rows.forEach((r, i) => {
      r.rank = i + 1;
    });
    return rows.map(({ rankByBlocking: _drop, ...rest }) => rest);
  };

  const producerRows = sortMain([...producer.values()].map((a) => toRow(a, PRODUCER_ROLES, true)));
  const checkerRows = sortMain([...checker.values()].map((a) => toRow(a, CHECKER_ROLES, false)));

  interface WorkAccum {
    runs: number;
    pass: number;
    fail: number;
    routes: Set<string>;
  }
  const work: Map<string, Map<string, WorkAccum>> = new Map();
  for (const row of allTime) {
    if (row.route === "unknown" || row.route === "other") continue;
    const key = modelKey(row.route);
    const types = row.work_types ?? {};
    for (const name of Object.keys(types)) {
      if (!work.has(name)) work.set(name, new Map());
      const table = work.get(name)!;
      if (!table.has(key)) {
        table.set(key, { runs: 0, pass: 0, fail: 0, routes: new Set() });
      }
      const acc = table.get(key)!;
      acc.routes.add(row.route);
      acc.runs += num(types[name], "runs");
      acc.pass += num(types[name], "pass");
      acc.fail += num(types[name], "fail");
    }
  }
  const workTypes: Record<string, unknown[]> = {};
  for (const [name, table] of work) {
    const rows = [...table].map(([model, acc]) => {
      const n = acc.pass + acc.fail;
      return {
        model,
        routes: [...acc.routes].sort(),
        runs: acc.runs,
        pass: acc.pass,
        fail: acc.fail,
        pass_rate: { value: n === 0 ? null : round4(acc.pass / n), n },
        few_runs: n < 10,
        can_pick: n >= 10,
        rank: 0,
      };
    });
    rows.sort((a, b) => {
      if (a.few_runs !== b.few_runs) return a.few_runs ? 1 : -1;
      if (a.pass_rate.value === null && b.pass_rate.value === null) {
        return a.model < b.model ? -1 : 1;
      }
      if (a.pass_rate.value === null) return 1;
      if (b.pass_rate.value === null) return -1;
      if (b.pass_rate.value !== a.pass_rate.value) {
        return b.pass_rate.value - a.pass_rate.value;
      }
      if (b.pass_rate.n !== a.pass_rate.n) return b.pass_rate.n - a.pass_rate.n;
      return a.model < b.model ? -1 : 1;
    });
    rows.forEach((r, i) => {
      r.rank = i + 1;
    });
    workTypes[name] = rows;
  }

  const unknownRuns = allTime
    .filter((r: any) => r.route === "unknown")
    .reduce((sum: number, r: any) => sum + num(r, "runs"), 0);
  const otherRuns = allTime
    .filter((r: any) => r.route === "other")
    .reduce((sum: number, r: any) => sum + num(r, "runs"), 0);

  const page = {
    schema: "model-guide-real-work/1",
    source: {
      file: basename(input),
      sha256,
      generated_on: doc.generated_on,
    },
    coverage: { ...doc.coverage, unknown_runs: unknownRuns, other_runs: otherRuns },
    producer: producerRows,
    checker: checkerRows,
    work_types: workTypes,
  };

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "real-work.json"), `${JSON.stringify(page, null, 2)}\n`);
}

main();
