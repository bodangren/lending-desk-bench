/**
 * Per-track scoring inputs, shared by score.ts (which writes a record) and
 * score-attestation.ts (which re-derives it from the artifacts). Keeping one
 * implementation is the point: two copies of the declared-id rules or the
 * adherence rule would let freshness disagree with production scoring.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BenchTrack, CandidateContract, SoftViolation } from "./candidate-contract.js";
import type { DoctorReport } from "./doctor.js";
import { ADVISORY, CRITERIA, PROBES } from "./tests/criteria.js";
import { loadSet, setBugs, validateSet } from "./bugfix/set-loader.js";
import type { BugEntry } from "./bugfix/registry.js";
import { FIXTURE_REVISION } from "./revisions.js";
import { loadChangeSet, setChangeCriteria, setSuperseded, validateChangeSet } from "./change/requests.js";
import { loadMutantSet, setMutants, validateMutantSet } from "./tests-track/set-loader.js";
import {
  contractAdherence,
  deriveBugfixScoreMetrics,
  deriveChangeScoreMetrics,
  deriveScoreMetrics,
  deriveTestsScoreMetrics,
} from "./score-calculation.js";

/** Criteria that grade the build track's Measure files, which every variant replaces. */
const CLOSEOUT_IDS = new Set(Object.entries(CRITERIA).filter(([, c]) => c.axis === "adherence").map(([id]) => id));

/** Result id of one mutant on the tests track: true when a valid candidate test killed it. */
export const killId = (mutantId: string) => `K.${mutantId}`;

export type TrackContext =
  | { track: "build" }
  | { track: "bugfix"; bugs: BugEntry[] }
  | { track: "change"; changeIds: string[]; superseded: string[] }
  | { track: "tests"; mutants: { id: string; class: string }[]; tests: { total: number; valid: number } };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Load the frozen set (and, for tests, the per-test summary) from a run's artifacts. */
export function loadTrackContext(track: BenchTrack, artifacts: string): { context?: TrackContext; reasons: string[] } {
  try {
    if (track === "bugfix") {
      const path = join(artifacts, "bug-set.json");
      if (!existsSync(path)) throw new Error("missing bug-set file");
      const set = loadSet(path);
      const reasons = validateSet(set);
      if (reasons.length) throw new Error(`invalid bug set: ${reasons.join("; ")}`);
      return { context: { track, bugs: setBugs(set) }, reasons: [] };
    }
    if (track === "change") {
      const path = join(artifacts, "change-set.json");
      if (!existsSync(path)) throw new Error("missing change-set file");
      const set = loadChangeSet(path);
      const reasons = validateChangeSet(set);
      if (reasons.length) throw new Error(`invalid change set: ${reasons.join("; ")}`);
      return { context: { track, changeIds: setChangeCriteria(set), superseded: setSuperseded(set) }, reasons: [] };
    }
    if (track === "tests") {
      const path = join(artifacts, "mutant-set.json");
      if (!existsSync(path)) throw new Error("missing mutant-set file");
      const set = loadMutantSet(path);
      const reasons = validateMutantSet(set);
      if (reasons.length) throw new Error(`invalid mutant set: ${reasons.join("; ")}`);
      const mutants = setMutants(set).map((mutant) => ({ id: mutant.id, class: mutant.class }));
      return { context: { track, mutants, tests: readTestsSummary(artifacts) }, reasons: [] };
    }
    return { context: { track: "build" }, reasons: [] };
  } catch (error) {
    return { reasons: [error instanceof Error ? error.message : String(error)] };
  }
}

/** Valid and total test counts from grade-tests.ts; 0/0 when the gate blocked the suites. */
export function readTestsSummary(artifacts: string): { total: number; valid: number } {
  const path = join(artifacts, "tests-results.json");
  if (!existsSync(path)) return { total: 0, valid: 0 };
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(value) || !isRecord(value.summary)) throw new Error("tests-results.json lacks a summary");
  const { total, valid } = value.summary as Record<string, unknown>;
  if (!Number.isInteger(total) || !Number.isInteger(valid) || (valid as number) > (total as number) || (valid as number) < 0) {
    throw new Error("tests-results.json summary is malformed");
  }
  return { total: total as number, valid: valid as number };
}

