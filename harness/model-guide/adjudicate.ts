/** The adjudication queue and the apply (spec D11, FR-12).
 *
 * Usage:
 *   npx tsx model-guide/adjudicate.ts queue <set_id> \
 *     --private <dir> --raw <dir>
 *   npx tsx model-guide/adjudicate.ts apply <set_id> \
 *     --private <dir> --judge-a <file> --judge-b <file>
 *
 * Exit 0 writes the files of the command. Exit 2 writes no file and prints
 * one line `queue: <check>` or `apply: <check>` on stdout. A flag with no
 * value gives `queue: --<flag> needs a value` or `apply: --<flag> needs a
 * value`.
 *
 * The queue reads the keys of the set:
 *   <private>/sets/<set_id>/keys/<diff_id>.json
 * and the raw outputs of every route:
 *   <raw>/<slug>/<diff_id>.txt
 * The slug is the route name of the run. The queue never reads it and never
 * writes it. A missing file contributes no finding.
 *
 * The queue counts every finding of an output in order, matched or not. The
 * id of an item is route-blind and claim-keyed (spec D11, ruling P3A1-1):
 * `<diff_id>#C<12 hex>`, the first 12 hex characters of the SHA-256 of
 * `JSON.stringify([diff_id, file, line, class, severity, title, reason])`.
 * Two routes that report the same claim get one id, and two different claims
 * get two ids. The scorer of task 3.3 computes the same id and looks up the
 * verdict. A finding that matches a plant of its key (same file, line in
 * `new_lines[0] - 3` to `new_lines[1] + 3`, class in `accepted_classes`) is
 * not queued. A missing or invalid block, or a finding without `file` or
 * `line`, adds no item.
 *
 * Two findings are the same claim when `diff_id`, `file`, `line`, `class`,
 * `severity`, `title`, and `reason` are equal. The queue keeps one item per
 * claim and drops the duplicates of the other routes (spec D11).
 *
 * The queue groups the items by diff id and file and a 3-line window:
 * sorted by line, a line that is more than 2 above the group start opens a
 * new group. The window of a group is `[start, start + 2]`. The queue
 * writes `<private>/sets/<set_id>/adjudication/queue.json`:
 *   {
 *     "set_id": "<set_id>",
 *     "groups": [{
 *       "id": "<diff_id>#G<n>",
 *       "diff_id": "<diff_id>",
 *       "file": "<path>",
 *       "window": [<start>, <start + 2>],
 *       "items": [{
 *         "id": "<diff_id>#C<12 hex>",
 *         "line": <line>,
 *         "claim": {"class", "severity", "title", "reason"}
 *       }]
 *     }]
 *   }
 * The groups are sorted by diff id, then window start. The items are sorted
 * by line, then id. The queue holds no route name and no verdict.
 *
 * The apply reads the queue and the two judge files. Each judge file is a
 * flat JSON object that maps a finding id to `real-defect`, `false-claim`, or
 * `unclear`. Only an equal verdict of both judges counts. A missing or
 * different verdict is `unclear` (the rule of two, spec D11).
 *
 * The apply writes `<private>/sets/<set_id>/adjudication/verdicts.json`, the
 * flat map that `review-score.ts --verdicts` reads:
 *   `real-defect` is neutral and adds the finding to the `real_defects` of
 *   the key of its diff, with exactly `id`, `file`, `new_lines: [line,
 *   line]`, `class: "R"`, `severity`, and `source: "adjudication"`
 *   `false-claim` is a false claim when the scorer runs with the map
 *   `unclear` is neutral and marks the pass `provisional`
 *
 * The apply also writes `<private>/sets/<set_id>/adjudication/real-defects.json`
 * for the PM hand-off:
 *   {"set_id", "real_defects": [{"id", "diff_id", "file", "line", "class",
 *    "severity", "title", "reason"}]}
 *
 * The apply never marks a plant found. A finding at a wrong line or with a
 * wrong class stays unmatched, and it can only become a real defect or a
 * false claim (the no-rescue rule, spec D10, D11).
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";

const VERDICTS = ["real-defect", "false-claim", "unclear"];
/** The window of a plant match: `new_lines[0] - 3` to `new_lines[1] + 3`. */
const MATCH_WINDOW = 3;
/** The window of a group: a line more than 2 above the group start opens a
 * new group, so the window holds 3 lines. */
