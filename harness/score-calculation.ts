/** Pure result-to-score arithmetic shared by scoring and live attestation. */
import { ADVISORY, CRITERIA, PROBES, type Tier } from "./tests/criteria.js";
import { PENALTY_FULL, type DoctorReport } from "./doctor.js";

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
 * a dead zone.
 */
export const TIER_GATE = 0.9;
/** Completion below this earns a proportionally reduced quality axis, not a copy of it. */
export const QUALITY_GATE = 0.6;
export const AXIS_WEIGHTS = { completion: 0.6, adversarial: 0.2, quality: 0.2 };

export type ScoreMetrics = {
  criteria: Record<string, boolean>;
  probes: Record<string, boolean>;
  advisory: Record<string, boolean>;
  tiers: Record<`${Tier}`, {
    rate: number;
    /** True when this tier receives full weight (lower rates all ≥ TIER_GATE). */
    unlocked: boolean;
    /** Always true under soft scaling — higher tiers still count proportionally. */
    counted: boolean;
    /** Multiplier applied to passes at this tier (0–1). */
    scale: number;
  }>;
  axes: { completion: number; adversarial: number; quality: number; weights: typeof AXIS_WEIGHTS };
  raw: number;
};

/** Linear soft gate: full credit at rate ≥ gate, else rate/gate. */
export function softTiercale(rate: number, gate: number = TIER_GATE): number {
  if (gate <= 0) return 1;
  if (rate >= gate) return 1;
  if (rate <= 0) return 0;
  return rate / gate;
}

export function deriveScoreMetrics(
  passed: Record<string, boolean>,
  doctorReport: DoctorReport,
  penalty: number,
): ScoreMetrics {
  const criteria = Object.fromEntries(Object.keys(CRITERIA).map((id) => [id, Boolean(passed[id])]));
  const probes = Object.fromEntries(Object.keys(PROBES).map((id) => [id, Boolean(passed[id])]));
  const advisory = Object.fromEntries(ADVISORY.map((id) => [id, Boolean(passed[id])]));
  const byTier = (tier: Tier) => Object.entries(CRITERIA).filter(([, criterion]) => criterion.tier === tier);
  const rate = (tier: Tier) => {
    const criteriaAtTier = byTier(tier);
    return criteriaAtTier.length ? criteriaAtTier.filter(([id]) => criteria[id]).length / criteriaAtTier.length : 1;
  };
  const rates: Record<Tier, number> = { 0: rate(0), 1: rate(1), 2: rate(2) };
  const scale: Record<Tier, number> = {
    0: 1,
    1: softTiercale(rates[0]),
    2: softTiercale(rates[0]) * softTiercale(rates[1]),
  };
  const unlocked: Record<Tier, boolean> = {
    0: true,
    1: rates[0] >= TIER_GATE,
    2: rates[0] >= TIER_GATE && rates[1] >= TIER_GATE,
  };
  const tiers = {
    "0": { rate: rates[0], unlocked: true, counted: true, scale: scale[0] },
    "1": { rate: rates[1], unlocked: unlocked[1], counted: true, scale: scale[1] },
    "2": { rate: rates[2], unlocked: unlocked[2], counted: true, scale: scale[2] },
  };
  // Fractional earned: each passed criterion contributes its tier's scale.
  const earned = ([0, 1, 2] as Tier[]).reduce(
    (sum, tier) => sum + scale[tier] * byTier(tier).filter(([id]) => criteria[id]).length,
    0,
  );
  const completion = earned / Object.keys(CRITERIA).length;
  const probeEntries = Object.entries(PROBES);
  const adversarial = probeEntries.length
    ? probeEntries.reduce((sum, [id, probe]) => sum + (probes[id] ? scale[probe.tier] : 0), 0) / probeEntries.length
    : 0;
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
    AXIS_WEIGHTS.quality * quality
  );
  return {
    criteria,
    probes,
    advisory,
    tiers,
    axes: { completion, adversarial, quality, weights: AXIS_WEIGHTS },
    raw,
  };
}
