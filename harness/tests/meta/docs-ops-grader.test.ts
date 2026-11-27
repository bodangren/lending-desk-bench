/**
 * docs-and-ops grader contract (Red for track guide_docs_ops_20261127 task 1.3).
 *
 * Pinned module contract for `harness/docs-and-ops/grade-docs-ops.ts`:
 *   PRIMARY_AXES    ["documentation", "operations"]
 *   SECONDARY_AXES  ["adherence", "quality"]
 *   gateSecondary(mean: number): number — gates adherence and quality on the
 *     mean of the primary axes; 1 stays 1 and 0 stays 0.
 *   declaredCheckIds(): string[] — every documentation and verifier check id;
 *     each id matches /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.
 *   resultIdsValid(ids: string[]): boolean — false when any id is malformed.
 *   gradeRunbook(text: string): { passed, failed, reasons } — the oracle
 *     runbook passes; an empty or placeholder-carrying runbook fails on its
 *     declared checks (required sections, repository commands, route names,
 *     placeholder rejection).
 *   gradeVerifier(input: { manifest, resultJson, exitCode, cleanEnv, timedOut })
 *     : { passed, failed, reasons } — a non-zero exit, a dirty environment,
 *     a timeout, or a malformed manifest fails; identical inputs give
 *     identical outputs (deterministic); reasons come back sorted.
 *
 * Every test fails while the track is missing: the grader module does not
 * exist and the oracle overlay it reads is absent.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { writeVariant } from "../../bugfix/make-variant.js";
import { generateDocsOpsVariant } from "../../docs-and-ops/make-variant.js";
import { gradeDocsOps } from "../../docs-and-ops/grade-docs-ops.js";

const HARNESS = resolve(import.meta.dirname, "../..");
const ORACLE_RUNBOOK = join(HARNESS, "docs-and-ops", "oracle-overlay", "docs", "runbook.md");
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

type Grade = { passed: boolean; failed: string[]; reasons: string[] };

async function grader(): Promise<{
  PRIMARY_AXES: unknown;
  SECONDARY_AXES: unknown;
  gateSecondary: (mean: number) => number;
  declaredCheckIds: () => string[];
  resultIdsValid: (ids: string[]) => boolean;
  gradeRunbook: (text: string) => Grade;
  gradeVerifier: (input: {
    manifest: string;
    resultJson: string;
    exitCode: number;
    cleanEnv: boolean;
    timedOut: boolean;
  }) => Grade;
}> {
  return import("../../docs-and-ops/grade-docs-ops.js");
}

describe("docs-and-ops grader contract", () => {
  it("loads the docs-and-ops grader module", async () => {
    expect(await grader(), "grade-docs-ops.ts loads").toBeDefined();
  });

  it("grades documentation and operations as the primary axes", async () => {
    const mod = await grader();
    expect(mod.PRIMARY_AXES).toEqual(["documentation", "operations"]);
    expect(mod.SECONDARY_AXES).toEqual(["adherence", "quality"]);
  });

  it("gates adherence and quality on the mean of the primary axes", async () => {
    const mod = await grader();
    expect(mod.gateSecondary(1), "a perfect primary mean keeps full secondary").toBe(1);
    expect(mod.gateSecondary(0), "a zero primary mean gates secondary to zero").toBe(0);
  });

  it("declares well-formed check ids and rejects malformed result ids", async () => {
    const mod = await grader();
    const ids = mod.declaredCheckIds();
    expect(ids.length, "the grader declares checks").toBeGreaterThan(0);
    for (const id of ids) expect(id, `check id ${id}`).toMatch(ID_RE);
    expect(mod.resultIdsValid(ids), "declared ids validate").toBe(true);
    expect(mod.resultIdsValid(["!!! not an id"]), "a malformed id invalidates the run").toBe(false);
  });

  it("passes the oracle runbook", async () => {
    const mod = await grader();
    expect(existsSync(ORACLE_RUNBOOK), "the oracle runbook exists").toBe(true);
    const grade = mod.gradeRunbook(readFileSync(ORACLE_RUNBOOK, "utf8"));
    expect(grade.failed, `oracle failures: ${grade.reasons.join("; ")}`).toEqual([]);
    expect(grade.passed).toBe(true);
  });

  it("fails a runbook that is empty or carries placeholders on declared checks", async () => {
    const mod = await grader();
    const declared = mod.declaredCheckIds();
    const oracle = readFileSync(ORACLE_RUNBOOK, "utf8");
    for (const [tag, text] of [["empty", ""], ["placeholder", `${oracle}\nTODO: fill this in\n`]] as Array<
      [string, string]
    >) {
      const grade = mod.gradeRunbook(text);
      expect(grade.passed, `${tag} runbook passes`).toBe(false);
      expect(grade.failed.length, `${tag} runbook names failed checks`).toBeGreaterThan(0);
      for (const id of grade.failed) {
        expect(declared, `${tag} failure ${id} is a declared check`).toContain(id);
      }
    }
  });

  it("fails the verifier on exit codes, a dirty environment, a timeout, and a malformed manifest", async () => {
    const mod = await grader();
    const base = {
      manifest: "{}",
      resultJson: "{}",
      exitCode: 0,
      cleanEnv: true,
      timedOut: false,
    };
    for (const [tag, input] of [
      ["exit code", { ...base, exitCode: 1 }],
      ["dirty environment", { ...base, cleanEnv: false }],
      ["timeout", { ...base, timedOut: true }],
      ["malformed manifest", { ...base, manifest: "{not json" }],
    ] as Array<[string, typeof base]>) {
      const grade = mod.gradeVerifier(input);
      expect(grade.passed, `verifier passes with ${tag}`).toBe(false);
    }
  });

  it("grades the verifier deterministically with sorted reasons", async () => {
    const mod = await grader();
    const input = { manifest: "{not json", resultJson: "{}", exitCode: 1, cleanEnv: false, timedOut: true };
    const first = mod.gradeVerifier(input);
    const second = mod.gradeVerifier(input);
    expect(first.passed).toBe(false);
    expect(second, "identical inputs grade identically").toEqual(first);
    expect(first.reasons, "reasons come back sorted").toEqual([...first.reasons].sort());
  });
});

const F2_ROOTS: string[] = [];
afterAll(() => {
  for (const root of F2_ROOTS) rmSync(root, { recursive: true, force: true });
});

/** Replace the body of one `## <name>` section, keeping its heading. */
function setSectionBody(text: string, name: string, body: string): string {
  const marker = `## ${name}\n`;
  const start = text.indexOf(marker);
  expect(start, `the oracle runbook has a ${name} section`).toBeGreaterThanOrEqual(0);
  const bodyStart = start + marker.length;
  const next = text.indexOf("\n## ", bodyStart);
  const end = next === -1 ? text.length : next + 1;
  return text.slice(0, bodyStart) + body + text.slice(end);
}

