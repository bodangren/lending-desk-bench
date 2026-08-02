import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ADVISORY, CRITERIA, PROBES } from "../criteria";
import { SPEC_MATRIX } from "../spec-matrix";
import { REQUIRED_PRIMARY_COLLATERAL } from "./spec-matrix-contract";
import { applyNegativeControl, type NegativeControl } from "../negative-controls";
import { SENSITIVITY_CONTROLS } from "../sensitivity-controls";

const ROOT = resolve(import.meta.dirname, "../../..");
const declared = [...Object.keys(CRITERIA), ...Object.keys(PROBES), ...ADVISORY].sort();

type Replacement = { from: string; to: string };
type ReplacementAware = NegativeControl & { replacements?: readonly Replacement[] };
const replacementsFor = (control: ReplacementAware): readonly Replacement[] =>
  control.replacements?.length ? control.replacements : [{ from: control.from, to: control.to }];

describe("sensitivity control manifest", () => {
  it("covers every declared result exactly once", () => {
    const targets = SENSITIVITY_CONTROLS.flatMap((control) => control.expectedFailures).sort();
    expect(SENSITIVITY_CONTROLS).toHaveLength(declared.length);
    expect(new Set(SENSITIVITY_CONTROLS.map((control) => control.id)).size).toBe(SENSITIVITY_CONTROLS.length);
    expect(targets).toEqual(declared);
    for (const control of SENSITIVITY_CONTROLS) {
      expect(control.expectedFailures).toHaveLength(1);
      expect(declared).toContain(control.expectedFailures[0]);
      expect(control.allowedCollateral).not.toContain(control.expectedFailures[0]);
      for (const collateral of control.allowedCollateral) expect(declared).toContain(collateral);
    }
  });

  it("validates every replacement anchor and a non-noop mutation", () => {
    for (const control of SENSITIVITY_CONTROLS) {
      const source = readFileSync(resolve(ROOT, "reference", control.target), "utf8");
      for (const replacement of replacementsFor(control)) {
        expect(replacement.to).not.toBe(replacement.from);
        expect(source.indexOf(replacement.from), `${control.id}: ${replacement.from}`).toBe(source.lastIndexOf(replacement.from));
      }
      const mutated = applyNegativeControl(source, control);
      expect(mutated).not.toBe(source);
    }
  });

  it("permits independent controls to share an anchor", () => {
    const source = "shared anchor";
    const controls: NegativeControl[] = [
      { id: "shared-one", target: "synthetic.ts", from: "shared", to: "one", expectedFailures: [] },
      { id: "shared-two", target: "synthetic.ts", from: "shared", to: "two", expectedFailures: [] },
    ];
    const anchors = controls.map((control) => `${control.target}\u0000${control.from}`);
    expect(new Set(anchors).size).toBeLessThan(controls.length);
    expect(controls.map((control) => applyNegativeControl(source, control))).toEqual(["one anchor", "two anchor"]);
  });

  it("gives every matrix primary one intentional control with explicit collateral", () => {
    const primaries = SPEC_MATRIX.map((row) => row.primary);
    expect(new Set(primaries).size, "matrix primaries must be independent before controls can own them").toBe(SPEC_MATRIX.length);
    for (const primary of primaries) {
      const controls = SENSITIVITY_CONTROLS.filter((control) => control.expectedFailures.length === 1 && control.expectedFailures[0] === primary);
      expect(controls, primary + " needs exactly one dedicated sensitivity control").toHaveLength(1);
      const control = controls[0];
      expect(Array.isArray(control.allowedCollateral), primary + " must declare collateral explicitly").toBe(true);
      expect(new Set(control.allowedCollateral).size, primary + " collateral entries must be unique").toBe(control.allowedCollateral.length);
      expect(control.allowedCollateral).not.toContain(primary);
    }
  });

  it("keeps collateral explicit for the five split spec behaviors", () => {
    for (const [primary, collateral] of Object.entries(REQUIRED_PRIMARY_COLLATERAL)) {
      const control = SENSITIVITY_CONTROLS.find((candidate) => candidate.expectedFailures.length === 1 && candidate.expectedFailures[0] === primary);
      expect(control, primary + " needs an intentional behavior control").toBeDefined();
      expect(control!.allowedCollateral, primary + " must disclose expected collateral").toEqual(collateral);
    }
  });
});
