import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const HARNESS = resolve(import.meta.dirname, "..");
const TOOL = join(HARNESS, "model-guide", "guide.ts");
const TSX = join(HARNESS, "node_modules", ".bin", "tsx");
const NO_PICK = "no pick yet: not enough evidence";
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `model-guide-app-code-${tag}-`));
  roots.push(dir);
  return dir;
}

function put(path: string, value: unknown): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function fixture(tag: string, routes: unknown[], models: any[], generatedAt = "2026-11-27T13:00:00") {
  const dir = tempDir(tag);
  const realWork = put(join(dir, "real-work.json"), {
    source: { export_date: "2026-11-26" },
    producer: [],
    checker: [],
    by_role: {},
  });
  const printAudit = put(join(dir, "print-audit.json"), { routes: {} });
  const tracks = put(join(dir, "tracks.json"), {
    tracks: { tests: { models: [{ total: 98.7 }] } },
  });
  const benchmark = put(join(dir, "benchmark.json"), {
    schema: 1,
    generated_at: generatedAt,
    models,
  });
  const routesFile = put(join(dir, "routes.json"), routes);
  return { dir, realWork, printAudit, tracks, benchmark, routesFile };
}

function runGuide(files: ReturnType<typeof fixture>) {
  const out = join(files.dir, "out");
  const result = spawnSync(
    TSX,
    [
      "model-guide/guide.ts",
      "--real-work", files.realWork,
      "--routes", files.routesFile,
      "--print-audit", files.printAudit,
      "--benchmark", files.benchmark,
      "--tracks", files.tracks,
      "--today", "2026-11-27",
      "--out", out,
    ],
    {
      cwd: HARNESS,
      env: { ...process.env, NO_COLOR: "1", npm_config_loglevel: "silent" },
      encoding: "utf8",
      timeout: 60_000,
    },
  );
  const file = join(out, "model-guide.json");
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    file,
    data: existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null,
  };
}

function appCode(data: any): any {
  return data.rows.find((row: any) => row.kind === "app code");
}

const ROUTES = [
  { family: "Claude Sonnet", route: "claude-agent/sonnet#high" },
  { family: "MiniMax M3.1 Flash", route: "minimax-cn-coding-plan/MiniMax-M3.1-Flash" },
  { family: "DeepSeek Flash", route: "opencode-go/deepseek-v4.1-flash" },
  { family: "Hy", route: "opencode-go/hy4-flash-free#high" },
  { family: "Go", route: "opencode-go/mimo-v2.6-flash" },
  { family: "Go", route: "opencode-go/muse-spark-1.3-contributor#high" },
  { family: "Hungerg", route: "opencode-go/hungerg-free" },
  { family: "GPT Sol", route: "openai/gpt-6.2-sol#high" },
];

const MODELS = [
  { provider_model: "opencode-go/qwen3.8-flash", score: { total: 96.0 } },
  { provider_model: "opencode-go/hungerg-free", score: { total: 95.2 } },
  { provider_model: "opencode-go/deepseek-v4.1-flash", score: { total: 95.0 } },
  { provider_model: "opencode-go/mimo-v2.6-flash", score: { total: 95.0 } },
  { provider_model: "opencode-go/mimo-v2.6-pro", score: { total: 94.5 } },
  { provider_model: "opencode-go/muse-spark-1.3-contributor", score: { total: 93.8 } },
  { provider_model: "opencode-go/minimax-m3.1-flash", score: { total: 91.1 } },
  { provider_model: "opencode-go/hy4-flash-free", score: { total: 71.9 } },
];

