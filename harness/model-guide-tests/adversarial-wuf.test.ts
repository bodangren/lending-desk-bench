import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const HARNESS = resolve(import.meta.dirname, "..");
const ROOT = resolve(HARNESS, "..");
const SOURCE = join(HARNESS, "model-guide");
const FIXTURES = join(import.meta.dirname, "fixtures");
const PAGE_B = join(FIXTURES, "page-b");
const GUIDE = join(FIXTURES, "guide");
const PRINT_AUDIT = join(FIXTURES, "print-audit");
const APPROVAL = join(ROOT, "measure", "archive", "model_guide", "publish-approval.md");
const DATE = "2026-10-20";
const MANIFEST_NAME = `MANIFEST-${DATE}.txt`;
const INPUTS = [
  `ra-outcomes-${DATE}.json`,
  `aa-reliability-${DATE}.json`,
  `allowed-routes-${DATE}.json`,
  MANIFEST_NAME,
];
const DATA = join("docs", "assets", "data");
const DATA_CANDIDATES = [
  join(DATA, "model-guide.json"),
  join(DATA, "real-work.json"),
];
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function temp(tag: string): string {
  const path = mkdtempSync(join(tmpdir(), `adversarial-wuf-${tag}-`));
  roots.push(path);
  return path;
}

function env(privateDir?: string): NodeJS.ProcessEnv {
  const next = { ...process.env, NO_COLOR: "1", npm_config_loglevel: "silent" };
  next.HOME = temp("home");
  next.MODEL_GUIDE_PRIVATE_DIR = privateDir ?? privateSeed("default").path;
  delete next.BENCH_TRACK;
  return next;
}

function git(root: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: root,
    env: env(),
    encoding: "utf8",
    timeout: 60_000,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.replace(/\s+$/, "");
}

