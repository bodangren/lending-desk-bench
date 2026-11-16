import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Red tests for plan task 3.5: the leak check (spec D9, FR-10, G5, G7).
 * They start `harness/model-guide/leak-check.ts` as a subprocess on a temp
 * git repository and a copy of the fixture set of task 3.2. No test reads
 * the network, the real home, the real private folder, or a real repository.
 * This is a new file; it does not add cases to the Phase 1 `leak-guard.test.ts`.
 *
 * Pinned command-line interface:
 *   cd harness && npx tsx model-guide/leak-check.ts \
 *     --private <dir> --repo <dir> [--preview <dir>]
 *
 * `--private` and `--repo` are required and take a value that is not a flag
 * token. A missing value gives exit 2 and one line on stdout:
 * `leak-check: --private needs a value`. The check writes no file.
 *
 * The scan targets:
 *   - every staged file of the repo (the index, not the work tree);
 *   - every file under `<repo>/docs/`, staged or not (FR-10);
 *   - every file under `<preview>/`, staged or not, when `--preview` is given.
 *
 * A target fails when its text holds one of these:
 *   key-field      an exact JSON key of `new_lines`, `witness`, or `operator`
 *                  at any depth. A non-JSON file is not parsed for keys, so a
 *                  prose word "witness" does not fail (G5, G7). A string
 *                  value that holds the word does not fail (G7).
 *                  Line: `leak-check: key-field: <path> <key>`
 *   private-path   the exact absolute path of `--private`, and its real path
 *                  when `--private` is a symbolic link (P3B1-3).
 *                  Line: `leak-check: private-path: <path>`
 *   seeded-line    a line of a seeded diff of the private set, of 20
 *                  characters or more, that is not in the matching source
 *                  diff of that diff, and that appears in the target text.
 *                  The line text is the diff body after the `L<n> ` or
 *                  `L--- ` prefix and after the kind character (`+` or `-`).
 *                  Line: `leak-check: seeded-line: <path>`
 * A target that holds none of these passes. `<path>` is repo-relative for a
 * staged or `docs/` file, and the absolute path for a preview file. The
 * check exits 0 when no target fails and 2 when one target or more fails,
 * with one line for each finding. A broken symbolic link under `docs/` or
 * the preview folder is skipped: it holds no text and is not a finding
 * (P3B1-4). A staged path is read byte-exact, including a non-ASCII name
 * (P3B1-1).
 *
 * The fixture set `sets/mg-2026-11a/` gives the private inputs: `diffs/`
 * holds the seeded diffs and `src/` holds their source diffs. A plant line
 * of `forge-01` (for example `  const v10 = wrong(11);`) is 20 characters
 * or more and is not in its source diff. An unchanged added line (for
 * example `  const v16 = compute(16);`) is in both diffs and does not fail.
 */

const HARNESS = resolve(import.meta.dirname, "..");
const TOOL = join(HARNESS, "model-guide", "leak-check.ts");
const FIXTURE_SET = join(import.meta.dirname, "fixtures", "review", "sets", "mg-2026-11a");
const SET = "mg-2026-11a";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `model-guide-leak-${tag}-`));
  roots.push(dir);
  return dir;
}

function requireProduction(): void {
  if (!existsSync(TOOL)) {
    throw new Error(
      `production file is missing: ${TOOL} (Phase 2 has no leak-check tool)`,
    );
  }
}

function env(fakeHome: string) {
  const copy: Record<string, string | undefined> = {
    ...process.env,
    HOME: fakeHome,
    XDG_CONFIG_HOME: join(fakeHome, ".config"),
    GIT_CONFIG_NOSYSTEM: "1",
    TZ: "UTC",
    NO_COLOR: "1",
    npm_config_loglevel: "silent",
  };
  delete copy.BENCH_TRACK;
  return copy as NodeJS.ProcessEnv;
}

/** A temp git repo with its own HOME, so no test touches the real one. */
function repo(tag: string): { dir: string; home: string } {
  const dir = tempDir(`repo-${tag}`);
  const home = tempDir(`home-${tag}`);
  const result = spawnSync("git", ["init", "-q"], {
    cwd: dir,
    env: env(home),
    encoding: "utf8",
    timeout: 30_000,
  });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  return { dir, home };
}

