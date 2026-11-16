import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Adversarial tests for Phase 3 (spec D4 to D13, D22, FR-8 to FR-10).
 * They attack `harness/model-guide/` at HEAD: hostile reviewer output and
 * scorer edges (`review-score.ts`), claim identity and the rule of two
 * (`adjudicate.ts`), lint edges (`review-set.ts`), leak-check boundaries
 * (`leak-check.ts`), and the score file through `guide.ts`.
 *
 * Every run happens in a temp folder or a temp git repo. No test reaches
 * the network, the real home, the real private folder, or a model. The
 * only committed fixtures read are the synthetic ones under `fixtures/`.
 *
 * Failing-first key:
 * - P3X1-1 (blocking, spec D11 tool header "two different claims get two
 *   ids"): two findings whose titles and reasons differ only by a
 *   whitespace shift share one `claimKey` join string, so the queue keeps
 *   one item for two claims.
 * - P3X1-2 (major, spec D5 + FR-8 "the plant rules of D5"): a plant at
 *   `new_lines` [9999, 9999], outside every hunk of its diff, passes the
 *   lint, so the W of the set counts weight no route can find.
 */

const HARNESS = resolve(import.meta.dirname, "..");
const SOURCE = join(HARNESS, "model-guide");
const SCORE_TOOL = join(SOURCE, "review-score.ts");
const ADJUDICATE_TOOL = join(SOURCE, "adjudicate.ts");
const LINT_TOOL = join(SOURCE, "review-set.ts");
const LEAK_TOOL = join(SOURCE, "leak-check.ts");
const REAL_WORK_TOOL = join(SOURCE, "real-work.ts");
const GUIDE_TOOL = join(SOURCE, "guide.ts");
const TSX = join(HARNESS, "node_modules", ".bin", "tsx");
const FIXTURES = join(import.meta.dirname, "fixtures");
const FIXTURE_SET = join(FIXTURES, "review", "sets", "mg-2026-11a");
const EXPORT_FIXTURE = join(FIXTURES, "real-work-mini.json");
const MANIFEST_FIXTURE = join(FIXTURES, "MANIFEST.txt");
const PRINT_AUDIT_DIR = join(FIXTURES, "print-audit");
const GUIDE_FIXTURES = join(FIXTURES, "guide");
const BENCHMARK = join(GUIDE_FIXTURES, "benchmark-mini.json");
const TRACKS = join(GUIDE_FIXTURES, "tracks-mini.json");

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `model-guide-advp3-${tag}-`));
  roots.push(dir);
  return dir;
}

function requireProduction(): void {
  for (const path of [SCORE_TOOL, ADJUDICATE_TOOL, LINT_TOOL, LEAK_TOOL, REAL_WORK_TOOL, GUIDE_TOOL]) {
    if (!existsSync(path)) throw new Error(`production file is missing: ${path}`);
  }
}

function env(home: string): NodeJS.ProcessEnv {
  const copy: Record<string, string | undefined> = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    GIT_CONFIG_NOSYSTEM: "1",
    TZ: "UTC",
    NO_COLOR: "1",
    npm_config_loglevel: "silent",
  };
  delete copy.BENCH_TRACK;
  return copy as NodeJS.ProcessEnv;
}

function tsx(args: string[], home: string) {
  return spawnSync(TSX, args, { cwd: HARNESS, env: env(home), encoding: "utf8", timeout: 60_000 });
}

function fenced(findings: unknown[]): string {
  return "```json\n" + JSON.stringify({ findings }, null, 2) + "\n```\n";
}

/** The route-blind claim id of the scorer and the queue. */
function claimId(diffId: string, finding: Record<string, unknown>): string {
  const canonical = JSON.stringify([
    diffId,
    finding.file,
    finding.line,
    finding.class ?? "",
    finding.severity ?? "",
    finding.title ?? "",
    finding.reason ?? "",
  ]);
  return `${diffId}#C${createHash("sha256").update(canonical).digest("hex").slice(0, 12)}`;
}

/* ---------- minimal private sets (keys only the tools read) ---------- */

interface MiniPlant {
  id: string;
  file: string;
  lines: [number, number];
  class: string;
  accepted: string[];
  severity: string;
}

/** A private set with one diff `d1` and the given plants. The scorer and
 * the queue read only `keys/`; the lint is not run on these sets. */
function miniPrivate(tag: string, plants: MiniPlant[]): string {
  requireProduction();
  const dir = tempDir(`private-${tag}`);
  mkdirSync(join(dir, "sets", "mg-mini", "keys"), { recursive: true });
  writeFileSync(
    join(dir, "sets", "mg-mini", "keys", "d1.json"),
    JSON.stringify({
      plants: plants.map((plant) => ({
        id: plant.id,
        file: plant.file,
        new_lines: plant.lines,
        class: plant.class,
        accepted_classes: plant.accepted,
        severity: plant.severity,
      })),
    }),
  );
  return dir;
}

function miniOutputs(tag: string, texts: Record<string, string>): string {
  const dir = tempDir(`outputs-${tag}`);
  writeFileSync(join(dir, "d1.txt"), texts.d1 ?? "```json\n{\"findings\": []}\n```\n");
  return dir;
}

