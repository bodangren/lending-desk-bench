/**
 * Grade a lending_desk_tests candidate (tests_bench FR-4).
 *
 *   CANDIDATE=<dir> ARTIFACTS=<dir> PORT=<port> tsx harness/tests-track/grade-tests.ts
 *
 * The candidate's own suite runs against:
 *   clean1, clean2  the candidate tree itself (the correct app, already built by the gate)
 *   variant         reference-variant/: a second correct implementation
 *   <mutant id>     the correct app with one mutant of the frozen set
 * A test is valid when it passes on clean1, clean2, and variant. A mutant is
 * killed when a valid test fails on it. Every app gets a fresh server, so the
 * seed data is fresh for each suite run.
 *
 * Mutant and variant apps are built once per content hash under
 * runs/.tests-track-cache/ and copied per run; node_modules is hard-linked,
 * because Turbopack rejects a node_modules symlink that leaves the project.
 *
 * Writes results.json (K.<mutant> -> killed) and tests-results.json. Exit 1 on a
 * harness failure (an app that does not start), never on a weak suite.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeVariant } from "../bugfix/make-variant.js";
import { TEST_FILE_PATTERN } from "../candidate-contract.js";
import { killId } from "../track-scoring.js";
import { appTreeHash, testsTreeFiles, VARIANT_OVERLAY } from "./make-variant.js";
import type { MutantDefinition } from "./mutants.js";
import { loadMutantSet, setMutants, validateMutantSet } from "./set-loader.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const CACHE = join(ROOT, "runs", ".tests-track-cache");
const FIXTURE_MODULES = join(ROOT, "fixture", "node_modules");
const NOW = "2026-03-15T12:00:00.000Z";
const SUITE_TIMEOUT_MS = 600_000;

export type SuiteRun = {
  /** Per-test outcome; skipped and todo tests are left out. */
  outcomes: Record<string, boolean>;
  /** False when Vitest wrote no report (a crash, a hang, a config error). */
  reported: boolean;
  seconds: number;
};

/** A minimal environment: candidate tests never see the grader's credentials. */
function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/tmp",
    CI: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    ...extra,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

async function waitReady(port: number, server: ChildProcess): Promise<boolean> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) return false;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/members`, { cache: "no-store" });
      if (response.ok) return true;
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  return false;
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  for (let attempt = 0; attempt < 20 && server.exitCode === null; attempt += 1) await sleep(250);
  if (server.exitCode === null) server.kill("SIGKILL");
}

/** Vitest JSON report -> "file > full test name" -> passed. */
export function outcomesFromReport(report: unknown, appDir: string): Record<string, boolean> {
  const outcomes: Record<string, boolean> = {};
  const files = (report as { testResults?: { name?: string; assertionResults?: { fullName?: string; title?: string; status?: string }[] }[] })
    .testResults ?? [];
  for (const file of files) {
    const rel = relative(appDir, file.name ?? "unknown");
    for (const assertion of file.assertionResults ?? []) {
      if (assertion.status !== "passed" && assertion.status !== "failed") continue;
      const base = `${rel} > ${assertion.fullName ?? assertion.title ?? "unnamed"}`;
      let key = base;
      for (let index = 2; key in outcomes; index += 1) key = `${base} #${index}`;
      outcomes[key] = assertion.status === "passed";
    }
  }
  return outcomes;
}

