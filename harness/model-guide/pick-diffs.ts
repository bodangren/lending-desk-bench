/** Candidate diffs tool (spec D4, FR-8).
 *
 * Usage:
 *   npx tsx model-guide/pick-diffs.ts \
 *     --repo <owner/name> --set <set_id> --private <dir> [--limit <n>]
 *
 * Exit 0 writes `<private>/candidates/<owner>__<name>.json` with schema
 * `model-guide-candidates/1`. Exit 2 writes no output file and prints one
 * line `pick-diffs: --<flag> needs a value` on stdout.
 *
 * `--repo`, `--set`, and `--private` are required. `--limit` is optional and
 * counts the diffs of D8; the default is 12. A run with rejected candidates
 * still exits 0.
 *
 * The tool calls `gh` with the `api` verb and the `GET` method only. It makes
 * one list call and one detail call for each commit that passes the two
 * list rules:
 *   api GET repos/<owner>/<name>/commits --paginate
 *   api GET repos/<owner>/<name>/commits/<sha>
 * The tool reads no local checkout and calls no other verb.
 *
 * A commit qualifies by the rules of spec D4. The first failed rule gives the
 * reason:
 *   1. two parents or more            `merge commit`
 *   2. committer date outside         `committer date outside 2026-08-01 to
 *      2026-08-01 to 2026-11-13        2026-11-13`
 *   3. file count outside 1 to 8      `file count outside 1 to 8`
 *   4. a file over 2000 lines         `file over 2000 lines`
 *   5. line count outside 40 to 400   `line count outside 40 to 400`
 *   6. code share below 60 %          `code share below 60%`
 *   7. a lock file                    `lock file`
 *   8. a binary file                  `binary file`
 *   9. a path under dist/, build/,    `build output path`
 *      or generated/
 *
 * The rules 3 to 9 need the file list of the detail body. The detail call
 * therefore happens after the merge rule and the date rule.
 *
 * A file is a lock file when its base name is `package-lock.json`,
 * `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, or ends in `.lock`.
 * A file is binary when its detail entry has no `patch` key. The code
 * extensions are `.ts`, `.tsx`, `.js`, `.py`, and `.sql`.
 *
 * The output holds `qualified` (the qualifying commits, newest first by
 * committer date), `selected` (the first `--limit` qualified SHAs, less each
 * diff that the set holds), and `rejected` (one reason per rejected commit,
 * in the order of the list). A set holds a diff when
 * `<private>/sets/<set_id>/keys/*.json` holds a `source.commit` of that SHA.
 * A held diff stays in `qualified` and is skipped by `selected`. The output
 * holds no wall-clock value.
 */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";

const SCHEMA = "model-guide-candidates/1";
const DEFAULT_LIMIT = 12;
const DATE_LOWER = Date.parse("2026-08-01T00:00:00Z");
const DATE_UPPER = Date.parse("2026-11-13T23:59:59.999Z");
const MIN_FILES = 1;
const MAX_FILES = 8;
const MIN_LINES = 40;
const MAX_LINES = 400;
const MAX_FILE_LINES = 2000;
const MIN_CODE_SHARE = 0.6;
const LOCK_NAMES = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"];
const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".py", ".sql"];
const BUILD_SEGMENTS = ["dist", "build", "generated"];

const REASON_MERGE = "merge commit";
const REASON_DATE = "committer date outside 2026-08-01 to 2026-11-13";
const REASON_FILES = "file count outside 1 to 8";
const REASON_FILE_LINES = "file over 2000 lines";
const REASON_LINES = "line count outside 40 to 400";
const REASON_SHARE = "code share below 60%";
const REASON_LOCK = "lock file";
const REASON_BINARY = "binary file";
const REASON_BUILD = "build output path";

/** One refusal line on stdout and exit 2. The tool writes no file. */
function refuse(reason: string): never {
  process.stdout.write(`pick-diffs: ${reason}\n`);
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
  repo: string;
  set: string;
  privateDir: string;
  limit: number;
}

/** The flags of the tool. A flag with no value, or a value that is a flag
 * token, is a refusal that names the flag. */
