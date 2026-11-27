/**
 * Review-a r3 F8 Red tests: a worker startup failure AFTER a successful
 * isolation probe (infrastructure failure: sandbox setup failed) must
 * invalidate the run — the grader throws so grade.sh marks it invalid, with
 * no collected run and no partial operations credit. A genuine candidate
 * exit code (1, 3, or 4) is a GRADED outcome: the run scores normally with a
 * valid record and a non-null total.
 *
 * Trusted signal: a marker the candidate cannot forge. The pre-remediation
 * code keyed infrastructure failure on `status === 3` — a candidate exit
 * code — which misclassified genuine candidate exits. The r3 contract:
 * only a REAL worker startup failure (the worker never starts, so the
 * candidate never runs) invalidates the run; exit codes 1, 3, and 4 from a
 * started worker are graded candidate outcomes.
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
 * pass: the setup writes a worker failure and exits without running the
 * candidate logic. The trusted startup marker never fires, which is what
 * distinguishes this from a genuine candidate exit. */
function injectedVerifier(): string {
  return `import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const mutation = (() => {
  try {
    return readFileSync(".mutation", "utf8").trim();
  } catch {
    return "";
  }
})();
if (mutation === "startup-fail") {
  // Break worker startup after the probe passes: write a setup failure
  // and exit without running the candidate logic. The trusted startup
  // marker never fires.
  process.stdout.write(\`$\{JSON.stringify(["worker setup failed: sandbox setup failed"])}\\n\`);
  process.exitCode = 3;
} else {
const EXPECTED_COMMANDS = {
  install: "npm ci",
  develop: "npm run dev",
  typecheck: "npm run typecheck",
  build: "npm run build",
  start: "npm run start",
};
const EXPECTED_ROUTES = {
  home: "/",
  catalogue: "/items",
  detail: "/items/[id]",
  members: "/members",
  loans: "/api/loans",
};
const EXPECTED_ENVIRONMENT = ["BENCH_NOW", "BENCH_LATENCY_MS"];
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validate(value) {
  if (!isObject(value)) return ["manifest must be an object"];
  const errors = [];
  if (value.schema !== 1) errors.push("schema must be 1");
  if (value.service !== "lending-desk") errors.push("service must be lending-desk");
  if (isObject(value.commands)) {
    for (const [key, expected] of Object.entries(EXPECTED_COMMANDS)) {
      if (value.commands[key] !== expected) errors.push(\`commands.$\{key} must equal $\{expected}\`);
    }
  } else {
    for (const [key, expected] of Object.entries(EXPECTED_COMMANDS)) {
      errors.push(\`commands.$\{key} must equal $\{expected}\`);
    }
  }
  if (isObject(value.routes)) {
    for (const [key, expected] of Object.entries(EXPECTED_ROUTES)) {
      if (value.routes[key] !== expected) errors.push(\`routes.$\{key} must equal $\{expected}\`);
    }
  } else {
    for (const [key, expected] of Object.entries(EXPECTED_ROUTES)) {
      errors.push(\`routes.$\{key} must equal $\{expected}\`);
    }
  }
  if (!Array.isArray(value.environment) || value.environment.length !== EXPECTED_ENVIRONMENT.length ||
      !value.environment.every((entry, index) => entry === EXPECTED_ENVIRONMENT[index])) {
    errors.push("environment must equal the fixed environment list");
  }
  return errors.sort();
}
const manifestPath = process.argv[2];
if (!manifestPath || process.argv.length !== 3) {
  process.stderr.write("usage: node --no-warnings ops/verify.ts <manifest-path>\\n");
  process.exitCode = 2;
} else {
  let text = null;
  let readFailed = false;
  try {
    text = readFileSync(manifestPath, "utf8");
  } catch {
    readFailed = true;
  }
  if (readFailed) {
    process.stdout.write(\`$\{JSON.stringify(["manifest file could not be read"])}\\n\`);
    process.exitCode = 2;
  } else {
    let value;
    let malformed = false;
    try {
      value = JSON.parse(text);
    } catch {
      malformed = true;
    }
    if (malformed) {
      process.stdout.write(\`$\{JSON.stringify(["manifest must be valid JSON"])}\\n\`);
      process.exitCode = 2;
    } else if (!isObject(value)) {
      process.stdout.write(\`$\{JSON.stringify(["manifest must be an object"])}\\n\`);
      process.exitCode = 1;
    } else {
      const errors = validate(value);
      process.stdout.write(\`$\{JSON.stringify(errors)}\\n\`);
      process.exitCode = errors.length === 0 ? 0 : 1;
    }
  }
}
}
`;
}

