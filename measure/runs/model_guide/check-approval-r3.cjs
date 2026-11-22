/** Read-only check of publish-approval.md against the publish.ts parser.
 * It writes no file and never starts publish.ts. */
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = process.cwd();
const approval = join(root, "measure", "tracks", "model_guide", "publish-approval.md");
const preview = join(root, ".tmp", "model-guide-preview");
const text = readFileSync(approval, "utf8");
const errors = [];

const owner = text.match(/^approved_by: (.+)$/m);
const date = text.match(/^date: (.+)$/m);
if (!owner?.[1].trim()) errors.push("missing or empty approved_by line");
else console.log(`PASS approved_by: ${owner[1].trim()}`);
if (!date?.[1].trim()) errors.push("missing or empty date line");
else console.log(`PASS date: ${date[1].trim()}`);

const lines = text.split("\n");
const start = lines.findIndex((line) => line.trim() === "files:");
if (start === -1) errors.push("no files section");
else {
  const tail = lines.slice(start + 1).filter((line) => line.trim() !== "");
  const strict = /^[0-9a-f]{64}\s+\S+$/;
  const parser = /^([0-9a-f]{64})\s+(.*)$/;
  for (const line of tail) {
    if (!strict.test(line)) errors.push(`bad row shape: ${line}`);
    const match = line.match(parser);
    if (!match) {
      errors.push(`parser rejects row: ${line}`);
      continue;
    }
    const [, sha, rawPath] = match;
    const path = rawPath.trim();
    const actual = createHash("sha256").update(readFileSync(join(preview, path))).digest("hex");
    if (actual !== sha) errors.push(`sha mismatch: ${path}`);
    else console.log(`PASS ${path} ${sha}`);
  }
  if (tail.length !== 6) errors.push(`expected 6 rows, got ${tail.length}`);
  else console.log("PASS six rows");
  if (tail.some((line) => line.includes("preview-base.json"))) {
    errors.push("preview-base.json must not be approved");
  } else console.log("PASS no preview-base.json row");
}

if (errors.length > 0) {
  for (const error of errors) console.log(`FAIL ${error}`);
  process.exit(1);
}
console.log("APPROVAL CHECK: PASS");
