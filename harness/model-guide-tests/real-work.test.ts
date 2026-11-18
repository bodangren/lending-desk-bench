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
  text: string;
  none: boolean;
}

/** The ten top lines. Each line is one sentence with the label "in this
 * role" (spec D16 Top block, PM 2026-11-18), so the values come from the
 * text of the line, not from a rate or count hook. */
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
    const text = inner.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    out.push({
      role: m[2].match(/\bdata-role="([^"]*)"/)?.[1] ?? null,
      key: m[2].match(/\bdata-model-key="([^"]*)"/)?.[1] ?? null,
      text,
      none: text.endsWith(": no pick yet"),
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
  it("DS4: a route note strips at the first space-paren, so keys stay whole and the footer route count is 36", () => {
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
    expect(footerNumber(page, "footer-routes"), "the stripped route count").toBe(36);
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
    expect(one.cells[4], "the escape sum over all gate rows is 0, so the cell shows no data").toBe(
      "no data",
    );
    const two = rowIn(checkerSection(page), "t1/gate-two");
    expect(two.cells[1], "runs = 7+5+5").toBe("17");
    expect(two.cells[2], "pass % = 16/17").toBe("94 %");
    expect(two.cells[3], "findings per run = 6/17").toBe("0.35");
    expect(two.cells[4], "no escape data yet shows no data").toBe("no data");
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

  it("DS10: the checker rank orders by AA net score with not-rated rows last, then findings per run, more runs, and the model key, and the route unknown never shows", () => {
    const page = basePage();
    const section = checkerSection(page);
    // Rated rows first by net score high. Then the not-rated rows by
    // findings per run high, then more runs, then the model key: gate-eight
    // and gate-zeta tie on findings (0.00) and runs (8), so the model key
    // puts gate-eight first.
    expect(rankedKeys(section)).toEqual([
      "t1/gate-nine",
      "t1/gate-one",
      "t1/gate-two",
      "t1/gate-four",
      "opencode/gate-three-free",
      "t1/gate-seven",
      "t1/gate-six",
      "t1/gate-five",
      "t1/gate-fourteen",
      "t1/gate-eight",
      "t1/gate-zeta",
      "t1/__proto__",
      't1/"><img src=x onerror=alert(1)>',
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
    for (const key of ["t1/gate-five", "t1/gate-eight"]) {
      expect(
        rowIn(checker, key).html,
        `${key} carries data-mark="not-for-verdicts"`,
      ).toContain('data-mark="not-for-verdicts"');
    }
    expect(
      rowIn(checker, "t1/gate-six").html,
      "a net score of 19.9 is above 0, so gate-six carries no mark (PM 2026-11-18)",
    ).not.toContain("data-mark=");
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

  it("DS13: each of the ten top lines starts with its role label and a colon, in the given order", () => {
    const page = basePage();
    const at = page.indexOf('data-mg="top-block"');
    const firstTable = page.indexOf("<table");
    expect(firstTable, "the page holds a table").toBeGreaterThan(-1);
    expect(at, "the top block sits before the first table").toBeLessThan(firstTable);

    const expected: Record<string, { text: string; key: string | null }> = {
      red: { text: "Red: prod-one 100 % in this role, 5 tasks", key: "t1/prod-one" },
      green: { text: "Green: prod-one 62 % in this role, 15 tasks", key: "t1/prod-one" },
      coder: { text: "Coder: no pick yet", key: null },
      "review-a": {
        text: "Review A: gate-one 90 % pass in this role, 10 runs, net 41.5",
        key: "t1/gate-one",
      },
      "review-b": {
        text: "Review B: gate-one 60 % pass in this role, 5 runs, net 18.5",
        key: "t1/gate-one",
      },
      "review-c": {
        text: "Review C: gate-seven 100 % pass in this role, 5 runs, net 20",
        key: "t1/gate-seven",
      },
      adversarial: { text: "Adversarial: no pick yet", key: null },
      acceptance: { text: "Acceptance: no pick yet", key: null },
      "phase-acceptance": {
        text: "Phase acceptance: gate-two 80 % pass in this role, 5 runs, net 33.3",
        key: "t1/gate-two",
      },
      "final-acceptance": { text: "Final acceptance: no pick yet", key: null },
    };
    const order = Object.keys(expected);

    const picks = picksOf(page);
    expect(picks, "one line for each of the ten roles").toHaveLength(order.length);
    expect(
      picks.map((pick) => pick.role),
      "the lines run in the order of spec rule 8",
    ).toEqual(order);
    for (const pick of picks) {
      const role = pick.role as string;
      const want = expected[role];
      expect(want, `a line for the role ${role}`).toBeTruthy();
      expect(
        pick.text,
        `${role} visible line text (spec D16 Top block, orchestrator 2026-11-18)`,
      ).toBe(want.text);
      expect(pick.key, `${role} pick key`).toBe(want.key);
      expect(pick.none, `${role} no-pick flag`).toBe(want.key === null);
    }
  });

  it("DS25: a gate pick follows the checker rank order, so a 100 % pass row with a lower net score does not pick", () => {
    const page = basePage();
    const checker = checkerSection(page);
    // The counterfactual rows exist and rank: gate-five passes 100 % but is
    // not rated, and gate-six passes 100 % with net 19.9, now rated
    // (PM 2026-11-18: the gate is a net score above 0).
    const five = rowIn(checker, "t1/gate-five");
    expect(five.rank, "gate-five ranks in the checker table").not.toBeNull();
    expect(five.cells[2], "gate-five passes 100 %").toBe("100 %");
    const six = rowIn(checker, "t1/gate-six");
    expect(six.cells[2], "gate-six passes 100 %").toBe("100 %");
    expect(six.cells[5], "gate-six net score is 19.9").toBe("19.9");
    const picks = picksOf(page);
    const reviewA = picks.find((pick) => pick.role === "review-a")!;
    expect(
      reviewA.text,
      "review-a picks the higher net row although its pass rate is lower",
    ).toBe("Review A: gate-one 90 % pass in this role, 10 runs, net 41.5");
    expect(reviewA.key).toBe("t1/gate-one");
    const reviewC = picks.find((pick) => pick.role === "review-c")!;
    expect(
      reviewC.text,
      "review-c picks net 20 over the 100 % row with net 19.9",
    ).toBe("Review C: gate-seven 100 % pass in this role, 5 runs, net 20");
    expect(reviewC.key).toBe("t1/gate-seven");
  });
});

describe("DS26 the footer row count and the zero net gate (task 4.13e)", () => {
  it("DS26: the footer row count equals the outcomes array length, even with a malformed row", () => {
    const root = repoFixture("row-count", {
      outcomes: (rows) => {
        rows.push({ route: "t1/ghost", role: "green" });
      },
    });
    const page = buildPage(root);
    expect(footerNumber(page, "footer-rows"), "the footer row count is the outcomes length").toBe(
      42,
    );
  });

  it("DS26: a net score of 0 carries the verdict mark and gives no pick (guard: holds at HEAD)", () => {
    const root = repoFixture("net-zero");
    const staged = join(root, "fixture-b");
    const aaPath = join(staged, AA_NAME);
    const aa = JSON.parse(readFileSync(aaPath, "utf8"));
    for (const key of ["gate-six", "gate-seven"]) {
      expect(aa.models[key], `the AA fixture holds ${key}`).toBeTruthy();
      aa.models[key] = { rated: true, aliases: [], netScore: 0 };
    }
    writeFileSync(aaPath, `${JSON.stringify(aa, null, 2)}\n`);
    writeFileSync(
      join(staged, MANIFEST_NAME),
      [
        manifestLine(join(staged, OUTCOMES_NAME), OUTCOMES_NAME),
        manifestLine(join(staged, AA_NAME), AA_NAME),
        manifestLine(join(staged, ALLOWED_NAME), ALLOWED_NAME),
        "",
      ].join("\n"),
    );
    const page = buildPage(root);
    const checker = checkerSection(page);
    for (const key of ["t1/gate-six", "t1/gate-seven"]) {
      expect(
        rowIn(checker, key).html,
        `${key} with net 0 is not for verdicts (PM 2026-11-18)`,
      ).toContain('data-mark="not-for-verdicts"');
    }
    const picks = picksOf(page);
    const reviewC = picks.find((pick) => pick.role === "review-c")!;
    expect(reviewC.text, "review-c has no pick with only net-0 rows").toBe(
      "Review C: no pick yet",
    );
    expect(reviewC.key, "the no-pick line carries no model key").toBeNull();
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
