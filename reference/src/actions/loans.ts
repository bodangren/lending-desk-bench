"use server";

import { revalidatePath } from "next/cache";
import {
  ItemOnLoanError,
  LoanAlreadyClosedError,
  closeLoan,
  findOpenLoan,
  getItem,
  getMember,
  insertLoan,
  now,
} from "@/src/db";
import { getStaffSession } from "@/src/lib/auth";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function checkoutItem(
  itemId: string,
  memberId: string,
  dueAt: string,
): Promise<ActionResult> {
  // Authorise inside the action: it is reachable independently of any page.
  const session = await getStaffSession();
  if (!session) return { ok: false, error: "Not authorized" };

  const due = Date.parse(dueAt);
  if (Number.isNaN(due)) return { ok: false, error: "Due date must be in the future" };
  const at = now();
  if (due <= at.getTime()) return { ok: false, error: "Due date must be in the future" };

  const [item, member] = await Promise.all([getItem(itemId), getMember(memberId)]);
  if (!item) return { ok: false, error: "Unknown item" };
  if (!member) return { ok: false, error: "Unknown member" };

  // Cheap answer for the common case…
  if (await findOpenLoan(itemId)) return { ok: false, error: "Item is already on loan" };

  try {
    await insertLoan({
      itemId,
      memberId,
      borrowedAt: at.toISOString(),
      dueAt: new Date(due).toISOString(),
      returnedAt: null,
    });
  } catch (error) {
    // …and the real one: the check above is a read, and another request can
    // take the item between that read and this write.
    if (error instanceof ItemOnLoanError) {
      return { ok: false, error: "Item is already on loan" };
    }
    throw error;
  }

  revalidatePath("/items");
  revalidatePath(`/items/${itemId}`);
  return { ok: true };
}

export async function returnItem(itemId: string): Promise<ActionResult> {
  const session = await getStaffSession();
  if (!session) return { ok: false, error: "Not authorized" };

  const open = await findOpenLoan(itemId);
  if (!open) return { ok: false, error: "Item is not on loan" };

  try {
    await closeLoan(open.id, now().toISOString());
  } catch (error) {
    if (error instanceof LoanAlreadyClosedError) {
      return { ok: false, error: "Item is not on loan" };
    }
    throw error;
  }

  revalidatePath("/items");
  revalidatePath(`/items/${itemId}`);
  return { ok: true };
}
