/** Overview table tool (spec D18, D19, FR-6, acceptance 7).
 *
 * Usage:
 *   npx tsx model-guide/guide.ts \
 *     --real-work <real-work.json> --scores <review-scores.json> \
 *     --print-audit <print-audit-2026-11.json> \
 *     --benchmark <benchmark.json> --tracks <tracks.json> [--routes <routes.json>] \
 *     --today <YYYY-MM-DD> --out <folder>
 *
 * Exit 0 writes `<folder>/model-guide.json` with schema
 * `model-guide-overview/1`. Exit 2 writes no output file and prints one
 * line `input-check: <check>` on stdout. The checks run in this order:
 * args, today, real-work, scores, print-audit, routes, benchmark, tracks.
 *   args        a required flag is missing, a flag holds no value, or a
 *               flag is unknown
 *   today       the `--today` value is not a real calendar date
 *   real-work   the file is missing, is not JSON, or holds no source date
 *               and no producer, checker, or role table
 *   scores      the file is present but is not JSON, or a route holds no
 *               string name, no string state, or a pass without a date or
 *               a numeric score
 *   print-audit the file is missing, is not JSON, or `routes` is not an
 *               object of `"x of y"` strings
 *   routes      the file is missing, is not JSON, or an entry holds no
 *               string family or route
 *   benchmark   the file is missing, is not JSON, or holds no model with a
 *               numeric `score.total`
 *   tracks      the file is missing, is not JSON, holds no tests model with
 *               a numeric `total`, or has a malformed docs-and-ops table
 *
 * `--scores` may be absent, or it may name a file that does not exist.
 * Both mean "track A has no rank" and give exit 0, because the preview
 * must render before Phase 4 (spec D18, FR-6).
 *
 * `--routes` defaults to `routes.json` beside this tool. The app code row
 * selects the highest Build score in each route family. A family without
 * a score keeps its session route. The evidence cell names each selection.
 *
 * The output holds six rows in the spec D18 order: "Code review", "app
 * code", "test writing", "docs and ops", "print-book audit", "tooling".
 * Each row holds exactly the fields kind, pick, second, evidence,
 * evidence_date, base_line.
 *   pick          the model of the first qualified source, or the exact
 *                 words "no pick yet: not enough evidence"
 *   second        the second qualified model of that source, or null
 *   evidence      the source, the number, and the count (spec D18 PM
 *                 2026-11-17): "page B producer: accept <n> %, <count>
 *                 tasks", "track A: worst <n> (n=<count>)", "print-audit:
 *                 <x> of <y> (n=<y>)", "build routes: <family>=<route>
 *                 [<score>]; ...", or the exact words "no pick yet" for
 *                 a row with no source.
 *   evidence_date the outcomes export date, the last complete track A pass
 *                 date, the Build data date, or the tracks export date for
 *                 the docs and ops pick
 *   base_line     null, except the highest build total on the app code row,
 *                 the highest tests total on the test writing row, and the
 *                 highest docs-and-ops total on the docs and ops row. The
 *                 base line never picks and never changes a pick.
 *
 * `real-work.json` is the output of `real-work.ts --manifest` (schema
 * `model-guide-real-work/2`). It holds the producer and the checker table
 * and the per-role rows; it has no work-type split (spec D16 "Data
 * source"). A page B producer row qualifies with 5 tasks or more and a
 * first-round rate (ruling Q1: the test writing row reads the producer role
 * `red`). A page B gate row qualifies with 5 runs or more, an allowed
 * model, and an AA net score above 0 (PM 2026-11-18). A track A route
 * qualifies with state "complete" and 3 complete passes; a provisional pass
 * counts (spec D13). When the first source has no qualified model the second
 * source picks.
 *
 * Ruling Q2 (PM, 2026-11-15): with no complete track A rank the code review
 * pick is the exact no-pick words, even when the page B checker table holds
 * a qualified model. The app code row reads the Build scores through the
 * session route families. The docs and ops row ranks Arm A models by total
 * from its track table. The tooling row has no source and shows the no-pick
 * words.
 *
 * The print-audit second source reads the tool output of task 2.4b: a route
 * name maps to its "x of y" result, and the rank orders the blockers found,
 * highest first. It never iterates the summary keys as routes.
 *
 * Inputs are read as own entries only. A `__proto__` name stays an ordinary
 * map entry (the tables are read into maps and arrays), so no hostile name
 * becomes a row or a route of the output file.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUTPUT_NAME = "model-guide.json";
const SCHEMA = "model-guide-overview/1";
const NO_PICK = "no pick yet: not enough evidence";
const NO_PICK_EVIDENCE = "no pick yet";
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
  routes: string | null;
  benchmark: string;
  tracks: string;
  today: string;
  out: string;
}

const FLAGS: Record<string, keyof Args> = {
  "--real-work": "realWork",
  "--scores": "scores",
  "--print-audit": "printAudit",
  "--routes": "routes",
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
    routes: null,
    benchmark: "",
    tracks: "",
    today: "",
    out: "",
  };
  let i = 0;
  while (i < argv.length) {
    const flag = argv[i];
    // Own keys only: `__proto__`, `constructor`, and `toString` are
    // inherited names, not flags of this tool.
    const key = Object.hasOwn(FLAGS, flag) ? FLAGS[flag] : undefined;
    const value = argv[i + 1] ?? "";
    if (key === undefined || value === "" || value.startsWith("--")) {
      refuse("args");
    }
    args[key] = value;
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

/** Real work page B data (the tool output of schema
 * `model-guide-real-work/2`). The three tables are kept as arrays; the role
 * names are read into a Map, so a name such as `__proto__` stays an
 * ordinary key. */
