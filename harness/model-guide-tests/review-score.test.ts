import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Red tests for plan task 3.3: the scorer (spec D10, D11, D13, FR-9).
 * They start `harness/model-guide/review-score.ts` as a subprocess on a copy
 * of the synthetic set of task 3.2 and the raw outputs under
 * `fixtures/review/outputs/`. No test reads the network, the real home, the
 * real private folder, or a real repository.
 *
 * Pinned command-line interface:
 *   cd harness && npx tsx model-guide/review-score.ts score \
 *     --private <dir> --set <set_id> --route <route> --pass <n> \
 *     --date <YYYY-MM-DD> --outputs <dir> --scores <dir> [--verdicts <file>]
 *
 * `--private`, `--set`, `--route`, `--pass`, `--date`, `--outputs`, and
 * `--scores` are required and take a value that is not a flag token. A
 * missing value gives exit 2, no score file, and one line on stdout:
 * `score: <flag> needs a value`. `--scores` is the public folder; it
 * defaults to `harness/model-guide/data/review-scores` but every test passes
 * a temp folder.
 *
 * `--outputs` holds one file for each diff of the set: `<diff_id>.txt`. The
 * text holds one fenced JSON block `{"findings": [...]}` (spec D10). A
 * missing file is an invalid review of that diff.
 *
 * `--verdicts` is a JSON object that maps a finding id to one agreed verdict
 * of the two judges of spec D11: `<diff_id>#F<n>` (n is 1-based, before the
 * 30-finding cap) to `real-defect`, `false-claim`, or `unclear`. No entry is
 * neutral and not a false claim.
 *
 * The pass covers the whole set (spec D13). It reads every key of the set
 * and every output file. A finding matches a plant when the file is equal,
 * the line is in `new_lines[0] - 3` to `new_lines[1] + 3`, and the class is
 * in `accepted_classes`. One finding matches at most one plant; a finding
 * that fits two plants matches the nearer plant range. A plant is found when
 * one finding or more matches it; a second finding on a found plant is a
 * duplicate and is neutral. A finding that matches no plant is neutral
 * before the verdict check (spec D10):
 *   - `false-claim` adds 1 to `false_claims`.
 *   - `real-defect` adds 1 to `real_defects` and is neutral.
 *   - `unclear` marks the pass `provisional` and is neutral.
 * The first 30 findings of a diff count; finding 31 and later are ignored.
 * A diff whose text holds no JSON block, holds invalid JSON, or holds a
 * finding without `file` or `line` is an invalid review: it adds 1 to
 * `invalid_reviews`, and it has 0 found, 0 false claims, and no verdict.
 *
 * Weights (spec D6): blocker 5, major 2, minor 1. With `W` the weight sum of
 * every plant of the set, `F` the weight sum of the found plants, and `X`
 * the false claims, the score is `max(0, 100 × F / W − 2 × X)`, rounded to
 * one decimal. `blocker_recall` is `blockers_found / blockers`, rounded to
 * 4 decimals.
 *
 * The score file `<scores>/<set_id>.json` holds exactly `set_id`, `passes`,
 * and `routes`. A pass record is replaced when the same route and pass run
 * again. A pass record holds exactly:
 *   route, pass, date, state, score, weight, found_weight, found, missed,
 *   false_claims, blockers, blockers_found, blocker_recall, invalid_reviews,
 *   real_defects, by_class, by_severity
 * `state` is `complete` or `provisional` (at least one unclear verdict).
 * `by_class` holds C1 to C9, and `by_severity` holds blocker, major, minor;
 * each value holds `found` and `missed`.
 *
 * A route record holds exactly:
 *   route, state, passes, worst, median, best, worst_blocker_recall, rank
 * `state` is `complete` when the route has 3 or more pass records (a
 * provisional pass is complete) and `incomplete` otherwise. `worst` is the
 * lowest score, `best` the highest, `median` the middle score, and
 * `worst_blocker_recall` the lowest blocker recall of the route's passes.
 * `rank` is 1-based over the complete routes, sorted by the higher `worst`,
 * then the higher `worst_blocker_recall`, then the higher `median`; an
 * incomplete route has `rank: null` and comes after every ranked route.
 * The score file holds no `new_lines`, `witness`, `operator`, `file`, `line`,
 * `title`, or `reason` key at any depth, no path, and no finding text.
 *
 * Fixtures: `fixtures/review/sets/mg-2026-11a/` holds 48 plants; `W` is 132
 * (16 blockers, 20 majors, 12 minors). `forge-01` has P1 [10, 15] class C1
 * (accepted C1 and C5), P2 [18, 19] class C2 (accepted C2 and C1), P3
 * [30, 31] class C3, P4 [48, 49] class C4. The outputs of task 3.2 name
 * that diff.
 */

