/**
 * Candidate filesystem contract shared by run, grade, and score.
 *
 * The comparison root (the fixture, or a track's generated variant) describes
 * the complete allowed tree. Only the track's writable files may differ in a
 * candidate. Generated runtime trees are ignored.
 *
 * Violations fall in two classes (bench_v2 FR-8):
 *   hard  symlinks, special entries, nested runtime directories, .git. The run
 *         stays invalid: these can reach outside the candidate.
 *   soft  added or missing files, protected edits, changed exports, compiler
 *         suppressions, test-file limits. Under fixture r1 these discarded the
 *         whole run (19 build runs). Now run.sh records them, grafts the writable
 *         files onto a fresh root, and grades the graft; adherence pays the cost.
 */
import { canonicalPublicSurface } from "./public-api.js";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
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

const TASK_FILES = WRITABLE_CANDIDATE_PATHS.filter((path) => !path.startsWith("measure/tracks/"));

/** The bugfix variant replaces the build track's Measure directory. */
export const BUGFIX_WRITABLE_CANDIDATE_PATHS = [
  ...TASK_FILES,
  "measure/tracks/lending_desk_bugfix/plan.md",
  "measure/tracks/lending_desk_bugfix/metadata.json",
] as const;

/** The change variant keeps the nine task files writable (change_bench FR-4). */
export const CHANGE_WRITABLE_CANDIDATE_PATHS = [
  ...TASK_FILES,
  "measure/tracks/lending_desk_change/plan.md",
  "measure/tracks/lending_desk_change/metadata.json",
] as const;

/**
 * The tests variant protects every application file. The candidate may add
 * test files under tests/ (tests_bench FR-3) and close out its Measure track.
 */
export const TESTS_WRITABLE_CANDIDATE_PATHS = [
  "measure/tracks/lending_desk_tests/plan.md",
  "measure/tracks/lending_desk_tests/metadata.json",
] as const;
export const TEST_FILE_PATTERN = /^tests\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.test\.ts$/;
export const TEST_FILE_LIMITS = { files: 20, bytes: 200_000 };

export type BenchTrack = "build" | "bugfix" | "tests" | "change";
export const BENCH_TRACKS: readonly BenchTrack[] = ["build", "bugfix", "tests", "change"];

export function resolveTrack(value: string | undefined | null): BenchTrack {
  return BENCH_TRACKS.includes(value as BenchTrack) ? (value as BenchTrack) : "build";
}

/** Exact writable paths. The tests track also accepts TEST_FILE_PATTERN files. */
export function writablePathsForTrack(track: BenchTrack): readonly string[] {
  switch (track) {
    case "bugfix": return BUGFIX_WRITABLE_CANDIDATE_PATHS;
    case "change": return CHANGE_WRITABLE_CANDIDATE_PATHS;
    case "tests": return TESTS_WRITABLE_CANDIDATE_PATHS;
    default: return WRITABLE_CANDIDATE_PATHS;
  }
}

export function isWritableForTrack(track: BenchTrack, rel: string): boolean {
  if (writablePathsForTrack(track).includes(rel)) return true;
  return track === "tests" && TEST_FILE_PATTERN.test(rel) && !rel.split("/").includes("..");
}

/** Writable files present in a candidate: the exact paths plus any track-pattern files. */
export function candidateWritableFiles(track: BenchTrack, candidateRoot: string): string[] {
  const files = existsSync(candidateRoot) ? readTree(resolve(candidateRoot)).files : [];
  return files.filter((rel) => isWritableForTrack(track, rel));
}

const WRITABLE = new Set<string>(WRITABLE_CANDIDATE_PATHS);
const RUNTIME_DIRECTORIES = new Set(["node_modules", ".next", ".git"]);

export type HardViolation = "unsafe_entry" | "git_directory" | "missing_root";
export type SoftViolation =
  | "files_added"
  | "files_missing"
  | "protected_modified"
  | "surface_changed"
  | "ts_suppression"
  | "test_limits";
/** Soft classes a graft cannot remove: they live inside writable files. */
export const GRADEABLE_SOFT_CLASSES: ReadonlySet<SoftViolation> = new Set(["surface_changed", "ts_suppression"]);

