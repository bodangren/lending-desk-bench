import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Red tests for plan task 3.4: the adjudication queue and apply (spec D11,
 * FR-12). They start `harness/model-guide/adjudicate.ts` as a subprocess on
 * a copy of the synthetic set of task 3.2 and on raw outputs built from
 * `fixtures/review/outputs/`. No test reads the network, the real home, the
 * real private folder, or a real repository.
 *
 * Pinned command-line interface:
 *   cd harness && npx tsx model-guide/adjudicate.ts queue <set_id> \
 *     --private <dir> --raw <dir>
 *   cd harness && npx tsx model-guide/adjudicate.ts apply <set_id> \
 *     --private <dir> --judge-a <file> --judge-b <file>
 *
 * Each flag takes a value that is not a flag token. A missing value gives
 * exit 2, no output file, and one line on stdout:
 * `queue: <flag> needs a value` or `apply: <flag> needs a value`.
 *
 * `--raw` holds one folder for each route (the folder name is the route
 * slug), and one file for each diff of the set: `<raw>/<slug>/<diff_id>.txt`.
 * The queue never writes a route name and never reads the slug. A missing
 * file contributes no finding.
 *
 * The queue reads the keys of the set and every raw output. It counts every
 * finding of an output in order, matched or not; a finding that matches a
 * plant of its key (same file, line in `new_lines[0] - 3` to
 * `new_lines[1] + 3`, class in `accepted_classes`) is not queued. A missing
 * or invalid block, or a finding without `file` or `line`, adds no item.
 *
 * The id of an item is route-blind and claim-keyed (spec D11, ruling
 * P3A1-1): `<diff_id>#C<12 hex>`, the first 12 hex characters of the
 * SHA-256 of
 * `JSON.stringify([diff_id, file, line, class, severity, title, reason])`
 * (the fixed order of the array, no spaces). Two routes that report the same
 * claim get one id; two different claims at the same output index get two
 * ids. The scorer of task 3.3 computes the same id and looks up the verdict.
 *
 * Two findings are the same claim when `diff_id`, `file`, `line`, `class`,
 * `severity`, `title`, and `reason` are equal. The queue keeps one item per
 * claim and drops the duplicates of the other routes (spec D11).
 *
 * The queue groups the items by `diff_id` and `file` and a 3-line window:
 * sorted by line, a line that is more than 2 above the group start opens a
 * new group. A group window is `[start, start + 2]`. A group holds the id of
 * each finding and its claim text; it holds no route and no verdict. The
 * queue writes `<private>/sets/<set_id>/adjudication/queue.json`:
 *   {
 *     "set_id": "<set_id>",
 *     "groups": [{
 *       "id": "<diff_id>#G<n>",
 *       "diff_id": "<diff_id>",
 *       "file": "<path>",
 *       "window": [<start>, <start + 2>],
 *       "items": [{
 *         "id": "<diff_id>#C<12 hex>",
 *         "line": <line>,
 *         "claim": {"class", "severity", "title", "reason"}
 *       }]
 *     }]
 *   }
 * Groups are sorted by diff id, then window start; items by line, then id.
 *
 * `apply` reads the queue and the two judge files. Each judge file is a flat
 * JSON object that maps a finding id to `real-defect`, `false-claim`, or
 * `unclear`. Only an equal verdict of both judges counts; a missing or
 * different verdict is `unclear` (the rule of two, spec D11). `apply` writes
 * `<private>/sets/<set_id>/adjudication/verdicts.json`, the flat map that
 * `review-score.ts --verdicts` reads:
 *   - `real-defect` is neutral and adds the finding to the key
 *     `real_defects` of its diff, with exactly `id`, `file`,
 *     `new_lines: [line, line]`, `class: "R"`, `severity`, and
 *     `source: "adjudication"` (spec D7, D11).
 *   - `false-claim` is a false claim when the scorer runs with the map.
 *   - `unclear` is neutral and marks the pass `provisional`.
 * `apply` also writes `<private>/sets/<set_id>/adjudication/real-defects.json`
 * for the PM hand-off:
 *   {"set_id", "real_defects": [{"id", "diff_id", "file", "line", "class",
 *    "severity", "title", "reason"}]}
 * `apply` never marks a plant found: a finding at a wrong line or with a
 * wrong class stays unmatched and can only become a real defect or a false
 * claim (the no-rescue rule, spec D10, D11).
 *
 * The fixture corpus is the one of task 3.2: `forge-01` has P1 [10, 15]
 * class C1, P2 [18, 19] class C2, P3 [30, 31] class C3, and P4 [48, 49]
 * class C4. A finding at line 60, 61, or 65 of `src/forge-01.ts` matches no
 * plant.
 */

