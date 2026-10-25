import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadSet, registryHeadroom, setBugs, setFileHash, validateSet } from "../../bugfix/set-loader.js";
import { BUG_REGISTRY } from "../../bugfix/registry.js";

const V1 = resolve(import.meta.dirname, "../../bugfix/sets/v1.json");

describe("bugfix task set v1", () => {
  it("loads, validates, and spans every bug class", () => {
    const set = loadSet(V1);
    expect(set.schema).toBe(1);
    expect(validateSet(set)).toEqual([]);
    const classes = new Set(setBugs(set).map((entry) => entry.class));
    for (const required of ["functional", "security", "performance", "reliability"]) {
      expect(classes.has(required as never), required).toBe(true);
    }
  });

  it("holds 11 frozen bugs drawn from the registry", () => {
    const set = loadSet(V1);
    expect(set.bugs).toHaveLength(11);
    for (const id of set.bugs) {
      expect(BUG_REGISTRY.some((entry) => entry.id === id), id).toBe(true);
    }
  });

  it("rejects unknown bugs, duplicates, and missing classes", () => {
    const set = loadSet(V1);
    expect(validateSet({ ...set, bugs: [...set.bugs, "BUG-unknown"] }).join("; "))
      .toContain("unknown bug");
    expect(validateSet({ ...set, bugs: [...set.bugs, set.bugs[0]] }).join("; "))
      .toContain("duplicate bug");
    expect(validateSet({ ...set, bugs: [set.bugs[0]] }).join("; "))
      .toContain("lacks a");
  });

  it("keeps registry headroom over the set and a stable file hash", () => {
    const set = loadSet(V1);
    expect(registryHeadroom(set)).toBeGreaterThan(0);
    const first = setFileHash(V1);
    const second = setFileHash(V1);
    expect(first.sha256).toBe(second.sha256);
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