const HARNESS = resolve(import.meta.dirname, "..");
const TOOL = join(HARNESS, "model-guide", "review-score.ts");
const FIXTURE_SET = join(import.meta.dirname, "fixtures", "review", "sets", "mg-2026-11a");
const FIXTURE_OUTPUTS = join(import.meta.dirname, "fixtures", "review", "outputs");
const SET = "mg-2026-11a";
const EMPTY = "```json\n{\"findings\": []}\n```\n";
const DIFF_IDS = [
  "forge-01", "forge-02", "forge-03", "forge-04", "forge-05", "forge-06", "forge-c1",
  "mono-01", "mono-02", "mono-03", "mono-04", "mono-05", "mono-06", "mono-c1",
];
const PASS_KEYS = [
  "blocker_recall", "blockers", "blockers_found", "by_class", "by_severity",
  "date", "false_claims", "found", "found_weight", "invalid_reviews", "missed",
  "pass", "real_defects", "route", "score", "state", "weight",
];
const ROUTE_KEYS = [
  "best", "median", "passes", "rank", "route", "state", "worst", "worst_blocker_recall",
];
const FORBIDDEN = ["new_lines", "witness", "operator", "file", "line", "title", "reason"];

interface Finding {
  file: string;
  line: number;
  severity: string;
  class: string;
  title: string;
  reason: string;
}

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `model-guide-review-score-${tag}-`));
  roots.push(dir);
  return dir;
}

