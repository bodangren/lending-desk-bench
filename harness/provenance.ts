import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

const IGNORED_DIRECTORIES = new Set(["node_modules", ".next", ".git"]);

function walkFiles(relativeDir: string): string[] {
  const files: string[] = [];
  const visit = (relativePath: string) => {
    const fullPath = join(ROOT, relativePath);
    for (const entry of readdirSync(fullPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const childPath = join(relativePath, entry.name);
      if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) visit(childPath);
      else if (entry.isFile()) files.push(childPath);
    }
  };
  visit(relativeDir);
  return files.sort();
}

function hashPaths(relativePaths: string[]): string {
  const rows = relativePaths
    .slice()
    .sort()
    .map((relativePath) => `${sha256(readFileSync(join(ROOT, relativePath)))}  ${relativePath}\n`);
  return sha256(rows.join(""));
}

export function currentHashes() {
  const testFiles = walkFiles("harness/tests");
  const fixtureFiles = walkFiles("fixture");
  const referenceFiles = walkFiles("reference").filter((path) => path !== "reference/doctor-raw.json");
  // The second correct implementation grades tests-track suites; the change
  // reference is the change track's calibration overlay.
  const variantReferenceFiles = walkFiles("reference-variant");
  const changeReferenceFiles = walkFiles("reference-change");
  const testsTrackFiles = [
    ...walkFiles("harness/tests-track/model-visible"),
    ...walkFiles("harness/tests-track/sets"),
    ...walkFiles("harness/tests-track/oracle-overlay"),
  ];
  const changeTrackFiles = [...walkFiles("harness/change/model-visible"), ...walkFiles("harness/change/sets")];
  return {
    runner_sha256: hashPaths([
      "harness/run.sh",
      "harness/grade.sh",
      "harness/score.ts",
      "harness/score-calculation.ts",
      "harness/score-attestation.ts",
      "harness/verify-controls.ts",
      "harness/verify-bugs.ts",
      "harness/executor-attestation.ts",
      "harness/collect.ts",
      "harness/score-freshness.ts",
      "harness/doctor.ts",
      "harness/source-signals.ts",
      "harness/provenance.ts",
      "harness/execution-identity.ts",
      "harness/candidate-contract.ts",
      "harness/public-api.ts",
      "harness/preflight.sh",
      "harness/usage.ts",
      "harness/opencode-entry.sh",
      "harness/opencode-credential.sh",
      "harness/toolchain.sh",
      "harness/go-cost.ts",
      "harness/bugfix/registry.ts",
      "harness/bugfix/set-loader.ts",
      "harness/bugfix/make-variant.ts",
      "harness/bugfix/sets/v1.json",
      "harness/bugfix/model-visible/AGENTS.md",
      "harness/bugfix/model-visible/track/spec.md",
      "harness/bugfix/model-visible/track/plan.md",
      "harness/bugfix/model-visible/track/metadata.json",
      "harness/browser-check.ts",
      "harness/revisions.ts",
      "harness/track-bindings.ts",
      "harness/track-scoring.ts",
      "harness/provenance-check.ts",
      "harness/provenance-record.ts",
      "harness/tests-track/mutants.ts",
      "harness/tests-track/set-loader.ts",
      "harness/tests-track/make-variant.ts",
      "harness/tests-track/grade-tests.ts",
      "harness/change/requests.ts",
      "harness/change/make-variant.ts",
      ...testsTrackFiles,
      ...changeTrackFiles,
    ]),
    suite_sha256: hashPaths([
      ...testFiles,
      ...fixtureFiles,
      ...referenceFiles,
      ...variantReferenceFiles,
      ...changeReferenceFiles,
      "harness/package.json",
      "harness/package-lock.json",
      "harness/playwright.config.ts",
      "harness/vitest.config.ts",
    ]),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const hashes = currentHashes();
  if (process.argv[2] === "--shell") {
    console.log(`${hashes.runner_sha256}\t${hashes.suite_sha256}`);
  } else {
    console.log(JSON.stringify(hashes));
  }
}
