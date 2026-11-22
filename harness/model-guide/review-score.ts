/** The scorer of one pass (spec D10, D11, D13, FR-9).
 *
 * Usage:
 *   npx tsx model-guide/review-score.ts score \
 *     --private <dir> --set <set_id> --route <route> --pass <n> \
 *     --date <YYYY-MM-DD> --outputs <dir> --scores <dir> [--verdicts <file>]
 *
 * Exit 0 writes the public score file `<scores>/<set_id>.json`. Exit 2 writes
 * no score file and prints one line `score: <check>` on stdout.
 *
 * `--private`, `--set`, `--route`, `--pass`, `--date`, and `--outputs` are
 * required. `--scores` names the public folder of the score files; the
 * default is `harness/model-guide/data/review-scores`. `--verdicts` names the
 * agreed verdicts of the two judges; it is optional. `--incomplete-reason`
 * names the reason shown on each incomplete route; it is optional. A reason
 * with a credential key shape is refused, and the value is never printed.
 *
 * The private set holds the keys of D7:
 *   <private>/sets/<set_id>/keys/<diff_id>.json
 * The outputs folder holds one raw review per diff:
 *   <outputs>/<diff_id>.txt
 * The verdicts file is a flat JSON object. Each key is a claim id of the form
 * `<diff_id>#C<12 hex>`, and each value is `real-defect`, `false-claim`, or
 * `unclear`. The claim id is route-blind: it is the first 12 hex characters
 * of the SHA-256 of
 * `JSON.stringify([diff_id, file, line, class, severity, title, reason])`.
 * The same claim in two routes gets the same id and the same verdict.
 *
 * The match of spec D10: a finding matches a plant when the file is equal,
 * the line is from `new_lines[0] - 3` to `new_lines[1] + 3`, and the class is
 * in `accepted_classes`. One finding matches at most one plant, and the
 * nearer plant range wins. A plant is found when one finding matches it. A
 * second finding on a found plant is a duplicate, and it is neutral. Only the
 * first 30 findings of a diff count.
 *
 * A finding that matches no plant is neutral before the verdict check:
 *   `false-claim` adds 1 to `false_claims`
 *   `real-defect` adds 1 to `real_defects`
 *   `unclear` marks the pass `provisional`
 * A finding with no verdict stays neutral.
 *
 * A diff whose text holds no JSON block, holds invalid JSON, or holds a
 * finding without `file` or `line` is an invalid review. It adds 1 to
 * `invalid_reviews`, and it has 0 found and 0 false claims. A missing output
 * file is an invalid review too.
 *
 * The weights of spec D6: blocker 5, major 2, minor 1. With `W` the weight
 * sum of every plant of the set, `F` the weight sum of the found plants, and
 * `X` the false claims, the score is `max(0, 100 × F / W − 2 × X)`, rounded
 * to one decimal. The blocker recall is `blockers_found / blockers`, rounded
 * to 4 decimals.
 *
 * The `missed` count of a class or a severity holds the plants that no
 * counted finding pointed at. A finding points at a plant when the file is
 * equal and the line is in the window of the plant. The class of the finding
 * does not matter. A found plant is not missed, because the review reached
 * it. Every plant of an invalid diff is missed, because that diff has no
 * finding at all. The top-level `missed` is the sum of the `by_class` missed
 * values, and it is the sum of the `by_severity` missed values.
 *
 * The score file holds exactly `set_id`, `passes`, and `routes`. A pass
 * record holds exactly:
 *   route, pass, date, state, score, weight, found_weight, found, missed,
 *   false_claims, blockers, blockers_found, blocker_recall, invalid_reviews,
 *   real_defects, by_class, by_severity
 * A route record holds exactly:
 *   route, state, passes, worst, median, best, worst_blocker_recall, rank
 * An incomplete route also holds `incomplete_reason` when `--incomplete-reason`
 * was given. A complete route and a pass record never hold it.
 * The `passes` of a route record holds the pass records of that route, in
 * pass order. The Phase 2 reader `guide.ts` reads the state, the date, the
 * score, and the recall of each one.
 * The rank is 1-based over the complete routes, ordered by the higher worst
 * score, then the higher worst blocker recall, then the higher median. An
 * incomplete route has `rank: null` and comes after every ranked route. A
 * run replaces the pass with the same route and pass number.
 *
 * The score file holds no finding text, no file path, and no line.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";

const DEFAULT_SCORES = "harness/model-guide/data/review-scores";
const WEIGHTS: Record<string, number> = { blocker: 5, major: 2, minor: 1 };
const CLASSES = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9"];
const SEVERITIES = ["blocker", "major", "minor"];
const MAX_FINDINGS = 30;
const WINDOW = 3;
const COMPLETE_PASSES = 3;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** The credential key shapes of the live runner guard. */
const KEY_SHAPE_RE =
  /sk-[A-Za-z0-9_-]{20,}|xox[bap]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}/;

