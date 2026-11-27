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
 *     --benchmark <benchmark.json> --tracks <tracks.json> [--routes <routes.json>] \
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
 *   evidence      the source, the number, and the count. Task 4.1e pins
 *                 these forms (spec D18 PM 2026-11-17, orchestrator
 *                 2026-11-17): "page B producer: accept <n> %, <count>
 *                 tasks" for the test writing row, "track A: worst <n>
 *                 (n=<count>)" for a track A rank, "track A: total <n>
 *                 (n=<count>)" for the docs and ops Arm A rank (F6),
 *                 "print-audit: <x> of <y> (n=<y>)", and the
 *                 exact words "no pick yet" for a row with no source.
 *   evidence_date the export date of the outcomes file (the date in the
 *                 MANIFEST name, Q-S4), the date of the last complete
 *                 track A pass for a track A pick (spec D18), or the
 *                 tracks export date for the docs and ops row (D1)
 *   base_line     null, except the highest build total of `--benchmark`
 *                 on the app code row, the highest tests total of
 *                 `--tracks` on the test writing row, and the highest
 *                 docs-and-ops total of `--tracks` on the docs and ops
 *                 row (D1). The base line shows beside the pick and never
 *                 changes it (spec D18).
 *
 * Pick rule (spec D18, sources PM 2026-11-17): the first source gives the
 * first and second choice from its rank. A page B producer row qualifies
 * with 5 tasks or more and a first-round rate; a page B gate row with 5
 * runs or more, an allowed model, and an AA net score above 0
 * (PM 2026-11-18); a track A route with a complete state and 3 complete
 * passes. The app code row ranks the session route families by Build
 * score. A family without a Build score keeps its session route. When no
 * session route has a Build score, the row shows the no-pick words. The
 * base line itself never picks.
 *
 * Orchestrator rulings on spec D18, recorded under plan task 2.3 and 4.1e:
 *   Q1 the test writing row names its source "page B producer" and picks
 *      the rank 1 of the producer role `red` (sources table PM
 *      2026-11-17; the export carries the role, so the red-only table
 *      applies).
 *   Q2 the code review row shows "no pick yet: not enough evidence" while
 *      track A has no complete rank. The page B checker table does not
 *      pick for code review.
 * A row with no source shows "no pick yet" as its evidence text
 * (orchestrator 2026-11-17).
 *
 * Stale rule (spec D19): the mark uses the newest evidence_date of the
 * table against `--today`. The tool takes `--today`, so the verdict does
 * not move with the wall clock (anti-pattern A11).
 *
 * Fixtures, all synthetic: `fixtures/page-b/` (the three dated page B
 * files and their MANIFEST, run through `real-work.ts --manifest`),
 * `fixtures/print-audit/`
 * (assembled into the print-audit data shape that task 2.1 pinned), and
 * `fixtures/guide/` (`review-scores-mini.json` follows spec D13 with two
 * complete routes and one incomplete route that holds the best worst
 * score; `benchmark-mini.json` and `tracks-mini.json` hold the build,
 * tests, and docs-and-ops base lines). No test reads the real export, the
 * real hand-off file, the real docs/, a model, the network, or the private folder.
 */

const HARNESS = resolve(import.meta.dirname, "..");
const SOURCE = join(HARNESS, "model-guide");
const TOOL = join(SOURCE, "guide.ts");
const REAL_WORK_TOOL = join(SOURCE, "real-work.ts");
const PREVIEW_SH = join(SOURCE, "preview.sh");
const TSX = join(HARNESS, "node_modules", ".bin", "tsx");
const FIXTURES = join(import.meta.dirname, "fixtures");
const PAGE_B = join(FIXTURES, "page-b");
const DATE = "2026-10-20";
const OUTCOMES_NAME = `ra-outcomes-${DATE}.json`;
const AA_NAME = `aa-reliability-${DATE}.json`;
const ALLOWED_NAME = `allowed-routes-${DATE}.json`;
const MANIFEST_NAME = `MANIFEST-${DATE}.txt`;
const EXPORT_DATE = DATE;
const TRACK_A_DATE = "2026-11-13";
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
const EVIDENCE_RE =
  /^(page B producer: accept \d+ %, \d+ tasks|track A: (worst|total) [\d.]+ \(n=\d+\)|print-audit: \d+ of \d+ \(n=\d+\)|no pick yet)$/;
