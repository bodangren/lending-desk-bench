/**
 * Deterministic variant generator for the lending_desk_change track.
 *
 * variant = fixture/ + reference/ over the nine task files + the change track's
 *           model-visible files (spec with the change requests, plan, AGENTS.md)
 *
 * The application starts correct; the change requests exist only in the spec.
 * The same fixture, reference, model-visible files, and set always produce the
 * same bytes.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyTaskOverlay, readFixtureFiles, replaceMeasureTrack, treeHash, writeVariant } from "../bugfix/make-variant.js";
import { changeRegistryHash, changeSetFileHash, loadChangeSet, validateChangeSet } from "./requests.js";

const MODEL_VISIBLE = resolve(import.meta.dirname, "model-visible");
export const CHANGE_TRACK_DIR = "measure/tracks/lending_desk_change";
const CATALOGUE = "app/items/page.tsx";
const NARROW_PARAMS = "  searchParams: Promise<{ q?: string; category?: string }>;";
const WIDE_PARAMS = "  searchParams: Promise<{ q?: string; category?: string; status?: string }>;";

export type ChangeVariantManifest = {
  schema: 1;
  track: "change";
  change_set_id: string;
  change_set_sha256: string;
  registry_sha256: string;
  variant_sha256: string;
  file_count: number;
};

export function generateChangeVariant(setIdOrPath: string): { files: Map<string, string>; manifest: ChangeVariantManifest } {
  const set = loadChangeSet(setIdOrPath);
  const reasons = validateChangeSet(set);
  if (reasons.length) throw new Error(`change set is invalid: ${reasons.join("; ")}`);
  // The model-visible spec states the requests of set c1. A new set needs its own spec.
  if (set.id !== "c1") throw new Error(`change set ${set.id} has no model-visible spec`);
  const files = readFixtureFiles();
  applyTaskOverlay(files);
  replaceMeasureTrack(files, MODEL_VISIBLE, CHANGE_TRACK_DIR);
  // CR-1 reads ?status=. The variant widens the catalogue's searchParams type, so
  // the request needs no signature change and the exported surface stays the
  // contract that the model must keep.
  const page = files.get(CATALOGUE) ?? "";
  if (page.split(NARROW_PARAMS).length !== 2) throw new Error("catalogue searchParams anchor is not unique");
  files.set(CATALOGUE, page.replace(NARROW_PARAMS, WIDE_PARAMS));
  return {
    files,
    manifest: {
      schema: 1,
      track: "change",
      change_set_id: set.id,
      change_set_sha256: changeSetFileHash(setIdOrPath).sha256,
      registry_sha256: changeRegistryHash(),
      variant_sha256: treeHash(files),
      file_count: files.size,
    },
  };
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
  if (!outDir || !setId) throw new Error("usage: tsx harness/change/make-variant.ts --out <dir> --set <id|path>");
  const variant = generateChangeVariant(setId);
  writeVariant(variant, outDir);
  console.log(JSON.stringify(variant.manifest, null, 2));
}