const GROUP_WINDOW = 2;

/** One refusal line on stdout and exit 2. The tool writes no file. */
function refuse(command: string, check: string): never {
  process.stdout.write(`${command}: ${check}\n`);
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
function refuseSymlink(command: string, paths: string[]): void {
  for (const path of paths) {
    let info;
    try {
      info = lstatSync(path);
    } catch {
      continue;
    }
    if (info.isSymbolicLink()) refuse(command, `symlink: ${path}`);
  }
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface Args {
  setId: string;
  privateDir: string;
  rawDir: string;
  judgeA: string;
  judgeB: string;
}

/** The command line. Each flag takes the next token as its value. */
function parseArgs(argv: string[], command: string): Args {
  const setId = argv[1] ?? "";
  if (setId === "" || setId.startsWith("--")) refuse(command, "set_id needs a value");
  if (!isPlainSetId(setId)) refuse(command, `set-id: ${setId}`);
  const allowed =
    command === "queue" ? ["--private", "--raw"] : ["--private", "--judge-a", "--judge-b"];
  const values: Record<string, string> = {};
  let i = 2;
  while (i < argv.length) {
    const flag = argv[i];
    if (!allowed.includes(flag)) refuse(command, `unknown flag ${flag}`);
    const value = argv[i + 1] ?? "";
    if (value === "" || value.startsWith("--")) refuse(command, `${flag} needs a value`);
    values[flag] = value;
    i += 2;
  }
  for (const flag of allowed) {
    if (values[flag] === undefined) refuse(command, `${flag} needs a value`);
  }
  return {
    setId,
    privateDir: values["--private"],
    rawDir: values["--raw"] ?? "",
    judgeA: values["--judge-a"] ?? "",
    judgeB: values["--judge-b"] ?? "",
  };
}

interface SetPlant {
  file: string;
  first: number;
  last: number;
  class: string;
  accepted: string[];
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
    plants.push({
      file: typeof plant.file === "string" ? plant.file : "",
      first,
      last,
      class: typeof plant.class === "string" ? plant.class : "",
      accepted: Array.isArray(plant.accepted_classes)
        ? plant.accepted_classes.filter((name: unknown) => typeof name === "string")
        : [],
    });
  }
  return plants;
}

/** A finding matches a plant when the file is equal, the line is in the
 * window of the plant, and the class is in the accepted classes. */
function matchesPlant(finding: any, plants: SetPlant[]): boolean {
  for (const plant of plants) {
    if (plant.file !== finding.file) continue;
    if (finding.line < plant.first - MATCH_WINDOW || finding.line > plant.last + MATCH_WINDOW) continue;
    if (!plant.accepted.includes(finding.class)) continue;
    return true;
  }
  return false;
}

/** The answer text of one raw output (plan task 4.13v, Review C 2fdb8f8). A
 * real `opencode run --format json` call prints one JSON event per line: a
 * `{"type":"text",...,"part":{"type":"text","text":"..."}}` event holds one
 * text block, and the answer is the joined text blocks. A plain answer holds
 * no event line and is returned unchanged. The same decoder lives in
 * `judge-run.sh` and `review-score.ts`; three places read a raw output. The
 * committed adversarial fixture copies only the runner and `quota.ts` into
 * its temp repo, so a separate shared module cannot reach the judge runner
 * there. */
function decodeAnswerText(raw: string): string {
  const parts: string[] = [];
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
    if (event.type === "result" && typeof event.text === "string") parts.push(event.text);
  }
  return parts.length === 0 ? raw : parts.join("\n");
}

/** The findings of one output text, or null when the block is missing or
 * invalid. The raw output of a real call is a `--format json` event stream,
 * so the answer text is decoded first (plan task 4.13v, Review C 2fdb8f8). */
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
  return doc.findings;
}

interface Entry {
  diffId: string;
  file: string;
  id: string;
  line: number;
  claim: { class: string; severity: string; title: string; reason: string };
}

/** The claim text of a finding. A missing text is an empty string. */
function claimOf(finding: any): Entry["claim"] {
  return {
    class: typeof finding.class === "string" ? finding.class : "",
    severity: typeof finding.severity === "string" ? finding.severity : "",
    title: typeof finding.title === "string" ? finding.title : "",
    reason: typeof finding.reason === "string" ? finding.reason : "",
  };
}

