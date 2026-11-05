import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The rescore guard of D3 (spec FR-3).
 *
 * The rescore reads the track of the run first. A tests-track run launches no
 * browser, so it passes the guard. A build, bugfix, or change run passes only
 * with a record whose channel is chrome. Any other run prints one SKIP line
 * and keeps every byte of its score.json.
 *
 * The test uses a temp tree only. It never reads the real runs/ tree, it
 * launches no browser, and it calls no model.
 */

const HARNESS = resolve(import.meta.dirname, "..");
const DOCTOR = join(HARNESS, "rescore-doctor.sh");

const SCORE = JSON.stringify({
  schema: 3, track: "build", run_id: "a-old-model-2026w43-r1", model: "opencode-go/test-model",
  arm: "a", valid: true, trusted: true, publishable: true, rankable: true, total: 42,
  axes: { quality: 1 }, adherence: { contract: 1 },
}) + "\n";

type RunSpec = { id: string; track: string; record: boolean };

/** The stub of the harness tools. The rescore runs no test and calls no model. */
function tsxStub(): string {
  return `#!/usr/bin/env bash
case "$(basename "$1")" in
  provenance.ts) printf 'runner-hash suite-hash\\n' ;;
  score.ts) printf '{"valid":true,"total":90,"axes":{"quality":1},"adherence":{"contract":1}}\\n' ;;
  *) exit 0 ;;
esac
`;
}

function writeRun(repo: string, spec: RunSpec): void {
  const dir = join(repo, "runs", spec.id);
  const artifacts = join(dir, "artifacts");
  mkdirSync(artifacts, { recursive: true });
  mkdirSync(join(dir, "candidate"), { recursive: true });
  mkdirSync(join(dir, "variant"), { recursive: true });
  writeFileSync(join(artifacts, "provenance.json"), JSON.stringify({
    executor: { kind: "opencode" }, model: "opencode-go/test-model", arm: "a",
    mode: "default", track: spec.track, fixture_revision: 1,
  }) + "\n");
  writeFileSync(join(artifacts, "results.json"), "{}\n");
  writeFileSync(join(artifacts, "execution-identity.json"), "{}\n");
  writeFileSync(join(artifacts, "executor-cohort.json"), "{}\n");
  writeFileSync(join(artifacts, "score.json"), SCORE);
  if (spec.record) {
    writeFileSync(join(artifacts, "grader-browser.json"), JSON.stringify({
      schema: 1, channel: "chrome", version: "153.0.8010.52",
    }) + "\n");
  }
}

function fixture(specs: RunSpec[]) {
  const root = mkdtempSync(join(tmpdir(), "rescore-guard-"));
  const repo = join(root, "repo");
  const harness = join(repo, "harness");
  mkdirSync(join(harness, "node_modules", ".bin"), { recursive: true });
  mkdirSync(join(repo, "fixture"), { recursive: true });
  writeFileSync(join(harness, "rescore-doctor.sh"), readFileSync(DOCTOR));
  writeFileSync(join(harness, "node_modules", ".bin", "tsx"), tsxStub(), { mode: 0o755 });
  for (const spec of specs) writeRun(repo, spec);
  return { root, repo };
}

function rescore(repo: string) {
  return spawnSync("bash", [join(repo, "harness", "rescore-doctor.sh")], {
    cwd: repo, env: { ...process.env, WEEK: "all" }, encoding: "utf8", timeout: 60_000,
  });
}

/** The name and the bytes of every file of one tree. */
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string, prefix: string) => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (statSync(full).isDirectory()) {
        out.push(`dir ${rel}`);
        walk(full, rel);
      } else {
        const hash = createHash("sha256").update(readFileSync(full)).digest("hex");
        out.push(`file ${rel} ${hash}`);
      }
    }
  };
  walk(dir, "");
  return out;
}

describe("the rescore guard of D3", () => {
  it("skips a build run without the record and keeps its bytes", () => {
    const id = "a-old-model-2026w43-r1";
    const { root, repo } = fixture([{ id, track: "build", record: false }]);
    try {
      const run = join(repo, "runs", id);
      const before = snapshot(run);
      const result = rescore(repo);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const skips = result.stdout.split(/\r?\n/).filter((line) => line.startsWith("SKIP "));
      expect(skips).toEqual([`SKIP ${id} (graded before the system Chrome move; regrade needed)`]);
      expect(snapshot(run)).toEqual(before);
      expect(readFileSync(join(run, "artifacts", "score.json"), "utf8")).toBe(SCORE);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("passes a build run with a chrome record", () => {
    const id = "a-new-model-2026w43-r1";
    const { root, repo } = fixture([{ id, track: "build", record: true }]);
    try {
      const result = rescore(repo);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const lines = result.stdout.split(/\r?\n/).filter(Boolean);
      expect(lines.filter((line) => line.startsWith("SKIP "))).toEqual([]);
      expect(lines.some((line) => line.startsWith(`OK   ${id}`))).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("passes a tests-track run", () => {
    const id = "tt-a-tests-model-2026w43-r1";
    const { root, repo } = fixture([{ id, track: "tests", record: false }]);
    try {
      const result = rescore(repo);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const lines = result.stdout.split(/\r?\n/).filter(Boolean);
      expect(lines.filter((line) => line.startsWith("SKIP "))).toEqual([]);
      expect(lines.some((line) => line.startsWith(`OK   ${id}`))).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
