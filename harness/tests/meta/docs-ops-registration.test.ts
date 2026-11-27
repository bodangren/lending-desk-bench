/**
 * docs-and-ops registration contract (Red for track guide_docs_ops_20261127
 * task 1.4).
 *
 * Every test fails while the track is missing: candidate-contract.ts knows
 * no docs-and-ops track, and no runner, regrade, rescore, or site-export
 * source names it. Green satisfies them by registering the track across the
 * runner and the public track export: BENCH_TRACK=docs-and-ops gives `do-`
 * run IDs, the d1 frozen set, the standard non-build repeat default of one,
 * a browserless grade, and a tracks.json entry.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BENCH_TRACKS, resolveTrack } from "../../candidate-contract.js";

const HARNESS = resolve(import.meta.dirname, "../..");

function source(relative: string): string {
  return readFileSync(join(HARNESS, relative), "utf8");
}

describe("docs-and-ops registration contract", () => {
  it("resolves docs-and-ops as its own benchmark track", () => {
    expect(BENCH_TRACKS as readonly string[], "BENCH_TRACKS lists docs-and-ops").toContain("docs-and-ops");
    expect(resolveTrack("docs-and-ops")).toBe("docs-and-ops");
  });

  it("accepts BENCH_TRACK=docs-and-ops in run.sh and grade.sh", () => {
    expect(source("run.sh")).toContain("docs-and-ops");
    expect(source("grade.sh")).toContain("docs-and-ops");
  });

  it("gives do- run IDs with the standard non-build repeat default in batch.sh", () => {
    const batch = source("batch.sh");
    expect(batch, "batch.sh names the track").toContain("docs-and-ops");
    expect(batch, "docs-and-ops runs carry the do- prefix").toContain('TRACK_PREFIX="do-"');
    expect(batch, "docs-and-ops repeats once by default").toContain("REPS_DOCS_AND_OPS:-1");
  });

  it("runs the docs-and-ops canary through the normal run.sh path in batch.sh", () => {
    expect(source("batch.sh")).toContain("docs-and-ops");
    expect(source("batch.sh")).toMatch(/docs-and-ops\)[^\n]*run\.sh/);
  });

  it("keeps the docs-and-ops grade browserless", () => {
    expect(source("grade.sh")).toContain("docs-and-ops");
    expect(source("rescore-doctor.sh")).toContain("docs-and-ops");
  });

  it("survives regrade and rescore on do- run IDs", () => {
    expect(source("regrade-run.sh")).toContain("do-*)");
    expect(source("regrade-run.sh")).toContain("d1.json");
    expect(source("rescore-doctor.sh")).toContain("do-)");
  });

  it("binds docs-and-ops provenance to the d1 frozen set", () => {
    expect(source("track-bindings.ts")).toContain("docs-and-ops");
    expect(source("provenance.ts")).toContain("docs-and-ops");
  });

  it("lists docs-and-ops in the public tracks export", () => {
    expect(source("export-site-data.py")).toContain("docs-and-ops");
    expect(source("export-site-data.py")).toMatch(/"docs-and-ops":\s*"do-"/);
  });

  it("F7: a dry run plans do- run IDs without executing runs", () => {
    // Behavioral check for the F7 nit (already satisfied: the dry run works
    // and writes nothing under runs/). It pins the registered behavior
    // instead of the batch.sh source strings above.
    const runsDir = resolve(HARNESS, "..", "runs");
    const before = existsSync(runsDir) ? readdirSync(runsDir).sort() : [];
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of ["REPS", "REPS_BUILD", "REPS_BUGFIX", "REPS_TESTS", "REPS_CHANGE", "REPS_DOCS_AND_OPS", "FORCE"]) {
      delete env[key];
    }
    const run = spawnSync("bash", ["batch.sh", "--dry-run", "--model", "grok-4.6"], {
      cwd: HARNESS,
      env: { ...env, BENCH_TRACK: "docs-and-ops", WEEK: "2099w01", ARMS: "a b" },
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(run.status, `F7: the dry run exits 0: ${run.stderr}`).toBe(0);
    expect(run.stdout, "F7: the dry run plans the Arm A do- run ID").toContain("-> do-a-grok-4-6-2099w01-r1");
    expect(run.stdout, "F7: the dry run plans the Arm B do- run ID").toContain("-> do-b-grok-4-6-2099w01-r1");
    const after = existsSync(runsDir) ? readdirSync(runsDir).sort() : [];
    expect(after, "F7: the dry run writes nothing under runs/").toEqual(before);
  }, 180_000);
});
