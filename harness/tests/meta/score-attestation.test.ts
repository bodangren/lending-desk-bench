import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ADVISORY, CRITERIA, PROBES } from "../criteria";
import { createCurrentAgentRuntime, currentSchema4Provenance } from "./schema4-fixtures";
import { freshnessInProcess, scoreInProcess, type ScoreJson } from "./score-helpers";

const ROOT = resolve(import.meta.dirname, "../../..");
const FIXTURE = resolve(ROOT, "fixture");
const MODEL = "meta/score-attestation";
const ARM = "a" as const;

type Json = Record<string, unknown>;

type PreparedRun = {
  work: string;
  runId: string;
  artifacts: string;
  score: Json;
  environment: NodeJS.ProcessEnv;
};

function copyCandidate(parent: string): string {
  const candidate = resolve(parent, "candidate");
  cpSync(FIXTURE, candidate, {
    recursive: true,
    filter: (source) => {
      const name = basename(source);
      return ![".git", "node_modules", ".next"].includes(name) && !source.endsWith(".tsbuildinfo");
    },
  });
  return candidate;
}

function allResults(value = false): Json {
  return Object.fromEntries(
    [...Object.keys(CRITERIA), ...Object.keys(PROBES), ...ADVISORY].map((id) => [id, value]),
  );
}

async function score(candidate: string, artifacts: string, runId: string, environment: NodeJS.ProcessEnv = {}): Promise<ScoreJson> {
  return scoreInProcess({ candidate, artifacts, runId, model: MODEL, arm: ARM, environment });
}

