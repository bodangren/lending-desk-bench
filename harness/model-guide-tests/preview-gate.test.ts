import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readlinkSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Red tests for plan task 1.3: the preview and the publish gate (spec D16,
 * D21, FR-4, FR-7, FR-14). They call the planned files
 * `harness/model-guide/preview.sh`, `harness/model-guide/publish.ts`,
 * `harness/model-guide/real-work.ts`, and
 * `harness/model-guide/pages/real-work.html`.
 *
 * Pinned interfaces:
 *
 * preview.sh
 *   <repo>/harness/model-guide/preview.sh --export <export.json>
 *   The repo root is three levels above the script. The optional
 *   `--preview <folder>` changes the preview folder. The default is
 *   `<repo>/.tmp/model-guide-preview`.
 *   It runs the tools with cwd `<repo>/harness`. It writes these files in the
 *   preview folder: `real-work.json`, `real-work.html`, and `preview-base.json`.
 *   It writes no file under `<repo>/docs/`. Exit 0 on success, exit 2 when the
 *   input check of real-work.ts fails.
 *   `preview-base.json` shape:
 *     { "schema": "model-guide-preview-base/1",
 *       "docs": { "<path relative to docs/>": "<sha256 at copy time>" } }
 *   It lists every file that it copied from `<repo>/docs/`.
 *   The generated `real-work.html` carries the nav links in this order:
 *   Methodology, Results, Real work, Review, Models, Tracks. The new links are
 *   `./real-work.html` and `./review.html`. The page carries the method note
 *   text that this test pins.
 *
 *   The preview path safety rule uses the real paths of `<repo>/docs` and the
 *   `--preview` value. The tool resolves symlinks and collapses dot segments.
 *   It also resolves a path that does not exist. The tool refuses when the
 *   paths are equal, when the preview path is under docs, or when docs is under
 *   the preview path. The refusal happens before any directory or file write.
 *   The refusal gives exit 2 and this exact line on stdout:
 *     preview: refused path <value>
 *   The value is the exact `--preview` argument. Standard error stays empty.
 *   The tool also refuses the root path `/`.
 *
 *   Any symlink under docs/ — a relative link to a file inside docs/, a
 *   `../../` link to a file outside docs/, or a link to a directory — gives
 *   exit 2 and this exact line on stdout:
 *     preview: refused path <absolute link path>
 *   before any write. No preview folder is created, docs/ stays unchanged,
 *   and the link target stays byte-identical. Standard error stays empty.
 *
 *   An unreadable entry under docs/ (mode 000) gives exit 2 and this exact
 *   line on stdout:
 *     preview: unreadable <path relative to the repo>
 *   before any write: no traceback and no `cp:` line on stderr, no
 *   half-built preview folder, and an existing preview folder stays
 *   byte-identical. The case is skipped with a reason when the test runs as
 *   root, because mode 000 stays readable for root.
 *
 *   The tool resolves relative `--export` and `--preview` values against the
 *   caller folder. It then uses the absolute paths after it changes folders.
 *
 *   A usage error gives exit 2 and this exact line on stderr:
 *     usage: preview.sh --export <file> [--preview <folder>]
 *   Standard output stays empty for a usage error. The tool writes no file.
 *
 * publish.ts
 *   cd <repo>/harness && npx tsx model-guide/publish.ts --preview <folder>
 *   The approval record is `<repo>/measure/tracks/model_guide/publish-approval.md`:
 *     approved_by: <name>
 *     date: <YYYY-MM-DD>
 *     files:
 *     <sha256>  <path relative to docs/>
 *   The checks run in this order:
 *     1. no approval record        -> exit 2, `publish: no approval record`
 *     2. no files section or rows  -> exit 2, `publish: no files`
 *     3. an unsafe approval path   -> exit 2, `publish: bad path <path>`
 *     4. an approved SHA-256 differs from the preview file
 *                                  -> exit 2, `publish: sha256 <path>`
 *     5. no preview base file      -> exit 2, `publish: no preview base`
 *     6. a docs/ file differs from preview-base.json
 *                                  -> exit 2, `publish: drift <path>`
 *     7. else copy each approved preview file to `<repo>/docs/<path>`, exit 0.
 *   Each refusal prints one line on stdout and writes no file.
 *   The bad path line uses the exact path from the record. An empty path gives
 *   `publish: bad path ` with one trailing space.
 *   Each drift path is relative to docs and uses `/` separators.
 *   A docs/ entry that is a symlink (to a file or to a directory) or an
 *   unreadable directory gives exit 2 and `publish: drift <path relative to
 *   docs/>`; the path of a symlink is the link itself. The walk states each
 *   entry without following links, so the copy loop never writes through a
 *   link and each link target stays byte-identical. The approval rows stay
 *   checked first, and a record that names only matching files stays valid.
 *
 *   A malformed record row gives exit 2 and this exact line on stdout:
 *     publish: bad line <text>
 *   The text is the complete record line. Standard error stays empty.
 *
 *   A preview base with invalid JSON gives exit 2 and this exact line:
 *     publish: bad preview base
 *   Standard error stays empty. The tool writes no file.
 *
 *   A usage error gives exit 2 and this exact line on stderr:
 *     usage: publish.ts --preview <folder>
 *   A missing `--preview` and an unknown flag give this usage line.
 *   Standard output stays empty for a usage error.
 *
 * The test builds a temp repo with a synthetic docs/ tree and a synthetic
 * export. It copies harness/model-guide/ and links harness/node_modules. No
 * test reads the real docs/, the real export, a model, the network, or the
 * private folder.
 */

const HARNESS = resolve(import.meta.dirname, "..");
const SOURCE = join(HARNESS, "model-guide");
const PREVIEW_SH = join(SOURCE, "preview.sh");
const PUBLISH_TS = join(SOURCE, "publish.ts");
const REAL_WORK_TS = join(SOURCE, "real-work.ts");
const PAGE = join(SOURCE, "pages", "real-work.html");
const PAGE_B = join(import.meta.dirname, "fixtures", "page-b");
const DATE = "2026-10-20";
const OUTCOMES_NAME = `ra-outcomes-${DATE}.json`;
const AA_NAME = `aa-reliability-${DATE}.json`;
const ALLOWED_NAME = `allowed-routes-${DATE}.json`;
const MANIFEST_NAME = `MANIFEST-${DATE}.txt`;
const PUBLISH_USAGE = "usage: publish.ts --preview <folder>\n";
const PREVIEW_USAGE = "usage: preview.sh --manifest <file> [--preview <folder>]\n";
const INPUT_CHECK_SCHEMA_LINE = `input-check: schema ${OUTCOMES_NAME}\n`;

const METHOD_NOTE =
  "Route names stay as written in the record, so #high and [1m] variants are " +
  "separate routes. This page merges them by model.";