/** One refusal line on stdout and exit 2. The tool writes no score file. */
function refuse(check: string): never {
  process.stdout.write(`score: ${check}\n`);
  process.exit(2);
}

/** A set id is a plain name: it starts with a letter or a digit, holds only
 * letters, digits, `.`, `_`, and `-`, and holds no `..`. */
const SET_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isPlainSetId(setId: string): boolean {
  return SET_ID_RE.test(setId) && !setId.includes("..");
}

/** The write path of a target inside a named root: the target, then each
 * folder up to and including the root. */
function writePath(target: string, root: string): string[] {
  const paths = [target];
  let dir = dirname(target);
  while (dir !== root && dir.startsWith(`${root}${sep}`)) {
    paths.push(dir);
    dir = dirname(dir);
  }
  if (dir === root) paths.push(root);
  return paths;
}

/** A link on the write path takes the write outside its folder, so the tool
 * refuses before any write. A path that does not exist is not a link. */
function refuseSymlink(paths: string[]): void {
  for (const path of paths) {
    let info;
    try {
      info = lstatSync(path);
    } catch {
      continue;
    }
    if (info.isSymbolicLink()) refuse(`symlink: ${path}`);
  }
}

interface Args {
  privateDir: string;
  setId: string;
  route: string;
  pass: number;
  date: string;
  outputsDir: string;
  scoresDir: string;
  verdictsFile: string | null;
  incompleteReason: string | null;
}

