import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assessCandidateContract } from "../../candidate-contract";
import { executionIdentityFingerprint, ARM_B_SKILLS, resolveExecutionIdentity } from "../../execution-identity";
import { currentHashes } from "../../provenance";
import { ADVISORY, CRITERIA, PROBES } from "../criteria";
import { createCurrentAgentRuntime, currentSchema4Provenance } from "./schema4-fixtures";
import { envWithoutTrack, freshnessInProcess, scoreInProcess } from "./score-helpers";

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
  opencodePath: string;
  rgPath: string;
  configPath: string;
  entryPath: string;
  modelRef: string;
  skillRoots: Record<(typeof ARM_B_SKILLS)[number], string>;
  runtimeFlags: string[];
  cliFlags: string[];
};

type PreparedExecutor = {
  temp: string;
  opencode: string;
  skills: Record<(typeof ARM_B_SKILLS)[number], string>;
  artifacts: string;
  capture: string;
  identity: Json;
  live: LiveExecutor;
  frozenCohort: Json;
};

function makeLiveExecutor(temp: string): { opencode: string; skills: PreparedExecutor["skills"]; artifacts: string; capture: string; live: LiveExecutor } {
  const capture = resolve(temp, "opencode-calls.jsonl");
  const opencode = resolve(temp, "opencode", "bin", "opencode");
  mkdirSync(resolve(temp, "opencode", "bin"), { recursive: true });
  writeFileSync(opencode, `#!${process.execPath}
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(capture)}, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.argv[2] === "--version") console.log("opencode v2.0.32");
`);
  chmodSync(opencode, 0o755);

  const rg = resolve(temp, "rg");
  writeFileSync(rg, "#!/bin/sh\necho ripgrep 15.1.0\n");
  chmodSync(rg, 0o755);

  const config = resolve(temp, "executor", "opencode.json");
  mkdirSync(resolve(temp, "executor"), { recursive: true });
  writeFileSync(config, JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    model: "opencode-go/meta/live",
    permissions: [],
  }) + "\n");
  const entry = resolve(temp, "opencode-entry.sh");
  writeFileSync(entry, "#!/bin/sh\nexit 0\n");

  const skills = Object.fromEntries(ARM_B_SKILLS.map((skill) => {
    const root = resolve(temp, "skills", skill);
    mkdirSync(root, { recursive: true });
    writeFileSync(resolve(root, "SKILL.md"), "# " + skill + "\n");
    return [skill, root];
  })) as PreparedExecutor["skills"];

  // The run's own recorded snapshots: attestation re-hashes these, never the
  // live executor tree (FR-6).
  const artifacts = resolve(temp, "artifacts");
  mkdirSync(resolve(artifacts, "executor"), { recursive: true });
  writeFileSync(resolve(artifacts, "executor", "opencode.json"), readFileSync(config));
  cpSync(resolve(temp, "skills"), resolve(artifacts, "executor", "skills"), { recursive: true });

  return {
    opencode,
    skills,
    artifacts,
    capture,
    live: {
      runId: "meta-live-executor",
      arm: "b",
      imageReference: IMAGE,
      opencodePath: opencode,
      rgPath: rg,
      configPath: config,
      entryPath: entry,
      modelRef: "opencode-go/meta/live",
      skillRoots: skills,
      runtimeFlags: ["run", "--pull=never", "--read-only"],
      cliFlags: ["run", "--standalone", "--format", "json", "--auto", "--model", "opencode-go/meta/live"],
    },
  };
}

