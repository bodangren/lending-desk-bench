/** Pure result-to-score arithmetic shared by scoring and live attestation. */
import { ADVISORY, CHANGE_CRITERIA, CRITERIA, PROBES, criterionWeight, type Criterion, type Tier } from "./tests/criteria.js";
import { PENALTY_FULL, type DoctorReport } from "./doctor.js";
import type { BugEntry } from "./bugfix/registry.js";
import { FIXTURE_REVISION } from "./revisions.js";

/** The criteria a record's own fixture revision states; later ones do not count. */
const statedUnder = (revision: number) => ([, criterion]: [string, Criterion]) => (criterion.since ?? 1) <= revision;

/**
 * Soft gate threshold. Higher tiers always contribute, but their weight is
 * scaled by how completely lower tiers pass:
 *
 *   scale(t) = min(1, rate(t) / TIER_GATE)
 *   weight_T1 = scale(T0)
 *   weight_T2 = scale(T0) * scale(T1)
 *
 * A hard binary unlock (weight 0 below 90%) collapsed every model that missed
 * two Tier-0 criteria into the same ~17-point pile and erased discrimination.
 * Soft scaling keeps the "don't bank polish without basics" incentive without
 * a dead zone. Tier rates count criteria; criterion weights apply only to the
 * earned sum, so a saturated criterion still gates like any other.
 */
export const TIER_GATE = 0.9;
/** Completion below this earns a proportionally reduced quality axis, not a copy of it. */
export const QUALITY_GATE = 0.6;

/**
 * Build-track axes (bench_v2 FR-9). Completion and the probes carry the product;
 * adherence grades the file contract and the Measure closeout; the quality axis
 * resolves only a few source signals, so it keeps a tenth.
 */
export const AXIS_WEIGHTS = { completion: 0.55, adversarial: 0.2, adherence: 0.15, quality: 0.1 };

/**
 * Bugfix track axes. Repair is the primary signal; regression and robustness
 * guard the rest of the application; quality is gated on repair so a candidate
 * that fixes nothing may not bank clean-code points.
 */
export const BUGFIX_AXIS_WEIGHTS = { repair: 0.45, regression: 0.2, robustness: 0.15, adherence: 0.1, quality: 0.1 };
export const BUGFIX_QUALITY_GATE = 0.6;
/** Security bugs weigh double in the repair sum (and security mutants in the kill sum). */
export const BUG_CLASS_WEIGHT: Record<string, number> = {
  functional: 1, security: 2, performance: 1, reliability: 1,
};

/** Change-request track axes (change_bench FR-5). */
export const CHANGE_AXIS_WEIGHTS = { change: 0.45, regression: 0.25, robustness: 0.1, adherence: 0.1, quality: 0.1 };
export const CHANGE_QUALITY_GATE = 0.6;

/** Test-writing track axes (tests_bench FR-5). */
export const TESTS_AXIS_WEIGHTS = { kill: 0.6, validity: 0.2, adherence: 0.1, quality: 0.1 };
export const TESTS_QUALITY_GATE = 0.6;

/**
 * Contract adherence. Each soft violation class the agent committed (an added
 * file, a protected edit, a changed export, ...) costs half the contract score.
 * Hard violations (symlinks, special entries) never reach scoring: they stay
 * invalid.
 */
export const SOFT_VIOLATION_COST = 0.5;
export function contractAdherence(softClasses: readonly string[]): number {
  return Math.max(0, 1 - SOFT_VIOLATION_COST * new Set(softClasses).size);
}

/**
 * Adherence is gated on the track's primary axis, like quality: an untouched
 * candidate breaks no rule, and without the gate it would bank adherence points
 * (up to 10 on the build track) for doing nothing.
 */
export const ADHERENCE_GATE = 0.6;
const gatedAdherence = (raw: number, primary: number) => raw * softTiercale(primary, ADHERENCE_GATE);

type TierReport = {
  rate: number;
  /** True when this tier receives full weight (lower rates all ≥ TIER_GATE). */
  unlocked: boolean;
  /** Always true under soft scaling — higher tiers still count proportionally. */
  counted: boolean;
  /** Multiplier applied to passes at this tier (0–1). */
  scale: number;
};

export type ScoreMetrics = {
  criteria: Record<string, boolean>;
  probes: Record<string, boolean>;
  advisory: Record<string, boolean>;
  tiers: Record<`${Tier}`, TierReport>;
  axes: {
    completion: number;
    adversarial: number;
    adherence: number;
    quality: number;
    weights: typeof AXIS_WEIGHTS;
  };
  raw: number;
};

/** Linear soft gate: full credit at rate ≥ gate, else rate/gate. */
export function softTiercale(rate: number, gate: number = TIER_GATE): number {
  if (gate <= 0) return 1;
  if (rate >= gate) return 1;
  if (rate <= 0) return 0;
  return rate / gate;
}

