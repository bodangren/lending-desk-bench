import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const HARNESS = join(ROOT, "harness");
const TSX = join(HARNESS, "node_modules/.bin/tsx");
const DATE = "2026-10-26";
const WEEK = "2026w44";
const SELECTOR = "harness/daily-pick.ts (5.1)";
const PIN = "harness/batch.sh --model (5.2)";
const JOB = "harness/cron-daily.sh (5.3), day record run_ids/runner_exit (5.4)";
type Json = Record<string, any>;
type Work = { root: string; runs: string; days: string; pricing: string; catalog: string; served: string; home: string; bin: string };
type Result = { status: number | null; stdout: string; stderr: string };
type Row = { model: string; last_test: string | null; requests_per_month: number };

let FAILED = 0;
let PASS_COUNT = 0;
let FAIL_COUNT = 0;
const RESULTS: string[] = [];
function pass(label: string) { PASS_COUNT++; RESULTS.push(`PASS: ${label}`); }
function fail(label: string, error: unknown) {
  FAILED = 1; FAIL_COUNT++;
  RESULTS.push(`FAIL: ${label}: ${error instanceof Error ? error.message : String(error)}`);
}

// Vitest provides the exit code. This wrapper preserves the project's check summary.
function caseOf(label: string, body: (w: Work) => void | Promise<void>) {
  it(label, async () => {
    console.log(`=== ${label} ===`);
    const w = workspace();
    try { await body(w); pass(label); }
    catch (error) { fail(label, error); throw error; }
    finally { rmSync(w.root, { recursive: true, force: true }); }
  });
}
function each<T>(values: readonly T[], body: (value: T) => void) {
  const failures: string[] = [];
  for (const value of values) {
    try { body(value); }
    catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
  }
  if (failures.length) throw new Error(failures.join("\n"));
}
afterAll(() => {
  for (const result of RESULTS) console.log(result);
  console.log(`=== Total: ${PASS_COUNT + FAIL_COUNT} checks (PASS=${PASS_COUNT}, FAIL=${FAIL_COUNT}) ===`);
  expect(FAILED, "schedule check counters").toBe(FAIL_COUNT > 0 ? 1 : 0);
});

