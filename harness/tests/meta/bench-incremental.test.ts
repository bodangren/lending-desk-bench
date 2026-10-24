import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSet } from "../../bugfix/set-loader";
import { hashTreeOnDisk } from "../../bugfix/make-variant";
import { registryHash } from "../../bugfix/registry";
import { changeRegistryHash, loadChangeSet } from "../../change/requests";
import { loadMutantSet, mutantSetHash } from "../../tests-track/set-loader";
import { declaredIds, loadTrackContext } from "../../track-scoring";
import { type BenchTrack } from "../../candidate-contract";
import { executionIdentityFingerprint } from "../../execution-identity";
import { createCurrentAgentRuntime, currentSchema4Provenance } from "./schema4-fixtures";
import { envWithoutTrack, freshnessInProcess, scoreInProcess } from "./score-helpers";

const ROOT = resolve(import.meta.dirname, "../../..");
const HARNESS = resolve(ROOT, "harness");
const TSX = resolve(HARNESS, "node_modules/.bin/tsx");
const FIXTURE = resolve(ROOT, "fixture");
const EXPORT_SCRIPT = resolve(HARNESS, "export-site-data.py");

type Json = Record<string, unknown>;
type Arm = "a" | "b";
type Workspace = { root: string; runs: string; pricing: string };
type Template = {
  work: string;
  track: BenchTrack;
  arm: Arm;
  candidate: string;
  variant: string;
  artifacts: string;
  environment: NodeJS.ProcessEnv;
};
type WorkRow = Json & {
  track: string;
  arm: string;
  model: string;
  class: string;
  reason?: unknown;
};

const TRACKS: readonly BenchTrack[] = ["build", "bugfix", "tests", "change"];
const ARMS: readonly Arm[] = ["a", "b"];
const REPS: Record<BenchTrack, number> = { build: 3, bugfix: 1, tests: 1, change: 1 };

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function copyTree(source: string, destination: string): void {
  cpSync(source, destination, {
    recursive: true,
    filter: (entry) => ![".git", "node_modules", ".next"].includes(basename(entry)) && !entry.endsWith(".tsbuildinfo"),
  });
}

function batchModel(name: string, requests = 10_000): Json {
  return {
    name,
    api: "openai-completions",
    high_usage: true,
    batch: true,
    requests_per_month: requests,
    monthly_usage_usd: 15,
    rates: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
  };
}

function pricingFor(models: Record<string, Json>): Json {
  return {
    schema: 1,
    source: "synthetic",
    retrieved: "2026-10-17",
    high_usage_min_requests_per_month: 7000,
    deepseek_rate: "off-peak",
    provider: "opencode-go",
    apis: {
      "openai-completions": { baseUrl: "https://example.invalid" },
      "openai-responses": { baseUrl: "https://example.invalid" },
      "anthropic-messages": { baseUrl: "https://example.invalid" },
    },
    aliases: {},
    models,
  };
}

function makeWorkspace(models: Record<string, Json>): Workspace {
  const root = mkdtempSync(join(tmpdir(), "bench-incremental-"));
  const runs = join(root, "runs");
  const pricing = join(root, "go-pricing.json");
  mkdirSync(runs);
  writeJson(pricing, pricingFor(models));
  return { root, runs, pricing };
}

function trackSetSource(track: Exclude<BenchTrack, "build">): string {
  if (track === "bugfix") return resolve(HARNESS, "bugfix/sets/v1.json");
  if (track === "tests") return resolve(HARNESS, "tests-track/sets/m1.json");
  return resolve(HARNESS, "change/sets/c1.json");
}

function installTrackBinding(track: BenchTrack, artifacts: string, variant: string): Json {
  if (track === "build") return {};

  const source = trackSetSource(track);
  const file = track === "bugfix" ? "bug-set.json" : track === "tests" ? "mutant-set.json" : "change-set.json";
  const destination = join(artifacts, file);
  cpSync(source, destination);
  const binding: Json = { variant_sha256: hashTreeOnDisk(variant), registry_sha256: null };
  if (track === "bugfix") {
    const set = loadSet(destination);
    binding.bug_set_id = set.id;
    binding.bug_set_sha256 = sha256File(destination);
    binding.registry_sha256 = registryHash();
  } else if (track === "tests") {
    const set = loadMutantSet(destination);
    binding.mutant_set_id = set.id;
    binding.mutant_set_sha256 = sha256File(destination);
    binding.registry_sha256 = mutantSetHash(set);
    writeJson(join(artifacts, "tests-results.json"), { summary: { total: 0, valid: 0 } });
  } else {
    const set = loadChangeSet(destination);
    binding.change_set_id = set.id;
    binding.change_set_sha256 = sha256File(destination);
    binding.registry_sha256 = changeRegistryHash();
  }
  return binding;
}

