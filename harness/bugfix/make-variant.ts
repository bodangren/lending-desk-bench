/**
 * Deterministic bugfix variant generator.
 *
 * clean tree  = fixture/ + reference/ over the nine task files
 * variant     = clean tree + every bug in one task set
 *
 * The same fixture, reference, registry, and set always produce the same bytes.
 * run.sh seeds bugfix candidates from the generated tree; provenance binds the
 * manifest hashes.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyNegativeControl } from "../tests/negative-controls.js";
import { BUG_REGISTRY, registryHash, validateRegistry, type BugEntry } from "./registry.js";
import { loadSet, setBugs, setFileHash, validateSet } from "./set-loader.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const FIXTURE = join(ROOT, "fixture");
const REFERENCE = join(ROOT, "reference");
const MODEL_VISIBLE = resolve(import.meta.dirname, "model-visible");

const TASK_FILES = [
  "src/lib/loans.ts",
  "src/components/item-card.tsx",
  "src/actions/loans.ts",
  "app/items/page.tsx",
  "app/items/[id]/page.tsx",
  "app/items/[id]/checkout-form.tsx",
  "app/api/loans/route.ts",
  "app/items/loading.tsx",
  "app/items/error.tsx",
] as const;

const EXCLUDED_NAMES = new Set(["node_modules", ".next", ".git"]);
const BUILD_TRACK_DIR = "measure/tracks/lending_desk";
const BUGFIX_TRACK_DIR = "measure/tracks/lending_desk_bugfix";

export type VariantManifest = {
  schema: 1;
  track: "bugfix";
  bug_set_id: string;
  bug_set_sha256: string;
  registry_sha256: string;
  bugs: string[];
  variant_sha256: string;
  file_count: number;
};

export type GeneratedVariant = {
  files: Map<string, string>;
  manifest: VariantManifest;
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Identical algorithm to candidate-contract treeHash, so hashes interoperate. */
export function treeHash(files: Map<string, string>): string {
  const rows = [...files.keys()]
    .sort()
    .map((rel) => `${sha256(files.get(rel)!)}  ${rel}\n`)
    .join("");
  return sha256(rows);
}

/** The fixture tree as a path -> content map, without runtime directories. */
export function readFixtureFiles(): Map<string, string> {
  const files = new Map<string, string>();
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name);
      const rel = relative(FIXTURE, full).split("\\").join("/");
      if (EXCLUDED_NAMES.has(entry.name)) continue;
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile()) {
        if (rel.endsWith(".tsbuildinfo")) continue;
        files.set(rel, readFileSync(full, "utf8"));
      }
    }
  };
  visit(FIXTURE);
  return files;
}

/**
 * Apply an overlay's nine task files. The reference overlay supplies the correct
 * application. Its Measure closeout files belong to the build track and must
 * never leak into a variant.
 */
export function applyTaskOverlay(files: Map<string, string>, overlay: string = REFERENCE): void {
  for (const rel of TASK_FILES) {
    const source = join(overlay, rel);
    if (!existsSync(source)) throw new Error(`overlay is missing task file: ${rel}`);
    files.set(rel, readFileSync(source, "utf8"));
  }
}

/**
 * Replace the build track's Measure directory with another track's model-visible
 * files: `<modelVisible>/track/*` lands in `trackDir`, and `<modelVisible>/AGENTS.md`
 * replaces the fixture's AGENTS.md.
 */
export function replaceMeasureTrack(files: Map<string, string>, modelVisible: string, trackDir: string): void {
  for (const rel of [...files.keys()]) {
    if (rel === BUILD_TRACK_DIR || rel.startsWith(`${BUILD_TRACK_DIR}/`)) files.delete(rel);
  }
  const source = join(modelVisible, "track");
  for (const name of readdirSync(source)) {
    files.set(`${trackDir}/${name}`, readFileSync(join(source, name), "utf8"));
  }
  files.set("AGENTS.md", readFileSync(join(modelVisible, "AGENTS.md"), "utf8"));
}

