import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  renameSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Adversarial tests for Phase 1 of model_guide (role: adversarial).
 *
 * Every case starts from a synthetic temp repo or a temp folder. No case
 * reads the real docs/, the real export, a model, the network, or the
 * private folder. Each case asserts a promise of a tool header or of the
 * spec. A case that fails on the audited HEAD marks an implementation
 * defect for Green; no case was weakened to pass.
 *
 * Case ids:
 *   S  starting points of the review findings (A5-1, A5-2, A5-3, C5-2, C5-3)
 *   X  path classes of --manifest
 *   V  path classes of --preview
 *   H  hostile export JSON (input check)
 *   E  HTML escaping of the page
 *   P  approval record parser and the publish gate
 *   L  leak guard
 */

const HARNESS = resolve(import.meta.dirname, "..");
const SOURCE = join(HARNESS, "model-guide");
const PAGE_B = join(import.meta.dirname, "fixtures", "page-b");
const OUTCOMES_NAME = "ra-outcomes-2026-10-20.json";
const AA_NAME = "aa-reliability-2026-10-20.json";
const ALLOWED_NAME = "allowed-routes-2026-10-20.json";
const MANIFEST_NAME = "MANIFEST-2026-10-20.txt";
/** The staged outcomes rows (the array the tools read). */
const FIXTURE = join(PAGE_B, OUTCOMES_NAME);
const GUARD = join(import.meta.dirname, "leak-guard.test.ts");