const HARNESS = resolve(import.meta.dirname, "..");
const TOOL = join(HARNESS, "model-guide", "adjudicate.ts");
const SCORER = join(HARNESS, "model-guide", "review-score.ts");
const FIXTURE_SET = join(import.meta.dirname, "fixtures", "review", "sets", "mg-2026-11a");
const SET = "mg-2026-11a";
const EMPTY = "```json\n{\"findings\": []}\n```\n";
const DIFF_IDS = [
  "forge-01", "forge-02", "forge-03", "forge-04", "forge-05", "forge-06", "forge-c1",
  "mono-01", "mono-02", "mono-03", "mono-04", "mono-05", "mono-06", "mono-c1",
];
const FILE = "src/forge-01.ts";

interface Finding {
  file: string;
  line: number;
  severity: string;
  class: string;
  title: string;
  reason: string;
}

const A: Finding = { file: FILE, line: 60, severity: "major", class: "C2", title: "First claim", reason: "the call returns success" };
const B: Finding = { file: FILE, line: 61, severity: "major", class: "C2", title: "Second claim", reason: "the value is stale" };
const C: Finding = { file: FILE, line: 65, severity: "minor", class: "C6", title: "Third claim", reason: "the token is logged" };

/** The route-blind claim id of a finding (spec D11, ruling P3A1-1). */
function claimId(diffId: string, finding: Finding): string {
  const canonical = JSON.stringify([
    diffId,
    finding.file,
    finding.line,
    finding.class,
    finding.severity,
    finding.title,
    finding.reason,
  ]);
  return `${diffId}#C${createHash("sha256").update(canonical).digest("hex").slice(0, 12)}`;
}

const ID_A = claimId("forge-01", A);
const ID_B = claimId("forge-01", B);
const ID_C = claimId("forge-01", C);

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `model-guide-adjudicate-${tag}-`));
  roots.push(dir);
  return dir;
}

function requireProduction(): void {
  if (!existsSync(TOOL)) {
    throw new Error(
      `production file is missing: ${TOOL} (Phase 2 has no adjudicate tool)`,
    );
  }
}

function env(fakeHome: string) {
  const copy: Record<string, string | undefined> = {
    ...process.env,
    HOME: fakeHome,
    TZ: "UTC",
    NO_COLOR: "1",
    npm_config_loglevel: "silent",
  };
  delete copy.BENCH_TRACK;
  return copy as NodeJS.ProcessEnv;
}

/** A fresh writable copy of the fixture set. */
function staged(tag: string): string {
  const privateDir = tempDir(`private-${tag}`);
  mkdirSync(join(privateDir, "sets"), { recursive: true });
  cpSync(FIXTURE_SET, join(privateDir, "sets", SET), { recursive: true });
  return privateDir;
}

function fenced(findings: Finding[]): string {
  return "```json\n" + JSON.stringify({ findings }, null, 2) + "\n```\n";
}

/** Build `<raw>/<slug>/<diff_id>.txt`; a missing diff is empty. */
function buildRaw(tag: string, routes: Record<string, Record<string, Finding[] | string>>): string {
  const dir = tempDir(`raw-${tag}`);
  for (const [slug, outputs] of Object.entries(routes)) {
    mkdirSync(join(dir, slug), { recursive: true });
    for (const diffId of DIFF_IDS) {
      const value = outputs[diffId];
      const text = value === undefined ? EMPTY : typeof value === "string" ? value : fenced(value);
      writeFileSync(join(dir, slug, `${diffId}.txt`), text);
    }
  }
  return dir;
}