/** Move one exact line out of its section to sit under another heading. */
function moveLineOutOfSection(text: string, line: string, target: string): string {
  expect(text, `the oracle runbook holds: ${line}`).toContain(`${line}\n`);
  const removed = text.replace(`${line}\n`, "");
  const marker = `## ${target}\n`;
  const at = removed.indexOf(marker);
  expect(at, `the oracle runbook has a ${target} section`).toBeGreaterThanOrEqual(0);
  const insertAt = at + marker.length;
  return `${removed.slice(0, insertAt)}\n${line}\n${removed.slice(insertAt)}`;
}

const RETURNED_STAYS = "A returned loan stays returned after its due date.";
const DUE_SOON_BOUNDARY = "An open loan is `due-soon` from `now` through the next 48 hours.";
const ROLLBACK_PRESERVATION = "Keep the existing data store and loan records.";
const ROLLBACK_RESTORE = "Deploy the previous release.";

/** Every Verification-section line that names the operations verifier,
 * read from the oracle itself. The F2 case tracks the documented command
 * (F3) instead of pinning a stale tsx string, so the two findings agree
 * whatever runtime the remediation documents. */
function verifierMentionLines(oracle: string): string[] {
  const marker = "## Verification\n";
  const start = oracle.indexOf(marker);
  expect(start, "the oracle runbook has a Verification section").toBeGreaterThanOrEqual(0);
  const bodyStart = start + marker.length;
  const next = oracle.indexOf("\n## ", bodyStart);
  const body = next === -1 ? oracle.slice(bodyStart) : oracle.slice(bodyStart, next + 1);
  const lines = body.split("\n").filter((line) => /verif/i.test(line));
  expect(lines.length, "the oracle Verification names the operations verifier").toBeGreaterThan(0);
  return lines;
}