function runScoreMini(privateDir: string, outputsDir: string, tag: string, verdicts?: Record<string, string>) {
  const scoresDir = tempDir(`scores-${tag}`);
  const args = [
    "model-guide/review-score.ts", "score",
    "--private", privateDir, "--set", "mg-mini",
    "--route", "route/a", "--pass", "1",
    "--date", "2026-11-20", "--outputs", outputsDir, "--scores", scoresDir,
  ];
  let verdictsFile: string | null = null;
  if (verdicts) {
    verdictsFile = join(tempDir(`verdicts-${tag}`), "verdicts.json");
    writeFileSync(verdictsFile, JSON.stringify(verdicts));
    args.push("--verdicts", verdictsFile);
  }
  const result = tsx(args, tempDir(`home-${tag}`));
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  return JSON.parse(readFileSync(join(scoresDir, "mg-mini.json"), "utf8")).passes[0];
}

function miniRaw(tag: string, routes: Record<string, unknown[]>): string {
  const dir = tempDir(`raw-${tag}`);
  for (const [slug, findings] of Object.entries(routes)) {
    mkdirSync(join(dir, slug), { recursive: true });
    writeFileSync(join(dir, slug, "d1.txt"), fenced(findings));
  }
  return dir;
}

function runQueue(privateDir: string, rawDir: string, home: string) {
  return tsx(
    ["model-guide/adjudicate.ts", "queue", "mg-mini", "--private", privateDir, "--raw", rawDir],
    home,
  );
}

function readQueue(privateDir: string): any {
  return JSON.parse(
    readFileSync(join(privateDir, "sets", "mg-mini", "adjudication", "queue.json"), "utf8"),
  );
}

function queueItemCount(queue: any): number {
  return queue.groups.reduce((sum: number, group: any) => sum + group.items.length, 0);
}

/* ---------- leak-check helpers ---------- */

/** A temp git repo with its own HOME. */
function leakRepo(tag: string): { dir: string; home: string } {
  const dir = tempDir(`repo-${tag}`);
  const home = tempDir(`home-${tag}`);
  expect(spawnSync("git", ["init", "-q"], { cwd: dir, env: env(home), encoding: "utf8" }).status).toBe(0);
  expect(
    spawnSync("git", ["config", "user.email", "advp3@example.invalid"], { cwd: dir, env: env(home), encoding: "utf8" }).status,
  ).toBe(0);
  expect(
    spawnSync("git", ["config", "user.name", "advp3"], { cwd: dir, env: env(home), encoding: "utf8" }).status,
  ).toBe(0);
  return { dir, home };
}

function gitAdd(repoDir: string, home: string, rel: string): void {
  const result = spawnSync("git", ["add", "--", rel], { cwd: repoDir, env: env(home), encoding: "utf8" });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
}

