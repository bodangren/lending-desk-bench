/** Publish gate for page B (spec D21, FR-7).
 *
 * Usage:
 *   cd harness && npx tsx model-guide/publish.ts --preview <folder>
 *
 * The approval record is `<repo>/harness/model-guide/publish-approval.md`:
 *   approved_by: <name>
 *   date: <YYYY-MM-DD>
 *   files:
 *   <sha256>  <path relative to docs/>
 *
 * The checks run in this order:
 *   1. no approval record        -> exit 2, `publish: no approval record`
 *   2. no non-empty `approved_by:` line, or no non-empty `date:` line in the
 *      record                     -> exit 2, `publish: bad approval record`;
 *                                   the record is the consent artifact
 *   3. no files section or rows  -> exit 2, `publish: no files`
 *   4. a malformed record row    -> exit 2, `publish: bad line <text>`
 *   5. an unsafe approval path, or a path that names a folder
 *                                -> exit 2, `publish: bad path <path>`
 *   6. an approved SHA-256 differs from the preview file
 *                                -> exit 2, `publish: sha256 <path>`
 *   7. no preview base file, or invalid JSON in it, or a JSON value that is
 *      not an object, or a `docs` value that is not an object
 *                                -> exit 2, `publish: no preview base` or
 *                                   `publish: bad preview base`
 *   8. the docs root is not a plain folder (for example a symlink)
 *                                -> exit 2, `publish: bad docs root`; the
 *                                   tool lstats the root and follows no root
 *                                   link, so no copied file reaches a link
 *                                   target
 *   9. a docs/ file differs from preview-base.json, or a docs/ entry cannot
 *      be read (for example a dangling symlink) or is not a plain file or
 *      folder (a symlink to a file or to a directory)
 *                                -> exit 2, `publish: drift <path>`; the
 *                                   walk stats each entry with lstat and
 *                                   never follows a link, so the copy loop
 *                                   writes through no link and each link
 *                                   target stays byte-identical; an
 *                                   unreadable directory maps to the same
 *                                   drift line without a stack trace, and
 *                                   the root itself prints `.`
 *  10. a destination that cannot be written
 *                                -> exit 2, `publish: write <path>`; each
 *                                   approved file is staged in its target
 *                                   folder before the first rename, so a
 *                                   refused run leaves no partial set
 *  11. else copy each approved preview file to `<repo>/docs/<path>`, exit 0.
 * Each refusal prints one line on stdout and writes no file.
 * The drift check uses own-property checks on the preview base map.
 * A usage error prints `usage: publish.ts --preview <folder>` on stderr,
 * keeps stdout empty, and exits 2.
 */
import { createHash } from "node:crypto";
import {
  existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync,
  statSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const APPROVAL = join(ROOT, "harness", "model-guide", "publish-approval.md");
const USAGE = "usage: publish.ts --preview <folder>\n";

function refuse(line: string): never {
  process.stdout.write(`${line}\n`);
  process.exit(2);
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseArgs(argv: string[]): string {
  if (argv.length !== 2 || argv[0] !== "--preview" || !argv[1]) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  return argv[1];
}

/** The record path must stay a plain relative path inside docs/. */
function isSafeRelPath(path: string): boolean {
  if (path === "") return false;
  if (path.includes("\\")) return false;
  if (path.startsWith("/")) return false;
  return path.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

interface ApprovalRow {
  sha: string;
  path: string;
}

function readApproval(): ApprovalRow[] {
  if (!existsSync(APPROVAL)) refuse("publish: no approval record");
  const text = readFileSync(APPROVAL, "utf8");
  const owner = text.match(/^approved_by: (.+)$/m);
  const date = text.match(/^date: (.+)$/m);
  if (!owner?.[1].trim() || !date?.[1].trim()) {
    refuse("publish: bad approval record");
  }
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === "files:");
  if (start === -1) refuse("publish: no files");
  const rows: ApprovalRow[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") continue;
    const match = line.match(/^([0-9a-f]{64})\s+(.*)$/);
    if (!match) refuse(`publish: bad line ${line}`);
    rows.push({ sha: match[1], path: match[2].trim() });
  }
  if (rows.length === 0) refuse("publish: no files");
  return rows;
}

/** Every current file of docs/, with `/` separators, sorted per folder. The
 * walk stats each entry with lstat and never follows a link. A symlink (to a
 * file or to a directory), an entry that cannot be stated, or a directory
 * that cannot be read lands in the broken list and becomes a drift refusal,
 * not a stack trace. */
function docsFiles(): { files: string[]; broken: string[] } {
  const files: string[] = [];
  const broken: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      broken.push(prefix || ".");
      return;
    }
    for (const name of names) {
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      let info;
      try {
        info = lstatSync(full);
      } catch {
        broken.push(rel);
        continue;
      }
      if (info.isDirectory()) walk(full, rel);
      else if (info.isFile()) files.push(rel);
      else broken.push(rel);
    }
  };
  walk(join(ROOT, "docs"), "");
  return { files, broken };
}

