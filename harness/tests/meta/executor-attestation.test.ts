import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assessCandidateContract } from "../../candidate-contract";
import { executionIdentityFingerprint, ARM_B_SKILLS, resolveExecutionIdentity } from "../../execution-identity";
import { currentHashes } from "../../provenance";
import { ADVISORY, CRITERIA, PROBES } from "../criteria";
import { freshnessInProcess, scoreInProcess } from "./score-helpers";

const IMAGE = "docker.io/library/node@sha256:" + "a".repeat(64);
const DRIFTED_IMAGE = "docker.io/library/node@sha256:" + "b".repeat(64);
const COHORT = "executor-cohort-meta-2026-08";
const ROOT = resolve(import.meta.dirname, "../../..");
const HARNESS = resolve(ROOT, "harness");
const FIXTURE = resolve(ROOT, "fixture");
const MODEL = "meta/executor-freshness";

type Json = Record<string, unknown>;

type LiveExecutor = {
  runId: string;
  arm: "b";
  imageReference: string;
  piPath: string;
  skillRoots: Record<(typeof ARM_B_SKILLS)[number], string>;
  runtimeFlags: string[];
  cliFlags: string[];
};

type PreparedExecutor = {
  temp: string;
  pi: string;
  skills: Record<(typeof ARM_B_SKILLS)[number], string>;
  identity: Json;
  live: LiveExecutor;
  frozenCohort: Json;
};

function makeLiveExecutor(temp: string): { pi: string; skills: PreparedExecutor["skills"]; live: LiveExecutor } {
  const pi = resolve(temp, "pi", "bin", "pi");
  mkdirSync(resolve(temp, "pi", "bin"), { recursive: true });
  writeFileSync(pi, "#!/usr/bin/env sh\necho pi 9.9.9\n");
  chmodSync(pi, 0o755);

  const skills = Object.fromEntries(ARM_B_SKILLS.map((skill) => {
    const root = resolve(temp, "skills", skill);
    mkdirSync(root, { recursive: true });
    writeFileSync(resolve(root, "SKILL.md"), "# " + skill + "\n");
    return [skill, root];
  })) as PreparedExecutor["skills"];
  return {
    pi,
    skills,
    live: {
      runId: "meta-live-executor",
      arm: "b",
      imageReference: IMAGE,
      piPath: pi,
      skillRoots: skills,
      runtimeFlags: ["run", "--pull=never", "--read-only"],
      cliFlags: ["/opt/pi/bin/pi", "--provider", "local", "--model", "meta/live", "--thinking", "xhigh"],
    },
  };
}

function prepareExecutor(): PreparedExecutor {
  const temp = mkdtempSync(resolve(tmpdir(), "lending-desk-live-executor-"));
  const { pi, skills, live } = makeLiveExecutor(temp);
  const identity = resolveExecutionIdentity(live) as Json;
  const frozenCohort = {
    schema: 1,
    id: COHORT,
    image_reference: identity.image_reference,
    image_identity: identity.image_identity,
    pi: identity.pi,
    arms: {
      a: { skills: {}, skill_tree_sha256: undefined },
      b: { skills: identity.skills, skill_tree_sha256: identity.skill_tree_sha256 },
    },
  };
  return { temp, pi, skills, identity, live, frozenCohort };
}

async function attestCurrentExecutor(input: Json): Promise<Json> {
  const modulePath = new URL("../../executor-attestation.ts", import.meta.url).href;
  try {
    const implementation = await import(/* @vite-ignore */ modulePath) as {
      attestCurrentExecutor?: (value: Json) => Json | Promise<Json>;
    };
    if (typeof implementation.attestCurrentExecutor !== "function") {
      throw new Error("executor-attestation.ts must export attestCurrentExecutor");
    }
    return await implementation.attestCurrentExecutor(input);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error("Phase 8A requires harness/executor-attestation.ts: " + detail);
  }
}

function attestationInput(prepared: PreparedExecutor, overrides: Partial<Json> = {}): Json {
  return {
    record: {
      run_id: prepared.live.runId,
      arm: prepared.live.arm,
      cohort_id: COHORT,
      executor: prepared.identity,
    },
    frozen_cohort: prepared.frozenCohort,
    live: {
      run_id: prepared.live.runId,
      arm: prepared.live.arm,
      image_reference: prepared.live.imageReference,
      pi_path: prepared.live.piPath,
      skill_roots: prepared.live.skillRoots,
      runtime_flags: prepared.live.runtimeFlags,
      cli_flags: prepared.live.cliFlags,
    },
    ...overrides,
  };
}

