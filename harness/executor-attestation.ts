import { isDeepStrictEqual } from "node:util";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { hashTree, validateExecutionIdentity } from "./execution-identity.js";

type JsonRecord = Record<string, unknown>;
type Arm = "a" | "b";
export type ExecutorAttestation = {
  schema: 1;
  current: boolean;
  cohort_compatible: boolean;
  eligible: boolean;
  reasons: string[];
};
const isRecord = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null && !Array.isArray(value);
const isArm = (value: unknown): value is Arm => value === "a" || value === "b";
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

function failed(reasons: string[], current = false, cohortCompatible = false): ExecutorAttestation {
  return { schema: 1, current, cohort_compatible: cohortCompatible, eligible: current && cohortCompatible, reasons };
}

function deepEqualReasons(frozen: JsonRecord, executor: JsonRecord, fields: readonly string[], label: string): string[] {
  const reasons: string[] = [];
  for (const field of fields) {
    if (!(field in frozen) || !isDeepStrictEqual(frozen[field], executor[field])) {
      reasons.push(`executor ${label} differs from frozen cohort: ${field}`);
    }
  }
  return reasons;
}

function compatibleCohort(record: JsonRecord, frozen: JsonRecord, executor: JsonRecord): string[] {
  const reasons: string[] = [];
  if (frozen.schema !== 1 || typeof frozen.id !== "string" || !frozen.id) reasons.push("executor cohort is malformed");
  if (record.cohort_id !== frozen.id) reasons.push("executor cohort ID is incompatible");
  if (executor.kind === "not-invoked") {
    if (frozen.kind !== "not-invoked") reasons.push("not-invoked executor cohort is incompatible");
    return reasons;
  }
  if (executor.schema === 2) {
    reasons.push(...deepEqualReasons(frozen, executor, [
      "image_reference", "image_identity", "opencode", "model_ref", "variant",
      "config_sha256", "entry_sha256", "helpers", "credential",
    ], "evidence"));
    const arms = isRecord(frozen.arms) ? frozen.arms : undefined;
    const arm = typeof record.arm === "string" ? record.arm : "";
    const frozenArm = arms && isRecord(arms[arm]) ? arms[arm] : undefined;
    if (!frozenArm || !isDeepStrictEqual(frozenArm.skills, executor.skills) ||
        !isDeepStrictEqual(frozenArm.skill_tree_sha256, executor.skill_tree_sha256)) {
      reasons.push("executor skills differ from frozen cohort");
    }
    if (!strings(frozen.runtime_flags) || !strings(frozen.cli_flags)) {
      reasons.push("frozen executor flag evidence is malformed");
    } else if (!isDeepStrictEqual(frozen.runtime_flags, executor.runtime_flags) ||
        !isDeepStrictEqual(frozen.cli_flags, executor.cli_flags)) {
      reasons.push("executor flags differ from frozen cohort");
    }
    return reasons;
  }
  // Schema 1 is the legacy Pi shape: keep the frozen-cohort comparison so a
  // schema-6 record labels its Pi history readably.
  reasons.push(...deepEqualReasons(frozen, executor, ["image_reference", "image_identity", "pi"], "evidence"));
  const arms = isRecord(frozen.arms) ? frozen.arms : undefined;
  const arm = typeof record.arm === "string" ? record.arm : "";
  const frozenArm = arms && isRecord(arms[arm]) ? arms[arm] : undefined;
  if (!frozenArm || !isDeepStrictEqual(frozenArm.skills, executor.skills) ||
      !isDeepStrictEqual(frozenArm.skill_tree_sha256, executor.skill_tree_sha256)) {
    reasons.push("executor skills differ from frozen cohort");
  }
  const hasRuntimeFlags = "runtime_flags" in frozen;
  const hasCliFlags = "cli_flags" in frozen;
  if (hasRuntimeFlags !== hasCliFlags ||
      (hasRuntimeFlags && (!strings(frozen.runtime_flags) || !strings(frozen.cli_flags)))) {
    reasons.push("frozen executor flag evidence is malformed");
  } else if (hasRuntimeFlags &&
      (!isDeepStrictEqual(frozen.runtime_flags, executor.runtime_flags) ||
       !isDeepStrictEqual(frozen.cli_flags, executor.cli_flags))) {
    reasons.push("executor flags differ from frozen cohort");
  }
  return reasons;
}

