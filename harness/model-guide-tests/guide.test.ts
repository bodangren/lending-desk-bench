import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Red tests for plan task 2.2: the overview table of spec D18, D19 (the
 * stale mark), FR-6, and acceptance 7. They call the planned tool
 * `harness/model-guide/guide.ts`.
 *
 * Pinned command-line interface:
 *   cd harness && npx tsx model-guide/guide.ts \
 *     --real-work <real-work.json> --scores <review-scores.json> \
 *     --print-audit <print-audit-2026-11.json> \
 *     --benchmark <benchmark.json> --tracks <tracks.json> \
 *     --today <YYYY-MM-DD> --out <folder>
 * Exit 0 writes `<folder>/model-guide.json`.
 * `--scores` may be absent or may point at a missing file. Both mean
 * "no track A rank" and give exit 0, because the preview must render
 * before Phase 4. The other flags are required.
 *
 * Pinned output file `model-guide.json` (row order and field names are the
 * public data contract of the strategy, section 5):
 *   schema        "model-guide-overview/1"
 *   today         the `--today` value
 *   stale         true when the newest evidence_date is more than 14 days
 *                 before `today`, else false
 *   rows          six rows in the spec D18 order, each with exactly the
 *                 fields kind, pick, second, evidence, evidence_date,
 *                 base_line
 * The kind values, in order: "Code review", "app code", "test writing",
 * "docs and ops", "print-book audit", "tooling".
 *   pick          the model of the first qualified source, or the exact
 *                 words "no pick yet: not enough evidence" when neither
 *                 source has a qualified model
 *   second        the second choice model, or null when the rank has no
 *                 second qualified model
 *   evidence      "<source>: <number> (n=<count>)". The source prefix is
 *                 "page B", "track A", or "print-audit" (spec D18 example:
 *                 "page B: pass 0.86 (n=114)"). Page B numbers are the
 *                 pass rate with 2 decimals; the track A number is the
 *                 worst pass score with 1 decimal; the print-audit number
 *                 is the "x of y" route result with (n=<y>).
 *   evidence_date the export `generated_on`, or the date of the last
 *                 complete track A pass for the track A pick (spec D18)
 *   base_line     null, except the highest build total of `--benchmark`
 *                 on the app code row and the highest tests total of
 *                 `--tracks` on the test writing row. The base line shows
 *                 beside the pick and never changes it (spec D18).
 *
 * Pick rule (spec D18): the first source gives the first and second choice
 * from its rank. A page B row qualifies with 10 runs or more (10 results
 * for a work-type row); a track A route qualifies with a complete state and
 * 3 complete passes. When the first source has no qualified model the
 * second source picks. Sources per row: Code review = track A rank, then
 * page B checker table; app code = work type `app code`, then the build
 * base line; test writing = producer table, then the tests base line; docs
 * and ops = work type `docs and ops`, then none; print-book audit = work
 * type `print books`, then the print-audit data point; tooling = work type
 * `tooling`, then none. The base line itself never picks.
 *
 * Spec D18 names the test writing source "page B producer table, role red".
 * The page B data file `real-work.json` has no role key (Phase 1 contract),
 * so this test proves the producer table as the source and does not pin the
 * role filter. The Red report and the handoff to Green name that open
 * decision. This test also does not pin the code review row when track A
 * has no complete route: spec D18 lets the page B checker table pick there,
 * while the strategy closeout gate wants "no pick yet" until Phase 4. The
 * handoff names that conflict for the orchestrator.
 *
 * Stale rule (spec D19): the mark uses the newest evidence_date of the
 * table against `--today`. The tool takes `--today`, so the verdict does
 * not move with the wall clock (anti-pattern A11).
 *
 * Fixtures, all synthetic: `fixtures/real-work-mini.json` (the export, run
 * through the Phase 1 tool `real-work.ts`), `fixtures/print-audit/`
 * (assembled into the print-audit data shape that task 2.1 pinned), and
 * `fixtures/guide/` (`review-scores-mini.json` follows spec D13 with two
 * complete routes and one incomplete route that holds the best worst
 * score; `benchmark-mini.json` and `tracks-mini.json` hold the build and
 * tests base lines). No test reads the real export, the real hand-off file,
 * the real docs/, a model, the network, or the private folder.
 */