describe("review-a F2: required facts live inside their sections", () => {
  it("F2: an empty Verification body fails D.sections.verification", async () => {
    const mod = await grader();
    const grade = mod.gradeRunbook(setSectionBody(readFileSync(ORACLE_RUNBOOK, "utf8"), "Verification", "\n"));
    expect(grade.passed, "F2: an empty Verification body passes").toBe(false);
    expect(grade.failed, "F2: the omission names its check").toContain("D.sections.verification");
  });

  it("F2: an empty Rollback body fails D.sections.rollback", async () => {
    const mod = await grader();
    const grade = mod.gradeRunbook(setSectionBody(readFileSync(ORACLE_RUNBOOK, "utf8"), "Rollback", "\n"));
    expect(grade.passed, "F2: an empty Rollback body passes").toBe(false);
    expect(grade.failed, "F2: the omission names its check").toContain("D.sections.rollback");
  });

  it("F2: the returned-loan fact moved out of Loan state fails D.loan.boundary", async () => {
    const mod = await grader();
    const moved = moveLineOutOfSection(readFileSync(ORACLE_RUNBOOK, "utf8"), RETURNED_STAYS, "Environment");
    const grade = mod.gradeRunbook(moved);
    expect(grade.passed, "F2: a relocated returned-loan fact passes").toBe(false);
    expect(grade.failed, "F2: the omission names its check").toContain("D.loan.boundary");
    for (const id of grade.failed) {
      expect(mod.declaredCheckIds(), `F2: failure ${id} is a declared check`).toContain(id);
    }
  });

  it("F2: the due-soon boundary moved out of Loan state fails D.loan.boundary", async () => {
    const mod = await grader();
    const moved = moveLineOutOfSection(readFileSync(ORACLE_RUNBOOK, "utf8"), DUE_SOON_BOUNDARY, "API routes");
    const grade = mod.gradeRunbook(moved);
    expect(grade.passed, "F2: a relocated due-soon boundary passes").toBe(false);
    expect(grade.failed, "F2: the omission names its check").toContain("D.loan.boundary");
    for (const id of grade.failed) {
      expect(mod.declaredCheckIds(), `F2: failure ${id} is a declared check`).toContain(id);
    }
  });

  it("F2: a Rollback section without data preservation fails D.sections.rollback", async () => {
    const mod = await grader();
    const oracle = readFileSync(ORACLE_RUNBOOK, "utf8");
    expect(oracle, "the oracle states rollback preservation").toContain(ROLLBACK_PRESERVATION);
    const grade = mod.gradeRunbook(oracle.replace(`${ROLLBACK_PRESERVATION}\n`, ""));
    expect(grade.passed, "F2: rollback without data preservation passes").toBe(false);
    expect(grade.failed, "F2: the omission names its check").toContain("D.sections.rollback");
  });

  it("F2: a Verification section without the operations verifier fails D.sections.verification", async () => {
    const mod = await grader();
    const oracle = readFileSync(ORACLE_RUNBOOK, "utf8");
    let mutated = oracle;
    for (const line of verifierMentionLines(oracle)) {
      expect(mutated, "the oracle names the operations verifier").toContain(`${line}\n`);
      mutated = mutated.replace(`${line}\n`, "");
    }
    const grade = mod.gradeRunbook(mutated);
    expect(grade.passed, "F2: verification without the verifier passes").toBe(false);
    expect(grade.failed, "F2: the omission names its check").toContain("D.sections.verification");
  });

  it("F2: the catalogue row removed fails D.routes.items", async () => {
    const mod = await grader();
    const oracle = readFileSync(ORACLE_RUNBOOK, "utf8");
    const apiMarker = "## API routes\n";
    const at = oracle.indexOf(apiMarker);
    expect(at, "the oracle runbook has an API routes section").toBeGreaterThanOrEqual(0);
    const catalogueLine = oracle.split("\n").find((line) => line.includes("| `/items` |") || line.includes("`/items`"));
    expect(catalogueLine, "the oracle API routes table holds the catalogue row").toBeDefined();
    const grade = mod.gradeRunbook(oracle.replace(`${catalogueLine}\n`, ""));
    expect(grade.passed, "F2 r2: a missing catalogue route passes").toBe(false);
    expect(grade.failed, "F2 r2: the omission names its check").toContain("D.routes.items");
  });
});

