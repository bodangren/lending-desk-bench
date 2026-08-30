/** Spec D, E + probes. */
import { expect, test, type Page } from "@playwright/test";

/**
 * Member names in render order, ignoring the checkout form's <option> list —
 * those carry the same names and would otherwise mask the history's ordering.
 * Reading the HTML rather than a locator keeps this independent of whether the
 * history is a <ul>, a <table> or a stack of <div>s.
 */
async function historyNames(page: Page): Promise<string[]> {
  const text = await page.evaluate(() => {
    const root = (document.querySelector("main") ?? document.body).cloneNode(true) as HTMLElement;
    // The member picker carries every name, and the flight payload repeats the
    // whole tree. Neither is the rendered history.
    root.querySelectorAll("select, script, template, style").forEach((n) => n.remove());
    return root.textContent ?? "";
  });
  const names = ["Ada Okonkwo", "Bruno Silva", "Chen Weiming", "Chen Wei", "Dara Nwosu"];
  const hits: { at: number; name: string }[] = [];
  for (const name of names) {
    for (let i = text.indexOf(name); i !== -1; i = text.indexOf(name, i + 1)) {
      // "Chen Wei" also matches inside "Chen Weiming"; keep the longer match.
      if (name === "Chen Wei" && text.startsWith("Chen Weiming", i)) continue;
      hits.push({ at: i, name });
    }
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.name);
}

/**
 * The due-date control, whatever input type the candidate chose. Spec E.1 asks for
 * "a due-date input" and names no type, so <input type="datetime-local"> and a text
 * input named dueAt are both correct answers. A bare input[type="date"] locator made
 * every one of those candidates fail eleven unrelated criteria on a timeout.
 */
function dueDateInput(page: Page) {
  return page
    .locator('input[type="date"], input[type="datetime-local"], input[name="dueAt"]')
    .first();
}

/** Fill the due date in the value form the chosen input type accepts. */
async function fillDueDate(page: Page, date: string): Promise<void> {
  const input = dueDateInput(page);
  await expect(input, "the checkout form has no due-date input").toBeVisible({ timeout: 10_000 });
  const type = (await input.getAttribute("type")) ?? "";
  await input.fill(type === "datetime-local" ? `${date}T00:00` : date);
}

/** Wait until the store actually holds the loan, not just the optimistic badge. */
type LoanRecord = {
  itemId: string; memberId: string; borrowedAt: string; dueAt: string; returnedAt: string | null;
};

/**
 * Read every loan and select in the test, rather than asking the API to filter.
 *
 * Four Tier 0 section-F criteria take their evidence from this call. Sending
 * ?itemId= made them depend on G.filter-item as well, which is Tier 1, so a broken
 * query string could cost four Tier 0 points for a correct section F. The unfiltered
 * GET is checkbox G.1, which those criteria cannot avoid depending on.
 */
async function allLoans(page: Page): Promise<LoanRecord[] | null> {
  const res = await page.request.get("/api/loans", {
    headers: { "x-staff-key": "staff-key-7f3a" },
  });
  if (!res.ok()) return null;
  return ((await res.json()).loans ?? []) as LoanRecord[];
}

async function loanCount(page: Page, itemId: string): Promise<number> {
  const loans = await allLoans(page);
  return loans === null ? -1 : loans.filter((l) => l.itemId === itemId).length;
}

/** Open loans only — a return closes a loan rather than removing it. */
async function openLoanCount(page: Page, itemId: string): Promise<number> {
  const loans = await allLoans(page);
  if (loans === null) return -1;
  return loans.filter((l) => l.itemId === itemId && l.returnedAt === null).length;
}

test("D.renders", async ({ page }) => {
  await page.goto("/items/itm-001");
  await expect(page.getByRole("heading", { level: 1, name: "Cordless Drill" })).toBeVisible();
  await expect(page.getByText("power-tool")).toBeVisible();
  await expect(page.getByText("18V brushless drill with two batteries.")).toBeVisible();
});

test("D.history-order", async ({ page }) => {
  // itm-018 carries eight loans. Newest borrowedAt first is the whole sequence,
  // not just the first row: an ascending sort or an unsorted render both put the
  // right names on screen in the wrong order.
  const expectedHistory = [
    "Dara Nwosu", "Chen Wei", "Bruno Silva", "Ada Okonkwo",
    "Dara Nwosu", "Chen Wei", "Bruno Silva", "Ada Okonkwo",
  ];

  await page.goto("/items/itm-018");
  // This route streams its loan history. Wait for all rows to render, then
  // retain the exact-order assertion below so an ascending/unsorted history
  // cannot pass simply because its names happen to be present.
  await expect.poll(async () => (await historyNames(page)).length, { timeout: 10_000 })
    .toBe(expectedHistory.length);
  expect(await historyNames(page)).toEqual(expectedHistory);
});

