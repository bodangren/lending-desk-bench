/**
 * In-process scoring helpers for meta tests.
 * Prefer these over spawning `tsx score.ts` (cold start + full suite hash per case).
 */
import { resolve } from "node:path";
import { buildScoreRecord } from "../../score";
import { assessScoreFreshness } from "../../score-freshness";

export type ScoreJson = Record<string, unknown>;

export function applyEnv(environment: NodeJS.ProcessEnv): void {
  // Hermeticity (bench_v2 E2): the meta fixtures grade the build-track task.
  // The caller's ambient BENCH_TRACK must never reach the scoring pipeline
  // unless the fixture environment pins one explicitly; an unspecified track
  // falls back to build in score.ts.
  if (!Object.hasOwn(environment, "BENCH_TRACK")) {
    delete process.env.BENCH_TRACK;
  }
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/* process.env without BENCH_TRACK, for spawn environments: fixtures inherit the
 * build-track default, so an ambient non-build BENCH_TRACK (batch.sh exports it
 * for its own grading) must not leak into spawned grade.sh / summarize.sh. */
export function envWithoutTrack(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const { BENCH_TRACK: _leaked, ...inherited } = process.env;
  return { ...inherited, ...extra };
}

export async function scoreInProcess(input: {
  candidate: string;
  artifacts: string;
  runId: string;
  model: string;
  arm: "a" | "b";
  environment?: NodeJS.ProcessEnv;
  underLoad?: boolean;
}): Promise<ScoreJson> {
  if (input.environment) applyEnv(input.environment);
  return buildScoreRecord({
    candidate: input.candidate,
    artifacts: input.artifacts,
    runId: input.runId,
    model: input.model,
    arm: input.arm,
    underLoad: input.underLoad === true,
  });
}

export function freshnessInProcess(artifacts: string, environment: NodeJS.ProcessEnv = {}): ScoreJson {
  applyEnv(environment);
  return assessScoreFreshness(resolve(artifacts, "score.json")) as unknown as ScoreJson;
}