/**
 * Tier-scaled, weighted pass rate over one set of criteria.
 * Rates count criteria per tier; the earned sum and the denominator use weights.
 */
function tierScaled(entries: readonly [string, Criterion][], passed: Record<string, boolean>): {
  tiers: Record<`${Tier}`, TierReport>;
  scale: Record<Tier, number>;
  rate: number;
} {
  const byTier = (tier: Tier) => entries.filter(([, criterion]) => criterion.tier === tier);
  const rateAt = (tier: Tier) => {
    const atTier = byTier(tier);
    return atTier.length ? atTier.filter(([id]) => passed[id]).length / atTier.length : 1;
  };
  const rates: Record<Tier, number> = { 0: rateAt(0), 1: rateAt(1), 2: rateAt(2) };
  const scale: Record<Tier, number> = {
    0: 1,
    1: softTiercale(rates[0]),
    2: softTiercale(rates[0]) * softTiercale(rates[1]),
  };
  const tiers = {
    "0": { rate: rates[0], unlocked: true, counted: true, scale: scale[0] },
    "1": { rate: rates[1], unlocked: rates[0] >= TIER_GATE, counted: true, scale: scale[1] },
    "2": { rate: rates[2], unlocked: rates[0] >= TIER_GATE && rates[1] >= TIER_GATE, counted: true, scale: scale[2] },
  };
  const totalWeight = entries.reduce((sum, [, criterion]) => sum + criterionWeight(criterion), 0);
  const earned = entries.reduce(
    (sum, [id, criterion]) => sum + (passed[id] ? scale[criterion.tier] * criterionWeight(criterion) : 0),
    0,
  );
  return { tiers, scale, rate: totalWeight > 0 ? earned / totalWeight : 1 };
}

function snapshots(passed: Record<string, boolean>, criteriaIds: readonly string[]) {
  return {
    criteria: Object.fromEntries(criteriaIds.map((id) => [id, Boolean(passed[id])])),
    probes: Object.fromEntries(Object.keys(PROBES).map((id) => [id, Boolean(passed[id])])),
    advisory: Object.fromEntries(ADVISORY.map((id) => [id, Boolean(passed[id])])),
  };
}

const isAdherence = ([, criterion]: [string, Criterion]) => criterion.axis === "adherence";

export function deriveScoreMetrics(
  passed: Record<string, boolean>,
  doctorReport: DoctorReport,
  penalty: number,
  contract = 1,
  revision = FIXTURE_REVISION,
): ScoreMetrics {
  const { criteria, probes, advisory } = snapshots(passed, Object.keys(CRITERIA));
  const stated = Object.entries(CRITERIA).filter(statedUnder(revision));
  const product = stated.filter((entry) => !isAdherence(entry));
  const closeout = stated.filter(isAdherence);
  const { tiers, scale, rate: completion } = tierScaled(product, criteria);
  const probeEntries = Object.entries(PROBES);
  const adversarial = probeEntries.length
    ? probeEntries.reduce((sum, [id, probe]) => sum + (probes[id] ? scale[probe.tier] : 0), 0) / probeEntries.length
    : 0;
  // Process instructions: the file contract and the Measure closeout the task asks
  // for. Under r1 a contract violation discarded the whole run; now it costs here.
  const closeoutRate = closeout.length ? closeout.filter(([id]) => criteria[id]).length / closeout.length : 1;
  const adherence = gatedAdherence(0.5 * contract + 0.5 * closeoutRate, completion);
  // Gate the axis on completion instead of multiplying by it. The old form made
  // quality a scaled copy of completion, so one defect was charged on two axes, and
  // with a zero penalty in every run the axis carried no information of its own.
  // The gate keeps the original intent: a candidate that implemented almost nothing
  // may not collect clean-code points for the little it wrote.
  const quality = doctorReport.ok
    ? softTiercale(completion, QUALITY_GATE) * Math.max(0, 1 - penalty / PENALTY_FULL)
    : 0;
  const raw = 100 * (
    AXIS_WEIGHTS.completion * completion +
    AXIS_WEIGHTS.adversarial * adversarial +
    AXIS_WEIGHTS.adherence * adherence +
    AXIS_WEIGHTS.quality * quality
  );
  return {
    criteria,
    probes,
    advisory,
    tiers,
    axes: { completion, adversarial, adherence, quality, weights: AXIS_WEIGHTS },
    raw,
  };
}

/**
 * Regression over the build criteria that no seeded defect or change request
 * owns. Detector ids and declared collateral never enter the denominator, so
 * one defect is never charged twice. M.* closeout criteria grade the build
 * track's Measure files, which every variant replaces, so they never count.
 */
