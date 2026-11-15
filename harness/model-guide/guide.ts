/** Overview table tool (spec D18, D19, FR-6, acceptance 7).
 *
 * Usage:
 *   npx tsx model-guide/guide.ts \
 *     --real-work <real-work.json> --scores <review-scores.json> \
 *     --print-audit <print-audit-2026-11.json> \
 *     --benchmark <benchmark.json> --tracks <tracks.json> \
 *     --today <YYYY-MM-DD> --out <folder>
 *
 * Exit 0 writes `<folder>/model-guide.json` with schema
 * `model-guide-overview/1`. Exit 2 writes no output file and prints one
 * line `input-check: <check>` on stdout. The checks run in this order:
 * args, today, real-work, scores, print-audit, benchmark, tracks.
 *   args        a required flag is missing, a flag holds no value, or a
 *               flag is unknown
 *   today       the `--today` value is not a real calendar date
 *   real-work   the file is missing, is not JSON, or holds no
 *               `source.generated_on` date and no `producer`, `checker`,
 *               or `work_types` table
 *   scores      the file is present but is not JSON, or a route holds no
 *               string name, no string state, or a pass without a date or
 *               a numeric score
 *   print-audit the file is missing, is not JSON, or `routes` is not an
 *               object of `"x of y"` strings
 *   benchmark   the file is missing, is not JSON, or holds no model with a
 *               numeric `score.total`
 *   tracks      the file is missing, is not JSON, or holds no tests model
 *               with a numeric `total`
 *
 * `--scores` may be absent, or it may name a file that does not exist.
 * Both mean "track A has no rank" and give exit 0, because the preview
 * must render before Phase 4 (spec D18, FR-6).
 *
 * The output holds six rows in the spec D18 order: "Code review", "app
 * code", "test writing", "docs and ops", "print-book audit", "tooling".
 * Each row holds exactly the fields kind, pick, second, evidence,
 * evidence_date, base_line.
 *   pick          the model of the first qualified source, or the exact
 *                 words "no pick yet: not enough evidence"
 *   second        the second qualified model of that source, or null
 *   evidence      "<source>: <number> (n=<count>)". The source is
 *                 "page B", "page B producer" (test writing, ruling Q1),
 *                 "track A", or "print-audit". A page B number is the pass
 *                 rate with 2 decimals; a track A number is the worst pass
 *                 score with 1 decimal; a print-audit number is the route
 *                 result text "x of y" with n = y.
 *   evidence_date the export `generated_on`, or the last complete track A
 *                 pass date for the track A pick
 *   base_line     null, except the highest build total of `--benchmark` on
 *                 the app code row and the highest tests total of
 *                 `--tracks` on the test writing row. The base line never
 *                 picks and never changes a pick (spec D18).
 *
 * A page B row qualifies with `pass_rate.n >= 10` (it carries `can_pick`).
 * The first source gives the first and the second choice from its rank.
 * A track A route qualifies with state "complete" and 3 complete passes,
 * and the rank orders the worst pass score, highest first. When the first
 * source has no qualified model the second source picks; the base lines
 * never pick.
 *
 * Ruling Q1 (PM, 2026-11-15): the test writing row uses the page B
 * producer table as a whole, because `real-work.json` has no role key. Its
 * evidence cell starts with "page B producer".
 * Ruling Q2 (PM, 2026-11-15): with no complete track A rank the code
 * review pick is the exact no-pick words, even when the page B checker
 * table holds a qualified model.
 *
 * The print-audit second source reads the tool output of task 2.4b: a
 * route name maps to its "x of y" result, and the rank orders the blockers
 * found, highest first. It never iterates the summary keys as routes.
 *
 * Inputs are read as own entries only. A `__proto__` name stays an
 * ordinary map entry (the tables are read into maps and arrays), so no
 * hostile name becomes a row or a route of the output file.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUTPUT_NAME = "model-guide.json";
const SCHEMA = "model-guide-overview/1";
const NO_PICK = "no pick yet: not enough evidence";
const STALE_DAYS = 14;
const TRACK_A_PASSES = 3;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ROUTE_RESULT_RE = /^(\d+) of (\d+)$/;
const KINDS = [
  "Code review",
  "app code",
  "test writing",
  "docs and ops",
  "print-book audit",
  "tooling",
];

function refuse(check: string): never {
  process.stdout.write(`input-check: ${check}\n`);
  process.exit(2);
}

interface Args {
  realWork: string;
  scores: string | null;
  printAudit: string;
  benchmark: string;
  tracks: string;
  today: string;
  out: string;
}

const FLAGS: Record<string, keyof Args> = {
  "--real-work": "realWork",
  "--scores": "scores",
  "--print-audit": "printAudit",
  "--benchmark": "benchmark",
  "--tracks": "tracks",
  "--today": "today",
  "--out": "out",
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    realWork: "",
    scores: null,
    printAudit: "",
    benchmark: "",
    tracks: "",
    today: "",
    out: "",
  };
  let i = 0;
  while (i < argv.length) {
    const key = FLAGS[argv[i]];
    const value = argv[i + 1] ?? "";
    if (key === undefined || value === "" || value.startsWith("--")) {
      refuse("args");
    }
    args[key] = key === "scores" ? value : value;
    i += 2;
  }
  for (const key of ["realWork", "printAudit", "benchmark", "tracks", "today", "out"] as const) {
    if (args[key] === "") refuse("args");
  }
  return args;
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read a JSON file. A missing or unreadable file, or text that is not
 * JSON, is the caller's refusal check. */
