/**
 * Review-a F1 (Blocker) Red tests: the candidate-written ops/verify.ts must
 * run isolated — network disabled, restricted file access (no read of the
 * host home or credentials, no write outside a private temp directory),
 * bounded process lifetime, score artifacts and host credentials outside
 * the worker.
 *
 * No grader-side isolation mechanism exists in the harness (run.sh isolates
 * *agent* runs in podman containers; grade.sh and grade-docs-ops.ts run
 * candidate code directly on the host), so these tests pin the behavioral
 * contract, not a tool: each hostile verifier either is blocked or fails
 * the run, and the canary is untouched.
 *
 * Every test stages an oracle-passing candidate, swaps in one hostile
 * verifier that mimics the oracle exactly when its attack succeeds (so the
 * grade would pass) and fails closed with ["blocked"] when blocked, then
 * asserts the grade fails the run and the attack left no mark. All fail on
 * the current host-executed grader (F1) and pass once the verifier runs in
 * an isolated worker.
 */
import { createServer } from "node:net";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { writeVariant } from "../../bugfix/make-variant.js";
import { generateDocsOpsVariant } from "../../docs-and-ops/make-variant.js";
import { gradeDocsOps } from "../../docs-and-ops/grade-docs-ops.js";

const HARNESS = resolve(import.meta.dirname, "../..");
const ROOT = resolve(HARNESS, "..");
const ORACLE_RUNBOOK = readFileSync(join(HARNESS, "docs-and-ops", "oracle-overlay", "docs", "runbook.md"), "utf8");
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function temp(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `docs-ops-f1-${tag}-`));
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

/** A verifier that runs `attack` first: success continues with the exact
 * oracle logic (so an unblocked attack grades as a pass); any block fails
 * closed with ["blocked"] exit 0 (so a blocked attack fails the grade). */
function hostileVerifier(prelude: string): string {
  return `import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createConnection } from "node:net";
import { spawnSync } from "node:child_process";
const failClosed = () => {
  process.stdout.write(\`$\{JSON.stringify(["blocked"])}\\n\`);
  process.exitCode = 0;
};
let attackOk = false;
async function main() {
try {
${prelude}
  attackOk = true;
} catch {
  attackOk = false;
}
if (!attackOk) {
  failClosed();
  return;
}
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
  if (!Array.isArray(value.environment) || value.environment.join("\\0") !== EXPECTED_ENVIRONMENT.join("\\0")) {
    errors.push("environment must equal the fixed environment list");
  }
  return errors.sort();
}
const usageLine = (() => {
  try {
    const spec = readFileSync("measure/tracks/lending_desk_docs_ops/spec.md", "utf8");
    const found = spec.split("\\n").map((entry) => entry.trim()).find((entry) => entry.indexOf("usage:") === 0);
    if (found) return found;
  } catch {
  }
  return "usage: tsx ops/verify.ts <manifest-path>";
})();
const manifestPath = process.argv[2];
if (!manifestPath || process.argv.length !== 3) {
  process.stderr.write(\`$\{usageLine\}\\n\`);
  process.exitCode = 2;
} else {
  let text;
  try {
    text = readFileSync(manifestPath, "utf8");
  } catch {
    process.stdout.write(\`$\{JSON.stringify(["manifest file could not be read"])}\\n\`);
    process.exitCode = 2;
    text = null;
  }
  if (text !== null) {
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      value = undefined;
    }
    if (value === undefined) {
      process.stdout.write(\`$\{JSON.stringify(["manifest must be valid JSON"])}\\n\`);
      process.exitCode = 2;
    } else {
      const errors = validate(value);
      process.stdout.write(\`$\{JSON.stringify(errors)}\\n\`);
      process.exitCode = errors.length === 0 ? 0 : 1;
    }
  }
}
}
main();
`;
}

function artifactTexts(artifacts: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of ["results.json", "docs-ops-grade.json", "docs-ops-valid.json", "docs-ops-invalid.json"]) {
      const file = join(dir, entry);
      if (existsSync(file)) out.push(readFileSync(file, "utf8"));
    }
  };
  visit(artifacts);
  return out;
}

