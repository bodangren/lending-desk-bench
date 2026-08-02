import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const VERIFY_CONTROLS = resolve(ROOT, "harness", "verify-controls.ts");

function source(): string {
  return readFileSync(VERIFY_CONTROLS, "utf8").replace(/\s+/g, " ");
}

describe("sensitivity-control calibration status", () => {
  it("uses the live score attestor and exposes strict host evidence in each control report", () => {
    const verifier = source();

    expect(verifier).toContain("assessScoreFreshness");
    expect(verifier).toMatch(/scoreFreshness\.score_current\s*===\s*true/);
    expect(verifier).toMatch(/scoreFreshness\.host_trusted\s*===\s*true/);
    expect(verifier).toMatch(/score_current:\s*boolean;/);
    expect(verifier).toMatch(/host_trusted:\s*boolean;/);
    expect(verifier).toMatch(/sensitivity_passed:\s*boolean;/);
    expect(verifier).toMatch(/calibration_passed:\s*boolean;/);
  });

  it("does not use a diagnostic under-load control as calibration evidence", () => {
    const verifier = source();

    expect(verifier).toMatch(/const sensitivityPassed\s*=\s*issues\.length\s*===\s*0;/);
    expect(verifier).toMatch(/const calibrationPassed\s*=\s*sensitivityPassed\s*&&\s*hostTrusted;/);
    expect(verifier).toMatch(/sensitivity_passed:\s*sensitivityPassed,/);
    expect(verifier).toMatch(/calibration_passed:\s*calibrationPassed,/);
    expect(verifier).toMatch(/passed:\s*calibrationPassed,/);
  });

  it("makes every --all and --fast batch summary explicitly false when calibration is not trusted", () => {
    const verifier = source();
    const summary = verifier.slice(verifier.indexOf("const summary = {"));

    expect(summary).toMatch(/sensitivity_passed:\s*report\.sensitivity_passed,/);
    expect(summary).toMatch(/calibration_passed:\s*report\.calibration_passed,/);
    expect(summary).toMatch(/sensitivity_passed:\s*reports\.every\(\(report\)\s*=>\s*report\.sensitivity_passed\),/);
    expect(summary).toMatch(/calibration_passed:\s*reports\.every\(\(report\)\s*=>\s*report\.calibration_passed\),/);
    expect(summary).toMatch(/passed:\s*reports\.every\(\(report\)\s*=>\s*report\.calibration_passed\),/);
  });
});
