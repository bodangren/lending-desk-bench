import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  statSync, symlinkSync, writeFileSync,
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
 * publish.ts
 *   cd <repo>/harness && npx tsx model-guide/publish.ts --preview <folder>
 *   The approval record is `<repo>/measure/tracks/model_guide/publish-approval.md`:
 *     approved_by: <name>
 *     date: <YYYY-MM-DD>
 *     files:
 *     <sha256>  <path relative to docs/>
 *   The checks run in this order:
 *     1. no approval record        -> exit 2, `publish: no approval record`
 *     2. an approved SHA-256 differs from the preview file
 *                                  -> exit 2, `publish: sha256 <path>`
 *     3. a docs/ file differs from preview-base.json
 *                                  -> exit 2, `publish: drift <path>`
 *     4. else copy each approved preview file to `<repo>/docs/<path>`, exit 0.
 *   Each refusal prints one line on stdout and writes no file.
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
  const copy = { ...process.env, NO_COLOR: "1" };
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
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, rel));
    else out.push(rel);
  }
  return out;
}

function snapshot(dir: string): string[] {
  return filesUnder(dir).map((rel) => `file ${rel} ${sha256(join(dir, rel))}`);
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

function previewFolder(root: string): string {
  return join(root, ".tmp", "model-guide-preview");
}

function runPreview(root: string) {
  return spawnSync("bash", [
    join(root, "harness", "model-guide", "preview.sh"),
    "--export", join(root, "fixture", "real-work-mini.json"),
  ], { cwd: root, env: env(), encoding: "utf8", timeout: 120_000 });
}

function runPublish(root: string) {
  return spawnSync("npx", [
    "tsx", "model-guide/publish.ts", "--preview", previewFolder(root),
  ], {
    cwd: join(root, "harness"), env: env(), encoding: "utf8", timeout: 120_000,
  });
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

function approvedHashes(root: string, paths: string[]): Array<[string, string]> {
  return paths.map((path) => [sha256(join(previewFolder(root), path)), path]);
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
});
