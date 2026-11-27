/**
 * Review-a r3 F5 Red tests: the grader must exercise a WRONG-LENGTH
 * environment array with an otherwise valid prefix (manifest environment
 * ["BENCH_NOW"] with otherwise valid fields): the required error and exit
 * 1. A mutation test starts from the oracle and removes the length
 * comparison: the mutated verifier must fail O.result.errors and the
 * exit-code check.
 *
 * All fail on the current code, which has no short-prefix environment
 * manifest in its staged set and no length-removal mutation coverage.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { writeVariant } from "../../bugfix/make-variant.js";
import { generateDocsOpsVariant } from "../../docs-and-ops/make-variant.js";
import { gradeDocsOps, VALID_MANIFEST } from "../../docs-and-ops/grade-docs-ops.js";

const HARNESS = resolve(import.meta.dirname, "../..");
const ENV_ERROR = "environment must equal the fixed environment list";
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function temp(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `docs-ops-f5r3-${tag}-`));
  roots.push(dir);
  return dir;
}

/** The otherwise valid manifest with a short environment prefix, built
 * from the grader's own fixed manifest so the input cannot drift. */
function shortEnvironmentManifest(): string {
  return JSON.stringify({ ...VALID_MANIFEST, environment: ["BENCH_NOW"] });
}

function stageOracle(tag: string): { candidate: string; artifacts: string } {
  const variant = generateDocsOpsVariant("d1");
  const candidate = temp(`${tag}-candidate`);
  writeVariant(variant, candidate);
  cpSync(join(HARNESS, "docs-and-ops", "oracle-overlay"), candidate, { recursive: true });
  return { candidate, artifacts: temp(`${tag}-artifacts`) };
}

describe("review-a r3 F5: the grader exercises a wrong-length environment", () => {
  // Already satisfied at HEAD: the pure grader enforces the strict
  // environment list and the oracle rejects the short prefix. These stay
  // as guards for the exact error and exit-code contract; the r3 gap is
  // the full-grade length-removal mutation below.
  it("F5 r3: the required error names the environment list", () => {
    expect(ENV_ERROR, "F5 r3: the required error is pinned").toBe(
      "environment must equal the fixed environment list",
    );
    expect(JSON.parse(shortEnvironmentManifest()).environment, "F5 r3: the prefix is short").toEqual([
      "BENCH_NOW",
    ]);
  });

  it("F5 r3: the pure grader fails O.result.errors and O.exit-code for a short environment", async () => {
    const { gradeVerifier } = await import("../../docs-and-ops/grade-docs-ops.js");
    const grade = gradeVerifier({
      manifest: shortEnvironmentManifest(),
      resultJson: "[]",
      exitCode: 0,
      cleanEnv: true,
      timedOut: false,
    });
    expect(grade.passed, "F5 r3: a clean pass for a short environment passes").toBe(false);
    expect(grade.failed, "F5 r3: the short length fails O.result.errors").toContain("O.result.errors");
    expect(grade.failed, "F5 r3: the short length fails O.exit-code").toContain("O.exit-code");
  });

  it("F5 r3: the oracle verifier rejects a short environment with the required error and exit 1", async () => {
    const { spawnSync } = await import("node:child_process");
    const node = process.execPath;
    const manifestPath = join(temp("short-manifest"), "env-short.json");
    writeFileSync(manifestPath, shortEnvironmentManifest());
    const run = spawnSync(node, ["--no-warnings", join(HARNESS, "docs-and-ops", "oracle-overlay", "ops", "verify.ts"), manifestPath], {
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(run.error ?? null, "F5 r3: the oracle verifier runs").toBeNull();
    expect(JSON.parse(run.stdout), "F5 r3: the oracle prints the required error").toEqual([ENV_ERROR]);
    expect(String(run.stdout).endsWith("\n"), "F5 r3: the oracle prints one newline").toBe(true);
    expect(run.status, "F5 r3: the oracle exits 1 for a short environment").toBe(1);
  }, 120_000);

  it("F5 r3: a verifier with its length comparison removed fails O.result.errors and O.exit-code", async () => {
    const { candidate, artifacts } = stageOracle("short-length");
    const control = await gradeDocsOps(candidate, artifacts);
    expect(control.passed, `F5 r3 control: the oracle passes (${control.reasons.join("; ")})`).toBe(true);
    const oracleVerifier = readFileSync(join(HARNESS, "docs-and-ops", "oracle-overlay", "ops", "verify.ts"), "utf8");
    const withLengthRemoved = oracleVerifier.replace(
      "value.environment.length !== EXPECTED_ENVIRONMENT.length ||",
      "false ||",
    );
    expect(withLengthRemoved, "F5 r3: the length comparison is present to remove").not.toBe(oracleVerifier);
    writeFileSync(join(candidate, "ops", "verify.ts"), withLengthRemoved);
    const mutatedArtifacts = temp("short-length-broken");
    const grade = await gradeDocsOps(candidate, mutatedArtifacts);
    expect(grade.passed, "F5 r3: a verifier without the length comparison passes").toBe(false);
    expect(grade.failed, "F5 r3: the missing length check fails O.result.errors").toContain("O.result.errors");
    expect(grade.failed, "F5 r3: the missing length check fails the exit-code check").toContain("O.exit-code");
  }, 180_000);
});
