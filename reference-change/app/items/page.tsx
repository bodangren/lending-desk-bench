import { Suspense } from "react";
import { countItems, listCategories, listItems, listLoans } from "@/src/db";
import { ItemCard } from "@/src/components/item-card";

async function ItemGrid({ q, category, status }: { q?: string; category?: string; status?: string }) {
  const [items, loans] = await Promise.all([listItems(), listLoans()]);
  const needle = q?.toLowerCase();
  const onLoan = new Set(loans.filter((l) => l.returnedAt === null).map((l) => l.itemId));
  // CR-1: any status other than these two leaves the list unfiltered.
  const filtered = items.filter(
    (i) =>
      (!needle || i.name.toLowerCase().includes(needle)) &&
      (!category || i.category === category) &&
      (status !== "available" || !onLoan.has(i.id)) &&
      (status !== "on-loan" || onLoan.has(i.id)),
  );

  if (filtered.length === 0) {
    return <p className="text-neutral-600">No items match your search.</p>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {filtered.map((item) => (
        <ItemCard
          key={item.id}
          item={item}
          openLoan={loans.find((l) => l.itemId === item.id && l.returnedAt === null) ?? null}
        />
      ))}
    </div>
  );
}

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; status?: string }>;
}) {
  // None of these depend on each other, so they resolve together rather than in
  // sequence — including searchParams, which is itself a promise.
  const [{ q, category, status }, total, categories] = await Promise.all([
    searchParams,
    countItems(),
    listCategories(),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Items</h1>
      <p className="text-sm text-neutral-600">
        {total} in the catalogue · {categories.join(", ")}
      </p>
      <Suspense fallback={<ItemGridSkeleton />}>
        <ItemGrid q={q} category={category} status={status} />
      </Suspense>
    </div>
  );
}

function ItemGridSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="h-40 animate-pulse rounded-lg bg-neutral-100" />
      ))}
    </div>
  );
}
