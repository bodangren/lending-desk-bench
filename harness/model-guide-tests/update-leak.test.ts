import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Red tests for plan task 1.3: the leak check (spec FR-4, Review B 5 F1).
 *
 * New contract: `update.sh --docs` runs `leak-check.ts` over exactly the
 * candidate files of the commit, using the private input named by
 * `MODEL_GUIDE_PRIVATE_DIR` (default: the real location). A hit in a
 * candidate refuses with one line, exit 2, and no commit:
 * `update: leak <path>`. The raw `leak-check:` finding never reaches
 * stdout. A hit in an unrelated file outside the commit does not refuse.
 * A missing private input on `--docs` refuses with one named line instead
 * of a silent empty scan. A clean commit set passes and commits.
 *
 * A hit reaches a candidate through the score chain: the test plants the
 * marker in the synthetic score file, `preview.sh` copies it to
 * `review.json`, and the weekly job commits that copy. Key-field plants
 * need no private content, but every run gets a synthetic seeded private
 * input by default; cases that exercise a missing or empty private input
 * set their own. Every git action runs in a temp repo under the system
 * temp folder. No case reads the network, a model, the real private
 * folder, or the real repo history.
 */

const HARNESS = resolve(import.meta.dirname, "..");
const ROOT = resolve(HARNESS, "..");
const SOURCE = join(HARNESS, "model-guide");
const FIXTURES = join(import.meta.dirname, "fixtures");
const PAGE_B = join(FIXTURES, "page-b");
const PRINT_AUDIT_DIR = join(FIXTURES, "print-audit");
const GUIDE_FIXTURES = join(FIXTURES, "guide");
const BENCHMARK = join(GUIDE_FIXTURES, "benchmark-mini.json");
const TRACKS = join(GUIDE_FIXTURES, "tracks-mini.json");
const ARCHIVED_APPROVAL = join(
  ROOT, "measure", "archive", "model_guide", "publish-approval.md",
);
const DATE = "2026-10-20";
const OUTCOMES_NAME = `ra-outcomes-${DATE}.json`;
const AA_NAME = `aa-reliability-${DATE}.json`;
const ALLOWED_NAME = `allowed-routes-${DATE}.json`;
const MANIFEST_NAME = `MANIFEST-${DATE}.txt`;
const MANIFEST_COPY = join("fixture-b", `MANIFEST-${DATE}.txt`);

const INDEX_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Overview</title>
<link rel="stylesheet" href="./assets/css/site.css"></head>
<body><nav><a href="./methodology.html">Methodology</a>
<a href="./results.html">Results</a><a href="./models/">Models</a>
<a href="./tracks.html">Tracks</a></nav>
<main><h1>Overview</h1></main></body></html>
`;
const SITE_CSS = "body { font-family: sans-serif; }\n";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `model-guide-leak-${tag}-`));
  roots.push(dir);
  return dir;
}

function env(): NodeJS.ProcessEnv {
  const copy = { ...process.env, NO_COLOR: "1", npm_config_loglevel: "silent" };
  copy.HOME = tempDir("home");
  copy.MODEL_GUIDE_PRIVATE_DIR = seededPrivateDir("default", "  synthetic default seed line one;");
  delete copy.BENCH_TRACK;
  return copy;
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function manifestShaOf(file: string): string {
  const match = readFileSync(file, "utf8").match(/^sha256: ([0-9a-f]{64})$/m);
  if (!match) throw new Error(`no sha256 line in ${file}`);
  return match[1];
}

function git(root: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: root, env: env(), encoding: "utf8", timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${result.stderr || result.stdout}`);
  }
  return result.stdout.replace(/\s+$/, "");
}

function printAuditData(tag: string): string {
  const handoff = JSON.parse(
    readFileSync(join(PRINT_AUDIT_DIR, "print-audit-mini.json"), "utf8"),
  );
  const dir = tempDir(`print-audit-${tag}`);
  const routes: Record<string, string> = {};
  for (const [key, name] of Object.entries<any>(handoff.routes)) {
    routes[name] = `${handoff.summary[key].blockers_found} of ${handoff.summary.key.blockers}`;
  }
  const doc = {
    schema: "model-guide-print-audit/1",
    source: { sha256: manifestShaOf(join(PRINT_AUDIT_DIR, "MANIFEST.txt")) },
    totals: {
      errors: handoff.errors.length,
      blockers: handoff.errors.filter((row: any) => row.severity === "blocker").length,
    },
    routes,
    summary: handoff.summary,
    note: handoff.note,
  };
  const file = join(dir, "print-audit-2026-11.json");
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  return file;
}

