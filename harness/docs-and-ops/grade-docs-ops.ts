/** Deterministic, isolated grader for the docs-and-ops candidate deliverables. */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
const WORKER_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 1_048_576;

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

const MALFORMED_MANIFEST = "{not json";
const NON_OBJECT_MANIFEST = "[]";
const MISSING_FIELDS_MANIFEST = "{}";
const ENV_NESTED_MANIFEST = JSON.stringify({ ...VALID_MANIFEST, environment: [["BENCH_NOW"], "BENCH_LATENCY_MS"] });
const ENV_NUMBER_MANIFEST = JSON.stringify({ ...VALID_MANIFEST, environment: ["BENCH_NOW", 7] });
const ENV_OBJECT_MANIFEST = JSON.stringify({ ...VALID_MANIFEST, environment: ["BENCH_NOW", { name: "BENCH_LATENCY_MS" }] });
const ENV_SWAPPED_MANIFEST = JSON.stringify({ ...VALID_MANIFEST, environment: [...EXPECTED_ENVIRONMENT].reverse() });
const ENV_SHORT_MANIFEST = JSON.stringify({ ...VALID_MANIFEST, environment: ["BENCH_NOW"] });

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

function sectionBody(text: string, name: string): { found: boolean; body: string } {
  const lines = text.split(/\r?\n/);
  const heading = new RegExp(`^##\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return { found: false, body: "" };
  let end = start + 1;
  while (end < lines.length && !/^##\s+/.test(lines[end])) end += 1;
  return { found: true, body: lines.slice(start + 1, end).join("\n").trim() };
}

/** Normalise prose so Markdown emphasis, code ticks, and table cells do not
 * hide a required fact. */
function factText(body: string): string {
  return body.replace(/[*_~`>#|]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function restoresRelease(body: string): boolean {
  const text = factText(body);
  const action = /\b(?:restore|restores|restored|redeploy|redeployed|deploy|deployed|roll\s*back|rolled\s*back|re-?activate|revert|return|restart)\b/.test(text);
  const target = /\b(?:previous|prior|last good|known-good)\b/.test(text);
  const object = /\b(?:release|deployment|artifact|tag|version)\b/.test(text);
  return action && target && object;
}

function preservesLoanRecords(body: string): boolean {
  const text = factText(body);
  const subject = /\b(?:loan|loans|record|records|row|rows|history|data|store|state)\b/.test(text);
  const action = /\b(?:keep|keeps|kept|preserve|preserves|preserved|retain|retained|not delete|does not delete|do not delete|must not delete|never delete|never remove|no data migration|nothing deleted|intact|untouched)\b/.test(text);
  return subject && action;
}

function statesLoanBoundaries(body: string): boolean {
  const text = factText(body);
  const returned = text.includes("returned loan stays returned");
  const overdue = /strictly\s+before\s+now/.test(text);
  const dueSoon = text.includes("due-soon") && text.includes("48") && text.includes("now") &&
    /(?:through|within|at or after|from|until)/.test(text);
  return returned && overdue && dueSoon;
}

/** Grade the runbook against repository facts inside their required sections. */
export function gradeRunbook(text: string): Grade {
  const section = (name: string) => sectionBody(text, name);
  const setup = section("Setup");
  const scripts = section("Scripts");
  const environment = section("Environment");
  const api = section("API routes");
  const loanState = section("Loan state");
  const verification = section("Verification");
  const rollback = section("Rollback");
  const lower = (value: string) => value.toLowerCase();
  const hasAll = (body: string, values: readonly string[]) =>
    values.every((value) => lower(body).includes(value.toLowerCase()));
  const nonempty = (value: { found: boolean; body: string }) => value.found && value.body.length > 0;
  const checks: Array<{ id: string; passed: boolean; reason: string }> = [
    { id: "D.sections.setup", passed: nonempty(setup), reason: "runbook lacks a Setup body" },
    { id: "D.sections.scripts", passed: nonempty(scripts), reason: "runbook lacks a Scripts body" },
    { id: "D.sections.environment", passed: nonempty(environment), reason: "runbook lacks an Environment body" },
    { id: "D.sections.api-routes", passed: nonempty(api), reason: "runbook lacks an API routes body" },
    { id: "D.sections.loan-state", passed: nonempty(loanState), reason: "runbook lacks a Loan state body" },
    {
      id: "D.sections.verification",
      passed: nonempty(verification) && hasAll(verification.body, ["npm run typecheck", "npm run build", "ops/verify.ts"]),
      reason: "Verification lacks typecheck, build, or the operations verifier",
    },
    {
      id: "D.sections.rollback",
      passed: nonempty(rollback) && restoresRelease(rollback.body) && preservesLoanRecords(rollback.body),
      reason: "Rollback lacks release restoration or data preservation",
    },
    { id: "D.commands.install", passed: hasAll(setup.body, ["npm ci"]), reason: "Setup omits npm ci" },
    { id: "D.commands.dev", passed: hasAll(scripts.body, ["npm run dev"]), reason: "Scripts omits npm run dev" },
    { id: "D.commands.typecheck", passed: hasAll(scripts.body, ["npm run typecheck"]), reason: "Scripts omits npm run typecheck" },
    { id: "D.commands.build", passed: hasAll(scripts.body, ["npm run build"]), reason: "Scripts omits npm run build" },
    { id: "D.commands.start", passed: hasAll(scripts.body, ["npm run start"]), reason: "Scripts omits npm run start" },
    { id: "D.routes.home", passed: /(?:^|[\s`|])\/(?:[\s`|]|$)/m.test(api.body), reason: "API routes omits the home route" },
    { id: "D.routes.items", passed: /(?:^|[|\s`])\/items(?:`|\s|\||$)/m.test(api.body), reason: "API routes omits the catalogue route" },
    { id: "D.routes.detail", passed: api.body.includes("/items/[id]"), reason: "API routes omits the item detail route" },
    { id: "D.routes.members", passed: api.body.includes("/members"), reason: "API routes omits the members route" },
    { id: "D.routes.loans", passed: api.body.includes("/api/loans"), reason: "API routes omits the loans API route" },
    {
      id: "D.environment.variables",
      passed: hasAll(environment.body, ["BENCH_NOW", "BENCH_LATENCY_MS", "BENCH_FAIL_ITEMS", "BENCH_TRACE_FILE"]),
      reason: "Environment omits a repository variable",
    },
    { id: "D.api.methods", passed: hasAll(api.body, ["GET", "POST", "PATCH"]), reason: "API routes omits a loans API method" },
    {
      id: "D.api.auth",
      passed: hasAll(`${environment.body}\n${api.body}`, ["x-staff-key", "staff_key"]),
      reason: "the runbook omits the staff header or cookie",
    },
    {
      id: "D.loan.statuses",
      passed: hasAll(loanState.body, ["returned", "overdue", "due-soon", "ok"]),
      reason: "Loan state omits a loan status",
    },
    {
      id: "D.loan.boundary",
      passed: nonempty(loanState) && statesLoanBoundaries(loanState.body),
      reason: "Loan state omits the returned or due-soon boundary",
    },
    {
      id: "D.placeholders",
      passed: text.trim().length > 0 && !PLACEHOLDER_RE.test(text),
      reason: "runbook is empty or contains a placeholder",
    },
  ];
  const failed = checks.filter((check) => !check.passed);
  return result(
    failed.length === 0,
    failed.map((check) => check.id),
    failed.map((check) => check.reason),
  );
}

type ExpectedInvocation = {
  parsed: boolean;
  parseErrors: string[];
  errors: string[];
  exitCode: number;
};

function expectedInvocation(manifest: string, readError: boolean): ExpectedInvocation {
  if (readError) {
    const errors = ["manifest file could not be read"];
    return { parsed: false, parseErrors: errors, errors, exitCode: 2 };
  }
  let value: unknown;
  try {
    value = JSON.parse(manifest);
  } catch {
    const errors = ["manifest must be valid JSON"];
    return { parsed: false, parseErrors: errors, errors, exitCode: 2 };
  }
  if (!isObject(value)) {
    const errors = ["manifest must be an object"];
    return { parsed: true, parseErrors: [], errors, exitCode: 1 };
  }
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
  if (!Array.isArray(value.environment) || value.environment.length !== EXPECTED_ENVIRONMENT.length ||
      !value.environment.every((entry, index) => entry === EXPECTED_ENVIRONMENT[index])) {
    errors.push("environment must equal the fixed environment list");
  }
  errors.sort();
  return { parsed: true, parseErrors: [], errors, exitCode: errors.length === 0 ? 0 : 1 };
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
  readError?: boolean;
  requireNewline?: boolean;
}): Grade {
  const expected = expectedInvocation(input.manifest, input.readError === true);
  const errors = parsedResult(input.resultJson);
  const formatted = input.resultJson === `${JSON.stringify(expected.errors)}\n` ||
    (input.requireNewline !== true && input.resultJson === JSON.stringify(expected.errors));
  const parseHandled = expected.parsed || (errors !== null && JSON.stringify(errors) === JSON.stringify(expected.parseErrors));
  const checks: Array<{ id: string; passed: boolean; reason: string }> = [
    { id: "O.manifest.parse", passed: parseHandled, reason: "verifier did not handle manifest parsing" },
    { id: "O.result.json", passed: errors !== null, reason: "verifier output is not a JSON string array" },
    { id: "O.result.errors", passed: errors !== null && formatted, reason: "verifier output does not match the required JSON" },
    { id: "O.exit-code", passed: input.exitCode === expected.exitCode, reason: "verifier exit code is wrong" },
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
  completed: boolean;
  started: boolean;
  infrastructureFailure: string | null;
  isolationError: string | null;
};

type Isolation = { bwrap: string; node: string; manifests: string };

function cleanEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: "/tmp",
    CI: "1",
    NO_COLOR: "1",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

function usageLine(): string {
  const spec = readFileSync(resolve(import.meta.dirname, "model-visible", "track", "spec.md"), "utf8");
  return spec.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith("usage:")) ??
    "usage: node --no-warnings ops/verify.ts <manifest-path>";
}

function resolveIsolation(): { bwrap: string; node: string } {
  const probe = spawnSync("bwrap", [
    "--unshare-all", "--ro-bind", "/", "/", "--", "/bin/true",
  ], { env: cleanEnvironment(), stdio: "ignore", timeout: 5_000 });
  if (probe.error || probe.status !== 0) {
    throw new Error(`verifier isolation is unavailable: ${probe.error?.message ?? `bwrap exited ${probe.status}`}`);
  }
  return { bwrap: "bwrap", node: process.execPath };
}

function stageManifests(): { dir: string; texts: Record<string, string> } {
  const dir = mkdtempSync(join(tmpdir(), "docs-ops-manifests-"));
  const texts: Record<string, string> = {
    "valid.json": `${JSON.stringify(VALID_MANIFEST, null, 2)}\n`,
    "invalid.json": `${JSON.stringify(INVALID_MANIFEST, null, 2)}\n`,
    "malformed.json": MALFORMED_MANIFEST,
    "non-object.json": NON_OBJECT_MANIFEST,
    "missing-fields.json": MISSING_FIELDS_MANIFEST,
    "env-nested.json": ENV_NESTED_MANIFEST,
    "env-number.json": ENV_NUMBER_MANIFEST,
    "env-object.json": ENV_OBJECT_MANIFEST,
    "env-swapped.json": ENV_SWAPPED_MANIFEST,
    "env-short.json": ENV_SHORT_MANIFEST,
    "verify-worker.sh": "#!/bin/sh\ncontrol=\"\"\nif [ -r /workspace/.mutation ]; then read -r control < /workspace/.mutation || true; fi\nif [ \"$control\" = \"startup-fail\" ] || [ ! -x /runtime/node ]; then printf 'setup-failed\\n' >&3; exit 3; fi\nprintf 'started\\n' >&3\nexec /runtime/node --no-warnings ops/verify.ts \"$@\" 3>&-\n",
  };
  for (const [name, text] of Object.entries(texts)) {
    writeFileSync(join(dir, name), text, { mode: name === "verify-worker.sh" ? 0o755 : 0o644 });
  }
  return { dir, texts };
}

function runVerifier(isolation: Isolation, candidate: string, manifestName?: string): Promise<VerifierRun> {
  const args = [
    "--unshare-all", "--die-with-parent", "--new-session",
    "--ro-bind", candidate, "/workspace",
    "--ro-bind", isolation.manifests, "/manifests",
    "--ro-bind", "/usr", "/usr",
    "--ro-bind", "/bin", "/bin",
    "--ro-bind", "/lib", "/lib",
    "--ro-bind", "/lib64", "/lib64",
    "--ro-bind", isolation.node, "/runtime/node",
    "--tmpfs", "/tmp",
    "--proc", "/proc",
    "--dev", "/dev",
    "--setenv", "PATH", "/runtime:/usr/bin:/bin",
    "--setenv", "HOME", "/tmp",
    "--chdir", "/workspace",
    "--ro-bind", join(isolation.manifests, "verify-worker.sh"), "/verify-worker",
    "/verify-worker",
    ...(manifestName ? [`/manifests/${manifestName}`] : []),
  ];
  return new Promise((resolveRun) => {
    const child = spawn(isolation.bwrap, args, {
      env: cleanEnvironment(),
      stdio: ["ignore", "pipe", "pipe", "pipe"],
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    let startup = "";
    let timedOut = false;
    let isolationError: string | null = null;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (status: number | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      const started = startup === "started\n";
      const setupFailure = isolationError ??
        (startup === "setup-failed\n" ? "worker setup failed" : null) ??
        (status !== null && startup === "" && !timedOut ? "worker did not report a trusted startup" : null);
      resolveRun({
        status, stdout, stderr, timedOut,
        cleanEnv: isolationError === null,
        completed: status !== null && started && !timedOut && isolationError === null,
        started,
        infrastructureFailure: setupFailure,
        isolationError,
      });
    };
    const stop = () => {
      if (child.pid && process.platform !== "win32") {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      } else {
        child.kill("SIGKILL");
      }
    };
    timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, WORKER_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length + stderr.length > MAX_OUTPUT_BYTES) {
        timedOut = true;
        stop();
      }
    });
    child.stdio[3]?.on("data", (chunk: Buffer) => {
      startup += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stdout.length + stderr.length > MAX_OUTPUT_BYTES) {
        timedOut = true;
        stop();
      }
    });
    child.on("error", (error) => {
      isolationError = error.message;
      finish(null);
    });
    child.on("close", (status) => finish(status));
  });
}