describe("review-a r2 F2: rollback holds real restoration instructions", () => {
  it("F2 r2: removing the release restoration instruction fails D.sections.rollback", async () => {
    const mod = await grader();
    const oracle = readFileSync(ORACLE_RUNBOOK, "utf8");
    expect(oracle, "the oracle states the release restoration instruction").toContain(`${ROLLBACK_RESTORE}\n`);
    // The noun stays ("previous release") but the deploy instruction goes.
    const mutated = oracle.replace(
      `${ROLLBACK_RESTORE}\n`,
      "The previous release is ancient history.\n",
    );
    const grade = mod.gradeRunbook(mutated);
    expect(grade.passed, "F2 r2: rollback without release restoration passes").toBe(false);
    expect(grade.failed, "F2 r2: the omission names its check").toContain("D.sections.rollback");
  });

  it("F2 r2: removing the data preservation instruction fails D.sections.rollback", async () => {
    const mod = await grader();
    const oracle = readFileSync(ORACLE_RUNBOOK, "utf8");
    expect(oracle, "the oracle states the data preservation instruction").toContain(`${ROLLBACK_PRESERVATION}\n`);
    // Both nouns stay ("data store", "loan records") but the keep instruction goes.
    const mutated = oracle.replace(
      `${ROLLBACK_PRESERVATION}\n`,
      "The data store and loan records are somewhere.\n",
    );
    const grade = mod.gradeRunbook(mutated);
    expect(grade.passed, "F2 r2: rollback without data preservation passes").toBe(false);
    expect(grade.failed, "F2 r2: the omission names its check").toContain("D.sections.rollback");
  });
});

function stageF4Oracle(tag: string): { candidate: string; artifacts: string } {
  const variant = generateDocsOpsVariant("d1");
  const candidate = mkdtempSync(join(tmpdir(), `docs-ops-f4-${tag}-`));
  F2_ROOTS.push(candidate);
  writeVariant(variant, candidate);
  cpSync(join(HARNESS, "docs-and-ops", "oracle-overlay"), candidate, { recursive: true });
  const artifacts = mkdtempSync(join(tmpdir(), `docs-ops-f4-${tag}-artifacts-`));
  F2_ROOTS.push(artifacts);
  return { candidate, artifacts };
}

describe("review-a F4: absent deliverables fail their execution checks", () => {
  it("F4: a missing verifier fails O.environment.clean, O.manifest.parse, O.timeout, and determinism", async () => {
    const { candidate, artifacts } = stageF4Oracle("missing-verifier");
    const control = await gradeDocsOps(candidate, artifacts);
    expect(control.passed, `F4 control: the oracle passes (${control.reasons.join("; ")})`).toBe(true);
    rmSync(join(candidate, "ops", "verify.ts"));
    const brokenArtifacts = mkdtempSync(join(tmpdir(), "docs-ops-f4-missing-verifier-broken-"));
    F2_ROOTS.push(brokenArtifacts);
    const grade = await gradeDocsOps(candidate, brokenArtifacts);
    expect(grade.passed, "F4: a missing verifier passes overall").toBe(false);
    for (const id of [
      "O.environment.clean",
      "O.manifest.parse",
      "O.timeout",
      "O.valid.deterministic",
      "O.invalid.deterministic",
    ]) {
      expect(grade.failed, `F4: a missing verifier must fail ${id}`).toContain(id);
    }
  }, 120_000);

  it("F4: an empty runbook fails D.placeholders", async () => {
    const { candidate, artifacts } = stageF4Oracle("empty-runbook");
    const control = await gradeDocsOps(candidate, artifacts);
    expect(control.passed, `F4 control: the oracle passes (${control.reasons.join("; ")})`).toBe(true);
    writeFileSync(join(candidate, "docs", "runbook.md"), "");
    const brokenArtifacts = mkdtempSync(join(tmpdir(), "docs-ops-f4-empty-runbook-broken-"));
    F2_ROOTS.push(brokenArtifacts);
    const grade = await gradeDocsOps(candidate, brokenArtifacts);
    expect(grade.passed, "F4: an empty runbook passes overall").toBe(false);
    expect(grade.failed, "F4: an empty runbook must fail D.placeholders").toContain("D.placeholders");
  }, 120_000);
});

