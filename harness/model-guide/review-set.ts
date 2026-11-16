/** Set lint and public manifest tool (spec D5 to D9, D13, FR-8).
 *
 * Usage:
 *   npx tsx model-guide/review-set.ts lint <set_id> \
 *     --private <dir> --sets <dir> --created <YYYY-MM-DD>
 *
 * Exit 0 writes the public manifest `<sets>/<set_id>.json`. Exit 2 writes no
 * manifest and prints one or more `lint: <check>: <detail>` lines. A flag
 * with no value gives one line `lint: --<flag> needs a value`.
 *
 * `--private` and `--created` are required. `--sets` is optional and names
 * the public folder of the manifests; the default is
 * `harness/model-guide/data/sets`.
 *
 * The private set layout:
 *   <private>/sets/<set_id>/keys/<diff_id>.json   the key of D7
 *   <private>/sets/<set_id>/diffs/<diff_id>.diff  the seeded diff
 *   <private>/sets/<set_id>/src/<diff_id>.diff    the source diff
 *
 * The diff text holds one hunk per hunk header. Each body line is
 * `L<n> +<text>` (an added line), `L--- -<text>` (a removed line), or
 * `L<n>  <text>` (a context line). The lint recomputes `new_start` (the
 * first new-side number of the hunk), `new_count` (the body lines that are
 * not removed), and `old_count` (the body lines that are not added). The
 * `old_start` of the header stays free (spec D5, D10).
 *
 * The checks and their lines:
 *   key-json          the key file is not JSON
 *                     `lint: key-json: <diff_id>`
 *   key-schema        the key schema is not `model-guide-key/1`
 *   key-set           the key set id is not the set folder
 *   key-id            the key diff id is not the file base name
 *   key-source        the key source holds no repo, commit, or parent
 *   seeded-diff       the seeded diff file is missing
 *   seeded-sha256     the SHA-256 of the seeded diff differs from the key
 *                     `lint: seeded-sha256: <diff_id>`
 *   hunk-header       a recomputed hunk value differs
 *                     `lint: hunk-header: <diff_id> hunk <n>`
 *   plant-removed-line a plant range crosses a removed line
 *                     `lint: plant-removed-line: <diff_id> <plant_id>`
 *   plant-length      a plant spans more than 6 lines
 *                     `lint: plant-length: <diff_id> <plant_id>`
 *   plant-spacing     two plants start fewer than 8 lines apart
 *                     `lint: plant-spacing: <diff_id> <p1> <p2>`
 *   operator          an operator is not in the catalog of its class
 *                     `lint: operator: <diff_id> <plant_id> <operator> is not
 *                     in <class>`
 *   counts            the set size is below its profile
 *                     `lint: counts: diffs <n>, needs <m>`
 *                     `lint: counts: blockers <n>, needs 14`
 *                     `lint: counts: class <C> has <n>, needs <m>`
 *
 * A plant lies on added lines only, spans 1 to 6 lines, and two plants of
 * one diff start at least 8 lines apart (spec D5).
 *
 * The set profile binds `mg-2026-11a` (spec D8): 14 diffs, 12 seeded with 6
 * from each source repo, 2 controls with no plant, 3 to 5 plants per seeded
 * diff, 40 to 60 plants, 14 or more blockers, each class C1 to C7 with 3 or
 * more plants, and C8 and C9 with 1 or more. A `mg-2026-11p*` set uses the
 * pilot profile of spec D13: 6 diffs and 12 or more plants, with no per-repo
 * or class minimum.
 *
 * The public manifest holds exactly the fields of spec D9:
 *   set_id        the set id of the command
 *   created       the `--created` value; never the wall clock
 *   diffs         sorted by id; each entry holds exactly `id`, `repo`,
 *                 `commit`, `parent`, `seeded_sha256`, and `key_sha256`
 *   plant_counts  exactly `by_class` (C1 to C9) and `by_severity` (blocker,
 *                 major, minor)
 * The manifest holds no plant text, no file path, and no line.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const KEY_SCHEMA = "model-guide-key/1";
const DEFAULT_SETS = "harness/model-guide/data/sets";
const EV7_REPOS = ["bodangren/advantage-forge", "Reading-Advantage-Thailand/reading-advantage-monorepo"];
const CLASSES = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9"];
const SEVERITIES = ["blocker", "major", "minor"];
const MAX_PLANT_LINES = 6;
const MIN_PLANT_GAP = 8;
const HEADER_RE = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/;
const BODY_RE = /^L(\d+|---)\s([-+ ])(.*)$/;

/** The operator catalog of spec D6. The name of an operator is its id and
 * its text, for example `C3-1 invert-condition`. */
