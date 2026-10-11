"use server";

import { revalidatePath } from "next/cache";
import { ItemOnLoanError, LoanAlreadyClosedError, closeLoan, findOpenLoan, insertLoan, now } from "@/src/db";
import { getStaffSession } from "@/src/lib/auth";

export type ActionResult = { ok: true } | { ok: false; error: string };

const fail = (error: string): ActionResult => ({ ok: false, error });

function refreshViews(itemId: string): void {
  revalidatePath("/items");
  revalidatePath(`/items/${itemId}`);
}

/**
 * Record a loan of `itemId` to `memberId`, due at `dueAt` (ISO 8601).
 * See spec section F.
 */
export async function checkoutItem(
  itemId: string,
  memberId: string,
  dueAt: string,
): Promise<ActionResult> {
  if (!(await getStaffSession())) return fail("Not authorized");
  const current = now();
  const due = new Date(dueAt);
  if (!(due.getTime() > current.getTime())) return fail("Due date must be in the future");
  try {
    // The store refuses a second open loan when the write lands. That one check
    // covers a stale form and two desks racing for the same item.
    await insertLoan({
      itemId,
      memberId,
      borrowedAt: current.toISOString(),
      dueAt: due.toISOString(),
      returnedAt: null,
    });
  } catch (error) {
    if (error instanceof ItemOnLoanError) return fail("Item is already on loan");
    throw error;
  }
  refreshViews(itemId);
  return { ok: true };
}

/**
 * Record the return of the open loan on `itemId`.
 * See spec section F.
 */
export async function returnItem(itemId: string): Promise<ActionResult> {
  if (!(await getStaffSession())) return fail("Not authorized");
  const open = await findOpenLoan(itemId);
  if (open === null) return fail("Item is not on loan");
  try {
    await closeLoan(open.id, now().toISOString());
  } catch (error) {
    if (error instanceof LoanAlreadyClosedError) return fail("Item is not on loan");
    throw error;
  }
  refreshViews(itemId);
  return { ok: true };
}