function readJsonFile(file: string, check: string): any {
  if (!existsSync(file) || !statSync(file).isFile()) refuse(check);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    refuse(check);
  }
  try {
    return JSON.parse(text);
  } catch {
    refuse(check);
  }
}

/** A normalized calendar date string, or null when the value is not one. */
function asDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.slice(0, 10);
  if (!DATE_RE.test(text)) return null;
  const time = Date.parse(`${text}T00:00:00Z`);
  if (!Number.isFinite(time)) return null;
  if (new Date(time).toISOString().slice(0, 10) !== text) return null;
  return text;
}

/** Real work page B data (tool of Phase 1, schema `model-guide-real-work/1`).
 * The three tables are kept as arrays; the work-type names are read into a
 * Map, so a name such as `__proto__` stays an ordinary key. */
interface RealWork {
  generatedOn: string;
  producer: any[];
  checker: any[];
  workTypes: Map<string, any[]>;
}

function readRealWork(file: string): RealWork {
  const doc = readJsonFile(file, "real-work");
  if (!isObject(doc) || !isObject(doc.source)) refuse("real-work");
  const generatedOn = asDate(doc.source.generated_on);
  if (generatedOn === null) refuse("real-work");
  if (!Array.isArray(doc.producer) || !Array.isArray(doc.checker)) refuse("real-work");
  if (!isObject(doc.work_types)) refuse("real-work");
  const workTypes = new Map<string, any[]>();
  for (const [name, rows] of Object.entries(doc.work_types)) {
    if (!Array.isArray(rows)) refuse("real-work");
    workTypes.set(name, rows);
  }
  return {
    generatedOn,
    producer: doc.producer,
    checker: doc.checker,
    workTypes,
  };
}

interface RouteRank {
  route: string;
  worst: number;
  passes: Array<{ date: string; score: number }>;
  lastDate: string;
}

/** The track A rank of spec D13. A route qualifies with a complete state
 * and 3 complete passes; the rank orders the worst pass score, highest
 * first. A missing or unreadable score file gives an empty rank. */