/** The command line. Each flag takes the next token as its value. */
function parseArgs(argv: string[]): Args {
  if (argv[0] !== "score") refuse("unknown command");
  const values: Record<string, string> = {};
  let i = 1;
  while (i < argv.length) {
    const flag = argv[i];
    if (
      flag !== "--private" &&
      flag !== "--set" &&
      flag !== "--route" &&
      flag !== "--pass" &&
      flag !== "--date" &&
      flag !== "--outputs" &&
      flag !== "--scores" &&
      flag !== "--verdicts" &&
      flag !== "--incomplete-reason"
    ) {
      refuse(`unknown flag ${flag}`);
    }
    const value = argv[i + 1] ?? "";
    if (value === "" || value.startsWith("--")) refuse(`${flag} needs a value`);
    values[flag] = value;
    i += 2;
  }
  for (const flag of ["--private", "--set", "--route", "--pass", "--date", "--outputs"]) {
    if (values[flag] === undefined) refuse(`${flag} needs a value`);
  }
  if (!isPlainSetId(values["--set"])) refuse(`set-id: ${values["--set"]}`);
  const pass = Number(values["--pass"]);
  if (!Number.isInteger(pass) || pass < 1) refuse("--pass needs a number");
  if (!DATE_RE.test(values["--date"])) refuse("--date needs a date");
  return {
    privateDir: values["--private"],
    setId: values["--set"],
    route: values["--route"],
    pass,
    date: values["--date"],
    outputsDir: values["--outputs"],
    scoresDir: values["--scores"] ?? DEFAULT_SCORES,
    verdictsFile: values["--verdicts"] ?? null,
    incompleteReason: values["--incomplete-reason"] ?? null,
  };
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface SetPlant {
  id: string;
  file: string;
  first: number;
  last: number;
  class: string;
  accepted: string[];
  severity: string;
  weight: number;
}

/** The plants of one key of the set. */
function readPlants(key: any): SetPlant[] {
  const plants: SetPlant[] = [];
  if (!Array.isArray(key.plants)) return plants;
  for (const plant of key.plants) {
    if (!isObject(plant)) continue;
    const lines = Array.isArray(plant.new_lines) ? plant.new_lines : [];
    const first = typeof lines[0] === "number" ? lines[0] : 0;
    const last = typeof lines[lines.length - 1] === "number" ? lines[lines.length - 1] : first;
    const severity = typeof plant.severity === "string" ? plant.severity : "";
    plants.push({
      id: typeof plant.id === "string" ? plant.id : "",
      file: typeof plant.file === "string" ? plant.file : "",
      first,
      last,
      class: typeof plant.class === "string" ? plant.class : "",
      accepted: Array.isArray(plant.accepted_classes)
        ? plant.accepted_classes.filter((name: unknown) => typeof name === "string")
        : [],
      severity,
      weight: WEIGHTS[severity] ?? 0,
    });
  }
  return plants;
}

/** The answer text of one raw output (plan task 4.13t, ADV-P4B-1). A real
 * `opencode run --format json` call prints one JSON event per line: a
 * `{"type":"text",...,"part":{"type":"text","text":"..."}}` event holds
 * one text block, and the answer is the joined text blocks. A plain answer
 * holds no event line and is returned unchanged. The same decoder lives in
 * `judge-run.sh` and `adjudicate.ts`: the committed adversarial fixture
 * copies only the runner and `quota.ts` into its temp repo, so a separate
 * shared module cannot reach the judge runner there. A `result` branch
 * never wins over the text events, so a forged result branch after the
 * fenced answer is refused (task 4.15, Review A N13). A result-only
 * stream still decodes (ADV-P4B AJ1). */
function decodeAnswerText(raw: string): string {
  const parts: string[] = [];
  const resultParts: string[] = [];
  // The fragments of one session message (task 4.16): the server splits
  // streamed text at an arbitrary character, so the fragments rejoin
  // exactly only with the empty string. Event-stream texts hold whole
  // lines and keep the newline join below.
  const msgParts: string[] = [];
  const msgResults: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim();
    if (!text.startsWith("{")) continue;
    let event: any;
    try {
      event = JSON.parse(text);
    } catch {
      continue;
    }
    if (event === null || typeof event !== "object" || Array.isArray(event)) continue;
    const part = event.part;
    if (
      event.type === "text" &&
      part !== null &&
      typeof part === "object" &&
      !Array.isArray(part) &&
      typeof part.text === "string"
    ) {
      parts.push(part.text);
      continue;
    }
    // The result-event shape of the ADV-P4B AJ1 fixture.
    if (event.type === "result" && typeof event.text === "string") resultParts.push(event.text);
    // The session message shape of the live-server path (task 4.16, spec
    // D14): one message line holds a `parts` array (the OpenChamber session
    // message read), and the real assistant message holds a `content`
    // array. A text entry wins over a result entry, and a result-only
    // payload still decodes, the same rule as the event stream above.
    const collection = Array.isArray(event.parts)
      ? event.parts
      : Array.isArray(event.content)
        ? event.content
        : null;
    if (collection !== null) {
      for (const entry of collection) {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
        if (entry.type === "text" && typeof entry.text === "string") msgParts.push(entry.text);
        else if (entry.type === "result" && typeof entry.text === "string") {
          msgResults.push(entry.text);
        }
      }
      continue;
    }
  }
  if (msgParts.length > 0) return refuseResultBranch(msgParts.join(""));
  if (parts.length > 0) return refuseResultBranch(parts.join("\n"));
  if (msgResults.length > 0) return refuseResultBranch(msgResults.join(""));
  if (resultParts.length > 0) return refuseResultBranch(resultParts.join("\n"));
  return refuseResultBranch(raw);
}

/** A forged `result` branch smuggled as a text line never reaches the
 * fence scan (task 4.15, Review A N13). Only nested lines are refused, so
 * a top-level result event still decodes (ADV-P4B AJ1). */
