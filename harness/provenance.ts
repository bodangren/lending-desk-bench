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
  return {
    runner_sha256: hashPaths([
      "harness/run.sh",
      "harness/grade.sh",
      "harness/score.ts",
      "harness/score-calculation.ts",
      "harness/score-attestation.ts",
      "harness/verify-controls.ts",
      "harness/executor-attestation.ts",
      "harness/collect.ts",
      "harness/score-freshness.ts",
      "harness/doctor.ts",
      "harness/provenance.ts",
      "harness/execution-identity.ts",
      "harness/candidate-contract.ts",
      "harness/public-api.ts",
      "harness/preflight.sh",
      "harness/usage.ts",
    ]),
    suite_sha256: hashPaths([
      ...testFiles,
      ...fixtureFiles,
      ...referenceFiles,
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
