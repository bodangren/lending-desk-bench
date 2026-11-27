/**
 * Review-a r2 F8 Red tests: a worker startup failure AFTER a successful
 * isolation probe (infrastructure failure: sandbox setup failed, non-null
 * exit status from the setup, not from the candidate) must make the grader
 * THROW / fail the grade so grade.sh invalidates the run — no partial
 * operations credit, no "collected" run. A genuine candidate nonzero exit
 * code stays a graded outcome.
 *
 * Production shape (grade-docs-ops.ts): gradeDocsOps calls
 * resolveIsolation() first (bwrap probe; throws when isolation is
 * unavailable), then runs every verifier invocation inside the worker.
 * runVerifier records completed=false with an isolationError for a spawn or
 * sandbox setup failure (exit statuses the candidate cannot emit). The F8
 * contract: when the probe passes but a later worker startup fails, the
 * grade must not award operations checks and must not resolve normally with
 * partial credit. All fail on the current code, which grades a post-probe
 * worker setup failure as a completed candidate outcome.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { writeVariant } from "../../bugfix/make-variant.js";
import { generateDocsOpsVariant } from "../../docs-and-ops/make-variant.js";
import { gradeDocsOps } from "../../docs-and-ops/grade-docs-ops.js";

const HARNESS = resolve(import.meta.dirname, "../..");
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function temp(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `docs-ops-f8-${tag}-`));
  roots.push(dir);
  return dir;
}

function stageOracle(tag: string): { candidate: string; artifacts: string } {
  const variant = generateDocsOpsVariant("d1");
  const candidate = temp(`${tag}-candidate`);
  writeVariant(variant, candidate);
  cpSync(join(HARNESS, "docs-and-ops", "oracle-overlay"), candidate, { recursive: true });
  return { candidate, artifacts: temp(`${tag}-artifacts`) };
}

/** A verifier whose first lines break worker startup AFTER the probe would
 * pass: the manifest-side setup exits nonzero for a reason the candidate
 * cannot cause (no such manifest is staged). The trusted signal is the
 * worker's own startup status, not the candidate exit code. */
function setupFailingVerifier(reason: string): string {
  return `import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
const probe = spawnSync("bwrap", ["--unshare-all", "--ro-bind", "/", "/", "--", "/bin/true"], { stdio: "ignore" });
if (probe.error || probe.status !== 0) process.exit(3);
const manifestPath = process.argv[2];
if (!manifestPath || process.argv.length !== 3) {
  process.stderr.write("usage: node --no-warnings ops/verify.ts <manifest-path>\\n");
  process.exitCode = 2;
} else if (!existsSync(manifestPath)) {
  process.stdout.write(\`$\{JSON.stringify(["worker setup failed: ${reason}"])}\\n\`);
  process.exitCode = 3;
} else {
  let value;
  try {
    value = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    process.stdout.write(\`$\{JSON.stringify(["manifest must be valid JSON"])}\\n\`);
    process.exitCode = 2;
    value = undefined;
  }
  if (value !== undefined) {
    process.stdout.write(\`$\{JSON.stringify([])}\\n\`);
    process.exitCode = 0;
  }
}
`;
}

describe("review-a r2 F8: worker startup failure invalidates the run", () => {
  it("F8 r2: a failing worker setup after the probe throws instead of grading", async () => {
    const { candidate, artifacts } = stageOracle("setup-fail");
    const control = await gradeDocsOps(candidate, artifacts);
    expect(control.passed, `F8 r2 control: the oracle passes (${control.reasons.join("; ")})`).toBe(true);
    writeFileSync(join(candidate, "ops", "verify.ts"), setupFailingVerifier("sandbox setup failed"));
    const brokenArtifacts = temp("setup-fail-broken");
    let thrown: unknown = null;
    let report: Awaited<ReturnType<typeof gradeDocsOps>> | null = null;
    try {
      report = await gradeDocsOps(candidate, brokenArtifacts);
    } catch (error) {
      thrown = error;
    }
    const threw = thrown instanceof Error && /setup|isolation|worker/i.test(thrown.message);
    expect(threw, "F8 r2: a worker setup failure must throw, not grade").toBe(true);
    if (report) {
      expect(report.passed, "F8 r2: a worker setup failure must not pass").toBe(false);
      const awarded = Object.entries(report.checks)
        .filter(([id, value]) => id.startsWith("O.") && value === true)
        .map(([id]) => id);
      expect(awarded, "F8 r2: a worker setup failure earns no operations credit").toEqual([]);
    }
  }, 180_000);

  it("F8 r2: a genuine candidate nonzero exit stays a graded outcome", async () => {
    const { candidate, artifacts } = stageOracle("candidate-exit");
    const control = await gradeDocsOps(candidate, artifacts);
    expect(control.passed, `F8 r2 control: the oracle passes (${control.reasons.join("; ")})`).toBe(true);
    writeFileSync(join(candidate, "ops", "verify.ts"), `process.stdout.write(\`$\{JSON.stringify(["always wrong"])}\\n\`);\nprocess.exitCode = 1;\n`);
    const brokenArtifacts = temp("candidate-exit-broken");
    const grade = await gradeDocsOps(candidate, brokenArtifacts);
    expect(grade.passed, "F8 r2: a wrong candidate answer passes").toBe(false);
    expect(grade.failed, "F8 r2: a wrong answer names its outcome check").toContain("O.result.errors");
  }, 180_000);
});