/** The key of a claim: the same tuple the claim id hashes, so two claims
 * that differ only by a whitespace shift stay two claims. */
function claimKey(diffId: string, file: string, line: number, claim: Entry["claim"]): string {
  return JSON.stringify([diffId, file, line, claim.class, claim.severity, claim.title, claim.reason]);
}

/** The route-blind claim id of a finding (spec D11, ruling P3A1-1). It is
 * the first 12 hex characters of the SHA-256 of the claim tuple. */
function claimId(diffId: string, file: string, line: number, claim: Entry["claim"]): string {
  const canonical = claimKey(diffId, file, line, claim);
  return `${diffId}#C${createHash("sha256").update(canonical).digest("hex").slice(0, 12)}`;
}

interface Group {
  diffId: string;
  file: string;
  start: number;
  items: Entry[];
}

/** The queue file of the set. */
function writeQueue(args: Args): void {
  const dir = join(args.privateDir, "sets", args.setId, "adjudication");
  const queuePath = join(dir, "queue.json");
  refuseSymlink("queue", writePath(queuePath, args.privateDir));
  const keysDir = join(args.privateDir, "sets", args.setId, "keys");
  if (!existsSync(keysDir) || !statSync(keysDir).isDirectory()) {
    refuse("queue", `set missing ${args.setId}`);
  }
  if (!existsSync(args.rawDir) || !statSync(args.rawDir).isDirectory()) {
    refuse("queue", "raw missing");
  }

  const diffIds = readdirSync(keysDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => basename(name, ".json"));
  const plantsByDiff = new Map<string, SetPlant[]>();
  for (const diffId of diffIds) {
    const key = JSON.parse(readFileSync(join(keysDir, `${diffId}.json`), "utf8"));
    plantsByDiff.set(diffId, readPlants(key));
  }
  const slugs = readdirSync(args.rawDir)
    .filter((name) => statSync(join(args.rawDir, name)).isDirectory())
    .sort();

  // One item per claim. The first route that reports a claim keeps the id.
  const entries = new Map<string, Entry>();
  for (const slug of slugs) {
    for (const diffId of diffIds) {
      const path = join(args.rawDir, slug, `${diffId}.txt`);
      if (!existsSync(path) || !statSync(path).isFile()) continue;
      const findings = readFindings(readFileSync(path, "utf8"));
      if (findings === null) continue;
      const plants = plantsByDiff.get(diffId) ?? [];
      findings.forEach((finding: any) => {
        if (!isObject(finding)) return;
        if (typeof finding.file !== "string" || finding.file === "") return;
        if (typeof finding.line !== "number" || !Number.isFinite(finding.line)) return;
        if (matchesPlant(finding, plants)) return;
        const claim = claimOf(finding);
        const key = claimKey(diffId, finding.file, finding.line, claim);
        if (entries.has(key)) return;
        entries.set(key, {
          diffId,
          file: finding.file,
          id: claimId(diffId, finding.file, finding.line, claim),
          line: finding.line,
          claim,
        });
      });
    }
  }

  // The groups hold the items of one diff and file and a 3-line window.
  const byDiffFile = new Map<string, Entry[]>();
  for (const entry of entries.values()) {
    const key = `${entry.diffId} ${entry.file}`;
    const list = byDiffFile.get(key) ?? [];
    list.push(entry);
    byDiffFile.set(key, list);
  }
  const groups: Group[] = [];
  for (const list of byDiffFile.values()) {
    const sorted = [...list].sort((a, b) => a.line - b.line || a.id.localeCompare(b.id));
    let current: Group | null = null;
    for (const entry of sorted) {
      if (current === null || entry.line - current.start > GROUP_WINDOW) {
        current = { diffId: entry.diffId, file: entry.file, start: entry.line, items: [] };
        groups.push(current);
      }
      current.items.push(entry);
    }
  }
  groups.sort(
    (a, b) => a.diffId.localeCompare(b.diffId) || a.start - b.start || a.file.localeCompare(b.file),
  );

  const doc = {
    set_id: args.setId,
    groups: groups.map((group, index) => ({
      id: `${group.diffId}#G${index + 1}`,
      diff_id: group.diffId,
      file: group.file,
      window: [group.start, group.start + GROUP_WINDOW],
      items: group.items.map((entry) => ({
        id: entry.id,
        line: entry.line,
        claim: entry.claim,
      })),
    })),
  };

  mkdirSync(dir, { recursive: true });
  writeFileSync(queuePath, `${JSON.stringify(doc, null, 2)}\n`);
}

