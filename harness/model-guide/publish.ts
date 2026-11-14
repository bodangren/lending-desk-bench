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
 *   2. an approved SHA-256 differs from the preview file
 *                                -> exit 2, `publish: sha256 <path>`
 *   3. a docs/ file differs from preview-base.json
 *                                -> exit 2, `publish: drift <path>`
 *   4. else copy each approved preview file to `<repo>/docs/<path>`, exit 0.
 * Each refusal prints its line on stdout and writes no file.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const APPROVAL = join(ROOT, "measure", "tracks", "model_guide", "publish-approval.md");

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseArgs(argv: string[]): string {
  let preview = "";
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--preview") preview = argv[i + 1] ?? "";
  }
  if (!preview) {
    process.stdout.write("publish: no approval record\n");
    process.exit(2);
  }
  return preview;
}

function readApproval(): Array<[string, string]> {
  if (!existsSync(APPROVAL)) {
    process.stdout.write("publish: no approval record\n");
    process.exit(2);
  }
  const lines = readFileSync(APPROVAL, "utf8").split("\n");
  const start = lines.findIndex((line) => line.trim() === "files:");
  const rows: Array<[string, string]> = [];
  if (start === -1) return rows;
  for (const line of lines.slice(start + 1)) {
    const match = line.match(/^([0-9a-f]{64})\s+(.+)$/);
    if (match) rows.push([match[1], match[2].trim()]);
  }
  return rows;
}

function main(): void {
  const preview = parseArgs(process.argv.slice(2));
  const approved = readApproval();

  let failed = false;
  for (const [sha, rel] of approved) {
    const file = join(preview, rel);
    if (!existsSync(file) || sha256File(file) !== sha) {
      process.stdout.write(`publish: sha256 ${rel}\n`);
      failed = true;
    }
  }
  if (failed) process.exit(2);

  const basePath = join(preview, "preview-base.json");
  const base = JSON.parse(readFileSync(basePath, "utf8"));
  const docs: Record<string, string> = base.docs ?? {};
  const drifted: string[] = [];
  for (const rel of Object.keys(docs).sort()) {
    const file = join(ROOT, "docs", rel);
    if (!existsSync(file) || sha256File(file) !== docs[rel]) {
      drifted.push(rel);
    }
  }
  for (const rel of drifted) {
    process.stdout.write(`publish: drift ${rel}\n`);
  }
  if (drifted.length > 0) process.exit(2);

  for (const [, rel] of approved) {
    const dest = join(ROOT, "docs", rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(join(preview, rel)));
  }
}

main();
