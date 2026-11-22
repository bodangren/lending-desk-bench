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
 * Red tests for plan task 1.1: the approval path and the named refusal
 * (spec FR-1, FR-2).
 *
 * New contract (spec D1, D2):
 *   - `harness/model-guide/update.sh` and `harness/model-guide/publish.ts`
 *     (with their header comments) read
 *     `harness/model-guide/publish-approval.md`. The old
 *     `measure/tracks/model_guide/` path appears in neither tool.
 *   - `update.sh --docs <manifest>` with no stable record prints
 *     `update: no approval record` on stdout, exits 2, and writes no file
 *     and makes no commit. A plain run without `--docs` keeps the
 *     preview-only branch.
 *   - The stable record parses under the `publish.ts` rules. Its
 *     `approved_by` line, `date` line, and every `files:` row equal the
 *     archived record's. The text above `files:` holds the PM weekly
 *     refresh rule and names the archived record and PM 2026-11-22.
 *
 * Every git action runs in a temp repo under the system temp folder. No
 * case reads or writes the real repo history, the real `docs/`, the real
 * export, the network, a model, or the private folder. The only real-repo
 * reads are the tool sources (A1) and the two approval records (A5).
 */

const HARNESS = resolve(import.meta.dirname, "..");
const ROOT = resolve(HARNESS, "..");
const SOURCE = join(HARNESS, "model-guide");
const UPDATE_SH = join(SOURCE, "update.sh");
const PUBLISH_TOOL = join(SOURCE, "publish.ts");
const FIXTURES = join(import.meta.dirname, "fixtures");
const PAGE_B = join(FIXTURES, "page-b");
const PRINT_AUDIT_DIR = join(FIXTURES, "print-audit");
const GUIDE_FIXTURES = join(FIXTURES, "guide");
const BENCHMARK = join(GUIDE_FIXTURES, "benchmark-mini.json");
const TRACKS = join(GUIDE_FIXTURES, "tracks-mini.json");
const ARCHIVED_APPROVAL = join(
  ROOT, "measure", "archive", "model_guide", "publish-approval.md",
);
const STABLE_REL = join("harness", "model-guide", "publish-approval.md");
const OLD_PATH_TOKEN = "measure/tracks/model_guide/publish-approval";
const DATE = "2026-10-20";
const OUTCOMES_NAME = `ra-outcomes-${DATE}.json`;
const AA_NAME = `aa-reliability-${DATE}.json`;
const ALLOWED_NAME = `allowed-routes-${DATE}.json`;
const MANIFEST_NAME = `MANIFEST-${DATE}.txt`;
const DATA_DIR = join("docs", "assets", "data");
const PREVIEW_DIR = join(".tmp", "model-guide-preview");
const MANIFEST_COPY = join("fixture-b", `MANIFEST-${DATE}.txt`);
const NO_RECORD_LINE = "update: no approval record\n";

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
  const dir = mkdtempSync(join(tmpdir(), `model-guide-approval-${tag}-`));
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
      else out[path] = sha256(full);
    }
  };
  walk(root, "");
  return out;
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

/** A temp repo that mirrors the real layout, with no approval record. */
function updateRepo(tag: string): { root: string; manifest: string } {
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
  writeFileSync(join(root, "docs", "assets", "css", "site.css"), SITE_CSS);
  copyFileSync(BENCHMARK, join(root, DATA_DIR, "benchmark.json"));
  copyFileSync(TRACKS, join(root, DATA_DIR, "tracks.json"));
  mkdirSync(join(root, "harness", "model-guide", "data"), { recursive: true });
  copyFileSync(
    printAuditData(tag),
    join(root, "harness", "model-guide", "data", "print-audit-2026-11.json"),
  );
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
  return { root, manifest: join(root, MANIFEST_COPY) };
}

function runUpdate(root: string, args: string[]) {
  return spawnSync(
    "bash",
    [join(root, "harness", "model-guide", "update.sh"), ...args],
    { cwd: root, env: env(), encoding: "utf8", timeout: 180_000 },
  );
}

function runPublish(root: string, preview: string) {
  return spawnSync(
    "npx",
    ["tsx", "model-guide/publish.ts", "--preview", preview],
    { cwd: join(root, "harness"), env: env(), encoding: "utf8", timeout: 120_000 },
  );
}

/** The first line that starts with `key:`. The parser reads the first
 * match, so the test does the same. */
function recordLine(text: string, key: string): string {
  const line = text.split("\n").find((entry) => entry.startsWith(`${key}:`));
  expect(line, `the record holds an ${key} line`).toBeDefined();
  return line as string;
}

/** The `sha path` rows of an approval record, in file order. */
function approvalRows(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => /^[0-9a-f]{64}\s+\S/.test(line))
    .map((line) => line.trim());
}

