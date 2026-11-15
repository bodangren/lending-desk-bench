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
const FIXTURE = join(import.meta.dirname, "fixtures", "real-work-mini.json");
const MANIFEST = join(import.meta.dirname, "fixtures", "MANIFEST.txt");
const PUBLISH_USAGE = "usage: publish.ts --preview <folder>\n";
const PREVIEW_USAGE = "usage: preview.sh --export <file> [--preview <folder>]\n";
const REQUIRED_COVERAGE_KEYS = [
  "runs",
  "first_run_date",
  "last_run_date",
  "share_known_route",
  "share_with_result",
  "paired_duplicates_left_out",
];

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

function populateRepo(root: string): void {
  mkdirSync(join(root, "harness"), { recursive: true });
  cpSync(SOURCE, join(root, "harness", "model-guide"), { recursive: true });
  mkdirSync(join(root, "docs", "assets", "css"), { recursive: true });
  mkdirSync(join(root, "docs", "assets", "data"), { recursive: true });
  writeFileSync(join(root, "docs", "index.html"), INDEX_HTML);
  writeFileSync(join(root, "docs", "assets", "css", "site.css"), SITE_CSS);
  writeFileSync(join(root, "docs", "assets", "data", "benchmark.json"), BENCHMARK_JSON);
  mkdirSync(join(root, "measure", "tracks", "model_guide"), { recursive: true });
  mkdirSync(join(root, "fixture"), { recursive: true });
  writeFileSync(join(root, "fixture", "real-work-mini.json"), readFileSync(FIXTURE));
  writeFileSync(join(root, "fixture", "MANIFEST.txt"), readFileSync(MANIFEST));
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

function stageFixture(root: string, mutate: (doc: any) => void): void {
  const doc = JSON.parse(readFileSync(FIXTURE, "utf8"));
  mutate(doc);
  const json = join(root, "fixture", "real-work-mini.json");
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  writeFileSync(json, text);
  writeFileSync(join(root, "fixture", "MANIFEST.txt"), [
    `sha256: ${sha256(json)}`,
    `size: ${Buffer.byteLength(text)}`,
    "source-commit: none (synthetic fixture, 2026-11-14)",
    "",
  ].join("\n"));
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
    "--export", join(root, "fixture", "real-work-mini.json"),
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

  it("B2 refuses a script value in the numeric coverage field without writing a file", () => {
    const root = repoFixture("b2-coverage");
    stageFixture(root, (doc) => {
      doc.coverage.paired_duplicates_left_out = "<scr" + "ipt>alert(1)</scr" + "ipt>";
    });
    const docsBefore = snapshot(join(root, "docs"));
    const previewBefore = snapshot(previewFolder(root));
    const result = runPreview(root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout).toBe("input-check: schema\n");
    expect(result.stderr).toBe("");
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
    expect(snapshot(previewFolder(root))).toEqual(previewBefore);
    expect(existsSync(join(previewFolder(root), "real-work.json"))).toBe(false);
  });

  it("B2 escapes a script value in a route name and never writes the raw tag", () => {
    const root = repoFixture("b2-route");
    const raw = "<im" + "g src=x onerror=alert(1)>";
    stageFixture(root, (doc) => {
      doc.all_time[0].route = raw;
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

  it("F14 resolves a relative export path from the repo root", () => {
    const root = repoFixture("f14-row6");
    const docsBefore = snapshot(join(root, "docs"));
    const result = runPreviewArgs(root, ["--export", "fixture/real-work-mini.json"], root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(existsSync(join(previewFolder(root), "real-work.json"))).toBe(true);
    expect(existsSync(join(previewFolder(root), "real-work.html"))).toBe(true);
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
  });

  it("F14 resolves a relative export path from a folder outside the repo", () => {
    const root = repoFixture("f14-row7");
    const outside = tempDir("f14-outside");
    writeFileSync(join(outside, "real-work-mini.json"), readFileSync(FIXTURE));
    writeFileSync(join(outside, "MANIFEST.txt"), readFileSync(MANIFEST));
    const docsBefore = snapshot(join(root, "docs"));
    const result = runPreviewArgs(root, ["--export", "real-work-mini.json"], outside);
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

  it("F15 refuses preview.sh with --export as the last argument", () => {
    const root = repoFixture("f15-export-last");
    const docsBefore = snapshot(join(root, "docs"));
    const rootBefore = snapshot(root, true);
    const result = runPreviewArgs(root, ["--export"], root);
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

  it("F15 refuses preview.sh with an empty export value", () => {
    const root = repoFixture("f15-export-empty");
    const docsBefore = snapshot(join(root, "docs"));
    const rootBefore = snapshot(root, true);
    const result = runPreviewArgs(root, ["--export", ""], root);
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
      ["--export", join(root, "fixture", "real-work-mini.json"), "--preview", ""],
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
    stageFixture(root, (doc) => {
      doc.schema = "real-work-outcomes/invalid";
    });
    const docsBefore = snapshot(join(root, "docs"));
    const target = previewFolder(root);
    expect(existsSync(target)).toBe(false);
    const result = runPreview(root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout).toBe("input-check: schema\n");
    expect(result.stderr).toBe("");
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

  it.each(REQUIRED_COVERAGE_KEYS)(
    "F17 refuses a missing coverage %s key with the schema line",
    (key) => {
      const root = repoFixture(`f17-${key}`);
      stageFixture(root, (doc) => {
        delete doc.coverage[key];
      });
      const docsBefore = snapshot(join(root, "docs"));
      const result = runPreview(root);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      expect(result.stdout).toBe("input-check: schema\n");
      expect(result.stderr).toBe("");
      expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
      expect(existsSync(join(previewFolder(root), "real-work.json"))).toBe(false);
    },
  );

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

  const A32_CASES: Array<[string, (doc: any) => void]> = [
    ["a null coverage runs value", (doc) => { doc.coverage.runs = null; }],
    ["a number in coverage first_run_date", (doc) => { doc.coverage.first_run_date = 20260928; }],
    ["a string in coverage share_known_route", (doc) => { doc.coverage.share_known_route = "0.568"; }],
    ["a missing generated_on", (doc) => { delete doc.generated_on; }],
  ];

  it.each(A32_CASES)(
    "A3-2 refuses %s with the schema line, no traceback, and no half-built preview folder",
    (_label, mutate) => {
      const root = repoFixture("a3-2");
      stageFixture(root, mutate);
      const docsBefore = snapshot(join(root, "docs"));
      const result = runPreview(root);
      expect(result.status, `A3-2 status: ${result.status}`).toBe(2);
      expect(result.stdout).toBe("input-check: schema\n");
      expect(result.stderr).not.toMatch(/Traceback|    at /);
      expect(existsSync(join(previewFolder(root), "real-work.json"))).toBe(false);
      expect(existsSync(join(previewFolder(root), "real-work.html"))).toBe(false);
      expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
    },
  );

  it("A3-1 keeps an existing preview folder byte-identical after an input check refusal", () => {
    const root = repoFixture("a3-1-existing");
    expect(runPreview(root).status).toBe(0);
    const preview = previewFolder(root);
    const indexBefore = readFileSync(join(preview, "index.html"), "utf8");
    const baseBefore = readFileSync(join(preview, "preview-base.json"), "utf8");
    expect(indexBefore).toContain('href="./real-work.html"');
    stageFixture(root, (doc) => {
      doc.schema = "real-work-outcomes/invalid";
    });
    const before = snapshot(preview);
    const docsBefore = snapshot(join(root, "docs"));
    const result = runPreview(root);
    expect(result.status, `A3-1 status: ${result.status}`).toBe(2);
    expect(result.stdout).toBe("input-check: schema\n");
    expect(result.stderr).toBe("");
    expect(snapshot(preview)).toEqual(before);
    expect(readFileSync(join(preview, "index.html"), "utf8")).toBe(indexBefore);
    expect(readFileSync(join(preview, "preview-base.json"), "utf8")).toBe(baseBefore);
    expect(snapshot(join(root, "docs"))).toEqual(docsBefore);
  });

  it("A3-1 leaves no new parent folder after a refusal into a new nested preview folder", () => {
    const root = repoFixture("a3-1-nested");
    stageFixture(root, (doc) => {
      doc.schema = "real-work-outcomes/invalid";
    });
    const target = join(root, ".tmp", "a3-1-nested-parent", "leaf");
    const docsBefore = snapshot(join(root, "docs"));
    const result = runPreview(root, target);
    expect(result.status, `A3-1 nested status: ${result.status}`).toBe(2);
    expect(result.stdout).toBe("input-check: schema\n");
    expect(result.stderr).toBe("");
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

  it('Acceptance 5: an export with no work-type rows renders "no pick yet"', () => {
    const root = repoFixture("pa1-1-empty");
    stageFixture(root, (doc) => {
      for (const item of doc.all_time) item.work_types = {};
    });
    const result = runPreview(root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const page = readFileSync(join(previewFolder(root), "real-work.html"), "utf8");
    expect(page).toContain("no pick yet");
  });

  it('Acceptance 5 (PA1-1): a work type carried only by the unknown route renders a heading and "no pick yet" with no table', () => {
    const root = repoFixture("pa1-1-unknown");
    stageFixture(root, (doc) => {
      const unknown = doc.all_time.find((item: any) => item.route === "unknown");
      unknown.work_types = { translation: { runs: 5, pass: 3, fail: 2 } };
    });
    const result = runPreview(root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const page = readFileSync(join(previewFolder(root), "real-work.html"), "utf8");
    expect(page).toContain("<h3>translation</h3>");
    const start = page.indexOf("<h3>translation</h3>");
    const nextHeading = page.indexOf("<h3>", start + 1);
    const section = nextHeading < 0 ? page.slice(start) : page.slice(start, nextHeading);
    expect(section).toContain("no pick yet");
    expect(section).not.toContain("<table>");
    const appCode = page.indexOf("<h3>app code</h3>");
    expect(appCode).toBeGreaterThan(-1);
    const appNext = page.indexOf("<h3>", appCode + 1);
    const appSection = appNext < 0 ? page.slice(appCode) : page.slice(appCode, appNext);
    expect(appSection).toContain("<table>");
  });
});

/**
 * Red tests for plan task 1.20: the UX findings U1, U3, and U4 of the
 * browser review `measure/runs/model_guide/ux-browser-2a9d421.json`. They
 * read the generated `real-work.html` in the preview folder.
 *
 * Pinned contracts:
 *
 * U1 (blocking): at 390 px the Source card clips the SHA-256, because the
 *   source paragraph has no wrap rule and `.card` sets `overflow: hidden`
 *   (spec D16 requires the readable hash on the page). The generated page
 *   must carry a wrap rule for the source paragraph or for an element that
 *   wraps it inside the Source card: `overflow-wrap: anywhere` or
 *   `word-break: break-all`, either in an inline `style` attribute or in a
 *   class rule inside a `<style>` block of the generated page. Both forms
 *   pass. The fix needs no change under `docs/`.
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

  /** The Source card: the `<section>` that holds `<h2>Source</h2>`. */
  function sourceSection(page: string): string {
    const at = page.indexOf("<h2>Source</h2>");
    expect(at, "the page holds a Source heading").toBeGreaterThan(-1);
    const start = page.lastIndexOf("<section", at);
    const end = page.indexOf("</section>", at);
    expect(start, "the Source heading sits in a section").toBeGreaterThan(-1);
    expect(end, "the Source section closes").toBeGreaterThan(at);
    return page.slice(start, end + "</section>".length);
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

  it("U1: the source paragraph or a wrapper in the Source card carries a wrap rule", () => {
    const page = generatedPage("u1");
    const section = sourceSection(page);
    const h2End = section.indexOf("</h2>");
    const shaAt = section.indexOf("SHA-256");
    expect(shaAt, "the Source card holds the SHA-256 line").toBeGreaterThan(-1);
    const pOpen = section.lastIndexOf("<p", shaAt);
    expect(pOpen, "the SHA-256 line sits in a paragraph").toBeGreaterThan(h2End);
    const pTag = section.slice(pOpen, section.indexOf(">", pOpen) + 1);
    const wrapperTags =
      section.slice(h2End + "</h2>".length, pOpen).match(/<[a-zA-Z][^>]*>/g) ?? [];
    const chain = [pTag, ...wrapperTags];
    const inline = chain.some(styleCarriesWrap);
    const viaClass = chain.some((tag) =>
      classesOf(tag).some((cls) => classRuleCarriesWrap(page, cls)),
    );
    expect(
      inline || viaClass,
      "U1: the source paragraph or a wrapper inside the Source card must carry " +
        "`overflow-wrap: anywhere` or `word-break: break-all`, as an inline style " +
        `attribute or as a class rule in a <style> block of the page. Paragraph tag: ` +
        `${pTag}; wrapper tags: ${wrapperTags.join(" ") || "none"}`,
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
    json: any;
    audit?: any;
    auditSection?: string;
  }

  let pageGuardCache: Snapshot | null = null;
  let blockCache: Snapshot | null = null;

  /** The generated page of the page-guard fixture (G1 to G4). */
  function pageGuardSnapshot(): Snapshot {
    if (!pageGuardCache) {
      const root = repoFixture("page-guard");
      const exportPath = stagePageGuard(root);
      const result = runPreviewArgs(root, ["--export", exportPath]);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const preview = previewFolder(root);
      pageGuardCache = {
        page: readFileSync(join(preview, "real-work.html"), "utf8"),
        json: JSON.parse(readFileSync(join(preview, "real-work.json"), "utf8")),
      };
    }
    return pageGuardCache;
  }

  /** The generated page that holds the print-audit block (T1, T11, N4). */
  function blockSnapshot(): Snapshot {
    if (!blockCache) {
      const root = repoFixture("print-audit-block");
      stagePrintAuditData(root);
      const exportPath = stagePageGuard(root);
      const result = runPreviewArgs(root, ["--export", exportPath]);
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
        json: JSON.parse(readFileSync(join(preview, "real-work.json"), "utf8")),
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

  it("G1: the source line carries generated 2026-10-20 from the sentinel fixture", () => {
    const { page } = pageGuardSnapshot();
    expect(page).toContain("generated 2026-10-20");
    expect(page).not.toContain("generated 2026-11-14");
  });

  it("G2: the coverage block holds 1,285, the two dates, and both shares as percents", () => {
    const { page, json } = pageGuardSnapshot();
    expect(json.coverage.runs).toBe(1285);
    expect(page).toContain("1,285");
    expect(page).toContain(
      `${json.coverage.first_run_date} to ${json.coverage.last_run_date}`,
    );
    expect(page).toContain("2026-10-01 to 2026-11-01");
    expect(page).toContain(`${(json.coverage.share_known_route * 100).toFixed(1)} %`);
    expect(page).toContain(`${(json.coverage.share_with_result * 100).toFixed(1)} %`);
    expect(page).toContain("38.9 %");
    expect(page).toContain("77.8 %");
  });

  it("G3: each few-runs row shows few runs and a row with 10 results shows none", () => {
    const { page, json } = pageGuardSnapshot();
    for (const [group, heading] of [
      ["producer", "Producer roles"],
      ["checker", "Checker roles"],
    ] as const) {
      const rows = json[group];
      expect(rows.some((row: any) => row.few_runs), `${group} has a marked row`).toBe(true);
      expect(rows.some((row: any) => !row.few_runs), `${group} has an unmarked row`).toBe(true);
      const html = bodyRows(mainSection(page, heading));
      expect(html).toHaveLength(rows.length);
      rows.forEach((row: any, index: number) => {
        expect(
          html[index].join(" ").includes("few runs"),
          `${group} row ${index} (${row.model}, n=${row.pass_rate.n})`,
        ).toBe(row.few_runs);
      });
    }
    for (const [name, rows] of Object.entries<any>(json.work_types)) {
      const html = bodyRows(workTypeSection(page, name));
      expect(html).toHaveLength(rows.length);
      rows.forEach((row: any, index: number) => {
        expect(
          html[index].join(" ").includes("few runs"),
          `work type ${name} row ${index} (${row.model}, n=${row.pass_rate.n})`,
        ).toBe(row.few_runs);
      });
    }
  });

  it("G4: each rate cell ends with (n=<pass_rate.n>) and the integer equals the JSON value", () => {
    const { page, json } = pageGuardSnapshot();
    const check = (cells: string[], label: string, rate: any, at: number) => {
      if (rate.value === null) {
        expect(cells[at]).toBe("no rate");
        return;
      }
      expect(
        cells[at].endsWith(` (n=${rate.n})`),
        `${label}: cell ${JSON.stringify(cells[at])} must end with (n=${rate.n})`,
      ).toBe(true);
    };
    for (const [group, heading] of [
      ["producer", "Producer roles"],
      ["checker", "Checker roles"],
    ] as const) {
      const html = bodyRows(mainSection(page, heading));
      json[group].forEach((row: any, index: number) => {
        check(html[index], `${group} pass rate`, row.pass_rate, 9);
        check(html[index], `${group} blocking rate`, row.blocking_rate, 10);
      });
    }
    for (const [name, rows] of Object.entries<any>(json.work_types)) {
      const html = bodyRows(workTypeSection(page, name));
      rows.forEach((row: any, index: number) => {
        check(html[index], `${name} pass rate`, row.pass_rate, 6);
      });
    }
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