const INDEX_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Overview</title>
<link rel="stylesheet" href="./assets/css/site.css"></head>
<body><nav><a href="./methodology.html">Methodology</a>
<a href="./results.html">Results</a><a href="./models/">Models</a>
<a href="./tracks.html">Tracks</a></nav>
<main><h1>Overview</h1></main></body></html>
`;

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const ROOT_SKIP_REASON =
  "skipped as root: a mode 000 entry stays readable for root, so the case cannot occur";

const roots: string[] = [];
const modes: string[] = [];
afterAll(() => {
  // Restore the modes first: rmSync cannot list a mode 000 folder.
  for (const path of modes) {
    try { chmodSync(path, 0o755); } catch { /* the path is gone */ }
  }
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function env(): NodeJS.ProcessEnv {
  const copy = { ...process.env, NO_COLOR: "1", npm_config_loglevel: "silent" };
  delete copy.BENCH_TRACK;
  return copy;
}

function sha256Text(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `model-guide-adv-${tag}-`));
  roots.push(dir);
  return dir;
}

/** A snapshot that never reads a special file and never fails on a mode 000
 * folder, so a FIFO or a locked folder cannot hang or crash the test. */
function snap(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string, prefix: string) => {
    let names: string[];
    try {
      names = readdirSync(current).sort();
    } catch {
      out.push(`unreadable ${prefix || "."}`);
      return;
    }
    for (const name of names) {
      const full = join(current, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const info = lstatSync(full);
      if (info.isSymbolicLink()) out.push(`link ${rel}`);
      else if (info.isDirectory()) {
        out.push(`dir ${rel}`);
        walk(full, rel);
      } else if (info.isFile()) {
        try {
          out.push(`file ${rel} ${sha256Text(readFileSync(full))}`);
        } catch {
          out.push(`unreadable ${rel}`);
        }
      } else out.push(`special ${rel}`);
    }
  };
  if (existsSync(dir)) walk(dir, "");
  return out;
}

function populateRepo(root: string): void {
  mkdirSync(join(root, "harness"), { recursive: true });
  cpSync(SOURCE, join(root, "harness", "model-guide"), { recursive: true });
  mkdirSync(join(root, "docs", "assets", "css"), { recursive: true });
  mkdirSync(join(root, "docs", "assets", "data"), { recursive: true });
  writeFileSync(join(root, "docs", "index.html"), INDEX_HTML);
  writeFileSync(join(root, "docs", "assets", "css", "site.css"), "body { color: black; }\n");
  writeFileSync(join(root, "docs", "assets", "data", "benchmark.json"), '{"schema":1}\n');
  mkdirSync(join(root, "measure", "tracks", "model_guide"), { recursive: true });
  mkdirSync(join(root, "fixture-b"), { recursive: true });
  for (const name of [OUTCOMES_NAME, AA_NAME, ALLOWED_NAME, MANIFEST_NAME]) {
    writeFileSync(join(root, "fixture-b", name), readFileSync(join(PAGE_B, name)));
  }
  symlinkSync(join(HARNESS, "node_modules"), join(root, "harness", "node_modules"));
}

function repoFixture(tag: string): string {
  const root = tempDir(tag);
  populateRepo(root);
  return root;
}

function previewFolder(root: string): string {
  return join(root, ".tmp", "model-guide-preview");
}

/** Stage the page B files from raw outcomes text and a manifest that
 * matches them. Returns the manifest path (the CLI argument). */
function stageText(dir: string, text: string, name = OUTCOMES_NAME, crlf = false): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), text);
  for (const other of [AA_NAME, ALLOWED_NAME]) {
    writeFileSync(join(dir, other), readFileSync(join(PAGE_B, other)));
  }
  const lines = [name, AA_NAME, ALLOWED_NAME].map((file) => {
    const data = readFileSync(join(dir, file));
    return `${sha256Text(data)}  ${data.length}  ${file}`;
  });
  writeFileSync(join(dir, MANIFEST_NAME), lines.join(crlf ? "\r\n" : "\n"));
  return join(dir, MANIFEST_NAME);
}

/** The outcomes rows with the legacy field aliases the old cases mutate:
 * `all_time` is the live rows array, the other aliases hold no input. */
function legacyFixture(): { doc: any; rows: any[] } {
  const rows = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const doc = {
    schema: "real-work-outcomes/1",
    generated_on: "2026-10-20",
    coverage: {} as Record<string, unknown>,
    all_time: rows,
    weekly: [] as any[],
  };
  return { doc, rows };
}

function stageDoc(dir: string, mutate: (doc: any) => void, name = OUTCOMES_NAME): string {
  const { doc, rows } = legacyFixture();
  mutate(doc);
  return stageText(dir, `${JSON.stringify(rows, null, 2)}\n`, name);
}

function runPreviewArgs(root: string, args: string[], cwd = root) {
  return spawnSync("bash", [join(root, "harness", "model-guide", "preview.sh"), ...args], {
    cwd, env: env(), encoding: "utf8", timeout: 120_000,
  });
}

function runPreview(root: string, manifestPath?: string, preview?: string) {
  const args = ["--manifest", manifestPath ?? join(root, "fixture-b", MANIFEST_NAME)];
  if (preview !== undefined) args.push("--preview", preview);
  return runPreviewArgs(root, args);
}

function runTool(manifestPath: string, out: string) {
  return spawnSync(
    join(HARNESS, "node_modules", ".bin", "tsx"),
    ["model-guide/real-work.ts", "--manifest", manifestPath, "--out", out],
    { cwd: HARNESS, env: env(), encoding: "utf8", timeout: 120_000 },
  );
}

function runPublish(root: string, preview = previewFolder(root)) {
  return spawnSync(
    join(root, "harness", "node_modules", ".bin", "tsx"),
    ["model-guide/publish.ts", "--preview", preview],
    { cwd: join(root, "harness"), env: env(), encoding: "utf8", timeout: 120_000 },
  );
}

function writeRecordText(root: string, text: string): void {
  // Both paths: the stable path the tools read (written after the harness
  // copy, so the fixture rows win over any copied real record) and the old
  // track path the previous contract used.
  writeFileSync(join(root, "harness", "model-guide", "publish-approval.md"), text);
  writeFileSync(join(root, "measure", "tracks", "model_guide", "publish-approval.md"), text);
}

function writeRecord(root: string, rows: Array<[string, string]>): void {
  writeRecordText(root, [
    "approved_by: Daniel",
    "date: 2026-11-20",
    "files:",
    ...rows.map(([sha, path]) => `${sha}  ${path}`),
    "",
  ].join("\n"));
}

function hashOf(root: string, path: string): string {
  return sha256Text(readFileSync(join(previewFolder(root), path)));
}

/** A clean preview of the synthetic repo plus an approval of the two page files. */
function approvedRepo(tag: string): string {
  const root = repoFixture(tag);
  const run = runPreview(root);
  expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
  writeRecord(root, [
    [hashOf(root, "real-work.html"), "real-work.html"],
    [hashOf(root, "real-work.json"), "real-work.json"],
  ]);
  return root;
}

/** Strip stack frames from child output before it enters an assertion
 * message, so the test runner does not try to map the frames of a temp file. */
function brief(text: string): string {
  return text.split("\n").filter((line) => !/^\s+at /.test(line)).join(" | ").slice(0, 240);
}

const NO_TRACE = /Traceback|    at |node:internal|TypeError|SyntaxError|RangeError|RecursionError/;

describe("S: starting points of the review findings", () => {
  it("S A5-1 refuses preview.sh with an unreadable directory under docs with a refusal line and exit 2", (ctx) => {
    if (isRoot) ctx.skip(ROOT_SKIP_REASON);
    const root = repoFixture("s-a5-1");
    mkdirSync(join(root, "docs", "lockdir"));
    writeFileSync(join(root, "docs", "lockdir", "inner.txt"), "inner\n");
    const docsBefore = snap(join(root, "docs"));
    modes.push(join(root, "docs", "lockdir"));
    chmodSync(join(root, "docs", "lockdir"), 0o000);
    const result = runPreview(root);
    chmodSync(join(root, "docs", "lockdir"), 0o755);
    expect(result.stdout).toBe("preview: unreadable docs/lockdir\n");
    expect(result.status, `${result.stdout}\n${brief(result.stderr)}`).toBe(2);
    expect(result.stderr).toBe("");
    expect(existsSync(join(root, ".tmp"))).toBe(false);
    expect(snap(join(root, "docs"))).toEqual(docsBefore);
  });

  it("S A5-2 ends preview.sh when docs holds a FIFO, and writes no file under docs", () => {
    const root = repoFixture("s-a5-2");
    const made = spawnSync("mkfifo", [join(root, "docs", "pipe")]);
    expect(made.status).toBe(0);
    const docsBefore = snap(join(root, "docs"));
    // timeout stops the whole process group, so no hung child stays behind.
    const result = spawnSync("timeout", [
      "-k", "2", "20", "bash", join(root, "harness", "model-guide", "preview.sh"),
      "--manifest", join(root, "fixture-b", MANIFEST_NAME),
    ], { cwd: root, env: env(), encoding: "utf8", timeout: 90_000 });
    expect([124, 137], `preview.sh hung on a FIFO; status ${result.status}`).not.toContain(result.status);
    expect(result.status).not.toBe(0);
    expect(snap(join(root, "docs"))).toEqual(docsBefore);
  });

  it("S A5-2 refuses publish with a FIFO under docs as drift and writes no file", () => {
    const root = approvedRepo("s-a5-2-publish");
    expect(spawnSync("mkfifo", [join(root, "docs", "pipe")]).status).toBe(0);
    const docsBefore = snap(join(root, "docs"));
    const result = runPublish(root);
    expect(result.status, `${result.stdout}\n${brief(result.stderr)}`).toBe(2);
    expect(result.stdout).toBe("publish: drift pipe\n");
    expect(result.stderr).toBe("");
    expect(snap(join(root, "docs"))).toEqual(docsBefore);
  });

  it("S A5-3 names the dangling link in the preview.sh refusal line", () => {
    const root = repoFixture("s-a5-3");
    symlinkSync(join(root, "no-such-target.txt"), join(root, "docs", "dangling.txt"));
    const docsBefore = snap(join(root, "docs"));
    const result = runPreview(root);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe(`preview: refused path ${join(root, "docs", "dangling.txt")}\n`);
    expect(result.stderr).toBe("");
    expect(existsSync(join(root, ".tmp"))).toBe(false);
    expect(snap(join(root, "docs"))).toEqual(docsBefore);
  });

  it("S C5-2 prints no empty path in a publish drift line when the docs root is unreadable", (ctx) => {
    if (isRoot) ctx.skip(ROOT_SKIP_REASON);
    const root = approvedRepo("s-c5-2");
    modes.push(join(root, "docs"));
    chmodSync(join(root, "docs"), 0o000);
    let result;
    try {
      result = runPublish(root);
    } finally {
      chmodSync(join(root, "docs"), 0o755);
    }
    expect(result.status, `${result.stdout}\n${brief(result.stderr)}`).toBe(2);
    const lines = result.stdout.split("\n").filter((line) => line !== "");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/^publish: drift \S+$/);
    expect(result.stderr).not.toMatch(NO_TRACE);
    expect(existsSync(join(root, "docs", "real-work.html"))).toBe(false);
  });

  it("S C5-2 refuses preview.sh with an unreadable docs root with one refusal line and exit 2", (ctx) => {
    if (isRoot) ctx.skip(ROOT_SKIP_REASON);
    const root = repoFixture("s-c5-2-preview");
    modes.push(join(root, "docs"));
    chmodSync(join(root, "docs"), 0o000);
    let result;
    try {
      result = runPreview(root);
    } finally {
      chmodSync(join(root, "docs"), 0o755);
    }
    expect(result.status, `${result.stdout}\n${brief(result.stderr)}`).toBe(2);
    expect(result.stdout).toMatch(/^preview: unreadable \S+\n$/);
    expect(result.stderr).toBe("");
    expect(existsSync(join(root, ".tmp"))).toBe(false);
  });

  it("S C5-3 refuses publish when the docs root is a symlink and writes through no link", () => {
    const root = approvedRepo("s-c5-3");
    renameSync(join(root, "docs"), join(root, "docs-real"));
    symlinkSync(join(root, "docs-real"), join(root, "docs"));
    const realBefore = snap(join(root, "docs-real"));
    const result = runPublish(root);
    expect(result.stderr).not.toMatch(NO_TRACE);
    expect(snap(join(root, "docs-real")), `publish wrote through the docs root link; status ${result.status}`)
      .toEqual(realBefore);
    expect(result.status, `${result.stdout}\n${brief(result.stderr)}`).toBe(2);
  });
});

describe("X: path classes of --manifest", () => {
  function expectRefusal(root: string, file: string): void {
    const docsBefore = snap(join(root, "docs"));
    const result = runPreview(root, file);
    expect(result.stderr, `status ${result.status}\n${result.stdout}`).toMatch(/^input-check: \S+( \S+)?\n$/);
    expect(result.status).toBe(2);
    expect(result.stdout, "the refusal line goes to stderr (spec Q-S3)").toBe("");
    expect(existsSync(join(root, ".tmp"))).toBe(false);
    expect(snap(join(root, "docs"))).toEqual(docsBefore);
  }

  it("X refuses a manifest path that does not exist, with exit 2", () => {
    const root = repoFixture("x-missing");
    expectRefusal(root, join(root, "fixture-b", "MANIFEST-2026-10-21.txt"));
  });

  it("X refuses a manifest path that is a folder with exit 2", () => {
    const root = repoFixture("x-dir");
    mkdirSync(join(root, "fixture-b", "MANIFEST-2026-10-22.txt"));
    expectRefusal(root, join(root, "fixture-b", "MANIFEST-2026-10-22.txt"));
  });

  it("X accepts a manifest path with spaces and unicode in the name", () => {
    const root = repoFixture("x-space");
    const dir = join(root, "fix ture é");
    mkdirSync(dir);
    // The folder path carries the spaces and the unicode character; the
    // staged file names stay the exact dated names of the RA-3 rule.
    const file = stageDoc(dir, () => {});
    const result = runPreview(root, file);
    expect(result.status, `${result.stdout}\n${brief(result.stderr)}`).toBe(0);
    expect(
      existsSync(join(previewFolder(root), "real-work.json")),
      "the run writes the page data file",
    ).toBe(true);
    expect(existsSync(join(previewFolder(root), "real-work.html"))).toBe(true);
  });

  it("X accepts a manifest with CRLF line ends", () => {
    const root = repoFixture("x-crlf");
    const dir = join(root, "crlf");
    mkdirSync(dir);
    const text = readFileSync(FIXTURE, "utf8");
    const file = stageText(dir, text, OUTCOMES_NAME, true);
    const result = runPreview(root, file);
    expect(result.status, `${result.stdout}\n${brief(result.stderr)}`).toBe(0);
  });

  it("X accepts a manifest symlink and reads the data files beside its target", () => {
    const root = repoFixture("x-link");
    const dir = join(root, "linkdir");
    mkdirSync(dir);
    stageText(dir, readFileSync(FIXTURE, "utf8"), OUTCOMES_NAME);
    symlinkSync(join(dir, MANIFEST_NAME), join(dir, "alias-manifest.txt"));
    const result = runPreview(root, join(dir, "alias-manifest.txt"));
    expect(result.status, `${result.stdout}\n${brief(result.stderr)}`).toBe(0);
  });
});

describe("V: path classes of --preview", () => {
  it("V refuses a preview path that is an existing regular file and leaves the file and docs byte-identical", () => {
    const root = repoFixture("v-file");
    const target = join(root, "preview-is-a-file");
    writeFileSync(target, "keep me\n");
    const docsBefore = snap(join(root, "docs"));
    const result = runPreview(root, undefined, target);
    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toMatch(/Traceback|    at /);
    expect(readFileSync(target, "utf8")).toBe("keep me\n");
    expect(snap(join(root, "docs"))).toEqual(docsBefore);
  });

  it("V writes through a preview symlink to an outside folder and leaves docs byte-identical", () => {
    const root = repoFixture("v-outlink");
    const outside = tempDir("v-outlink-target");
    const link = join(root, "pv-link");
    symlinkSync(outside, link);
    const docsBefore = snap(join(root, "docs"));
    const result = runPreview(root, undefined, link);
    expect(result.status, `${result.stdout}\n${brief(result.stderr)}`).toBe(0);
    expect(existsSync(join(outside, "real-work.html"))).toBe(true);
    expect(snap(join(root, "docs"))).toEqual(docsBefore);
  });

  it("V refuses a new folder below a symlink that points into docs, before any write", () => {
    const root = repoFixture("v-into-docs");
    symlinkSync(join(root, "docs", "assets"), join(root, "lnk"));
    const docsBefore = snap(join(root, "docs"));
    const result = runPreview(root, undefined, "lnk/newdir");
    expect(result.status, `${result.stdout}\n${brief(result.stderr)}`).toBe(2);
    expect(result.stdout).toBe("preview: refused path lnk/newdir\n");
    expect(result.stderr).toBe("");
    expect(existsSync(join(root, "docs", "assets", "newdir"))).toBe(false);
    expect(snap(join(root, "docs"))).toEqual(docsBefore);
  });

  it("V refuses a preview symlink that points to the repo root, because docs sits below it", () => {
    const root = repoFixture("v-to-root");
    symlinkSync(root, join(root, "to-root"));
    const docsBefore = snap(join(root, "docs"));
    const result = runPreview(root, undefined, "to-root");
    expect(result.status, `${result.stdout}\n${brief(result.stderr)}`).toBe(2);
    expect(result.stdout).toBe("preview: refused path to-root\n");
    expect(result.stderr).toBe("");
    expect(snap(join(root, "docs"))).toEqual(docsBefore);
  });
});

describe("H: hostile export JSON through the input check", () => {
  function expectNoCrash(text: string, tag: string): void {
    const dir = tempDir(`h-${tag}`);
    const file = stageText(dir, text);
    const out = join(dir, "out");
    const result = runTool(file, out);
    expect(result.stderr, `status ${result.status}`).not.toMatch(NO_TRACE);
    expect([0, 2], `the tool exits 0 or 2; got ${result.status}`).toContain(result.status);
    if (result.status === 2) {
      expect(result.stderr).toMatch(/^input-check: \S+( \S+)?\n$/);
      expect(result.stdout, "the refusal line goes to stderr (spec Q-S3)").toBe("");
      expect(existsSync(out)).toBe(false);
    }
  }

  it("H refuses export text that is not JSON with exit 2 and no stack trace", () => {
    expectNoCrash('{"schema": "real-work-outcomes/1", ', "badjson");
  });

  it("H refuses a JSON null root with exit 2 and no stack trace", () => {
    expectNoCrash("null\n", "null");
  });

  it("H refuses JSON roots that are an array, a string, and a number", () => {
    expectNoCrash("[]\n", "array");
    expectNoCrash('"text"\n', "string");
    expectNoCrash("42\n", "number");
  });

  it("H handles an all_time row whose route is not a string without a stack trace", () => {
    for (const route of [5, null, { a: 1 }, ["x/m"]]) {
      const { rows } = legacyFixture();
      rows[0].route = route;
      expectNoCrash(`${JSON.stringify(rows)}\n`, "route");
    }
  });

  it("H handles an all_time row without a route key without a stack trace", () => {
    const { rows } = legacyFixture();
    delete rows[0].route;
    expectNoCrash(`${JSON.stringify(rows)}\n`, "noroute");
  });

  it("H keeps a deeply nested extra key from breaking the preview after it started to write", () => {
    const root = repoFixture("h-deep");
    const depth = 30000;
    const { rows } = legacyFixture();
    (rows[0] as any).extra = "@@DEEP@@";
    // Build the text by hand: JSON.stringify of a 30000 level value would overflow here.
    const text = JSON.stringify(rows).replace('"@@DEEP@@"', "[".repeat(depth) + "]".repeat(depth));
    const file = stageText(join(root, "fixture-b"), `${text}\n`);
    const result = runPreview(root, file);
    expect([0, 2], `status ${result.status}\n${brief(result.stderr)}`).toContain(result.status);
    expect(result.stderr).not.toMatch(NO_TRACE);
    if (result.status !== 0) expect(existsSync(previewFolder(root))).toBe(false);
  });

  it("H passes no extra coverage key of the export into the public real-work.json", () => {
    const root = repoFixture("h-leak-coverage");
    const canary = "CANARY-coverage-extra-9f3a";
    const file = stageDoc(join(root, "fixture"), (doc) => {
      doc.coverage.private_note = canary;
    });
    const result = runPreview(root, file);
    expect(result.status, `${result.stdout}\n${brief(result.stderr)}`).toBe(0);
    const json = readFileSync(join(previewFolder(root), "real-work.json"), "utf8");
    expect(json).not.toContain(canary);
    expect(readFileSync(join(previewFolder(root), "real-work.html"), "utf8")).not.toContain(canary);
  });

  /** Run the tool on a mutated export. The rule: an exit 0 page holds only
   * finite counts and a pass rate inside 0 to 1 (spec D16: pass / (pass + fail + error)),
   * or the tool refuses the export. */
  function expectSaneOrRefused(mutate: (doc: any) => void, tag: string): void {
    const dir = tempDir(`h-${tag}`);
    const file = stageDoc(dir, mutate);
    const out = join(dir, "out");
    const result = runTool(file, out);
    expect([0, 2], `status ${result.status}: ${brief(result.stderr)}`).toContain(result.status);
    if (result.status !== 0) return;
    const page = JSON.parse(readFileSync(join(out, "real-work.json"), "utf8"));
    for (const row of [...page.producer, ...page.checker]) {
      for (const key of ["runs", "pass", "fail", "error", "no_result", "blocking_findings"]) {
        expect(Number.isFinite(row[key]), `${row.model} ${key} is ${row[key]}`).toBe(true);
      }
      const rate = row.pass_rate;
      expect(Number.isFinite(rate.n), `${row.model} rate n is ${rate.n}`).toBe(true);
      if (rate.value !== null) {
        expect(rate.value, `${row.model} rate ${rate.value}`).toBeGreaterThanOrEqual(0);
        expect(rate.value, `${row.model} rate ${rate.value}`).toBeLessThanOrEqual(1);
      }
    }
  }

  it("H refuses a negative result count, or keeps every pass rate inside 0 to 1", () => {
    expectSaneOrRefused((doc) => {
      const row = doc.all_time.find((r: any) => r.route === "t1/prod-one#high");
      expect(row, "the fixture holds the t1/prod-one#high producer row").toBeDefined();
      row!.pass = 50;
      row!.fail = -30;
    }, "negative");
  });

  it("H refuses a count too large to add, or keeps every count a finite number", () => {
    expectSaneOrRefused((doc) => {
      const rows = doc.all_time.filter((r: any) => r.role === "red" && r.route.startsWith("t1/"));
      expect(rows.length, "the fixture holds red t1 producer rows").toBeGreaterThanOrEqual(2);
      for (const row of rows.slice(0, 2)) row.pass = 1e308;
    }, "huge");
  });

  it("H keeps route names that equal Object prototype members as separate rows", () => {
    const dir = tempDir("h-proto-route");
    const names = ["constructor", "toString", "__proto__", "hasOwnProperty"];
    const file = stageDoc(dir, (doc) => {
      const rows = doc.all_time.filter((r: any) => r.route !== "unknown" && r.route !== "other");
      names.forEach((name, i) => {
        rows[i].route = `p/${name}`;
      });
    });
    const out = join(dir, "out");
    const result = runTool(file, out);
    expect(result.status, `${result.stdout}\n${brief(result.stderr)}`).toBe(0);
    const page = JSON.parse(readFileSync(join(out, "real-work.json"), "utf8"));
    const models = [...page.producer, ...page.checker].map((r: any) => r.model);
    for (const name of names) expect(models).toContain(`p/${name}`);
    expect(Object.prototype.hasOwnProperty.call({}, "polluted")).toBe(false);
  });

});

describe("E: HTML escaping of the page", () => {
  const PAYLOAD = '</td></tr></table><script>ADVX(1)</script>"&\'';
  const TOKEN = "<!--MODEL-GUIDE:COVERAGE-->";

  function pageOf(root: string): string {
    return readFileSync(join(previewFolder(root), "real-work.html"), "utf8");
  }

  function tableCount(page: string): number {
    return (page.match(/<table/g) ?? []).length;
  }

  it("E escapes a hostile value in every text field that the page prints", () => {
    const control = repoFixture("e-control");
    expect(runPreview(control).status).toBe(0);
    const root = repoFixture("e-hostile");
    const file = stageDoc(join(root, "fixture"), (doc) => {
      doc.generated_on = `2026-11-14${PAYLOAD}`;
      doc.coverage.first_run_date = `2026-06-06${PAYLOAD}`;
      doc.coverage.last_run_date = `2026-11-13${TOKEN}${PAYLOAD}`;
      const named = doc.all_time.filter((r: any) => r.route !== "unknown" && r.route !== "other");
      named[0].route = `x/m${PAYLOAD}`;
      named[0].ratings = { [`axis${PAYLOAD}`]: { mean: 4, n: 2 } };
      for (const row of named) {
        if (!row.work_types) continue;
        const renamed: Record<string, unknown> = {};
        for (const [name, value] of Object.entries(row.work_types)) {
          renamed[name === "tooling" ? `${name}${PAYLOAD}` : name] = value;
        }
        row.work_types = renamed;
      }
    });
    const result = runPreview(root, file);
    expect(result.status, `${result.stdout}\n${brief(result.stderr)}`).toBe(0);
    const page = pageOf(root);
    expect(page).not.toContain("<script");
    expect(page).not.toContain("</td></tr></table><");
    expect(page).not.toMatch(/<!--MODEL-GUIDE:/);
    expect(page).toContain("&lt;script&gt;ADVX(1)&lt;/script&gt;");
    expect(tableCount(page)).toBe(tableCount(pageOf(control)));
  });

  it("E keeps a template token text in a route name from a second substitution", () => {
    const root = repoFixture("e-token");
    const file = stageDoc(join(root, "fixture"), (doc) => {
      const named = doc.all_time.filter((r: any) => r.route !== "unknown" && r.route !== "other");
      named[0].route = `x/${TOKEN}`;
    });
    const result = runPreview(root, file);
    expect(result.status, `${result.stdout}\n${brief(result.stderr)}`).toBe(0);
    const page = pageOf(root);
    expect(page).not.toContain(TOKEN);
    expect(page).toContain("&lt;!--MODEL-GUIDE:COVERAGE--&gt;");
  });
});

describe("P: approval record parser and the publish gate", () => {
  function docsPlus(root: string, paths: string[]): string[] {
    return [...snap(join(root, "docs")), ...paths.map((p) => `+${p}`)].sort();
  }

  it("P refuses an approval record that holds no approved_by and no date, and writes no file", () => {
    const root = approvedRepo("p-no-who");
    writeRecordText(root, [
      "files:",
      `${hashOf(root, "real-work.html")}  real-work.html`,
      "",
    ].join("\n"));
    const docsBefore = snap(join(root, "docs"));
    const result = runPublish(root);
    expect(snap(join(root, "docs")), `publish wrote with no approved_by; status ${result.status}`)
      .toEqual(docsBefore);
    expect(result.status).toBe(2);
  });

  it("P never writes a wrong file for an approval record with CRLF line ends", () => {
    const root = repoFixture("p-crlf");
    expect(runPreview(root).status).toBe(0);
    writeRecordText(root, [
      "approved_by: Daniel",
      "date: 2026-11-20",
      "files:",
      `${hashOf(root, "real-work.json")}  real-work.json`,
      "",
    ].join("\r\n"));
    const docsBefore = snap(join(root, "docs"));
    const result = runPublish(root);
    expect(result.stderr).not.toMatch(NO_TRACE);
    if (result.status === 2) {
      expect(snap(join(root, "docs"))).toEqual(docsBefore);
    } else {
      expect(result.status).toBe(0);
      expect(snap(join(root, "docs")).sort()).toEqual(
        [...docsBefore, `file real-work.json ${hashOf(root, "real-work.json")}`].sort(),
      );
    }
  });

  it("P refuses two rows for one path when the second SHA-256 is wrong, and writes no file", () => {
    const root = repoFixture("p-dup");
    expect(runPreview(root).status).toBe(0);
    writeRecord(root, [
      [hashOf(root, "real-work.html"), "real-work.html"],
      ["0".repeat(64), "real-work.html"],
    ]);
    const docsBefore = snap(join(root, "docs"));
    const result = runPublish(root);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("publish: sha256 real-work.html\n");
    expect(snap(join(root, "docs"))).toEqual(docsBefore);
  });

  it("P refuses an upper-case SHA-256 as a bad line", () => {
    const root = repoFixture("p-upper");
    expect(runPreview(root).status).toBe(0);
    const line = `${hashOf(root, "real-work.json").toUpperCase()}  real-work.json`;
    writeRecordText(root, `approved_by: Daniel\ndate: 2026-11-20\nfiles:\n${line}\n`);
    const docsBefore = snap(join(root, "docs"));
    const result = runPublish(root);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe(`publish: bad line ${line}\n`);
    expect(snap(join(root, "docs"))).toEqual(docsBefore);
  });

  it("P refuses a comment line after the rows as a bad line, and writes no file", () => {
    const root = repoFixture("p-comment");
    expect(runPreview(root).status).toBe(0);
    writeRecordText(root, [
      "approved_by: Daniel", "date: 2026-11-20", "files:",
      `${hashOf(root, "real-work.json")}  real-work.json`,
      "# approved after a call",
      "",
    ].join("\n"));
    const docsBefore = snap(join(root, "docs"));
    const result = runPublish(root);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("publish: bad line # approved after a call\n");
    expect(snap(join(root, "docs"))).toEqual(docsBefore);
  });

  it("P refuses a row that names a file the preview does not hold, and writes no file", () => {
    const root = repoFixture("p-absent");
    expect(runPreview(root).status).toBe(0);
    writeRecord(root, [["a".repeat(64), "no-such-page.html"]]);
    const docsBefore = snap(join(root, "docs"));
    const result = runPublish(root);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("publish: sha256 no-such-page.html\n");
    expect(snap(join(root, "docs"))).toEqual(docsBefore);
  });

  it("P refuses a preview base that is valid JSON but not an object, with no stack trace", () => {
    for (const body of ["null", "[]", "42", '"text"']) {
      const root = approvedRepo("p-base");
      writeFileSync(join(previewFolder(root), "preview-base.json"), `${body}\n`);
      const docsBefore = snap(join(root, "docs"));
      const result = runPublish(root);
      expect(result.stderr, `base ${body}`).not.toMatch(NO_TRACE);
      expect(result.status, `base ${body}: ${result.stdout}`).toBe(2);
      expect(snap(join(root, "docs"))).toEqual(docsBefore);
    }
  });

  it("P refuses a replayed publish with drift on the files it wrote, and writes nothing more", () => {
    const root = approvedRepo("p-replay");
    const first = runPublish(root);
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
    const docsAfterFirst = snap(join(root, "docs"));
    const second = runPublish(root);
    expect(second.status).toBe(2);
    expect(second.stdout).toBe("publish: drift real-work.html\npublish: drift real-work.json\n");
    expect(snap(join(root, "docs"))).toEqual(docsAfterFirst);
  });

  it("P writes all approved files or none when one destination cannot be written", (ctx) => {
    if (isRoot) ctx.skip(ROOT_SKIP_REASON);
    const root = repoFixture("p-atomic");
    mkdirSync(join(root, "docs", "locked"));
    writeFileSync(join(root, "docs", "locked", "keep.txt"), "keep\n");
    expect(runPreview(root).status).toBe(0);
    mkdirSync(join(previewFolder(root), "locked"), { recursive: true });
    writeFileSync(join(previewFolder(root), "locked", "new.html"), "<p>new</p>\n");
    writeRecord(root, [
      [hashOf(root, "real-work.html"), "real-work.html"],
      [hashOf(root, "locked/new.html"), "locked/new.html"],
    ]);
    modes.push(join(root, "docs", "locked"));
    chmodSync(join(root, "docs", "locked"), 0o555);
    let result;
    try {
      result = runPublish(root);
    } finally {
      chmodSync(join(root, "docs", "locked"), 0o755);
    }
    expect(result.status).not.toBe(0);
    expect(existsSync(join(root, "docs", "real-work.html")),
      "the publish left a half set: real-work.html was written and locked/new.html was not")
      .toBe(false);
  });

  it("P keeps a trailing space in an approval row from changing the written file name", () => {
    const root = repoFixture("p-trailing");
    expect(runPreview(root).status).toBe(0);
    writeRecordText(root, [
      "approved_by: Daniel", "date: 2026-11-20", "files:",
      `${hashOf(root, "real-work.json")}  real-work.json   `,
      "",
    ].join("\n"));
    const docsBefore = snap(join(root, "docs"));
    const result = runPublish(root);
    expect(result.status, `${result.stdout}\n${brief(result.stderr)}`).toBe(0);
    expect(snap(join(root, "docs")).sort()).toEqual(
      [...docsBefore, `file real-work.json ${hashOf(root, "real-work.json")}`].sort(),
    );
    expect(docsPlus(root, [])).not.toContain("file real-work.json   ");
  });
});

describe("L: leak guard", () => {
  const HANDOFF = ["hand", "off/real-work-outcomes"].join("");
  const EXPORT_SHA = [
    "dae855cad4bcd29b0623d8a0b8d4eb7",
    "5aa16a7ddd6688455735bf312df5464f2",
  ].join("");

  function scan(dir: string, needles: string[]): string[] {
    const hits: string[] = [];
    const walk = (current: string) => {
      for (const name of readdirSync(current)) {
        const full = join(current, name);
        const info = lstatSync(full);
        if (info.isDirectory()) walk(full);
        else if (info.isFile()) {
          const text = readFileSync(full, "utf8").toLowerCase();
          for (const needle of needles) {
            if (text.includes(needle.toLowerCase())) hits.push(`${needle.slice(0, 8)} ${full}`);
          }
        }
      }
    };
    walk(dir);
    return hits;
  }

  it("L holds no hand-off path and no export SHA-256 in the production folder, in any letter case", () => {
    expect(scan(SOURCE, [HANDOFF, EXPORT_SHA])).toEqual([]);
  });

  it("L holds no hand-off path and no export SHA-256 in the test folder, in any letter case", () => {
    expect(scan(import.meta.dirname, [HANDOFF, EXPORT_SHA])).toEqual([]);
  });

  /** Run a copy of the real guard over a temp folder with planted files. */
  function runGuardCopy(tag: string, planted: Record<string, string>, links: Record<string, string> = {}) {
    // The project holds node_modules; the guard folder holds only the guard
    // and the planted files, so the guard scans no node_modules link.
    const project = tempDir(`l-${tag}`);
    const dir = join(project, "guard");
    mkdirSync(dir);
    writeFileSync(join(dir, "leak-guard.test.ts"), readFileSync(GUARD));
    symlinkSync(join(HARNESS, "node_modules"), join(project, "node_modules"));
    for (const [rel, text] of Object.entries(planted)) {
      const full = join(dir, rel);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, text);
    }
    for (const [rel, target] of Object.entries(links)) symlinkSync(target, join(dir, rel));
    return spawnSync(
      join(project, "node_modules", ".bin", "vitest"),
      ["run", "--configLoader", "native", "--maxWorkers=1", "--reporter=dot"],
      { cwd: project, env: env(), encoding: "utf8", timeout: 120_000 },
    );
  }

  it("L passes the guard on a clean folder (control)", () => {
    const result = runGuardCopy("clean", { "fixtures/a.json": "{}\n" });
    expect(result.status, `${result.stdout}\n${brief(result.stderr)}`).toBe(0);
  });

  it("L runs the guard on a folder that holds a symlink to a clean file without a crash", () => {
    const result = runGuardCopy("link", { "fixtures/a.json": "{}\n" }, { "alias.json": "fixtures/a.json" });
    expect(`${result.stdout}\n${brief(result.stderr)}`, "the guard threw on a symlink instead of scanning it")
      .not.toMatch(/ENOENT/);
    expect(result.status, `${result.stdout}\n${brief(result.stderr)}`).toBe(0);
  });

  it("L makes the guard fail on a planted export SHA-256 in a nested file", () => {
    const result = runGuardCopy("sha", { "fixtures/deep/a.json": `{"sha":"${EXPORT_SHA}"}\n` });
    expect(result.status, `${result.stdout}\n${brief(result.stderr)}`).not.toBe(0);
  });

  it("L makes the guard fail on a planted hand-off path in a nested file", () => {
    const result = runGuardCopy("path", { "fixtures/deep/a.txt": `see ~/${HANDOFF}-x.json\n` });
    expect(result.status, `${result.stdout}\n${brief(result.stderr)}`).not.toBe(0);
  });

  it("L makes the guard fail on the export SHA-256 in upper-case letters", () => {
    const result = runGuardCopy("upper", { "fixtures/a.json": `{"sha":"${EXPORT_SHA.toUpperCase()}"}\n` });
    expect(result.status, "the guard accepted an upper-case rendering of the export SHA-256")
      .not.toBe(0);
  });

  it("L keeps its needle tests free of the needles in this file", () => {
    const own = readFileSync(join(import.meta.dirname, basename(import.meta.filename)), "utf8");
    expect(own.includes(HANDOFF)).toBe(false);
    expect(own.includes(EXPORT_SHA)).toBe(false);
  });
});