function requireProduction(): void {
  if (!existsSync(TOOL)) {
    throw new Error(
      `production file is missing: ${TOOL} (Phase 2 has no review-score tool)`,
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

let shared: string | undefined;

/** One read-only copy of the fixture set for every test. */
function privateDir(): string {
  requireProduction();
  if (!shared) {
    const root = tempDir("private");
    mkdirSync(join(root, "sets"), { recursive: true });
    cpSync(FIXTURE_SET, join(root, "sets", SET), { recursive: true });
    shared = root;
  }
  return shared;
}

function readKey(diffId: string): any {
  return JSON.parse(readFileSync(join(FIXTURE_SET, "keys", `${diffId}.json`), "utf8"));
}

function totalWeight(): number {
  const weight: Record<string, number> = { blocker: 5, major: 2, minor: 1 };
  let sum = 0;
  for (const diffId of DIFF_IDS) {
    for (const plant of readKey(diffId).plants) sum += weight[plant.severity];
  }
  return sum;
}

function expectedScore(foundWeight: number, falseClaims: number): number {
  const raw = (100 * foundWeight) / totalWeight() - 2 * falseClaims;
  return Math.max(0, Math.round(raw * 10) / 10);
}

type Outputs = Record<string, string | Finding[]>;

function fenced(findings: Finding[]): string {
  return "```json\n" + JSON.stringify({ findings }, null, 2) + "\n```\n";
}

/** Build an outputs folder: a file for every diff, empty unless overridden.
 * A string value names a fixture output; an array is a finding list. */
function buildOutputs(tag: string, overrides: Outputs = {}): string {
  const dir = tempDir(`outputs-${tag}`);
  for (const diffId of DIFF_IDS) {
    const value = overrides[diffId];
    const text = value === undefined
      ? EMPTY
      : typeof value === "string"
        ? readFileSync(join(FIXTURE_OUTPUTS, `${value}.txt`), "utf8")
        : fenced(value);
    writeFileSync(join(dir, `${diffId}.txt`), text);
  }
  return dir;
}

function runScore(
  scoresDir: string,
  outputsDir: string,
  opts: { route: string; pass: number; date?: string; verdicts?: Record<string, string>; privateDir?: string },
) {
  requireProduction();
  const args = [
    "model-guide/review-score.ts", "score",
    "--private", opts.privateDir ?? privateDir(),
    "--set", SET,
    "--route", opts.route,
    "--pass", String(opts.pass),
    "--date", opts.date ?? "2026-11-20",
    "--outputs", outputsDir,
    "--scores", scoresDir,
  ];
  if (opts.verdicts) {
    const file = join(tempDir(`verdicts-${opts.route.replace(/\W+/g, "-")}-${opts.pass}`), "verdicts.json");
    writeFileSync(file, JSON.stringify(opts.verdicts));
    args.push("--verdicts", file);
  }
  return spawnSync(join(HARNESS, "node_modules", ".bin", "tsx"), args, {
    cwd: HARNESS,
    env: env(tempDir("home")),
    encoding: "utf8",
    timeout: 60_000,
  });
}

function readScore(scoresDir: string): any {
  return JSON.parse(readFileSync(join(scoresDir, `${SET}.json`), "utf8"));
}

interface PassRun {
  route: string;
  pass: number;
  outputs: Outputs;
  verdicts?: Record<string, string>;
}

/** Run one score command and return its pass record. */
function scorePass(tag: string, run: PassRun): any {
  const scoresDir = tempDir(`scores-${tag}`);
  const outputsDir = buildOutputs(tag, run.outputs);
  const result = runScore(scoresDir, outputsDir, run);
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const record = readScore(scoresDir).passes.find(
    (entry: any) => entry.route === run.route && entry.pass === run.pass,
  );
  expect(record, `the score file holds ${run.route} pass ${run.pass}`).toBeTruthy();
  return record;
}

/** Run several score commands into one score file. */
function scoreMany(tag: string, runs: PassRun[]): any {
  const scoresDir = tempDir(`scores-${tag}`);
  for (const run of runs) {
    const outputsDir = buildOutputs(`${tag}-${run.route.replace(/\W+/g, "-")}-${run.pass}`, run.outputs);
    const result = runScore(scoresDir, outputsDir, run);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  }
  return readScore(scoresDir);
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

/** A finding on a plant line, with the class and file of the key. */
function plantFinding(plant: any, line = plant.new_lines[0], cls = plant.class): Finding {
  return {
    file: plant.file,
    line,
    severity: plant.severity,
    class: cls,
    title: "defect",
    reason: "the call returns success",
  };
}

function firstPlant(predicate: (plant: any) => boolean, diffIds = DIFF_IDS): { diffId: string; plant: any } {
  for (const diffId of diffIds) {
    for (const plant of readKey(diffId).plants) {
      if (predicate(plant)) return { diffId, plant };
    }
  }
  throw new Error("the fixture has no such plant");
}

const FORGE01 = readKey("forge-01");
const P1 = FORGE01.plants[0];
const P2 = FORGE01.plants[1];
const P3 = FORGE01.plants[2];
const P4 = FORGE01.plants[3];

describe("R1 the match", () => {
  it("R1 matches a finding in the window and counts the plant weight once", () => {
    const record = scorePass("match", { route: "route/a", pass: 1, outputs: { "forge-01": "match-01" } });
    expect(Object.keys(record).sort()).toEqual(PASS_KEYS);
    expect(record.state).toBe("complete");
    expect(record.score).toBe(3.8);
    expect(record.weight).toBe(132);
    expect(record.found_weight).toBe(5);
    expect(record.found).toBe(1);
    expect(record.missed).toBe(47);
    expect(record.false_claims).toBe(0);
    expect(record.by_class.C1).toEqual({ found: 1, missed: 5 });
    expect(record.by_severity.blocker).toEqual({ found: 1, missed: 15 });
  });

  it("R1 accepts an alternate class of accepted_classes", () => {
    const record = scorePass("alt", { route: "route/a", pass: 1, outputs: { "forge-01": "accepted-alt" } });
    expect(record.found).toBe(1);
    expect(record.found_weight).toBe(5);
    expect(record.by_class.C1.found).toBe(1);
  });

  it("R1 treats a second finding on a found plant as a duplicate", () => {
    const record = scorePass("duplicate", { route: "route/a", pass: 1, outputs: { "forge-01": "duplicate" } });
    expect(record.found).toBe(1);
    expect(record.found_weight).toBe(5);
    expect(record.false_claims).toBe(0);
    expect(record.score).toBe(3.8);
  });

  it("R1 ignores finding 31 and later", () => {
    const record = scorePass("many", { route: "route/a", pass: 1, outputs: { "forge-01": "many-33" } });
    expect(record.found).toBe(1);
    expect(record.found_weight).toBe(5);
    expect(record.by_class.C4).toEqual({ found: 0, missed: 5 });
    expect(record.by_class.C1.found).toBe(1);
  });
});

describe("R2 the window and the nearer plant", () => {
  it("R2 matches new_lines[0] - 3 and new_lines[1] + 3, and not one line further", () => {
    const lower = scorePass("lower", { route: "route/a", pass: 1, outputs: { "forge-01": "window-lower" } });
    expect(lower.by_class.C3).toEqual({ found: 1, missed: 5 });
    const upper = scorePass("upper", { route: "route/a", pass: 1, outputs: { "forge-01": "window-upper" } });
    expect(upper.by_class.C3).toEqual({ found: 1, missed: 5 });
    const outside = scorePass("outside", { route: "route/a", pass: 1, outputs: { "forge-01": "window-outside" } });
    expect(outside.found).toBe(0);
    expect(outside.found_weight).toBe(0);
  });

  it("R2 does not find a wrong class at the right line under a real-defect verdict", () => {
    const record = scorePass("wrong-class", {
      route: "route/a", pass: 1,
      outputs: { "forge-01": "wrong-class" },
      verdicts: { "forge-01#F1": "real-defect" },
    });
    expect(record.found).toBe(0);
    expect(record.found_weight).toBe(0);
    expect(record.real_defects).toBe(1);
    expect(record.false_claims).toBe(0);
  });

  it("R2 does not find a wrong line outside the window under a real-defect verdict", () => {
    const record = scorePass("wrong-line", {
      route: "route/a", pass: 1,
      outputs: { "forge-01": "wrong-line" },
      verdicts: { "forge-01#F1": "real-defect" },
    });
    expect(record.found).toBe(0);
    expect(record.real_defects).toBe(1);
  });

  it("R2 matches a finding between two plants to the nearer plant", () => {
    const record = scorePass("nearer", { route: "route/a", pass: 1, outputs: { "forge-01": "nearer-plant" } });
    expect(record.by_class.C1).toEqual({ found: 1, missed: 5 });
    expect(record.by_class.C2).toEqual({ found: 0, missed: 5 });
    expect(record.found).toBe(1);
  });

  it("R2 matches two findings between two plants to each plant", () => {
    const record = scorePass("between", { route: "route/a", pass: 1, outputs: { "forge-01": "between-two" } });
    expect(record.found).toBe(2);
    expect(record.found_weight).toBe(10);
    expect(record.by_class.C1.found).toBe(1);
    expect(record.by_class.C2.found).toBe(1);
  });
});

describe("R3 the score and the counts", () => {
  it("R3 applies max(0, 100 F / W - 2 X) and records the counts", () => {
    const findings = [plantFinding(P1), plantFinding(P2, P2.new_lines[0], "C1"), plantFinding(P3), plantFinding(P4)];
    findings.push({ file: P1.file, line: 60, severity: "major", class: "C2", title: "defect", reason: "the call returns success" });
    const record = scorePass("formula", {
      route: "route/a", pass: 1,
      outputs: { "forge-01": findings },
      verdicts: { "forge-01#F5": "false-claim" },
    });
    expect(record.found_weight).toBe(20);
    expect(record.false_claims).toBe(1);
    expect(record.score).toBe(13.2);
    expect(expectedScore(20, 1)).toBe(13.2);
    expect(record.found).toBe(4);
    expect(record.missed).toBe(44);
    expect(record.blockers).toBe(16);
    expect(record.blockers_found).toBe(4);
    expect(record.blocker_recall).toBe(0.25);
    expect(record.by_severity).toEqual({
      blocker: { found: 4, missed: 12 },
      major: { found: 0, missed: 20 },
      minor: { found: 0, missed: 12 },
    });
    expect(record.by_class.C4).toEqual({ found: 1, missed: 4 });
  });

  it("R3 makes a score below 0 become 0", () => {
    const record = scorePass("negative", {
      route: "route/a", pass: 1,
      outputs: { "forge-01": "unmatched" },
      verdicts: { "forge-01#F1": "false-claim", "forge-01#F2": "false-claim" },
    });
    expect(record.found_weight).toBe(0);
    expect(record.false_claims).toBe(2);
    expect(record.score).toBe(0);
  });
});

describe("R4 invalid reviews and pass states", () => {
  it("R4 makes an invalid review with 0 found and 0 false claims", () => {
    for (const name of ["no-block", "invalid-json", "no-line", "no-file"]) {
      const record = scorePass(`invalid-${name}`, { route: "route/a", pass: 1, outputs: { "forge-01": name } });
      expect(record.invalid_reviews, name).toBe(1);
      expect(record.found, name).toBe(0);
      expect(record.found_weight, name).toBe(0);
      expect(record.false_claims, name).toBe(0);
      expect(record.score, name).toBe(0);
    }
  });

  it("R4 marks an unclear verdict provisional and keeps the rank", () => {
    const doc = scoreMany("unclear", [
      { route: "route/a", pass: 1, outputs: { "forge-01": "match-01" } },
      { route: "route/a", pass: 2, outputs: { "forge-01": "unmatched" }, verdicts: { "forge-01#F1": "unclear" } },
      { route: "route/a", pass: 3, outputs: { "forge-01": "match-01" } },
    ]);
    const second = doc.passes.find((entry: any) => entry.route === "route/a" && entry.pass === 2);
    expect(second.state).toBe("provisional");
    expect(second.false_claims).toBe(0);
    const route = doc.routes.find((entry: any) => entry.route === "route/a");
    expect(route.state).toBe("complete");
    expect(route.rank).toBe(1);
    expect(route.passes).toBe(3);
  });

  it("R4 gives incomplete with fewer than 3 complete passes", () => {
    const doc = scoreMany("incomplete", [
      { route: "route/a", pass: 1, outputs: { "forge-01": "match-01" } },
      { route: "route/a", pass: 2, outputs: { "forge-01": "match-01" } },
    ]);
    const route = doc.routes.find((entry: any) => entry.route === "route/a");
    expect(route.state).toBe("incomplete");
    expect(route.rank).toBeNull();
    expect(route.passes).toBe(2);
  });
});

describe("R5 the rank", () => {
  it("R5 ranks by the worst pass", () => {
    const doc = scoreMany("worst", [
      { route: "route/a", pass: 1, outputs: { "forge-01": [plantFinding(P1)] } },
      { route: "route/a", pass: 2, outputs: { "forge-01": [plantFinding(P1), plantFinding(P2, P2.new_lines[0], "C1")] } },
      { route: "route/a", pass: 3, outputs: { "forge-01": [plantFinding(P1), plantFinding(P2, P2.new_lines[0], "C1"), plantFinding(P3)] } },
      { route: "route/b", pass: 1, outputs: {} },
      { route: "route/b", pass: 2, outputs: {} },
      { route: "route/b", pass: 3, outputs: {} },
    ]);
    const a = doc.routes.find((entry: any) => entry.route === "route/a");
    const b = doc.routes.find((entry: any) => entry.route === "route/b");
    expect(a.worst).toBe(expectedScore(5, 0));
    expect(a.median).toBe(expectedScore(10, 0));
    expect(a.best).toBe(expectedScore(15, 0));
    expect(a.rank).toBe(1);
    expect(b.worst).toBe(0);
    expect(b.rank).toBe(2);
  });

  it("R5 breaks a tie by the higher worst blocker recall", () => {
    const blocker = firstPlant((plant) => plant.severity === "blocker");
    const minors: { diffId: string; plant: any }[] = [];
    for (const diffId of DIFF_IDS) {
      for (const plant of readKey(diffId).plants) {
        if (plant.severity === "minor" && minors.length < 5) minors.push({ diffId, plant });
      }
    }
    expect(minors).toHaveLength(5);
    const minorFindings = (): Record<string, Finding[]> => {
      const map: Record<string, Finding[]> = {};
      for (const { diffId, plant } of minors) {
        map[diffId] = [...(map[diffId] ?? []), plantFinding(plant)];
      }
      return map;
    };
    const blockerOutput = { [blocker.diffId]: [plantFinding(blocker.plant)] };
    const doc = scoreMany("recall", [
      { route: "route/d", pass: 1, outputs: blockerOutput },
      { route: "route/d", pass: 2, outputs: blockerOutput },
      { route: "route/d", pass: 3, outputs: blockerOutput },
      { route: "route/e", pass: 1, outputs: minorFindings() },
      { route: "route/e", pass: 2, outputs: minorFindings() },
      { route: "route/e", pass: 3, outputs: minorFindings() },
    ]);
    const d = doc.routes.find((entry: any) => entry.route === "route/d");
    const e = doc.routes.find((entry: any) => entry.route === "route/e");
    expect(d.worst).toBe(e.worst);
    expect(d.worst).toBe(expectedScore(5, 0));
    expect(d.worst_blocker_recall).toBe(0.0625);
    expect(e.worst_blocker_recall).toBe(0);
    expect(d.rank).toBe(1);
    expect(e.rank).toBe(2);
  });

  it("R5 breaks a remaining tie by the higher median", () => {
    const doc = scoreMany("median", [
      { route: "route/b", pass: 1, outputs: {} },
      { route: "route/b", pass: 2, outputs: {} },
      { route: "route/b", pass: 3, outputs: {} },
      { route: "route/c", pass: 1, outputs: {} },
      { route: "route/c", pass: 2, outputs: { "forge-01": [plantFinding(P1)] } },
      { route: "route/c", pass: 3, outputs: { "forge-01": [plantFinding(P1), plantFinding(P2, P2.new_lines[0], "C1")] } },
    ]);
    const b = doc.routes.find((entry: any) => entry.route === "route/b");
    const c = doc.routes.find((entry: any) => entry.route === "route/c");
    expect(b.worst).toBe(0);
    expect(c.worst).toBe(0);
    expect(b.worst_blocker_recall).toBe(0);
    expect(c.worst_blocker_recall).toBe(0);
    expect(c.median).toBe(expectedScore(5, 0));
    expect(c.rank).toBe(1);
    expect(b.rank).toBe(2);
  });
});

describe("R6 the score file shape and the write flags", () => {
  it("R6 holds no secret field and no finding text", () => {
    const scoresDir = tempDir("scores-shape");
    const outputsDir = buildOutputs("shape", { "forge-01": "match-01" });
    const result = runScore(scoresDir, outputsDir, { route: "route/a", pass: 1 });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const doc = readScore(scoresDir);
    expect(Object.keys(doc).sort()).toEqual(["passes", "routes", "set_id"]);
    expect(Object.keys(doc.passes[0]).sort()).toEqual(PASS_KEYS);
    expect(Object.keys(doc.routes[0]).sort()).toEqual(ROUTE_KEYS);
    const names = keyNames(doc);
    for (const forbidden of FORBIDDEN) {
      expect(names, `the score file holds no ${forbidden} key`).not.toContain(forbidden);
    }
    for (const value of stringValues(doc)) {
      expect(value).not.toContain("src/");
      expect(value).not.toContain("returns success");
      expect(value).not.toContain("```");
    }
  });

  it("each missing value exits 2 with one named line and writes nothing", () => {
    requireProduction();
    const scoresDir = tempDir("scores-flags");
    const outputsDir = buildOutputs("flags");
    const result = spawnSync(
      join(HARNESS, "node_modules", ".bin", "tsx"),
      [
        "model-guide/review-score.ts", "score",
        "--set", SET, "--route", "route/a", "--pass", "1",
        "--date", "2026-11-20", "--outputs", outputsDir, "--scores", scoresDir,
        "--private",
      ],
      { cwd: HARNESS, env: env(tempDir("home-flags")), encoding: "utf8", timeout: 60_000 },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout.trim()).toBe("score: --private needs a value");
    expect(existsSync(join(scoresDir, `${SET}.json`))).toBe(false);
  });
});
