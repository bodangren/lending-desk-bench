import { Suspense } from "react";
import { countItems, listCategories, listItems, listLoans } from "@/src/db";
import type { Item, Loan } from "@/src/db/schema";
import { ItemCard } from "@/src/components/item-card";

type Filters = { q?: string; category?: string };

function matches(item: Item, { q, category }: Filters): boolean {
  if (category && item.category !== category) return false;
  if (!q) return true;
  return item.name.toLocaleLowerCase("en").includes(q.toLocaleLowerCase("en"));
}

async function Results({ filters }: { filters: Filters }) {
  const [items, loans] = await Promise.all([listItems(), listLoans()]);
  const openByItem = new Map<string, Loan>();
  for (const loan of loans) {
    if (loan.returnedAt === null) openByItem.set(loan.itemId, loan);
  }
  const shown = items.filter((item) => matches(item, filters));
  if (shown.length === 0) return <p className="text-sm">No items match your search.</p>;
  return (
    <ul className="grid gap-2 md:grid-cols-2">
      {shown.map((item) => (
        <li key={item.id}>
          <ItemCard item={item} openLoan={openByItem.get(item.id) ?? null} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Item catalogue. Supports `?q=` and `?category=` filtering.
 * See spec section C.
 */
export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const [filters, [total, categories]] = await Promise.all([
    searchParams,
    Promise.all([countItems(), listCategories()]),
  ]);
  return (
    <section className="space-y-5">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold">
          <span>Items</span>
        </h1>
        <small className="text-neutral-500">
          {total} tools in {categories.length} categories
        </small>
      </header>
      <Suspense fallback={<Placeholder />}>
        <Results filters={filters} />
      </Suspense>
    </section>
  );
}

function Placeholder() {
  return (
    <ul className="grid gap-2 md:grid-cols-2" aria-busy="true">
      {["a", "b", "c", "d", "e", "f"].map((slot) => (
        <li key={slot} className="h-24 rounded-md bg-neutral-100" />
      ))}
    </ul>
  );
}