const OPERATORS: Record<string, string[]> = {
  C1: [
    "C1-1 remove-role-check",
    "C1-2 weaken-role-check",
    "C1-3 wrong-owner-check",
    "C1-4 missing-owner-check",
    "C1-5 open-route",
  ],
  C2: [
    "C2-1 wrong-field-write",
    "C2-2 lost-update",
    "C2-3 drop-transaction",
    "C2-4 drop-unique",
    "C2-5 partial-write",
  ],
  C3: [
    "C3-1 invert-condition",
    "C3-2 off-by-one",
    "C3-3 wrong-comparison",
    "C3-4 wrong-default",
    "C3-5 swap-arguments",
    "C3-6 drop-branch",
  ],
  C4: [
    "C4-1 swallow-error",
    "C4-2 drop-await",
    "C4-3 ignore-result",
    "C4-4 catch-wrong",
    "C4-5 success-on-error",
  ],
  C5: [
    "C5-1 drop-bound",
    "C5-2 drop-type-check",
    "C5-3 raw-query",
    "C5-4 weak-pattern",
    "C5-5 trust-client-flag",
  ],
  C6: [
    "C6-1 log-secret",
    "C6-2 return-secret",
    "C6-3 over-select",
    "C6-4 log-personal-data",
    "C6-5 expose-in-error",
  ],
  C7: [
    "C7-1 rename-field",
    "C7-2 change-return-shape",
    "C7-3 change-type",
    "C7-4 drop-field",
    "C7-5 add-required-field",
  ],
  C8: [
    "C8-1 always-true-assert",
    "C8-2 remove-assert",
    "C8-3 skip-test",
    "C8-4 weaken-assert",
    "C8-5 wrong-fixture",
  ],
  C9: [
    "C9-1 query-in-loop",
    "C9-2 unbounded-read",
    "C9-3 missing-order",
    "C9-4 extra-call-per-row",
    "C9-5 no-pagination",
  ],
};

/** One line on stdout and exit 2. The tool writes no manifest. */
function refuse(line: string): never {
  process.stdout.write(`${line}\n`);
  process.exit(2);
}

/** The failure lines of a run, then exit 2. The tool writes no manifest. */
function refuseAll(lines: string[]): never {
  for (const line of lines) process.stdout.write(`${line}\n`);
  process.exit(2);
}

interface Args {
  setId: string;
  privateDir: string;
  setsDir: string;
  created: string;
}