function json(path: string, value: unknown) { writeFileSync(path, JSON.stringify(value) + "\n"); }
function workspace(): Work {
  const root = mkdtempSync(join(tmpdir(), "daily-schedule-"));
  const w = { root, runs: join(root, "runs"), days: join(root, "reports/daily"),
    pricing: join(root, "pricing.json"), catalog: join(root, "catalog.json"), served: join(root, "served.txt"),
    home: join(root, "home"), bin: join(root, "bin") };
  for (const path of [w.runs, w.days, w.home, w.bin]) mkdirSync(path, { recursive: true });
  // The cron sources toolchain.sh. Give it a synthetic nvm installation.
  const nvm = join(w.home, ".nvm");
  mkdirSync(join(nvm, "alias"), { recursive: true });
  mkdirSync(join(nvm, "versions/node/v24.0.0/bin"), { recursive: true });
  writeFileSync(join(nvm, "alias/default"), "v24.0.0\n");
  symlinkSync(process.execPath, join(nvm, "versions/node/v24.0.0/bin/node"));
  // A seam regression must stop locally, not invoke Git, a model, or a fetch.
  for (const name of ["git", "opencode", "curl", "wget", "podman", "docker", "ssh"])
    writeFileSync(join(w.bin, name), "#!/usr/bin/env bash\necho 'FORBIDDEN external command' >&2\nexit 97\n", { mode: 0o755 });
  inputs(w, { a: 100, b: 50, c: 80 });
  return w;
}
function inputs(w: Work, models: Record<string, number>, live = Object.keys(models), served = Object.keys(models), batch: string[] = [], aliases = {}) {
  json(w.pricing, { schema: 1, source: "synthetic", retrieved: DATE, provider: "opencode-go",
    high_usage_min_requests_per_month: 1, deepseek_rate: "off-peak", aliases,
    apis: { "openai-completions": { baseUrl: "https://example.invalid" } },
    models: Object.fromEntries(Object.entries(models).map(([id, requests]) => [id, {
      name: id, api: "openai-completions", high_usage: true, batch: batch.includes(id),
      requests_per_month: requests, monthly_usage_usd: 15,
      rates: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
    }])) });
  json(w.catalog, { live });
  writeFileSync(w.served, served.map(id => `opencode-go/${id}\n`).join(""));
}
function env(w: Work, values: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { PATH: `${w.bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: w.home,
    TMPDIR: w.root, TSX_DISABLE_CACHE: "1", _BENCH_ENV_LOADED: "1", ...values };
}
function exec(w: Work, command: string, args: string[], values: Record<string, string> = {}): Result {
  const r = spawnSync(command, args, { cwd: ROOT, env: env(w, values), encoding: "utf8", timeout: 20_000, maxBuffer: 4 * 1024 * 1024 });
  if (r.error) throw new Error(`${command}: ${r.error.message}`);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
function run(w: Work, id: string, model: string, patch: Json = {}) {
  const artifacts = join(w.runs, id, "artifacts");
  mkdirSync(artifacts, { recursive: true });
  json(join(artifacts, "provenance.json"), { executor: { kind: "opencode" }, model: `opencode-go/${model}`, arm: "a", track: "build", ...patch });
  return join(w.runs, id);
}
function day(w: Work, date: string, model: string, ids: string[]) {
  json(join(w.days, `${date}.json`), { schema: 1, date, model, run_ids: ids, runner_exit: 0 });
}
function row(model: string, requests: number, last_test: string | null = null): Row {
  return { model, last_test, requests_per_month: requests };
}
function expected(model: string | null, reason: string, order: Row[], counts: number[], excluded: Json = {}, date = DATE, week = WEEK) {
  return { schema: 1, date, week, model, reason, last_test: order[0]?.last_test ?? null,
    counts: { live: counts[0], candidates: counts[1], eligible: counts[2], untested: counts[3] },
    excluded: { unpriced: [], gone: [], unservable: [], this_week: [], ...excluded }, order };
}
function pick(w: Work, values: Record<string, string> = {}, date = DATE): Result {
  return exec(w, TSX, [join(HARNESS, "daily-pick.ts"), "--catalog", w.catalog, "--served", w.served,
    "--date", date, "--runs-root", w.runs, "--pricing", w.pricing, "--day-dir", w.days], values);
}
function pickLine(e: Json): string {
  if (e.reason === "resume") return `DAILY_PICK date=${e.date} model=${e.model} reason=resume`;
  return `DAILY_PICK date=${e.date} model=${e.model ?? "none"} reason=${e.reason} last_test=${e.last_test ?? "none"} candidates=${e.counts.candidates} eligible=${e.counts.eligible} untested=${e.counts.untested}`;
}
function assertPick(r: Result, e: Json) {
  expect(r.status, `${SELECTOR}: missing selection CLI; ${r.stderr}`).toBe(e.reason === "none" ? 3 : 0);
  expect(JSON.parse(r.stdout), `${SELECTOR}: exact selection JSON fields`).toEqual(e);
  expect(r.stderr, `${SELECTOR}: exact DAILY_PICK line`).toBe(pickLine(e) + "\n");
}
function first(w: Work) {
  run(w, "a-a-2026w40-r1", "a");
  return expected("c", "untested", [row("c", 80), row("b", 50), row("a", 100, "2026-10-04")], [3, 3, 3, 2]);
}
function stale(w: Work) {
  inputs(w, { a: 100, b: 50 });
  run(w, "a-a-2026w40-r1", "a"); run(w, "a-b-2026w42-r1", "b");
  return expected("a", "stalest", [row("a", 100, "2026-10-04"), row("b", 50, "2026-10-18")], [2, 2, 2, 0]);
}

describe("selector", () => {
  caseOf("6.1.1 untested first: daily-pick.ts", w => { const e = first(w); assertPick(pick(w), e); });
  caseOf("6.1.2 untested tie: daily-pick.ts byte order", w => {
    inputs(w, { "x-a": 50, "x.a": 50 }, ["x.a", "x-a"]);
    assertPick(pick(w), expected("x-a", "untested", [row("x-a", 50), row("x.a", 50)], [2, 2, 2, 2]));
  });
  caseOf("6.1.3 stalest: daily-pick.ts last_test", w => { const e = stale(w); assertPick(pick(w), e); });
  caseOf("6.1.4 stalest tie: daily-pick.ts requests then byte order", w => {
    inputs(w, { a: 50, b: 80 });
    run(w, "a-a-2026w40-r1", "a"); run(w, "a-b-2026w40-r1", "b");
    const requests = pick(w);
    inputs(w, { a: 80, b: 80 }, ["b", "a"]);
    const bytes = pick(w);
    each([
      { result: requests, output: expected("b", "stalest", [row("b", 80, "2026-10-04"), row("a", 50, "2026-10-04")], [2, 2, 2, 0]) },
      { result: bytes, output: expected("a", "stalest", [row("a", 80, "2026-10-04"), row("b", 80, "2026-10-04")], [2, 2, 2, 0]) },
    ], item => assertPick(item.result, item.output));
  });
  caseOf("6.1.5 directory time: daily-pick.ts ignores mtime", w => {
    const e = stale(w);
    utimesSync(join(w.runs, "a-a-2026w40-r1"), new Date(), new Date());
    utimesSync(join(w.runs, "a-b-2026w42-r1"), new Date("2020-01-01Z"), new Date("2020-01-01Z"));
    assertPick(pick(w), e);
  });
  caseOf("6.1.6 day record date: daily-pick.ts last_test", w => {
    inputs(w, { a: 100, b: 50 });
    run(w, "a-a-2026w41-r1", "a"); run(w, "a-b-2026w41-r1", "b");
    const fallback = pick(w);
    day(w, "2026-10-06", "b", ["a-b-2026w41-r1"]);
    const recorded = pick(w);
    each([
      { result: fallback, output: expected("a", "stalest", [row("a", 100, "2026-10-11"), row("b", 50, "2026-10-11")], [2, 2, 2, 0]) },
      { result: recorded, output: expected("b", "stalest", [row("b", 50, "2026-10-06"), row("a", 100, "2026-10-11")], [2, 2, 2, 0]) },
    ], item => assertPick(item.result, item.output));
  });
  caseOf("6.1.7 latest run: daily-pick.ts last_test", w => {
    inputs(w, { a: 100, b: 50 });
    run(w, "a-a-2026w38-r1", "a"); run(w, "a-a-2026w41-r1", "a"); run(w, "a-b-2026w40-r1", "b");
    assertPick(pick(w), expected("b", "stalest", [row("b", 50, "2026-10-04"), row("a", 100, "2026-10-11")], [2, 2, 2, 0]));
  });
  caseOf("6.1.8 no week: daily-pick.ts zero date", w => {
    inputs(w, { x: 10, b: 50 });
    run(w, "a-x-legacy", "x"); run(w, "a-b-2026w40-r1", "b");
    assertPick(pick(w), expected("x", "stalest", [row("x", 10, "0000-00-00"), row("b", 50, "2026-10-04")], [2, 2, 2, 0]));
  });
  caseOf("6.1.9 unpriced: daily-pick.ts excluded.unpriced", w => {
    inputs(w, { a: 100 }, ["z-unpriced", "a"], ["z-unpriced", "a"]);
    json(w.catalog, { live: ["z-unpriced", "a"], requests_per_month: { "z-unpriced": 99999 } });
    assertPick(pick(w), expected("a", "untested", [row("a", 100)], [2, 1, 1, 1], { unpriced: ["z-unpriced"] }));
  });
  caseOf("6.1.10 gone: daily-pick.ts excluded.gone", w => {
    inputs(w, { a: 100, gone: 99999 }, ["a"]);
    assertPick(pick(w), expected("a", "untested", [row("a", 100)], [1, 1, 1, 1], { gone: ["gone"] }));
  });
  caseOf("6.1.11 unservable: daily-pick.ts exact served line", w => {
    inputs(w, { a: 100, "x-1.1": 99999 }, ["x-1.1", "a"], ["x-1.10", "a"]);
    assertPick(pick(w), expected("a", "untested", [row("a", 100)], [2, 1, 1, 1], { unservable: ["x-1.1"] }));
  });
  caseOf("6.1.12 this week: daily-pick.ts excluded.this_week", w => {
    inputs(w, { a: 100, b: 50 });
    run(w, "a-a-2026w38-r1", "a"); run(w, "a-a-2026w44-r1", "a"); run(w, "a-b-2026w40-r1", "b");
    assertPick(pick(w), expected("b", "stalest", [row("b", 50, "2026-10-04")], [2, 2, 1, 0], { this_week: ["a"] }));
  });
  caseOf("6.1.13 none: daily-pick.ts exit 3", w => {
    inputs(w, { a: 100, b: 50 });
    run(w, "a-a-2026w44-r1", "a"); run(w, "a-b-2026w44-r1", "b");
    assertPick(pick(w), expected(null, "none", [], [2, 2, 0, 0], { this_week: ["a", "b"] }));
  });
  caseOf("6.1.14 identity: daily-pick.ts OpenCode identity and aliases", w => {
    // Four rejected identity classes: Pi, local, bad arm/track, and malformed JSON.
    inputs(w, { pi: 100, local: 90, arm: 80, track: 70, malformed: 60, x: 999 }, undefined, undefined, [], { "x-old": "x" });
    run(w, "a-pi-2026w40-r1", "pi", { executor: { pi: {} } });
    run(w, "a-local-2026w40-r1", "local", { model: "local/reference" });
    run(w, "a-arm-2026w40-r1", "arm", { arm: "c" });
    run(w, "a-track-2026w40-r1", "track", { track: "foo" });
    const bad = run(w, "a-malformed-2026w40-r1", "malformed");
    writeFileSync(join(bad, "artifacts/provenance.json"), "not JSON");
    run(w, "a-x-2026w40-r1", "x-old");
    assertPick(pick(w), expected("pi", "untested", [row("pi", 100), row("local", 90), row("arm", 80), row("track", 70), row("malformed", 60), row("x", 999, "2026-10-04")], [6, 6, 6, 5]));
  });
  caseOf("6.1.15 invalid run: daily-pick.ts tested identity", w => {
    inputs(w, { a: 100, b: 50 });
    const a = run(w, "a-a-2026w40-r1", "a"); json(join(a, "artifacts/score.json"), { valid: false });
    assertPick(pick(w), expected("b", "untested", [row("b", 50), row("a", 100, "2026-10-04")], [2, 2, 2, 1]));
  });
  caseOf("6.1.16 resume: daily-pick.ts short JSON and line", w => {
    day(w, DATE, "z", []);
    assertPick(pick(w), { schema: 1, date: DATE, week: WEEK, model: "z", reason: "resume" });
  });
  caseOf("6.1.17 bad day record: daily-pick.ts exit 2", w => {
    writeFileSync(join(w.days, "2026-01-01.json"), "not JSON");
    assertFault(pick(w), "bad day record");
  });
  caseOf("6.1.18 input faults: daily-pick.ts exit 2 with no stdout", w => {
    each(["empty catalog", "non-JSON catalog", "no live", "empty live", "empty served", "bad date", "missing pricing", "missing runs"], fault => {
      inputs(w, { a: 100 }); mkdirSync(w.runs, { recursive: true });
      if (fault === "empty catalog") writeFileSync(w.catalog, "");
      if (fault === "non-JSON catalog") writeFileSync(w.catalog, "not JSON");
      if (fault === "no live") json(w.catalog, {});
      if (fault === "empty live") json(w.catalog, { live: [] });
      if (fault === "empty served") writeFileSync(w.served, "");
      if (fault === "missing pricing") rmSync(w.pricing);
      if (fault === "missing runs") rmSync(w.runs, { recursive: true });
      assertFault(pick(w, {}, fault === "bad date" ? "2026-13-01" : DATE), fault);
    });
  });
  caseOf("6.1.19 hermetic: daily-pick.ts ignores poisoned environment", w => {
    const e = stale(w); const clean = pick(w);
    const poisoned = pick(w, { BENCH_TRACK: "change", REPS: "9", BENCH_RUNS_ROOT: "/nonexistent", BENCH_PRICING_PATH: "/nonexistent" });
    assertPick(clean, e); assertPick(poisoned, e);
    expect(poisoned.stdout, SELECTOR).toBe(clean.stdout); expect(poisoned.stderr, SELECTOR).toBe(clean.stderr);
  });
  caseOf("6.1.20 determinism: daily-pick.ts ignores input order", w => {
    inputs(w, { a: 100, b: 50 });
    run(w, "a-a-2026w41-r1", "a"); run(w, "a-b-2026w41-r1", "b");
    day(w, "2026-10-06", "b", ["a-b-2026w41-r1"]);
    const before = pick(w);
    rmSync(w.runs, { recursive: true }); mkdirSync(w.runs);
    run(w, "a-b-2026w41-r1", "b"); run(w, "a-a-2026w41-r1", "a");
    json(w.catalog, { live: ["b", "a"] }); const after = pick(w);
    const e = expected("b", "stalest", [row("b", 50, "2026-10-06"), row("a", 100, "2026-10-11")], [2, 2, 2, 0]);
    assertPick(before, e); assertPick(after, e); expect(after.stdout, SELECTOR).toBe(before.stdout);
  });
  caseOf("6.1.21 run-list: daily-pick.ts --day-runs exact IDs", w => {
    inputs(w, { x: 100, y: 50 });
    run(w, "b-x-2026w44-r2", "x", { arm: "b" }); run(w, "a-x-2026w44-r1", "x");
    run(w, "bf-b-x-2026w44-r1", "x", { arm: "b", track: "bugfix" });
    run(w, "a-x-2026w43-r1", "x"); run(w, "a-y-2026w44-r1", "y");
    run(w, "pi-x-2026w44-r1", "x", { executor: { pi: {} } });
    run(w, "canary-build-2026w44-r1", "x", { model: "local/reference" });
    const r = exec(w, TSX, [join(HARNESS, "daily-pick.ts"), "--day-runs", "x", "--week", WEEK, "--runs-root", w.runs, "--pricing", w.pricing]);
    expect(r.status, `${SELECTOR}: missing --day-runs; ${r.stderr}`).toBe(0);
    expect(JSON.parse(r.stdout), SELECTOR).toEqual(["a-x-2026w44-r1", "b-x-2026w44-r2", "bf-b-x-2026w44-r1"]);
    expect(r.stderr, SELECTOR).toBe("");
  });
  caseOf("6.1.22 labeled line: daily-pick.ts exact stderr", w => {
    const e = first(w); const r = pick(w); assertPick(r, e);
    expect(r.stderr, SELECTOR).toBe("DAILY_PICK date=2026-10-26 model=c reason=untested last_test=none candidates=3 eligible=3 untested=2\n");
  });
  caseOf("6.1.23 untested before a no-week run: daily-pick.ts rule 4", w => {
    // A tested model with no week token has the zero date. It must not win
    // over an untested candidate with fewer requests.
    inputs(w, { "x-legacy": 999, "y-fresh": 100 });
    run(w, "a-x-legacy", "x-legacy");
    assertPick(pick(w), expected("y-fresh", "untested", [row("y-fresh", 100), row("x-legacy", 999, "0000-00-00")], [2, 2, 2, 1]));
  });
});

function assertFault(r: Result, fault: string) {
  expect(r.status, `${SELECTOR}: missing input validation: ${fault}`).toBe(2);
  expect(r.stdout, `${SELECTOR}: fault stdout: ${fault}`).toBe("");
  expect(r.stderr, `${SELECTOR}: fault label: ${fault}`).toMatch(/^daily-pick: [^\n]+\n$/);
  expect(r.stderr.split("\n").filter(line => line.startsWith("DAILY_PICK ")), SELECTOR).toEqual([]);
}

function batchSetup(w: Work) { inputs(w, { "glm-5.2": 100, "batch-z": 50, "batch-a": 80 }, undefined, undefined, ["batch-z", "batch-a"]); }
function batch(w: Work, args: string[] = ["--model", "glm-5.2"], values: Record<string, string> = {}): Result {
  return exec(w, "bash", [join(HARNESS, "batch.sh"), "--dry-run", ...args], {
    BENCH_DRY_RUN: "1", BENCH_RUNS_ROOT: w.runs, BENCH_PRICING_PATH: w.pricing,
    WEEK: "2026w50", ARMS: "a b", BENCH_TRACK: "build", ...values,
  });
}
function planned(r: Result): string[] {
  // Keep duplicates. A second execution of an ID must fail the exact-list check.
  return (r.stdout + r.stderr).split(/\r?\n/).filter(line => line.includes("DRY-RUN START")).map(line => {
    const m = / -> (\S+)$/.exec(line);
    expect(m, `${PIN}: malformed DRY-RUN START line: ${line}`).not.toBeNull();
    return m![1];
  }).sort();
}
const BUILD_IDS = ["a-glm-5-2-2026w50-r1", "a-glm-5-2-2026w50-r2", "a-glm-5-2-2026w50-r3", "b-glm-5-2-2026w50-r1", "b-glm-5-2-2026w50-r2", "b-glm-5-2-2026w50-r3"];
const UNPINNED_IDS = ["a-batch-a-2026w50-r1", "a-batch-a-2026w50-r2", "a-batch-a-2026w50-r3", "a-batch-z-2026w50-r1", "a-batch-z-2026w50-r2", "a-batch-z-2026w50-r3", "b-batch-a-2026w50-r1", "b-batch-a-2026w50-r2", "b-batch-a-2026w50-r3", "b-batch-z-2026w50-r1", "b-batch-z-2026w50-r2", "b-batch-z-2026w50-r3"];
function assertBatch(r: Result, ids: string[], pinned = true) {
  expect(r.status, `${PIN}: missing flag planning; ${r.stderr}`).toBe(0);
  expect(planned(r), `${PIN}: exact planned IDs`).toEqual(ids);
  const lines = (r.stdout + r.stderr).split(/\r?\n/);
  expect(lines.filter(line => line.startsWith("PINNED MODEL ")), PIN).toEqual(pinned ? ["PINNED MODEL glm-5.2"] : []);
  expect(lines.filter(line => line.startsWith("WORK LIST ")), PIN).toEqual(pinned ? [] : ["WORK LIST build — 2 of 2 batch models to schedule"]);
}

describe("batch pin", () => {
  caseOf("6.2.1 build: batch.sh --model exact six IDs", w => {
    batchSetup(w); assertBatch(batch(w), BUILD_IDS); expect(readdirSync(w.runs), PIN).toEqual([]);
  });
  caseOf("6.2.2 other tracks: batch.sh --model exact prefixes", w => {
    batchSetup(w);
    each([
      ["bugfix", ["bf-a-glm-5-2-2026w50-r1", "bf-b-glm-5-2-2026w50-r1"]],
      ["tests", ["tt-a-glm-5-2-2026w50-r1", "tt-b-glm-5-2-2026w50-r1"]],
      ["change", ["ch-a-glm-5-2-2026w50-r1", "ch-b-glm-5-2-2026w50-r1"]],
    ] as const, ([track, ids]) => assertBatch(batch(w, undefined, { BENCH_TRACK: track }), [...ids]));
    expect(readdirSync(w.runs), PIN).toEqual([]);
  });
  caseOf("6.2.3 unknown ID: batch.sh --model exits 2", w => {
    batchSetup(w); const r = batch(w, ["--model", "no-such-model"]);
    expect(r.status, `${PIN}: missing price-key validation`).toBe(2);
    expect(planned(r), PIN).toEqual([]); expect(readdirSync(w.runs), PIN).toEqual([]);
  });
  caseOf("6.2.4 no value: batch.sh --model exits 2", w => {
    batchSetup(w); const r = batch(w, ["--model"]);
    expect(r.status, `${PIN}: missing required flag value`).toBe(2);
    expect(planned(r), PIN).toEqual([]); expect(readdirSync(w.runs), PIN).toEqual([]);
  });
  caseOf("6.2.5 unsafe IDs: batch.sh --model exits 2", w => {
    batchSetup(w);
    each(["../x", "A", "x$(id)"], id => {
      const r = batch(w, ["--model", id]);
      expect(r.status, `${PIN}: missing safe-ID validation: ${id}`).toBe(2);
      expect(planned(r), `${PIN}: unsafe-ID plan: ${id}`).toEqual([]);
    });
    expect(readdirSync(w.runs), PIN).toEqual([]);
  });
  caseOf("6.2.6 pin wins: batch.sh --model ignores FORCE and failing batch model", w => {
    batchSetup(w); const dir = run(w, "a-batch-a-2026w49-r1", "batch-a");
    json(join(dir, "artifacts/score.json"), { valid: false });
    assertBatch(batch(w, undefined, { FORCE: "1" }), BUILD_IDS);
    expect(readdirSync(w.runs), PIN).toEqual(["a-batch-a-2026w49-r1"]);
  });
  caseOf("6.2.7 no pin: batch.sh preserves exact batch list", w => {
    batchSetup(w); assertBatch(batch(w, []), UNPINNED_IDS, false); expect(readdirSync(w.runs), PIN).toEqual([]);
  });
  caseOf("6.2.8 no variable pin: batch.sh ignores BENCH_MODEL", w => {
    batchSetup(w); assertBatch(batch(w, [], { BENCH_MODEL: "glm-5.2" }), UNPINNED_IDS, false);
    expect(readdirSync(w.runs), PIN).toEqual([]);
  });
});

const RUNNER_SOURCE = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const recPath = path.join(process.env.BENCH_DAILY_DIR, process.env.BENCH_DAILY_DATE + '.json');
const record = fs.existsSync(recPath) ? JSON.parse(fs.readFileSync(recPath, 'utf8')) : null;
fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({args, week: process.env.WEEK, record_present: record !== null, record}) + '\\n');
const model = args[1];
if (args.length !== 2 || args[0] !== '--model' || !/^[a-z0-9][a-z0-9.-]*$/.test(model)) process.exit(98);
for (const arm of ['a', 'b']) {
  const id = arm + '-' + model.replaceAll('.', '-') + '-' + process.env.WEEK + '-r1';
  const artifacts = path.join(process.env.BENCH_RUNS_ROOT, id, 'artifacts');
  fs.mkdirSync(artifacts, {recursive:true});
  fs.writeFileSync(path.join(artifacts, 'provenance.json'), JSON.stringify({executor:{kind:'opencode'}, model:'opencode-go/' + model, arm, track:'build'}));
}
process.exit(Number(process.env.STUB_EXIT || '0'));
`;
function jobSetup(w: Work) {
  inputs(w, { "glm-5.2": 100, "batch-a": 80 }, undefined, undefined, ["batch-a"]);
  // A .cjs file also works when a parent package declares type=module.
  writeFileSync(join(w.root, "runner.cjs"), RUNNER_SOURCE, { mode: 0o755 });
}
function job(w: Work, args: string[] = [], values: Record<string, string> = {}, date = DATE) {
  return exec(w, "bash", [join(HARNESS, "cron-daily.sh"), ...args], {
    BENCH_RUNS_ROOT: w.runs, BENCH_PRICING_PATH: w.pricing,
    BENCH_DAILY_DIR: w.days, BENCH_DAILY_DATE: date, BENCH_DAILY_CATALOG: w.catalog,
    BENCH_DAILY_SERVED: w.served, BENCH_DAILY_RUNNER: join(w.root, "runner.cjs"),
    BENCH_DAILY_PUBLISH: "0", BENCH_DAILY_LOCK: join(w.root, "weekly-cron.lock"),
    STUB_LOG: join(w.root, "stub.jsonl"), ARMS: "a b", ...values,
  });
}
function lines(r: Result, prefix: string) {
  return (r.stdout + "\n" + r.stderr).split(/\r?\n/).filter(line => line.startsWith(prefix));
}
function calls(w: Work): Json[] {
  const log = join(w.root, "stub.jsonl");
  return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];
}
function record(w: Work, date = DATE): Json { return JSON.parse(readFileSync(join(w.days, `${date}.json`), "utf8")); }
function jobSelection(date = DATE, week = WEEK) {
  return expected("glm-5.2", "untested", [row("glm-5.2", 100), row("batch-a", 80)], [2, 2, 2, 2], {}, date, week);
}
const STUB_IDS = ["a-glm-5-2-2026w44-r1", "b-glm-5-2-2026w44-r1"];
function assertJobPick(r: Result, e: Json) { expect(lines(r, "DAILY_PICK "), `${JOB}: missing exact DAILY_PICK line`).toEqual([pickLine(e)]); }
function assertStartRecord(w: Work, e: Json, index = 0) {
  const c = calls(w);
  expect(c.length, `${JOB}: missing --model runner call`).toBe(index + 1);
  expect(c[index], `${JOB}: day record must precede the runner`).toEqual({
    args: ["--model", e.model], week: e.week, record_present: true,
    record: { ...e, run_ids: [], runner_exit: null },
  });
}
function assertStopped(w: Work, r: Result, step: string) {
  expect(r.status, `${JOB}: missing ${step} failure exit`).not.toBe(0);
  expect(lines(r, `DAILY FAIL ${step}:`), `${JOB}: missing DAILY FAIL ${step} label`).toHaveLength(1);
  expect(lines(r, "DAILY_PICK "), JOB).toEqual([]);
  expect(readdirSync(w.days), `${JOB}: fault writes no day record`).toEqual([]);
  expect(calls(w), JOB).toEqual([]);
  expect(readdirSync(w.runs), JOB).toEqual([]);
}

describe("daily job", () => {
  caseOf("6.3.1 dry run: cron-daily.sh exact pick and 12 planned IDs", w => {
    jobSetup(w); const r = job(w, ["--dry-run"]);
    expect(r.status, `${JOB}: missing --dry-run; ${r.stderr}`).toBe(0);
    assertJobPick(r, jobSelection());
    expect(planned(r), JOB).toEqual([
      "a-glm-5-2-2026w44-r1", "a-glm-5-2-2026w44-r2", "a-glm-5-2-2026w44-r3",
      "b-glm-5-2-2026w44-r1", "b-glm-5-2-2026w44-r2", "b-glm-5-2-2026w44-r3",
      "bf-a-glm-5-2-2026w44-r1", "bf-b-glm-5-2-2026w44-r1",
      "ch-a-glm-5-2-2026w44-r1", "ch-b-glm-5-2-2026w44-r1",
      "tt-a-glm-5-2-2026w44-r1", "tt-b-glm-5-2-2026w44-r1",
    ]);
    expect(lines(r, "DAILY DRY-RUN "), JOB).toEqual(["DAILY DRY-RUN planned=12"]);
    expect(readdirSync(w.days), JOB).toEqual([]); expect(readdirSync(join(w.root, "reports")), JOB).toEqual(["daily"]);
    expect(readdirSync(w.runs), JOB).toEqual([]); expect(calls(w), JOB).toEqual([]);
  });
  caseOf("6.3.2 empty catalog: cron-daily.sh fails before pick", w => {
    jobSetup(w); writeFileSync(w.catalog, ""); assertStopped(w, job(w), "catalog");
  });
  caseOf("6.3.3 bad inputs: cron-daily.sh catalog and served failure labels", w => {
    jobSetup(w);
    each(["not JSON", "empty live", "empty served"], bad => {
      inputs(w, { "glm-5.2": 100, "batch-a": 80 });
      if (bad === "not JSON") writeFileSync(w.catalog, "not JSON");
      if (bad === "empty live") json(w.catalog, { live: [] });
      if (bad === "empty served") writeFileSync(w.served, "");
      assertStopped(w, job(w), bad === "empty served" ? "served" : "catalog");
    });
  });
  caseOf("6.3.4 live mode: cron-daily.sh writes day record before runner", w => {
    jobSetup(w); const r = job(w); const e = jobSelection();
    expect(r.status, `${JOB}: missing live entry point; ${r.stderr}`).toBe(0);
    assertJobPick(r, e); assertStartRecord(w, e);
    expect(record(w), `${JOB}: missing run_ids and runner_exit update`).toEqual({ ...e, run_ids: STUB_IDS, runner_exit: 0 });
    expect(readdirSync(w.runs).sort(), JOB).toEqual(STUB_IDS);
    expect(lines(r, "DAILY RUNNER "), JOB).toEqual(["DAILY RUNNER exit=0"]);
    expect(lines(r, "DAILY RUNS "), JOB).toEqual(["DAILY RUNS 2"]);
    expect(lines(r, "DAILY PUBLISH "), JOB).toEqual(["DAILY PUBLISH skipped"]);
  });
  caseOf("6.3.5 same day: cron-daily.sh resumes the recorded model", w => {
    jobSetup(w); const a = job(w);
    expect(a.status, `${JOB}: missing first-day execution; ${a.stderr}`).toBe(0);
    assertJobPick(a, jobSelection()); assertStartRecord(w, jobSelection());
    writeFileSync(w.served, "opencode-go/batch-a\n"); const b = job(w);
    expect(b.status, JOB).toBe(0);
    assertJobPick(b, { schema: 1, date: DATE, week: WEEK, model: "glm-5.2", reason: "resume" });
    expect(calls(w).map(c => ({ args: c.args, week: c.week, record_present: c.record_present })), JOB).toEqual([
      { args: ["--model", "glm-5.2"], week: WEEK, record_present: true },
      { args: ["--model", "glm-5.2"], week: WEEK, record_present: true },
    ]);
    expect(record(w).model, JOB).toBe("glm-5.2"); expect(record(w).run_ids, JOB).toEqual(STUB_IDS);
    expect(record(w).runner_exit, JOB).toBe(0); expect(readdirSync(w.runs).sort(), JOB).toEqual(STUB_IDS);
  });
  caseOf("6.3.6 next week: cron-daily.sh selects a new model with the recorded date", w => {
    jobSetup(w); const a = job(w);
    expect(a.status, `${JOB}: missing first-day execution; ${a.stderr}`).toBe(0);
    const e = expected("batch-a", "untested", [row("batch-a", 80), row("glm-5.2", 100, DATE)], [2, 2, 2, 1], {}, "2026-11-02", "2026w45");
    const b = job(w, [], {}, "2026-11-02"); expect(b.status, JOB).toBe(0); assertJobPick(b, e); assertStartRecord(w, e, 1);
    const ids = ["a-batch-a-2026w45-r1", "b-batch-a-2026w45-r1"];
    expect(record(w, "2026-11-02"), JOB).toEqual({ ...e, run_ids: ids, runner_exit: 0 });
    expect(record(w), JOB).toEqual({ ...jobSelection(), run_ids: STUB_IDS, runner_exit: 0 });
    expect(readdirSync(w.runs).sort(), JOB).toEqual([...ids, ...STUB_IDS].sort());
  });
  caseOf("6.3.7 lock held: cron-daily.sh selects nothing", async w => {
    jobSetup(w);
    // The child holds flock until stdin closes. READY proves that it owns the lock.
    const holder = spawn("flock", ["-x", join(w.root, "weekly-cron.lock"), "bash", "-c", "printf 'READY\\n'; read -r release"], {
      cwd: w.root, env: env(w), stdio: ["pipe", "pipe", "pipe"],
    });
    try {
      await new Promise<void>((ok, reject) => {
        holder.once("error", reject);
        holder.once("exit", code => reject(new Error(`lock holder exited ${code}`)));
        holder.stdout.once("data", data => String(data) === "READY\n" ? ok() : reject(new Error("lock readiness mismatch")));
      });
      const r = job(w);
      expect(r.status, `${JOB}: missing shared lock; ${r.stderr}`).toBe(0);
      expect(lines(r, "DAILY SKIP "), JOB).toEqual(["DAILY SKIP lock held"]);
      expect(lines(r, "DAILY_PICK "), JOB).toEqual([]); expect(calls(w), JOB).toEqual([]); expect(readdirSync(w.days), JOB).toEqual([]);
    } finally {
      const exited = new Promise<void>(ok => holder.once("exit", () => ok()));
      holder.stdin.end("release\n"); await exited;
    }
  });
  caseOf("6.3.8 bad day record: cron-daily.sh stops before runner", w => {
    jobSetup(w); const path = join(w.days, `${DATE}.json`); writeFileSync(path, "not JSON");
    const r = job(w);
    expect(r.status, `${JOB}: invalid day record must exit 2`).toBe(2);
    expect(lines(r, "DAILY_PICK "), JOB).toEqual([]); expect(calls(w), JOB).toEqual([]);
    expect(readFileSync(path, "utf8"), JOB).toBe("not JSON"); expect(readdirSync(w.runs), JOB).toEqual([]);
  });
  caseOf("6.3.9 none: cron-daily.sh publishes nothing", w => {
    jobSetup(w); run(w, "a-glm-5-2-2026w44-r1", "glm-5.2"); run(w, "a-batch-a-2026w44-r1", "batch-a");
    const r = job(w); expect(r.status, `${JOB}: none is a successful no-op; ${r.stderr}`).toBe(0);
    assertJobPick(r, expected(null, "none", [], [2, 2, 0, 0], { this_week: ["batch-a", "glm-5.2"] }));
    expect(readdirSync(w.days), JOB).toEqual([]); expect(calls(w), JOB).toEqual([]);
    expect(lines(r, "DAILY PUBLISH "), JOB).toEqual(["DAILY PUBLISH none"]);
    expect(readdirSync(w.runs).sort(), JOB).toEqual(["a-batch-a-2026w44-r1", "a-glm-5-2-2026w44-r1"]);
  });
  caseOf("6.3.10 runner failure: day record runner_exit is 4", w => {
    jobSetup(w); const r = job(w, [], { STUB_EXIT: "4" });
    expect(r.status, `${JOB}: runner failure must stop publishing`).not.toBe(0);
    assertJobPick(r, jobSelection()); assertStartRecord(w, jobSelection());
    expect(record(w), JOB).toEqual({ ...jobSelection(), run_ids: STUB_IDS, runner_exit: 4 });
    expect(lines(r, "DAILY RUNNER "), JOB).toEqual(["DAILY RUNNER exit=4"]);
    expect(lines(r, "DAILY PUBLISH "), JOB).toEqual(["DAILY PUBLISH none"]);
  });
});

describe("artifacts", () => {
  caseOf("6.4.1 weekly.sh forwards batch.sh --model arguments", () => {
    const weekly = readFileSync(join(HARNESS, "weekly.sh"), "utf8");
    const invocations = weekly.split(/\r?\n/).filter(line => /^\s*if ! BENCH_TRACK="\$track" \.\/batch\.sh/.test(line));
    expect(invocations, `${PIN}: weekly.sh lacks ./batch.sh "$@"`).toEqual(['  if ! BENCH_TRACK="$track" ./batch.sh "$@"; then']);
  });
  caseOf("6.4.2 batch.sh retains the exact self-check scrub list", () => {
    const batch = readFileSync(join(HARNESS, "batch.sh"), "utf8");
    const invocations = batch.split(/\r?\n/).filter(line => line.includes('npm run --silent "$meta_script"'));
    expect(invocations, `${PIN}: self-check must retain BENCH_TRACK and repeat scrubbing`).toEqual([
      '  if ! env -u BENCH_TRACK -u REPS -u REPS_BUILD -u REPS_BUGFIX -u REPS_TESTS -u REPS_CHANGE npm run --silent "$meta_script" > "meta-selfcheck.log" 2>&1; then',
    ]);
  });
});
