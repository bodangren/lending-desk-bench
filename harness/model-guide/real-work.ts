/** Page B data tool (spec D16 "Data source (PM 2026-11-17)", FR-1 to FR-3).
 *
 * Usage:
 *   npx tsx model-guide/real-work.ts --manifest <file> --out <folder>
 *
 * The manifest is `<sha256>  <size>  <file name>`, one line for each of the
 * three dated data files: `ra-outcomes-<date>.json`, `aa-reliability-<date>
 * .json`, and `allowed-routes-<date>.json` (Q-S2). The tool reads the three
 * files next to the manifest. The read date and the export date are the date
 * in the MANIFEST-<date>.txt file name (Q-S4).
 *
 * Exit 0 writes `<folder>/real-work.json`. Exit 2 writes no output file and
 * prints one line `input-check: <check> <file name>` on stderr (Q-S3). The
 * checks run in this order: manifest, input, sha256, size, json, schema.
 *   manifest a missing manifest, a name that is not a base name, a duplicate
 *            line, or no line for one of the three files
 *   input    a named data file is missing or is not a regular file
 *   sha256   a file does not match the SHA-256 of its manifest line
 *   size     a file does not match the size of its manifest line
 *   json     a file is not JSON
 *   schema   the outcomes file is not an array, the AA file holds no models
 *            object, or the allowed file holds no route array
 * A usage error gives exit 2, one usage line on stderr, and empty stdout.
 *
 * The tool works with own keys only: the tables are Maps and arrays, so a
 * route or model name such as `__proto__` stays an ordinary row. A row whose
 * route is missing or is not a string is left out. A route is stripped at the
 * first " (" because some routes carry a free-text note; the model key is the
 * route without `#<variant>` and `[1m]` (D16).
 *
 * The output holds the producer table, the checker table, the ten role lines
 * of the top block, the per-role rows of D18, the coverage of the footer, and
 * the three source files. It never copies an input file.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const OUTPUT_NAME = "real-work.json";
const SCHEMA = "model-guide-real-work/2";
const MIN_COUNT = 5;
const NET_SCORE_GATE = 20;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MANIFEST_RE = /^MANIFEST-(\d{4}-\d{2}-\d{2})\.txt$/;
const SUM_LINE_RE = /^([0-9a-f]{64}) {2}(\d+) {2}(.+)$/;

const PRODUCER_ROLES = new Set(["green", "red", "coder", "small", "strategy", "record"]);
const GATE_ROLES = new Set([
  "review-a",
  "review-b",
  "review-c",
  "adversarial",
  "acceptance",
  "phase-acceptance",
  "final-acceptance",
]);

/** The top block lines, in the order of spec D16 rule 8. */
const ROLES: Array<{ id: string; label: string; kind: "producer" | "gate" }> = [
  { id: "red", label: "Red", kind: "producer" },
  { id: "green", label: "Green", kind: "producer" },
  { id: "coder", label: "Coder", kind: "producer" },
  { id: "review-a", label: "Review A", kind: "gate" },
  { id: "review-b", label: "Review B", kind: "gate" },
  { id: "review-c", label: "Review C", kind: "gate" },
  { id: "adversarial", label: "Adversarial", kind: "gate" },
  { id: "acceptance", label: "Acceptance", kind: "gate" },
  { id: "phase-acceptance", label: "Phase acceptance", kind: "gate" },
  { id: "final-acceptance", label: "Final acceptance", kind: "gate" },
];

const KIND_PREFIX: Record<FileKind, string> = {
  outcomes: "ra-outcomes-",
  aa: "aa-reliability-",
  allowed: "allowed-routes-",
};
const KIND_ORDER: FileKind[] = ["outcomes", "aa", "allowed"];

type FileKind = "outcomes" | "aa" | "allowed";

function usage(): never {
  process.stderr.write("usage: real-work.ts --manifest <file> --out <folder>\n");
  process.exit(2);
}

