/**
 * Change track only (lending_desk_change): CR-1, CR-3 through the form, and CR-4.
 * grade.sh leaves these out of every other track with --grep-invert "X\.".
 *
 * Other spec files change loans on the shared server, so these tests name items
 * whose state no other test changes, and never count the whole catalogue.
 */
import { expect, test, type Page } from "@playwright/test";
import { closeOpenLoan, fillDueDate, loansFor } from "./_forms";

const card = (page: Page, id: string) => page.locator(`a[href="/items/${id}"]`);
const cards = (page: Page) => page.locator('a[href^="/items/itm-"]');

/** Every card on the page shows the badge, and none shows the other one. */
async function expectAllBadges(page: Page, badge: "Available" | "On loan") {
  const other = badge === "Available" ? /on loan/i : /available/i;
  const texts = await cards(page).allTextContents();
  expect(texts.length, "the filtered catalogue is empty").toBeGreaterThan(0);
  for (const text of texts) {
    expect(text, `a card without ${badge}: ${text}`).toContain(badge);
    expect(text, `a card with the other badge: ${text}`).not.toMatch(other);
  }
}

test("X.status-available", async ({ page }) => {
  await page.goto("/items?status=available");
  // itm-001 and itm-013 hold only returned loans; itm-003 is on loan and overdue;
  // itm-017's open loan sits behind a returned one.
  await expect(card(page, "itm-001")).toHaveCount(1);
  await expect(card(page, "itm-013")).toHaveCount(1);
  await expect(card(page, "itm-003")).toHaveCount(0);
  await expect(card(page, "itm-017")).toHaveCount(0);
  await expectAllBadges(page, "Available");
});

test("X.status-on-loan", async ({ page }) => {
  await page.goto("/items?status=on-loan");
  await expect(card(page, "itm-003")).toHaveCount(1);
  await expect(card(page, "itm-017")).toHaveCount(1);
  await expect(card(page, "itm-001")).toHaveCount(0);
  await expect(card(page, "itm-013")).toHaveCount(0);
  await expectAllBadges(page, "On loan");
});

test("X.status-combined", async ({ page }) => {
  // With category: the two power tools on loan, not the measuring tool on loan.
  await page.goto("/items?status=on-loan&category=power-tool");
  await expect(card(page, "itm-003")).toHaveCount(1);
  await expect(card(page, "itm-017")).toHaveCount(1);
  await expect(card(page, "itm-007")).toHaveCount(0);
  await expect(card(page, "itm-001")).toHaveCount(0);
  // With q, both ways, and the empty result.
  await page.goto("/items?status=available&q=cordless");
  await expect(card(page, "itm-001")).toHaveCount(1);
  await expect(cards(page)).toHaveCount(1);
  await page.goto("/items?status=on-loan&q=cordless");
  await expect(page.getByText("No items match your search.")).toBeVisible();
  // An unknown status is ignored: every safety item, on loan or not.
  await page.goto("/items?status=reserved&category=safety");
  await expect(card(page, "itm-010")).toHaveCount(1);
  await expect(card(page, "itm-021")).toHaveCount(1);
});

test("X.due-limit-action", async ({ page }) => {
  // 2026-05-20 is 66 days after the fixed clock. itm-016 holds one returned loan
  // (lon-011), and no other test asserts its loans: an app that wrongly accepts
  // this checkout must not also fail a build criterion that shares the item.
  const itemId = "itm-016";
  await page.goto(`/items/${itemId}`);
  await page.getByRole("combobox").first().selectOption({ label: "Ada Okonkwo" });
  await fillDueDate(page, "2026-05-20");
  await page.getByRole("button", { name: /check ?out/i }).click();
  try {
    await expect(page.getByText("Due date must be within 60 days")).toBeVisible({ timeout: 10_000 });
    expect((await loansFor(page, itemId)).filter((loan) => loan.returnedAt === null)).toEqual([]);
  } finally {
    if ((await loansFor(page, itemId)).some((loan) => loan.returnedAt === null)) await closeOpenLoan(page, itemId);
  }
});

test("X.detail-borrower", async ({ page }) => {
  // lon-001: Ada Okonkwo, due 72h before the fixed clock. lon-003: Chen Wei (a
  // strict prefix of Chen Weiming), due 200h after it.
  await page.goto("/items/itm-003");
  await expect(page.getByText("On loan to Ada Okonkwo, due 2026-03-12")).toBeVisible({ timeout: 10_000 });
  await page.goto("/items/itm-010");
  await expect(page.getByText("On loan to Chen Wei, due 2026-03-23")).toBeVisible({ timeout: 10_000 });
  await page.goto("/items/itm-001");
  await expect(page.getByRole("heading", { level: 1, name: "Cordless Drill" })).toBeVisible();
  await expect(page.getByText(/on loan to/i)).toHaveCount(0);
});