describe("app code route selection from Build scores", () => {
  it("names the selected route of each family and ranks the scored selections", () => {
    const run = runGuide(fixture("selection", ROUTES, MODELS));
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    const row = appCode(run.data);
    expect(row.pick).toBe("opencode-go/hungerg-free");
    expect(row.second).toBe("opencode-go/deepseek-v4.1-flash");
    expect(row.base_line).toBe(96.0);
    expect(row.evidence_date).toBe("2026-11-27");
    expect(row.evidence).toBe(
      "build routes: Claude Sonnet=claude-agent/sonnet#high; " +
      "MiniMax M3.1 Flash=opencode-go/minimax-m3.1-flash 91.1; " +
      "DeepSeek Flash=opencode-go/deepseek-v4.1-flash 95.0; " +
      "Hy=opencode-go/hy4-flash-free#high 71.9; " +
      "Go=opencode-go/mimo-v2.6-flash 95.0; " +
      "Hungerg=opencode-go/hungerg-free 95.2; " +
      "GPT Sol=openai/gpt-6.2-sol#high",
    );
  });

  it("uses the highest Build score in a family and keeps the session variant", () => {
    const models = MODELS.map((model) =>
      model.provider_model === "opencode-go/muse-spark-1.3-contributor"
        ? { ...model, score: { total: 97.0 } }
        : model,
    );
    const run = runGuide(fixture("go-variant", ROUTES, models));
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    const row = appCode(run.data);
    expect(row.pick).toBe("opencode-go/muse-spark-1.3-contributor#high");
    expect(row.second).toBe("opencode-go/hungerg-free");
    expect(row.evidence).toContain("Go=opencode-go/muse-spark-1.3-contributor#high 97.0");
  });

  it("keeps the no-pick row when no session route has a Build score", () => {
    const run = runGuide(fixture("no-score", ROUTES, [
      { provider_model: "other/model", score: { total: 99.0 } },
    ]));
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    const row = appCode(run.data);
    expect(row.pick).toBe(NO_PICK);
    expect(row.second).toBeNull();
    expect(row.evidence).toBe("no pick yet");
    expect(row.evidence_date).toBe("2026-11-26");
  });

  it("refuses a malformed route table without an output file", () => {
    const files = fixture("bad-routes", [{ family: "Go" }], MODELS);
    const run = runGuide(files);
    expect(run.status).toBe(2);
    expect(run.stdout.trim()).toBe("input-check: routes");
    expect(existsSync(run.file)).toBe(false);
  });
});

describe("trial routes stay out of the public guide", () => {
  const ARK = [
    { family: "GLM Flash", route: "volcengine-agent-plan/glm-5.3-flash", trial: true },
    { family: "Doubao Seed Evolving", route: "volcengine-agent-plan/doubao-seed-evolving", trial: true },
  ];

  it("skips a trial route even when the route holds the best Build score", () => {
    const models = [
      ...MODELS,
      { provider_model: "volcengine-agent-plan/glm-5.3-flash", score: { total: 99.9 } },
      { provider_model: "volcengine-agent-plan/doubao-seed-evolving", score: { total: 99.8 } },
    ];
    const run = runGuide(fixture("trial-skip", [...ROUTES, ...ARK], models));
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    const text = readFileSync(run.file, "utf8");
    for (const word of ["volcengine", "doubao", "GLM Flash", "Evolving"]) {
      expect(text.toLowerCase(), `the guide holds ${word}`).not.toContain(word.toLowerCase());
    }
    expect(appCode(run.data).pick).toBe("opencode-go/hungerg-free");
  });

  it("builds the same guide with and without the trial rows", () => {
    const withTrial = runGuide(fixture("trial-same-a", [...ROUTES, ...ARK], MODELS));
    const without = runGuide(fixture("trial-same-b", ROUTES, MODELS));
    expect(withTrial.status).toBe(0);
    expect(appCode(withTrial.data)).toEqual(appCode(without.data));
  });

  it("flags every Ark route of the shipped routes.json as a trial route", () => {
    const rows = JSON.parse(readFileSync(join(HARNESS, "model-guide", "routes.json"), "utf8"));
    const ark = rows.filter((row: any) => String(row.route).startsWith("volcengine-agent-plan/"));
    expect(ark.length).toBeGreaterThan(0);
    for (const row of ark) expect(row.trial, row.route).toBe(true);
  });
});
