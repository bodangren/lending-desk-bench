import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const HARNESS = resolve(ROOT, "harness");

describe("runner safety contract", () => {
  it("rejects unsafe run IDs before destructive candidate setup", () => {
    const run = readFileSync(resolve(HARNESS, "run.sh"), "utf8");
    const validation = run.search(/validate[_-]?run[_-]?id|RUN_ID_PATTERN/i);
    const cleanup = run.indexOf('rm -rf "$WORK"');
    expect(validation, "run.sh needs an explicit run-id validator").toBeGreaterThanOrEqual(0);
    expect(validation, "validate the ID before candidate cleanup").toBeLessThan(cleanup);
  });

  it("uses the shared allowlist and protected-fixture contract in both run paths", () => {
    const run = readFileSync(resolve(HARNESS, "run.sh"), "utf8");
    const grade = readFileSync(resolve(HARNESS, "grade.sh"), "utf8");
    const contract = readFileSync(resolve(HARNESS, "candidate-contract.ts"), "utf8");
    expect(run).toMatch(/candidate-contract\.ts/);
    expect(grade).toMatch(/candidate-contract\.ts/);
    expect(contract).toMatch(/WRITABLE_CANDIDATE_PATHS/);
    expect(contract).toMatch(/fixture_protected_sha256/);
  });

  it("rejects a protected-file mutation through the executable candidate contract", () => {
    const temp = mkdtempSync(resolve(tmpdir(), "lending-desk-contract-"));
    const candidate = resolve(temp, "candidate");
    const fixture = resolve(ROOT, "fixture");
    cpSync(fixture, candidate, {
      recursive: true,
      filter: (source) => {
        const name = basename(source);
        return ![".git", "node_modules", ".next"].includes(name) && !source.endsWith(".tsbuildinfo");
      },
    });
    const protectedFile = resolve(candidate, "src/db/index.ts");
    writeFileSync(protectedFile, `${readFileSync(protectedFile, "utf8")}\n// contract mutation\n`);
    const result = spawnSync(
      resolve(HARNESS, "node_modules/.bin/tsx"),
      [resolve(HARNESS, "candidate-contract.ts"), fixture, candidate],
      { cwd: HARNESS, encoding: "utf8" },
    );
    try {
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(3);
      const contract = JSON.parse(result.stdout);
      expect(contract.valid).toBe(false);
      expect(contract.reasons).toContain("candidate modified protected fixture files");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }, 60_000);

  it("standalone grade rejects a protected candidate mutation before gate or suites", () => {
    const work = mkdtempSync(resolve(ROOT, "runs", "grade-protected-"));
    const runId = basename(work);
    const candidate = resolve(work, "candidate");
    const fixture = resolve(ROOT, "fixture");
    cpSync(fixture, candidate, {
      recursive: true,
      filter: (source) => {
        const name = basename(source);
        return ![".git", "node_modules", ".next"].includes(name) && !source.endsWith(".tsbuildinfo");
      },
    });
    symlinkSync(resolve(fixture, "node_modules"), resolve(candidate, "node_modules"), "dir");
    const protectedFile = resolve(candidate, "src/db/index.ts");
    writeFileSync(protectedFile, `${readFileSync(protectedFile, "utf8")}\n// standalone grade mutation\n`);
    const result = spawnSync(
      resolve(HARNESS, "grade.sh"),
      [runId, "meta/protected", "a", "0"],
      {
        cwd: HARNESS,
        encoding: "utf8",
        env: {
          ...process.env,
          API_PORT: "38081",
          E2E_PORT: "38082",
        },
      },
    );
    try {
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(4);
      const contract = JSON.parse(readFileSync(resolve(work, "artifacts/candidate-contract.json"), "utf8"));
      expect(contract.valid).toBe(false);
      const score = JSON.parse(readFileSync(resolve(work, "artifacts/score.json"), "utf8"));
      expect(score).toMatchObject({ valid: false, total: null, provenance_valid: false, suite_current: false });
      expect(score.invalid_reasons).toContain("candidate filesystem contract failed");
      expect(existsSync(resolve(work, "artifacts/gate.json"))).toBe(false);
      expect(existsSync(resolve(work, "artifacts/unit-raw.json"))).toBe(false);
      expect(existsSync(resolve(work, "artifacts/api-raw.json"))).toBe(false);
      expect(existsSync(resolve(work, "artifacts/e2e-raw.json"))).toBe(false);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60_000);

  it("rejects missing raw reports instead of collecting an empty score record", () => {
    const temp = mkdtempSync(resolve(tmpdir(), "lending-desk-collect-"));
    const dest = resolve(temp, "results.json");
    const result = spawnSync(
      resolve(HARNESS, "node_modules/.bin/tsx"),
      [resolve(HARNESS, "collect.ts"), "missing-unit.json", "missing-api.json", "missing-e2e.json", "missing-error.json", dest],
      { cwd: temp, encoding: "utf8" },
    );
    try {
      expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0);
      expect(existsSync(dest)).toBe(false);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
  it("rejects duplicate result IDs instead of overwriting either report", () => {
    const temp = mkdtempSync(resolve(tmpdir(), "lending-desk-duplicate-results-"));
    const unit = resolve(temp, "unit.json");
    const api = resolve(temp, "api.json");
    const e2e = resolve(temp, "e2e.json");
    const e2eError = resolve(temp, "e2e-error.json");
    writeFileSync(unit, JSON.stringify({ testResults: [{ name: "unit", assertionResults: [{ title: "G.get200", status: "passed" }] }] }));
    writeFileSync(api, JSON.stringify({ testResults: [{ name: "api", assertionResults: [{ title: "G.get200", status: "failed" }] }] }));
    writeFileSync(e2e, JSON.stringify({ suites: [] }));
    writeFileSync(e2eError, JSON.stringify({ suites: [] }));
    const dest = resolve(temp, "results.json");
    const result = spawnSync(
      resolve(HARNESS, "node_modules/.bin/tsx"),
      [resolve(HARNESS, "collect.ts"), unit, api, e2e, e2eError, dest],
      { cwd: temp, encoding: "utf8" },
    );
    try {
      expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0);
      expect(result.stderr).toContain("duplicate result id G.get200");
      expect(existsSync(dest)).toBe(false);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("emits an explicit provenance_valid boolean on every score record", async () => {
    const { buildScoreRecord } = await import("../../score");
    const temp = mkdtempSync(resolve(tmpdir(), "lending-desk-score-"));
    writeFileSync(resolve(temp, "gate.json"), '{"typecheck":false,"build":false}\n');
    writeFileSync(resolve(temp, "provenance.json"), '{}\n');
    try {
      const score = await buildScoreRecord({
        candidate: resolve(ROOT, "fixture"),
        artifacts: temp,
        runId: "meta-score",
        model: "meta",
        arm: "b",
      });
      expect(typeof score.provenance_valid).toBe("boolean");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }, 60_000);

  it("keeps AGENTS.md available in Arm B", () => {
    const run = readFileSync(resolve(HARNESS, "run.sh"), "utf8");
    const armB = run.match(/^\s*b\)\n([\s\S]*?)^\s*;;/m)?.[1];
    // The writable candidate-root mount carries fixture/AGENTS.md into /workspace.
    expect(run).toContain('--mount "type=bind,src=$CAND,dst=/workspace,rw"');
    expect(armB, "Arm B block is missing").toBeDefined();
    expect(armB).not.toContain("--no-context-files");
  });
});
