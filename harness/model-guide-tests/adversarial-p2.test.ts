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
 * Adversarial tests for Phase 2 (spec D13, D17, D18, D19, FR-5, FR-6,
 * acceptance 7; the 2.4a ruling in plan.md). They attack the production
 * code of `harness/model-guide/` at the Phase 2 HEAD: the track A tie-break
 * of `guide.ts`, the newest-score-file selection of `preview.sh` and
 * `update.sh`, the no-change rerun of `update.sh`, the flag validation of
 * `guide.ts`, and a symlinked `docs/assets/data`.
 *
 * Every git action and every `update.sh`/`preview.sh` run of this file
 * happens in a temp repo under the system temp folder. No case reads or
 * writes the real repo history, the real `docs/`, the real export, the real
 * hand-off file, the network, a model, or the private folder. All fixtures
 * are synthetic and reused from `fixtures/`.
 *
 * Failing-first key:
 * - P2ADV-1 (blocking, spec D13): equal worst scores must rank the higher
 *   median first, not the alphabetically first route (`guide.ts:241` sorts
 *   by worst score then route name).
 * - P2ADV-2 (blocking, tool header "newest review score file" of
 *   `preview.sh` and `update.sh`): the newest file by date must win, not
 *   the alphabetically last glob match.
 * - P2ADV-3 (blocking, spec D19 + `update.sh` header "one git commit holds
 *   exactly these two paths"): a rerun with unchanged data must exit 0.
 * - P2ADV-4 (blocking, `guide.ts` header "a flag is unknown"): inherited
 *   `Object.prototype` keys (`__proto__`, `constructor`, `toString`) must
 *   be refused with `input-check: args`.
 * - P2ADV-5 (blocking, spec D21 + `update.sh` header "the two files go into
 *   `<repo>/docs/assets/data/`"): a symlinked `docs/assets/data` must not
 *   take writes outside the repo.
 */

const HARNESS = resolve(import.meta.dirname, "..");
const SOURCE = join(HARNESS, "model-guide");
const GUIDE_TOOL = join(SOURCE, "guide.ts");
const REAL_WORK_TOOL = join(SOURCE, "real-work.ts");
const PRINT_AUDIT_TOOL = join(SOURCE, "print-audit.ts");
const PREVIEW_SH = join(SOURCE, "preview.sh");
const UPDATE_SH = join(SOURCE, "update.sh");
const TSX = join(HARNESS, "node_modules", ".bin", "tsx");
const FIXTURES = join(import.meta.dirname, "fixtures");
const PAGE_B = join(FIXTURES, "page-b");
const OUTCOMES_NAME = "ra-outcomes-2026-10-20.json";
const AA_NAME = "aa-reliability-2026-10-20.json";
const ALLOWED_NAME = "allowed-routes-2026-10-20.json";
const MANIFEST_NAME = "MANIFEST-2026-10-20.txt";
const EXPORT_FIXTURE = join(PAGE_B, OUTCOMES_NAME);
const AA_FIXTURE = join(PAGE_B, AA_NAME);
const ALLOWED_FIXTURE = join(PAGE_B, ALLOWED_NAME);
const PRINT_AUDIT_DIR = join(FIXTURES, "print-audit");
const GUIDE_FIXTURES = join(FIXTURES, "guide");
const BENCHMARK = join(GUIDE_FIXTURES, "benchmark-mini.json");
const TRACKS = join(GUIDE_FIXTURES, "tracks-mini.json");

const NO_PICK = "no pick yet: not enough evidence";
const TODAY = "2026-11-14";
const HOSTILE_ROUTE = 'y/"><img src=x onerror=alert(1)>';
const DATA_DIR = join("docs", "assets", "data");
const PREVIEW_DIR = join(".tmp", "model-guide-preview");
const APPROVAL = join("harness", "model-guide", "publish-approval.md");
const OLD_APPROVAL = join("measure", "tracks", "model_guide", "publish-approval.md");

const INDEX_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Overview</title>
<link rel="stylesheet" href="./assets/css/site.css"></head>
<body><nav><a href="./methodology.html">Methodology</a>
<a href="./results.html">Results</a><a href="./models/">Models</a>
<a href="./tracks.html">Tracks</a></nav>
<header class="hero"><h1>Overview</h1></header>
<main><p>Body</p></main></body></html>
`;
const SITE_CSS = "body { font-family: sans-serif; }\n";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `model-guide-advp2-${tag}-`));
  roots.push(dir);
  return dir;
}

function requireProduction(): void {
  for (const path of [GUIDE_TOOL, REAL_WORK_TOOL, PRINT_AUDIT_TOOL, PREVIEW_SH, UPDATE_SH]) {
    if (!existsSync(path)) throw new Error(`production file is missing: ${path}`);
  }
}

function env(): NodeJS.ProcessEnv {
  const copy = { ...process.env, NO_COLOR: "1", npm_config_loglevel: "silent" };
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

/** Run guide.ts without asserting the exit code. The caller checks it.
 * `args` starts with the tool path, as in the pinned command line. */
function guideRaw(args: string[]): { status: number; stdout: string; out: string } {
  requireProduction();
  const out = tempDir("guide-out");
  const result = spawnSync(TSX, [...args, "--out", out], {
    cwd: HARNESS, env: env(), encoding: "utf8", timeout: 60_000,
  });
  return { status: result.status ?? -1, stdout: result.stdout, out };
}

/** The staged page B set with a mutation, and a manifest that matches.
 * Returns the manifest path (the CLI argument). The legacy aliases let the
 * old mutations run; `all_time` and `allowedRoutes` are the live arrays of
 * the staged files. */
function stagedExport(tag: string, mutate: (doc: any) => void): string {
  const dir = tempDir(`export-${tag}`);
  const rows = JSON.parse(readFileSync(EXPORT_FIXTURE, "utf8"));
  const allowedDoc = JSON.parse(readFileSync(ALLOWED_FIXTURE, "utf8"));
  const doc = {
    schema: "real-work-outcomes/1",
    generated_on: "2026-10-20",
    coverage: {} as Record<string, unknown>,
    all_time: rows,
    weekly: [] as any[],
    allowedRoutes: allowedDoc.allowedRoutes,
  };
  mutate(doc);
  writeFileSync(join(dir, OUTCOMES_NAME), `${JSON.stringify(rows, null, 2)}\n`);
  writeFileSync(join(dir, AA_NAME), readFileSync(AA_FIXTURE));
  writeFileSync(join(dir, ALLOWED_NAME), `${JSON.stringify(allowedDoc, null, 2)}\n`);
  const lines = [OUTCOMES_NAME, AA_NAME, ALLOWED_NAME].map((name) => {
    const data = readFileSync(join(dir, name));
    return `${sha256(dir ? join(dir, name) : name)}  ${data.length}  ${name}`;
  });
  writeFileSync(join(dir, MANIFEST_NAME), `${lines.join("\n")}\n`);
  return join(dir, MANIFEST_NAME);
}

/** Run the page B tool on a manifest and return the data file path. */
function realWorkFrom(manifestPath: string, tag: string): string {
  const out = tempDir(`real-work-${tag}`);
  const result = spawnSync(
    TSX,
    ["model-guide/real-work.ts", "--manifest", manifestPath, "--out", out],
    { cwd: HARNESS, env: env(), encoding: "utf8", timeout: 60_000 },
  );
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const json = join(out, "real-work.json");
  expect(existsSync(json), `missing ${json}`).toBe(true);
  return json;
}

/** The print-audit data file of task 2.4b, assembled from the synthetic
 * hand-off fixture: a route maps a short key to a route name, and its
 * result is `blockers_found` over `summary.key.blockers`. */
function printAuditInput(tag: string): string {
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

/** A complete track A score file with the given routes. Each route holds
 * three complete passes. `worst` is the minimum pass score. */
function scoresFile(tag: string, routes: Array<{ route: string; scores: [number, number, number] }>): string {
  const dir = tempDir(`scores-${tag}`);
  const doc = {
    schema: "model-guide-review-scores/1",
    set_id: "mg-2026-11a",
    routes: routes.map(({ route, scores }) => ({
      route,
      state: "complete",
      passes: scores.map((score, index) => ({
        date: `2026-11-1${index + 1}`,
        score,
        state: "complete",
      })),
    })),
  };
  const file = join(dir, "review-scores.json");
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  return file;
}

function guideInputs(tag: string, exportPath?: string): {
  realWork: string;
  printAudit: string;
  benchmark: string;
  tracks: string;
} {
  return {
    realWork: realWorkFrom(exportPath ?? stagedExport(`${tag}-default`, () => {}), `${tag}-rw`),
    printAudit: printAuditInput(`${tag}-pa`),
    benchmark: BENCHMARK,
    tracks: TRACKS,
  };
}

/** One git command in the temp repo. */
function git(root: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: root, env: env(), encoding: "utf8", timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${result.stderr || result.stdout}`);
  }
  return result.stdout.replace(/\s+$/, "");
}