/** The apply of the two judge files to the queue. */
function writeApply(args: Args): void {
  const dir = join(args.privateDir, "sets", args.setId, "adjudication");
  const queuePath = join(dir, "queue.json");
  const verdictsPath = join(dir, "verdicts.json");
  const realDefectsPath = join(dir, "real-defects.json");
  refuseSymlink("apply", writePath(verdictsPath, args.privateDir));
  refuseSymlink("apply", writePath(realDefectsPath, args.privateDir));
  if (!existsSync(queuePath) || !statSync(queuePath).isFile()) {
    refuse("apply", "queue missing");
  }
  const queue = JSON.parse(readFileSync(queuePath, "utf8"));
  if (!isObject(queue) || !Array.isArray(queue.groups)) refuse("apply", "queue");
  const judgeA = readJudgeFile(args.judgeA);
  const judgeB = readJudgeFile(args.judgeB);

  const verdicts: Record<string, string> = {};
  const realDefects: any[] = [];
  const keyAdditions = new Map<string, any[]>();
  for (const group of queue.groups) {
    if (!isObject(group) || !Array.isArray(group.items)) refuse("apply", "queue");
    const diffId = typeof group.diff_id === "string" ? group.diff_id : "";
    // The file of a finding is on its group, not in its claim.
    const groupFile = typeof group.file === "string" ? group.file : "";
    for (const item of group.items) {
      if (!isObject(item) || typeof item.id !== "string") refuse("apply", "queue");
      const claim = isObject(item.claim) ? item.claim : {};
      const first = judgeA[item.id];
      const second = judgeB[item.id];
      // The rule of two: only an equal verdict of both judges counts.
      const verdict = first === second && VERDICTS.includes(first) ? first : "unclear";
      verdicts[item.id] = verdict;
      if (verdict !== "real-defect") continue;
      const line = typeof item.line === "number" ? item.line : 0;
      const file = groupFile;
      const severity = typeof claim.severity === "string" ? claim.severity : "";
      realDefects.push({
        id: item.id,
        diff_id: diffId,
        file,
        line,
        class: typeof claim.class === "string" ? claim.class : "",
        severity,
        title: typeof claim.title === "string" ? claim.title : "",
        reason: typeof claim.reason === "string" ? claim.reason : "",
      });
      const list = keyAdditions.get(diffId) ?? [];
      list.push({
        id: item.id,
        file,
        new_lines: [line, line],
        class: "R",
        severity,
        source: "adjudication",
      });
      keyAdditions.set(diffId, list);
    }
  }

  // The key of a diff holds its confirmed real defects (spec D7, D11).
  const keysDir = join(args.privateDir, "sets", args.setId, "keys");
  for (const [diffId, additions] of keyAdditions) {
    const keyPath = join(keysDir, `${diffId}.json`);
    refuseSymlink("apply", writePath(keyPath, args.privateDir));
    if (!existsSync(keyPath)) refuse("apply", `key missing ${diffId}`);
    const key = JSON.parse(readFileSync(keyPath, "utf8"));
    const known = Array.isArray(key.real_defects) ? key.real_defects : [];
    key.real_defects = [...known, ...additions];
    writeFileSync(keyPath, `${JSON.stringify(key, null, 2)}\n`);
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(verdictsPath, `${JSON.stringify(verdicts, null, 2)}\n`);
  writeFileSync(
    realDefectsPath,
    `${JSON.stringify({ set_id: args.setId, real_defects: realDefects }, null, 2)}\n`,
  );
}

/** The verdicts of one judge. A missing or unreadable file is an empty
 * map, so every finding stays unclear. */
function readJudgeFile(file: string): Record<string, string> {
  if (!existsSync(file) || !statSync(file).isFile()) return {};
  let doc: any;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
  if (!isObject(doc)) return {};
  const verdicts: Record<string, string> = {};
  for (const [id, verdict] of Object.entries(doc)) {
    if (typeof verdict === "string") verdicts[id] = verdict;
  }
  return verdicts;
}

function main(): void {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (command !== "queue" && command !== "apply") {
    refuse("queue", "unknown command");
  }
  const args = parseArgs(argv, command);
  if (command === "queue") writeQueue(args);
  else writeApply(args);
}

main();
