/** The leak check of the track A data (spec D9, FR-10).
 *
 * Usage:
 *   npx tsx model-guide/leak-check.ts \
 *     --private <dir> --repo <dir> [--preview <dir>]
 *
 * Exit 0 means no leak. Exit 2 prints one line per finding and writes no
 * file. A flag with no value gives one line `leak-check: --<flag> needs a
 * value` and exit 2.
 *
 * The check reads the git index of the repo with `git` only:
 *   git -C <repo> diff --cached --name-only
 *   git -C <repo> show :<path>
 * The work tree of a staged file is never read, so the check reads the
 * content that the commit will hold. The private folder is never scanned.
 *
 * The scan targets are:
 *   - every staged file of the repo
 *   - every file under `<repo>/docs/`, staged or not (FR-10)
 *   - every file under `<preview>/`, when `--preview` names a folder
 *
 * The checks and their lines:
 *   key-field     the text is JSON and holds a `new_lines`, `witness`, or
 *                 `operator` key at any depth
 *                 `leak-check: key-field: <path> <key>`
 *   private-path  the text holds the absolute path of the private folder
 *                 `leak-check: private-path: <path>`
 *   seeded-line   the text holds a line of a seeded diff that the source
 *                 diff of that diff does not hold
 *                 `leak-check: seeded-line: <path>`
 *
 * A key field is an exact key name. A non-JSON text is not parsed for key
 * words, so a prose word passes. A string value that holds a key word does
 * not fail either.
 *
 * The seeded lines come from the private folder:
 *   <private>/sets/<set_id>/diffs/<diff_id>.diff
 *   <private>/sets/<set_id>/src/<diff_id>.diff
 * The text of a body line is the line after the `L<n> ` or `L--- ` prefix
 * and after the kind character, so it keeps its leading spaces. A text of 20
 * characters or more that the source diff of the same diff does not hold is
 * a seeded line. A target that holds one of them as a substring fails.
 *
 * The path of a finding is repo-relative for a staged file and a file under
 * `docs/`, and the absolute path for a file under the preview folder.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const KEY_FIELDS = ["new_lines", "witness", "operator"];
const MIN_SEEDED_LENGTH = 20;

/** One refusal line on stdout and exit 2. The check writes no file. */
function refuse(check: string): never {
  process.stdout.write(`leak-check: ${check}\n`);
  process.exit(2);
}

interface Args {
  privateDir: string;
  repo: string;
  preview: string | null;
}

/** The command line. Each flag takes the next token as its value. */
function parseArgs(argv: string[]): Args {
  const values: Record<string, string> = {};
  let i = 0;
  while (i < argv.length) {
    const flag = argv[i];
    if (flag !== "--private" && flag !== "--repo" && flag !== "--preview") {
      refuse(`unknown flag ${flag}`);
    }
    const value = argv[i + 1] ?? "";
    if (value === "" || value.startsWith("--")) refuse(`${flag} needs a value`);
    values[flag] = value;
    i += 2;
  }
  if (values["--private"] === undefined) refuse("--private needs a value");
  if (values["--repo"] === undefined) refuse("--repo needs a value");
  return {
    privateDir: values["--private"],
    repo: values["--repo"],
    preview: values["--preview"] ?? null,
  };
}

/** The keys of a JSON value, at any depth. */
function keyNames(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) keyNames(item, found);
  } else if (value !== null && typeof value === "object") {
    for (const [name, item] of Object.entries(value)) {
      found.push(name);
      keyNames(item, found);
    }
  }
  return found;
}

/** The body texts of a diff. Each text is the line after the `L<n> ` or
 * `L--- ` prefix and after the kind character. */
function bodyTexts(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (!/^L(?:\d+|---) [-+]/.test(line)) continue;
    out.push(line.replace(/^L(?:\d+|---) /, "").slice(1));
  }
  return out;
}