/** Start the app, run the candidate suite against it, stop the app. */
export async function runSuite(appDir: string, port: number, reportPath: string): Promise<SuiteRun> {
  const started = Date.now();
  const server = spawn(join(appDir, "node_modules", ".bin", "next"), ["start", "--port", String(port)], {
    cwd: appDir,
    env: cleanEnv({ BENCH_NOW: NOW, BENCH_LATENCY_MS: "50", NODE_ENV: "production" }),
    stdio: ["ignore", "ignore", "ignore"],
  });
  try {
    if (!(await waitReady(port, server))) {
      throw new Error(`app in ${appDir} did not become ready on port ${port}`);
    }
    rmSync(reportPath, { force: true });
    spawnSync(join(appDir, "node_modules", ".bin", "vitest"), ["run", "--reporter=json", `--outputFile=${reportPath}`], {
      cwd: appDir,
      env: cleanEnv({ BASE_URL: `http://127.0.0.1:${port}` }),
      stdio: ["ignore", "ignore", "ignore"],
      timeout: SUITE_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
  } finally {
    await stopServer(server);
  }
  let report: unknown;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    return { outcomes: {}, reported: false, seconds: Math.round((Date.now() - started) / 1000) };
  }
  return { outcomes: outcomesFromReport(report, appDir), reported: true, seconds: Math.round((Date.now() - started) / 1000) };
}

/** Build (once) and return the cached app for this exact tree. */
export function cachedApp(name: string, files: Map<string, string>): string {
  const dir = join(CACHE, `${name}-${appTreeHash(files)}`);
  if (existsSync(join(dir, ".built"))) return dir;
  mkdirSync(CACHE, { recursive: true });
  const lock = `${dir}.lock`;
  for (let attempt = 0; ; attempt += 1) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      if (existsSync(join(dir, ".built"))) return dir;
      if (attempt > 1200) throw new Error(`cache lock ${lock} is held too long`);
      spawnSync("sleep", ["0.5"]);
    }
  }
  try {
    if (existsSync(join(dir, ".built"))) return dir;
    const staging = `${dir}.staging`;
    rmSync(staging, { recursive: true, force: true });
    writeVariant({ files }, staging);
    spawnSync("cp", ["-al", FIXTURE_MODULES, join(staging, "node_modules")], { stdio: "ignore" });
    const build = spawnSync(join(staging, "node_modules", ".bin", "next"), ["build"], {
      cwd: staging,
      env: cleanEnv({ NODE_ENV: "production" }),
      encoding: "utf8",
      timeout: 900_000,
    });
    if (build.status !== 0) {
      throw new Error(`building ${name} failed: ${(build.stderr ?? "").split("\n").slice(-5).join(" ")}`);
    }
    writeFileSync(join(staging, ".built"), new Date().toISOString() + "\n");
    rmSync(dir, { recursive: true, force: true });
    renameSync(staging, dir);
    return dir;
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** Copy a cached app for one run and put the candidate's test files into it. */
function prepareWorkdir(cacheDir: string, candidate: string, workdir: string): void {
  rmSync(workdir, { recursive: true, force: true });
  mkdirSync(workdir, { recursive: true });
  for (const entry of readdirSync(cacheDir)) {
    if (entry === "node_modules" || entry === ".built") continue;
    cpSync(join(cacheDir, entry), join(workdir, entry), { recursive: true });
  }
  // Hard links from the candidate's own private copy: a test that writes into
  // node_modules changes this run's copy, never the fixture's.
  const modules = existsSync(join(candidate, "node_modules")) ? join(candidate, "node_modules") : FIXTURE_MODULES;
  spawnSync("cp", ["-al", modules, join(workdir, "node_modules")], { stdio: "ignore" });
  rmSync(join(workdir, "tests"), { recursive: true, force: true });
  for (const rel of listTestFiles(candidate)) {
    mkdirSync(dirname(join(workdir, rel)), { recursive: true });
    cpSync(join(candidate, rel), join(workdir, rel));
  }
}

export function listTestFiles(candidate: string): string[] {
  const found: string[] = [];
  const visit = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(candidate, full);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && TEST_FILE_PATTERN.test(rel)) found.push(rel);
    }
  };
  visit(join(candidate, "tests"));
  return found.sort();
}

export type TestsGrade = {
  schema: 1;
  mutant_set_id: string;
  summary: { total: number; valid: number; broken: number; brittle: number };
  tests: Record<string, { clean1: boolean; clean2: boolean; variant: boolean; valid: boolean }>;
  runs: Record<string, { reported: boolean; seconds: number; failed_valid: number }>;
  kills: Record<string, boolean>;
};