function refuseResultBranch(answer: string): string {
  return answer
    .split("\n")
    .filter((line) => {
      if (!line.trim().startsWith("{")) return true;
      try {
        const doc = JSON.parse(line.trim());
        return !(doc !== null && typeof doc === "object" && !Array.isArray(doc) && doc.type === "result");
      } catch {
        return true;
      }
    })
    .join("\n");
}

/** The findings of one output text, or null when the review is invalid.
 * The raw output of a real call is a `--format json` event stream, so the
 * answer text is decoded first (plan task 4.13t, ADV-P4B-1). */
function readFindings(raw: string): any[] | null {
  const text = decodeAnswerText(raw);
  const marked = text.indexOf("```json");
  const fence = marked >= 0 ? "```json" : "```";
  const open = text.indexOf(fence);
  if (open === -1) return null;
  const bodyStart = open + fence.length;
  const close = text.indexOf("```", bodyStart);
  if (close === -1) return null;
  let doc: any;
  try {
    doc = JSON.parse(text.slice(bodyStart, close).trim());
  } catch {
    return null;
  }
  if (!isObject(doc) || !Array.isArray(doc.findings)) return null;
  for (const finding of doc.findings) {
    if (!isObject(finding)) return null;
    if (typeof finding.file !== "string" || finding.file === "") return null;
    if (typeof finding.line !== "number" || !Number.isFinite(finding.line)) return null;
  }
  return doc.findings;
}

/** The route-blind claim id of a finding (spec D11, ruling P3A1-1). It is
 * the first 12 hex characters of the SHA-256 of the claim tuple. */
function claimId(diffId: string, finding: any): string {
  const canonical = JSON.stringify([
    diffId,
    typeof finding.file === "string" ? finding.file : "",
    typeof finding.line === "number" ? finding.line : 0,
    typeof finding.class === "string" ? finding.class : "",
    typeof finding.severity === "string" ? finding.severity : "",
    typeof finding.title === "string" ? finding.title : "",
    typeof finding.reason === "string" ? finding.reason : "",
  ]);
  return `${diffId}#C${createHash("sha256").update(canonical).digest("hex").slice(0, 12)}`;
}

/** The lines between the finding and the plant range. */
function distanceTo(line: number, plant: SetPlant): number {
  if (line < plant.first) return plant.first - line;
  if (line > plant.last) return line - plant.last;
  return 0;
}

/** The plant that a finding matches, or null. The nearer plant wins. */
function nearestPlant(finding: any, plants: SetPlant[]): SetPlant | null {
  let best: SetPlant | null = null;
  let bestDistance = Infinity;
  for (const plant of plants) {
    if (plant.file !== finding.file) continue;
    if (finding.line < plant.first - WINDOW || finding.line > plant.last + WINDOW) continue;
    if (!plant.accepted.includes(finding.class)) continue;
    const gap = distanceTo(finding.line, plant);
    if (gap < bestDistance) {
      bestDistance = gap;
      best = plant;
    }
  }
  return best;
}

interface Counts {
  found: number;
  foundWeight: number;
  falseClaims: number;
  realDefects: number;
  invalidReviews: number;
  blockersFound: number;
  provisional: boolean;
  byClass: Record<string, { found: number; missed: number }>;
  bySeverity: Record<string, { found: number; missed: number }>;
}