export type CandidateContract = {
  schema: 1;
  /** No violation of any class. */
  valid: boolean;
  /** No hard violation, and every soft violation lives inside a writable file. */
  gradeable: boolean;
  reasons: string[];
  hard: HardViolation[];
  soft: SoftViolation[];
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
  return protectedHashWith(root, files, WRITABLE);
}

function protectedHashWith(root: string, files: readonly string[], writable: Set<string>) {
  return hash(files
    .filter((rel) => !writable.has(rel))
    .map((rel) => `${hash(readFileSync(join(root, rel)))}  ${rel}\n`)
    .join(""));
}

export function assessCandidateContract(
  fixtureRoot: string,
  candidateRoot: string,
  options: { track?: BenchTrack } = {},
): CandidateContract {
  const track = options.track ?? "build";
  const fixture = resolve(fixtureRoot);
  const candidate = resolve(candidateRoot);
  const reasons: string[] = [];
  const hard = new Set<HardViolation>();
  const soft = new Set<SoftViolation>();
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
      schema: 1, valid: false, gradeable: false, reasons, hard: ["missing_root"], soft: [],
      candidate_sha256: "", fixture_protected_sha256: "", candidate_protected_sha256: "",
      fixture_files: [], candidate_files: [],
    };
  }

  const fixtureTree = readTree(fixture);
  const candidateTree = readTree(candidate);
  reasons.push(...fixtureTree.unsafe.map((reason) => `fixture ${reason}`));
  reasons.push(...candidateTree.unsafe.map((reason) => `candidate ${reason}`));
  if (fixtureTree.unsafe.length || candidateTree.unsafe.length) hard.add("unsafe_entry");
  if (existsSync(join(candidate, ".git"))) {
    reasons.push("candidate contains .git");
    hard.add("git_directory");
  }

  const fixtureSet = new Set(fixtureTree.files);
  const candidateSet = new Set(candidateTree.files);
  // A file the track lets the candidate add is part of its work, not an addition.
  const writable = new Set<string>([
    ...writablePathsForTrack(track),
    ...candidateTree.files.filter((path) => !fixtureSet.has(path) && isWritableForTrack(track, path)),
  ]);
  const missing = fixtureTree.files.filter((path) => !candidateSet.has(path));
  const added = candidateTree.files.filter((path) => !fixtureSet.has(path) && !writable.has(path));
  if (missing.length) {
    reasons.push(`candidate is missing fixture file(s): ${missing.join(", ")}`);
    soft.add("files_missing");
  }
  if (added.length) {
    reasons.push(`candidate adds file(s): ${added.join(", ")}`);
    soft.add("files_added");
  }
  if (track === "tests") {
    const testFiles = candidateTree.files.filter((path) => !fixtureSet.has(path) && TEST_FILE_PATTERN.test(path));
    const bytes = testFiles.reduce((sum, path) => sum + lstatSync(join(candidate, path)).size, 0);
    if (testFiles.length > TEST_FILE_LIMITS.files || bytes > TEST_FILE_LIMITS.bytes) {
      reasons.push(`candidate test files exceed ${TEST_FILE_LIMITS.files} files or ${TEST_FILE_LIMITS.bytes} bytes`);
      soft.add("test_limits");
    }
  }

  const fixtureProtected = protectedHashWith(fixture, fixtureTree.files, writable);
  for (const path of writable) {
    if (!/\.tsx?$/.test(path) || !candidateSet.has(path)) continue;
    try {
      if (/@ts-(?:nocheck|ignore|expect-error)\b/i.test(readFileSync(join(candidate, path), "utf8"))) {
        if (!soft.has("ts_suppression")) reasons.push("candidate contains a TypeScript compiler suppression");
        soft.add("ts_suppression");
      }
      if (!fixtureSet.has(path) || soft.has("surface_changed")) continue;
      const fixtureSurface = canonicalPublicSurface(join(fixture, path));
      const candidateSurface = canonicalPublicSurface(join(candidate, path));
      if (fixtureSurface.join("\u0000") !== candidateSurface.join("\u0000")) {
        reasons.push("candidate changed a writable public export or type signature", `public surface changed in ${path}`);
        soft.add("surface_changed");
      }
    } catch (error) {
      reasons.push("candidate public API inspection failed: " + (error instanceof Error ? error.message : String(error)));
      soft.add("surface_changed");
    }
  }
  const candidateProtected = protectedHashWith(candidate, candidateTree.files, writable);
  // Compare the protected files both trees hold. An added or a missing file has its
  // own class; counting it here too would charge one violation twice.
  const shared = fixtureTree.files.filter((path) => candidateSet.has(path));
  if (protectedHashWith(fixture, shared, writable) !== protectedHashWith(candidate, shared, writable)) {
    reasons.push("candidate modified protected fixture files");
    soft.add("protected_modified");
  }

  const softList = [...soft].sort();
  return {
    schema: 1,
    valid: reasons.length === 0,
    gradeable: hard.size === 0 && softList.every((violation) => GRADEABLE_SOFT_CLASSES.has(violation)),
    reasons,
    hard: [...hard].sort(),
    soft: softList,
    candidate_sha256: treeHash(candidate, candidateTree.files),
    fixture_protected_sha256: fixtureProtected,
    candidate_protected_sha256: candidateProtected,
    fixture_files: fixtureTree.files,
    candidate_files: candidateTree.files,
  };
}