/** SHA-256 of every file of the temp tree, keyed by relative path. */
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
      else if (info.isSymbolicLink()) out[path] = "link";
      else out[path] = sha256(full);
    }
  };
  walk(root, "");
  return out;
}

/** A temp repo that mirrors the real layout for update.sh/preview.sh runs. */
function toolRepo(tag: string, exportPath?: string): { root: string; exportCopy: string } {
  requireProduction();
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
  mkdirSync(join(root, "measure", "tracks", "model_guide"), { recursive: true });
  mkdirSync(join(root, "fixture-b"), { recursive: true });
  const stagedDir = exportPath ? join(exportPath, "..") : PAGE_B;
  for (const name of [OUTCOMES_NAME, AA_NAME, ALLOWED_NAME, MANIFEST_NAME]) {
    copyFileSync(join(stagedDir, name), join(root, "fixture-b", name));
  }
  symlinkSync(join(HARNESS, "node_modules"), join(root, "harness", "node_modules"));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "model-guide-advp2@example.invalid"]);
  git(root, ["config", "user.name", "Model Guide Adversarial P2"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "initial"]);
  expect(git(root, ["status", "--short"]), "the temp repo starts clean").toBe("");
  return { root, exportCopy: join(root, "fixture-b", MANIFEST_NAME) };
}

