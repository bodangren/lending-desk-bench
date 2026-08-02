/**
 * In-process scoring helpers for meta tests.
 * Prefer these over spawning `tsx score.ts` (cold start + full suite hash per case).
 */
import { resolve } from "node:path";
import { buildScoreRecord } from "../../score";
import { assessScoreFreshness } from "../../score-freshness";

export type ScoreJson = Record<string, unknown>;

export function applyEnv(environment: NodeJS.ProcessEnv): void {
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
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
