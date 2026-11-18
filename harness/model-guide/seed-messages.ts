/** The message backfill tool (spec D10 ruling 2026-11-18).
 *
 * Usage:
 *   npx tsx model-guide/seed-messages.ts <set_id> \
 *     --private <dir> [--gh <path>]
 *
 * Exit 0 writes one message file per diff of the set and prints one line
 * `seed-messages: <n> written` on stdout. Exit 2 prints one line
 * `seed-messages: <check>` or `seed-messages: <diff_id> <check>` on stdout
 * and writes no file.
 *
 * The set is `<private>/sets/<set_id>`. For each diff
 * `<private>/sets/<set_id>/diffs/<diff_id>.diff` the tool reads the key
 * `<private>/sets/<set_id>/keys/<diff_id>.json` for `source.commit` and
 * `source.repo`, runs
 *   <gh> api repos/<owner>/<repo>/commits/<sha> --jq .commit.message
 * and writes the first line of the commit message to
 * `<private>/sets/<set_id>/messages/<diff_id>.txt` with a trailing newline
 * and no other text. `--gh` defaults to `gh`. `--private` defaults to
 * `$HOME/.local/share/lending-desk-bench/model-guide`.
 *
 * The four checks of a diff are a missing key, a key with no commit or no
 * repo, a `gh` failure, and an empty first line. The first check that fails
 * names its diff. The tool writes every message file only after every
 * message is known, so a refusal leaves no message file.
 *
 * The tool reads the keys and the names of the diffs. It reads no file in
 * `src/` and writes nothing outside `messages/`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The default of `--gh`. */
const DEFAULT_GH = "gh";
/** The default of `--private`. */
const DEFAULT_PRIVATE = ".local/share/lending-desk-bench/model-guide";
/** The output ceiling of one `gh` call. A commit message is small. */
const GH_MAX_BUFFER = 8 * 1024 * 1024;

/** One refusal line on stdout and exit 2. The tool writes no file. */
function refuse(reason: string): never {
  process.stdout.write(`seed-messages: ${reason}\n`);
  process.exit(2);
}

/** One refusal line for one diff and exit 2. The tool writes no file. */
function refuseDiff(diffId: string, check: string): never {
  refuse(`${diffId} ${check}`);
}

/** A set id is a plain name: it starts with a letter or a digit, holds only
 * letters, digits, `.`, `_`, and `-`, and holds no `..`. */
const SET_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

interface Args {
  setId: string;
  privateDir: string;
  gh: string;
}

/** The flags of the tool. The set id comes first. A flag with no value, or a
 * value that is a flag token, is a refusal that names the flag. */
function parseArgs(argv: string[]): Args {
  const values: Record<string, string> = {};
  let setId = "";
  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      if (setId !== "") refuse("the set id is given twice");
      setId = token;
      i += 1;
      continue;
    }
    if (token !== "--private" && token !== "--gh") refuse(`unknown flag ${token}`);
    const value = argv[i + 1] ?? "";
    if (value === "" || value.startsWith("--")) refuse(`${token} needs a value`);
    values[token] = value;
    i += 2;
  }
  if (setId === "") refuse("the set id needs a value");
  if (!SET_ID_RE.test(setId) || setId.includes("..")) refuse(`set-id: ${setId}`);
  const privateDir = values["--private"] ?? join(process.env.HOME ?? "/root", DEFAULT_PRIVATE);
  return { setId, privateDir, gh: values["--gh"] ?? DEFAULT_GH };
}

/** The last non-empty line of a `gh` stderr, on the stderr of the tool. The
 * stdout of the tool holds the refusal line alone. */
function reportGhStderr(text: string | null): void {
  const lines = (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length > 0) process.stderr.write(`${lines[lines.length - 1]}\n`);
}

/** The commit message of one commit, or null when the call failed. */
function fetchMessage(gh: string, repo: string, commit: string): string | null {
  const run = spawnSync(gh, ["api", `repos/${repo}/commits/${commit}`, "--jq", ".commit.message"], {
    encoding: "utf8",
    maxBuffer: GH_MAX_BUFFER,
  });
  if (run.error !== undefined) {
    reportGhStderr(run.stderr);
    return null;
  }
  if (run.status !== 0) {
    reportGhStderr(run.stderr);
    return null;
  }
  return run.stdout ?? "";
}

/** The first line of a commit message, or null when the line holds no text. */
function firstLine(message: string): string | null {
  const line = message.split("\n")[0].replace(/\r$/, "");
  if (line.trim() === "") return null;
  return line;
}

/** A link on the write path takes the write outside the folder, so the tool
 * refuses before any write. A path that does not exist is not a link. */
function refuseLink(path: string): void {
  if (!existsSync(path)) return;
  if (lstatSync(path).isSymbolicLink()) refuse(`the path is a link: ${path}`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const setDir = join(args.privateDir, "sets", args.setId);
  const diffDir = join(setDir, "diffs");
  const keyDir = join(setDir, "keys");
  const messageDir = join(setDir, "messages");

  let names: string[];
  try {
    names = readdirSync(diffDir);
  } catch {
    refuse("the set folder is missing");
  }
  const diffIds = names
    .filter((name) => name.endsWith(".diff"))
    .map((name) => name.slice(0, -".diff".length))
    .sort();
  if (diffIds.length === 0) refuse("the set has no diff");

  // Every key is read before any call, so a bad key is named before the
  // tool asks GitHub for a message.
  const sources: Array<{ id: string; repo: string; commit: string }> = [];
  for (const diffId of diffIds) {
    const keyPath = join(keyDir, `${diffId}.json`);
    if (!existsSync(keyPath)) refuseDiff(diffId, "key is missing");
    let key: unknown;
    try {
      key = JSON.parse(readFileSync(keyPath, "utf8"));
    } catch {
      refuseDiff(diffId, "key is unreadable");
    }
    const source = (key as { source?: { commit?: unknown; repo?: unknown } } | null)?.source;
    const commit = source?.commit;
    const repo = source?.repo;
    if (typeof commit !== "string" || commit === "") refuseDiff(diffId, "key holds no commit");
    if (typeof repo !== "string" || repo === "") refuseDiff(diffId, "key holds no repo");
    sources.push({ id: diffId, repo, commit });
  }

  // Every message is known before any file is written, so a refusal leaves
  // no message file.
  const messages: Array<{ id: string; text: string }> = [];
  for (const entry of sources) {
    const message = fetchMessage(args.gh, entry.repo, entry.commit);
    if (message === null) refuseDiff(entry.id, "gh api failed");
    const text = firstLine(message);
    if (text === null) refuseDiff(entry.id, "commit message has no first line");
    messages.push({ id: entry.id, text });
  }

  refuseLink(messageDir);
  mkdirSync(messageDir, { recursive: true });
  for (const message of messages) {
    const path = join(messageDir, `${message.id}.txt`);
    refuseLink(path);
    writeFileSync(path, `${message.text}\n`);
  }
  process.stdout.write(`seed-messages: ${messages.length} written\n`);
}

main();