function expectRejected(attestation: Json): void {
  expect(attestation).toMatchObject({
    schema: 1,
    current: false,
    cohort_compatible: false,
    eligible: false,
  });
  expect(attestation.reasons).toEqual(expect.any(Array));
  expect(attestation.reasons as unknown[]).not.toHaveLength(0);
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function copyCandidate(parent: string): string {
  const candidate = resolve(parent, "candidate");
  cpSync(FIXTURE, candidate, {
    recursive: true,
    filter: (source) => ![".git", "node_modules", ".next"].includes(basename(source)) && !source.endsWith(".tsbuildinfo"),
  });
  return candidate;
}

function declaredResults(): Json {
  return Object.fromEntries([...Object.keys(CRITERIA), ...Object.keys(PROBES), ...ADVISORY].map((id) => [id, false]));
}

async function scoreRecord(candidate: string, artifacts: string, runId: string, env: NodeJS.ProcessEnv): Promise<Json> {
  return scoreInProcess({
    candidate,
    artifacts,
    runId,
    model: MODEL,
    arm: "b",
    environment: env,
  });
}

function scoreFreshness(artifacts: string, env: NodeJS.ProcessEnv): Json {
  return freshnessInProcess(artifacts, env);
}

describe("current executor attestation", () => {
  it("preserves a valid control when the recorded, frozen, and live executors match", async () => {
    const prepared = prepareExecutor();
    try {
      expect(Object.keys((prepared.identity.skills as Json) ?? {}).sort()).toEqual([...ARM_B_SKILLS].sort());
      await expect(attestCurrentExecutor(attestationInput(prepared))).resolves.toMatchObject({
        schema: 1,
        current: true,
        cohort_compatible: true,
        eligible: true,
        reasons: [],
      });
    } finally {
      rmSync(prepared.temp, { recursive: true, force: true });
    }
  });

  it("rejects a live Pi binary and version drift after identity capture", async () => {
    const prepared = prepareExecutor();
    try {
      writeFileSync(prepared.pi, "#!/usr/bin/env sh\necho pi 9.9.10\n");
      chmodSync(prepared.pi, 0o755);
      expectRejected(await attestCurrentExecutor(attestationInput(prepared)));
    } finally {
      rmSync(prepared.temp, { recursive: true, force: true });
    }
  });

  it("rejects a live Arm-B skill-tree drift after identity capture", async () => {
    const prepared = prepareExecutor();
    try {
      writeFileSync(resolve(prepared.skills.measure, "drift.md"), "this changes the mounted skill tree\n");
      expectRejected(await attestCurrentExecutor(attestationInput(prepared)));
    } finally {
      rmSync(prepared.temp, { recursive: true, force: true });
    }
  });

  it("rejects a live image digest and identity drift after identity capture", async () => {
    const prepared = prepareExecutor();
    try {
      expectRejected(await attestCurrentExecutor(attestationInput(prepared, {
        live: {
          run_id: prepared.live.runId,
          arm: prepared.live.arm,
          image_reference: DRIFTED_IMAGE,
          pi_path: prepared.live.piPath,
          skill_roots: prepared.live.skillRoots,
          runtime_flags: prepared.live.runtimeFlags,
          cli_flags: prepared.live.cliFlags,
        },
      })));
    } finally {
      rmSync(prepared.temp, { recursive: true, force: true });
    }
  });

  it("rejects an otherwise current executor recorded under an incompatible cohort", async () => {
    const prepared = prepareExecutor();
    try {
      const input = attestationInput(prepared);
      (input.record as Json).cohort_id = "other-cohort";
      const attestation = await attestCurrentExecutor(input);
      expect(attestation).toMatchObject({
        schema: 1,
        current: true,
        cohort_compatible: false,
        eligible: false,
      });
      expect(attestation.reasons as unknown[]).not.toHaveLength(0);
    } finally {
      rmSync(prepared.temp, { recursive: true, force: true });
    }
  });

  it.each([
    { missing: ["cohort_id", "executor_cohort"], label: "both cohort fields" },
    { missing: ["cohort_id"], label: "cohort_id only" },
    { missing: ["executor_cohort"], label: "executor_cohort only" },
  ])("fails closed for a fresh agent score missing $label", async ({ missing }) => {
    const prepared = prepareExecutor();
    const work = mkdtempSync(resolve(ROOT, "runs", "meta-executor-missing-cohort-"));
    const runId = basename(work);
    const artifacts = resolve(work, "artifacts");
    const candidate = copyCandidate(work);
    const live = { ...prepared.live, runId };
    const identity = resolveExecutionIdentity(live) as Json;
    const frozenCohort = {
      schema: 1,
      id: COHORT,
      image_reference: identity.image_reference,
      image_identity: identity.image_identity,
      pi: identity.pi,
      arms: { b: { skills: identity.skills, skill_tree_sha256: identity.skill_tree_sha256 } },
    };
    const liveEnv: NodeJS.ProcessEnv = {
      ...process.env,
      BENCH_AGENT_IMAGE: live.imageReference,
      BENCH_PI_ROOT: resolve(prepared.temp, "pi"),
      BENCH_SKILL_ROOT: resolve(prepared.temp, "skills"),
    };
    try {
      mkdirSync(artifacts);
      writeJson(resolve(artifacts, "gate.json"), { typecheck: true, build: true });
      writeJson(resolve(artifacts, "collection.json"), { valid: true, status: "collected" });
      writeJson(resolve(artifacts, "results.json"), declaredResults());
      const contract = assessCandidateContract(FIXTURE, candidate);
      expect(contract.valid).toBe(true);
      const hashes = currentHashes();
      const provenance: Json = {
        schema: 4,
        run_id: runId,
        arm: "b",
        model: MODEL,
        mode: "agent",
        candidate_sha256: contract.candidate_sha256,
        fixture_protected_sha256: contract.fixture_protected_sha256,
        runner_sha256: hashes.runner_sha256,
        suite_sha256: hashes.suite_sha256,
        agent_isolated: true,
        candidate_contract_schema: 1,
        cohort_id: COHORT,
        executor_cohort: frozenCohort,
        executor: identity,
        execution_identity_sha256: executionIdentityFingerprint(identity),
      };
      for (const field of missing) delete provenance[field];
      writeJson(resolve(artifacts, "provenance.json"), provenance);
      writeJson(resolve(artifacts, "score.json"), await scoreRecord(candidate, artifacts, runId, liveEnv));

      const freshness = scoreFreshness(artifacts, liveEnv);
      expect(["STALE-PROVENANCE", "INVALID"]).toContain(freshness.state);
      expect(freshness).toMatchObject({ rankable: false, provenance_current: false });
      expect((freshness.reasons as string[]).join("\n")).toMatch(/executor.*cohort|cohort.*executor/i);
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(prepared.temp, { recursive: true, force: true });
    }
  });

  it("makes a previously trusted score stale and non-rankable when its live executor cohort drifts", async () => {
    const prepared = prepareExecutor();
    const work = mkdtempSync(resolve(ROOT, "runs", "meta-executor-freshness-"));
    const runId = basename(work);
    const artifacts = resolve(work, "artifacts");
    const candidate = copyCandidate(work);
    const live = { ...prepared.live, runId };
    const identity = resolveExecutionIdentity(live) as Json;
    const frozenCohort = {
      schema: 1,
      id: COHORT,
      image_reference: identity.image_reference,
      image_identity: identity.image_identity,
      pi: identity.pi,
      arms: { b: { skills: identity.skills, skill_tree_sha256: identity.skill_tree_sha256 } },
    };
    const liveEnv: NodeJS.ProcessEnv = {
      ...process.env,
      BENCH_AGENT_IMAGE: live.imageReference,
      BENCH_PI_ROOT: resolve(prepared.temp, "pi"),
      BENCH_SKILL_ROOT: resolve(prepared.temp, "skills"),
    };
    try {
      mkdirSync(artifacts);
      writeJson(resolve(artifacts, "gate.json"), { typecheck: true, build: true });
      writeJson(resolve(artifacts, "collection.json"), { valid: true, status: "collected" });
      writeJson(resolve(artifacts, "results.json"), declaredResults());
      const contract = assessCandidateContract(FIXTURE, candidate);
      expect(contract.valid).toBe(true);
      const hashes = currentHashes();
      const provenance = {
        schema: 4,
        run_id: runId,
        arm: "b",
        model: MODEL,
        mode: "agent",
        candidate_sha256: contract.candidate_sha256,
        fixture_protected_sha256: contract.fixture_protected_sha256,
        runner_sha256: hashes.runner_sha256,
        suite_sha256: hashes.suite_sha256,
        agent_isolated: true,
        candidate_contract_schema: 1,
        cohort_id: COHORT,
        executor_cohort: frozenCohort,
        executor: identity,
        execution_identity_sha256: executionIdentityFingerprint(identity),
      };
      writeJson(resolve(artifacts, "provenance.json"), provenance);
      writeJson(resolve(artifacts, "score.json"), await scoreRecord(candidate, artifacts, runId, liveEnv));

      expect(scoreFreshness(artifacts, liveEnv)).toMatchObject({
        state: "TRUSTED",
        rankable: true,
        provenance_current: true,
      });

      writeFileSync(prepared.pi, "#!/usr/bin/env sh\necho pi 9.9.10\n");
      chmodSync(prepared.pi, 0o755);
      const stale = scoreFreshness(artifacts, liveEnv);
      expect(["STALE-PROVENANCE", "INVALID"]).toContain(stale.state);
      expect(stale).toMatchObject({ rankable: false, provenance_current: false });
      expect((stale.reasons as string[]).join("\n")).toMatch(/executor|cohort/i);
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(prepared.temp, { recursive: true, force: true });
    }
  });

  it("keeps executor and score attestation modules in the runner provenance hash", () => {
    const provenance = readFileSync(resolve(HARNESS, "provenance.ts"), "utf8");
    for (const path of [
      "harness/execution-identity.ts",
      "harness/executor-attestation.ts",
      "harness/score-attestation.ts",
      "harness/score-calculation.ts",
      "harness/public-api.ts",
    ]) {
      expect(provenance).toContain(path);
    }
  });

});