function readTrackARank(file: string | null): RouteRank[] {
  if (file === null || !existsSync(file) || !statSync(file).isFile()) return [];
  const doc = readJsonFile(file, "scores");
  if (!isObject(doc) || !Array.isArray(doc.routes)) refuse("scores");
  const rank: RouteRank[] = [];
  for (const route of doc.routes) {
    if (!isObject(route) || typeof route.route !== "string") refuse("scores");
    if (typeof route.state !== "string" || !Array.isArray(route.passes)) refuse("scores");
    if (route.state !== "complete") continue;
    const passes: Array<{ date: string; score: number }> = [];
    for (const pass of route.passes) {
      if (!isObject(pass) || pass.state !== "complete") continue;
      const date = asDate(pass.date);
      if (date === null || typeof pass.score !== "number" || !Number.isFinite(pass.score)) {
        refuse("scores");
      }
      passes.push({ date, score: pass.score });
    }
    if (passes.length < TRACK_A_PASSES) continue;
    passes.sort((a, b) => a.date.localeCompare(b.date));
    const worst = Math.min(...passes.map((pass) => pass.score));
    rank.push({ route: route.route, worst, passes, lastDate: passes[passes.length - 1].date });
  }
  rank.sort((a, b) => b.worst - a.worst || a.route.localeCompare(b.route));
  return rank;
}

interface AuditRoute {
  route: string;
  found: number;
  total: number;
  text: string;
}

/** The print-audit tool output of task 2.4b. `routes` maps a route name to
 * an "x of y" result; the summary keys are never read as routes. */
function readPrintAudit(file: string): AuditRoute[] {
  const doc = readJsonFile(file, "print-audit");
  if (!isObject(doc) || !isObject(doc.routes)) refuse("print-audit");
  const routes: AuditRoute[] = [];
  for (const [name, value] of Object.entries(doc.routes)) {
    const match = typeof value === "string" ? ROUTE_RESULT_RE.exec(value) : null;
    if (match === null) refuse("print-audit");
    routes.push({
      route: name,
      found: Number(match[1]),
      total: Number(match[2]),
      text: `${match[1]} of ${match[2]}`,
    });
  }
  routes.sort((a, b) => b.found - a.found || a.route.localeCompare(b.route));
  return routes;
}

function readBuildBaseLine(file: string): number {
  const doc = readJsonFile(file, "benchmark");
  if (!isObject(doc) || !Array.isArray(doc.models)) refuse("benchmark");
  const totals = doc.models
    .filter((model: any) => isObject(model) && isObject(model.score))
    .map((model: any) => model.score.total)
    .filter((total: unknown) => typeof total === "number" && Number.isFinite(total));
  if (totals.length === 0) refuse("benchmark");
  return Math.max(...totals);
}

function readTestsBaseLine(file: string): number {
  const doc = readJsonFile(file, "tracks");
  const models = isObject(doc) && isObject(doc.tracks) && isObject(doc.tracks.tests)
    ? doc.tracks.tests.models
    : null;
  if (!Array.isArray(models)) refuse("tracks");
  const totals = models
    .map((model: any) => (isObject(model) ? model.total : undefined))
    .filter((total: unknown) => typeof total === "number" && Number.isFinite(total));
  if (totals.length === 0) refuse("tracks");
  return Math.max(...totals);
}

/** One pick source: the model, the second choice, the evidence cell, and
 * the evidence date. */
interface Source {
  pick: string;
  second: string | null;
  evidence: string;
  date: string;
}

/** A page B table of real-work.json, already ranked by the tool. A row
 * qualifies with `can_pick` (10 runs or more). With no qualified row the
 * pick is the no-pick words; the evidence still cites the top row, so the
 * reader sees how little evidence the row holds. */
function fromPageB(rows: any[] | undefined, prefix: string, date: string): Source {
  const table = Array.isArray(rows) ? rows : [];
  const qualified = table.filter(
    (row) => isObject(row) && row.can_pick === true && typeof row.model === "string",
  );
  const shown = qualified[0] ?? table.find((row) => isObject(row) && typeof row.model === "string");
  const pick = qualified.length > 0 ? qualified[0].model : NO_PICK;
  const second = qualified.length > 1 ? qualified[1].model : null;
  let evidence = `${prefix}: no runs (n=0)`;
  if (isObject(shown) && isObject(shown.pass_rate)) {
    const value = shown.pass_rate.value;
    const n = shown.pass_rate.n;
    if (typeof value === "number" && typeof n === "number") {
      evidence = `${prefix}: pass ${value.toFixed(2)} (n=${n})`;
    }
  }
  return { pick, second, evidence, date };
}

