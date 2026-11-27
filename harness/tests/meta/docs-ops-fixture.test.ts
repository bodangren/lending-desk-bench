/**
 * docs-and-ops fixture contract (Red for track guide_docs_ops_20261127 task 1.2).
 *
 * Every test fails while the track is missing: the docs-and-ops builder
 * modules do not exist, candidate-contract.ts knows no docs-and-ops track,
 * and the model-visible sources, the d1 frozen set, and the oracle overlay
 * are absent. Green satisfies them by adding the task 1.2 files; no test
 * pins fixture content beyond the task text.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isWritableForTrack, writablePathsForTrack } from "../../candidate-contract.js";

const HARNESS = resolve(import.meta.dirname, "../..");
const TRACK_DIR = join(HARNESS, "docs-and-ops");

function readTrackFile(relative: string): string {
  return readFileSync(join(HARNESS, relative), "utf8");
}

describe("docs-and-ops fixture contract", () => {
  it("provides the task builder module", async () => {
    const mod = await import("../../docs-and-ops/tasks.js");
    expect(mod, "docs-and-ops/tasks.js loads").toBeDefined();
  });

  it("provides the variant builder module", async () => {
    const mod = await import("../../docs-and-ops/make-variant.js");
    expect(mod, "docs-and-ops/make-variant.js loads").toBeDefined();
  });

  it("holds the candidate files listed in task 1.2", () => {
    for (const relative of [
      "docs-and-ops/model-visible/AGENTS.md",
      "docs-and-ops/model-visible/track/spec.md",
      "docs-and-ops/model-visible/track/plan.md",
      "docs-and-ops/model-visible/track/metadata.json",
      "docs-and-ops/model-visible/docs/runbook.md",
      "docs-and-ops/model-visible/ops/verify.ts",
    ]) {
      expect(existsSync(join(HARNESS, relative)), `missing ${relative}`).toBe(true);
    }
  });

  it("keeps the runbook and the verifier stub writable for the candidate", () => {
    const writable = writablePathsForTrack("docs-and-ops" as never);
    expect(writable, "docs/runbook.md is writable").toContain("docs/runbook.md");
    expect(writable, "ops/verify.ts is writable").toContain("ops/verify.ts");
    expect(isWritableForTrack("docs-and-ops" as never, "docs/runbook.md")).toBe(true);
    expect(isWritableForTrack("docs-and-ops" as never, "ops/verify.ts")).toBe(true);
  });

  it("ships the d1 frozen set", () => {
    const file = join(TRACK_DIR, "sets", "d1.json");
    expect(existsSync(file), "missing docs-and-ops/sets/d1.json").toBe(true);
    const set = JSON.parse(readFileSync(file, "utf8"));
    expect(set.id, "the frozen set is d1").toBe("d1");
  });

  it("ships the oracle overlay runbook and verifier", () => {
    for (const relative of [
      "docs-and-ops/oracle-overlay/docs/runbook.md",
      "docs-and-ops/oracle-overlay/ops/verify.ts",
    ]) {
      expect(existsSync(join(HARNESS, relative)), `missing ${relative}`).toBe(true);
    }
  });

  it("names the track in the candidate contract sources", () => {
    expect(readTrackFile("candidate-contract.ts")).toContain("docs-and-ops");
  });
});
