/** Deterministic grader for the docs-and-ops candidate deliverables. */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DOCS_OPS_CRITERIA } from "../tests/criteria.js";
import { gateDocsOpsSecondary } from "../score-calculation.js";

export const PRIMARY_AXES = ["documentation", "operations"] as const;
export const SECONDARY_AXES = ["adherence", "quality"] as const;
export const gateSecondary = gateDocsOpsSecondary;

export type Grade = { passed: boolean; failed: string[]; reasons: string[] };

const RESULT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const PLACEHOLDER_RE = /\b(?:TODO|TBD|FIXME|XXX|HACK|PLACEHOLDER)\b|\[insert[^\]]*\]|<fill[^>]*>/i;
const USAGE = "usage: tsx ops/verify.ts <manifest-path>";

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

export const VALID_MANIFEST = {
  schema: 1,
  service: "lending-desk",
  commands: EXPECTED_COMMANDS,
  routes: EXPECTED_ROUTES,
  environment: EXPECTED_ENVIRONMENT,
};

export const INVALID_MANIFEST = {
  schema: 2,
  service: "lending-desk",
  commands: { ...EXPECTED_COMMANDS, typecheck: "tsc" },
  routes: { ...EXPECTED_ROUTES, detail: "/items/:id" },
  environment: ["BENCH_LATENCY_MS"],
};

export function declaredCheckIds(): string[] {
  return Object.keys(DOCS_OPS_CRITERIA).sort();
}