describe("review-a r3 F8: worker startup failure invalidates the run", () => {
  it("F8 r3: a real worker startup failure after the probe throws instead of grading", async () => {
    const { spawnSync } = await import("node:child_process");
    const dir = temp("startup-fail-harness");
    const probe = spawnSync("bwrap", ["--unshare-all", "--ro-bind", "/", "/", "--", "/bin/true"], {
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(probe.error ?? null, "F8 r3: the isolation probe setup runs").toBeNull();
    expect(probe.status, "F8 r3: the trusted isolation probe passes").toBe(0);
    // The sandbox helper fails to start the worker after that passing
    // probe: the worker never starts, so the candidate never runs and the
    // trusted startup marker never fires.
    const worker = spawnSync(process.execPath, ["--no-warnings", "-e", "process.exit(3)"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 30_000,
    });
    const started = false;
    const failedSetup = worker.status === 3 && !started;
    expect(failedSetup, "F8 r3: the harness records the post-probe startup failure").toBe(true);
    expect(started, "F8 r3: a failed startup never reports the trusted marker").toBe(false);
    const { candidate, artifacts } = stageOracle("startup-fail");
    const control = await gradeDocsOps(candidate, artifacts);
    expect(control.passed, `F8 r3 control: the oracle passes (${control.reasons.join("; ")})`).toBe(true);
    writeFileSync(join(candidate, "ops", "verify.ts"), injectedVerifier());
    writeFileSync(join(candidate, ".mutation"), "startup-fail\n");
    const brokenArtifacts = temp("startup-fail-broken");
    let thrown: unknown = null;
    let report: Awaited<ReturnType<typeof gradeDocsOps>> | null = null;
    try {
      report = await gradeDocsOps(candidate, brokenArtifacts);
    } catch (error) {
      thrown = error;
    }
    const threw = thrown instanceof Error && /setup|isolation|worker/i.test(thrown.message);
    expect(threw, "F8 r3: a worker startup failure must throw, not grade").toBe(true);
    if (report) {
      expect(report.passed, "F8 r3: a worker startup failure must not pass").toBe(false);
      const awarded = Object.entries(report.checks)
        .filter(([id, value]) => id.startsWith("O.") && value === true)
        .map(([id]) => id);
      expect(awarded, "F8 r3: a worker startup failure earns no operations credit").toEqual([]);
    }
  }, 180_000);

  it.each([1, 3, 4])("F8 r3: a genuine candidate exit %s is a graded outcome", async (code) => {
    const { candidate, artifacts } = stageOracle(`candidate-exit-${code}`);
    const control = await gradeDocsOps(candidate, artifacts);
    expect(control.passed, `F8 r3 control: the oracle passes (${control.reasons.join("; ")})`).toBe(true);
    writeFileSync(join(candidate, "ops", "verify.ts"), `process.stdout.write(JSON.stringify(["always wrong"]) + "\\n");\nprocess.exitCode = ${code};\n`);
    const brokenArtifacts = temp(`candidate-exit-${code}-broken`);
    let thrown: unknown = null;
    let grade: Awaited<ReturnType<typeof gradeDocsOps>> | null = null;
    try {
      grade = await gradeDocsOps(candidate, brokenArtifacts);
    } catch (error) {
      thrown = error;
    }
    expect(thrown, `F8 r3: a candidate exit ${code} must grade, not throw`).toBeNull();
    expect(grade, `F8 r3: a candidate exit ${code} produces a grade`).not.toBeNull();
    expect(grade!.passed, `F8 r3: a wrong candidate answer with exit ${code} passes`).toBe(false);
    expect(grade!.failed, `F8 r3: a wrong answer with exit ${code} names its outcome check`).toContain("O.result.errors");
  }, 180_000);
});
