import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Red tests for plan task 1.4: the executable bit and the README wording
 * (spec FR-5, Review C 5 F1, Review A 5 F3).
 *
 * New contract:
 *   - `harness/model-guide/update.sh` carries mode `100755` in the index,
 *     so the README command runs as written (no `bash` prefix).
 *   - The README weekly-update section states the preview-only branch and
 *     the docs branch (`--docs`) separately.
 *   - The README commit claim names the two data files plus the rebuilt
 *     pages. The old "only those two paths" claim is gone.
 *
 * No case runs a tool against the real repo. E2 executes a temp copy of
 * the script with no argument, which stops at the usage line.
 */

const HARNESS = resolve(import.meta.dirname, "..");
const ROOT = resolve(HARNESS, "..");
const SOURCE = join(HARNESS, "model-guide");
const README = join(ROOT, "README.md");
const SECTION_HEAD = "## Model guide weekly update";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `model-guide-exec-${tag}-`));
  roots.push(dir);
  return dir;
}

function weeklySection(): string {
  const text = readFileSync(README, "utf8");
  const start = text.indexOf(SECTION_HEAD);
  expect(start, "the weekly update section exists").toBeGreaterThanOrEqual(0);
  return text.slice(start);
}

describe("the weekly update executable bit and README wording (spec FR-5)", () => {
  it("E1: harness/model-guide/update.sh carries mode 100755 in the index", () => {
    const result = spawnSync("git", ["ls-files", "-s", "harness/model-guide/update.sh"], {
      cwd: ROOT, encoding: "utf8", timeout: 60_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim(), "the index mode is 100755").toMatch(/^100755 /);
  });

  it("E2: the README command runs as written, without a bash prefix", () => {
    const root = tempDir("exec-copy");
    mkdirSync(join(root, "harness"), { recursive: true });
    cpSync(SOURCE, join(root, "harness", "model-guide"), { recursive: true });
    symlinkSync(join(HARNESS, "node_modules"), join(root, "harness", "node_modules"));
    // No shell, no bash prefix: the documented form executes directly and
    // stops at the usage line when it gets no argument.
    const result = spawnSync(join(root, "harness", "model-guide", "update.sh"), [], {
      cwd: root,
      env: { ...process.env, NO_COLOR: "1", npm_config_loglevel: "silent" },
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stderr).toBe("usage: update.sh <path of MANIFEST-<date>.txt>\n");
  });

  it("E3: the README states the preview-only branch and the docs branch separately", () => {
    const section = weeklySection();
    expect(section, "the preview-only branch is named").toContain("preview-only");
    expect(section, "the docs branch flag is named").toContain("--docs");
  });

  it("E4: the README commit claim names the two data files plus the rebuilt pages", () => {
    const section = weeklySection();
    expect(section, "the old two-path claim is gone").not.toContain("only those two paths");
    for (const path of [
      "docs/assets/data/real-work.json",
      "docs/assets/data/model-guide.json",
      "docs/index.html",
      "docs/real-work.html",
    ]) {
      expect(section, `the claim names ${path}`).toContain(path);
    }
  });

  it("E5: the README names the command without a bash prefix", () => {
    const section = weeklySection();
    expect(section, "the command has no bash prefix").not.toContain("bash harness/model-guide/update.sh");
    expect(section, "the command is named as written").toContain("harness/model-guide/update.sh");
  });
});
