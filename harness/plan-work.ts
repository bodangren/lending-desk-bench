/**
 * Work-list selector for the incremental weekly batch (bench_incremental).
 *
 * Enumerates every batch model (the `go-pricing.json` entries listed by
 * go-cost.ts --batch-lines) for each track and arm, then classifies it from
 * the runs/ tree:
 *
 * - new      — no agent run for the track and arm
 * - failing  — agent runs exist, but fewer TRUSTED rankable runs than the
 *              track's repeat count
 * - current  — the TRUSTED rankable run count reaches the track repeat count
 *              (REPS_BUILD default 3, other tracks 1; a bare REPS overrides
 *              every track, matching batch.sh)
 *
 * A run counts as trusted only when score-freshness.ts assessScoreFreshness
 * returns TRUSTED and rankable under the current runner and suite hashes.
 * Freshness attests the run's recorded executor against the run's own
 * artifact snapshots only (FR-6); no live executor environment is staged,
 * so the classification cannot change with any ambient BENCH_* value, HOME,
 * or PATH. Model identity comes only from each run's
 * provenance.json (model, arm, track) — never from the run-ID shape — so
 * canary, calibration, control, and adhoc runs never enter the work list.
 *
 * The selector is read-only over runs/ (FR-6): it schedules, it never edits
 * score.json, provenance, or freshness results. It is hermetic (A11/NFR-1):
 * stdout depends only on the runs tree, the pricing table, and harness
 * hashes; BENCH_TRACK and the rest of the caller environment never change it.
 * plan-work.ts stays outside the provenance hash lists, alongside batch.sh,
 * weekly.sh, and recost.sh, so scheduling changes cannot invalidate grades.
 *
 * CLI:
 *   plan-work.ts --all                              full classification matrix
 *   plan-work.ts --work-list <track>                new+failing rows for one track
 *   plan-work.ts --batch-lines [--pricing <path>]   pricing menu via go-cost.ts
 *   plan-work.ts --all --runs-root <dir> --pricing <path>
 *
 * BENCH_RUNS_ROOT / BENCH_PRICING_PATH provide the same defaults as the flags.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { batchLines, loadPricing, resolveGoModelId } from "./go-cost.js";
import { assessScoreFreshness } from "./score-freshness.js";
import { BENCH_TRACKS, type BenchTrack } from "./candidate-contract.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_RUNS_ROOT = resolve(HERE, "..", "runs");
const DEFAULT_PRICING_PATH = resolve(HERE, "go-pricing.json");
const ARMS = ["a", "b"] as const;
const DEFAULT_REPS: Record<BenchTrack, number> = { build: 3, bugfix: 1, tests: 1, change: 1 };

type Arm = (typeof ARMS)[number];
type WorkClass = "new" | "failing" | "current";
type Json = Record<string, unknown>;

type WorkRow = {
  track: BenchTrack;
  arm: Arm;
  model: string;
  class: WorkClass;
  trusted_count: number;
  reason: string;
};

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(path: string): { value?: Json; error?: string } {
  if (!existsSync(path)) return { error: "no provenance.json" };
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(value) ? { value } : { error: "provenance.json is not an object" };
  } catch (error) {
    return { error: `malformed provenance.json: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Track repeat count: bare REPS overrides every track, then REPS_<TRACK>, then defaults. */
function repsFor(track: BenchTrack): number {
  const raw = process.env.REPS ?? process.env[`REPS_${track.toUpperCase()}`];
  if (raw === undefined) return DEFAULT_REPS[track];
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 9) {
    throw new Error(`repeat count for ${track} must be an integer from 1 to 9 (got "${raw}")`);
  }
  return parsed;
}

type RunStats = { runs: number; trusted: number };

/**
 * Count agent runs and TRUSTED rankable runs per track/arm/model over the
 * runs tree. Identity is read from provenance.json only: the recorded model
 * resolves to a pricing-table id with go-cost.ts resolveGoModelId (the same
 * mapping recost uses — runs record `provider/model`, the table keys bare
 * ids). Runs whose provenance names a model outside the batch table, an
 * unknown arm, or an unknown track (canary, calibration, control, adhoc) are
 * never counted.
 */
