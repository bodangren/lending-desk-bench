import { describe, expect, it } from "vitest";
import { BUG_REGISTRY, detectorConflicts, registryHash, validateRegistry } from "../../bugfix/registry.js";
import { CRITERIA, PROBES } from "../criteria.js";

describe("bugfix bug registry", () => {
  it("is internally valid under its own validator", () => {
    expect(validateRegistry(BUG_REGISTRY)).toEqual([]);
  });

  it("uses only known detector and collateral ids", () => {
    const known = new Set([...Object.keys(CRITERIA), ...Object.keys(PROBES)]);
    for (const entry of BUG_REGISTRY) {
      expect(known.has(entry.id), `bug id collides with a suite id: ${entry.id}`).toBe(false);
      for (const detector of entry.detectors) expect(known.has(detector), `${entry.id} -> ${detector}`).toBe(true);
      for (const collateral of entry.collateral) expect(known.has(collateral), `${entry.id} -> ${collateral}`).toBe(true);
    }
  });

  it("declares at least one detector and a distinct collateral set per bug", () => {
    for (const entry of BUG_REGISTRY) {
      expect(entry.detectors.length, entry.id).toBeGreaterThan(0);
      for (const id of entry.collateral) {
        expect(entry.detectors.includes(id), `${entry.id} double-lists ${id}`).toBe(false);
      }
    }
  });

  it("has pairwise-disjoint detectors without declared collateral", () => {
    expect(detectorConflicts(BUG_REGISTRY)).toEqual([]);
  });

  it("produces a stable registry hash", () => {
    expect(registryHash()).toBe(registryHash());
    expect(registryHash()).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects synthetic no-op mutations and unknown detectors", () => {
    const [first] = BUG_REGISTRY;
    const reasons = validateRegistry([
      { ...first, id: "BUG-x-a", from: "a", to: "a" },
      { ...first, id: "BUG-x-b", detectors: ["NOT-A-CRITERION"] },
    ]);
    expect(reasons).toContain("BUG-x-a declares a no-op replacement");
    expect(reasons).toContain("BUG-x-b names unknown detector: NOT-A-CRITERION");
  });
});