export async function gradeTests(input: { candidate: string; artifacts: string; port: number }): Promise<TestsGrade> {
  const { candidate, artifacts, port } = input;
  const set = loadMutantSet(join(artifacts, "mutant-set.json"));
  const setReasons = validateMutantSet(set);
  if (setReasons.length) throw new Error(`mutant set is invalid: ${setReasons.join("; ")}`);
  const mutants: MutantDefinition[] = setMutants(set);
  const reports = join(artifacts, "tests-reports");
  mkdirSync(reports, { recursive: true });
  const work = join(dirname(candidate), "apps");
  const runs: TestsGrade["runs"] = {};

  const clean1 = await runSuite(candidate, port, join(reports, "clean1.json"));
  const clean2 = await runSuite(candidate, port, join(reports, "clean2.json"));
  const variantDir = join(work, "variant");
  prepareWorkdir(cachedApp("variant", testsTreeFiles({ overlay: VARIANT_OVERLAY })), candidate, variantDir);
  const variant = await runSuite(variantDir, port, join(reports, "variant.json"));
  rmSync(variantDir, { recursive: true, force: true });
  runs.clean1 = { reported: clean1.reported, seconds: clean1.seconds, failed_valid: 0 };
  runs.clean2 = { reported: clean2.reported, seconds: clean2.seconds, failed_valid: 0 };
  runs.variant = { reported: variant.reported, seconds: variant.seconds, failed_valid: 0 };

  const tests: TestsGrade["tests"] = {};
  for (const key of Object.keys(clean1.outcomes).sort()) {
    const row = {
      clean1: clean1.outcomes[key] === true,
      clean2: clean2.outcomes[key] === true,
      variant: variant.outcomes[key] === true,
      valid: false,
    };
    row.valid = row.clean1 && row.clean2 && row.variant;
    tests[key] = row;
  }
  const validKeys = Object.keys(tests).filter((key) => tests[key].valid);
  const kills: Record<string, boolean> = {};
  for (const mutant of mutants) {
    if (!validKeys.length) {
      kills[mutant.id] = false;
      continue;
    }
    const mutantDir = join(work, "mutant");
    prepareWorkdir(cachedApp(mutant.id.replace(/[^A-Za-z0-9_.-]/g, "_"), testsTreeFiles({ mutant })), candidate, mutantDir);
    const run = await runSuite(mutantDir, port, join(reports, `${mutant.id}.json`));
    rmSync(mutantDir, { recursive: true, force: true });
    // A suite that crashes only on the mutant has noticed a behavior change.
    const failedValid = run.reported ? validKeys.filter((key) => run.outcomes[key] !== true).length : validKeys.length;
    runs[mutant.id] = { reported: run.reported, seconds: run.seconds, failed_valid: failedValid };
    kills[mutant.id] = failedValid > 0;
  }
  rmSync(work, { recursive: true, force: true });

  const total = Object.keys(tests).length;
  const broken = Object.values(tests).filter((row) => !row.clean1 || !row.clean2).length;
  const brittle = Object.values(tests).filter((row) => row.clean1 && row.clean2 && !row.variant).length;
  return {
    schema: 1,
    mutant_set_id: set.id,
    summary: { total, valid: validKeys.length, broken, brittle },
    tests,
    runs,
    kills,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const candidate = process.env.CANDIDATE ?? "";
  const artifacts = process.env.ARTIFACTS ?? "";
  const port = Number(process.env.PORT);
  if (!candidate || !artifacts || !Number.isInteger(port)) {
    throw new Error("usage: CANDIDATE=<dir> ARTIFACTS=<dir> PORT=<port> tsx grade-tests.ts");
  }
  if (!statSync(candidate).isDirectory()) throw new Error(`candidate is not a directory: ${candidate}`);
  const grade = await gradeTests({ candidate, artifacts, port });
  writeFileSync(join(artifacts, "tests-results.json"), JSON.stringify(grade, null, 2) + "\n");
  const results = Object.fromEntries(Object.entries(grade.kills).map(([id, killed]) => [killId(id), killed]));
  writeFileSync(join(artifacts, "results.json"), JSON.stringify(results, null, 2) + "\n");
  console.log(`tests: ${grade.summary.valid}/${grade.summary.total} valid; killed ` +
    `${Object.values(grade.kills).filter(Boolean).length}/${Object.keys(grade.kills).length}`);
}
