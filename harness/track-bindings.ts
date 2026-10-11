/**
 * Provenance bindings for the tracks that grade a generated variant.
 *
 * bugfix, tests, and change runs each seed the candidate from a variant built
 * out of a frozen set (bugs, mutants, change requests). Provenance binds the set
 * id, the set file hash, the registry hash, and the variant tree hash. score.ts
 * and score-freshness.ts both call verifyTrackBindings, so the two can never
 * disagree about a stale set or registry.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BenchTrack } from "./candidate-contract.js";
import { registryHash } from "./bugfix/registry.js";
import { loadSet, validateSet } from "./bugfix/set-loader.js";
import { hashTreeOnDisk } from "./bugfix/make-variant.js";
import { loadMutantSet, mutantSetHash, validateMutantSet } from "./tests-track/set-loader.js";
import { changeRegistryHash, loadChangeSet, validateChangeSet } from "./change/requests.js";

type Binding = {
  /** Provenance field that carries the set id / the set file hash. */
  idField: string;
  shaField: string;
  /** Word used in reasons: "bug" -> "bug-set", "bug registry". */
  label: string;
  /** Copy of the set file in the run's artifacts. */
  setFile: string;
  load(path: string): { id: string };
  validate(set: { id: string }): string[];
  /** Hash of the definitions the set resolves to. */
  registry(set: { id: string }): string;
};

export const TRACK_BINDINGS: Record<Exclude<BenchTrack, "build">, Binding> = {
  bugfix: {
    idField: "bug_set_id",
    shaField: "bug_set_sha256",
    label: "bug",
    setFile: "bug-set.json",
    load: loadSet,
    validate: (set) => validateSet(set as ReturnType<typeof loadSet>),
    registry: () => registryHash(),
  },
  tests: {
    idField: "mutant_set_id",
    shaField: "mutant_set_sha256",
    label: "mutant",
    setFile: "mutant-set.json",
    load: loadMutantSet,
    validate: (set) => validateMutantSet(set as ReturnType<typeof loadMutantSet>),
    registry: (set) => mutantSetHash(set as ReturnType<typeof loadMutantSet>),
  },
  change: {
    idField: "change_set_id",
    shaField: "change_set_sha256",
    label: "change",
    setFile: "change-set.json",
    load: loadChangeSet,
    validate: (set) => validateChangeSet(set as ReturnType<typeof loadChangeSet>),
    registry: () => changeRegistryHash(),
  },
};

/** Provenance fields every schema-6 record carries, null where the track has none. */
export const TRACK_BINDING_FIELDS = [
  "bug_set_id", "bug_set_sha256", "mutant_set_id", "mutant_set_sha256",
  "change_set_id", "change_set_sha256", "registry_sha256", "variant_sha256",
] as const;

const hex64 = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export function verifyTrackBindings(
  provenance: Record<string, unknown>,
  artifacts: string,
  track: BenchTrack,
  comparisonRoot: string,
): { current: boolean; reasons: string[] } {
  if (track === "build") return { current: true, reasons: [] };
  const binding = TRACK_BINDINGS[track];
  const reasons: string[] = [];
  let current = true;
  const setPath = join(artifacts, binding.setFile);
  const setId = provenance[binding.idField];
  let set: { id: string } | undefined;
  if (typeof setId !== "string" || !setId) {
    reasons.push(`${track} provenance lacks ${binding.idField}`);
    current = false;
  } else if (!existsSync(setPath)) {
    reasons.push(`${track} provenance lacks the run's ${binding.label}-set file`);
    current = false;
  } else {
    const setSha = createHash("sha256").update(readFileSync(setPath)).digest("hex");
    if (provenance[binding.shaField] !== setSha) {
      reasons.push(`${binding.label}-set hash does not match the run's ${binding.label}-set file`);
      current = false;
    }
    try {
      set = binding.load(setPath);
      const setReasons = binding.validate(set);
      if (setReasons.length) reasons.push(`${binding.label} set is invalid: ${setReasons.join("; ")}`);
      if (set.id !== setId) {
        reasons.push(`${binding.label}-set id does not match provenance`);
        current = false;
      }
    } catch (error) {
      reasons.push(`${binding.label}-set file is unreadable: ${error instanceof Error ? error.message : String(error)}`);
      current = false;
    }
  }
  let registry: string | undefined;
  try {
    // The bug and change registries do not depend on the set; the mutant hash does.
    registry = binding.registry(set ?? { id: "" });
  } catch {
    registry = undefined;
  }
  if (provenance.registry_sha256 !== registry) {
    reasons.push(`${binding.label} registry changed since this run executed`);
    current = false;
  }
  if (!hex64(provenance.variant_sha256)) {
    reasons.push(`${track} provenance lacks a variant hash`);
    current = false;
  } else if (existsSync(comparisonRoot) && hashTreeOnDisk(comparisonRoot) !== provenance.variant_sha256) {
    reasons.push("variant tree changed since this run executed");
    current = false;
  }
  return { current, reasons };
}