/**
 * Build a gradeable candidate from a contract-violating one: a fresh copy of the
 * comparison root, then the original's regular writable files on top. Added
 * files and protected edits never reach the grader. Test files beyond the
 * track's limits are left out in sorted order. Returns the grafted paths.
 */
export function graftCandidate(root: string, original: string, dest: string, track: BenchTrack): string[] {
  const rootTree = readTree(resolve(root));
  rmSync(dest, { recursive: true, force: true });
  for (const rel of rootTree.files) {
    mkdirSync(dirname(join(dest, rel)), { recursive: true });
    copyFileSync(join(root, rel), join(dest, rel));
  }
  const grafted: string[] = [];
  let testFiles = 0;
  let testBytes = 0;
  const originalFiles = existsSync(original) ? readTree(resolve(original)).files : [];
  for (const rel of originalFiles) {
    if (!isWritableForTrack(track, rel)) continue;
    const source = join(original, rel);
    const stat = lstatSync(source);
    if (!stat.isFile()) continue;
    if (TEST_FILE_PATTERN.test(rel) && track === "tests") {
      if (testFiles + 1 > TEST_FILE_LIMITS.files || testBytes + stat.size > TEST_FILE_LIMITS.bytes) continue;
      testFiles += 1;
      testBytes += stat.size;
    }
    mkdirSync(dirname(join(dest, rel)), { recursive: true });
    copyFileSync(source, join(dest, rel));
    grafted.push(rel);
  }
  return grafted;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const trackFlagIndex = args.indexOf("--track");
  const track = resolveTrack(trackFlagIndex >= 0 ? args[trackFlagIndex + 1] : undefined);
  if (trackFlagIndex >= 0) {
    args.splice(trackFlagIndex, 2);
  }
  const [command, candidateRoot] = args;
  if (command === "--writable-paths") {
    console.log(writablePathsForTrack(track).join("\n"));
  } else if (command === "--graft") {
    const [, root, original, dest] = args;
    if (!root || !original || !dest) {
      throw new Error("usage: candidate-contract.ts --graft <root> <original> <dest> [--track t]");
    }
    console.log(JSON.stringify({ schema: 1, track, grafted: graftCandidate(root, original, dest, track) }, null, 2));
  } else {
    const fixtureRoot = command;
    if (!fixtureRoot || !candidateRoot) {
      throw new Error("usage: candidate-contract.ts <root> <candidate-root> [--track build|bugfix|tests|change]");
    }
    const contract = assessCandidateContract(fixtureRoot, candidateRoot, { track });
    console.log(JSON.stringify(contract, null, 2));
    // 0 clean; 3 soft violations inside writable files only (gradeable as is);
    // 5 soft violations a graft must remove first; 4 hard violations (invalid).
    process.exitCode = contract.valid ? 0 : contract.gradeable ? 3 : contract.hard.length === 0 ? 5 : 4;
  }
}
