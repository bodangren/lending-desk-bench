/**
 * Bug admission executor for the bugfix track — mirrors verify-controls.ts.
 *
 * For every selected registry bug it generates a fresh single-bug variant,
 * grades it through the normal run.sh -> grade.sh pipeline, and verifies that
 * the bug's detectors fail while nothing outside its declared collateral does.
 * --set grades one full task set: every detector must fail and every other id
 * must pass.
 *
 * This is a calibration operator. Its runs are diagnostic and nonrankable.
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BUG_REGISTRY, validateRegistry, type BugEntry } from "./bugfix/registry.js";
import { loadSet, setBugs, validateSet } from "./bugfix/set-loader.js";
import { hashTreeOnDisk } from "./bugfix/make-variant.js";
import { protectedTreeUnchanged, snapshotProtectedTree } from "./protected-tree.js";

const ROOT = resolve(import.meta.dirname, "..");
const RUNS = join(ROOT, "runs");
const FIXTURE = join(ROOT, "fixture");
const REFERENCE = join(ROOT, "reference");
const RUNNER = join(ROOT, "harness", "run.sh");

type JsonRecord = Record<string, unknown>;

type BugReport = {
  schema: 1;
  kind: "bug-admission";
  mode: "single-bug" | "full-set";
  bug_set: { id: string; bugs: string[]; detectors: string[] };
  run_id: string;
  variant: string;
  runner: { status: number | null; signal: string | null; error: string | null };
  observed: {
    raw_failures: string[];
    collected_failures: string[];
    raw_matches_collection: boolean;
    missing_expected_failures: string[];
    unexpected_failures: string[];
  };
  integrity: {
    gate_passed: boolean;
    collection_current: boolean;
    provenance_valid: boolean;
    suite_current: boolean;
    score_valid: boolean;
    score_current: boolean;
    host_trusted: boolean;
    variant_unchanged: boolean;
    fixture_unchanged: boolean;
    reference_unchanged: boolean;
  };
  sensitivity_passed: boolean;
  passed: boolean;
  issues: string[];
};

function usage(exitCode: number): never {
  console.error("Usage: tsx harness/verify-bugs.ts --list | --all | --set <id|path> | --id <bug-id> [--id <bug-id> ...]");
  process.exit(exitCode);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(path: string): unknown {
  if (!existsSync(path)) throw new Error("missing " + relative(ROOT, path));
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error("malformed " + relative(ROOT, path) + ": " + detail);
  }
}

function safeRunPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36);
}

function freshRunId(prefix: string): string {
  const candidate = `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(candidate)) {
    throw new Error("generated invalid run ID: " + candidate);
  }
  if (existsSync(join(RUNS, candidate))) return freshRunId(prefix);
  return candidate;
}

type Selection = { list: true } | { list: false; mode: "single-bug" | "full-set"; bugs: BugEntry[]; setId: string };

function parseSelection(argv: string[]): Selection {
  let list = false;
  let all = false;
  let setId = "";
  const requested: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--list") { list = true; continue; }
    if (arg === "--all") { all = true; continue; }
    if (arg === "--set") { setId = argv[++index] ?? ""; continue; }
    if (arg === "--id") { requested.push(argv[++index] ?? ""); continue; }
    if (arg.startsWith("--id=")) { requested.push(arg.slice("--id=".length)); continue; }
    throw new Error("unknown argument: " + arg);
  }
  if (list) {
    if (all || setId || requested.length) throw new Error("--list cannot be combined with selection flags");
    return { list: true };
  }
  const flags = [all ? "--all" : "", setId ? "--set" : "", requested.length ? "--id" : ""].filter(Boolean);
  if (flags.length > 1) throw new Error(`flags are mutually exclusive: ${flags.join(", ")}`);
  if (all) {
    return { list: false, mode: "single-bug", bugs: [...BUG_REGISTRY], setId: "registry-all" };
  }
  if (setId) {
    const set = loadSet(setId);
    const reasons = validateSet(set);
    if (reasons.length) throw new Error(`bug set is invalid: ${reasons.join("; ")}`);
    return { list: false, mode: "full-set", bugs: setBugs(set), setId: set.id };
  }
  if (requested.length) {
    const bugs = requested.map((id) => {
      const entry = BUG_REGISTRY.find((candidate) => candidate.id === id);
      if (!entry) throw new Error("unknown bug id: " + id);
      return entry;
    });
    return { list: false, mode: "single-bug", bugs, setId: "adhoc" };
  }
  usage(2);
}

function addStatus(statuses: Record<string, boolean>, id: string, passed: boolean, source: string): void {
  if (id in statuses) throw new Error("duplicate raw result ID " + id + " in " + source);
  statuses[id] = passed;
}

function collectVitestRaw(path: string, statuses: Record<string, boolean>): void {
  const report = readJson(path);
  if (!isRecord(report) || !Array.isArray(report.testResults)) {
    throw new Error("invalid Vitest raw report: " + relative(ROOT, path));
  }
  for (const file of report.testResults) {
    if (!isRecord(file) || !Array.isArray(file.assertionResults)) continue;
    for (const assertion of file.assertionResults) {
      if (!isRecord(assertion) || typeof assertion.title !== "string") continue;
      const id = assertion.title.trim();
      if (id) addStatus(statuses, id, assertion.status === "passed", relative(ROOT, path));
    }
  }
}

function collectPlaywrightRaw(path: string, statuses: Record<string, boolean>): void {
  const report = readJson(path);
  if (!isRecord(report) || !Array.isArray(report.suites)) {
    throw new Error("invalid Playwright raw report: " + relative(ROOT, path));
  }
  const walk = (suite: unknown): void => {
    if (!isRecord(suite)) return;
    if (Array.isArray(suite.specs)) {
      for (const spec of suite.specs) {
        if (!isRecord(spec) || typeof spec.title !== "string") continue;
        const tests = Array.isArray(spec.tests) ? spec.tests : [];
        const first = tests[0];
        const firstStatus = isRecord(first) ? first.status : undefined;
        const id = spec.title.trim();
        if (id) addStatus(statuses, id, spec.ok === true && firstStatus !== "skipped", relative(ROOT, path));
      }
    }
    if (Array.isArray(suite.suites)) for (const child of suite.suites) walk(child);
  };
  for (const suite of report.suites) walk(suite);
}

function collectRawStatuses(artifactDir: string): Record<string, boolean> {
  const statuses: Record<string, boolean> = {};
  collectVitestRaw(join(artifactDir, "unit-raw.json"), statuses);
  collectVitestRaw(join(artifactDir, "api-raw.json"), statuses);
  collectPlaywrightRaw(join(artifactDir, "e2e-raw.json"), statuses);
  collectPlaywrightRaw(join(artifactDir, "e2e-error-raw.json"), statuses);
  return statuses;
}

function statusesMatch(raw: Record<string, boolean>, collected: JsonRecord): boolean {
  const rawIds = Object.keys(raw).sort();
  const collectedIds = Object.keys(collected).sort();
  if (rawIds.join("\0") !== collectedIds.join("\0")) return false;
  return rawIds.every((id) => collected[id] === raw[id]);
}

function runBug(
  mode: "single-bug" | "full-set",
  bugs: readonly BugEntry[],
  setId: string,
): BugReport {
  const registryReasons = validateRegistry(BUG_REGISTRY);
  if (registryReasons.length) throw new Error("bug registry is invalid: " + registryReasons.join("; "));

  const runId = freshRunId("bug-" + safeRunPart(setId));
  const artifactDir = join(RUNS, runId, "artifacts");
  const fixtureBefore = snapshotProtectedTree(FIXTURE);
  const referenceBefore = snapshotProtectedTree(REFERENCE);

  const ids = bugs.map((entry) => entry.id);
  const detectors = [...new Set(bugs.flatMap((entry) => entry.detectors))].sort();
  // Everything a selected bug declares as collateral is also allowed to fail:
  // a single realistic mutation can move more than one observable surface.
  const allowed = new Set<string>([
    ...detectors,
    ...bugs.flatMap((entry) => entry.collateral),
  ]);

  // run.sh wipes runs/<runId> before it seeds, so any file the runner must read
  // lives outside that directory. Named sets are used in place; adhoc selections
  // materialize a persistent set file beside the run.
  let bugSetPath = "";
  if (mode === "full-set" && !setId.includes("/")) {
    const candidateSetPath = join(ROOT, "harness", "bugfix", "sets", `${setId}.json`);
    if (!existsSync(candidateSetPath)) throw new Error("unknown bug set: " + setId);
    bugSetPath = candidateSetPath;
  }
  const admissionDir = `${RUNS}/${runId}-admission`;
  if (!bugSetPath) {
    mkdirSync(admissionDir, { recursive: true });
    bugSetPath = join(admissionDir, "bug-set.json");
    writeFileSync(bugSetPath, JSON.stringify({
      schema: 1,
      id: "verify-" + safeRunPart(ids.join("-")),
      bugs: ids,
      notes: "verify-bugs adhoc admission set",
      admission: true,
    }, null, 2) + "\n");
  }

  // Pre-generate once: this proves the anchors bite and records the expected
  // variant hash. run.sh regenerates the same tree from the same set file.
  mkdirSync(artifactDir, { recursive: true });
  console.log(`[bugfix:${mode}] generating variant for ${ids.length} bug(s)`);
  const make = spawnSync(
    join(ROOT, "harness", "node_modules", ".bin", "tsx"),
    [join(ROOT, "harness", "bugfix", "make-variant.ts"), "--out", join(admissionDir, "variant"), "--set", bugSetPath],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (make.status !== 0 || !make.stdout.trim()) {
    throw new Error(`variant generation failed: ${make.stderr || make.stdout}`);
  }
  const manifest = JSON.parse(make.stdout) as JsonRecord;
  writeFileSync(join(admissionDir, "bug-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  const variantShaBefore = hashTreeOnDisk(join(admissionDir, "variant"));

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    AGENT_SKIP: "1",
    BENCH_TRACK: "bugfix",
    BENCH_BUG_SET: bugSetPath,
  };
  delete childEnv.API_PORT;
  delete childEnv.E2E_PORT;
  delete childEnv.OVERLAY;
  console.log(`[bugfix:${mode}] running ${runId}`);
  const runner = spawnSync(RUNNER, ["local", "sensitivity-bug", "a", runId], {
    cwd: ROOT,
    env: childEnv,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(
    join(artifactDir, "bug-runner.log"),
    (runner.stdout ?? "") + (runner.stderr ? "\n--- stderr ---\n" + runner.stderr : ""),
  );

  const issues: string[] = [];
  if (runner.error) issues.push("runner could not start: " + runner.error.message);
  if (runner.status !== 0) issues.push("runner exit status was " + String(runner.status));
  if (runner.signal) issues.push("runner was terminated by " + runner.signal);

  let raw: Record<string, boolean> = {};
  let results: JsonRecord = {};
  let score: JsonRecord = {};
  let collectionCurrent = false;
  try {
    raw = collectRawStatuses(artifactDir);
    const loadedResults = readJson(join(artifactDir, "results.json"));
    if (!isRecord(loadedResults)) throw new Error("results.json is not an object");
    results = loadedResults;
    const loadedScore = readJson(join(artifactDir, "score.json"));
    if (!isRecord(loadedScore)) throw new Error("score.json is not an object");
    score = loadedScore;
    const loadedCollection = readJson(join(artifactDir, "collection.json"));
    collectionCurrent = isRecord(loadedCollection) && loadedCollection.valid === true && loadedCollection.status === "collected";
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  if (!collectionCurrent) issues.push("collection did not complete");

  const rawFailures = Object.keys(raw).filter((id) => raw[id] === false).sort();
  const collectedFailures = Object.keys(results).filter((id) => results[id] === false).sort();
  const missingExpected = detectors.filter((id) => raw[id] !== false);
  const unexpected = rawFailures.filter((id) => !allowed.has(id));
  const rawMatchesCollection = statusesMatch(raw, results);
  if (!rawMatchesCollection) issues.push("results.json does not exactly match the raw reports");
  if (missingExpected.length) issues.push("expected detector failures did not occur: " + missingExpected.join(", "));
  if (unexpected.length) issues.push("unexpected raw failures: " + unexpected.join(", "));

  const gatePassed = score.gate === undefined ? false : (score.gate as JsonRecord).passed === true;
  const provenanceValid = score.provenance_valid === true;
  const suiteCurrent = score.suite_current === true;
  const scoreValid = score.valid === true && score.blocked_by_gate === false;
  if (!gatePassed) issues.push("bug variant invalidated the typecheck/build gate");
  if (!provenanceValid) issues.push("bug variant invalidated provenance");
  if (!suiteCurrent) issues.push("bug variant invalidated suite currentness");
  if (!scoreValid) issues.push("bug variant did not yield a valid non-gate-blocked score");

  const variantUnchanged = hashTreeOnDisk(join(RUNS, runId, "variant")) === variantShaBefore;
  if (!variantUnchanged) issues.push("variant tree changed during the admission run");
  const fixtureUnchanged = protectedTreeUnchanged(fixtureBefore, FIXTURE);
  const referenceUnchanged = protectedTreeUnchanged(referenceBefore, REFERENCE);
  if (!fixtureUnchanged) issues.push("fixture tree changed during the admission run");
  if (!referenceUnchanged) issues.push("reference tree changed during the admission run");

  const report: BugReport = {
    schema: 1,
    kind: "bug-admission",
    mode,
    bug_set: { id: String(manifest.bug_set_id), bugs: ids, detectors },
    run_id: runId,
    variant: relative(ROOT, join(admissionDir, "variant")),
    runner: { status: runner.status, signal: runner.signal, error: runner.error?.message ?? null },
    observed: {
      raw_failures: rawFailures,
      collected_failures: collectedFailures,
      raw_matches_collection: rawMatchesCollection,
      missing_expected_failures: missingExpected,
      unexpected_failures: unexpected,
    },
    integrity: {
      gate_passed: gatePassed,
      collection_current: collectionCurrent,
      provenance_valid: provenanceValid,
      suite_current: suiteCurrent,
      score_valid: scoreValid,
      score_current: score.suite_current === true && score.provenance_valid === true,
      host_trusted: score.host === undefined ? false : (score.host as JsonRecord).under_load !== true,
      variant_unchanged: variantUnchanged,
      fixture_unchanged: fixtureUnchanged,
      reference_unchanged: referenceUnchanged,
    },
    sensitivity_passed: false,
    passed: false,
    issues,
  };
  report.sensitivity_passed = issues.length === 0;
  report.passed = report.sensitivity_passed;
  writeFileSync(join(artifactDir, "bug-verification.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`[bugfix:${mode}] ${ids.join(",")} ${(report.passed ? "PASS" : "FAIL")} -> runs/${runId}/artifacts/bug-verification.json`);
  return report;
}

async function main(): Promise<void> {
  const selection = parseSelection(process.argv.slice(2));
  if (selection.list) {
    for (const entry of BUG_REGISTRY) {
      console.log(`${entry.id}\t${entry.class}\t${entry.skill_rule ?? "-"}\t${entry.detectors.join(",")}\t${entry.target}`);
    }
    return;
  }
  if (selection.mode === "single-bug") {
    for (const bugEntry of selection.bugs) {
      const report = runBug("single-bug", [bugEntry], "adhoc");
      if (!report.passed) {
        process.exitCode = 1;
      }
    }
    return;
  }
  const report = runBug("full-set", selection.bugs, selection.setId);
  if (!report.passed) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