function write(dir: string, rel: string, text: string): void {
  const file = join(dir, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** Write a file and add it to the index. */
function stage(dir: string, rel: string, text: string, home: string): void {
  write(dir, rel, text);
  const result = spawnSync("git", ["add", "--", rel], {
    cwd: dir,
    env: env(home),
    encoding: "utf8",
    timeout: 30_000,
  });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
}

/** A writable copy of the fixture set under `<private>/sets/<set_id>/`. */
function privateCopy(tag: string): string {
  const privateDir = tempDir(`private-${tag}`);
  mkdirSync(join(privateDir, "sets"), { recursive: true });
  cpSync(FIXTURE_SET, join(privateDir, "sets", SET), { recursive: true });
  return privateDir;
}

function leak(privateDir: string, repoDir: string, opts: { preview?: string; home?: string } = {}) {
  requireProduction();
  const args = ["model-guide/leak-check.ts", "--private", privateDir, "--repo", repoDir];
  if (opts.preview) args.push("--preview", opts.preview);
  return spawnSync(join(HARNESS, "node_modules", ".bin", "tsx"), args, {
    cwd: HARNESS,
    env: env(opts.home ?? tempDir("home-run")),
    encoding: "utf8",
    timeout: 60_000,
  });
}

function expectRefusal(privateDir: string, repoDir: string, line: string, tag: string, opts: { preview?: string } = {}) {
  const result = leak(privateDir, repoDir, { ...opts, home: tempDir(`home-${tag}`) });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
  expect(result.stdout.split("\n").map((item) => item.trim())).toContain(line);
}

/** The text of a diff body line, after the L prefix and the kind character. */
function bodyTexts(file: string): string[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => /^L(?:\d+|---) [-+]/.test(line))
    .map((line) => line.replace(/^L(?:\d+|---) /, "").slice(1));
}

describe("K1 the clean tree", () => {
  it("K1 passes a clean staged tree", () => {
    const { dir, home } = repo("clean");
    const privateDir = privateCopy("clean");
    stage(dir, "notes.md", "A clean note. Nothing secret here.\n", home);
    const result = leak(privateDir, dir, { home: tempDir("home-clean") });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });
});

describe("K2 the key field", () => {
  it("K2 fails a staged file with a new_lines key", () => {
    const { dir, home } = repo("key-new-lines");
    const privateDir = privateCopy("key-new-lines");
    stage(dir, "bad.json", `${JSON.stringify({ plant: { new_lines: [10, 11] } })}\n`, home);
    expectRefusal(privateDir, dir, "leak-check: key-field: bad.json new_lines", "key-new-lines");
  });

  it("K2 fails a staged file with a witness or operator key at any depth", () => {
    const { dir, home } = repo("key-deep");
    const privateDir = privateCopy("key-deep");
    stage(dir, "witness.json", `${JSON.stringify({ outer: { witness: "a sentence" } })}\n`, home);
    stage(dir, "operator.json", `${JSON.stringify({ plants: [{ operator: "C1-1 remove-role-check" }] })}\n`, home);
    const result = leak(privateDir, dir, { home: tempDir("home-key-deep") });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    const lines = result.stdout.split("\n").map((item) => item.trim());
    expect(lines).toContain("leak-check: key-field: operator.json operator");
    expect(lines).toContain("leak-check: key-field: witness.json witness");
  });

  it("K2 and G5 pass a prose word and a string value with the key words", () => {
    const { dir, home } = repo("prose");
    const privateDir = privateCopy("prose");
    stage(dir, "note.md", "The witness saw the operator and wrote a sentence.\n", home);
    stage(dir, "value.json", `${JSON.stringify({ note: "witness operator new_lines" })}\n`, home);
    const result = leak(privateDir, dir, { home: tempDir("home-prose") });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });
});

describe("K3 the private path", () => {
  it("K3 fails a staged file with the private folder path", () => {
    const { dir, home } = repo("path");
    const privateDir = privateCopy("path");
    stage(dir, "path.txt", `the folder is ${privateDir}\n`, home);
    expectRefusal(privateDir, dir, "leak-check: private-path: path.txt", "path");
  });

  it("K3 finds the real path of a symlinked private folder", () => {
    const { dir, home } = repo("private-link");
    const real = privateCopy("private-link-real");
    const link = join(tempDir("private-link-parent"), "private-link");
    symlinkSync(real, link, "dir");
    stage(dir, "path.txt", `the folder is ${real}\n`, home);
    expectRefusal(link, dir, "leak-check: private-path: path.txt", "private-link");
  });
});

describe("K4 the seeded line", () => {
  it("K4 fails a staged file with a seeded line that is not in the source diff", () => {
    const { dir, home } = repo("seeded");
    const privateDir = privateCopy("seeded");
    const seeded = bodyTexts(join(privateDir, "sets", SET, "diffs", "forge-01.diff"));
    const source = bodyTexts(join(privateDir, "sets", SET, "src", "forge-01.diff"));
    const secret = seeded.find((text) => text.length >= 20 && !source.includes(text));
    expect(secret, "the fixture has a seeded-only line of 20 characters or more").toBeTruthy();
    stage(dir, "leak.txt", `${secret}\n`, home);
    expectRefusal(privateDir, dir, "leak-check: seeded-line: leak.txt", "seeded");
  });

  it("K4 passes a line that the source diff also holds", () => {
    const { dir, home } = repo("source-line");
    const privateDir = privateCopy("source-line");
    const seeded = bodyTexts(join(privateDir, "sets", SET, "diffs", "forge-01.diff"));
    const source = bodyTexts(join(privateDir, "sets", SET, "src", "forge-01.diff"));
    const shared = seeded.find((text) => text.length >= 20 && source.includes(text));
    expect(shared, "the fixture has a line in both diffs").toBeTruthy();
    stage(dir, "ok.txt", `${shared}\n`, home);
    const result = leak(privateDir, dir, { home: tempDir("home-source-line") });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it("K4 finds a seeded line under a non-ASCII staged path", () => {
    const { dir, home } = repo("non-ascii");
    const privateDir = privateCopy("non-ascii");
    const seeded = bodyTexts(join(privateDir, "sets", SET, "diffs", "forge-01.diff"));
    const source = bodyTexts(join(privateDir, "sets", SET, "src", "forge-01.diff"));
    const secret = seeded.find((text) => text.length >= 20 && !source.includes(text));
    expect(secret).toBeTruthy();
    stage(dir, "café.txt", `${secret}\n`, home);
    expectRefusal(privateDir, dir, "leak-check: seeded-line: café.txt", "non-ascii");
  });
});

describe("K5 docs and preview, unstaged", () => {
  it("K5 fails an unstaged file under docs/ with a key field", () => {
    const { dir, home } = repo("docs");
    const privateDir = privateCopy("docs");
    stage(dir, "notes.md", "A clean note.\n", home);
    write(dir, "docs/data.json", `${JSON.stringify({ witness: "a sentence" })}\n`);
    expectRefusal(privateDir, dir, "leak-check: key-field: docs/data.json witness", "docs");
  });

  it("K5 fails an unstaged preview file with a seeded line", () => {
    const { dir, home } = repo("preview");
    const privateDir = privateCopy("preview");
    stage(dir, "notes.md", "A clean note.\n", home);
    const seeded = bodyTexts(join(privateDir, "sets", SET, "diffs", "forge-01.diff"));
    const source = bodyTexts(join(privateDir, "sets", SET, "src", "forge-01.diff"));
    const secret = seeded.find((text) => text.length >= 20 && !source.includes(text));
    expect(secret).toBeTruthy();
    const preview = tempDir("preview-out");
    write(preview, "page.json", `${JSON.stringify({ line: secret })}\n`);
    expectRefusal(privateDir, dir, `leak-check: seeded-line: ${join(preview, "page.json")}`, "preview", { preview });
  });

  it("K5 does not crash on a broken symlink under docs/", () => {
    const { dir, home } = repo("broken-link");
    const privateDir = privateCopy("broken-link");
    stage(dir, "notes.md", "A clean note.\n", home);
    mkdirSync(join(dir, "docs"), { recursive: true });
    symlinkSync(join(tempDir("gone"), "missing.txt"), join(dir, "docs", "broken"));
    const result = leak(privateDir, dir, { home: tempDir("home-broken-link") });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });
});

describe("the write flags", () => {
  it("each missing value exits 2 with one named line and writes nothing", () => {
    requireProduction();
    const { dir, home } = repo("flags");
    const privateDir = privateCopy("flags");
    stage(dir, "notes.md", "A clean note.\n", home);
    const result = spawnSync(
      join(HARNESS, "node_modules", ".bin", "tsx"),
      ["model-guide/leak-check.ts", "--repo", dir, "--private"],
      { cwd: HARNESS, env: env(tempDir("home-flags")), encoding: "utf8", timeout: 60_000 },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout.trim()).toBe("leak-check: --private needs a value");
  });
});
