/** Page B data tool (spec D16, FR-1 to FR-3).
 *
 * Usage:
 *   npx tsx model-guide/real-work.ts --input <export.json> --out <folder>
 *
 * Exit 0 writes `<folder>/real-work.json` with schema
 * `model-guide-real-work/1`. Exit 2 writes no output file and prints one
 * line `input-check: <check>` on stdout. The checks run in this order:
 * input, json, manifest, sha256, size, schema, run-sum.
 *   input    the path is missing or is not a regular file
 *   json     the input text is not JSON
 *   schema   `schema` is not `real-work-outcomes/1`; a coverage key is
 *            missing or has the wrong type; a coverage count is not a
 *            non-negative safe integer; a row of `weekly` or `all_time`
 *            holds no string route, a count that is not a non-negative safe
 *            integer, or a malformed `ratings`, `rater_checks`, or
 *            `work_types` value
 *   run-sum  the `runs` sum of `weekly` or of `all_time` is not a safe
 *            integer, or differs from `coverage.runs`
 * The output holds only the named coverage keys of spec EV4 (plus
 * `unknown_runs` and `other_runs`), so no extra key of the input reaches the
 * public file. Work-type and rating-axis names are kept as own keys (a name
 * such as `__proto__` stays a row). The tool never copies the input file
 * into the repository.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

/** Every coverage key that the preview page reads. A missing key is a
 * schema refusal. The check runs before any write (spec D16, FR-1). */
const REQUIRED_COVERAGE_KEYS = [
  "runs",
  "first_run_date",
  "last_run_date",
  "share_known_route",
  "share_with_result",
  "paired_duplicates_left_out",
];

/** The count keys of a row. Each is a non-negative safe integer. */
const COUNT_KEYS = [
  "runs",
  "pass",
  "fail",
  "error",
  "no_result",
  "blocking_findings",
];

function refuse(check: string): never {
  process.stdout.write(`input-check: ${check}\n`);
  process.exit(2);
}

/** A count is a whole number at or above 0 that a sum can hold. */
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Add two validated counts and refuse a sum that leaves the safe range. */
function safeAdd(total: number, value: number): number {
  const sum = total + value;
  if (!Number.isSafeInteger(sum)) refuse("schema");
  return sum;
}

/** A row of `weekly` or `all_time`: a string route, safe counts, and
 * well-formed ratings, rater checks, and work-type counts. */