function repo(tag: string, manifestName = MANIFEST_NAME): { root: string; manifest: string } {
  const root = temp(tag);
  mkdirSync(join(root, "harness"), { recursive: true });
  cpSync(SOURCE, join(root, "harness", "model-guide"), {
    recursive: true,
    filter: (path) => !path.endsWith("publish-approval.md"),
  });
  mkdirSync(join(root, "docs", "assets", "css"), { recursive: true });
  mkdirSync(join(root, DATA), { recursive: true });
  writeFileSync(
    join(root, "docs", "index.html"),
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Overview</title>
<link rel="stylesheet" href="./assets/css/site.css"></head>
<body><nav><a href="./methodology.html">Methodology</a>
<a href="./results.html">Results</a><a href="./models/">Models</a>
<a href="./tracks.html">Tracks</a></nav>
<main><h1>Overview</h1></main></body></html>
`,
  );
  writeFileSync(join(root, "docs", "real-work.html"), "<!doctype html><html><body>stale</body></html>\n");
  writeFileSync(join(root, "docs", "methodology.html"), "<!doctype html><html>unrelated</html>\n");
  writeFileSync(join(root, "docs", "assets", "css", "site.css"), "body { color: black }\n");
  copyFileSync(join(GUIDE, "benchmark-mini.json"), join(root, DATA, "benchmark.json"));
  copyFileSync(join(GUIDE, "tracks-mini.json"), join(root, DATA, "tracks.json"));
  const printDir = temp("print-audit");
  copyFileSync(join(PRINT_AUDIT, "print-audit-mini.json"), join(printDir, "source.json"));
  const printDoc = JSON.parse(readFileSync(join(printDir, "source.json"), "utf8"));
  const printOut = {
    schema: "model-guide-print-audit/1",
    source: { sha256: "0".repeat(64) },
    totals: { errors: 0, blockers: 0 },
    routes: Object.fromEntries(Object.keys(printDoc.routes).map((key) => [printDoc.routes[key], "0 of 0"])),
    summary: printDoc.summary,
    note: printDoc.note,
  };
  mkdirSync(join(root, "harness", "model-guide", "data"), { recursive: true });
  writeFileSync(
    join(root, "harness", "model-guide", "data", "print-audit-2026-11.json"),
    `${JSON.stringify(printOut, null, 2)}\n`,
  );
  const exportDir = join(root, "fixture-b");
  mkdirSync(exportDir, { recursive: true });
  const inputDir = manifestName === MANIFEST_NAME ? exportDir : dirname(join(exportDir, manifestName));
  mkdirSync(inputDir, { recursive: true });
  for (const name of INPUTS) copyFileSync(join(PAGE_B, name), join(inputDir, name));
  symlinkSync(join(HARNESS, "node_modules"), join(root, "harness", "node_modules"));
  writeFileSync(
    join(root, ".gitignore"),
    `${readFileSync(join(ROOT, ".gitignore"), "utf8")}\nharness/node_modules\n`,
  );
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "adversarial@example.invalid"]);
  git(root, ["config", "user.name", "Adversarial WUF"]);
  copyFileSync(APPROVAL, join(root, "harness", "model-guide", "publish-approval.md"));
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "fixture"]);
  return { root, manifest: join(exportDir, manifestName) };
}

function run(root: string, manifest: string, privateDir?: string, plantPath?: string) {
  const runEnv = env(privateDir);
  if (plantPath !== undefined) runEnv.WUF_PLANT_PATH = plantPath;
  return spawnSync("bash", [join(root, "harness", "model-guide", "update.sh"), "--docs", manifest], {
    cwd: root,
    env: runEnv,
    encoding: "utf8",
    timeout: 180_000,
  });
}

function commits(root: string): string {
  return git(root, ["rev-list", "--count", "HEAD"]);
}

function treeHash(root: string): string {
  const hash = createHash("sha256");
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const path = rel ? `${rel}/${name}` : name;
      if (path === ".git" || path.startsWith(".git/") || path === "harness/node_modules" || path.startsWith("harness/node_modules/")) continue;
      const info = lstatSync(full);
      hash.update(path);
      if (info.isDirectory()) walk(full, path);
      else hash.update(readFileSync(full));
    }
  };
  walk(root, "");
  return hash.digest("hex");
}

function seededLine(tag: string): string {
  return `private-seed-${tag}-must-not-ship`;
}

function privateSeed(tag: string): { path: string; line: string } {
  const path = temp(`private-${tag}`);
  const line = seededLine(tag);
  const set = join(path, "sets", "synthetic");
  mkdirSync(join(set, "diffs"), { recursive: true });
  mkdirSync(join(set, "src"), { recursive: true });
  writeFileSync(join(set, "diffs", "seed.diff"), `@@ -1 +1 @@\nL1 +${line}\n`);
  writeFileSync(join(set, "src", "seed.diff"), "@@ -1 +1 @@\nL1 -baseline text only\n");
  return { path, line };
}

function injectCandidate(root: string, rel: string, line: string): void {
  const update = join(root, "harness", "model-guide", "update.sh");
  let text = readFileSync(update, "utf8");
  const anchor = "# Scan exactly the candidate files in a throwaway repo.";
  const injection = `# Synthetic adversarial candidate plant for this temp repo.\ncase "\${WUF_PLANT_PATH:-}" in\n  ${rel}) printf '%s\\\\n' '${line}' >> "$CAND/${rel}" ;;\nesac\n\n`;
  if (!text.includes(anchor)) throw new Error("candidate-scan anchor missing");
  text = text.replace(anchor, `${injection}${anchor}`);
  writeFileSync(update, text);
}

describe("weekly update adversarial boundary tests", () => {
  it("refuses a symlinked public candidate before changing its target", () => {
    const { root, manifest } = repo("symlink");
    const outside = join(temp("outside"), "index.html");
    writeFileSync(outside, "outside remains unchanged\n");
    rmSync(join(root, "docs", "index.html"));
    symlinkSync(outside, join(root, "docs", "index.html"));
    const before = readFileSync(outside, "utf8");
    const result = run(root, manifest);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("update: refused path");
    expect(readFileSync(outside, "utf8")).toBe(before);
    expect(commits(root)).toBe("1");
  });

  it("handles a manifest under a path with spaces, a newline, a leading dash, and a parent segment", () => {
    const hostile = `- export space\nline`;
    const { root, manifest } = repo("hostile-name", `${hostile}/${MANIFEST_NAME}`);
    const pathWithParent = join(root, "fixture-b", ".", `${hostile}`, "..", `${hostile}`, basename(manifest));
    const result = run(root, pathWithParent);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it("a second run is a no-op and makes no new commit", () => {
    const { root, manifest } = repo("twice");
    const first = run(root, manifest);
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
    const count = commits(root);
    const second = run(root, manifest);
    expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(0);
    expect(second.stdout).toBe("update: no change\n");
    expect(commits(root)).toBe(count);
  });

  it("keeps a dirty unrelated file out of the update commit", () => {
    const { root, manifest } = repo("dirty");
    const unrelated = join(root, "docs", "methodology.html");
    writeFileSync(unrelated, "dirty unrelated content\n");
    const result = run(root, manifest);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const paths = git(root, ["show", "--name-only", "--format=", "HEAD"]).split("\n").filter(Boolean);
    expect(paths).not.toContain("docs/methodology.html");
    expect(git(root, ["status", "--short"])).toContain("docs/methodology.html");
  });

  it.each(["empty", "file", "missing"])("fails closed when the private input is a %s", (kind) => {
    const { root, manifest } = repo(`private-${kind}`);
    const target = join(temp(`private-target-${kind}`), "private");
    if (kind === "empty") mkdirSync(target);
    if (kind === "file") writeFileSync(target, "not a directory");
    const seed = privateSeed(`private-${kind}`);
    if (kind === "empty") injectCandidate(root, "docs/index.html", seed.line);
    const before = treeHash(root);
    const headBefore = git(root, ["show", "--name-only", "--format=", "HEAD"]).split("\n").filter(Boolean);
    const countBefore = commits(root);
    const result = run(root, manifest, target, kind === "empty" ? "docs/index.html" : undefined);
    // A refusal changes nothing: the commit set still matches the
    // pre-run HEAD snapshot, and the tree is byte-identical. The fixture
    // commits docs/index.html, so the run itself must add no commit.
    expect(result.status, `${kind} private input`).toBe(2);
    expect(result.stdout, `${kind} refusal line`).toBe("update: no private input\n");
    expect(treeHash(root), `${kind} tree unchanged`).toBe(before);
    expect(commits(root), `${kind} HEAD unchanged`).toBe(countBefore);
    expect(
      git(root, ["show", "--name-only", "--format=", "HEAD"]).split("\n").filter(Boolean),
      `${kind} commit set unchanged`,
    ).toEqual(headBefore);
    if (kind === "empty") {
      expect(
        readFileSync(join(root, "docs", "index.html"), "utf8"),
        "the planted seed never reaches docs",
      ).not.toContain(seed.line);
    }
  });

  it("the default synthetic private input still refuses a planted seeded line in a candidate", () => {
    const { root, manifest } = repo("default-scan");
    const line = seededLine("default");
    injectCandidate(root, "docs/index.html", line);
    const before = treeHash(root);
    const result = run(root, manifest, undefined, "docs/index.html");
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout).toBe("update: leak docs/index.html\n");
    expect(treeHash(root)).toBe(before);
    expect(commits(root)).toBe("1");
  });

  it("publish.ts rejects an approval row that points outside docs", () => {
    const { root } = repo("publish-outside");
    const record = join(root, "harness", "model-guide", "publish-approval.md");
    const text = readFileSync(record, "utf8").replace("docs/index.html", "../outside.html");
    writeFileSync(record, text);
    const preview = temp("publish-preview");
    const result = spawnSync(
      "npx",
      ["tsx", join(root, "harness", "model-guide", "publish.ts"), "--preview", preview],
      { cwd: root, env: env(), encoding: "utf8", timeout: 60_000 },
    );
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("publish:");
    expect(existsSync(join(root, "outside.html"))).toBe(false);
  });

  it.each([
    ["docs/assets/data/model-guide.json", "data-model-guide"],
    ["docs/assets/data/real-work.json", "data-real-work"],
    ["docs/index.html", "overview"],
    ["docs/real-work.html", "real-work"],
    ["docs/review.html", "review"],
    ["docs/assets/data/review.json", "review-json"],
  ])("leak-check refuses a planted key in candidate %s", (path, tag) => {
    const { root, manifest } = repo(`candidate-${tag}`);
    const seed = privateSeed(tag);
    injectCandidate(root, path, seed.line);
    const before = treeHash(root);
    const result = run(root, manifest, seed.path, path);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout).toBe(`update: leak ${path}\n`);
    expect(result.stdout).not.toContain(seed.line);
    expect(treeHash(root)).toBe(before);
    expect(commits(root)).toBe("1");
  });

  it("duplicate incomplete routes with open passes keep review.html aligned with review.json", () => {
    const { root, manifest } = repo("duplicate-open-passes");
    const scoresDir = join(root, "harness", "model-guide", "data", "review-scores");
    mkdirSync(scoresDir, { recursive: true });
    const scoreFile = join(scoresDir, "duplicate.json");
    const baseline = {
      schema: "model-guide-review-scores/1",
      set_id: "synthetic-set",
      routes: [{ route: "same-route", state: "complete", passes: [90, 91, 92].map((score) => ({ date: DATE, score, state: "complete" })) }],
    };
    writeFileSync(scoreFile, `${JSON.stringify(baseline, null, 2)}\n`);
    const first = run(root, manifest);
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
    const publishedScore = readFileSync(scoreFile, "utf8");
    copyFileSync(scoreFile, join(root, DATA, "review.json"));
    git(root, ["add", join(DATA, "review.json")]);
    git(root, ["commit", "-q", "-m", "publish score baseline"]);

    const changed = {
      schema: "model-guide-review-scores/1",
      set_id: "synthetic-set",
      routes: [
        { route: "same-route", state: "incomplete", passes: [{ date: DATE, score: 41.2, state: "open" }] },
        { route: "same-route", state: "incomplete", passes: [{ date: DATE, score: 42.3, state: "open" }] },
      ],
    };
    const changedText = `${JSON.stringify(changed, null, 2)}\n`;
    writeFileSync(scoreFile, changedText);
    const update = run(root, manifest);
    expect(update.status, `${update.stdout}\n${update.stderr}`).toBe(0);
    expect(readFileSync(join(root, DATA, "review.json"), "utf8")).toBe(changedText);
    const review = readFileSync(join(root, "docs", "review.html"), "utf8");
    expect(review).toContain("same-route");
    expect(review).toContain("41.2");
    expect(review).toContain("42.3");
    expect(publishedScore).not.toBe(changedText);
  });

  it("removes the staging directory after an interrupt before the docs copy", () => {
    const { root, manifest } = repo("interrupt");
    const updateFile = join(root, "harness", "model-guide", "update.sh");
    let script = readFileSync(updateFile, "utf8");
    const anchor = "trap 'rm -rf \"$STAGING\"' EXIT";
    expect(script).toContain(anchor);
    script = script.replace(anchor, `${anchor}\nexit 143`);
    writeFileSync(updateFile, script);
    const before = treeHash(root);
    const stagingParent = tmpdir();
    const beforeNames = new Set(readdirSync(stagingParent));
    const result = spawnSync("bash", [updateFile, "--docs", manifest], {
      cwd: root,
      env: env(),
      encoding: "utf8",
      timeout: 180_000,
    });
    expect(result.status).toBe(143);
    expect(treeHash(root)).toBe(before);
    expect(commits(root)).toBe("1");
    const leftovers = readdirSync(stagingParent).filter((name) => name.startsWith("tmp.") && !beforeNames.has(name));
    expect(leftovers).toEqual([]);
  });
});