/** The command line. Each flag takes the next token as its value. */
function parseArgs(argv: string[]): Args {
  if (argv[0] !== "lint") refuse("lint: unknown command");
  const setId = argv[1] ?? "";
  if (setId === "" || setId.startsWith("--")) refuse("lint: set_id needs a value");
  const values: Record<string, string> = {};
  let i = 2;
  while (i < argv.length) {
    const flag = argv[i];
    if (flag !== "--private" && flag !== "--sets" && flag !== "--created") {
      refuse(`lint: unknown flag: ${flag}`);
    }
    const value = argv[i + 1] ?? "";
    if (value === "" || value.startsWith("--")) refuse(`lint: ${flag} needs a value`);
    values[flag] = value;
    i += 2;
  }
  if (values["--private"] === undefined) refuse("lint: --private needs a value");
  if (values["--created"] === undefined) refuse("lint: --created needs a value");
  return {
    setId,
    privateDir: values["--private"],
    setsDir: values["--sets"] ?? DEFAULT_SETS,
    created: values["--created"],
  };
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The two positive line numbers of a plant range. */
function isNewLines(lines: unknown[]): boolean {
  return (
    lines.length === 2 &&
    lines.every((line) => typeof line === "number" && Number.isInteger(line) && line > 0)
  );
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

interface BodyLine {
  kind: "add" | "remove" | "context";
  number: number | null;
}

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  body: BodyLine[];
}

/** The hunks of a diff text. A body line that no rule reads is ignored. */
function parseHunks(text: string): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  for (const line of text.split("\n")) {
    const header = HEADER_RE.exec(line);
    if (header !== null) {
      current = {
        oldStart: Number(header[1]),
        oldCount: Number(header[2]),
        newStart: Number(header[3]),
        newCount: Number(header[4]),
        body: [],
      };
      hunks.push(current);
      continue;
    }
    const body = BODY_RE.exec(line);
    if (body === null || current === null) continue;
    const kind = body[2] === "+" ? "add" : body[2] === "-" ? "remove" : "context";
    const number = body[1] === "---" ? null : Number(body[1]);
    current.body.push({ kind, number });
  }
  return hunks;
}

/** The new-side number of the first body line of a hunk. */
function firstNewNumber(hunk: Hunk): number | null {
  for (const line of hunk.body) {
    if (line.number !== null) return line.number;
  }
  return null;
}

/** A removed line lies between the first and the last new-side line of a
 * plant when the body holds one between them. */
function crossesRemovedLine(hunk: Hunk, first: number, last: number): boolean {
  const start = hunk.body.findIndex((line) => line.number === first);
  const end = hunk.body.findIndex((line) => line.number === last);
  if (start === -1 || end === -1) return false;
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  return hunk.body.slice(low + 1, high).some((line) => line.kind === "remove");
}

interface Plant {
  id: string;
  first: number;
  last: number;
  class: string;
  operator: string;
  severity: string;
}

interface DiffEntry {
  id: string;
  repo: string;
  commit: string;
  parent: string;
  seededSha: string;
  keySha: string;
  plants: Plant[];
}

/** The plants of a key, with the numbers of the plant range. */
function readPlants(key: any, diffId: string, failures: string[]): Plant[] {
  if (!Array.isArray(key.plants)) {
    failures.push(`lint: plants: ${diffId}`);
    return [];
  }
  const plants: Plant[] = [];
  for (const plant of key.plants) {
    if (!isObject(plant)) {
      failures.push(`lint: plant: ${diffId}`);
      continue;
    }
    const id = typeof plant.id === "string" ? plant.id : "";
    const lines = Array.isArray(plant.new_lines) ? plant.new_lines : [];
    const first = typeof lines[0] === "number" ? lines[0] : 0;
    const last = typeof lines[lines.length - 1] === "number" ? lines[lines.length - 1] : first;
    const severity = typeof plant.severity === "string" ? plant.severity : "";
    // The plant schema of D7: an id, two positive line numbers, a file, a
    // witness, and a severity of the scale.
    if (id === "") failures.push(`lint: key-schema: ${diffId} ${id} id`);
    if (!isNewLines(lines)) failures.push(`lint: key-schema: ${diffId} ${id} new_lines`);
    if (typeof plant.file !== "string" || plant.file === "") {
      failures.push(`lint: key-schema: ${diffId} ${id} file`);
    }
    if (typeof plant.witness !== "string" || plant.witness === "") {
      failures.push(`lint: key-schema: ${diffId} ${id} witness`);
    }
    if (!SEVERITIES.includes(severity)) {
      failures.push(`lint: key-schema: ${diffId} ${id} severity`);
    }
    plants.push({
      id,
      first,
      last,
      class: typeof plant.class === "string" ? plant.class : "",
      operator: typeof plant.operator === "string" ? plant.operator : "",
      severity,
    });
  }
  return plants;
}

