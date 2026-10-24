import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ADVISORY, CRITERIA, PROBES } from "../criteria";
import { createCurrentAgentRuntime, currentSchema4Provenance, type CurrentAgentRuntime } from "./schema4-fixtures";
import { legacyPiProvenance } from "./legacy-pi-fixtures";
import { attestCurrentExecutor } from "../../executor-attestation";
import { freshnessInProcess, scoreInProcess, type ScoreJson } from "./score-helpers";

const ROOT = resolve(import.meta.dirname, "../../..");
const FIXTURE = resolve(ROOT, "fixture");
const MODEL = "meta/executor";
const ARM = "b" as const;

type Json = Record<string, unknown>;

function copyCandidate(parent: string): string {
  const candidate = resolve(parent, "candidate");
  cpSync(FIXTURE, candidate, {
    recursive: true,
    filter: (source) => ![".git", "node_modules", ".next"].includes(basename(source)) && !source.endsWith(".tsbuildinfo"),
  });
  return candidate;
}

function schema4Provenance(candidate: string, runId: string, live: CurrentAgentRuntime, artifacts: string): Json {
  return currentSchema4Provenance({ fixture: FIXTURE, candidate, runId, model: MODEL, arm: ARM, live, artifacts });
}

async function score(candidate: string, artifacts: string, runId: string, environment: NodeJS.ProcessEnv): Promise<ScoreJson> {
  return scoreInProcess({ candidate, artifacts, runId, model: MODEL, arm: ARM, environment });
}

function freshness(artifacts: string, environment: NodeJS.ProcessEnv): ScoreJson {
  return freshnessInProcess(artifacts, environment);
}

const declaredResults = () => Object.fromEntries(
  [...Object.keys(CRITERIA), ...Object.keys(PROBES), ...ADVISORY].map((id) => [id, false]),
);

const mutateCases: { name: string; mutate: (provenance: Json) => Json }[] = [
  { name: "stale schema", mutate: (p) => ({ ...p, schema: 3 }) },
  { name: "missing run id", mutate: (p) => { const next = { ...p }; delete next.run_id; return next; } },
  { name: "wrong run id", mutate: (p) => ({ ...p, run_id: "other-run" }) },
  { name: "missing execution identity", mutate: (p) => { const next = { ...p }; delete next.executor; return next; } },
  { name: "mutable image reference", mutate: (p) => ({ ...p, executor: { ...(p.executor as Json), image_reference: "docker.io/library/node:latest" } }) },
  { name: "missing OpenCode hash", mutate: (p) => ({ ...p, executor: { ...(p.executor as Json), opencode: { ...((p.executor as Json).opencode as Json), sha256: "" } } }) },
  { name: "missing OpenCode version", mutate: (p) => ({ ...p, executor: { ...(p.executor as Json), opencode: { ...((p.executor as Json).opencode as Json), version: "" } } }) },
  { name: "missing Arm-B build-graph skill", mutate: (p) => { const skills = { ...((p.executor as Json).skills as Json) }; delete skills["build-graph"]; return { ...p, executor: { ...(p.executor as Json), skills } }; } },
  { name: "extra Arm-B skill", mutate: (p) => ({ ...p, executor: { ...(p.executor as Json), skills: { ...((p.executor as Json).skills as Json), unexpected: "0".repeat(64) } } }) },
  { name: "missing runtime flags", mutate: (p) => ({ ...p, executor: { ...(p.executor as Json), runtime_flags: [], runtime_flags_sha256: "" } }) },
  { name: "runtime flag fingerprint mismatch", mutate: (p) => ({ ...p, executor: { ...(p.executor as Json), runtime_flags: [...((p.executor as Json).runtime_flags as string[]), "--unsafe"] } }) },
  { name: "missing CLI flags", mutate: (p) => ({ ...p, executor: { ...(p.executor as Json), cli_flags: [], cli_flags_sha256: "" } }) },
  { name: "CLI flag fingerprint mismatch", mutate: (p) => ({ ...p, executor: { ...(p.executor as Json), cli_flags: [...((p.executor as Json).cli_flags as string[]), "--no-session"] } }) },
  { name: "mismatched identity fingerprint", mutate: (p) => ({ ...p, execution_identity_sha256: "0".repeat(64) }) },
];