function scanRuns(
  runsRoot: string,
  pricing: ReturnType<typeof loadPricing>["pricing"],
  batchModelIds: ReadonlySet<string>,
  warnings: string[],
): Map<string, RunStats> {
  const counts = new Map<string, RunStats>();
  if (!existsSync(runsRoot)) throw new Error(`runs root is missing: ${runsRoot}`);
  for (const entry of readdirSync(runsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const artifacts = resolve(runsRoot, entry.name, "artifacts");
    const read = readJson(resolve(artifacts, "provenance.json"));
    if (!read.value) {
      warnings.push(`${entry.name}: ${read.error}`);
      continue;
    }
    const provenance = read.value;
    // FR-8: the score series comes from the executor kind in the provenance
    // record. A legacy Pi run stays out of the work list and out of the
    // ranking. The run ID never decides the series.
    const executor = provenance.executor;
    const kind = isRecord(executor) ? executor.kind : undefined;
    if (kind !== "opencode") continue;
    const model = resolveGoModelId(
      typeof provenance.model === "string" ? provenance.model : undefined,
      pricing,
    );
    const arm = provenance.arm === "a" || provenance.arm === "b" ? (provenance.arm as Arm) : undefined;
    const track = BENCH_TRACKS.includes(provenance.track as BenchTrack) ? (provenance.track as BenchTrack) : undefined;
    if (!model || !arm || !track || !batchModelIds.has(model)) continue;

    const key = `${track}|${arm}|${model}`;
    const stats = counts.get(key) ?? { runs: 0, trusted: 0 };
    stats.runs += 1;
    const scorePath = resolve(artifacts, "score.json");
    if (existsSync(scorePath)) {
      const trusted = assessScoreFreshness(scorePath);
      if (trusted.state === "TRUSTED" && trusted.rankable) stats.trusted += 1;
    }
    counts.set(key, stats);
  }
  return counts;
}

function classify(
  loaded: ReturnType<typeof loadPricing>,
  runsRoot: string,
  warnings: string[],
): WorkRow[] {
  const lines = batchLines(loaded.pricing);
  const batchModelIds = new Set(lines.map((line) => line.split("|")[1]));
  const counts = scanRuns(runsRoot, loaded.pricing, batchModelIds, warnings);
  const rows: WorkRow[] = [];
  for (const track of BENCH_TRACKS) {
    const reps = repsFor(track);
    for (const arm of ARMS) {
      for (const line of lines) {
        const model = line.split("|")[1];
        const stats = counts.get(`${track}|${arm}|${model}`) ?? { runs: 0, trusted: 0 };
        let workClass: WorkClass;
        let reason: string;
        if (stats.runs === 0) {
          workClass = "new";
          reason = `no agent run for ${track}/${arm}`;
        } else if (stats.trusted >= reps) {
          workClass = "current";
          reason = `trusted-run count ${stats.trusted} reaches the ${track} repeat count ${reps}`;
        } else {
          workClass = "failing";
          reason = `trusted-run count ${stats.trusted} is below the ${track} repeat count ${reps} over ${stats.runs} agent run(s) at the current hashes`;
        }
        rows.push({ track, arm, model, class: workClass, trusted_count: stats.trusted, reason });
      }
    }
  }
  return rows;
}

function emit(rows: WorkRow[], runsRoot: string, pricingSha256: string): void {
  const payload = {
    schema: 1,
    runs_root: runsRoot,
    pricing_sha256: pricingSha256,
    classifications: rows,
  };
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
}

function usage(): never {
  throw new Error("usage: plan-work.ts (--all | --work-list <track> | --batch-lines) [--runs-root <dir>] [--pricing <path>]");
}

function main(argv: readonly string[]): void {
  let mode: "all" | "work-list" | "batch-lines" | undefined;
  let track: string | undefined;
  let runsRoot = process.env.BENCH_RUNS_ROOT ? resolve(process.env.BENCH_RUNS_ROOT) : DEFAULT_RUNS_ROOT;
  let pricingPath = process.env.BENCH_PRICING_PATH ? resolve(process.env.BENCH_PRICING_PATH) : DEFAULT_PRICING_PATH;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--all") mode = "all";
    else if (arg === "--work-list") {
      mode = "work-list";
      if (!value) usage();
      track = value;
      index += 1;
    } else if (arg === "--batch-lines") mode = "batch-lines";
    else if (arg === "--runs-root") {
      if (!value) usage();
      runsRoot = resolve(value);
      index += 1;
    } else if (arg === "--pricing") {
      if (!value) usage();
      pricingPath = resolve(value);
      index += 1;
    } else usage();
  }
  if (!mode) usage();
  const loaded = loadPricing(pricingPath);
  if (mode === "batch-lines") {
    // Same lines as `go-cost.ts --batch-lines`, honoring --pricing so a batch
    // dry run can exercise a synthetic table without editing go-cost.ts.
    for (const line of batchLines(loaded.pricing)) console.log(line);
    return;
  }
  if (mode === "work-list") {
    if (!track || !BENCH_TRACKS.includes(track as BenchTrack)) {
      throw new Error(`--work-list track must be one of: ${BENCH_TRACKS.join(", ")}`);
    }
  }
  const warnings: string[] = [];
  let rows = classify(loaded, runsRoot, warnings);
  if (mode === "work-list") {
    rows = rows.filter((row) => row.track === track && (row.class === "new" || row.class === "failing"));
  }
  emit(rows, runsRoot, loaded.sha256);
  const summary = (classes: readonly WorkClass[]) =>
    classes.map((workClass) => `${workClass} ${rows.filter((row) => row.class === workClass).length}`).join(", ");
  for (const warning of warnings) console.error(`plan-work: ${warning}`);
  console.error(`plan-work: ${rows.length} row(s) over ${BENCH_TRACKS.length} track(s) — ${summary(["new", "failing", "current"])}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
