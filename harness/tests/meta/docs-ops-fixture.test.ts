/**
 * docs-and-ops fixture contract (Red for track guide_docs_ops_20261127 task 1.2).
 *
 * Every test fails while the track is missing: the docs-and-ops builder
 * modules do not exist, candidate-contract.ts knows no docs-and-ops track,
 * and the model-visible sources, the d1 frozen set, and the oracle overlay
 * are absent. Green satisfies them by adding the task 1.2 files; no test
 * pins fixture content beyond the task text.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isWritableForTrack, writablePathsForTrack } from "../../candidate-contract.js";
import { writeVariant } from "../../bugfix/make-variant.js";
import { generateDocsOpsVariant } from "../../docs-and-ops/make-variant.js";

const HARNESS = resolve(import.meta.dirname, "../..");
const ROOT = resolve(HARNESS, "..");
const TRACK_DIR = join(HARNESS, "docs-and-ops");

function readTrackFile(relative: string): string {
  return readFileSync(join(HARNESS, relative), "utf8");
}

describe("docs-and-ops fixture contract", () => {
  it("provides the task builder module", async () => {
    const mod = await import("../../docs-and-ops/tasks.js");
    expect(mod, "docs-and-ops/tasks.js loads").toBeDefined();
  });

  it("provides the variant builder module", async () => {
    const mod = await import("../../docs-and-ops/make-variant.js");
    expect(mod, "docs-and-ops/make-variant.js loads").toBeDefined();
  });

  it("holds the candidate files listed in task 1.2", () => {
    for (const relative of [
      "docs-and-ops/model-visible/AGENTS.md",
      "docs-and-ops/model-visible/track/spec.md",
      "docs-and-ops/model-visible/track/plan.md",
      "docs-and-ops/model-visible/track/metadata.json",
      "docs-and-ops/model-visible/docs/runbook.md",
      "docs-and-ops/model-visible/ops/verify.ts",
    ]) {
      expect(existsSync(join(HARNESS, relative)), `missing ${relative}`).toBe(true);
    }
  });

  it("keeps the runbook and the verifier stub writable for the candidate", () => {
    const writable = writablePathsForTrack("docs-and-ops" as never);
    expect(writable, "docs/runbook.md is writable").toContain("docs/runbook.md");
    expect(writable, "ops/verify.ts is writable").toContain("ops/verify.ts");
    expect(isWritableForTrack("docs-and-ops" as never, "docs/runbook.md")).toBe(true);
    expect(isWritableForTrack("docs-and-ops" as never, "ops/verify.ts")).toBe(true);
  });

  it("ships the d1 frozen set", () => {
    const file = join(TRACK_DIR, "sets", "d1.json");
    expect(existsSync(file), "missing docs-and-ops/sets/d1.json").toBe(true);
    const set = JSON.parse(readFileSync(file, "utf8"));
    expect(set.id, "the frozen set is d1").toBe("d1");
  });

  it("ships the oracle overlay runbook and verifier", () => {
    for (const relative of [
      "docs-and-ops/oracle-overlay/docs/runbook.md",
      "docs-and-ops/oracle-overlay/ops/verify.ts",
    ]) {
      expect(existsSync(join(HARNESS, relative)), `missing ${relative}`).toBe(true);
    }
  });

  it("names the track in the candidate contract sources", () => {
    expect(readTrackFile("candidate-contract.ts")).toContain("docs-and-ops");
  });
});

const F3_ROOTS: string[] = [];
afterAll(() => {
  for (const root of F3_ROOTS) rmSync(root, { recursive: true, force: true });
});

/** The fixed valid manifest, parsed from the candidate spec itself so the
 * F3 case tracks the documented contract instead of a module export the
 * remediation may refactor. The spec shows the schema-1 manifest first. */
function fixedValidManifest(): unknown {
  const spec = readTrackFile("docs-and-ops/model-visible/track/spec.md");
  const blocks = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => match[1]);
  expect(blocks.length, "F3: the spec documents fixed manifests").toBeGreaterThan(0);
  const parsed = blocks.map((block) => JSON.parse(block));
  const valid = parsed.find(
    (value) => typeof value === "object" && value !== null && (value as { schema?: unknown }).schema === 1,
  );
  expect(valid, "F3: the spec documents a schema-1 fixed manifest").toBeDefined();
  return valid;
}

/** The verifier command the candidate spec documents, parsed from the spec
 * itself so the test follows the documented command exactly. */
function documentedVerifierCommand(): string[] {
  const spec = readTrackFile("docs-and-ops/model-visible/track/spec.md");
  const fenced = spec.match(/```bash\n([\s\S]*?)```/);
  expect(fenced, "F3: the spec documents a bash verifier command").not.toBeNull();
  const line = fenced![1].split("\n").find((entry) => entry.includes("ops/verify.ts"));
  expect(line, "F3: the documented command runs ops/verify.ts").toBeDefined();
  return line!.trim().split(/\s+/);
}

describe("review-a F3: the documented verifier command works in a built candidate", () => {
  it("F3: the spec-documented command verifies the fixed manifest after dependency install", () => {
    const candidate = mkdtempSync(join(tmpdir(), "docs-ops-f3-candidate-"));
    F3_ROOTS.push(candidate);
    writeVariant(generateDocsOpsVariant("d1"), candidate);
    cpSync(join(HARNESS, "docs-and-ops", "oracle-overlay"), candidate, { recursive: true });
    // Mirror run.sh: the built candidate carries the installed dependency
    // tree (a symlink stands in for run.sh's cp -a of the 568 MB tree;
    // command resolution through it is identical). No hidden grader
    // fallback may satisfy the documented command.
    symlinkSync(join(ROOT, "fixture", "node_modules"), join(candidate, "node_modules"));
    const manifest = join(candidate, "docs-ops-fixed-valid.json");
    writeFileSync(manifest, `${JSON.stringify(fixedValidManifest(), null, 2)}\n`);
    const template = documentedVerifierCommand();
    const argv = template.map((entry) => (entry === "<manifest-path>" ? manifest : entry));
    const argvWithManifest = argv.some((entry) => entry === manifest) ? argv : [...argv, manifest];
    const run = spawnSync(argvWithManifest[0], argvWithManifest.slice(1), {
      cwd: candidate,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(
      run.error ?? null,
      `F3: the documented command does not run in a built candidate: ${String(run.error ?? "")}`,
    ).toBeNull();
    expect(run.status, `F3: the documented command fails: ${run.stderr}`).toBe(0);
    expect(
      JSON.parse(run.stdout),
      "F3: the documented command prints the valid JSON error array",
    ).toEqual([]);
  }, 180_000);
});