function freshness(artifacts: string, environment: NodeJS.ProcessEnv = {}): ScoreJson {
  return freshnessInProcess(artifacts, environment);
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

async function prepareRun(): Promise<PreparedRun> {
  const work = mkdtempSync(resolve(ROOT, "runs", "meta-score-attestation-"));
  const runId = basename(work);
  const artifacts = resolve(work, "artifacts");
  const candidate = copyCandidate(work);
  const live = createCurrentAgentRuntime({ root: work, arm: ARM, model: MODEL });
  mkdirSync(artifacts);
  writeJson(resolve(artifacts, "gate.json"), { typecheck: true, build: true });
  writeJson(resolve(artifacts, "collection.json"), { valid: true, status: "collected" });
  writeJson(resolve(artifacts, "results.json"), allResults());
  writeJson(
    resolve(artifacts, "provenance.json"),
    currentSchema4Provenance({ fixture: FIXTURE, candidate, runId, model: MODEL, arm: ARM, live }),
  );
  const record = await score(candidate, artifacts, runId, live.environment);
  writeJson(resolve(artifacts, "score.json"), record);
  return { work, runId, artifacts, score: record, environment: live.environment };
}

function expectAttestationRejected(artifacts: string, environment: NodeJS.ProcessEnv): void {
  expect(freshness(artifacts, environment)).toMatchObject({
    state: "INVALID",
    rankable: false,
    score_current: false,
  });
}

describe("live score-record attestation", () => {
  it("uses a complete schema-2 score fixture with matching run, provenance, and raw results", async () => {
    const run = await prepareRun();
    try {
      expect(run.score).toMatchObject({
        schema: 2,
        valid: true,
        trusted: true,
        publishable: true,
        rankable: true,
        run_id: run.runId,
        host: { under_load: false },
        candidate_contract: { schema: 1, valid: true },
      });
      expect(run.score.provenance).toMatchObject({ schema: 4, run_id: run.runId, model: MODEL, arm: ARM });
      expect(run.score.criteria).toEqual(Object.fromEntries(Object.keys(CRITERIA).map((id) => [id, false])));
      expect(run.score.probes).toEqual(Object.fromEntries(Object.keys(PROBES).map((id) => [id, false])));
      expect(run.score.advisory).toEqual(Object.fromEntries(ADVISORY.map((id) => [id, false])));
    } finally {
      rmSync(run.work, { recursive: true, force: true });
    }
  });

  it("preserves a genuine gate-failed score as current GATE-BLOCKED evidence without results.json", async () => {
    const work = mkdtempSync(resolve(ROOT, "runs", "meta-score-gate-blocked-"));
    const runId = basename(work);
    const artifacts = resolve(work, "artifacts");
    const candidate = copyCandidate(work);
    const live = createCurrentAgentRuntime({ root: work, arm: ARM, model: MODEL });
    try {
      mkdirSync(artifacts);
      writeJson(resolve(artifacts, "gate.json"), { typecheck: false, build: true });
      writeJson(resolve(artifacts, "collection.json"), { valid: true, status: "blocked_by_gate" });
      writeJson(
        resolve(artifacts, "provenance.json"),
        currentSchema4Provenance({ fixture: FIXTURE, candidate, runId, model: MODEL, arm: ARM, live }),
      );

      const record = await score(candidate, artifacts, runId, live.environment);
      writeJson(resolve(artifacts, "score.json"), record);

      expect(record).toMatchObject({
        schema: 2,
        valid: true,
        blocked_by_gate: true,
        rankable: false,
        gate: { typecheck: false, build: true, passed: false },
        missing_criteria: [],
        orphan_results: [],
        total: 0,
      });
      expect(freshness(artifacts, live.environment)).toMatchObject({
        state: "GATE-BLOCKED",
        rankable: false,
        candidate_contract_valid: true,
        provenance_current: true,
        score_current: true,
        host_trusted: true,
        gate_passed: false,
        collection_current: true,
      });
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  it("recomputes result-derived criteria, tiers, axes, and total instead of trusting score.json", async () => {
    const run = await prepareRun();
    try {
      writeJson(resolve(run.artifacts, "score.json"), {
        ...run.score,
        total: 100,
        criteria: Object.fromEntries(Object.keys(CRITERIA).map((id) => [id, true])),
        probes: Object.fromEntries(Object.keys(PROBES).map((id) => [id, true])),
        advisory: Object.fromEntries(ADVISORY.map((id) => [id, true])),
        tiers: {
          "0": { rate: 1, unlocked: true, counted: true },
          "1": { rate: 1, unlocked: true, counted: true },
          "2": { rate: 1, unlocked: true, counted: true },
        },
        axes: {
          completion: 1,
          adversarial: 1,
          quality: 1,
          weights: { completion: 0.6, adversarial: 0.2, quality: 0.2 },
        },
      });
      expectAttestationRejected(run.artifacts, run.environment);
    } finally {
      rmSync(run.work, { recursive: true, force: true });
    }
  });

  it("rejects a score record with a non-schema-2 payload", async () => {
    const run = await prepareRun();
    try {
      writeJson(resolve(run.artifacts, "score.json"), { ...run.score, schema: 1 });
      expectAttestationRejected(run.artifacts, run.environment);
    } finally {
      rmSync(run.work, { recursive: true, force: true });
    }
  });

  it("rejects a score record whose declared run ID differs from its directory", async () => {
    const run = await prepareRun();
    try {
      writeJson(resolve(run.artifacts, "score.json"), { ...run.score, run_id: "other-run" });
      expectAttestationRejected(run.artifacts, run.environment);
    } finally {
      rmSync(run.work, { recursive: true, force: true });
    }
  });

  it("requires results.json to be present", async () => {
    const run = await prepareRun();
    try {
      rmSync(resolve(run.artifacts, "results.json"));
      expectAttestationRejected(run.artifacts, run.environment);
    } finally {
      rmSync(run.work, { recursive: true, force: true });
    }
  });

  it("requires results.json to be complete for the declared suite", async () => {
    const run = await prepareRun();
    try {
      const incomplete = allResults();
      delete incomplete[Object.keys(CRITERIA)[0]];
      writeJson(resolve(run.artifacts, "results.json"), incomplete);
      expectAttestationRejected(run.artifacts, run.environment);
    } finally {
      rmSync(run.work, { recursive: true, force: true });
    }
  });

  it("binds the score's provenance snapshot to the run artifacts", async () => {
    const run = await prepareRun();
    try {
      writeJson(resolve(run.artifacts, "score.json"), {
        ...run.score,
        provenance: { ...(run.score.provenance as Json), run_id: "other-run" },
      });
      expectAttestationRejected(run.artifacts, run.environment);
    } finally {
      rmSync(run.work, { recursive: true, force: true });
    }
  });

  it("binds the score's candidate-contract snapshot to the run artifacts", async () => {
    const run = await prepareRun();
    try {
      writeJson(resolve(run.artifacts, "score.json"), {
        ...run.score,
        candidate_contract: {
          ...(run.score.candidate_contract as Json),
          candidate_sha256: "0".repeat(64),
        },
      });
      expectAttestationRejected(run.artifacts, run.environment);
    } finally {
      rmSync(run.work, { recursive: true, force: true });
    }
  });

  it.each([
    ["missing", {}],
    ["true", { under_load: true }],
    ["non-boolean", { under_load: "false" }],
  ])("requires boolean false host evidence before a score can be rankable (%s)", async (_name, host) => {
    const run = await prepareRun();
    try {
      writeJson(resolve(run.artifacts, "score.json"), { ...run.score, host });
      expect(freshness(run.artifacts, run.environment)).toMatchObject({
        host_trusted: false,
        rankable: false,
      });
    } finally {
      rmSync(run.work, { recursive: true, force: true });
    }
  });
});
