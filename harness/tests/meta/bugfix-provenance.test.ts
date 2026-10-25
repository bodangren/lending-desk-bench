import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildScoreRecord } from "../../score.js";
import { generateFromSetId, writeVariant } from "../../bugfix/make-variant.js";
import { setFileHash } from "../../bugfix/set-loader.js";
import { currentSchema4Provenance } from "./schema4-fixtures.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const FIXTURE = resolve(ROOT, "fixture");
const MODEL = "meta/bugfix-provenance";
const ARM = "a";

function schema5BugfixProvenance({
  variantDir,
  candidate,
  runId,
  setSha256,
  registrySha,
  variantSha,
}: {
  variantDir: string;
  candidate: string;
  runId: string;
  setSha256: string;
  registrySha: string;
  variantSha: string;
}) {
  // Reuse the schema-5 shape written by run.sh: the fixture fields carry the
  // variant contract, the track fields carry the bugfix bindings.
  const base = currentSchema4Provenance({ fixture: variantDir, candidate, runId, model: MODEL, arm: ARM, mode: "overlay", track: "bugfix" }) as Record<string, unknown>;
  return {
    ...base,
    track: "bugfix",
    bug_set_id: "v1",
    bug_set_sha256: setSha256,
    registry_sha256: registrySha,
    variant_sha256: variantSha,
  };
}

function prepareBugfixRun() {
  const work = mkdtempSync(resolve(ROOT, "runs", "meta-bugfix-provenance-"));
  const artifacts = resolve(work, "artifacts");
  mkdirSync(artifacts, { recursive: true });
  const seeded = generateFromSetId("v1");
  const variantDir = resolve(work, "variant");
  writeVariant(seeded, variantDir);
  const candidate = resolve(work, "candidate");
  cpSync(variantDir, candidate, { recursive: true });
  return { work, artifacts, variantDir, candidate, seeded };
}

describe("bugfix provenance freshness", () => {
  it("accepts current bugfix bindings and rejects stale registry, set, or variant hashes", async () => {
    const run = prepareBugfixRun();
    try {
      writeFileSync(resolve(run.artifacts, "gate.json"), '{"typecheck":false,"build":false}\n');
      writeFileSync(resolve(run.artifacts, "collection.json"), '{"valid":true,"status":"blocked_by_gate"}\n');
      const setPath = resolve(run.artifacts, "bug-set.json");
      writeFileSync(setPath, readFileSync(setFileHash("v1").path));
      const current = schema5BugfixProvenance({
        variantDir: run.variantDir,
        candidate: run.candidate,
        runId: "meta-bugfix-prov",
        setSha256: setFileHash("v1").sha256,
        registrySha: (await import("../../bugfix/registry.js")).registryHash(),
        variantSha: run.seeded.manifest.variant_sha256,
      });

      const cases = [
        { name: "current", provenance: current, reason: undefined },
        { name: "stale registry", provenance: { ...current, registry_sha256: "0".repeat(64) }, reason: "bug registry changed since this run executed" },
        { name: "stale set", provenance: { ...current, bug_set_sha256: "0".repeat(64) }, reason: "bug-set hash does not match the run's bug-set file" },
        { name: "stale variant", provenance: { ...current, variant_sha256: "0".repeat(64) }, reason: "variant tree changed since this run executed" },
        { name: "missing set id", provenance: { ...current, bug_set_id: "" }, reason: "bugfix provenance lacks bug_set_id" },
      ];
      for (const testCase of cases) {
        writeFileSync(resolve(run.artifacts, "provenance.json"), `${JSON.stringify(testCase.provenance)}\n`);
        const record = await buildScoreRecord({
          candidate: run.candidate,
          artifacts: run.artifacts,
          variant: run.variantDir,
          track: "bugfix",
          runId: "meta-bugfix-prov",
          model: MODEL,
          arm: ARM,
        });
        if (!testCase.reason) {
          expect(record, testCase.name).toMatchObject({ valid: true, provenance_valid: true, suite_current: true });
          expect(record.track).toBe("bugfix");
        } else {
          expect(record, testCase.name).toMatchObject({ valid: false, provenance_valid: false, total: null });
          expect(record.invalid_reasons).toContain(testCase.reason);
        }
      }
    } finally {
      rmSync(run.work, { recursive: true, force: true });
    }
  }, 120_000);

  it("rejects a build-track provenance record on a bugfix run", async () => {
    const run = prepareBugfixRun();
    try {
      writeFileSync(resolve(run.artifacts, "gate.json"), '{"typecheck":false,"build":false}\n');
      writeFileSync(resolve(run.artifacts, "collection.json"), '{"valid":true,"status":"blocked_by_gate"}\n');
      const setPath = resolve(run.artifacts, "bug-set.json");
      writeFileSync(setPath, readFileSync(setFileHash("v1").path));
      const current = schema5BugfixProvenance({
        variantDir: run.variantDir,
        candidate: run.candidate,
        runId: "meta-bugfix-prov",
        setSha256: setFileHash("v1").sha256,
        registrySha: (await import("../../bugfix/registry.js")).registryHash(),
        variantSha: run.seeded.manifest.variant_sha256,
      });
      writeFileSync(resolve(run.artifacts, "provenance.json"), `${JSON.stringify({ ...current, track: "build" })}\n`);
      const record = await buildScoreRecord({
        candidate: run.candidate,
        artifacts: run.artifacts,
        variant: run.variantDir,
        track: "bugfix",
        runId: "meta-bugfix-prov",
        model: MODEL,
        arm: ARM,
      });
      expect(record).toMatchObject({ valid: false, provenance_valid: false });
      expect(record.invalid_reasons).toContain("provenance track does not match this grading invocation");
    } finally {
      rmSync(run.work, { recursive: true, force: true });
    }
  }, 120_000);

  it("never leaks the variant manifest into the candidate tree", async () => {
    const run = prepareBugfixRun();
    try {
      expect(basename(run.artifacts)).toBe("artifacts");
      expect(existsSync(resolve(run.variantDir, "bug-manifest.json"))).toBe(false);
      expect(existsSync(resolve(run.variantDir, "variant.json"))).toBe(false);
    } finally {
      rmSync(run.work, { recursive: true, force: true });
    }
  });
});
