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
import { extractUsage } from "./usage.js";
import { recostUsage } from "./go-cost.js";
import { runDoctor, loadBaseline, penaltyOver, PENALTY_FULL, DOCTOR_VERSION, type DoctorReport } from "./doctor.js";
import { currentHashes } from "./provenance.js";
import { assessCandidateContract, resolveTrack, type BenchTrack, type CandidateContract } from "./candidate-contract.js";
import { checkProvenance } from "./provenance-check.js";
import { FIXTURE_REVISION } from "./revisions.js";
import { contractScore, declaredIds, loadTrackContext, recordRevision, trackMetrics, type TrackContext } from "./track-scoring.js";

const ROOT = resolve(import.meta.dirname, "..");

/** Playwright's error when the browser binary cannot start (grade.sh greps the same text). */
const BROWSER_LAUNCH_ERROR = /browserType\.launch|Executable doesn't exist/;

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
    gradeable: false,
    reasons: [reason],
    hard: ["missing_root"],
    soft: [],
    candidate_sha256: "",
    fixture_protected_sha256: "",
    candidate_protected_sha256: "",
    fixture_files: [],
    candidate_files: [],
  };
}

/** The contract fields a score record carries; score-attestation compares the same shape. */
export function contractSnapshot(contract: CandidateContract): Record<string, unknown> {
  return {
    schema: contract.schema,
    valid: contract.valid,
    gradeable: contract.gradeable,
    reasons: contract.reasons,
    hard: contract.hard,
    soft: contract.soft,
    candidate_sha256: contract.candidate_sha256,
    fixture_protected_sha256: contract.fixture_protected_sha256,
  };
}

/** Every track except build grades against the run's generated variant tree. */
export function comparisonRootFor(track: BenchTrack, candidate: string, variant?: string): string {
  return track === "build" ? join(ROOT, "fixture") : (variant ?? join(candidate, "..", "variant"));
}

