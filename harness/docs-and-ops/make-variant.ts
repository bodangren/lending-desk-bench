/** Deterministic candidate generator for the docs-and-ops track. */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyTaskOverlay, readFixtureFiles, replaceMeasureTrack, treeHash, writeVariant } from "../bugfix/make-variant.js";
import {
  DOCS_OPS_TASKS,
  DOCS_OPS_TRACK_DIR,
  docsOpsRegistryHash,
  docsOpsSetFileHash,
  loadDocsOpsSet,
  validateDocsOpsSet,
} from "./tasks.js";

const MODEL_VISIBLE = resolve(import.meta.dirname, "model-visible");

export type DocsOpsVariantManifest = {
  schema: 1;
  track: "docs-and-ops";
  docs_ops_set_id: string;
  docs_ops_set_sha256: string;
  registry_sha256: string;
  variant_sha256: string;
  file_count: number;
};

export function generateDocsOpsVariant(setIdOrPath: string): {
  files: Map<string, string>;
  manifest: DocsOpsVariantManifest;
} {
  const set = loadDocsOpsSet(setIdOrPath);
  const reasons = validateDocsOpsSet(set);
  if (reasons.length) throw new Error(`docs-and-ops set is invalid: ${reasons.join("; ")}`);
  const files = readFixtureFiles();
  applyTaskOverlay(files);
  replaceMeasureTrack(files, MODEL_VISIBLE, DOCS_OPS_TRACK_DIR);
  for (const task of DOCS_OPS_TASKS) {
    const source = join(MODEL_VISIBLE, task.path);
    if (!existsSync(source)) throw new Error(`model-visible task stub is missing: ${task.path}`);
    files.set(task.path, readFileSync(source, "utf8"));
  }
  return {
    files,
    manifest: {
      schema: 1,
      track: "docs-and-ops",
      docs_ops_set_id: set.id,
      docs_ops_set_sha256: docsOpsSetFileHash(setIdOrPath).sha256,
      registry_sha256: docsOpsRegistryHash(),
      variant_sha256: treeHash(files),
      file_count: files.size,
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  let outDir = "";
  let setId = "";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") outDir = argv[++index] ?? "";
    else if (arg === "--set") setId = argv[++index] ?? "";
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!outDir || !setId) throw new Error("usage: tsx harness/docs-and-ops/make-variant.ts --out <dir> --set <id|path>");
  const variant = generateDocsOpsVariant(setId);
  writeVariant(variant, outDir);
  console.log(JSON.stringify(variant.manifest, null, 2));
}
