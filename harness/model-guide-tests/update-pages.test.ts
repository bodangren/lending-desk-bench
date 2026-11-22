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
 * commit only when the score file changed. A missing review template
 * with a changed score refuses before any write or commit. A rerun with
 * unchanged data
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
  copy.MODEL_GUIDE_PRIVATE_DIR = seededPrivate("default");
  delete copy.BENCH_TRACK;
  return copy;
}

/** A synthetic private input of the shape leak-check.ts reads: one set
 * with one seeded line of 20 characters or more that the source diff
 * does not hold. The line is synthetic and appears in no fixture. */
function seededPrivate(tag: string): string {
  const dir = tempDir(`private-${tag}`);
  const set = join(dir, "sets", "mg-2026-11a");
  mkdirSync(join(set, "diffs"), { recursive: true });
  mkdirSync(join(set, "src"), { recursive: true });
  writeFileSync(join(set, "diffs", "seed-01.diff"), `@@ -1,1 +1,1 @@\nL1 +  synthetic ${tag} seed line one;\n`);
  writeFileSync(join(set, "src", "seed-01.diff"), "@@ -1,1 +1,1 @@\nL1 -  synthetic base content only;\n");
  return dir;
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

/** A complete-route score: the published baseline shape. */
function scoreComplete(): string {
  return `${JSON.stringify(
    {
      schema: "model-guide-review-scores/1",
      set_id: "mg-2026-11a",
      routes: [
        {
          route: "s1-model",
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

/** A second complete-route score with a different route. */
function scoreCompleteTwo(): string {
  return `${JSON.stringify(
    {
      schema: "model-guide-review-scores/1",
      set_id: "mg-2026-11a",
      routes: [
        {
          route: "s2-model",
          state: "complete",
          passes: [88.0, 89.0, 90.0].map((score, index) => ({
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

/** A changed incomplete-route score: one pass, no rank. */
function scoreIncomplete(): string {
  return `${JSON.stringify(
    {
      schema: "model-guide-review-scores/1",
      set_id: "mg-2026-11a",
      routes: [
        {
          route: "s2-model",
          state: "incomplete",
          passes: [
            {
              date: "2026-11-12",
              score: 78.6,
              state: "complete",
              false_claims: 0,
              real_defects: 0,
            },
          ],
        },
      ],
    },
    null,
    2,
  )}\n`;
}

function scoresDirOf(root: string): string {
  const dir = join(root, "harness", "model-guide", "data", "review-scores");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** SHA-256 of every file of the temp tree, used to prove a refused run
 * changes nothing. */
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
/** The six docs files a weekly run may change. */
const SIX_DOCS_FILES = [
  join(DATA_DIR, "real-work.json"),
  join(DATA_DIR, "model-guide.json"),
  join(DATA_DIR, "review.json"),
  join("docs", "index.html"),
  join("docs", "real-work.html"),
  join("docs", "review.html"),
];

/** The current bytes of the six docs files, null when a file is absent. */
function docsBytes(root: string): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const rel of SIX_DOCS_FILES) {
    const full = join(root, rel);
    out[rel] = existsSync(full) ? readFileSync(full, "utf8") : null;
  }
  return out;
}
/** A temp repo with docs pages, data files, and the export pair. */
function updateRepo(tag: string, withScores: boolean): { root: string; manifest: string } {
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

  it("F2a: a changed incomplete score file rebuilds review.html and review.json with the new rendering", () => {
    const { root, manifest } = updateRepo("pages-changed-score", false);
    approve(root);
    const scoreFile = join(scoresDirOf(root), "mg-2026-11a.json");
    writeFileSync(scoreFile, scoreComplete());
    const first = runDocsUpdate(root, manifest);
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
    // The published baseline: the rendered page from the first run plus
    // the score data the fixed weekly job commits beside it.
    copyFileSync(scoreFile, join(root, DATA_DIR, "review.json"));
    git(root, ["add", join(DATA_DIR, "review.json")]);
    if (git(root, ["status", "--short"]) !== "") {
      git(root, ["commit", "-q", "-m", "published score baseline"]);
    }
    // The score changes to an incomplete route set.
    writeFileSync(scoreFile, scoreIncomplete());
    const changed = scoreIncomplete();
    const beforeBytes = docsBytes(root);

    const result = runDocsUpdate(root, manifest);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

    const review = readFileSync(join(root, "docs", "review.html"), "utf8");
    expect(review, "the rebuilt page shows the new incomplete route").toContain("s2-model");
    expect(review, "the rebuilt page shows the incomplete mark").toContain(
      "incomplete: 1 of 3 passes",
    );
    expect(review, "the rebuilt page shows the new worst score").toContain("78.6");
    expect(review, "the old rendering is gone").not.toContain("s1-model");
    expect(
      readFileSync(join(root, DATA_DIR, "review.json"), "utf8"),
      "review.json is byte-equal to the consumed score",
    ).toBe(changed);
    // The commit holds exactly the files whose bytes changed, measured
    // from the six docs files instead of a hard-coded set: git never
    // lists unchanged paths, and a no-op rerun must commit nothing.
    const afterBytes = docsBytes(root);
    const changedPaths = SIX_DOCS_FILES.filter((path) => beforeBytes[path] !== afterBytes[path]);
    expect(changedPaths, "the changed review outputs rebuilt").toEqual(
      expect.arrayContaining([join("docs", "review.html"), join(DATA_DIR, "review.json")]),
    );
    expect(commitPaths(root), "the commit holds exactly the changed files").toEqual(
      [...changedPaths].sort(),
    );
  });

  it("F2b: an unchanged complete score file leaves the published review page alone", () => {
    const { root, manifest } = updateRepo("pages-same-score", false);
    approve(root);
    const scoreFile = join(scoresDirOf(root), "mg-2026-11a.json");
    const score = scoreComplete();
    writeFileSync(scoreFile, score);
    // Publish the rendered page through the preview path, then mark it.
    const previewTmp = tempDir("preview-baseline");
    const built = spawnSync(
      "bash",
      [join(root, "harness", "model-guide", "preview.sh"), "--manifest", manifest, "--preview", previewTmp],
      { cwd: root, env: env(), encoding: "utf8", timeout: 180_000 },
    );
    expect(built.status, `${built.stdout}\n${built.stderr}`).toBe(0);
    const published = `${readFileSync(join(previewTmp, "review.html"), "utf8")}<!-- published-baseline -->\n`;
    writeFileSync(join(root, "docs", "review.html"), published);
    copyFileSync(scoreFile, join(root, DATA_DIR, "review.json"));
    git(root, ["add", scoreFile, join("docs", "review.html"), join(DATA_DIR, "review.json")]);
    git(root, ["commit", "-q", "-m", "published baseline"]);

    const result = runDocsUpdate(root, manifest);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

    expect(
      readFileSync(join(root, "docs", "review.html"), "utf8"),
      "the published page is not rebuilt",
    ).toBe(published);
    expect(
      readFileSync(join(root, DATA_DIR, "review.json"), "utf8"),
      "the published score data is untouched",
    ).toBe(score);
    expect(commitPaths(root), "the review outputs stay out of the commit").toEqual(
      [...DATA_PATHS, ...PAGE_PATHS].sort(),
    );
    expect(git(root, ["status", "--short"]), "the tree is clean").toBe("");
  });

  it("F7: a missing overview template refuses before any commit", () => {
    const { root, manifest } = updateRepo("pages-no-overview", false);
    approve(root);
    rmSync(join(root, "harness", "model-guide", "pages", "guide-section.html"));
    const before = treeHashes(root);
    const commits = git(root, ["rev-list", "--count", "HEAD"]);

    const result = runDocsUpdate(root, manifest);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(treeHashes(root), "no file of the repo changes").toEqual(before);
    expect(git(root, ["rev-list", "--count", "HEAD"]), "no commit").toBe(commits);
  });

  it("F15: a missing review template with a changed score refuses before any commit", () => {
    const { root, manifest } = updateRepo("pages-no-review-template", false);
    approve(root);
    const scoreFile = join(scoresDirOf(root), "mg-2026-11a.json");
    writeFileSync(scoreFile, scoreComplete());
    const first = runDocsUpdate(root, manifest);
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
    // The published baseline: the rendered page from the first run plus
    // the score data the fixed weekly job commits beside it.
    copyFileSync(scoreFile, join(root, DATA_DIR, "review.json"));
    git(root, ["add", join(DATA_DIR, "review.json")]);
    if (git(root, ["status", "--short"]) !== "") {
      git(root, ["commit", "-q", "-m", "published score baseline"]);
    }
    // The score changes to a second complete route set, and the review
    // template goes missing: the preview keeps the stale page, so the
    // weekly job must refuse instead of publishing fresh score data
    // beside a stale public page.
    writeFileSync(scoreFile, scoreCompleteTwo());
    rmSync(join(root, "harness", "model-guide", "pages", "review.html"));
    const before = treeHashes(root);
    const commits = git(root, ["rev-list", "--count", "HEAD"]);

    const result = runDocsUpdate(root, manifest);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(treeHashes(root), "no file of the repo changes").toEqual(before);
    expect(git(root, ["rev-list", "--count", "HEAD"]), "no commit").toBe(commits);
  });

  it("F9a: a commit prints one update: committed line per committed path", () => {
    const { root, manifest } = updateRepo("pages-log", false);
    approve(root);

    const result = runDocsUpdate(root, manifest);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

    const lines = result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
    expect(lines).toEqual(
      [...DATA_PATHS, ...PAGE_PATHS].sort().map((path) => `update: committed ${path}`),
    );
  });

  it("F9b: a no-op prints update: no change and exits 0", () => {
    const { root, manifest } = updateRepo("pages-noop", false);
    approve(root);

    const first = runDocsUpdate(root, manifest);
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
    const commits = git(root, ["rev-list", "--count", "HEAD"]);

    const second = runDocsUpdate(root, manifest);
    expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(0);
    expect(second.stdout, "the no-op line").toBe("update: no change\n");
    expect(git(root, ["rev-list", "--count", "HEAD"]), "no commit").toBe(commits);
  });
});
