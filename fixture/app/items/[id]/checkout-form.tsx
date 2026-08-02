"use client";

import type { Member } from "@/src/db/schema";

/**
 * Checkout control shown on the item detail page. See spec section E.
 */
export function CheckoutForm({
  itemId,
  members,
}: {
  itemId: string;
  members: Member[];
}) {
  // TODO: implement (spec E)
  return null;
}

/**
 * Return control shown when an item has an open loan. See spec section E.
 */
export function ReturnButton({ itemId }: { itemId: string }) {
  void itemId;
  // TODO: implement (spec E)
  return null;
}