/** The seeded lines of the private folder. A text belongs to a seeded line
 * when the source diff of the same diff does not hold it. */
function seededLines(privateDir: string): string[] {
  const secrets = new Set<string>();
  const setsDir = join(privateDir, "sets");
  if (!existsSync(setsDir) || !statSync(setsDir).isDirectory()) return [];
  for (const setName of readdirSync(setsDir).sort()) {
    const setDir = join(setsDir, setName);
    if (!statSync(setDir).isDirectory()) continue;
    const diffsDir = join(setDir, "diffs");
    if (!existsSync(diffsDir) || !statSync(diffsDir).isDirectory()) continue;
    for (const name of readdirSync(diffsDir).sort()) {
      if (!name.endsWith(".diff")) continue;
      const sourcePath = join(setDir, "src", name);
      const source =
        existsSync(sourcePath) && statSync(sourcePath).isFile()
          ? bodyTexts(readFileSync(sourcePath, "utf8"))
          : [];
      for (const text of bodyTexts(readFileSync(join(diffsDir, name), "utf8"))) {
        if (text.length >= MIN_SEEDED_LENGTH && !source.includes(text)) secrets.add(text);
      }
    }
  }
  return [...secrets];
}

/** Every file under a folder. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else out.push(full);
  }
  return out;
}

/** One `git` call in the repo. */
function git(repo: string, args: string[]): string | null {
  const run = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (run.error !== undefined || run.status !== 0) return null;
  return run.stdout;
}

/** The paths of the staged files of the repo. */
function stagedPaths(repo: string): string[] {
  const out = git(repo, ["diff", "--cached", "--name-only"]);
  if (out === null) return [];
  return out.split("\n").filter((line) => line !== "");
}

/** The content of a staged file, read from the index. */
function indexText(repo: string, path: string): string | null {
  return git(repo, ["show", `:${path}`]);
}

/** The findings of one target. */
function scan(text: string, label: string, privatePaths: string[], secrets: string[]): string[] {
  const lines: string[] = [];
  let doc: any = null;
  try {
    doc = JSON.parse(text);
  } catch {
    doc = null;
  }
  if (doc !== null) {
    for (const key of keyNames(doc)) {
      if (!KEY_FIELDS.includes(key)) continue;
      lines.push(`leak-check: key-field: ${label} ${key}`);
    }
  }
  for (const path of privatePaths) {
    if (!text.includes(path)) continue;
    lines.push(`leak-check: private-path: ${label}`);
    break;
  }
  for (const secret of secrets) {
    if (!text.includes(secret)) continue;
    lines.push(`leak-check: seeded-line: ${label}`);
    break;
  }
  return lines;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  // The private folder path, as the caller gave it and as the system reads
  // it. A link in the path must not hide the folder.
  const privatePaths = [args.privateDir, resolve(args.privateDir)];
  const secrets = seededLines(args.privateDir);

  const findings: string[] = [];
  const seen = new Set<string>();
  const add = (lines: string[]) => {
    for (const line of lines) {
      if (seen.has(line)) continue;
      seen.add(line);
      findings.push(line);
    }
  };

  // The staged files, read from the index.
  for (const path of stagedPaths(args.repo)) {
    const text = indexText(args.repo, path);
    if (text === null) continue;
    add(scan(text, path, privatePaths, secrets));
  }
  // The files under docs/, staged or not (FR-10).
  for (const file of filesUnder(join(args.repo, "docs"))) {
    const text = readFileSync(file, "utf8");
    add(scan(text, relative(args.repo, file), privatePaths, secrets));
  }
  // The files under the preview folder.
  if (args.preview !== null) {
    for (const file of filesUnder(args.preview)) {
      const text = readFileSync(file, "utf8");
      add(scan(text, file, privatePaths, secrets));
    }
  }

  if (findings.length > 0) {
    for (const line of findings) process.stdout.write(`${line}\n`);
    process.exit(2);
  }
}

main();