describe("the weekly update approval path (spec FR-1, FR-2)", () => {
  it("A1: neither update.sh nor publish.ts names the old approval path", () => {
    for (const file of [UPDATE_SH, PUBLISH_TOOL]) {
      const text = readFileSync(file, "utf8");
      expect(text, `${file} must not name the old path`).not.toContain(OLD_PATH_TOKEN);
    }
  });

  it("A2: publish.ts refuses when the stable record is absent, even with an old-path record", () => {
    const root = tempDir("publish-no-stable");
    mkdirSync(join(root, "harness"), { recursive: true });
    cpSync(SOURCE, join(root, "harness", "model-guide"), {
    recursive: true,
    // The real approval record stays out of every fixture; a case that
    // needs consent writes its own record after the copy.
    filter: (source) => !source.endsWith("publish-approval.md"),
  });
    symlinkSync(join(HARNESS, "node_modules"), join(root, "harness", "node_modules"));
    // An old-path record only: the new tool must not read it.
    const oldDir = join(root, "measure", "tracks", "model_guide");
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(
      join(oldDir, "publish-approval.md"),
      [
        "approved_by: Daniel",
        "date: 2026-11-15",
        "files:",
        `${"0".repeat(64)}  index.html`,
        "",
      ].join("\n"),
    );
    const preview = join(root, "preview");
    mkdirSync(preview, { recursive: true });

    const result = runPublish(root, preview);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout, "one refusal line on stdout").toBe("publish: no approval record\n");
  });

  it("A3: update.sh --docs with no stable record refuses, writes nothing, and makes no commit", () => {
    const { root, manifest } = updateRepo("docs-no-record");
    const before = treeHashes(root, [PREVIEW_DIR]);
    const commits = git(root, ["rev-list", "--count", "HEAD"]);

    const result = runUpdate(root, ["--docs", manifest]);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout, "the named refusal on stdout").toBe(NO_RECORD_LINE);
    expect(treeHashes(root, [PREVIEW_DIR])).toEqual(before);
    expect(existsSync(join(root, DATA_DIR, "real-work.json")), "no docs write").toBe(false);
    expect(existsSync(join(root, PREVIEW_DIR)), "no preview folder appears").toBe(false);
    expect(git(root, ["rev-list", "--count", "HEAD"])).toBe(commits);
    expect(git(root, ["status", "--short"])).toBe("");
  });

  it("F1: a flagless run with the stable record stays preview-only", () => {
    const { root, manifest } = updateRepo("flagless-approved");
    copyFileSync(ARCHIVED_APPROVAL, join(root, "harness", "model-guide", "publish-approval.md"));
    git(root, ["add", join("harness", "model-guide", "publish-approval.md")]);
    git(root, ["commit", "-q", "-m", "approval record"]);
    const before = treeHashes(root, [PREVIEW_DIR]);
    const commits = git(root, ["rev-list", "--count", "HEAD"]);

    const result = runUpdate(root, [manifest]);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

    const preview = join(root, PREVIEW_DIR);
    expect(existsSync(join(preview, "real-work.json")), "real-work.json in the preview").toBe(true);
    expect(existsSync(join(preview, "model-guide.json")), "model-guide.json in the preview").toBe(true);
    expect(treeHashes(root, [PREVIEW_DIR])).toEqual(before);
    expect(existsSync(join(root, DATA_DIR, "real-work.json")), "no docs write").toBe(false);
    expect(existsSync(join(root, DATA_DIR, "model-guide.json")), "no docs write").toBe(false);
    expect(git(root, ["rev-list", "--count", "HEAD"])).toBe(commits);
    expect(git(root, ["status", "--short"]), "no file changed under docs/").toBe("");
  });

  it("A4: a plain run without --docs keeps the preview-only branch", () => {
    const { root, manifest } = updateRepo("plain-preview");
    const before = treeHashes(root, [PREVIEW_DIR]);
    const commits = git(root, ["rev-list", "--count", "HEAD"]);

    const result = runUpdate(root, [manifest]);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

    const preview = join(root, PREVIEW_DIR);
    expect(existsSync(join(preview, "real-work.json")), "real-work.json in the preview").toBe(true);
    expect(existsSync(join(preview, "model-guide.json")), "model-guide.json in the preview").toBe(true);
    expect(treeHashes(root, [PREVIEW_DIR])).toEqual(before);
    expect(existsSync(join(root, DATA_DIR, "real-work.json")), "no docs write").toBe(false);
    expect(git(root, ["rev-list", "--count", "HEAD"])).toBe(commits);
  });

  it("A5: the stable record carries the archived consent plus the PM weekly rule", () => {
    const stableText = readFileSync(join(ROOT, STABLE_REL), "utf8");
    const archivedText = readFileSync(ARCHIVED_APPROVAL, "utf8");
    // The record parses under the publish.ts rules: a non-empty
    // approved_by line, a non-empty date line, and a files: section last.
    expect(stableText.match(/^approved_by: (.+)$/m)?.[1].trim(), "a non-empty approved_by line").toBeTruthy();
    expect(stableText.match(/^date: (.+)$/m)?.[1].trim(), "a non-empty date line").toBeTruthy();
    const lines = stableText.split("\n");
    const start = lines.findIndex((line) => line.trim() === "files:");
    expect(start, "a files: section").toBeGreaterThanOrEqual(0);
    const tail = lines.slice(start + 1).filter((line) => line.trim() !== "");
    expect(tail.length, "the files section holds rows").toBeGreaterThan(0);
    for (const line of tail) {
      expect(line, `the row parses: ${line}`).toMatch(/^[0-9a-f]{64}\s+\S/);
    }
    // The consent lines and every files: row equal the archived record's.
    expect(recordLine(stableText, "approved_by")).toBe(recordLine(archivedText, "approved_by"));
    expect(recordLine(stableText, "date")).toBe(recordLine(archivedText, "date"));
    expect(approvalRows(stableText)).toEqual(approvalRows(archivedText));
    expect(approvalRows(stableText)).toHaveLength(6);
    // The text above files: holds the PM weekly rule and its provenance.
    const head = lines.slice(0, start).join("\n");
    for (const condition of [
      "leak check passes",
      "only data and generated pages change",
      "same page set and layout",
      "run log names the files pushed",
    ]) {
      expect(head, `the rule holds: ${condition}`).toContain(condition);
    }
    expect(head, "the page-look sentence").toContain(
      "needs one PM page look (page-check) before the push",
    );
    expect(head, "the provenance names the archived record").toContain(
      "measure/archive/model_guide/publish-approval.md",
    );
    expect(head, "the provenance names the PM ruling").toContain("PM 2026-11-22");
  });
});
