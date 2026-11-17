import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
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
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Adversarial tests for the page B data source (plan tasks 4.1e and 4.1f).
 * They attack the three dated data files, the merge, the AA lookup, the
 * allowed list, the rank, the top block, the footer, and the 390 px layout.
 *
 * Each case checks a rule of spec D16 "Data source (PM 2026-11-17)", D17,
 * or D18. A case never pins the current output. The cases read the page
 * through the `data-mg` hooks of test-strategy 13.6 and parse labeled
 * values (A3). Each case checks its row counts first (A4).
 *
 * Every fixture is synthetic and built in memory. The cases use the sentinel
 * date 2026-10-20 and never read a real dated data file. The browser cases
 * read the CSS file of the real docs/ folder, and they only copy it into a
 * temp repo, so the layout is the layout of the site. A case that needs a
 * browser fails when no browser starts (it never skips).
 *
 * A failing case in this file shows an implementation defect. The case name
 * holds the id ADV4-n of the finding.
 */

const HARNESS = resolve(import.meta.dirname, "..");
const REPO = resolve(HARNESS, "..");
const SOURCE = join(HARNESS, "model-guide");
const PAGE_B = join(import.meta.dirname, "fixtures", "page-b");
const REAL_CSS = join(REPO, "docs", "assets", "css", "site.css");
const DATE = "2026-10-20";
const DASH = "–";