const TEST_WRITING_EVIDENCE = "page B producer: accept 100 %, 5 tasks";
const NO_PICK_EVIDENCE = "no pick yet";
const HOSTILE_ROUTE = 't1/"><img src=x onerror=alert(1)>';
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

/** Stage the three page B data files and a manifest that matches them. */
function stagePageB(
  tag: string,
  mutate?: { outcomes?: (rows: any[]) => void; allowed?: (doc: any) => void },
): { dir: string; manifest: string } {
  const dir = tempDir(`page-b-${tag}`);
  let outcomesText = readFileSync(join(PAGE_B, OUTCOMES_NAME), "utf8");
  if (mutate?.outcomes) {
    const rows = JSON.parse(outcomesText);
    mutate.outcomes(rows);
    outcomesText = JSON.stringify(rows, null, 2) + "\n";
  }
  writeFileSync(join(dir, OUTCOMES_NAME), outcomesText);
  writeFileSync(join(dir, AA_NAME), readFileSync(join(PAGE_B, AA_NAME)));
  let allowedText = readFileSync(join(PAGE_B, ALLOWED_NAME), "utf8");
  if (mutate?.allowed) {
    const doc = JSON.parse(allowedText);
    mutate.allowed(doc);
    allowedText = JSON.stringify(doc, null, 2) + "\n";
  }
  writeFileSync(join(dir, ALLOWED_NAME), allowedText);
  const lines = [OUTCOMES_NAME, AA_NAME, ALLOWED_NAME].map((name) => {
    const data = readFileSync(join(dir, name));
    return `${createHash("sha256").update(data).digest("hex")}  ${data.length}  ${name}`;
  });
  writeFileSync(join(dir, MANIFEST_NAME), `${lines.join("\n")}\n`);
  return { dir, manifest: join(dir, MANIFEST_NAME) };
}

/** Run the page B tool on the staged fixture and return the data file path. */
function realWorkFrom(
  tag: string,
  mutate?: { outcomes?: (rows: any[]) => void; allowed?: (doc: any) => void },
): { json: string; data: any } {
  const { manifest } = stagePageB(tag, mutate);
  const out = tempDir(`real-work-${tag}`);
  const result = spawnSync(
    TSX,
    ["model-guide/real-work.ts", "--manifest", manifest, "--out", out],
    { cwd: HARNESS, env: env(), encoding: "utf8", timeout: 60_000 },
  );
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const json = join(out, "real-work.json");
  expect(existsSync(json), `missing ${json}`).toBe(true);
  return { json, data: JSON.parse(readFileSync(json, "utf8")) };
}