/** The counts of one pass over the whole set. */
function scorePass(
  keysDir: string,
  outputsDir: string,
  verdicts: Record<string, string>,
  setPlants: SetPlant[],
): Counts {
  const counts: Counts = {
    found: 0,
    foundWeight: 0,
    falseClaims: 0,
    realDefects: 0,
    invalidReviews: 0,
    blockersFound: 0,
    provisional: false,
    byClass: {},
    bySeverity: {},
  };
  for (const name of CLASSES) counts.byClass[name] = { found: 0, missed: 0 };
  for (const name of SEVERITIES) counts.bySeverity[name] = { found: 0, missed: 0 };

  const names = readdirSync(keysDir).filter((name) => name.endsWith(".json")).sort();
  for (const name of names) {
    const diffId = basename(name, ".json");
    const key = JSON.parse(readFileSync(join(keysDir, name), "utf8"));
    const plants = readPlants(key);
    const outputPath = join(outputsDir, `${diffId}.txt`);
    let findings: any[] | null = null;
    if (existsSync(outputPath) && statSync(outputPath).isFile()) {
      findings = readFindings(readFileSync(outputPath, "utf8"));
    }
    if (findings === null) {
      counts.invalidReviews += 1;
      // An invalid review has no finding, so every plant of the diff is
      // missed at every level.
      for (const plant of plants) {
        if (plant.class in counts.byClass) counts.byClass[plant.class].missed += 1;
        if (plant.severity in counts.bySeverity) counts.bySeverity[plant.severity].missed += 1;
      }
      continue;
    }
    const foundPlants = new Set<string>();
    const pointedPlants = new Set<string>();
    const counted = findings.slice(0, MAX_FINDINGS);
    for (const [index, finding] of counted.entries()) {
      // A finding points at every plant of its file whose window holds its
      // line. A pointed plant is not missed, because the review reached it.
      for (const plant of plants) {
        if (plant.file !== finding.file) continue;
        if (finding.line < plant.first - WINDOW || finding.line > plant.last + WINDOW) continue;
        pointedPlants.add(plant.id);
      }
      const plant = nearestPlant(finding, plants);
      if (plant !== null) {
        if (foundPlants.has(plant.id)) continue;
        foundPlants.add(plant.id);
        counts.found += 1;
        counts.foundWeight += plant.weight;
        if (plant.class in counts.byClass) counts.byClass[plant.class].found += 1;
        if (plant.severity in counts.bySeverity) counts.bySeverity[plant.severity].found += 1;
        if (plant.severity === "blocker") counts.blockersFound += 1;
        continue;
      }
      const verdict = verdicts[claimId(diffId, finding)];
      if (verdict === "false-claim") counts.falseClaims += 1;
      else if (verdict === "real-defect") counts.realDefects += 1;
      else if (verdict === "unclear") counts.provisional = true;
    }
    for (const plant of plants) {
      if (foundPlants.has(plant.id) || pointedPlants.has(plant.id)) continue;
      if (plant.class in counts.byClass) counts.byClass[plant.class].missed += 1;
      if (plant.severity in counts.bySeverity) counts.bySeverity[plant.severity].missed += 1;
    }
  }
  return counts;
}

/** The median of the values. For an even count it is the mean of the two
 * middle values. */
function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

interface RouteRecord {
  route: string;
  state: string;
  passes: any[];
  worst: number;
  median: number;
  best: number;
  worst_blocker_recall: number;
  rank: number | null;
  incomplete_reason?: string;
}