const INDEX_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Overview</title>
<link rel="stylesheet" href="./assets/css/site.css"></head>
<body><nav><a href="./methodology.html">Methodology</a>
<a href="./results.html">Results</a><a href="./models/">Models</a>
<a href="./tracks.html">Tracks</a></nav>
<main><h1>Overview</h1></main></body></html>
`;

const ROLE_IDS = [
  "red",
  "green",
  "coder",
  "review-a",
  "review-b",
  "review-c",
  "adversarial",
  "acceptance",
  "phase-acceptance",
  "final-acceptance",
];
/** The visible role labels of the ten top lines (spec D16 Top block,
 * orchestrator 2026-11-18). */
const ROLE_LABEL: Record<string, string> = {
  red: "Red",
  green: "Green",
  coder: "Coder",
  "review-a": "Review A",
  "review-b": "Review B",
  "review-c": "Review C",
  adversarial: "Adversarial",
  acceptance: "Acceptance",
  "phase-acceptance": "Phase acceptance",
  "final-acceptance": "Final acceptance",
};

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `model-guide-adv-p4-${tag}-`));
  roots.push(dir);
  return dir;
}

function env(): NodeJS.ProcessEnv {
  const copy = { ...process.env, NO_COLOR: "1", npm_config_loglevel: "silent", TZ: "UTC" };
  delete copy.BENCH_TRACK;
  return copy;
}

// ---------------------------------------------------------------- fixtures

type Row = Record<string, unknown>;

/** A producer row with every field of the real `ra-quota outcomes --json`. */
function prod(
  route: string,
  role: string,
  tasks: number,
  accepted: number,
  rate: number | null,
  rework: number | null,
  cleanup: number | null,
  tokens: number | null,
): Row {
  return {
    route,
    role,
    runs: tasks,
    pass: tasks,
    fail: 0,
    error: 0,
    no_verdict: 0,
    open: 0,
    decided: tasks,
    coverage: 1.0,
    ratings: {},
    findings: 0,
    escaped_findings: 0,
    kind: "producer",
    tasks,
    accepted,
    first_round_rate: rate,
    mean_rework_rounds: rework,
    cleanup_share: cleanup,
    tokens_per_accepted: tokens,
  };
}

/** A gate row. `extra` may set no_verdict, open, runs, and any raw field. */
function gate(
  route: string,
  role: string,
  decided: number,
  pass: number,
  findings: number,
  escapes: number,
  extra: Row = {},
): Row {
  const noVerdict = Number(extra.no_verdict ?? 0);
  const open = Number(extra.open ?? 0);
  return {
    route,
    role,
    runs: decided + noVerdict + open,
    pass,
    fail: decided - pass,
    error: 0,
    no_verdict: noVerdict,
    open,
    decided,
    recorded_rate: null,
    coverage: 1.0,
    ratings: {},
    findings,
    escaped_findings: 0,
    kind: "gate",
    escapes,
    ...extra,
  };
}

interface Input {
  outcomes: Row[];
  aa?: Record<string, unknown>;
  allowed?: string[];
  orchestrator?: string[];
  date?: string;
}

function aaFile(models: Record<string, unknown>): Record<string, unknown> {
  return { schema: "aa-reliability/1", source: { readDate: DATE }, models };
}

function sha256Of(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Write the three dated files and a MANIFEST into `dir`. Returns the manifest. */
function writeStaged(dir: string, input: Input): string {
  const date = input.date ?? DATE;
  mkdirSync(dir, { recursive: true });
  const files: Array<[string, string]> = [
    [`ra-outcomes-${date}.json`, `${JSON.stringify(input.outcomes, null, 2)}\n`],
    [`aa-reliability-${date}.json`, `${JSON.stringify(aaFile(input.aa ?? {}), null, 2)}\n`],
    [
      `allowed-routes-${date}.json`,
      `${JSON.stringify(
        { allowedRoutes: input.allowed ?? [], orchestratorRoutes: input.orchestrator ?? [] },
        null,
        2,
      )}\n`,
    ],
  ];
  const lines: string[] = [];
  for (const [name, text] of files) {
    writeFileSync(join(dir, name), text);
    const data = Buffer.from(text);
    lines.push(`${sha256Of(data)}  ${data.length}  ${name}`);
  }
  const manifest = join(dir, `MANIFEST-${date}.txt`);
  writeFileSync(manifest, `${lines.join("\n")}\n`);
  return manifest;
}

interface RepoOptions {
  /** Replace the plain-name file of the temp repo. */
  names?: Record<string, string>;
  /** Use the real site.css so the layout is the layout of the site. */
  realCss?: boolean;
  /** Replace the `routes` object of the print-audit data file. */
  auditRoutes?: Record<string, string>;
}

const REAL_DATED = /^(ra-outcomes|aa-reliability|allowed-routes)-\d{4}-\d{2}-\d{2}\.json$|^MANIFEST-/;

/** A temp repo that holds the production folder, a small docs/, and links
 * to the real node_modules. The real dated data files and the track A sets
 * are left out of the copy. */
function makeRepo(tag: string, options: RepoOptions = {}): string {
  const root = tempDir(`repo-${tag}`);
  mkdirSync(join(root, "harness"), { recursive: true });
  cpSync(SOURCE, join(root, "harness", "model-guide"), {
    recursive: true,
    filter: (source) => {
      const name = basename(source);
      return name !== "sets" && !REAL_DATED.test(name);
    },
  });
  mkdirSync(join(root, "docs", "assets", "css"), { recursive: true });
  mkdirSync(join(root, "docs", "assets", "data"), { recursive: true });
  writeFileSync(join(root, "docs", "index.html"), INDEX_HTML);
  if (options.realCss) {
    if (!existsSync(REAL_CSS)) throw new Error(`the real stylesheet is missing: ${REAL_CSS}`);
    writeFileSync(join(root, "docs", "assets", "css", "site.css"), readFileSync(REAL_CSS));
  } else {
    writeFileSync(join(root, "docs", "assets", "css", "site.css"), "body { font-family: sans-serif; }\n");
  }
  writeFileSync(join(root, "docs", "assets", "data", "benchmark.json"), '{"schema":1,"rows":[]}\n');
  mkdirSync(join(root, "measure", "tracks", "model_guide"), { recursive: true });
  symlinkSync(join(HARNESS, "node_modules"), join(root, "harness", "node_modules"));
  const data = join(root, "harness", "model-guide", "data");
  if (options.names) {
    writeFileSync(join(data, "model-names.json"), `${JSON.stringify(options.names, null, 2)}\n`);
  }
  if (options.auditRoutes) {
    const file = join(data, "print-audit-2026-11.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    doc.routes = options.auditRoutes;
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  }
  return root;
}

function runPreview(root: string, manifest: string, preview?: string) {
  const args = [join(root, "harness", "model-guide", "preview.sh"), "--manifest", manifest];
  if (preview) args.push("--preview", preview);
  return spawnSync("bash", args, { cwd: root, env: env(), encoding: "utf8", timeout: 120_000 });
}

function previewFolder(root: string): string {
  return join(root, ".tmp", "model-guide-preview");
}

function buildPage(root: string, manifest: string): string {
  const result = runPreview(root, manifest);
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const file = join(previewFolder(root), "real-work.html");
  expect(existsSync(file), `missing ${file}`).toBe(true);
  return readFileSync(file, "utf8");
}

function pageOf(tag: string, input: Input, options: RepoOptions = {}): { page: string; root: string } {
  const root = makeRepo(tag, options);
  const manifest = writeStaged(join(root, "fixture-b"), input);
  return { page: buildPage(root, manifest), root };
}

// ----------------------------------------------------------- page parsing

function unescapeHtml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&");
}

function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function sectionOf(page: string, heading: string): string {
  const at = page.indexOf(`<h2>${heading}</h2>`);
  expect(at, `the page holds a ${heading} heading`).toBeGreaterThan(-1);
  const end = page.indexOf("</section>", at);
  expect(end, `the ${heading} section closes`).toBeGreaterThan(at);
  return page.slice(at, end);
}

interface TableRow {
  key: string;
  rank: string | null;
  cells: string[];
  html: string;
}

function rowsOf(region: string): TableRow[] {
  const out: TableRow[] = [];
  for (const m of region.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g)) {
    const raw = m[1].match(/\bdata-model-key="([^"]*)"/)?.[1];
    if (raw === undefined) continue;
    out.push({
      key: unescapeHtml(raw),
      rank: m[1].match(/\bdata-rank="([^"]*)"/)?.[1] ?? null,
      cells: [...m[2].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => textOf(cell[1])),
      html: m[0],
    });
  }
  return out;
}

function defaultTableText(section: string): string {
  const m = section.match(/<table\b[^>]*data-mg="default-table"[^>]*>[\s\S]*?<\/table>/);
  return m ? m[0] : "";
}

function fewGroupText(section: string): string {
  const at = section.indexOf('data-mg="too-few"');
  if (at < 0) return "";
  const end = section.indexOf("</details>", at);
  return section.slice(at, end < 0 ? section.length : end);
}

/** The data rows of the default table and of the Too few tasks group. */
function tableRows(section: string): TableRow[] {
  return [...rowsOf(defaultTableText(section)), ...rowsOf(fewGroupText(section))];
}

function rowIn(rows: TableRow[], key: string): TableRow {
  const found = rows.find((row) => row.key === key);
  expect(found, `row ${key} exists in ${JSON.stringify(rows.map((row) => row.key))}`).toBeDefined();
  return found!;
}

function rankedKeys(rows: TableRow[]): string[] {
  return rows.filter((row) => row.rank !== null).map((row) => row.key);
}

interface Pick {
  role: string | null;
  key: string | null;
  text: string;
  rate: string;
  count: string;
  none: boolean;
}

/** The ten top lines. Each line starts with its role label and a colon and
 * then holds one of the three forms of spec D16 Top block (orchestrator
 * 2026-11-18), so the rate and the count come from the text of the line. */
function picksOf(page: string): Pick[] {
  const at = page.indexOf('data-mg="top-block"');
  expect(at, "the page holds the top block").toBeGreaterThan(-1);
  const end = page.indexOf("</section>", at);
  const region = page.slice(at, end);
  const out: Pick[] = [];
  for (const m of region.matchAll(/<li\b([^>]*\bdata-mg="pick"[^>]*)>([\s\S]*?)<\/li>/g)) {
    const key = m[1].match(/\bdata-model-key="([^"]*)"/)?.[1];
    const text = textOf(m[2]);
    const gate = text.match(/ (\d+) % pass in this role, (\d+) runs, net /);
    const producer = text.match(/ (\d+) % in this role, (\d+) tasks/);
    out.push({
      role: m[1].match(/\bdata-role="([^"]*)"/)?.[1] ?? null,
      key: key === undefined ? null : unescapeHtml(key),
      text,
      rate: gate ? `${gate[1]} %` : producer ? `${producer[1]} %` : "",
      count: gate ? gate[2] : producer ? producer[2] : "",
      none: text.endsWith(": no pick yet"),
    });
  }
  return out;
}

/** The ten lines of the top block, in order, with the labeled values. Each
 * line starts with "<role label>: " and a no-pick line is exactly
 * "<role label>: no pick yet" (spec D16 Top block, orchestrator 2026-11-18). */
function expectTopBlock(
  page: string,
  expected: Record<string, [string, string, string] | null>,
): void {
  const picks = picksOf(page);
  expect(picks.map((pick) => pick.role), "ten lines in the order of spec D16 rule 8").toEqual(ROLE_IDS);
  for (const pick of picks) {
    const role = pick.role as string;
    const label = ROLE_LABEL[role];
    expect(label, `a role label for ${role}`).toBeTruthy();
    expect(
      pick.text.startsWith(`${label}: `),
      `${role} line starts with "${label}: ", got "${pick.text}"`,
    ).toBe(true);
    const want = expected[role] ?? null;
    if (want === null) {
      expect(pick.none, `${role} says no pick yet`).toBe(true);
      expect(pick.text, `${role} no-pick line text`).toBe(`${label}: no pick yet`);
      expect(pick.key, `${role} names no model`).toBeNull();
      continue;
    }
    expect(pick.none, `${role} has a pick`).toBe(false);
    expect([pick.key, pick.rate, pick.count], `${role} pick`).toEqual(want);
  }
}

function footerText(page: string, hook: string): string {
  const start = page.indexOf('data-mg="about-footer"');
  expect(start, "the page holds the About this data footer").toBeGreaterThan(-1);
  const m = page.slice(start).match(new RegExp(`data-mg="${hook}"[^>]*>([\\s\\S]*?)<`));
  expect(m, `the footer holds ${hook}`).toBeTruthy();
  return textOf(m![1]);
}

function footerNumber(page: string, hook: string): number {
  const text = footerText(page, hook);
  expect(text, `${hook} holds one integer`).toMatch(/^\d+$/);
  return Number(text);
}

// ------------------------------------------------------------------ cases

describe("ADV4 data shapes of the real export (D16 Data source, Route key, Counts, Producer table)", () => {
  it("ADV4-1: a [1m] and #variant route, a nested note, a duplicate row, and null cells merge into one correct row", () => {
    const outcomes = [
      prod("p1/alpha[1m]#high", "red", 10, 5, 0.8, 1.0, 0.2, 100000),
      prod("p1/alpha#high[1m]", "green", 10, 5, 0.4, 2.0, 0.4, 300000),
      // The note holds a nested " (" and a [1m]#variant text. The strip cuts
      // at the first " (" before any key rule runs.
      prod(
        "p1/alpha#high (ra-quota pick; substitution for p1/zeta[1m]#medium (above pace))",
        "green",
        40,
        3,
        null,
        null,
        null,
        null,
      ),
      // The same route and role twice: the sums add, the row is not dropped.
      prod("p1/alpha[1m]#high", "red", 10, 5, 0.8, 1.0, 0.2, 100000),
      // A role outside the ten lines, with no task. It holds the plain route
      // that the note route strips to, so an unstripped note adds a route.
      prod("p1/alpha#high", "record", 0, 0, null, null, null, null),
      prod("p1/beta", "green", 8, 4, 0.5, null, null, null),
    ];
    const { page } = pageOf("adv4-1", {
      outcomes,
      allowed: ["p1/alpha#high[1m]", "p1/beta"],
    });
    const producer = sectionOf(page, "Producer roles");
    const rows = tableRows(producer);
    // A4: exactly the two models, ranked.
    expect(rows.map((row) => row.key).sort()).toEqual(["p1/alpha", "p1/beta"]);
    expect(rankedKeys(rows).sort()).toEqual(["p1/alpha", "p1/beta"]);
    for (const row of rows) {
      expect(row.key).not.toMatch(/ \(|\[1m\]|#|ra-quota|zeta/);
    }
    expect(page, "the note text names no model row").not.toContain('data-model-key="p1/zeta');
    const alpha = rowIn(rows, "p1/alpha");
    // Tasks 10+10+40+10 = 70. Accept % = (0.8*5 + 0.4*5 + 0.8*5) / 15 = 10/15.
    // Rework = (1*10 + 2*10 + 1*10) / 30. Cleanup = (.2*10 + .4*10 + .2*10) / 30.
    // Tokens = (1e5*5 + 3e5*5 + 1e5*5) / 15. The null row adds no weight.
    expect(alpha.cells.slice(1)).toEqual(["70", "67 %", "1.3", "27 %", "167k"]);
    expect(alpha.html, "the entry #high[1m] allows p1/alpha").not.toContain('data-mark="not-allowed"');
    expect(rowIn(rows, "p1/beta").cells.slice(1)).toEqual(["8", "50 %", DASH, DASH, DASH]);
    // Six valid rows. Four distinct stripped routes: p1/alpha[1m]#high,
    // p1/alpha#high[1m], p1/alpha#high (the note route and the record row),
    // and p1/beta. An unstripped note would make five.
    expect(footerNumber(page, "footer-rows")).toBe(6);
    expect(footerNumber(page, "footer-routes")).toBe(4);
    // Red rows only: (0.8*5 + 0.8*5) / 10 = 80 %, 20 tasks. Green: p1/alpha has
    // 50 tasks and 40 % (the null row gives no weight), p1/beta has 50 % and 8.
    expectTopBlock(page, {
      red: ["p1/alpha", "80 %", "20"],
      green: ["p1/beta", "50 %", "8"],
    });
  });

  it("ADV4-2: a gate row with decided 0 adds nothing, and the variant of the busiest route counts decided, not runs", () => {
    const outcomes = [
      gate("p1/gamma[1m]#high", "review-a", 6, 6, 3, 0, { runs: 8, no_verdict: 1, open: 1 }),
      gate(
        "p1/gamma#low (ra-quota pick review-a --not-family deepseek (nested (deeper) note))",
        "review-a",
        4,
        3,
        1,
        1,
        { runs: 20, no_verdict: 8, open: 8 },
      ),
      gate("p1/gamma", "review-a", 0, 0, 0, 0, { runs: 4, no_verdict: 4 }),
      gate("p1/gamma[1m]#high", "phase-acceptance", 0, 0, 0, 0, { runs: 2, no_verdict: 2 }),
      gate("p1/delta#high", "review-a", 0, 0, 0, 0, { runs: 3, no_verdict: 3 }),
      gate("p1/delta", "review-b", 0, 0, 0, 0, { runs: 2, open: 2 }),
    ];
    const { page } = pageOf("adv4-2", {
      outcomes,
      aa: {
        gamma: { rated: true, netScore: 25, byEffort: { high: { netScore: 45 }, low: { netScore: 10 } } },
      },
      allowed: ["p1/gamma"],
    });
    const rows = tableRows(sectionOf(page, "Checker roles"));
    expect(rows.map((row) => row.key).sort(), "two models").toEqual(["p1/delta", "p1/gamma"]);
    // Runs = 6+4+0+0 = 10. Pass = 9/10. Findings = 4/10. Escapes 1. The
    // busiest route by decided is the [1m]#high route (6 against 4), so the
    // net score is byEffort.high. Counting runs would give byEffort.low.
    expect(rowIn(rows, "p1/gamma").cells.slice(1)).toEqual(["10", "90 %", "0.40", "1", "45"]);
    const delta = rowIn(rows, "p1/delta");
    expect(delta.rank, "a model with no decided run has no rank").toBeNull();
    expect(delta.cells[1], "Runs = sum of decided").toBe("0");
    expect(delta.cells[2], "no decided run gives no rate").toBe(DASH);
    expectTopBlock(page, { "review-a": ["p1/gamma", "90 %", "10"] });
  });
});

describe("ADV4 AA lookup (D16 Data source, AA net score)", () => {
  function gateModels(names: string[]): Row[] {
    return names.map((name) => gate(name, "review-a", 6, 6, 0, 0));
  }

  it("ADV4-3: a name that is a model key and also an alias resolves by one rule, not by the order of the AA file", () => {
    // h1 comes before k1, so the alias of h1 meets the key k1 first. k2 comes
    // before h2, so the key k2 meets the alias of h2 first. One rule must
    // give both names the same kind of match.
    const { page } = pageOf("adv4-3", {
      outcomes: gateModels(["p1/k1", "p1/k2"]),
      aa: {
        h1: { rated: true, netScore: 51, aliases: ["k1"] },
        k1: { rated: true, netScore: 25 },
        k2: { rated: true, netScore: 26 },
        h2: { rated: true, netScore: 52, aliases: ["k2"] },
      },
      allowed: ["p1/k1", "p1/k2"],
    });
    const rows = tableRows(sectionOf(page, "Checker roles"));
    expect(rows.map((row) => row.key).sort()).toEqual(["p1/k1", "p1/k2"]);
    const first = Number(rowIn(rows, "p1/k1").cells[5]);
    const second = Number(rowIn(rows, "p1/k2").cells[5]);
    expect([25, 51], "k1 resolves to its own entry or to the alias holder").toContain(first);
    expect([26, 52], "k2 resolves to its own entry or to the alias holder").toContain(second);
    expect(
      first === 51,
      `the key-or-alias rule must not depend on file order (k1=${first}, k2=${second})`,
    ).toBe(second === 52);
    // Orchestrator ruling 2026-11-18 (ADV-6): a direct model key wins over the
    // alias of another model, whatever the order of the file.
    expect([first, second], "a direct key wins over an alias").toEqual([25, 26]);
  });

  it("ADV4-4: a variant with no byEffort entry, a busiest route with no variant, and inherited names use the primary row", () => {
    const outcomes = [
      gate("p1/efmiss#high", "review-a", 6, 6, 0, 0),
      // The route with the most decided runs has no variant.
      gate("p1/nov", "review-a", 8, 8, 0, 0),
      gate("p1/nov#high", "review-a", 5, 5, 0, 0),
      gate("p1/ctorv#constructor", "review-a", 6, 6, 0, 0),
      gate("p1/tsv#toString", "review-a", 6, 6, 0, 0),
    ];
    const { page } = pageOf("adv4-4", {
      outcomes,
      aa: {
        efmiss: { rated: true, netScore: 30, byEffort: { low: { netScore: 11 } } },
        nov: { rated: true, netScore: 31, byEffort: { high: { netScore: 44 } } },
        ctorv: { rated: true, netScore: 33, byEffort: { high: { netScore: 46 } } },
        tsv: { rated: true, netScore: 34, byEffort: { high: { netScore: 47 } } },
      },
      allowed: ["p1/efmiss", "p1/nov", "p1/ctorv", "p1/tsv"],
    });
    const rows = tableRows(sectionOf(page, "Checker roles"));
    expect(rows.map((row) => row.key).sort()).toEqual([
      "p1/ctorv",
      "p1/efmiss",
      "p1/nov",
      "p1/tsv",
    ]);
    expect(rowIn(rows, "p1/efmiss").cells[5], "byEffort lacks high: primary row").toBe("30");
    expect(rowIn(rows, "p1/nov").cells[5], "busiest route has no variant: primary row").toBe("31");
    expect(rowIn(rows, "p1/ctorv").cells[5], "variant constructor: primary row").toBe("33");
    expect(rowIn(rows, "p1/tsv").cells[5], "variant toString: primary row").toBe("34");
  });

  it("ADV4-5: a route variant named __proto__ finds no byEffort entry and uses the primary row", () => {
    // The variant is the text after "#". byEffort has no own key __proto__,
    // so the entry is absent and the primary row applies (D16: byEffort when
    // that entry is present, else the primary row).
    const { page } = pageOf("adv4-5", {
      outcomes: [gate("p1/protov#__proto__", "review-a", 6, 6, 0, 0)],
      aa: { protov: { rated: true, netScore: 32, byEffort: { high: { netScore: 46 } } } },
      allowed: ["p1/protov"],
    });
    const rows = tableRows(sectionOf(page, "Checker roles"));
    expect(rows.map((row) => row.key)).toEqual(["p1/protov"]);
    const row = rowIn(rows, "p1/protov");
    expect(row.cells[5], "the primary net score of 32").toBe("32");
    expect(row.html, "32 is at or above 20, so no verdict mark").not.toContain('data-mark="not-for-verdicts"');
  });
});

describe("ADV4 allowed list and the pick filters (D16 Data source, Allowed list, Top block)", () => {
  it("ADV4-6: allowed entries with [1m] and #variant in any order allow their model, and an empty list allows none", () => {
    const route = (name: string) => prod(name, "green", 6, 3, 0.5, 1.0, 0.1, 1000);
    const outcomes = [
      route("p1/m1"),
      route("p1/m2#low"),
      route("p1/m3"),
      route("p1/m4[1m]"),
      route("p1/m5#high"),
      route("p1/m6"),
      route("q1/m1"),
    ];
    const allowedBuild = pageOf("adv4-6a", {
      outcomes,
      allowed: ["p1/m1[1m]", "p1/m2#high", "p1/m3[1m]#high", "p1/m4#high[1m]"],
      orchestrator: ["p1/m5[1m]#low"],
    });
    const rows = tableRows(sectionOf(allowedBuild.page, "Producer roles"));
    expect(rows).toHaveLength(7);
    const marked = rows.filter((row) => row.html.includes('data-mark="not-allowed"')).map((row) => row.key);
    expect(marked.sort(), "only a model outside the list, and the same model on another provider").toEqual([
      "p1/m6",
      "q1/m1",
    ]);

    const emptyBuild = pageOf("adv4-6b", { outcomes, allowed: [], orchestrator: [] });
    const emptyRows = tableRows(sectionOf(emptyBuild.page, "Producer roles"));
    expect(emptyRows).toHaveLength(7);
    for (const row of emptyRows) {
      expect(row.html, `${row.key} is not allowed with an empty list`).toContain('data-mark="not-allowed"');
    }
    expectTopBlock(emptyBuild.page, {});
  });

  it("ADV4-7: the pick skips a not-allowed, unrated, and under-20 row, and takes the first row that passes", () => {
    const outcomes = [
      gate("p1/ra-na", "review-a", 10, 10, 0, 0),
      gate("p1/ra-un", "review-a", 9, 9, 0, 0),
      gate("p1/ra-lo", "review-a", 8, 8, 0, 0),
      gate("p1/ra-ok", "review-a", 7, 7, 0, 0),
      gate("p1/rb-na", "review-b", 8, 8, 0, 0),
      gate("p1/rc-un", "review-c", 8, 8, 0, 0),
      gate("p1/ad-lo", "adversarial", 6, 6, 0, 0),
      gate("p1/ad-ok", "adversarial", 5, 4, 0, 0),
      prod("p1/rd-nr", "red", 6, 3, 0.5, 1.0, 0.1, 1000),
    ];
    const { page } = pageOf("adv4-7", {
      outcomes,
      aa: {
        "ra-na": { rated: true, netScore: 60 },
        // rated false wins over a stored score.
        "ra-un": { rated: false, netScore: 55 },
        "ra-lo": { rated: true, netScore: 19.99 },
        "ra-ok": { rated: true, netScore: 20 },
        "rb-na": { rated: true, netScore: 40 },
        "rc-un": { rated: false },
        "ad-lo": { rated: true, netScore: 19.99 },
        "ad-ok": { rated: true, netScore: 25 },
      },
      allowed: ["p1/ra-un", "p1/ra-lo", "p1/ra-ok", "p1/rc-un", "p1/ad-lo", "p1/ad-ok", "p1/rd-nr"],
    });
    const checker = tableRows(sectionOf(page, "Checker roles"));
    expect(checker).toHaveLength(8);
    const un = rowIn(checker, "p1/ra-un");
    expect(un.cells[5], "rated false gives not rated even with a score").toBe("not rated");
    expect(un.html).toContain('data-mark="not-for-verdicts"');
    expect(rowIn(checker, "p1/ra-lo").html, "19.99 is under 20").toContain('data-mark="not-for-verdicts"');
    expect(rowIn(checker, "p1/ra-ok").html, "20 is not under 20").not.toContain("data-mark=");
    expect(rowIn(checker, "p1/ra-na").html).toContain('data-mark="not-allowed"');
    expectTopBlock(page, {
      // Not allowed, unrated, and 19.99 rank above ra-ok and never pick.
      red: ["p1/rd-nr", "50 %", "6"],
      "review-a": ["p1/ra-ok", "100 %", "7"],
      // A role with only a not-allowed row, and a role with only an unrated row.
      "review-b": null,
      "review-c": null,
      // The 100 % row has net 19.99, so the 80 % row picks.
      adversarial: ["p1/ad-ok", "80 %", "5"],
    });
  });
});

describe("ADV4 ties in the rank keys (D16 Data source, FR-3)", () => {
  const greenRows = (): Row[] => [
    prod("p1/ga", "green", 6, 3, 0.5, 1.0, 0.1, 1000),
    prod("p1/gb", "green", 9, 3, 0.5, 1.0, 0.1, 1000),
    // gc has the lowest rework and the same task count as ga, so only the
    // rework key can put it first. gb has more tasks than ga and gd.
    prod("p1/gc", "green", 6, 3, 0.5, 0.5, 0.1, 1000),
    prod("p1/gd", "green", 6, 3, 0.5, 1.0, 0.1, 1000),
  ];
  const gateRows = (): Row[] => [
    gate("p1/xa", "review-a", 10, 8, 0, 1),
    gate("p1/xb", "review-a", 5, 4, 0, 0),
    gate("p1/xe", "review-a", 10, 8, 0, 0),
  ];

  function build(tag: string, reverse: boolean) {
    const producerRows = reverse ? greenRows().reverse() : greenRows();
    const checkerRows = reverse ? gateRows().reverse() : gateRows();
    return pageOf(tag, {
      outcomes: [...producerRows, ...checkerRows],
      aa: { xa: { netScore: 30 }, xb: { netScore: 30 }, xe: { netScore: 30 } },
      allowed: ["p1/ga", "p1/gb", "p1/gc", "p1/gd", "p1/xa", "p1/xb", "p1/xe"],
    }).page;
  }

  it("ADV4-8: producer ties go to the lower rework, then more tasks, and checker ties to the net score, findings per run, more runs, then the model key, and row order changes nothing", () => {
    const forward = build("adv4-8a", false);
    const backward = build("adv4-8b", true);
    for (const page of [forward, backward]) {
      const producer = tableRows(sectionOf(page, "Producer roles"));
      expect(producer, "four producer rows").toHaveLength(4);
      const order = rankedKeys(producer);
      expect(order, "four ranked producer rows").toHaveLength(4);
      // The same accept % for all. gc has the lowest rework. gb has more
      // tasks than ga and gd. ga and gd tie in every key.
      expect(order.slice(0, 2)).toEqual(["p1/gc", "p1/gb"]);
      expect(order.slice(2).sort()).toEqual(["p1/ga", "p1/gd"]);
      const checker = tableRows(sectionOf(page, "Checker roles"));
      // All three hold net 30 and no findings. xa and xe have 10 runs and
      // xb has 5, so xb ranks last; xa and xe tie on every key, and the
      // model key puts p1/xa before p1/xe. Escapes take no part.
      expect(rankedKeys(checker)).toEqual(["p1/xa", "p1/xe", "p1/xb"]);
    }
    expect(
      rankedKeys(tableRows(sectionOf(backward, "Producer roles"))),
      "a full tie keeps one order whatever the order of the rows",
    ).toEqual(rankedKeys(tableRows(sectionOf(forward, "Producer roles"))));
    expectTopBlock(forward, {
      green: ["p1/gc", "50 %", "6"],
      "review-a": ["p1/xa", "80 %", "10"],
    });
  });

  it("ADV4-9: two models with the same stated accept rate tie, so the lower rework ranks first", () => {
    // Both rows state first_round_rate 0.7. A single row is the weighted mean
    // of one value, so both models hold the rate 0.7 and show 70 %. The tie
    // goes to the lower rework (na), not to the order of float rounding noise.
    const { page } = pageOf("adv4-9", {
      outcomes: [
        prod("p1/na", "green", 10, 3, 0.7, 0.5, 0.1, 1000),
        prod("p1/nb", "green", 10, 10, 0.7, 2.0, 0.1, 1000),
      ],
      allowed: ["p1/na", "p1/nb"],
    });
    const rows = tableRows(sectionOf(page, "Producer roles"));
    expect(rows).toHaveLength(2);
    expect(rowIn(rows, "p1/na").cells[2]).toBe("70 %");
    expect(rowIn(rows, "p1/nb").cells[2]).toBe("70 %");
    expect(rankedKeys(rows), "equal rate: lower rework first").toEqual(["p1/na", "p1/nb"]);
    expectTopBlock(page, { green: ["p1/na", "70 %", "10"] });
  });
});

describe("ADV4 footer numbers and rounding (D16 Data source, Coverage, Numbers)", () => {
  const gateOf = (route: string, role: string) => gate(route, role, 6, 6, 0, 0);

  it("ADV4-10: the footer is right with no unknown row, with only unknown rows, and with a share that needs one decimal", () => {
    const none = pageOf("adv4-10a", {
      outcomes: [prod("p1/f1", "green", 6, 3, 0.5, 1.0, 0.1, 1000), gateOf("p1/f2", "review-a"), gateOf("p1/f3 (note)", "review-b")],
      allowed: ["p1/f1", "p1/f2", "p1/f3"],
    }).page;
    expect(footerNumber(none, "footer-rows")).toBe(3);
    expect(footerNumber(none, "footer-routes")).toBe(3);
    expect(footerNumber(none, "footer-unknown-rows")).toBe(0);
    expect(footerText(none, "footer-unknown-share"), "no unknown row gives 0.0 %").toBe("0.0 %");

    const all = pageOf("adv4-10b", {
      outcomes: [
        gateOf("unknown", "review-a"),
        gateOf("unknown (probe note)", "review-b"),
        gateOf("unknown", "adversarial"),
      ],
    }).page;
    expect(footerNumber(all, "footer-rows")).toBe(3);
    expect(footerNumber(all, "footer-routes"), "one distinct route, unknown included").toBe(1);
    expect(footerNumber(all, "footer-unknown-rows")).toBe(3);
    expect(footerText(all, "footer-unknown-share")).toBe("100.0 %");
    expect(page_hasDataRow(all), "unknown rows show in no table").toBe(false);
    expectTopBlock(all, {});

    for (const [unknownCount, share] of [
      [1, "33.3 %"],
      [2, "66.7 %"],
    ] as Array<[number, string]>) {
      const outcomes = [
        ...Array.from({ length: unknownCount }, (_, i) => gateOf("unknown", `review-${["a", "b"][i]}`)),
        ...Array.from({ length: 3 - unknownCount }, () => gateOf("p1/third", "review-c")),
      ];
      const page = pageOf(`adv4-10c${unknownCount}`, { outcomes }).page;
      expect(footerNumber(page, "footer-rows")).toBe(3);
      expect(footerNumber(page, "footer-unknown-rows")).toBe(unknownCount);
      expect(footerText(page, "footer-unknown-share"), `${unknownCount} of 3 rows`).toBe(share);
    }
  });

  it("ADV4-11: one rounding step gives the whole percent and the one-decimal rework, with no earlier rounding", () => {
    // 0.04996 rounds to 0.0 at one decimal. 12.496 % rounds to 12 %.
    const { page } = pageOf("adv4-11", {
      outcomes: [prod("p1/rnd", "green", 10, 8, 0.5, 0.04996, 0.12496, 100000)],
      allowed: ["p1/rnd"],
    });
    const rows = tableRows(sectionOf(page, "Producer roles"));
    expect(rows.map((row) => row.key)).toEqual(["p1/rnd"]);
    expect(rowIn(rows, "p1/rnd").cells.slice(1)).toEqual(["10", "50 %", "0.0", "12 %", "100k"]);
  });
});

function page_hasDataRow(page: string): boolean {
  return (
    tableRows(sectionOf(page, "Producer roles")).length > 0 ||
    tableRows(sectionOf(page, "Checker roles")).length > 0
  );
}

describe("ADV4 print-audit names (D17, FR-5)", () => {
  it("ADV4-12: a route key with [1m] before #variant maps to a plain name and leaves no route text in the block", () => {
    const { page } = pageOf(
      "adv4-12",
      { outcomes: [prod("p1/x", "green", 6, 3, 0.5, 1.0, 0.1, 1000)], allowed: ["p1/x"] },
      {
        names: { "p1/opus": "Opus Plain", "p1/sonnet": "Sonnet Plain" },
        auditRoutes: {
          "p1/opus[1m]#high": "13 of 13",
          "p1/sonnet#high[1m]": "9 of 13",
        },
      },
    );
    const at = page.indexOf("<h2>Print audit</h2>");
    expect(at, "the page holds a Print audit heading").toBeGreaterThan(-1);
    const block = page.slice(at, page.indexOf("</section>", at));
    const items = [...block.matchAll(/data-mg="audit-result"[^>]*>([\s\S]*?)<\/li>/g)].map((m) =>
      textOf(m[1]),
    );
    expect(items, "one item for each route").toHaveLength(2);
    const sonnet = items.find((text) => text.includes("Sonnet Plain"));
    expect(sonnet, `a #variant[1m] key shows its plain name: ${JSON.stringify(items)}`).toBeDefined();
    expect(sonnet).toContain("9 of 13");
    const opus = items.find((text) => text.includes("Opus Plain"));
    expect(opus, `a [1m]#variant key shows its plain name: ${JSON.stringify(items)}`).toBeDefined();
    expect(opus).toContain("13 of 13");
    expect(block, "the block holds no route text").not.toContain("[1m]");
  });
});

