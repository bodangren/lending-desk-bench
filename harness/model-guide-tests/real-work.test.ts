import { spawnSync } from "node:child_process";
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
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Red tests for plan task 4.1e: the merge, the ranks, the marks, the AA
 * net score, the allowed list, and the top block of the Data source block
 * (spec D16 "Data source (PM 2026-11-17)" rules, Tool details). Groups DS4
 * to DS13 (test-strategy 13.4). The cases build the page through
 * `harness/model-guide/preview.sh` and read the `data-mg` hooks of section
 * 13.6.
 *
 * Pinned CLI (spec Q-S1):
 *   bash harness/model-guide/preview.sh --manifest <MANIFEST-date.txt> \
 *     [--preview <folder>]
 * Usage line: `usage: preview.sh --manifest <file> [--preview <folder>]`
 *
 * The tests pin no field of `real-work.json` (the spec names none). Every
 * computed value comes from a `data-mg` hook and a labeled parse (A3).
 * The fixture is `fixtures/page-b/` with the sentinel date 2026-10-20. No
 * test reads a real dated file, the real docs/, a model, the network, or
 * the private folder.
 */

const HARNESS = resolve(import.meta.dirname, "..");
const SOURCE = join(HARNESS, "model-guide");
const PREVIEW_SH = join(SOURCE, "preview.sh");
const PAGE_B = join(import.meta.dirname, "fixtures", "page-b");

const DATE = "2026-10-20";
const OUTCOMES_NAME = `ra-outcomes-${DATE}.json`;
const AA_NAME = `aa-reliability-${DATE}.json`;
const ALLOWED_NAME = `allowed-routes-${DATE}.json`;
const MANIFEST_NAME = `MANIFEST-${DATE}.txt`;

