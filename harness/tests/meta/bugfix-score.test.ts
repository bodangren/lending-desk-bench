import { describe, expect, it } from "vitest";
import { deriveBugfixScoreMetrics } from "../../score-calculation.js";
import { BUG_REGISTRY } from "../../bugfix/registry.js";
import { loadSet, setBugs } from "../../bugfix/set-loader.js";
import { CRITERIA, PROBES } from "../criteria.js";
import type { DoctorReport } from "../../doctor.js";

const cleanDoctor = (): DoctorReport => ({ ok: true, errors: 0, warnings: 0, byCategory: {}, byRule: {}, diagnostics: [] });
const setV1 = () => setBugs(loadSet("v1"));
const passingResults = (bugs: ReturnType<typeof setBugs>) => {
  const passed: Record<string, boolean> = {};
  for (const id of Object.keys(CRITERIA)) passed[id] = true;
  for (const id of Object.keys(PROBES)) passed[id] = true;
  for (const bug of bugs) for (const id of bug.detectors) passed[id] = true;
  return passed;
};
const failingDetectors = (bugs: ReturnType<typeof setBugs>) => {
  const passed: Record<string, boolean> = {};
  for (const id of Object.keys(CRITERIA)) passed[id] = true;
  for (const id of Object.keys(PROBES)) passed[id] = true;
  for (const bug of bugs) for (const id of bug.detectors) passed[id] = false;
  return passed;
};

describe("bugfix score arithmetic", () => {
  it("gives a fully repaired, regression-free candidate a perfect score", () => {
    const bugs = setV1();
    const metrics = deriveBugfixScoreMetrics({
      passed: passingResults(bugs),
      bugs,
      doctorReport: cleanDoctor(),
      penalty: 0,
    });
    expect(metrics.axes.repair).toBe(1);
    expect(metrics.axes.regression).toBe(1);
    expect(metrics.axes.robustness).toBe(1);
    expect(metrics.axes.quality).toBe(1);
    expect(metrics.raw).toBeCloseTo(100, 6);
  });

  it("scores the untouched variant with zero repair and a guarded quality axis", () => {
    const bugs = setV1();
    const metrics = deriveBugfixScoreMetrics({
      passed: failingDetectors(bugs),
      bugs,
      doctorReport: cleanDoctor(),
      penalty: 0,
    });
    expect(metrics.axes.repair).toBe(0);
    // Quality is gated on repair: no repairs, no clean-code banking.
    expect(metrics.axes.quality).toBe(0);
    // Regression and robustness stay high: the seeded defects are excluded
    // from those denominators by design.
    expect(metrics.axes.regression).toBeGreaterThan(0.8);
    expect(metrics.axes.robustness).toBe(1);
    // The documented untouched baseline sits near 40.
    expect(metrics.raw).toBeGreaterThan(30);
    expect(metrics.raw).toBeLessThan(45);
  });

  it("weights security repairs double in the repair axis", () => {
    const bugs = setV1();
    const securityBug = bugs.find((bug) => bug.class === "security");
    if (!securityBug) throw new Error("v1 lacks a security bug");
    const passed = failingDetectors(bugs);
    for (const id of securityBug.detectors) passed[id] = true;
    // Security weight 2 of total weight 14 -> exactly 2/14.
    const metrics = deriveBugfixScoreMetrics({
      passed,
      bugs,
      doctorReport: cleanDoctor(),
      penalty: 0,
    });
    const expected = 2 / bugs.reduce((sum, bug) => sum + (bug.class === "security" ? 2 : 1), 0);
    expect(metrics.axes.repair).toBeCloseTo(expected, 9);
  });

  it("keeps repair and regression denominators disjoint", () => {
    const bugs = setV1();
    const detectorIds = new Set(bugs.flatMap((bug) => bug.detectors));
    for (const bug of bugs) {
      for (const id of bug.detectors) {
        expect(detectorIds.has(id), id).toBe(true);
      }
    }
    const passed: Record<string, boolean> = {};
    // Detectors fail; every other criterion and probe passes.
    for (const id of Object.keys(CRITERIA)) passed[id] = !detectorIds.has(id);
    for (const id of Object.keys(PROBES)) passed[id] = !detectorIds.has(id);
    const metrics = deriveBugfixScoreMetrics({
      passed,
      bugs,
      doctorReport: cleanDoctor(),
      penalty: 0,
    });
    // Only the detectors fail; they are excluded from regression/robustness,
    // so both axes stay perfect while repair is zero.
    expect(metrics.axes.regression).toBe(1);
    expect(metrics.axes.robustness).toBe(1);
    expect(metrics.axes.repair).toBe(0);
  });

  it("reports per-class rates", () => {
    const bugs = setV1();
    const metrics = deriveBugfixScoreMetrics({
      passed: passingResults(bugs),
      bugs,
      doctorReport: cleanDoctor(),
      penalty: 0,
    });
    for (const bugClass of ["functional", "security", "performance", "reliability"]) {
      expect(metrics.repair.class_rates[bugClass]).toBe(1);
    }
    expect(Object.keys(BUG_REGISTRY).length).toBeGreaterThan(0);
  });

  it("scores a clean set (no bugs) vacuously at 100", () => {
    const metrics = deriveBugfixScoreMetrics({
      passed: passingResults([]),
      bugs: [],
      doctorReport: cleanDoctor(),
      penalty: 0,
    });
    expect(metrics.axes.repair).toBe(1);
    expect(metrics.axes.regression).toBe(1);
    expect(metrics.axes.robustness).toBe(1);
    expect(metrics.axes.quality).toBe(1);
    expect(metrics.raw).toBeCloseTo(100, 6);
  });
});