function approve(root: string): void {
  const text = ["approved_by: Daniel", "date: 2026-11-15", ""].join("\n");
  // Both paths: the stable path the tools read (written after the harness
  // copy, so the fixture record wins over any copied real record) and the
  // old track path the previous contract used.
  writeFileSync(join(root, APPROVAL), text);
  writeFileSync(join(root, OLD_APPROVAL), text);
  git(root, ["add", APPROVAL, OLD_APPROVAL]);
  git(root, ["commit", "-q", "-m", "approval record"]);
}

describe("adversarial phase 2: guide tie-break, score freshness, rerun, flags, symlinks", () => {
  it("P2ADV-1 tie-break (spec D13): an equal worst score ranks the higher median first, not the alphabetically first route", () => {
    // Both routes have worst 80.0. a-route has median 81, z-route median 82.
    // D13 breaks the tie by the higher worst blocker recall, then the higher
    // median score. With no recall field the median decides: z-route first.
    const inputs = guideInputs("tiebreak");
    const scores = scoresFile("tiebreak", [
      { route: "a-route", scores: [80.0, 81.0, 99.0] },
      { route: "z-route", scores: [80.0, 82.0, 83.0] },
    ]);
    const run = guideRaw([
      "model-guide/guide.ts",
      "--real-work", inputs.realWork,
      "--scores", scores,
      "--print-audit", inputs.printAudit,
      "--benchmark", inputs.benchmark,
      "--tracks", inputs.tracks,
      "--today", TODAY,
    ]);
    expect(run.status, run.stdout).toBe(0);
    const page = JSON.parse(readFileSync(join(run.out, "model-guide.json"), "utf8"));
    const row = page.rows.find((item: any) => item.kind === "Code review");
    expect(row, "the Code review row").toBeDefined();
    expect(row.pick, "D13: the higher median (z-route, median 82) wins the worst-score tie").toBe("z-route");
    expect(row.second).toBe("a-route");
  });

  it("P2ADV-2 newest score file (preview.sh/update.sh header): the newest file by date wins, not the alphabetically last glob match", () => {
    const { root, exportCopy } = toolRepo("newest-score");
    const scoresDir = join(root, "harness", "model-guide", "data", "review-scores");
    mkdirSync(scoresDir, { recursive: true });
    // The alphabetically first file is the newest by mtime and ranks
    // new-model first (worst 90). The alphabetically last file is older by
    // mtime and ranks old-model first (worst 95).
    const newest = scoresFile("newest-a", [{ route: "new-model", scores: [90.0, 91.0, 92.0] }]);
    const older = scoresFile("older-p", [{ route: "old-model", scores: [95.0, 96.0, 97.0] }]);
    const aFile = join(scoresDir, "mg-2026-11a.json");
    const pFile = join(scoresDir, "mg-2026-11p.json");
    copyFileSync(newest, aFile);
    copyFileSync(older, pFile);
    const now = new Date();
    const old = new Date(now.getTime() - 24 * 3600 * 1000);
    utimesSync(aFile, now, now);
    utimesSync(pFile, old, old);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "two score files"]);

    const result = spawnSync("bash", [join(root, "harness", "model-guide", "update.sh"), exportCopy], {
      cwd: root, env: env(), encoding: "utf8", timeout: 180_000,
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const page = JSON.parse(
      readFileSync(join(root, PREVIEW_DIR, "model-guide.json"), "utf8"),
    );
    const row = page.rows.find((item: any) => item.kind === "Code review");
    expect(row, "the Code review row").toBeDefined();
    expect(row.pick, "the newest score file (mg-2026-11a.json) picks new-model").toBe("new-model");
  });

  it("P2ADV-3 rerun (spec D19): a weekly update with unchanged data exits 0", () => {
    const { root, exportCopy } = toolRepo("rerun");
    approve(root);
    const first = spawnSync("bash", [join(root, "harness", "model-guide", "update.sh"), "--docs", exportCopy], {
      cwd: root, env: env(), encoding: "utf8", timeout: 180_000,
    });
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
    const commits = git(root, ["rev-list", "--count", "HEAD"]);

    const second = spawnSync("bash", [join(root, "harness", "model-guide", "update.sh"), "--docs", exportCopy], {
      cwd: root, env: env(), encoding: "utf8", timeout: 180_000,
    });
    expect(second.status, `a no-change week must still exit 0: ${second.stdout}\n${second.stderr}`).toBe(0);
    expect(git(root, ["rev-list", "--count", "HEAD"])).toBe(commits);
    expect(git(root, ["status", "--short"]), "the rerun leaves the tree clean").toBe("");
  });

  it("P2ADV-4 unknown flags (guide.ts header `args`): inherited Object.prototype keys are refused", () => {
    const inputs = guideInputs("inherited-flags");
    const base = [
      "model-guide/guide.ts",
      "--real-work", inputs.realWork,
      "--print-audit", inputs.printAudit,
      "--benchmark", inputs.benchmark,
      "--tracks", inputs.tracks,
      "--today", TODAY,
    ];
    // Control: a plain unknown flag is refused.
    const control = guideRaw([...base, "--bogus", "x"]);
    expect(control.status, control.stdout).toBe(2);
    expect(control.stdout).toContain("input-check: args");
    expect(existsSync(join(control.out, "model-guide.json")), "no output on refusal").toBe(false);
    // Each inherited key must be refused the same way.
    for (const token of ["__proto__", "constructor", "toString"]) {
      const run = guideRaw([...base, token, "x"]);
      expect(run.status, `unknown flag ${token} must exit 2, got ${run.status}: ${run.stdout}`).toBe(2);
      expect(run.stdout, `unknown flag ${token}`).toContain("input-check: args");
      expect(existsSync(join(run.out, "model-guide.json")), `no output on refusal (${token})`).toBe(false);
    }
  });

  it("P2ADV-5 symlinked data dir (spec D21): update.sh writes no file outside the repo", () => {
    const outside = tempDir("outside-data");
    copyFileSync(BENCHMARK, join(outside, "benchmark.json"));
    copyFileSync(TRACKS, join(outside, "tracks.json"));
    const before = readdirSync(outside).sort();
    const { root, exportCopy } = toolRepo("symlink-data");
    // Replace the data dir with a link to the outside folder.
    rmSync(join(root, DATA_DIR), { recursive: true, force: true });
    symlinkSync(outside, join(root, DATA_DIR));
    approve(root);
    const result = spawnSync("bash", [join(root, "harness", "model-guide", "update.sh"), exportCopy], {
      cwd: root, env: env(), encoding: "utf8", timeout: 180_000,
    });
    expect(result.status, `a symlinked data dir must be refused with exit 2, got ${result.status}: ${result.stdout}\n${result.stderr}`).toBe(2);
    expect(readdirSync(outside).sort(), "no file is written outside the repo").toEqual(before);
  });
});