/** A temp repo with the stable approval record committed. */
function updateRepo(tag: string): { root: string; manifest: string } {
  const root = tempDir(tag);
  mkdirSync(join(root, "harness"), { recursive: true });
  cpSync(SOURCE, join(root, "harness", "model-guide"), {
    recursive: true,
    // The real approval record stays out of every fixture; a case that
    // needs consent writes its own record after the copy.
    filter: (source) => !source.endsWith("publish-approval.md"),
  });
  mkdirSync(join(root, "docs", "assets", "css"), { recursive: true });
  mkdirSync(join(root, "docs", "assets", "data"), { recursive: true });
  writeFileSync(join(root, "docs", "index.html"), INDEX_HTML);
  writeFileSync(join(root, "docs", "assets", "css", "site.css"), SITE_CSS);
  copyFileSync(BENCHMARK, join(root, "docs", "assets", "data", "benchmark.json"));
  copyFileSync(TRACKS, join(root, "docs", "assets", "data", "tracks.json"));
  mkdirSync(join(root, "harness", "model-guide", "data"), { recursive: true });
  copyFileSync(
    printAuditData(tag),
    join(root, "harness", "model-guide", "data", "print-audit-2026-11.json"),
  );
  mkdirSync(join(root, "fixture-b"), { recursive: true });
  for (const name of [OUTCOMES_NAME, AA_NAME, ALLOWED_NAME, MANIFEST_NAME]) {
    copyFileSync(join(PAGE_B, name), join(root, "fixture-b", name));
  }
  symlinkSync(join(HARNESS, "node_modules"), join(root, "harness", "node_modules"));
  writeFileSync(
    join(root, ".gitignore"),
    `${readFileSync(join(HARNESS, "..", ".gitignore"), "utf8")}\nharness/node_modules\n`,
  );
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "model-guide-update@example.invalid"]);
  git(root, ["config", "user.name", "Model Guide Update Test"]);
  copyFileSync(ARCHIVED_APPROVAL, join(root, "harness", "model-guide", "publish-approval.md"));
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "initial"]);
  expect(git(root, ["status", "--short"]), "the temp repo starts clean").toBe("");
  return { root, manifest: join(root, MANIFEST_COPY) };
}

function runDocsUpdate(root: string, manifest: string, privateDir?: string) {
  const runEnv = env();
  if (privateDir !== undefined) runEnv.MODEL_GUIDE_PRIVATE_DIR = privateDir;
  return spawnSync(
    "bash",
    [join(root, "harness", "model-guide", "update.sh"), "--docs", manifest],
    { cwd: root, env: runEnv, encoding: "utf8", timeout: 180_000 },
  );
}

/** A synthetic score file with one complete route plus extra top-level
 * fields. The tools ignore the extras; the weekly job copies them into
 * the committed review.json byte for byte. */
function scoreWith(extra: Record<string, unknown>): string {
  return `${JSON.stringify(
    {
      schema: "model-guide-review-scores/1",
      set_id: "mg-2026-11a",
      routes: [
        {
          route: "leak-model",
          state: "complete",
          passes: [90.0, 91.0, 92.0].map((score, index) => ({
            date: `2026-11-1${index + 1}`,
            score,
            state: "complete",
          })),
        },
      ],
      ...extra,
    },
    null,
    2,
  )}\n`;
}

function writeScore(root: string, text: string): void {
  const dir = join(root, "harness", "model-guide", "data", "review-scores");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "mg-2026-11a.json"), text);
}

/** A synthetic private input with one seeded line: the diffs file holds
 * the line, the source file does not. */
function seededPrivateDir(tag: string, seeded: string): string {
  const dir = tempDir(`private-${tag}`);
  const set = join(dir, "sets", "mg-2026-11a");
  mkdirSync(join(set, "diffs"), { recursive: true });
  mkdirSync(join(set, "src"), { recursive: true });
  writeFileSync(join(set, "diffs", "seed-01.diff"), `@@ -1,1 +1,1 @@\nL1 +${seeded}\n`);
  writeFileSync(
    join(set, "src", "seed-01.diff"),
    "@@ -1,1 +1,1 @@\nL1 -  const different base content;\n",
  );
  return dir;
}

/** SHA-256 of every file of the temp tree: a refused run must leave the
 * repo byte-identical, including docs/. */