const INDEX_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Overview</title>
<link rel="stylesheet" href="./assets/css/site.css"></head>
<body><nav><a href="./methodology.html">Methodology</a>
<a href="./results.html">Results</a><a href="./models/">Models</a>
<a href="./tracks.html">Tracks</a></nav>
<main><h1>Overview</h1></main></body></html>
`;

const SITE_CSS = "body { font-family: sans-serif; }\n";
const BENCHMARK_JSON = '{"schema":1,"rows":[]}\n';

/** Mode 000 stays readable for root, so the unreadable cases cannot occur. */
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const ROOT_SKIP_REASON =
  "skipped as root: a mode 000 entry stays readable for root, so the refusal case cannot occur";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function requireProduction(): void {
  for (const path of [PREVIEW_SH, PUBLISH_TS, REAL_WORK_TS, PAGE]) {
    if (!existsSync(path)) throw new Error(`production file is missing: ${path}`);
  }
}

function env(): NodeJS.ProcessEnv {
  const copy = { ...process.env, NO_COLOR: "1", npm_config_loglevel: "silent" };
  delete copy.BENCH_TRACK;
  return copy;
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function filesUnder(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    const info = lstatSync(full);
    if (info.isDirectory() && !info.isSymbolicLink()) out.push(...filesUnder(full, rel));
    else out.push(rel);
  }
  return out;
}

function snapshot(dir: string, includeDirs = false): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (current: string, prefix: string) => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const info = lstatSync(full);
      if (info.isSymbolicLink()) out.push(`link ${rel} ${readlinkSync(full)}`);
      else if (info.isDirectory()) {
        if (includeDirs) out.push(`dir ${rel}`);
        walk(full, rel);
      } else out.push(`file ${rel} ${sha256(full)}`);
    }
  };
  walk(dir, "");
  return out;
}

function manifestLineOf(file: string, name: string): string {
  const data = readFileSync(file);
  return `${createHash("sha256").update(data).digest("hex")}  ${data.length}  ${name}`;
}

/** Write the four page B fixture files into `<root>/fixture-b/` with a
 * manifest that matches the staged bytes. */
function populatePageB(root: string, mutate?: {
  outcomes?: (rows: any[]) => void;
  allowed?: (doc: any) => void;
}): string {
  const staged = join(root, "fixture-b");
  mkdirSync(staged, { recursive: true });
  let outcomesText = readFileSync(join(PAGE_B, OUTCOMES_NAME), "utf8");
  if (mutate?.outcomes) {
    const rows = JSON.parse(outcomesText);
    mutate.outcomes(rows);
    outcomesText = JSON.stringify(rows, null, 2) + "\n";
  }
  writeFileSync(join(staged, OUTCOMES_NAME), outcomesText);
  writeFileSync(join(staged, AA_NAME), readFileSync(join(PAGE_B, AA_NAME)));
  let allowedText = readFileSync(join(PAGE_B, ALLOWED_NAME), "utf8");
  if (mutate?.allowed) {
    const doc = JSON.parse(allowedText);
    mutate.allowed(doc);
    allowedText = JSON.stringify(doc, null, 2) + "\n";
  }
  writeFileSync(join(staged, ALLOWED_NAME), allowedText);
  writeFileSync(
    join(staged, MANIFEST_NAME),
    [
      manifestLineOf(join(staged, OUTCOMES_NAME), OUTCOMES_NAME),
      manifestLineOf(join(staged, AA_NAME), AA_NAME),
      manifestLineOf(join(staged, ALLOWED_NAME), ALLOWED_NAME),
      "",
    ].join("\n"),
  );
  return join(staged, MANIFEST_NAME);
}

function populateRepo(root: string): void {
  mkdirSync(join(root, "harness"), { recursive: true });
  cpSync(SOURCE, join(root, "harness", "model-guide"), { recursive: true });
  mkdirSync(join(root, "docs", "assets", "css"), { recursive: true });
  mkdirSync(join(root, "docs", "assets", "data"), { recursive: true });
  writeFileSync(join(root, "docs", "index.html"), INDEX_HTML);
  writeFileSync(join(root, "docs", "assets", "css", "site.css"), SITE_CSS);
  writeFileSync(join(root, "docs", "assets", "data", "benchmark.json"), BENCHMARK_JSON);
  mkdirSync(join(root, "measure", "tracks", "model_guide"), { recursive: true });
  populatePageB(root);
  symlinkSync(join(HARNESS, "node_modules"), join(root, "harness", "node_modules"));
}

function repoFixture(tag: string) {
  requireProduction();
  const root = mkdtempSync(join(tmpdir(), `model-guide-preview-${tag}-`));
  roots.push(root);
  populateRepo(root);
  return root;
}

function nestedRepoFixture(tag: string) {
  requireProduction();
  const parent = mkdtempSync(join(tmpdir(), `model-guide-preview-parent-${tag}-`));
  roots.push(parent);
  const root = join(parent, "repo");
  populateRepo(root);
  return { parent, root };
}

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `model-guide-preview-${tag}-`));
  roots.push(dir);
  return dir;
}

function fakeNpxBin(root: string): string {
  const bin = join(root, "fake-bin");
  mkdirSync(bin, { recursive: true });
  const npx = join(bin, "npx");
  writeFileSync(npx, "#!/usr/bin/env bash\nexit 97\n");
  chmodSync(npx, 0o755);
  return bin;
}

/** The staged outcomes array with a mutation, and a rebuilt manifest. */
function stageFixture(root: string, mutate: (rows: any[]) => void): void {
  const rows = JSON.parse(readFileSync(join(PAGE_B, OUTCOMES_NAME), "utf8"));
  mutate(rows);
  const json = join(root, "fixture-b", OUTCOMES_NAME);
  const text = `${JSON.stringify(rows, null, 2)}\n`;
  writeFileSync(json, text);
  rebuildManifest(root);
}

/** Raw outcomes text (for a wrong top-level shape) and a rebuilt manifest. */
function stageOutcomesText(root: string, text: string): void {
  writeFileSync(join(root, "fixture-b", OUTCOMES_NAME), text);
  rebuildManifest(root);
}

/** Rewrite the manifest from the three staged files. */
function rebuildManifest(root: string): void {
  const staged = join(root, "fixture-b");
  writeFileSync(
    join(staged, MANIFEST_NAME),
    [
      manifestLineOf(join(staged, OUTCOMES_NAME), OUTCOMES_NAME),
      manifestLineOf(join(staged, AA_NAME), AA_NAME),
      manifestLineOf(join(staged, ALLOWED_NAME), ALLOWED_NAME),
      "",
    ].join("\n"),
  );
}

function previewFolder(root: string): string {
  return join(root, ".tmp", "model-guide-preview");
}

function runPreviewArgs(
  root: string,
  args: string[],
  cwd = root,
  extraEnv: NodeJS.ProcessEnv = {},
) {
  return spawnSync("bash", [join(root, "harness", "model-guide", "preview.sh"), ...args], {
    cwd,
    env: { ...env(), ...extraEnv },
    encoding: "utf8",
    timeout: 120_000,
  });
}

function runPreview(root: string, preview?: string, cwd = root) {
  const args = [
    "--manifest", join(root, "fixture-b", MANIFEST_NAME),
  ];
  if (preview !== undefined) args.push("--preview", preview);
  return runPreviewArgs(root, args, cwd);
}

function runPublishArgs(root: string, args: string[]) {
  const tsx = join(root, "harness", "node_modules", ".bin", "tsx");
  return spawnSync(tsx, ["model-guide/publish.ts", ...args], {
    cwd: join(root, "harness"),
    env: env(),
    encoding: "utf8",
    timeout: 120_000,
  });
}

function runPublish(root: string, preview = previewFolder(root)) {
  return runPublishArgs(root, ["--preview", preview]);
}

function writeApproval(root: string, rows: Array<[string, string]>): void {
  const text = [
    "approved_by: Daniel",
    "date: 2026-11-20",
    "files:",
    ...rows.map(([sha, path]) => `${sha}  ${path}`),
    "",
  ].join("\n");
  writeFileSync(join(root, "measure", "tracks", "model_guide", "publish-approval.md"), text);
}

function writeApprovalText(root: string, text: string): void {
  writeFileSync(join(root, "measure", "tracks", "model_guide", "publish-approval.md"), text);
}

function approvedHashes(root: string, paths: string[]): Array<[string, string]> {
  return paths.map((path) => [sha256(join(previewFolder(root), path)), path]);
}

/** Build the preview folder by hand with the preview base that preview.sh
 * records: each docs file follows links to its target content, and a link
 * to a directory stays out of the base (os.walk does not descend it). The
 * publish tests use this so they do not depend on what preview.sh does with
 * a docs symlink. */
function writeDocsBase(root: string): void {
  const docs = join(root, "docs");
  const base: Record<string, string> = {};
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const info = lstatSync(full);
      if (info.isSymbolicLink()) {
        if (statSync(full).isFile()) base[rel] = sha256(full);
        continue;
      }
      if (info.isDirectory()) {
        walk(full, rel);
        continue;
      }
      base[rel] = sha256(full);
    }
  };
  walk(docs, "");
  mkdirSync(previewFolder(root), { recursive: true });
  writeFileSync(
    join(previewFolder(root), "preview-base.json"),
    `${JSON.stringify({ schema: "model-guide-preview-base/1", docs: base }, null, 2)}\n`,
  );
}

function expectPreviewRefusal(root: string, value: string, cwd: string): void {
  const docs = join(root, "docs");
  const target = resolve(cwd, value);
  const docsBefore = snapshot(docs);
  const targetBefore = snapshot(target);
  const rootBefore = snapshot(root, true);
  const result = runPreview(root, value, cwd);
  expect(result.status, result.stdout).toBe(2);
  expect(result.stdout).toBe(`preview: refused path ${value}\n`);
  expect(result.stderr).toBe("");
  expect(snapshot(docs)).toEqual(docsBefore);
  expect(snapshot(target)).toEqual(targetBefore);
  expect(snapshot(root, true)).toEqual(rootBefore);
}

function expectPublishRefusal(root: string, lines: string[]): void {
  const docs = join(root, "docs");
  const preview = previewFolder(root);
  const docsBefore = snapshot(docs);
  const previewBefore = snapshot(preview);
  const result = runPublish(root);
  expect(result.status, result.stdout).toBe(2);
  expect(result.stdout).toBe(lines.join(""));
  expect(result.stderr).toBe("");
  expect(snapshot(docs)).toEqual(docsBefore);
  expect(snapshot(preview)).toEqual(previewBefore);
}

function failContract(message: string): never {
  const error = new Error(message);
  error.stack = `Error: ${message}`;
  throw error;
}

function expectBadApprovalPath(path: string): void {
  const root = repoFixture("b1");
  expect(runPreview(root).status).toBe(0);
  writeApproval(root, [["0".repeat(64), path]]);
  if (path === "") {
    const docsBefore = snapshot(join(root, "docs"));
    const previewBefore = snapshot(previewFolder(root));
    const result = runPublish(root);
    if (result.status !== 2) {
      failContract(`B1 empty path must exit 2; got ${result.status}`);
    }
    expect(result.stdout).toBe("publish: bad path \n");
    expect(result.stderr).toBe("");
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
    expect(snapshot(previewFolder(root))).toEqual(previewBefore);
    return;
  }
  expectPublishRefusal(root, [`publish: bad path ${path}\n`]);
}

function expectBadApprovalLine(line: string): void {
  const root = repoFixture("bad-line");
  expect(runPreview(root).status).toBe(0);
  writeApprovalText(root, [
    "approved_by: Daniel",
    "date: 2026-11-20",
    "files:",
    line,
    "",
  ].join("\n"));
  expectPublishRefusal(root, [`publish: bad line ${line}\n`]);
}

describe("the preview and the publish gate", () => {
  it("writes page B and its data into the preview folder with the nav and the method note", () => {
    const root = repoFixture("p1");
    const result = runPreview(root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const preview = previewFolder(root);
    for (const name of ["real-work.html", "real-work.json", "preview-base.json"]) {
      expect(existsSync(join(preview, name)), `missing preview file: ${name}`).toBe(true);
    }
    const page = readFileSync(join(preview, "real-work.html"), "utf8");
    expect(page).toContain(METHOD_NOTE);
    for (const label of ["Methodology", "Results", "Real work", "Review", "Models", "Tracks"]) {
      expect(page, `nav label ${label}`).toContain(`>${label}<`);
    }
    expect(page).toContain('href="./real-work.html"');
    expect(page).toContain('href="./review.html"');
    const results = page.indexOf(">Results<");
    const realWork = page.indexOf(">Real work<");
    const review = page.indexOf(">Review<");
    const models = page.indexOf(">Models<");
    expect(results).toBeGreaterThan(-1);
    expect(realWork).toBeGreaterThan(results);
    expect(review).toBeGreaterThan(realWork);
    expect(models).toBeGreaterThan(review);
  });

  it("records the SHA-256 of each copied docs file in preview-base.json", () => {
    const root = repoFixture("p1b");
    const result = runPreview(root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const base = JSON.parse(readFileSync(join(previewFolder(root), "preview-base.json"), "utf8"));
    expect(base.schema).toBe("model-guide-preview-base/1");
    const docs = join(root, "docs");
    const paths = filesUnder(docs);
    expect(Object.keys(base.docs).sort()).toEqual(paths.slice().sort());
    for (const rel of paths) {
      expect(base.docs[rel], `base entry ${rel}`).toBe(sha256(join(docs, rel)));
    }
  });

  it("leaves the temp docs copy without a change", () => {
    const root = repoFixture("p2");
    const before = snapshot(join(root, "docs"));
    const result = runPreview(root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(snapshot(join(root, "docs"))).toEqual(before);
  });

  it("refuses publish without an approval record and writes no file", () => {
    const root = repoFixture("p3");
    expect(runPreview(root).status).toBe(0);
    const before = snapshot(join(root, "docs"));
    const result = runPublish(root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout).toContain("publish: no approval record");
    expect(snapshot(join(root, "docs"))).toEqual(before);
    expect(existsSync(join(root, "docs", "real-work.html"))).toBe(false);
  });

  it("refuses publish with one wrong SHA-256 and writes no file", () => {
    const root = repoFixture("p3b");
    expect(runPreview(root).status).toBe(0);
    const wrong = approvedHashes(root, ["real-work.html"]);
    wrong[0][0] = wrong[0][0].replace(/^./, (c) => (c === "0" ? "1" : "0"));
    writeApproval(root, wrong);
    const before = snapshot(join(root, "docs"));
    const result = runPublish(root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout).toContain("publish: sha256 real-work.html");
    expect(snapshot(join(root, "docs"))).toEqual(before);
    expect(existsSync(join(root, "docs", "real-work.html"))).toBe(false);
  });

  it("refuses publish and names the file when a docs file drifted after the preview", () => {
    const root = repoFixture("p4");
    expect(runPreview(root).status).toBe(0);
    writeApproval(root, approvedHashes(root, ["real-work.html", "real-work.json"]));
    writeFileSync(join(root, "docs", "assets", "css", "site.css"), `${SITE_CSS}/* drift */\n`);
    const before = snapshot(join(root, "docs"));
    const result = runPublish(root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout).toContain("publish: drift assets/css/site.css");
    expect(snapshot(join(root, "docs"))).toEqual(before);
    expect(existsSync(join(root, "docs", "real-work.html"))).toBe(false);
  });

  it("copies the approved files into docs with a matching record and no drift", () => {
    const root = repoFixture("p5");
    expect(runPreview(root).status).toBe(0);
    const approved = ["index.html", "real-work.html", "real-work.json"];
    writeApproval(root, approvedHashes(root, approved));
    const result = runPublish(root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    for (const rel of approved) {
      expect(existsSync(join(root, "docs", rel)), `published ${rel}`).toBe(true);
      expect(sha256(join(root, "docs", rel)), rel)
        .toBe(sha256(join(previewFolder(root), rel)));
    }
  });

  it("A1 refuses the exact docs path before any write", () => {
    const root = repoFixture("a1-1");
    expectPreviewRefusal(root, `${root}/docs`, root);
  });

  it("A1 refuses the docs path with a trailing slash before any write", () => {
    const root = repoFixture("a1-2");
    expectPreviewRefusal(root, `${root}/docs/`, root);
  });

  it("A1 refuses the docs path with a double slash before any write", () => {
    const root = repoFixture("a1-3");
    expectPreviewRefusal(root, `${root}//docs`, root);
  });

  it("A1 refuses a missing folder under docs without creating it", () => {
    const root = repoFixture("a1-4");
    expectPreviewRefusal(root, `${root}/docs/new-sub`, root);
    expect(existsSync(join(root, "docs", "new-sub"))).toBe(false);
  });

  it("A1 refuses an existing folder under docs before any write", () => {
    const root = repoFixture("a1-5");
    expectPreviewRefusal(root, `${root}/docs/assets`, root);
  });

  it("A1 refuses the relative docs path from the repo root", () => {
    const root = repoFixture("a1-6");
    expectPreviewRefusal(root, "docs", root);
  });

  it("A1 refuses the dot-relative docs path from the repo root", () => {
    const root = repoFixture("a1-6b");
    expectPreviewRefusal(root, "./docs", root);
  });

  it("A1 refuses the parent-relative docs path from the harness folder", () => {
    const root = repoFixture("a1-7");
    expectPreviewRefusal(root, "../docs", join(root, "harness"));
  });

  it("A1 refuses a docs path with a parent segment before any write", () => {
    const root = repoFixture("a1-8");
    expectPreviewRefusal(root, `${root}/harness/../docs`, root);
  });

  it("A1 refuses an outside symlink that points to docs before any write", () => {
    const root = repoFixture("a1-9");
    const outside = tempDir("a1-9-link");
    const link = join(outside, "preview-link");
    symlinkSync(join(root, "docs"), link, "dir");
    expectPreviewRefusal(root, link, root);
  });

  it("A1 refuses the repo root because docs is under it", () => {
    const root = repoFixture("a1-10");
    expectPreviewRefusal(root, root, root);
  });

  it("A1 allows a sibling folder whose name starts with docs", () => {
    const root = repoFixture("a1-11");
    const target = `${root}/docs-preview`;
    const result = runPreview(root, target, root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(existsSync(join(target, "real-work.html"))).toBe(true);
  });

  it("A1 allows the default preview folder", () => {
    const root = repoFixture("a1-12");
    const docsBefore = snapshot(join(root, "docs"));
    const result = runPreview(root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
    expect(existsSync(join(previewFolder(root), "real-work.html"))).toBe(true);
  });

  it("A1 allows a preview folder outside the repo", () => {
    const root = repoFixture("a1-12b");
    const target = join(tempDir("a1-12-outside"), "preview");
    const docsBefore = snapshot(join(root, "docs"));
    const result = runPreview(root, target, root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
    expect(existsSync(join(target, "real-work.html"))).toBe(true);
  });

  it("A2 refuses a file added under docs after the preview", () => {
    const root = repoFixture("a2-added");
    expect(runPreview(root).status).toBe(0);
    writeApproval(root, approvedHashes(root, ["real-work.html", "real-work.json"]));
    writeFileSync(join(root, "docs", "added.txt"), "new\n");
    expectPublishRefusal(root, ["publish: drift added.txt\n"]);
  });

  it("A2 refuses a file added under a new docs subfolder after the preview", () => {
    const root = repoFixture("a2-subfolder");
    expect(runPreview(root).status).toBe(0);
    writeApproval(root, approvedHashes(root, ["real-work.html", "real-work.json"]));
    mkdirSync(join(root, "docs", "new-folder"), { recursive: true });
    writeFileSync(join(root, "docs", "new-folder", "added.txt"), "new\n");
    expectPublishRefusal(root, ["publish: drift new-folder/added.txt\n"]);
  });

  it("A2 refuses a file removed from docs after the preview", () => {
    const root = repoFixture("a2-removed");
    expect(runPreview(root).status).toBe(0);
    writeApproval(root, approvedHashes(root, ["real-work.html", "real-work.json"]));
    rmSync(join(root, "docs", "assets", "css", "site.css"));
    expectPublishRefusal(root, ["publish: drift assets/css/site.css\n"]);
  });

  it("A2 names each of two files added under docs after the preview", () => {
    const root = repoFixture("a2-two");
    expect(runPreview(root).status).toBe(0);
    writeApproval(root, approvedHashes(root, ["real-work.html", "real-work.json"]));
    writeFileSync(join(root, "docs", "added-a.txt"), "a\n");
    writeFileSync(join(root, "docs", "added-b.txt"), "b\n");
    expectPublishRefusal(root, [
      "publish: drift added-a.txt\n",
      "publish: drift added-b.txt\n",
    ]);
  });

  it("B1 refuses the parent approval path before any copy", () => {
    expectBadApprovalPath("../x.html");
  });

  it("B1 refuses the parent-segment approval path before any copy", () => {
    expectBadApprovalPath("a/../../x.html");
  });

  it("B1 refuses the absolute approval path before any copy", () => {
    expectBadApprovalPath("/tmp/x.html");
  });

  it("B1 refuses the dot-relative approval path before any copy", () => {
    expectBadApprovalPath("./x.html");
  });

  it("B1 refuses the double-slash approval path before any copy", () => {
    expectBadApprovalPath("a//b.html");
  });

  it("B1 refuses the backslash approval path before any copy", () => {
    expectBadApprovalPath("a\\b.html");
  });

  it("B1 refuses the empty approval path before any copy", () => {
    expectBadApprovalPath("");
  });

  it("B1 refuses an approval record without a files section", () => {
    const root = repoFixture("b1-no-section");
    expect(runPreview(root).status).toBe(0);
    writeApprovalText(root, "approved_by: Daniel\ndate: 2026-11-20\n");
    expectPublishRefusal(root, ["publish: no files\n"]);
  });

  it("B1 refuses an approval record with an empty files section", () => {
    const root = repoFixture("b1-empty-section");
    expect(runPreview(root).status).toBe(0);
    writeApprovalText(root, "approved_by: Daniel\ndate: 2026-11-20\nfiles:\n");
    expectPublishRefusal(root, ["publish: no files\n"]);
  });

  it("B2 escapes a script value in a route name and never writes the raw tag", () => {
    const root = repoFixture("b2-route");
    const raw = "<im" + "g src=x onerror=alert(1)>";
    stageFixture(root, (rows) => {
      rows[0].route = raw;
    });
    const result = runPreview(root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const page = readFileSync(join(previewFolder(root), "real-work.html"), "utf8");
    expect(page).toContain("&" + "lt;img src=x onerror=alert(1)&" + "gt;");
    expect(page).not.toContain(raw);
  });

  it("C2 refuses publish without preview-base.json and writes no file", () => {
    const root = repoFixture("c2-no-base");
    const preview = previewFolder(root);
    mkdirSync(preview, { recursive: true });
    writeFileSync(join(preview, "real-work.html"), "<html></html>\n");
    const approved = approvedHashes(root, ["real-work.html"]);
    writeApproval(root, approved);
    const docsBefore = snapshot(join(root, "docs"));
    const previewBefore = snapshot(preview);
    const result = runPublish(root);
    if (result.status !== 2) {
      failContract(`C2 missing preview base must exit 2; got ${result.status}`);
    }
    expect(result.stdout).toBe("publish: no preview base\n");
    expect(result.stderr).toBe("");
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
    expect(snapshot(preview)).toEqual(previewBefore);
  });

  it("C4 refuses publish without --preview with a usage line", () => {
    const root = repoFixture("c4-no-preview");
    const docsBefore = snapshot(join(root, "docs"));
    const previewBefore = snapshot(previewFolder(root));
    const result = runPublishArgs(root, []);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(PUBLISH_USAGE);
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
    expect(snapshot(previewFolder(root))).toEqual(previewBefore);
  });

  it("C4 refuses an unknown publish flag with a usage line and writes no file", () => {
    const root = repoFixture("c4-unknown");
    expect(runPreview(root).status).toBe(0);
    writeApproval(root, approvedHashes(root, ["real-work.html", "real-work.json"]));
    const docsBefore = snapshot(join(root, "docs"));
    const previewBefore = snapshot(previewFolder(root));
    const result = runPublishArgs(root, ["--preview", previewFolder(root), "--unknown"]);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(PUBLISH_USAGE);
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
    expect(snapshot(previewFolder(root))).toEqual(previewBefore);
  });

  it("F12 resolves a relative preview path from the repo root before it changes folders", () => {
    const { parent, root } = nestedRepoFixture("f12-row1");
    const docs = join(root, "docs");
    const target = join(parent, "docs");
    const docsBefore = snapshot(docs);
    expect(existsSync(target)).toBe(false);
    const result = runPreview(root, "../docs", root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(existsSync(join(target, "real-work.json"))).toBe(true);
    expect(existsSync(join(target, "real-work.html"))).toBe(true);
    expect(snapshot(docs)).toEqual(docsBefore);
  });

  it("F12 resolves a relative preview path from the harness folder", () => {
    const root = repoFixture("f12-row2");
    const docs = join(root, "docs");
    const target = join(root, "harness", "docs");
    const docsBefore = snapshot(docs);
    const result = runPreview(root, "docs", join(root, "harness"));
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(existsSync(join(target, "real-work.json"))).toBe(true);
    expect(existsSync(join(target, "real-work.html"))).toBe(true);
    expect(snapshot(docs)).toEqual(docsBefore);
  });

  it("F12 keeps a relative preview path under the caller repo folder", () => {
    const root = repoFixture("f12-row3");
    const docs = join(root, "docs");
    const target = join(root, ".tmp", "rel-preview");
    const wrongTarget = join(root, "harness", ".tmp", "rel-preview");
    const docsBefore = snapshot(docs);
    const result = runPreview(root, ".tmp/rel-preview", root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(existsSync(join(target, "real-work.json"))).toBe(true);
    expect(existsSync(join(target, "real-work.html"))).toBe(true);
    expect(existsSync(wrongTarget)).toBe(false);
    expect(snapshot(docs)).toEqual(docsBefore);
  });

  it("F12 refuses a parent-relative preview path from the model-guide folder", () => {
    const root = repoFixture("f12-row4");
    expectPreviewRefusal(root, "../../docs", join(root, "harness", "model-guide"));
  });

  it("F20 refuses the root preview path before it starts a tool", () => {
    const root = repoFixture("f20-root");
    const fakeBin = fakeNpxBin(root);
    const docsBefore = snapshot(join(root, "docs"));
    const rootBefore = snapshot(root, true);
    const result = runPreviewArgs(
      root,
      ["--export", join(root, "fixture", "real-work-mini.json"), "--preview", "/"],
      root,
      { PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout).toBe("preview: refused path /\n");
    expect(result.stderr).toBe("");
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
    expect(snapshot(root, true)).toEqual(rootBefore);
  });

  it("F14 resolves a relative manifest path from the repo root", () => {
    const root = repoFixture("f14-row6");
    const docsBefore = snapshot(join(root, "docs"));
    const result = runPreviewArgs(root, ["--manifest", `fixture-b/${MANIFEST_NAME}`], root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(existsSync(join(previewFolder(root), "real-work.json"))).toBe(true);
    expect(existsSync(join(previewFolder(root), "real-work.html"))).toBe(true);
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
  });

  it("F14 resolves a relative manifest path from a folder outside the repo", () => {
    const root = repoFixture("f14-row7");
    const outside = tempDir("f14-outside");
    for (const name of [OUTCOMES_NAME, AA_NAME, ALLOWED_NAME, MANIFEST_NAME]) {
      writeFileSync(join(outside, name), readFileSync(join(PAGE_B, name)));
    }
    const docsBefore = snapshot(join(root, "docs"));
    const result = runPreviewArgs(root, ["--manifest", MANIFEST_NAME], outside);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(existsSync(join(previewFolder(root), "real-work.json"))).toBe(true);
    expect(existsSync(join(previewFolder(root), "real-work.html"))).toBe(true);
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
  });

  it("F13 keeps fresh real-work data when docs holds stale published files", () => {
    const root = repoFixture("f13-stale");
    expect(runPreview(root).status).toBe(0);
    const preview = previewFolder(root);
    const freshData = JSON.parse(readFileSync(join(preview, "real-work.json"), "utf8"));
    const freshSha = freshData.source.sha256 as string;
    const freshDate = freshData.source.generated_on as string;
    const oldSha = "f".repeat(64);
    expect(oldSha).not.toBe(freshSha);
    const staleData = JSON.parse(JSON.stringify(freshData));
    staleData.source.sha256 = oldSha;
    staleData.source.generated_on = "2000-01-01";
    writeFileSync(join(root, "docs", "real-work.json"), `${JSON.stringify(staleData, null, 2)}\n`);
    const freshPage = readFileSync(join(preview, "real-work.html"), "utf8");
    const stalePage = freshPage.replaceAll(freshSha, oldSha).replaceAll(freshDate, "2000-01-01");
    writeFileSync(join(root, "docs", "real-work.html"), stalePage);
    const docsBefore = snapshot(join(root, "docs"));
    const result = runPreview(root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const previewData = JSON.parse(readFileSync(join(preview, "real-work.json"), "utf8"));
    expect(previewData.source.sha256).toBe(freshSha);
    expect(previewData.source.generated_on).toBe(freshDate);
    const page = readFileSync(join(preview, "real-work.html"), "utf8");
    expect(page).toContain(freshSha);
    expect(page).not.toContain(oldSha);
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
  });

  it("F15 refuses preview.sh with --manifest as the last argument", () => {
    const root = repoFixture("f15-manifest-last");
    const docsBefore = snapshot(join(root, "docs"));
    const rootBefore = snapshot(root, true);
    const result = runPreviewArgs(root, ["--manifest"], root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(PREVIEW_USAGE);
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
    expect(snapshot(root, true)).toEqual(rootBefore);
  });

  it("F15 refuses preview.sh with --preview as the last argument", () => {
    const root = repoFixture("f15-preview-last");
    const docsBefore = snapshot(join(root, "docs"));
    const rootBefore = snapshot(root, true);
    const result = runPreviewArgs(root, ["--preview"], root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(PREVIEW_USAGE);
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
    expect(snapshot(root, true)).toEqual(rootBefore);
  });

  it("F15 refuses preview.sh with an empty manifest value", () => {
    const root = repoFixture("f15-manifest-empty");
    const docsBefore = snapshot(join(root, "docs"));
    const rootBefore = snapshot(root, true);
    const result = runPreviewArgs(root, ["--manifest", ""], root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(PREVIEW_USAGE);
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
    expect(snapshot(root, true)).toEqual(rootBefore);
  });

  it("F15 refuses preview.sh with an empty preview value", () => {
    const root = repoFixture("f15-preview-empty");
    const docsBefore = snapshot(join(root, "docs"));
    const rootBefore = snapshot(root, true);
    const result = runPreviewArgs(
      root,
      ["--manifest", join(root, "fixture-b", MANIFEST_NAME), "--preview", ""],
      root,
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(PREVIEW_USAGE);
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
    expect(snapshot(root, true)).toEqual(rootBefore);
  });

  it("F19 leaves no preview folder after an input check refusal", () => {
    const root = repoFixture("f19-empty-folder");
    stageOutcomesText(root, '{"rows": []}\n');
    const docsBefore = snapshot(join(root, "docs"));
    const target = previewFolder(root);
    expect(existsSync(target)).toBe(false);
    const result = runPreview(root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(INPUT_CHECK_SCHEMA_LINE);
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
    expect(existsSync(target)).toBe(false);
  });

  it("F16 refuses an approval row with one field", () => {
    expectBadApprovalLine("only-one-field");
  });

  it("F16 refuses an approval row with a 63 character SHA-256", () => {
    const shortSha = "a".repeat(63);
    expectBadApprovalLine(`${shortSha}  real-work.html`);
  });

  it("F16 refuses an approval row with a non-hex SHA-256", () => {
    const badSha = "z".repeat(64);
    expectBadApprovalLine(`${badSha}  real-work.html`);
  });

  it("F18 refuses an approval row that names a folder", () => {
    const root = repoFixture("f18-folder");
    expect(runPreview(root).status).toBe(0);
    writeApproval(root, [["0".repeat(64), "assets"]]);
    expectPublishRefusal(root, ["publish: bad path assets\n"]);
  });

  it("F23 refuses a docs file named constructor after the preview", () => {
    const root = repoFixture("f23-constructor");
    expect(runPreview(root).status).toBe(0);
    writeApproval(root, approvedHashes(root, ["real-work.html", "real-work.json"]));
    writeFileSync(join(root, "docs", "constructor"), "new\n");
    expectPublishRefusal(root, ["publish: drift constructor\n"]);
  });

  it("F23 refuses a docs file named toString after the preview", () => {
    const root = repoFixture("f23-tostring");
    expect(runPreview(root).status).toBe(0);
    writeApproval(root, approvedHashes(root, ["real-work.html", "real-work.json"]));
    writeFileSync(join(root, "docs", "toString"), "new\n");
    expectPublishRefusal(root, ["publish: drift toString\n"]);
  });

  it("F23 refuses an invalid preview base without a stack trace", () => {
    const root = repoFixture("f23-bad-base");
    expect(runPreview(root).status).toBe(0);
    writeApproval(root, approvedHashes(root, ["real-work.html", "real-work.json"]));
    writeFileSync(join(previewFolder(root), "preview-base.json"), "{not-json\n");
    expectPublishRefusal(root, ["publish: bad preview base\n"]);
  });

  it("A3-1 keeps an existing preview folder byte-identical after an input check refusal", () => {
    const root = repoFixture("a3-1-existing");
    expect(runPreview(root).status).toBe(0);
    const preview = previewFolder(root);
    const indexBefore = readFileSync(join(preview, "index.html"), "utf8");
    const baseBefore = readFileSync(join(preview, "preview-base.json"), "utf8");
    expect(indexBefore).toContain('href="./real-work.html"');
    stageOutcomesText(root, '{"rows": []}\n');
    const before = snapshot(preview);
    const docsBefore = snapshot(join(root, "docs"));
    const result = runPreview(root);
    expect(result.status, `A3-1 status: ${result.status}`).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(INPUT_CHECK_SCHEMA_LINE);
    expect(snapshot(preview)).toEqual(before);
    expect(readFileSync(join(preview, "index.html"), "utf8")).toBe(indexBefore);
    expect(readFileSync(join(preview, "preview-base.json"), "utf8")).toBe(baseBefore);
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
  });

  it("A3-1 leaves no new parent folder after a refusal into a new nested preview folder", () => {
    const root = repoFixture("a3-1-nested");
    stageOutcomesText(root, '{"rows": []}\n');
    const target = join(root, ".tmp", "a3-1-nested-parent", "leaf");
    const docsBefore = snapshot(join(root, "docs"));
    const result = runPreview(root, target);
    expect(result.status, `A3-1 nested status: ${result.status}`).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(INPUT_CHECK_SCHEMA_LINE);
    expect(existsSync(target)).toBe(false);
    expect(existsSync(join(root, ".tmp", "a3-1-nested-parent"))).toBe(false);
    expect(existsSync(join(root, ".tmp"))).toBe(false);
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
  });

  it("A3-3 refuses a symlink planted inside an existing preview folder without a docs write", () => {
    const root = repoFixture("a3-3-symlink");
    expect(runPreview(root).status).toBe(0);
    const preview = previewFolder(root);
    rmSync(join(preview, "real-work.json"));
    symlinkSync(join(root, "docs", "real-work.json"), join(preview, "real-work.json"));
    const docsBefore = snapshot(join(root, "docs"));
    const result = runPreview(root);
    expect(result.status, `A3-3 status: ${result.status}`).toBe(2);
    expect(result.stdout).toBe(`preview: refused path ${join(preview, "real-work.json")}\n`);
    expect(result.stderr).toBe("");
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
  });

  it("C3-2 keeps exactly one of each nav link on a second preview over a published index", () => {
    const root = repoFixture("c3-2-nav");
    expect(runPreview(root).status).toBe(0);
    writeFileSync(
      join(root, "docs", "index.html"),
      readFileSync(join(previewFolder(root), "index.html")),
    );
    const result = runPreview(root);
    expect(result.status, `C3-2 status: ${result.status}`).toBe(0);
    const index = readFileSync(join(previewFolder(root), "index.html"), "utf8");
    expect(index.split('href="./real-work.html"').length - 1).toBe(1);
    expect(index.split('href="./review.html"').length - 1).toBe(1);
  });

  it("B2-1 refuses publish with a dangling symlink under docs and writes no file", () => {
    const root = repoFixture("b2-1-dangling");
    expect(runPreview(root).status).toBe(0);
    writeApproval(root, approvedHashes(root, ["real-work.html", "real-work.json"]));
    symlinkSync(join(root, "no-such-target.txt"), join(root, "docs", "dangling.txt"));
    const docsBefore = snapshot(join(root, "docs"));
    const result = runPublish(root);
    expect(result.status, `B2-1 dangling status: ${result.status}`).toBe(2);
    expect(result.stdout).toContain("publish: drift dangling.txt");
    expect(result.stderr).not.toMatch(/    at |Traceback/);
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
  });

  it("B2-1 refuses publish with an unreadable file under docs and writes no file", () => {
    const root = repoFixture("b2-1-locked");
    writeFileSync(join(root, "docs", "locked.txt"), "locked\n");
    expect(runPreview(root).status).toBe(0);
    writeApproval(root, approvedHashes(root, ["real-work.html", "real-work.json"]));
    const docsBefore = snapshot(join(root, "docs"));
    chmodSync(join(root, "docs", "locked.txt"), 0o000);
    const result = runPublish(root);
    expect(result.status, `B2-1 locked status: ${result.status}`).toBe(2);
    expect(result.stdout).toContain("publish: drift locked.txt");
    expect(result.stderr).not.toMatch(/    at |Traceback/);
    chmodSync(join(root, "docs", "locked.txt"), 0o644);
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
  });

  it("B2-1 refuses preview.sh with a dangling entry under docs without a traceback", () => {
    const root = repoFixture("b2-1-preview-dangling");
    symlinkSync(join(root, "no-such-target.txt"), join(root, "docs", "dangling.txt"));
    const docsBefore = snapshot(join(root, "docs"));
    const result = runPreview(root);
    expect(result.status, `B2-1 preview status: ${result.status}`).toBe(2);
    expect(result.stderr).not.toMatch(/Traceback|    at /);
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
  });

  it("B3-1 refuses preview.sh with a relative symlink under docs before any write", () => {
    const root = repoFixture("b3-1-preview-rel");
    symlinkSync("index.html", join(root, "docs", "alias.html"));
    const docsBefore = snapshot(join(root, "docs"));
    const result = runPreview(root);
    expect(result.status, `B3-1 status: ${result.status}`).toBe(2);
    expect(result.stdout)
      .toBe(`preview: refused path ${join(root, "docs", "alias.html")}\n`);
    expect(result.stderr).toBe("");
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
    expect(existsSync(join(root, ".tmp"))).toBe(false);
  });

  it("B3-1 refuses preview.sh with an outside symlink under docs before any write", () => {
    const { parent, root } = nestedRepoFixture("b3-1-preview-out");
    writeFileSync(join(parent, "outside.html"), "outside\n");
    symlinkSync("../../outside.html", join(root, "docs", "escape.html"));
    const docsBefore = snapshot(join(root, "docs"));
    const outsideBefore = readFileSync(join(parent, "outside.html"), "utf8");
    const result = runPreview(root);
    expect(result.status, `B3-1 status: ${result.status}`).toBe(2);
    expect(result.stdout)
      .toBe(`preview: refused path ${join(root, "docs", "escape.html")}\n`);
    expect(result.stderr).toBe("");
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
    expect(readFileSync(join(parent, "outside.html"), "utf8")).toBe(outsideBefore);
    expect(existsSync(join(root, ".tmp"))).toBe(false);
  });

  it("B3-1 refuses preview.sh with a directory symlink under docs before any write", () => {
    const { parent, root } = nestedRepoFixture("b3-1-preview-dir");
    mkdirSync(join(parent, "outside-dir"), { recursive: true });
    writeFileSync(join(parent, "outside-dir", "outside.txt"), "outside\n");
    symlinkSync("../../outside-dir", join(root, "docs", "dirlink"), "dir");
    const docsBefore = snapshot(join(root, "docs"));
    const outsideBefore = readFileSync(join(parent, "outside-dir", "outside.txt"), "utf8");
    const result = runPreview(root);
    expect(result.status, `B3-1 status: ${result.status}`).toBe(2);
    expect(result.stdout)
      .toBe(`preview: refused path ${join(root, "docs", "dirlink")}\n`);
    expect(result.stderr).toBe("");
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
    expect(readFileSync(join(parent, "outside-dir", "outside.txt"), "utf8"))
      .toBe(outsideBefore);
    expect(existsSync(join(root, ".tmp"))).toBe(false);
  });

  it("B3-1 refuses publish with a relative docs symlink in the approval row and writes through no link", () => {
    const root = repoFixture("b3-1-publish-rel");
    symlinkSync("index.html", join(root, "docs", "alias.html"));
    writeDocsBase(root);
    const preview = previewFolder(root);
    writeFileSync(join(preview, "index.html"), "<html>preview index</html>\n");
    symlinkSync("index.html", join(preview, "alias.html"));
    writeApproval(root, [[sha256(join(preview, "alias.html")), "alias.html"]]);
    const docsBefore = snapshot(join(root, "docs"));
    const previewBefore = snapshot(preview);
    const result = runPublish(root);
    expect(result.status, `B3-1 publish status: ${result.status}`).toBe(2);
    expect(result.stdout).toBe("publish: drift alias.html\n");
    expect(result.stderr).toBe("");
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
    expect(snapshot(preview)).toEqual(previewBefore);
    expect(readFileSync(join(root, "docs", "index.html"), "utf8")).toBe(INDEX_HTML);
  });

  it("B3-1 refuses publish with an outside docs symlink and leaves the outside file byte-identical", () => {
    const { parent, root } = nestedRepoFixture("b3-1-publish-out");
    writeFileSync(join(parent, "outside.html"), "docs-side\n");
    writeFileSync(join(root, "outside.html"), "preview-side\n");
    symlinkSync("../../outside.html", join(root, "docs", "escape.html"));
    writeDocsBase(root);
    const preview = previewFolder(root);
    symlinkSync("../../outside.html", join(preview, "escape.html"));
    writeApproval(root, [[sha256(join(preview, "escape.html")), "escape.html"]]);
    const docsBefore = snapshot(join(root, "docs"));
    const previewBefore = snapshot(preview);
    const outsideBefore = readFileSync(join(parent, "outside.html"), "utf8");
    const result = runPublish(root);
    expect(result.status, `B3-1 publish status: ${result.status}`).toBe(2);
    expect(result.stdout).toBe("publish: drift escape.html\n");
    expect(result.stderr).toBe("");
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
    expect(snapshot(preview)).toEqual(previewBefore);
    expect(readFileSync(join(parent, "outside.html"), "utf8")).toBe(outsideBefore);
  });

  it("B3-1 refuses publish with a directory symlink under docs and writes no file", () => {
    const { parent, root } = nestedRepoFixture("b3-1-publish-dir");
    mkdirSync(join(parent, "outside-dir"), { recursive: true });
    writeFileSync(join(parent, "outside-dir", "secret.txt"), "secret\n");
    symlinkSync("../../outside-dir", join(root, "docs", "dirlink"), "dir");
    writeDocsBase(root);
    const preview = previewFolder(root);
    writeFileSync(join(preview, "real-work.html"), "<html>page</html>\n");
    writeFileSync(join(preview, "real-work.json"), "{}\n");
    writeApproval(root, approvedHashes(root, ["real-work.html", "real-work.json"]));
    const docsBefore = snapshot(join(root, "docs"));
    const previewBefore = snapshot(preview);
    const secretBefore = readFileSync(join(parent, "outside-dir", "secret.txt"), "utf8");
    const result = runPublish(root);
    expect(result.status, `B3-1 publish status: ${result.status}`).toBe(2);
    expect(result.stdout).toBe("publish: drift dirlink\n");
    expect(result.stderr).toBe("");
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
    expect(snapshot(preview)).toEqual(previewBefore);
    expect(readFileSync(join(parent, "outside-dir", "secret.txt"), "utf8"))
      .toBe(secretBefore);
    expect(existsSync(join(root, "docs", "real-work.html"))).toBe(false);
  });

  it("A4-3 refuses publish with an unreadable directory under docs without a stack trace", (ctx) => {
    if (isRoot) ctx.skip(ROOT_SKIP_REASON);
    const root = repoFixture("a4-3-lockdir");
    expect(runPreview(root).status).toBe(0);
    mkdirSync(join(root, "docs", "lockdir"));
    writeFileSync(join(root, "docs", "lockdir", "inner.txt"), "inner\n");
    writeApproval(root, approvedHashes(root, ["real-work.html", "real-work.json"]));
    const docsBefore = snapshot(join(root, "docs"));
    const previewBefore = snapshot(previewFolder(root));
    chmodSync(join(root, "docs", "lockdir"), 0o000);
    const result = runPublish(root);
    chmodSync(join(root, "docs", "lockdir"), 0o755);
    expect(result.status, `A4-3 status: ${result.status}`).toBe(2);
    expect(result.stdout).toBe("publish: drift lockdir\n");
    expect(result.stderr).toBe("");
    expect(snapshot(previewFolder(root))).toEqual(previewBefore);
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
    expect(existsSync(join(root, "docs", "real-work.html"))).toBe(false);
  });

  it("A4-1 refuses preview.sh with an unreadable file under docs without a traceback or a half-built folder", (ctx) => {
    if (isRoot) ctx.skip(ROOT_SKIP_REASON);
    const root = repoFixture("a4-1-locked");
    writeFileSync(join(root, "docs", "locked.txt"), "locked\n");
    const docsBefore = snapshot(join(root, "docs"));
    chmodSync(join(root, "docs", "locked.txt"), 0o000);
    const result = runPreview(root);
    chmodSync(join(root, "docs", "locked.txt"), 0o644);
    expect(result.status, `A4-1 status: ${result.status}`).toBe(2);
    expect(result.stdout).toBe("preview: unreadable docs/locked.txt\n");
    expect(result.stderr).toBe("");
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
    expect(existsSync(previewFolder(root))).toBe(false);
    expect(existsSync(join(root, ".tmp"))).toBe(false);
  });

  it("A4-1 keeps an existing preview folder byte-identical when a docs entry is unreadable", (ctx) => {
    if (isRoot) ctx.skip(ROOT_SKIP_REASON);
    const root = repoFixture("a4-1-existing");
    expect(runPreview(root).status).toBe(0);
    const preview = previewFolder(root);
    const indexBefore = readFileSync(join(preview, "index.html"), "utf8");
    writeFileSync(join(root, "docs", "index.html"), `${INDEX_HTML}<!-- later edit -->\n`);
    writeFileSync(join(root, "docs", "locked.txt"), "locked\n");
    const docsBefore = snapshot(join(root, "docs"));
    const previewBefore = snapshot(preview);
    chmodSync(join(root, "docs", "locked.txt"), 0o000);
    const result = runPreview(root);
    chmodSync(join(root, "docs", "locked.txt"), 0o644);
    expect(result.status, `A4-1 status: ${result.status}`).toBe(2);
    expect(result.stdout).toBe("preview: unreadable docs/locked.txt\n");
    expect(result.stderr).toBe("");
    expect(snapshot(preview)).toEqual(previewBefore);
    expect(readFileSync(join(preview, "index.html"), "utf8")).toBe(indexBefore);
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
  });

});

/**
 * Red tests for plan task 1.20: the UX findings U1, U3, and U4 of the
 * browser review `measure/runs/model_guide/ux-browser-2a9d421.json`. They
 * read the generated `real-work.html` in the preview folder.
 *
 * Pinned contracts:
 *
 * U1 (blocking): the SHA-256 values of the About this data footer clip at
 *   390 px when no element of their chain carries a wrap rule. The footer
 *   element that holds a SHA-256 must sit inside a chain that carries
 *   `overflow-wrap: anywhere` or `word-break: break-all`, either as an
 *   inline `style` attribute or as a class rule inside a `<style>` block of
 *   the generated page (test-strategy 13.5: U1 retargets the footer file
 *   list). Both forms pass. The fix needs no change under `docs/`.
 *
 * U3 (minor): every `.table-wrap` scroll box in the generated page carries
 *   `tabindex="0"`, `role="region"`, and a non-empty `aria-label`, so a
 *   keyboard user can scroll the tables and a screen reader names the box.
 *
 * U4 (nit): the nav link with `href="./real-work.html"` carries
 *   `aria-current="page"`, and no other link in the page carries
 *   `aria-current`.
 *
 * Out of scope: U2 (checker table width) and U5 (site-wide favicon 404).
 * They go to the phase acceptance as nonblocking items.
 */
describe("the UX fixes U1, U3, U4 of task 1.20", () => {
  const WRAP_DECL = /overflow-wrap\s*:\s*anywhere|word-break\s*:\s*break-all/;

  function generatedPage(tag: string): string {
    const root = repoFixture(tag);
    const result = runPreview(root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    return readFileSync(join(previewFolder(root), "real-work.html"), "utf8");
  }

  /** The About this data footer and the open tag that starts it: the chain
   * of elements around a footer SHA-256 value. */
  function footerChain(page: string): string[] {
    const at = page.indexOf('data-mg="about-footer"');
    expect(at, "the page holds the About this data footer").toBeGreaterThan(-1);
    const end = page.indexOf("</body>", at);
    expect(end, "the footer closes").toBeGreaterThan(at);
    const footer = page.slice(at, end);
    const footerTag = page.slice(page.lastIndexOf("<", at), page.indexOf(">", at) + 1);
    const tags = footer.match(/<[a-zA-Z][^>]*>/g) ?? [];
    return [footerTag, ...tags];
  }

  function styleCarriesWrap(tag: string): boolean {
    const m = tag.match(/\bstyle\s*=\s*"([^"]*)"/);
    return m !== null && WRAP_DECL.test(m[1]);
  }

  function classesOf(tag: string): string[] {
    const m = tag.match(/\bclass\s*=\s*"([^"]*)"/);
    return m ? m[1].split(/\s+/).filter(Boolean) : [];
  }

  function styleBlocks(page: string): string[] {
    return [...page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  }

  /** True when a `<style>` block of the page holds a rule whose selector
   * names `.cls` and whose body carries the wrap declaration. */
  function classRuleCarriesWrap(page: string, cls: string): boolean {
    for (const css of styleBlocks(page)) {
      for (const chunk of css.split("}")) {
        const brace = chunk.indexOf("{");
        if (brace < 0) continue;
        const selector = chunk.slice(0, brace);
        const body = chunk.slice(brace + 1);
        if (selector.includes(`.${cls}`) && WRAP_DECL.test(body)) return true;
      }
    }
    return false;
  }

  it("U1: the footer chain that holds a SHA-256 value carries a wrap rule", () => {
    const page = generatedPage("u1");
    const at = page.indexOf('data-mg="about-footer"');
    const end = page.indexOf("</body>", at);
    const footer = page.slice(at, end);
    const shaAt = footer.search(/[0-9a-f]{64}/);
    expect(shaAt, "the footer holds a SHA-256 value").toBeGreaterThan(-1);
    const chain = footerChain(page);
    const inline = chain.some(styleCarriesWrap);
    const viaClass = chain.some((tag) =>
      classesOf(tag).some((cls) => classRuleCarriesWrap(page, cls)),
    );
    expect(
      inline || viaClass,
      "U1: an element around a footer SHA-256 must carry `overflow-wrap: anywhere` " +
        `or \`word-break: break-all\`. Chain: ${chain.join(" ")}`,
    ).toBe(true);
  });

  it("U3: every .table-wrap box carries tabindex, role, and a non-empty aria-label", () => {
    const page = generatedPage("u3");
    const tags = page.match(/<[a-zA-Z][^>]*class="[^"]*\btable-wrap\b[^"]*"[^>]*>/g) ?? [];
    expect(tags.length, "the page holds the table-wrap scroll boxes").toBeGreaterThanOrEqual(6);
    for (const tag of tags) {
      expect(tag, `U3 tabindex missing: ${tag}`).toMatch(/\btabindex\s*=\s*"0"/);
      expect(tag, `U3 role missing: ${tag}`).toMatch(/\brole\s*=\s*"region"/);
      expect(tag, `U3 aria-label missing or empty: ${tag}`).toMatch(
        /\baria-label\s*=\s*"[^"]+"/,
      );
    }
  });

  it('U4: the ./real-work.html nav link carries aria-current="page" and no other link does', () => {
    const page = generatedPage("u4");
    const anchors = page.match(/<a\b[^>]*>/g) ?? [];
    const realWork = anchors.filter((tag) => /\bhref\s*=\s*"\.\/real-work\.html"/.test(tag));
    expect(realWork.length, "the nav holds exactly one ./real-work.html link").toBe(1);
    expect(realWork[0], `U4 aria-current missing: ${realWork[0]}`).toMatch(
      /\baria-current\s*=\s*"page"/,
    );
    const others = anchors.filter(
      (tag) =>
        /\baria-current\b/.test(tag) && !/\bhref\s*=\s*"\.\/real-work\.html"/.test(tag),
    );
    expect(others, `U4 aria-current on other links: ${others.join(" ")}`).toEqual([]);
  });
});

/**
 * Red tests for plan task 2.1, phase 2: the print-audit block (spec D17,
 * FR-5, T1, T11, N4) and the four page guards of PA2-1 (G1 to G4).
 *
 * PA2-1 is the accepted finding of
 * `measure/runs/model_guide/phase-acceptance-9cb95b6.json`. It says that no
 * test asserted the generated date, the coverage numbers, the `few runs`
 * mark, or the ` (n=...)` run count in the generated `real-work.html`. The
 * behavior exists, so G1 to G4 pass at the Phase 1 base. Their proof is
 * their falsification condition: a hardcoded date, a dropped thousands
 * comma, a missed mark, or a dropped count.
 *
 * The print-audit cases fail at the Phase 1 base: the Phase 1 code has no
 * print-audit tool and no print-audit block.
 *
 * The print-audit block is built from `fixtures/print-audit/` through the
 * planned tool `harness/model-guide/print-audit.ts`, which writes
 * `harness/model-guide/data/print-audit-2026-11.json` (spec FR-5). Task
 * 2.4a re-pins the fixture to the real OD6 key shape: `routes` maps a
 * short key to a route name, a row holds `severity` plus one string per
 * route short key, and a checklist item holds `item` and `text`.
 * `fixtures/page-guard/` is the page B export behind G1 to G4. No test
 * reads the real hand-off file, the real export, the real docs/, a model,
 * the network, or the private folder.
 */
describe("the print-audit block and the PA2-1 page guards of task 2.1", () => {
  const PRINT_AUDIT_DIR = join(import.meta.dirname, "fixtures", "print-audit");
  const PAGE_GUARD_DIR = join(import.meta.dirname, "fixtures", "page-guard");
  const PRINT_AUDIT_TS = join(SOURCE, "print-audit.ts");
  const PLACEHOLDER = "Error types: not yet received.";
  // Ruling D17: the fixture is the real OD6 key shape, so the hostile name
  // is a route name and the hostile text is a checklist item text.
  const HOSTILE_ROUTE = '"><img src=x onerror=alert(1)>';
  const HOSTILE_ITEM_TEXT = 'the label reads "><img src=x onerror=alert(1)>';
  const HOSTILE_RAW = "<img src=x onerror=alert(1)>";

  /** Python `html.escape(s)`, the escape preview.sh uses. */
  function escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#x27;");
  }

  function stagePageGuard(root: string): string {
    const dir = join(root, "fixture-page-guard");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "real-work-page.json"),
      readFileSync(join(PAGE_GUARD_DIR, "real-work-page.json")),
    );
    writeFileSync(join(dir, "MANIFEST.txt"), readFileSync(join(PAGE_GUARD_DIR, "MANIFEST.txt")));
    return join(dir, "real-work-page.json");
  }

  /** Write the print-audit data file of the temp repo through the tool. */
  function stagePrintAuditData(root: string): void {
    if (!existsSync(PRINT_AUDIT_TS)) {
      throw new Error(
        `production file is missing: ${PRINT_AUDIT_TS} (Phase 1 has no print-audit tool)`,
      );
    }
    const dir = join(root, "fixture-print-audit");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "print-audit-mini.json"),
      readFileSync(join(PRINT_AUDIT_DIR, "print-audit-mini.json")),
    );
    writeFileSync(join(dir, "MANIFEST.txt"), readFileSync(join(PRINT_AUDIT_DIR, "MANIFEST.txt")));
    const tsx = join(root, "harness", "node_modules", ".bin", "tsx");
    const out = join(root, "harness", "model-guide", "data");
    const result = spawnSync(
      tsx,
      ["model-guide/print-audit.ts", "--input", join(dir, "print-audit-mini.json"), "--out", out],
      { cwd: join(root, "harness"), env: env(), encoding: "utf8", timeout: 60_000 },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(existsSync(join(out, "print-audit-2026-11.json"))).toBe(true);
  }

  interface Snapshot {
    page: string;
    audit?: any;
    auditSection?: string;
  }

  let pageGuardCache: Snapshot | null = null;
  let blockCache: Snapshot | null = null;

  /** The page built once from the page B fixture (G1 to G4, G6 to G10). */
  function pageGuardSnapshot(): Snapshot {
    if (!pageGuardCache) {
      const root = repoFixture("page-b-base");
      const result = runPreview(root);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      pageGuardCache = {
        page: readFileSync(join(previewFolder(root), "real-work.html"), "utf8"),
      };
    }
    return pageGuardCache;
  }

  /** The generated page that holds the print-audit block (T1, T11, N4). */
  function blockSnapshot(): Snapshot {
    if (!blockCache) {
      const root = repoFixture("print-audit-block");
      stagePrintAuditData(root);
      const result = runPreview(root);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const preview = previewFolder(root);
      const page = readFileSync(join(preview, "real-work.html"), "utf8");
      const at = page.indexOf("<h2>Print audit</h2>");
      expect(at, "the page holds a Print audit heading").toBeGreaterThan(-1);
      const start = page.lastIndexOf("<section", at);
      const end = page.indexOf("</section>", at);
      expect(end, "the Print audit section closes").toBeGreaterThan(at);
      blockCache = {
        page,
        audit: JSON.parse(
          readFileSync(
            join(root, "harness", "model-guide", "data", "print-audit-2026-11.json"),
            "utf8",
          ),
        ),
        auditSection: page.slice(start, end + "</section>".length),
      };
    }
    return blockCache;
  }

  function auditFixture(): any {
    return JSON.parse(readFileSync(join(PRINT_AUDIT_DIR, "print-audit-mini.json"), "utf8"));
  }

  function typeHistogram(rows: any[]): Record<string, number> {
    // Ruling D17: an error type is a severity class with the count of rows
    // of that class.
    const out: Record<string, number> = {};
    for (const row of rows) out[row.severity] = (out[row.severity] ?? 0) + 1;
    return out;
  }

  function bodyRows(section: string): string[][] {
    const body = section.split("</thead>")[1] ?? "";
    const rows = [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)];
    return rows.map((match) => {
      const cells = [...match[1].matchAll(/<td>([\s\S]*?)<\/td>/g)];
      return cells.map((cell) => cell[1]);
    });
  }

  function mainSection(page: string, heading: string): string {
    const at = page.indexOf(`<h2>${heading}</h2>`);
    expect(at, `the page holds a ${heading} heading`).toBeGreaterThan(-1);
    const end = page.indexOf("</section>", at);
    expect(end).toBeGreaterThan(at);
    return page.slice(at, end);
  }

  function workTypeSection(page: string, name: string): string {
    const at = page.indexOf(`<h3>${escapeHtml(name)}</h3>`);
    expect(at, `the page holds the ${name} work type`).toBeGreaterThan(-1);
    const nextHeading = page.indexOf("<h3>", at + 1);
    const nextSection = page.indexOf("</section>", at);
    const end = nextHeading < 0 || nextSection < nextHeading ? nextSection : nextHeading;
    return page.slice(at, end);
  }

  /**
   * Task 4.1a — page B layout, spec D16 "Layout (PM P1 2026-11-16)".
   *
   * These cases assert the generated HTML only. They pin these `data-mg`
   * hooks, which the page render must put into `real-work.html`:
   *   data-mg="top-block"     the recommendation block, before the first
   *                           table; one line per role group and work type;
   *                           each line carries data-mg="pick" (plain text:
   *                           group label, model, whole %, result count) and
   *                           data-model-key="<model key>". With no row of
   *                           10 or more results, the line says "no pick yet".
   *   data-mg="default-table" on each visible <table>. Its <thead> holds the
   *                           default columns only.
   *   data-model-key="<key>"  on each data <tr> of a default table and of a
   *                           too-few group; data-rank="<n>" only on ranked
   *                           rows, never on a row with fewer than 10 results.
   *   data-mg="model-name"    on the <td> that holds the plain model name.
   *   data-mg="too-few"       a <details> group labelled "Too few runs to
   *                           rank" under a table, holding the rows with
   *                           fewer than 10 results and no data-rank.
   *   data-mg="more-columns"  a <details> toggle whose summary says "More
   *                           columns" and whose body lists the extra column
   *                           names (one toggle per table or one page-wide).
   *   data-mg="work-type"     the wrapper of one work type: a <details>
   *                           section or a tab with role="tab"/"tabpanel".
   *   data-mg="about-footer"  the "About this data" footer after the tables;
   *                           it holds the source line and the coverage block.
   */
  function hookStart(page: string, hook: string): number {
    const at = page.indexOf(`data-mg="${hook}"`);
    expect(at, `the page holds data-mg="${hook}"`).toBeGreaterThan(-1);
    return at;
  }

  function hookRegion(page: string, hook: string, endMarker: string): string {
    const at = hookStart(page, hook);
    const end = page.indexOf(endMarker, at);
    expect(end, `data-mg="${hook}" reaches ${endMarker}`).toBeGreaterThan(at);
    return page.slice(at, end);
  }

  function headerTexts(table: string): string[] {
    return [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) =>
      m[1].replace(/<[^>]*>/g, "").trim(),
    );
  }

  function defaultTables(page: string): string[] {
    return [...page.matchAll(/<table\b[^>]*data-mg="default-table"[^>]*>[\s\S]*?<\/table>/g)].map(
      (m) => m[0],
    );
  }

  interface RowProbe {
    key: string;
    rank: string | null;
    cells: string[];
  }

  function rowProbes(table: string): RowProbe[] {
    const out: RowProbe[] = [];
    for (const m of table.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g)) {
      const key = m[1].match(/\bdata-model-key="([^"]*)"/)?.[1];
      if (key === undefined) continue;
      out.push({
        key,
        rank: m[1].match(/\bdata-rank="([^"]*)"/)?.[1] ?? null,
        cells: [...m[2].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((c) =>
          c[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(),
        ),
      });
    }
    return out;
  }

  function fewGroupOf(section: string): string {
    const at = section.indexOf('data-mg="too-few"');
    expect(at, "the section holds a Too few runs to rank group").toBeGreaterThan(-1);
    const open = section.lastIndexOf("<details", at);
    const end = section.indexOf("</details>", at);
    expect(end, "the group closes").toBeGreaterThan(at);
    return section.slice(open < 0 ? at : open, end + "</details>".length);
  }

  function pickItems(page: string): Array<{ key: string | null; text: string }> {
    const out: Array<{ key: string | null; text: string }> = [];
    const re = /<([a-zA-Z][\w-]*)\b([^>]*)>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(page)) !== null) {
      if (!/\bdata-mg="pick"/.test(m[2])) continue;
      const name = m[1];
      const close = page.indexOf(`</${name}>`, re.lastIndex);
      if (close < 0) continue;
      const inner = page.slice(re.lastIndex, close);
      out.push({
        key: m[2].match(/\bdata-model-key="([^"]*)"/)?.[1] ?? null,
        text: inner.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(),
      });
      re.lastIndex = close + name.length + 3;
    }
    return out;
  }

  /** A page built from the staged page B fixture after a mutation of the
   * outcomes rows. The manifest is rebuilt, so the input check passes on
   * the changed synthetic bytes. */
  function pageGuardVariant(tag: string, mutate: (rows: any[]) => void): Snapshot {
    const root = repoFixture(tag);
    stageFixture(root, mutate);
    const result = runPreview(root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    return {
      page: readFileSync(join(previewFolder(root), "real-work.html"), "utf8"),
    };
  }

  interface Probe {
    key: string;
    rank: string | null;
    cells: string[];
  }

  function unescapeHtml(value: string): string {
    return value
      .replaceAll("&quot;", '"')
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&#x27;", "'")
      .replaceAll("&amp;", "&");
  }

  /** Data rows of a region with their `data-model-key`, `data-rank`, and
   * their cell texts. The key is HTML-unescaped, so a hostile key compares
   * against its raw text. */
  function probesOf(region: string): Probe[] {
    const out: Probe[] = [];
    for (const m of region.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g)) {
      const raw = m[1].match(/\bdata-model-key="([^"]*)"/)?.[1];
      if (raw === undefined) continue;
      out.push({
        key: unescapeHtml(raw),
        rank: m[1].match(/\bdata-rank="([^"]*)"/)?.[1] ?? null,
        cells: [...m[2].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((cell) =>
          cell[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(),
        ),
      });
    }
    return out;
  }

  interface TopPick {
    role: string | null;
    key: string | null;
    text: string;
    none: boolean;
  }

  /** The pick lines of the top block, in document order. */
  function topPicksOf(page: string): TopPick[] {
    const at = page.indexOf('data-mg="top-block"');
    expect(at, "the page holds the top block").toBeGreaterThan(-1);
    const end = page.indexOf("</section>", at);
    const region = page.slice(at, end > at ? end : page.length);
    const out: TopPick[] = [];
    const re = /<([a-zA-Z][\w-]*)\b([^>]*\bdata-mg="pick"[^>]*)>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(region)) !== null) {
      const tag = m[1];
      const close = region.indexOf(`</${tag}>`, re.lastIndex);
      expect(close, "a pick line closes").toBeGreaterThan(re.lastIndex);
      const inner = region.slice(re.lastIndex, close);
      const text = inner.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
      out.push({
        role: m[2].match(/\bdata-role="([^"]*)"/)?.[1] ?? null,
        key: m[2].match(/\bdata-model-key="([^"]*)"/)?.[1] ?? null,
        text,
        none: text.endsWith(": no pick yet"),
      });
      re.lastIndex = close + tag.length + 3;
    }
    return out;
  }

  /** The text of one `data-mg` hook element inside a region. */
  function hookTextOf(region: string, hook: string): string {
    const at = region.indexOf(`data-mg="${hook}"`);
    expect(at, `the region holds data-mg="${hook}"`).toBeGreaterThan(-1);
    const open = region.lastIndexOf("<", at);
    const tag = region.slice(open, region.indexOf(">", at) + 1);
    const tagName = tag.match(/^<([a-zA-Z][\w-]*)/)?.[1];
    expect(tagName, `the ${hook} hook sits on an element`).toBeTruthy();
    const bodyStart = region.indexOf(">", at) + 1;
    const close = region.indexOf(`</${tagName}>`, bodyStart);
    expect(close, `the ${hook} element closes`).toBeGreaterThan(bodyStart);
    return region.slice(bodyStart, close).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  }

  /** One labeled integer of the About this data footer (A3). */
  function footerNumber(page: string, hook: string): number {
    const text = hookTextOf(hookRegion(page, "about-footer", "</body>"), hook);
    const match = text.match(/^(\d+)$/);
    expect(match, `${hook} holds one integer, got "${text}"`).toBeTruthy();
    return Number(match![1]);
  }

  const PRODUCER_G_COLUMNS = [
    "Model",
    "Tasks",
    "First-round accept %",
    "Rework",
    "Cleanup %",
    "Tokens per accepted task",
  ];
  const CHECKER_G_COLUMNS = ["Model", "Runs", "Pass %", "Findings per run", "Escapes", "Net score"];

  it("G1: the footer lists the three files with their SHA-256 values and the read date, below the first table", () => {
    const { page } = pageGuardSnapshot();
    const firstTable = page.indexOf("<table");
    expect(firstTable, "the page holds a table").toBeGreaterThan(-1);
    const footerAt = page.indexOf('data-mg="about-footer"');
    expect(footerAt, "the page holds the About this data footer").toBeGreaterThan(-1);
    expect(footerAt, "the footer sits below the first table").toBeGreaterThan(firstTable);
    const footer = hookRegion(page, "about-footer", "</body>");
    expect(footer, "the footer is named About this data").toContain("About this data");
    const shas = footer.match(/[0-9a-f]{64}/g) ?? [];
    for (const name of [OUTCOMES_NAME, AA_NAME, ALLOWED_NAME]) {
      expect(footer, `the footer lists ${name}`).toContain(name);
      expect(shas, `the footer holds the SHA-256 of ${name}`).toContain(sha256(join(PAGE_B, name)));
    }
    expect(footer, "the footer holds the read date").toContain(DATE);
  });

  it("G2: the coverage numbers sit in the same About this data footer", () => {
    const { page } = pageGuardSnapshot();
    const footer = hookRegion(page, "about-footer", "</body>");
    expect(footerNumber(page, "footer-rows"), "row count").toBe(41);
    expect(footerNumber(page, "footer-routes"), "route count").toBe(36);
    expect(footerNumber(page, "footer-unknown-rows"), "unknown rows").toBe(2);
    const share = hookTextOf(footer, "footer-unknown-share");
    expect(share, "the share is a labeled percent").toMatch(/^(\d+(?:\.\d)?)\s*%$/);
    expect(Number(share.match(/^(\d+(?:\.\d)?)/)![1]), "the unknown share").toBe(4.9);
    expect(hookTextOf(footer, "footer-read-date"), "the read date").toBe(DATE);
    expect(hookTextOf(footer, "footer-export-date"), "the export date").toBe(DATE);
    expect(footer, "the footer holds the merge method note").toContain(METHOD_NOTE);
  });

  it("G3: a row below the minimum of 5 sits in Too few tasks, with no rank, never in the ranked table", () => {
    const { page } = pageGuardSnapshot();
    expect(page, "the old group label is gone").not.toContain("Too few runs to rank");
    const groups: Array<[string, string[], string[]]> = [
      [
        "Producer roles",
        [
          "t1/prod-evil",
          "t1/prod-eight",
          "t1/prod-strat",
          "t1/prod-one",
          "t2/prod-two",
          "t1/prod-four",
          "t1/prod-three",
          "t1/prod-two",
          "t1/prod-nine",
          "t1/prod-six",
        ],
        ["t1/prod-five", "t1/prod-seven", "t1/prod-tiny"],
      ],
      [
        "Checker roles",
        [
          "t1/gate-nine",
          "t1/gate-one",
          "t1/gate-two",
          "t1/gate-four",
          "opencode/gate-three-free",
          "t1/gate-seven",
          "t1/gate-six",
          "t1/gate-five",
          "t1/gate-fourteen",
          "t1/gate-eight",
          "t1/gate-zeta",
          "t1/__proto__",
          't1/"><img src=x onerror=alert(1)>',
        ],
        ["t1/gate-eleven", "t1/gate-twelve", "t1/gate-variant"],
      ],
    ];
    for (const [heading, expectedRanked, expectedFew] of groups) {
      const section = mainSection(page, heading);
      const ranked = probesOf(section).filter((row) => row.rank !== null);
      expect(ranked.map((row) => row.key), `${heading} ranked rows`).toEqual(expectedRanked);
      for (const row of ranked) {
        expect(Number.isInteger(Number(row.rank)), `${heading} rank ${row.rank} is an integer`)
          .toBe(true);
      }
      const fewGroup = fewGroupOf(section);
      expect(fewGroup, `${heading} group label`).toContain("Too few tasks");
      const few = probesOf(fewGroup);
      expect(few.map((row) => row.key).slice().sort(), `${heading} too-few rows`)
        .toEqual(expectedFew.slice().sort());
      for (const row of few) expect(row.rank, `${row.key} has no rank`).toBeNull();
      for (const key of expectedFew) {
        expect(ranked.some((row) => row.key === key), `${key} is not ranked`).toBe(false);
      }
    }
  });

  it("G4: a rate is a whole percent with no (n=...), an empty value is a dash, and the count columns hold the counts", () => {
    const { page } = pageGuardSnapshot();
    let dashSeen = false;
    const producer = mainSection(page, "Producer roles");
    const pHeaders = headerTexts(defaultTables(producer)[0]);
    const pAccept = pHeaders.indexOf("First-round accept %");
    const pTasks = pHeaders.indexOf("Tasks");
    expect(pAccept, "the producer table has a first-round column").toBeGreaterThan(-1);
    expect(pTasks, "the producer table has a Tasks column").toBeGreaterThan(-1);
    for (const row of probesOf(producer)) {
      const rate = row.cells[pAccept] ?? "";
      if (rate === "\u2013") {
        dashSeen = true;
        continue;
      }
      expect(rate, `${row.key} accept % is a whole percent`).toMatch(/^\d+\s*%$/);
      expect(rate, `${row.key} accept % has no (n=...)`).not.toContain("(n=");
      expect(row.cells[pTasks], `${row.key} Tasks holds a count`).toMatch(/^\d+$/);
    }
    const checker = mainSection(page, "Checker roles");
    const cHeaders = headerTexts(defaultTables(checker)[0]);
    const cPass = cHeaders.indexOf("Pass %");
    const cRuns = cHeaders.indexOf("Runs");
    expect(cPass, "the checker table has a Pass % column").toBeGreaterThan(-1);
    expect(cRuns, "the checker table has a Runs column").toBeGreaterThan(-1);
    for (const row of probesOf(checker)) {
      const rate = row.cells[cPass] ?? "";
      expect(rate, `${row.key} pass % is a whole percent`).toMatch(/^\d+\s*%$/);
      expect(rate, `${row.key} pass % has no (n=...)`).not.toContain("(n=");
      expect(row.cells[cRuns], `${row.key} Runs holds a count`).toMatch(/^\d+$/);
    }
    expect(dashSeen, "the page shows the dash for an empty value").toBe(true);
  });

  it("G6: each top line starts with its role label and a colon, and each line without a pick shows one of the four causes", () => {
    const { page } = pageGuardSnapshot();
    const picks = topPicksOf(page);
    expect(picks, "one line for each of the ten roles").toHaveLength(10);
    // The visible text of every line (spec D16 Top block, orchestrator
    // 2026-11-18): "<role label>: ..." for a pick and for "no pick yet".
    const texts: Record<string, string> = {
      red: "Red: prod-one 100 % in this role, 5 tasks",
      green: "Green: prod-one 62 % in this role, 15 tasks",
      coder: "Coder: no pick yet",
      "review-a": "Review A: gate-one 90 % pass in this role, 10 runs, net 41.5",
      "review-b": "Review B: no pick yet",
      "review-c": "Review C: gate-seven 100 % pass in this role, 5 runs, net 20",
      adversarial: "Adversarial: no pick yet",
      acceptance: "Acceptance: no pick yet",
      "phase-acceptance": "Phase acceptance: gate-two 80 % pass in this role, 5 runs, net 33.3",
      "final-acceptance": "Final acceptance: no pick yet",
    };
    for (const pick of picks) {
      const role = pick.role as string;
      expect(texts[role], `a text for the role ${role}`).toBeTruthy();
      expect(pick.text, `${role} visible line text`).toBe(texts[role]);
    }
    const none = picks.filter((pick) => pick.none);
    expect(
      none.map((pick) => pick.role),
      "five lines say no pick yet",
    ).toEqual(["coder", "review-b", "adversarial", "acceptance", "final-acceptance"]);
    for (const pick of none) {
      expect(pick.key, `${pick.role} line carries no model key`).toBeNull();
    }
    // The causes in the fixture: not allowed and not for verdicts rank in
    // the table but never pick, and a below-minimum net score stops Review B.
    const checker = probesOf(mainSection(page, "Checker roles"));
    expect(
      checker.some((row) => row.key === "t1/gate-nine" && row.rank !== null),
      "a not-allowed row ranks in the table",
    ).toBe(true);
    expect(
      checker.some((row) => row.key === "t1/gate-eight" && row.rank !== null),
      "a not-for-verdicts row ranks in the table",
    ).toBe(true);
    expect(
      checker.some((row) => row.key === "t1/gate-one" && row.rank !== null),
      "gate-one ranks in the table",
    ).toBe(true);
    const producer = probesOf(mainSection(page, "Producer roles"));
    expect(
      producer.some((row) => row.key === "t1/prod-eight" && row.rank !== null),
      "a not-allowed producer row ranks in the table",
    ).toBe(true);
  });

  it("G7: the two default tables hold exactly the pinned columns", () => {
    const { page } = pageGuardSnapshot();
    expect(
      headerTexts(defaultTables(mainSection(page, "Producer roles"))[0]),
      "the producer default columns",
    ).toEqual(PRODUCER_G_COLUMNS);
    expect(
      headerTexts(defaultTables(mainSection(page, "Checker roles"))[0]),
      "the checker default columns",
    ).toEqual(CHECKER_G_COLUMNS);
  });

  it("G8: the remaining columns sit behind a More columns toggle", () => {
    const { page } = pageGuardSnapshot();
    const more = hookRegion(page, "more-columns", "</details>");
    expect(more, "the toggle is labelled More columns").toContain("More columns");
    for (const name of ["Routes", "Roles", "Accepted", "AA net score"]) {
      expect(more, `the toggle holds ${name}`).toContain(name);
    }
    for (const table of defaultTables(page)) {
      const headers = headerTexts(table);
      for (const name of ["Routes", "Roles", "Accepted", "AA net score"]) {
        expect(headers, `the default table hides ${name}`).not.toContain(name);
      }
    }
  });

  it("G10: a plain model name comes from model-names.json and an unnamed key drops the plan prefix", () => {
    const namesFile = join(SOURCE, "data", "model-names.json");
    expect(existsSync(namesFile), "the committed model-names.json exists").toBe(true);
    const names = JSON.parse(readFileSync(namesFile, "utf8"));
    const namedKey = "kimi-code-plan-cn/kimi-for-coding";
    expect(typeof names[namedKey], "model-names.json names the Kimi key").toBe("string");
    const { page } = pageGuardVariant("names", (rows) => {
      for (const row of rows) {
        if (row.route === "t1/prod-five") row.route = namedKey;
        if (row.route === "t1/prod-six") row.route = "opencode-go/synthetic-unknown";
      }
    });
    const modelCells = [...page.matchAll(/<td\b[^>]*data-mg="model-name"[^>]*>([\s\S]*?)<\/td>/g)].map(
      (m) => m[1].replace(/<[^>]*>/g, "").trim(),
    );
    expect(modelCells.length, "the rows hold plain model-name cells").toBeGreaterThan(0);
    expect(
      modelCells.some((cell) => cell.includes(escapeHtml(names[namedKey]))),
      "the named key shows its plain name",
    ).toBe(true);
    expect(
      modelCells.some((cell) => cell.includes(namedKey)),
      "the named key does not show its raw route key in the model cell",
    ).toBe(false);
    expect(
      modelCells.some((cell) => cell.includes("synthetic-unknown")),
      "an unnamed key shows the key without its plan prefix",
    ).toBe(true);
    expect(
      modelCells.some((cell) => cell.includes("opencode-go/synthetic-unknown")),
      "an unnamed key does not show the provider prefix",
    ).toBe(false);
  });

  it("T1: the print-audit block shows 52, 13, both results, the bias note, and the calibration line", () => {
    const { auditSection } = blockSnapshot();
    const section = auditSection as string;
    const fixture = auditFixture();
    expect(section).toMatch(/52\s+(errors?|rows?)|(errors?|rows?)\s*[:\-]?\s*52/i);
    expect(section).toMatch(/13\s+blockers?|blockers?\s*[:\-]?\s*13/i);
    expect(section).toContain("11 of 13");
    expect(section).toContain("13 of 13");
    expect(section).toContain("k3.1-pro");
    expect(section).toContain("Sonnet 5.5");
    const notePattern = fixture.note
      .trim()
      .split(/\s+/)
      .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+");
    expect(section, "the bias note reaches the block").toMatch(new RegExp(notePattern));
    expect(section).toMatch(/one\s+calibration\s+run/i);
    expect(section).toMatch(/not\s+a\s+rank/i);
  });

  it("T11: the hostile route name and checklist text reach the HTML escaped, and __proto__ adds no route", () => {
    const { auditSection, audit } = blockSnapshot();
    const section = auditSection as string;
    const fixture = auditFixture();
    // The hostile route name shows in the routes line with its result.
    expect(section).toContain(`${escapeHtml(HOSTILE_ROUTE)} ${fixture.summary.bad01.blockers_found} of ${fixture.summary.key.blockers}`);
    expect(section).toContain(escapeHtml(HOSTILE_ITEM_TEXT));
    expect(section, "no raw img tag").not.toContain(HOSTILE_RAW);
    expect(section).toContain("__proto__");
    // Output route keys are the route names of the fixture (the values of
    // the short keys). The plain `__proto__` summary key adds no route.
    expect(Object.keys(audit.routes).sort()).toEqual(
      Object.values(fixture.routes).slice().sort(),
    );
    expect(Object.keys(audit.routes)).not.toContain("__proto__");
    expect(audit.errors.map((row: any) => row.id)).not.toContain("__proto__");
    expect(audit.errors).toHaveLength(52);
    for (const route of Object.values(fixture.routes) as string[]) {
      expect(section.includes(escapeHtml(route)), `route ${route} shows in the block`).toBe(true);
    }
    expect(
      section.match(/\d+\s+of\s+\d+/g),
      "the block holds one result per route",
    ).toHaveLength(Object.keys(fixture.routes).length);
  });

  it("N4: the block shows every error type with its count and no placeholder line", () => {
    const { auditSection, audit } = blockSnapshot();
    const section = auditSection as string;
    expect(section).not.toContain(PLACEHOLDER);
    const expected = typeHistogram(auditFixture().errors);
    // Ruling D17: the error types are the three severity classes.
    expect(Object.keys(audit.error_types).sort()).toEqual(["blocker", "major", "minor"]);
    expect(Object.keys(audit.error_types).sort()).toEqual(Object.keys(expected).sort());
    for (const [type, count] of Object.entries(expected)) {
      expect(audit.error_types[type], `type ${type}`).toBe(count);
      const escaped = escapeHtml(type);
      const at = section.indexOf(escaped);
      expect(at, `the block shows the type ${type}`).toBeGreaterThan(-1);
      const window = section.slice(Math.max(0, at - 40), at + escaped.length + 60);
      expect(window, `the count of ${type}`).toMatch(new RegExp(`\\b${count}\\b`));
    }
  });

  it("T1: the block rows hold the real row shape and the per-route result of each row", () => {
    const { auditSection, audit } = blockSnapshot();
    const section = auditSection as string;
    const fixture = auditFixture();
    const routeKeys = Object.keys(fixture.routes);
    expect(audit.errors).toHaveLength(52);
    for (const [index, row] of audit.errors.entries()) {
      const source = fixture.errors[index];
      expect(Object.keys(row).sort(), `row ${index} fields`).toEqual(
        ["checklist", "id", "results", "severity"],
      );
      expect(row.severity, `row ${index} severity`).toBe(source.severity);
      expect(row.results, `row ${index} per-route results`).toEqual(
        routeKeys.map((key) => source[key]),
      );
      expect(row.checklist, `row ${index} checklist`).toHaveLength(source.checklist.length);
      for (const [i, item] of row.checklist.entries()) {
        expect(Object.keys(item).sort(), `row ${index} item ${i} fields`).toEqual(
          ["code", "text"],
        );
        expect(item.code, `row ${index} item ${i} code`).toBe(source.checklist[i].item);
        expect(item.text, `row ${index} item ${i} text`).toBe(source.checklist[i].text);
      }
    }
    // The page shows the first row with its item code and text and with
    // the result of each run.
    const first = fixture.errors[0];
    const li = section.match(/<li>E001 [\s\S]*?<\/li>/)?.[0] ?? "";
    expect(li, "the E001 row reaches the block").not.toBe("");
    expect(li).toContain(
      `${escapeHtml(first.checklist[0].item)}: ${escapeHtml(first.checklist[0].text)}`,
    );
    expect(li).toContain(
      `results ${routeKeys.map((key) => first[key]).join(", ")}`,
    );
  });

  it("P2U1-1: the block shows summary.bias_note when the top-level note differs from it", () => {
    const { auditSection } = blockSnapshot();
    const section = auditSection as string;
    const fixture = auditFixture();
    // The precondition of P2U1-1 (UX review b4fba01): the two notes are
    // different texts, so a block that renders only the top-level note
    // shows the scope note and hides the bias note.
    expect(fixture.note, "the fixture note is the scope note").not.toBe(
      fixture.summary.bias_note,
    );
    expect(
      section,
      "the bias note of summary reaches the print-audit block",
    ).toContain(fixture.summary.bias_note);
  });
});

