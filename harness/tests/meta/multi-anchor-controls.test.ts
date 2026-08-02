import { describe, expect, it } from "vitest";
import { applyNegativeControl, type NegativeControl } from "../negative-controls";

type Replacement = { from: string; to: string };
type MultiAnchorControl = NegativeControl & { replacements: readonly Replacement[] };

const multi = (replacements: readonly Replacement[]): MultiAnchorControl => ({
  id: "multi-anchor-test",
  target: "synthetic.ts",
  from: "legacy-anchor",
  to: "legacy-replacement",
  expectedFailures: [],
  replacements,
} as MultiAnchorControl);

describe("multi-anchor negative controls", () => {
  it("applies every multi-anchor replacement exactly once", () => {
    const source = "before <first> middle <second> after";
    const mutated = applyNegativeControl(source, multi([
      { from: "<first>", to: "ONE" },
      { from: "<second>", to: "TWO" },
    ]));
    expect(mutated).toBe("before ONE middle TWO after");
  });

  it("rejects duplicate, ambiguous, and no-op multi-anchor replacements", () => {
    expect(() => applyNegativeControl("alpha beta", multi([
      { from: "alpha", to: "one" },
      { from: "alpha", to: "two" },
    ]))).toThrow();
    expect(() => applyNegativeControl("alpha alpha beta", multi([
      { from: "alpha", to: "one" },
      { from: "beta", to: "two" },
    ]))).toThrow();
    expect(() => applyNegativeControl("alpha beta", multi([
      { from: "alpha", to: "alpha" },
      { from: "beta", to: "two" },
    ]))).toThrow();
  });
});