/** The checks of one diff: the key, the seeded diff, and the plants. */
function readDiff(
  keysDir: string,
  diffsDir: string,
  name: string,
  setId: string,
  failures: string[],
): DiffEntry | null {
  const diffId = basename(name, ".json");
  const keyPath = join(keysDir, name);
  const keyText = readFileSync(keyPath, "utf8");
  let key: any;
  try {
    key = JSON.parse(keyText);
  } catch {
    failures.push(`lint: key-json: ${diffId}`);
    return null;
  }
  if (!isObject(key)) {
    failures.push(`lint: key-json: ${diffId}`);
    return null;
  }
  if (key.schema !== KEY_SCHEMA) failures.push(`lint: key-schema: ${diffId}`);
  if (key.set_id !== setId) failures.push(`lint: key-set: ${diffId}`);
  if (key.diff_id !== diffId) failures.push(`lint: key-id: ${diffId}`);
  const source = isObject(key.source) ? key.source : {};
  const repo = typeof source.repo === "string" ? source.repo : "";
  const commit = typeof source.commit === "string" ? source.commit : "";
  const parent = typeof source.parent === "string" ? source.parent : "";
  if (repo === "" || commit === "" || parent === "") failures.push(`lint: key-source: ${diffId}`);

  const plants = readPlants(key, diffId, failures);

  const diffPath = join(diffsDir, `${diffId}.diff`);
  let diffText = "";
  if (!existsSync(diffPath) || !statSync(diffPath).isFile()) {
    failures.push(`lint: seeded-diff: ${diffId}`);
    return {
      id: diffId,
      repo,
      commit,
      parent,
      seededSha: "",
      keySha: sha256(keyText),
      plants,
    };
  }
  diffText = readFileSync(diffPath, "utf8");
  const seededSha = sha256(diffText);
  if (key.seeded_diff_sha256 !== seededSha) failures.push(`lint: seeded-sha256: ${diffId}`);

  const hunks = parseHunks(diffText);
  if (hunks.length === 0) failures.push(`lint: hunk-header: ${diffId} hunk 1`);
  for (const [index, hunk] of hunks.entries()) {
    const newStart = firstNewNumber(hunk);
    const newCount = hunk.body.filter((line) => line.kind !== "remove").length;
    const oldCount = hunk.body.filter((line) => line.kind !== "add").length;
    if (
      hunk.newStart !== newStart ||
      hunk.newCount !== newCount ||
      hunk.oldCount !== oldCount
    ) {
      failures.push(`lint: hunk-header: ${diffId} hunk ${index + 1}`);
    }
  }

  for (const plant of plants) {
    const catalog = OPERATORS[plant.class];
    if (catalog === undefined || !catalog.includes(plant.operator)) {
      failures.push(`lint: operator: ${diffId} ${plant.id} ${plant.operator} is not in ${plant.class}`);
    }
    if (plant.last - plant.first + 1 > MAX_PLANT_LINES) {
      failures.push(`lint: plant-length: ${diffId} ${plant.id}`);
    }
    if (hunks.some((hunk) => crossesRemovedLine(hunk, plant.first, plant.last))) {
      failures.push(`lint: plant-removed-line: ${diffId} ${plant.id}`);
    }
  }
  const sorted = [...plants].sort((a, b) => a.first - b.first);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].first - sorted[i - 1].first < MIN_PLANT_GAP) {
      failures.push(`lint: plant-spacing: ${diffId} ${sorted[i - 1].id} ${sorted[i].id}`);
    }
  }

  return { id: diffId, repo, commit, parent, seededSha, keySha: sha256(keyText), plants };
}