/**
 * Review B round 2, P2B2-2 (`measure/runs/model_guide/review-b-3d42bf8.json`):
 * the `ls -1t | head -n 1` newest score file rule of `preview.sh` parses one
 * line per name, so a planted newest file whose name holds a newline steers
 * the pick to an older file. The pinned contract is the same one that
 * `update.test.ts` pins for `update.sh`: the truly newest file by
 * modification time wins. The run happens in a temp repo, and the temp repo
 * gets the real build and tests data files so that the overview table is
 * rendered at all.
 */
describe("review B round 2 (P2B2-2): the newline score name in preview.sh", () => {
  const GUIDE_FIXTURES = join(import.meta.dirname, "fixtures", "guide");

  /** A synthetic track A score file. A `complete` route with three
   * complete passes qualifies; an `incomplete` route never qualifies. */
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

  it("P2B2-2 preview: a newest score file whose name holds a newline does not steer the pick (the newest file by modification time wins)", () => {
    const root = repoFixture("newline-scores");
    // The temp repo of this file ships a placeholder benchmark and no tests
    // data file, and the overview table needs both (plus the print-audit
    // data file that populateRepo already copies).
    copyFileSync(
      join(GUIDE_FIXTURES, "benchmark-mini.json"),
      join(root, "docs", "assets", "data", "benchmark.json"),
    );
    copyFileSync(
      join(GUIDE_FIXTURES, "tracks-mini.json"),
      join(root, "docs", "assets", "data", "tracks.json"),
    );
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

    const result = runPreview(root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const page = JSON.parse(
      readFileSync(join(previewFolder(root), "model-guide.json"), "utf8"),
    );
    const row = page.rows.find((item: any) => item.kind === "Code review");
    expect(row, "the Code review row").toBeDefined();
    expect(
      row.pick,
      "the newest file by modification time wins; the newline name steers nothing",
    ).toBe("new-model");
    const index = readFileSync(join(previewFolder(root), "index.html"), "utf8");
    expect(index, "the page shows the same pick").toContain("new-model");
  });
});

/**
 * Red tests for plan task 4.1e: groups DS14 to DS21 and FX2 of the Data
 * source block (test-strategy 13.4). The cases read the generated
 * `real-work.html` through the `data-mg` hooks of section 13.6. FX2 runs
 * before the format check DS16 in this file (A4). The fixture is
 * `fixtures/page-b/` with the sentinel date 2026-10-20.
 */
describe("the Data source page groups DS14 to DS21 and FX2", () => {
  const DASH = "\u2013";
  const PRODUCER_COLUMNS = [
    "Model",
    "Tasks",
    "First-round accept %",
    "Rework",
    "Cleanup %",
    "Tokens per accepted task",
  ];
  const CHECKER_COLUMNS = ["Model", "Runs", "Pass %", "Findings per run", "Escapes", "Net score"];

  interface DsRow {
    key: string;
    rank: string | null;
    cells: string[];
  }

  function unescape(value: string): string {
    return value
      .replaceAll("&quot;", '"')
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&#x27;", "'")
      .replaceAll("&amp;", "&");
  }

  function sectionOf(page: string, heading: string): string {
    const at = page.indexOf(`<h2>${heading}</h2>`);
    expect(at, `the page holds a ${heading} heading`).toBeGreaterThan(-1);
    const end = page.indexOf("</section>", at);
    expect(end, `the ${heading} section closes`).toBeGreaterThan(at);
    return page.slice(at, end);
  }

  function headersOf(table: string): string[] {
    return [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) =>
      m[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(),
    );
  }

  function defaultTableOf(section: string, label: string): string {
    const m = section.match(/<table\b[^>]*data-mg="default-table"[^>]*>[\s\S]*?<\/table>/);
    expect(m, `${label} holds a default table`).toBeTruthy();
    return m![0];
  }

  function rowsOf(region: string): DsRow[] {
    const out: DsRow[] = [];
    for (const m of region.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g)) {
      const raw = m[1].match(/\bdata-model-key="([^"]*)"/)?.[1];
      if (raw === undefined) continue;
      out.push({
        key: unescape(raw),
        rank: m[1].match(/\bdata-rank="([^"]*)"/)?.[1] ?? null,
        cells: [...m[2].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((cell) =>
          cell[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(),
        ),
      });
    }
    return out;
  }

  function fewGroupOf(section: string): string {
    const at = section.indexOf('data-mg="too-few"');
    expect(at, "the section holds a Too few tasks group").toBeGreaterThan(-1);
    const open = section.lastIndexOf("<details", at);
    const end = section.indexOf("</details>", at);
    expect(end, "the group closes").toBeGreaterThan(at);
    return section.slice(open < 0 ? at : open, end + "</details>".length);
  }

  function hookTextOf(region: string, hook: string): string {
    const at = region.indexOf(`data-mg="${hook}"`);
    expect(at, `the region holds data-mg="${hook}"`).toBeGreaterThan(-1);
    const open = region.lastIndexOf("<", at);
    const tag = region.slice(open, region.indexOf(">", at) + 1);
    const tagName = tag.match(/^<([a-zA-Z][\w-]*)/)?.[1];
    expect(tagName, `the ${hook} hook sits on an element`).toBeTruthy();
    const bodyStart = region.indexOf(">", at) + 1;
    const close = region.indexOf(`</${tagName}>`, bodyStart);
    expect(close, `the ${hook} element closes`).toBeGreaterThan(bodyStart);
    return region.slice(bodyStart, close).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  }

  function footerOf(page: string): string {
    const at = page.indexOf('data-mg="about-footer"');
    expect(at, "the page holds the About this data footer").toBeGreaterThan(-1);
    const end = page.indexOf("</body>", at);
    expect(end, "the footer closes").toBeGreaterThan(at);
    return page.slice(at, end);
  }

  function footerNumber(page: string, hook: string): number {
    const text = hookTextOf(footerOf(page), hook);
    const match = text.match(/^(\d+)$/);
    expect(match, `${hook} holds one integer, got "${text}"`).toBeTruthy();
    return Number(match![1]);
  }

  function topPickCount(page: string): number {
    const at = page.indexOf('data-mg="top-block"');
    expect(at, "the page holds the top block").toBeGreaterThan(-1);
    const end = page.indexOf("</section>", at);
    const region = page.slice(at, end > at ? end : page.length);
    return (region.match(/data-mg="pick"/g) ?? []).length;
  }

  function hookItemsOf(region: string, hook: string): string[] {
    const re = new RegExp(`<([a-zA-Z][\\w-]*)\\b[^>]*data-mg="${hook}"[^>]*>`, "g");
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(region)) !== null) {
      const tag = m[1];
      const close = region.indexOf(`</${tag}>`, re.lastIndex);
      expect(close, `a ${hook} item closes`).toBeGreaterThan(re.lastIndex);
      out.push(
        region
          .slice(re.lastIndex, close)
          .replace(/<[^>]*>/g, "")
          .replace(/\s+/g, " ")
          .trim(),
      );
      re.lastIndex = close + tag.length + 3;
    }
    return out;
  }

  function moreColumnsOf(section: string): string {
    const at = section.indexOf('data-mg="more-columns"');
    expect(at, "the section holds a More columns toggle").toBeGreaterThan(-1);
    const open = section.lastIndexOf("<", at);
    const tag = section.slice(open, section.indexOf(">", at) + 1);
    const tagName = tag.match(/^<([a-zA-Z][\w-]*)/)?.[1] as string;
    const close = section.indexOf(`</${tagName}>`, at);
    expect(close, "the toggle closes").toBeGreaterThan(at);
    return section.slice(open, close + tagName.length + 3);
  }

  interface DsPage {
    root: string;
    page: string;
  }

  let dsCache: DsPage | null = null;

  function base(): DsPage {
    if (!dsCache) {
      const root = repoFixture("ds-page");
      const result = runPreview(root);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const file = join(previewFolder(root), "real-work.html");
      expect(existsSync(file), `missing ${file}`).toBe(true);
      dsCache = { root, page: readFileSync(file, "utf8") };
    }
    return dsCache;
  }

  function countRanks(page: string): {
    producerRanked: DsRow[];
    producerFew: DsRow[];
    checkerRanked: DsRow[];
    checkerFew: DsRow[];
  } {
    const producer = sectionOf(page, "Producer roles");
    const checker = sectionOf(page, "Checker roles");
    return {
      producerRanked: rowsOf(producer).filter((row) => row.rank !== null),
      producerFew: rowsOf(fewGroupOf(producer)),
      checkerRanked: rowsOf(checker).filter((row) => row.rank !== null),
      checkerFew: rowsOf(fewGroupOf(checker)),
    };
  }

  it("FX2: the page holds 9 ranked and 2 too-few producer rows, 11 ranked and 2 too-few checker rows, and 10 top lines", () => {
    const { page } = base();
    const counts = countRanks(page);
    expect(counts.producerRanked, "ranked producer rows").toHaveLength(10);
    expect(counts.producerFew, "too-few producer rows").toHaveLength(3);
    expect(counts.checkerRanked, "ranked checker rows").toHaveLength(13);
    expect(counts.checkerFew, "too-few checker rows").toHaveLength(3);
    expect(topPickCount(page), "top block lines").toBe(10);
  });

  it("DS14: the page holds no work-type section and no heading that names a retired work type", () => {
    const { page } = base();
    expect(page, "no work-type hook").not.toContain('data-mg="work-type"');
    const headings = [...page.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/g)].map((m) =>
      m[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().toLowerCase(),
    );
    expect(headings.length, "the page holds headings").toBeGreaterThan(0);
    for (const name of ["work types", "app code", "docs and ops", "print books", "tooling", "other"]) {
      expect(headings, `no heading names ${name}`).not.toContain(name);
    }
  });

  it("DS15: no producer header matches pass, and the checker table has no blocking columns", () => {
    const { page } = base();
    const producer = sectionOf(page, "Producer roles");
    const pHeaders = [
      ...headersOf(defaultTableOf(producer, "producer")),
      ...headersOf(moreColumnsOf(producer)),
    ];
    expect(pHeaders.length, "the producer section holds headers").toBeGreaterThan(0);
    for (const header of pHeaders) {
      expect(header, `producer header ${header} matches /pass/i`).not.toMatch(/pass/i);
    }
    const cHeaders = headersOf(defaultTableOf(sectionOf(page, "Checker roles"), "checker"));
    expect(cHeaders, "no Blocking % header").not.toContain("Blocking %");
    expect(cHeaders, "no Blockers per run header").not.toContain("Blockers per run");
  });

  it("DS16: the default columns match the pinned lists and every number cell matches its format", () => {
    const { page } = base();
    const producer = sectionOf(page, "Producer roles");
    const pTable = defaultTableOf(producer, "producer");
    const pHeaders = headersOf(pTable);
    expect(pHeaders, "the producer default columns").toEqual(PRODUCER_COLUMNS);
    const checker = sectionOf(page, "Checker roles");
    const cTable = defaultTableOf(checker, "checker");
    const cHeaders = headersOf(cTable);
    expect(cHeaders, "the checker default columns").toEqual(CHECKER_COLUMNS);

    const isPercent = (cell: string) => cell === DASH || /^\d+\s*%$/.test(cell);
    const pTasks = pHeaders.indexOf("Tasks");
    const pAccept = pHeaders.indexOf("First-round accept %");
    const pRework = pHeaders.indexOf("Rework");
    const pCleanup = pHeaders.indexOf("Cleanup %");
    const pTokens = pHeaders.indexOf("Tokens per accepted task");
    const pRows = rowsOf(producer);
    expect(pRows.length, "the producer table holds rows").toBeGreaterThan(0);
    for (const row of pRows) {
      expect(row.cells[pTasks], `${row.key} Tasks is an integer`).toMatch(/^\d+$/);
      expect(isPercent(row.cells[pAccept] ?? ""), `${row.key} accept % is a whole percent`).toBe(true);
      const rework = row.cells[pRework] ?? "";
      expect(
        rework === DASH || /^\d+\.\d$/.test(rework),
        `${row.key} rework is one decimal or a dash, got "${rework}"`,
      ).toBe(true);
      expect(isPercent(row.cells[pCleanup] ?? ""), `${row.key} cleanup is a whole percent`).toBe(true);
      const tokens = row.cells[pTokens] ?? "";
      expect(
        tokens === DASH || /^\d+k$/.test(tokens),
        `${row.key} tokens are whole thousands or a dash, got "${tokens}"`,
      ).toBe(true);
    }

    const cRuns = cHeaders.indexOf("Runs");
    const cPass = cHeaders.indexOf("Pass %");
    const cFindings = cHeaders.indexOf("Findings per run");
    const cEscapes = cHeaders.indexOf("Escapes");
    const cNet = cHeaders.indexOf("Net score");
    const cRows = rowsOf(checker);
    expect(cRows.length, "the checker table holds rows").toBeGreaterThan(0);
    for (const row of cRows) {
      expect(row.cells[cRuns], `${row.key} Runs is an integer`).toMatch(/^\d+$/);
      expect(isPercent(row.cells[cPass] ?? ""), `${row.key} pass % is a whole percent`).toBe(true);
      const findings = row.cells[cFindings] ?? "";
      expect(
        /^\d+\.\d{2}$/.test(findings),
        `${row.key} findings per run has two decimals and no %, got "${findings}"`,
      ).toBe(true);
      expect(
        row.cells[cEscapes],
        `${row.key} Escapes shows no data while the escape sum is 0`,
      ).toBe("no data");
      const net = row.cells[cNet] ?? "";
      expect(
        net === "not rated" || Number.isFinite(Number(net)),
        `${row.key} net score is a number or not rated, got "${net}"`,
      ).toBe(true);
    }
    expect(pTable + cTable, "no cell holds (n=").not.toContain("(n=");
  });

  it("DS18: the About this data footer holds the three files, the dates, and the coverage of the fixture", () => {
    const { root, page } = base();
    const at = page.indexOf('data-mg="about-footer"');
    const firstTable = page.indexOf("<table");
    expect(at, "the page holds the footer").toBeGreaterThan(-1);
    expect(firstTable, "the page holds a table").toBeGreaterThan(-1);
    expect(at, "the footer sits below the first table").toBeGreaterThan(firstTable);
    const footer = footerOf(page);
    expect(footer, "the footer is named About this data").toContain("About this data");
    expect(
      (footer.match(/data-mg="footer-file"/g) ?? []).length,
      "three footer-file items",
    ).toBe(3);
    for (const name of [OUTCOMES_NAME, AA_NAME, ALLOWED_NAME]) {
      expect(footer, `the footer names ${name}`).toContain(name);
      expect(footer, `the footer holds the SHA-256 of ${name}`).toContain(
        sha256(join(root, "fixture-b", name)),
      );
    }
    expect(hookTextOf(footer, "footer-read-date"), "the read date").toBe(DATE);
    expect(hookTextOf(footer, "footer-export-date"), "the export date").toBe(DATE);
    expect(footer, "the footer holds no real date").not.toContain("2026-11-17");
    expect(footerNumber(page, "footer-rows"), "row count").toBe(41);
    expect(footerNumber(page, "footer-routes"), "route count").toBe(36);
    expect(footerNumber(page, "footer-unknown-rows"), "unknown rows").toBe(2);
    const share = hookTextOf(footer, "footer-unknown-share");
    expect(share, "the unknown share is a labeled percent").toMatch(/^(\d+(?:\.\d)?)\s*%$/);
    expect(Number(share.match(/^(\d+(?:\.\d)?)/)![1]), "the unknown share").toBe(4.9);
    expect(footer, "the footer holds the merge method note").toContain(METHOD_NOTE);
  });

  it("DS19: the number cells carry white-space: nowrap and the model-name cell carries no wrap lock", () => {
    const { page } = base();
    const styles = [...page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
    expect(styles.length, "the page holds a style block").toBeGreaterThan(0);
    const rules: Array<{ selector: string; body: string }> = [];
    for (const css of styles) {
      for (const chunk of css.split("}")) {
        const brace = chunk.indexOf("{");
        if (brace < 0) continue;
        rules.push({ selector: chunk.slice(0, brace), body: chunk.slice(brace + 1) });
      }
    }
    expect(rules.length, "the style block holds rules").toBeGreaterThan(0);
    const numberRule = rules.some(
      (rule) => rule.selector.includes("num") && /white-space\s*:\s*nowrap/.test(rule.body),
    );
    expect(numberRule, "a number-cell rule carries white-space: nowrap").toBe(true);
    expect(page, "the page holds model-name cells").toContain('data-mg="model-name"');
    for (const rule of rules) {
      if (!rule.selector.includes("model-name")) continue;
      expect(
        /white-space\s*:\s*nowrap/.test(rule.body),
        `the model-name rule ${rule.selector} carries no nowrap`,
      ).toBe(false);
      expect(
        /\b(width|max-width)\s*:/.test(rule.body),
        `the model-name rule ${rule.selector} carries no fixed width`,
      ).toBe(false);
    }
  });

  it("DS20: the print-audit block maps the raw route keys to plain names and holds no raw key", () => {
    const root = repoFixture("ds20");
    const auditFile = join(root, "harness", "model-guide", "data", "print-audit-2026-11.json");
    expect(existsSync(auditFile), "the temp repo holds the print-audit data file").toBe(true);
    const doc = JSON.parse(readFileSync(auditFile, "utf8"));
    doc.routes = {
      "kimi-code-plan-cn/k3.1-pro": "11 of 13",
      "claude-code/claude-sonnet-5-5#high": "13 of 13",
      "opencode-go/synthetic-unknown": "3 of 13",
    };
    writeFileSync(auditFile, `${JSON.stringify(doc, null, 2)}\n`);
    const result = runPreview(root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const page = readFileSync(join(previewFolder(root), "real-work.html"), "utf8");
    const at = page.indexOf("<h2>Print audit</h2>");
    expect(at, "the page holds a Print audit heading").toBeGreaterThan(-1);
    const end = page.indexOf("</section>", at);
    const section = page.slice(at, end);
    const items = hookItemsOf(section, "audit-result");
    expect(items.length, "one audit-result item per route").toBeGreaterThanOrEqual(3);
    for (const text of items) {
      expect(text, `the item pairs its name with a result: ${text}`).toMatch(/\d+ of \d+/);
    }
    const kimi = items.find((text) => text.includes("Kimi K3.1 Pro"));
    expect(kimi, "the Kimi key shows its plain name").toBeDefined();
    expect(kimi, "the Kimi result pairs with its count").toContain("11 of 13");
    const sonnet = items.find((text) => text.includes("Claude Sonnet 5.5"));
    expect(sonnet, "the Claude key shows its plain name").toBeDefined();
    expect(sonnet, "the Claude result pairs with its count").toContain("13 of 13");
    const unnamed = items.find((text) => text.includes("synthetic-unknown"));
    expect(unnamed, "the unnamed key shows the key without its plan prefix").toBeDefined();
    for (const raw of [
      "kimi-code-plan-cn/k3.1-pro",
      "kimi-code-plan-cn",
      "claude-code/claude-sonnet-5-5",
      "claude-code",
      "#high",
      "opencode-go/synthetic-unknown",
    ]) {
      expect(section, `the block holds no raw key text ${raw}`).not.toContain(raw);
    }
  });

  it("DS21: the hostile route reaches the HTML escaped, __proto__ is an ordinary row, and the counts hold", () => {
    const { page } = base();
    expect(page, "the page holds no raw img tag").not.toContain("<img");
    expect(page, "the hostile route is escaped").toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(page, "the __proto__ row is an ordinary row").toContain('data-model-key="t1/__proto__"');
    const counts = countRanks(page);
    expect(counts.producerRanked, "ranked producer rows").toHaveLength(10);
    expect(counts.producerFew, "too-few producer rows").toHaveLength(3);
    expect(counts.checkerRanked, "ranked checker rows").toHaveLength(13);
    expect(counts.checkerFew, "too-few checker rows").toHaveLength(3);
    expect(topPickCount(page), "top block lines").toBe(10);
  });

  it("DS22: the checker table text says that a high pass % does not mean a good checker", () => {
    const { page } = base();
    const checker = sectionOf(page, "Checker roles");
    expect(
      checker,
      "the checker table carries its warning sentence (spec D16 PM 2026-11-18)",
    ).toContain("A high pass % does not mean a good checker.");
  });

  it("DS23: the About this data footer states the effort-level limit of the net score", () => {
    const { page } = base();
    const footer = footerOf(page);
    expect(
      footer,
      "the footer holds the effort sentence of spec D16 PM 2026-11-18",
    ).toContain(
      "The record does not hold the effort level of each run. The net score uses " +
        "the effort level of the route with the most runs, so a model can score " +
        "higher at another effort level (for example Claude Sonnet 5.5 at #max).",
    );
  });

  it("DS24: every Escapes cell shows no data when the escape sum is 0, and the number otherwise", () => {
    const fixtureRows = JSON.parse(readFileSync(join(PAGE_B, OUTCOMES_NAME), "utf8"));
    const escapeSum = fixtureRows
      .filter((row: any) => row.kind === "gate")
      .reduce((total: number, row: any) => total + (row.escapes ?? 0), 0);
    expect(escapeSum, "the base fixture holds no escape data").toBe(0);

    const { page } = base();
    const baseRows = rowsOf(sectionOf(page, "Checker roles"));
    expect(baseRows.length, "the checker table holds rows").toBeGreaterThan(0);
    for (const row of baseRows) {
      expect(row.cells[4], `${row.key} shows no data while no escape exists`).toBe("no data");
    }

    const root = repoFixture("ds24-escapes");
    stageFixture(root, (rows) => {
      for (const row of rows) {
        if (row.kind !== "gate") continue;
        if (row.route === "t1/gate-one#high") row.escapes = 1;
        if (row.route === "t1/gate-one") row.escapes = 2;
        if (row.route === "t1/gate-four") row.escapes = 1;
      }
    });
    const result = runPreview(root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const variant = readFileSync(join(previewFolder(root), "real-work.html"), "utf8");
    const variantRows = rowsOf(sectionOf(variant, "Checker roles"));
    const byKey = (key: string) => {
      const found = variantRows.find((row) => row.key === key);
      expect(found, `row ${key} exists in the variant`).toBeDefined();
      return found!;
    };
    expect(byKey("t1/gate-one").cells[4], "the merged escape sum 1+2 shows as a number").toBe("3");
    expect(byKey("t1/gate-four").cells[4], "a single escape shows as a number").toBe("1");
    expect(byKey("t1/gate-two").cells[4], "a zero escape shows as a number").toBe("0");
  });
});

// ---------------------------------------------------------------------------
// The review page cases V1 to V9 of task 4.8a (test-strategy section 4.4,
// spec D13, D16, FR-14, D21).
//
// The tool under test is the review page edit of
// `harness/model-guide/preview.sh` (Green task 4.8). That edit does not
// exist at the base of the phase, so every V case fails for the missing
// page. The Phase 1 and Phase 2 cases above stay green.
//
// Contract of the review page:
//
//   - preview.sh reads the newest score file under
//     `harness/model-guide/data/review-scores/` (the rule that guide.ts
//     uses) and writes `review.html` and `review.json` into the preview
//     folder. `review.json` is a copy of the score file.
//   - `preview.sh --pilot-gate pass|fail`, default `pass` (assumption A4-1
//     of section 6.2). With `fail` the page shows no rank for any route and
//     preview.sh prints exactly one line on stdout:
//     `preview: pilot gate fail`.
//   - The review table carries `data-mg="review-table"` with the heads
//     Route, Rank, Worst, Median, Best, Blocker recall, False claims,
//     Real defects. A route row carries `data-mg="review-route"` and
//     `data-route="<route>"`. Its cells carry `data-mg="review-rank"`,
//     `data-mg="review-worst"`, `data-mg="review-median"`,
//     `data-mg="review-best"`, `data-mg="review-recall"`,
//     `data-mg="review-false-claims"`, and `data-mg="review-real-defects"`.
//   - The numbers of a route equal the score document: worst, median, and
//     best with one decimal (D13), the blocker recall as a whole percent
//     (the worst blocker recall of the route), and the false claims and the
//     real defects as the sum over the passes of the route.
//   - The counts by class and by severity of a route are the sum over its
//     passes. A row carries `data-mg="review-class"` with `data-route` and
//     `data-class`, or `data-mg="review-severity"` with `data-route` and
//     `data-severity`, and holds the label, the found count, and the missed
//     count in that order. The heads are Class, Found, Missed and Severity,
//     Found, Missed.
//   - A route with fewer than 3 complete passes has `rank: null` in the
//     score document. Its row holds the word `incomplete`, no rank number,
//     and no worst score.
//   - Each pass carries `data-mg="review-pass"` with `data-route`,
//     `data-pass`, and `data-state` (`complete` or `provisional`).
//   - The set counts carry `data-mg="review-set-diffs"`,
//     `data-mg="review-set-plants"`, and `data-mg="review-set-blockers"`,
//     each inside `data-mg="review-set-counts"`, and each holds its number
//     with its label word. The values come from
//     `data/sets/<set_id>.json`.
//   - The method note carries `data-mg="review-method"` and names the set
//     size as `<n> diffs`, the weights 5, 2, and 1, the false-claim cost 2,
//     `N = 3`, and the pilot gate.
//   - The page holds no key `new_lines`, `witness`, `operator`, `file`, or
//     `line`, and no private folder path (secrecy rule, section 9.4).
//
// Every case copies the scripts it runs into a temp repo, writes its score
// document and set manifest inline, and reads no private folder, no key,
// no real score file, and no model.
// ---------------------------------------------------------------------------

const V_SET_ID = "mg-v-page";
const V_RANKED = "opencode-go/muse-spark-1.3-contributor#high";
const V_FEW = "kimi-code-plan-cn/kimi-for-coding#high";
const V_CLASSES = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9"];
const V_SEVERITIES = ["blocker", "major", "minor"];
const V_HEADS = [
  "Route",
  "Rank",
  "Worst",
  "Median",
  "Best",
  "Blocker recall",
  "False claims",
  "Real defects",
];
const V_PILOT_FAIL_LINE = "preview: pilot gate fail";
const V_PRIVATE_KEYS = ["new_lines", "witness", "operator", "file", "line"];

function reEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A pattern that matches one tag carrying every attribute of the list, in
 * any order, and captures the element with its closing tag. */
function vAttrPattern(attrs: Array<[string, string]>): string {
  const looks = attrs
    .map(([key, value]) => `(?=[^>]*\\b${reEscape(key)}="${reEscape(value)}")`)
    .join("");
  return `<([a-z0-9]+)${looks}[^>]*>([\\s\\S]*?)</\\1>`;
}

function vFirstFragment(html: string, attrs: Array<[string, string]>): string | null {
  const match = new RegExp(vAttrPattern(attrs), "i").exec(html);
  return match ? match[0] : null;
}

function vAllFragments(html: string, attrs: Array<[string, string]>): string[] {
  const pattern = new RegExp(vAttrPattern(attrs), "gi");
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) out.push(match[0]);
  return out;
}

