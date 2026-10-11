import Image from "next/image";
import Link from "next/link";
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
  const onLoan = openLoan !== null;
  return (
    <Link
      href={`/items/${item.id}`}
      className="flex items-center gap-4 rounded-md border border-neutral-300 p-3 hover:bg-neutral-50"
    >
      <div className="min-w-0 flex-1">
        <p className={onLoan ? "text-xs font-medium text-amber-800" : "text-xs font-medium text-emerald-800"}>
          {onLoan ? "On loan" : "Available"}
        </p>
        <h3 className="truncate font-semibold">{item.name}</h3>
        <p className="text-sm text-neutral-500">{item.category}</p>
      </div>
      <Image unoptimized alt={item.name} src={item.imageUrl} width={64} height={64} />
    </Link>
  );
}