/** The print-audit data file of task 2.1, assembled from the synthetic
 * hand-off fixture (the real OD6 key shape, task 2.4a): a route maps a
 * short key to a route name, and its result is `blockers_found` over
 * `summary.key.blockers`. Route results are "x of y" strings, no book
 * content. */
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
    const rw = realWorkFrom("main");
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
    expect(appCode.pick, "the build base line never picks").toBe(NO_PICK);
    expect(appCode.second, "a row with no pick has no second choice").toBeNull();
  });

  it("T3: the evidence cell holds the source, the number, and the run count", () => {
    const { guide } = main();
    expect(rowOf(guide, "Code review").evidence).toBe("track A: worst 84.0 (n=3)");
    expect(rowOf(guide, "print-book audit").evidence).toBe("print-audit: 13 of 13 (n=13)");
    expect(rowOf(guide, "test writing").evidence).toBe(TEST_WRITING_EVIDENCE);
    // A row with no source shows the no-pick words as its evidence text
    // (orchestrator ruling on spec D18, 2026-11-17). The docs and ops row
    // has its own track A source (D1), so it is not in this loop.
    for (const kind of ["app code", "tooling"]) {
      expect(rowOf(guide, kind).evidence, `evidence of ${kind}`).toBe(NO_PICK_EVIDENCE);
    }
  });

  it("T2: each row carries its evidence date", () => {
    const data = main().guide;
    expect(rowOf(data, "Code review").evidence_date).toBe(TRACK_A_DATE);
    // Every other row takes the export date of the outcomes file (spec D18,
    // the date in the MANIFEST file name, Q-S4). The docs and ops row takes
    // the tracks export date instead (D1).
    for (const kind of ["app code", "test writing", "print-book audit", "tooling"]) {
      expect(rowOf(data, kind).evidence_date, `date of ${kind}`).toBe(EXPORT_DATE);
    }
  });

  it("T3: the base line shows beside the pick and never changes it", () => {
    const { guide } = main();
    // The build score sits on the app code row, the tests score on the
    // test writing row, and nowhere else. The docs and ops base line is
    // the highest docs-and-ops total (D1), so it is not in the null loop
    // below.
    expect(rowOf(guide, "app code").base_line).toBe(maxBuildTotal(BENCHMARK));
    expect(rowOf(guide, "app code").base_line).toBe(95.0);
    expect(rowOf(guide, "test writing").base_line).toBe(maxTestsTotal(TRACKS));
    expect(rowOf(guide, "test writing").base_line).toBe(98.7);
    for (const kind of ["Code review", "print-book audit", "tooling"]) {
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

  it("T4: the print-audit second source picks for the print-book audit row", () => {
    const run = runGuide({
      tag: "print-books",
      realWork: main().realWorkJson,
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
    expect(row.evidence_date).toBe(EXPORT_DATE);
  });

  it("T5: a row with no source shows the no-pick words", () => {
    // The empty docs-and-ops table keeps the no-pick row (D1-keep), so
    // this case runs on a tracks fixture with no docs-and-ops models.
    const run = runGuide({
      tag: "docs-and-ops",
      realWork: main().realWorkJson,
      scores: SCORES,
      printAudit: printAuditInput("docs-and-ops"),
      benchmark: BENCHMARK,
      tracks: tracksWithoutDocsAndOps(),
      today: TODAY,
    });
    const row = rowOf(run.data, "docs and ops");
    expect(row.pick).toBe(NO_PICK);
    expect(row.evidence, "the evidence text of a source-less row").toBe(NO_PICK_EVIDENCE);
    expect(row.evidence_date).toBe(EXPORT_DATE);
    expect(row.base_line, "docs and ops has no base line").toBeNull();
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
    // The newest evidence_date is the 2026-11-14 tracks export (D1), so
    // 2026-11-29 is 15 days out (stale) and 2026-11-28 is 14 (fresh).
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

  it("T7b: a track A route with one provisional pass keeps its rank (D13)", () => {
    const scores = JSON.parse(readFileSync(SCORES, "utf8"));
    const top = scores.routes[0];
    expect(top.passes).toHaveLength(3);
    top.passes[0].state = "provisional";
    const file = join(tempDir("scores-provisional"), "review-scores-mini.json");
    writeFileSync(file, JSON.stringify(scores));
    const run = runGuide({
      tag: "provisional",
      realWork: main().realWorkJson,
      scores: file,
      printAudit: printAuditInput("provisional"),
      benchmark: BENCHMARK,
      tracks: TRACKS,
      today: TODAY,
    });
    const codeReview = rowOf(run.data, "Code review");
    expect(codeReview.pick, "a provisional pass does not remove the rank").toBe(top.route);
    expect(codeReview.evidence).toBe("track A: worst 84.0 (n=3)");
    expect(codeReview.evidence_date).toBe("2026-11-13");
  });

  it("T5 page: the preview index shows the no-pick words for the empty row", () => {
    const { root, manifest } = pageRepo("nopick");
    const result = runPreview(root, manifest);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const index = readFileSync(previewIndex(root), "utf8");
    expect(index, "the overview page holds the table").toContain(NO_PICK);
  });

  it("B8-1 page: a hostile model name reaches the overview table HTML escaped", () => {
    const { root, manifest } = pageRepo("hostile", {
      outcomes: (rows) => {
        for (const row of rows) {
          if (row.route === "t1/prod-one[1m]#high") row.route = HOSTILE_ROUTE;
        }
      },
      allowed: (doc) => {
        doc.allowedRoutes.push(HOSTILE_ROUTE);
      },
    });
    const result = runPreview(root, manifest);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const index = readFileSync(previewIndex(root), "utf8");
    expect(index, "the escaped hostile model reaches the page")
      .toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(index, "no raw img tag").not.toContain(HOSTILE_RAW);
  });

  it("D18 Q1: the test writing row picks the rank 1 of the producer role red and the evidence cell names the producer table", () => {
    const { guide } = main();
    // The red producer rows of the fixture are t1/prod-one (5 tasks,
    // accept 100 %) and t1/prod-nine (8 tasks, accept 25 %). The row picks
    // the first qualified model of that role (spec D18 sources, PM
    // 2026-11-17) and the second choice follows its rank.
    const row = rowOf(guide, "test writing");
    expect(row.pick, "the pick is the red producer rank 1").toBe("t1/prod-one");
    expect(row.second, "the second choice is the red producer rank 2").toBe("t1/prod-nine");
    expect(row.evidence, "the evidence cell names the producer table")
      .toBe(TEST_WRITING_EVIDENCE);
    expect(row.evidence_date, "the evidence date is the export date").toBe(EXPORT_DATE);
  });

  it("D18 Q2: with no complete track A route the code review pick is the no-pick words", () => {
    const { guide } = main();
    // (a) model-guide.json. The score file keeps only the incomplete
    // routes, so track A has no rank (ruling Q2). The page B checker table
    // does not pick for code review (spec D18 ruling Q2, PM 2026-11-15),
    // so the row shows the no-pick words.
    const scores = JSON.parse(readFileSync(SCORES, "utf8"));
    const incomplete = scores.routes.filter((route: any) => route.state !== "complete");
    expect(incomplete, "one incomplete route in the fixture").toHaveLength(1);
    const noCompleteFile = join(tempDir("scores-no-complete"), "review-scores-mini.json");
    writeFileSync(noCompleteFile, JSON.stringify({ ...scores, routes: incomplete }));
    const run = runGuide({
      tag: "no-complete",
      realWork: main().realWorkJson,
      scores: noCompleteFile,
      printAudit: printAuditInput("no-complete"),
      benchmark: BENCHMARK,
      tracks: TRACKS,
      today: TODAY,
    });
    const row = rowOf(run.data, "Code review");
    expect(row.pick, "the code review pick is the no-pick words").toBe(NO_PICK);
    expect(row.second, "no second choice without a rank").toBeNull();
    expect(guide.rows.map((item: any) => item.kind)).toEqual(KINDS);

    // (b) the preview index page. The temp preview repo has no score
    // file, so it has no complete track A route either.
    const { root, manifest } = pageRepo("code-review-nopick");
    rmSync(join(root, "harness", "model-guide", "data", "review-scores"), {
      recursive: true,
      force: true,
    });
    const result = runPreview(root, manifest);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const index = readFileSync(previewIndex(root), "utf8");
    const cells = [...index.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((match) => match[1]);
    const codeReview = cells.find((entry) => entry.includes("Code review"));
    expect(codeReview, "the page holds the code review row").toBeDefined();
    expect(codeReview, "the code review row shows the no-pick words").toContain(NO_PICK);
  });

  it("RA-1: the overview pick cells show plain names, a #variant route maps to its model key name, and no-pick words stay", () => {
    const { root, manifest } = pageRepo("ra1-names", {
      outcomes: (rows) => {
        for (const row of rows) {
          if (row.route === "t1/prod-one[1m]#high") {
            row.route = "claude-code/claude-sonnet-5-5#high";
          }
          if (row.route === "t1/prod-nine") {
            row.route = "opencode-go/synthetic-unknown";
          }
        }
      },
      allowed: (doc) => {
        doc.allowedRoutes.push("claude-code/claude-sonnet-5-5#high");
        doc.allowedRoutes.push("opencode-go/synthetic-unknown");
      },
    });
    // This case is about hostile names, not the docs row: it empties the
    // docs-and-ops table of the temp repo, so the empty-table behavior
    // (D1-keep) keeps the no-pick words on that row.
    const tracksFile = join(root, "docs", "assets", "data", "tracks.json");
    const tracksDoc = JSON.parse(readFileSync(tracksFile, "utf8"));
    tracksDoc.tracks["docs-and-ops"] = { models: [] };
    writeFileSync(tracksFile, JSON.stringify(tracksDoc));
    // The print-audit source carries #variant routes as its keys, so the
    // overview must map each of them to the plain name of its model key
    // (RA2-2, RA3-2).
    const auditFile = join(root, "harness", "model-guide", "data", "print-audit-2026-11.json");
    expect(existsSync(auditFile), "the temp repo holds the print-audit data file").toBe(true);
    const audit = JSON.parse(readFileSync(auditFile, "utf8"));
    audit.routes = {
      "claude-code/claude-sonnet-5-5#high": "13 of 13",
      "kimi-code-plan-cn/k3.1-pro#high": "11 of 13",
    };
    writeFileSync(auditFile, `${JSON.stringify(audit, null, 2)}\n`);
    const result = runPreview(root, manifest);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const index = readFileSync(previewIndex(root), "utf8");
    const rows = [...index.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((match) => match[1]);
    const testWriting = rows.find((entry) => /test writing/i.test(entry));
    expect(testWriting, "the page holds the test writing row").toBeDefined();
    const tds = [...testWriting!.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((cell) =>
      cell[1].replace(/<[^>]*>/g, "").trim(),
    );
    expect(tds.length, "the row holds the five cells of the table").toBe(5);
    const names = JSON.parse(readFileSync(join(SOURCE, "data", "model-names.json"), "utf8"));
    expect(names["claude-code/claude-sonnet-5-5"], "model-names.json names the key").toBe(
      "Claude Sonnet 5.5",
    );
    expect(names["claude-agent/sonnet"], "model-names.json names the Claude Agent key").toBe(
      "Claude Sonnet 5.5",
    );
    const pick = tds[1];
    const second = tds[2];
    expect(pick, "the pick cell shows the plain name").toContain("Claude Sonnet 5.5");
    expect(pick, "the pick cell holds no raw route key").not.toContain(
      "claude-code/claude-sonnet-5-5",
    );
    expect(second, "the second cell shows the key without its plan prefix").toContain(
      "synthetic-unknown",
    );
    expect(second, "the second cell holds no plan prefix").not.toContain("opencode-go/");
    const docs = rows.find((entry) => /docs and ops/i.test(entry));
    expect(docs, "the page holds the docs and ops row").toBeDefined();
    expect(docs, "the no-pick words stay as they are").toContain(NO_PICK);

    // The print-book audit row picks from the print-audit source, whose
    // best route is the #variant key claude-code/claude-sonnet-5-5#high
    // (RA2-2). Both cells must show plain names.
    const auditRow = rows.find((entry) => /print-book audit/i.test(entry));
    expect(auditRow, "the page holds the print-book audit row").toBeDefined();
    const auditTds = [...auditRow!.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((cell) =>
      cell[1].replace(/<[^>]*>/g, "").trim(),
    );
    expect(auditTds.length, "the row holds the five cells of the table").toBe(5);
    expect(auditTds[1], "the #variant pick maps to its model key name").toContain(
      "Claude Sonnet 5.5",
    );
    expect(auditTds[1], "the pick cell holds no #variant text").not.toContain("#high");
    expect(auditTds[1], "the pick cell holds no raw route key").not.toContain(
      "claude-code/claude-sonnet-5-5",
    );
    expect(auditTds[2], "the second cell maps its #variant route to the plain name").toContain(
      "Kimi K3.1 Pro",
    );
    expect(auditTds[2], "the second cell holds no raw route key").not.toContain(
      "kimi-code-plan-cn/k3.1-pro",
    );
  });

  it("RA-2: the Test writing pick skips a not-allowed row and a row below the minimum", () => {
    // The committed fixture holds t1/prod-evil (accept 100 %, 20 tasks,
    // not allowed) and t1/prod-tiny (accept 100 %, 4 tasks). Neither may
    // become the pick of the test writing row.
    const base = realWorkFrom("ra2-base");
    const runBase = runGuide({
      tag: "ra2-base",
      realWork: base.json,
      scores: SCORES,
      printAudit: printAuditInput("ra2-base"),
      benchmark: BENCHMARK,
      tracks: TRACKS,
      today: TODAY,
    });
    const baseRow = rowOf(runBase.data, "test writing");
    expect(baseRow.pick, "the pick is the red rank 1 that passes every filter").toBe("t1/prod-one");
    expect(baseRow.pick, "the not-allowed row never picks").not.toBe("t1/prod-evil");
    expect(baseRow.pick, "the 4-task row never picks").not.toBe("t1/prod-tiny");

    // The fixture allows t1/prod-tiny, so only the minimum of 5 keeps it
    // out of the pick. The variant lowers the rate of the red prod-one row
    // to 0.5: a missing allowed filter then picks t1/prod-evil. A minimum
    // change in both tools picks t1/prod-tiny there, because the rank order
    // of the table comes from real-work.ts.
    const variant = realWorkFrom("ra2-variant", {
      outcomes: (rows) => {
        for (const row of rows) {
          if (row.route === "t1/prod-one[1m]#high") row.first_round_rate = 0.5;
        }
      },
    });
    const runVariant = runGuide({
      tag: "ra2-variant",
      realWork: variant.json,
      scores: SCORES,
      printAudit: printAuditInput("ra2-variant"),
      benchmark: BENCHMARK,
      tracks: TRACKS,
      today: TODAY,
    });
    const variantRow = rowOf(runVariant.data, "test writing");
    expect(variantRow.pick, "the pick stays the red rank 1 of the allowed rows").toBe(
      "t1/prod-one",
    );
    expect(variantRow.pick, "the not-allowed row never picks").not.toBe("t1/prod-evil");
    expect(variantRow.pick, "the 4-task row never picks").not.toBe("t1/prod-tiny");
    expect(variantRow.second, "the second choice passes the filters too").not.toBe("t1/prod-evil");
    expect(variantRow.second).not.toBe("t1/prod-tiny");

    // The second variant makes t1/prod-nine not allowed, so only rows
    // below the minimum or not allowed remain for the second choice. With
    // the minimum of 5 the second choice stays null. A guide.ts minimum of
    // 4 alone (mutant N1) fills it with t1/prod-tiny, because the rank
    // order of the table still comes from real-work.ts.
    const secondVariant = realWorkFrom("ra2-second", {
      allowed: (doc) => {
        doc.allowedRoutes = doc.allowedRoutes.filter((route) => route !== "t1/prod-nine");
      },
    });
    const runSecond = runGuide({
      tag: "ra2-second",
      realWork: secondVariant.json,
      scores: SCORES,
      printAudit: printAuditInput("ra2-second"),
      benchmark: BENCHMARK,
      tracks: TRACKS,
      today: TODAY,
    });
    const secondRow = rowOf(runSecond.data, "test writing");
    expect(secondRow.pick, "the pick is still the red rank 1").toBe("t1/prod-one");
    expect(secondRow.second, "no other red row passes the filters").toBeNull();
    expect(secondRow.second, "the 4-task row never fills the second choice").not.toBe(
      "t1/prod-tiny",
    );
  });

  it("DS26: the overview section text says a model needs 5 tasks or runs, not 10", () => {
    const template = readFileSync(join(SOURCE, "pages", "guide-section.html"), "utf8");
    expect(
      template,
      "the overview text states the minimum of 5 of spec D18 PM 2026-11-18",
    ).toContain("5 tasks or runs");
    expect(template, "the overview text no longer says 10 runs or more").not.toContain(
      "10 runs or more",
    );
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

/** A temp repo for preview.sh: docs/, the model-guide folder, the staged
 * page B fixture set, the print-audit data file, and the base-line data
 * files. `mutate` may replace the staged outcomes array or the allowed
 * list before the manifest is written. */
function pageRepo(tag: string, mutate?: {
  outcomes?: (rows: any[]) => void;
  allowed?: (doc: any) => void;
}): { root: string; manifest: string } {
  requireProduction();
  const root = tempDir(`page-${tag}`);
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
  writeFileSync(join(root, "docs", "assets", "css", "site.css"), "body { font-family: sans-serif; }\n");
  copyFileSync(BENCHMARK, join(root, "docs", "assets", "data", "benchmark.json"));
  copyFileSync(TRACKS, join(root, "docs", "assets", "data", "tracks.json"));
  mkdirSync(join(root, "harness", "model-guide", "data"), { recursive: true });
  copyFileSync(printAuditInput(tag), join(root, "harness", "model-guide", "data", "print-audit-2026-11.json"));
  const staged = stagePageB(tag, mutate);
  mkdirSync(join(root, "fixture-b"), { recursive: true });
  for (const name of [OUTCOMES_NAME, AA_NAME, ALLOWED_NAME, MANIFEST_NAME]) {
    copyFileSync(join(staged.dir, name), join(root, "fixture-b", name));
  }
  symlinkSync(join(HARNESS, "node_modules"), join(root, "harness", "node_modules"));
  return { root, manifest: join(root, "fixture-b", MANIFEST_NAME) };
}

function previewIndex(root: string): string {
  return join(root, ".tmp", "model-guide-preview", "index.html");
}

function runPreview(root: string, manifest: string) {
  return spawnSync("bash", [join(root, "harness", "model-guide", "preview.sh"),
    "--manifest", manifest], {
    cwd: root, env: env(), encoding: "utf8", timeout: 120_000,
  });
}

/**
 * The docs and ops row from the docs-and-ops track (task 1.6, Red).
 * The guide reads tracks["docs-and-ops"].models and ranks Arm A by total;
 * the fixture's Arm B leader (r/m, 99.9) must never pick. The evidence date
 * is the tracks export date and the base line is the highest total. An
 * empty docs-and-ops table keeps the no-pick words. All but the empty-table
 * keep-behavior fail while the guide ignores the track.
 */
function docsAndOpsArmA(file: string): any[] {
  const doc = JSON.parse(readFileSync(file, "utf8"));
  expect(doc.tracks["docs-and-ops"], "the tracks fixture holds docs-and-ops").toBeDefined();
  return doc.tracks["docs-and-ops"].models
    .filter((item: any) => item.arm === "a")
    .sort((a: any, b: any) => b.total - a.total);
}

function tracksExportDate(file: string): string {
  const generated = JSON.parse(readFileSync(file, "utf8")).generated_at;
  expect(generated, "the tracks fixture carries an export date").toMatch(/^\d{4}-\d{2}-\d{2}/);
  return String(generated).slice(0, 10);
}

function tracksWithoutDocsAndOps(): string {
  const dir = tempDir("tracks-no-docs-and-ops");
  const doc = JSON.parse(readFileSync(TRACKS, "utf8"));
  doc.tracks["docs-and-ops"] = { models: [] };
  const file = join(dir, "tracks-mini.json");
  writeFileSync(file, JSON.stringify(doc));
  return file;
}

describe("the docs and ops row from the docs-and-ops track (task 1.6)", () => {
  it("D1: the row ranks Arm A of tracks[docs-and-ops].models by total", () => {
    const ranked = docsAndOpsArmA(TRACKS);
    expect(ranked.length, "the fixture holds two Arm A models").toBe(2);
    expect(ranked[0].total, "the Arm B leader never picks").toBeLessThan(99.9);
    const row = rowOf(main().guide, "docs and ops");
    expect(row.pick, "the pick is the Arm A rank 1").toBe(ranked[0].model);
    expect(row.second, "the second choice is the Arm A rank 2").toBe(ranked[1].model);
  });

  it("D1: the evidence date is the tracks export date", () => {
    const row = rowOf(main().guide, "docs and ops");
    expect(row.evidence_date, "the evidence date is the tracks export date")
      .toBe(tracksExportDate(TRACKS));
  });

  it("D1: the base line is the highest docs-and-ops total", () => {
    const highest = Math.max(
      ...JSON.parse(readFileSync(TRACKS, "utf8")).tracks["docs-and-ops"].models
        .map((item: any) => item.total),
    );
    expect(rowOf(main().guide, "docs and ops").base_line).toBe(highest);
  });

  it("D1-keep: an empty docs-and-ops table keeps the no-pick words", () => {
    const run = runGuide({
      tag: "docs-and-ops-empty",
      realWork: main().realWorkJson,
      scores: SCORES,
      printAudit: printAuditInput("docs-and-ops-empty"),
      benchmark: BENCHMARK,
      tracks: tracksWithoutDocsAndOps(),
      today: TODAY,
    });
    const row = rowOf(run.data, "docs and ops");
    expect(row.pick).toBe(NO_PICK);
    expect(row.second).toBeNull();
    expect(row.evidence).toBe(NO_PICK_EVIDENCE);
  });
});

/** Tracks fixture variant whose docs-and-ops models carry unequal repeat
 * totals across several models, so the selected model repeat count cannot
 * be confused with the Arm A model count. */
function tracksWithRepeatTotals(): string {
  const dir = tempDir("tracks-repeat-totals");
  const doc = JSON.parse(readFileSync(TRACKS, "utf8"));
  doc.tracks["docs-and-ops"] = {
    models: [
      { model: "r/m", arm: "b", total: 99.9, repeats: { n: 1, totals: [99.9] } },
      { model: "p/m", arm: "a", total: 91.2, repeats: { n: 4, totals: [89.0, 90.5, 91.2, 93.1] } },
      { model: "q/m", arm: "a", total: 87.5, repeats: { n: 2, totals: [87.5, 88.0] } },
      { model: "s/m", arm: "a", total: 85.0, repeats: { n: 1, totals: [85.0] } },
    ],
  };
  const file = join(dir, "tracks-mini.json");
  writeFileSync(file, JSON.stringify(doc));
  return file;
}

describe("the docs and ops evidence label and repeat count (review-a F6)", () => {
  it("F6: the picked total is labeled as the Arm A total with the selected model repeat count", () => {
    const run = runGuide({
      tag: "docs-and-ops-repeat-totals",
      realWork: main().realWorkJson,
      scores: SCORES,
      printAudit: printAuditInput("docs-and-ops-repeat-totals"),
      benchmark: BENCHMARK,
      tracks: tracksWithRepeatTotals(),
      today: TODAY,
    });
    const row = rowOf(run.data, "docs and ops");
    expect(row.pick, "F6: the pick is the Arm A rank 1").toBe("p/m");
    expect(row.evidence, "F6: the value is labeled as the Arm A total").toBe("track A: total 91.2 (n=4)");
    expect(row.evidence, "F6: the value is not labeled worst").not.toContain("worst");
  });
});