interface RealWork {
  exportDate: string;
  producer: any[];
  checker: any[];
  byRole: Map<string, any[]>;
}

function readRealWork(file: string): RealWork {
  const doc = readJsonFile(file, "real-work");
  if (!isObject(doc) || !isObject(doc.source)) refuse("real-work");
  const exportDate =
    asDate(doc.source.export_date) ?? asDate(doc.source.generated_on);
  if (exportDate === null) refuse("real-work");
  if (!Array.isArray(doc.producer) || !Array.isArray(doc.checker)) refuse("real-work");
  const byRole = new Map<string, any[]>();
  if (isObject(doc.by_role)) {
    for (const [name, rows] of Object.entries(doc.by_role)) {
      if (!Array.isArray(rows)) refuse("real-work");
      byRole.set(name, rows);
    }
  }
  return {
    exportDate,
    producer: doc.producer,
    checker: doc.checker,
    byRole,
  };
}

interface RouteRank {
  route: string;
  worst: number;
  worstRecall: number;
  median: number;
  passes: Array<{ date: string; score: number }>;
  lastDate: string;
}

/** The median of the values; for an even count the mean of the two middle
 * values. */
function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The track A rank of spec D13. A route qualifies with a complete state
 * and 3 complete passes; the rank orders the worst pass score, highest
 * first. A tie goes to the higher worst blocker recall, and then to the
 * higher median score. A missing or unreadable score file gives an empty
 * rank. */
function readTrackARank(file: string | null): RouteRank[] {
  if (file === null || !existsSync(file) || !statSync(file).isFile()) return [];
  const doc = readJsonFile(file, "scores");
  if (!isObject(doc) || !Array.isArray(doc.routes)) refuse("scores");
  const rank: RouteRank[] = [];
  for (const route of doc.routes) {
    if (!isObject(route) || typeof route.route !== "string") refuse("scores");
    if (typeof route.state !== "string" || !Array.isArray(route.passes)) refuse("scores");
    if (route.state !== "complete") continue;
    const passes: Array<{ date: string; score: number; recall: number }> = [];
    for (const pass of route.passes) {
      if (!isObject(pass)) continue;
      // Spec D13: a provisional pass stays complete. It counts for the
      // 3-pass threshold, and it does not remove the rank of the route.
      if (pass.state !== "complete" && pass.state !== "provisional") continue;
      const date = asDate(pass.date);
      if (date === null || typeof pass.score !== "number" || !Number.isFinite(pass.score)) {
        refuse("scores");
      }
      const recall =
        typeof pass.blocker_recall === "number" && Number.isFinite(pass.blocker_recall)
          ? pass.blocker_recall
          : 0;
      passes.push({ date, score: pass.score, recall });
    }
    if (passes.length < TRACK_A_PASSES) continue;
    passes.sort((a, b) => a.date.localeCompare(b.date));
    const worst = Math.min(...passes.map((pass) => pass.score));
    const worstRecall = Math.min(...passes.map((pass) => pass.recall));
    const median = medianOf(passes.map((pass) => pass.score));
    rank.push({
      route: route.route,
      worst,
      worstRecall,
      median,
      passes,
      lastDate: passes[passes.length - 1].date,
    });
  }
  // Spec D13: worst score, then worst blocker recall, then median score.
  rank.sort(
    (a, b) =>
      b.worst - a.worst ||
      b.worstRecall - a.worstRecall ||
      b.median - a.median ||
      a.route.localeCompare(b.route),
  );
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

interface SessionRoute {
  family: string;
  route: string;
}

interface BuildModel {
  route: string;
  total: number;
}

interface BuildData {
  models: BuildModel[];
  baseLine: number;
  date: string | null;
}

/** The session route families. The default file sits beside this tool. */
function readRoutes(file: string | null): SessionRoute[] {
  const path = file ?? join(import.meta.dirname, "routes.json");
  const doc = readJsonFile(path, "routes");
  if (!Array.isArray(doc)) refuse("routes");
  const routes: SessionRoute[] = [];
  for (const row of doc) {
    if (
      !isObject(row) ||
      typeof row.family !== "string" ||
      row.family === "" ||
      typeof row.route !== "string" ||
      row.route === ""
    ) {
      refuse("routes");
    }
    routes.push({ family: row.family, route: row.route });
  }
  return routes;
}

function readBuild(file: string): BuildData {
  const doc = readJsonFile(file, "benchmark");
  if (!isObject(doc) || !Array.isArray(doc.models)) refuse("benchmark");
  const models: BuildModel[] = [];
  for (const model of doc.models) {
    if (
      !isObject(model) ||
      typeof model.provider_model !== "string" ||
      !isObject(model.score) ||
      typeof model.score.total !== "number" ||
      !Number.isFinite(model.score.total)
    ) {
      continue;
    }
    models.push({ route: model.provider_model, total: model.score.total });
  }
  if (models.length === 0) refuse("benchmark");
  return {
    models,
    baseLine: Math.max(...models.map((model) => model.total)),
    date: asDate(doc.generated_at),
  };
}

/** The route without its effort variant or context-key suffix. */
function routeBase(route: string): string {
  return route.split("#", 1)[0].replace(/\[[^\]]+\]$/, "");
}

