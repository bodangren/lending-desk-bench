/**
 * Execute the declarative sensitivity controls against fresh reference overlays.
 *
 * This is intentionally a calibration operator, not part of model ranking:
 * each selected control gets a unique run ID, an immutable reference copy with
 * one anchored mutation, and the normal run.sh -> grade.sh pipeline.
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { applyNegativeControl } from "./tests/negative-controls.js";
import {
  SENSITIVITY_CONTROLS,
  type SensitivityControl,
} from "./tests/sensitivity-controls.js";
import { protectedTreeUnchanged, snapshotProtectedTree } from "./protected-tree.js";
import { assessScoreFreshness } from "./score-freshness.js";

const ROOT = resolve(import.meta.dirname, "..");
const RUNS = join(ROOT, "runs");
const REFERENCE = join(ROOT, "reference");
const FIXTURE = join(ROOT, "fixture");
const RUNNER = join(ROOT, "harness", "run.sh");

const FAST_CONTROL_IDS = [
  "sensitivity-A.returned",
  "sensitivity-C.renders",
  "sensitivity-G.get200",
  "sensitivity-ADV.useActionState",
] as const;

type JsonRecord = Record<string, unknown>;

type ControlReport = {
  schema: 1;
  kind: "sensitivity-control";
  control: {
    id: string;
    target: string;
    expected_failures: readonly string[];
    allowed_collateral: readonly string[];
  };
  run_id: string;
  overlay: string;
  runner: {
    status: number | null;
    signal: string | null;
    error: string | null;
  };
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
    reference_unchanged: boolean;
    fixture_unchanged: boolean;
  };
  sensitivity_passed: boolean;
  calibration_passed: boolean;
  passed: boolean;
  issues: string[];
};

function usage(exitCode: number): never {
  console.error(
    "Usage: tsx harness/verify-controls.ts --list | --fast | --all | --id <control-id> [--id <control-id> ...]",
  );
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


function resolveInside(base: string, target: string): string {
  if (!target || target.includes("\0")) throw new Error("empty or NUL target");
  const full = resolve(base, target);
  if (full !== base && !full.startsWith(base + sep)) {
    throw new Error("target escapes " + relative(ROOT, base) + ": " + target);
  }
  return full;
}

function safeRunPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36);
}

function freshRunId(control: SensitivityControl, index: number): string {
  const suffix = Date.now().toString(36) + "-" + randomBytes(3).toString("hex");
  const candidate = "control-" + safeRunPart(control.id) + "-" + index + "-" + suffix;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(candidate)) {
    throw new Error("generated invalid run ID: " + candidate);
  }
  if (existsSync(join(RUNS, candidate))) return freshRunId(control, index + 1);
  return candidate;
}

function parseSelection(argv: string[]): { list: boolean; controls: SensitivityControl[] } {
  let list = false;
  let all = false;
  let fast = false;
  const requested: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--list") {
      list = true;
      continue;
    }
    if (arg === "--all") {
      all = true;
      continue;
    }
    if (arg === "--fast") {
      fast = true;
      continue;
    }
    if (arg === "--id") {
      const id = argv[++index];
      if (!id) usage(2);
      requested.push(id);
      continue;
    }
    if (arg.startsWith("--id=")) {
      requested.push(arg.slice("--id=".length));
      continue;
    }
    throw new Error("unknown argument: " + arg);
  }

  if (list) {
    if (all || fast || requested.length) throw new Error("--list cannot be combined with selection flags");
    return { list: true, controls: [] };
  }
  if (all && (fast || requested.length)) throw new Error("--all cannot be combined with --fast or --id");

  const byId = new Map(SENSITIVITY_CONTROLS.map((control) => [control.id, control]));
  const selected = new Map<string, SensitivityControl>();
  if (all) {
    for (const control of SENSITIVITY_CONTROLS) selected.set(control.id, control);
  }
  if (fast) {
    for (const id of FAST_CONTROL_IDS) {
      const control = byId.get(id);
      if (!control) throw new Error("fast control missing from manifest: " + id);
      selected.set(id, control);
    }
  }
  for (const id of requested) {
    const control = byId.get(id);
    if (!control) throw new Error("unknown sensitivity control: " + id);
    selected.set(id, control);
  }
  if (selected.size === 0) usage(2);
  return { list: false, controls: [...selected.values()] };
}

function addStatus(
  statuses: Record<string, boolean>,
  id: string,
  passed: boolean,
  source: string,
): void {
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
    if (Array.isArray(suite.suites)) {
      for (const child of suite.suites) walk(child);
    }
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

function writeControlReport(runId: string, report: ControlReport): void {
  const artifactDir = join(RUNS, runId, "artifacts");
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, "control-verification.json"), JSON.stringify(report, null, 2) + "\n");
}

function runControl(control: SensitivityControl, index: number): ControlReport {
  const runId = freshRunId(control, index);
  const overlay = join(RUNS, runId + "-overlay");
  const artifactDir = join(RUNS, runId, "artifacts");
  const overlayTarget = resolveInside(overlay, control.target);
  const referenceBefore = snapshotProtectedTree(REFERENCE);
  const fixtureBefore = snapshotProtectedTree(FIXTURE);

  cpSync(REFERENCE, overlay, { recursive: true, errorOnExist: true });
  const source = readFileSync(overlayTarget, "utf8");
  const mutated = applyNegativeControl(source, control);
  writeFileSync(overlayTarget, mutated);

  const childEnv: NodeJS.ProcessEnv = { ...process.env, AGENT_SKIP: "1", OVERLAY: overlay };
  delete childEnv.API_PORT;
  delete childEnv.E2E_PORT;
  // Preserve an explicit operator override; resulting control evidence remains untrusted.
  console.log("[" + control.id + "] running " + runId);
  const runner = spawnSync(RUNNER, ["local", "sensitivity-control", "a", runId], {
    cwd: ROOT,
    env: childEnv,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(
    join(artifactDir, "control-runner.log"),
    (runner.stdout ?? "") + (runner.stderr ? "\n--- stderr ---\n" + runner.stderr : ""),
  );

  const issues: string[] = [];
  if (runner.error) issues.push("runner could not start: " + runner.error.message);
  if (runner.status !== 0) issues.push("runner exit status was " + String(runner.status));
  if (runner.signal) issues.push("runner was terminated by " + runner.signal);

  let raw: Record<string, boolean> = {};
  let results: JsonRecord = {};
  let gate: JsonRecord = {};
  let collection: JsonRecord = {};
  let score: JsonRecord = {};
  try {
    raw = collectRawStatuses(artifactDir);
    const loadedResults = readJson(join(artifactDir, "results.json"));
    if (!isRecord(loadedResults)) throw new Error("results.json is not an object");
    results = loadedResults;
    const loadedGate = readJson(join(artifactDir, "gate.json"));
    if (!isRecord(loadedGate)) throw new Error("gate.json is not an object");
    gate = loadedGate;
    const loadedCollection = readJson(join(artifactDir, "collection.json"));
    if (!isRecord(loadedCollection)) throw new Error("collection.json is not an object");
    collection = loadedCollection;
    const loadedScore = readJson(join(artifactDir, "score.json"));
    if (!isRecord(loadedScore)) throw new Error("score.json is not an object");
    score = loadedScore;
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  const scoreFreshness = assessScoreFreshness(join(artifactDir, "score.json"));
  const scoreCurrent = scoreFreshness.score_current === true;
  const hostTrusted = scoreFreshness.host_trusted === true;

  const rawFailures = Object.keys(raw).filter((id) => raw[id] === false).sort();
  const collectedFailures = Object.keys(results).filter((id) => results[id] === false).sort();
  const allowed = new Set([...control.expectedFailures, ...control.allowedCollateral]);
  const missingExpected = control.expectedFailures.filter((id) => raw[id] !== false);
  const unexpected = rawFailures.filter((id) => !allowed.has(id));
  const rawMatchesCollection = statusesMatch(raw, results);

  if (!rawMatchesCollection) issues.push("results.json does not exactly match the raw reports");
  if (missingExpected.length) issues.push("expected raw failures did not occur: " + missingExpected.join(", "));
  if (unexpected.length) issues.push("unexpected raw failures: " + unexpected.join(", "));

  const gatePassed = gate.typecheck === true && gate.build === true;
  const collectionCurrent = collection.valid === true && collection.status === "collected";
  const provenanceValid = score.provenance_valid === true;
  const suiteCurrent = score.suite_current === true;
  const scoreValid = score.valid === true && score.blocked_by_gate === false;
  if (!gatePassed) issues.push("control invalidated the typecheck/build gate");
  if (!collectionCurrent) issues.push("control invalidated collection");
  if (!provenanceValid) issues.push("control invalidated provenance");
  if (!suiteCurrent) issues.push("control invalidated suite currentness");
  if (!scoreValid) issues.push("control did not yield a valid non-gate-blocked score");
  if (!scoreCurrent) issues.push("control score record does not match live artifacts");

  const referenceUnchanged = protectedTreeUnchanged(referenceBefore, REFERENCE);
  const fixtureUnchanged = protectedTreeUnchanged(fixtureBefore, FIXTURE);
  if (!referenceUnchanged) issues.push("reference tree changed during control execution");
  if (!fixtureUnchanged) issues.push("fixture tree changed during control execution");

  const sensitivityPassed = issues.length === 0;
  const calibrationPassed = sensitivityPassed && hostTrusted;

  const report: ControlReport = {
    schema: 1,
    kind: "sensitivity-control",
    control: {
      id: control.id,
      target: control.target,
      expected_failures: control.expectedFailures,
      allowed_collateral: control.allowedCollateral,
    },
    run_id: runId,
    overlay: relative(ROOT, overlay),
    runner: {
      status: runner.status,
      signal: runner.signal,
      error: runner.error?.message ?? null,
    },
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
      score_current: scoreCurrent,
      host_trusted: hostTrusted,
      reference_unchanged: referenceUnchanged,
      fixture_unchanged: fixtureUnchanged,
    },
    sensitivity_passed: sensitivityPassed,
    calibration_passed: calibrationPassed,
    passed: calibrationPassed,
    issues,
  };
  writeControlReport(runId, report);
  console.log("[" + control.id + "] " + (report.passed ? "PASS" : "FAIL") + " -> runs/" + runId + "/artifacts/control-verification.json");
  return report;
}

function main(): void {
  const selection = parseSelection(process.argv.slice(2));
  if (selection.list) {
    for (const control of SENSITIVITY_CONTROLS) {
      console.log(control.id + "\t" + control.expectedFailures.join(",") + "\t" + control.target);
    }
    return;
  }

  const batchId = "control-batch-" + Date.now().toString(36) + "-" + randomBytes(3).toString("hex");
  const batchArtifacts = join(RUNS, batchId, "artifacts");
  mkdirSync(batchArtifacts, { recursive: true });
  const reports = selection.controls.map((control, index) => runControl(control, index));
  const summary = {
    schema: 1,
    kind: "sensitivity-control-batch",
    controls: reports.map((report) => ({
      id: report.control.id,
      run_id: report.run_id,
      passed: report.passed,
      sensitivity_passed: report.sensitivity_passed,
      calibration_passed: report.calibration_passed,
      report: "runs/" + report.run_id + "/artifacts/control-verification.json",
    })),
    sensitivity_passed: reports.every((report) => report.sensitivity_passed),
    calibration_passed: reports.every((report) => report.calibration_passed),
    passed: reports.every((report) => report.calibration_passed),
  };
  writeFileSync(join(batchArtifacts, "verify-controls-summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log("summary -> runs/" + batchId + "/artifacts/verify-controls-summary.json");
  if (!summary.passed) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