describe("ADV4 metamorphic and parallel runs", () => {
  interface Summary {
    producer: { ranked: string[]; few: string[] };
    checker: { ranked: string[]; few: string[] };
    picks: Array<[string | null, string | null, string, string, boolean]>;
    footer: string[];
  }

  function summaryOf(page: string): Summary {
    const side = (section: string) => {
      const rows = tableRows(section);
      return {
        ranked: rows.filter((row) => row.rank !== null).map((row) => `${row.rank}:${row.key}:${row.cells.join("|")}`),
        few: rows.filter((row) => row.rank === null).map((row) => `${row.key}:${row.cells.join("|")}`).sort(),
      };
    };
    return {
      producer: side(sectionOf(page, "Producer roles")),
      checker: side(sectionOf(page, "Checker roles")),
      picks: picksOf(page).map((pick) => [pick.role, pick.key, pick.rate, pick.count, pick.none]),
      footer: [
        "footer-rows",
        "footer-routes",
        "footer-unknown-rows",
        "footer-unknown-share",
        "footer-read-date",
        "footer-export-date",
      ].map((hook) => footerText(page, hook)),
    };
  }

  function seeded(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("ADV4-13: the same rows in another order give the same page", () => {
    const outcomes: Row[] = JSON.parse(readFileSync(join(PAGE_B, `ra-outcomes-${DATE}.json`), "utf8"));
    const aa = JSON.parse(readFileSync(join(PAGE_B, `aa-reliability-${DATE}.json`), "utf8")).models;
    const allowedDoc = JSON.parse(readFileSync(join(PAGE_B, `allowed-routes-${DATE}.json`), "utf8"));
    expect(outcomes.length, "the fixture holds rows").toBeGreaterThan(30);
    const build = (tag: string, rows: Row[]) =>
      pageOf(tag, {
        outcomes: rows,
        aa,
        allowed: allowedDoc.allowedRoutes,
        orchestrator: allowedDoc.orchestratorRoutes,
      }).page;
    const base = summaryOf(build("adv4-13-base", outcomes));
    expect(base.producer.ranked.length, "A4: the base page ranks producers").toBeGreaterThan(5);
    expect(base.checker.ranked.length, "A4: the base page ranks checkers").toBeGreaterThan(5);
    const random = seeded(20261118);
    const shuffled = [...outcomes].sort(() => random() - 0.5);
    const rotated = [...outcomes.slice(7), ...outcomes.slice(0, 7)];
    for (const [tag, rows] of [
      ["reverse", [...outcomes].reverse()],
      ["rotate", rotated],
      ["shuffle", shuffled],
    ] as Array<[string, Row[]]>) {
      expect(summaryOf(build(`adv4-13-${tag}`, rows)), `${tag} order`).toEqual(base);
    }
  });

  it("ADV4-14: two builds at the same time into two preview folders stay apart", async () => {
    const root = makeRepo("adv4-14");
    const first = writeStaged(join(root, "fixture-a"), {
      outcomes: [prod("p1/solo-a", "green", 6, 3, 0.5, 1.0, 0.1, 1000)],
      allowed: ["p1/solo-a"],
      date: "2026-10-20",
    });
    const second = writeStaged(join(root, "fixture-c"), {
      outcomes: [prod("p1/solo-b", "green", 7, 3, 0.5, 1.0, 0.1, 1000)],
      allowed: ["p1/solo-b"],
      date: "2026-10-21",
    });
    const script = join(root, "harness", "model-guide", "preview.sh");
    const run = (manifest: string, preview: string) =>
      new Promise<{ status: number | null; output: string }>((done) => {
        const child = spawn("bash", [script, "--manifest", manifest, "--preview", preview], {
          cwd: root,
          env: env(),
        });
        let output = "";
        child.stdout.on("data", (chunk) => (output += chunk));
        child.stderr.on("data", (chunk) => (output += chunk));
        child.on("close", (status) => done({ status, output }));
      });
    const previewA = join(root, ".tmp", "adv-a");
    const previewB = join(root, ".tmp", "adv-b");
    const [a, b] = await Promise.all([run(first, previewA), run(second, previewB)]);
    expect(a.status, a.output).toBe(0);
    expect(b.status, b.output).toBe(0);
    const pageA = readFileSync(join(previewA, "real-work.html"), "utf8");
    const pageB = readFileSync(join(previewB, "real-work.html"), "utf8");
    expect(pageA).toContain('data-model-key="p1/solo-a"');
    expect(pageA, "page A holds no row of run B").not.toContain("p1/solo-b");
    expect(footerText(pageA, "footer-read-date")).toBe("2026-10-20");
    expect(pageB).toContain('data-model-key="p1/solo-b"');
    expect(pageB, "page B holds no row of run A").not.toContain("p1/solo-a");
    expect(footerText(pageB, "footer-read-date")).toBe("2026-10-21");
  }, 120_000);
});

describe("ADV4 the leak check reads a route note as data (A7)", () => {
  function leakRun(rows: unknown[], privateDir: string) {
    const repo = tempDir("leak-repo");
    spawnSync("git", ["init", "-q"], { cwd: repo });
    const name = `ra-outcomes-${DATE}.json`;
    writeFileSync(join(repo, name), `${JSON.stringify(rows, null, 2)}\n`);
    spawnSync("git", ["add", "--", name], { cwd: repo });
    return spawnSync(
      join(HARNESS, "node_modules", ".bin", "tsx"),
      ["model-guide/leak-check.ts", "--private", privateDir, "--repo", repo],
      { cwd: HARNESS, env: env(), encoding: "utf8", timeout: 60_000 },
    );
  }

  it("ADV4-15: filter words in a note hide neither a real key field nor the private path, and prose alone passes", () => {
    const privateDir = tempDir("leak-private");
    const prose = prod(
      "p1/leak-a#high (never use the operator; do not witness new_lines)",
      "green",
      6,
      3,
      0.5,
      1.0,
      0.1,
      1000,
    );
    const control = leakRun([prose], privateDir);
    expect(control.status, `prose alone passes: ${control.stdout}${control.stderr}`).toBe(0);

    const withKey = leakRun([prose, { ...prod("p1/leak-b", "green", 6, 3, 0.5, 1.0, 0.1, 1000), operator: "x" }], privateDir);
    expect(withKey.status, `${withKey.stdout}${withKey.stderr}`).toBe(2);
    expect(withKey.stdout).toMatch(
      new RegExp(`^leak-check: key-field: ra-outcomes-${DATE}\\.json operator$`, "m"),
    );

    const withPath = leakRun(
      [prod(`p1/leak-c (do not copy; never share ${privateDir}/sets)`, "green", 6, 3, 0.5, 1.0, 0.1, 1000)],
      privateDir,
    );
    expect(withPath.status, `${withPath.stdout}${withPath.stderr}`).toBe(2);
    expect(withPath.stdout).toMatch(
      new RegExp(`^leak-check: private-path: ra-outcomes-${DATE}\\.json$`, "m"),
    );
  }, 120_000);
});

// ---------------------------------------------------------- browser cases

const LONG_NAMES: Record<string, string> = {
  "p1/bm-a": "Muse Spark 1.3 Contributor",
  "p1/bm-b": "DeepSeek V4.1 Flash (free)",
  "p1/bm-c": "MiniMax M3.1 Flash (free)",
};
const UNBREAKABLE = `p1/${"x".repeat(120)}`;

/** Realistic names, long enough to wrap. The hostile page adds one name with
 * no break point, which widens the table of the whole page. */
function layoutInput(hostile: boolean): Input {
  const keys = [...Object.keys(LONG_NAMES), "p1/Experimental-Reasoning-Model-Alpha-Preview"];
  if (hostile) keys.push(UNBREAKABLE);
  const outcomes: Row[] = [];
  for (const key of keys) {
    outcomes.push(prod(key, "green", 12, 6, 0.5, 1.0, 0.1, 100000));
    outcomes.push(gate(key, "review-a", 8, 6, 2, 0));
  }
  return {
    outcomes,
    // Only the second model is allowed, so the other rows carry marks.
    allowed: ["p1/bm-b"],
    aa: { "bm-b": { rated: true, netScore: 40 } },
  };
}

describe("ADV4 layout in a browser (D16 Data source Width, D16 Width)", () => {
  let browser: any = null;
  let realisticFile = "";
  let hostileFile = "";

  async function launch(): Promise<any> {
    const { chromium } = await import("playwright");
    const reasons: string[] = [];
    for (const options of [{ channel: "chrome" }, {}]) {
      try {
        return await chromium.launch(options as any);
      } catch (error) {
        reasons.push(String(error).split("\n")[0]);
      }
    }
    throw new Error(`no browser started: ${reasons.join(" | ")}`);
  }

  beforeAll(async () => {
    const realistic = makeRepo("adv4-layout", { names: LONG_NAMES, realCss: true });
    buildPage(realistic, writeStaged(join(realistic, "fixture-b"), layoutInput(false)));
    realisticFile = join(previewFolder(realistic), "real-work.html");
    const hostile = makeRepo("adv4-layout-hostile", { names: LONG_NAMES, realCss: true });
    buildPage(hostile, writeStaged(join(hostile, "fixture-b"), layoutInput(true)));
    hostileFile = join(previewFolder(hostile), "real-work.html");
    browser = await launch();
  }, 120_000);

  afterAll(async () => {
    if (browser) await browser.close();
  });

  async function measure(file: string, width: number, height: number, script: string): Promise<any> {
    const page = await browser.newPage({ viewport: { width, height } });
    try {
      // Only the page and its own files load. A font request fails at once.
      await page.route("**/*", (route: any) =>
        route.request().url().startsWith("file://") ? route.continue() : route.abort(),
      );
      await page.goto(pathToFileURL(file).href);
      return await page.evaluate(script);
    } finally {
      await page.close();
    }
  }

  const LINES = `
    const clusters = (tops) => {
      const sorted = [...tops].sort((a, b) => a - b);
      let count = 0;
      let last = -1e9;
      for (const top of sorted) {
        if (top - last > 6) count += 1;
        last = top;
      }
      return count;
    };
    const linesOf = (cell) => {
      let lines = 0;
      let text = "";
      for (const node of cell.childNodes) {
        if (node.nodeType === 3 && node.textContent.trim() !== "") {
          const range = document.createRange();
          range.selectNodeContents(node);
          lines = clusters([...range.getClientRects()].map((rect) => rect.top));
          text = node.textContent.trim();
        }
      }
      return { lines, text };
    };
  `;

  it("ADV4-16: at 390 px a plain model name wraps to 2 lines or fewer in both default tables", async () => {
    const rows: Array<{ table: string; text: string; lines: number; width: number }> = await measure(
      realisticFile,
      390,
      844,
      `(() => { ${LINES}
        const out = [];
        for (const table of document.querySelectorAll('table[data-mg="default-table"]')) {
          const heading = table.closest("section").querySelector("h2").textContent.trim();
          for (const cell of table.querySelectorAll('td[data-mg="model-name"]')) {
            const found = linesOf(cell);
            out.push({ table: heading, text: found.text, lines: found.lines, width: Math.round(cell.getBoundingClientRect().width) });
          }
        }
        return out;
      })()`,
    );
    const named = rows.filter((row) => Object.values(LONG_NAMES).includes(row.text));
    // A4: both tables show the three long names.
    expect(named, JSON.stringify(rows)).toHaveLength(6);
    const wide = named.filter((row) => row.lines > 2);
    expect(
      wide,
      `spec D16 Width: a model name does not wrap to 3 lines at 390 px, got ${JSON.stringify(
        named.map((row) => `${row.table}: ${row.text} = ${row.lines} lines in ${row.width} px`),
      )}`,
    ).toEqual([]);
  }, 120_000);

  it("ADV4-17: the number cells do not wrap, the page has no sideways overflow, and the SHA-256 values stay in the footer card", async () => {
    for (const [name, file] of [
      ["realistic", realisticFile],
      ["hostile", hostileFile],
    ] as Array<[string, string]>) {
      for (const [width, height] of [
        [390, 844],
        [980, 800],
        [1280, 800],
      ] as Array<[number, number]>) {
        const tag = `${name} page at ${width} px`;
        const result = await measure(
          file,
          width,
          height,
          `(() => { ${LINES}
            const numbers = [];
            for (const table of document.querySelectorAll('table[data-mg="default-table"]')) {
              for (const cell of table.querySelectorAll("td.num")) numbers.push(linesOf(cell).lines);
            }
            const sha = [...document.querySelectorAll('[data-mg="footer-sha256"]')].map((el) => {
              const card = el.closest(".card").getBoundingClientRect();
              return {
                length: el.textContent.trim().length,
                fits: el.scrollWidth <= el.clientWidth + 1,
                inside: el.getBoundingClientRect().right <= card.right + 1,
              };
            });
            return {
              scrollWidth: document.documentElement.scrollWidth,
              clientWidth: document.documentElement.clientWidth,
              numbers,
              sha,
            };
          })()`,
        );
        expect(result.numbers.length, `${tag}: A4 number cells exist`).toBeGreaterThan(10);
        expect(Math.max(...result.numbers), `${tag}: a number cell wraps`).toBeLessThanOrEqual(1);
        expect(result.scrollWidth, `${tag}: sideways overflow`).toBeLessThanOrEqual(result.clientWidth);
        expect(result.sha, `${tag}: three SHA-256 values`).toHaveLength(3);
        for (const item of result.sha) {
          expect(item.length).toBe(64);
          expect(item.fits, `${tag}: a SHA-256 is clipped`).toBe(true);
          expect(item.inside, `${tag}: a SHA-256 leaves its card`).toBe(true);
        }
      }
    }
  }, 120_000);

  it("ADV4-18: each table that scrolls inside its own box shows a visible scroll hint", async () => {
    const problems: string[] = [];
    for (const [width, height] of [
      [390, 844],
      [980, 800],
      [1280, 800],
    ] as Array<[number, number]>) {
      const wraps: Array<{ label: string; hint: boolean }> = await measure(
        realisticFile,
        width,
        height,
        `(() => {
          for (const details of document.querySelectorAll("details")) details.open = true;
          const out = [];
          for (const wrap of document.querySelectorAll(".table-wrap")) {
            if (wrap.scrollWidth <= wrap.clientWidth + 1) continue;
            const hint = wrap.nextElementSibling;
            const visible = !!hint && hint.classList.contains("scroll-hint") &&
              getComputedStyle(hint).display !== "none" && hint.getBoundingClientRect().height > 0;
            out.push({ label: wrap.getAttribute("aria-label") || "", hint: visible });
          }
          return out;
        })()`,
      );
      if (width === 390) {
        expect(wraps.length, "A4: tables scroll at 390 px").toBeGreaterThan(0);
      }
      for (const wrap of wraps) {
        if (!wrap.hint) problems.push(`${width} px: ${wrap.label}`);
      }
    }
    expect(
      problems,
      "spec D16 Width: a wide table scrolls inside its own box and shows a visible scroll hint",
    ).toEqual([]);
  }, 120_000);
});