/** The count checks of the set profile. */
function checkCounts(diffs: DiffEntry[], setId: string, failures: string[]): void {
  const plants = diffs.flatMap((diff) => diff.plants);
  const byClass: Record<string, number> = {};
  for (const name of CLASSES) byClass[name] = 0;
  const bySeverity: Record<string, number> = {};
  for (const name of SEVERITIES) bySeverity[name] = 0;
  for (const plant of plants) {
    if (plant.class in byClass) byClass[plant.class] += 1;
    if (plant.severity in bySeverity) bySeverity[plant.severity] += 1;
  }
  const seeded = diffs.filter((diff) => diff.plants.length > 0);
  const controls = diffs.filter((diff) => diff.plants.length === 0);

  if (setId.startsWith("mg-2026-11p")) {
    // The pilot profile of spec D13: 6 diffs and 12 or more plants.
    if (diffs.length !== 6) failures.push(`lint: counts: diffs ${diffs.length}, needs 6`);
    if (plants.length < 12) failures.push(`lint: counts: plants ${plants.length}, needs 12`);
    return;
  }

  if (diffs.length !== 14) failures.push(`lint: counts: diffs ${diffs.length}, needs 14`);
  if (seeded.length !== 12) failures.push(`lint: counts: seeded diffs ${seeded.length}, needs 12`);
  if (controls.length !== 2) failures.push(`lint: counts: controls ${controls.length}, needs 2`);
  for (const repo of EV7_REPOS) {
    const count = seeded.filter((diff) => diff.repo === repo).length;
    if (count !== 6) failures.push(`lint: counts: repo ${repo} has ${count} seeded diffs, needs 6`);
  }
  for (const diff of seeded) {
    const count = diff.plants.length;
    if (count < 3 || count > 5) {
      failures.push(`lint: counts: plants in ${diff.id} has ${count}, needs 3 to 5`);
    }
  }
  if (plants.length < 40 || plants.length > 60) {
    failures.push(`lint: counts: plants ${plants.length}, needs 40 to 60`);
  }
  if (bySeverity.blocker < 14) {
    failures.push(`lint: counts: blockers ${bySeverity.blocker}, needs 14`);
  }
  for (const name of CLASSES) {
    const needed = name === "C8" || name === "C9" ? 1 : 3;
    if (byClass[name] < needed) {
      failures.push(`lint: counts: class ${name} has ${byClass[name]}, needs ${needed}`);
    }
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const setDir = join(args.privateDir, "sets", args.setId);
  const keysDir = join(setDir, "keys");
  const diffsDir = join(setDir, "diffs");
  if (!existsSync(keysDir) || !statSync(keysDir).isDirectory()) {
    refuse(`lint: set-missing: ${args.setId}`);
  }

  const failures: string[] = [];
  const names = readdirSync(keysDir).filter((name) => name.endsWith(".json")).sort();
  const diffs: DiffEntry[] = [];
  for (const name of names) {
    const entry = readDiff(keysDir, diffsDir, name, args.setId, failures);
    if (entry !== null) diffs.push(entry);
  }
  diffs.sort((a, b) => a.id.localeCompare(b.id));
  checkCounts(diffs, args.setId, failures);

  if (failures.length > 0) refuseAll(failures);

  const byClass: Record<string, number> = {};
  for (const name of CLASSES) byClass[name] = 0;
  const bySeverity: Record<string, number> = {};
  for (const name of SEVERITIES) bySeverity[name] = 0;
  for (const diff of diffs) {
    for (const plant of diff.plants) {
      if (plant.class in byClass) byClass[plant.class] += 1;
      if (plant.severity in bySeverity) bySeverity[plant.severity] += 1;
    }
  }

  const manifest = {
    set_id: args.setId,
    created: args.created,
    diffs: diffs.map((diff) => ({
      id: diff.id,
      repo: diff.repo,
      commit: diff.commit,
      parent: diff.parent,
      seeded_sha256: diff.seededSha,
      key_sha256: diff.keySha,
    })),
    plant_counts: { by_class: byClass, by_severity: bySeverity },
  };

  mkdirSync(args.setsDir, { recursive: true });
  writeFileSync(join(args.setsDir, `${args.setId}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
}

main();
