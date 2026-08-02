import { describe, expect, it } from "vitest";
import { ADVISORY, CRITERIA, PROBES } from "../criteria";
import { deriveScoreMetrics, softTiercale, TIER_GATE } from "../../score-calculation";

const emptyDoctor = () => ({
  ok: true, errors: 0, warnings: 0, byCategory: {}, byRule: {}, diagnostics: [],
});

function allPass(value = true): Record<string, boolean> {
  return Object.fromEntries(
    [...Object.keys(CRITERIA), ...Object.keys(PROBES), ...ADVISORY].map((id) => [id, value]),
  );
}

function withFails(ids: string[]): Record<string, boolean> {
  const passed = allPass(true);
  for (const id of ids) passed[id] = false;
  return passed;
}

describe("soft tier scoring", () => {
  it("softTiercale is linear below the gate and capped at 1", () => {
    expect(softTiercale(1)).toBe(1);
    expect(softTiercale(TIER_GATE)).toBe(1);
    expect(softTiercale(0)).toBe(0);
    expect(softTiercale(0.45)).toBeCloseTo(0.5, 5);
    expect(softTiercale(0.8)).toBeCloseTo(0.8 / 0.9, 5);
  });

  it("scores a perfect suite at 100", () => {
    const metrics = deriveScoreMetrics(allPass(true), emptyDoctor(), 0);
    expect(metrics.raw).toBeCloseTo(100, 5);
    expect(metrics.tiers["0"].scale).toBe(1);
    expect(metrics.tiers["1"].unlocked).toBe(true);
    expect(metrics.tiers["2"].unlocked).toBe(true);
  });

  it("does not zero Tier 1 when Tier 0 is 80% (the old hard-gate dead zone)", () => {
    // Fail three Tier-0 criteria → ~80% T0 with current suite size.
    const t0 = Object.entries(CRITERIA).filter(([, c]) => c.tier === 0).map(([id]) => id);
    expect(t0.length).toBeGreaterThanOrEqual(3);
    const passed = withFails(t0.slice(0, 3));
    const metrics = deriveScoreMetrics(passed, emptyDoctor(), 0);
    expect(metrics.tiers["0"].rate).toBeLessThan(TIER_GATE);
    expect(metrics.tiers["1"].unlocked).toBe(false);
    // Soft scale still counts T1/T2 proportionally — not a ~17-point floor.
    expect(metrics.tiers["1"].scale).toBeGreaterThan(0.8);
    expect(metrics.tiers["1"].counted).toBe(true);
    expect(metrics.raw).toBeGreaterThan(50);
    expect(metrics.raw).toBeLessThan(95);
  });

  it("preserves discrimination among mid-pack suites instead of collapsing them", () => {
    const t0 = Object.entries(CRITERIA).filter(([, c]) => c.tier === 0).map(([id]) => id);
    const t1 = Object.entries(CRITERIA).filter(([, c]) => c.tier === 1).map(([id]) => id);
    // Same T0 damage; different T1 damage.
    const weaker = withFails([...t0.slice(0, 3), ...t1.slice(0, 8)]);
    const stronger = withFails([...t0.slice(0, 3), ...t1.slice(0, 2)]);
    const weakScore = deriveScoreMetrics(weaker, emptyDoctor(), 0).raw;
    const strongScore = deriveScoreMetrics(stronger, emptyDoctor(), 0).raw;
    expect(strongScore - weakScore).toBeGreaterThan(5);
  });

  it("still suppresses polish when Tier 0 is empty", () => {
    const t0 = Object.entries(CRITERIA).filter(([, c]) => c.tier === 0).map(([id]) => id);
    const passed = withFails(t0); // every T0 criteria fails; T1/T2 criteria all pass
    const metrics = deriveScoreMetrics(passed, emptyDoctor(), 0);
    expect(metrics.tiers["0"].rate).toBe(0);
    expect(metrics.tiers["1"].scale).toBe(0);
    expect(metrics.tiers["2"].scale).toBe(0);
    // Higher-tier criteria contribute nothing; only remaining Tier-0 probes can score.
    expect(metrics.axes.completion).toBe(0);
    expect(metrics.raw).toBeLessThan(10);
  });
});

