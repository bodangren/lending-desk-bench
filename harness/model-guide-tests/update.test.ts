import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Red tests for plan task 2.3: the weekly update of spec D19, D21. They
 * call the planned script `harness/model-guide/update.sh`.
 *
 * Pinned command line (spec D19):
 *   bash harness/model-guide/update.sh <export file>
 * run with cwd `<repo>`. `<repo>` is three levels above the script, the
 * same rule as `preview.sh`. The script runs the tools with cwd
 * `<repo>/harness`. The default preview folder is
 * `<repo>/.tmp/model-guide-preview`. The script writes no file outside the
 * preview folder and outside `docs/assets/data/`, and it writes no file
 * under `docs/` before the approval (spec D21).
 *
 * Approval gate: the file `<repo>/measure/tracks/model_guide/publish-approval.md`
 * (the record of spec D21). The gate is the existence of that file. The
 * script reads no field of the record.
 *
 * Before the approval (exit 0):
 *   - `real-work.json` and `model-guide.json` are written into the preview
 *     folder only. Every other file of the repo keeps its SHA-256, no file
 *     appears under `docs/`, and no commit runs.
 * After the approval (exit 0):
 *   - the same two data files are written into `<repo>/docs/assets/data/`.
 *   - one `git commit` runs and holds exactly these two paths:
 *       docs/assets/data/real-work.json
 *       docs/assets/data/model-guide.json
 *     It holds no other path. An unrelated dirty file of `docs/` stays
 *     uncommitted and stays dirty. The temp repo of this test has no
 *     remote, so a `git push` would fail the run.
 * A failed input check (exit 2):
 *   - one named `input-check:` line on stdout, and no file of the repo
 *     changes: no `docs/` write, no new preview folder, no commit.
 *
 * Output contract read by these tests (the public data contract of the
 * strategy, section 5, and the pin of `guide.ts` in red-p2-b1dcd24.log):
 *   `<folder>/real-work.json`  schema `model-guide-real-work/1`, and the
 *                             export `generated_on` 2026-11-14.
 *   `<folder>/model-guide.json` schema `model-guide-overview/1` with the
 *                             six rows of spec D18 in order. Only the
 *                             date-independent fields are read here; the
 *                             date and stale fields belong to guide.test.ts.
 *
 * Every git action runs in a temp repo under the system temp folder. No
 * case reads or writes the real repo history, the real `docs/`, the real
 * export, the real hand-off file, the network, a model, or the private
 * folder. All fixtures are synthetic and reused from `fixtures/`: this
 * file adds no fixture folder.
 */

const HARNESS = resolve(import.meta.dirname, "..");
const SOURCE = join(HARNESS, "model-guide");
const UPDATE_SH = join(SOURCE, "update.sh");
const REAL_WORK_TOOL = join(SOURCE, "real-work.ts");
const GUIDE_TOOL = join(SOURCE, "guide.ts");
const FIXTURES = join(import.meta.dirname, "fixtures");
const EXPORT_FIXTURE = join(FIXTURES, "real-work-mini.json");
const MANIFEST_FIXTURE = join(FIXTURES, "MANIFEST.txt");
const PRINT_AUDIT_DIR = join(FIXTURES, "print-audit");
const GUIDE_FIXTURES = join(FIXTURES, "guide");
const BENCHMARK = join(GUIDE_FIXTURES, "benchmark-mini.json");
const TRACKS = join(GUIDE_FIXTURES, "tracks-mini.json");

const KINDS = [
  "Code review",
  "app code",
  "test writing",
  "docs and ops",
  "print-book audit",
  "tooling",
];
const DATA_DIR = join("docs", "assets", "data");
const REAL_WORK_JSON = "real-work.json";
const MODEL_GUIDE_JSON = "model-guide.json";
const APPROVAL = join("measure", "tracks", "model_guide", "publish-approval.md");
const PREVIEW_DIR = join(".tmp", "model-guide-preview");
const EXPORT_COPY = join("fixture", "real-work-mini.json");
const MANIFEST_COPY = join("fixture", "MANIFEST.txt");

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
  const dir = mkdtempSync(join(tmpdir(), `model-guide-update-${tag}-`));
  roots.push(dir);
  return dir;
}

