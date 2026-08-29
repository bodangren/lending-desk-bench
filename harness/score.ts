/**
 * Tiered scorer. A score is publishable only when its collection, fixture contract,
 * and exact suite provenance are all current. Gate failures are explicit zeroes;
 * harness failures never masquerade as candidate failures.
 *
 * Meta tests should import `buildScoreRecord` in-process. Spawning this file via
 * tsx re-pays cold start + full suite hashing on every call (~10s) and is the main
 * reason the meta suite times out and agents thrash on "failed evaluations".
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CRITERIA, PROBES, ADVISORY } from "./tests/criteria.js";
import { extractUsage } from "./usage.js";
import { recostUsage } from "./go-cost.js";
import { runDoctor, loadBaseline, penaltyOver, PENALTY_FULL, DOCTOR_VERSION, type DoctorReport } from "./doctor.js";
import { currentHashes } from "./provenance.js";
import { assessCandidateContract, type CandidateContract } from "./candidate-contract.js";
import { executionIdentityFingerprint, validateExecutionIdentity } from "./execution-identity.js";
import { attestExecutorFromEnvironment } from "./executor-attestation.js";
import { deriveScoreMetrics } from "./score-calculation.js";

const ROOT = resolve(import.meta.dirname, "..");

const emptyDoctor = (): DoctorReport => ({
  ok: false, errors: 0, warnings: 0, byCategory: {}, byRule: {}, diagnostics: [],
});

let cachedHashes: ReturnType<typeof currentHashes> | undefined;
function liveHashes(): ReturnType<typeof currentHashes> {
  cachedHashes ??= currentHashes();
  return cachedHashes;
}

/** Drop process-local hash cache (tests that mutate harness sources mid-run). */
export function resetScoreHashCache(): void {
  cachedHashes = undefined;
}

