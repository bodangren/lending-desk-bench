/**
 * Shared browser helpers for the checkout and return forms (spec D, E, F and the
 * form probes). State is read and prepared through the fixture's grader-only
 * route app/api/bench-state, never through the /api/loans handler under test.
 * The leading underscore keeps Playwright from collecting this file as a spec.
 */
import { expect, type Page } from "@playwright/test";

/**
 * The due-date control, whatever input type the candidate chose. Spec E.1 asks for
 * "a due-date input" and names no type, so <input type="datetime-local"> and a text
 * input named dueAt are both correct answers. A bare input[type="date"] locator made
 * every one of those candidates fail eleven unrelated criteria on a timeout.
 */
export function dueDateInput(page: Page) {
  return page
    .locator('input[type="date"], input[type="datetime-local"], input[name="dueAt"]')
    .first();
}

/** Fill the due date in the value form the chosen input type accepts. */
export async function fillDueDate(page: Page, date: string): Promise<void> {
  const input = dueDateInput(page);
  await expect(input, "the checkout form has no due-date input").toBeVisible({ timeout: 10_000 });
  const type = (await input.getAttribute("type")) ?? "";
  await input.fill(type === "datetime-local" ? `${date}T00:00` : date);
}

/** Wait until the store actually holds the loan, not just the optimistic badge. */
export type LoanRecord = {
  itemId: string; memberId: string; borrowedAt: string; dueAt: string; returnedAt: string | null;
};

/**
 * Read every loan through the fixture's grader-only route and select in the test.
 *
 * Sections E and F grade the forms and the actions. Under fixture r1 their evidence
 * came from GET /api/loans, which section G grades on its own, so a candidate that
 * left route.ts as its stub also lost about 25 E and F criteria for correct forms
 * and actions. The protected route app/api/bench-state reads the store directly and
 * answers only to the key grade.sh gives this server.
 */
export const BENCH_STATE_HEADERS = { "x-bench-state-key": process.env.BENCH_STATE_KEY || "bench-state-local" };

export async function allLoans(page: Page): Promise<LoanRecord[] | null> {
  const res = await page.request.get("/api/bench-state", { headers: BENCH_STATE_HEADERS });
  if (!res.ok()) return null;
  return ((await res.json()).loans ?? []) as LoanRecord[];
}

export async function loanCount(page: Page, itemId: string): Promise<number> {
  const loans = await allLoans(page);
  return loans === null ? -1 : loans.filter((l) => l.itemId === itemId).length;
}

/** Open loans only — a return closes a loan rather than removing it. */
export async function openLoanCount(page: Page, itemId: string): Promise<number> {
  const loans = await allLoans(page);
  if (loans === null) return -1;
  return loans.filter((l) => l.itemId === itemId && l.returnedAt === null).length;
}

export const BENCH_NOW = "2026-03-15T12:00:00.000Z";
export const CHECKOUT_DUE = "2026-04-30";
export const CHECKOUT_DUE_ISO = "2026-04-30T00:00:00.000Z";

/**
 * F.1 records "the given `dueAt`". The form field holds a calendar date, and no
 * checkbox states a date-to-instant convention, so accept any instant inside that UTC
 * day. A raw string compare failed four candidates on a Tier 0 criterion for storing
 * "2026-04-30", which is exactly what the form gave them.
 */
export function onDueDate(value: string, day: string): boolean {
  const at = Date.parse(value);
  const start = Date.parse(day + "T00:00:00.000Z");
  return Number.isFinite(at) && at >= start && at < start + 86_400_000;
}

export async function expectDueOn(page: Page, itemId: string, day: string): Promise<void> {
  const [loan] = await loansFor(page, itemId);
  expect(onDueDate(loan.dueAt, day), `dueAt ${loan.dueAt} is not on ${day}`).toBe(true);
}

export async function loansFor(page: Page, itemId: string): Promise<LoanRecord[]> {
  const loans = await allLoans(page);
  expect(loans, "the grader state route did not answer").not.toBeNull();
  return loans!.filter((loan) => loan.itemId === itemId);
}

/** Prepare state through the grader route, not through the /api/loans under test. */
export async function createOpenLoan(page: Page, itemId: string, memberId = "mbr-001") {
  const response = await page.request.post("/api/bench-state", {
    headers: { ...BENCH_STATE_HEADERS, "content-type": "application/json" },
    data: { op: "open", itemId, memberId, dueAt: CHECKOUT_DUE_ISO },
  });
  expect(response.status()).toBe(201);
}

export async function closeOpenLoan(page: Page, itemId: string) {
  const response = await page.request.post("/api/bench-state", {
    headers: { ...BENCH_STATE_HEADERS, "content-type": "application/json" },
    data: { op: "close", itemId },
  });
  expect(response.status()).toBe(200);
}

/**
 * The checkout form, found by a part spec.md states. E.1 requires a member selector;
 * the idle submit label is stated nowhere, and "Check out" appears only in
 * reference/app/items/[id]/checkout-form.tsx. Presence tests use this; the click sites
 * still need a button and keep the tolerant /check ?out/i pattern.
 */
export function checkoutForm(page: Page) {
  return page.getByRole("combobox");
}