function queue(privateDir: string, rawDir: string) {
  requireProduction();
  return spawnSync(
    join(HARNESS, "node_modules", ".bin", "tsx"),
    ["model-guide/adjudicate.ts", "queue", SET, "--private", privateDir, "--raw", rawDir],
    { cwd: HARNESS, env: env(tempDir("home-queue")), encoding: "utf8", timeout: 60_000 },
  );
}

function apply(privateDir: string, judgeA: Record<string, string>, judgeB: Record<string, string>) {
  requireProduction();
  const dir = tempDir("judges");
  const a = join(dir, "judge-a.json");
  const b = join(dir, "judge-b.json");
  writeFileSync(a, JSON.stringify(judgeA));
  writeFileSync(b, JSON.stringify(judgeB));
  return spawnSync(
    join(HARNESS, "node_modules", ".bin", "tsx"),
    ["model-guide/adjudicate.ts", "apply", SET, "--private", privateDir, "--judge-a", a, "--judge-b", b],
    { cwd: HARNESS, env: env(tempDir("home-apply")), encoding: "utf8", timeout: 60_000 },
  );
}

function readJson(file: string): any {
  return JSON.parse(readFileSync(file, "utf8"));
}

function queueFile(privateDir: string): string {
  return join(privateDir, "sets", SET, "adjudication", "queue.json");
}

function verdictsFile(privateDir: string): string {
  return join(privateDir, "sets", SET, "adjudication", "verdicts.json");
}

function realDefectsFile(privateDir: string): string {
  return join(privateDir, "sets", SET, "adjudication", "real-defects.json");
}

function keyFile(privateDir: string, diffId = "forge-01"): string {
  return join(privateDir, "sets", SET, "keys", `${diffId}.json`);
}

function buildOutputs(tag: string, findings: Finding[]): string {
  const dir = tempDir(`outputs-${tag}`);
  for (const diffId of DIFF_IDS) {
    writeFileSync(join(dir, `${diffId}.txt`), diffId === "forge-01" ? fenced(findings) : EMPTY);
  }
  return dir;
}

/** Run the scorer of task 3.3 with an optional verdict map. */
function score(privateDir: string, tag: string, findings: Finding[], verdicts?: string): any {
  expect(existsSync(SCORER), `the scorer of task 3.3 is missing: ${SCORER}`).toBe(true);
  const scoresDir = tempDir(`scores-${tag}`);
  const outputsDir = buildOutputs(tag, findings);
  const args = [
    "model-guide/review-score.ts", "score",
    "--private", privateDir, "--set", SET, "--route", "route/a", "--pass", "1",
    "--date", "2026-11-20", "--outputs", outputsDir, "--scores", scoresDir,
  ];
  if (verdicts) args.push("--verdicts", verdicts);
  const result = spawnSync(join(HARNESS, "node_modules", ".bin", "tsx"), args, {
    cwd: HARNESS, env: env(tempDir("home-score")), encoding: "utf8", timeout: 60_000,
  });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  return readJson(join(scoresDir, `${SET}.json`)).passes[0];
}

function keyNames(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) keyNames(item, found);
  } else if (value !== null && typeof value === "object") {
    for (const [name, item] of Object.entries(value)) {
      found.push(name);
      keyNames(item, found);
    }
  }
  return found;
}

function stringValues(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string") found.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) stringValues(item, found);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) stringValues(item, found);
  }
  return found;
}

function items(queueDoc: any): any[] {
  return queueDoc.groups.flatMap((group: any) => group.items);
}

