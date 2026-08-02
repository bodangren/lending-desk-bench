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

/** Wait until the store actually holds the loan, not just the optimistic badge. */
async function loanCount(page: Page, itemId: string): Promise<number> {
  const res = await page.request.get(`/api/loans?itemId=${itemId}`, {
    headers: { "x-staff-key": "staff-key-7f3a" },
  });
  return res.ok() ? ((await res.json()).loans?.length ?? -1) : -1;
}

/** Open loans only — a return closes a loan rather than removing it. */
async function openLoanCount(page: Page, itemId: string): Promise<number> {
  const res = await page.request.get(`/api/loans?itemId=${itemId}`, {
    headers: { "x-staff-key": "staff-key-7f3a" },
  });
  if (!res.ok()) return -1;
  const loans = (await res.json()).loans ?? [];
  return loans.filter((l: { returnedAt: string | null }) => l.returnedAt === null).length;
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
  const body = await page.locator("body").innerText();
  expect(body).toMatch(/\breturned\b/);
  expect(body).toMatch(/\bok\b/);
  // itm-003's open loan is past its due date.
  await page.goto("/items/itm-003");
  await expect(page.getByText("overdue")).toBeVisible();
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
  await expect(page.getByRole("button", { name: /check ?out/i })).toHaveCount(0);
  // itm-017 has an open loan too, behind a newer-looking returned one
  await page.goto("/items/itm-017");
  await expect(page.getByRole("button", { name: /check ?out/i })).toHaveCount(0);
  // itm-001 is available -> form present
  await page.goto("/items/itm-001");
  await expect(page.getByRole("button", { name: /check ?out/i })).toBeVisible();
});

test("D.return-visible", async ({ page }) => {
  // On loan -> Return, no checkout. itm-017's open loan sits under a newer
  // returned one, so "latest loan" reasoning picks the wrong control.
  for (const id of ["itm-003", "itm-017"]) {
    await page.goto(`/items/${id}`);
    await expect(page.getByRole("button", { name: "Return" })).toBeVisible();
    await expect(page.getByRole("button", { name: /check ?out/i })).toHaveCount(0);
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
  await page.getByRole("combobox").selectOption({ label: "Ada Okonkwo" });
  await page.getByRole("textbox").or(page.locator('input[type="date"]')).first().fill("2026-04-30");
  await page.getByRole("button", { name: /check ?out/i }).click();
  await expect(page.getByText("On loan").first()).toBeVisible({ timeout: 10_000 });
  // The badge alone can be optimistic. The loan has to reach the store.
  await expect.poll(() => loanCount(page, "itm-004"), { timeout: 15_000 }).toBe(1);
});

test("E.pending", async ({ page }) => {
  await page.goto("/items/itm-005");
  await page.getByRole("combobox").selectOption({ label: "Bruno Silva" });
  await page.locator('input[type="date"]').first().fill("2026-04-30");
  await page.getByRole("button", { name: /check ?out/i }).click();
  // The control both reads "Checking out…" and stops accepting a second submit.
  const pendingBtn = page.getByRole("button", { name: "Checking out…" });
  await expect(pendingBtn).toBeVisible({ timeout: 3000 });
  await expect(pendingBtn).toBeDisabled();
});

test("E.optimistic", async ({ page }) => {
  await page.goto("/items/itm-006");
  await page.getByRole("combobox").selectOption({ label: "Chen Wei" });
  await page.locator('input[type="date"]').first().fill("2026-04-30");
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
  await page.getByRole("combobox").selectOption({ label: "Ada Okonkwo" });
  await page.locator('input[type="date"]').first().fill("2020-01-01"); // past
  await page.getByRole("button", { name: /check ?out/i }).click();
  await expect(page.getByText("Due date must be in the future")).toBeVisible({ timeout: 10_000 });
  // A rejected checkout must not leave the optimistic badge behind.
  await expect(page.getByText("On loan")).toHaveCount(0);
});

test("P.stale-after-mutate", async ({ page }) => {
  await page.goto("/items/itm-009");
  await page.getByRole("combobox").selectOption({ label: "Dara Nwosu" });
  await page.locator('input[type="date"]').first().fill("2026-04-30");
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

async function loansFor(page: Page, itemId: string) {
  const response = await page.request.get(`/api/loans?itemId=${itemId}`, {
    headers: STAFF_HEADERS,
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).loans as Array<{
    itemId: string; memberId: string; borrowedAt: string; dueAt: string; returnedAt: string | null;
  }>;
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

test("E.member-options", async ({ page }) => {
  await page.goto("/items/itm-002");
  await expect(page.getByRole("combobox").locator("option")).toHaveText([
    "Select a member", "Ada Okonkwo", "Bruno Silva", "Chen Wei", "Dara Nwosu", "Chen Weiming",
  ]);
  await expect(page.locator('input[type="date"]')).toHaveCount(1);
});

test("F.auth-checkout", async ({ page }) => {
  // The page starts authenticated so this gets a real Server Action token. Removing
  // the cookie only after that makes this an action-auth test, not a hidden-UI test.
  await page.goto("/items/itm-002");
  await page.getByRole("combobox").selectOption({ label: "Ada Okonkwo" });
  await page.locator('input[type="date"]').fill(CHECKOUT_DUE);
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
  await page.getByRole("combobox").selectOption({ label: "Ada Okonkwo" });
  await page.locator('input[type="date"]').fill(CHECKOUT_DUE);
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
  await page.getByRole("combobox").selectOption({ label: "Chen Weiming" });
  await page.locator('input[type="date"]').fill(CHECKOUT_DUE);
  await page.getByRole("button", { name: /check ?out/i }).click();
  await expect.poll(() => loansFor(page, itemId), { timeout: 15_000 }).toEqual([
    expect.objectContaining({
      itemId,
      memberId: "mbr-005",
      borrowedAt: BENCH_NOW,
      dueAt: CHECKOUT_DUE_ISO,
      returnedAt: null,
    }),
  ]);
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
  await page.getByRole("combobox").selectOption({ label: "Ada Okonkwo" });
  await page.locator('input[type="date"]').fill("2026-03-15");
  await page.getByRole("button", { name: /check ?out/i }).click();
  await expect(page.getByText("Due date must be in the future")).toBeVisible({ timeout: 10_000 });
  expect(await loansFor(page, itemId)).toEqual([]);
});

test("F.post-mutation-state", async ({ page }) => {
  const itemId = "itm-014";
  await page.goto("/items/" + itemId);
  await page.getByRole("combobox").selectOption({ label: "Bruno Silva" });
  await page.locator('input[type="date"]').fill(CHECKOUT_DUE);
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
  await page.getByRole("combobox").selectOption({ label: "Chen Weiming" });
  await page.locator('input[type="date"]').fill(CHECKOUT_DUE);
  await page.getByRole("button", { name: /check ?out/i }).click();
  await expect.poll(() => loansFor(page, "itm-029"), { timeout: 15_000 }).toEqual([
    expect.objectContaining({
      itemId: "itm-029", memberId: "mbr-005", borrowedAt: BENCH_NOW,
      dueAt: CHECKOUT_DUE_ISO, returnedAt: null,
    }),
  ]);
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
  await expect(page.getByText("Available", { exact: true })).toBeVisible({ timeout: 800 });
  await expect(page.getByText("Not authorized")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Available", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Return" })).toBeVisible();
  expect((await loansFor(page, "itm-028")).filter((loan) => loan.returnedAt === null)).toHaveLength(1);
});