test("D.history-status", async ({ page }) => {
  // itm-017: an older returned loan and a newer open one that is not yet due.
  await page.goto("/items/itm-017");
  // Match each status on its own element, not on the whole body. innerText inserts no
  // separator between two inline elements, so a row built as <span>name</span>
  // <span>status</span> reads as "Bruno Silvareturned" and a word boundary fails,
  // although the name, the status and the order are all on screen.
  // These locators also retry, which the single innerText read did not: /items/[id]
  // inherits the /items loading fallback, and two runs read the fallback instead.
  await expect(page.getByText(/returned/i).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/\bok\b/i).first()).toBeVisible({ timeout: 10_000 });
  // itm-003's open loan is past its due date.
  await page.goto("/items/itm-003");
  await expect(page.getByText(/overdue/i).first()).toBeVisible({ timeout: 10_000 });
});

test("D.notfound", async ({ page }) => {
  await page.goto("/items/itm-does-not-exist");
  await expect(page.getByText("That page does not exist.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
});

test("D.metadata", async ({ page }) => {
  await page.goto("/items/itm-001");
  await expect(page).toHaveTitle("Cordless Drill — Lending Desk");
  // The awkward name has to survive too.
  await page.goto("/items/itm-016");
  await expect(page).toHaveTitle("Étau d'Établi — Lending Desk");
});

test("D.form-hidden", async ({ page }) => {
  // itm-003 (Circular Saw) has an open loan -> no checkout form
  await page.goto("/items/itm-003");
  await expect(checkoutForm(page)).toHaveCount(0);
  // itm-017 has an open loan too, behind a newer-looking returned one
  await page.goto("/items/itm-017");
  await expect(checkoutForm(page)).toHaveCount(0);
  // itm-001 is available -> form present
  await page.goto("/items/itm-001");
  await expect(checkoutForm(page).first()).toBeVisible();
});

test("D.return-visible", async ({ page }) => {
  // On loan -> Return, no checkout. itm-017's open loan sits under a newer
  // returned one, so "latest loan" reasoning picks the wrong control.
  for (const id of ["itm-003", "itm-017"]) {
    await page.goto(`/items/${id}`);
    await expect(page.getByRole("button", { name: "Return" })).toBeVisible();
    await expect(checkoutForm(page)).toHaveCount(0);
  }
  // Available -> no Return.
  await page.goto("/items/itm-001");
  await expect(page.getByRole("button", { name: "Return" })).toHaveCount(0);
});

test("E.return-submits", async ({ page }) => {
  await page.goto("/items/itm-025");
  await page.getByRole("button", { name: "Return" }).click();
  // The close has to reach the store, not just the badge.
  await expect.poll(() => openLoanCount(page, "itm-025"), { timeout: 15_000 }).toBe(0);
  // And the page must catch up on its own: the item reads available and the
  // checkout form is offered again, with no manual reload.
  await expect(page.getByRole("button", { name: /check ?out/i })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Return" })).toHaveCount(0);
});

test("E.return-pending", async ({ page }) => {
  await page.goto("/items/itm-026");
  await page.getByRole("button", { name: "Return" }).click();
  const pendingBtn = page.getByRole("button", { name: "Returning…" });
  await expect(pendingBtn).toBeVisible({ timeout: 3000 });
  await expect(pendingBtn).toBeDisabled();
});

test("E.return-optimistic", async ({ page }) => {
  await page.goto("/items/itm-027");
  // Available must show before the server round-trip completes.
  await page.route("**/items/itm-027", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.getByRole("button", { name: "Return" }).click();
  await expect(page.getByText("Available").first()).toBeVisible({ timeout: 800 });
});

test("E.submits", async ({ page }) => {
  await page.goto("/items/itm-004");
  await page.getByRole("combobox").first().selectOption({ label: "Ada Okonkwo" });
  await fillDueDate(page, "2026-04-30");
  await page.getByRole("button", { name: /check ?out/i }).click();
  // E.2 is "submitting calls checkoutItem with the item id, the member and the due
  // date", which the store answers. Poll it first: asserting the badge first charged
  // an E.4 defect to this id as well, and E.optimistic already grades the badge.
  await expect.poll(() => loanCount(page, "itm-004"), { timeout: 15_000 }).toBe(1);
  await expect(page.getByText("On loan").first()).toBeVisible({ timeout: 10_000 });
});

test("E.pending", async ({ page }) => {
  await page.goto("/items/itm-005");
  await page.getByRole("combobox").first().selectOption({ label: "Bruno Silva" });
  await fillDueDate(page, "2026-04-30");
  await page.getByRole("button", { name: /check ?out/i }).click();
  // The control both reads "Checking out…" and stops accepting a second submit.
  const pendingBtn = page.getByRole("button", { name: "Checking out…" });
  await expect(pendingBtn).toBeVisible({ timeout: 3000 });
  await expect(pendingBtn).toBeDisabled();
});

test("E.optimistic", async ({ page }) => {
  await page.goto("/items/itm-006");
  await page.getByRole("combobox").first().selectOption({ label: "Chen Wei" });
  await fillDueDate(page, "2026-04-30");
  // Optimistic state must appear well before the server round-trip completes.
  await page.route("**/items/itm-006", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.getByRole("button", { name: /check ?out/i }).click();
  await expect(page.getByText("On loan").first()).toBeVisible({ timeout: 800 });
});

test("E.error-shown", async ({ page }) => {
  await page.goto("/items/itm-008");
  await page.getByRole("combobox").first().selectOption({ label: "Ada Okonkwo" });
  await fillDueDate(page, "2020-01-01"); // past
  await page.getByRole("button", { name: /check ?out/i }).click();
  await expect(page.getByText("Due date must be in the future")).toBeVisible({ timeout: 10_000 });
  // A rejected checkout must not leave the optimistic badge behind.
  await expect(page.getByText("On loan")).toHaveCount(0);
});

test("P.stale-after-mutate", async ({ page }) => {
  await page.goto("/items/itm-009");
  await page.getByRole("combobox").first().selectOption({ label: "Dara Nwosu" });
  await fillDueDate(page, "2026-04-30");
  await page.getByRole("button", { name: /check ?out/i }).click();
  // Let the write land first — navigating mid-action aborts it, and this probe
  // is about staleness, not about whether the mutation ran.
  await expect.poll(() => loanCount(page, "itm-009"), { timeout: 15_000 }).toBe(1);
  // The catalogue must reflect it on the next visit, with no manual reload.
  await page.goto("/items");
  await expect(page.getByRole("link", { name: /Moisture Meter/ })).toContainText("On loan");
});

const STAFF_HEADERS = { "x-staff-key": "staff-key-7f3a" };
const BENCH_NOW = "2026-03-15T12:00:00.000Z";
const CHECKOUT_DUE = "2026-04-30";
const CHECKOUT_DUE_ISO = "2026-04-30T00:00:00.000Z";

/**
 * F.1 records "the given `dueAt`". The form field holds a calendar date, and no
 * checkbox states a date-to-instant convention, so accept any instant inside that UTC
 * day. A raw string compare failed four candidates on a Tier 0 criterion for storing
 * "2026-04-30", which is exactly what the form gave them.
 */
function onDueDate(value: string, day: string): boolean {
  const at = Date.parse(value);
  const start = Date.parse(day + "T00:00:00.000Z");
  return Number.isFinite(at) && at >= start && at < start + 86_400_000;
}

async function expectDueOn(page: Page, itemId: string, day: string): Promise<void> {
  const [loan] = await loansFor(page, itemId);
  expect(onDueDate(loan.dueAt, day), `dueAt ${loan.dueAt} is not on ${day}`).toBe(true);
}

async function loansFor(page: Page, itemId: string): Promise<LoanRecord[]> {
  const loans = await allLoans(page);
  expect(loans, "GET /api/loans did not answer").not.toBeNull();
  return loans!.filter((loan) => loan.itemId === itemId);
}

async function createOpenLoan(page: Page, itemId: string, memberId = "mbr-001") {
  const response = await page.request.post("/api/loans", {
    headers: { ...STAFF_HEADERS, "content-type": "application/json" },
    data: { itemId, memberId, dueAt: CHECKOUT_DUE_ISO },
  });
  expect(response.status()).toBe(201);
}

async function closeOpenLoan(page: Page, itemId: string) {
  const response = await page.request.patch("/api/loans", {
    headers: { ...STAFF_HEADERS, "content-type": "application/json" },
    data: { itemId },
  });
  expect(response.status()).toBe(200);
}

/**
 * The checkout form, found by a part spec.md states. E.1 requires a member selector;
 * the idle submit label is stated nowhere, and "Check out" appears only in
 * reference/app/items/[id]/checkout-form.tsx. Presence tests use this; the click sites
 * still need a button and keep the tolerant /check ?out/i pattern.
 */
function checkoutForm(page: Page) {
  return page.getByRole("combobox");
}

/** The five seeded members, sorted, so the assertion does not fix an option order. */
const MEMBER_NAMES = ["Ada Okonkwo", "Bruno Silva", "Chen Wei", "Chen Weiming", "Dara Nwosu"];

test("E.member-options", async ({ page }) => {
  await page.goto("/items/itm-002");
  // E.1 asks only for "a member selector listing `members` by name". It states no
  // placeholder option, no placeholder wording and no option order. Grading the exact
  // option array made 17 of 19 candidates fail for rendering the five names and
  // nothing else, which is what the checkbox asks for.
  await expect
    .poll(async () => {
      const texts = await page.getByRole("combobox").locator("option").allTextContents();
      return texts.map((text) => text.trim()).filter((text) => MEMBER_NAMES.includes(text)).sort();
    }, { timeout: 10_000 })
    .toEqual(MEMBER_NAMES);
  await expect(dueDateInput(page)).toBeVisible();
});

test("F.auth-checkout", async ({ page }) => {
  // The page starts authenticated so this gets a real Server Action token. Removing
  // the cookie only after that makes this an action-auth test, not a hidden-UI test.
  await page.goto("/items/itm-002");
  await page.getByRole("combobox").first().selectOption({ label: "Ada Okonkwo" });
  await fillDueDate(page, CHECKOUT_DUE);
  await page.context().clearCookies();
  await page.getByRole("button", { name: /check ?out/i }).click();
  await expect(page.getByText("Not authorized")).toBeVisible();
  expect(await loansFor(page, "itm-002")).toEqual([]);
});

test("F.auth-return", async ({ page }) => {
  await page.goto("/items/itm-028");
  await expect(page.getByRole("button", { name: "Return" })).toBeVisible();
  await page.context().clearCookies();
  await page.getByRole("button", { name: "Return" }).click();
  await expect(page.getByText("Not authorized")).toBeVisible();
  expect((await loansFor(page, "itm-028")).filter((loan) => loan.returnedAt === null)).toHaveLength(1);
});

test("F.checkout-conflict", async ({ page }) => {
  // Keep the form from a page that was available, then make the item unavailable
  // through a distinct staff request. The action itself must reject the stale submit.
  await page.goto("/items/itm-019");
  await createOpenLoan(page, "itm-019", "mbr-004");
  await page.getByRole("combobox").first().selectOption({ label: "Ada Okonkwo" });
  await fillDueDate(page, CHECKOUT_DUE);
  await page.getByRole("button", { name: /check ?out/i }).click();
  await expect(page.getByText("Item is already on loan")).toBeVisible();
  expect(await loansFor(page, "itm-019")).toHaveLength(1);
});

test("F.return-not-on-loan", async ({ page }) => {
  await createOpenLoan(page, "itm-020", "mbr-005");
  await page.goto("/items/itm-020");
  await expect(page.getByRole("button", { name: "Return" })).toBeVisible();
  await closeOpenLoan(page, "itm-020");
  await page.getByRole("button", { name: "Return" }).click();
  await expect(page.getByText("Item is not on loan")).toBeVisible();
  expect((await loansFor(page, "itm-020")).every((loan) => loan.returnedAt !== null)).toBe(true);
});

test("F.checkout-record", async ({ page }) => {
  const itemId = "itm-021";
  await page.goto("/items/" + itemId);
  await page.getByRole("combobox").first().selectOption({ label: "Chen Weiming" });
  await fillDueDate(page, CHECKOUT_DUE);
  await page.getByRole("button", { name: /check ?out/i }).click();
  await expect.poll(() => loansFor(page, itemId), { timeout: 15_000 }).toEqual([
    expect.objectContaining({
      itemId,
      memberId: "mbr-005",
      borrowedAt: BENCH_NOW,
      returnedAt: null,
    }),
  ]);
  await expectDueOn(page, itemId, CHECKOUT_DUE);
});

test("F.return-record", async ({ page }) => {
  const itemId = "itm-022";
  await createOpenLoan(page, itemId, "mbr-004");
  await page.goto("/items/" + itemId);
  await page.getByRole("button", { name: "Return" }).click();
  await expect.poll(() => loansFor(page, itemId), { timeout: 15_000 }).toEqual([
    expect.objectContaining({
      itemId,
      memberId: "mbr-004",
      borrowedAt: BENCH_NOW,
      returnedAt: BENCH_NOW,
    }),
  ]);
});

test("F.future-due-date", async ({ page }) => {
  const itemId = "itm-023";
  await page.goto("/items/" + itemId);
  await page.getByRole("combobox").first().selectOption({ label: "Ada Okonkwo" });
  // 2026-03-15 is the day of the fixed clock, so a candidate that reads a bare date
  // as end of day gets an instant after now and correctly accepts the checkout.
  // Pick a day that is in the past under every convention.
  await fillDueDate(page, "2026-03-14");
  await page.getByRole("button", { name: /check ?out/i }).click();
  await expect(page.getByText("Due date must be in the future")).toBeVisible({ timeout: 10_000 });
  expect(await loansFor(page, itemId)).toEqual([]);
});

test("F.post-mutation-state", async ({ page }) => {
  const itemId = "itm-014";
  await page.goto("/items/" + itemId);
  await page.getByRole("combobox").first().selectOption({ label: "Bruno Silva" });
  await fillDueDate(page, CHECKOUT_DUE);
  await page.getByRole("button", { name: /check ?out/i }).click();
  await expect.poll(() => openLoanCount(page, itemId), { timeout: 15_000 }).toBe(1);

  // A next visit, rather than a local optimistic badge, must show the new checkout.
  await page.goto("/items");
  await expect(page.getByRole("link", { name: /TILE CUTTER XL/ })).toContainText("On loan");
  await page.goto("/items/" + itemId);
  await expect(page.getByRole("button", { name: "Return" })).toBeVisible();
  await expect(page.getByRole("button", { name: /check ?out/i })).toHaveCount(0);

  await page.getByRole("button", { name: "Return" }).click();
  await expect.poll(() => openLoanCount(page, itemId), { timeout: 15_000 }).toBe(0);
  await page.goto("/items");
  await expect(page.getByRole("link", { name: /TILE CUTTER XL/ })).toContainText("Available");
  await page.goto("/items/" + itemId);
  await expect(page.getByRole("button", { name: /check ?out/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Return" })).toHaveCount(0);
});

test("F.lifecycle", async ({ page }) => {
  await page.goto("/items/itm-029");
  await page.getByRole("combobox").first().selectOption({ label: "Chen Weiming" });
  await fillDueDate(page, CHECKOUT_DUE);
  await page.getByRole("button", { name: /check ?out/i }).click();
  await expect.poll(() => loansFor(page, "itm-029"), { timeout: 15_000 }).toEqual([
    expect.objectContaining({
      itemId: "itm-029", memberId: "mbr-005", borrowedAt: BENCH_NOW, returnedAt: null,
    }),
  ]);
  await expectDueOn(page, "itm-029", CHECKOUT_DUE);
  await page.goto("/items/itm-029");
  await expect(page.getByRole("button", { name: "Return" })).toBeVisible();
  await page.getByRole("button", { name: "Return" }).click();
  await expect.poll(() => loansFor(page, "itm-029"), { timeout: 15_000 }).toEqual([
    expect.objectContaining({ returnedAt: BENCH_NOW }),
  ]);
  await page.goto("/items");
  await expect(page.getByRole("link", { name: /Tin Snips/ })).toContainText("Available");
  await page.goto("/items/itm-029");
  await expect(page.getByRole("button", { name: /check ?out/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Return" })).toHaveCount(0);
});

test("E.return-error", async ({ page }) => {
  await page.goto("/items/itm-028");
  await page.route("**/items/itm-028", async (route) => {
    if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.context().clearCookies();
  await page.getByRole("button", { name: "Return" }).click();
  // E.9 is the only checkbox this id owns: the rejected error string is rendered.
  // Assert it first. The optimistic state belongs to E.8 and already has its own id,
  // so grading it here charged one defect twice: 11 of 19 runs failed on the
  // optimistic line and never reached the assertion the id is mapped to.
  await expect(page.getByText("Not authorized")).toBeVisible({ timeout: 10_000 });
  // The revert, read from structure rather than from wording. B.2 fixes the badge
  // vocabulary but no checkbox states how the detail page phrases availability, and
  // an exact "Available" match failed candidates that render "Status: Available".
  await expect(page.getByRole("button", { name: "Return" })).toBeVisible();
  expect((await loansFor(page, "itm-028")).filter((loan) => loan.returnedAt === null)).toHaveLength(1);
});