describe("J1 the queue units", () => {
  it("J1 writes one item per finding with its id and no route name", () => {
    const privateDir = staged("items");
    const raw = buildRaw("items", {
      route_a: { "forge-01": [A, B, C] },
      route_b: { "forge-01": [A, B, C] },
    });
    const result = queue(privateDir, raw);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const doc = readJson(queueFile(privateDir));
    expect(doc.set_id).toBe(SET);
    expect(items(doc).map((item) => item.id)).toEqual([ID_A, ID_B, ID_C]);
    expect(items(doc)).toHaveLength(3);
    expect(keyNames(doc)).not.toContain("route");
    for (const value of stringValues(doc)) {
      expect(value).not.toContain("route_a");
      expect(value).not.toContain("route_b");
    }
  });

  it("J1 groups by file and a 3-line window", () => {
    const privateDir = staged("groups");
    const raw = buildRaw("groups", { route_a: { "forge-01": [A, B, C] } });
    expect(queue(privateDir, raw).status).toBe(0);
    const doc = readJson(queueFile(privateDir));
    expect(doc.groups).toHaveLength(2);
    expect(doc.groups[0]).toMatchObject({
      id: "forge-01#G1",
      diff_id: "forge-01",
      file: FILE,
      window: [60, 62],
    });
    expect(doc.groups[0].items.map((item: any) => item.id)).toEqual([ID_A, ID_B]);
    expect(doc.groups[1]).toMatchObject({ id: "forge-01#G2", window: [65, 67] });
    expect(doc.groups[1].items.map((item: any) => item.id)).toEqual([ID_C]);
  });

  it("J1 leaves out a finding that matches a plant", () => {
    const privateDir = staged("matched");
    const plant = readJson(keyFile(privateDir)).plants[0];
    const match: Finding = { file: plant.file, line: plant.new_lines[0], severity: plant.severity, class: plant.class, title: "a real plant", reason: "the call is wrong" };
    const raw = buildRaw("matched", { route_a: { "forge-01": [match, A] } });
    expect(queue(privateDir, raw).status).toBe(0);
    const doc = readJson(queueFile(privateDir));
    expect(items(doc).map((item) => item.id)).toEqual([ID_A]);
  });

  it("J1 gives two routes with different claims at the same index two items", () => {
    const privateDir = staged("same-index");
    const raw = buildRaw("same-index", {
      route_a: { "forge-01": [A] },
      route_b: { "forge-01": [B] },
    });
    expect(queue(privateDir, raw).status).toBe(0);
    const doc = readJson(queueFile(privateDir));
    expect(items(doc).map((item) => item.id)).toEqual([ID_A, ID_B]);
    expect(new Set(items(doc).map((item) => item.id)).size).toBe(2);

    const judges = { [ID_A]: "real-defect", [ID_B]: "real-defect" };
    expect(apply(privateDir, judges, judges).status).toBe(0);
    expect(readJson(keyFile(privateDir)).real_defects.map((entry: any) => entry.id)).toEqual([
      ID_A,
      ID_B,
    ]);
  });

  it("J1 uses the route-blind claim id form", () => {
    const privateDir = staged("claim-id");
    const raw = buildRaw("claim-id", { route_a: { "forge-01": [A] } });
    expect(queue(privateDir, raw).status).toBe(0);
    const id = items(readJson(queueFile(privateDir)))[0].id;
    expect(id).toBe(ID_A);
    expect(id).toMatch(/^forge-01#C[0-9a-f]{12}$/);
  });

  it("J1 matches at new_lines[0] - 3 and new_lines[1] + 3 and not one line further", () => {
    const privateDir = staged("window");
    const lower: Finding = { file: FILE, line: 27, severity: "major", class: "C3", title: "lower edge", reason: "the value is stale" };
    const upper: Finding = { file: FILE, line: 34, severity: "major", class: "C3", title: "upper edge", reason: "the value is stale" };
    const outside: Finding = { file: FILE, line: 26, severity: "major", class: "C3", title: "one further", reason: "the value is stale" };
    const raw = buildRaw("window", { route_a: { "forge-01": [lower, upper, outside] } });
    expect(queue(privateDir, raw).status).toBe(0);
    const queued = items(readJson(queueFile(privateDir)));
    expect(queued).toHaveLength(1);
    expect(queued[0].line).toBe(26);
    expect(queued[0].id).toBe(claimId("forge-01", outside));
  });
});

describe("J2 the apply mapping", () => {
  it("J2 maps real-defect to neutral and to the key", () => {
    const privateDir = staged("real");
    const raw = buildRaw("real", { route_a: { "forge-01": [A] } });
    expect(queue(privateDir, raw).status).toBe(0);

    const baseline = score(privateDir, "real-base", [A]);
    expect(baseline.score).toBe(0);
    expect(baseline.false_claims).toBe(0);
    expect(baseline.real_defects).toBe(0);

    const judges = { [ID_A]: "real-defect" };
    const result = apply(privateDir, judges, judges);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(readJson(verdictsFile(privateDir))).toEqual({ [ID_A]: "real-defect" });

    const key = readJson(keyFile(privateDir));
    expect(key.real_defects).toEqual([
      {
        id: ID_A,
        file: FILE,
        new_lines: [60, 60],
        class: "R",
        severity: "major",
        source: "adjudication",
      },
    ]);
    const handoff = readJson(realDefectsFile(privateDir));
    expect(handoff.set_id).toBe(SET);
    expect(handoff.real_defects).toEqual([
      { id: ID_A, diff_id: "forge-01", file: FILE, line: 60, class: "C2", severity: "major", title: "First claim", reason: "the call returns success" },
    ]);

    const neutral = score(privateDir, "real-after", [A], verdictsFile(privateDir));
    expect(neutral.score).toBe(baseline.score);
    expect(neutral.false_claims).toBe(0);
    expect(neutral.real_defects).toBe(1);
  });

  it("J2 maps false-claim to a false claim", () => {
    const privateDir = staged("false");
    const raw = buildRaw("false", { route_a: { "forge-01": [A] } });
    expect(queue(privateDir, raw).status).toBe(0);
    const judges = { [ID_A]: "false-claim" };
    expect(apply(privateDir, judges, judges).status).toBe(0);
    expect(readJson(verdictsFile(privateDir))).toEqual({ [ID_A]: "false-claim" });
    expect(readJson(keyFile(privateDir)).real_defects).toEqual([]);

    const record = score(privateDir, "false-after", [A], verdictsFile(privateDir));
    expect(record.false_claims).toBe(1);
    expect(record.real_defects).toBe(0);
    expect(record.state).toBe("complete");
  });

  it("J2 maps unclear to provisional", () => {
    const privateDir = staged("unclear");
    const raw = buildRaw("unclear", { route_a: { "forge-01": [A] } });
    expect(queue(privateDir, raw).status).toBe(0);
    const judges = { [ID_A]: "unclear" };
    expect(apply(privateDir, judges, judges).status).toBe(0);
    expect(readJson(verdictsFile(privateDir))).toEqual({ [ID_A]: "unclear" });
    const record = score(privateDir, "unclear-after", [A], verdictsFile(privateDir));
    expect(record.state).toBe("provisional");
    expect(record.false_claims).toBe(0);
    expect(record.real_defects).toBe(0);
  });

  it("J2 treats a verdict the two judges do not share as unclear", () => {
    const privateDir = staged("disagree");
    const raw = buildRaw("disagree", { route_a: { "forge-01": [A] } });
    expect(queue(privateDir, raw).status).toBe(0);
    const result = apply(privateDir, { [ID_A]: "false-claim" }, { [ID_A]: "real-defect" });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(readJson(verdictsFile(privateDir))).toEqual({ [ID_A]: "unclear" });
    expect(readJson(keyFile(privateDir)).real_defects).toEqual([]);

    const record = score(privateDir, "disagree-after", [A], verdictsFile(privateDir));
    expect(record.false_claims).toBe(0);
    expect(record.real_defects).toBe(0);
    expect(record.state).toBe("provisional");
  });

  it("J2 keeps two different claims of one group as two items with their own verdict", () => {
    const privateDir = staged("group-claims");
    const raw = buildRaw("group-claims", { route_a: { "forge-01": [A, B] } });
    expect(queue(privateDir, raw).status).toBe(0);
    const doc = readJson(queueFile(privateDir));
    expect(doc.groups).toHaveLength(1);
    expect(doc.groups[0].items.map((item: any) => item.claim.title)).toEqual(["First claim", "Second claim"]);

    const result = apply(
      privateDir,
      { [ID_A]: "real-defect", [ID_B]: "false-claim" },
      { [ID_A]: "real-defect", [ID_B]: "false-claim" },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(readJson(verdictsFile(privateDir))).toEqual({
      [ID_A]: "real-defect",
      [ID_B]: "false-claim",
    });
    expect(readJson(keyFile(privateDir)).real_defects.map((entry: any) => entry.id)).toEqual([
      ID_A,
    ]);
  });

  it("J2 keeps one claim at different indices as one item and costs both routes the same", () => {
    const privateDir = staged("claim-indices");
    const plant = readJson(keyFile(privateDir)).plants[0];
    const match: Finding = {
      file: plant.file,
      line: plant.new_lines[0],
      severity: plant.severity,
      class: plant.class,
      title: "a real plant",
      reason: "the call is wrong",
    };
    const raw = buildRaw("claim-indices", {
      route_a: { "forge-01": [match, A] },
      route_b: { "forge-01": [A, match] },
    });
    expect(queue(privateDir, raw).status).toBe(0);
    const doc = readJson(queueFile(privateDir));
    expect(items(doc).map((item) => item.id)).toEqual([ID_A]);

    const judges = { [ID_A]: "false-claim" };
    expect(apply(privateDir, judges, judges).status).toBe(0);
    const first = score(privateDir, "indices-a", [match, A], verdictsFile(privateDir));
    const second = score(privateDir, "indices-b", [A, match], verdictsFile(privateDir));
    expect(first.found).toBe(1);
    expect(second.found).toBe(1);
    expect(first.false_claims).toBe(1);
    expect(second.false_claims).toBe(1);
    expect(first.score).toBe(1.8);
    expect(second.score).toBe(1.8);
  });
});

describe("J3 the blind queue", () => {
  it("J3 holds no route name and no verdict", () => {
    const privateDir = staged("blind");
    const raw = buildRaw("blind", {
      route_a: { "forge-01": [A, B, C] },
      route_b: { "forge-01": [A, B, C] },
    });
    expect(queue(privateDir, raw).status).toBe(0);
    const text = readFileSync(queueFile(privateDir), "utf8");
    const doc = JSON.parse(text);
    expect(text).not.toContain("route_a");
    expect(text).not.toContain("route_b");
    expect(keyNames(doc)).not.toContain("route");
    expect(keyNames(doc)).not.toContain("verdict");
    for (const value of stringValues(doc)) {
      expect(["real-defect", "false-claim", "unclear"]).not.toContain(value);
    }
  });
});

describe("J4 no rescue", () => {
  it("J4 never makes a wrong-line finding found through apply", () => {
    const privateDir = staged("wrong-line");
    const finding: Finding = { file: FILE, line: 90, severity: "major", class: "C1", title: "a claim", reason: "the call returns success" };
    const id = claimId("forge-01", finding);
    const raw = buildRaw("wrong-line", { route_a: { "forge-01": [finding] } });
    expect(queue(privateDir, raw).status).toBe(0);
    const judges = { [id]: "real-defect" };
    expect(apply(privateDir, judges, judges).status).toBe(0);
    const key = readJson(keyFile(privateDir));
    expect(key.real_defects.map((entry: any) => entry.id)).toEqual([id]);
    const record = score(privateDir, "wrong-line-after", [finding], verdictsFile(privateDir));
    expect(record.found).toBe(0);
    expect(record.real_defects).toBe(1);
  });

  it("J4 never makes a wrong-class finding found through apply", () => {
    const privateDir = staged("wrong-class");
    const finding: Finding = { file: FILE, line: 30, severity: "major", class: "C9", title: "a claim", reason: "the value is stale" };
    const id = claimId("forge-01", finding);
    const raw = buildRaw("wrong-class", { route_a: { "forge-01": [finding] } });
    expect(queue(privateDir, raw).status).toBe(0);
    const judges = { [id]: "real-defect" };
    expect(apply(privateDir, judges, judges).status).toBe(0);
    const record = score(privateDir, "wrong-class-after", [finding], verdictsFile(privateDir));
    expect(record.found).toBe(0);
    expect(record.real_defects).toBe(1);
  });

  it("J4 never counts a disagreement against the model", () => {
    const privateDir = staged("no-penalty");
    const raw = buildRaw("no-penalty", { route_a: { "forge-01": [A] } });
    expect(queue(privateDir, raw).status).toBe(0);
    expect(apply(privateDir, { [ID_A]: "false-claim" }, { [ID_A]: "unclear" }).status).toBe(0);
    const record = score(privateDir, "no-penalty-after", [A], verdictsFile(privateDir));
    expect(record.false_claims).toBe(0);
    expect(record.score).toBe(0);
    expect(record.state).toBe("provisional");
  });
});

describe("P3B1 the write targets and the set id", () => {
  it("P3B1-2 refuses a symlink at the queue target before any write", () => {
    const privateDir = staged("queue-symlink");
    const raw = buildRaw("queue-symlink", { route_a: { "forge-01": [A] } });
    const dir = join(privateDir, "sets", SET, "adjudication");
    mkdirSync(dir, { recursive: true });
    const target = join(dir, "queue.json");
    const outside = join(tempDir("outside"), "outside.json");
    writeFileSync(outside, "keep\n");
    symlinkSync(outside, target);
    const result = queue(privateDir, raw);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout.split("\n").map((item) => item.trim())).toContain(
      `queue: symlink: ${target}`,
    );
    expect(readFileSync(outside, "utf8")).toBe("keep\n");
  });

  it("P3B1-2 refuses a symlink at the verdicts target before any write", () => {
    const privateDir = staged("apply-symlink");
    const raw = buildRaw("apply-symlink", { route_a: { "forge-01": [A] } });
    expect(queue(privateDir, raw).status, "the queue is built first").toBe(0);
    const target = verdictsFile(privateDir);
    const outside = join(tempDir("outside-apply"), "outside.json");
    writeFileSync(outside, "keep\n");
    symlinkSync(outside, target);
    const judges = { [ID_A]: "real-defect" };
    const result = apply(privateDir, judges, judges);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout.split("\n").map((item) => item.trim())).toContain(
      `apply: symlink: ${target}`,
    );
    expect(readFileSync(outside, "utf8")).toBe("keep\n");
    expect(readJson(keyFile(privateDir)).real_defects).toEqual([]);
  });

  it("P3B1-5 refuses a set id that is not a plain name", () => {
    const privateDir = staged("bad-id");
    const raw = buildRaw("bad-id", { route_a: { "forge-01": [A] } });
    const result = spawnSync(
      join(HARNESS, "node_modules", ".bin", "tsx"),
      ["model-guide/adjudicate.ts", "queue", "../x", "--private", privateDir, "--raw", raw],
      { cwd: HARNESS, env: env(tempDir("home-bad-id")), encoding: "utf8", timeout: 60_000 },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout.trim()).toBe("queue: set-id: ../x");
    expect(existsSync(join(privateDir, "x", "adjudication", "queue.json"))).toBe(false);
  });
});