/** Every result id the track's suites must collect, sorted. */
export function declaredIds(context: TrackContext): string[] {
  const product = Object.keys(CRITERIA).filter((id) => !CLOSEOUT_IDS.has(id));
  switch (context.track) {
    case "build":
      return [...Object.keys(CRITERIA), ...Object.keys(PROBES), ...ADVISORY].sort();
    case "bugfix":
      return [...product, ...Object.keys(PROBES), ...ADVISORY].sort();
    case "change":
      return [...product, ...Object.keys(PROBES), ...ADVISORY, ...context.changeIds].sort();
    case "tests":
      return context.mutants.map((mutant) => killId(mutant.id)).sort();
  }
}

export type TrackMetrics = {
  criteria: Record<string, boolean>;
  probes: Record<string, boolean>;
  advisory: Record<string, boolean>;
  tiers: Record<string, unknown>;
  axes: Record<string, unknown>;
  raw: number;
  /** Track evidence written beside the axes: repair, change, or mutation. */
  evidence: Record<string, unknown>;
  /** The axis the quality gate and the doctor scan depend on. */
  primary: number;
};

/**
 * `revision` is the fixture revision the agent saw (provenance.fixture_revision):
 * criteria that a later revision's spec introduced do not count for that record.
 */
export function trackMetrics(
  context: TrackContext,
  passed: Record<string, boolean>,
  doctorReport: DoctorReport,
  penalty: number,
  contract: number,
  revision: number,
): TrackMetrics {
  switch (context.track) {
    case "build": {
      const metrics = deriveScoreMetrics(passed, doctorReport, penalty, contract, revision);
      return { ...metrics, evidence: {}, primary: metrics.axes.completion };
    }
    case "bugfix": {
      const metrics = deriveBugfixScoreMetrics({ passed, bugs: context.bugs, doctorReport, penalty, contract, revision });
      return { ...metrics, evidence: { repair: metrics.repair }, primary: metrics.axes.repair };
    }
    case "change": {
      const metrics = deriveChangeScoreMetrics({
        passed, changeIds: context.changeIds, superseded: context.superseded, doctorReport, penalty, contract, revision,
      });
      return { ...metrics, evidence: { change: metrics.change }, primary: metrics.axes.change };
    }
    case "tests": {
      const kills = Object.fromEntries(context.mutants.map((mutant) => [mutant.id, passed[killId(mutant.id)] === true]));
      const metrics = deriveTestsScoreMetrics({
        kills, mutants: context.mutants, tests: context.tests, doctorReport, penalty, contract,
      });
      return {
        criteria: {}, probes: {}, advisory: {}, tiers: {},
        axes: metrics.axes, raw: metrics.raw,
        evidence: { mutation: metrics.mutation }, primary: metrics.axes.kill,
      };
    }
  }
}

/**
 * Contract adherence for scoring. contract-violation.json records the soft
 * classes of the agent's original tree before run.sh grafted it; a clean run has
 * no such file, and then the graded tree's own soft classes (a changed export or
 * a suppression inside a writable file) count. Provenance binds the file's hash,
 * so deleting it cannot raise the score.
 */
export function contractScore(
  artifacts: string,
  contract: CandidateContract,
  provenance: Record<string, unknown> | undefined,
): { score: number; classes: string[]; reasons: string[] } {
  const path = join(artifacts, "contract-violation.json");
  const reasons: string[] = [];
  let classes: string[] = [...contract.soft];
  if (existsSync(path)) {
    const bytes = readFileSync(path);
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (provenance && provenance.contract_violation_sha256 !== sha) {
      reasons.push("contract-violation.json does not match provenance");
    }
    try {
      const value: unknown = JSON.parse(bytes.toString("utf8"));
      if (!isRecord(value) || !Array.isArray(value.soft)) throw new Error("no soft class list");
      classes = [...new Set([...(value.soft as SoftViolation[]), ...contract.soft])].sort();
    } catch (error) {
      reasons.push(`contract-violation.json is malformed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (provenance && provenance.contract_violation_sha256 !== null) {
    reasons.push("provenance names a contract violation record that is missing");
  }
  return { score: contractAdherence(classes), classes, reasons };
}

/** The fixture revision a record is scored under: the one its agent saw. */
export function recordRevision(provenance: Record<string, unknown> | undefined): number {
  const revision = provenance?.fixture_revision;
  return Number.isInteger(revision) && (revision as number) >= 1 && (revision as number) <= FIXTURE_REVISION
    ? (revision as number)
    : FIXTURE_REVISION;
}