/** The text of a fragment with its tags removed. */
function vText(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function vFirstText(html: string, attrs: Array<[string, string]>): string | null {
  const fragment = vFirstFragment(html, attrs);
  return fragment === null ? null : vText(fragment);
}

/** The cell texts of one row, in column order. */
function vCells(fragment: string): string[] {
  const out: string[] = [];
  const pattern = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(fragment)) !== null) out.push(vText(match[1]));
  return out;
}

/** The link texts of one href, in page order. */
function vAnchors(html: string, href: string): string[] {
  const pattern = new RegExp(`<a\\b[^>]*href="${reEscape(href)}"[^>]*>([\\s\\S]*?)</a>`, "gi");
  return [...html.matchAll(pattern)].map((match) => vText(match[1]));
}

/** The row of one route in the review table. */
function vRouteRow(page: string, route: string): string | null {
  return vFirstFragment(page, [
    ["data-mg", "review-route"],
    ["data-route", route],
  ]);
}

function vRowCell(row: string, name: string): string | null {
  return vFirstText(row, [["data-mg", name]]);
}

/** The score document of the V cases: one ranked route with a provisional
 * pass, and one route with two complete passes. */
function vScoreDoc(): any {
  const pass = (
    route: string,
    number: number,
    state: "complete" | "provisional",
    score: number,
    options: {
      recall: number;
      falseClaims: number;
      realDefects: number;
      classes: Array<[string, number, number]>;
      severities: Array<[string, number, number]>;
      blockers: number;
      blockersFound: number;
    },
  ): any => {
    const byClass: Record<string, { found: number; missed: number }> = {};
    const bySeverity: Record<string, { found: number; missed: number }> = {};
    for (const name of V_CLASSES) byClass[name] = { found: 0, missed: 0 };
    for (const name of V_SEVERITIES) bySeverity[name] = { found: 0, missed: 0 };
    for (const [name, found, missed] of options.classes) byClass[name] = { found, missed };
    for (const [name, found, missed] of options.severities) bySeverity[name] = { found, missed };
    const found = Object.values(byClass).reduce((sum, item) => sum + item.found, 0);
    const missed = Object.values(byClass).reduce((sum, item) => sum + item.missed, 0);
    return {
      route,
      pass: number,
      date: ["2026-11-20", "2026-11-21", "2026-11-22"][number - 1] ?? "2026-11-22",
      state,
      score,
      weight: 40,
      found_weight: Math.round((score * 40) / 100),
      found,
      missed,
      false_claims: options.falseClaims,
      blockers: options.blockers,
      blockers_found: options.blockersFound,
      blocker_recall: options.recall,
      invalid_reviews: 0,
      real_defects: options.realDefects,
      by_class: byClass,
      by_severity: bySeverity,
    };
  };

  const ranked = [
    pass(V_RANKED, 1, "complete", 62.0, {
      recall: 0.5,
      falseClaims: 2,
      realDefects: 1,
      classes: [["C1", 2, 1], ["C2", 1, 2]],
      severities: [["blocker", 1, 1], ["major", 2, 2], ["minor", 1, 1]],
      blockers: 4,
      blockersFound: 2,
    }),
    pass(V_RANKED, 2, "complete", 71.5, {
      recall: 0.75,
      falseClaims: 1,
      realDefects: 0,
      classes: [["C1", 1, 0], ["C3", 0, 1]],
      severities: [["blocker", 0, 1], ["major", 1, 1]],
      blockers: 4,
      blockersFound: 3,
    }),
    pass(V_RANKED, 3, "provisional", 84.0, {
      recall: 1,
      falseClaims: 0,
      realDefects: 0,
      classes: [["C1", 0, 1], ["C2", 1, 0]],
      severities: [["blocker", 1, 0], ["major", 0, 1], ["minor", 1, 1]],
      blockers: 4,
      blockersFound: 4,
    }),
  ];
  const few = [
    pass(V_FEW, 1, "complete", 55.0, {
      recall: 0.4,
      falseClaims: 4,
      realDefects: 0,
      classes: [["C4", 1, 3]],
      severities: [["major", 1, 2], ["minor", 0, 1]],
      blockers: 5,
      blockersFound: 2,
    }),
    pass(V_FEW, 2, "complete", 66.0, {
      recall: 0.6,
      falseClaims: 0,
      realDefects: 2,
      classes: [["C5", 2, 0]],
      severities: [["blocker", 1, 0], ["minor", 1, 1]],
      blockers: 5,
      blockersFound: 3,
    }),
  ];

  const record = (list: any[]): any => {
    const scores = list.map((item) => item.score);
    const recalls = list.map((item) => item.blocker_recall);
    const sorted = [...scores].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    return {
      route: list[0].route,
      state: list.length >= 3 ? "complete" : "incomplete",
      passes: list,
      worst: Math.min(...scores),
      median,
      best: Math.max(...scores),
      worst_blocker_recall: Math.min(...recalls),
      rank: null as number | null,
    };
  };

  const records = [record(ranked), record(few)];
  const complete = records.filter((item) => item.state === "complete");
  complete.sort((a, b) => b.worst - a.worst || b.worst - a.worst);
  complete.forEach((item, index) => {
    item.rank = index + 1;
  });
  return {
    set_id: V_SET_ID,
    passes: [...ranked, ...few],
    routes: [...complete, ...records.filter((item) => item.state !== "complete")],
  };
}

