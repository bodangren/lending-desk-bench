import Image from "next/image";
import Link from "next/link";
import type { Item, Loan } from "@/src/db/schema";

export function ItemCard({ item, openLoan }: { item: Item; openLoan: Loan | null }) {
  return (
    <Link
      href={`/items/${item.id}`}
      className="flex flex-col gap-2 rounded-xl border border-slate-300 bg-white p-3"
    >
      <span className="w-fit rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-900">
        {openLoan === null ? "Available" : "On loan"}
      </span>
      <p className="text-xs uppercase tracking-wide text-slate-500">{item.category}</p>
      <Image
        alt={item.name}
        src={item.imageUrl}
        width={96}
        height={64}
        unoptimized
        className="h-16 w-24 rounded-md object-cover"
      />
      <h3 className="text-base font-bold text-slate-900">{item.name}</h3>
    </Link>
  );
}
