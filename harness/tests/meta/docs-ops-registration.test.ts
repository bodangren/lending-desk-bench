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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { BENCH_TRACKS, resolveTrack } from "../../candidate-contract.js";
import { writeVariant } from "../../bugfix/make-variant.js";
import { generateDocsOpsVariant } from "../../docs-and-ops/make-variant.js";
import { gradeDocsOps } from "../../docs-and-ops/grade-docs-ops.js";
import { resolveExecutionIdentity } from "../../execution-identity.js";

const HARNESS = resolve(import.meta.dirname, "../..");
const ROOT_DIR = resolve(HARNESS, "..");
const ROOT_FIXTURE = resolve(ROOT_DIR, "fixture");

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
});

const F7_ROOTS: string[] = [];
afterAll(() => {
  for (const root of F7_ROOTS) rmSync(root, { recursive: true, force: true });
});

function f7Temp(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `docs-ops-f7-${tag}-`));
  F7_ROOTS.push(dir);
  return dir;
}

function f7Env(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ["REPS", "REPS_BUILD", "REPS_BUGFIX", "REPS_TESTS", "REPS_CHANGE", "REPS_DOCS_AND_OPS", "FORCE", "PIN_MODEL", "BENCH_DRY_RUN", "BENCH_SELFCHECK"]) {
    delete env[key];
  }
  // Pseudo-terminal control characters would corrupt run-ID matching.
  delete env.COLUMNS;
  return { ...env, BENCH_TRACK: "docs-and-ops", WEEK: "2099w01", ARMS: "a b", ...extra };
}

/** Stage a temp repo that stands in for the project root: the harness
 * scripts (copied, so the real batch.sh, rescore-doctor.sh, and
 * export-site-data.py run), the node_modules and shared trees the temp
 * scripts resolve, and a docs/ tree for the site export. Nothing here
 * touches the real runs/, reports/, or docs/. */
function stageTempRepo(tag: string): { root: string; harness: string } {
  const root = f7Temp(`repo-${tag}`);
  const harness = join(root, "harness");
  mkdirSync(harness, { recursive: true });
  for (const entry of readdirSync(HARNESS, { withFileTypes: true })) {
    if (entry.isFile() && /\.(sh|ts|json|cjs|py)$/.test(entry.name)) {
      cpSync(join(HARNESS, entry.name), join(harness, entry.name));
    } else if (
      entry.isDirectory() &&
      ["node_modules", "tests", "bugfix", "tests-track", "change", "docs-and-ops"].includes(entry.name)
    ) {
      symlinkSync(join(HARNESS, entry.name), join(harness, entry.name), "dir");
    }
  }
  // currentHashes walks these trees by relative path; symlink them so the
  // temp repo hashes exactly like the real one.
  for (const tree of ["fixture", "reference", "reference-variant", "reference-change"]) {
    symlinkSync(join(ROOT_DIR, tree), join(root, tree), "dir");
  }
  mkdirSync(join(root, "docs", "assets", "data"), { recursive: true });
  mkdirSync(join(root, "runs"), { recursive: true });
  return { root, harness };
}

/** Stage a finished oracle docs-and-ops run inside a temp repo: a real
 * generated variant tree, a real oracle candidate, a real gradeDocsOps
 * result map, and the identity, cohort, gate, collection, contract, and
 * provenance records the rescore path requires. */
async function stageScoredRun(
  root: string,
  runId: string,
  model: string,
): Promise<{ run: string; artifacts: string }> {
  const tsx = join(HARNESS, "node_modules", ".bin", "tsx");
  const run = join(root, "runs", runId);
  const variantDir = join(run, "variant");
  const candidate = join(run, "candidate");
  const artifacts = join(run, "artifacts");
  mkdirSync(artifacts, { recursive: true });
  const variant = generateDocsOpsVariant("d1");
  writeVariant(variant, variantDir);
  writeVariant(variant, candidate);
  cpSync(join(HARNESS, "docs-and-ops", "oracle-overlay"), candidate, { recursive: true });
  symlinkSync(join(ROOT_FIXTURE, "node_modules"), join(candidate, "node_modules"), "dir");
  writeFileSync(join(artifacts, "variant-manifest.json"), `${JSON.stringify(variant.manifest, null, 2)}\n`);
  const grade = await gradeDocsOps(candidate, artifacts);
  expect(grade.passed, `F7 r2 staging: the oracle grades clean (${grade.reasons.join("; ")})`).toBe(true);
  const contract = spawnSync(tsx, ["candidate-contract.ts", variantDir, candidate, "--track", "docs-and-ops"], {
    cwd: HARNESS,
    encoding: "utf8",
    timeout: 120_000,
  });
  expect(contract.status, `F7 r2 staging: the contract assesses (${contract.stderr})`).toBe(0);
  writeFileSync(join(artifacts, "candidate-contract.json"), contract.stdout);
  writeFileSync(
    join(artifacts, "execution-identity.json"),
    `${JSON.stringify(resolveExecutionIdentity({ runId, arm: "a", mode: "overlay" }), null, 2)}\n`,
  );
  writeFileSync(join(artifacts, "executor-cohort.json"), `${JSON.stringify({ schema: 1, kind: "not-invoked", arms: {}, id: "f7-rescore-cohort" }, null, 2)}\n`);
  cpSync(join(HARNESS, "docs-and-ops", "sets", "d1.json"), join(artifacts, "docs-ops-set.json"));
  writeFileSync(join(artifacts, "gate.json"), `${JSON.stringify({ typecheck: true, build: true }, null, 2)}\n`);
  writeFileSync(
    join(artifacts, "collection.json"),
    `${JSON.stringify({ valid: true, status: "collected" }, null, 2)}\n`,
  );
  const provenance = spawnSync(tsx, ["provenance-record.ts", artifacts], {
    cwd: HARNESS,
    env: {
      ...process.env,
      RUN_ID: runId,
      ARM: "a",
      MODEL: model,
      MODE: "overlay",
      BENCH_TRACK: "docs-and-ops",
      FIXTURE_REVISION: "1",
    },
    encoding: "utf8",
    timeout: 120_000,
  });
  expect(provenance.status, `F7 r2 staging: provenance records (${provenance.stderr})`).toBe(0);
  return { run, artifacts };
}

