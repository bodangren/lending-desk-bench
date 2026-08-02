/**
 * Recompute whether an existing score is still eligible for publication.
 *
 * Persisted score flags are historical output, not the source of freshness:
 * this checker re-evaluates the candidate filesystem contract and current
 * runner/suite hashes against the run's provenance before considering a score.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assessCandidateContract, type CandidateContract } from "./candidate-contract.js";
import { currentHashes } from "./provenance.js";
import { executionIdentityFingerprint, validateExecutionIdentity } from "./execution-identity.js";
import { attestExecutorFromEnvironment } from "./executor-attestation.js";
import { attestScoreRecord } from "./score-attestation.js";

const ROOT = resolve(import.meta.dirname, "..");
const FIXTURE = join(ROOT, "fixture");
let cachedHashes: ReturnType<typeof currentHashes> | undefined;

type JsonRecord = Record<string, unknown>;

export type FreshnessState =
  | "TRUSTED"
  | "CALIBRATION"
  | "GATE-BLOCKED"
  | "UNDER-LOAD"
  | "UNTRUSTED"
  | "STALE-PROVENANCE"
  | "INVALID";

export type ScoreFreshness = {
  schema: 1;
  score_path: string;
  run_id: string;
  state: FreshnessState;
  rankable: boolean;
  candidate_contract_valid: boolean;
  provenance_current: boolean;
  score_current: boolean;
  host_trusted: boolean;
  gate_passed: boolean;
  collection_current: boolean;
  reasons: string[];
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(path: string): { value?: unknown; error?: string } {
  if (!existsSync(path)) return { error: "missing " + path };
  try {
    return { value: JSON.parse(readFileSync(path, "utf8")) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { error: "malformed " + path + ": " + detail };
  }
}

function failedContract(reason: string): CandidateContract {
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

function contractFor(candidate: string): CandidateContract {
  try {
    return assessCandidateContract(FIXTURE, candidate);
  } catch (error) {
    return failedContract(error instanceof Error ? error.message : String(error));
  }
}

function resolveScorePath(input: string): string {
  if (input.endsWith(".json")) return resolve(process.cwd(), input);
  return resolve(ROOT, "runs", input, "artifacts", "score.json");
}

function liveHashes(): ReturnType<typeof currentHashes> {
  cachedHashes ??= currentHashes();
  return cachedHashes;
}

function result(
  scorePath: string,
  runId: string,
  state: FreshnessState,
  rankable: boolean,
  contractValid: boolean,
  provenanceCurrent: boolean,
  gatePassed: boolean,
  collectionCurrent: boolean,
  reasons: string[],
  scoreCurrent = false,
  hostTrusted = false,
): ScoreFreshness {
  return {
    schema: 1,
    score_path: scorePath,
    run_id: runId,
    state,
    rankable,
    candidate_contract_valid: contractValid,
    provenance_current: provenanceCurrent,
    score_current: scoreCurrent,
    host_trusted: hostTrusted,
    gate_passed: gatePassed,
    collection_current: collectionCurrent,
    reasons,
  };
}

/**
 * Assess an existing score path or a run ID. This never writes a run artifact.
 */