describe("the write flags", () => {
  it("each missing value exits 2 with one named line and writes nothing", () => {
    requireProduction();
    const privateDir = staged("flags");
    const raw = buildRaw("flags", { route_a: { "forge-01": [A] } });

    const missingRaw = spawnSync(
      join(HARNESS, "node_modules", ".bin", "tsx"),
      ["model-guide/adjudicate.ts", "queue", SET, "--private", privateDir, "--raw"],
      { cwd: HARNESS, env: env(tempDir("home-flags")), encoding: "utf8", timeout: 60_000 },
    );
    expect(missingRaw.status, `${missingRaw.stdout}\n${missingRaw.stderr}`).toBe(2);
    expect(missingRaw.stdout.trim()).toBe("queue: --raw needs a value");
    expect(existsSync(queueFile(privateDir))).toBe(false);

    expect(queue(privateDir, raw).status).toBe(0);
    const dir = tempDir("judges-flags");
    const judgeA = join(dir, "a.json");
    const judgeB = join(dir, "b.json");
    writeFileSync(judgeA, "{}");
    writeFileSync(judgeB, "{}");
    const missingJudge = spawnSync(
      join(HARNESS, "node_modules", ".bin", "tsx"),
      ["model-guide/adjudicate.ts", "apply", SET, "--private", privateDir, "--judge-b", judgeB, "--judge-a"],
      { cwd: HARNESS, env: env(tempDir("home-flags-2")), encoding: "utf8", timeout: 60_000 },
    );
    expect(missingJudge.status, `${missingJudge.stdout}\n${missingJudge.stderr}`).toBe(2);
    expect(missingJudge.stdout.trim()).toBe("apply: --judge-a needs a value");
    expect(existsSync(verdictsFile(privateDir))).toBe(false);
  });
});