/** The sum of one field over the passes of one route. */
function vPassSum(doc: any, route: string, field: "false_claims" | "real_defects"): number {
  return doc.passes
    .filter((item: any) => item.route === route)
    .reduce((sum: number, item: any) => sum + item[field], 0);
}

/** The count of one class or severity over the passes of one route. */
function vCountSum(
  doc: any,
  route: string,
  group: "by_class" | "by_severity",
  key: string,
): { found: number; missed: number } {
  let found = 0;
  let missed = 0;
  for (const item of doc.passes) {
    if (item.route !== route) continue;
    const cell = item[group][key] ?? { found: 0, missed: 0 };
    found += cell.found;
    missed += cell.missed;
  }
  return { found, missed };
}

/** The public set manifest of spec D9 for the V cases. */
function writeVSet(root: string): void {
  const dir = join(root, "harness", "model-guide", "data", "sets");
  mkdirSync(dir, { recursive: true });
  const diffs = Array.from({ length: 3 }, (_, index) => ({
    id: `v-${index + 1}`,
    repo: "mono",
    commit: String(index + 1).repeat(40),
    parent: String(index + 2).repeat(40),
    seeded_sha256: "a".repeat(64),
    key_sha256: "b".repeat(64),
  }));
  const doc = {
    set_id: V_SET_ID,
    created: "2026-11-17",
    diffs,
    plant_counts: {
      by_class: { C1: 1, C2: 1, C3: 1, C4: 1, C5: 0, C6: 0, C7: 0, C8: 0, C9: 0 },
      by_severity: { blocker: 2, major: 1, minor: 1 },
    },
  };
  writeFileSync(join(dir, `${V_SET_ID}.json`), `${JSON.stringify(doc, null, 2)}\n`);
}