describe("review-a r2 F7: registration behavior with temporary artifacts", () => {
  it("F7 r2: a dry run plans do- run IDs without executing runs", () => {
    const runsDir = resolve(HARNESS, "..", "runs");
    const before = existsSync(runsDir) ? readdirSync(runsDir).sort() : [];
    const run = spawnSync("bash", ["batch.sh", "--dry-run", "--model", "grok-4.6"], {
      cwd: HARNESS,
      env: f7Env(),
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(run.status, `F7 r2: the dry run exits 0: ${run.stderr}`).toBe(0);
    expect(run.stdout, "F7 r2: the dry run plans the Arm A do- run ID").toContain("-> do-a-grok-4-6-2099w01-r1");
    expect(run.stdout, "F7 r2: the dry run plans the Arm B do- run ID").toContain("-> do-b-grok-4-6-2099w01-r1");
    const after = existsSync(runsDir) ? readdirSync(runsDir).sort() : [];
    expect(after, "F7 r2: the dry run writes nothing under runs/").toEqual(before);
  }, 180_000);

  it("F7 r2: rescore-doctor.sh keeps a valid do- run on its total", async () => {
    const { root, harness } = stageTempRepo("rescore");
    const runId = "do-a-f7rescore-2099w01-r1";
    const model = "local/oracle-f7";
    await stageScoredRun(root, runId, model);
    const run = spawnSync("bash", ["rescore-doctor.sh"], {
      cwd: harness,
      env: f7Env({ WEEK: "2099w01" }),
      encoding: "utf8",
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    expect(run.status, `F7 r2: rescore exits 0: ${run.stderr}`).toBe(0);
    expect(run.stdout, "F7 r2: rescore keeps the do- run").toContain(`OK   ${runId}`);
    const score = JSON.parse(readFileSync(join(root, "runs", runId, "artifacts", "score.json"), "utf8"));
    expect(score.valid, "F7 r2: the rescored run stays valid").toBe(true);
    expect(score.track, "F7 r2: the rescored run stays on docs-and-ops").toBe("docs-and-ops");
    expect(score.total, "F7 r2: the rescored total stays 100").toBe(100);
  }, 600_000);

  it("F7 r2: export-site-data.py lists the do- run under docs-and-ops", async () => {
    const { root, harness } = stageTempRepo("export");
    const runId = "do-a-f7export-2099w01-r1";
    const run = join(root, "runs", runId);
    const artifacts = join(run, "artifacts");
    mkdirSync(artifacts, { recursive: true });
    writeFileSync(
      join(artifacts, "score.json"),
      `${JSON.stringify({
        schema: 3,
        run_id: runId,
        model: "local/oracle-f7",
        arm: "a",
        track: "docs-and-ops",
        valid: true,
        trusted: true,
        publishable: true,
        rankable: true,
        total: 100,
        axes: { documentation: 1, operations: 1, adherence: 1, quality: 1 },
      }, null, 2)}\n`,
    );
    writeFileSync(
      join(artifacts, "provenance.json"),
      `${JSON.stringify({ schema: 7, run_id: runId, model: "local/oracle-f7", arm: "a", track: "docs-and-ops" }, null, 2)}\n`,
    );
    const out = spawnSync("python3", ["-I", "export-site-data.py"], {
      cwd: harness,
      encoding: "utf8",
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    expect(out.status, `F7 r2: the export exits 0: ${out.stderr}`).toBe(0);
    const tracks = JSON.parse(
      readFileSync(join(root, "docs", "assets", "data", "tracks.json"), "utf8"),
    );
    expect(tracks.tracks["docs-and-ops"], "F7 r2: the export lists docs-and-ops").toBeDefined();
    const row = tracks.tracks["docs-and-ops"].models.find((entry: any) => entry.model === "local/oracle-f7");
    expect(row, "F7 r2: the do- run reaches the docs-and-ops table").toBeDefined();
    expect(row.total, "F7 r2: the exported total is 100").toBe(100);
  }, 600_000);
});
