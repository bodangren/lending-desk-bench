// Probe: update.sh private-input guard vs leak-check scan root.
// Review B, pass 4, weekly_update_fix. Builds throwaway fixture repos in
// the OS temp folder from the repo fixtures, runs a copied update.sh with
// hostile MODEL_GUIDE_PRIVATE_DIR values, and checks the refusal contract.
// Writes nothing into the repo. Removes every temp folder at the end.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
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
import { join } from "node:path";

const REPO = "/home/daniebo/Desktop/lending-desk-bench";
const HARNESS = join(REPO, "harness");
const SOURCE = join(HARNESS, "model-guide");
const FIXTURES = join(HARNESS, "model-guide-tests", "fixtures");
const PAGE_B = join(FIXTURES, "page-b");
const GUIDE = join(FIXTURES, "guide");
const PRINT_AUDIT = join(FIXTURES, "print-audit");
const APPROVAL = join(REPO, "measure", "archive", "model_guide", "publish-approval.md");
const DATE = "2026-10-20";
const MANIFEST_NAME = `MANIFEST-${DATE}.txt`;
const INPUTS = [
  `ra-outcomes-${DATE}.json`,
  `aa-reliability-${DATE}.json`,
  `allowed-routes-${DATE}.json`,
  MANIFEST_NAME,
];
const DATA = join("docs", "assets", "data");
const roots = [];
let failures = 0;

function temp(tag) {
  const path = mkdtempSync(join(tmpdir(), `wuf-probe-${tag}-`));
  roots.push(path);
  return path;
}

function env(privateDir) {
  const next = { ...process.env, NO_COLOR: "1", npm_config_loglevel: "silent" };
  next.HOME = temp("home");
  next.MODEL_GUIDE_PRIVATE_DIR = privateDir;
  delete next.BENCH_TRACK;
  return next;
}

function git(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    env: env("/nonexistent"),
    encoding: "utf8",
    timeout: 60_000,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.replace(/\s+$/, "");
}

function seededLine(tag) {
  return `private-seed-${tag}-must-not-ship`;
}

function privateSeedAt(path, tag) {
  const line = seededLine(tag);
  const set = join(path, "sets", "synthetic");
  mkdirSync(join(set, "diffs"), { recursive: true });
  mkdirSync(join(set, "src"), { recursive: true });
  writeFileSync(join(set, "diffs", "seed.diff"), `@@ -1 +1 @@\nL1 +${line}\n`);
  writeFileSync(join(set, "src", "seed.diff"), "@@ -1 +1 @@\nL1 -baseline text only\n");
  return line;
}

function relativeSeed(root, rel, tag) {
  const dir = join(root, rel);
  if (!dir.startsWith(`${root}/`)) roots.push(dir);
  return { value: rel, line: privateSeedAt(dir, tag) };
}

function repo(tag) {
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
  for (const name of INPUTS) copyFileSync(join(PAGE_B, name), join(exportDir, name));
  symlinkSync(join(HARNESS, "node_modules"), join(root, "harness", "node_modules"));
  writeFileSync(
    join(root, ".gitignore"),
    `${readFileSync(join(REPO, ".gitignore"), "utf8")}\nharness/node_modules\n`,
  );
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "probe@example.invalid"]);
  git(root, ["config", "user.name", "Probe B"]);
  copyFileSync(APPROVAL, join(root, "harness", "model-guide", "publish-approval.md"));
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "fixture"]);
  return { root, manifest: join(exportDir, MANIFEST_NAME) };
}

function run(root, manifest, privateDir, plantPath) {
  const runEnv = env(privateDir);
  if (plantPath !== undefined) runEnv.WUF_PLANT_PATH = plantPath;
  return spawnSync("bash", [join(root, "harness", "model-guide", "update.sh"), "--docs", manifest], {
    cwd: root,
    env: runEnv,
    encoding: "utf8",
    timeout: 180_000,
  });
}

function commits(root) {
  return git(root, ["rev-list", "--count", "HEAD"]);
}

