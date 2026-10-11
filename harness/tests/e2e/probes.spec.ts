/**
 * Adversarial probes. NOT derived from spec.md.
 * These encode where models actually break, not what the spec asks for.
 */
import { expect, test, type Page } from "@playwright/test";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { BASE } from "./_stream";
import { CHECKOUT_DUE, closeOpenLoan, fillDueDate, openLoanCount } from "./_forms";

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
  // Both assertions are negative, so a page that returns 500 or an empty body used to
  // earn this Tier 0 probe by rendering nothing at all. Require the page first.
  const res = await page.request.get("/items/itm-001");
  expect(res.ok(), `detail page returned ${res.status()}`).toBe(true);
  const html = await res.text();
  expect(html, "detail page never rendered the item").toContain("Cordless Drill");
  expect(html).not.toContain("staff-key-7f3a");
  const detail = await page.request.get("/items/itm-003");
  expect(detail.ok(), `detail page returned ${detail.status()}`).toBe(true);
  const detailHtml = await detail.text();
  expect(detailHtml, "detail page never rendered the item").toContain("Circular Saw");
  expect(detailHtml).not.toContain("staff-key-7f3a");
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

test("P.action-race", async ({ context }) => {
  // Two desks submit the same item at the same moment. Both actions read "no open
  // loan" before either writes, so the store rejects the second insert with
  // ItemOnLoanError. The losing action must answer the contract error, not throw
  // into the error boundary. The stale-form check (F.checkout-conflict) cannot see
  // this: its item is already on loan when the action reads.
  const itemId = "itm-011";
  const desks = await Promise.all([context.newPage(), context.newPage()]);
  const members = ["Ada Okonkwo", "Bruno Silva"];
  for (const [index, desk] of desks.entries()) {
    await desk.goto(`/items/${itemId}`);
    await desk.getByRole("combobox").first().selectOption({ label: members[index] });
    await fillDueDate(desk, CHECKOUT_DUE);
  }
  await Promise.all(desks.map((desk) => desk.getByRole("button", { name: /check ?out/i }).click()));

  await expect.poll(() => openLoanCount(desks[0], itemId), { timeout: 15_000 }).toBe(1);
  await expect
    .poll(async () => {
      const shown = await Promise.all(
        desks.map((desk) => desk.getByText("Item is already on loan").count()),
      );
      return shown.filter((count) => count > 0).length;
    }, { timeout: 15_000, message: "the losing desk never showed the contract error" })
    .toBe(1);
  await closeOpenLoan(desks[0], itemId);
});

test("P.retry-after-error", async ({ page }) => {
  // A rejected checkout must leave the form usable. A stale error, a stuck
  // optimistic badge, or a form bound to its failed attempt leaves the desk with
  // no way to lend the item without a reload.
  const itemId = "itm-012";
  await page.goto(`/items/${itemId}`);
  await page.getByRole("combobox").first().selectOption({ label: "Dara Nwosu" });
  await fillDueDate(page, "2020-01-01");
  await page.getByRole("button", { name: /check ?out/i }).click();
  await expect(page.getByText("Due date must be in the future")).toBeVisible({ timeout: 10_000 });

  // React 19 resets an uncontrolled form after its action, so fill it again.
  await page.getByRole("combobox").first().selectOption({ label: "Dara Nwosu" });
  await fillDueDate(page, CHECKOUT_DUE);
  await page.getByRole("button", { name: /check ?out/i }).click();
  await expect.poll(() => openLoanCount(page, itemId), { timeout: 15_000 }).toBe(1);
  await expect(page.getByText("Due date must be in the future")).toHaveCount(0, { timeout: 10_000 });
  await closeOpenLoan(page, itemId);
});

/**
 * axe-core rules about names, labels, and ARIA validity. Colour contrast and other
 * design-dependent rules are left out: they grade styling choices that no
 * checkbox states and that vary with the rendering host.
 */
const AXE_RULES = [
  "aria-allowed-attr", "aria-hidden-focus", "aria-required-attr", "aria-required-children",
  "aria-required-parent", "aria-roles", "aria-valid-attr", "aria-valid-attr-value",
  "button-name", "duplicate-id-aria", "image-alt", "input-button-name", "label",
  "link-name", "list", "listitem", "nested-interactive", "select-name",
];
const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

async function axeViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async (rules) => {
    const axe = (window as unknown as { axe: { run: Function } }).axe;
    const result = await axe.run(document, {
      runOnly: { type: "rule", values: rules },
      resultTypes: ["violations"],
    });
    return (result.violations as { id: string; impact: string; nodes: { target: string[] }[] }[])
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => `${violation.id} at ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
  }, AXE_RULES);
}

test("P.axe-clean", async ({ page }) => {
  // The catalogue, an available item (form and history), and an item on loan
  // (Return control). Each page is scanned after its streamed sections land.
  for (const path of ["/items", "/items/itm-001", "/items/itm-003"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const violations = await axeViolations(page);
    expect(violations, `${path}: ${violations.join("; ")}`).toEqual([]);
  }
});

test.describe("advisory — modernization signals", () => {
  test("ADV.useActionState", async () => {
    expect(source("app/items/[id]/checkout-form.tsx")).toMatch(/useActionState|useFormState/);
  });

  test("ADV.useOptimistic", async () => {
    expect(source("app/items/[id]/checkout-form.tsx")).toContain("useOptimistic");
  });
});