async function makeTemplate(parent: string, track: BenchTrack, arm: Arm): Promise<Template> {
  const work = join(parent, `template-${track}-${arm}`);
  mkdirSync(work, { recursive: true });
  const candidate = join(work, "candidate");
  const variant = join(work, "variant");
  const artifacts = join(work, "artifacts");
  mkdirSync(artifacts);
  if (track === "build") {
    copyTree(FIXTURE, candidate);
  } else {
    copyTree(FIXTURE, variant);
    copyTree(variant, candidate);
  }

  const runId = `template-${track}-${arm}`;
  const model = `synthetic-${track}-${arm}`;
  const runtime = createCurrentAgentRuntime({ root: work, arm, model });
  writeJson(join(artifacts, "gate.json"), { typecheck: true, build: true });
  writeJson(join(artifacts, "collection.json"), { valid: true, status: "collected" });
  const context = track === "build" ? { track: "build" as const } : undefined;
  const initial = currentSchema4Provenance({
    fixture: track === "build" ? FIXTURE : variant,
    candidate,
    runId,
    model,
    arm,
    live: runtime,
    track,
    artifacts,
  }) as Json;
  const binding = installTrackBinding(track, artifacts, variant);
  const provenance = { ...initial, track, ...binding };
  writeJson(join(artifacts, "provenance.json"), provenance);
  const resolvedContext = context ?? loadTrackContext(track, artifacts).context;
  if (!resolvedContext) throw new Error(`could not load synthetic ${track} context`);
  writeJson(join(artifacts, "results.json"), Object.fromEntries(declaredIds(resolvedContext).map((id) => [id, false])));
  const score = await scoreInProcess({
    candidate,
    artifacts,
    runId,
    model,
    arm,
    environment: envWithoutTrack({ ...runtime.environment, BENCH_TRACK: track }),
  });
  writeJson(join(artifacts, "score.json"), score);
  return { work, track, arm, candidate, variant, artifacts, environment: runtime.environment };
}

function updateExecution(provenance: Json, runId: string, arm: Arm): Json {
  const executor = provenance.executor as Json;
  const updatedExecutor = { ...executor, run_id: runId, arm };
  return {
    ...provenance,
    run_id: runId,
    arm,
    executor: updatedExecutor,
    execution_identity_sha256: executionIdentityFingerprint(updatedExecutor),
  };
}

function cloneRun(template: Template, runs: string, runId: string, model: string, untrusted = false): string {
  const destination = join(runs, runId);
  copyTree(template.work, destination);
  const provenancePath = join(destination, "artifacts/provenance.json");
  const scorePath = join(destination, "artifacts/score.json");
  const provenance = updateExecution(JSON.parse(readFileSync(provenancePath, "utf8")) as Json, runId, template.arm);
  provenance.model = model;
  writeJson(provenancePath, provenance);
  const score = JSON.parse(readFileSync(scorePath, "utf8")) as Json;
  score.run_id = runId;
  score.model = model;
  score.arm = template.arm;
  score.track = template.track;
  score.provenance = provenance;
  if (untrusted) {
    score.trusted = false;
    score.publishable = false;
    score.rankable = false;
  }
  writeJson(scorePath, score);
  return destination;
}

async function makeModeRun(
  template: Template,
  runs: string,
  runId: string,
  model: string,
  mode: "agent" | "overlay",
): Promise<string> {
  const destination = join(runs, runId);
  copyTree(template.work, destination);
  const candidate = join(destination, "candidate");
  const variant = join(destination, "variant");
  const provenance = currentSchema4Provenance({
    fixture: template.track === "build" ? FIXTURE : variant,
    candidate,
    runId,
    model,
    arm: template.arm,
    mode,
    track: template.track,
  }) as Json;
  const binding = installTrackBinding(template.track, join(destination, "artifacts"), variant);
  writeJson(join(destination, "artifacts/provenance.json"), { ...provenance, track: template.track, ...binding });
  const score = await scoreInProcess({
    candidate,
    artifacts: join(destination, "artifacts"),
    runId,
    model,
    arm: template.arm,
    environment: envWithoutTrack({ BENCH_TRACK: template.track }),
  });
  writeJson(join(destination, "artifacts/score.json"), score);
  return destination;
}

