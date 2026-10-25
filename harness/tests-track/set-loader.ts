/**
 * Mutant-set loader for the tests track. A set is frozen per cohort; every
 * model grades against the identical mutants.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BugClass } from "../bugfix/registry.js";
import { mutantDefinitionsHash, resolveMutant, type MutantDefinition } from "./mutants.js";

const SETS_DIR = resolve(import.meta.dirname, "sets");
const CLASSES: readonly BugClass[] = ["functional", "security", "performance", "reliability"];

export type MutantSet = {
  schema: 1;
  id: string;
  mutants: readonly { id: string; class?: BugClass }[];
  notes: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function mutantSetPath(idOrPath: string): string {
  return idOrPath.endsWith(".json") ? resolve(idOrPath) : join(SETS_DIR, `${idOrPath}.json`);
}

export function loadMutantSet(idOrPath: string): MutantSet {
  const path = mutantSetPath(idOrPath);
  if (!existsSync(path)) throw new Error(`missing mutant set: ${path}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`malformed mutant set ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed) || parsed.schema !== 1 || typeof parsed.id !== "string" || !Array.isArray(parsed.mutants)) {
    throw new Error(`mutant set ${path} is not a schema-1 set`);
  }
  const mutants = parsed.mutants.map((entry) => {
    if (!isRecord(entry) || typeof entry.id !== "string") throw new Error(`mutant set ${path} has a malformed entry`);
    if (entry.class !== undefined && !CLASSES.includes(entry.class as BugClass)) {
      throw new Error(`mutant set ${path} names an unknown class for ${entry.id}`);
    }
    return { id: entry.id, class: entry.class as BugClass | undefined };
  });
  return { schema: 1, id: parsed.id, mutants, notes: typeof parsed.notes === "string" ? parsed.notes : "" };
}

export function setMutants(set: MutantSet): MutantDefinition[] {
  return set.mutants.map((entry) => resolveMutant(entry.id, entry.class));
}

export function validateMutantSet(set: MutantSet): string[] {
  const reasons: string[] = [];
  const seen = new Set<string>();
  for (const entry of set.mutants) {
    if (seen.has(entry.id)) reasons.push(`duplicate mutant in set ${set.id}: ${entry.id}`);
    seen.add(entry.id);
    try {
      const mutant = resolveMutant(entry.id, entry.class);
      if (entry.class && entry.class !== mutant.class) reasons.push(`set ${set.id} overrides the class of ${entry.id}`);
      if (!mutant.replacements.length || mutant.replacements.some((r) => r.from === r.to)) {
        reasons.push(`${entry.id} declares no effective replacement`);
      }
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (!set.mutants.length) reasons.push(`set ${set.id} is empty`);
  return reasons;
}

export function mutantSetHash(set: MutantSet): string {
  return mutantDefinitionsHash(setMutants(set));
}

export function mutantSetFileHash(idOrPath: string): { path: string; sha256: string } {
  const path = mutantSetPath(idOrPath);
  return { path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") };
}