function refuse(check: string, name: string): never {
  process.stderr.write(`input-check: ${check} ${name}\n`);
  process.exit(2);
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A finite number at or above 0, or null. A data error leaves the value
 * out of its average (it never counts as a zero). */
function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function count(value: unknown): number {
  return numberOrNull(value) ?? 0;
}

/** Strip the free-text note at the first " (" and trim (D16). */
function stripNote(route: string): string {
  const at = route.indexOf(" (");
  return (at < 0 ? route : route.slice(0, at)).trim();
}

/** Remove the `#<variant>` part and the `[1m]` part. The provider stays. */
function modelKey(route: string): string {
  return route.replace(/\[1m\]/g, "").split("#")[0];
}

/** The `#<variant>` part of a route, or null. */
function variantOf(route: string): string | null {
  const at = route.indexOf("#");
  return at < 0 ? null : route.slice(at + 1);
}

/** The last path part of a model key, in lower case, without a `-free`
 * suffix. That name matches a model key or an alias of the AA file. */
function canonicalName(model: string): string {
  const parts = model.split("/");
  let name = (parts[parts.length - 1] ?? model).toLowerCase();
  if (name.endsWith("-free")) name = name.slice(0, -"-free".length);
  return name;
}

function parseArgs(argv: string[]): { manifest: string; out: string } {
  let manifest = "";
  let out = "";
  let i = 0;
  while (i < argv.length) {
    const flag = argv[i];
    const value = argv[i + 1] ?? "";
    if (flag === "--manifest") {
      if (value === "") usage();
      manifest = value;
      i += 2;
    } else if (flag === "--out") {
      if (value === "") usage();
      out = value;
      i += 2;
    } else {
      usage();
    }
  }
  if (!manifest || !out) usage();
  return { manifest, out };
}

function dateOfManifestName(name: string): string | null {
  const match = MANIFEST_RE.exec(name);
  if (!match) return null;
  const date = match[1];
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(time)) return null;
  if (new Date(time).toISOString().slice(0, 10) !== date) return null;
  return DATE_RE.test(date) ? date : null;
}

interface ManifestEntry {
  kind: FileKind;
  name: string;
  sha256: string;
  size: number;
}

/** Read the manifest and claim one base-name entry for each of the three
 * kinds. A line whose name carries no kind prefix fills a free kind. */
function readManifest(
  manifestPath: string,
): { dir: string; date: string; entries: ManifestEntry[] } {
  const givenName = basename(manifestPath);
  if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) {
    refuse("manifest", givenName);
  }
  let real: string;
  try {
    real = realpathSync(manifestPath);
  } catch {
    refuse("manifest", givenName);
  }
  const date = dateOfManifestName(basename(real)) ?? dateOfManifestName(givenName);
  if (date === null) refuse("manifest", givenName);

  let text: string;
  try {
    text = readFileSync(real, "utf8");
  } catch {
    refuse("manifest", givenName);
  }

  const lines = text
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.trim() !== "");

  const claimed = new Map<FileKind, ManifestEntry>();
  const unclaimed: Array<{ name: string; sha256: string; size: number }> = [];
  for (const line of lines) {
    const match = SUM_LINE_RE.exec(line);
    // A line that is not in the `<sha256>  <size>  <file name>` form carries
    // no data and is ignored (test-strategy 13.3).
    if (!match) continue;
    const name = match[3].trim();
    if (name === "" || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
      refuse("manifest", name);
    }
    const entry = { name, sha256: match[1], size: Number(match[2]) };
    if (!Number.isSafeInteger(entry.size)) refuse("manifest", name);
    const kind = KIND_ORDER.find((item) => name.startsWith(KIND_PREFIX[item]));
    if (kind !== undefined) {
      if (claimed.has(kind)) refuse("manifest", name);
      claimed.set(kind, { ...entry, kind });
    } else {
      unclaimed.push(entry);
    }
  }

  for (const entry of unclaimed) {
    const free = KIND_ORDER.find((kind) => !claimed.has(kind));
    if (free === undefined) refuse("manifest", entry.name);
    claimed.set(free, { ...entry, kind: free });
  }
  for (const kind of KIND_ORDER) {
    if (!claimed.has(kind)) refuse("manifest", `${KIND_PREFIX[kind]}${date}.json`);
  }

  return {
    dir: dirname(real),
    date,
    entries: KIND_ORDER.map((kind) => claimed.get(kind)!),
  };
}

interface ProducerAccum {
  model: string;
  kind: "producer";
  routes: Set<string>;
  roles: Set<string>;
  routeCounts: Map<string, number>;
  tasks: number;
  accepted: number;
  rateSum: number;
  rateAccepted: number;
  reworkSum: number;
  reworkTasks: number;
  cleanupSum: number;
  cleanupTasks: number;
  tokenSum: number;
  tokenAccepted: number;
  runs: number;
  pass: number;
  fail: number;
  error: number;
  noVerdict: number;
  findings: number;
  escapes: number;
}