function regressionOver(passed: Record<string, boolean>, excluded: ReadonlySet<string>, revision: number) {
  const entries = Object.entries(CRITERIA)
    .filter(statedUnder(revision))
    .filter((entry) => !isAdherence(entry) && !excluded.has(entry[0]));
  return tierScaled(entries, passed);
}

function robustnessOver(probes: Record<string, boolean>, excluded: ReadonlySet<string>): number {
  const entries = Object.entries(PROBES).filter(([id]) => !excluded.has(id));
  return entries.length ? entries.filter(([id]) => probes[id]).length / entries.length : 1;
}

/**
 * Bugfix-track metrics. Detector ids and declared collateral never enter the
 * regression or robustness denominators, so one defect is never charged twice.
 * M.* closeout criteria grade the build track's Measure files, which the
 * bugfix variant replaces, so they are excluded entirely.
 */
export function deriveBugfixScoreMetrics(input: {
  passed: Record<string, boolean>;
  bugs: readonly BugEntry[];
  doctorReport: DoctorReport;
  penalty: number;
  contract?: number;
  revision?: number;
}): {
  criteria: Record<string, boolean>;
  probes: Record<string, boolean>;
  advisory: Record<string, boolean>;
  /** Top-level axes mirror `repair.axes` so record assembly is track-agnostic. */
  axes: BugfixAxes;
  repair: {
    axes: BugfixAxes;
    bugs: { id: string; class: string; repaired: boolean; detectors: readonly string[]; failed_detectors: readonly string[] }[];
    class_rates: Record<string, number>;
  };
  tiers: ScoreMetrics["tiers"];
  raw: number;
} {
  const { passed, bugs, doctorReport, penalty, contract = 1, revision = FIXTURE_REVISION } = input;
  const { criteria, probes, advisory } = snapshots(passed, Object.keys(CRITERIA));

  const bugOutcomes = bugs.map((entry) => {
    const failedDetectors = entry.detectors.filter((id) => !passed[id]);
    return {
      id: entry.id,
      class: entry.class,
      repaired: failedDetectors.length === 0,
      detectors: entry.detectors,
      failed_detectors: failedDetectors,
    };
  });
  const totalWeight = bugOutcomes.reduce((sum, bugOutcome) => sum + (BUG_CLASS_WEIGHT[bugOutcome.class] ?? 1), 0);
  const earnedWeight = bugOutcomes.reduce(
    (sum, bugOutcome) => sum + (bugOutcome.repaired ? BUG_CLASS_WEIGHT[bugOutcome.class] ?? 1 : 0),
    0,
  );
  // Vacuous pass: an empty bug set (clean-tree calibration) has nothing to repair.
  const repair = totalWeight > 0 ? earnedWeight / totalWeight : 1;

  const excluded = new Set<string>();
  for (const entry of bugs) {
    for (const id of entry.detectors) excluded.add(id);
    for (const id of entry.collateral) excluded.add(id);
  }
  const { tiers, rate: regression } = regressionOver(criteria, excluded, revision);
  const robustness = robustnessOver(probes, excluded);

  // Quality is gated on repair, not completion: a candidate that repairs
  // nothing may not collect clean-code points for the code it left behind.
  const quality = doctorReport.ok
    ? softTiercale(repair, BUGFIX_QUALITY_GATE) * Math.max(0, 1 - penalty / PENALTY_FULL)
    : 0;

  const classRates: Record<string, number> = {};
  for (const bugClass of ["functional", "security", "performance", "reliability"]) {
    const ofClass = bugOutcomes.filter((bugOutcome) => bugOutcome.class === bugClass);
    if (ofClass.length) {
      classRates[bugClass] = ofClass.filter((bugOutcome) => bugOutcome.repaired).length / ofClass.length;
    }
  }

  const adherence = gatedAdherence(contract, repair);
  const raw = 100 * (
    BUGFIX_AXIS_WEIGHTS.repair * repair +
    BUGFIX_AXIS_WEIGHTS.regression * regression +
    BUGFIX_AXIS_WEIGHTS.robustness * robustness +
    BUGFIX_AXIS_WEIGHTS.adherence * adherence +
    BUGFIX_AXIS_WEIGHTS.quality * quality
  );
  const axes = { repair, regression, robustness, adherence, quality, weights: BUGFIX_AXIS_WEIGHTS };
  return {
    criteria,
    probes,
    advisory,
    axes,
    repair: {
      axes,
      bugs: bugOutcomes,
      class_rates: classRates,
    },
    tiers,
    raw,
  };
}

type BugfixAxes = {
  repair: number;
  regression: number;
  robustness: number;
  adherence: number;
  quality: number;
  weights: typeof BUGFIX_AXIS_WEIGHTS;
};

