/**
 * Task-set loader for the bugfix track.
 *
 * A set is a frozen, versioned list of registry bug ids. Every model in one
 * comparison cohort receives the identical variant, so a set must resolve and
 * validate before any run starts.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUG_REGISTRY,
  detectorConflicts,
  getBug,
  validateRegistry,
  type BugClass,
  type BugEntry,
} from "./registry.js";

const SETS_DIR = resolve(import.meta.dirname, "sets");

export type BugSet = {
  schema: 1;
  id: string;
  bugs: readonly string[];
  notes: string;
  /** Admission sets (verify-bugs single-bug runs) skip cohort class coverage. */
  admission?: boolean;
  /** Calibration sets (e.g. the empty clean-tree set) skip cohort class coverage. */
  calibration?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function setPath(idOrPath: string): string {
  if (idOrPath.endsWith(".json")) return resolve(idOrPath);
  return join(SETS_DIR, `${idOrPath}.json`);
}

export function loadSet(idOrPath: string): BugSet {
  const path = setPath(idOrPath);
  if (!existsSync(path)) throw new Error(`missing bug set: ${path}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`malformed bug set ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed) || parsed.schema !== 1 || typeof parsed.id !== "string") {
    throw new Error(`bug set ${path} is not a schema-1 set`);
  }
  if (!Array.isArray(parsed.bugs) || !parsed.bugs.every((id) => typeof id === "string")) {
    throw new Error(`bug set ${path} must list bug id strings`);
  }
  return {
    schema: 1,
    id: parsed.id,
    bugs: parsed.bugs as readonly string[],
    notes: typeof parsed.notes === "string" ? parsed.notes : "",
    admission: parsed.admission === true,
    calibration: parsed.calibration === true,
  };
}

export function validateSet(set: BugSet): string[] {
  const reasons: string[] = [];
  const seen = new Set<string>();
  for (const id of set.bugs) {
    if (seen.has(id)) reasons.push(`duplicate bug in set ${set.id}: ${id}`);
    seen.add(id);
    let exists = false;
    try {
      getBug(id);
      exists = true;
    } catch {
      reasons.push(`set ${set.id} names unknown bug: ${id}`);
    }
    if (exists) {
      const entry = getBug(id);
      const entryReasons = validateRegistry([entry]);
      reasons.push(...entryReasons.map((reason) => `${id}: ${reason}`));
    }
  }
  const classes = new Set<BugClass>();
  for (const id of set.bugs) {
    try {
      classes.add(getBug(id).class);
    } catch {
      // already reported
    }
  }
  if (set.admission !== true && set.calibration !== true) {
    for (const required of ["functional", "security", "performance", "reliability"] as const) {
      if (!classes.has(required)) reasons.push(`set ${set.id} lacks a ${required} bug`);
    }
  }
  const entries = set.bugs
    .map((id) => {
      try {
        return getBug(id);
      } catch {
        return undefined;
      }
    })
    .filter((entry): entry is BugEntry => entry !== undefined);
  if (entries.length === set.bugs.length) {
    reasons.push(...detectorConflicts(entries).map((reason) => `set ${set.id}: ${reason}`));
  }
  return reasons;
}

export function setBugs(set: BugSet): BugEntry[] {
  return set.bugs.map((id) => getBug(id));
}

export function setFileHash(idOrPath: string): { path: string; sha256: string } {
  const path = setPath(idOrPath);
  return {
    path,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  };
}

/** Registry size sanity: the registry must exceed any single set (rotation headroom). */
export function registryHeadroom(set: BugSet): number {
  return BUG_REGISTRY.length - set.bugs.length;
}
