import Image from "next/image";
import Link from "next/link";
import type { Item, Loan } from "@/src/db/schema";

export function ItemCard({ item, openLoan }: { item: Item; openLoan: Loan | null }) {
  return (
    <Link
      href={`/items/${item.id}`}
      className="block rounded-lg border border-neutral-200 p-4 hover:border-neutral-400"
    >
      <Image
        src={item.imageUrl}
        alt={item.name}
        width={80}
        height={80}
        className="mb-3 rounded bg-neutral-100"
        unoptimized
      />
      <h2 className="font-medium">{item.name}</h2>
      <p className="text-sm text-neutral-600">{item.category}</p>
      <span
        className={`mt-2 inline-block rounded px-2 py-0.5 text-xs ${
          openLoan ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"
        }`}
      >
        {openLoan ? "On loan" : "Available"}
      </span>
    </Link>
  );
}
