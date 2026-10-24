/**
 * Write a schema-7 provenance.json for one run.
 *
 *   tsx provenance-record.ts <artifacts-dir>
 *
 * Inputs come from the run's artifacts and the environment:
 *   RUN_ID, ARM, MODEL (provider/model), MODE (agent|overlay), BENCH_TRACK
 *   FIXTURE_REVISION   instructions the agent saw (default: current revision)
 *   GRAFT_JSON         optional path to {reason, from_candidate_sha256, from_fixture_revision}
 * Artifacts read: candidate-contract.json (must be gradeable), execution-identity.json
 * (schema 2; a Pi identity is never written again), executor-cohort.json
 * (variant-manifest.json for variant tracks), and the optional
 * contract-violation.json.
 *
 * run.sh, regrade-run.sh, and rescore-doctor.sh all call this, so the three can
 * never write different shapes.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTrack, type BenchTrack } from "./candidate-contract.js";
import { executionIdentityFingerprint, validateExecutionIdentity } from "./execution-identity.js";
import { currentHashes } from "./provenance.js";
import { graftErrors, PROVENANCE_SCHEMA } from "./provenance-check.js";
import { FIXTURE_REVISION } from "./revisions.js";
import { TRACK_BINDINGS, TRACK_BINDING_FIELDS } from "./track-bindings.js";

type Json = Record<string, unknown>;
const hex64 = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

function readJson(path: string): Json {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(value)) throw new Error(`${path} is not a JSON object`);
  return value;
}

export function buildProvenance(input: {
  artifacts: string;
  runId: string;
  arm: string;
  model: string;
  mode: string;
  track: BenchTrack;
  fixtureRevision?: number;
  graft?: Json | null;
}): Json {
  const { artifacts, runId, arm, model, mode, track } = input;
  if (!/^(a|b)$/.test(arm) || !/^(agent|overlay)$/.test(mode)) throw new Error("invalid provenance identity");
  const contract = readJson(join(artifacts, "candidate-contract.json"));
  if (contract.schema !== 1 || contract.gradeable !== true || !hex64(contract.candidate_sha256) ||
      !hex64(contract.fixture_protected_sha256)) {
    throw new Error("candidate contract is not gradeable");
  }
  const executor = readJson(join(artifacts, "execution-identity.json"));
  const identityErrors = validateExecutionIdentity(executor, {
    runId,
    arm: arm as "a" | "b",
    mode: mode === "overlay" ? "overlay" : "agent",
  });
  if ((executor as Json).schema !== 2 || identityErrors.length) {
    throw new Error("execution identity is not a schema-2 OpenCode record: " + identityErrors.join("; "));
  }
  const cohort = readJson(join(artifacts, "executor-cohort.json"));
  if (cohort.schema !== 1 || typeof cohort.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(cohort.id)) {
    throw new Error("invalid executor cohort");
  }
  const bindings: Json = Object.fromEntries(TRACK_BINDING_FIELDS.map((field) => [field, null]));
  if (track !== "build") {
    const manifestPath = [join(artifacts, "variant-manifest.json"), join(artifacts, "bug-manifest.json")]
      .find((path) => existsSync(path));
    if (!manifestPath) throw new Error(`${track} run lacks a variant manifest`);
    const manifest = readJson(manifestPath);
    const binding = TRACK_BINDINGS[track];
    if (manifest.schema !== 1 || manifest.track !== track) throw new Error("variant manifest does not match the track");
    const setId = manifest[binding.idField];
    const setSha = manifest[binding.shaField];
    if (typeof setId !== "string" || !setId || !hex64(setSha) || !hex64(manifest.registry_sha256) || !hex64(manifest.variant_sha256)) {
      throw new Error(`${track} provenance lacks variant evidence`);
    }
    bindings[binding.idField] = setId;
    bindings[binding.shaField] = setSha;
    bindings.registry_sha256 = manifest.registry_sha256;
    bindings.variant_sha256 = manifest.variant_sha256;
  }
  const violationPath = join(artifacts, "contract-violation.json");
  const contractViolation = existsSync(violationPath)
    ? createHash("sha256").update(readFileSync(violationPath)).digest("hex")
    : null;
  const graft = input.graft ?? null;
  const graftProblems = graftErrors(graft);
  if (graftProblems.length) throw new Error(graftProblems.join("; "));
  const revision = input.fixtureRevision ?? FIXTURE_REVISION;
  if (!Number.isInteger(revision) || revision < 1 || revision > FIXTURE_REVISION) throw new Error("invalid fixture revision");
  const hashes = currentHashes();
  return {
    schema: PROVENANCE_SCHEMA,
    track,
    fixture_revision: revision,
    ...bindings,
    contract_violation_sha256: contractViolation,
    graft,
    run_id: runId,
    arm,
    model,
    mode,
    candidate_sha256: contract.candidate_sha256,
    fixture_protected_sha256: contract.fixture_protected_sha256,
    runner_sha256: hashes.runner_sha256,
    suite_sha256: hashes.suite_sha256,
    agent_isolated: mode === "agent",
    candidate_contract_schema: 1,
    cohort_id: cohort.id,
    executor_cohort: cohort,
    executor,
    execution_identity_sha256: executionIdentityFingerprint(executor),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const artifacts = process.argv[2];
  if (!artifacts) throw new Error("usage: provenance-record.ts <artifacts-dir>");
  const env = process.env;
  const graft = env.GRAFT_JSON ? readJson(env.GRAFT_JSON) : null;
  const provenance = buildProvenance({
    artifacts,
    runId: env.RUN_ID ?? "",
    arm: env.ARM ?? "",
    model: env.MODEL ?? "",
    mode: env.MODE ?? "",
    track: resolveTrack(env.BENCH_TRACK),
    fixtureRevision: env.FIXTURE_REVISION ? Number(env.FIXTURE_REVISION) : undefined,
    graft,
  });
  writeFileSync(join(artifacts, "provenance.json"), JSON.stringify(provenance) + "\n");
}