/** The track A rank. Ruling Q2: with no complete rank the pick is the
 * no-pick words, and the page B checker table does not pick for code
 * review. */
function fromTrackA(rank: RouteRank[], generatedOn: string): Source {
  if (rank.length === 0) {
    return {
      pick: NO_PICK,
      second: null,
      evidence: "track A: no complete rank (n=0)",
      date: generatedOn,
    };
  }
  const best = rank[0];
  return {
    pick: best.route,
    second: rank.length > 1 ? rank[1].route : null,
    evidence: `track A: worst ${best.worst.toFixed(1)} (n=${best.passes.length})`,
    date: best.lastDate,
  };
}

/** The print-audit data point. The rank orders the blockers found, highest
 * first. */
function fromPrintAudit(routes: AuditRoute[], generatedOn: string): Source {
  if (routes.length === 0) {
    return {
      pick: NO_PICK,
      second: null,
      evidence: "print-audit: no route (n=0)",
      date: generatedOn,
    };
  }
  const best = routes[0];
  return {
    pick: best.route,
    second: routes.length > 1 ? routes[1].route : null,
    evidence: `print-audit: ${best.text} (n=${best.total})`,
    date: generatedOn,
  };
}

interface Row {
  kind: string;
  pick: string;
  second: string | null;
  evidence: string;
  evidence_date: string;
  base_line: number | null;
}

function rowOf(kind: string, source: Source, baseLine: number | null): Row {
  return {
    kind,
    pick: source.pick,
    second: source.second,
    evidence: source.evidence,
    evidence_date: source.date,
    base_line: baseLine,
  };
}

/** Whole days from `from` to `to`; both are calendar dates. */
function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const today = asDate(args.today);
  if (today === null) refuse("today");

  const realWork = readRealWork(args.realWork);
  const rank = readTrackARank(args.scores);
  const audit = readPrintAudit(args.printAudit);
  const buildBaseLine = readBuildBaseLine(args.benchmark);
  const testsBaseLine = readTestsBaseLine(args.tracks);

  const generatedOn = realWork.generatedOn;
  const codeReview = fromTrackA(rank, generatedOn);
  const appCode = fromPageB(realWork.workTypes.get("app code"), "page B", generatedOn);
  const testWriting = fromPageB(realWork.producer, "page B producer", generatedOn);
  const docsAndOps = fromPageB(realWork.workTypes.get("docs and ops"), "page B", generatedOn);
  const printBooks = fromPageB(realWork.workTypes.get("print books"), "page B", generatedOn);
  const tooling = fromPageB(realWork.workTypes.get("tooling"), "page B", generatedOn);

  // The print-book audit row falls to the print-audit data point when the
  // work-type table has no qualified model.
  const printBookSource =
    printBooks.pick === NO_PICK ? fromPrintAudit(audit, generatedOn) : printBooks;

  const rows: Row[] = [
    rowOf(KINDS[0], codeReview, null),
    rowOf(KINDS[1], appCode, buildBaseLine),
    rowOf(KINDS[2], testWriting, testsBaseLine),
    rowOf(KINDS[3], docsAndOps, null),
    rowOf(KINDS[4], printBookSource, null),
    rowOf(KINDS[5], tooling, null),
  ];

  const newest = rows
    .map((row) => row.evidence_date)
    .sort((a, b) => a.localeCompare(b))
    .pop() ?? today;
  const stale = daysBetween(newest, today) > STALE_DAYS;

  const page = { schema: SCHEMA, today, stale, rows };
  mkdirSync(args.out, { recursive: true });
  writeFileSync(join(args.out, OUTPUT_NAME), `${JSON.stringify(page, null, 2)}\n`);
}

try {
  main();
} catch {
  refuse("error");
}