export function assessScoreFreshness(input: string): ScoreFreshness {
  const scorePath = resolveScorePath(input);
  const artifacts = dirname(scorePath);
  const work = dirname(artifacts);
  const runId = work.split("/").pop() ?? "unknown";
  const candidate = join(work, "candidate");
  const scoreRead = readJson(scorePath);
  const score = isRecord(scoreRead.value) ? scoreRead.value : undefined;
  if (!score) {
    return result(
      scorePath, runId, "INVALID", false, false, false, false, false,
      [scoreRead.error ?? "score record is not an object"],
    );
  }

  const contract = contractFor(candidate);
  const provenanceRead = readJson(join(artifacts, "provenance.json"));
  const provenance = isRecord(provenanceRead.value) ? provenanceRead.value : undefined;
  const freshnessReasons: string[] = [];
  if (!contract.valid) {
    freshnessReasons.push(...contract.reasons.map((reason) => "candidate filesystem contract: " + reason));
  }

  let provenanceCurrent = false;
  if (!provenance) {
    freshnessReasons.push(provenanceRead.error ?? "provenance.json is not an object");
  } else {
    try {
      const hashes = liveHashes();
      const expectedArm = score.arm === "a" || score.arm === "b" ? score.arm : undefined;
      const mode = provenance.mode === "agent" || provenance.mode === "overlay" ? provenance.mode : undefined;
      const runnerAndSuiteCurrent =
        provenance.schema === 4 &&
        provenance.candidate_contract_schema === 1 &&
        provenance.runner_sha256 === hashes.runner_sha256 &&
        provenance.suite_sha256 === hashes.suite_sha256;
      const identityMatches =
        provenance.arm === score.arm &&
        provenance.model === score.model;
      const contractMatches =
        contract.valid &&
        provenance.candidate_sha256 === contract.candidate_sha256 &&
        provenance.fixture_protected_sha256 === contract.fixture_protected_sha256;
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
      if (!runnerAndSuiteCurrent) freshnessReasons.push("runner or suite provenance is stale");
      if (runnerAndSuiteCurrent && !identityMatches) freshnessReasons.push("provenance model or arm differs from score record");
      if (contract.valid && !contractMatches) freshnessReasons.push("candidate contract differs from run provenance");
      if (runnerAndSuiteCurrent && identityMatches && contractMatches && !recordedExecutionCurrent) {
        freshnessReasons.push("execution identity differs from current run evidence");
      }
      if (runnerAndSuiteCurrent && identityMatches && contractMatches && recordedExecutionCurrent && !executorAttestation.eligible) {
        freshnessReasons.push(...executorAttestation.reasons.map((reason) => "executor attestation: " + reason));
      }
    } catch (error) {
      freshnessReasons.push("could not recompute runner/suite hashes: " + (error instanceof Error ? error.message : String(error)));
    }
  }

  const gateRead = readJson(join(artifacts, "gate.json"));
  const gate = isRecord(gateRead.value) ? gateRead.value : undefined;
  const gateWellFormed = gate?.typecheck === true || gate?.typecheck === false;
  const buildWellFormed = gate?.build === true || gate?.build === false;
  const gatePassed = gate?.typecheck === true && gate?.build === true;
  if (!gateWellFormed || !buildWellFormed) freshnessReasons.push(gateRead.error ?? "gate.json must contain boolean typecheck and build fields");

  const collectionRead = readJson(join(artifacts, "collection.json"));
  const collection = isRecord(collectionRead.value) ? collectionRead.value : undefined;
  const collectionCurrent = collection?.valid === true &&
    (gatePassed ? collection.status === "collected" : collection.status === "blocked_by_gate");
  if (!collectionCurrent) {
    freshnessReasons.push(collectionRead.error ??
      (gatePassed
        ? "collection.json must be valid and collected after a passing gate"
        : "collection.json must be valid and blocked_by_gate after a failed gate"));
  }

  const scoreFreshness = attestScoreRecord({
    score,
    runId,
    artifacts,
    candidate,
    provenance,
    contract,
    gate,
    gateFieldsValid: gateWellFormed && buildWellFormed,
    gatePassed,
    collectionCurrent,
    provenanceCurrent,
  });
  const scoreCurrent = scoreFreshness.score_current === true;
  const hostTrusted = isRecord(score.host) && score.host.under_load === false;
  freshnessReasons.push(...scoreFreshness.reasons);
  if (!contract.valid || !provenanceCurrent) {
    return result(
      scorePath, runId, "STALE-PROVENANCE", false, contract.valid, provenanceCurrent,
      gatePassed, collectionCurrent, freshnessReasons, scoreCurrent, hostTrusted,
    );
  }
  if (!scoreCurrent) {
    return result(
      scorePath, runId, "INVALID", false, true, true,
      gatePassed, collectionCurrent, freshnessReasons, false, hostTrusted,
    );
  }
  if (!gatePassed) {
    return result(
      scorePath, runId, "GATE-BLOCKED", false, true, true, false, collectionCurrent,
      freshnessReasons, scoreCurrent, hostTrusted,
    );
  }
  if (!collectionCurrent) {
    return result(
      scorePath, runId, "INVALID", false, true, true, true, false, freshnessReasons, scoreCurrent, hostTrusted,
    );
  }

  const mode = provenance?.mode;
  const isolatedAgent = mode === "agent" && provenance.agent_isolated === true;
  if (!isolatedAgent) {
    return result(
      scorePath, runId, "CALIBRATION", false, true, true, true, true,
      ["overlay and non-isolated runs are diagnostic only"], scoreCurrent, hostTrusted,
    );
  }

  const host = isRecord(score.host) ? score.host : {};
  if (!hostTrusted) {
    return result(
      scorePath, runId, "UNDER-LOAD", false, true, true, true, true,
      [host.under_load === true ? "host was contended during grading" : "host trust evidence lacks under_load: false"],
      scoreCurrent, false,
    );
  }

  const total = score.total;
  const totalIsFinite = typeof total === "number" && Number.isFinite(total);
  const reasons = Array.isArray(score.invalid_reasons) ? score.invalid_reasons : undefined;
  const persistedEligible =
    score.valid === true &&
    score.trusted === true &&
    score.publishable === true &&
    score.rankable === true &&
    score.blocked_by_gate !== true &&
    totalIsFinite &&
    Array.isArray(reasons) &&
    reasons.length === 0;
  if (!persistedEligible) {
    return result(
      scorePath, runId, "UNTRUSTED", false, true, true, true, true,
      ["record is not a valid trusted publishable rankable score"], scoreCurrent, hostTrusted,
    );
  }
  return result(scorePath, runId, "TRUSTED", true, true, true, true, true, [], scoreCurrent, hostTrusted);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args[0] === "--many") {
    if (args.length < 2) throw new Error("usage: score-freshness.ts --many <score-path>...");
    console.log(JSON.stringify(args.slice(1).map((input) => assessScoreFreshness(input))));
    return;
  }
  const [input, mode] = args;
  if (!input || (mode && mode !== "--rankable")) {
    throw new Error("usage: score-freshness.ts <score-path|run-id> [--rankable]");
  }
  const freshness = assessScoreFreshness(input);
  if (mode === "--rankable") {
    process.exitCode = freshness.rankable ? 0 : 1;
    return;
  }
  console.log(JSON.stringify(freshness));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
