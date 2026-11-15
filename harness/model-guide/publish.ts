/** Publish gate for page B (spec D21, FR-7).
 *
 * Usage:
 *   cd harness && npx tsx model-guide/publish.ts --preview <folder>
 *
 * The approval record is `<repo>/measure/tracks/model_guide/publish-approval.md`:
 *   approved_by: <name>
 *   date: <YYYY-MM-DD>
 *   files:
 *   <sha256>  <path relative to docs/>
 *
 * The checks run in this order:
 *   1. no approval record        -> exit 2, `publish: no approval record`
 *   2. no files section or rows  -> exit 2, `publish: no files`
 *   3. a malformed record row    -> exit 2, `publish: bad line <text>`
 *   4. an unsafe approval path, or a path that names a folder
 *                                -> exit 2, `publish: bad path <path>`
 *   5. an approved SHA-256 differs from the preview file
 *                                -> exit 2, `publish: sha256 <path>`
 *   6. no preview base file, or invalid JSON in it
 *                                -> exit 2, `publish: no preview base` or
 *                                   `publish: bad preview base`
 *   7. a docs/ file differs from preview-base.json, or a docs/ entry cannot
 *      be read (for example a dangling symlink)
 *                                -> exit 2, `publish: drift <path>`
 *   8. else copy each approved preview file to `<repo>/docs/<path>`, exit 0.
 * Each refusal prints one line on stdout and writes no file.
 * The drift check uses own-property checks on the preview base map.
 * A usage error prints `usage: publish.ts --preview <folder>` on stderr,
 * keeps stdout empty, and exits 2.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const APPROVAL = join(ROOT, "measure", "tracks", "model_guide", "publish-approval.md");
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
  const lines = readFileSync(APPROVAL, "utf8").split("\n");
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

/** Every current file of docs/, with `/` separators, sorted per folder. An
 * entry that cannot be stated (for example a dangling symlink) lands in the
 * broken list and becomes a drift refusal, not a stack trace. */
function docsFiles(): { files: string[]; broken: string[] } {
  const files: string[] = [];
  const broken: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      let info;
      try {
        info = statSync(full);
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
  let base: { docs?: Record<string, string> };
  try {
    base = JSON.parse(readFileSync(basePath, "utf8"));
  } catch {
    refuse("publish: bad preview base");
  }
  const baseDocs: Record<string, string> = base.docs ?? {};
  const hasOwn = (obj: object, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(obj, key);

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

  for (const row of approved) {
    const dest = join(ROOT, "docs", row.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(join(preview, row.path)));
  }
}

main();
