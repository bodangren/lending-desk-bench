/**
 * bench_v2, tests_bench, change_bench: arithmetic, contract classes, graft,
 * schema-6 provenance, and the frozen sets of the two new tracks.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ADVISORY, CHANGE_CRITERIA, CRITERIA, PROBES, SATURATED_WEIGHT } from "../criteria";
import { CHANGE_CONTROLS } from "../sensitivity-controls";
import { applyNegativeControl } from "../negative-controls";
import {
  contractAdherence,
  deriveChangeScoreMetrics,
  deriveScoreMetrics,
  deriveTestsScoreMetrics,
} from "../../score-calculation";
import { assessCandidateContract, graftCandidate, TEST_FILE_LIMITS } from "../../candidate-contract";
import { checkProvenance, graftErrors, PROVENANCE_SCHEMA } from "../../provenance-check";
import { contractScore, declaredIds, killId } from "../../track-scoring";
import { loadMutantSet, setMutants, validateMutantSet } from "../../tests-track/set-loader";
import { generateTestsVariant, testsTreeFiles } from "../../tests-track/make-variant";
import { CHANGE_REQUESTS, loadChangeSet, requestCriteria, setChangeCriteria, validateChangeSet } from "../../change/requests";
import { generateChangeVariant } from "../../change/make-variant";
import { treeHash, writeVariant } from "../../bugfix/make-variant";
import { currentHashes } from "../../provenance";
import { FIXTURE_REVISION } from "../../revisions";
import { currentSchema4Provenance } from "./schema4-fixtures";

const ROOT = resolve(import.meta.dirname, "../../..");
const FIXTURE = resolve(ROOT, "fixture");
const cleanDoctor = () => ({ ok: true, errors: 0, warnings: 0, byCategory: {}, byRule: {}, diagnostics: [] });
const allPass = () => Object.fromEntries(
  [...Object.keys(CRITERIA), ...Object.keys(PROBES), ...ADVISORY].map((id) => [id, true]),
) as Record<string, boolean>;

function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "bench-v2-candidate-"));
  cpSync(FIXTURE, dir, {
    recursive: true,
    filter: (source) => ![".git", "node_modules", ".next"].includes(basename(source)) && !source.endsWith(".tsbuildinfo"),
  });
  return dir;
}

describe("bench_v2 build arithmetic", () => {
  it("weighs saturated criteria at a quarter inside completion", () => {
    const saturated = Object.entries(CRITERIA).filter(([, c]) => c.weight === SATURATED_WEIGHT);
    expect(saturated.map(([id]) => id).sort()).toEqual([
      "A.boundary", "A.due-soon", "A.ok", "A.overdue", "A.returned",
      "B.badge", "B.image-alt", "B.image-response", "B.link", "B.name-category",
      "C.empty", "C.filter-both", "C.filter-case", "C.filter-category", "C.filter-q",
      "C.renders", "C.renders-all",
    ]);
    const lostSaturated = deriveScoreMetrics({ ...allPass(), "C.filter-q": false }, cleanDoctor(), 0).axes.completion;
    const lostNormal = deriveScoreMetrics({ ...allPass(), "E.optimistic": false }, cleanDoctor(), 0).axes.completion;
    expect(1 - lostSaturated).toBeCloseTo((1 - lostNormal) * SATURATED_WEIGHT, 9);
  });

  it("moves the Measure closeout from completion into adherence", () => {
    const metrics = deriveScoreMetrics({ ...allPass(), "M.closeout": false }, cleanDoctor(), 0);
    expect(metrics.axes.completion).toBe(1);
    expect(metrics.axes.adherence).toBeCloseTo(0.5 + 0.5 * (2 / 3), 9);
    expect(metrics.raw).toBeCloseTo(100 - 15 * 0.5 / 3, 9);
  });

  it("charges each soft violation class half the contract score", () => {
    expect(contractAdherence([])).toBe(1);
    expect(contractAdherence(["files_added"])).toBe(0.5);
    expect(contractAdherence(["files_added", "files_added"])).toBe(0.5);
    expect(contractAdherence(["files_added", "protected_modified"])).toBe(0);
    expect(contractAdherence(["files_added", "protected_modified", "surface_changed"])).toBe(0);
    const metrics = deriveScoreMetrics(allPass(), cleanDoctor(), 0, contractAdherence(["surface_changed"]));
    expect(metrics.axes.adherence).toBeCloseTo(0.75, 9);
  });

  it("scores a record only on the criteria its fixture revision states", () => {
    const newer = Object.entries(CRITERIA).filter(([, c]) => (c.since ?? 1) > 1).map(([id]) => id).sort();
    expect(newer).toEqual(["E.error-announced", "E.labels"]);
    const missed = { ...allPass(), "E.labels": false, "E.error-announced": false };
    expect(deriveScoreMetrics(missed, cleanDoctor(), 0, 1, 1).raw).toBeCloseTo(100, 9);
    expect(deriveScoreMetrics(missed, cleanDoctor(), 0, 1, 2).raw).toBeLessThan(100);
  });

  it("gives an untouched candidate no adherence points", () => {
    const empty = Object.fromEntries(Object.keys(allPass()).map((id) => [id, id === "M.metadata-valid"]));
    const metrics = deriveScoreMetrics(empty, cleanDoctor(), 0);
    expect(metrics.axes.completion).toBe(0);
    expect(metrics.axes.adherence).toBe(0);
    expect(metrics.axes.quality).toBe(0);
  });
});

describe("change and tests arithmetic", () => {
  const changeIds = Object.keys(CHANGE_CRITERIA);

  it("scores a complete change at 100 and an untouched variant near 35", () => {
    const done = deriveChangeScoreMetrics({
      passed: { ...allPass(), ...Object.fromEntries(changeIds.map((id) => [id, true])) },
      changeIds, doctorReport: cleanDoctor(), penalty: 0,
    });
    expect(done.raw).toBeCloseTo(100, 9);
    const untouched = deriveChangeScoreMetrics({
      passed: { ...allPass(), ...Object.fromEntries(changeIds.map((id) => [id, false])) },
      changeIds, doctorReport: cleanDoctor(), penalty: 0,
    });
    expect(untouched.axes.change).toBe(0);
    expect(untouched.axes.adherence).toBe(0);
    expect(untouched.axes.quality).toBe(0);
    expect(untouched.raw).toBeCloseTo(35, 9);
    expect(untouched.change.request_rates).toEqual({ "CR-1": 0, "CR-2": 0, "CR-3": 0, "CR-4": 0 });
  });

  it("weighs security kills double and scores an empty suite at zero", () => {
    const mutants = [{ id: "m-fn", class: "functional" }, { id: "m-sec", class: "security" }];
    const onlySecurity = deriveTestsScoreMetrics({
      kills: { "m-sec": true }, mutants, tests: { total: 4, valid: 4 }, doctorReport: cleanDoctor(), penalty: 0,
    });
    expect(onlySecurity.axes.kill).toBeCloseTo(2 / 3, 9);
    const all = deriveTestsScoreMetrics({
      kills: { "m-sec": true, "m-fn": true }, mutants, tests: { total: 4, valid: 4 }, doctorReport: cleanDoctor(), penalty: 0,
    });
    expect(all.raw).toBeCloseTo(100, 9);
    const none = deriveTestsScoreMetrics({
      kills: {}, mutants, tests: { total: 0, valid: 0 }, doctorReport: cleanDoctor(), penalty: 0,
    });
    expect(none.axes).toMatchObject({ kill: 0, validity: 0, adherence: 0, quality: 0 });
    expect(none.raw).toBe(0);
  });

  it("declares the right result ids per track", () => {
    const product = Object.keys(CRITERIA).filter((id) => !id.startsWith("M."));
    expect(declaredIds({ track: "build" })).toHaveLength(Object.keys(CRITERIA).length + Object.keys(PROBES).length + ADVISORY.length);
    expect(declaredIds({ track: "bugfix", bugs: [] })).toHaveLength(product.length + Object.keys(PROBES).length + ADVISORY.length);
    expect(declaredIds({ track: "change", changeIds, superseded: [] })).toEqual(
      [...product, ...Object.keys(PROBES), ...ADVISORY, ...changeIds].sort(),
    );
    expect(declaredIds({ track: "tests", mutants: [{ id: "BUG-x", class: "functional" }], tests: { total: 0, valid: 0 } }))
      .toEqual([killId("BUG-x")]);
  });
});

describe("contract classes and graft", () => {
  it("classifies added files and protected edits as soft, and grafts them away", () => {
    const candidate = copyFixture();
    const grafted = mkdtempSync(join(tmpdir(), "bench-v2-graft-"));
    try {
      writeFileSync(join(candidate, "src/lib/extra.ts"), "export const extra = 1;\n");
      writeFileSync(join(candidate, "src/db/seed.ts"), readFileSync(join(candidate, "src/db/seed.ts"), "utf8") + "\n// edit\n");
      writeFileSync(join(candidate, "src/lib/loans.ts"), readFileSync(join(candidate, "src/lib/loans.ts"), "utf8") + "\n// agent work\n");
      const contract = assessCandidateContract(FIXTURE, candidate);
      expect(contract).toMatchObject({ valid: false, gradeable: false, hard: [] });
      expect(contract.soft).toEqual(["files_added", "protected_modified"]);
      const copied = graftCandidate(FIXTURE, candidate, grafted, "build");
      expect(copied).toContain("src/lib/loans.ts");
      expect(copied).not.toContain("src/lib/extra.ts");
      const after = assessCandidateContract(FIXTURE, grafted);
      expect(after).toMatchObject({ valid: true, gradeable: true, soft: [], hard: [] });
      expect(readFileSync(join(grafted, "src/lib/loans.ts"), "utf8")).toContain("// agent work");
    } finally {
      rmSync(candidate, { recursive: true, force: true });
      rmSync(grafted, { recursive: true, force: true });
    }
  });

  it("grades a changed export as is, and keeps a symlink invalid", () => {
    const candidate = copyFixture();
    try {
      writeFileSync(join(candidate, "src/lib/loans.ts"),
        readFileSync(join(candidate, "src/lib/loans.ts"), "utf8") + "\nexport const extraHelper = 1;\n");
      const surface = assessCandidateContract(FIXTURE, candidate);
      expect(surface).toMatchObject({ valid: false, gradeable: true, soft: ["surface_changed"], hard: [] });
      symlinkSync("/etc/hostname", join(candidate, "app/link.txt"));
      const linked = assessCandidateContract(FIXTURE, candidate);
      expect(linked.hard).toContain("unsafe_entry");
      expect(linked.gradeable).toBe(false);
    } finally {
      rmSync(candidate, { recursive: true, force: true });
    }
  });

  it("lets the tests track add test files and nothing else", () => {
    const root = mkdtempSync(join(tmpdir(), "bench-v2-tests-root-"));
    const candidate = mkdtempSync(join(tmpdir(), "bench-v2-tests-cand-"));
    try {
      const files = testsTreeFiles();
      writeVariant({ files }, root);
      writeVariant({ files }, candidate);
      mkdirSync(join(candidate, "tests"), { recursive: true });
      writeFileSync(join(candidate, "tests", "api.test.ts"), "import { it } from \"vitest\";\nit(\"x\", () => {});\n");
      const clean = assessCandidateContract(root, candidate, { track: "tests" });
      expect(clean).toMatchObject({ valid: true, gradeable: true });
      writeFileSync(join(candidate, "tests", "helper.ts"), "export const x = 1;\n");
      expect(assessCandidateContract(root, candidate, { track: "tests" }).soft).toEqual(["files_added"]);
      rmSync(join(candidate, "tests", "helper.ts"));
      for (let index = 0; index < TEST_FILE_LIMITS.files; index += 1) {
        writeFileSync(join(candidate, "tests", `extra-${index}.test.ts`), "export {};\n");
      }
      expect(assessCandidateContract(root, candidate, { track: "tests" }).soft).toEqual(["test_limits"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(candidate, { recursive: true, force: true });
    }
  });
});

describe("schema-6 provenance", () => {
  it("rejects an invalid fixture revision and a malformed graft", () => {
    expect(graftErrors(null)).toEqual([]);
    expect(graftErrors({ reason: "regrade", from_candidate_sha256: "a".repeat(64), from_fixture_revision: 1 })).toEqual([]);
    expect(graftErrors({ reason: "other", from_candidate_sha256: "x", from_fixture_revision: 0 })).toHaveLength(3);
    const candidate = copyFixture();
    try {
      const provenance = currentSchema4Provenance({
        fixture: FIXTURE, candidate, runId: "meta-v2", model: "meta/v2", arm: "a", mode: "overlay",
      }) as Record<string, unknown>;
      expect(provenance.schema).toBe(PROVENANCE_SCHEMA);
      const contract = assessCandidateContract(FIXTURE, candidate);
      const check = (patch: Record<string, unknown>) => checkProvenance({
        provenance: { ...provenance, ...patch }, hashes: currentHashes(), runId: "meta-v2", model: "meta/v2", arm: "a",
        track: "build", contract, artifacts: candidate, comparisonRoot: FIXTURE,
      });
      expect(check({}).current).toBe(true);
      expect(check({ fixture_revision: FIXTURE_REVISION + 1 }).reasons).toContain("provenance fixture revision is invalid");
      expect(check({ graft: { reason: "regrade" } }).current).toBe(false);
      expect(check({ schema: 5 }).reasons).toContain("runner or suite provenance does not match this score implementation");
    } finally {
      rmSync(candidate, { recursive: true, force: true });
    }
  }, 60_000);

  it("binds contract-violation.json by hash", () => {
    const artifacts = mkdtempSync(join(tmpdir(), "bench-v2-artifacts-"));
    const candidate = copyFixture();
    try {
      const contract = assessCandidateContract(FIXTURE, candidate);
      const record = JSON.stringify({ soft: ["files_added"] });
      writeFileSync(join(artifacts, "contract-violation.json"), record);
      const sha = createHash("sha256").update(record).digest("hex");
      expect(contractScore(artifacts, contract, { contract_violation_sha256: sha })).toEqual({ score: 0.5, classes: ["files_added"], reasons: [] });
      expect(contractScore(artifacts, contract, { contract_violation_sha256: null }).reasons)
        .toContain("contract-violation.json does not match provenance");
      rmSync(join(artifacts, "contract-violation.json"));
      expect(contractScore(artifacts, contract, { contract_violation_sha256: sha }).reasons)
        .toContain("provenance names a contract violation record that is missing");
    } finally {
      rmSync(artifacts, { recursive: true, force: true });
      rmSync(candidate, { recursive: true, force: true });
    }
  });
});

describe("tests_bench and change_bench sets", () => {
  it("freezes mutant set m1: 12 mutants, every anchor applies to the clean app", () => {
    const set = loadMutantSet("m1");
    expect(validateMutantSet(set)).toEqual([]);
    const mutants = setMutants(set);
    expect(mutants).toHaveLength(12);
    const classes = mutants.reduce<Record<string, number>>((acc, m) => ({ ...acc, [m.class]: (acc[m.class] ?? 0) + 1 }), {});
    expect(classes).toEqual({ functional: 7, security: 3, reliability: 2 });
    for (const mutant of mutants) {
      expect(() => testsTreeFiles({ mutant }), mutant.id).not.toThrow();
    }
  });

  it("generates the tests and change variants deterministically", () => {
    expect(generateTestsVariant("m1").manifest.variant_sha256).toBe(generateTestsVariant("m1").manifest.variant_sha256);
    const change = generateChangeVariant("c1");
    expect(change.manifest.variant_sha256).toBe(generateChangeVariant("c1").manifest.variant_sha256);
    expect(change.manifest.variant_sha256).toBe(treeHash(change.files));
    const spec = change.files.get("measure/tracks/lending_desk_change/spec.md") ?? "";
    for (const request of CHANGE_REQUESTS) expect(spec).toContain(request.id);
    expect(change.files.has("measure/tracks/lending_desk/spec.md")).toBe(false);
    const testsSpec = generateTestsVariant("m1").files.get("measure/tracks/lending_desk_tests/spec.md") ?? "";
    for (const mutant of setMutants(loadMutantSet("m1"))) expect(testsSpec).not.toContain(mutant.id);
  });

  it("freezes change set c1 with a control for every change criterion", () => {
    const set = loadChangeSet("c1");
    expect(validateChangeSet(set)).toEqual([]);
    expect(setChangeCriteria(set).sort()).toEqual(Object.keys(CHANGE_CRITERIA).sort());
    for (const request of CHANGE_REQUESTS) expect(requestCriteria(request.id).length).toBeGreaterThan(0);
    const controlled = new Set(CHANGE_CONTROLS.flatMap((control) => control.expectedFailures));
    expect([...controlled].sort()).toEqual(Object.keys(CHANGE_CRITERIA).sort());
    for (const control of CHANGE_CONTROLS) {
      const source = readFileSync(join(ROOT, "reference-change", control.target), "utf8");
      expect(() => applyNegativeControl(source, control), control.id).not.toThrow();
    }
  });
});