function applyCleanTree(files: Map<string, string>): void {
  applyTaskOverlay(files);
  replaceMeasureTrack(files, MODEL_VISIBLE, BUGFIX_TRACK_DIR);
}

export function applyBugs(files: Map<string, string>, bugs: readonly BugEntry[]): void {
  for (const entry of bugs) {
    const source = files.get(entry.target);
    if (source === undefined) throw new Error(`${entry.id}: target is not in the tree: ${entry.target}`);
    let mutated: string;
    try {
      mutated = applyNegativeControl(source, entry);
    } catch (error) {
      throw new Error(`${entry.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    files.set(entry.target, mutated);
  }
}

export function generateBugfixVariant(input: {
  bugs: readonly BugEntry[];
  setId: string;
  setSha256: string;
}): GeneratedVariant {
  const registryReasons = validateRegistry(BUG_REGISTRY);
  if (registryReasons.length) {
    throw new Error(`bug registry is invalid: ${registryReasons.join("; ")}`);
  }
  const files = readFixtureFiles();
  applyCleanTree(files);
  applyBugs(files, input.bugs);
  const manifest: VariantManifest = {
    schema: 1,
    track: "bugfix",
    bug_set_id: input.setId,
    bug_set_sha256: input.setSha256,
    registry_sha256: registryHash(),
    bugs: input.bugs.map((entry) => entry.id),
    variant_sha256: treeHash(files),
    file_count: files.size,
  };
  return { files, manifest };
}

export function generateFromSetId(idOrPath: string): GeneratedVariant {
  const set = loadSet(idOrPath);
  const reasons = validateSet(set);
  if (reasons.length) throw new Error(`bug set is invalid: ${reasons.join("; ")}`);
  const { sha256: setSha256 } = setFileHash(idOrPath);
  return generateBugfixVariant({ bugs: setBugs(set), setId: set.id, setSha256 });
}

export function writeVariant(variant: Pick<GeneratedVariant, "files">, outDir: string): void {
  rmSync(outDir, { recursive: true, force: true });
  for (const [rel, content] of variant.files) {
    const target = join(outDir, rel);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
  // The manifest lives OUTSIDE the variant tree: it names the seeded bugs, and
  // the candidate is seeded from this directory, so a manifest here would leak.
}

/** Recompute the variant hash from a written tree (manifest excluded by design). */
export function hashTreeOnDisk(root: string): string {
  const files = new Map<string, string>();
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name);
      const rel = relative(root, full).split("\\").join("/");
      if (EXCLUDED_NAMES.has(entry.name)) continue;
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && !rel.endsWith(".tsbuildinfo")) files.set(rel, readFileSync(full, "utf8"));
    }
  };
  visit(root);
  return treeHash(files);
}

function usage(exitCode: number): never {
  console.error("Usage: tsx harness/bugfix/make-variant.ts --out <dir> (--set <id|path> | --bugs <id,id,...>)");
  process.exit(exitCode);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  let outDir = "";
  let setId = "";
  let bugsArg = "";
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out") outDir = argv[++i] ?? "";
    else if (argv[i] === "--set") setId = argv[++i] ?? "";
    else if (argv[i] === "--bugs") bugsArg = argv[++i] ?? "";
    else usage(2);
  }
  if (!outDir || (!setId && !bugsArg) || (setId && bugsArg)) usage(2);

  let variant: GeneratedVariant;
  if (setId) {
    variant = generateFromSetId(setId);
  } else {
    const ids = bugsArg.split(",").map((id) => id.trim()).filter(Boolean);
    const unknown = ids.filter((id) => !BUG_REGISTRY.some((entry) => entry.id === id));
    if (unknown.length) throw new Error(`unknown bug id(s) in --bugs: ${unknown.join(", ")}`);
    const bugs = ids.map((id) => BUG_REGISTRY.find((entry) => entry.id === id)!);
    variant = generateBugfixVariant({ bugs, setId: "adhoc", setSha256: sha256(ids.sort().join("\n")) });
  }
  writeVariant(variant, outDir);
  // Manifest on stdout; callers must store it outside the variant tree.
  console.log(JSON.stringify(variant.manifest, null, 2));
}
