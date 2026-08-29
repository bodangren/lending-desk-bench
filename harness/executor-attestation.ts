import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import { ARM_B_SKILLS, resolveExecutionIdentity, validateExecutionIdentity } from "./execution-identity.js";

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
function failed(reasons: string[], current = false, cohortCompatible = false): ExecutorAttestation {
  return { schema: 1, current, cohort_compatible: cohortCompatible, eligible: current && cohortCompatible, reasons };
}
function compatibleCohort(record: JsonRecord, frozen: JsonRecord, executor: JsonRecord): string[] {
  const reasons: string[] = [];
  if (frozen.schema !== 1 || typeof frozen.id !== "string" || !frozen.id) reasons.push("executor cohort is malformed");
  if (record.cohort_id !== frozen.id) reasons.push("executor cohort ID is incompatible");
  if (executor.kind === "not-invoked") {
    if (frozen.kind !== "not-invoked") reasons.push("not-invoked executor cohort is incompatible");
    return reasons;
  }
  if (!isDeepStrictEqual(frozen.image_reference, executor.image_reference) ||
      !isDeepStrictEqual(frozen.image_identity, executor.image_identity) ||
      !isDeepStrictEqual(frozen.pi, executor.pi)) reasons.push("executor differs from frozen image or Pi cohort");
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
function resolveLive(live: JsonRecord): JsonRecord {
  if (!isArm(live.arm) || typeof live.run_id !== "string" || typeof live.image_reference !== "string" ||
      typeof live.pi_path !== "string" || !strings(live.runtime_flags) || !strings(live.cli_flags)) {
    throw new Error("live executor input is incomplete");
  }
  let skillRoots: Partial<Record<(typeof ARM_B_SKILLS)[number], string>> | undefined;
  if (live.arm === "b") {
    if (!isRecord(live.skill_roots)) throw new Error("live Arm-B skill roots are missing");
    skillRoots = {};
    for (const skill of ARM_B_SKILLS) {
      if (typeof live.skill_roots[skill] !== "string") throw new Error("live Arm-B skill root is missing: " + skill);
      skillRoots[skill] = live.skill_roots[skill] as string;
    }
  }
  return resolveExecutionIdentity({
    runId: live.run_id,
    arm: live.arm,
    imageReference: live.image_reference,
    piPath: live.pi_path,
    skillRoots,
    runtimeFlags: live.runtime_flags,
    cliFlags: live.cli_flags,
  }) as JsonRecord;
}
export function attestCurrentExecutor(input: unknown): ExecutorAttestation {
  if (!isRecord(input) || !isRecord(input.record) || !isRecord(input.frozen_cohort)) {
    return failed(["executor attestation input is incomplete"]);
  }
  const record = input.record;
  const frozen = input.frozen_cohort;
  const executor = isRecord(record.executor) ? record.executor : undefined;
  if (!executor || !isArm(record.arm) || typeof record.run_id !== "string") return failed(["recorded executor is incomplete"]);
  if (executor.kind === "not-invoked") {
    const identityErrors = validateExecutionIdentity(executor, { runId: record.run_id, arm: record.arm, mode: "overlay" });
    const current = identityErrors.length === 0;
    const cohortReasons = compatibleCohort(record, frozen, executor);
    return failed([...identityErrors, ...cohortReasons], current, current && cohortReasons.length === 0);
  }
  if (!isRecord(input.live)) return failed(["live executor input is missing"]);
  let live: JsonRecord;
  try { live = resolveLive(input.live); }
  catch (error) { return failed(["could not resolve live executor: " + (error instanceof Error ? error.message : String(error))]); }
  const current = isDeepStrictEqual(executor, live);
  const cohortReasons = compatibleCohort(record, frozen, executor);
  const reasons = [...cohortReasons];
  if (!current) reasons.unshift("live executor differs from recorded executor");
  return failed(reasons, current, current && cohortReasons.length === 0);
}
function parseFlags(name: string, fallback: unknown): string[] {
  const raw = process.env[name];
  if (!raw) {
    if (!strings(fallback)) throw new Error(name + " fallback is invalid");
    return fallback;
  }
  const parsed = JSON.parse(raw);
  if (!strings(parsed)) throw new Error(name + " must be a JSON string array");
  return parsed;
}
export function attestExecutorFromEnvironment(record: unknown): ExecutorAttestation {
  if (!isRecord(record)) return failed(["provenance executor record is malformed"]);
  if (!("cohort_id" in record) && !("executor_cohort" in record)) {
    return failed(["provenance executor cohort is missing"]);
  }
  if (typeof record.cohort_id !== "string" || !isRecord(record.executor_cohort) || !isRecord(record.executor)) {
    return failed(["provenance executor cohort is incomplete"]);
  }
  if ((record.executor as JsonRecord).kind === "not-invoked") {
    return attestCurrentExecutor({ record, frozen_cohort: record.executor_cohort });
  }
  try {
    if (!isArm(record.arm) || typeof record.run_id !== "string") throw new Error("provenance run binding is invalid");
    const executor = record.executor as JsonRecord;
    const frozen = record.executor_cohort as JsonRecord;
    const piRoot = process.env.BENCH_PI_ROOT;
    if (!piRoot) throw new Error("BENCH_PI_ROOT is not set");
    const skillRoot = process.env.BENCH_SKILL_ROOT ?? join(process.env.HOME ?? "", ".agents/skills");
    const live: JsonRecord = {
      run_id: record.run_id,
      arm: record.arm,
      image_reference: process.env.BENCH_AGENT_IMAGE ?? "docker.io/library/node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3",
      pi_path: join(piRoot, "bin", "pi"),
      runtime_flags: parseFlags("BENCH_EXECUTOR_RUNTIME_FLAGS", frozenFlags(frozen, "runtime_flags") ?? executor.runtime_flags),
      cli_flags: parseFlags("BENCH_EXECUTOR_CLI_FLAGS", frozenFlags(frozen, "cli_flags") ?? executor.cli_flags),
    };
    if (record.arm === "b") live.skill_roots = Object.fromEntries(ARM_B_SKILLS.map((skill) => [skill, join(skillRoot, skill)]));
    return attestCurrentExecutor({ record, frozen_cohort: record.executor_cohort, live });
  } catch (error) {
    return failed(["could not resolve environment executor: " + (error instanceof Error ? error.message : String(error))]);
  }
}
function frozenFlags(frozen: JsonRecord, name: "runtime_flags" | "cli_flags"): string[] | undefined {
  const hasRuntimeFlags = "runtime_flags" in frozen;
  const hasCliFlags = "cli_flags" in frozen;
  if (hasRuntimeFlags !== hasCliFlags ||
      (hasRuntimeFlags && (!strings(frozen.runtime_flags) || !strings(frozen.cli_flags)))) {
    throw new Error("frozen executor flags are incomplete");
  }
  return hasRuntimeFlags ? frozen[name] as string[] : undefined;
}
