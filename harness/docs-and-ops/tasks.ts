/** Task and frozen-set definitions for the docs-and-ops benchmark track. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const DOCS_OPS_TRACK_DIR = "measure/tracks/lending_desk_docs_ops";

export const DOCS_OPS_TASKS = [
  { id: "documentation", path: "docs/runbook.md" },
  { id: "operations", path: "ops/verify.ts" },
] as const;

export type DocsOpsTaskId = (typeof DOCS_OPS_TASKS)[number]["id"];
export type DocsOpsSet = {
  schema: 1;
  id: string;
  tasks: readonly DocsOpsTaskId[];
  notes: string;
};

const SETS_DIR = resolve(import.meta.dirname, "sets");

export function docsOpsSetPath(idOrPath: string): string {
  return idOrPath.endsWith(".json") ? resolve(idOrPath) : join(SETS_DIR, `${idOrPath}.json`);
}

export function loadDocsOpsSet(idOrPath: string): DocsOpsSet {
  const path = docsOpsSetPath(idOrPath);
  if (!existsSync(path)) throw new Error(`missing docs-and-ops set: ${path}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`malformed docs-and-ops set ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`docs-and-ops set ${path} is not an object`);
  }
  const record = parsed as Record<string, unknown>;
  if (record.schema !== 1 || typeof record.id !== "string" || !Array.isArray(record.tasks) ||
      !record.tasks.every((id) => typeof id === "string")) {
    throw new Error(`docs-and-ops set ${path} is not a schema-1 set`);
  }
  return {
    schema: 1,
    id: record.id,
    tasks: record.tasks as DocsOpsTaskId[],
    notes: typeof record.notes === "string" ? record.notes : "",
  };
}

export function validateDocsOpsSet(set: DocsOpsSet): string[] {
  const reasons: string[] = [];
  const expected = DOCS_OPS_TASKS.map((task) => task.id).sort();
  const actual = [...set.tasks].sort();
  if (set.id !== "d1") reasons.push(`docs-and-ops set ${set.id} has no model-visible contract`);
  if (actual.join("\0") !== expected.join("\0")) reasons.push("docs-and-ops set must hold documentation and operations");
  if (new Set(actual).size !== actual.length) reasons.push("docs-and-ops set contains a duplicate task");
  return reasons;
}

export function docsOpsRegistryHash(): string {
  const rows = DOCS_OPS_TASKS.map((task) => JSON.stringify(task)).sort();
  return createHash("sha256").update(rows.join("\n")).digest("hex");
}

export function docsOpsSetFileHash(idOrPath: string): { path: string; sha256: string } {
  const path = docsOpsSetPath(idOrPath);
  return { path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") };
}