describe("adversarial phase 2: boundaries, page contract, and input matrix", () => {
  it("P2ADV-6 stale page mark (spec D19): evidence older than 14 days shows the stale mark above the table", () => {
    const exportPath = stagedExport("stale-page", (doc) => {
      doc.generated_on = "2026-10-01";
    });
    const { root } = toolRepo("stale-page", exportPath);
    const first = spawnSync(
      "bash",
      [join(root, "harness", "model-guide", "preview.sh"), "--manifest", join(root, "fixture-b", MANIFEST_NAME)],
      { cwd: root, env: env(), encoding: "utf8", timeout: 180_000 },
    );
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
    const page = JSON.parse(
      readFileSync(join(root, PREVIEW_DIR, "model-guide.json"), "utf8"),
    );
    expect(page.stale, "45-day-old evidence is stale").toBe(true);
    const index = readFileSync(join(root, PREVIEW_DIR, "index.html"), "utf8");
    expect(index, "the page shows the stale mark").toContain('data-stale="true"');
    expect(index, "the section sits above the hero").toBeDefined();
    expect(index.indexOf('id="model-guide"') < index.indexOf('class="hero"'), "the overview section is above the hero").toBe(true);
    for (const header of ["Kind of work", "Use this model", "Second choice", "Evidence", "Evidence date"]) {
      expect(index, `the page shows the header ${header}`).toContain(`<th scope="col">${header}</th>`);
    }
    // A second preview over the same folder keeps exactly one section.
    const second = spawnSync(
      "bash",
      [join(root, "harness", "model-guide", "preview.sh"), "--manifest", join(root, "fixture-b", MANIFEST_NAME)],
      { cwd: root, env: env(), encoding: "utf8", timeout: 180_000 },
    );
    expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(0);
    const again = readFileSync(join(root, PREVIEW_DIR, "index.html"), "utf8");
    expect(again.split('id="model-guide"').length - 1, "one overview section after a second preview").toBe(1);
  });

  it("P2ADV-8 hostile names (spec D18): every overview cell with a hostile model name is escaped on the page", () => {
    const exportPath = stagedExport("hostile", (doc) => {
      for (const item of doc.all_time) {
        if (item.route === "t1/prod-nine") item.route = HOSTILE_ROUTE;
      }
      // The hostile model must stay allowed, or it never picks.
      doc.allowedRoutes.push(HOSTILE_ROUTE);
    });
    const { root } = toolRepo("hostile", exportPath);
    const result = spawnSync(
      "bash",
      [join(root, "harness", "model-guide", "preview.sh"), "--manifest", join(root, "fixture-b", MANIFEST_NAME)],
      { cwd: root, env: env(), encoding: "utf8", timeout: 180_000 },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const page = JSON.parse(
      readFileSync(join(root, PREVIEW_DIR, "model-guide.json"), "utf8"),
    );
    const picks = page.rows.flatMap((row: any) => [row.pick, row.second]);
    expect(
      picks.some(
        (name: any) =>
          typeof name === "string" && name.includes("img src=x onerror=alert(1)"),
      ),
      "the JSON keeps the hostile name in a cell",
    ).toBe(true);
    for (const name of ["index.html", "real-work.html"]) {
      const html = readFileSync(join(root, PREVIEW_DIR, name), "utf8");
      expect(html, `${name} escapes the hostile name`).toContain("&lt;img");
      expect(html, `${name} holds no raw hostile tag`).not.toContain("<img src=x onerror=alert(1)>");
    }
  });

  it("P2ADV-9 flag matrix (guide.ts header): each missing flag is refused with args", () => {
    const inputs = guideInputs("flag-matrix");
    const full = {
      "--real-work": inputs.realWork,
      "--print-audit": inputs.printAudit,
      "--benchmark": inputs.benchmark,
      "--tracks": inputs.tracks,
      "--today": TODAY,
    };
    // Each missing required flag gives input-check: args and no output.
    // --out is always supplied by the runner, so its absence is checked
    // separately below.
    for (const missing of Object.keys(full)) {
      const args = ["model-guide/guide.ts"];
      for (const [flag, value] of Object.entries(full)) {
        if (flag !== missing) args.push(flag, value);
      }
      const run = guideRaw(args);
      expect(run.status, `missing ${missing} must exit 2`).toBe(2);
      expect(run.stdout, `missing ${missing}`).toContain("input-check: args");
      expect(existsSync(join(run.out, "model-guide.json")), `no output when ${missing} is missing`).toBe(false);
    }
    // A missing --out flag is refused with args and no output.
    const noOut = spawnSync(
      TSX,
      [
        "model-guide/guide.ts",
        "--real-work", inputs.realWork,
        "--print-audit", inputs.printAudit,
        "--benchmark", inputs.benchmark,
        "--tracks", inputs.tracks,
        "--today", TODAY,
      ],
      { cwd: HARNESS, env: env(), encoding: "utf8", timeout: 60_000 },
    );
    expect(noOut.status, `${noOut.stdout}`).toBe(2);
    expect(noOut.stdout).toContain("input-check: args");
    // Each malformed input gives its own check and no output.
    const badToday = guideRaw([
      "model-guide/guide.ts",
      "--real-work", inputs.realWork,
      "--print-audit", inputs.printAudit,
      "--benchmark", inputs.benchmark,
      "--tracks", inputs.tracks,
      "--today", "2026-13-40",
    ]);
    expect(badToday.status).toBe(2);
    expect(badToday.stdout).toContain("input-check: today");
    const badWork = guideRaw([
      "model-guide/guide.ts",
      "--real-work", join(inputs.realWork, ".missing"),
      "--print-audit", inputs.printAudit,
      "--benchmark", inputs.benchmark,
      "--tracks", inputs.tracks,
      "--today", TODAY,
    ]);
    expect(badWork.status).toBe(2);
    expect(badWork.stdout).toContain("input-check: real-work");
    const badDir = tempDir("bad-scores");
    const badScores = join(badDir, "review-scores.json");
    writeFileSync(badScores, "not json\n");
    const badScoresRun = guideRaw([
      "model-guide/guide.ts",
      "--real-work", inputs.realWork,
      "--scores", badScores,
      "--print-audit", inputs.printAudit,
      "--benchmark", inputs.benchmark,
      "--tracks", inputs.tracks,
      "--today", TODAY,
    ]);
    expect(badScoresRun.status).toBe(2);
    expect(badScoresRun.stdout).toContain("input-check: scores");
    const badBenchDir = tempDir("bad-benchmark");
    const badBenchmark = join(badBenchDir, "benchmark.json");
    writeFileSync(badBenchmark, "not json\n");
    const badBenchRun = guideRaw([
      "model-guide/guide.ts",
      "--real-work", inputs.realWork,
      "--print-audit", inputs.printAudit,
      "--benchmark", badBenchmark,
      "--tracks", inputs.tracks,
      "--today", TODAY,
    ]);
    expect(badBenchRun.status).toBe(2);
    expect(badBenchRun.stdout).toContain("input-check: benchmark");
    expect(existsSync(join(badBenchRun.out, "model-guide.json")), "no output on refusal").toBe(false);
    const badTracks = guideRaw([
      "model-guide/guide.ts",
      "--real-work", inputs.realWork,
      "--print-audit", inputs.printAudit,
      "--benchmark", inputs.benchmark,
      "--tracks", join(inputs.tracks, ".missing"),
      "--today", TODAY,
    ]);
    expect(badTracks.status).toBe(2);
    expect(badTracks.stdout).toContain("input-check: tracks");
    expect(existsSync(join(badTracks.out, "model-guide.json")), "no output on refusal").toBe(false);
    const badPaDir = tempDir("bad-print-audit");
    const badPa = JSON.parse(readFileSync(inputs.printAudit, "utf8"));
    badPa.routes["zzz-bad"] = 42;
    const badPaFile = join(badPaDir, "print-audit-2026-11.json");
    writeFileSync(badPaFile, JSON.stringify(badPa));
    const badPaRun = guideRaw([
      "model-guide/guide.ts",
      "--real-work", inputs.realWork,
      "--print-audit", badPaFile,
      "--benchmark", inputs.benchmark,
      "--tracks", inputs.tracks,
      "--today", TODAY,
    ]);
    expect(badPaRun.status).toBe(2);
    expect(badPaRun.stdout).toContain("input-check: print-audit");
    expect(existsSync(join(badPaRun.out, "model-guide.json")), "no output on refusal").toBe(false);
    // An absent --scores flag is allowed: track A has no rank, exit 0.
    const noScores = guideRaw([
      "model-guide/guide.ts",
      "--real-work", inputs.realWork,
      "--print-audit", inputs.printAudit,
      "--benchmark", inputs.benchmark,
      "--tracks", inputs.tracks,
      "--today", TODAY,
    ]);
    expect(noScores.status).toBe(0);
    const page = JSON.parse(readFileSync(join(noScores.out, "model-guide.json"), "utf8"));
    expect(page.rows.find((item: any) => item.kind === "Code review").pick).toBe(NO_PICK);
  });

  it("P2ADV-10 failed guide step (update.sh header): a refused guide run writes nothing into the repo", () => {
    const { root, exportCopy } = toolRepo("guide-fails");
    approve(root);
    writeFileSync(join(root, DATA_DIR, "benchmark.json"), "not json\n");
    const before = treeHashes(root);
    const commits = git(root, ["rev-list", "--count", "HEAD"]);
    const result = spawnSync("bash", [join(root, "harness", "model-guide", "update.sh"), exportCopy], {
      cwd: root, env: env(), encoding: "utf8", timeout: 180_000,
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout).toContain("input-check: benchmark");
    expect(treeHashes(root), "the refused run writes nothing into the repo").toEqual(before);
    expect(git(root, ["rev-list", "--count", "HEAD"])).toBe(commits);
    expect(existsSync(join(root, PREVIEW_DIR)), "no preview folder appears").toBe(false);
  });

  it("P2ADV-11 repo path with a space: update.sh runs before the approval with preview-only writes", () => {
    const base = tempDir("space base");
    const spaced = join(base, "repo with space");
    mkdirSync(spaced, { recursive: true });
    mkdirSync(join(spaced, "harness"), { recursive: true });
    cpSync(SOURCE, join(spaced, "harness", "model-guide"), {
      recursive: true,
      // The real approval record stays out of every fixture.
      filter: (source) => !source.endsWith("publish-approval.md"),
    });
    mkdirSync(join(spaced, "docs", "assets", "css"), { recursive: true });
    mkdirSync(join(spaced, "docs", "assets", "data"), { recursive: true });
    writeFileSync(join(spaced, "docs", "index.html"), INDEX_HTML);
    writeFileSync(join(spaced, "docs", "assets", "css", "site.css"), SITE_CSS);
    copyFileSync(BENCHMARK, join(spaced, DATA_DIR, "benchmark.json"));
    copyFileSync(TRACKS, join(spaced, DATA_DIR, "tracks.json"));
    mkdirSync(join(spaced, "measure", "tracks", "model_guide"), { recursive: true });
    mkdirSync(join(spaced, "fixture-b"), { recursive: true });
    for (const name of [OUTCOMES_NAME, AA_NAME, ALLOWED_NAME, MANIFEST_NAME]) {
      copyFileSync(join(PAGE_B, name), join(spaced, "fixture-b", name));
    }
    symlinkSync(join(HARNESS, "node_modules"), join(spaced, "harness", "node_modules"));
    git(spaced, ["init", "-q", "-b", "main"]);
    git(spaced, ["config", "user.email", "model-guide-advp2@example.invalid"]);
    git(spaced, ["config", "user.name", "Model Guide Adversarial P2"]);
    git(spaced, ["add", "-A"]);
    git(spaced, ["commit", "-q", "-m", "initial"]);
    const before = treeHashes(spaced, [PREVIEW_DIR]);
    const result = spawnSync(
      "bash",
      [join(spaced, "harness", "model-guide", "update.sh"), join(spaced, "fixture-b", MANIFEST_NAME)],
      { cwd: spaced, env: env(), encoding: "utf8", timeout: 180_000 },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(existsSync(join(spaced, PREVIEW_DIR, "real-work.json")), "preview real-work.json").toBe(true);
    expect(existsSync(join(spaced, PREVIEW_DIR, "model-guide.json")), "preview model-guide.json").toBe(true);
    expect(treeHashes(spaced, [PREVIEW_DIR]), "nothing outside the preview folder moved").toEqual(before);
  });

  it("P2ADV-12 filter precision (spec D17, anti-pattern A7): a value that names a banned word passes, a banned key is refused", () => {
    // A checklist text that holds the words "text", "file", and "pages" as
    // values must pass: the D17 ban covers keys, not bare words.
    const dir = tempDir("filter-precision");
    const handoff = JSON.parse(
      readFileSync(join(PRINT_AUDIT_DIR, "print-audit-mini.json"), "utf8"),
    );
    handoff.errors[0].checklist[0].text =
      "the text of a file spans several pages and names no key";
    const handoffFile = join(dir, "print-audit-hand-off.json");
    const text = JSON.stringify(handoff);
    writeFileSync(handoffFile, text);
    writeFileSync(join(dir, "MANIFEST.txt"), `sha256: ${sha256(handoffFile)}\nsize: ${Buffer.byteLength(text)}\n`);
    const out = tempDir("filter-precision-out");
    const good = spawnSync(
      TSX,
      [PRINT_AUDIT_TOOL, "--input", handoffFile, "--out", out],
      { cwd: HARNESS, env: env(), encoding: "utf8", timeout: 60_000 },
    );
    expect(good.status, `${good.stdout}\n${good.stderr}`).toBe(0);
    expect(existsSync(join(out, "print-audit-2026-11.json"))).toBe(true);
    // Control: a row that carries a banned old-shape `type` key is refused
    // (spec D17: a row carries no `type` and no `results` key).
    const bad = JSON.parse(JSON.stringify(handoff));
    bad.errors[1].type = "C3";
    const badDir = tempDir("filter-precision-bad");
    const badMoved = join(badDir, "print-audit-hand-off.json");
    const badText = JSON.stringify(bad);
    writeFileSync(badMoved, badText);
    writeFileSync(join(badDir, "MANIFEST.txt"), `sha256: ${sha256(badMoved)}\nsize: ${Buffer.byteLength(badText)}\n`);
    const badOut = tempDir("filter-precision-bad-out");
    const refused = spawnSync(
      TSX,
      [PRINT_AUDIT_TOOL, "--input", badMoved, "--out", badOut],
      { cwd: HARNESS, env: env(), encoding: "utf8", timeout: 60_000 },
    );
    expect(refused.status, `${refused.stdout}\n${refused.stderr}`).toBe(2);
    expect(refused.stdout).toContain("input-check: errors");
    expect(existsSync(join(badOut, "print-audit-2026-11.json")), "no output on refusal").toBe(false);
  });

  it("P2ADV-13 route result form (D17 with the 2.4a ruling): each route maps to `x of y` and the page shows both results", () => {
    const inputs = guideInputs("result-form");
    const doc = JSON.parse(readFileSync(inputs.printAudit, "utf8"));
    for (const [name, result] of Object.entries<any>(doc.routes)) {
      expect(result, `route ${name}`).toMatch(/^\d+ of \d+$/);
    }
    expect(doc.totals.errors).toBe(52);
    expect(doc.totals.blockers).toBe(13);
    const { root } = toolRepo("result-form");
    const result = spawnSync(
      "bash",
      [join(root, "harness", "model-guide", "preview.sh"), "--manifest", join(root, "fixture-b", MANIFEST_NAME)],
      { cwd: root, env: env(), encoding: "utf8", timeout: 180_000 },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const html = readFileSync(join(root, PREVIEW_DIR, "real-work.html"), "utf8");
    expect(html, "the page shows the 11-of-13 result").toContain("11 of 13");
    expect(html, "the page shows the 13-of-13 result").toContain("13 of 13");
    expect(html, "no placeholder line").not.toContain("Error types: not yet received.");
  });

  it("P2ADV-14 stale boundary (spec D19, FR-6): 14 days is fresh, 15 days is stale", () => {
    const inputs = guideInputs("stale-boundary");
    // The case passes no --scores, so no track A date applies: the newest
    // evidence date is the staged export date 2026-10-20.
    for (const [today, stale] of [["2026-11-03", false], ["2026-11-04", true]] as const) {
      const run = guideRaw([
        "model-guide/guide.ts",
        "--real-work", inputs.realWork,
        "--print-audit", inputs.printAudit,
        "--benchmark", inputs.benchmark,
        "--tracks", inputs.tracks,
        "--today", today,
      ]);
      expect(run.status, run.stdout).toBe(0);
      const page = JSON.parse(readFileSync(join(run.out, "model-guide.json"), "utf8"));
      expect(page.today).toBe(today);
      expect(page.stale, `evidence 2026-10-20 against --today ${today}`).toBe(stale);
    }
  });
});
