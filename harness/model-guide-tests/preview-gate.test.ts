import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync,
  readdirSync, rmSync, symlinkSync, writeFileSync,
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

function repoFixture(tag: string) {
  requireProduction();
  const root = mkdtempSync(join(tmpdir(), `model-guide-preview-${tag}-`));
  roots.push(root);
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
  return root;
}

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `model-guide-preview-${tag}-`));
  roots.push(dir);
  return dir;
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

function runPreview(root: string, preview?: string, cwd = root) {
  const args = [
    join(root, "harness", "model-guide", "preview.sh"),
    "--export", join(root, "fixture", "real-work-mini.json"),
  ];
  if (preview !== undefined) args.push("--preview", preview);
  return spawnSync("bash", args, {
    cwd,
    env: env(),
    encoding: "utf8",
    timeout: 120_000,
  });
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
});