/** The model id of a route. */
function modelId(route: string): string {
  const base = routeBase(route);
  return base.slice(base.indexOf("/") + 1).toLowerCase();
}

interface TrackTables {
  testsBaseLine: number;
  docsAndOps: Source;
  docsAndOpsBaseLine: number | null;
}

/** Read the tests base line and the optional docs-and-ops rank from tracks.json. */
function readTrackTables(file: string, fallbackDate: string): TrackTables {
  const doc = readJsonFile(file, "tracks");
  const models = isObject(doc) && isObject(doc.tracks) && isObject(doc.tracks.tests)
    ? doc.tracks.tests.models
    : null;
  if (!Array.isArray(models)) refuse("tracks");
  const totals = models
    .map((model: any) => (isObject(model) ? model.total : undefined))
    .filter((total: unknown) => typeof total === "number" && Number.isFinite(total));
  if (totals.length === 0) refuse("tracks");
  const testsBaseLine = Math.max(...totals);

  const docsTrack = isObject(doc) && isObject(doc.tracks) && Object.hasOwn(doc.tracks, "docs-and-ops")
    ? doc.tracks["docs-and-ops"]
    : null;
  if (docsTrack === null) {
    return { testsBaseLine, docsAndOps: noSource(fallbackDate), docsAndOpsBaseLine: null };
  }
  if (!isObject(docsTrack) || !Array.isArray(docsTrack.models)) refuse("tracks");
  const allTotals = docsTrack.models
    .map((model: any) => (isObject(model) ? model.total : undefined))
    .filter((total: unknown) => typeof total === "number" && Number.isFinite(total));
  const docsAndOpsBaseLine = allTotals.length > 0 ? Math.max(...allTotals) : null;
  const armA = docsTrack.models
    .filter((model: any) =>
      isObject(model) && model.arm === "a" && typeof model.model === "string" &&
      typeof model.total === "number" && Number.isFinite(model.total))
    .sort((a: any, b: any) => b.total - a.total || a.model.localeCompare(b.model));
  if (armA.length === 0) {
    return { testsBaseLine, docsAndOps: noSource(fallbackDate), docsAndOpsBaseLine };
  }
  const date = asDate(doc.generated_at);
  if (date === null) refuse("tracks");
  const best = armA[0];
  return {
    testsBaseLine,
    docsAndOps: {
      pick: best.model,
      second: armA.length > 1 ? armA[1].model : null,
      evidence: `track A: worst ${best.total.toFixed(1)} (n=${armA.length})`,
      date,
    },
    docsAndOpsBaseLine,
  };
}

/** One pick source: the model, the second choice, the evidence cell, and
 * the evidence date. */
interface Source {
  pick: string;
  second: string | null;
  evidence: string;
  date: string;
}

/** A page B producer role table of real-work.json, already ranked by the
 * tool. A row qualifies with 5 tasks or more, a first-round rate, and an
 * allowed model (spec D18). The evidence cell holds the source, the rate,
 * and the task count (PM 2026-11-17). */
