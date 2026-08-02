import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CRITERIA, PROBES } from "../criteria";
import { applyNegativeControl, NEGATIVE_CONTROLS } from "../negative-controls";

const ROOT = resolve(import.meta.dirname, "../../..");
const declared = new Set([...Object.keys(CRITERIA), ...Object.keys(PROBES)]);

describe("deterministic negative controls", () => {
  it("has unique, anchored mutations with declared expected failures", () => {
    expect(new Set(NEGATIVE_CONTROLS.map((control) => control.id)).size).toBe(NEGATIVE_CONTROLS.length);
    for (const control of NEGATIVE_CONTROLS) {
      const source = readFileSync(resolve(ROOT, "reference", control.target), "utf8");
      const mutated = applyNegativeControl(source, control);
      expect(mutated).not.toBe(source);
      for (const id of control.expectedFailures) expect(declared).toContain(id);
    }
  });
});
