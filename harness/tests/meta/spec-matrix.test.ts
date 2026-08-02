import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ADVISORY, CRITERIA, PROBES } from "../criteria";
import { SPEC_MATRIX } from "../spec-matrix";
import { REQUIRED_PRIMARY_ROWS } from "./spec-matrix-contract";

const HARNESS = resolve(import.meta.dirname, "../..");
const ROOT = resolve(HARNESS, "..");

function testTitles(path: string): Set<string> {
  const source = readFileSync(path, "utf8");
  const titles = new Set<string>();
  const declaration = /(?:^|\s)(?:test|it)\(\s*["']([^"']+)["']/gm;
  for (const match of source.matchAll(declaration)) titles.add(match[1]);
  return titles;
}

describe("spec matrix", () => {
  it("M.matrix-valid", () => {
    const fixtureSpec = readFileSync(resolve(ROOT, "fixture/measure/tracks/lending_desk/spec.md"), "utf8");
    expect(fixtureSpec.match(/^- \[ \] /gm)).toHaveLength(52);
    expect(SPEC_MATRIX).toHaveLength(52);
    expect(new Set(SPEC_MATRIX.map((row) => row.id)).size).toBe(52);
    expect(SPEC_MATRIX.map((row) => row.id)).toEqual([
      ...Array.from({ length: 5 }, (_, i) => "A." + (i + 1)),
      ...Array.from({ length: 4 }, (_, i) => "B." + (i + 1)),
      ...Array.from({ length: 7 }, (_, i) => "C." + (i + 1)),
      ...Array.from({ length: 6 }, (_, i) => "D." + (i + 1)),
      ...Array.from({ length: 9 }, (_, i) => "E." + (i + 1)),
      ...Array.from({ length: 7 }, (_, i) => "F." + (i + 1)),
      ...Array.from({ length: 12 }, (_, i) => "G." + (i + 1)),
      ...Array.from({ length: 2 }, (_, i) => "H." + (i + 1)),
    ]);
  });

  it("M.matrix-primary-ownership", () => {
    const primaries = SPEC_MATRIX.map((row) => row.primary);
    expect(primaries).toHaveLength(52);
    expect(new Set(primaries).size, "each spec checkbox needs one independent Axis-1 primary").toBe(52);
    for (const row of SPEC_MATRIX) {
      expect(
        Object.prototype.hasOwnProperty.call(CRITERIA, row.primary),
        row.id + " must map to CRITERIA, never PROBES or ADVISORY: " + row.primary,
      ).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(PROBES, row.primary), row.id + " primary leaked into PROBES").toBe(false);
      expect(ADVISORY).not.toContain(row.primary);
    }
  });

  it("M.matrix-wired", () => {
    for (const row of SPEC_MATRIX) {
      const path = resolve(HARNESS, "tests", row.testFile);
      expect(existsSync(path), row.id + " test file is missing: " + row.testFile).toBe(true);
      expect(testTitles(path), row.id + " primary assertion is absent from " + row.testFile).toContain(row.primary);
    }
  });

  it("M.matrix-split-semantics", () => {
    for (const required of REQUIRED_PRIMARY_ROWS) {
      const row = SPEC_MATRIX.find((candidate) => candidate.id === required.id);
      expect(row, required.id + " matrix row is missing").toMatchObject(required);
      expect(Object.prototype.hasOwnProperty.call(CRITERIA, required.primary), required.primary + " must be scored").toBe(true);
      expect(testTitles(resolve(HARNESS, "tests", required.testFile))).toContain(required.primary);
    }
  });
});