/**
 * Change-track metrics. The change axis is the tier-scaled pass rate of the
 * active requests' X.* criteria; the build criteria and probes guard regression.
 * A request may declare build criteria it supersedes; they leave regression.
 */
export function deriveChangeScoreMetrics(input: {
  passed: Record<string, boolean>;
  changeIds: readonly string[];
  superseded?: readonly string[];
  doctorReport: DoctorReport;
  penalty: number;
  contract?: number;
  revision?: number;
}) {
  const { passed, changeIds, superseded = [], doctorReport, penalty, contract = 1, revision = FIXTURE_REVISION } = input;
  const { criteria, probes, advisory } = snapshots(passed, Object.keys(CRITERIA));
  const changeEntries = changeIds.map((id) => {
    const criterion = CHANGE_CRITERIA[id];
    if (!criterion) throw new Error(`unknown change criterion: ${id}`);
    return [id, criterion] as [string, Criterion];
  });
  const change_results = Object.fromEntries(changeIds.map((id) => [id, Boolean(passed[id])]));
  const { rate: change } = tierScaled(changeEntries, change_results);
  const excluded = new Set(superseded);
  const { tiers, rate: regression } = regressionOver(criteria, excluded, revision);
  const robustness = robustnessOver(probes, excluded);
  const quality = doctorReport.ok
    ? softTiercale(change, CHANGE_QUALITY_GATE) * Math.max(0, 1 - penalty / PENALTY_FULL)
    : 0;
  const adherence = gatedAdherence(contract, change);
  const requestRates: Record<string, number> = {};
  for (const [id] of changeEntries) {
    const cr = CHANGE_CRITERIA[id].cr;
    const ofRequest = changeIds.filter((other) => CHANGE_CRITERIA[other].cr === cr);
    requestRates[cr] = ofRequest.filter((other) => change_results[other]).length / ofRequest.length;
  }
  const raw = 100 * (
    CHANGE_AXIS_WEIGHTS.change * change +
    CHANGE_AXIS_WEIGHTS.regression * regression +
    CHANGE_AXIS_WEIGHTS.robustness * robustness +
    CHANGE_AXIS_WEIGHTS.adherence * adherence +
    CHANGE_AXIS_WEIGHTS.quality * quality
  );
  const axes = { change, regression, robustness, adherence, quality, weights: CHANGE_AXIS_WEIGHTS };
  return {
    criteria,
    probes,
    advisory,
    axes,
    change: { axes, results: change_results, request_rates: requestRates },
    tiers,
    raw,
  };
}

/**
 * Test-writing metrics. `kills` maps each mutant of the set to whether a valid
 * candidate test failed on it. Validity is the share of candidate tests that
 * passed on both correct applications; a suite with no test has validity 0.
 */
export function deriveTestsScoreMetrics(input: {
  kills: Record<string, boolean>;
  mutants: readonly { id: string; class: string }[];
  tests: { total: number; valid: number };
  doctorReport: DoctorReport;
  penalty: number;
  contract?: number;
}) {
  const { kills, mutants, tests, doctorReport, penalty, contract = 1 } = input;
  const outcomes = mutants.map((mutant) => ({ id: mutant.id, class: mutant.class, killed: Boolean(kills[mutant.id]) }));
  const totalWeight = outcomes.reduce((sum, outcome) => sum + (BUG_CLASS_WEIGHT[outcome.class] ?? 1), 0);
  const earned = outcomes.reduce((sum, outcome) => sum + (outcome.killed ? BUG_CLASS_WEIGHT[outcome.class] ?? 1 : 0), 0);
  const kill = totalWeight > 0 ? earned / totalWeight : 0;
  const validity = tests.total > 0 ? tests.valid / tests.total : 0;
  const quality = doctorReport.ok
    ? softTiercale(kill, TESTS_QUALITY_GATE) * Math.max(0, 1 - penalty / PENALTY_FULL)
    : 0;
  const adherence = gatedAdherence(contract, kill);
  const classRates: Record<string, number> = {};
  for (const mutantClass of ["functional", "security", "performance", "reliability"]) {
    const ofClass = outcomes.filter((outcome) => outcome.class === mutantClass);
    if (ofClass.length) classRates[mutantClass] = ofClass.filter((outcome) => outcome.killed).length / ofClass.length;
  }
  const raw = 100 * (
    TESTS_AXIS_WEIGHTS.kill * kill +
    TESTS_AXIS_WEIGHTS.validity * validity +
    TESTS_AXIS_WEIGHTS.adherence * adherence +
    TESTS_AXIS_WEIGHTS.quality * quality
  );
  const axes = { kill, validity, adherence, quality, weights: TESTS_AXIS_WEIGHTS };
  return {
    axes,
    mutation: { axes, mutants: outcomes, class_rates: classRates, tests },
    raw,
  };
}