function isRow(row: unknown): boolean {
  if (typeof row !== "object" || row === null || Array.isArray(row)) return false;
  const entry = row as Record<string, any>;
  if (typeof entry.route !== "string") return false;
  for (const key of COUNT_KEYS) {
    if (!isCount(entry[key])) return false;
  }
  if (entry.rater_checks !== undefined) {
    const checks = entry.rater_checks;
    if (typeof checks !== "object" || checks === null || Array.isArray(checks)) return false;
    if (!isCount(checks.n) || !isCount(checks.agreed)) return false;
  }
  if (entry.ratings !== undefined) {
    const ratings = entry.ratings;
    if (typeof ratings !== "object" || ratings === null || Array.isArray(ratings)) return false;
    for (const axis of Object.keys(ratings)) {
      const value = ratings[axis];
      if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
      if (typeof value.mean !== "number" || !Number.isFinite(value.mean)) return false;
      if (!isCount(value.n)) return false;
    }
  }
  if (entry.work_types !== undefined) {
    const types = entry.work_types;
    if (typeof types !== "object" || types === null || Array.isArray(types)) return false;
    for (const name of Object.keys(types)) {
      const value = types[name];
      if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
      for (const key of ["runs", "pass", "fail"]) {
        if (!isCount(value[key])) return false;
      }
    }
  }
  return true;
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
  let i = 0;
  while (i < argv.length) {
    if (argv[i] === "--input") {
      input = argv[i + 1] ?? "";
      i += 2;
    } else if (argv[i] === "--out") {
      out = argv[i + 1] ?? "";
      i += 2;
    } else {
      process.stderr.write("usage: real-work.ts --input <file> --out <folder>\n");
      process.exit(2);
    }
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

/** Fallback for the PM export manifest (spec EV1): one `sha256sum` style
 * line `<sha256>  <size>  <file>`. The Red fixture uses `sha256:` and
 * `size:` lines instead. Both formats carry the same two values. The file
 * name of a sum line must equal the base name of the input file. */
function readManifestSumLine(
  text: string,
): { sha256: string; size: string; file: string } | null {
  const match = text.match(/^([0-9a-f]{64})\s+(\d+)\s+(\S+).*$/m);
  return match ? { sha256: match[1], size: match[2], file: match[3] } : null;
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
  acc.runs = safeAdd(acc.runs, num(row, "runs"));
  acc.pass = safeAdd(acc.pass, num(row, "pass"));
  acc.fail = safeAdd(acc.fail, num(row, "fail"));
  acc.error = safeAdd(acc.error, num(row, "error"));
  acc.noResult = safeAdd(acc.noResult, num(row, "no_result"));
  acc.blocking = safeAdd(acc.blocking, num(row, "blocking_findings"));
  const ratings = row.ratings ?? {};
  for (const axis of Object.keys(ratings)) {
    const mean = ratings[axis]?.mean;
    const n = ratings[axis]?.n;
    if (typeof mean === "number" && typeof n === "number" && n > 0) {
      acc.ratingSum.set(axis, (acc.ratingSum.get(axis) ?? 0) + mean * n);
      acc.ratingN.set(axis, safeAdd(acc.ratingN.get(axis) ?? 0, n));
    }
  }
  acc.raterN = safeAdd(acc.raterN, num(row.rater_checks, "n"));
  acc.raterAgreed = safeAdd(acc.raterAgreed, num(row.rater_checks, "agreed"));
}

function main(): void {
  const { input, out } = parseArgs(process.argv.slice(2));

  if (!existsSync(input) || !statSync(input).isFile()) refuse("input");

  const manifestPath = join(dirname(input), "MANIFEST.txt");
  if (!existsSync(manifestPath)) refuse("manifest");
  const manifest = readFileSync(manifestPath, "utf8");

  const bytes = readFileSync(input);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const sumLine = readManifestSumLine(manifest);
  const shaExpected = readManifestLine(manifest, "sha256") ?? sumLine?.sha256;
  if (shaExpected !== sha256) refuse("sha256");
  const sizeExpected = readManifestLine(manifest, "size") ?? sumLine?.size;
  if (sizeExpected !== String(bytes.length)) {
    refuse("size");
  }
  if (sumLine && sumLine.file !== basename(input)) refuse("manifest");

  let doc: unknown;
  try {
    doc = JSON.parse(bytes.toString("utf8"));
  } catch {
    refuse("json");
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    refuse("schema");
  }
  const root = doc as Record<string, any>;
  if (root.schema !== "real-work-outcomes/1") refuse("schema");
  if (typeof root.generated_on !== "string") refuse("schema");
  if (
    typeof root.coverage !== "object" ||
    root.coverage === null ||
    Array.isArray(root.coverage)
  ) {
    refuse("schema");
  }
  const coverage = root.coverage as Record<string, any>;
  for (const key of REQUIRED_COVERAGE_KEYS) {
    if (!Object.hasOwn(coverage, key)) refuse("schema");
  }
  if (!isCount(coverage.runs)) refuse("schema");
  if (typeof coverage.first_run_date !== "string") refuse("schema");
  if (typeof coverage.last_run_date !== "string") refuse("schema");
  if (
    typeof coverage.share_known_route !== "number" ||
    !Number.isFinite(coverage.share_known_route)
  ) {
    refuse("schema");
  }
  if (
    typeof coverage.share_with_result !== "number" ||
    !Number.isFinite(coverage.share_with_result)
  ) {
    refuse("schema");
  }
  if (!isCount(coverage.paired_duplicates_left_out)) refuse("schema");
  const leftOut = coverage.paired_duplicates_left_out;
  for (const key of ["runs_with_known_route", "runs_with_result"]) {
    if (Object.hasOwn(coverage, key) && !isCount(coverage[key])) refuse("schema");
  }
  for (const key of ["weekly", "all_time"] as const) {
    if (root[key] !== undefined && !Array.isArray(root[key])) refuse("schema");
  }
  const weekly: any[] = root.weekly ?? [];
  const allTime: any[] = root.all_time ?? [];
  for (const row of [...weekly, ...allTime]) {
    if (!isRow(row)) refuse("schema");
  }
  const weeklyRuns = weekly.reduce((sum: number, r: any) => safeAdd(sum, r.runs), 0);
  const allTimeRuns = allTime.reduce((sum: number, r: any) => safeAdd(sum, r.runs), 0);
  if (weeklyRuns !== coverage.runs) refuse("run-sum");
  if (allTimeRuns !== coverage.runs) refuse("run-sum");

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
      pass = safeAdd(pass, row.pass);
      fail = safeAdd(fail, row.fail);
      error = safeAdd(error, row.error);
    }
    const n = safeAdd(safeAdd(pass, fail), error);
    return { value: n === 0 ? null : pass / n, n };
  };

  const toRow = (acc: Accum, group: Set<string>, rankByBlocking: boolean) => {
    const n = safeAdd(safeAdd(acc.pass, acc.fail), acc.error);
    const ratingEntries: Array<[string, { mean: number; n: number }]> = [];
    for (const [axis, sum] of acc.ratingSum) {
      const axisN = acc.ratingN.get(axis) ?? 0;
      if (axisN > 0) ratingEntries.push([axis, { mean: round4(sum / axisN), n: axisN }]);
    }
    const ratings = Object.fromEntries(ratingEntries);
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
      acc.runs = safeAdd(acc.runs, num(types[name], "runs"));
      acc.pass = safeAdd(acc.pass, num(types[name], "pass"));
      acc.fail = safeAdd(acc.fail, num(types[name], "fail"));
    }
  }
  const workTypeEntries: Array<[string, unknown[]]> = [];
  for (const [name, table] of work) {
    const rows = [...table].map(([model, acc]) => {
      const n = safeAdd(acc.pass, acc.fail);
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
    workTypeEntries.push([name, rows]);
  }
  const workTypes = Object.fromEntries(workTypeEntries);

  const unknownRuns = allTime
    .filter((r: any) => r.route === "unknown")
    .reduce((sum: number, r: any) => safeAdd(sum, r.runs), 0);
  const otherRuns = allTime
    .filter((r: any) => r.route === "other")
    .reduce((sum: number, r: any) => safeAdd(sum, r.runs), 0);

  const coverageOut: Record<string, unknown> = {
    runs: coverage.runs,
    first_run_date: coverage.first_run_date,
    last_run_date: coverage.last_run_date,
    share_known_route: coverage.share_known_route,
    share_with_result: coverage.share_with_result,
    paired_duplicates_left_out: leftOut,
  };
  for (const key of ["runs_with_known_route", "runs_with_result"]) {
    if (Object.hasOwn(coverage, key)) coverageOut[key] = coverage[key];
  }
  coverageOut.unknown_runs = unknownRuns;
  coverageOut.other_runs = otherRuns;

  const page = {
    schema: "model-guide-real-work/1",
    source: {
      file: basename(input),
      sha256,
      generated_on: root.generated_on,
    },
    coverage: coverageOut,
    producer: producerRows,
    checker: checkerRows,
    work_types: workTypes,
  };

  let text: string;
  try {
    text = `${JSON.stringify(page, null, 2)}\n`;
  } catch {
    refuse("schema");
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "real-work.json"), text);
}

main();
