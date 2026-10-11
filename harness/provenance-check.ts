/**
 * Provenance validation shared by score.ts and score-freshness.ts.
 *
 * Schema 6 (bench_v2) adds fixture_revision, contract_violation_sha256, graft,
 * and the tests/change set bindings to schema 5. Every older schema is stale:
 * regrade-run.sh rewrites provenance for a historical run and grades it again.
 */
import type { BenchTrack, CandidateContract } from "./candidate-contract.js";
import { executionIdentityFingerprint, validateExecutionIdentity } from "./execution-identity.js";
import { attestExecutorFromEnvironment } from "./executor-attestation.js";
import { FIXTURE_REVISION } from "./revisions.js";
import { verifyTrackBindings } from "./track-bindings.js";

export const PROVENANCE_SCHEMA = 6;

const hex64 = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A graft block: the agent's writable files, graded on a fresh comparison tree. */
export function graftErrors(graft: unknown): string[] {
  if (graft === null) return [];
  if (!isRecord(graft)) return ["provenance graft must be null or an object"];
  const errors: string[] = [];
  if (graft.reason !== "contract-violation" && graft.reason !== "regrade") errors.push("provenance graft reason is invalid");
  if (!hex64(graft.from_candidate_sha256)) errors.push("provenance graft lacks the original candidate hash");
  if (!Number.isInteger(graft.from_fixture_revision) || (graft.from_fixture_revision as number) < 1) {
    errors.push("provenance graft lacks the original fixture revision");
  }
  return errors;
}

export function checkProvenance(input: {
  provenance: Record<string, unknown>;
  hashes: { runner_sha256: string; suite_sha256: string };
  runId: string;
  model: unknown;
  arm: unknown;
  track: BenchTrack;
  contract: CandidateContract;
  artifacts: string;
  comparisonRoot: string;
}): { current: boolean; reasons: string[] } {
  const { provenance, hashes, runId, model, arm, track, contract, artifacts, comparisonRoot } = input;
  const reasons: string[] = [];
  const expectedArm = arm === "a" || arm === "b" ? arm : undefined;
  const mode = provenance.mode === "agent" || provenance.mode === "overlay" ? provenance.mode : undefined;
  const runnerAndSuiteCurrent =
    provenance.schema === PROVENANCE_SCHEMA &&
    provenance.candidate_contract_schema === 1 &&
    provenance.runner_sha256 === hashes.runner_sha256 &&
    provenance.suite_sha256 === hashes.suite_sha256;
  let bindingsCurrent = true;
  if (runnerAndSuiteCurrent && provenance.track !== track) {
    reasons.push("provenance track does not match this grading invocation");
    bindingsCurrent = false;
  }
  if (runnerAndSuiteCurrent) {
    const bindings = verifyTrackBindings(provenance, artifacts, track, comparisonRoot);
    reasons.push(...bindings.reasons);
    if (!bindings.current) bindingsCurrent = false;
    const revision = provenance.fixture_revision;
    if (!Number.isInteger(revision) || (revision as number) < 1 || (revision as number) > FIXTURE_REVISION) {
      reasons.push("provenance fixture revision is invalid");
      bindingsCurrent = false;
    }
    const violation = provenance.contract_violation_sha256;
    if (violation !== null && !hex64(violation)) {
      reasons.push("provenance contract-violation hash is malformed");
      bindingsCurrent = false;
    }
    const graft = graftErrors(provenance.graft ?? null);
    if (graft.length) {
      reasons.push(...graft);
      bindingsCurrent = false;
    }
  }
  const identityMatches = provenance.arm === arm && provenance.model === model;
  const contractMatches = contract.gradeable &&
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
  if (!runnerAndSuiteCurrent) reasons.push("runner or suite provenance does not match this score implementation");
  else if (!identityMatches) reasons.push("provenance model or arm does not match this grading invocation");
  else if (contract.gradeable && !contractMatches) reasons.push("candidate or fixture contract does not match run provenance");
  else if (!recordedExecutionCurrent) reasons.push("execution identity does not match this grading invocation");
  else if (!executorAttestation.eligible) reasons.push(...executorAttestation.reasons.map((reason) => "executor attestation: " + reason));
  return {
    current: runnerAndSuiteCurrent && bindingsCurrent && identityMatches && contractMatches && executionCurrent,
    reasons,
  };
}