function fromProducerRole(rows: any[] | undefined, date: string): Source {
  const table = Array.isArray(rows) ? rows : [];
  const qualified = table.filter(
    (row) =>
      isObject(row) &&
      typeof row.model === "string" &&
      typeof row.tasks === "number" &&
      row.tasks >= 5 &&
      isObject(row.first_round) &&
      typeof row.first_round.value === "number" &&
      row.allowed !== false,
  );
  if (qualified.length === 0) {
    return { pick: NO_PICK, second: null, evidence: NO_PICK_EVIDENCE, date };
  }
  const best = qualified[0];
  return {
    pick: best.model,
    second: qualified.length > 1 ? qualified[1].model : null,
    evidence: `page B producer: accept ${Math.round(best.first_round.value * 100)} %, ${best.tasks} tasks`,
    date,
  };
}

/** A row with no source: the no-pick words and no second choice. */
function noSource(date: string): Source {
  return { pick: NO_PICK, second: null, evidence: NO_PICK_EVIDENCE, date };
}

interface RouteSelection {
  family: string;
  route: string;
  score: number | null;
  order: number;
}

/** The app code source. Each family keeps its highest Build score. An exact
 * provider route wins; the same model id on another provider is the fallback.
 * A family without a score keeps its session route. */
function fromBuildRoutes(routes: SessionRoute[], build: BuildData, fallbackDate: string): Source {
  const groups = new Map<string, { order: number; choices: RouteSelection[] }>();
  routes.forEach((spec, order) => {
    const base = routeBase(spec.route);
    const exact = build.models.filter((model) => model.route === base);
    const candidates = exact.length > 0
      ? exact
      : build.models.filter((model) => modelId(model.route) === modelId(base));
    const best = candidates.reduce<BuildModel | null>(
      (current, model) => current === null || model.total > current.total ? model : current,
      null,
    );
    const choice: RouteSelection = {
      family: spec.family,
      route: exact.length > 0 ? spec.route : best?.route ?? spec.route,
      score: best?.total ?? null,
      order,
    };
    const group = groups.get(spec.family);
    if (group === undefined) groups.set(spec.family, { order, choices: [choice] });
    else group.choices.push(choice);
  });
  const selections = [...groups.values()]
    .sort((a, b) => a.order - b.order)
    .map((group) => {
      const scoredChoices = group.choices.filter((choice) => choice.score !== null);
      const best = scoredChoices.length === 0
        ? group.choices[0]
        : scoredChoices.reduce(
            (current, choice) =>
              (choice.score as number) > (current.score as number) ? choice : current,
          );
      return { ...best, order: group.order };
    });
  const scored = selections
    .filter((selection) => selection.score !== null)
    .sort((a, b) => (b.score as number) - (a.score as number) || a.order - b.order);
  if (scored.length === 0) return noSource(fallbackDate);
  const evidence = `build routes: ${selections
    .map((selection) =>
      `${selection.family}=${selection.route}${selection.score === null ? "" : ` ${selection.score.toFixed(1)}`}`,
    )
    .join("; ")}`;
  return {
    pick: scored[0].route,
    second: scored.length > 1 ? scored[1].route : null,
    evidence,
    date: build.date ?? fallbackDate,
  };
}

/** The track A rank. Ruling Q2: with no complete rank the pick is the
 * no-pick words, and the page B checker table does not pick for code
 * review. */
function fromTrackA(rank: RouteRank[], exportDate: string): Source {
  if (rank.length === 0) {
    return {
      pick: NO_PICK,
      second: null,
      evidence: "track A: no complete rank (n=0)",
      date: exportDate,
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
function fromPrintAudit(routes: AuditRoute[], exportDate: string): Source {
  if (routes.length === 0) {
    return {
      pick: NO_PICK,
      second: null,
      evidence: "print-audit: no route (n=0)",
      date: exportDate,
    };
  }
  const best = routes[0];
  return {
    pick: best.route,
    second: routes.length > 1 ? routes[1].route : null,
    evidence: `print-audit: ${best.text} (n=${best.total})`,
    date: exportDate,
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
  const routes = readRoutes(args.routes);
  const build = readBuild(args.benchmark);

  const exportDate = realWork.exportDate;
  const trackTables = readTrackTables(args.tracks, exportDate);
  const codeReview = fromTrackA(rank, exportDate);
  // The app code row reads the Build scores through the session route families.
  // The docs and ops row reads its own track table. Tooling keeps its no-pick row.
  const appCode = fromBuildRoutes(routes, build, exportDate);
  const testWriting = fromProducerRole(realWork.byRole.get("red"), exportDate);
  const docsAndOps = trackTables.docsAndOps;
  const printBooks = fromPrintAudit(audit, exportDate);
  const tooling = noSource(exportDate);

  const rows: Row[] = [
    rowOf(KINDS[0], codeReview, null),
    rowOf(KINDS[1], appCode, build.baseLine),
    rowOf(KINDS[2], testWriting, trackTables.testsBaseLine),
    rowOf(KINDS[3], docsAndOps, trackTables.docsAndOpsBaseLine),
    rowOf(KINDS[4], printBooks, null),
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
