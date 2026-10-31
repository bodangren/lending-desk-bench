import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
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
  caseOf("6.2.9 empty value: batch.sh --model exits 2", w => {
    batchSetup(w); const r = batch(w, ["--model", ""]);
    expect(r.status, `${PIN}: an empty --model value must exit 2`).toBe(2);
    expect(lines(r, "WORK LIST "), PIN).toEqual([]);
    expect(lines(r, "PINNED MODEL "), PIN).toEqual([]);
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

const BATCH_SOURCE = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const recPath = path.join(process.env.BENCH_DAILY_DIR, process.env.BENCH_DAILY_DATE + '.json');
const record = fs.existsSync(recPath) ? JSON.parse(fs.readFileSync(recPath, 'utf8')) : null;
const track = process.env.BENCH_TRACK || '';
fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({args, week: process.env.WEEK, track, record_present: record !== null, record}) + '\\n');
const model = args[1];
if (args.length !== 2 || args[0] !== '--model' || !/^[a-z0-9][a-z0-9.-]*$/.test(model)) process.exit(98);
if (!process.env.STUB_NO_RUNS) {
  for (const arm of ['a', 'b']) {
    const id = arm + '-' + model.replaceAll('.', '-') + '-' + process.env.WEEK + '-r1';
    const artifacts = path.join(process.env.BENCH_RUNS_ROOT, id, 'artifacts');
    fs.mkdirSync(artifacts, {recursive:true});
    fs.writeFileSync(path.join(artifacts, 'provenance.json'), JSON.stringify({executor:{kind:'opencode'}, model:'opencode-go/' + model, arm, track: track || 'build'}));
    if (process.env.STUB_INVALID) fs.writeFileSync(path.join(artifacts, 'score.json'), JSON.stringify({valid:false}));
  }
}
process.exit(Number(process.env.STUB_EXIT || '0'));
`;
const QUOTA_TEN_SOURCE = `#!/usr/bin/env node
process.stdout.write('{"usage":{"windows":{"weekly":{"usedPercent":10},"monthly":{"usedPercent":10}}}}');
`;
// Stops the retired default weekly.sh from touching the real reports tree.
// A D12 job must not start this process.
const RETIRED_RUNNER_SOURCE = `#!/usr/bin/env node
const fs = require('node:fs');
if (process.env.STUB_LOG) fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({retired_runner:true, args:process.argv.slice(2)}) + '\\n');
process.exit(97);
`;
// The runner of the publish case. It writes the site data of the day, so the
// job has something to commit under docs/.
const PUBLISH_RUNNER_SOURCE = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({args}) + '\\n');
const model = args[1];
for (const arm of ['a', 'b']) {
  const id = arm + '-' + model.replaceAll('.', '-') + '-' + process.env.WEEK + '-r1';
  const artifacts = path.join(process.env.BENCH_RUNS_ROOT, id, 'artifacts');
  fs.mkdirSync(artifacts, {recursive:true});
  fs.writeFileSync(path.join(artifacts, 'provenance.json'), JSON.stringify({executor:{kind:'opencode'}, model:'opencode-go/' + model, arm, track:'build'}));
}
const docs = process.env.STUB_DOCS_DIR;
fs.mkdirSync(path.join(docs, 'assets', 'data'), {recursive:true});
fs.writeFileSync(path.join(docs, 'assets', 'data', 'benchmark.json'), JSON.stringify({generated_at: '2026-10-27'}) + '\\n');
process.exit(0);
`;
function jobSetup(w: Work) {
  inputs(w, { "glm-5.2": 100, "batch-a": 80 }, undefined, undefined, ["batch-a"]);
  // A .cjs file also works when a parent package declares type=module.
  writeFileSync(join(w.root, "batch.cjs"), BATCH_SOURCE, { mode: 0o755 });
  writeFileSync(join(w.root, "quota.cjs"), QUOTA_TEN_SOURCE, { mode: 0o755 });
  writeFileSync(join(w.root, "retired-runner.cjs"), RETIRED_RUNNER_SOURCE, { mode: 0o755 });
}
function job(w: Work, args: string[] = [], values: Record<string, string> = {}, date = DATE) {
  // A dry run keeps the real batch.sh, so case 6.3.1 can still see 12 planned ids.
  // A live run points at the batch stub. The retired runner must not start.
  const dry = args.includes("--dry-run");
  const seams: Record<string, string> = {
    BENCH_DAILY_POST: "0",
    BENCH_DAILY_QUOTA_CMD: join(w.root, "quota.cjs"),
  };
  if (!dry) {
    seams.BENCH_DAILY_BATCH = join(w.root, "batch.cjs");
    seams.BENCH_DAILY_RUNNER = join(w.root, "retired-runner.cjs");
  }
  return exec(w, "bash", [join(HARNESS, "cron-daily.sh"), ...args], {
    BENCH_RUNS_ROOT: w.runs, BENCH_PRICING_PATH: w.pricing,
    BENCH_DAILY_DIR: w.days, BENCH_DAILY_DATE: date, BENCH_DAILY_CATALOG: w.catalog,
    BENCH_DAILY_SERVED: w.served,
    BENCH_DAILY_PUBLISH: "0", BENCH_DAILY_LOCK: join(w.root, "weekly-cron.lock"),
    STUB_LOG: join(w.root, "stub.jsonl"), ARMS: "a b", ...seams, ...values,
  });
}
function lines(r: Result, prefix: string) {
  return (r.stdout + "\n" + r.stderr).split(/\r?\n/).filter(line => line.startsWith(prefix));
}
function calls(w: Work): Json[] {
  const log = join(w.root, "stub.jsonl");
  return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
}
function batchCalls(w: Work): Json[] {
  return calls(w).filter(call => Array.isArray(call.args) && !call.retired_runner);
}
function record(w: Work, date = DATE): Json { return JSON.parse(readFileSync(join(w.days, `${date}.json`), "utf8")); }
function jobSelection(date = DATE, week = WEEK) {
  return expected("glm-5.2", "untested", [row("glm-5.2", 100), row("batch-a", 80)], [2, 2, 2, 2], {}, date, week);
}
const STUB_IDS = ["a-glm-5-2-2026w44-r1", "b-glm-5-2-2026w44-r1"];
function assertJobPick(r: Result, e: Json) { expect(lines(r, "DAILY_PICK "), `${JOB}: missing exact DAILY_PICK line`).toEqual([pickLine(e)]); }
function assertStartRecord(w: Work, e: Json, jobIndex = 0) {
  const c = batchCalls(w);
  const start = jobIndex * 4;
  const tracks = ["build", "bugfix", "tests", "change"];
  expect(c.length, `${JOB}: missing D12 BENCH_DAILY_BATCH calls`).toBe(start + 4);
  tracks.forEach((track, i) => {
    expect(c[start + i]?.args, `${JOB}: D12 batch ${track} must receive --model`).toEqual(["--model", e.model]);
    expect(c[start + i]?.track, `${JOB}: missing D12 BENCH_TRACK=${track}`).toBe(track);
  });
  expect(c[start], `${JOB}: day record must precede the first D12 batch`).toMatchObject({
    args: ["--model", e.model], week: e.week, record_present: true,
    record: { ...e, run_ids: [], runner_exit: null, go_guard_stop: null },
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
    const guard = lines(r, "DAILY GO-GUARD ");
    expect(guard, `${JOB}: missing D12 DAILY GO-GUARD weekly=10 monthly=10`).toEqual(["DAILY GO-GUARD weekly=10 monthly=10"]);
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
    expect(r.status, `${JOB}: missing D12 BENCH_DAILY_BATCH; ${r.stderr}`).toBe(0);
    assertJobPick(r, e); assertStartRecord(w, e);
    expect(record(w), `${JOB}: missing run_ids and runner_exit update`).toEqual({ ...e, run_ids: STUB_IDS, runner_exit: 0, go_guard_stop: null });
    expect(readdirSync(w.runs).sort(), JOB).toEqual(STUB_IDS);
    expect(lines(r, "DAILY RUNNER "), JOB).toEqual(["DAILY RUNNER exit=0"]);
    expect(lines(r, "DAILY RUNS "), JOB).toEqual(["DAILY RUNS 2"]);
    expect(lines(r, "DAILY PUBLISH "), JOB).toEqual(["DAILY PUBLISH skipped"]);
  });
  caseOf("6.3.5 same day: cron-daily.sh resumes the recorded model", w => {
    jobSetup(w); const a = job(w);
    expect(a.status, `${JOB}: missing D12 BENCH_DAILY_BATCH; ${a.stderr}`).toBe(0);
    assertJobPick(a, jobSelection()); assertStartRecord(w, jobSelection());
    writeFileSync(w.served, "opencode-go/batch-a\n"); const b = job(w);
    expect(b.status, JOB).toBe(0);
    assertJobPick(b, { schema: 1, date: DATE, week: WEEK, model: "glm-5.2", reason: "resume" });
    const four = ["build", "bugfix", "tests", "change"].map(track => ({ args: ["--model", "glm-5.2"], week: WEEK, track, record_present: true }));
    expect(batchCalls(w).map(c => ({ args: c.args, week: c.week, track: c.track, record_present: c.record_present })), `${JOB}: missing D12 BENCH_DAILY_BATCH order`).toEqual([...four, ...four]);
    expect(record(w).model, JOB).toBe("glm-5.2"); expect(record(w).run_ids, JOB).toEqual(STUB_IDS);
    expect(record(w).runner_exit, JOB).toBe(0); expect(readdirSync(w.runs).sort(), JOB).toEqual(STUB_IDS);
  });
  caseOf("6.3.6 next week: cron-daily.sh selects a new model with the recorded date", w => {
    jobSetup(w); const a = job(w);
    expect(a.status, `${JOB}: missing D12 BENCH_DAILY_BATCH; ${a.stderr}`).toBe(0);
    const e = expected("batch-a", "untested", [row("batch-a", 80), row("glm-5.2", 100, DATE)], [2, 2, 2, 1], {}, "2026-11-02", "2026w45");
    const b = job(w, [], {}, "2026-11-02"); expect(b.status, JOB).toBe(0); assertJobPick(b, e); assertStartRecord(w, e, 1);
    const ids = ["a-batch-a-2026w45-r1", "b-batch-a-2026w45-r1"];
    expect(record(w, "2026-11-02"), JOB).toEqual({ ...e, run_ids: ids, runner_exit: 0, go_guard_stop: null });
    expect(record(w), JOB).toEqual({ ...jobSelection(), run_ids: STUB_IDS, runner_exit: 0, go_guard_stop: null });
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
    expect(record(w), JOB).toEqual({ ...jobSelection(), run_ids: STUB_IDS, runner_exit: 4, go_guard_stop: null });
    expect(lines(r, "DAILY RUNNER "), JOB).toEqual(["DAILY RUNNER exit=4"]);
    expect(lines(r, "DAILY PUBLISH "), JOB).toEqual(["DAILY PUBLISH none"]);
  });
  caseOf("6.3.11 shared lock: cron-daily.sh selects nothing", async w => {
    jobSetup(w);
    // The holder keeps a shared lock. The job takes the lock exclusively, so
    // a second daily job must skip.
    const holder = spawn("flock", ["-s", join(w.root, "weekly-cron.lock"), "bash", "-c", "printf 'READY\\n'; read -r release"], {
      cwd: w.root, env: env(w), stdio: ["pipe", "pipe", "pipe"],
    });
    try {
      await new Promise<void>((ok, reject) => {
        holder.once("error", reject);
        holder.once("exit", code => reject(new Error(`lock holder exited ${code}`)));
        holder.stdout.once("data", data => String(data) === "READY\n" ? ok() : reject(new Error("lock readiness mismatch")));
      });
      const r = job(w);
      expect(r.status, `${JOB}: a shared lock must skip the job; ${r.stderr}`).toBe(0);
      expect(lines(r, "DAILY SKIP "), JOB).toEqual(["DAILY SKIP lock held"]);
      expect(lines(r, "DAILY_PICK "), JOB).toEqual([]); expect(calls(w), JOB).toEqual([]); expect(readdirSync(w.days), JOB).toEqual([]);
    } finally {
      const exited = new Promise<void>(ok => holder.once("exit", () => ok()));
      holder.stdin.end("release\n"); await exited;
    }
  });
  caseOf("6.3.12 zero runs: cron-daily.sh fails the day", w => {
    jobSetup(w); const r = job(w, [], { STUB_NO_RUNS: "1" });
    expect(r.status, `${JOB}: a runner with no run must fail the day`).not.toBe(0);
    assertJobPick(r, jobSelection()); assertStartRecord(w, jobSelection());
    expect(lines(r, "DAILY RUNNER "), JOB).toEqual(["DAILY RUNNER exit=0"]);
    expect(lines(r, "DAILY RUNS "), JOB).toEqual(["DAILY RUNS 0"]);
    expect(lines(r, "DAILY FAIL runs:"), JOB).toEqual(["DAILY FAIL runs: the runner produced no runs"]);
    expect(lines(r, "DAILY PUBLISH "), JOB).toEqual(["DAILY PUBLISH none"]);
    expect(record(w), JOB).toEqual({ ...jobSelection(), run_ids: [], runner_exit: 0, go_guard_stop: null });
    expect(readdirSync(w.runs), JOB).toEqual([]);
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
  caseOf("6.4.3 publish scope: cron-daily.sh commits only docs/", () => {
    const cron = readFileSync(join(HARNESS, "cron-daily.sh"), "utf8");
    const adds = cron.split(/\r?\n/).filter(line => line.includes("git add"));
    expect(adds, `${JOB}: the job must stage only docs/`).toEqual(["git add docs/"]);
    const checks = cron.split(/\r?\n/).filter(line => line.includes("git diff --cached --quiet"));
    expect(checks, `${JOB}: the empty check must be limited to docs/`).toEqual(["if git diff --cached --quiet -- docs/; then"]);
    const commits = cron.split(/\r?\n/).filter(line => line.includes("git commit"));
    expect(commits, `${JOB}: the publish commit must be path-limited to docs/`).toEqual(['if ! git commit -F "$MSG_FILE" -- docs/; then']);
    const pushes = cron.split(/\r?\n/).filter(line => line.includes("git push"));
    expect(pushes.some(line => /git push origin ["']?\$\{?[A-Za-z_][A-Za-z0-9_]*\}?:main/.test(line)), `${JOB}: missing D13 git push origin <sha>:main`).toBe(true);
    expect(cron.includes("git push origin main"), `${JOB}: D13 forbids git push origin main`).toBe(false);
  });
  caseOf("6.4.4 publish scope: the publish commit holds only docs/", w => {
    // A temporary git repository. The script runs from a copy inside it, so
    // its git commands act on the temporary root only.
    jobSetup(w);
    const repo = join(w.root, "pub");
    const origin = join(w.root, "origin.git");
    const gitEnv = { PATH: "/usr/bin:/bin", HOME: w.home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
    const git = (args: string[], cwd = repo) => {
      const r = spawnSync("git", args, { cwd, env: gitEnv, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
      return r.stdout.trim();
    };
    git(["init", "-q", "-b", "main", repo], w.root);
    git(["init", "-q", "--bare", "-b", "main", origin], w.root);
    git(["config", "user.email", "schedule@example.invalid"]);
    git(["config", "user.name", "Schedule Test"]);
    git(["remote", "add", "origin", origin]);
    mkdirSync(join(repo, "harness"), { recursive: true });
    mkdirSync(join(repo, "docs/assets/data"), { recursive: true });
    copyFileSync(join(HARNESS, "cron-daily.sh"), join(repo, "harness/cron-daily.sh"));
    for (const name of ["daily-pick.ts", "go-cost.ts", "candidate-contract.ts", "package.json", "toolchain.sh"])
      symlinkSync(join(HARNESS, name), join(repo, "harness", name));
    symlinkSync(join(HARNESS, "node_modules"), join(repo, "harness/node_modules"));
    writeFileSync(join(repo, "docs/index.html"), "<html></html>\n");
    git(["add", "docs/"]);
    git(["commit", "-q", "-m", "initial"]);
    // origin/main must equal the parent of the later docs commit (D13).
    git(["push", "-q", "origin", "main"]);
    // A path outside docs/, staged before the job runs.
    writeFileSync(join(repo, "secret.txt"), "not for the publish\n");
    git(["add", "secret.txt"]);
    // The runner writes the site data and the two run directories.
    writeFileSync(join(w.root, "publish-runner.cjs"), PUBLISH_RUNNER_SOURCE, { mode: 0o755 });
    const r = spawnSync("bash", [join(repo, "harness/cron-daily.sh")], {
      cwd: repo, encoding: "utf8", timeout: 30_000,
      env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: w.home, TMPDIR: w.root,
        TSX_DISABLE_CACHE: "1", _BENCH_ENV_LOADED: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
        BENCH_RUNS_ROOT: w.runs, BENCH_PRICING_PATH: w.pricing, BENCH_DAILY_DIR: w.days,
        BENCH_DAILY_DATE: DATE, BENCH_DAILY_CATALOG: w.catalog, BENCH_DAILY_SERVED: w.served,
        BENCH_DAILY_BATCH: join(w.root, "publish-runner.cjs"), BENCH_DAILY_POST: "0",
        BENCH_DAILY_QUOTA_CMD: join(w.root, "quota.cjs"), BENCH_DAILY_PUBLISH: "1",
        BENCH_DAILY_LOCK: join(w.root, "publish.lock"), STUB_LOG: join(w.root, "publish-stub.jsonl"),
        STUB_DOCS_DIR: join(repo, "docs") },
    });
    const result: Result = { status: r.status, stdout: r.stdout, stderr: r.stderr };
    expect(result.status, `${JOB}: missing D12 BENCH_DAILY_BATCH; D13 git push origin <sha>:main; ${result.stderr}`).toBe(0);
    const published = lines(result, "DAILY PUBLISH ");
    expect(published.length, JOB).toBe(1);
    expect(published[0], JOB).toMatch(/^DAILY PUBLISH [0-9a-f]{7,}$/);
    expect(lines(result, "DAILY FAIL "), JOB).toEqual([]);
    const committed = git(["show", "--name-only", "--format=", "HEAD"]).split("\n").filter(Boolean).sort();
    expect(committed, `${JOB}: the publish commit must hold only docs/`).toEqual(["docs/assets/data/benchmark.json"]);
    const pushed = git(["ls-tree", "-r", "--name-only", "main"], origin).split("\n").filter(Boolean).sort();
    expect(pushed, `${JOB}: the push must hold only docs/`).toEqual(["docs/assets/data/benchmark.json", "docs/index.html"]);
    expect(git(["ls-files", "--cached"]).split("\n"), JOB).toContain("secret.txt");
    expect(git(["log", "-1", "--format=%s"]), JOB).toBe("Publish daily 2026-10-26 OpenCode Go results: glm-5.2 (untested).");
  });
  caseOf("6.4.5 header: cron-daily.sh names the timer and Persistent=false", () => {
    const cron = readFileSync(join(HARNESS, "cron-daily.sh"), "utf8");
    const header = cron.split(/^set -u$/m)[0];
    expect(header, `${JOB}: missing D11 harness/systemd/lending-desk-daily.timer`).toContain("harness/systemd/lending-desk-daily.timer");
    expect(header, `${JOB}: missing D11 Persistent=false`).toContain("Persistent=false");
    expect(header.includes("0 1 * * 0,3"), `${JOB}: D11 forbids the crontab install line`).toBe(false);
  });
  caseOf("6.4.6 live quota source: cron-daily.sh names the local port read", () => {
    const cron = readFileSync(join(HARNESS, "cron-daily.sh"), "utf8");
    for (const token of ["openchamber status --json", "127.0.0.1", "/api/quota/opencode-go", "usedPercent"]) {
      expect(cron, `${JOB}: missing D12 live quota token ${token}`).toContain(token);
    }
    expect(cron.includes("http://127.0.0.1:"), `${JOB}: D12 GET host must be 127.0.0.1`).toBe(true);
  });
  caseOf("6.4.7 post steps: cron-daily.sh names the steps after the four batches", () => {
    const cron = readFileSync(join(HARNESS, "cron-daily.sh"), "utf8");
    for (const name of ["rescore-doctor.sh", "recost.sh", "export-site-data.py", "generate-model-pages.py", "cleanup.sh"]) {
      expect(cron, `${JOB}: missing D12 post step ${name}`).toContain(name);
    }
  });
});

// ---- Section 12: the adversarial cases ------------------------------------------

// The runner of case 12.4. Its runs are not valid, so the model counts as
// tested (spec D3) and the next day selects another model.
const INVALID_RUNNER_SOURCE = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({args, week: process.env.WEEK}) + '\\n');
const model = args[1];
for (const arm of ['a', 'b']) {
  const id = arm + '-' + model.replaceAll('.', '-') + '-' + process.env.WEEK + '-r1';
  const artifacts = path.join(process.env.BENCH_RUNS_ROOT, id, 'artifacts');
  fs.mkdirSync(artifacts, {recursive:true});
  fs.writeFileSync(path.join(artifacts, 'provenance.json'), JSON.stringify({executor:{kind:'opencode'}, model:'opencode-go/' + model, arm, track:'build'}));
  fs.writeFileSync(path.join(artifacts, 'score.json'), JSON.stringify({valid:false}));
}
process.exit(0);
`;

// A listing of a directory tree. The scratch directory holds the caches of the
// runtime, so it is one entry and the tree under it is not read.
function listing(root: string, skip: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (full === skip) { out.push(`${rel}/`); continue; }
      const st = statSync(full);
      if (st.isDirectory()) { out.push(`${rel}/`); walk(full, rel); }
      else out.push(`${rel}:${st.size}`);
    }
  };
  walk(root, "");
  return out;
}

describe("adversarial", () => {
  caseOf("12.1 two models on one day: cron-daily.sh keeps the recorded model until the operator deletes the record", w => {
    jobSetup(w);
    const first = job(w);
    expect(first.status, `${JOB}: missing D12 BENCH_DAILY_BATCH; ${first.stderr}`).toBe(0);
    assertJobPick(first, jobSelection());
    // A new live list. A new selection would now give another model, but the
    // record of the day holds the model of the day (spec rule 1).
    json(w.catalog, { live: ["batch-a"] });
    const second = job(w);
    expect(second.status, `${JOB}: the second job run must succeed; ${second.stderr}`).toBe(0);
    assertJobPick(second, { schema: 1, date: DATE, week: WEEK, model: "glm-5.2", reason: "resume" });
    // The operator deleted the day record. The job has no record to resume, so
    // it makes a new pick. The plan names this deletion as an operator action.
    rmSync(join(w.days, `${DATE}.json`));
    const third = job(w);
    expect(third.status, `${JOB}: the third job run must succeed; ${third.stderr}`).toBe(0);
    const e = expected("batch-a", "untested", [row("batch-a", 80)], [1, 1, 1, 1], { gone: ["glm-5.2"] });
    assertJobPick(third, e);
    expect(record(w), `${JOB}: the new pick must reach the day record`).toEqual({
      ...e, run_ids: ["a-batch-a-2026w44-r1", "b-batch-a-2026w44-r1"], runner_exit: 0, go_guard_stop: null,
    });
    expect(batchCalls(w).map(c => c.args), `${JOB}: missing D12 BENCH_DAILY_BATCH calls`).toEqual([
      ...Array(8).fill(["--model", "glm-5.2"]), ["--model", "batch-a"], ["--model", "batch-a"], ["--model", "batch-a"], ["--model", "batch-a"],
    ]);
  });
  caseOf("12.2 unpriced id: cron-daily.sh never selects a model that the price table names in aliases only", w => {
    jobSetup(w);
    // The live list holds an id that the price table names in aliases only.
    // The alias points at a model with more requests, so a selector that
    // resolves the live list through aliases would pick that model.
    inputs(w, { a: 50, b: 100 }, ["x-alias", "a"], ["x-alias", "a", "b"], [], { "x-alias": "b" });
    const r = job(w);
    expect(r.status, `${JOB}: missing D12 BENCH_DAILY_BATCH; ${r.stderr}`).toBe(0);
    const e = expected("a", "untested", [row("a", 50)], [2, 1, 1, 1], { unpriced: ["x-alias"], gone: ["b"] });
    assertJobPick(r, e);
    expect(record(w), `${JOB}: the excluded lists must reach the day record`).toEqual({
      ...e, run_ids: ["a-a-2026w44-r1", "b-a-2026w44-r1"], runner_exit: 0, go_guard_stop: null,
    });
    expect(batchCalls(w).map(c => c.args), `${JOB}: missing D12 BENCH_DAILY_BATCH calls`).toEqual(Array(4).fill(["--model", "a"]));
  });
  caseOf("12.3 stale model: daily-pick.ts ignores a directory time and an unrelated day record", w => {
    // The expected result: the pick stays a, with the last test date
    // 2026-10-04. A directory time and a record of another run must not move
    // that date (spec EV6 and D4).
    inputs(w, { a: 50, b: 100 });
    run(w, "a-a-2026w40-r1", "a"); run(w, "a-b-2026w42-r1", "b");
    assertPick(pick(w), expected("a", "stalest", [row("a", 50, "2026-10-04"), row("b", 100, "2026-10-18")], [2, 2, 2, 0]));
    utimesSync(join(w.runs, "a-a-2026w40-r1"), new Date(), new Date());
    // The record names the run of b only. Its date belongs to that run alone.
    day(w, "2026-12-31", "b", ["a-b-2026w42-r1"]);
    assertPick(pick(w), expected("a", "stalest", [row("a", 50, "2026-10-04"), row("b", 100, "2026-12-31")], [2, 2, 2, 0]));
  });
  caseOf("12.4 invalid runs: cron-daily.sh selects another model on the next day", w => {
    jobSetup(w);
    const invalid = { STUB_INVALID: "1" };
    const first = job(w, [], invalid);
    expect(first.status, `${JOB}: missing D12 BENCH_DAILY_BATCH; ${first.stderr}`).toBe(0);
    assertJobPick(first, jobSelection());
    // The runs of the first day are not valid. They still count as a test, so
    // the model moves to the end of the order and the next day gives another
    // model (spec D3).
    const second = job(w, [], invalid, "2026-11-02");
    expect(second.status, `${JOB}: missing D12 BENCH_DAILY_BATCH; ${second.stderr}`).toBe(0);
    const e = expected("batch-a", "untested", [row("batch-a", 80), row("glm-5.2", 100, DATE)], [2, 2, 2, 1], {}, "2026-11-02", "2026w45");
    assertJobPick(second, e);
    expect(record(w, "2026-11-02"), `${JOB}: the new model must reach the day record`).toEqual({
      ...e, run_ids: ["a-batch-a-2026w45-r1", "b-batch-a-2026w45-r1"], runner_exit: 0, go_guard_stop: null,
    });
    expect(batchCalls(w).map(c => c.args), `${JOB}: missing D12 BENCH_DAILY_BATCH calls`).toEqual([
      ...Array(4).fill(["--model", "glm-5.2"]), ...Array(4).fill(["--model", "batch-a"]),
    ]);
  });
  caseOf("12.5 hostile id: cron-daily.sh never runs an id that came from the endpoint", w => {
    jobSetup(w);
    const pwned = join(w.root, "pwned");
    const hostile = [`x; touch ${pwned}`, "$(id)", "../../etc"];
    // The served list holds the hostile ids too, so the price table is the
    // only thing that keeps them out of the candidate list.
    inputs(w, { "safe-model": 100 }, ["safe-model", ...hostile], ["safe-model", ...hostile], []);
    // A stub for the id command. A shell that evaluates $(id) writes a marker.
    writeFileSync(join(w.bin, "id"), `#!/usr/bin/env bash\ntouch "${join(w.root, "id-ran")}"\nexit 0\n`, { mode: 0o755 });
    const r = job(w);
    expect(r.status, `${JOB}: missing D12 BENCH_DAILY_BATCH; ${r.stderr}`).toBe(0);
    const e = expected("safe-model", "untested", [row("safe-model", 100)], [4, 1, 1, 1],
      { unpriced: ["$(id)", "../../etc", `x; touch ${pwned}`] });
    assertJobPick(r, e);
    expect(record(w), `${JOB}: the excluded lists must reach the day record`).toEqual({
      ...e, run_ids: ["a-safe-model-2026w44-r1", "b-safe-model-2026w44-r1"], runner_exit: 0, go_guard_stop: null,
    });
    expect(batchCalls(w).map(c => c.args), `${JOB}: missing D12 BENCH_DAILY_BATCH calls`).toEqual(Array(4).fill(["--model", "safe-model"]));
    expect(existsSync(pwned), `${JOB}: the job must not run a hostile id`).toBe(false);
    expect(existsSync("/tmp/pwned"), `${JOB}: no file named pwned may exist`).toBe(false);
    expect(existsSync(join(w.root, "id-ran")), `${JOB}: no shell may evaluate the hostile id`).toBe(false);
  });
  caseOf("12.6 dry run writes nothing: cron-daily.sh leaves the temporary root unchanged", w => {
    jobSetup(w);
    // The job opens the lock file. It exists before the run, so the listing
    // shows every file of the root.
    writeFileSync(join(w.root, "weekly-cron.lock"), "");
    // The scratch directory holds the caches of the runtime. It is inside the
    // temporary root, so the job still writes nothing outside it.
    const scratch = join(w.root, "scratch");
    mkdirSync(scratch, { recursive: true });
    const before = listing(w.root, scratch);
    const r = job(w, ["--dry-run"], { TMPDIR: scratch });
    expect(r.status, `${JOB}: the dry run must succeed; ${r.stderr}`).toBe(0);
    expect(listing(w.root, scratch), `${JOB}: the dry run must write no file under the temporary root`).toEqual(before);
    expect(readdirSync(w.days), `${JOB}: the dry run must write no day record`).toEqual([]);
    expect(readdirSync(w.runs), `${JOB}: the dry run must write no run directory`).toEqual([]);
    expect(calls(w), `${JOB}: the dry run must call no runner`).toEqual([]);
  });
  caseOf("12.7 forged date: daily-pick.ts dates only the run that the day record lists", w => {
    // The expected result: the pick is a, with the last test date
    // 2026-10-11. The record of 2026-10-20 names the run of b, so that date
    // belongs to b alone (spec D4). A record that moves every run would give
    // b, and a record that moves no run would also give b.
    inputs(w, { a: 50, b: 100 });
    run(w, "a-a-2026w41-r1", "a"); run(w, "a-b-2026w40-r1", "b");
    day(w, "2026-10-20", "b", ["a-b-2026w40-r1"]);
    assertPick(pick(w), expected("a", "stalest", [row("a", 50, "2026-10-11"), row("b", 100, "2026-10-20")], [2, 2, 2, 0]));
  });
});

// ---- Section 6.5: O1 conditions -------------------------------------------------
// Each spawn below uses an explicit environment. No case writes under the real
// runs/, reports/, or systemd folders. No case calls a model or openchamber.

const D11 = "D11 harness/systemd/lending-desk-daily.service and lending-desk-daily.timer";
const D12Q = "D12 BENCH_DAILY_QUOTA_CMD";
const D12B = "D12 BENCH_DAILY_BATCH";
const D13 = "D13 git push origin <sha>:main";
const D14 = "D14 BENCH_DAILY_SELECT";
type QuotaStep = { value?: number | string | null; monthly?: number | string | null; omitMonthly?: boolean; raw?: string; exit?: number; omit?: boolean };

function writeQuota(w: Work, name: string, steps: QuotaStep[]): string {
  const script = join(w.root, name);
  const counter = join(w.root, `${name}.n`);
  const log = join(w.root, "order.jsonl");
  writeFileSync(script, `#!/usr/bin/env node
const fs = require('node:fs');
const steps = ${JSON.stringify(steps)};
const counter = ${JSON.stringify(counter)};
const log = ${JSON.stringify(log)};
const n = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0;
fs.writeFileSync(counter, String(n + 1));
fs.appendFileSync(log, JSON.stringify({kind:'quota', n}) + '\\n');
const step = steps[Math.min(n, steps.length - 1)];
if (step.exit) {
  if (step.raw != null) process.stdout.write(step.raw);
  process.exit(step.exit);
}
if (Object.prototype.hasOwnProperty.call(step, 'raw')) {
  process.stdout.write(step.raw);
  process.exit(0);
}
const body = {usage:{windows:{weekly:{}, monthly:{}}}};
if (!step.omit) body.usage.windows.weekly.usedPercent = step.value;
if (step.omitMonthly) delete body.usage.windows.monthly;
else body.usage.windows.monthly.usedPercent = Object.prototype.hasOwnProperty.call(step, 'monthly') ? step.monthly : 10;
process.stdout.write(JSON.stringify(body));
`, { mode: 0o755 });
  return script;
}
function writeTrackBatch(w: Work): string {
  const script = join(w.root, "track-batch.cjs");
  const log = join(w.root, "order.jsonl");
  const counter = join(w.root, "docs-n");
  writeFileSync(script, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const track = process.env.BENCH_TRACK || 'build';
const log = ${JSON.stringify(log)};
fs.appendFileSync(log, JSON.stringify({kind:'batch', track, args}) + '\\n');
if (process.env.STUB_LOG) fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({args, track, week: process.env.WEEK}) + '\\n');
const model = args[1] || 'glm-5.2';
for (const arm of ['a', 'b']) {
  const id = arm + '-' + model.replaceAll('.', '-') + '-' + track + '-' + process.env.WEEK + '-r1';
  const artifacts = path.join(process.env.BENCH_RUNS_ROOT, id, 'artifacts');
  fs.mkdirSync(artifacts, {recursive:true});
  fs.writeFileSync(path.join(artifacts, 'provenance.json'), JSON.stringify({executor:{kind:'opencode'}, model:'opencode-go/' + model, arm, track}));
}
if (process.env.STUB_DOCS_DIR) {
  const nPath = ${JSON.stringify(counter)};
  const n = fs.existsSync(nPath) ? Number(fs.readFileSync(nPath, 'utf8')) + 1 : 1;
  fs.writeFileSync(nPath, String(n));
  fs.mkdirSync(path.join(process.env.STUB_DOCS_DIR, 'assets', 'data'), {recursive:true});
  fs.writeFileSync(path.join(process.env.STUB_DOCS_DIR, 'assets', 'data', 'benchmark.json'), JSON.stringify({n}) + '\\n');
}
process.exit(0);
`, { mode: 0o755 });
  return script;
}
function writeSelect(w: Work, code: number): string {
  const script = join(w.root, `select-${code}.cjs`);
  writeFileSync(script, `#!/usr/bin/env node\nprocess.exit(${code});\n`, { mode: 0o755 });
  return script;
}
function orderLog(w: Work): Json[] {
  const log = join(w.root, "order.jsonl");
  return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
}
function trackIds(track: string, week = WEEK, slug = "glm-5-2"): string[] {
  return ["a", "b"].map(arm => `${arm}-${slug}-${track}-${week}-r1`);
}
function guardJob(w: Work, steps: QuotaStep[], name: string, extra: Record<string, string> = {}, args: string[] = []) {
  writeTrackBatch(w);
  return job(w, args, {
    BENCH_DAILY_QUOTA_CMD: writeQuota(w, name, steps),
    BENCH_DAILY_BATCH: join(w.root, "track-batch.cjs"),
    ...extra,
  });
}
function assertSkip(w: Work, r: Result, reason: string, label: string) {
  expect(lines(r, "DAILY SKIP go-guard:"), `${label}: missing ${D12Q}`).toEqual([`DAILY SKIP go-guard: ${reason}`]);
  expect(lines(r, "DAILY GO-GUARD "), `${label}: a stop must not also print DAILY GO-GUARD`).toEqual([]);
  expect(r.status, `${label}: missing ${D12Q} exit 0`).toBe(0);
  expect(lines(r, "DAILY FAIL runs:"), `${label}: a guard stop is not DAILY FAIL runs`).toEqual([]);
  expect(orderLog(w).filter(row => row.kind === "batch"), `${label}: a stop must not call ${D12B}`).toEqual([]);
}
function assertMidStop(w: Work, r: Result, done: number, label: string) {
  const tracks = ["build", "bugfix", "tests"].slice(0, done);
  expect(lines(r, "DAILY GO-GUARD "), `${label}: missing ${D12Q} clean reads`).toEqual(Array(done).fill("DAILY GO-GUARD weekly=10 monthly=10"));
  expect(lines(r, "DAILY SKIP go-guard:"), `${label}: missing ${D12Q}`).toEqual(["DAILY SKIP go-guard: weekly used 81 percent"]);
  expect(orderLog(w).filter(row => row.kind === "batch").map(row => row.track), `${label}: missing ${D12B}`).toEqual(tracks);
  expect(r.status, `${label}: missing ${D12Q} exit 0`).toBe(0);
  expect(lines(r, "DAILY FAIL runs:"), `${label}: a guard stop is not DAILY FAIL runs`).toEqual([]);
}

function gitWrap(w: Work) {
  const bin = join(w.root, "git-bin");
  const log = join(w.root, "git-argv.log");
  mkdirSync(bin, { recursive: true });
  writeFileSync(log, "");
  writeFileSync(join(bin, "git"), `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nexec /usr/bin/git "$@"\n`, { mode: 0o755 });
  writeFileSync(join(bin, "sleep"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  return { bin, log };
}
function pushRepo(w: Work) {
  const repo = join(w.root, "pub");
  const origin = join(w.root, "origin.git");
  const gitEnv = { PATH: "/usr/bin:/bin", HOME: w.home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
  const git = (args: string[], cwd = repo) => {
    const r = spawnSync("git", args, { cwd, env: gitEnv, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git(["init", "-q", "-b", "main", repo], w.root);
  git(["init", "-q", "--bare", "-b", "main", origin], w.root);
  git(["config", "user.email", "schedule@example.invalid"]);
  git(["config", "user.name", "Schedule Test"]);
  git(["remote", "add", "origin", origin]);
  mkdirSync(join(repo, "harness"), { recursive: true });
  mkdirSync(join(repo, "docs"), { recursive: true });
  copyFileSync(join(HARNESS, "cron-daily.sh"), join(repo, "harness/cron-daily.sh"));
  for (const name of ["daily-pick.ts", "go-cost.ts", "candidate-contract.ts", "package.json", "toolchain.sh"])
    symlinkSync(join(HARNESS, name), join(repo, "harness", name));
  symlinkSync(join(HARNESS, "node_modules"), join(repo, "harness/node_modules"));
  writeFileSync(join(repo, "docs/index.html"), "<html></html>\n");
  git(["add", "docs/"]);
  git(["commit", "-q", "-m", "initial"]);
  git(["push", "-q", "origin", "main"]);
  return { repo, origin, git };
}
function runCopied(w: Work, repo: string, reachPush: boolean, extra: Record<string, string> = {}) {
  const { bin, log } = gitWrap(w);
  const stub = writeTrackBatch(w);
  const env: Record<string, string> = {
    PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: w.home, TMPDIR: w.root, TSX_DISABLE_CACHE: "1", _BENCH_ENV_LOADED: "1",
    GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
    BENCH_RUNS_ROOT: w.runs, BENCH_PRICING_PATH: w.pricing, BENCH_DAILY_DIR: w.days,
    BENCH_DAILY_DATE: DATE, BENCH_DAILY_CATALOG: w.catalog, BENCH_DAILY_SERVED: w.served,
    BENCH_DAILY_BATCH: stub, BENCH_DAILY_POST: "0", BENCH_DAILY_QUOTA_CMD: join(w.root, "quota.cjs"),
    BENCH_DAILY_PUBLISH: "1", BENCH_DAILY_LOCK: join(w.root, "publish.lock"),
    STUB_LOG: join(w.root, "stub.jsonl"), STUB_DOCS_DIR: join(repo, "docs"), ...extra,
  };
  // HEAD still runs BENCH_DAILY_RUNNER. Set it only when the case must reach the push.
  if (reachPush) env.BENCH_DAILY_RUNNER = stub;
  const r = spawnSync("bash", [join(repo, "harness/cron-daily.sh")], {
    cwd: repo, encoding: "utf8", timeout: 45_000, env,
  });
  if (r.error) throw new Error(`cron-daily.sh: ${r.error.message}`);
  return { result: { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }, log };
}

describe("O1 conditions", () => {
  caseOf("6.5.1 stop before batch 1: quota 81 writes an empty record", w => {
    jobSetup(w);
    const r = guardJob(w, [{ value: 81 }], "quota-81.cjs");
    assertSkip(w, r, "weekly used 81 percent", "6.5.1");
    expect(record(w).run_ids, `6.5.1: missing ${D12Q} empty run_ids`).toEqual([]);
    expect(record(w).go_guard_stop, `6.5.1: missing ${D12Q} go_guard_stop`).toBe("weekly used 81 percent");
  });
  caseOf("6.5.2 exactly 80 continues: four batches and go_guard_stop null", w => {
    jobSetup(w);
    const r = guardJob(w, [{ value: 80 }, { value: 80 }, { value: 80 }, { value: 80 }], "quota-80.cjs");
    expect(lines(r, "DAILY SKIP go-guard:"), `6.5.2: ${D12Q} must not stop at 80`).toEqual([]);
    expect(orderLog(w).filter(row => row.kind === "batch").map(row => row.track), `6.5.2: missing ${D12B}`).toEqual(["build", "bugfix", "tests", "change"]);
    expect(record(w).go_guard_stop, `6.5.2: missing ${D12Q} go_guard_stop null`).toBe(null);
  });
  caseOf("6.5.3 80.0 continues: a string compare must not stop the day", w => {
    jobSetup(w);
    const raw = '{"usage":{"windows":{"weekly":{"usedPercent":80.0},"monthly":{"usedPercent":10}}}}';
    const r = guardJob(w, [{ raw }, { raw }, { raw }, { raw }], "quota-80-0.cjs");
    expect(lines(r, "DAILY SKIP go-guard:"), `6.5.3: missing ${D12Q}; 80.0 must continue`).toEqual([]);
    expect(orderLog(w).filter(row => row.kind === "batch").map(row => row.track), `6.5.3: missing ${D12B}`).toEqual(["build", "bugfix", "tests", "change"]);
    expect(record(w).go_guard_stop, `6.5.3: missing ${D12Q} go_guard_stop null`).toBe(null);
  });
  caseOf("6.5.4 failed read: a non-zero quota command stops even with JSON", w => {
    jobSetup(w);
    const r = guardJob(w, [{ exit: 1, raw: '{"usage":{"windows":{"weekly":{"usedPercent":10},"monthly":{"usedPercent":10}}}}' }], "quota-fail.cjs");
    assertSkip(w, r, "read failed", "6.5.4");
  });
  caseOf("6.5.5 missing field: absent or null usedPercent stops the day", w => {
    jobSetup(w);
    each(["ok", "null"], kind => {
      rmSync(join(w.days, `${DATE}.json`), { force: true });
      rmSync(join(w.root, "order.jsonl"), { force: true });
      const step = kind === "ok" ? { raw: '{"ok":true}' } : { value: null };
      const r = guardJob(w, [step], `quota-miss-${kind}.cjs`);
      assertSkip(w, r, "missing field", `6.5.5 ${kind}`);
    });
  });
  caseOf("6.5.6 not a number: a JSON string must not be coerced", w => {
    jobSetup(w);
    const r = guardJob(w, [{ value: "high" }], "quota-nan.cjs");
    assertSkip(w, r, "not a number", "6.5.6");
  });
  caseOf("6.5.7 empty output: empty or whitespace is a failed read", w => {
    jobSetup(w);
    let emptyN = 0;
    each(["", " \n\t"], raw => {
      const name = `quota-empty-${emptyN}.cjs`;
      emptyN += 1;
      rmSync(join(w.days, `${DATE}.json`), { force: true });
      rmSync(join(w.root, "order.jsonl"), { force: true });
      const r = guardJob(w, [{ raw }], name);
      assertSkip(w, r, "read failed", `6.5.7 ${name}`);
      expect(lines(r, "DAILY SKIP go-guard:"), `6.5.7: ${D12Q} must not say not a number`).not.toContain("DAILY SKIP go-guard: not a number");
    });
  });
  caseOf("6.5.8 stop before batch 2: the record keeps the build run ids", w => {
    jobSetup(w);
    const r = guardJob(w, [{ value: 10 }, { value: 81 }], "quota-b2.cjs");
    assertMidStop(w, r, 1, "6.5.8");
    const ids = trackIds("build");
    expect(record(w).run_ids.slice().sort(), `6.5.8: missing ${D12B} build run ids`).toEqual(ids.slice().sort());
    expect(record(w).go_guard_stop, `6.5.8: missing ${D12Q} go_guard_stop`).toBe("weekly used 81 percent");
    expect(readdirSync(w.runs).some(name => name.includes("-bugfix-") || name.includes("-tests-") || name.includes("-change-")), `6.5.8: a later ${D12B} call must not run`).toBe(false);
  });
  caseOf("6.5.9 stop before batch 3: the record keeps build and bugfix run ids", w => {
    jobSetup(w);
    const r = guardJob(w, [{ value: 10 }, { value: 10 }, { value: 81 }], "quota-b3.cjs");
    assertMidStop(w, r, 2, "6.5.9");
    const ids = [...trackIds("build"), ...trackIds("bugfix")].sort();
    expect(record(w).run_ids.slice().sort(), `6.5.9: missing ${D12B} earlier run ids`).toEqual(ids);
    expect(readdirSync(w.runs).some(name => name.includes("-tests-") || name.includes("-change-")), `6.5.9: tests and change must not run`).toBe(false);
  });
  caseOf("6.5.10 stop before batch 4: the record keeps build, bugfix, and tests run ids", w => {
    jobSetup(w);
    const r = guardJob(w, [{ value: 10 }, { value: 10 }, { value: 10 }, { value: 81 }], "quota-b4.cjs");
    assertMidStop(w, r, 3, "6.5.10");
    const ids = [...trackIds("build"), ...trackIds("bugfix"), ...trackIds("tests")].sort();
    expect(record(w).run_ids.slice().sort(), `6.5.10: missing ${D12B} earlier run ids`).toEqual(ids);
    expect(readdirSync(w.runs).some(name => name.includes("-change-")), `6.5.10: change must not run`).toBe(false);
  });
  caseOf("6.5.11 dry-run clean read: one guard line and no model call", w => {
    jobSetup(w);
    const quota = writeQuota(w, "quota-dry.cjs", [{ value: 10 }]);
    const r = job(w, ["--dry-run"], { BENCH_DAILY_QUOTA_CMD: quota });
    expect(lines(r, "DAILY GO-GUARD "), `6.5.11: missing ${D12Q} DAILY GO-GUARD weekly=10 monthly=10`).toEqual(["DAILY GO-GUARD weekly=10 monthly=10"]);
    expect(lines(r, "DAILY DRY-RUN "), `6.5.11: missing ${D12Q} planned count`).toEqual(["DAILY DRY-RUN planned=12"]);
    expect(readdirSync(w.days), `6.5.11: a dry run writes no day record`).toEqual([]);
    expect(readdirSync(w.runs), `6.5.11: a dry run makes no model call`).toEqual([]);
    expect(r.status, `6.5.11: missing ${D12Q} exit 0`).toBe(0);
  });
  caseOf("6.5.12 dry-run stop: planned=0 and no batch dry run", w => {
    jobSetup(w);
    const quota = writeQuota(w, "quota-dry-stop.cjs", [{ value: 81 }]);
    const r = job(w, ["--dry-run"], { BENCH_DAILY_QUOTA_CMD: quota });
    expect(lines(r, "DAILY SKIP go-guard:"), `6.5.12: missing ${D12Q}`).toEqual(["DAILY SKIP go-guard: weekly used 81 percent"]);
    expect(lines(r, "DAILY DRY-RUN "), `6.5.12: missing ${D12Q} planned=0`).toEqual(["DAILY DRY-RUN planned=0"]);
    expect(r.status, `6.5.12: missing ${D12Q} exit 0`).toBe(0);
    expect(readdirSync(w.days), `6.5.12: a dry run writes no day record`).toEqual([]);
    expect(readdirSync(w.runs), `6.5.12: a stop makes no model call`).toEqual([]);
    expect(planned(r), `6.5.12: a batch dry run must not start`).toEqual([]);
  });
  caseOf("6.5.13 per-batch order: quota, build, quota, bugfix, quota, tests, quota, change", w => {
    jobSetup(w);
    const sentinel = join(w.root, "retired-sentinel");
    writeFileSync(join(w.root, "sentinel-runner.cjs"), `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'ran\\n');\nprocess.exit(0);\n`, { mode: 0o755 });
    const r = guardJob(w, [{ value: 10 }, { value: 10 }, { value: 10 }, { value: 10 }], "quota-order.cjs", {
      BENCH_DAILY_RUNNER: join(w.root, "sentinel-runner.cjs"),
    });
    expect(orderLog(w).map(row => row.kind === "quota" ? "quota" : row.track), `6.5.13: missing ${D12Q} and ${D12B} order`).toEqual([
      "quota", "build", "quota", "bugfix", "quota", "tests", "quota", "change",
    ]);
    expect(existsSync(sentinel), `6.5.13: retired BENCH_DAILY_RUNNER must not start (${D12B})`).toBe(false);
    expect(lines(r, "DAILY GO-GUARD "), `6.5.13: missing ${D12Q} four clean lines`).toEqual([
      "DAILY GO-GUARD weekly=10 monthly=10", "DAILY GO-GUARD weekly=10 monthly=10", "DAILY GO-GUARD weekly=10 monthly=10", "DAILY GO-GUARD weekly=10 monthly=10",
    ]);
  });
  caseOf("6.5.14 push at the parent: git push origin <sha>:main", w => {
    jobSetup(w);
    const { repo, origin, git } = pushRepo(w);
    const parent = git(["rev-parse", "HEAD"]);
    const { result, log } = runCopied(w, repo, true);
    const head = git(["rev-parse", "HEAD"]);
    const pushes = readFileSync(log, "utf8").split("\n").filter(line => line.startsWith("push "));
    expect(pushes, `6.5.14: missing ${D13}`).toContain(`push origin ${head}:main`);
    expect(pushes, `6.5.14: ${D13} forbids git push origin main`).not.toContain("push origin main");
    expect(git(["rev-parse", "main"], origin), `6.5.14: the remote tip must equal the docs commit`).toBe(head);
    expect(head, `6.5.14: the docs commit parent must be origin/main before the push`).not.toBe(parent);
    expect(result.status, `6.5.14: missing ${D13} exit 0`).toBe(0);
    expect(lines(result, "DAILY PUBLISH ")[0], `6.5.14: missing ${D13} DAILY PUBLISH`).toMatch(/^DAILY PUBLISH [0-9a-f]{7,}$/);
  });
  caseOf("6.5.15 other local commits: the job skips the push and keeps the commit local", w => {
    jobSetup(w);
    const { repo, origin, git } = pushRepo(w);
    writeFileSync(join(repo, "note.txt"), "other local commit\n");
    git(["add", "note.txt"]);
    git(["commit", "-q", "-m", "other local"]);
    const parent = git(["rev-parse", "HEAD"]);
    const remoteBefore = git(["rev-parse", "main"], origin);
    const { result } = runCopied(w, repo, true);
    expect(lines(result, "DAILY PUSH skipped:"), `6.5.15: missing ${D13}`).toEqual(["DAILY PUSH skipped: 1 other local commits"]);
    expect(result.status, `6.5.15: missing ${D13} exit 0`).toBe(0);
    expect(git(["rev-parse", "main"], origin), `6.5.15: ${D13} must not move the remote`).toBe(remoteBefore);
    expect(git(["rev-parse", "HEAD^"]), `6.5.15: the other local commit must sit before the docs commit`).toBe(parent);
    expect(git(["log", "-1", "--format=%s"]), `6.5.15: the docs commit must stay local`).toMatch(/^Publish daily /);
  });
  caseOf("6.5.16 origin/main moved: the skip line is not other local commits", w => {
    jobSetup(w);
    const { repo, origin, git } = pushRepo(w);
    git(["checkout", "-q", "-b", "side"]);
    writeFileSync(join(repo, "side.txt"), "moved\n");
    git(["add", "side.txt"]);
    git(["commit", "-q", "-m", "origin moved"]);
    git(["push", "-q", "origin", "side:main"]);
    git(["checkout", "-q", "main"]);
    const remoteBefore = git(["rev-parse", "main"], origin);
    const { result } = runCopied(w, repo, true);
    expect(git(["rev-list", "--count", "origin/main..HEAD~1"]), `6.5.16: the count before the docs commit must be 0`).toBe("0");
    expect(lines(result, "DAILY PUSH skipped:"), `6.5.16: missing ${D13}`).toEqual(["DAILY PUSH skipped: origin/main moved"]);
    expect(result.status, `6.5.16: missing ${D13} exit 0`).toBe(0);
    expect(lines(result, "DAILY PUSH skipped:").join("\n"), `6.5.16: ${D13} must not say other local commits`).not.toContain("other local commits");
    expect(git(["rev-parse", "main"], origin), `6.5.16: ${D13} must not push`).toBe(remoteBefore);
  });
  caseOf("6.5.17 failed fetch: the commit stays local and the remote stays unchanged", w => {
    jobSetup(w);
    const { repo, origin, git } = pushRepo(w);
    const remoteBefore = git(["rev-parse", "main"], origin);
    git(["remote", "set-url", "origin", join(w.root, "missing.git")]);
    const { result } = runCopied(w, repo, true);
    expect(lines(result, "DAILY PUSH skipped:"), `6.5.17: missing ${D13}`).toEqual(["DAILY PUSH skipped: fetch failed"]);
    expect(result.status, `6.5.17: missing ${D13} exit 0`).toBe(0);
    expect(git(["rev-parse", "main"], origin), `6.5.17: ${D13} must not change the remote`).toBe(remoteBefore);
    expect(git(["log", "-1", "--format=%s"]), `6.5.17: the docs commit must stay local`).toMatch(/^Publish daily /);
  });
  caseOf("6.5.18 selector exit 1: the job must not take the no-pick path", w => {
    jobSetup(w);
    const r = job(w, [], { BENCH_DAILY_SELECT: writeSelect(w, 1) });
    expect(lines(r, "DAILY FAIL pick:"), `6.5.18: missing ${D14}`).toEqual(["DAILY FAIL pick: the selector exited 1"]);
    expect(r.status, `6.5.18: missing ${D14} exit 1`).toBe(1);
    expect(batchCalls(w), `6.5.18: ${D14} must call no batch`).toEqual([]);
    expect(readdirSync(w.days), `6.5.18: ${D14} must write no day record`).toEqual([]);
  });
  caseOf("6.5.19 selector exit 4: the job exits 4 and writes no day record", w => {
    jobSetup(w);
    const r = job(w, [], { BENCH_DAILY_SELECT: writeSelect(w, 4) });
    expect(lines(r, "DAILY FAIL pick:"), `6.5.19: missing ${D14}`).toEqual(["DAILY FAIL pick: the selector exited 4"]);
    expect(r.status, `6.5.19: missing ${D14} exit 4`).toBe(4);
    expect(batchCalls(w), `6.5.19: ${D14} must call no batch`).toEqual([]);
    expect(readdirSync(w.days), `6.5.19: ${D14} must write no day record`).toEqual([]);
  });
  caseOf("6.5.20 selector exit 2: the fail path stays and the job selects no model", w => {
    jobSetup(w);
    const r = job(w, [], { BENCH_DAILY_SELECT: writeSelect(w, 2) });
    expect(lines(r, "DAILY FAIL pick:"), `6.5.20: missing ${D14}`).toEqual(["DAILY FAIL pick: the selector exited 2"]);
    expect(r.status, `6.5.20: missing ${D14} exit 2`).toBe(2);
    expect(batchCalls(w), `6.5.20: ${D14} must call no batch`).toEqual([]);
    expect(readdirSync(w.days), `6.5.20: ${D14} must write no day record`).toEqual([]);
  });
  caseOf("6.5.21 selector exit 3: the no-pick path stays", w => {
    jobSetup(w);
    const r = job(w, [], { BENCH_DAILY_SELECT: writeSelect(w, 3) });
    expect(readdirSync(w.days), `6.5.21: missing ${D14}; exit 3 must write no day record`).toEqual([]);
    expect(lines(r, "DAILY FAIL pick:"), `6.5.21: ${D14} must not print DAILY FAIL pick`).toEqual([]);
    expect(r.status, `6.5.21: missing ${D14} exit 0`).toBe(0);
    expect(lines(r, "DAILY PUBLISH "), `6.5.21: missing ${D14} DAILY PUBLISH none`).toEqual(["DAILY PUBLISH none"]);
    expect(batchCalls(w), `6.5.21: ${D14} must call no batch`).toEqual([]);
  });
  caseOf("6.5.22 unit files: the service and the timer hold the D11 lines", () => {
    const svc = join(HARNESS, "systemd/lending-desk-daily.service");
    const tmr = join(HARNESS, "systemd/lending-desk-daily.timer");
    expect(existsSync(svc), `6.5.22: missing ${D11}`).toBe(true);
    expect(existsSync(tmr), `6.5.22: missing ${D11}`).toBe(true);
    const service = readFileSync(svc, "utf8").split(/\r?\n/);
    const timer = readFileSync(tmr, "utf8").split(/\r?\n/);
    for (const line of ["Type=oneshot", "WorkingDirectory=/home/daniebo/Desktop/lending-desk-bench", "ExecStart=/home/daniebo/Desktop/lending-desk-bench/harness/cron-daily.sh", "StandardOutput=append:/home/daniebo/Desktop/lending-desk-bench/reports/cron-daily.log", "StandardError=append:/home/daniebo/Desktop/lending-desk-bench/reports/cron-daily.log"]) {
      expect(service, `6.5.22: missing ${D11} service line ${line}`).toContain(line);
    }
    for (const line of ["OnCalendar=Wed,Sun 01:00:00", "Persistent=false", "Unit=lending-desk-daily.service", "WantedBy=timers.target"]) {
      expect(timer, `6.5.22: missing ${D11} timer line ${line}`).toContain(line);
    }
    expect(timer.join("\n").includes("Persistent=true"), `6.5.22: ${D11} forbids Persistent=true`).toBe(false);
  });
  caseOf("6.5.23 resume record: counts, excluded, order, and last_test stay", w => {
    jobSetup(w);
    inputs(w, { "glm-5.2": 100 }, ["z-unpriced", "glm-5.2"], ["z-unpriced", "glm-5.2"]);
    json(w.catalog, { live: ["z-unpriced", "glm-5.2"], requests_per_month: { "z-unpriced": 99999 } });
    const { repo, git } = pushRepo(w);
    runCopied(w, repo, false);
    expect(existsSync(join(w.days, `${DATE}.json`)), "6.5.23 fixture: the first run must write a day record").toBe(true);
    const first = record(w);
    expect(first.excluded?.unpriced, "6.5.23 fixture: the first record must list the unpriced model").toEqual(["z-unpriced"]);
    const kept = { counts: first.counts, excluded: first.excluded, order: first.order, last_test: first.last_test };
    const second = runCopied(w, repo, false);
    const again = record(w);
    expect(
      { counts: again.counts, excluded: again.excluded, order: again.order, last_test: again.last_test },
      "6.5.23: missing section 5.4 resume record keep of counts, excluded, order, and last_test",
    ).toEqual(kept);
    expect(lines(second.result, "DAILY_PICK "), "6.5.23: the selector line stays the short resume object").toEqual([
      `DAILY_PICK date=${DATE} model=glm-5.2 reason=resume`,
    ]);
    expect(git(["log", "-1", "--format=%B"]), "6.5.23: the publish body must name the unpriced model").toContain("z-unpriced");
  });
  caseOf("6.5.24 value 80.0001: the skip line keeps the full number", w => {
    jobSetup(w);
    const r = guardJob(w, [{ raw: '{"usage":{"windows":{"weekly":{"usedPercent":80.0001},"monthly":{"usedPercent":10}}}}' }], "quota-800001.cjs");
    expect(lines(r, "DAILY SKIP go-guard:"), `6.5.24: missing ${D12Q} exact 80.0001`).toEqual(["DAILY SKIP go-guard: weekly used 80.0001 percent"]);
    expect(r.status, `6.5.24: missing ${D12Q} exit 0`).toBe(0);
    expect(orderLog(w).filter(row => row.kind === "batch"), `6.5.24: a stop must not call ${D12B}`).toEqual([]);
  });
  caseOf("6.5.25 weekly below 0: the skip line keeps the sign", w => {
    jobSetup(w);
    each<{ value: number; reason: string }>([
      { value: -1, reason: "weekly value -1 is below 0" },
      { value: -0.5, reason: "weekly value -0.5 is below 0" },
    ], item => {
      rmSync(join(w.days, `${DATE}.json`), { force: true });
      rmSync(join(w.root, "order.jsonl"), { force: true });
      const r = guardJob(w, [{ value: item.value }], `quota-below-${item.value}.cjs`);
      assertSkip(w, r, item.reason, `6.5.25 ${item.value}`);
      expect(record(w).run_ids, `6.5.25: missing ${D12Q} empty run_ids`).toEqual([]);
      expect(record(w).go_guard_stop, `6.5.25: missing ${D12Q} go_guard_stop`).toBe(item.reason);
    });
  });
  caseOf("6.5.26 monthly missing field: absent, empty, or null stops the day", w => {
    jobSetup(w);
    each<{ raw: string; label: string }>([
      { raw: '{"usage":{"windows":{"weekly":{"usedPercent":10}}}}', label: "absent" },
      { raw: '{"usage":{"windows":{"weekly":{"usedPercent":10},"monthly":{}}}}', label: "empty" },
      { raw: '{"usage":{"windows":{"weekly":{"usedPercent":10},"monthly":{"usedPercent":null}}}}', label: "null" },
    ], item => {
      rmSync(join(w.days, `${DATE}.json`), { force: true });
      rmSync(join(w.root, "order.jsonl"), { force: true });
      const r = guardJob(w, [{ raw: item.raw }], `quota-monthly-missing-${item.label}.cjs`);
      assertSkip(w, r, "monthly missing field", `6.5.26 ${item.label}`);
      expect(record(w).go_guard_stop, `6.5.26: missing ${D12Q} go_guard_stop`).toBe("monthly missing field");
    });
  });
  caseOf("6.5.27 monthly not a number: a string, a boolean, or an array stops the day", w => {
    jobSetup(w);
    each<{ raw: string; label: string }>([
      { raw: '{"usage":{"windows":{"weekly":{"usedPercent":10},"monthly":{"usedPercent":"high"}}}}', label: "string" },
      { raw: '{"usage":{"windows":{"weekly":{"usedPercent":10},"monthly":{"usedPercent":true}}}}', label: "boolean" },
      { raw: '{"usage":{"windows":{"weekly":{"usedPercent":10},"monthly":{"usedPercent":[]}}}}', label: "array" },
    ], item => {
      rmSync(join(w.days, `${DATE}.json`), { force: true });
      rmSync(join(w.root, "order.jsonl"), { force: true });
      const r = guardJob(w, [{ raw: item.raw }], `quota-monthly-nan-${item.label}.cjs`);
      assertSkip(w, r, "monthly not a number", `6.5.27 ${item.label}`);
    });
  });
  caseOf("6.5.28 monthly below 0: the record keeps the monthly reason", w => {
    jobSetup(w);
    const r = guardJob(w, [{ value: 10, monthly: -1 }], "quota-monthly-below.cjs");
    assertSkip(w, r, "monthly value -1 is below 0", "6.5.28");
    expect(record(w).go_guard_stop, `6.5.28: missing ${D12Q} go_guard_stop`).toBe("monthly value -1 is below 0");
  });
  caseOf("6.5.29 monthly above 80: the skip line names the monthly window", w => {
    jobSetup(w);
    const r = guardJob(w, [{ value: 10, monthly: 81 }], "quota-monthly-81.cjs");
    assertSkip(w, r, "monthly used 81 percent", "6.5.29");
    expect(record(w).run_ids, `6.5.29: missing ${D12Q} empty run_ids`).toEqual([]);
    expect(record(w).go_guard_stop, `6.5.29: missing ${D12Q} go_guard_stop`).toBe("monthly used 81 percent");
  });
  caseOf("6.5.30 clean-read line: the weekly value comes first and the monthly value second", w => {
    jobSetup(w);
    const r = guardJob(w, [
      { value: 10, monthly: 20 }, { value: 10, monthly: 20 }, { value: 10, monthly: 20 }, { value: 10, monthly: 20 },
    ], "quota-clean.cjs");
    expect(lines(r, "DAILY GO-GUARD "), `6.5.30: missing ${D12Q} exact weekly=<n> monthly=<m> line`).toEqual([
      "DAILY GO-GUARD weekly=10 monthly=20", "DAILY GO-GUARD weekly=10 monthly=20",
      "DAILY GO-GUARD weekly=10 monthly=20", "DAILY GO-GUARD weekly=10 monthly=20",
    ]);
    expect(orderLog(w).filter(row => row.kind === "batch").map(row => row.track), `6.5.30: missing ${D12B}`).toEqual(["build", "bugfix", "tests", "change"]);
    expect(record(w).go_guard_stop, `6.5.30: missing ${D12Q} go_guard_stop null`).toBe(null);
    rmSync(join(w.days, `${DATE}.json`), { force: true });
    rmSync(join(w.root, "order.jsonl"), { force: true });
    const runsBefore = readdirSync(w.runs).length;
    const quota = writeQuota(w, "quota-clean-dry.cjs", [{ value: 30, monthly: 40 }]);
    const dry = job(w, ["--dry-run"], { BENCH_DAILY_QUOTA_CMD: quota });
    expect(lines(dry, "DAILY GO-GUARD "), `6.5.30: missing ${D12Q} exact dry-run clean line`).toEqual(["DAILY GO-GUARD weekly=30 monthly=40"]);
    expect(lines(dry, "DAILY DRY-RUN "), `6.5.30: missing ${D12Q} planned count`).toEqual(["DAILY DRY-RUN planned=12"]);
    expect(planned(dry).length, `6.5.30: missing ${D12Q} planned ids`).toBe(12);
    expect(readdirSync(w.days), `6.5.30: a dry run writes no day record`).toEqual([]);
    expect(readdirSync(w.runs).length, `6.5.30: a dry run makes no model call`).toBe(runsBefore);
  });
  caseOf("6.5.31 monthly exactly 80 and 80.0 continue: four batches and no skip line", w => {
    jobSetup(w);
    const raw = '{"usage":{"windows":{"weekly":{"usedPercent":10},"monthly":{"usedPercent":80.0}}}}';
    each<{ label: string; steps: QuotaStep[] }>([
      { label: "80", steps: [{ value: 10, monthly: 80 }, { value: 10, monthly: 80 }, { value: 10, monthly: 80 }, { value: 10, monthly: 80 }] },
      { label: "80.0", steps: [{ raw }, { raw }, { raw }, { raw }] },
    ], item => {
      rmSync(join(w.days, `${DATE}.json`), { force: true });
      rmSync(join(w.root, "order.jsonl"), { force: true });
      const r = guardJob(w, item.steps, `quota-monthly-${item.label}.cjs`);
      expect(lines(r, "DAILY SKIP go-guard:"), `6.5.31 ${item.label}: ${D12Q} must not stop at monthly ${item.label}`).toEqual([]);
      expect(orderLog(w).filter(row => row.kind === "batch").map(row => row.track), `6.5.31 ${item.label}: missing ${D12B}`).toEqual(["build", "bugfix", "tests", "change"]);
      expect(record(w).go_guard_stop, `6.5.31 ${item.label}: missing ${D12Q} go_guard_stop null`).toBe(null);
      expect(lines(r, "DAILY GO-GUARD "), `6.5.31 ${item.label}: missing ${D12Q} monthly=80`).toEqual(Array(4).fill("DAILY GO-GUARD weekly=10 monthly=80"));
    });
  });
  caseOf("6.5.32 monthly 80.0001: the skip line keeps the full number", w => {
    jobSetup(w);
    const r = guardJob(w, [{ value: 10, monthly: 80.0001 }], "quota-monthly-800001.cjs");
    assertSkip(w, r, "monthly used 80.0001 percent", "6.5.32");
  });
  caseOf("6.5.33 zero for both windows continues: four batches and four guard lines", w => {
    jobSetup(w);
    const r = guardJob(w, [
      { value: 0, monthly: 0 }, { value: 0, monthly: 0 }, { value: 0, monthly: 0 }, { value: 0, monthly: 0 },
    ], "quota-zero.cjs");
    expect(lines(r, "DAILY SKIP go-guard:"), `6.5.33: ${D12Q} must not treat 0 as missing`).toEqual([]);
    expect(orderLog(w).filter(row => row.kind === "batch").map(row => row.track), `6.5.33: missing ${D12B}`).toEqual(["build", "bugfix", "tests", "change"]);
    expect(record(w).go_guard_stop, `6.5.33: missing ${D12Q} go_guard_stop null`).toBe(null);
    expect(lines(r, "DAILY GO-GUARD "), `6.5.33: missing ${D12Q} weekly=0 monthly=0`).toEqual(Array(4).fill("DAILY GO-GUARD weekly=0 monthly=0"));
  });
  caseOf("6.5.34 monthly stop before batch 2: the record keeps the build run ids", w => {
    jobSetup(w);
    const r = guardJob(w, [{ value: 10, monthly: 10 }, { value: 10, monthly: 81 }], "quota-monthly-b2.cjs");
    expect(lines(r, "DAILY GO-GUARD "), `6.5.34: missing ${D12Q} clean read`).toEqual(["DAILY GO-GUARD weekly=10 monthly=10"]);
    expect(lines(r, "DAILY SKIP go-guard:"), `6.5.34: missing ${D12Q} monthly stop`).toEqual(["DAILY SKIP go-guard: monthly used 81 percent"]);
    expect(orderLog(w).filter(row => row.kind === "batch").map(row => row.track), `6.5.34: missing ${D12B} build batch only`).toEqual(["build"]);
    expect(r.status, `6.5.34: missing ${D12Q} exit 0`).toBe(0);
    expect(record(w).go_guard_stop, `6.5.34: missing ${D12Q} go_guard_stop`).toBe("monthly used 81 percent");
    expect(record(w).run_ids.slice().sort(), `6.5.34: missing ${D12B} build run ids`).toEqual(trackIds("build").slice().sort());
    expect(readdirSync(w.runs).some(name => name.includes("-bugfix-") || name.includes("-tests-") || name.includes("-change-")), `6.5.34: a later ${D12B} call must not run`).toBe(false);
  });
  caseOf("6.5.35 dry-run monthly stop: planned=0 and no batch dry run", w => {
    jobSetup(w);
    const quota = writeQuota(w, "quota-monthly-dry-stop.cjs", [{ value: 10, monthly: 81 }]);
    const r = job(w, ["--dry-run"], { BENCH_DAILY_QUOTA_CMD: quota });
    expect(lines(r, "DAILY SKIP go-guard:"), `6.5.35: missing ${D12Q} monthly stop`).toEqual(["DAILY SKIP go-guard: monthly used 81 percent"]);
    expect(lines(r, "DAILY GO-GUARD "), `6.5.35: a stop must not print DAILY GO-GUARD`).toEqual([]);
    expect(lines(r, "DAILY DRY-RUN "), `6.5.35: missing ${D12Q} planned=0`).toEqual(["DAILY DRY-RUN planned=0"]);
    expect(r.status, `6.5.35: missing ${D12Q} exit 0`).toBe(0);
    expect(readdirSync(w.days), `6.5.35: a dry run writes no day record`).toEqual([]);
    expect(readdirSync(w.runs), `6.5.35: a stop makes no model call`).toEqual([]);
    expect(planned(r), `6.5.35: a batch dry run must not start`).toEqual([]);
  });
  caseOf("6.5.36 weekly first: the weekly check decides the reason", w => {
    jobSetup(w);
    each<{ label: string; step: QuotaStep; reason: string }>([
      { label: "below 0", step: { raw: '{"usage":{"windows":{"weekly":{"usedPercent":-1},"monthly":{"usedPercent":"high"}}}}' }, reason: "weekly value -1 is below 0" },
      { label: "81 and 81", step: { value: 81, monthly: 81 }, reason: "weekly used 81 percent" },
      { label: "weekly text", step: { raw: '{"usage":{"windows":{"weekly":{"usedPercent":"high"}}}}' }, reason: "not a number" },
    ], item => {
      rmSync(join(w.days, `${DATE}.json`), { force: true });
      rmSync(join(w.root, "order.jsonl"), { force: true });
      const r = guardJob(w, [item.step], `quota-weekly-first-${item.label.replace(/\W+/g, "-")}.cjs`);
      assertSkip(w, r, item.reason, `6.5.36 ${item.label}`);
      expect(record(w).go_guard_stop, `6.5.36 ${item.label}: missing ${D12Q} weekly reason`).toBe(item.reason);
    });
  });
});
