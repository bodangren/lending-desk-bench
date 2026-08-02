/**
 * Adversarial probes. NOT derived from spec.md.
 * These encode where models actually break, not what the spec asks for.
 */
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { BASE, streamMarks } from "./_stream";

type Call = { name: string; start: number; end: number };

const CANDIDATE = process.env.CANDIDATE!;
const source = (rel: string) => {
  const p = join(CANDIDATE, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};

/**
 * Render a page server-side and return the data-layer calls it made.
 *
 * Deliberately a raw GET rather than `page.goto`: the App Router prefetches the
 * links it can see once the page hydrates, and those prefetches render other
 * routes into the same trace file. A plain request exercises exactly one render.
 */
async function tracedGet(path: string): Promise<Call[]> {
  const traceFile = process.env.BENCH_TRACE_FILE;
  if (!traceFile) return [];
  writeFileSync(traceFile, "");
  // Drain the body: a streamed response resolves its headers long before the
  // render that produced the later chunks has finished calling the data layer.
  await (await fetch(`${BASE}${path}`, { cache: "no-store" })).text();
  await new Promise((r) => setTimeout(r, 250)); // trace lines are appended just after each call
  return readFileSync(traceFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Call);
}


test("P.no-key-leak", async ({ page }) => {
  // The staff key authenticates every mutation. Handing the session object (or
  // the key itself) to a client component ships it to every browser that loads
  // the page, in the RSC payload if not in the markup.
  const res = await page.request.get("/items/itm-001");
  const html = await res.text();
  expect(html).not.toContain("staff-key-7f3a");
  const detail = await page.request.get("/items/itm-003");
  expect(await detail.text()).not.toContain("staff-key-7f3a");
});

test("P.no-waterfall", async () => {
  // Timing alone cannot separate parallel from sequential here — measured variance on
  // identical correct code was 1128ms vs 1723ms. Instead read the call trace that
  // src/db writes when BENCH_TRACE_FILE is set, and check the two independent reads
  // actually overlapped in time.
  const traceFile = process.env.BENCH_TRACE_FILE;
  test.skip(!traceFile, "BENCH_TRACE_FILE not set");

  const calls = await tracedGet("/items");
  const count = calls.find((c) => c.name === "countItems");
  const cats = calls.find((c) => c.name === "listCategories");
  expect(count, "countItems was never called").toBeDefined();
  expect(cats, "listCategories was never called").toBeDefined();

  const overlap =
    Math.min(count!.end, cats!.end) - Math.max(count!.start, cats!.start);
  expect(
    overlap,
    `countItems ${count!.start}-${count!.end}, listCategories ${cats!.start}-${cats!.end}`,
  ).toBeGreaterThan(0);
});

test("P.n-plus-one", async () => {
  // Asking the store for each row's open loan costs one round trip per item.
  // Running them through Promise.all hides the latency but not the load: with 29
  // items that is 29 queries where one read of the loan table would do. The cost
  // has to stay flat as the catalogue grows.
  const traceFile = process.env.BENCH_TRACE_FILE;
  test.skip(!traceFile, "BENCH_TRACE_FILE not set");

  const calls = await tracedGet("/items");
  expect(calls.length, "no data-layer calls traced at all").toBeGreaterThan(0);
  const perItem = calls.filter((c) => c.name === "findOpenLoan" || c.name === "getItem").length;
  expect(
    perItem,
    `${perItem} per-row reads for one catalogue render: ${calls.map((c) => c.name).join(", ")}`,
  ).toBeLessThanOrEqual(2);
  expect(calls.length, `${calls.length} data-layer calls for one catalogue render`)
    .toBeLessThanOrEqual(8);
});

test("P.validate-before-io", async () => {
  // A malformed body is knowable without asking the store anything. Loading the
  // item and the member first spends the route's whole latency budget on a
  // request that was always going to be a 400.
  const traceFile = process.env.BENCH_TRACE_FILE;
  test.skip(!traceFile, "BENCH_TRACE_FILE not set");

  writeFileSync(traceFile!, "");
  const res = await fetch(`${BASE}/api/loans`, {
    method: "POST",
    headers: { "x-staff-key": "staff-key-7f3a", "content-type": "application/json" },
    body: JSON.stringify({ itemId: 42, memberId: "mbr-001" }),
  });
  expect(res.status).toBe(400);
  await new Promise((r) => setTimeout(r, 250));
  const calls = readFileSync(traceFile!, "utf8").split("\n").filter(Boolean);
  expect(calls.length, `${calls.length} store reads before rejecting a malformed body`).toBe(0);
});

test("P.dedup-item", async () => {
  // The title and the body both need the item. That is one item, read once —
  // the second read is invisible in the output and doubles the latency budget
  // of the route.
  const traceFile = process.env.BENCH_TRACE_FILE;
  test.skip(!traceFile, "BENCH_TRACE_FILE not set");

  const calls = await tracedGet("/items/itm-001");
  const gets = calls.filter((c) => c.name === "getItem").length;
  expect(gets, `getItem called ${gets}× for one detail render`).toBeLessThanOrEqual(1);
});

test("P.streams-shell", async () => {
  // The detail route has no loading.tsx, so nothing paints until the slowest
  // await in the page resolves — unless the loan history sits behind its own
  // boundary. Read the flush order off the socket rather than polling the DOM.
  const m = await streamMarks(`${BASE}/items/itm-018`, {
    name: /<h1[^>]*>\s*Scaffold Tower/,
    history: "Dara Nwosu",
  });
  expect(m.name, "item name never rendered").toBeDefined();
  expect(m.history, "loan history never rendered").toBeDefined();
  expect(
    m.history! - m.name!,
    `name at ${m.name}ms, history at ${m.history}ms — both arrived in one flush`,
  ).toBeGreaterThan(100);
});

test.describe("advisory — modernization signals", () => {
  test("ADV.useActionState", async () => {
    expect(source("app/items/[id]/checkout-form.tsx")).toMatch(/useActionState|useFormState/);
  });

  test("ADV.useOptimistic", async () => {
    expect(source("app/items/[id]/checkout-form.tsx")).toContain("useOptimistic");
  });
});