describe("review-a F1: candidate verifier isolation", () => {
  it("F1: blocks reads outside the candidate and fails the run, leaving the canary untouched", async () => {
    const dir = temp("read");
    const canary = join(dir, "host-canary-secret");
    const secret = `docs-ops-host-canary-${process.pid}-${Date.now()}`;
    writeFileSync(canary, `host credential: ${secret}\n`);
    const { candidate, artifacts } = stageOracle("read");
    writeFileSync(
      join(candidate, "ops", "verify.ts"),
      hostileVerifier(`const stolen = readFileSync(${JSON.stringify(canary)}, "utf8");
    if (!stolen.includes(${JSON.stringify(secret)})) throw new Error("canary mismatch");`),
    );
    const report = await gradeDocsOps(candidate, artifacts);
    expect(report.passed, "F1: a verifier that reads host files must fail the run").toBe(false);
    expect(readFileSync(canary, "utf8"), "F1: the canary is untouched").toContain(secret);
    for (const text of artifactTexts(artifacts)) {
      expect(text, "F1: the host secret never reaches the artifacts").not.toContain(secret);
    }
  }, 120_000);

  it("F1: blocks writes outside the private temp directory and fails the run", async () => {
    const dir = temp("write");
    const marker = join(dir, "escaped-write-marker");
    const { candidate, artifacts } = stageOracle("write");
    writeFileSync(
      join(candidate, "ops", "verify.ts"),
      hostileVerifier(`writeFileSync(${JSON.stringify(marker)}, "escaped\\n");`),
    );
    const report = await gradeDocsOps(candidate, artifacts);
    expect(report.passed, "F1: a verifier that writes outside must fail the run").toBe(false);
    expect(existsSync(marker), "F1: no write escapes the worker").toBe(false);
  }, 120_000);

  it("F1: blocks forgery of the result file and fails the run", async () => {
    const { candidate, artifacts } = stageOracle("forge");
    writeFileSync(
      join(candidate, "ops", "verify.ts"),
      hostileVerifier(`const manifestArg = process.argv[2];
    if (manifestArg) {
      writeFileSync(join(dirname(manifestArg), "forged-by-verifier.json"), "forged\\n");
    }`),
    );
    const report = await gradeDocsOps(candidate, artifacts);
    expect(report.passed, "F1: a verifier that forges results must fail the run").toBe(false);
    expect(
      existsSync(join(artifacts, "forged-by-verifier.json")),
      "F1: score artifacts stay outside the worker",
    ).toBe(false);
  }, 120_000);

  it("F1: blocks network access to a local listener and fails the run", async () => {
    let connections = 0;
    const server = createServer((socket) => {
      connections += 1;
      socket.destroy();
    });
    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolveListen());
    });
    const port = (server.address() as { port: number }).port;
    try {
      const { candidate, artifacts } = stageOracle("network");
      writeFileSync(
        join(candidate, "ops", "verify.ts"),
        hostileVerifier(`await new Promise((resolveNet, rejectNet) => {
    const socket = createConnection({ host: "127.0.0.1", port: ${port} }, () => {
      socket.destroy();
      resolveNet(true);
    });
    socket.setTimeout(2000, () => {
      socket.destroy();
      rejectNet(new Error("no network"));
    });
    socket.once("error", rejectNet);
  });`),
      );
      const report = await gradeDocsOps(candidate, artifacts);
      expect(report.passed, "F1: a verifier that reaches the network must fail the run").toBe(false);
      expect(connections, "F1: no connection reaches the listener").toBe(0);
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  }, 120_000);

  it("F1: bounds the worker lifetime so no detached worker outlives the grade", async () => {
    const dir = temp("lifetime");
    const marker = join(dir, "escaped-worker-marker");
    const { candidate, artifacts } = stageOracle("lifetime");
    writeFileSync(
      join(candidate, "ops", "verify.ts"),
      hostileVerifier(`spawnSync("bash", ["-c", ${JSON.stringify(`setsid bash -c 'sleep 6; echo escaped > ${marker}' < /dev/null > /dev/null 2>&1 &`)}]);`),
    );
    const report = await gradeDocsOps(candidate, artifacts);
    expect(report, "F1: the grade completes").toBeDefined();
    const deadline = Date.now() + 12_000;
    while (!existsSync(marker) && Date.now() < deadline) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
    expect(existsSync(marker), "F1: no detached worker outlives the grade").toBe(false);
  }, 120_000);
});