function readJson(path: string): { value?: unknown; error?: string } {
  if (!existsSync(path)) return { error: `missing ${path}` };
  try {
    return { value: JSON.parse(readFileSync(path, "utf8")) };
  } catch (error) {
    return { error: `malformed ${path}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failedCandidateContract(reason: string): CandidateContract {
  return {
    schema: 1,
    valid: false,
    reasons: [reason],
    candidate_sha256: "",
    fixture_protected_sha256: "",
    candidate_protected_sha256: "",
    fixture_files: [],
    candidate_files: [],
  };
}

export type ScoreEnv = {
  candidate: string;
  artifacts: string;
  runId?: string;
  model?: string;
  arm?: string;
  thinking?: string;
  wallSeconds?: number;
  gradingSeconds?: number;
  agentExit?: number;
  underLoad?: boolean;
  hostCpus?: number;
  hostLoad?: number;
  hostAvailMb?: number;
};

/**
 * Build a schema-2 score record for the given candidate/artifacts.
 * Prefer this over spawning `tsx score.ts` from meta tests.
 */
export async function buildScoreRecord(input: ScoreEnv): Promise<Record<string, unknown>> {
  const candidate = input.candidate;
  const artifacts = input.artifacts;
  const runId = input.runId ?? "";
  const model = input.model;
  const arm = input.arm;

  const invalidReasons: string[] = [];
  let candidateContract: CandidateContract;
  if (!candidate) {
    candidateContract = failedCandidateContract("CANDIDATE is required");
  } else {
    try {
      candidateContract = assessCandidateContract(join(ROOT, "fixture"), candidate);
    } catch (error) {
      candidateContract = failedCandidateContract(error instanceof Error ? error.message : String(error));
    }
  }
  if (!candidateContract.valid) {
    invalidReasons.push(...candidateContract.reasons.map((reason) => `candidate filesystem contract: ${reason}`));
  }

  const gateRead = readJson(join(artifacts, "gate.json"));
  if (gateRead.error || !isRecord(gateRead.value)) invalidReasons.push(gateRead.error ?? "gate.json is not an object");
  const gate = isRecord(gateRead.value) ? gateRead.value : {};
  const gateFieldsValid = typeof gate.typecheck === "boolean" && typeof gate.build === "boolean";
  if (!gateFieldsValid) {
    invalidReasons.push("gate.json must contain boolean typecheck and build fields");
  }
  const typecheck = gate.typecheck === true;
  const build = gate.build === true;
  const gatePassed = typecheck && build;

  let collectionCurrent = false;
  const collectionRead = readJson(join(artifacts, "collection.json"));
  const collection = isRecord(collectionRead.value) ? collectionRead.value : undefined;
  if (collectionRead.error || !collection) {
    invalidReasons.push(collectionRead.error ?? "collection.json is not an object");
  } else if (collection.valid !== true) {
    invalidReasons.push("collection.json is not marked valid");
  } else if (gatePassed && collection.status !== "collected") {
    invalidReasons.push("collection.json must be collected after a passing gate");
  } else if (!gatePassed && collection.status !== "blocked_by_gate") {
    invalidReasons.push("collection.json must be blocked_by_gate after a failed gate");
  }
  collectionCurrent = collection?.valid === true &&
    (gatePassed ? collection.status === "collected" : collection.status === "blocked_by_gate");

  const provenanceRead = readJson(join(artifacts, "provenance.json"));
  const provenance = isRecord(provenanceRead.value) ? provenanceRead.value : undefined;
  let provenanceCurrent = false;
  if (provenanceRead.error || !provenance) {
    invalidReasons.push(provenanceRead.error ?? "provenance.json is not an object");
  } else {
    const expected = liveHashes();
    const expectedArm = arm === "a" || arm === "b" ? arm : undefined;
    const mode = provenance.mode === "agent" || provenance.mode === "overlay" ? provenance.mode : undefined;
    const runnerAndSuiteCurrent =
      provenance.schema === 4 &&
      provenance.candidate_contract_schema === 1 &&
      provenance.runner_sha256 === expected.runner_sha256 &&
      provenance.suite_sha256 === expected.suite_sha256;
    const identityMatches = provenance.arm === arm && provenance.model === model;
    const contractMatches = candidateContract.valid &&
      provenance.candidate_sha256 === candidateContract.candidate_sha256 &&
      provenance.fixture_protected_sha256 === candidateContract.fixture_protected_sha256;
    const executionErrors = expectedArm && mode
      ? validateExecutionIdentity(provenance.executor, { runId, arm: expectedArm, mode })
      : ["provenance arm or mode is invalid"];
    const executionFingerprintMatches =
      typeof provenance.execution_identity_sha256 === "string" &&
      provenance.execution_identity_sha256 === executionIdentityFingerprint(provenance.executor);
    const modeBindingMatches =
      (mode === "agent" && provenance.agent_isolated === true) ||
      (mode === "overlay" && provenance.agent_isolated === false);
    const recordedExecutionCurrent =
      provenance.run_id === runId &&
      executionErrors.length === 0 &&
      executionFingerprintMatches &&
      modeBindingMatches;
    const executorAttestation = attestExecutorFromEnvironment(provenance);
    const executionCurrent = recordedExecutionCurrent && executorAttestation.eligible;
    provenanceCurrent = runnerAndSuiteCurrent && identityMatches && contractMatches && executionCurrent;
    if (!runnerAndSuiteCurrent) invalidReasons.push("runner or suite provenance does not match this score implementation");
    else if (!identityMatches) invalidReasons.push("provenance model or arm does not match this grading invocation");
    else if (candidateContract.valid && !contractMatches) invalidReasons.push("candidate or fixture contract does not match run provenance");
    else if (!recordedExecutionCurrent) invalidReasons.push("execution identity does not match this grading invocation");
    else if (!executorAttestation.eligible) invalidReasons.push(...executorAttestation.reasons.map((reason) => "executor attestation: " + reason));
  }

  const declared = [...Object.keys(CRITERIA), ...Object.keys(PROBES), ...ADVISORY];
  let passed: Record<string, boolean> = {};
  if (gatePassed) {
    const resultRead = readJson(join(artifacts, "results.json"));
    if (resultRead.error || !isRecord(resultRead.value)) {
      invalidReasons.push(resultRead.error ?? "results.json is not an object");
    } else if (Object.values(resultRead.value).some((value) => typeof value !== "boolean")) {
      invalidReasons.push("results.json contains a non-boolean result");
    } else {
      passed = resultRead.value as Record<string, boolean>;
    }
  }

  const missingCriteria = gatePassed ? declared.filter((id) => !(id in passed)) : [];
  const orphanResults = gatePassed ? Object.keys(passed).filter((id) => !declared.includes(id)) : [];
  if (missingCriteria.length) invalidReasons.push(`missing collected criteria: ${missingCriteria.join(", ")}`);
  if (orphanResults.length) invalidReasons.push(`orphan collected criteria: ${orphanResults.join(", ")}`);
  const suiteCurrent = provenanceCurrent && gateFieldsValid && collectionCurrent &&
    (!gatePassed || (missingCriteria.length === 0 && orphanResults.length === 0));

  const preliminaryMetrics = deriveScoreMetrics(passed, emptyDoctor(), 0);

  let baseline = emptyDoctor();
  let doctorReport = emptyDoctor();
  let penalty = 0;
  if (gatePassed && invalidReasons.length === 0 && preliminaryMetrics.axes.completion > 0) {
    const baselinePath = join(ROOT, "reference", "doctor.json");
    if (!existsSync(baselinePath)) {
      invalidReasons.push("missing reference react-doctor baseline");
    } else {
      try {
        baseline = loadBaseline(baselinePath);
        if (!baseline.ok) invalidReasons.push("reference react-doctor baseline is invalid");
      } catch (error) {
        invalidReasons.push(`malformed reference react-doctor baseline: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (invalidReasons.length === 0) {
      doctorReport = runDoctor(candidate, join(artifacts, "doctor-raw.json"));
      if (!doctorReport.ok) invalidReasons.push("local react-doctor did not produce a valid report");
      else penalty = penaltyOver(doctorReport, baseline);
    }
  }
  const metrics = deriveScoreMetrics(passed, doctorReport, penalty);

  const valid = invalidReasons.length === 0;
  const host = {
    under_load: input.underLoad === true,
    cpus: input.hostCpus ?? 0,
    load1: input.hostLoad ?? 0,
    avail_mb: input.hostAvailMb ?? 0,
  };
  const mode = typeof provenance?.mode === "string" ? provenance.mode : "unknown";
  const agentIsolated = provenance?.agent_isolated === true;
  const rankable = valid && gatePassed && mode === "agent" && agentIsolated && !host.under_load;
  const trusted = rankable;
  const total = valid ? (gatePassed ? Math.round(metrics.raw * 10) / 10 : 0) : null;
  const usage = await extractUsage(join(artifacts, "session.json"));

  return {
    schema: 2,
    valid,
    trusted,
    publishable: trusted,
    rankable,
    invalid_reasons: invalidReasons,
    blocked_by_gate: !gatePassed,
    run_id: runId || undefined,
    model,
    arm,
    thinking_requested: input.thinking ?? "unknown",
    time_on_task_seconds: input.wallSeconds ?? 0,
    grading_seconds: input.gradingSeconds ?? 0,
    usage,
    go: recostUsage(usage, model),
    agent_exit: input.agentExit ?? 0,
    gate: { typecheck, build, passed: gatePassed },
    tiers: metrics.tiers,
    axes: metrics.axes,
    doctor: {
      version: DOCTOR_VERSION,
      ran: doctorReport.ok,
      errors: doctorReport.errors,
      warnings: doctorReport.warnings,
      by_category: doctorReport.byCategory,
      penalty_over_reference: Math.round(penalty * 100) / 100,
      penalty_full: PENALTY_FULL,
      reference_errors: baseline.errors,
      reference_warnings: baseline.warnings,
    },
    advisory: metrics.advisory,
    criteria: metrics.criteria,
    probes: metrics.probes,
    missing_criteria: missingCriteria,
    orphan_results: orphanResults,
    candidate_contract: {
      schema: candidateContract.schema,
      valid: candidateContract.valid,
      reasons: candidateContract.reasons,
      candidate_sha256: candidateContract.candidate_sha256,
      fixture_protected_sha256: candidateContract.fixture_protected_sha256,
    },
    provenance_valid: provenanceCurrent,
    suite_current: suiteCurrent,
    provenance: provenance ?? null,
    host,
    total,
  };
}

/** CLI / grade.sh entry: read process.env and print one score JSON document. */
export async function mainFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<Record<string, unknown>> {
  return buildScoreRecord({
    candidate: env.CANDIDATE ?? "",
    artifacts: env.ARTIFACTS || join(ROOT, "__missing_artifacts__"),
    runId: env.RUN_ID,
    model: env.MODEL,
    arm: env.ARM,
    thinking: env.THINKING,
    wallSeconds: Number(env.WALL_SECONDS ?? 0),
    gradingSeconds: Number(env.GRADING_SECONDS ?? 0),
    agentExit: Number(env.AGENT_EXIT ?? 0),
    underLoad: env.BENCH_UNDER_LOAD === "1",
    hostCpus: Number(env.BENCH_HOST_CPUS ?? 0),
    hostLoad: Number(env.BENCH_HOST_LOAD ?? 0),
    hostAvailMb: Number(env.BENCH_HOST_AVAIL_MB ?? 0),
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const record = await mainFromEnv();
  console.log(JSON.stringify(record, null, 2));
}
