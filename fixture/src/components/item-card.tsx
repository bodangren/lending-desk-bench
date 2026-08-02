import type { Item, Loan } from "@/src/db/schema";

/**
 * Catalogue tile for a single item.
 * `openLoan` is the item's current unreturned loan, or null when available.
 * See spec section B.
 */
export function ItemCard({
  item,
  openLoan,
}: {
  item: Item;
  openLoan: Loan | null;
}) {
  // TODO: implement (spec B)
  return null;
}
