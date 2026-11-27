import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { assessCandidateContract } from "../../candidate-contract.js";
import { generateDocsOpsVariant } from "../../docs-and-ops/make-variant.js";
import { gradeDocsOps } from "../../docs-and-ops/grade-docs-ops.js";
import { writeVariant } from "../../bugfix/make-variant.js";
import { DOCS_OPS_CRITERIA } from "../criteria.js";
import { deriveDocsOpsScoreMetrics } from "../../score-calculation.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const roots: string[] = [];

function temp(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `docs-ops-${tag}-`));
  roots.push(dir);
  return dir;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const cleanDoctor = () => ({
  ok: true, errors: 0, warnings: 0, byCategory: {}, byRule: {}, diagnostics: [],
});

describe("docs-and-ops integration", () => {
  it("generates a deterministic candidate with the correct app and writable task files", () => {
    const first = generateDocsOpsVariant("d1");
    const second = generateDocsOpsVariant("d1");
    expect(first.manifest.variant_sha256).toBe(second.manifest.variant_sha256);
    const root = temp("variant");
    const candidate = temp("candidate");
    writeVariant(first, root);
    writeVariant(first, candidate);
    expect(assessCandidateContract(root, candidate, { track: "docs-and-ops" }))
      .toMatchObject({ valid: true, gradeable: true });
    for (const path of ["src/lib/loans.ts", "src/actions/loans.ts", "app/api/loans/route.ts"]) {
      expect(readFileSync(join(candidate, path))).toEqual(readFileSync(join(ROOT, "reference", path)));
    }
    writeFileSync(join(candidate, "docs", "runbook.md"), "candidate work\n");
    expect(assessCandidateContract(root, candidate, { track: "docs-and-ops" }).valid).toBe(true);
    writeFileSync(join(candidate, "package.json"), "{}\n");
    expect(assessCandidateContract(root, candidate, { track: "docs-and-ops" }).soft)
      .toContain("protected_modified");
  });

  it("passes the oracle and fails the untouched stubs on declared checks", async () => {
    const variant = generateDocsOpsVariant("d1");
    const oracle = temp("oracle");
    const broken = temp("broken");
    writeVariant(variant, oracle);
    writeVariant(variant, broken);
    cpSync(join(ROOT, "harness/docs-and-ops/oracle-overlay"), oracle, { recursive: true });
    const oracleArtifacts = temp("oracle-artifacts");
    const brokenArtifacts = temp("broken-artifacts");
    const [oracleGrade, brokenGrade] = await Promise.all([
      gradeDocsOps(oracle, oracleArtifacts),
      gradeDocsOps(broken, brokenArtifacts),
    ]);
    expect(oracleGrade.passed, oracleGrade.reasons.join("; ")).toBe(true);
    expect(oracleGrade.failed).toEqual([]);
    expect(Object.values(oracleGrade.checks).every(Boolean)).toBe(true);
    expect(brokenGrade.passed).toBe(false);
    expect(brokenGrade.failed).toEqual(expect.arrayContaining(["D.commands.install", "O.valid.behavior"]));
  }, 60_000);

  it("gates both secondary axes on the primary mean", () => {
    const ids = Object.keys(DOCS_OPS_CRITERIA);
    const all = Object.fromEntries(ids.map((id) => [id, true]));
    const none = Object.fromEntries(ids.map((id) => [id, false]));
    const documentationOnly = Object.fromEntries(ids.map((id) => [id, id.startsWith("D.")]));
    expect(deriveDocsOpsScoreMetrics({ passed: all, doctorReport: cleanDoctor(), penalty: 0 }).raw).toBe(100);
    const empty = deriveDocsOpsScoreMetrics({ passed: none, doctorReport: cleanDoctor(), penalty: 0 });
    expect(empty.axes).toMatchObject({ documentation: 0, operations: 0, adherence: 0, quality: 0 });
    const partial = deriveDocsOpsScoreMetrics({
      passed: documentationOnly, doctorReport: cleanDoctor(), penalty: 0,
    });
    expect(partial.axes.documentation).toBe(1);
    expect(partial.axes.operations).toBe(0);
    expect(partial.axes.adherence).toBeCloseTo(5 / 6, 9);
    expect(partial.axes.quality).toBeCloseTo(5 / 6, 9);
  });
});