function requireProduction(): void {
  if (!existsSync(UPDATE_SH)) {
    throw new Error(
      `production file is missing: ${UPDATE_SH} (Phase 2 has no weekly update script yet)`,
    );
  }
  if (!existsSync(REAL_WORK_TOOL)) throw new Error(`missing: ${REAL_WORK_TOOL}`);
  if (!existsSync(GUIDE_TOOL)) throw new Error(`missing: ${GUIDE_TOOL}`);
}

function env(): NodeJS.ProcessEnv {
  const copy = { ...process.env, NO_COLOR: "1", npm_config_loglevel: "silent" };
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

/** One git command. It always acts on the temp repo that the caller passes. */
function git(root: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: root, env: env(), encoding: "utf8", timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${result.stderr || result.stdout}`);
  }
  return result.stdout.replace(/\s+$/, "");
}

/** SHA-256 of every file of the temp tree, keyed by the relative path.
 * `.git` and the `harness/node_modules` link are never read, so a change
 * inside them cannot move a verdict (A13). `skip` hides a folder that the
 * run is allowed to write. */
function treeHashes(root: string, skip: string[] = []): Record<string, string> {
  const hidden = [".git", "harness/node_modules", ...skip];
  const out: Record<string, string> = {};
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const path = rel ? `${rel}/${name}` : name;
      if (hidden.some((item) => path === item || path.startsWith(`${item}/`))) continue;
      const info = lstatSync(full);
      if (info.isDirectory()) walk(full, path);
      else if (info.isSymbolicLink()) out[path] = `link:${readlinkSync(full)}`;
      else out[path] = sha256(full);
    }
  };
  walk(root, "");
  return out;
}

/** The print-audit data file of task 2.1, assembled from the synthetic
 * hand-off fixture (the real OD6 key shape, task 2.4a): a route maps a
 * short key to a route name, and its result is `blockers_found` over
 * `summary.key.blockers`. Route results are "x of y" strings, no book
 * content. */
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

/** A temp repo that mirrors the real layout: docs/, the model-guide folder
 * with the synthetic print-audit data file, the base-line data files, the
 * fixture export pair, an approval folder, a `.gitignore`, and one initial
 * commit. Every git command of this file runs inside it. */
function updateRepo(tag: string): { root: string; exportPath: string } {
  requireProduction();
  const root = tempDir(tag);
  mkdirSync(join(root, "harness"), { recursive: true });
  cpSync(SOURCE, join(root, "harness", "model-guide"), { recursive: true });
  mkdirSync(join(root, "docs", "assets", "css"), { recursive: true });
  mkdirSync(join(root, "docs", "assets", "data"), { recursive: true });
  writeFileSync(join(root, "docs", "index.html"), INDEX_HTML);
  writeFileSync(join(root, "docs", "assets", "css", "site.css"), SITE_CSS);
  copyFileSync(BENCHMARK, join(root, DATA_DIR, "benchmark.json"));
  copyFileSync(TRACKS, join(root, DATA_DIR, "tracks.json"));
  mkdirSync(join(root, "harness", "model-guide", "data"), { recursive: true });
  copyFileSync(
    printAuditData(tag),
    join(root, "harness", "model-guide", "data", "print-audit-2026-11.json"),
  );
  mkdirSync(join(root, "measure", "tracks", "model_guide"), { recursive: true });
  mkdirSync(join(root, "fixture"), { recursive: true });
  copyFileSync(EXPORT_FIXTURE, join(root, EXPORT_COPY));
  copyFileSync(MANIFEST_FIXTURE, join(root, MANIFEST_COPY));
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
  expect(git(root, ["remote"]), "the temp repo has no remote").toBe("");
  return { root, exportPath: join(root, EXPORT_COPY) };
}

/** The approval record of spec D21. The gate is its existence. The helper
 * commits the record, so the record itself is clean before the run and the
 * status that a refused or an approved run must leave holds only the files
 * of the case. */
function approve(root: string): void {
  writeFileSync(join(root, APPROVAL), ["approved_by: Daniel", "date: 2026-11-15", ""].join("\n"));
  git(root, ["add", APPROVAL]);
  git(root, ["commit", "-q", "-m", "approval record"]);
}

function runUpdate(root: string, exportPath: string) {
  return spawnSync(
    "bash",
    [join(root, "harness", "model-guide", "update.sh"), exportPath],
    { cwd: root, env: env(), encoding: "utf8", timeout: 180_000 },
  );
}

function dataFile(root: string, name: string): any {
  const file = join(root, DATA_DIR, name);
  expect(existsSync(file), `missing ${file}`).toBe(true);
  return JSON.parse(readFileSync(file, "utf8"));
}

describe("the weekly update (spec D19, D21)", () => {
  it("U1: before the approval update.sh writes the two data files into the preview folder only", () => {
    const { root, exportPath } = updateRepo("before-approval");
    const before = treeHashes(root, [PREVIEW_DIR]);
    const commits = git(root, ["rev-list", "--count", "HEAD"]);

    const result = runUpdate(root, exportPath);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

    const preview = join(root, PREVIEW_DIR);
    expect(existsSync(join(preview, REAL_WORK_JSON)), "real-work.json in the preview").toBe(true);
    expect(existsSync(join(preview, MODEL_GUIDE_JSON)), "model-guide.json in the preview").toBe(true);
    const realWork = JSON.parse(readFileSync(join(preview, REAL_WORK_JSON), "utf8"));
    expect(realWork.schema).toBe("model-guide-real-work/1");
    expect(realWork.source.generated_on).toBe("2026-11-14");
    const guide = JSON.parse(readFileSync(join(preview, MODEL_GUIDE_JSON), "utf8"));
    expect(guide.schema).toBe("model-guide-overview/1");
    expect(guide.rows.map((row: any) => row.kind)).toEqual(KINDS);

    // Nothing outside the preview folder moved (spec D21).
    expect(treeHashes(root, [PREVIEW_DIR])).toEqual(before);
    expect(existsSync(join(root, DATA_DIR, REAL_WORK_JSON)), "no docs write").toBe(false);
    expect(existsSync(join(root, DATA_DIR, MODEL_GUIDE_JSON)), "no docs write").toBe(false);
    expect(git(root, ["rev-list", "--count", "HEAD"])).toBe(commits);
    expect(git(root, ["status", "--short"]), "no file changed under docs/").toBe("");
  });

  it("U2: after the approval update.sh writes the two data files into docs/assets/data and commits exactly those two paths", () => {
    const { root, exportPath } = updateRepo("after-approval");
    approve(root);
    // One unrelated dirty file: the run must leave it out of the commit.
    writeFileSync(join(root, "docs", "index.html"), `${INDEX_HTML}<!-- dirty, not for this commit -->\n`);
    expect(git(root, ["status", "--short"])).toContain("docs/index.html");
    const commits = git(root, ["rev-list", "--count", "HEAD"]);

    const result = runUpdate(root, exportPath);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

    const realWork = dataFile(root, REAL_WORK_JSON);
    expect(realWork.schema).toBe("model-guide-real-work/1");
    expect(realWork.source.generated_on).toBe("2026-11-14");
    const guide = dataFile(root, MODEL_GUIDE_JSON);
    expect(guide.schema).toBe("model-guide-overview/1");
    expect(guide.rows.map((row: any) => row.kind)).toEqual(KINDS);

    const committed = git(root, ["show", "--name-only", "--format=", "HEAD"])
      .split("\n").filter(Boolean).sort();
    expect(committed, "the commit holds the two data files and nothing else").toEqual(
      [
        join(DATA_DIR, MODEL_GUIDE_JSON),
        join(DATA_DIR, REAL_WORK_JSON),
      ].sort(),
    );
    expect(git(root, ["rev-list", "--count", "HEAD"])).toBe(String(Number(commits) + 1));
    // The unrelated dirty file stays uncommitted and stays dirty.
    expect(git(root, ["status", "--short"])).toBe(" M docs/index.html");
    expect(git(root, ["remote"]), "no push in the run").toBe("");
  });

  it("U3: a failed input check gives exit 2 and changes no file", () => {
    const { root, exportPath } = updateRepo("bad-input");
    approve(root);
    // One byte more than the manifest holds: the SHA-256 check must refuse
    // the file before any write. The status below is the status of the
    // case: the fixture copy is dirty on purpose, and the run must not
    // move it.
    writeFileSync(exportPath, `${readFileSync(exportPath, "utf8")}\n`);
    const dirty = git(root, ["status", "--short"]);
    const before = treeHashes(root);
    const commits = git(root, ["rev-list", "--count", "HEAD"]);

    const result = runUpdate(root, exportPath);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    const lines = result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
    expect(lines, `stdout of a refused run: ${result.stdout}`).toHaveLength(1);
    expect(lines[0], "the one line names the input check").toContain("input-check");

    expect(treeHashes(root)).toEqual(before);
    expect(existsSync(join(root, PREVIEW_DIR)), "no preview folder appears").toBe(false);
    expect(git(root, ["rev-list", "--count", "HEAD"])).toBe(commits);
    expect(git(root, ["status", "--short"]), "the refused run changes no status")
      .toBe(dirty);
  });
});

/**
 * Review B round 2 (measure/runs/model_guide/review-b-3d42bf8.json).
 *
 * P2B2-1 the symlink guard of `update.sh` covers every path component the
 * script writes through: the two files under `docs/assets/data/`, and before
 * the approval the preview folder itself and its two target files. A planted
 * link at any of those names must give exit 2 with one refusal line and must
 * not move one byte of the link target outside the repo.
 *
 * P2B2-2 the newest score file rule of `update.sh` and `preview.sh` keeps
 * the contract "the newest file by modification time wins" when the newest
 * file name holds a newline. Both scripts get the same contract, and both
 * halves are tested: this file covers `update.sh`, `preview-gate.test.ts`
 * covers `preview.sh`.
 *
 * Every git action and every `update.sh` run of these cases happens in a
 * temp repo under the system temp folder. The link targets live in a second
 * temp folder outside the repo, so a write through a link is visible as a
 * changed byte outside the repo.
 */

/** A synthetic track A score file. A `complete` route with three complete
 * passes qualifies; an `incomplete` route never qualifies (spec D13). */
function scoreDoc(routes: Array<{ route: string; state: string; scores: number[] }>): string {
  const doc = {
    schema: "model-guide-review-scores/1",
    set_id: "mg-2026-11a",
    routes: routes.map(({ route, state, scores }) => ({
      route,
      state,
      passes: scores.map((score, index) => ({
        date: `2026-11-1${index + 1}`,
        score,
        state: "complete",
      })),
    })),
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** Exit 2 and exactly one line that names the refusal or the input check. */
function expectRefusal(result: { status: number | null; stdout: string; stderr: string }, what: string): void {
  expect(result.status, `${what} must exit 2: ${result.stdout}\n${result.stderr}`).toBe(2);
  const lines = result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  expect(lines, `${what} prints one line, got: ${result.stdout}`).toHaveLength(1);
  expect(lines[0], `${what} names the refusal`).toMatch(/^(update: refused .+|input-check: .+)$/);
}

describe("review B round 2: symlinked write targets and newline score names", () => {
  it("P2B2-1a: after the approval a symlink at either docs target file gives exit 2 and no outside write", () => {
    for (const name of [REAL_WORK_JSON, MODEL_GUIDE_JSON]) {
      const outside = tempDir(`outside-docs-${name}`);
      writeFileSync(join(outside, "target.txt"), "outside bytes, must not move\n");
      const outsideBefore = treeHashes(outside);
      const { root, exportPath } = updateRepo(`link-docs-${name}`);
      approve(root);
      symlinkSync(join(outside, "target.txt"), join(root, DATA_DIR, name));
      const treeBefore = treeHashes(root);
      const commits = git(root, ["rev-list", "--count", "HEAD"]);

      const result = runUpdate(root, exportPath);
      expectRefusal(result, `a symlink at docs/assets/data/${name}`);
      expect(treeHashes(outside), `no write outside the repo (${name})`).toEqual(outsideBefore);
      expect(treeHashes(root), `the repo stays byte-identical (${name})`).toEqual(treeBefore);
      expect(git(root, ["rev-list", "--count", "HEAD"]), `no commit (${name})`).toBe(commits);
    }
  });

  it("P2B2-1b: before the approval a symlinked preview folder gives exit 2 and no outside write", () => {
    const outside = tempDir("outside-preview");
    writeFileSync(join(outside, "keep.txt"), "outside bytes, must not move\n");
    const outsideBefore = treeHashes(outside);
    const { root, exportPath } = updateRepo("link-preview-folder");
    mkdirSync(join(root, ".tmp"), { recursive: true });
    symlinkSync(outside, join(root, PREVIEW_DIR));
    const treeBefore = treeHashes(root);
    const commits = git(root, ["rev-list", "--count", "HEAD"]);

    const result = runUpdate(root, exportPath);
    expectRefusal(result, "a symlinked preview folder");
    expect(treeHashes(outside), "no write outside the repo").toEqual(outsideBefore);
    expect(treeHashes(root), "the repo stays byte-identical").toEqual(treeBefore);
    expect(git(root, ["rev-list", "--count", "HEAD"])).toBe(commits);
  });

  it("P2B2-1c: before the approval a symlink at either preview target file gives exit 2 and no outside write", () => {
    for (const name of [REAL_WORK_JSON, MODEL_GUIDE_JSON]) {
      const outside = tempDir(`outside-preview-${name}`);
      writeFileSync(join(outside, "target.txt"), "outside bytes, must not move\n");
      const outsideBefore = treeHashes(outside);
      const { root, exportPath } = updateRepo(`link-preview-file-${name}`);
      mkdirSync(join(root, PREVIEW_DIR), { recursive: true });
      symlinkSync(join(outside, "target.txt"), join(root, PREVIEW_DIR, name));
      const treeBefore = treeHashes(root);
      const commits = git(root, ["rev-list", "--count", "HEAD"]);

      const result = runUpdate(root, exportPath);
      expectRefusal(result, `a symlink at ${PREVIEW_DIR}/${name}`);
      expect(treeHashes(outside), `no write outside the repo (${name})`).toEqual(outsideBefore);
      expect(treeHashes(root), `the repo stays byte-identical (${name})`).toEqual(treeBefore);
      expect(git(root, ["rev-list", "--count", "HEAD"]), `no commit (${name})`).toBe(commits);
    }
  });

  it("P2B2-2 update: a newest score file whose name holds a newline does not steer the pick (the newest file by modification time wins)", () => {
    const { root, exportPath } = updateRepo("newline-scores");
    const scoresDir = join(root, "harness", "model-guide", "data", "review-scores");
    mkdirSync(scoresDir, { recursive: true });
    // The older file has no complete route, so a pick from it shows no pick.
    const older = join(scoresDir, "evil.json");
    writeFileSync(older, scoreDoc([
      { route: "old-model", state: "incomplete", scores: [95.0, 96.0] },
    ]));
    // The newest file carries the newline in its name and one complete
    // route, so only a correct pick shows new-model.
    const hostile = join(scoresDir, "evil.json\nmg-2026-11a.json");
    writeFileSync(hostile, scoreDoc([
      { route: "new-model", state: "complete", scores: [90.0, 91.0, 92.0] },
    ]));
    const now = new Date();
    const old = new Date(now.getTime() - 24 * 3600 * 1000);
    utimesSync(older, old, old);
    utimesSync(hostile, now, now);

    const result = runUpdate(root, exportPath);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const page = JSON.parse(readFileSync(join(root, PREVIEW_DIR, MODEL_GUIDE_JSON), "utf8"));
    const row = page.rows.find((item: any) => item.kind === "Code review");
    expect(row, "the Code review row").toBeDefined();
    expect(
      row.pick,
      "the newest file by modification time wins; the newline name steers nothing",
    ).toBe("new-model");
  });
});
