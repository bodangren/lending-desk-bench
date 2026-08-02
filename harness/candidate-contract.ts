/**
 * Candidate filesystem contract shared by run, grade, and score.
 *
 * The fixture describes the complete allowed tree. Only the task files and
 * Measure closeout records may differ in a candidate. Generated runtime trees
 * are ignored, but symlinks and every other extra/special entry are rejected.
 */
import { canonicalPublicSurface } from "./public-api.js";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const WRITABLE_CANDIDATE_PATHS = [
  "src/lib/loans.ts",
  "src/components/item-card.tsx",
  "src/actions/loans.ts",
  "app/items/page.tsx",
  "app/items/[id]/page.tsx",
  "app/items/[id]/checkout-form.tsx",
  "app/api/loans/route.ts",
  "app/items/loading.tsx",
  "app/items/error.tsx",
  "measure/tracks/lending_desk/plan.md",
  "measure/tracks/lending_desk/metadata.json",
] as const;

const WRITABLE = new Set<string>(WRITABLE_CANDIDATE_PATHS);
const RUNTIME_DIRECTORIES = new Set(["node_modules", ".next", ".git"]);

export type CandidateContract = {
  schema: 1;
  valid: boolean;
  reasons: string[];
  candidate_sha256: string;
  fixture_protected_sha256: string;
  candidate_protected_sha256: string;
  fixture_files: string[];
  candidate_files: string[];
};

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

function readTree(root: string) {
  const files: string[] = [];
  const unsafe: string[] = [];
  const visit = (dir: string, isRoot: boolean) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name);
      const rel = relative(root, full);
      if (isRoot && RUNTIME_DIRECTORIES.has(entry.name)) continue;
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) {
        unsafe.push(`symlink: ${rel}`);
      } else if (stat.isDirectory()) {
        if (RUNTIME_DIRECTORIES.has(entry.name)) {
          unsafe.push(`forbidden nested runtime directory: ${rel}`);
        }
        visit(full, false);
      } else if (stat.isFile()) {
        if (!rel.endsWith(".tsbuildinfo")) files.push(rel);
      } else {
        unsafe.push(`unsupported filesystem entry: ${rel}`);
      }
    }
  };
  visit(root, true);
  return { files: files.sort(), unsafe: unsafe.sort() };
}

function treeHash(root: string, files: readonly string[]) {
  return hash(files.map((rel) => `${hash(readFileSync(join(root, rel)))}  ${rel}\n`).join(""));
}

function protectedHash(root: string, files: readonly string[]) {
  return hash(files
    .filter((rel) => !WRITABLE.has(rel))
    .map((rel) => `${hash(readFileSync(join(root, rel)))}  ${rel}\n`)
    .join(""));
}

export function assessCandidateContract(fixtureRoot: string, candidateRoot: string): CandidateContract {
  const fixture = resolve(fixtureRoot);
  const candidate = resolve(candidateRoot);
  const reasons: string[] = [];
  for (const [label, root] of [["fixture", fixture], ["candidate", candidate]] as const) {
    if (!existsSync(root)) {
      reasons.push(`${label} directory is missing: ${root}`);
      continue;
    }
    const stat = lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      reasons.push(`${label} root must be a real directory: ${root}`);
    }
  }
  if (reasons.length) {
    return {
      schema: 1, valid: false, reasons,
      candidate_sha256: "", fixture_protected_sha256: "", candidate_protected_sha256: "",
      fixture_files: [], candidate_files: [],
    };
  }

  const fixtureTree = readTree(fixture);
  const candidateTree = readTree(candidate);
  reasons.push(...fixtureTree.unsafe.map((reason) => `fixture ${reason}`));
  reasons.push(...candidateTree.unsafe.map((reason) => `candidate ${reason}`));
  if (existsSync(join(candidate, ".git"))) reasons.push("candidate contains .git");

  const fixtureSet = new Set(fixtureTree.files);
  const candidateSet = new Set(candidateTree.files);
  const missing = fixtureTree.files.filter((path) => !candidateSet.has(path));
  const added = candidateTree.files.filter((path) => !fixtureSet.has(path));
  if (missing.length) reasons.push(`candidate is missing fixture file(s): ${missing.join(", ")}`);
  if (added.length) reasons.push(`candidate adds file(s): ${added.join(", ")}`);

  const fixtureProtected = protectedHash(fixture, fixtureTree.files);
  for (const path of WRITABLE_CANDIDATE_PATHS) {
    if (!/\.tsx?$/.test(path) || !fixtureSet.has(path) || !candidateSet.has(path)) continue;
    try {
      if (/@ts-(?:nocheck|ignore|expect-error)\b/i.test(readFileSync(join(candidate, path), "utf8"))) {
        reasons.push("candidate contains a TypeScript compiler suppression");
        break;
      }
      const fixtureSurface = canonicalPublicSurface(join(fixture, path));
      const candidateSurface = canonicalPublicSurface(join(candidate, path));
      if (fixtureSurface.join("\u0000") !== candidateSurface.join("\u0000")) {
        reasons.push("candidate changed a writable public export or type signature");
        break;
      }
    } catch (error) {
      reasons.push("candidate public API inspection failed: " + (error instanceof Error ? error.message : String(error)));
      break;
    }
  }
  const candidateProtected = protectedHash(candidate, candidateTree.files);
  if (fixtureProtected !== candidateProtected) reasons.push("candidate modified protected fixture files");

  return {
    schema: 1,
    valid: reasons.length === 0,
    reasons,
    candidate_sha256: treeHash(candidate, candidateTree.files),
    fixture_protected_sha256: fixtureProtected,
    candidate_protected_sha256: candidateProtected,
    fixture_files: fixtureTree.files,
    candidate_files: candidateTree.files,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [, , command, candidateRoot] = process.argv;
  if (command === "--writable-paths") {
    console.log(WRITABLE_CANDIDATE_PATHS.join("\n"));
  } else {
    const fixtureRoot = command;
    if (!fixtureRoot || !candidateRoot) {
      throw new Error("usage: candidate-contract.ts <fixture-root> <candidate-root>");
    }
    const contract = assessCandidateContract(fixtureRoot, candidateRoot);
    console.log(JSON.stringify(contract, null, 2));
    process.exitCode = contract.valid ? 0 : 3;
  }
}