describe("schema-4 executor provenance", () => {
  it("makes score reject stale, incomplete, or mismatched execution bindings", async () => {
    const artifacts = mkdtempSync(resolve(tmpdir(), "lending-desk-schema4-score-"));
    const candidate = copyCandidate(artifacts);
    const runId = "meta-schema4-score";
    const live = createCurrentAgentRuntime({ root: artifacts, arm: ARM, model: MODEL });
    try {
      writeFileSync(resolve(artifacts, "gate.json"), '{"typecheck":false,"build":false}\n');
      writeFileSync(resolve(artifacts, "collection.json"), '{"valid":true,"status":"blocked_by_gate"}\n');
      const current = schema4Provenance(candidate, runId, live, artifacts);
      for (const testCase of [{ name: "current", provenance: current }, ...mutateCases.map(({ name, mutate }) => ({ name, provenance: mutate(current) }))]) {
        writeFileSync(resolve(artifacts, "provenance.json"), `${JSON.stringify(testCase.provenance)}\n`);
        const record = await score(candidate, artifacts, runId, live.environment);
        if (testCase.name === "current") {
          expect(record, testCase.name).toMatchObject({ valid: true, provenance_valid: true, suite_current: true });
        } else {
          expect(record, testCase.name).toMatchObject({ valid: false, provenance_valid: false, suite_current: false, total: null });
        }
      }
    } finally {
      rmSync(artifacts, { recursive: true, force: true });
    }
  });

  it("makes freshness recompute and reject stale, incomplete, or mismatched execution bindings", async () => {
    const work = mkdtempSync(resolve(ROOT, "runs", "meta-schema4-freshness-"));
    const artifacts = resolve(work, "artifacts");
    const runId = basename(work);
    const candidate = copyCandidate(work);
    const live = createCurrentAgentRuntime({ root: work, arm: ARM, model: MODEL });
    mkdirSync(artifacts);
    try {
      writeFileSync(resolve(artifacts, "gate.json"), '{"typecheck":true,"build":true}\n');
      writeFileSync(resolve(artifacts, "collection.json"), '{"valid":true,"status":"collected"}\n');
      writeFileSync(resolve(artifacts, "results.json"), JSON.stringify(declaredResults()) + "\n");
      const current = schema4Provenance(candidate, runId, live, artifacts);
      writeFileSync(resolve(artifacts, "provenance.json"), JSON.stringify(current) + "\n");
      writeFileSync(resolve(artifacts, "score.json"), JSON.stringify(await score(candidate, artifacts, runId, live.environment)) + "\n");
      for (const testCase of [{ name: "current", provenance: current }, ...mutateCases.map(({ name, mutate }) => ({ name, provenance: mutate(current) }))]) {
        writeFileSync(resolve(artifacts, "provenance.json"), `${JSON.stringify(testCase.provenance)}\n`);
        const record = freshness(artifacts, live.environment);
        if (testCase.name === "current") {
          expect(record, testCase.name).toMatchObject({ state: "TRUSTED", rankable: true, provenance_current: true });
        } else {
          expect(record, testCase.name).toMatchObject({ state: "STALE-PROVENANCE", rankable: false, provenance_current: false });
        }
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120_000);

  it("keeps a legacy Pi record readable on the history path without ranking it", async () => {
    // History path: a schema-6 Pi run stays readable so the harness can label
    // it, and it is never attested eligible or ranked as a Go result.
    const work = mkdtempSync(resolve(ROOT, "runs", "meta-legacy-pi-history-"));
    const runId = basename(work);
    const artifacts = resolve(work, "artifacts");
    const candidate = copyCandidate(work);
    try {
      mkdirSync(artifacts);
      writeFileSync(resolve(artifacts, "gate.json"), '{"typecheck":true,"build":true}\n');
      writeFileSync(resolve(artifacts, "collection.json"), '{"valid":true,"status":"collected"}\n');
      writeFileSync(resolve(artifacts, "results.json"), JSON.stringify(declaredResults()) + "\n");
      const provenance = legacyPiProvenance({ fixture: FIXTURE, candidate, runId, model: MODEL, arm: ARM });
      expect(provenance.schema).toBe(6);
      expect((provenance.executor as Json).kind).toBe("pi");
      writeFileSync(resolve(artifacts, "provenance.json"), JSON.stringify(provenance) + "\n");
      writeFileSync(resolve(artifacts, "score.json"), JSON.stringify({
        schema: 3,
        track: "build",
        valid: true,
        trusted: true,
        publishable: true,
        rankable: true,
        blocked_by_gate: false,
        invalid_reasons: [],
        run_id: runId,
        model: MODEL,
        arm: ARM,
        total: 99,
        host: { under_load: false },
      }) + "\n");

      const record = freshness(artifacts, {});
      expect(record).toMatchObject({ state: "STALE-PROVENANCE", rankable: false, provenance_current: false });
      expect((record.reasons as string[]).join("\n")).toMatch(/runner or suite provenance does not match/);

      // Readability: the recorded-executor check consumes the legacy shape
      // without throwing. The freshness verdict above is the ranking gate,
      // so the history record stays unranked even when the recorded Pi
      // executor is internally consistent.
      const attestation = attestCurrentExecutor({
        record: provenance,
        frozen_cohort: provenance.executor_cohort,
        artifacts,
      });
      expect(attestation).toMatchObject({ schema: 1 });
      expect(typeof attestation.eligible).toBe("boolean");
      expect(Array.isArray(attestation.reasons)).toBe(true);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120_000);
});
