import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { CandidateContract } from "./candidate-contract.js";
import { DOCTOR_VERSION, PENALTY_FULL, loadBaseline, penaltyOver, runDoctor, type DoctorReport } from "./doctor.js";
import { deriveScoreMetrics } from "./score-calculation.js";
import { ADVISORY, CRITERIA, PROBES } from "./tests/criteria.js";

type JsonRecord = Record<string, unknown>;
export type LiveScoreAttestation = { score_current: boolean; reasons: string[] };
export type ScoreAttestationInput = {
  score: JsonRecord;
  runId: string;
  artifacts: string;
  candidate: string;
  provenance: JsonRecord | undefined;
  contract: CandidateContract;
  gate: JsonRecord | undefined;
  gateFieldsValid: boolean;
  gatePassed: boolean;
  collectionCurrent: boolean;
  provenanceCurrent: boolean;
};
const ROOT = resolve(import.meta.dirname, "..");
const DECLARED = [...Object.keys(CRITERIA), ...Object.keys(PROBES), ...ADVISORY].sort();
const emptyDoctor = (): DoctorReport => ({ ok: false, errors: 0, warnings: 0, byCategory: {}, byRule: {}, diagnostics: [] });
const isRecord = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null && !Array.isArray(value);
function readJson(path: string): { value?: unknown; error?: string } {
  if (!existsSync(path)) return { error: "missing " + path };
  try { return { value: JSON.parse(readFileSync(path, "utf8")) }; }
  catch (error) { return { error: "malformed " + path + ": " + (error instanceof Error ? error.message : String(error)) }; }
}
function completeResults(value: unknown, reasons: string[]): Record<string, boolean> | undefined {
  if (!isRecord(value)) { reasons.push("results.json must be an object with every declared result"); return undefined; }
  const ids = Object.keys(value).sort();
  if (ids.join("\0") !== DECLARED.join("\0")) { reasons.push("results.json does not contain exactly the declared results"); return undefined; }
  if (ids.some((id) => typeof value[id] !== "boolean")) { reasons.push("results.json contains a non-boolean result"); return undefined; }
  return value as Record<string, boolean>;
}
function contractSnapshot(contract: CandidateContract): JsonRecord {
  return {
    schema: contract.schema, valid: contract.valid, reasons: contract.reasons,
    candidate_sha256: contract.candidate_sha256, fixture_protected_sha256: contract.fixture_protected_sha256,
  };
}
function doctorSnapshot(doctor: DoctorReport, penalty: number, baseline: DoctorReport): JsonRecord {
  return {
    version: DOCTOR_VERSION, ran: doctor.ok, errors: doctor.errors, warnings: doctor.warnings,
    by_category: doctor.byCategory, penalty_over_reference: Math.round(penalty * 100) / 100,
    penalty_full: PENALTY_FULL, reference_errors: baseline.errors, reference_warnings: baseline.warnings,
  };
}
export function attestScoreRecord(input: ScoreAttestationInput): LiveScoreAttestation {
  const reasons: string[] = [];
  const { score, runId, artifacts, candidate, provenance, contract, gate, gateFieldsValid, gatePassed, collectionCurrent, provenanceCurrent } = input;
  if (score.schema !== 2) reasons.push("score.json schema must be 2");
  if (score.run_id !== runId) reasons.push("score.json run ID does not match its run directory");
  if (!provenance || !isDeepStrictEqual(score.provenance, provenance)) reasons.push("score provenance snapshot does not match provenance.json");
  if (!isDeepStrictEqual(score.candidate_contract, contractSnapshot(contract))) reasons.push("score candidate-contract snapshot does not match the candidate");
  if (!gateFieldsValid || !isDeepStrictEqual(score.gate, { typecheck: gate?.typecheck, build: gate?.build, passed: gatePassed })) {
    reasons.push("score gate snapshot does not match gate.json");
  }
  let results: Record<string, boolean> = {};
  if (gatePassed) {
    const resultRead = readJson(join(artifacts, "results.json"));
    if (resultRead.error) reasons.push(resultRead.error);
    const complete = completeResults(resultRead.value, reasons);
    if (!complete) return { score_current: false, reasons };
    results = complete;
  }
  const preliminary = deriveScoreMetrics(results, emptyDoctor(), 0);
  let baseline = emptyDoctor();
  let doctor = emptyDoctor();
  let penalty = 0;
  if (preliminary.axes.completion > 0) {
    const baselinePath = join(ROOT, "reference", "doctor.json");
    if (!existsSync(baselinePath)) reasons.push("missing reference react-doctor baseline");
    else {
      try { baseline = loadBaseline(baselinePath); }
      catch (error) { reasons.push("malformed reference react-doctor baseline: " + (error instanceof Error ? error.message : String(error))); }
      if (!baseline.ok) reasons.push("reference react-doctor baseline is invalid");
    }
    if (reasons.length === 0) {
      doctor = runDoctor(candidate);
      if (!doctor.ok) reasons.push("local react-doctor did not produce a valid report");
      else penalty = penaltyOver(doctor, baseline);
    }
  }
  const metrics = deriveScoreMetrics(results, doctor, penalty);
  if (!isDeepStrictEqual(score.criteria, metrics.criteria)) reasons.push("score criteria do not match results.json");
  if (!isDeepStrictEqual(score.probes, metrics.probes)) reasons.push("score probes do not match results.json");
  if (!isDeepStrictEqual(score.advisory, metrics.advisory)) reasons.push("score advisory results do not match results.json");
  if (!isDeepStrictEqual(score.tiers, metrics.tiers)) reasons.push("score tiers do not match results.json");
  if (!isDeepStrictEqual(score.axes, metrics.axes)) reasons.push("score axes do not match live doctor evidence");
  if (!isDeepStrictEqual(score.doctor, doctorSnapshot(doctor, penalty, baseline))) reasons.push("score doctor evidence does not match live candidate analysis");
  // Gate-blocked totals are explicit zero; open-gate totals recompute from axes.
  const total = gatePassed ? Math.round(metrics.raw * 10) / 10 : 0;
  if (score.total !== total) reasons.push("score total does not match attested axes");
  // Keep suite_current identical to score.ts so freshness cannot thrash against production scoring.
  const resultsComplete = !gatePassed || (
    isDeepStrictEqual(score.missing_criteria, []) && isDeepStrictEqual(score.orphan_results, [])
  );
  const suiteCurrent = provenanceCurrent && gateFieldsValid && collectionCurrent && resultsComplete;
  if (score.valid !== true || score.blocked_by_gate !== !gatePassed || score.provenance_valid !== provenanceCurrent ||
      score.suite_current !== suiteCurrent ||
      !isDeepStrictEqual(score.missing_criteria, []) || !isDeepStrictEqual(score.orphan_results, [])) {
    reasons.push("score validity fields do not match current artifacts");
  }
  return { score_current: reasons.length === 0, reasons };
}