/** The route records of every route of the score file. */
function routeRecords(passes: any[], incompleteReason: string | null): RouteRecord[] {
  const routes = new Map<string, any[]>();
  for (const pass of passes) {
    if (!isObject(pass) || typeof pass.route !== "string") continue;
    const list = routes.get(pass.route) ?? [];
    list.push(pass);
    routes.set(pass.route, list);
  }
  const records: RouteRecord[] = [];
  for (const [route, list] of routes) {
    const scores = list.map((pass: any) =>
      typeof pass.score === "number" ? pass.score : 0,
    );
    const recalls = list.map((pass: any) =>
      typeof pass.blocker_recall === "number" ? pass.blocker_recall : 0,
    );
    // The route holds the pass records of the route, in pass order. The
    // Phase 2 reader `guide.ts` reads the state, the date, the score, and
    // the recall of each one.
    const ordered = [...list].sort((a: any, b: any) => {
      const left = typeof a.pass === "number" ? a.pass : 0;
      const right = typeof b.pass === "number" ? b.pass : 0;
      return left - right;
    });
    const record: RouteRecord = {
      route,
      state: list.length >= COMPLETE_PASSES ? "complete" : "incomplete",
      passes: ordered,
      worst: scores.length === 0 ? 0 : Math.min(...scores),
      median: scores.length === 0 ? 0 : medianOf(scores),
      best: scores.length === 0 ? 0 : Math.max(...scores),
      worst_blocker_recall: recalls.length === 0 ? 0 : Math.min(...recalls),
      rank: null,
    };
    if (record.state === "incomplete" && incompleteReason !== null) {
      record.incomplete_reason = incompleteReason;
    }
    records.push(record);
  }
  const complete = records.filter((record) => record.state === "complete");
  complete.sort(
    (a, b) =>
      b.worst - a.worst ||
      b.worst_blocker_recall - a.worst_blocker_recall ||
      b.median - a.median ||
      a.route.localeCompare(b.route),
  );
  complete.forEach((record, index) => {
    record.rank = index + 1;
  });
  return [...complete, ...records.filter((record) => record.state !== "complete")];
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.incompleteReason !== null && KEY_SHAPE_RE.test(args.incompleteReason)) {
    refuse("incomplete-reason");
  }
  const scorePath = join(args.scoresDir, `${args.setId}.json`);
  refuseSymlink(writePath(scorePath, args.scoresDir));
  const keysDir = join(args.privateDir, "sets", args.setId, "keys");
  if (!existsSync(keysDir) || !statSync(keysDir).isDirectory()) {
    refuse(`set-missing ${args.setId}`);
  }

  let verdicts: Record<string, string> = {};
  if (args.verdictsFile !== null) {
    if (!existsSync(args.verdictsFile) || !statSync(args.verdictsFile).isFile()) {
      refuse("verdicts");
    }
    let doc: any;
    try {
      doc = JSON.parse(readFileSync(args.verdictsFile, "utf8"));
    } catch {
      refuse("verdicts");
    }
    if (!isObject(doc)) refuse("verdicts");
    for (const [id, verdict] of Object.entries(doc)) {
      if (typeof verdict === "string") verdicts[id] = verdict;
    }
  }

  const setPlants: SetPlant[] = [];
  for (const name of readdirSync(keysDir).filter((item) => item.endsWith(".json")).sort()) {
    const key = JSON.parse(readFileSync(join(keysDir, name), "utf8"));
    setPlants.push(...readPlants(key));
  }
  const weight = setPlants.reduce((sum, plant) => sum + plant.weight, 0);
  const blockers = setPlants.filter((plant) => plant.severity === "blocker").length;

  const counts = scorePass(keysDir, args.outputsDir, verdicts, setPlants);
  const raw = weight === 0 ? 0 : (100 * counts.foundWeight) / weight - 2 * counts.falseClaims;
  const score = Math.max(0, Math.round(raw * 10) / 10);
  const recall =
    blockers === 0 ? 0 : Math.round((counts.blockersFound / blockers) * 10000) / 10000;

  // The top-level missed is the sum of the by_class missed values.
  const missed = CLASSES.reduce((sum, name) => sum + counts.byClass[name].missed, 0);

  const record = {
    route: args.route,
    pass: args.pass,
    date: args.date,
    state: counts.provisional ? "provisional" : "complete",
    score,
    weight,
    found_weight: counts.foundWeight,
    found: counts.found,
    missed,
    false_claims: counts.falseClaims,
    blockers,
    blockers_found: counts.blockersFound,
    blocker_recall: recall,
    invalid_reviews: counts.invalidReviews,
    real_defects: counts.realDefects,
    by_class: counts.byClass,
    by_severity: counts.bySeverity,
  };

  let passes: any[] = [];
  if (existsSync(scorePath) && statSync(scorePath).isFile()) {
    let doc: any;
    try {
      doc = JSON.parse(readFileSync(scorePath, "utf8"));
    } catch {
      refuse("score-file");
    }
    if (!isObject(doc) || !Array.isArray(doc.passes)) refuse("score-file");
    passes = doc.passes;
  }
  const kept = passes.filter(
    (pass: any) => !(isObject(pass) && pass.route === args.route && pass.pass === args.pass),
  );
  const next = [...kept, record];

  const manifest = {
    set_id: args.setId,
    passes: next,
    routes: routeRecords(next, args.incompleteReason),
  };

  mkdirSync(args.scoresDir, { recursive: true });
  writeFileSync(scorePath, `${JSON.stringify(manifest, null, 2)}\n`);
}

main();
