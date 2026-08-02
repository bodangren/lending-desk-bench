import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createCurrentAgentRuntime, currentSchema4Provenance, type CurrentAgentRuntime } from "./schema4-fixtures";

const ROOT = resolve(import.meta.dirname, "../../..");
const HARNESS = resolve(ROOT, "harness");
const FIXTURE = resolve(ROOT, "fixture");
const MODEL = "meta/grade-exit";
const ARM = "b";

function setupCandidate(runIdPrefix: string) {
  const work = mkdtempSync(resolve(ROOT, "runs", runIdPrefix));
  const candidate = resolve(work, "candidate");
  cpSync(FIXTURE, candidate, {
    recursive: true,
    filter: (source) => ![".git", "node_modules", ".next"].includes(basename(source)) && !source.endsWith(".tsbuildinfo"),
  });
  symlinkSync(resolve(FIXTURE, "node_modules"), resolve(candidate, "node_modules"), "dir");
  const page = resolve(candidate, "app/items/page.tsx");
  writeFileSync(page, `${readFileSync(page, "utf8")}\nconst typecheckMustFail: string = 1;\n`);
  return { work, candidate, runId: basename(work), artifacts: resolve(work, "artifacts") };
}

function schema4Provenance(candidate: string, runId: string, live: CurrentAgentRuntime) {
  return currentSchema4Provenance({ fixture: FIXTURE, candidate, runId, model: MODEL, arm: ARM, live });
}

function grade(runId: string, environment: NodeJS.ProcessEnv = {}) {
  return spawnSync(resolve(HARNESS, "grade.sh"), [runId, MODEL, ARM, "0"], {
    cwd: HARNESS,
    encoding: "utf8",
    env: { ...process.env, ...environment, API_PORT: "38101", E2E_PORT: "38102", BENCH_IGNORE_LOAD: "1" },
    maxBuffer: 10 * 1024 * 1024,
  });
}

describe("standalone grade exit semantics", () => {
  it("exits nonzero when score.ts produces an invalid record", () => {
    const { work, runId, artifacts } = setupCandidate("grade-invalid-score-");
    try {
      const result = grade(runId);
      expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0);
      const score = JSON.parse(readFileSync(resolve(artifacts, "score.json"), "utf8"));
      expect(score).toMatchObject({ valid: false, total: null, provenance_valid: false, suite_current: false });
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60_000);

  it("keeps a structurally valid gate-blocked record nonpublishable and nonrankable", () => {
    const { work, candidate, runId, artifacts } = setupCandidate("grade-gate-blocked-");
    const live = createCurrentAgentRuntime({ root: work, arm: ARM, model: MODEL });
    try {
      mkdirSync(artifacts);
      writeFileSync(resolve(artifacts, "provenance.json"), `${JSON.stringify(schema4Provenance(candidate, runId, live))}\n`);
      const result = grade(runId, live.environment);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const score = JSON.parse(readFileSync(resolve(artifacts, "score.json"), "utf8"));
      expect(score).toMatchObject({
        valid: true,
        blocked_by_gate: true,
        trusted: false,
        publishable: false,
        rankable: false,
        total: 0,
      });
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60_000);
});