/** A temp repo with the score document and the set manifest of the V
 * cases, written inline (section 4.4: no new fixture file). */
function buildVRepo(tag: string): string {
  const root = repoFixture(tag);
  const scores = join(root, "harness", "model-guide", "data", "review-scores");
  mkdirSync(scores, { recursive: true });
  const doc = vScoreDoc();
  writeFileSync(join(scores, `${V_SET_ID}.json`), `${JSON.stringify(doc, null, 2)}\n`);
  writeVSet(root);
  return root;
}

function vPreview(root: string, extra: string[] = []) {
  return runPreviewArgs(root, [
    "--manifest",
    join(root, "fixture-b", MANIFEST_NAME),
    "--preview",
    previewFolder(root),
    ...extra,
  ]);
}

/** The review page of the preview folder. Its absence is the Red reason. */
function reviewPage(root: string): string {
  const path = join(previewFolder(root), "review.html");
  expect(existsSync(path), `review.html is missing from the preview folder: ${path}`).toBe(true);
  return readFileSync(path, "utf8");
}

/** The review data file of the preview folder: a copy of the score file. */
function reviewJson(root: string): any {
  const path = join(previewFolder(root), "review.json");
  expect(existsSync(path), `review.json is missing from the preview folder: ${path}`).toBe(true);
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Every key of a parsed document, at any depth. */
function collectKeys(value: unknown, out: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      out.push(key);
      collectKeys(child, out);
    }
  }
}

