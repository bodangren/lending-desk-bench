/** Spec B, C, H + probes. */
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { BASE, countElements, prefixBefore, streamMarks } from "./_stream";

/** Every card links to /items/<id>, whatever else the markup does. */
const cards = (page: import("@playwright/test").Page) =>
  page.locator('a[href^="/items/itm-"]');


type TraceCall = { name: string; start: number; end: number };

async function tracedCatalogueCalls(): Promise<TraceCall[]> {
  const traceFile = process.env.BENCH_TRACE_FILE;
  test.skip(!traceFile, "BENCH_TRACE_FILE not set");
  writeFileSync(traceFile!, "");
  const response = await fetch(BASE + "/items", { cache: "no-store" });
  expect(response.ok).toBe(true);
  await response.text();
  await new Promise((resolve) => setTimeout(resolve, 250));
  return readFileSync(traceFile!, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TraceCall);
}

test("C.renders", async ({ page }) => {
  await page.goto("/items");
  await expect(page.getByRole("heading", { level: 1, name: "Items" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Cordless Drill/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Drill Press/ })).toBeVisible();
});

test("C.renders-all", async ({ page }) => {
  // "Every item", not "the first page of items". 29 in the seed.
  await page.goto("/items");
  await expect(cards(page)).toHaveCount(29);
  // Including the ones whose names are awkward to render.
  await expect(page.getByRole("link", { name: /C-Clamp \(150mm\)/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Étau d'Établi/ })).toBeVisible();
});

test("B.name-category", async ({ page }) => {
  await page.goto("/items");
  const card = page.getByRole("link", { name: /Cordless Drill/ });
  await expect(card).toContainText("Cordless Drill");
  await expect(card).toContainText("power-tool");
});

test("B.badge", async ({ page }) => {
  await page.goto("/items");
  // itm-001 has only returned loans; itm-003 (Circular Saw) has an open one.
  await expect(page.getByRole("link", { name: /Cordless Drill/ })).toContainText("Available");
  await expect(page.getByRole("link", { name: /Circular Saw/ })).toContainText("On loan");
  // itm-017 has a returned loan AND a newer open one: still on loan.
  await expect(page.getByRole("link", { name: /Rotary Hammer/ })).toContainText("On loan");
  // itm-013's loans are all returned, and they share a borrowedAt: still available.
  await expect(page.getByRole("link", { name: /^Tile Cutter/ })).toContainText("Available");
});

test("B.link", async ({ page }) => {
  await page.goto("/items");
  await expect(page.getByRole("link", { name: /Cordless Drill/ })).toHaveAttribute(
    "href", "/items/itm-001",
  );
});

test("B.image-alt", async ({ page }) => {
  await page.goto("/items");
  await expect(page.getByAltText("Cordless Drill")).toBeVisible();
  await expect(page.getByAltText("Étau d'Établi")).toBeVisible();
});

test("C.filter-q", async ({ page }) => {
  await page.goto("/items?q=drill");           // lower-case, matches "Cordless Drill", "Drill Press"
  await expect(page.getByRole("link", { name: /Cordless Drill/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Drill Press/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Claw Hammer/ })).toHaveCount(0);
});

test("C.filter-case", async ({ page }) => {
  // "Tile Cutter" and "TILE CUTTER XL" — case has to fold on both sides of the
  // comparison, not just on the query.
  await page.goto("/items?q=tile%20cutter");
  await expect(cards(page)).toHaveCount(2);
  await expect(page.getByRole("link", { name: "TILE CUTTER XL" })).toBeVisible();
  // And the reverse direction: an upper-case query against mixed-case names.
  await page.goto("/items?q=TILE%20CUTTER");
  await expect(cards(page)).toHaveCount(2);
});

test("P.searchparams-async", async ({ page }) => {
  // A page that never awaits searchParams renders the unfiltered list.
  const res = await page.goto("/items?q=zzzznomatch");
  expect(res?.status()).toBeLessThan(400);
  await expect(page.getByText("No items match your search.")).toBeVisible();
});

test("P.filter-literal", async ({ page }) => {
  // The query is text to look for, not a pattern to compile. `new RegExp(q)`
  // either throws on the first of these or matches everything on the second.
  await page.goto("/items?q=" + encodeURIComponent("(150mm)"));
  await expect(cards(page)).toHaveCount(1);
  await expect(page.getByRole("link", { name: /C-Clamp/ })).toBeVisible();

  const res = await page.goto("/items?q=" + encodeURIComponent(".*"));
  expect(res?.status()).toBeLessThan(400);
  await expect(page.getByText("No items match your search.")).toBeVisible();
});

test("C.filter-category", async ({ page }) => {
  await page.goto("/items?category=safety");
  await expect(page.getByRole("link", { name: /Safety Harness/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Ear Defenders/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Cordless Drill/ })).toHaveCount(0);
  await expect(cards(page)).toHaveCount(6);
});

test("C.filter-both", async ({ page }) => {
  await page.goto("/items?q=drill&category=power-tool");
  await expect(page.getByRole("link", { name: /Cordless Drill/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Drill Press/ })).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  await page.goto("/items?q=drill&category=safety");
  await expect(page.getByText("No items match your search.")).toBeVisible();
});

test("C.empty", async ({ page }) => {
  await page.goto("/items?q=definitely-not-an-item");
  await expect(page.getByText("No items match your search.")).toBeVisible();
});

test("P.hydration-clean", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" && /hydrat|did not match|server HTML/i.test(t)) errors.push(t);
  });
  await page.goto("/items");
  await page.goto("/items/itm-001");
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test("H.loading", async () => {
  // Read the flush order off the socket: the heading and a placeholder grid must
  // be sent before the rows are ready, not in the same chunk as them.
  const m = await streamMarks(`${BASE}/items`, {
    heading: /<h1[^>]*>\s*Items/,
    firstItem: "Cordless Drill",
  });
  expect(m.heading, "no <h1>Items</h1> in the response at all").toBeDefined();
  expect(m.firstItem, "catalogue never rendered").toBeDefined();
  expect(
    m.firstItem! - m.heading!,
    `heading at ${m.heading}ms, rows at ${m.firstItem}ms — the shell did not paint first`,
  ).toBeGreaterThan(100);

  // The placeholder grid: at least six tiles present in the shell.
  const shell = prefixBefore(m.body, "Cordless Drill");
  const afterHeading = shell.slice(shell.search(/<h1/));
  expect(
    countElements(afterHeading),
    "fewer than six placeholder tiles in the loading shell",
  ).toBeGreaterThanOrEqual(6);
});

test("B.image-response", async ({ page }) => {
  await page.goto("/items");
  const image = page.getByAltText("Cordless Drill");
  const src = await image.getAttribute("src");
  expect(src).toBeTruthy();
  const response = await page.request.get(new URL(src!, page.url()).toString());
  expect(response.ok(), `image response ${response.status()} for ${src}`).toBe(true);
  expect(response.headers()["content-type"]).toMatch(/^image\//);
});

test("C.summary", async ({ page }) => {
  await page.goto("/items");
  await expect(page.getByText("29 in the catalogue · hand-tool, measuring, power-tool, safety"))
    .toBeVisible();
});


test("C.parallel-reads", async () => {
  // This is spec C.7, not the hidden no-waterfall probe: the count and category
  // reads named by the checkbox must overlap in one catalogue render.
  const calls = await tracedCatalogueCalls();
  const count = calls.find((call) => call.name === "countItems");
  const categories = calls.find((call) => call.name === "listCategories");
  expect(count, "countItems was never called").toBeDefined();
  expect(categories, "listCategories was never called").toBeDefined();
  const overlap = Math.min(count!.end, categories!.end) - Math.max(count!.start, categories!.start);
  expect(overlap, "catalogue count and category reads did not overlap").toBeGreaterThan(0);
});
