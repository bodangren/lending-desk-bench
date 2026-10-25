/**
 * Deterministic tree generator for the lending_desk_tests track.
 *
 * candidate variant = fixture/ + reference/ over the nine task files
 *                     + the tests track's model-visible files
 *                     + a `test` script and vitest.config.mts
 * graded app        = the same tree with another overlay (reference-variant/)
 *                     or one mutant applied
 *
 * The candidate starts from the variant. Grading copies the candidate's tests/
 * into each graded app, so every app shares the variant's configuration.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyNegativeControl } from "../tests/negative-controls.js";
import {
  applyTaskOverlay,
  readFixtureFiles,
  replaceMeasureTrack,
  treeHash,
  writeVariant,
} from "../bugfix/make-variant.js";
import type { MutantDefinition } from "./mutants.js";
import { loadMutantSet, mutantSetFileHash, mutantSetHash, validateMutantSet } from "./set-loader.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const MODEL_VISIBLE = resolve(import.meta.dirname, "model-visible");
export const TESTS_TRACK_DIR = "measure/tracks/lending_desk_tests";
export const REFERENCE_OVERLAY = join(ROOT, "reference");
export const VARIANT_OVERLAY = join(ROOT, "reference-variant");

export type TestsVariantManifest = {
  schema: 1;
  track: "tests";
  mutant_set_id: string;
  mutant_set_sha256: string;
  registry_sha256: string;
  variant_sha256: string;
  file_count: number;
};

/** The clean tests-track tree with the given overlay, and optionally one mutant. */
export function testsTreeFiles(input: { overlay?: string; mutant?: MutantDefinition } = {}): Map<string, string> {
  const files = readFixtureFiles();
  applyTaskOverlay(files, input.overlay ?? REFERENCE_OVERLAY);
  replaceMeasureTrack(files, MODEL_VISIBLE, TESTS_TRACK_DIR);
  files.set("vitest.config.mts", readFileSync(join(MODEL_VISIBLE, "vitest.config.mts"), "utf8"));
  const manifest = JSON.parse(files.get("package.json") ?? "{}") as { scripts?: Record<string, string> };
  manifest.scripts = { ...manifest.scripts, test: "vitest run" };
  files.set("package.json", JSON.stringify(manifest, null, 2) + "\n");
  if (input.mutant) {
    const { mutant } = input;
    const source = files.get(mutant.target);
    if (source === undefined) throw new Error(`${mutant.id}: target is not in the tree: ${mutant.target}`);
    const [first] = mutant.replacements;
    files.set(mutant.target, applyNegativeControl(source, {
      id: mutant.id, target: mutant.target, from: first.from, to: first.to, replacements: mutant.replacements,
    }));
  }
  return files;
}

export function generateTestsVariant(setIdOrPath: string): { files: Map<string, string>; manifest: TestsVariantManifest } {
  const set = loadMutantSet(setIdOrPath);
  const reasons = validateMutantSet(set);
  if (reasons.length) throw new Error(`mutant set is invalid: ${reasons.join("; ")}`);
  const files = testsTreeFiles();
  return {
    files,
    manifest: {
      schema: 1,
      track: "tests",
      mutant_set_id: set.id,
      mutant_set_sha256: mutantSetFileHash(setIdOrPath).sha256,
      registry_sha256: mutantSetHash(set),
      variant_sha256: treeHash(files),
      file_count: files.size,
    },
  };
}

/** Content hash of a graded app tree; the build cache is keyed by it. */
export function appTreeHash(files: Map<string, string>): string {
  return createHash("sha256").update(treeHash(files)).digest("hex").slice(0, 24);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  let outDir = "";
  let setId = "";
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out") outDir = argv[++i] ?? "";
    else if (argv[i] === "--set") setId = argv[++i] ?? "";
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!outDir || !setId) throw new Error("usage: tsx harness/tests-track/make-variant.ts --out <dir> --set <id|path>");
  const variant = generateTestsVariant(setId);
  writeVariant(variant, outDir);
  // The manifest names the mutant set; callers store it outside the variant tree.
  console.log(JSON.stringify(variant.manifest, null, 2));
}