async function classificationWorkspace(): Promise<{ workspace: Workspace; models: string[] }> {
  const models = ["bench-new", "bench-failing", "bench-current"];
  const workspace = makeWorkspace(Object.fromEntries(models.map((model) => [model, batchModel(model)])));
  for (const track of TRACKS) {
    for (const arm of ARMS) {
      const template = await makeTemplate(workspace.root, track, arm);
      const prefix = track === "build" ? "" : track === "bugfix" ? "bf-" : track === "tests" ? "tt-" : "ch-";
      const failing = cloneRun(template, workspace.runs, `${prefix}${arm}-bench-failing-2026w40-r1`, "bench-failing", true);
      expect(freshnessInProcess(join(failing, "artifacts"), envWithoutTrack({ ...template.environment, BENCH_TRACK: track })))
        .toMatchObject({ state: "UNTRUSTED", rankable: false });
      for (let rep = 1; rep <= REPS[track]; rep += 1) {
        const current = cloneRun(
          template,
          workspace.runs,
          `${prefix}${arm}-bench-current-2026w${40 + rep}-r${rep}`,
          "bench-current",
        );
        expect(freshnessInProcess(join(current, "artifacts"), envWithoutTrack({ ...template.environment, BENCH_TRACK: track })))
          .toMatchObject({ state: "TRUSTED", rankable: true });
      }
    }
  }
  return { workspace, models };
}

function planWork(workspace: Workspace, extra: NodeJS.ProcessEnv = {}): ReturnType<typeof spawnSync> {
  return spawnSync(TSX, ["plan-work.ts", "--all", "--runs-root", workspace.runs, "--pricing", workspace.pricing], {
    cwd: HARNESS,
    encoding: "utf8",
    env: envWithoutTrack({
      BENCH_RUNS_ROOT: workspace.runs,
      BENCH_PRICING_PATH: workspace.pricing,
      // The selector prefers the bare REPS value over the per-track values.
      // An ambient REPS from the caller must not change the repeat count.
      REPS: undefined,
      REPS_BUILD: "3",
      REPS_BUGFIX: "1",
      REPS_TESTS: "1",
      REPS_CHANGE: "1",
      ...extra,
    }),
    maxBuffer: 4 * 1024 * 1024,
  });
}