const HARNESS = resolve(import.meta.dirname, "..");
const SOURCE = join(HARNESS, "model-guide");
const TOOL = join(SOURCE, "guide.ts");
const REAL_WORK_TOOL = join(SOURCE, "real-work.ts");
const PREVIEW_SH = join(SOURCE, "preview.sh");
const TSX = join(HARNESS, "node_modules", ".bin", "tsx");
const FIXTURES = join(import.meta.dirname, "fixtures");
const EXPORT_FIXTURE = join(FIXTURES, "real-work-mini.json");
const PRINT_AUDIT_DIR = join(FIXTURES, "print-audit");
const GUIDE_FIXTURES = join(FIXTURES, "guide");
const SCORES = join(GUIDE_FIXTURES, "review-scores-mini.json");
const BENCHMARK = join(GUIDE_FIXTURES, "benchmark-mini.json");
const TRACKS = join(GUIDE_FIXTURES, "tracks-mini.json");

const OUT_NAME = "model-guide.json";
const SCHEMA = "model-guide-overview/1";
const NO_PICK = "no pick yet: not enough evidence";
const TODAY = "2026-11-14";
const KINDS = [
  "Code review",
  "app code",
  "test writing",
  "docs and ops",
  "print-book audit",
  "tooling",
];
const ROOT_KEYS = ["rows", "schema", "stale", "today"].sort();
const ROW_KEYS = ["base_line", "evidence", "evidence_date", "kind", "pick", "second"].sort();
const EVIDENCE_RE = /^(page B|track A|print-audit): .+ \(n=\d+\)$/;
const HOSTILE_ROUTE = 'y/"><img src=x onerror=alert(1)>';
const HOSTILE_RAW = "<img src=x onerror=alert(1)>";

/** Python `html.escape(s)`, the escape the pages use. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `model-guide-guide-${tag}-`));
  roots.push(dir);
  return dir;
}

function requireProduction(): void {
  if (!existsSync(TOOL)) {
    throw new Error(
      `production file is missing: ${TOOL} (Phase 1 has no overview tool)`,
    );
  }
  if (!existsSync(REAL_WORK_TOOL)) throw new Error(`missing: ${REAL_WORK_TOOL}`);
  if (!existsSync(PREVIEW_SH)) throw new Error(`missing: ${PREVIEW_SH}`);
}

function env(): NodeJS.ProcessEnv {
  const copy = { ...process.env, NO_COLOR: "1", npm_config_loglevel: "silent" };
  delete copy.BENCH_TRACK;
  return copy;
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function manifestShaOf(file: string): string {
  const match = readFileSync(file, "utf8").match(/^sha256: ([0-9a-f]{64})$/m);
  if (!match) throw new Error(`no sha256 line in ${file}`);
  return match[1];
}

/** The export copy with a mutation and a manifest that matches the copy. */
function stagedExport(tag: string, mutate: (doc: any) => void): string {
  const dir = tempDir(`export-${tag}`);
  const doc = JSON.parse(readFileSync(EXPORT_FIXTURE, "utf8"));
  mutate(doc);
  const json = join(dir, "real-work-mini.json");
  const text = JSON.stringify(doc);
  writeFileSync(json, text);
  writeFileSync(join(dir, "MANIFEST.txt"), [
    `sha256: ${sha256(json)}`,
    `size: ${Buffer.byteLength(text)}`,
    "source-commit: none (synthetic fixture, 2026-11-15)",
    "",
  ].join("\n"));
  return json;
}

/** Run the Phase 1 tool on an export and return the data file path. */
function realWorkFrom(exportPath: string, tag: string): { json: string; data: any } {
  const out = tempDir(`real-work-${tag}`);
  const result = spawnSync(
    TSX,
    ["model-guide/real-work.ts", "--input", exportPath, "--out", out],
    { cwd: HARNESS, env: env(), encoding: "utf8", timeout: 60_000 },
  );
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const json = join(out, "real-work.json");
  expect(existsSync(json), `missing ${json}`).toBe(true);
  return { json, data: JSON.parse(readFileSync(json, "utf8")) };
}

/** The print-audit data file of task 2.1, assembled from the synthetic
 * hand-off fixture: route results as "x of y" strings, no book content. */