function writeStaged(repoDir: string, home: string, rel: string, text: string): void {
  const file = join(repoDir, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  gitAdd(repoDir, home, rel);
}

/** A private folder whose only secret is the 20-character body text
 * `" " + "s" * 19`, unless `shortOnly` holds (then only a 19-character
 * text, which is no secret). */
function seedPrivate(tag: string, shortOnly: boolean): { dir: string; secret20: string } {
  const dir = tempDir(`seed-${tag}`);
  const secret20 = ` ${"s".repeat(19)}`;
  const short19 = ` ${"t".repeat(18)}`;
  expect(secret20.length).toBe(20);
  expect(short19.length).toBe(19);
  const body = shortOnly ? `L11 + ${"t".repeat(18)}` : `L10 + ${"s".repeat(19)}`;
  mkdirSync(join(dir, "sets", "s1", "diffs"), { recursive: true });
  writeFileSync(join(dir, "sets", "s1", "diffs", "d.diff"), `@@ -1,1 +1,2 @@\nL1 + short\n${body}\n`);
  return { dir, secret20 };
}

function runLeak(privateDir: string, repoDir: string, home: string) {
  requireProduction();
  return tsx(["model-guide/leak-check.ts", "--private", privateDir, "--repo", repoDir], home);
}

/* ---------- guide helpers ---------- */

function realWorkFrom(tag: string): string {
  const fixture = tempDir(`export-${tag}`);
  copyFileSync(EXPORT_FIXTURE, join(fixture, "real-work-mini.json"));
  copyFileSync(MANIFEST_FIXTURE, join(fixture, "MANIFEST.txt"));
  const out = tempDir(`real-work-${tag}`);
  const result = tsx(
    ["model-guide/real-work.ts", "--input", join(fixture, "real-work-mini.json"), "--out", out],
    tempDir(`home-rw-${tag}`),
  );
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  return join(out, "real-work.json");
}

function printAuditInput(tag: string): string {
  const handoff = JSON.parse(readFileSync(join(PRINT_AUDIT_DIR, "print-audit-mini.json"), "utf8"));
  const dir = tempDir(`print-audit-${tag}`);
  const routes: Record<string, string> = {};
  for (const [key, name] of Object.entries<any>(handoff.routes)) {
    routes[name as string] = `${handoff.summary[key].blockers_found} of ${handoff.summary.key.blockers}`;
  }
  writeFileSync(
    join(dir, "print-audit-2026-11.json"),
    JSON.stringify({
      schema: "model-guide-print-audit/1",
      totals: { errors: handoff.errors.length, blockers: 13 },
      routes,
      summary: handoff.summary,
      note: handoff.note,
    }),
  );
  return join(dir, "print-audit-2026-11.json");
}

describe("adversarial phase 3: hostile reviewer output and scorer edges", () => {
  it("P3X1-A two fenced blocks: the scorer reads the first block and ignores the second", () => {
    const privateDir = miniPrivate("two-blocks", [
      { id: "P1", file: "src/a.ts", lines: [10, 12], class: "C1", accepted: ["C1"], severity: "major" },
    ]);
    const hit = { file: "src/a.ts", line: 11, severity: "major", class: "C1", title: "t", reason: "r" };
    const extra = { file: "src/a.ts", line: 11, severity: "major", class: "C9", title: "x", reason: "y" };
    const text = `${fenced([hit])}\nSome prose.\n${fenced([extra])}\n`;
    const record = runScoreMini(privateDir, miniOutputs("two-blocks", { d1: text }), "two-blocks");
    expect(record.found).toBe(1);
    expect(record.false_claims).toBe(0);
  });

  it("P3X1-B extra JSON keys beside findings are ignored and the findings score", () => {
    const privateDir = miniPrivate("extra-keys", [
      { id: "P1", file: "src/a.ts", lines: [10, 12], class: "C1", accepted: ["C1"], severity: "major" },
    ]);
    const hit = { file: "src/a.ts", line: 11, severity: "major", class: "C1", title: "t", reason: "r" };
    const text = `\`\`\`json\n${JSON.stringify({ findings: [hit], summary: "all good", score: 99 })}\n\`\`\`\n`;
    const record = runScoreMini(privateDir, miniOutputs("extra-keys", { d1: text }), "extra-keys");
    expect(record.found).toBe(1);
    expect(record.false_claims).toBe(0);
  });

  it("P3X1-C a line that is a string makes the review invalid, with 0 found and 0 false claims", () => {
    const privateDir = miniPrivate("string-line", [
      { id: "P1", file: "src/a.ts", lines: [10, 12], class: "C1", accepted: ["C1"], severity: "major" },
    ]);
    const bad = { file: "src/a.ts", line: "11", severity: "major", class: "C1", title: "t", reason: "r" };
    const record = runScoreMini(privateDir, miniOutputs("string-line", { d1: fenced([bad]) }), "string-line");
    expect(record.invalid_reviews).toBe(1);
    expect(record.found).toBe(0);
    expect(record.false_claims).toBe(0);
  });

  it("P3X1-D line 0 matches a window that covers it, and a far negative line stays neutral", () => {
    const privateDir = miniPrivate("zero-line", [
      { id: "P1", file: "src/a.ts", lines: [2, 3], class: "C1", accepted: ["C1"], severity: "major" },
    ]);
    const zero = { file: "src/a.ts", line: 0, severity: "major", class: "C1", title: "t", reason: "r" };
    const hit = runScoreMini(privateDir, miniOutputs("zero-line", { d1: fenced([zero]) }), "zero-line");
    expect(hit.found).toBe(1);
    const far = { file: "src/a.ts", line: -50, severity: "major", class: "C1", title: "t", reason: "r" };
    const miss = runScoreMini(privateDir, miniOutputs("zero-line-far", { d1: fenced([far]) }), "zero-line-far", {});
    expect(miss.found).toBe(0);
    expect(miss.false_claims).toBe(0);
  });

  it("P3X1-E an unknown severity still matches, and an unknown class goes to the verdict", () => {
    const privateDir = miniPrivate("unknown-sev", [
      { id: "P1", file: "src/a.ts", lines: [10, 12], class: "C1", accepted: ["C1"], severity: "major" },
    ]);
    const odd = { file: "src/a.ts", line: 11, severity: "critical", class: "C1", title: "t", reason: "r" };
    const hit = runScoreMini(privateDir, miniOutputs("unknown-sev", { d1: fenced([odd]) }), "unknown-sev");
    expect(hit.found).toBe(1);
    const strange = { file: "src/a.ts", line: 11, severity: "major", class: "CX", title: "t", reason: "r" };
    const id = claimId("d1", strange as Record<string, unknown>);
    const open = runScoreMini(
      privateDir, miniOutputs("unknown-class", { d1: fenced([strange]) }), "unknown-class", { [id]: "false-claim" },
    );
    expect(open.found).toBe(0);
    expect(open.false_claims).toBe(1);
  });

  it("P3X1-F a finding equally near two plants matches the first plant of the key, every run", () => {
    const plants: MiniPlant[] = [
      { id: "P1", file: "src/a.ts", lines: [10, 10], class: "C1", accepted: ["C1"], severity: "major" },
      { id: "P2", file: "src/a.ts", lines: [14, 14], class: "C1", accepted: ["C1"], severity: "minor" },
    ];
    const privateDir = miniPrivate("tie", plants);
    const middle = { file: "src/a.ts", line: 12, severity: "major", class: "C1", title: "t", reason: "r" };
    for (const tag of ["tie-a", "tie-b"]) {
      const record = runScoreMini(privateDir, miniOutputs(tag, { d1: fenced([middle]) }), tag);
      expect(record.found).toBe(1);
      expect(record.found_weight).toBe(2);
    }
  });

  it("P3X1-G a set with no blockers recalls 0, and a set with no plants scores 0", () => {
    const privateDir = miniPrivate("no-blockers", [
      { id: "P1", file: "src/a.ts", lines: [10, 12], class: "C1", accepted: ["C1"], severity: "major" },
    ]);
    const hit = { file: "src/a.ts", line: 11, severity: "major", class: "C1", title: "t", reason: "r" };
    const record = runScoreMini(privateDir, miniOutputs("no-blockers", { d1: fenced([hit]) }), "no-blockers");
    expect(record.blockers).toBe(0);
    expect(record.blocker_recall).toBe(0);
    expect(record.score).toBe(100);
    const empty = miniPrivate("empty", []);
    const none = runScoreMini(empty, miniOutputs("empty", {}), "empty");
    expect(none.score).toBe(0);
    expect(none.found).toBe(0);
  });
});

describe("adversarial phase 3: claim identity and the rule of two", () => {
  const plants: MiniPlant[] = [
    { id: "P1", file: "src/a.ts", lines: [10, 12], class: "C1", accepted: ["C1"], severity: "major" },
  ];

  it("P3X1-1 two different claims split by whitespace get two queue items", () => {
    // Title "a b" + reason "c" and title "a" + reason "b c" are different
    // claims (spec D11: two different claims get two ids), but the queue
    // dedup key joins the fields with a space, so both join to one string.
    const privateDir = miniPrivate("ws-collision", plants);
    const base = { file: "other.ts", line: 50, severity: "major", class: "C1" };
    const first = { ...base, title: "a b", reason: "c" };
    const second = { ...base, title: "a", reason: "b c" };
    expect(claimId("d1", first)).not.toBe(claimId("d1", second));
    const raw = miniRaw("ws-collision", { route_a: [first], route_b: [second] });
    const result = runQueue(privateDir, raw, tempDir("home-ws-collision"));
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(queueItemCount(readQueue(privateDir))).toBe(2);
  });

  it("P3X1-H the same Unicode claim from two routes is one item with one id", () => {
    const privateDir = miniPrivate("unicode", plants);
    const claim = {
      file: "other.ts", line: 50, severity: "major", class: "C1",
      title: "caf\u00e9 check", reason: "na\u00efve input gives a wrong row",
    };
    const raw = miniRaw("unicode", { route_a: [claim], route_b: [{ ...claim }] });
    const result = runQueue(privateDir, raw, tempDir("home-unicode"));
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const queue = readQueue(privateDir);
    expect(queueItemCount(queue)).toBe(1);
    expect(queue.groups[0].items[0].id).toBe(claimId("d1", claim));
  });

  it("P3X1-I two different claims get two ids", () => {
    const privateDir = miniPrivate("distinct", plants);
    const base = { file: "other.ts", line: 50, severity: "major", class: "C1" };
    const raw = miniRaw("distinct", {
      route_a: [{ ...base, title: "first", reason: "r" }],
      route_b: [{ ...base, title: "second", reason: "r" }],
    });
    const result = runQueue(privateDir, raw, tempDir("home-distinct"));
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(queueItemCount(readQueue(privateDir))).toBe(2);
  });

  it("P3X1-J verdicts for ids that are not in the queue are ignored", () => {
    const privateDir = miniPrivate("extra-verdicts", plants);
    const claim = { file: "other.ts", line: 50, severity: "major", class: "C1", title: "t", reason: "r" };
    const raw = miniRaw("extra-verdicts", { route_a: [claim] });
    expect(runQueue(privateDir, raw, tempDir("home-extra-q")).status).toBe(0);
    const id = claimId("d1", claim);
    const dir = tempDir("judges-extra");
    const a = join(dir, "a.json");
    const b = join(dir, "b.json");
    writeFileSync(a, JSON.stringify({ [id]: "false-claim", "d1#C000000000000": "false-claim" }));
    writeFileSync(b, JSON.stringify({ [id]: "false-claim", "d1#Cffffffffffff": "real-defect" }));
    const result = tsx(
      ["model-guide/adjudicate.ts", "apply", "mg-mini", "--private", privateDir, "--judge-a", a, "--judge-b", b],
      tempDir("home-extra-a"),
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const verdicts = JSON.parse(
      readFileSync(join(privateDir, "sets", "mg-mini", "adjudication", "verdicts.json"), "utf8"),
    );
    expect(Object.keys(verdicts)).toEqual([id]);
    expect(verdicts[id]).toBe("false-claim");
  });

  it("P3X1-K a missing judge file leaves every finding unclear", () => {
    const privateDir = miniPrivate("missing-judge", plants);
    const claim = { file: "other.ts", line: 50, severity: "major", class: "C1", title: "t", reason: "r" };
    const raw = miniRaw("missing-judge", { route_a: [claim] });
    expect(runQueue(privateDir, raw, tempDir("home-missing-q")).status).toBe(0);
    const dir = tempDir("judges-missing");
    const a = join(dir, "a.json");
    writeFileSync(a, JSON.stringify({ [claimId("d1", claim)]: "false-claim" }));
    const result = tsx(
      [
        "model-guide/adjudicate.ts", "apply", "mg-mini", "--private", privateDir,
        "--judge-a", a, "--judge-b", join(dir, "absent.json"),
      ],
      tempDir("home-missing-a"),
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const verdicts = JSON.parse(
      readFileSync(join(privateDir, "sets", "mg-mini", "adjudication", "verdicts.json"), "utf8"),
    );
    expect(verdicts[claimId("d1", claim)]).toBe("unclear");
  });

  it("P3X1-L two equal verdicts outside the three kinds count as unclear", () => {
    const privateDir = miniPrivate("bogus", plants);
    const claim = { file: "other.ts", line: 50, severity: "major", class: "C1", title: "t", reason: "r" };
    const raw = miniRaw("bogus", { route_a: [claim] });
    expect(runQueue(privateDir, raw, tempDir("home-bogus-q")).status).toBe(0);
    const dir = tempDir("judges-bogus");
    const a = join(dir, "a.json");
    const b = join(dir, "b.json");
    writeFileSync(a, JSON.stringify({ [claimId("d1", claim)]: "plant:P1" }));
    writeFileSync(b, JSON.stringify({ [claimId("d1", claim)]: "plant:P1" }));
    const result = tsx(
      ["model-guide/adjudicate.ts", "apply", "mg-mini", "--private", privateDir, "--judge-a", a, "--judge-b", b],
      tempDir("home-bogus-a"),
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const verdicts = JSON.parse(
      readFileSync(join(privateDir, "sets", "mg-mini", "adjudication", "verdicts.json"), "utf8"),
    );
    expect(verdicts[claimId("d1", claim)]).toBe("unclear");
  });

  it("P3X2-1 findings with shuffled JSON key order are one claim", () => {
    // claimOf reads named fields, so the source order must not matter.
    const privateDir = miniPrivate("field-order", plants);
    const dir = tempDir("raw-field-order");
    const first = '{"file":"other.ts","line":50,"severity":"major","class":"C1","title":"t","reason":"r"}';
    const second = '{"reason":"r","title":"t","class":"C1","severity":"major","line":50,"file":"other.ts"}';
    mkdirSync(join(dir, "route_a"), { recursive: true });
    mkdirSync(join(dir, "route_b"), { recursive: true });
    writeFileSync(join(dir, "route_a", "d1.txt"), `\`\`\`json\n{"findings": [${first}]}\n\`\`\`\n`);
    writeFileSync(join(dir, "route_b", "d1.txt"), `\`\`\`json\n{"findings": [${second}]}\n\`\`\`\n`);
    const result = runQueue(privateDir, dir, tempDir("home-field-order"));
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(queueItemCount(readQueue(privateDir))).toBe(1);
  });

  it("P3X2-2 claims that differ only in Unicode normalization get two ids", () => {
    // NFC "caf\u00e9" and NFD "cafe\u0301" are different code points, so
    // the byte-exact claim tuple of spec D11 gives two ids.
    const privateDir = miniPrivate("nfc-nfd", plants);
    const base = { file: "other.ts", line: 50, severity: "major", class: "C1", reason: "r" };
    const raw = miniRaw("nfc-nfd", {
      route_a: [{ ...base, title: "caf\u00e9" }],
      route_b: [{ ...base, title: "cafe\u0301" }],
    });
    const result = runQueue(privateDir, raw, tempDir("home-nfc-nfd"));
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const queue = readQueue(privateDir);
    expect(queueItemCount(queue)).toBe(2);
    expect(queue.groups[0].items[0].id).not.toBe(queue.groups[0].items[1].id);
  });
});

describe("adversarial phase 3: set lint edges", () => {
  /** A writable copy of the synthetic D8 set. */
  function staged(tag: string): string {
    requireProduction();
    const dir = tempDir(`lint-${tag}`);
    mkdirSync(join(dir, "sets"), { recursive: true });
    cpSync(FIXTURE_SET, join(dir, "sets", "mg-2026-11a"), { recursive: true });
    return dir;
  }

  function runLint(privateDir: string, tag: string) {
    const setsDir = tempDir(`sets-${tag}`);
    return {
      result: tsx(
        [
          "model-guide/review-set.ts", "lint", "mg-2026-11a",
          "--private", privateDir, "--sets", setsDir, "--created", "2026-11-13",
        ],
        tempDir(`home-lint-${tag}`),
      ),
      setsDir,
    };
  }

  it("P3X1-2 a plant outside every hunk of its diff is refused", () => {
    // The plant at new_lines [9999, 9999] changes no `+` line of its diff
    // (spec D5), so FR-8 must refuse it instead of counting its weight in W.
    const privateDir = staged("outside");
    const keysDir = join(privateDir, "sets", "mg-2026-11a", "keys");
    const name = readdirSync(keysDir).filter((entry) => entry.endsWith(".json")).sort()[0];
    const keyPath = join(keysDir, name);
    const key = JSON.parse(readFileSync(keyPath, "utf8"));
    expect(key.plants.length).toBeGreaterThan(0);
    key.plants[0].new_lines = [9999, 9999];
    writeFileSync(keyPath, `${JSON.stringify(key, null, 2)}\n`);
    const { result } = runLint(privateDir, "outside");
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
  });

  it("P3X1-M a diff with CRLF line ends is refused with a hunk-header line", () => {
    // JS `.` never matches `\r`, so no CRLF body line parses and the
    // recomputed counts differ: fail-closed with the hunk-header check.
    const privateDir = staged("crlf");
    const diffsDir = join(privateDir, "sets", "mg-2026-11a", "diffs");
    const name = readdirSync(diffsDir).filter((entry) => entry.endsWith(".diff")).sort()[0];
    const diffPath = join(diffsDir, name);
    const crlf = readFileSync(diffPath, "utf8").split("\n").join("\r\n");
    writeFileSync(diffPath, crlf);
    const keyPath = join(privateDir, "sets", "mg-2026-11a", "keys", name.replace(/\.diff$/, ".json"));
    const key = JSON.parse(readFileSync(keyPath, "utf8"));
    key.seeded_diff_sha256 = createHash("sha256").update(readFileSync(diffPath)).digest("hex");
    writeFileSync(keyPath, `${JSON.stringify(key, null, 2)}\n`);
    const { result } = runLint(privateDir, "crlf");
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout).toContain("lint: hunk-header: ");
  });

  it("P3X1-N an empty seeded diff is refused with a hunk-header line", () => {
    const privateDir = staged("empty-diff");
    const diffsDir = join(privateDir, "sets", "mg-2026-11a", "diffs");
    const name = readdirSync(diffsDir).filter((entry) => entry.endsWith(".diff")).sort()[0];
    const diffPath = join(diffsDir, name);
    writeFileSync(diffPath, "");
    const keyPath = join(privateDir, "sets", "mg-2026-11a", "keys", name.replace(/\.diff$/, ".json"));
    const key = JSON.parse(readFileSync(keyPath, "utf8"));
    key.seeded_diff_sha256 = createHash("sha256").update("").digest("hex");
    writeFileSync(keyPath, `${JSON.stringify(key, null, 2)}\n`);
    const { result } = runLint(privateDir, "empty-diff");
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout).toContain("hunk-header");
  });

  /** Rewrite added lines as context lines in a temp copy, then fix the hunk
   * header old count and the key SHA-256. Returns nothing. */
  function toContext(privateDir: string, diffId: string, numbers: number[]): void {
    const diffPath = join(privateDir, "sets", "mg-2026-11a", "diffs", `${diffId}.diff`);
    const lines = readFileSync(diffPath, "utf8").split("\n");
    let converted = 0;
    const out = lines.map((line) => {
      const match = /^L(\d+)\s([-+ ])(.*)$/.exec(line);
      if (match !== null && match[2] === "+" && numbers.includes(Number(match[1]))) {
        converted += 1;
        return `L${match[1]}  ${match[3]}`;
      }
      return line;
    });
    expect(converted, "the diff holds the converted lines").toBe(numbers.length);
    out[0] = out[0].replace(/^(@@ -\d+),(\d+) /, (whole, start, count) => `${start},${Number(count) + converted} `);
    writeFileSync(diffPath, out.join("\n"));
    const keyPath = join(privateDir, "sets", "mg-2026-11a", "keys", `${diffId}.json`);
    const key = JSON.parse(readFileSync(keyPath, "utf8"));
    key.seeded_diff_sha256 = createHash("sha256").update(readFileSync(diffPath)).digest("hex");
    writeFileSync(keyPath, `${JSON.stringify(key, null, 2)}\n`);
  }

  function setPlant(privateDir: string, diffId: string, plantId: string, lines: [number, number]): void {
    const keyPath = join(privateDir, "sets", "mg-2026-11a", "keys", `${diffId}.json`);
    const key = JSON.parse(readFileSync(keyPath, "utf8"));
    for (const plant of key.plants) if (plant.id === plantId) plant.new_lines = lines;
    writeFileSync(keyPath, `${JSON.stringify(key, null, 2)}\n`);
  }

  it("P3X2-3 a plant that half overlaps added lines passes the lint", () => {
    // P4 at [43, 44] touches the added line 43; the context line 44 only
    // brackets the range, so holdsAddedLine accepts it.
    const privateDir = staged("half-overlap");
    toContext(privateDir, "mono-01", [44, 45, 46]);
    setPlant(privateDir, "mono-01", "P4", [43, 44]);
    const { result } = runLint(privateDir, "half-overlap");
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it("P3X2-4 a plant on context lines only is refused with a plant-line line", () => {
    const privateDir = staged("context-only");
    toContext(privateDir, "mono-01", [44, 45, 46]);
    setPlant(privateDir, "mono-01", "P4", [44, 45]);
    const { result } = runLint(privateDir, "context-only");
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout).toContain("lint: plant-line: mono-01 P4");
  });

  it("P3X2-5 a plant that spans a removed line is still refused", () => {
    // P1 at [19, 20] holds added lines on both sides, so the new
    // plant-line check passes it, but the removed line between them must
    // still fail the plant-removed-line check.
    const privateDir = staged("removed-span");
    setPlant(privateDir, "forge-01", "P1", [19, 20]);
    const { result } = runLint(privateDir, "removed-span");
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout).toContain("lint: plant-removed-line: forge-01 P1");
  });
});

describe("adversarial phase 3: leak-check boundaries", () => {
  it("P3X1-O a 20-character seeded line fails and a 19-character line passes", () => {
    const hit = seedPrivate("k4-hit", false);
    const { dir: repoHit, home: homeHit } = leakRepo("k4-hit");
    writeStaged(repoHit, homeHit, "note.txt", `x${hit.secret20} y\n`);
    const failed = runLeak(hit.dir, repoHit, homeHit);
    expect(failed.status, `${failed.stdout}\n${failed.stderr}`).toBe(2);
    expect(failed.stdout).toContain("seeded-line");

    const short = seedPrivate("k4-short", true);
    const { dir: repoShort, home: homeShort } = leakRepo("k4-short");
    writeStaged(repoShort, homeShort, "note.txt", `x ${"t".repeat(18)} y\n`);
    const passed = runLeak(short.dir, repoShort, homeShort);
    expect(passed.status, `${passed.stdout}\n${passed.stderr}`).toBe(0);
  });

  it("P3X1-P trailing whitespace and CRLF do not hide a seeded line", () => {
    const seed = seedPrivate("k4-ws", false);
    const { dir: repoDir, home } = leakRepo("k4-ws");
    writeStaged(repoDir, home, "padded.txt", `x${seed.secret20}   \n`);
    const padded = runLeak(seed.dir, repoDir, home);
    expect(padded.status, `${padded.stdout}\n${padded.stderr}`).toBe(2);
    const { dir: repoCrlf, home: homeCrlf } = leakRepo("k4-crlf");
    writeStaged(repoCrlf, homeCrlf, "crlf.txt", `x\r\n${seed.secret20}\r\n`);
    const crlf = runLeak(seed.dir, repoCrlf, homeCrlf);
    expect(crlf.status, `${crlf.stdout}\n${crlf.stderr}`).toBe(2);
  });

  it("P3X1-Q a seeded line split across two staged files is not one staged line", () => {
    // FR-10 fails a staged file that holds the line; neither half holds it.
    const seed = seedPrivate("k4-split", false);
    const { dir: repoDir, home } = leakRepo("k4-split");
    writeStaged(repoDir, home, "part-a.txt", `x ${"s".repeat(9)}`);
    writeStaged(repoDir, home, "part-b.txt", `${"s".repeat(10)} y\n`);
    const result = runLeak(seed.dir, repoDir, home);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it("P3X1-R a staged deletion exits 0", () => {
    const seed = seedPrivate("k4-delete", false);
    const { dir: repoDir, home } = leakRepo("k4-delete");
    writeStaged(repoDir, home, "gone.txt", "plain text\n");
    expect(
      spawnSync("git", ["commit", "-q", "-m", "add"], { cwd: repoDir, env: env(home), encoding: "utf8" }).status,
    ).toBe(0);
    expect(
      spawnSync("git", ["rm", "-q", "gone.txt"], { cwd: repoDir, env: env(home), encoding: "utf8" }).status,
    ).toBe(0);
    const result = runLeak(seed.dir, repoDir, home);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it("P3X1-S a key field nested twenty levels deep in JSON fails", () => {
    const seed = seedPrivate("k4-deep", false);
    const { dir: repoDir, home } = leakRepo("k4-deep");
    let inner: Record<string, unknown> = { witness: 1 };
    for (let depth = 0; depth < 20; depth += 1) inner = { level: inner };
    writeStaged(repoDir, home, "deep.json", JSON.stringify({ top: inner }));
    const result = runLeak(seed.dir, repoDir, home);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout).toContain("key-field");
    expect(result.stdout).toContain("witness");
  });

  it("P3X1-T a prose word never suppresses a key-field hit", () => {
    // Anti-pattern A7: no English-word filter may drop a real hit. The
    // key scan matches exact key names, so prose around them is harmless.
    const seed = seedPrivate("k4-a7", false);
    const { dir: repoDir, home } = leakRepo("k4-a7");
    writeStaged(repoDir, home, "note.json", '{"note": "this never happened, do not worry", "witness": "x"}');
    const result = runLeak(seed.dir, repoDir, home);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout).toContain("key-field");
  });
});

describe("adversarial phase 3: the score file through guide.ts", () => {
  it("P3X1-U a route with 3 passes, one of them invalid, keeps a complete rank", () => {
    const realWork = realWorkFrom("invalid-pass");
    const scoresDir = tempDir("scores-invalid-pass");
    const scoresFile = join(scoresDir, "review-scores.json");
    const pass = (date: string, score: number, extra: Record<string, unknown> = {}) => ({
      date, score, state: "complete", blocker_recall: 0.5, ...extra,
    });
    writeFileSync(
      scoresFile,
      JSON.stringify({
        set_id: "mg-2026-11a",
        routes: [
          {
            route: "r-invalid",
            state: "complete",
            passes: [pass("2026-11-18", 10.0), pass("2026-11-19", 12.0), pass("2026-11-20", 11.0, { invalid_reviews: 2 })],
          },
        ],
      }),
    );
    const out = tempDir("guide-invalid-pass");
    const result = tsx(
      [
        "model-guide/guide.ts",
        "--real-work", realWork,
        "--scores", scoresFile,
        "--print-audit", printAuditInput("invalid-pass"),
        "--benchmark", BENCHMARK,
        "--tracks", TRACKS,
        "--today", "2026-11-21",
        "--out", out,
      ],
      tempDir("home-invalid-pass"),
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const page = JSON.parse(readFileSync(join(out, "model-guide.json"), "utf8"));
    const row = page.rows.find((item: any) => item.kind === "Code review");
    expect(row, "the Code review row").toBeDefined();
    expect(row.pick).toBe("r-invalid");
  });
});

describe("adversarial phase 3 round 3: the gh output ceiling", () => {
  const PICK_TOOL = join(SOURCE, "pick-diffs.ts");
  const FAKES = join(FIXTURES, "fakes");
  const FORGE = "bodangren/advantage-forge";

  function runPick(tag: string, extra: Record<string, string> = {}, fakeDir?: string) {
    requireProduction();
    const home = tempDir(`home-pick-${tag}`);
    const log = join(tempDir(`log-pick-${tag}`), "gh.log");
    const privateDir = tempDir(`private-pick-${tag}`);
    const path = fakeDir ? `${fakeDir}:${FAKES}:${process.env.PATH ?? ""}` : `${FAKES}:${process.env.PATH ?? ""}`;
    const childEnv: Record<string, string | undefined> = {
      ...process.env, PATH: path, FAKE_GH_LOG: log,
      HOME: home, TZ: "UTC", NO_COLOR: "1", npm_config_loglevel: "silent", ...extra,
    };
    delete childEnv.BENCH_TRACK;
    const result = spawnSync(join(HARNESS, "node_modules", ".bin", "tsx"),
      ["model-guide/pick-diffs.ts", "--repo", FORGE, "--set", "mg-2026-11a", "--private", privateDir],
      { cwd: HARNESS, env: childEnv as NodeJS.ProcessEnv, encoding: "utf8", timeout: 60_000 });
    return { result, privateDir, candidateFile: join(privateDir, "candidates", "bodangren__advantage-forge.json") };
  }

  /** A temp `gh` that answers the list call and fails or truncates after it. */
  function failingFake(tag: string, mode: "detail-fails" | "truncated-list"): string {
    const dir = tempDir(`fake-gh-${tag}`);
    const SHAA = "a".repeat(40);
    const SHAB = "b".repeat(40);
    const list = [
      { sha: SHAA, parents: [{ sha: "c".repeat(40) }], commit: { committer: { date: "2026-09-01T00:00:00Z" } } },
      { sha: SHAB, parents: [{ sha: "d".repeat(40) }], commit: { committer: { date: "2026-09-02T00:00:00Z" } } },
    ];
    const detail = { files: [{ filename: "src/a.ts", additions: 30, deletions: 10, patch: "@@ x @@\n+a\n" }] };
    writeFileSync(join(dir, "gh"), `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.FAKE_GH_LOG, process.argv.slice(2).join(" ") + "\\n");
const path = process.argv[5];
const mode = ${JSON.stringify(mode)};
if (mode === "truncated-list") { process.stdout.write('{"incomplete": true'); process.exit(0); }
if (/\\/commits$/.test(path)) { process.stdout.write(JSON.stringify(${JSON.stringify(list)})); process.exit(0); }
if (path.endsWith("/commits/${SHAA}")) { process.stdout.write(JSON.stringify(${JSON.stringify(detail)})); process.exit(0); }
process.stderr.write("fake gh: failing detail\\n");
process.exit(1);
`);
    chmodSync(join(dir, "gh"), 0o755);
    return dir;
  }

  it("P3X3-1 a commits list over 64 MiB fails closed with no candidates file", () => {
    // 72 MB of trailing pad exceeds GH_MAX_BUFFER (64 MiB), so the spawn
    // errors and the tool must refuse before writing anything.
    const { result, candidateFile } = runPick("over-ceiling", { FAKE_GH_LIST_PAD: "72000000" });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout).toContain("pick-diffs: gh api failed");
    expect(existsSync(candidateFile), "no partial candidates file").toBe(false);
  });

  it("P3X3-2 a detail call that fails mid-run fails closed with no candidates file", () => {
    const { result, candidateFile } = runPick("detail-fails", {}, failingFake("detail-fails", "detail-fails"));
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout).toContain("pick-diffs: gh api failed");
    expect(existsSync(candidateFile), "no partial candidates file").toBe(false);
  });

  it("P3X3-3 a list with a truncated JSON tail is refused with no candidates file", () => {
    const { result, candidateFile } = runPick("truncated-list", {}, failingFake("truncated-list", "truncated-list"));
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout).toContain("pick-diffs: gh api gave no JSON");
    expect(existsSync(candidateFile), "no partial candidates file").toBe(false);
  });
});