function sameRun(left: VerifierRun, right: VerifierRun): boolean {
  return left.completed && right.completed && left.status === right.status &&
    left.stdout === right.stdout && left.stderr === right.stderr;
}

function invocationGrade(run: VerifierRun, manifest: string, readError = false): Grade {
  return gradeVerifier({
    manifest,
    resultJson: run.stdout,
    exitCode: run.status ?? -1,
    cleanEnv: run.cleanEnv,
    timedOut: run.timedOut,
    readError,
    requireNewline: true,
  });
}

const OPERATION_IDS = declaredCheckIds().filter((id) => id.startsWith("O."));

function missingVerifierGrade(): Grade {
  return { passed: false, failed: OPERATION_IDS, reasons: ["verifier is missing"] };
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
    cases: Record<string, Grade>;
    deterministic: boolean;
    usage: boolean;
  };
};

/** Grade both deliverables and write the exact result map used by score.ts. */
export async function gradeDocsOps(candidate: string, artifacts: string): Promise<DocsOpsGrade> {
  mkdirSync(artifacts, { recursive: true });
  const runbookPath = join(candidate, "docs", "runbook.md");
  const runbook = gradeRunbook(existsSync(runbookPath) ? readFileSync(runbookPath, "utf8") : "");
  const checks: Record<string, boolean> = {};
  for (const id of declaredCheckIds()) checks[id] = false;
  for (const id of Object.keys(DOCS_OPS_CRITERIA).filter((entry) => entry.startsWith("D."))) {
    checks[id] = !runbook.failed.includes(id);
  }

  const verifierPath = join(candidate, "ops", "verify.ts");
  const verifierPresent = existsSync(verifierPath);
  const reasons = [...runbook.reasons];
  let valid: Grade = missingVerifierGrade();
  let invalid: Grade = missingVerifierGrade();
  const cases: Record<string, Grade> = {};
  let deterministic = false;
  let usage = false;

  if (verifierPresent) {
    const isolation = resolveIsolation();
    const staged = stageManifests();
    try {
      writeFileSync(join(artifacts, "docs-ops-valid.json"), staged.texts["valid.json"]);
      writeFileSync(join(artifacts, "docs-ops-invalid.json"), staged.texts["invalid.json"]);
      writeFileSync(join(artifacts, "docs-ops-malformed.json"), staged.texts["malformed.json"]);
      writeFileSync(join(artifacts, "docs-ops-non-object.json"), staged.texts["non-object.json"]);
      writeFileSync(join(artifacts, "docs-ops-missing-fields.json"), staged.texts["missing-fields.json"]);
      writeFileSync(join(artifacts, "docs-ops-env-nested.json"), staged.texts["env-nested.json"]);
      writeFileSync(join(artifacts, "docs-ops-env-number.json"), staged.texts["env-number.json"]);
      writeFileSync(join(artifacts, "docs-ops-env-object.json"), staged.texts["env-object.json"]);
      writeFileSync(join(artifacts, "docs-ops-env-swapped.json"), staged.texts["env-swapped.json"]);
      writeFileSync(join(artifacts, "docs-ops-env-short.json"), staged.texts["env-short.json"]);
      const worker: Isolation = { ...isolation, manifests: staged.dir };
      const [validRun, validRepeat, invalidRun, invalidRepeat, malformedRun, readRun, nonObjectRun, missingRun,
        envNestedRun, envNumberRun, envObjectRun, envSwappedRun, envShortRun, usageRun] =
        await Promise.all([
          runVerifier(worker, candidate, "valid.json"),
          runVerifier(worker, candidate, "valid.json"),
          runVerifier(worker, candidate, "invalid.json"),
          runVerifier(worker, candidate, "invalid.json"),
          runVerifier(worker, candidate, "malformed.json"),
          runVerifier(worker, candidate, "not-found.json"),
          runVerifier(worker, candidate, "non-object.json"),
          runVerifier(worker, candidate, "missing-fields.json"),
          runVerifier(worker, candidate, "env-nested.json"),
          runVerifier(worker, candidate, "env-number.json"),
          runVerifier(worker, candidate, "env-object.json"),
          runVerifier(worker, candidate, "env-swapped.json"),
          runVerifier(worker, candidate, "env-short.json"),
          runVerifier(worker, candidate),
        ]);
      valid = invocationGrade(validRun, staged.texts["valid.json"]);
      invalid = invocationGrade(invalidRun, staged.texts["invalid.json"]);
      cases.malformed = invocationGrade(malformedRun, staged.texts["malformed.json"]);
      cases.readError = invocationGrade(readRun, "", true);
      cases.nonObject = invocationGrade(nonObjectRun, staged.texts["non-object.json"]);
      cases.missingFields = invocationGrade(missingRun, staged.texts["missing-fields.json"]);
      cases.envNested = invocationGrade(envNestedRun, staged.texts["env-nested.json"]);
      cases.envNumber = invocationGrade(envNumberRun, staged.texts["env-number.json"]);
      cases.envObject = invocationGrade(envObjectRun, staged.texts["env-object.json"]);
      cases.envSwapped = invocationGrade(envSwappedRun, staged.texts["env-swapped.json"]);
      cases.envShort = invocationGrade(envShortRun, staged.texts["env-short.json"]);
      const manifestRuns = [validRun, invalidRun, malformedRun, readRun, nonObjectRun, missingRun,
        envNestedRun, envNumberRun, envObjectRun, envSwappedRun, envShortRun];
      const manifestGrades = [valid, invalid, ...Object.values(cases)];
      const common = [
        "O.manifest.parse",
        "O.result.json",
        "O.result.errors",
        "O.exit-code",
        "O.errors.sorted",
      ];
      for (const id of common) {
        checks[id] = manifestRuns.every((run) => run.completed) &&
          manifestGrades.every((grade) => !grade.failed.includes(id));
      }
      checks["O.valid.behavior"] = validRun.completed && valid.passed;
      checks["O.invalid.behavior"] = invalidRun.completed && invalid.passed;
      deterministic = sameRun(validRun, validRepeat) && sameRun(invalidRun, invalidRepeat);
      checks["O.valid.deterministic"] = sameRun(validRun, validRepeat);
      checks["O.invalid.deterministic"] = sameRun(invalidRun, invalidRepeat);
      const allRuns = [validRun, validRepeat, invalidRun, invalidRepeat, malformedRun, readRun,
        nonObjectRun, missingRun, envNestedRun, envNumberRun, envObjectRun, envSwappedRun, envShortRun, usageRun];
      const setupFailures = allRuns
        .map((run) => run.infrastructureFailure)
        .filter((reason): reason is string => reason !== null);
      if (setupFailures.length > 0) {
        throw new Error(`verifier worker setup failed: ${setupFailures[0]}`);
      }
      checks["O.environment.clean"] = allRuns.every((run) => run.completed && run.cleanEnv);
      checks["O.timeout"] = allRuns.every((run) => run.completed && !run.timedOut);
      usage = usageRun.completed && usageRun.status === 2 && usageRun.stdout === "" &&
        usageRun.stderr === `${usageLine()}\n`;
      checks["O.usage"] = usage;
      if (!deterministic) reasons.push("verifier output is not deterministic");
      if (!usage) reasons.push("verifier usage contract is wrong");
      for (const grade of [valid, invalid, ...Object.values(cases)]) reasons.push(...grade.reasons);
      for (const run of allRuns) {
        if (run.isolationError) reasons.push(`verifier isolation failed: ${run.isolationError}`);
      }
    } finally {
      rmSync(staged.dir, { recursive: true, force: true });
    }
  } else {
    reasons.push(...missingVerifierGrade().reasons);
  }

  const failed = declaredCheckIds().filter((id) => !checks[id]);
  const report: DocsOpsGrade = {
    schema: 1,
    passed: failed.length === 0,
    failed,
    reasons: [...new Set(reasons)].sort(),
    checks,
    runbook,
    verifier: { valid, invalid, cases, deterministic, usage },
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
