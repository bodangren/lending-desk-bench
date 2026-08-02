"use server";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Record a loan of `itemId` to `memberId`, due at `dueAt` (ISO 8601).
 * See spec section F.
 */
export async function checkoutItem(
  itemId: string,
  memberId: string,
  dueAt: string,
): Promise<ActionResult> {
  // TODO: implement (spec F)
  return { ok: false, error: "Not implemented" };
}

/**
 * Record the return of the open loan on `itemId`.
 * See spec section F.
 */
export async function returnItem(itemId: string): Promise<ActionResult> {
  // TODO: implement (spec F)
  return { ok: false, error: "Not implemented" };
}