const INDEX_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Overview</title>
<link rel="stylesheet" href="./assets/css/site.css"></head>
<body><nav><a href="./methodology.html">Methodology</a>
<a href="./results.html">Results</a><a href="./models/">Models</a>
<a href="./tracks.html">Tracks</a></nav>
<main><h1>Overview</h1></main></body></html>
`;

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `model-guide-real-work-${tag}-`));
  roots.push(dir);
  return dir;
}

function requireProduction(): void {
  if (!existsSync(PREVIEW_SH)) throw new Error(`production file is missing: ${PREVIEW_SH}`);
}

function env(): NodeJS.ProcessEnv {
  const copy = { ...process.env, NO_COLOR: "1", npm_config_loglevel: "silent" };
  delete copy.BENCH_TRACK;
  return copy;
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function manifestLine(file: string, name: string): string {
  const data = readFileSync(file);
  return `${createHash("sha256").update(data).digest("hex")}  ${data.length}  ${name}`;
}

/** A temp repo with docs/, the model-guide folder, and the staged page B
 * fixture set. `mutate` may replace the staged outcomes array or the
 * allowed list before the manifest is written. */
function repoFixture(
  tag: string,
  mutate?: { outcomes?: (rows: any[]) => void; allowed?: (doc: any) => void },
): string {
  requireProduction();
  const root = tempDir(`repo-${tag}`);
  mkdirSync(join(root, "harness"), { recursive: true });
  cpSync(SOURCE, join(root, "harness", "model-guide"), { recursive: true });
  mkdirSync(join(root, "docs", "assets", "css"), { recursive: true });
  mkdirSync(join(root, "docs", "assets", "data"), { recursive: true });
  writeFileSync(join(root, "docs", "index.html"), INDEX_HTML);
  writeFileSync(join(root, "docs", "assets", "css", "site.css"), "body { font-family: sans-serif; }\n");
  writeFileSync(
    join(root, "docs", "assets", "data", "benchmark.json"),
    '{"schema":1,"rows":[]}\n',
  );
  mkdirSync(join(root, "measure", "tracks", "model_guide"), { recursive: true });

  const staged = join(root, "fixture-b");
  mkdirSync(staged, { recursive: true });

  let outcomesText = readFileSync(join(PAGE_B, OUTCOMES_NAME), "utf8");
  if (mutate?.outcomes) {
    const rows = JSON.parse(outcomesText);
    mutate.outcomes(rows);
    outcomesText = JSON.stringify(rows, null, 2) + "\n";
  }
  writeFileSync(join(staged, OUTCOMES_NAME), outcomesText);

  writeFileSync(join(staged, AA_NAME), readFileSync(join(PAGE_B, AA_NAME)));

  let allowedText = readFileSync(join(PAGE_B, ALLOWED_NAME), "utf8");
  if (mutate?.allowed) {
    const doc = JSON.parse(allowedText);
    mutate.allowed(doc);
    allowedText = JSON.stringify(doc, null, 2) + "\n";
  }
  writeFileSync(join(staged, ALLOWED_NAME), allowedText);

  writeFileSync(
    join(staged, MANIFEST_NAME),
    [
      manifestLine(join(staged, OUTCOMES_NAME), OUTCOMES_NAME),
      manifestLine(join(staged, AA_NAME), AA_NAME),
      manifestLine(join(staged, ALLOWED_NAME), ALLOWED_NAME),
      "",
    ].join("\n"),
  );
  symlinkSync(join(HARNESS, "node_modules"), join(root, "harness", "node_modules"));
  return root;
}

function manifestOf(root: string): string {
  return join(root, "fixture-b", MANIFEST_NAME);
}

function runPreview(root: string) {
  return spawnSync(
    "bash",
    [join(root, "harness", "model-guide", "preview.sh"), "--manifest", manifestOf(root)],
    { cwd: root, env: env(), encoding: "utf8", timeout: 120_000 },
  );
}

function previewFolder(root: string): string {
  return join(root, ".tmp", "model-guide-preview");
}

function buildPage(root: string): string {
  const result = runPreview(root);
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const file = join(previewFolder(root), "real-work.html");
  expect(existsSync(file), `missing ${file}`).toBe(true);
  return readFileSync(file, "utf8");
}

let baseCache: string | null = null;
/** The page built once from the base fixture and shared by DS4 to DS13. */
function basePage(): string {
  if (!baseCache) baseCache = buildPage(repoFixture("base"));
  return baseCache;
}

let namedCache: string | null = null;
/** The page with two keys renamed to a named and an unnamed model key. */
function namedKeyPage(): string {
  if (!namedCache) {
    namedCache = buildPage(
      repoFixture("names", {
        outcomes: (rows) => {
          for (const row of rows) {
            if (row.route === "t1/prod-five") row.route = "kimi-code-plan-cn/kimi-for-coding";
            if (row.route === "t1/prod-six") row.route = "opencode-go/synthetic-unknown";
          }
        },
      }),
    );
  }
  return namedCache;
}

function unescape(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&");
}

function sectionOf(page: string, heading: string): string {
  const at = page.indexOf(`<h2>${heading}</h2>`);
  expect(at, `the page holds a ${heading} heading`).toBeGreaterThan(-1);
  const end = page.indexOf("</section>", at);
  expect(end, `the ${heading} section closes`).toBeGreaterThan(at);
  return page.slice(at, end);
}

interface Row {
  key: string;
  rank: string | null;
  cells: string[];
  html: string;
}

function rowsOf(region: string): Row[] {
  const out: Row[] = [];
  for (const m of region.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g)) {
    const raw = m[1].match(/\bdata-model-key="([^"]*)"/)?.[1];
    if (raw === undefined) continue;
    out.push({
      key: unescape(raw),
      rank: m[1].match(/\bdata-rank="([^"]*)"/)?.[1] ?? null,
      cells: [...m[2].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((cell) =>
        cell[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(),
      ),
      html: m[0],
    });
  }
  return out;
}

function headersOf(table: string): string[] {
  return [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) =>
    m[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(),
  );
}

function defaultTableOf(section: string, label: string): string {
  const m = section.match(/<table\b[^>]*data-mg="default-table"[^>]*>[\s\S]*?<\/table>/);
  expect(m, `${label} holds a default table`).toBeTruthy();
  return m![0];
}

function fewGroupRows(section: string, label: string): Row[] {
  const at = section.indexOf('data-mg="too-few"');
  expect(at, `${section ? label : label} holds a Too few tasks group`).toBeGreaterThan(-1);
  const open = section.lastIndexOf("<details", at);
  const end = section.indexOf("</details>", at);
  expect(end, "the too-few group closes").toBeGreaterThan(at);
  return rowsOf(section.slice(open < 0 ? at : open, end));
}

function rowIn(region: string, key: string): Row {
  const found = rowsOf(region).find((row) => row.key === key);
  expect(found, `row ${key} exists`).toBeDefined();
  return found!;
}

function rankedKeys(section: string): string[] {
  return rowsOf(section)
    .filter((row) => row.rank !== null)
    .map((row) => row.key);
}

function hookText(region: string, hook: string): string {
  const at = region.indexOf(`data-mg="${hook}"`);
  expect(at, `the page holds data-mg="${hook}"`).toBeGreaterThan(-1);
  const open = region.lastIndexOf("<", at);
  const tag = region.slice(open, region.indexOf(">", at) + 1);
  const tagName = tag.match(/^<([a-zA-Z][\w-]*)/)?.[1];
  expect(tagName, `the ${hook} hook sits on an element`).toBeTruthy();
  const bodyStart = region.indexOf(">", at) + 1;
  const close = region.indexOf(`</${tagName}>`, bodyStart);
  expect(close, `the ${hook} element closes`).toBeGreaterThan(bodyStart);
  return region.slice(bodyStart, close).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function hookElementRegion(region: string, hook: string): string {
  const at = region.indexOf(`data-mg="${hook}"`);
  expect(at, `the section holds data-mg="${hook}"`).toBeGreaterThan(-1);
  const open = region.lastIndexOf("<", at);
  const tag = region.slice(open, region.indexOf(">", at) + 1);
  const tagName = tag.match(/^<([a-zA-Z][\w-]*)/)?.[1];
  expect(tagName, `the ${hook} hook sits on an element`).toBeTruthy();
  const close = region.indexOf(`</${tagName}>`, at);
  expect(close, `the ${hook} element closes`).toBeGreaterThan(at);
  return region.slice(open, close + tagName!.length + 3);
}

function moreColumnsRegion(section: string): string {
  return hookElementRegion(section, "more-columns");
}

function footerRegion(page: string): string {
  const at = page.indexOf('data-mg="about-footer"');
  expect(at, "the page holds the About this data footer").toBeGreaterThan(-1);
  const end = page.indexOf("</body>", at);
  expect(end, "the footer closes").toBeGreaterThan(at);
  return page.slice(at, end);
}

function footerNumber(page: string, hook: string): number {
  const text = hookText(footerRegion(page), hook);
  const match = text.match(/^(\d+)$/);
  expect(match, `${hook} holds one integer, got "${text}"`).toBeTruthy();
  return Number(match![1]);
}

interface Pick {
  role: string | null;
  key: string | null;
  name: string | null;
  rate: string | null;
  count: string | null;
  none: boolean;
}

function picksOf(page: string): Pick[] {
  const at = page.indexOf('data-mg="top-block"');
  expect(at, "the page holds the top block").toBeGreaterThan(-1);
  const end = page.indexOf("</section>", at);
  const region = page.slice(at, end > at ? end : page.length);
  const out: Pick[] = [];
  const re = /<([a-zA-Z][\w-]*)\b([^>]*\bdata-mg="pick"[^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(region)) !== null) {
    const tag = m[1];
    const close = region.indexOf(`</${tag}>`, re.lastIndex);
    expect(close, "a pick line closes").toBeGreaterThan(re.lastIndex);
    const inner = region.slice(re.lastIndex, close);
    out.push({
      role: m[2].match(/\bdata-role="([^"]*)"/)?.[1] ?? null,
      key: m[2].match(/\bdata-model-key="([^"]*)"/)?.[1] ?? null,
      name: inner.includes('data-mg="pick-name"') ? hookText(inner, "pick-name") : null,
      rate: inner.includes('data-mg="pick-rate"') ? hookText(inner, "pick-rate") : null,
      count: inner.includes('data-mg="pick-count"') ? hookText(inner, "pick-count") : null,
      none: inner.includes('data-mg="pick-none"'),
    });
    re.lastIndex = close + tag.length + 3;
  }
  return out;
}

const PRODUCER_HEADERS = [
  "Model",
  "Tasks",
  "First-round accept %",
  "Rework",
  "Cleanup %",
  "Tokens per accepted task",
];
const CHECKER_HEADERS = ["Model", "Runs", "Pass %", "Findings per run", "Escapes", "Net score"];

function producerSection(page: string): string {
  return sectionOf(page, "Producer roles");
}

function checkerSection(page: string): string {
  return sectionOf(page, "Checker roles");
}

describe("DS4 to DS13: the page built from the page B fixture", () => {
  it("DS4: a route note strips at the first space-paren, so keys stay whole and the footer route count is 30", () => {
    const page = basePage();
    const keys = rowsOf(`${producerSection(page)}${checkerSection(page)}`).map((row) => row.key);
    expect(keys.length, "the page holds data rows").toBeGreaterThan(0);
    for (const key of keys) {
      expect(key, `model key ${key} holds no note text`).not.toContain(" (");
      expect(key, `model key ${key} holds no ra-quota text`).not.toContain("ra-quota");
    }
    expect(keys, "the note-carrying route merges into t1/prod-two").toContain("t1/prod-two");
    const row = rowIn(producerSection(page), "t1/prod-two");
    expect(row.cells[1], "t1/prod-two shows the summed tasks").toBe("20");
    expect(footerNumber(page, "footer-routes"), "the stripped route count").toBe(35);
  });

  it("DS5: the producer merge weights the first-round rate by accepted and the averages by their own denominators", () => {
    const page = basePage();
    const row = rowIn(producerSection(page), "t1/prod-one");
    expect(row.cells.length, "the producer row holds six cells").toBe(PRODUCER_HEADERS.length);
    expect(row.cells[1]).toBe("23");
    expect(row.cells[2], "first-round accept % = sum(rate*accepted)/sum(accepted) = 10/15").toBe("67 %");
    expect(row.cells[3], "rework = sum(rework*tasks)/sum(tasks) = 30/20").toBe("1.5");
    expect(row.cells[4], "cleanup = sum(cleanup*tasks)/sum(tasks) = 2/15").toBe("13 %");
    expect(row.cells[5], "tokens = sum(tokens*accepted)/sum(accepted) = 3400000/10").toBe("340k");
  });

  it("DS6: a null cell leaves the average denominator, an empty average shows a dash, and a zero-task row has no row", () => {
    const page = basePage();
    const seven = rowIn(producerSection(page), "t1/prod-seven");
    expect(seven.cells[1]).toBe("9");
    for (const index of [2, 3, 4, 5]) {
      expect(seven.cells[index], `cell ${index} of t1/prod-seven shows a dash`).toBe("–");
    }
    const pageText = page;
    expect(pageText.includes('data-model-key="t1/prod-zero"'), "t1/prod-zero has no row").toBe(
      false,
    );
  });

  it("DS7: the checker merge sums decided, not runs", () => {
    const page = basePage();
    const one = rowIn(checkerSection(page), "t1/gate-one");
    expect(one.cells.length, "the checker row holds six cells").toBe(CHECKER_HEADERS.length);
    expect(one.cells[1], "runs = sum(decided) = 6+4+5").toBe("15");
    expect(one.cells[2], "pass % = 12/15").toBe("80 %");
    expect(one.cells[3], "findings per run = 16/15").toBe("1.07");
    expect(one.cells[4], "escapes = 1+0+2").toBe("3");
    const two = rowIn(checkerSection(page), "t1/gate-two");
    expect(two.cells[1], "runs = 7+5+5").toBe("17");
    expect(two.cells[2], "pass % = 16/17").toBe("94 %");
    expect(two.cells[3], "findings per run = 6/17").toBe("0.35");
    expect(two.cells[4]).toBe("0");
    const twelve = fewGroupRows(checkerSection(page), "checker").find(
      (row) => row.key === "t1/gate-twelve",
    );
    expect(twelve, "t1/gate-twelve sits in the too-few group").toBeDefined();
    expect(twelve!.cells[1], "runs = decided = 3, not runs = 9").toBe("3");
    expect(twelve!.rank, "a 3-run row has no rank").toBeNull();
  });

  it("DS8: the minimum is 5 tasks or runs, and a row with 5 tasks and no rate sits in Too few tasks", () => {
    const page = basePage();
    const producer = producerSection(page);
    const checker = checkerSection(page);
    expect(rowIn(producer, "t1/prod-six").rank, "5 tasks rank").not.toBeNull();
    expect(rowIn(checker, "t1/gate-seven").rank, "5 runs rank").not.toBeNull();
    const five = fewGroupRows(producer, "producer").find((row) => row.key === "t1/prod-five");
    expect(five, "t1/prod-five (4 tasks) sits in Too few tasks").toBeDefined();
    expect(five!.rank, "4 tasks get no rank").toBeNull();
    const eleven = fewGroupRows(checker, "checker").find((row) => row.key === "t1/gate-eleven");
    expect(eleven, "t1/gate-eleven (4 runs) sits in Too few tasks").toBeDefined();
    expect(eleven!.rank, "4 runs get no rank").toBeNull();
    const seven = fewGroupRows(producer, "producer").find((row) => row.key === "t1/prod-seven");
    expect(seven, "t1/prod-seven (9 tasks, no rate) sits in Too few tasks").toBeDefined();
    expect(seven!.rank, "a row with no rate gets no rank").toBeNull();
  });

  it("DS9: the producer rank orders by accept %, then lower rework, then more tasks", () => {
    const page = basePage();
    const section = producerSection(page);
    expect(rankedKeys(section)).toEqual([
      "t1/prod-evil",
      "t1/prod-eight",
      "t1/prod-strat",
      "t1/prod-one",
      "t2/prod-two",
      "t1/prod-four",
      "t1/prod-three",
      "t1/prod-two",
      "t1/prod-nine",
      "t1/prod-six",
    ]);
    const ranks = rowsOf(section)
      .filter((row) => row.rank !== null)
      .map((row) => Number(row.rank));
    expect(ranks, "ranks run 1 to n in order").toEqual(ranks.map((_, index) => index + 1));
  });

  it("DS10: the checker rank orders by pass %, then fewer escapes, then more runs, and the route unknown never shows", () => {
    const page = basePage();
    const section = checkerSection(page);
    expect(rankedKeys(section)).toEqual([
      "t1/gate-five",
      "t1/gate-nine",
      "t1/gate-fourteen",
      "t1/gate-eight",
      "t1/gate-six",
      "opencode/gate-three-free",
      "t1/gate-seven",
      "t1/gate-four",
      "t1/gate-two",
      "t1/gate-one",
      't1/"><img src=x onerror=alert(1)>',
      "t1/__proto__",
    ]);
    const ranks = rowsOf(section)
      .filter((row) => row.rank !== null)
      .map((row) => Number(row.rank));
    expect(ranks, "ranks run 1 to n in order").toEqual(ranks.map((_, index) => index + 1));
    expect(
      section.includes('data-model-key="unknown"'),
      "the route unknown shows no row (spec Q-S10)",
    ).toBe(false);
    expect(
      producerSection(page).includes('data-model-key="unknown"'),
      "the route unknown shows no producer row",
    ).toBe(false);
  });

  it("DS11: the AA net score uses byEffort of the busiest variant, an alias, and the -free suffix", () => {
    const page = basePage();
    const checker = checkerSection(page);
    expect(rowIn(checker, "t1/gate-one").cells[5], "byEffort.high of the most counted runs").toBe(
      "41.5",
    );
    expect(rowIn(checker, "t1/gate-two").cells[5], "the alias gate-two-canon").toBe("33.3");
    expect(rowIn(checker, "opencode/gate-three-free").cells[5], "the -free suffix strips").toBe(
      "22.2",
    );
    expect(rowIn(checker, "t1/gate-five").cells[5], "rated false").toBe("not rated");
    expect(rowIn(checker, "t1/gate-eight").cells[5], "no AA entry").toBe("not rated");

    const more = moreColumnsRegion(producerSection(page));
    const prodOne = rowsOf(more).find((row) => row.key === "t1/prod-one");
    expect(prodOne, "the more-columns view holds t1/prod-one").toBeDefined();
    expect(
      prodOne!.cells.some((cell) => Number(cell) === 44.4),
      `the AA net score of t1/prod-one is 44.4, got ${JSON.stringify(prodOne!.cells)}`,
    ).toBe(true);

    // RA-6: the fixture's first gate-variant route is its least busy
    // variant, so the lookup must take the busiest variant, not the first
    // route and not the primary row.
    const variantRows = JSON.parse(readFileSync(join(PAGE_B, OUTCOMES_NAME), "utf8"));
    const firstVariant = variantRows.find(
      (row: any) => typeof row.route === "string" && row.route.startsWith("t1/gate-variant"),
    );
    expect(firstVariant?.route, "the fixture's first variant route is #low").toBe(
      "t1/gate-variant#low",
    );
    expect(
      rowIn(checker, "t1/gate-variant").cells[5],
      "the busiest variant wins over the first route",
    ).toBe("37.5");
  });

  it("DS12: the marks not-for-verdicts and not-allowed sit on the model rows as attributes", () => {
    const page = basePage();
    const checker = checkerSection(page);
    for (const key of ["t1/gate-five", "t1/gate-eight", "t1/gate-six"]) {
      expect(
        rowIn(checker, key).html,
        `${key} carries data-mark="not-for-verdicts"`,
      ).toContain('data-mark="not-for-verdicts"');
    }
    expect(
      rowIn(checker, "t1/gate-seven").html,
      "a net score of exactly 20 is not marked",
    ).not.toContain("data-mark=");
    expect(rowIn(checker, "t1/gate-nine").html, "a not-allowed model is marked").toContain(
      'data-mark="not-allowed"',
    );
    for (const key of ["t1/gate-one", "t1/gate-two"]) {
      expect(rowIn(checker, key).html, `${key} carries no mark`).not.toContain("data-mark=");
    }
    const producer = producerSection(page);
    expect(rowIn(producer, "t1/prod-eight").html, "not allowed").toContain(
      'data-mark="not-allowed"',
    );
    expect(rowIn(producer, "t2/prod-two").html, "not allowed on the other provider").toContain(
      'data-mark="not-allowed"',
    );
    expect(rowIn(producer, "t1/prod-one").html, "an allowed rated model carries no mark").not.toContain(
      "data-mark=",
    );
    // Spec Q-S8: the mark "not for verdicts" shows on both tables, because
    // rule 6 marks the model.
    expect(
      rowIn(producer, "t1/prod-five").html,
      "an unrated producer row carries not-for-verdicts (spec Q-S8)",
    ).toContain('data-mark="not-for-verdicts"');
  });

  it("DS13: the top block gives one line per role in the given order, with the filters of rule 8", () => {
    const page = basePage();
    const at = page.indexOf('data-mg="top-block"');
    const firstTable = page.indexOf("<table");
    expect(firstTable, "the page holds a table").toBeGreaterThan(-1);
    expect(at, "the top block sits before the first table").toBeLessThan(firstTable);

    const expected: Array<
      [string, string | null, number | null, number | null]
    > = [
      ["red", "t1/prod-one", 100, 5],
      ["green", "t1/prod-one", 62, 15],
      ["coder", null, null, null],
      ["review-a", "t1/gate-two", 100, 7],
      ["review-b", null, null, null],
      ["review-c", "t1/gate-seven", 100, 5],
      ["adversarial", null, null, null],
      ["acceptance", null, null, null],
      ["phase-acceptance", "t1/gate-two", 80, 5],
      ["final-acceptance", null, null, null],
    ];
    const picks = picksOf(page);
    expect(picks, "one line for each of the ten roles").toHaveLength(expected.length);
    expect(
      picks.map((pick) => pick.role),
      "the lines run in the order of spec rule 8",
    ).toEqual(expected.map(([role]) => role));
    for (const [role, key, rate, count] of expected) {
      const pick = picks.find((item) => item.role === role)!;
      if (key === null) {
        expect(pick.none, `${role} says no pick yet`).toBe(true);
        expect(pick.key, `${role} carries no data-model-key`).toBeNull();
        continue;
      }
      expect(pick.none, `${role} has a pick`).toBe(false);
      expect(pick.key, `${role} pick`).toBe(key);
      expect(pick.name, `${role} name`).toBeTruthy();
      const rateText = pick.rate ?? "";
      expect(rateText, `${role} rate "${rateText}" is a whole percent`).toMatch(/^\d+\s*%$/);
      expect(Number(rateText.match(/^(\d+)/)![1]), `${role} rate`).toBe(rate!);
      const countText = pick.count ?? "";
      expect(countText, `${role} count "${countText}" is an integer`).toMatch(/^\d+$/);
      expect(Number(countText), `${role} count`).toBe(count!);
    }
  });
});

describe("DS17: plain names and the routes of a row", () => {
  it("DS17: two providers with one plain name stay two rows, the default table has no Routes column, and the routes sit in More columns", () => {
    const page = basePage();
    const section = producerSection(page);
    const headers = headersOf(defaultTableOf(section, "producer"));
    expect(headers, "the default table keeps the pinned columns").toEqual(PRODUCER_HEADERS);
    expect(headers, "no Routes column in the default view").not.toContain("Routes");
    const one = rowIn(section, "t1/prod-two");
    const two = rowIn(section, "t2/prod-two");
    expect(one.cells[0], "t1/prod-two shows its plain name").toContain("prod-two");
    expect(two.cells[0], "t2/prod-two shows the same plain name").toContain("prod-two");
    expect(one.key).not.toBe(two.key);

    const more = section.match(
      /<details\b[^>]*data-mg="more-columns"[^>]*>[\s\S]*?<\/details>/,
    );
    expect(more, "the producer More columns toggle exists").toBeTruthy();
    expect(headersOf(more![0]), "the more-columns view lists the routes").toContain("Routes");
    const routesOfKey = rowsOf(more![0]).find((row) => row.key === "t1/prod-two");
    expect(routesOfKey, "the more-columns view holds t1/prod-two").toBeDefined();
    expect(
      routesOfKey!.cells.some((cell) => cell.includes("t1/prod-two")),
      `the routes of t1/prod-two reach the row: ${JSON.stringify(routesOfKey!.cells)}`,
    ).toBe(true);
  });

  it("DS17: a key in model-names.json shows its plain name and an unnamed key drops the plan prefix", () => {
    const page = namedKeyPage();
    const cells = [...page.matchAll(/<td\b[^>]*data-mg="model-name"[^>]*>([\s\S]*?)<\/td>/g)].map(
      (m) => m[1].replace(/<[^>]*>/g, "").trim(),
    );
    expect(cells.length, "the rows hold model-name cells").toBeGreaterThan(0);
    const named = cells.find((cell) => cell.includes("Kimi For Coding"));
    expect(named, "the named key shows its name from model-names.json").toBeDefined();
    expect(named, "the model cell holds no raw key").not.toContain("kimi-code-plan-cn/kimi-for-coding");
    const unnamed = cells.find((cell) => cell.includes("synthetic-unknown"));
    expect(unnamed, "an unnamed key shows the key without its plan prefix").toBeDefined();
    expect(
      unnamed,
      "the model cell holds no provider prefix",
    ).not.toContain("opencode-go/synthetic-unknown");
  });
});

describe("RA-4: the checker More columns Roles cell", () => {
  it("RA-4: the Roles cell lists a gate role that is not in GATE_ROLES", () => {
    const page = basePage();
    const more = moreColumnsRegion(checkerSection(page));
    const row = rowsOf(more).find((item) => item.key === "t1/gate-fourteen");
    expect(row, "the more-columns view holds the spec-review row").toBeDefined();
    expect(
      row!.cells.some((cell) => cell.includes("spec-review")),
      `the Roles cell lists spec-review: ${JSON.stringify(row!.cells)}`,
    ).toBe(true);
  });
});