export function resultIdsValid(ids: string[]): boolean {
  return ids.every((id) => RESULT_ID_RE.test(id)) && new Set(ids).size === ids.length;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function result(passed: boolean, failed: string[], reasons: string[]): Grade {
  return {
    passed: passed && failed.length === 0,
    failed: [...new Set(failed)].sort(),
    reasons: [...new Set(reasons)].sort(),
  };
}

/** Grade the runbook against the repository facts stated by the candidate spec. */
export function gradeRunbook(text: string): Grade {
  const lower = text.toLowerCase();
  const hasHeading = (name: string) =>
    new RegExp(`^#{1,6}\\s+.*\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "im").test(text);
  const hasAll = (values: readonly string[]) => values.every((value) => lower.includes(value.toLowerCase()));
  const checks: Array<{ id: string; passed: boolean; reason: string }> = [
    { id: "D.sections.setup", passed: hasHeading("setup"), reason: "runbook lacks a Setup section" },
    { id: "D.sections.scripts", passed: hasHeading("scripts"), reason: "runbook lacks a Scripts section" },
    { id: "D.sections.environment", passed: hasHeading("environment"), reason: "runbook lacks an Environment section" },
    { id: "D.sections.api-routes", passed: hasHeading("API routes"), reason: "runbook lacks an API routes section" },
    { id: "D.sections.loan-state", passed: hasHeading("loan state"), reason: "runbook lacks a Loan state section" },
    { id: "D.sections.verification", passed: hasHeading("verification"), reason: "runbook lacks a Verification section" },
    { id: "D.sections.rollback", passed: hasHeading("rollback"), reason: "runbook lacks a Rollback section" },
    { id: "D.commands.install", passed: lower.includes("npm ci"), reason: "runbook omits npm ci" },
    { id: "D.commands.dev", passed: lower.includes("npm run dev"), reason: "runbook omits npm run dev" },
    { id: "D.commands.typecheck", passed: lower.includes("npm run typecheck"), reason: "runbook omits npm run typecheck" },
    { id: "D.commands.build", passed: lower.includes("npm run build"), reason: "runbook omits npm run build" },
    { id: "D.commands.start", passed: lower.includes("npm run start"), reason: "runbook omits npm run start" },
    { id: "D.routes.home", passed: /(?:^|[\s`|])\/(?:[\s`|]|$)/m.test(text), reason: "runbook omits the home route" },
    { id: "D.routes.items", passed: text.includes("/items"), reason: "runbook omits the catalogue route" },
    { id: "D.routes.detail", passed: text.includes("/items/[id]"), reason: "runbook omits the item detail route" },
    { id: "D.routes.members", passed: text.includes("/members"), reason: "runbook omits the members route" },
    { id: "D.routes.loans", passed: text.includes("/api/loans"), reason: "runbook omits the loans API route" },
    {
      id: "D.environment.variables",
      passed: hasAll(["BENCH_NOW", "BENCH_LATENCY_MS", "BENCH_FAIL_ITEMS", "BENCH_TRACE_FILE"]),
      reason: "runbook omits a repository environment variable",
    },
    { id: "D.api.methods", passed: hasAll(["GET", "POST", "PATCH"]), reason: "runbook omits a loans API method" },
    {
      id: "D.api.auth",
      passed: hasAll(["x-staff-key", "staff_key"]),
      reason: "runbook omits the staff header or cookie",
    },
    {
      id: "D.loan.statuses",
      passed: hasAll(["returned", "overdue", "due-soon", "ok"]),
      reason: "runbook omits a loan status",
    },
    {
      id: "D.loan.boundary",
      passed: lower.includes("48") && lower.includes("strictly before") && lower.includes("returned"),
      reason: "runbook omits the loan status boundaries",
    },
    { id: "D.placeholders", passed: !PLACEHOLDER_RE.test(text), reason: "runbook contains a placeholder" },
  ];
  const failed = checks.filter((check) => !check.passed);
  return result(
    failed.length === 0,
    failed.map((check) => check.id),
    failed.map((check) => check.reason),
  );
}

function expectedManifestErrors(text: string): { parsed: boolean; errors: string[] } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { parsed: false, errors: ["manifest must be valid JSON"] };
  }
  if (!isObject(value)) return { parsed: true, errors: ["manifest must be an object"] };
  const errors: string[] = [];
  if (value.schema !== 1) errors.push("schema must be 1");
  if (value.service !== "lending-desk") errors.push("service must be lending-desk");
  if (isObject(value.commands)) {
    for (const [key, expected] of Object.entries(EXPECTED_COMMANDS)) {
      if (value.commands[key] !== expected) errors.push(`commands.${key} must equal ${expected}`);
    }
  } else {
    for (const [key, expected] of Object.entries(EXPECTED_COMMANDS)) {
      errors.push(`commands.${key} must equal ${expected}`);
    }
  }
  if (isObject(value.routes)) {
    for (const [key, expected] of Object.entries(EXPECTED_ROUTES)) {
      if (value.routes[key] !== expected) errors.push(`routes.${key} must equal ${expected}`);
    }
  } else {
    for (const [key, expected] of Object.entries(EXPECTED_ROUTES)) {
      errors.push(`routes.${key} must equal ${expected}`);
    }
  }
  if (!Array.isArray(value.environment) || value.environment.join("\0") !== EXPECTED_ENVIRONMENT.join("\0")) {
    errors.push("environment must equal the fixed environment list");
  }
  return { parsed: true, errors: errors.sort() };
}

function parsedResult(text: string): string[] | null {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) && value.every((entry) => typeof entry === "string")
      ? value as string[]
      : null;
  } catch {
    return null;
  }
}

/** Grade one verifier invocation against the manifest it received. */
export function gradeVerifier(input: {
  manifest: string;
  resultJson: string;
  exitCode: number;
  cleanEnv: boolean;
  timedOut: boolean;
}): Grade {
  const expected = expectedManifestErrors(input.manifest);
  const errors = parsedResult(input.resultJson);
  const expectedExit = expected.parsed ? (expected.errors.length === 0 ? 0 : 1) : 2;
  const checks: Array<{ id: string; passed: boolean; reason: string }> = [
    { id: "O.manifest.parse", passed: expected.parsed, reason: "manifest is not valid JSON" },
    { id: "O.result.json", passed: errors !== null, reason: "verifier output is not a JSON string array" },
    {
      id: "O.result.errors",
      passed: errors !== null && JSON.stringify(errors) === JSON.stringify(expected.errors),
      reason: "verifier errors do not match the manifest",
    },
    { id: "O.exit-code", passed: input.exitCode === expectedExit, reason: "verifier exit code is wrong" },
    {
      id: "O.errors.sorted",
      passed: errors !== null && JSON.stringify(errors) === JSON.stringify([...errors].sort()),
      reason: "verifier errors are not sorted",
    },
    { id: "O.environment.clean", passed: input.cleanEnv, reason: "verifier received a non-clean environment" },
    { id: "O.timeout", passed: !input.timedOut, reason: "verifier timed out" },
  ];
  const failed = checks.filter((check) => !check.passed);
  return result(
    failed.length === 0,
    failed.map((check) => check.id),
    failed.map((check) => check.reason),
  );
}

type VerifierRun = {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cleanEnv: boolean;
};

function cleanEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: "/tmp",
    CI: "1",
    NO_COLOR: "1",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

function runVerifier(tsx: string, candidate: string, manifestPath?: string): Promise<VerifierRun> {
  const args = manifestPath ? ["ops/verify.ts", manifestPath] : ["ops/verify.ts"];
  return new Promise((resolveRun) => {
    const child = spawn(tsx, args, {
      cwd: candidate,
      env: cleanEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (status: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveRun({ status, stdout, stderr, timedOut, cleanEnv: true });
    };
    const stop = () => {
      if (child.pid && process.platform !== "win32") {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      } else {
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, 15_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length + stderr.length > 1_048_576) stop();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stdout.length + stderr.length > 1_048_576) stop();
    });
    child.on("error", () => finish(null));
    child.on("close", (status) => finish(status));
  });
}

function sameRun(left: VerifierRun, right: VerifierRun): boolean {
  return left.status === right.status && left.stdout === right.stdout &&
    left.stderr === right.stderr && !left.timedOut && !right.timedOut;
}

export type DocsOpsGrade = {
  schema: 1;
  passed: boolean;
  failed: string[];
  reasons: string[];
  checks: Record<string, boolean>;
  runbook: Grade;
  verifier: {
    valid: Grade;
    invalid: Grade;
    deterministic: boolean;
    usage: boolean;
  };
};

/** Grade both deliverables and write the exact result map used by score.ts. */
export async function gradeDocsOps(candidate: string, artifacts: string): Promise<DocsOpsGrade> {
  mkdirSync(artifacts, { recursive: true });
  const runbookPath = join(candidate, "docs", "runbook.md");
  const runbook = gradeRunbook(existsSync(runbookPath) ? readFileSync(runbookPath, "utf8") : "");
  const validPath = join(artifacts, "docs-ops-valid.json");
  const invalidPath = join(artifacts, "docs-ops-invalid.json");
  const validText = `${JSON.stringify(VALID_MANIFEST, null, 2)}\n`;
  const invalidText = `${JSON.stringify(INVALID_MANIFEST, null, 2)}\n`;
  writeFileSync(validPath, validText);
  writeFileSync(invalidPath, invalidText);

  const localTsx = join(candidate, "node_modules", ".bin", "tsx");
  const tsx = existsSync(localTsx) ? localTsx : resolve(import.meta.dirname, "..", "node_modules", ".bin", "tsx");
  const [validRun, validRepeat, invalidRun, invalidRepeat, usageRun] = await Promise.all([
    runVerifier(tsx, candidate, validPath),
    runVerifier(tsx, candidate, validPath),
    runVerifier(tsx, candidate, invalidPath),
    runVerifier(tsx, candidate, invalidPath),
    runVerifier(tsx, candidate),
  ]);
  const valid = gradeVerifier({
    manifest: validText,
    resultJson: validRun.stdout,
    exitCode: validRun.status ?? -1,
    cleanEnv: validRun.cleanEnv,
    timedOut: validRun.timedOut,
  });
  const invalid = gradeVerifier({
    manifest: invalidText,
    resultJson: invalidRun.stdout,
    exitCode: invalidRun.status ?? -1,
    cleanEnv: invalidRun.cleanEnv,
    timedOut: invalidRun.timedOut,
  });
  const common = [
    "O.manifest.parse",
    "O.result.json",
    "O.result.errors",
    "O.exit-code",
    "O.errors.sorted",
    "O.environment.clean",
    "O.timeout",
  ];
  const checks: Record<string, boolean> = {};
  for (const id of declaredCheckIds()) checks[id] = false;
  for (const check of runbook.failed.length === 0
    ? Object.keys(DOCS_OPS_CRITERIA).filter((id) => id.startsWith("D."))
    : Object.keys(DOCS_OPS_CRITERIA).filter((id) => id.startsWith("D.") && !runbook.failed.includes(id))) {
    checks[check] = true;
  }
  for (const id of common) checks[id] = !valid.failed.includes(id) && !invalid.failed.includes(id);
  checks["O.valid.behavior"] = valid.passed;
  checks["O.invalid.behavior"] = invalid.passed;
  checks["O.valid.deterministic"] = sameRun(validRun, validRepeat);
  checks["O.invalid.deterministic"] = sameRun(invalidRun, invalidRepeat);
  checks["O.environment.clean"] = [validRun, validRepeat, invalidRun, invalidRepeat, usageRun]
    .every((run) => run.cleanEnv);
  checks["O.timeout"] = [validRun, validRepeat, invalidRun, invalidRepeat, usageRun]
    .every((run) => !run.timedOut);
  checks["O.usage"] = usageRun.status === 2 && usageRun.stdout === "" && usageRun.stderr.trim() === USAGE;
  const failed = declaredCheckIds().filter((id) => !checks[id]);
  const reasons = [...runbook.reasons, ...valid.reasons, ...invalid.reasons];
  if (!checks["O.valid.deterministic"]) reasons.push("valid verifier output is not deterministic");
  if (!checks["O.invalid.deterministic"]) reasons.push("invalid verifier output is not deterministic");
  if (!checks["O.usage"]) reasons.push("verifier usage contract is wrong");
  reasons.sort();
  const report: DocsOpsGrade = {
    schema: 1,
    passed: failed.length === 0,
    failed,
    reasons,
    checks,
    runbook,
    verifier: {
      valid,
      invalid,
      deterministic: checks["O.valid.deterministic"] && checks["O.invalid.deterministic"],
      usage: checks["O.usage"],
    },
  };
  writeFileSync(join(artifacts, "results.json"), `${JSON.stringify(checks, null, 2)}\n`);
  writeFileSync(join(artifacts, "docs-ops-grade.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const candidate = process.env.CANDIDATE ?? "";
  const artifacts = process.env.ARTIFACTS ?? "";
  if (!candidate || !artifacts) throw new Error("CANDIDATE and ARTIFACTS are required");
  await gradeDocsOps(candidate, artifacts);
}