function printAuditInput(tag: string): string {
  const handoff = JSON.parse(
    readFileSync(join(PRINT_AUDIT_DIR, "print-audit-mini.json"), "utf8"),
  );
  const dir = tempDir(`print-audit-${tag}`);
  const routes: Record<string, string> = {};
  for (const [name, value] of Object.entries<any>(handoff.routes)) {
    routes[name] = `${value.blockers_resolved} of ${value.blockers_total}`;
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

interface GuideRun {
  status: number;
  stdout: string;
  stderr: string;
  data: any;
}

function runGuide(opts: {
  tag: string;
  realWork: string;
  scores?: string | null;
  printAudit: string;
  benchmark: string;
  tracks: string;
  today: string;
}): GuideRun {
  requireProduction();
  const out = tempDir(`out-${opts.tag}`);
  const args = [
    "model-guide/guide.ts",
    "--real-work", opts.realWork,
    "--print-audit", opts.printAudit,
    "--benchmark", opts.benchmark,
    "--tracks", opts.tracks,
    "--today", opts.today,
    "--out", out,
  ];
  if (opts.scores !== null && opts.scores !== undefined) {
    args.push("--scores", opts.scores);
  }
  const result = spawnSync(TSX, args, {
    cwd: HARNESS, env: env(), encoding: "utf8", timeout: 60_000,
  });
  const file = join(out, OUT_NAME);
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  expect(existsSync(file), `missing output file: ${file}`).toBe(true);
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    data: JSON.parse(readFileSync(file, "utf8")),
  };
}

/** The main run on the untouched fixtures, computed once. */
let mainCache: { guide: any; realWork: any; realWorkJson: string } | null = null;
function main(): { guide: any; realWork: any; realWorkJson: string } {
  requireProduction();
  if (!mainCache) {
    const rw = realWorkFrom(EXPORT_FIXTURE, "main");
    const run = runGuide({
      tag: "main",
      realWork: rw.json,
      scores: SCORES,
      printAudit: printAuditInput("main"),
      benchmark: BENCHMARK,
      tracks: TRACKS,
      today: TODAY,
    });
    mainCache = { guide: run.data, realWork: rw.data, realWorkJson: rw.json };
  }
  return mainCache;
}

function rowOf(data: any, kind: string): any {
  const row = data.rows.find((item: any) => item.kind === kind);
  expect(row, `row ${kind}`).toBeDefined();
  return row;
}

function maxBuildTotal(file: string): number {
  const doc = JSON.parse(readFileSync(file, "utf8"));
  return Math.max(...doc.models.map((item: any) => item.score.total));
}

function maxTestsTotal(file: string): number {
  const doc = JSON.parse(readFileSync(file, "utf8"));
  return Math.max(...doc.tracks.tests.models.map((item: any) => item.total));
}

function worstOf(route: any): number {
  return Math.min(...route.passes.map((pass: any) => pass.score));
}

/** Work-type rows where every model misses the 10-result minimum. */
function starveWorkType(doc: any, name: string, cell: any): void {
  for (const item of doc.all_time) {
    if (item.work_types?.[name]) item.work_types[name] = { ...cell };
  }
}

function renameYM(doc: any): void {
  for (const block of ["weekly", "all_time"]) {
    for (const item of doc[block]) {
      if (item.route === "y/m") item.route = HOSTILE_ROUTE;
    }
  }
}

describe("the overview table (spec D18, D19, FR-6)", () => {
  it("T2: model-guide.json holds the six rows of D18 in order with the pinned fields", () => {
    const data = main().guide;
    expect(data.schema).toBe(SCHEMA);
    expect(Object.keys(data).sort()).toEqual(ROOT_KEYS);
    expect(data.today).toBe(TODAY);
    expect(typeof data.stale).toBe("boolean");
    expect(Array.isArray(data.rows)).toBe(true);
    expect(data.rows).toHaveLength(6);
    expect(data.rows.map((row: any) => row.kind)).toEqual(KINDS);
    for (const row of data.rows) {
      expect(Object.keys(row).sort(), `fields of ${row.kind}`).toEqual(ROW_KEYS);
      expect(typeof row.pick, `pick of ${row.kind}`).toBe("string");
      expect(row.pick.length).toBeGreaterThan(0);
      expect(row.evidence, `evidence of ${row.kind}`).toMatch(EVIDENCE_RE);
      expect(row.evidence_date, `date of ${row.kind}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(
        row.base_line === null || typeof row.base_line === "number",
        `base_line of ${row.kind}`,
      ).toBe(true);
    }
  });

  it("T3: the first source picks the first and the second choice from its rank", () => {
    const data = main().guide;
    const codeReview = rowOf(data, "Code review");
    expect(codeReview.pick).toBe("opencode-go/kimi-k2.7-code");
    expect(codeReview.second).toBe("opencode-go/mimo-v2.6-flash");
    const appCode = rowOf(data, "app code");
    expect(appCode.pick).toBe("x/m");
    expect(appCode.second).toBe("y/m");
  });

  it("T3: the evidence cell holds the source, the number, and the run count", () => {
    const { guide, realWork } = main();
    expect(rowOf(guide, "Code review").evidence).toBe("track A: worst 84.0 (n=3)");
    expect(rowOf(guide, "app code").evidence).toBe("page B: pass 0.80 (n=20)");
    expect(rowOf(guide, "docs and ops").evidence).toBe("page B: pass 0.90 (n=10)");
    expect(rowOf(guide, "print-book audit").evidence).toBe("page B: pass 0.40 (n=10)");
    expect(rowOf(guide, "tooling").evidence).toBe("page B: pass 0.30 (n=10)");

    // The test writing evidence comes from the producer table row of the
    // pick itself. The role filter of D18 is not pinned; see the header.
    const testWriting = rowOf(guide, "test writing");
    const match = testWriting.evidence.match(/^page B: pass \d+\.\d{2} \(n=(\d+)\)$/);
    expect(match, `evidence ${testWriting.evidence}`).not.toBeNull();
    const producer = realWork.producer.find((item: any) => item.model === testWriting.pick);
    expect(producer, `pick ${testWriting.pick} comes from the producer table`).toBeDefined();
    expect(producer.pass_rate.n).toBeGreaterThanOrEqual(10);
    expect(Number(match![1])).toBe(producer.pass_rate.n);
  });

  it("T2: each row carries its evidence date", () => {
    const data = main().guide;
    expect(rowOf(data, "Code review").evidence_date).toBe("2026-11-13");
    for (const kind of KINDS.slice(1)) {
      expect(rowOf(data, kind).evidence_date, `date of ${kind}`).toBe(TODAY);
    }
  });

  it("T3: the base line shows beside the pick and never changes it", () => {
    const { guide } = main();
    // The build score sits on the app code row, the tests score on the
    // test writing row, and nowhere else.
    expect(rowOf(guide, "app code").base_line).toBe(maxBuildTotal(BENCHMARK));
    expect(rowOf(guide, "app code").base_line).toBe(95.0);
    expect(rowOf(guide, "test writing").base_line).toBe(maxTestsTotal(TRACKS));
    expect(rowOf(guide, "test writing").base_line).toBe(98.7);
    for (const kind of ["Code review", "docs and ops", "print-book audit", "tooling"]) {
      expect(rowOf(guide, kind).base_line, `base line of ${kind}`).toBeNull();
    }

    // A moved base line moves the number only, never a pick.
    const dir = tempDir("benchmark-moved");
    const doc = JSON.parse(readFileSync(BENCHMARK, "utf8"));
    doc.models.find((item: any) => item.provider_model === "y/m").score.total = 96.0;
    const file = join(dir, "benchmark-mini.json");
    writeFileSync(file, JSON.stringify(doc));
    const run = runGuide({
      tag: "benchmark-moved",
      realWork: main().realWorkJson,
      scores: SCORES,
      printAudit: printAuditInput("bm"),
      benchmark: file,
      tracks: TRACKS,
      today: TODAY,
    });
    expect(rowOf(run.data, "app code").base_line).toBe(96.0);
    expect(run.data.rows.map((row: any) => [row.kind, row.pick, row.second]))
      .toEqual(guide.rows.map((row: any) => [row.kind, row.pick, row.second]));
  });

  it("T3: the rows of app code, docs and ops, print books, and tooling use the work-type table", () => {
    const { guide, realWork } = main();
    const producerTop = realWork.producer[0].model;
    const secondOf = (rows: any[]) => (rows[1].can_pick ? rows[1].model : null);
    const cases: Array<[string, string, string | null]> = [
      ["app code", realWork.work_types["app code"][0].model, secondOf(realWork.work_types["app code"])],
      ["docs and ops", realWork.work_types["docs and ops"][0].model, secondOf(realWork.work_types["docs and ops"])],
      ["print-book audit", realWork.work_types["print books"][0].model, secondOf(realWork.work_types["print books"])],
      ["tooling", realWork.work_types["tooling"][0].model, secondOf(realWork.work_types["tooling"])],
    ];
    for (const [kind, pick, second] of cases) {
      const row = rowOf(guide, kind);
      expect(row.pick, `pick of ${kind}`).toBe(pick);
      expect(row.second, `second of ${kind}`).toBe(second);
      // The producer rank starts with another model, so a producer-table
      // pick for these rows would fail here.
      expect(row.pick, `pick of ${kind} is not the producer top`).not.toBe(producerTop);
    }
  });

  it("T4: with no qualified model in the first source the print-audit second source picks", () => {
    const staged = stagedExport("print-books", (doc) =>
      starveWorkType(doc, "print books", { runs: 8, pass: 3, fail: 4 }));
    const rw = realWorkFrom(staged, "print-books");
    expect(rw.data.work_types["print books"].length).toBeGreaterThan(0);
    expect(rw.data.work_types["print books"].every((row: any) => !row.can_pick),
      "the first source has no qualified model").toBe(true);
    const run = runGuide({
      tag: "print-books",
      realWork: rw.json,
      scores: SCORES,
      printAudit: printAuditInput("print-books"),
      benchmark: BENCHMARK,
      tracks: TRACKS,
      today: TODAY,
    });
    const row = rowOf(run.data, "print-book audit");
    expect(row.pick).toBe("Sonnet 5.5");
    expect(row.second).toBe("k3.1-pro");
    expect(row.evidence).toBe("print-audit: 13 of 13 (n=13)");
    expect(row.evidence_date).toBe(TODAY);
  });

  it("T5: no qualified model in either source shows the no-pick words", () => {
    const staged = stagedExport("docs-and-ops", (doc) =>
      starveWorkType(doc, "docs and ops", { runs: 8, pass: 5, fail: 3 }));
    const rw = realWorkFrom(staged, "docs-and-ops");
    expect(rw.data.work_types["docs and ops"].every((row: any) => !row.can_pick),
      "the first source has no qualified model").toBe(true);
    const run = runGuide({
      tag: "docs-and-ops",
      realWork: rw.json,
      scores: SCORES,
      printAudit: printAuditInput("docs-and-ops"),
      benchmark: BENCHMARK,
      tracks: TRACKS,
      today: TODAY,
    });
    const row = rowOf(run.data, "docs and ops");
    expect(row.pick).toBe(NO_PICK);
    const match = row.evidence.match(/^page B: pass \d+\.\d{2} \(n=(\d+)\)$/);
    expect(match, `evidence ${row.evidence}`).not.toBeNull();
    expect(Number(match![1])).toBeLessThan(10);
    expect(row.evidence_date).toBe(TODAY);
  });

  it("FR-6: the table is written when the score flag or the score file is absent", () => {
    for (const [tag, scores] of [
      ["no-scores-flag", null],
      ["missing-scores-file", join(tempDir("scores-missing"), "review-scores.json")],
    ] as Array<[string, string | null]>) {
      const run = runGuide({
        tag,
        realWork: main().realWorkJson,
        scores,
        printAudit: printAuditInput(tag),
        benchmark: BENCHMARK,
        tracks: TRACKS,
        today: TODAY,
      });
      expect(run.data.schema, tag).toBe(SCHEMA);
      expect(run.data.rows.map((row: any) => row.kind), tag).toEqual(KINDS);
    }
  });

  it("T6: evidence 15 days old shows stale and 14 days shows none", () => {
    expect(main().guide.stale).toBe(false);
    for (const [today, stale] of [["2026-11-29", true], ["2026-11-28", false]] as Array<
      [string, boolean]
    >) {
      const run = runGuide({
        tag: `stale-${today}`,
        realWork: main().realWorkJson,
        scores: SCORES,
        printAudit: printAuditInput(`stale-${today}`),
        benchmark: BENCHMARK,
        tracks: TRACKS,
        today,
      });
      expect(run.data.today, `today of ${today}`).toBe(today);
      expect(run.data.stale, `stale of ${today}`).toBe(stale);
    }
  });

  it("T7: a track A route with incomplete does not qualify", () => {
    const scores = JSON.parse(readFileSync(SCORES, "utf8"));
    const complete = scores.routes.filter((route: any) => route.state === "complete");
    const incomplete = scores.routes.filter((route: any) => route.state !== "complete");
    expect(complete).toHaveLength(2);
    expect(incomplete).toHaveLength(1);
    expect(incomplete[0].passes).toHaveLength(2);
    const worstIncomplete = worstOf(incomplete[0]);
    expect(worstIncomplete, "the incomplete route holds the best worst score").toBeGreaterThan(
      Math.min(...complete.map((route: any) => worstOf(route))),
    );
    const codeReview = rowOf(main().guide, "Code review");
    expect(codeReview.pick).not.toBe(incomplete[0].route);
    expect(codeReview.second).not.toBe(incomplete[0].route);
    expect(codeReview.pick).toBe("opencode-go/kimi-k2.7-code");
    expect(codeReview.second).toBe("opencode-go/mimo-v2.6-flash");
  });

  it("T5 page: the preview index shows the no-pick words for the empty row", () => {
    const { root, exportPath } = pageRepo("nopick", (doc) =>
      starveWorkType(doc, "docs and ops", { runs: 8, pass: 5, fail: 3 }));
    const result = runPreview(root, exportPath);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const index = readFileSync(previewIndex(root), "utf8");
    expect(index, "the overview page holds the table").toContain(NO_PICK);
  });

  it("B8-1 page: a hostile model name reaches the overview table HTML escaped", () => {
    const { root, exportPath } = pageRepo("hostile", renameYM);
    const result = runPreview(root, exportPath);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const index = readFileSync(previewIndex(root), "utf8");
    expect(index, "the escaped hostile model reaches the page")
      .toContain(escapeHtml(HOSTILE_ROUTE));
    expect(index, "no raw img tag").not.toContain(HOSTILE_RAW);
  });
});

const INDEX_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Overview</title>
<link rel="stylesheet" href="./assets/css/site.css"></head>
<body><nav><a href="./methodology.html">Methodology</a>
<a href="./results.html">Results</a><a href="./models/">Models</a>
<a href="./tracks.html">Tracks</a></nav>
<main><h1>Overview</h1></main></body></html>
`;

/** A temp repo for preview.sh: docs/, the model-guide folder, the fixture
 * export, the print-audit data file, and the base-line data files. */
function pageRepo(tag: string, mutate?: (doc: any) => void): { root: string; exportPath: string } {
  requireProduction();
  const root = tempDir(`page-${tag}`);
  mkdirSync(join(root, "harness"), { recursive: true });
  cpSync(SOURCE, join(root, "harness", "model-guide"), { recursive: true });
  mkdirSync(join(root, "docs", "assets", "css"), { recursive: true });
  mkdirSync(join(root, "docs", "assets", "data"), { recursive: true });
  writeFileSync(join(root, "docs", "index.html"), INDEX_HTML);
  writeFileSync(join(root, "docs", "assets", "css", "site.css"), "body { font-family: sans-serif; }\n");
  copyFileSync(BENCHMARK, join(root, "docs", "assets", "data", "benchmark.json"));
  copyFileSync(TRACKS, join(root, "docs", "assets", "data", "tracks.json"));
  mkdirSync(join(root, "harness", "model-guide", "data"), { recursive: true });
  copyFileSync(printAuditInput(tag), join(root, "harness", "model-guide", "data", "print-audit-2026-11.json"));
  mkdirSync(join(root, "fixture"), { recursive: true });
  const doc = JSON.parse(readFileSync(EXPORT_FIXTURE, "utf8"));
  if (mutate) mutate(doc);
  const json = join(root, "fixture", "real-work-mini.json");
  const text = JSON.stringify(doc);
  writeFileSync(json, text);
  writeFileSync(join(root, "fixture", "MANIFEST.txt"), [
    `sha256: ${sha256(json)}`,
    `size: ${Buffer.byteLength(text)}`,
    "source-commit: none (synthetic fixture, 2026-11-15)",
    "",
  ].join("\n"));
  symlinkSync(join(HARNESS, "node_modules"), join(root, "harness", "node_modules"));
  return { root, exportPath: json };
}

function previewIndex(root: string): string {
  return join(root, ".tmp", "model-guide-preview", "index.html");
}

function runPreview(root: string, exportPath: string) {
  return spawnSync("bash", [join(root, "harness", "model-guide", "preview.sh"),
    "--export", exportPath], {
    cwd: root, env: env(), encoding: "utf8", timeout: 120_000,
  });
}
