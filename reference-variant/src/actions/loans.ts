"use server";

import { revalidatePath } from "next/cache";
import {
  ItemOnLoanError,
  LoanAlreadyClosedError,
  closeLoan,
  findOpenLoan,
  insertLoan,
  now,
} from "@/src/db";
import { getStaffSession } from "@/src/lib/auth";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function callerIsStaff(): Promise<boolean> {
  return (await getStaffSession()) !== null;
}

export async function checkoutItem(
  itemId: string,
  memberId: string,
  dueAt: string,
): Promise<ActionResult> {
  if (!(await callerIsStaff())) return { ok: false, error: "Not authorized" };

  const due = Date.parse(dueAt);
  const borrowedAt = now();
  if (!Number.isFinite(due) || due <= borrowedAt.getTime()) {
    return { ok: false, error: "Due date must be in the future" };
  }

  try {
    await insertLoan({
      itemId,
      memberId,
      borrowedAt: borrowedAt.toISOString(),
      dueAt,
      returnedAt: null,
    });
  } catch (error) {
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
  if (!(await callerIsStaff())) return { ok: false, error: "Not authorized" };

  const openLoan = await findOpenLoan(itemId);
  if (!openLoan) return { ok: false, error: "Item is not on loan" };

  try {
    await closeLoan(openLoan.id, now().toISOString());
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