function treeHashes(root: string): Record<string, string> {
  const hidden = [".git", "harness/node_modules"];
  const out: Record<string, string> = {};
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const path = rel ? `${rel}/${name}` : name;
      if (hidden.some((item) => path === item || path.startsWith(`${item}/`))) continue;
      const info = lstatSync(full);
      if (info.isDirectory()) walk(full, path);
      else out[path] = sha256(full);
    }
  };
  walk(root, "");
  return out;
}

function expectLeakRefusal(
  result: { status: number | null; stdout: string; stderr: string },
  root: string,
  commits: string,
): void {
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
  expect(result.stdout, "the raw leak-check line never reaches stdout").not.toContain(
    "leak-check:",
  );
  const lines = result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  expect(lines, `one refusal line, got: ${result.stdout}`).toHaveLength(1);
  expect(lines[0], "the line is the update leak refusal").toMatch(/^update: leak \S+$/);
  expect(git(root, ["rev-list", "--count", "HEAD"]), "no commit on a leak hit").toBe(commits);
}

describe("the weekly update leak check (spec FR-4)", () => {
  it("L1: a new_lines key in a candidate file refuses with one line, exit 2, and leaves docs/ byte-identical with no commit", () => {
    const { root, manifest } = updateRepo("leak-new-lines");
    writeScore(root, scoreWith({ new_lines: ["seeded-by-red-test"] }));
    const before = treeHashes(root);
    const commits = git(root, ["rev-list", "--count", "HEAD"]);

    const result = runDocsUpdate(root, manifest);
    expectLeakRefusal(result, root, commits);
    expect(treeHashes(root), "a refused run leaves docs/ byte-identical").toEqual(before);
  });

  it("L2: a private-path string in a candidate file refuses without the raw finding and without a commit", () => {
    const { root, manifest } = updateRepo("leak-private-path");
    const priv = seededPrivateDir("leak-private-path", "  synthetic private path seed line;");
    writeScore(root, scoreWith({ note: priv }));
    const commits = git(root, ["rev-list", "--count", "HEAD"]);

    const result = runDocsUpdate(root, manifest, priv);
    expectLeakRefusal(result, root, commits);
  });

  it("L3: a clean commit set passes the check and commits", () => {
    const { root, manifest } = updateRepo("leak-clean");
    const commits = git(root, ["rev-list", "--count", "HEAD"]);

    const result = runDocsUpdate(root, manifest);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(git(root, ["rev-list", "--count", "HEAD"])).toBe(String(Number(commits) + 1));
  });

  it("L4: a hit in a staged file outside the commit does not refuse", () => {
    const { root, manifest } = updateRepo("leak-staged");
    writeFileSync(
      join(root, "docs", "staged-leak.json"),
      `${JSON.stringify({ operator: "seeded-by-red-test" }, null, 2)}\n`,
    );
    git(root, ["add", join("docs", "staged-leak.json")]);
    const commits = git(root, ["rev-list", "--count", "HEAD"]);

    const result = runDocsUpdate(root, manifest);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(git(root, ["rev-list", "--count", "HEAD"])).toBe(String(Number(commits) + 1));
    const committed = git(root, ["show", "--name-only", "--format=", "HEAD"]);
    expect(committed, "the unrelated file stays out of the commit").not.toContain(
      join("docs", "staged-leak.json"),
    );
  });

  it("F4a: the scan uses the env private input, so a seeded line in a candidate refuses", () => {
    const seeded = "  const seeded leak marker one;";
    const priv = seededPrivateDir("f4a", seeded);
    const { root, manifest } = updateRepo("leak-seeded");
    writeScore(root, scoreWith({ note: seeded }));
    const commits = git(root, ["rev-list", "--count", "HEAD"]);

    const result = runDocsUpdate(root, manifest, priv);
    expectLeakRefusal(result, root, commits);
  });

  it("F4b: a missing private input on --docs refuses with a named line and no write or commit", () => {
    const { root, manifest } = updateRepo("leak-no-private");
    const missing = join(tempDir("private-missing"), "no-such-dir");
    const before = treeHashes(root);
    const commits = git(root, ["rev-list", "--count", "HEAD"]);

    const result = runDocsUpdate(root, manifest, missing);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout, "the named private-input refusal on stdout").toBe(
      "update: no private input\n",
    );
    expect(treeHashes(root), "no file of the repo changes").toEqual(before);
    expect(git(root, ["rev-list", "--count", "HEAD"])).toBe(commits);
  });
});
