import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  lstatSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Red tests for plan task 1.2: the page refresh (spec FR-3, Review A 5 F2).
 *
 * New contract: after the approval, `update.sh --docs <manifest>` rebuilds
 * the affected pages (`docs/index.html` and `docs/real-work.html`) through
 * `preview.sh` and `guide.ts`. The commit holds the two data files plus
 * those pages, staged by explicit path only. `docs/review.html` joins the
 * commit only when the score file changed. A rerun with unchanged data
 * exits 0 and makes no commit. An unrelated dirty file that is not an
 * affected page stays uncommitted.
 *
 * Every git action runs in a temp repo under the system temp folder. No
 * case reads or writes the real repo history, the real `docs/`, the real
 * export, the network, a model, or the private folder.
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
const DATA_DIR = join("docs", "assets", "data");
const REAL_WORK_JSON = "real-work.json";
const MODEL_GUIDE_JSON = "model-guide.json";
const MANIFEST_COPY = join("fixture-b", `MANIFEST-${DATE}.txt`);

const INDEX_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Overview</title>
<link rel="stylesheet" href="./assets/css/site.css"></head>
<body><nav><a href="./methodology.html">Methodology</a>
<a href="./results.html">Results</a><a href="./models/">Models</a>
<a href="./tracks.html">Tracks</a></nav>
<main><h1>Overview</h1></main></body></html>
`;
const METHODOLOGY_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Method</title></head>
<body><main><h1>Method</h1></main></body></html>
`;
const STALE_REAL_WORK_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Real work</title></head>
<body><main><h1>Stale real work page</h1></main></body></html>
`;
const SITE_CSS = "body { font-family: sans-serif; }\n";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `model-guide-pages-${tag}-`));
  roots.push(dir);
  return dir;
}

function env(): NodeJS.ProcessEnv {
  const copy = { ...process.env, NO_COLOR: "1", npm_config_loglevel: "silent" };
  copy.HOME = tempDir("home");
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

/** A synthetic track A score file: one complete route with three passes. */
function scoreDoc(): string {
  return `${JSON.stringify(
    {
      schema: "model-guide-review-scores/1",
      set_id: "mg-2026-11a",
      routes: [
        {
          route: "red-model",
          state: "complete",
          passes: [90.0, 91.0, 92.0].map((score, index) => ({
            date: `2026-11-1${index + 1}`,
            score,
            state: "complete",
          })),
        },
      ],
    },
    null,
    2,
  )}\n`;
}

/** A temp repo with docs pages, data files, and the export pair. */
function updateRepo(tag: string, withScores: boolean): { root: string; manifest: string } {
  const root = tempDir(tag);
  mkdirSync(join(root, "harness"), { recursive: true });
  cpSync(SOURCE, join(root, "harness", "model-guide"), { recursive: true });
  mkdirSync(join(root, "docs", "assets", "css"), { recursive: true });
  mkdirSync(join(root, "docs", "assets", "data"), { recursive: true });
  writeFileSync(join(root, "docs", "index.html"), INDEX_HTML);
  writeFileSync(join(root, "docs", "methodology.html"), METHODOLOGY_HTML);
  writeFileSync(join(root, "docs", "real-work.html"), STALE_REAL_WORK_HTML);
  writeFileSync(join(root, "docs", "assets", "css", "site.css"), SITE_CSS);
  copyFileSync(BENCHMARK, join(root, DATA_DIR, "benchmark.json"));
  copyFileSync(TRACKS, join(root, DATA_DIR, "tracks.json"));
  mkdirSync(join(root, "harness", "model-guide", "data"), { recursive: true });
  copyFileSync(
    printAuditData(tag),
    join(root, "harness", "model-guide", "data", "print-audit-2026-11.json"),
  );
  if (withScores) {
    const scoresDir = join(root, "harness", "model-guide", "data", "review-scores");
    mkdirSync(scoresDir, { recursive: true });
    writeFileSync(join(scoresDir, "mg-2026-11a.json"), scoreDoc());
  }
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
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "initial"]);
  expect(git(root, ["status", "--short"]), "the temp repo starts clean").toBe("");
  return { root, manifest: join(root, MANIFEST_COPY) };
}

/** The stable approval record: a copy of the archived record. */
function approve(root: string): void {
  const dest = join(root, "harness", "model-guide", "publish-approval.md");
  copyFileSync(ARCHIVED_APPROVAL, dest);
  git(root, ["add", dest]);
  git(root, ["commit", "-q", "-m", "approval record"]);
}

function runDocsUpdate(root: string, manifest: string) {
  return spawnSync(
    "bash",
    [join(root, "harness", "model-guide", "update.sh"), "--docs", manifest],
    { cwd: root, env: env(), encoding: "utf8", timeout: 180_000 },
  );
}

function commitPaths(root: string): string[] {
  return git(root, ["show", "--name-only", "--format=", "HEAD"])
    .split("\n").filter(Boolean).sort();
}

const DATA_PATHS = [
  join(DATA_DIR, MODEL_GUIDE_JSON),
  join(DATA_DIR, REAL_WORK_JSON),
].sort();
const PAGE_PATHS = [join("docs", "index.html"), join("docs", "real-work.html")].sort();

describe("the weekly update page refresh (spec FR-3)", () => {
  it("P1: the approved run commits the two data files plus index.html and real-work.html", () => {
    const { root, manifest } = updateRepo("pages-commit", false);
    approve(root);
    const commits = git(root, ["rev-list", "--count", "HEAD"]);

    const result = runDocsUpdate(root, manifest);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

    expect(commitPaths(root), "the commit holds the data files plus the rebuilt pages").toEqual(
      [...DATA_PATHS, ...PAGE_PATHS].sort(),
    );
    expect(git(root, ["rev-list", "--count", "HEAD"])).toBe(String(Number(commits) + 1));
  });

  it("P2a: with a changed score file docs/review.html joins the commit", () => {
    const { root, manifest } = updateRepo("pages-review", true);
    approve(root);

    const result = runDocsUpdate(root, manifest);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

    expect(existsSync(join(root, "docs", "review.html")), "review.html is rebuilt").toBe(true);
    const committed = commitPaths(root);
    for (const path of [...DATA_PATHS, ...PAGE_PATHS, join("docs", "review.html")]) {
      expect(committed, `the commit holds ${path}`).toContain(path);
    }
  });

  it("P2b: with no score file docs/review.html stays out of the commit", () => {
    const { root, manifest } = updateRepo("pages-no-review", false);
    approve(root);

    const result = runDocsUpdate(root, manifest);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

    expect(existsSync(join(root, "docs", "review.html")), "no review.html appears").toBe(false);
    expect(commitPaths(root), "review.html is out of the commit").toEqual(
      [...DATA_PATHS, ...PAGE_PATHS].sort(),
    );
  });

  it("P3: the rebuild runs through preview.sh and guide.ts, so fixture data reaches the pages", () => {
    const { root, manifest } = updateRepo("pages-marker", false);
    approve(root);

    const result = runDocsUpdate(root, manifest);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

    const index = readFileSync(join(root, "docs", "index.html"), "utf8");
    expect(index, "the overview section from guide.ts output is in index.html").toContain(
      'id="model-guide"',
    );
    const realWork = readFileSync(join(root, "docs", "real-work.html"), "utf8");
    expect(realWork, "the stale page body is gone").not.toContain("Stale real work page");
    expect(realWork, "the export date from the fixture manifest is on the page").toContain(DATE);
  });

  it("P4: a rerun with unchanged data exits 0 and makes no commit", () => {
    const { root, manifest } = updateRepo("pages-rerun", false);
    approve(root);

    const first = runDocsUpdate(root, manifest);
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
    const commits = git(root, ["rev-list", "--count", "HEAD"]);

    const second = runDocsUpdate(root, manifest);
    expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(0);
    expect(git(root, ["rev-list", "--count", "HEAD"]), "no second commit").toBe(commits);
    expect(git(root, ["status", "--short"]), "the rerun leaves a clean tree").toBe("");
  });

  it("P5: staging uses explicit paths, so an unrelated dirty file stays uncommitted", () => {
    const { root, manifest } = updateRepo("pages-explicit", false);
    approve(root);
    writeFileSync(
      join(root, "docs", "methodology.html"),
      `${METHODOLOGY_HTML}<!-- dirty, not for this commit -->\n`,
    );
    expect(git(root, ["status", "--short"])).toContain("docs/methodology.html");

    const result = runDocsUpdate(root, manifest);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

    expect(commitPaths(root), "the unrelated file stays out of the commit").toEqual(
      [...DATA_PATHS, ...PAGE_PATHS].sort(),
    );
    expect(git(root, ["status", "--short"])).toBe(" M docs/methodology.html");
  });
});
