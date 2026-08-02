import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { ADVISORY, CRITERIA, PROBES } from "../criteria";
import { createCurrentAgentRuntime, currentSchema4Provenance, type CurrentAgentRuntime } from "./schema4-fixtures";
import { scoreInProcess } from "./score-helpers";

const ROOT = resolve(import.meta.dirname, "../../..");
const HARNESS = resolve(ROOT, "harness");
const FIXTURE = resolve(ROOT, "fixture");
const MODEL = "meta/freshness";
const ARM = "a" as const;

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

function currentProvenance(candidate: string, mode: "agent" | "overlay" = "agent", runId = "meta-freshness", live?: CurrentAgentRuntime) {
  return currentSchema4Provenance({ fixture: FIXTURE, candidate, runId, model: MODEL, arm: ARM, mode, live });
}

async function score(candidate: string, artifacts: string, environment: NodeJS.ProcessEnv = {}, runId = "meta-freshness") {
  return scoreInProcess({
    candidate,
    artifacts,
    runId,
    model: MODEL,
    arm: ARM,
    environment: { ...process.env, ...environment },
  });
}

const declaredResults = () => Object.fromEntries(
  [...Object.keys(CRITERIA), ...Object.keys(PROBES), ...ADVISORY].map((id) => [id, false]),
);

describe("live publication freshness", () => {
  it("makes a quiet-host overlay calibration score valid but nonpublishable and non-rankable", async () => {
    const artifacts = mkdtempSync(resolve(tmpdir(), "lending-desk-overlay-score-"));
    const candidate = copyCandidate(artifacts);
    try {
      writeFileSync(resolve(artifacts, "gate.json"), '{"typecheck":true,"build":true}\n');
      writeFileSync(resolve(artifacts, "collection.json"), '{"valid":true,"status":"collected"}\n');
      writeFileSync(resolve(artifacts, "results.json"), `${JSON.stringify(declaredResults())}\n`);
      writeFileSync(resolve(artifacts, "provenance.json"), `${JSON.stringify(currentProvenance(candidate, "overlay"))}\n`);

      expect(await score(candidate, artifacts)).toMatchObject({
        valid: true,
        blocked_by_gate: false,
        trusted: false,
        publishable: false,
        rankable: false,
      });
    } finally {
      rmSync(artifacts, { recursive: true, force: true });
    }
  });

  it("makes a gate-blocked score nonpublishable and non-rankable even on a quiet host", async () => {
    const artifacts = mkdtempSync(resolve(tmpdir(), "lending-desk-gate-blocked-score-"));
    const candidate = copyCandidate(artifacts);
    const live = createCurrentAgentRuntime({ root: artifacts, arm: ARM, model: MODEL });
    try {
      writeFileSync(resolve(artifacts, "gate.json"), '{"typecheck":false,"build":false}\n');
      writeFileSync(resolve(artifacts, "collection.json"), '{"valid":true,"status":"blocked_by_gate"}\n');
      writeFileSync(resolve(artifacts, "provenance.json"), `${JSON.stringify(currentProvenance(candidate, "agent", "meta-freshness", live))}\n`);

      expect(await score(candidate, artifacts, live.environment)).toMatchObject({
        valid: true,
        blocked_by_gate: true,
        trusted: false,
        publishable: false,
        rankable: false,
        total: 0,
      });
    } finally {
      rmSync(artifacts, { recursive: true, force: true });
    }
  });

  it("summary rejects a forged trusted record when its live provenance is stale", () => {
    const work = mkdtempSync(resolve(ROOT, "runs", "meta-stale-publication-"));
    const runId = basename(work);
    const artifacts = resolve(work, "artifacts");
    const candidate = copyCandidate(work);
    const live = createCurrentAgentRuntime({ root: work, arm: ARM, model: MODEL });
    const provenance = currentProvenance(candidate, "agent", runId, live);
    provenance.suite_sha256 = "0".repeat(64);
    try {
      mkdirSync(artifacts);
      writeFileSync(resolve(artifacts, "gate.json"), '{"typecheck":true,"build":true}\n');
      writeFileSync(resolve(artifacts, "collection.json"), '{"valid":true,"status":"collected"}\n');
      writeFileSync(resolve(artifacts, "results.json"), `${JSON.stringify(declaredResults())}\n`);
      writeFileSync(resolve(artifacts, "provenance.json"), `${JSON.stringify(provenance)}\n`);
      writeFileSync(resolve(artifacts, "score.json"), JSON.stringify({
        schema: 2,
        valid: true,
        trusted: true,
        publishable: true,
        rankable: true,
        provenance_valid: true,
        suite_current: true,
        blocked_by_gate: false,
        invalid_reasons: [],
        model: MODEL,
        arm: ARM,
        total: 99,
        host: { under_load: false },
      }) + "\n");

      const result = spawnSync(resolve(HARNESS, "summarize.sh"), [], {
        cwd: HARNESS,
        encoding: "utf8",
        env: { ...process.env, ...live.environment },
      });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout).toMatch(new RegExp(`${runId}\\s+${MODEL}\\s+STALE-PROVENANCE`));
      expect(result.stdout).not.toContain(`(${runId})`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  it("routes batch resumption and summary classification through one live score-freshness check", () => {
    const batch = readFileSync(resolve(HARNESS, "batch.sh"), "utf8");
    const summary = readFileSync(resolve(HARNESS, "summarize.sh"), "utf8");
    expect(batch).toMatch(/score-freshness\.ts/);
    expect(summary).toMatch(/score-freshness\.ts/);
    // No silent "any score is fine" override — only trusted freshness may skip.
    expect(batch).not.toMatch(/RESUME_ANY_SCORE/);
  });
});