/**
 * Re-hash the run's own recorded snapshots and compare them with the recorded
 * identity. The run directory holds the config and the per-run skill snapshot
 * the container saw; ambient skill sources, live binaries, and live images
 * never enter this check (FR-6).
 */
function snapshotReasons(executor: JsonRecord, artifacts: string): string[] {
  const reasons: string[] = [];
  const configPath = join(artifacts, "executor", "opencode.json");
  if (typeof executor.config_sha256 !== "string") return reasons;
  if (!existsSync(configPath)) {
    reasons.push("executor config snapshot is missing from the run artifacts");
  } else if (sha256(readFileSync(configPath)) !== executor.config_sha256) {
    reasons.push("executor config snapshot does not match the recorded identity hash");
  }
  const skillsRoot = join(artifacts, "executor", "skills");
  const skills = isRecord(executor.skills) ? executor.skills : {};
  if (existsSync(skillsRoot)) {
    const listed = readdirSync(skillsRoot).sort();
    const recorded = Object.keys(skills).sort();
    if (listed.join("\0") !== recorded.join("\0")) {
      reasons.push("executor skill snapshot set does not match the recorded identity");
    }
  }
  for (const skill of Object.keys(skills)) {
    const snapshot = join(skillsRoot, skill);
    if (!existsSync(snapshot)) {
      reasons.push(`executor skill snapshot is missing from the run artifacts: ${skill}`);
      continue;
    }
    try {
      if (hashTree(snapshot) !== skills[skill]) {
        reasons.push(`executor skill snapshot does not match the recorded identity hash: ${skill}`);
      }
    } catch {
      reasons.push(`executor skill snapshot cannot be hashed: ${skill}`);
    }
  }
  return reasons;
}

/**
 * Attest the executor one run recorded. The check reads only the recorded
 * identity, the frozen cohort, and the run's own artifact snapshots. It never
 * resolves a live binary, a live skill folder, or a live image, and it never
 * reads BENCH_* variables, HOME, or PATH, so an OpenCode upgrade on the host
 * never makes an earlier run stale.
 */
export function attestCurrentExecutor(input: unknown): ExecutorAttestation {
  try {
    if (!isRecord(input) || !isRecord(input.record) || !isRecord(input.frozen_cohort)) {
      return failed(["executor attestation input is incomplete"]);
    }
    const record = input.record;
    const frozen = input.frozen_cohort;
    const executor = isRecord(record.executor) ? record.executor : undefined;
    if (!executor || !isArm(record.arm) || typeof record.run_id !== "string") return failed(["recorded executor is incomplete"]);
    if (executor.kind === "not-invoked") {
      const identityErrors = validateExecutionIdentity(executor, { runId: record.run_id, arm: record.arm, mode: "overlay" });
      const cohortReasons = compatibleCohort(record, frozen, executor);
      const current = identityErrors.length === 0;
      return failed([...identityErrors, ...cohortReasons], current, current && cohortReasons.length === 0);
    }
    const identityErrors = validateExecutionIdentity(executor, { runId: record.run_id, arm: record.arm, mode: "agent" });
    const snapshotErrors = typeof input.artifacts === "string" && executor.schema === 2
      ? snapshotReasons(executor, input.artifacts)
      : [];
    const cohortReasons = compatibleCohort(record, frozen, executor);
    const current = identityErrors.length === 0 && snapshotErrors.length === 0;
    return failed(
      [...identityErrors, ...snapshotErrors, ...cohortReasons],
      current,
      current && cohortReasons.length === 0,
    );
  } catch (error) {
    return failed(["executor attestation failed: " + (error instanceof Error ? error.message : String(error))]);
  }
}
