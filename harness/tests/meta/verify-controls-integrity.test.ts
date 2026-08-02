import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const HARNESS = resolve(ROOT, "harness");

type ProtectedTreeSnapshot = {
  schema: 1;
  files: readonly string[];
  sha256: string;
};

type ProtectedTreeApi = {
  snapshotProtectedTree(root: string): ProtectedTreeSnapshot;
  protectedTreeUnchanged(before: ProtectedTreeSnapshot, root: string): boolean;
};

async function protectedTreeApi(): Promise<ProtectedTreeApi> {
  // Keep this dynamic while the red contract precedes its production helper.
  const modulePath = new URL("../../protected-tree.ts", import.meta.url).href;
  try {
    return await import(modulePath) as ProtectedTreeApi;
  } catch (error) {
    throw new Error(
      "harness/protected-tree.ts must export snapshotProtectedTree and protectedTreeUnchanged: " +
      (error instanceof Error ? error.message : String(error)),
    );
  }
}

function makeProtectedTree(): string {
  const root = mkdtempSync(resolve(tmpdir(), "lending-desk-protected-tree-"));
  for (const directory of ["src/nested", "src/empty-protected", "src/node_modules", "node_modules", ".next", ".git"]) {
    mkdirSync(resolve(root, directory), { recursive: true });
  }
  writeFileSync(resolve(root, "package.json"), "{\"name\":\"tree\"}\n");
  writeFileSync(resolve(root, "src/nested/non-target.ts"), "export const guard = true;\n");
  writeFileSync(resolve(root, "src/node_modules/not-runtime-root.ts"), "must remain protected\n");
  writeFileSync(resolve(root, "tsconfig.tsbuildinfo"), "generated root cache\n");
  writeFileSync(resolve(root, "src/nested/cache.tsbuildinfo"), "generated nested cache\n");
  writeFileSync(resolve(root, "node_modules/ignored.js"), "generated dependency\n");
  writeFileSync(resolve(root, ".next/ignored.js"), "generated build output\n");
  writeFileSync(resolve(root, ".git/ignored"), "repository metadata\n");
  return root;
}

function runControlBody(source: string): string {
  const start = source.indexOf("function runControl(");
  expect(start, "verify-controls.ts must retain one runControl implementation").toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error("runControl body is not closed");
}

describe("verify-controls protected-tree integrity", () => {
  it("uses the candidate-contract exclusion policy deterministically", async () => {
    const tree = makeProtectedTree();
    try {
      const { snapshotProtectedTree } = await protectedTreeApi();
      const snapshot = snapshotProtectedTree(tree);
      expect(snapshot).toMatchObject({ schema: 1 });
      expect(snapshot.files).toEqual([
        "package.json",
        "src/nested/non-target.ts",
        "src/node_modules/not-runtime-root.ts",
      ]);
      expect(snapshot.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(snapshotProtectedTree(tree)).toEqual(snapshot);
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });

  it("detects a non-target protected-file modification", async () => {
    const tree = makeProtectedTree();
    try {
      const { protectedTreeUnchanged, snapshotProtectedTree } = await protectedTreeApi();
      const before = snapshotProtectedTree(tree);
      writeFileSync(resolve(tree, "src/nested/non-target.ts"), "export const guard = false;\n");
      expect(protectedTreeUnchanged(before, tree)).toBe(false);
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });

  it("detects protected files that are added or deleted", async () => {
    const tree = makeProtectedTree();
    try {
      const { protectedTreeUnchanged, snapshotProtectedTree } = await protectedTreeApi();
      const before = snapshotProtectedTree(tree);
      const added = resolve(tree, "src/nested/added-protected.ts");
      writeFileSync(added, "unexpected addition\n");
      expect(protectedTreeUnchanged(before, tree)).toBe(false);
      rmSync(added);
      expect(protectedTreeUnchanged(before, tree)).toBe(true);
      rmSync(resolve(tree, "src/nested/non-target.ts"));
      expect(protectedTreeUnchanged(before, tree)).toBe(false);
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });

  it("detects empty protected-directory and special-entry changes", async () => {
    const tree = makeProtectedTree();
    try {
      const { protectedTreeUnchanged, snapshotProtectedTree } = await protectedTreeApi();
      const before = snapshotProtectedTree(tree);
      const existingEmpty = resolve(tree, "src/empty-protected");
      rmSync(existingEmpty, { recursive: true });
      expect(protectedTreeUnchanged(before, tree)).toBe(false);
      mkdirSync(existingEmpty);
      expect(protectedTreeUnchanged(before, tree)).toBe(true);
      const addedEmpty = resolve(tree, "src/added-empty-protected");
      mkdirSync(addedEmpty);
      expect(protectedTreeUnchanged(before, tree)).toBe(false);
      rmSync(addedEmpty, { recursive: true });
      expect(protectedTreeUnchanged(before, tree)).toBe(true);
      const fifo = resolve(tree, "src/unexpected.fifo");
      const created = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
      expect(created.status, created.stderr).toBe(0);
      expect(protectedTreeUnchanged(before, tree)).toBe(false);
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });

  it("binds every sensitivity control to complete reference and fixture snapshots", async () => {
    const { readFileSync } = await import("node:fs");
    const control = runControlBody(readFileSync(resolve(HARNESS, "verify-controls.ts"), "utf8"));
    expect(control).toContain("snapshotProtectedTree(REFERENCE)");
    expect(control).toContain("snapshotProtectedTree(FIXTURE)");
    expect(control).toContain("protectedTreeUnchanged(referenceBefore, REFERENCE)");
    expect(control).toContain("protectedTreeUnchanged(fixtureBefore, FIXTURE)");
    expect(control).toContain("reference_unchanged: referenceUnchanged");
    expect(control).toContain("fixture_unchanged: fixtureUnchanged");
    expect(control).not.toMatch(/sha256\((?:reference|fixture)Target\)/);
  });
});