function stageF5Oracle(tag: string): { candidate: string; artifacts: string } {
  return stageF4Oracle(`f5-${tag}`);
}

const FIXED_ENVIRONMENT = ["BENCH_NOW", "BENCH_LATENCY_MS"];

/** The valid manifest with a short but otherwise valid environment, built
 * from the fixed array prefix so the input cannot drift from the contract. */
function shortEnvironmentManifest(): string {
  return JSON.stringify({
    schema: 1,
    service: "lending-desk",
    commands: {
      install: "npm ci",
      develop: "npm run dev",
      typecheck: "npm run typecheck",
      build: "npm run build",
      start: "npm run start",
    },
    routes: {
      home: "/",
      catalogue: "/items",
      detail: "/items/[id]",
      members: "/members",
      loans: "/api/loans",
    },
    environment: FIXED_ENVIRONMENT.slice(0, 1),
  });
}

/** The valid manifest with a non-string environment, built from the fixed
 * array so the input cannot drift from the contract. */
function nonStringEnvironmentManifest(kind: "nested" | "number" | "object" | "swapped"): string {
  const invalids: Record<string, unknown[]> = {
    nested: [["BENCH_NOW"], "BENCH_LATENCY_MS"],
    number: ["BENCH_NOW", 7],
    object: ["BENCH_NOW", { name: "BENCH_LATENCY_MS" }],
    swapped: [...FIXED_ENVIRONMENT].reverse(),
  };
  return JSON.stringify({
    schema: 1,
    service: "lending-desk",
    commands: {
      install: "npm ci",
      develop: "npm run dev",
      typecheck: "npm run typecheck",
      build: "npm run build",
      start: "npm run start",
    },
    routes: {
      home: "/",
      catalogue: "/items",
      detail: "/items/[id]",
      members: "/members",
      loans: "/api/loans",
    },
    environment: invalids[kind],
  });
}

/** A verifier that is exactly correct except for one manifest case. The
 * `.mutation` file in the candidate selects the mishandled case:
 * malformed JSON, a read error, a non-object manifest, or missing fields. */