interface GateAccum {
  model: string;
  kind: "gate";
  routes: Set<string>;
  roles: Set<string>;
  routeCounts: Map<string, number>;
  decided: number;
  pass: number;
  fail: number;
  error: number;
  noVerdict: number;
  findings: number;
  escapes: number;
  runs: number;
}

type Accum = ProducerAccum | GateAccum;

function newProducer(model: string): ProducerAccum {
  return {
    model,
    kind: "producer",
    routes: new Set(),
    roles: new Set(),
    routeCounts: new Map(),
    tasks: 0,
    accepted: 0,
    rateSum: 0,
    rateAccepted: 0,
    reworkSum: 0,
    reworkTasks: 0,
    cleanupSum: 0,
    cleanupTasks: 0,
    tokenSum: 0,
    tokenAccepted: 0,
    runs: 0,
    pass: 0,
    fail: 0,
    error: 0,
    noVerdict: 0,
    findings: 0,
    escapes: 0,
  };
}

function newGate(model: string): GateAccum {
  return {
    model,
    kind: "gate",
    routes: new Set(),
    roles: new Set(),
    routeCounts: new Map(),
    decided: 0,
    pass: 0,
    fail: 0,
    error: 0,
    noVerdict: 0,
    findings: 0,
    escapes: 0,
    runs: 0,
  };
}

/** Add one row to its model accumulator. The averages keep their own
 * denominators, and a null value leaves the denominator (D16, DS5, DS6). */
function addRow(acc: Accum, row: Record<string, any>, route: string): void {
  acc.routes.add(route);
  if (row.role !== undefined && PRODUCER_ROLES.has(row.role)) acc.roles.add(row.role);
  else if (row.role !== undefined && GATE_ROLES.has(row.role)) acc.roles.add(row.role);
  const counted = acc.kind === "producer" ? count(row.tasks) : count(row.decided);
  acc.routeCounts.set(route, (acc.routeCounts.get(route) ?? 0) + counted);

  if (acc.kind === "producer") {
    const tasks = count(row.tasks);
    acc.tasks += tasks;
    acc.accepted += count(row.accepted);
    const rate = numberOrNull(row.first_round_rate);
    if (rate !== null && rate <= 1) {
      acc.rateSum += rate * count(row.accepted);
      acc.rateAccepted += count(row.accepted);
    }
    const rework = numberOrNull(row.mean_rework_rounds);
    if (rework !== null) {
      acc.reworkSum += rework * tasks;
      acc.reworkTasks += tasks;
    }
    const cleanup = numberOrNull(row.cleanup_share);
    if (cleanup !== null && cleanup <= 1) {
      acc.cleanupSum += cleanup * tasks;
      acc.cleanupTasks += tasks;
    }
    const tokens = numberOrNull(row.tokens_per_accepted);
    if (tokens !== null) {
      acc.tokenSum += tokens * count(row.accepted);
      acc.tokenAccepted += count(row.accepted);
    }
    acc.runs += count(row.runs);
    acc.pass += count(row.pass);
    acc.fail += count(row.fail);
    acc.error += count(row.error);
    acc.noVerdict += count(row.no_verdict);
    acc.findings += count(row.findings);
    acc.escapes += count(row.escaped_findings);
    return;
  }

  acc.decided += count(row.decided);
  acc.pass += count(row.pass);
  acc.fail += count(row.fail);
  acc.error += count(row.error);
  acc.noVerdict += count(row.no_verdict);
  acc.findings += count(row.findings);
  acc.escapes += count(row.escapes);
  acc.runs += count(row.runs);
}

interface AaEntry {
  netScore?: unknown;
  rated?: unknown;
  byEffort?: Record<string, { netScore?: unknown }>;
  aliases?: unknown[];
}

/** The AA `models` block, indexed by lower-case model key and alias. */
function aaIndex(models: Record<string, unknown>): Map<string, AaEntry> {
  const index = new Map<string, AaEntry>();
  for (const [key, value] of Object.entries(models)) {
    if (!isObject(value)) continue;
    const entry = value as AaEntry;
    const name = key.toLowerCase();
    if (!index.has(name)) index.set(name, entry);
    if (Array.isArray(entry.aliases)) {
      for (const alias of entry.aliases) {
        if (typeof alias !== "string") continue;
        const aliasName = alias.toLowerCase();
        if (!index.has(aliasName)) index.set(aliasName, entry);
      }
    }
  }
  return index;
}

function netScoreValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The AA net score of a merged row: the `byEffort` entry of the route with
 * the most counted runs, else the primary row. No match, or `rated` false,
 * gives null ("not rated"). */
function netScoreOf(acc: Accum, index: Map<string, AaEntry>): number | null {
  const entry = index.get(canonicalName(acc.model));
  if (entry === undefined || entry.rated === false) return null;
  let bestVariant: string | null = null;
  let bestCount = -1;
  for (const [route, counted] of acc.routeCounts) {
    if (counted > bestCount) {
      bestCount = counted;
      bestVariant = variantOf(route);
    }
  }
  if (bestVariant !== null && isObject(entry.byEffort)) {
    const effort = entry.byEffort[bestVariant];
    if (isObject(effort)) return netScoreValue(effort.netScore);
  }
  return netScoreValue(entry.netScore);
}

/** The allowed model keys: an entry of `allowedRoutes` or
 * `orchestratorRoutes` after the same stripping of `#<variant>` and `[1m]`. */
function allowedKeys(doc: Record<string, any>): Set<string> {
  const keys = new Set<string>();
  for (const list of [doc.allowedRoutes, doc.orchestratorRoutes]) {
    if (!Array.isArray(list)) continue;
    for (const value of list) {
      if (typeof value !== "string") continue;
      keys.add(modelKey(value));
    }
  }
  return keys;
}

interface RowLike {
  model: string;
  kind: "producer" | "gate";
  routes: string[];
  roles: string[];
  allowed: boolean;
  not_for_verdicts: boolean;
  net_score: number | null;
  rank: number | null;
  runs: number;
  pass: number;
  fail: number;
  error: number;
  no_result: number;
  blocking_findings: number;
  pass_rate: { value: number | null; n: number };
  tasks?: number;
  accepted?: number;
  first_round?: { value: number | null; n: number };
  mean_rework?: number | null;
  cleanup_share?: number | null;
  tokens_per_accepted?: number | null;
  findings?: number;
  findings_per_run?: number;
  escapes?: number;
  rate_count?: number;
}