function parseArgs(argv: string[]): Args {
  const values: Record<string, string> = {};
  let i = 0;
  while (i < argv.length) {
    const flag = argv[i];
    if (flag !== "--repo" && flag !== "--set" && flag !== "--private" && flag !== "--limit") {
      refuse(`unknown flag ${flag}`);
    }
    const value = argv[i + 1] ?? "";
    if (value === "" || value.startsWith("--")) refuse(`${flag} needs a value`);
    values[flag] = value;
    i += 2;
  }
  for (const flag of ["--repo", "--set", "--private"]) {
    if (values[flag] === undefined) refuse(`${flag} needs a value`);
  }
  if (!isPlainSetId(values["--set"])) refuse(`set-id: ${values["--set"]}`);
  const [owner, name] = values["--repo"].split("/");
  if (owner === "" || name === "" || name.includes("/")) refuse("--repo needs an owner and a name");
  let limit = DEFAULT_LIMIT;
  if (values["--limit"] !== undefined) {
    const count = Number(values["--limit"]);
    if (!Number.isInteger(count) || count < 0) refuse("--limit needs a number");
    limit = count;
  }
  return {
    repo: values["--repo"],
    set: values["--set"],
    privateDir: values["--private"],
    limit,
  };
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One `gh api` GET call. The method is the GET method only. */
function ghApi(path: string, paginate: boolean): any {
  const args = ["api", "--method", "GET", path];
  if (paginate) args.push("--paginate");
  const run = spawnSync("gh", args, { encoding: "utf8" });
  if (run.error !== undefined || run.status !== 0) refuse("gh api failed");
  try {
    return JSON.parse(run.stdout);
  } catch {
    refuse("gh api gave no JSON");
  }
}

/** The SHA of the first parent, or null when the body holds no parent. */
function firstParent(body: any): string | null {
  const parents = Array.isArray(body?.parents) ? body.parents : [];
  const parent = parents[0];
  return isObject(parent) && typeof parent.sha === "string" ? parent.sha : null;
}

/** The committer time in milliseconds, or null when the body holds no date. */
function committerTime(body: any): number | null {
  const date = body?.commit?.committer?.date;
  if (typeof date !== "string") return null;
  const time = Date.parse(date);
  return Number.isFinite(time) ? time : null;
}

/** The committer time as an ISO 8601 second value in UTC. */
function isoSecond(time: number): string {
  return new Date(time).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The changed lines of one file: the added lines plus the removed lines. */
function fileLines(file: any): number {
  const additions = typeof file?.additions === "number" ? file.additions : 0;
  const deletions = typeof file?.deletions === "number" ? file.deletions : 0;
  return additions + deletions;
}

function fileName(file: any): string {
  return typeof file?.filename === "string" ? file.filename : "";
}

/** A code file holds one of the code extensions of spec D4. */
function isCodeFile(name: string): boolean {
  return CODE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/** A lock file holds a lock name of spec D4, or a base name that ends in
 * `.lock`. */
function isLockFile(name: string): boolean {
  const base = name.split("/").pop() ?? name;
  return LOCK_NAMES.includes(base) || base.endsWith(".lock");
}

/** A build output path holds a `dist`, `build`, or `generated` segment. */
function isBuildPath(name: string): boolean {
  const parts = name.split("/");
  return parts.slice(0, -1).some((part) => BUILD_SEGMENTS.includes(part));
}

interface Qualified {
  sha: string;
  parent: string;
  committer_date: string;
  files: number;
  lines: number;
  code_share: number;
}

/** The result of the rules 3 to 9: a reason, or the counts of the commit. */
type Verdict = { reason: string } | { files: number; lines: number; code_share: number };

/** The rules 3 to 9 of spec D4 on the detail body. The first failed rule
 * gives the reason. */
function classify(detail: any): Verdict {
  const files = Array.isArray(detail?.files) ? detail.files : [];
  if (files.length < MIN_FILES || files.length > MAX_FILES) return { reason: REASON_FILES };
  let lines = 0;
  let codeLines = 0;
  let bigFile = false;
  for (const file of files) {
    const count = fileLines(file);
    if (count > MAX_FILE_LINES) bigFile = true;
    lines += count;
    if (isCodeFile(fileName(file))) codeLines += count;
  }
  if (bigFile) return { reason: REASON_FILE_LINES };
  if (lines < MIN_LINES || lines > MAX_LINES) return { reason: REASON_LINES };
  const share = lines === 0 ? 0 : codeLines / lines;
  if (share < MIN_CODE_SHARE) return { reason: REASON_SHARE };
  for (const file of files) {
    if (isLockFile(fileName(file))) return { reason: REASON_LOCK };
  }
  for (const file of files) {
    if (!Object.hasOwn(file, "patch")) return { reason: REASON_BINARY };
  }
  for (const file of files) {
    if (isBuildPath(fileName(file))) return { reason: REASON_BUILD };
  }
  return {
    files: files.length,
    lines,
    code_share: share,
  };
}

/** The commit SHAs that the set holds. A key file holds the SHA under
 * `source.commit`. */
function heldCommits(privateDir: string, setId: string): Set<string> {
  const held = new Set<string>();
  const keysDir = join(privateDir, "sets", setId, "keys");
  if (!existsSync(keysDir) || !statSync(keysDir).isDirectory()) return held;
  for (const name of readdirSync(keysDir).sort()) {
    if (!name.endsWith(".json")) continue;
    let doc: any;
    try {
      doc = JSON.parse(readFileSync(join(keysDir, name), "utf8"));
    } catch {
      continue;
    }
    const commit = doc?.source?.commit;
    if (typeof commit === "string") held.add(commit);
  }
  return held;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const [owner, name] = args.repo.split("/");
  const target = join(args.privateDir, "candidates", `${owner}__${name}.json`);
  refuseSymlink(writePath(target, args.privateDir));

  const list = ghApi(`repos/${owner}/${name}/commits`, true);
  if (!Array.isArray(list)) refuse("gh api gave no commit list");

  const qualified: Array<Qualified & { time: number; order: number }> = [];
  const rejected: Array<{ sha: string; reason: string }> = [];

  list.forEach((body: any, order: number) => {
    const sha = typeof body?.sha === "string" ? body.sha : "";
    if (sha === "") refuse("gh api gave no commit SHA");
    const parents = Array.isArray(body?.parents) ? body.parents : [];
    if (parents.length >= 2) {
      rejected.push({ sha, reason: REASON_MERGE });
      return;
    }
    const time = committerTime(body);
    if (time === null || time < DATE_LOWER || time > DATE_UPPER) {
      rejected.push({ sha, reason: REASON_DATE });
      return;
    }
    const detail = ghApi(`repos/${owner}/${name}/commits/${sha}`, false);
    const verdict = classify(detail);
    if ("reason" in verdict) {
      rejected.push({ sha, reason: verdict.reason });
      return;
    }
    qualified.push({
      sha,
      parent: firstParent(body) ?? firstParent(detail) ?? "",
      committer_date: isoSecond(time),
      files: verdict.files,
      lines: verdict.lines,
      code_share: verdict.code_share,
      time,
      order,
    });
  });

  // The qualified list is newest first by committer date. The list order
  // settles a tie.
  qualified.sort((a, b) => b.time - a.time || a.order - b.order);

  const held = heldCommits(args.privateDir, args.set);
  const selected = qualified
    .filter((entry) => !held.has(entry.sha))
    .slice(0, args.limit)
    .map((entry) => entry.sha);

  const doc = {
    schema: SCHEMA,
    repo: args.repo,
    set_id: args.set,
    qualified: qualified.map((entry) => ({
      sha: entry.sha,
      parent: entry.parent,
      committer_date: entry.committer_date,
      files: entry.files,
      lines: entry.lines,
      code_share: entry.code_share,
    })),
    selected,
    rejected,
  };

  const dir = join(args.privateDir, "candidates");
  mkdirSync(dir, { recursive: true });
  writeFileSync(target, `${JSON.stringify(doc, null, 2)}\n`);
}

main();