/** The git result of one call inside the temp repo. */
function vGit(root: string, args: string[]): { status: number | null; stdout: string } {
  const result = spawnSync("git", args, { cwd: root, env: env(), encoding: "utf8", timeout: 60_000 });
  return { status: result.status, stdout: result.stdout ?? "" };
}

describe("the review page cases V1 to V9 of task 4.8a", () => {
  it("V1: the page holds the rank, worst, median, best, blocker recall, false claims, real defects, and the counts by class and severity", () => {
    const root = buildVRepo("v1");
    const run = vPreview(root);
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    const page = reviewPage(root);
    const doc = vScoreDoc();

    const table = vFirstFragment(page, [["data-mg", "review-table"]]);
    expect(table, "the page holds the review table").not.toBeNull();
    const heads = [...(table as string).matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((match) =>
      vText(match[1]),
    );
    expect(heads, "the review table heads").toEqual(V_HEADS);
    for (const head of ["Class", "Found", "Missed", "Severity"]) {
      expect(page, `the counts tables hold the head ${head}`).toMatch(
        new RegExp(`<th[^>]*>\\s*${head}\\s*</th>`),
      );
    }

    const row = vRouteRow(page, V_RANKED);
    expect(row, `the page holds a row for ${V_RANKED}`).not.toBeNull();
    expect(vRowCell(row as string, "review-rank"), "the rank of the ranked route").toBe("1");
    expect(vRowCell(row as string, "review-worst"), "the worst score").toBe("62.0");
    expect(vRowCell(row as string, "review-median"), "the median score").toBe("71.5");
    expect(vRowCell(row as string, "review-best"), "the best score").toBe("84.0");
    expect(vRowCell(row as string, "review-recall"), "the blocker recall").toBe("50 %");
    expect(vRowCell(row as string, "review-false-claims"), "the false claims").toBe(
      String(vPassSum(doc, V_RANKED, "false_claims")),
    );
    expect(vRowCell(row as string, "review-real-defects"), "the real defects").toBe(
      String(vPassSum(doc, V_RANKED, "real_defects")),
    );

    const fewRow = vRouteRow(page, V_FEW);
    expect(fewRow, `the page holds a row for ${V_FEW}`).not.toBeNull();
    expect(vRowCell(fewRow as string, "review-false-claims"), "the false claims of the second route").toBe(
      String(vPassSum(doc, V_FEW, "false_claims")),
    );
    expect(vRowCell(fewRow as string, "review-real-defects"), "the real defects of the second route").toBe(
      String(vPassSum(doc, V_FEW, "real_defects")),
    );

    for (const route of [V_RANKED, V_FEW]) {
      for (const name of V_CLASSES) {
        const expected = vCountSum(doc, route, "by_class", name);
        const cells = vCells(
          vFirstFragment(page, [
            ["data-mg", "review-class"],
            ["data-route", route],
            ["data-class", name],
          ]) ?? "",
        );
        expect(cells, `${route} counts by class ${name}`).toEqual([
          name,
          String(expected.found),
          String(expected.missed),
        ]);
      }
      for (const name of V_SEVERITIES) {
        const expected = vCountSum(doc, route, "by_severity", name);
        const cells = vCells(
          vFirstFragment(page, [
            ["data-mg", "review-severity"],
            ["data-route", route],
            ["data-severity", name],
          ]) ?? "",
        );
        expect(cells, `${route} counts by severity ${name}`).toEqual([
          name,
          String(expected.found),
          String(expected.missed),
        ]);
      }
    }
  });

  it("V2: a route with two complete passes shows incomplete, no rank number, and no worst score", () => {
    const root = buildVRepo("v2");
    const run = vPreview(root);
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    const page = reviewPage(root);
    const row = vRouteRow(page, V_FEW);
    expect(row, `the page holds a row for ${V_FEW}`).not.toBeNull();
    expect(vText(row as string), "the row of an unranked route").toContain("incomplete");
    const rank = vRowCell(row as string, "review-rank") ?? "";
    expect(/\d/.test(rank), `the rank cell of an unranked route holds a number: ${rank}`).toBe(false);
    const worst = vRowCell(row as string, "review-worst") ?? "";
    expect(/\d/.test(worst), `the worst cell of an unranked route holds a number: ${worst}`).toBe(
      false,
    );
    const ranked = vRouteRow(page, V_RANKED);
    expect(vRowCell(ranked as string, "review-rank"), "the ranked route keeps its rank").toBe("1");
  });

  it("V3: a provisional pass stays complete, the route keeps its rank, and the page marks the pass provisional", () => {
    const root = buildVRepo("v3");
    const run = vPreview(root);
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    const page = reviewPage(root);
    const row = vRouteRow(page, V_RANKED);
    expect(vRowCell(row as string, "review-rank"), "a provisional route keeps its rank").toBe("1");
    const provisional = vAllFragments(page, [
      ["data-mg", "review-pass"],
      ["data-route", V_RANKED],
      ["data-state", "provisional"],
    ]);
    expect(provisional, "the page marks the provisional pass of the ranked route").toHaveLength(1);
    expect(
      vAllFragments(page, [["data-mg", "review-pass"], ["data-route", V_RANKED]]),
      "the page lists the three passes of the ranked route",
    ).toHaveLength(3);
    expect(
      vAllFragments(page, [["data-mg", "review-pass"], ["data-route", V_FEW]]),
      "the page lists the two passes of the other route",
    ).toHaveLength(2);
    expect(vText(row as string), "the route with a provisional pass is not incomplete").not.toContain(
      "incomplete",
    );
  });

  it("V4: --pilot-gate fail shows no rank and one named line, and --pilot-gate pass shows the rank", () => {
    const root = buildVRepo("v4");
    const fail = vPreview(root, ["--pilot-gate", "fail"]);
    expect(fail.status, `${fail.stdout}\n${fail.stderr}`).toBe(0);
    const failPage = reviewPage(root);
    const lines = fail.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "");
    expect(lines, "the pilot gate fail prints one named line").toEqual([V_PILOT_FAIL_LINE]);
    const ranks = vAllFragments(failPage, [["data-mg", "review-rank"]]).map((item) => vText(item));
    expect(ranks.length, "the page holds no route row").toBeGreaterThan(0);
    for (const rank of ranks) {
      expect(/\d/.test(rank), `a rank number shows with the pilot gate fail: ${rank}`).toBe(false);
    }
    expect(vRouteRow(failPage, V_RANKED), "the page still lists the routes").not.toBeNull();

    const pass = vPreview(root, ["--pilot-gate", "pass"]);
    expect(pass.status, `${pass.stdout}\n${pass.stderr}`).toBe(0);
    const passPage = reviewPage(root);
    const ranked = vRouteRow(passPage, V_RANKED);
    expect(vRowCell(ranked as string, "review-rank"), "the pilot gate pass shows the rank").toBe("1");
  });

  it("V5: the page shows the diff, plant, and blocker counts of the set manifest, and a changed count moves the cell", () => {
    const root = buildVRepo("v5");
    const first = vPreview(root);
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
    const page = reviewPage(root);
    const diffs = vFirstText(page, [["data-mg", "review-set-diffs"]]) ?? "";
    const plants = vFirstText(page, [["data-mg", "review-set-plants"]]) ?? "";
    const blockers = vFirstText(page, [["data-mg", "review-set-blockers"]]) ?? "";
    expect(diffs, "the diff count of the set").toMatch(/\b3\b/);
    expect(diffs, "the diff count carries its label").toMatch(/diff/i);
    expect(plants, "the plant count of the set").toMatch(/\b4\b/);
    expect(plants, "the plant count carries its label").toMatch(/plant/i);
    expect(blockers, "the blocker count of the set").toMatch(/\b2\b/);
    expect(blockers, "the blocker count carries its label").toMatch(/blocker/i);

    const setPath = join(root, "harness", "model-guide", "data", "sets", `${V_SET_ID}.json`);
    const setDoc = JSON.parse(readFileSync(setPath, "utf8"));
    setDoc.plant_counts.by_severity.blocker = 5;
    writeFileSync(setPath, `${JSON.stringify(setDoc, null, 2)}\n`);
    const second = vPreview(root);
    expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(0);
    const moved = vFirstText(reviewPage(root), [["data-mg", "review-set-blockers"]]) ?? "";
    expect(moved, "the blocker cell follows the manifest").toMatch(/\b5\b/);
    expect(moved, "the blocker cell moved").not.toBe(blockers);
  });

  it("V6: the method note names the set size, the weights, the false-claim cost, N = 3, and the pilot gate", () => {
    const root = buildVRepo("v6");
    const run = vPreview(root);
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    const page = reviewPage(root);
    const note = vFirstText(page, [["data-mg", "review-method"]]);
    expect(note, "the page holds the method note").not.toBeNull();
    expect(note, "the note names the set size").toMatch(/\b3 diffs\b/);
    expect(note, "the note names the weights 5, 2, and 1").toMatch(
      /\bweights?\b[^0-9]{0,20}5[^0-9]{0,10}2[^0-9]{0,10}1\b/,
    );
    expect(note, "the note names the false-claim cost 2").toMatch(
      /(\bfalse[- ]claims?\b[^0-9]{0,40}\b2\b)|(\b2\b[^0-9]{0,40}false[- ]claims?\b)/i,
    );
    expect(note, "the note names N = 3").toMatch(/\bN\s*=\s*3\b/);
    expect(note, "the note names the pilot gate").toMatch(/\bpilot\b/i);
  });

  it("V7: the page and review.json hold no private key and no private path, and a prose word does not fail the scan", () => {
    const root = buildVRepo("v7");
    const run = vPreview(root);
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    const page = reviewPage(root);
    const doc = reviewJson(root);
    expect(doc, "review.json is a copy of the score file").toEqual(vScoreDoc());

    const keys: string[] = [];
    collectKeys(doc, keys);
    expect(
      keys.filter((key) => V_PRIVATE_KEYS.includes(key)),
      "review.json holds a private key",
    ).toEqual([]);
    for (const key of V_PRIVATE_KEYS) {
      expect(new RegExp(`"${key}"\\s*:`).test(page), `the page holds the key "${key}"`).toBe(false);
    }
    const text = `${page}\n${JSON.stringify(doc)}`;
    expect(text, "the page holds the private folder path").not.toContain(
      ".local/share/lending-desk-bench",
    );

    // A7: the scan reads exact key names, so a prose word never fails it.
    const prose = "the file of the set and a witness line";
    expect(
      V_PRIVATE_KEYS.filter((key) => new RegExp(`"${key}"\\s*:`).test(prose)),
      "the key scan must not match a prose word",
    ).toEqual([]);
    const proseKeys: string[] = [];
    collectKeys({ note: prose }, proseKeys);
    expect(proseKeys, "the key scan collects keys, not values").toEqual(["note"]);
  });

  it("V8: each page of the preview holds one Review link and one Real work link", () => {
    const root = buildVRepo("v8");
    const run = vPreview(root);
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    for (const name of ["index.html", "real-work.html", "review.html"]) {
      const path = join(previewFolder(root), name);
      expect(existsSync(path), `${name} is missing from the preview folder: ${path}`).toBe(true);
      const page = readFileSync(path, "utf8");
      expect(vAnchors(page, "./review.html"), `${name} Review links`).toEqual(["Review"]);
      expect(vAnchors(page, "./real-work.html"), `${name} Real work links`).toHaveLength(1);
    }
  });

  it("V9: the temp docs tree stays byte-identical, git status docs/ stays empty, and preview-base lists every docs file", () => {
    const root = buildVRepo("v9");
    expect(vGit(root, ["init", "-q"]).status, "git init failed").toBe(0);
    const gitArgs = [
      "-c",
      "user.email=review-v9@example.com",
      "-c",
      "user.name=review-v9",
      "-c",
      "commit.gpgsign=false",
    ];
    expect(vGit(root, [...gitArgs, "add", "docs"]).status, "git add docs failed").toBe(0);
    expect(vGit(root, [...gitArgs, "commit", "-q", "-m", "base"]).status, "git commit failed").toBe(0);

    const before = snapshot(join(root, "docs"));
    const run = vPreview(root);
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(snapshot(join(root, "docs")), "the run changed the temp docs tree").toEqual(before);
    expect(
      vGit(root, ["status", "--short", "docs/"]).stdout,
      "git status --short docs/ prints a line",
    ).toBe("");

    const base = JSON.parse(readFileSync(join(previewFolder(root), "preview-base.json"), "utf8"));
    expect(Object.keys(base.docs ?? {}).sort(), "preview-base lists each copied docs file").toEqual(
      filesUnder(join(root, "docs")).sort(),
    );
    // The review page itself is the missing piece at the phase base.
    expect(existsSync(join(previewFolder(root), "review.html")), "review.html is missing").toBe(true);
  });
});