function rateOf(pass: number, denominator: number): { value: number | null; n: number } {
  return { value: denominator > 0 ? pass / denominator : null, n: denominator };
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function producerRow(acc: ProducerAccum, index: Map<string, AaEntry>, allowed: Set<string>): RowLike {
  const notAllowed = !allowed.has(acc.model);
  const net = netScoreOf(acc, index);
  return {
    model: acc.model,
    kind: "producer",
    routes: [...acc.routes].sort(),
    roles: [...acc.roles].sort(),
    tasks: acc.tasks,
    accepted: acc.accepted,
    first_round: { value: acc.rateAccepted > 0 ? acc.rateSum / acc.rateAccepted : null, n: acc.rateAccepted },
    mean_rework: acc.reworkTasks > 0 ? roundTo(acc.reworkSum / acc.reworkTasks, 4) : null,
    cleanup_share: acc.cleanupTasks > 0 ? roundTo(acc.cleanupSum / acc.cleanupTasks, 4) : null,
    tokens_per_accepted:
      acc.tokenAccepted > 0 ? roundTo(acc.tokenSum / acc.tokenAccepted, 2) : null,
    runs: acc.runs,
    pass: acc.pass,
    fail: acc.fail,
    error: acc.error,
    no_result: acc.noVerdict,
    blocking_findings: acc.findings,
    escapes: acc.escapes,
    pass_rate: rateOf(acc.pass, acc.pass + acc.fail + acc.error),
    net_score: net,
    allowed: !notAllowed,
    not_for_verdicts: net === null || net < NET_SCORE_GATE,
    rank: null,
    rate_count: acc.tasks,
  };
}

function gateRow(acc: GateAccum, index: Map<string, AaEntry>, allowed: Set<string>): RowLike {
  const net = netScoreOf(acc, index);
  return {
    model: acc.model,
    kind: "gate",
    routes: [...acc.routes].sort(),
    roles: [...acc.roles].sort(),
    runs: acc.decided,
    pass: acc.pass,
    fail: acc.fail,
    error: acc.error,
    no_result: acc.noVerdict,
    blocking_findings: acc.findings,
    escapes: acc.escapes,
    findings: acc.findings,
    findings_per_run: acc.decided > 0 ? roundTo(acc.findings / acc.decided, 4) : 0,
    pass_rate: rateOf(acc.pass, acc.decided),
    net_score: net,
    allowed: allowed.has(acc.model),
    not_for_verdicts: net === null || net < NET_SCORE_GATE,
    rank: null,
    rate_count: acc.decided,
  };
}

function rateValue(row: RowLike): number | null {
  if (row.kind === "producer") return row.first_round?.value ?? null;
  return row.pass_rate.value;
}

function reworkValue(row: RowLike): number | null {
  return row.kind === "producer" ? (row.mean_rework ?? null) : null;
}

function escapesValue(row: RowLike): number {
  return row.escapes ?? 0;
}

function countOfRow(row: RowLike): number {
  return row.kind === "producer" ? (row.tasks ?? 0) : row.runs;
}

/** True when the row meets the minimum and holds a rate, so it ranks. */
function qualifies(row: RowLike): boolean {
  return countOfRow(row) >= MIN_COUNT && rateValue(row) !== null;
}

/** The rank order of D16: the higher rate first, then the lower rework (a
 * producer) or the fewer escapes (a gate), then the higher count, then the
 * model key. */
function compareRows(a: RowLike, b: RowLike): number {
  const rateA = rateValue(a) ?? 0;
  const rateB = rateValue(b) ?? 0;
  if (rateB !== rateA) return rateB - rateA;
  if (a.kind === "producer" && b.kind === "producer") {
    const reworkA = reworkValue(a);
    const reworkB = reworkValue(b);
    const valueA = reworkA === null ? Number.POSITIVE_INFINITY : reworkA;
    const valueB = reworkB === null ? Number.POSITIVE_INFINITY : reworkB;
    if (valueA !== valueB) return valueA < valueB ? -1 : 1;
  } else {
    if (escapesValue(a) !== escapesValue(b)) return escapesValue(a) - escapesValue(b);
  }
  if (countOfRow(b) !== countOfRow(a)) return countOfRow(b) - countOfRow(a);
  return a.model < b.model ? -1 : a.model > b.model ? 1 : 0;
}

function rankRows(rows: RowLike[]): RowLike[] {
  const ranked = rows.filter(qualifies).sort(compareRows);
  ranked.forEach((row, position) => {
    row.rank = position + 1;
  });
  const rest = rows.filter((row) => !qualifies(row));
  rest.sort((a, b) => countOfRow(b) - countOfRow(a) || (a.model < b.model ? -1 : 1));
  return [...ranked, ...rest];
}

interface TopPick {
  model: string;
  rate: number;
  count: number;
  net_score: number | null;
}

function pickOf(rows: RowLike[], kind: "producer" | "gate"): TopPick | null {
  for (const row of rows) {
    if (!qualifies(row)) continue;
    if (!row.allowed) continue;
    if (kind === "gate" && (row.net_score === null || row.net_score < NET_SCORE_GATE)) continue;
    return {
      model: row.model,
      rate: rateValue(row) ?? 0,
      count: countOfRow(row),
      net_score: row.net_score,
    };
  }
  return null;
}

function main(): void {
  const { manifest, out } = parseArgs(process.argv.slice(2));
  const parsed = readManifest(manifest);

  // Integrity before parse (D16, DS2).
  const bytes = new Map<FileKind, Buffer>();
  for (const entry of parsed.entries) {
    const path = join(parsed.dir, entry.name);
    if (!existsSync(path) || !statSync(path).isFile()) refuse("input", entry.name);
    bytes.set(entry.kind, readFileSync(path));
  }
  for (const entry of parsed.entries) {
    const data = bytes.get(entry.kind)!;
    const digest = createHash("sha256").update(data).digest("hex");
    if (digest !== entry.sha256) refuse("sha256", entry.name);
  }
  for (const entry of parsed.entries) {
    if (bytes.get(entry.kind)!.length !== entry.size) refuse("size", entry.name);
  }

  const docs = new Map<FileKind, unknown>();
  for (const entry of parsed.entries) {
    try {
      docs.set(entry.kind, JSON.parse(bytes.get(entry.kind)!.toString("utf8")));
    } catch {
      refuse("json", entry.name);
    }
  }

  const nameOf = (kind: FileKind) => parsed.entries.find((entry) => entry.kind === kind)!.name;
  const outcomes = docs.get("outcomes");
  if (!Array.isArray(outcomes)) refuse("schema", nameOf("outcomes"));
  const aa = docs.get("aa");
  if (!isObject(aa) || !isObject(aa.models)) refuse("schema", nameOf("aa"));
  const allowedDoc = docs.get("allowed");
  if (
    !isObject(allowedDoc) ||
    !Array.isArray(allowedDoc.allowedRoutes) ||
    !Array.isArray(allowedDoc.orchestratorRoutes)
  ) {
    refuse("schema", nameOf("allowed"));
  }

  const index = aaIndex(aa.models);
  const allowed = allowedKeys(allowedDoc);
  const roleKindOf = new Map(ROLES.map((role) => [role.id, role.kind]));

  const producerAccums = new Map<string, ProducerAccum>();
  const gateAccums = new Map<string, GateAccum>();
  const roleAccums = new Map<string, Map<string, Accum>>();
  for (const role of ROLES) roleAccums.set(role.id, new Map());

  let rows = 0;
  const routes = new Set<string>();
  let unknownRows = 0;

  for (const raw of outcomes) {
    if (!isObject(raw)) continue;
    if (typeof raw.route !== "string") continue;
    const route = stripNote(raw.route);
    if (route === "") continue;
    if (raw.kind !== "producer" && raw.kind !== "gate") continue;
    if (typeof raw.role !== "string") continue;
    rows += 1;
    routes.add(route);
    const unknown = route === "unknown";
    if (unknown) {
      unknownRows += 1;
      // The route unknown shows no table row and takes no rank (Q-S10).
      continue;
    }
    const model = modelKey(route);
    if (model === "") continue;
    const isProducer = raw.kind === "producer";
    const role = raw.role;
    const roleKind = roleKindOf.get(role) ?? null;

    if (isProducer) {
      if (!producerAccums.has(model)) producerAccums.set(model, newProducer(model));
      addRow(producerAccums.get(model)!, raw, route);
    } else {
      if (!gateAccums.has(model)) gateAccums.set(model, newGate(model));
      addRow(gateAccums.get(model)!, raw, route);
    }

    if (roleKind !== null) {
      const table = roleAccums.get(role)!;
      if (!table.has(model)) {
        table.set(model, roleKind === "producer" ? newProducer(model) : newGate(model));
      }
      addRow(table.get(model)!, raw, route);
    }
  }

  const producerRows = rankRows(
    [...producerAccums.values()]
      .filter((acc) => acc.tasks > 0)
      .map((acc) => producerRow(acc, index, allowed)),
  );
  const gateRows = rankRows(
    [...gateAccums.values()].map((acc) => gateRow(acc, index, allowed)),
  );

  const byRole: Record<string, RowLike[]> = {};
  const top: Array<{ role: string; label: string; kind: "producer" | "gate"; pick: TopPick | null }> = [];
  for (const role of ROLES) {
    const table = roleAccums.get(role.id)!;
    const roleRows = rankRows(
      [...table.values()].map((acc) =>
        acc.kind === "producer"
          ? producerRow(acc as ProducerAccum, index, allowed)
          : gateRow(acc as GateAccum, index, allowed),
      ),
    );
    byRole[role.id] = roleRows;
    top.push({ role: role.id, label: role.label, kind: role.kind, pick: pickOf(roleRows, role.kind) });
  }

  const unknownShare = rows > 0 ? roundTo((unknownRows / rows) * 100, 1) : 0;
  const outcomesName = nameOf("outcomes");
  const outcomesSha = createHash("sha256").update(bytes.get("outcomes")!).digest("hex");

  const page = {
    schema: SCHEMA,
    source: {
      sha256: outcomesSha,
      generated_on: parsed.date,
      read_date: parsed.date,
      export_date: parsed.date,
      files: parsed.entries.map((entry) => ({
        name: entry.name,
        sha256: entry.sha256,
        size: entry.size,
      })),
    },
    coverage: {
      rows,
      routes: routes.size,
      unknown_rows: unknownRows,
      unknown_share: unknownShare,
    },
    producer: producerRows,
    checker: gateRows,
    top,
    by_role: byRole,
  };

  const text = `${JSON.stringify(page, null, 2)}\n`;
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, OUTPUT_NAME), text);
}

try {
  main();
} catch {
  process.stderr.write("input-check: error real-work\n");
  process.exit(2);
}