function main(): void {
  const preview = parseArgs(process.argv.slice(2));
  const approved = readApproval();

  for (const row of approved) {
    if (!isSafeRelPath(row.path)) refuse(`publish: bad path ${row.path}`);
  }
  for (const row of approved) {
    const file = join(preview, row.path);
    if (existsSync(file) && statSync(file).isDirectory()) {
      refuse(`publish: bad path ${row.path}`);
    }
    if (!existsSync(file) || sha256File(file) !== row.sha) {
      refuse(`publish: sha256 ${row.path}`);
    }
  }

  const basePath = join(preview, "preview-base.json");
  if (!existsSync(basePath)) refuse("publish: no preview base");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(basePath, "utf8"));
  } catch {
    refuse("publish: bad preview base");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    refuse("publish: bad preview base");
  }
  const base = parsed as { docs?: unknown };
  if (
    base.docs !== undefined &&
    (typeof base.docs !== "object" || base.docs === null || Array.isArray(base.docs))
  ) {
    refuse("publish: bad preview base");
  }
  const baseDocs = (base.docs ?? {}) as Record<string, string>;
  const hasOwn = (obj: object, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(obj, key);

  const docsRoot = join(ROOT, "docs");
  try {
    if (!lstatSync(docsRoot).isDirectory()) refuse("publish: bad docs root");
  } catch {
    // A missing docs root falls to the drift walk below.
  }
  const drifted = new Set<string>();
  const current = docsFiles();
  for (const rel of current.files) {
    if (!hasOwn(baseDocs, rel)) drifted.add(rel);
  }
  for (const rel of current.broken) {
    drifted.add(rel);
  }
  for (const rel of Object.keys(baseDocs).sort()) {
    const file = join(ROOT, "docs", rel);
    if (!existsSync(file)) {
      drifted.add(rel);
      continue;
    }
    let sha: string;
    try {
      sha = sha256File(file);
    } catch {
      drifted.add(rel);
      continue;
    }
    if (sha !== baseDocs[rel]) drifted.add(rel);
  }
  for (const rel of [...drifted].sort()) {
    process.stdout.write(`publish: drift ${rel}\n`);
  }
  if (drifted.size > 0) process.exit(2);

  // Stage every approved file in its target folder before the first rename,
  // so a failed run leaves no partial set.
  const staged: Array<{ tmp: string; dest: string }> = [];
  const drop = (): void => {
    for (const item of staged) {
      try {
        rmSync(item.tmp, { force: true });
      } catch {
        // The temp file is gone or cannot be removed; the run still refuses.
      }
    }
  };
  for (const row of approved) {
    const dest = join(ROOT, "docs", row.path);
    try {
      mkdirSync(dirname(dest), { recursive: true });
      const tmp = join(dirname(dest), `.publish-${process.pid}-${staged.length}.tmp`);
      writeFileSync(tmp, readFileSync(join(preview, row.path)));
      staged.push({ tmp, dest });
    } catch {
      drop();
      refuse(`publish: write ${row.path}`);
    }
  }
  for (const item of staged) renameSync(item.tmp, item.dest);
}

main();
