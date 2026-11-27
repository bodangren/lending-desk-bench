/**
 * docs-and-ops grader contract (Red for track guide_docs_ops_20261127 task 1.3).
 *
 * Pinned module contract for `harness/docs-and-ops/grade-docs-ops.ts`:
 *   PRIMARY_AXES    ["documentation", "operations"]
 *   SECONDARY_AXES  ["adherence", "quality"]
 *   gateSecondary(mean: number): number — gates adherence and quality on the
 *     mean of the primary axes; 1 stays 1 and 0 stays 0.
 *   declaredCheckIds(): string[] — every documentation and verifier check id;
 *     each id matches /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.
 *   resultIdsValid(ids: string[]): boolean — false when any id is malformed.
 *   gradeRunbook(text: string): { passed, failed, reasons } — the oracle
 *     runbook passes; an empty or placeholder-carrying runbook fails on its
 *     declared checks (required sections, repository commands, route names,
 *     placeholder rejection).
 *   gradeVerifier(input: { manifest, resultJson, exitCode, cleanEnv, timedOut })
 *     : { passed, failed, reasons } — a non-zero exit, a dirty environment,
 *     a timeout, or a malformed manifest fails; identical inputs give
 *     identical outputs (deterministic); reasons come back sorted.
 *
 * Every test fails while the track is missing: the grader module does not
 * exist and the oracle overlay it reads is absent.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HARNESS = resolve(import.meta.dirname, "../..");
const ORACLE_RUNBOOK = join(HARNESS, "docs-and-ops", "oracle-overlay", "docs", "runbook.md");
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

type Grade = { passed: boolean; failed: string[]; reasons: string[] };

async function grader(): Promise<{
  PRIMARY_AXES: unknown;
  SECONDARY_AXES: unknown;
  gateSecondary: (mean: number) => number;
  declaredCheckIds: () => string[];
  resultIdsValid: (ids: string[]) => boolean;
  gradeRunbook: (text: string) => Grade;
  gradeVerifier: (input: {
    manifest: string;
    resultJson: string;
    exitCode: number;
    cleanEnv: boolean;
    timedOut: boolean;
  }) => Grade;
}> {
  return import("../../docs-and-ops/grade-docs-ops.js");
}

describe("docs-and-ops grader contract", () => {
  it("loads the docs-and-ops grader module", async () => {
    expect(await grader(), "grade-docs-ops.ts loads").toBeDefined();
  });

  it("grades documentation and operations as the primary axes", async () => {
    const mod = await grader();
    expect(mod.PRIMARY_AXES).toEqual(["documentation", "operations"]);
    expect(mod.SECONDARY_AXES).toEqual(["adherence", "quality"]);
  });

  it("gates adherence and quality on the mean of the primary axes", async () => {
    const mod = await grader();
    expect(mod.gateSecondary(1), "a perfect primary mean keeps full secondary").toBe(1);
    expect(mod.gateSecondary(0), "a zero primary mean gates secondary to zero").toBe(0);
  });

  it("declares well-formed check ids and rejects malformed result ids", async () => {
    const mod = await grader();
    const ids = mod.declaredCheckIds();
    expect(ids.length, "the grader declares checks").toBeGreaterThan(0);
    for (const id of ids) expect(id, `check id ${id}`).toMatch(ID_RE);
    expect(mod.resultIdsValid(ids), "declared ids validate").toBe(true);
    expect(mod.resultIdsValid(["!!! not an id"]), "a malformed id invalidates the run").toBe(false);
  });

  it("passes the oracle runbook", async () => {
    const mod = await grader();
    expect(existsSync(ORACLE_RUNBOOK), "the oracle runbook exists").toBe(true);
    const grade = mod.gradeRunbook(readFileSync(ORACLE_RUNBOOK, "utf8"));
    expect(grade.failed, `oracle failures: ${grade.reasons.join("; ")}`).toEqual([]);
    expect(grade.passed).toBe(true);
  });

  it("fails a runbook that is empty or carries placeholders on declared checks", async () => {
    const mod = await grader();
    const declared = mod.declaredCheckIds();
    const oracle = readFileSync(ORACLE_RUNBOOK, "utf8");
    for (const [tag, text] of [["empty", ""], ["placeholder", `${oracle}\nTODO: fill this in\n`]] as Array<
      [string, string]
    >) {
      const grade = mod.gradeRunbook(text);
      expect(grade.passed, `${tag} runbook passes`).toBe(false);
      expect(grade.failed.length, `${tag} runbook names failed checks`).toBeGreaterThan(0);
      for (const id of grade.failed) {
        expect(declared, `${tag} failure ${id} is a declared check`).toContain(id);
      }
    }
  });

  it("fails the verifier on exit codes, a dirty environment, a timeout, and a malformed manifest", async () => {
    const mod = await grader();
    const base = {
      manifest: "{}",
      resultJson: "{}",
      exitCode: 0,
      cleanEnv: true,
      timedOut: false,
    };
    for (const [tag, input] of [
      ["exit code", { ...base, exitCode: 1 }],
      ["dirty environment", { ...base, cleanEnv: false }],
      ["timeout", { ...base, timedOut: true }],
      ["malformed manifest", { ...base, manifest: "{not json" }],
    ] as Array<[string, typeof base]>) {
      const grade = mod.gradeVerifier(input);
      expect(grade.passed, `verifier passes with ${tag}`).toBe(false);
    }
  });

  it("grades the verifier deterministically with sorted reasons", async () => {
    const mod = await grader();
    const input = { manifest: "{not json", resultJson: "{}", exitCode: 1, cleanEnv: false, timedOut: true };
    const first = mod.gradeVerifier(input);
    const second = mod.gradeVerifier(input);
    expect(first.passed).toBe(false);
    expect(second, "identical inputs grade identically").toEqual(first);
    expect(first.reasons, "reasons come back sorted").toEqual([...first.reasons].sort());
  });
});
