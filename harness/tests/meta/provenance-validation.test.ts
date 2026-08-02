import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assessCandidateContract } from "../../candidate-contract";
import { buildScoreRecord } from "../../score";
import { currentSchema4Provenance } from "./schema4-fixtures";

const ROOT = resolve(import.meta.dirname, "../../..");
const MODEL = "meta/provenance";
const ARM = "b";

describe("schema-4 provenance validation", () => {
  it("invalidates every mismatched provenance binding", async () => {
    const artifacts = mkdtempSync(resolve(tmpdir(), "lending-desk-provenance-"));
    const fixture = resolve(ROOT, "fixture");
    const candidate = resolve(artifacts, "candidate");
    cpSync(fixture, candidate, {
      recursive: true,
      filter: (source) => {
        const name = basename(source);
        return ![".git", "node_modules", ".next"].includes(name) && !source.endsWith(".tsbuildinfo");
      },
    });
    const contract = assessCandidateContract(fixture, candidate);
    expect(contract.valid).toBe(true);
    const current = currentSchema4Provenance({ fixture, candidate, runId: "meta-provenance", model: MODEL, arm: ARM, mode: "overlay" });
    writeFileSync(resolve(artifacts, "gate.json"), '{"typecheck":false,"build":false}\n');
    writeFileSync(resolve(artifacts, "collection.json"), '{"valid":true,"status":"blocked_by_gate"}\n');
    const cases = [
      { name: "current", provenance: current },
      { name: "candidate hash", provenance: { ...current, candidate_sha256: "0".repeat(64) }, reason: "candidate or fixture contract does not match run provenance" },
      { name: "fixture hash", provenance: { ...current, fixture_protected_sha256: "0".repeat(64) }, reason: "candidate or fixture contract does not match run provenance" },
      { name: "arm", provenance: { ...current, arm: "a" }, reason: "provenance model or arm does not match this grading invocation" },
      { name: "model", provenance: { ...current, model: "other/model" }, reason: "provenance model or arm does not match this grading invocation" },
      { name: "runner hash", provenance: { ...current, runner_sha256: "0".repeat(64) }, reason: "runner or suite provenance does not match this score implementation" },
      { name: "suite hash", provenance: { ...current, suite_sha256: "0".repeat(64) }, reason: "runner or suite provenance does not match this score implementation" },
      { name: "contract schema", provenance: { ...current, candidate_contract_schema: 2 }, reason: "runner or suite provenance does not match this score implementation" },
    ];
    try {
      for (const testCase of cases) {
        writeFileSync(resolve(artifacts, "provenance.json"), `${JSON.stringify(testCase.provenance)}\n`);
        const score = await buildScoreRecord({
          candidate,
          artifacts,
          runId: "meta-provenance",
          model: MODEL,
          arm: ARM,
        });
        if (!testCase.reason) {
          expect(score, testCase.name).toMatchObject({ valid: true, provenance_valid: true, suite_current: true, total: 0 });
        } else {
          expect(score, testCase.name).toMatchObject({ valid: false, provenance_valid: false, suite_current: false, total: null });
          expect(score.invalid_reasons).toContain(testCase.reason);
        }
      }
    } finally {
      rmSync(artifacts, { recursive: true, force: true });
    }
  });
});