export type ScoreEnv = {
  candidate: string;
  artifacts: string;
  /** Variant-track runs grade against a generated variant instead of fixture/. */
  variant?: string;
  track?: BenchTrack;
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

function changedLineCount(diffPath: string): number {
  if (!existsSync(diffPath)) return 0;
  try {
    return readFileSync(diffPath, "utf8")
      .split("\n")
      .filter((line) => /^[+-]/.test(line) && !/^\+\+\+|^---/.test(line)).length;
  } catch {
    return 0;
  }
}

/**
 * Build a schema-3 score record for the given candidate/artifacts.
 * Prefer this over spawning `tsx score.ts` from meta tests.
 */
export async function buildScoreRecord(input: ScoreEnv): Promise<Record<string, unknown>> {
  const candidate = input.candidate;
  const artifacts = input.artifacts;
  const runId = input.runId ?? "";
  const model = input.model;
  const arm = input.arm;

  const invalidReasons: string[] = [];
  // The track comes from the env/explicit input; provenance must agree below.
  const track: BenchTrack = resolveTrack(input.track ?? process.env.BENCH_TRACK);
  const comparisonRoot = comparisonRootFor(track, candidate, input.variant);
  if (track !== "build" && !existsSync(comparisonRoot)) {
    invalidReasons.push(`${track} variant tree is missing: ${comparisonRoot}`);
  }
  let candidateContract: CandidateContract;
  if (!candidate) {
    candidateContract = failedCandidateContract("CANDIDATE is required");
  } else {
    try {
      candidateContract = assessCandidateContract(comparisonRoot, candidate, { track });
    } catch (error) {
      candidateContract = failedCandidateContract(error instanceof Error ? error.message : String(error));
    }
  }
  // Soft violations inside writable files (a changed export, a suppression) are
  // graded and cost adherence. Anything else must have been grafted away first.
  if (!candidateContract.gradeable) {
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
  const collectionCurrent = collection?.valid === true &&
    (gatePassed ? collection.status === "collected" : collection.status === "blocked_by_gate");

  const provenanceRead = readJson(join(artifacts, "provenance.json"));
  const provenance = isRecord(provenanceRead.value) ? provenanceRead.value : undefined;
  let provenanceCurrent = false;
  if (provenanceRead.error || !provenance) {
    invalidReasons.push(provenanceRead.error ?? "provenance.json is not an object");
  } else {
    const check = checkProvenance({
      provenance, hashes: liveHashes(), runId, model, arm, track,
      contract: candidateContract, artifacts, comparisonRoot,
    });
    provenanceCurrent = check.current;
    invalidReasons.push(...check.reasons);
  }

  const loaded = loadTrackContext(track, artifacts);
  invalidReasons.push(...loaded.reasons);
  const context: TrackContext = loaded.context ?? (
    track === "bugfix" ? { track, bugs: [] }
      : track === "change" ? { track, changeIds: [], superseded: [] }
      : track === "tests" ? { track, mutants: [], tests: { total: 0, valid: 0 } }
      : { track: "build" }
  );
  const declared = declaredIds(context);
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

  // A missing browser fails every browser criterion inside a report that still
  // parses. That is a harness failure: historical records graded this way must not
  // rescore into a valid low total.
  if (gatePassed) {
    for (const report of ["e2e-raw.json", "e2e-error-raw.json"]) {
      const reportPath = join(artifacts, report);
      if (existsSync(reportPath) && BROWSER_LAUNCH_ERROR.test(readFileSync(reportPath, "utf8"))) {
        invalidReasons.push("browser was unavailable during the e2e pass");
        break;
      }
    }
  }

  const missingCriteria = gatePassed ? declared.filter((id) => !(id in passed)) : [];
  const orphanResults = gatePassed ? Object.keys(passed).filter((id) => !declared.includes(id)) : [];
  if (missingCriteria.length) invalidReasons.push(`missing collected criteria: ${missingCriteria.join(", ")}`);
  if (orphanResults.length) invalidReasons.push(`orphan collected criteria: ${orphanResults.join(", ")}`);
  const suiteCurrent = provenanceCurrent && gateFieldsValid && collectionCurrent &&
    (!gatePassed || (missingCriteria.length === 0 && orphanResults.length === 0));

  const adherence = contractScore(artifacts, candidateContract, provenance);
  invalidReasons.push(...adherence.reasons);

  const preliminary = trackMetrics(context, passed, emptyDoctor(), 0, adherence.score, recordRevision(provenance));
  let baseline = emptyDoctor();
  let doctorReport = emptyDoctor();
  let penalty = 0;
  if (gatePassed && invalidReasons.length === 0 && preliminary.primary > 0) {
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
      doctorReport = runDoctor(candidate, join(artifacts, "doctor-raw.json"), track);
      if (!doctorReport.ok) invalidReasons.push("local react-doctor did not produce a valid report");
      else penalty = penaltyOver(doctorReport, baseline);
    }
  }
  const metrics = trackMetrics(context, passed, doctorReport, penalty, adherence.score, recordRevision(provenance));

  const valid = invalidReasons.length === 0;
  const host = {
    under_load: input.underLoad === true,
    cpus: input.hostCpus ?? 0,
    load1: input.hostLoad ?? 0,
    avail_mb: input.hostAvailMb ?? 0,
  };
  const mode = typeof provenance?.mode === "string" ? provenance.mode : "unknown";
  const agentIsolated = provenance?.agent_isolated === true;
  // Always-publish policy: under_load stays advisory host metadata, never a
  // ranking input.
  const rankable = valid && gatePassed && mode === "agent" && agentIsolated;
  const trusted = rankable;
  const total = valid ? (gatePassed ? Math.round(metrics.raw * 10) / 10 : 0) : null;
  const usage = await extractUsage(join(artifacts, "session.json"));

  return {
    schema: 3,
    track,
    fixture_revision: Number.isInteger(provenance?.fixture_revision) ? provenance!.fixture_revision : FIXTURE_REVISION,
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
    adherence: { contract: adherence.score, classes: adherence.classes },
    ...metrics.evidence,
    ...(track !== "build" ? { churn_lines: changedLineCount(join(artifacts, "candidate.diff")) } : {}),
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
    candidate_contract: contractSnapshot(candidateContract),
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
    variant: env.VARIANT,
    track: env.BENCH_TRACK as BenchTrack | undefined,
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