function mutatedVerifier(): string {
  return `import { readFileSync } from "node:fs";
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
const mutation = (() => {
  try {
    return readFileSync(".mutation", "utf8").trim();
  } catch {
    return "";
  }
})();
const manifestPath = process.argv[2];
const usageLine = (() => {
  try {
    const specText = readFileSync("measure/tracks/lending_desk_docs_ops/spec.md", "utf8");
    const found = specText.split("\\n").map((entry) => entry.trim()).find((entry) => entry.indexOf("usage:") === 0);
    if (found) return found;
  } catch (ignored) {
  }
  return "usage: tsx ops/verify.ts <manifest-path>";
})();
if (!manifestPath || process.argv.length !== 3) {
  process.stderr.write(usageLine + "\\n");
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
    if (mutation === "read-error") {
      process.stdout.write(\`$\{JSON.stringify([])}\\n\`);
      process.exitCode = 0;
    } else {
      process.stdout.write(\`$\{JSON.stringify(["manifest file could not be read"])}\\n\`);
      process.exitCode = 2;
    }
  } else {
    let value;
    let malformed = false;
    try {
      value = JSON.parse(text);
    } catch {
      malformed = true;
    }
    if (malformed) {
      if (mutation === "malformed") {
        process.stdout.write(\`$\{JSON.stringify([])}\\n\`);
        process.exitCode = 0;
      } else {
        process.stdout.write(\`$\{JSON.stringify(["manifest must be valid JSON"])}\\n\`);
        process.exitCode = 2;
      }
    } else if (!isObject(value)) {
      if (mutation === "non-object") {
        process.stdout.write(\`$\{JSON.stringify([])}\\n\`);
        process.exitCode = 0;
      } else {
        process.stdout.write(\`$\{JSON.stringify(["manifest must be an object"])}\\n\`);
        process.exitCode = 1;
      }
    } else {
      const errors = validate(value);
      const requiredKeys = ["schema", "service", "commands", "routes", "environment"];
      const missingKeys = requiredKeys.filter((key) => !(key in value));
      const envMutation = mutation.indexOf("env-") === 0 ? mutation.slice(4) : null;
      if (missingKeys.length > 0 && mutation === "missing-fields") {
        process.stdout.write(\`$\{JSON.stringify([])}\\n\`);
        process.exitCode = 0;
      } else if (mutation === "env-short") {
        // F5 r3: this verifier lost its length comparison. It still
        // rejects wrong element types, but it accepts a short valid
        // prefix with a clean pass.
        if (value.environment !== null && value.environment !== undefined && Array.isArray(value.environment) &&
            value.environment.length < EXPECTED_ENVIRONMENT.length &&
            EXPECTED_ENVIRONMENT.slice(0, value.environment.length).every((entry, index) => entry === value.environment[index]) &&
            value.environment.every((entry) => typeof entry === "string")) {
          process.stdout.write(\`$\{JSON.stringify([])}\\n\`);
          process.exitCode = 0;
        } else {
          process.stdout.write(\`$\{JSON.stringify(errors)}\\n\`);
          process.exitCode = errors.length === 0 ? 0 : 1;
        }
      } else if (envMutation !== null) {
        // F5 r2: this verifier mishandles a non-string or reordered
        // environment by reporting a clean pass for that one input. Only
        // the environment array is compared; the rest of the manifest is
        // validated exactly.
        const envCases = {
          nested: [["BENCH_NOW"], "BENCH_LATENCY_MS"],
          number: ["BENCH_NOW", 7],
          object: ["BENCH_NOW", { name: "BENCH_LATENCY_MS" }],
          swapped: ["BENCH_LATENCY_MS", "BENCH_NOW"],
        };
        const specialEnv = envCases[envMutation];
        if (specialEnv !== undefined && JSON.stringify(value.environment) === JSON.stringify(specialEnv)) {
          process.stdout.write(\`$\{JSON.stringify([])}\\n\`);
          process.exitCode = 0;
        } else {
          process.stdout.write(\`$\{JSON.stringify(errors)}\\n\`);
          process.exitCode = errors.length === 0 ? 0 : 1;
        }
      } else {
        process.stdout.write(\`$\{JSON.stringify(errors)}\\n\`);
        process.exitCode = errors.length === 0 ? 0 : 1;
      }
    }
  }
}
`;
}

describe("review-a F5: the grader exercises every specified manifest case", () => {
  it("F5: a correct malformed-JSON response passes O.manifest.parse", async () => {
    const mod = await grader();
    const grade = mod.gradeVerifier({
      manifest: "{not json",
      resultJson: `["manifest must be valid JSON"]`,
      exitCode: 2,
      cleanEnv: true,
      timedOut: false,
    });
    expect(grade.failed, `F5: the correct malformed-JSON response fails (${grade.failed.join(", ")})`).toEqual([]);
    expect(grade.passed, "F5: the correct malformed-JSON response does not pass").toBe(true);
  });

  it.each([
    ["malformed JSON", "malformed"],
    ["a read error", "read-error"],
    ["a non-object manifest", "non-object"],
    ["missing fields", "missing-fields"],
  ])("F5: the grader exercises %s", async (_label, mutation) => {
    const { candidate, artifacts } = stageF5Oracle(String(mutation));
    const control = await gradeDocsOps(candidate, artifacts);
    expect(control.passed, `F5 control: the oracle passes (${control.reasons.join("; ")})`).toBe(true);
    writeFileSync(join(candidate, "ops", "verify.ts"), mutatedVerifier());
    writeFileSync(join(candidate, ".mutation"), `${mutation}\n`);
    const mutatedArtifacts = mkdtempSync(join(tmpdir(), `docs-ops-f5-${mutation}-broken-`));
    F2_ROOTS.push(mutatedArtifacts);
    const grade = await gradeDocsOps(candidate, mutatedArtifacts);
    expect(grade.passed, `F5: a verifier that mishandles ${mutation} passes`).toBe(false);
  }, 120_000);
});

const ENV_ERROR = "environment must equal the fixed environment list";

describe("review-a r3 F5: the grader exercises a wrong-length environment", () => {
  // The r3 cases live in docs-ops-env.test.ts: the pure-grader and oracle
  // checks above already passed at HEAD, and only the full-grade
  // length-removal mutation still fails (see that file for the Red case).
  it("F5 r3: the short-prefix manifest is covered by the dedicated env suite", () => {
    expect(shortEnvironmentManifest(), "F5 r3: the short fixture is defined here").toContain("BENCH_NOW");
  });
});