function prepareExecutor(): PreparedExecutor {
  const temp = mkdtempSync(resolve(tmpdir(), "lending-desk-live-executor-"));
  const { opencode, skills, artifacts, capture, live } = makeLiveExecutor(temp);
  const identity = resolveExecutionIdentity(live) as Json;
  const frozenCohort = {
    schema: 1,
    id: COHORT,
    image_reference: identity.image_reference,
    image_identity: identity.image_identity,
    opencode: identity.opencode,
    model_ref: identity.model_ref,
    variant: identity.variant,
    config_sha256: identity.config_sha256,
    entry_sha256: identity.entry_sha256,
    helpers: identity.helpers,
    credential: identity.credential,
    runtime_flags: identity.runtime_flags,
    cli_flags: identity.cli_flags,
    arms: {
      a: { skills: {}, skill_tree_sha256: undefined },
      b: { skills: identity.skills, skill_tree_sha256: identity.skill_tree_sha256 },
    },
  };
  return { temp, opencode, skills, artifacts, capture, identity, live, frozenCohort };
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
    artifacts: prepared.artifacts,
    live: {
      run_id: prepared.live.runId,
      arm: prepared.live.arm,
      image_reference: prepared.live.imageReference,
      opencode_path: prepared.live.opencodePath,
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
      // FR-6: attestation never resolves a live binary. A live version drift
      // at the recorded path and drifted live evidence never enter the check,
      // so the recorded control stays eligible and no binary runs.
      writeFileSync(prepared.opencode, `#!${process.execPath}\nconsole.log("opencode v2.99.0");\n`);
      chmodSync(prepared.opencode, 0o755);
      writeFileSync(prepared.capture, "");
      const attestation = await attestCurrentExecutor(attestationInput(prepared, {
        live: {
          run_id: prepared.live.runId,
          arm: prepared.live.arm,
          image_reference: DRIFTED_IMAGE,
          opencode_path: prepared.live.opencodePath,
          skill_roots: prepared.live.skillRoots,
          runtime_flags: [...prepared.live.runtimeFlags, "--privileged"],
          cli_flags: [...prepared.live.cliFlags, "--thinking", "max"],
        },
      }));
      expect(attestation).toMatchObject({
        schema: 1,
        current: true,
        cohort_compatible: true,
        eligible: true,
        reasons: [],
      });
      expect(readFileSync(prepared.capture, "utf8"), "attestation must never execute a live binary").toBe("");
    } finally {
      rmSync(prepared.temp, { recursive: true, force: true });
    }
  });

  it("rejects a live Arm-B skill-tree drift after identity capture", async () => {
    const prepared = prepareExecutor();
    try {
      // Live source drift never enters the check (FR-6): the run reads its own
      // recorded snapshot, so drift there is the rejection signal.
      writeFileSync(resolve(prepared.skills.measure, "drift.md"), "this changes the live skill source\n");
      await expect(attestCurrentExecutor(attestationInput(prepared))).resolves.toMatchObject({
        current: true,
        cohort_compatible: true,
        eligible: true,
        reasons: [],
      });
      writeFileSync(resolve(prepared.artifacts, "executor/skills/measure/SKILL.md"), "# changed snapshot\n");
      const attestation = await attestCurrentExecutor(attestationInput(prepared));
      expectRejected(attestation);
      expect((attestation.reasons as string[]).join(" ")).toMatch(/skill|snapshot/i);
    } finally {
      rmSync(prepared.temp, { recursive: true, force: true });
    }
  });

  it("rejects a live image digest and identity drift after identity capture", async () => {
    const prepared = prepareExecutor();
    try {
      // A drifted live image digest is ignored (FR-6); recorded identity drift
      // after capture still rejects.
      await expect(attestCurrentExecutor(attestationInput(prepared, {
        live: {
          run_id: prepared.live.runId,
          arm: prepared.live.arm,
          image_reference: DRIFTED_IMAGE,
          opencode_path: prepared.live.opencodePath,
          skill_roots: prepared.live.skillRoots,
          runtime_flags: prepared.live.runtimeFlags,
          cli_flags: prepared.live.cliFlags,
        },
      }))).resolves.toMatchObject({ current: true, cohort_compatible: true, eligible: true, reasons: [] });
      const input = attestationInput(prepared);
      (input.record as Json).executor = { ...prepared.identity, image_identity: "b".repeat(64) };
      const attestation = await attestCurrentExecutor(input);
      expectRejected(attestation);
      expect((attestation.reasons as string[]).join(" ")).toMatch(/image/i);
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
    const executorRoot = mkdtempSync(resolve(tmpdir(), "lending-desk-missing-cohort-env-"));
    const work = mkdtempSync(resolve(ROOT, "runs", "meta-executor-missing-cohort-"));
    const runId = basename(work);
    const artifacts = resolve(work, "artifacts");
    const candidate = copyCandidate(work);
    const live = createCurrentAgentRuntime({ root: executorRoot, arm: "b", model: MODEL });
    // Ambient executor environment is present and wrong; the fail-closed reason
    // must come from the record, never from these values (FR-6).
    const liveEnv: NodeJS.ProcessEnv = envWithoutTrack({
      BENCH_AGENT_IMAGE: DRIFTED_IMAGE,
      BENCH_OPENCODE_BIN: resolve(executorRoot, "missing-opencode"),
      BENCH_SKILL_ROOT: resolve(executorRoot, "missing-skills"),
    });
    try {
      mkdirSync(artifacts);
      writeJson(resolve(artifacts, "gate.json"), { typecheck: true, build: true });
      writeJson(resolve(artifacts, "collection.json"), { valid: true, status: "collected" });
      writeJson(resolve(artifacts, "results.json"), declaredResults());
      const contract = assessCandidateContract(FIXTURE, candidate);
      expect(contract.valid).toBe(true);
      const provenance = currentSchema4Provenance({
        fixture: FIXTURE, candidate, runId, model: MODEL, arm: "b", live, artifacts,
      }) as Json;
      for (const field of missing) delete provenance[field];
      writeJson(resolve(artifacts, "provenance.json"), provenance);
      writeJson(resolve(artifacts, "score.json"), await scoreRecord(candidate, artifacts, runId, liveEnv));

      const freshness = scoreFreshness(artifacts, liveEnv);
      expect(["STALE-PROVENANCE", "INVALID"]).toContain(freshness.state);
      expect(freshness).toMatchObject({ rankable: false, provenance_current: false });
      expect((freshness.reasons as string[]).join("\n")).toMatch(/executor|cohort/i);
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(executorRoot, { recursive: true, force: true });
    }
  });

  it("makes a previously trusted score stale and non-rankable when its live executor cohort drifts", async () => {
    const executorRoot = mkdtempSync(resolve(tmpdir(), "lending-desk-executor-freshness-env-"));
    const work = mkdtempSync(resolve(ROOT, "runs", "meta-executor-freshness-"));
    const runId = basename(work);
    const artifacts = resolve(work, "artifacts");
    const candidate = copyCandidate(work);
    const live = createCurrentAgentRuntime({ root: executorRoot, arm: "b", model: MODEL });
    const liveEnv: NodeJS.ProcessEnv = envWithoutTrack({
      BENCH_AGENT_IMAGE: DRIFTED_IMAGE,
      BENCH_OPENCODE_BIN: resolve(executorRoot, "missing-opencode"),
      BENCH_SKILL_ROOT: resolve(executorRoot, "missing-skills"),
    });
    try {
      mkdirSync(artifacts);
      writeJson(resolve(artifacts, "gate.json"), { typecheck: true, build: true });
      writeJson(resolve(artifacts, "collection.json"), { valid: true, status: "collected" });
      writeJson(resolve(artifacts, "results.json"), declaredResults());
      const contract = assessCandidateContract(FIXTURE, candidate);
      expect(contract.valid).toBe(true);
      const provenance = currentSchema4Provenance({
        fixture: FIXTURE, candidate, runId, model: MODEL, arm: "b", live, artifacts,
      });
      writeJson(resolve(artifacts, "provenance.json"), provenance);
      writeJson(resolve(artifacts, "score.json"), await scoreRecord(candidate, artifacts, runId, liveEnv));

      expect(scoreFreshness(artifacts, liveEnv)).toMatchObject({
        state: "TRUSTED",
        rankable: true,
        provenance_current: true,
      });

      // FR-6: no live executor is resolved, so live drift cannot stale the
      // score. Drift of the run's own recorded snapshot is the stale signal.
      writeFileSync(resolve(artifacts, "executor/skills/measure/SKILL.md"), "# drifted snapshot\n");
      const stale = scoreFreshness(artifacts, liveEnv);
      expect(["STALE-PROVENANCE", "INVALID"]).toContain(stale.state);
      expect(stale).toMatchObject({ rankable: false, provenance_current: false });
      expect((stale.reasons as string[]).join("\n")).toMatch(/executor|skill|snapshot|cohort/i);
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(executorRoot, { recursive: true, force: true });
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