function treeHash(root) {
  const hash = createHash("sha256");
  const walk = (dir, rel) => {
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

function injectCandidate(root, rel, line) {
  const update = join(root, "harness", "model-guide", "update.sh");
  let text = readFileSync(update, "utf8");
  const anchor = "# Scan exactly the candidate files in a throwaway repo.";
  const injection = `# Synthetic adversarial candidate plant for this temp repo.\ncase "\${WUF_PLANT_PATH:-}" in\n  ${rel}) printf '%s\\\\n' '${line}' >> "$CAND/${rel}" ;;\nesac\n\n`;
  if (!text.includes(anchor)) throw new Error("candidate-scan anchor missing");
  text = text.replace(anchor, `${injection}${anchor}`);
  writeFileSync(update, text);
}

function check(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` :: ${detail}`}`);
}

// A refusal contract: exit 2, one line, byte-identical tree, same HEAD
// count and commit set, and neither the seeded line nor the value printed.
function expectRefusal(tag, value, seedLine) {
  const { root, manifest } = repo(`${tag}-setup`);
  injectCandidate(root, "docs/index.html", seedLine);
  const before = treeHash(root);
  const headBefore = git(root, ["show", "--name-only", "--format=", "HEAD"]).split("\n").filter(Boolean);
  const countBefore = commits(root);
  const result = run(root, manifest, value, "docs/index.html");
  check(`${tag} exit 2`, result.status === 2, `status ${result.status}`);
  check(`${tag} one refusal line`, result.stdout === "update: no private input\n", JSON.stringify(result.stdout));
  check(`${tag} docs byte-identical`, treeHash(root) === before, "tree changed");
  check(`${tag} no commit`, commits(root) === countBefore, `commits ${commits(root)} vs ${countBefore}`);
  check(
    `${tag} commit set unchanged`,
    JSON.stringify(git(root, ["show", "--name-only", "--format=", "HEAD"]).split("\n").filter(Boolean)) === JSON.stringify(headBefore),
    "commit set changed",
  );
  check(
    `${tag} seed never in docs`,
    !readFileSync(join(root, "docs", "index.html"), "utf8").includes(seedLine),
    "seed reached docs",
  );
  const all = `${result.stdout}\n${result.stderr}`;
  check(`${tag} seed never printed`, !all.includes(seedLine), "seed printed");
  // A space-only value is a substring of every sentence, so the exact
  // stdout line check above is the proof for it.
  check(`${tag} value never printed`, value.trim() === "" || !all.includes(value), "value printed");
}

// A leak refusal contract: the guard passed, the scan caught the plant.
function expectLeak(tag, value, seedLine) {
  const { root, manifest } = repo(`${tag}-setup`);
  injectCandidate(root, "docs/index.html", seedLine);
  const before = treeHash(root);
  const countBefore = commits(root);
  const result = run(root, manifest, value, "docs/index.html");
  check(`${tag} exit 2`, result.status === 2, `status ${result.status}`);
  check(`${tag} leak line`, result.stdout === "update: leak docs/index.html\n", JSON.stringify(result.stdout));
  check(`${tag} docs byte-identical`, treeHash(root) === before, "tree changed");
  check(`${tag} no commit`, commits(root) === countBefore, `commits ${commits(root)} vs ${countBefore}`);
  const all = `${result.stdout}\n${result.stderr}`;
  check(`${tag} seed never printed raw`, !all.includes(seedLine), "raw seed printed");
}

// 1-3. Relative values with a valid seeded folder under the repo root.
{
  const p = repo("rel-bare-pre");
  const seed = relativeSeed(p.root, "private-input", "rel-bare");
  expectRefusal("rel-bare", seed.value, seed.line);
}
{
  const p = repo("rel-dot-pre");
  const seed = relativeSeed(p.root, "./private-input", "rel-dot");
  expectRefusal("rel-dot", seed.value, seed.line);
}
{
  const p = repo("rel-dotdot-pre");
  const seed = relativeSeed(p.root, `../wuf-probe-x-${process.pid}`, "rel-dotdot");
  expectRefusal("rel-dotdot", seed.value, seed.line);
}

// 4. A tilde value: not absolute, so the relative guard refuses it.
expectRefusal("tilde", "~/wuf-probe-private", seededLine("tilde"));

// 5. A space-only value: non-empty and not absolute, refused.
expectRefusal("space", " ", seededLine("space"));

// 6. A trailing newline on an absolute value: the dir test fails closed.
{
  const base = temp("newline");
  const line = privateSeedAt(join(base, "private"), "newline");
  expectRefusal("newline", `${base}/private\n`, line);
}

// 7. An absolute value with dotdot segments inside: the guard and the
// scan resolve the same literal, so a plant is caught. The intermediate
// folder must exist, or the OS cannot resolve the .. segment and the
// dir test fails closed (probe 7b).
{
  const base = temp("dotdot-abs");
  const line = privateSeedAt(join(base, "private"), "dotdot-abs");
  mkdirSync(join(base, "x"), { recursive: true });
  expectLeak("dotdot-abs", `${base}/x/../private`, line);
}
{
  const base = temp("dotdot-missing");
  const line = privateSeedAt(join(base, "private"), "dotdot-missing");
  expectRefusal("dotdot-missing", `${base}/x/../private`, line);
}

// 8. A symlinked private dir: the guard and the scan follow the same link.
{
  const base = temp("symlink");
  const line = privateSeedAt(join(base, "real"), "symlink");
  symlinkSync(join(base, "real"), join(base, "link"));
  expectLeak("symlink", join(base, "link"), line);
}

// 9. An absolute valid value with a plant: the baseline leak refusal.
{
  const base = temp("abs-plant");
  const line = privateSeedAt(join(base, "private"), "abs-plant");
  expectLeak("abs-plant", join(base, "private"), line);
}

// 10. An absolute valid value with no plant: the run completes and
// commits, proving the guard passes the same root the scan reads.
{
  const base = temp("abs-clean");
  const line = privateSeedAt(join(base, "private"), "abs-clean");
  const { root, manifest } = repo("abs-clean-run");
  const countBefore = commits(root);
  const result = run(root, manifest, join(base, "private"), "docs/none");
  check("abs-clean exit 0", result.status === 0, `status ${result.status} :: ${result.stdout}\n${result.stderr}`);
  check("abs-clean commits once", commits(root) === String(Number(countBefore) + 1), `commits ${commits(root)}`);
  check("abs-clean committed index", result.stdout.includes("update: committed docs/index.html"), JSON.stringify(result.stdout));
  check(
    "abs-clean private path not printed",
    !`${result.stdout}\n${result.stderr}`.includes(base),
    "private path printed",
  );
}

for (const root of roots) rmSync(root, { recursive: true, force: true });
console.log(failures === 0 ? "ALL PROBES PASSED" : `${failures} PROBE CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