describe("review-a r2 F5: the verifier rejects a non-string environment", () => {
  // The number and object cases already pass at HEAD (join mismatch); they
  // stay as already-satisfied guards for the same required error contract.
  // The nested-array case is the r2 gap: array coercion accepts it.
  it.each([
    ["a nested array", "nested"],
    ["a number entry", "number"],
    ["an object entry", "object"],
  ])("F5 r2: the oracle rejects %s with the required error and a nonzero exit", async (_label, kind) => {
    const { spawnSync } = await import("node:child_process");
    const node = process.execPath;
    const manifest = mkdtempSync(join(tmpdir(), `docs-ops-f5r2-${kind}-`));
    F2_ROOTS.push(manifest);
    const manifestPath = join(manifest, "env.json");
    writeFileSync(manifestPath, nonStringEnvironmentManifest(kind as "nested" | "number" | "object"));
    const run = spawnSync(node, ["--no-warnings", join(HARNESS, "docs-and-ops", "oracle-overlay", "ops", "verify.ts"), manifestPath], {
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(run.error ?? null, "F5 r2: the oracle verifier runs").toBeNull();
    expect(JSON.parse(run.stdout), "F5 r2: the oracle prints the required error").toEqual([ENV_ERROR]);
    expect(String(run.stdout).endsWith("\n"), "F5 r2: the oracle prints one newline").toBe(true);
    expect(run.status, "F5 r2: the oracle exits nonzero").toBe(1);
  }, 120_000);

  // Already satisfied at HEAD: gradeVerifier already enforces the strict
  // environment list, so these pin the contract as guards. The r2 gap is
  // the oracle verifier and the real-grader exercise, pinned below.
  it("F5 r2: the grader fails O.result.errors and O.exit-code for an invalid element type", async () => {
    const mod = await grader();
    const grade = mod.gradeVerifier({
      manifest: nonStringEnvironmentManifest("number"),
      resultJson: "[]",
      exitCode: 0,
      cleanEnv: true,
      timedOut: false,
    });
    expect(grade.passed, "F5 r2: a clean pass for a bad environment passes").toBe(false);
    expect(grade.failed, "F5 r2: the invalid type fails O.result.errors").toContain("O.result.errors");
    expect(grade.failed, "F5 r2: the invalid type fails O.exit-code").toContain("O.exit-code");
  });

  it("F5 r2: the grader fails O.result.errors and O.exit-code for an invalid order", async () => {
    const mod = await grader();
    const grade = mod.gradeVerifier({
      manifest: nonStringEnvironmentManifest("swapped"),
      resultJson: "[]",
      exitCode: 0,
      cleanEnv: true,
      timedOut: false,
    });
    expect(grade.passed, "F5 r2: a clean pass for a reordered environment passes").toBe(false);
    expect(grade.failed, "F5 r2: the invalid order fails O.result.errors").toContain("O.result.errors");
    expect(grade.failed, "F5 r2: the invalid order fails O.exit-code").toContain("O.exit-code");
  });

  it.each([
    ["a nested array", "nested"],
    ["a number entry", "number"],
    ["an object entry", "object"],
    ["a swapped order", "swapped"],
  ])("F5 r2: the real grader rejects %s through the full grade", async (_label, kind) => {
    const { candidate, artifacts } = stageF5Oracle(`env-${kind}`);
    const control = await gradeDocsOps(candidate, artifacts);
    expect(control.passed, `F5 r2 control: the oracle passes (${control.reasons.join("; ")})`).toBe(true);
    writeFileSync(join(candidate, "ops", "verify.ts"), mutatedVerifier());
    writeFileSync(join(candidate, ".mutation"), `env-${kind}\n`);
    const mutatedArtifacts = mkdtempSync(join(tmpdir(), `docs-ops-f5r2-${kind}-broken-`));
    F2_ROOTS.push(mutatedArtifacts);
    const grade = await gradeDocsOps(candidate, mutatedArtifacts);
    expect(grade.passed, `F5 r2: a verifier that accepts ${kind} passes`).toBe(false);
    expect(grade.failed, `F5 r2: accepting ${kind} fails O.result.errors`).toContain("O.result.errors");
  }, 120_000);
});
