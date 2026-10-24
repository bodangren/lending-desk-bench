/**
 * Evidence for the exact executor that produced a candidate. The fingerprint
 * intentionally covers the resolved, inspectable inputs rather than a runner
 * configuration template.
 *
 * Schema 2 (kind "opencode") records the OpenCode executor: the resolved
 * binary, the pinned image, the generated config, the entry script, the
 * shipped helpers, the per-run skill snapshot, the runtime and CLI flags,
 * and the access-only credential descriptor. Schema 1 (Pi) records stay
 * readable through validateExecutionIdentity so legacy provenance never
 * crashes a freshness check.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ARM_B_SKILLS = [
  "measure",
  "next-best-practices",
  "vercel-react-best-practices",
  "vercel-composition-patterns",
  "build-graph",
] as const;

type Arm = "a" | "b";
type JsonRecord = Record<string, unknown>;
type BinaryEvidence = { path: string; sha256: string; version: string };
type AgentIdentity = {
  schema: 2;
  kind: "opencode";
  run_id: string;
  arm: Arm;
  opencode: BinaryEvidence;
  image_reference: string;
  image_identity: string;
  model_ref: string;
  variant: string | null;
  config_sha256: string;
  entry_sha256: string;
  helpers: { rg: BinaryEvidence };
  skills: Record<string, string>;
  skill_tree_sha256: string;
  runtime_flags: string[];
  runtime_flags_sha256: string;
  cli_flags: string[];
  cli_flags_sha256: string;
  credential: { integration: "opencode"; method: "oauth"; refresh_token_delivered: false };
};
type NotInvokedIdentity = {
  schema: 2;
  kind: "not-invoked";
  run_id: string;
  arm: Arm;
  reason: "AGENT_SKIP=1";
};
export type ExecutionIdentity = AgentIdentity | NotInvokedIdentity;
export type ResolveExecutionIdentityInput = {
  runId: string;
  arm: Arm;
  mode?: "agent" | "overlay";
  imageReference?: string;
  opencodePath?: string;
  modelRef?: string;
  configPath?: string;
  entryPath?: string;
  rgPath?: string;
  skillRoots?: Partial<Record<(typeof ARM_B_SKILLS)[number], string>>;
  runtimeFlags?: string[];
  cliFlags?: string[];
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.length > 0);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map((item) => stableJson(item)).join(",") + "]";
  if (isRecord(value)) {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableJson(value[key])).join(",") + "}";
  }
  return JSON.stringify(null);
}

export function hashTree(root: string): string {
  const files: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const full = join(dir, entry.name);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error("skill tree contains a symlink: " + full);
      if (stat.isDirectory()) visit(full);
      else if (stat.isFile()) files.push(full);
      else throw new Error("skill tree contains an unsupported entry: " + full);
    }
  };
  visit(root);
  return sha256(files.sort().map((file) => `${sha256(readFileSync(file))}  ${relative(root, file)}\n`).join(""));
}

function requireDigestImage(reference: string): string {
  const match = /@sha256:([a-f0-9]{64})$/.exec(reference);
  if (!match) throw new Error("image reference must use an immutable sha256 digest");
  return match[1];
}

function resolveBinary(path: string, name: string): BinaryEvidence {
  const result = spawnSync(path, ["--version"], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`could not resolve ${name} version: ` + (result.error?.message ?? result.stderr.trim() ?? "nonzero exit"));
  }
  const version = result.stdout.trim() || result.stderr.trim();
  if (!version) throw new Error(name + " did not report a version");
  return { path, sha256: sha256(readFileSync(path)), version };
}

export function resolveExecutionIdentity(input: ResolveExecutionIdentityInput): ExecutionIdentity {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(input.runId) || (input.runId === ".") || (input.runId === "..")) {
    throw new Error("invalid execution run ID");
  }
  if (input.arm !== "a" && input.arm !== "b") throw new Error("invalid execution arm");
  if (input.mode === "overlay") {
    return { schema: 2, kind: "not-invoked", run_id: input.runId, arm: input.arm, reason: "AGENT_SKIP=1" };
  }
  if (!input.imageReference || !input.opencodePath || !input.modelRef || !input.configPath || !input.entryPath ||
      !input.rgPath || !input.runtimeFlags || !input.cliFlags) {
    throw new Error("agent execution identity requires image, OpenCode, config, entry, helper, model, runtime flags, and CLI flags");
  }
  const skills: Record<string, string> = {};
  if (input.arm === "b") {
    for (const skill of ARM_B_SKILLS) {
      const root = input.skillRoots?.[skill];
      if (!root) throw new Error("missing Arm-B skill root: " + skill);
      skills[skill] = hashTree(root);
    }
  }
  return {
    schema: 2,
    kind: "opencode",
    run_id: input.runId,
    arm: input.arm,
    opencode: resolveBinary(input.opencodePath, "OpenCode"),
    image_reference: input.imageReference,
    image_identity: requireDigestImage(input.imageReference),
    model_ref: input.modelRef,
    variant: null,
    config_sha256: sha256(readFileSync(input.configPath)),
    entry_sha256: sha256(readFileSync(input.entryPath)),
    helpers: { rg: resolveBinary(input.rgPath, "ripgrep") },
    skills,
    skill_tree_sha256: sha256(JSON.stringify(skills)),
    runtime_flags: [...input.runtimeFlags],
    runtime_flags_sha256: sha256(JSON.stringify(input.runtimeFlags)),
    cli_flags: [...input.cliFlags],
    cli_flags_sha256: sha256(JSON.stringify(input.cliFlags)),
    credential: { integration: "opencode", method: "oauth", refresh_token_delivered: false },
  };
}

export function executionIdentityFingerprint(identity: unknown): string {
  return sha256(stableJson(identity));
}

function validateNotInvoked(identity: JsonRecord, expected: { runId: string; arm: Arm; mode?: "agent" | "overlay" }): string[] {
  const errors: string[] = [];
  if (expected.mode === "agent") errors.push("agent execution cannot use a not-invoked identity");
  if (identity.reason !== "AGENT_SKIP=1") errors.push("not-invoked identity reason is invalid");
  return errors;
}

function validateFlagEvidence(identity: JsonRecord): string[] {
  const errors: string[] = [];
  if (!stringArray(identity.runtime_flags) || identity.runtime_flags_sha256 !== sha256(JSON.stringify(identity.runtime_flags))) {
    errors.push("execution runtime flags are incomplete or mismatched");
  }
  if (!stringArray(identity.cli_flags) || identity.cli_flags_sha256 !== sha256(JSON.stringify(identity.cli_flags))) {
    errors.push("execution CLI flags are incomplete or mismatched");
  }
  return errors;
}

function validateSkills(identity: JsonRecord, arm: Arm): string[] {
  const skills = isRecord(identity.skills) ? identity.skills : undefined;
  if (!skills) return ["execution skills are missing"];
  const errors: string[] = [];
  const expectedSkills = arm === "b" ? [...ARM_B_SKILLS] : [];
  const actualSkills = Object.keys(skills).sort();
  if (actualSkills.join("\0") !== expectedSkills.sort().join("\0") || actualSkills.some((name) => !isSha256(skills[name]))) {
    errors.push("execution skills do not match the arm contract");
  }
  if (identity.skill_tree_sha256 !== sha256(JSON.stringify(skills))) {
    errors.push("execution skill-tree hash does not match skills");
  }
  return errors;
}

function validateImage(identity: JsonRecord): string[] {
  const errors: string[] = [];
  if (typeof identity.image_reference !== "string") errors.push("execution image reference is missing");
  let imageIdentity = "";
  try {
    imageIdentity = requireDigestImage(String(identity.image_reference));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  if (identity.image_identity !== imageIdentity) errors.push("execution image identity does not match image reference");
  return errors;
}

function validateBinaryEvidence(value: unknown, label: string): string[] {
  const evidence = isRecord(value) ? value : undefined;
  if (!evidence || typeof evidence.path !== "string" || !evidence.path ||
      !isSha256(evidence.sha256) || typeof evidence.version !== "string" || !evidence.version) {
    return ["execution " + label + " evidence is incomplete"];
  }
  return [];
}

function validateOpencodeIdentity(identity: JsonRecord, expected: { runId: string; arm: Arm; mode?: "agent" | "overlay" }): string[] {
  const errors: string[] = [];
  if (identity.kind !== "opencode") errors.push("execution identity kind is invalid");
  errors.push(...validateImage(identity));
  errors.push(...validateBinaryEvidence(identity.opencode, "OpenCode"));
  if (typeof identity.model_ref !== "string" || !identity.model_ref) errors.push("execution model reference is missing");
  if (identity.variant !== null && typeof identity.variant !== "string") errors.push("execution variant is invalid");
  if (!isSha256(identity.config_sha256)) errors.push("execution config hash is missing");
  if (!isSha256(identity.entry_sha256)) errors.push("execution entry hash is missing");
  const helpers = isRecord(identity.helpers) ? identity.helpers : undefined;
  if (!helpers) {
    errors.push("execution helpers are missing");
  } else {
    errors.push(...validateBinaryEvidence(helpers.rg, "ripgrep helper"));
  }
  errors.push(...validateSkills(identity, expected.arm));
  errors.push(...validateFlagEvidence(identity));
  const credential = isRecord(identity.credential) ? identity.credential : undefined;
  if (!credential || credential.integration !== "opencode" || credential.method !== "oauth" ||
      credential.refresh_token_delivered !== false) {
    errors.push("execution credential descriptor is invalid");
  }
  return errors;
}

function validatePiIdentity(identity: JsonRecord, expected: { runId: string; arm: Arm; mode?: "agent" | "overlay" }): string[] {
  const errors: string[] = [];
  errors.push(...validateImage(identity));
  errors.push(...validateBinaryEvidence(identity.pi, "Pi"));
  errors.push(...validateSkills(identity, expected.arm));
  errors.push(...validateFlagEvidence(identity));
  return errors;
}

export function validateExecutionIdentity(identity: unknown, expected: { runId: string; arm: Arm; mode?: "agent" | "overlay" }): string[] {
  const errors: string[] = [];
  if (!isRecord(identity)) return ["execution identity is not an object"];
  if (identity.schema === 2) {
    if (identity.run_id !== expected.runId) errors.push("execution identity run ID does not match");
    if (identity.arm !== expected.arm) errors.push("execution identity arm does not match");
    if (identity.kind === "not-invoked") return [...errors, ...validateNotInvoked(identity, expected)];
    if (expected.mode === "overlay") errors.push("overlay execution must use a not-invoked identity");
    return [...errors, ...validateOpencodeIdentity(identity, expected)];
  }
  if (identity.schema !== 1) {
    errors.push("execution identity schema is invalid");
    return errors;
  }
  // Schema 1 is the legacy Pi shape. It stays readable so schema-6 provenance
  // records label Pi history without crashing the freshness check.
  if (identity.run_id !== expected.runId) errors.push("execution identity run ID does not match");
  if (identity.arm !== expected.arm) errors.push("execution identity arm does not match");
  if (identity.kind === "not-invoked") return [...errors, ...validateNotInvoked(identity, expected)];
  if (expected.mode === "overlay") errors.push("overlay execution must use a not-invoked identity");
  return [...errors, ...validatePiIdentity(identity, expected)];
}

function fromEnvironment(): ExecutionIdentity {
  const environment = process.env;
  const runId = environment.EXECUTION_RUN_ID ?? "";
  const arm = environment.EXECUTION_ARM as Arm;
  const mode = environment.EXECUTION_MODE === "overlay" ? "overlay" : "agent";
  if (mode === "overlay") return resolveExecutionIdentity({ runId, arm, mode });
  const parseArray = (name: string): string[] => {
    const value = JSON.parse(environment[name] ?? "null");
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(name + " must be a JSON string array");
    return value;
  };
  const skillRoot = environment.EXECUTION_SKILL_ROOT;
  const skillRoots = arm === "b" && skillRoot
    ? Object.fromEntries(ARM_B_SKILLS.map((skill) => [skill, join(skillRoot, skill)]))
    : undefined;
  return resolveExecutionIdentity({
    runId,
    arm,
    mode,
    imageReference: environment.EXECUTION_IMAGE_REFERENCE,
    opencodePath: environment.EXECUTION_OPENCODE_PATH,
    modelRef: environment.EXECUTION_MODEL_REF,
    configPath: environment.EXECUTION_CONFIG_PATH,
    entryPath: environment.EXECUTION_ENTRY_PATH,
    rgPath: environment.EXECUTION_RG_PATH,
    skillRoots,
    runtimeFlags: parseArray("EXECUTION_RUNTIME_FLAGS"),
    cliFlags: parseArray("EXECUTION_CLI_FLAGS"),
  });
}

function main(): void {
  const [command, path] = process.argv.slice(2);
  if (command === "--from-env") {
    console.log(JSON.stringify(fromEnvironment()));
    return;
  }
  if (command === "--fingerprint" && path) {
    console.log(executionIdentityFingerprint(JSON.parse(readFileSync(path, "utf8"))));
    return;
  }
  throw new Error("usage: execution-identity.ts --from-env | --fingerprint <identity.json>");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