function workRows(result: ReturnType<typeof spawnSync>): WorkRow[] {
  if (result.error) throw new Error(`plan-work.ts failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`plan-work.ts failed (status ${result.status}): ${result.stderr || result.stdout}`);
  }
  const text = String(result.stdout).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const jsonLine = text.split(/\r?\n/).reverse().find((line) => {
      try {
        JSON.parse(line);
        return true;
      } catch {
        return false;
      }
    });
    if (!jsonLine) throw new Error("plan-work.ts did not emit JSON");
    parsed = JSON.parse(jsonLine);
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : (parsed as Json).classifications ?? (parsed as Json).work_list ?? (parsed as Json).entries;
  if (!Array.isArray(rows)) throw new Error("plan-work.ts JSON has no classification rows");
  return rows as WorkRow[];
}

function trustedCount(row: WorkRow): number {
  const value = row.trusted_count ?? row["trusted count"] ?? row.trustedCount;
  if (typeof value !== "number") throw new Error(`work row has no labeled trusted count: ${JSON.stringify(row)}`);
  return value;
}

function removeWorkspace(workspace: Workspace): void {
  rmSync(workspace.root, { recursive: true, force: true });
}

describe("bench_incremental selector contracts", () => {
  it("classifies new, failing, and current models per track and arm", async () => {
    const { workspace, models } = await classificationWorkspace();
    try {
      const rows = workRows(planWork(workspace));
      for (const track of TRACKS) {
        for (const arm of ARMS) {
          for (const model of models) {
            const row = rows.find((candidate) => candidate.track === track && candidate.arm === arm && candidate.model === model);
            expect(row, `${track}/${arm}/${model} classification is missing`).toBeDefined();
            const expectedClass = model === "bench-new" ? "new" : model === "bench-failing" ? "failing" : "current";
            const expectedCount = model === "bench-new" ? 0 : model === "bench-failing" ? 0 : REPS[track];
            expect(row?.class, `${track}/${arm}/${model} class`).toBe(expectedClass);
            expect(row ? trustedCount(row) : undefined, `${track}/${arm}/${model} trusted count`).toBe(expectedCount);
            expect(typeof row?.reason, `${track}/${arm}/${model} reason type`).toBe("string");
            expect(String(row?.reason ?? "").length, `${track}/${arm}/${model} reason is labeled`).toBeGreaterThan(0);
          }
        }
      }
    } finally {
      removeWorkspace(workspace);
    }
  }, 900_000);

  it("uses provenance identity instead of run-ID shape for diagnostic runs", async () => {
    const workspace = makeWorkspace({
      "identity-batch": batchModel("identity-batch"),
      "identity-other": { ...batchModel("identity-other"), high_usage: false, batch: false },
    });
    try {
      const buildA = await makeTemplate(workspace.root, "build", "a");
      const buildB = await makeTemplate(workspace.root, "build", "b");
      const calibration = await makeModeRun(buildA, workspace.runs, "cal-a-identity-batch-2026w40-r1", "identity-batch", "overlay");
      expect(freshnessInProcess(join(calibration, "artifacts"), envWithoutTrack({ ...buildA.environment, BENCH_TRACK: "build" })))
        .toMatchObject({ state: "CALIBRATION", rankable: false });
      const canary = cloneRun(buildA, workspace.runs, "canary-a-identity-batch-2026w40-r1", "identity-batch");
      expect(freshnessInProcess(join(canary, "artifacts"), envWithoutTrack({ ...buildA.environment, BENCH_TRACK: "build" })))
        .toMatchObject({ state: "TRUSTED", rankable: true });
      cloneRun(buildA, workspace.runs, "control-a-identity-other-2026w40-r1", "identity-other");
      cloneRun(buildB, workspace.runs, "bug-adhoc-b-identity-other-2026w40-r1", "identity-other");

      const rows = workRows(planWork(workspace));
      expect(rows.every((row) => row.model === "identity-batch")).toBe(true);
      const armA = rows.find((row) => row.track === "build" && row.arm === "a" && row.model === "identity-batch");
      const armB = rows.find((row) => row.track === "build" && row.arm === "b" && row.model === "identity-batch");
      expect(armA).toBeDefined();
      expect(armB).toBeDefined();
      expect(armA?.class).toBe("failing");
      expect(armA ? trustedCount(armA) : undefined).toBe(1);
      expect(armB?.class).toBe("new");
      expect(armB ? trustedCount(armB) : undefined).toBe(0);
    } finally {
      removeWorkspace(workspace);
    }
  }, 900_000);

  it("keeps selector output byte-identical when BENCH_TRACK leaks", async () => {
    const { workspace } = await classificationWorkspace();
    try {
      const clean = planWork(workspace);
      const leaked = planWork(workspace, { BENCH_TRACK: "change" });
      expect(clean.status, String(clean.stderr)).toBe(0);
      expect(leaked.status, String(leaked.stderr)).toBe(0);
      expect(Buffer.from(leaked.stdout)).toEqual(Buffer.from(clean.stdout));
    } finally {
      removeWorkspace(workspace);
    }
  }, 900_000);
});

function scheduledIds(output: string): string[] {
  const ids = new Set<string>();
  const pattern = /(?:^|\s|->)((?:bf-|tt-|ch-)?[ab]-[a-z0-9-]+-\d{4}w\d{2}-r\d+)(?=\s|$)/g;
  for (const match of output.matchAll(pattern)) ids.add(match[1]);
  try {
    const payload = JSON.parse(output.trim()) as Json;
    const listed = Array.isArray(payload.run_ids) ? payload.run_ids : Array.isArray(payload.runs) ? payload.runs : [];
    for (const id of listed) if (typeof id === "string") ids.add(id);
  } catch {
    // The dry-run contract may list the same IDs in human-readable batch lines.
  }
  return [...ids].sort();
}

function runBatchDry(workspace: Workspace, force: boolean): ReturnType<typeof spawnSync> {
  return spawnSync("bash", [resolve(HARNESS, "batch.sh"), "--dry-run"], {
    cwd: HARNESS,
    encoding: "utf8",
    env: envWithoutTrack({
      BENCH_TRACK: "build",
      BENCH_DRY_RUN: "1",
      DRY_RUN: "1",
      BENCH_RUNS_ROOT: workspace.runs,
      BENCH_PRICING_PATH: workspace.pricing,
      BENCH_SELFCHECK: "skip",
      BENCH_CANARY: "0",
      WEEK: "2026w50",
      ARMS: "a b",
      REPS_BUILD: "2",
      REPS: "2",
      FORCE: force ? "1" : "0",
    }),
    maxBuffer: 4 * 1024 * 1024,
  });
}

describe("bench_incremental batch consumption", () => {
  it("schedules only work-list rows in dry-run and restores the full matrix with FORCE=1", async () => {
    const batch = readFileSync(resolve(HARNESS, "batch.sh"), "utf8");
    expect(batch, "batch.sh must consume plan-work output").toContain("plan-work.ts");
    expect(batch, "batch.sh must expose a dry-run/listed invocation").toMatch(/BENCH_DRY_RUN|--dry-run/);

    const workspace = makeWorkspace({
      "batch-new": batchModel("batch-new"),
      "batch-current": batchModel("batch-current"),
    });
    try {
      for (const arm of ARMS) {
        const template = await makeTemplate(workspace.root, "build", arm);
        for (let rep = 1; rep <= 2; rep += 1) {
          cloneRun(template, workspace.runs, `${arm}-batch-current-2026w${40 + rep}-r${rep}`, "batch-current");
        }
      }

      const workRun = runBatchDry(workspace, false);
      expect(workRun.status, `${workRun.stdout}\n${workRun.stderr}`).toBe(0);
      expect(scheduledIds(String(workRun.stdout))).toEqual([
        "a-batch-new-2026w50-r1",
        "a-batch-new-2026w50-r2",
        "b-batch-new-2026w50-r1",
        "b-batch-new-2026w50-r2",
      ]);

      const forcedRun = runBatchDry(workspace, true);
      expect(forcedRun.status, `${forcedRun.stdout}\n${forcedRun.stderr}`).toBe(0);
      expect(scheduledIds(String(forcedRun.stdout))).toEqual([
        "a-batch-current-2026w50-r1",
        "a-batch-current-2026w50-r2",
        "a-batch-new-2026w50-r1",
        "a-batch-new-2026w50-r2",
        "b-batch-current-2026w50-r1",
        "b-batch-current-2026w50-r2",
        "b-batch-new-2026w50-r1",
        "b-batch-new-2026w50-r2",
      ]);
    } finally {
      removeWorkspace(workspace);
    }
  }, 900_000);
});

function sparsePricing(): Json {
  return pricingFor({
    "sparse-alpha": batchModel("Sparse Alpha"),
    "sparse-beta": batchModel("Sparse Beta", 9_000),
  });
}

function sparseScore(runId: string, model: string, arm: Arm, total: number): Json {
  return {
    schema: 3,
    track: "build",
    run_id: runId,
    model,
    arm,
    valid: true,
    trusted: true,
    publishable: true,
    rankable: true,
    total,
    axes: { completion: 1, adversarial: 1, quality: 1, adherence: 1 },
    usage: {},
    go: null,
    host: { under_load: false },
  };
}

function sparseRun(root: string, model: string, arm: Arm, week: string, total: number): void {
  const runId = `${arm}-${model}-${week}-r1`;
  const artifacts = join(root, "runs", runId, "artifacts");
  mkdirSync(artifacts, { recursive: true });
  writeJson(join(artifacts, "score.json"), sparseScore(runId, model, arm, total));
  writeJson(join(artifacts, "results.json"), {});
}

describe("bench_incremental site export", () => {
  it("keeps every current model row when the latest week is sparse", () => {
    const root = mkdtempSync(join(tmpdir(), "bench-incremental-export-"));
    try {
      mkdirSync(join(root, "harness/tests"), { recursive: true });
      mkdirSync(join(root, "runs"));
      cpSync(EXPORT_SCRIPT, join(root, "harness/export-site-data.py"));
      cpSync(resolve(HARNESS, "tests/criteria.ts"), join(root, "harness/tests/criteria.ts"));
      writeJson(join(root, "harness/go-pricing.json"), sparsePricing());
      sparseRun(root, "sparse-alpha", "a", "2026w40", 70);
      sparseRun(root, "sparse-alpha", "a", "2026w41", 80);
      sparseRun(root, "sparse-beta", "b", "2026w40", 75);

      const result = spawnSync("python3", [join(root, "harness/export-site-data.py")], {
        cwd: root,
        encoding: "utf8",
      });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const payload = JSON.parse(readFileSync(join(root, "docs/assets/data/benchmark.json"), "utf8")) as Json;
      const models = payload.models as Json[];
      expect(models.map((model) => model.id).sort()).toEqual(["sparse-alpha", "sparse-beta"]);
      const alpha = models.find((model) => model.id === "sparse-alpha");
      const beta = models.find((model) => model.id === "sparse-beta");
      expect((alpha?.no_skills as Json)?.repeats).toMatchObject({ week: "2026w41" });
      expect((beta?.skills as Json)?.repeats).toMatchObject({ week: "2026w40" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
