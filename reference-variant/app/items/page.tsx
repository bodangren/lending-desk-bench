import { listCategories, listItems, listLoans } from "@/src/db";
import { ItemCard } from "@/src/components/item-card";

type CatalogueProps = {
  searchParams: Promise<{ q?: string; category?: string }>;
};

function CatalogueGrid({
  items,
  loans,
  query,
  category,
  categories,
}: {
  items: Awaited<ReturnType<typeof listItems>>;
  loans: Awaited<ReturnType<typeof listLoans>>;
  query?: string;
  category?: string;
  categories: string[];
}) {
  const needle = query?.toLocaleLowerCase("en-US");
  const knownCategories = new Set(categories);
  const visible = items.filter((item) => {
    const nameMatches = needle === undefined
      || item.name.toLocaleLowerCase("en-US").includes(needle);
    const categoryMatches = category === undefined
      || (knownCategories.has(item.category) && item.category === category);
    return nameMatches && categoryMatches;
  });

  if (visible.length === 0) {
    return <p className="text-slate-600">No items match your search.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {visible.map((item) => (
        <ItemCard
          key={item.id}
          item={item}
          openLoan={loans.find((loan) => loan.itemId === item.id && loan.returnedAt === null) ?? null}
        />
      ))}
    </div>
  );
}

export default async function ItemsPage({ searchParams }: CatalogueProps) {
  const [params, items, categories, loans] = await Promise.all([
    searchParams,
    listItems(),
    listCategories(),
    listLoans(),
  ]);
  const total = items.length;

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-6">
      <h1 className="text-3xl font-bold text-slate-900">
        <span>Items</span>
      </h1>
      <section aria-label="Item catalogue" data-total={total}>
        <CatalogueGrid
          items={items}
          loans={loans}
          query={params.q}
          category={params.category}
          categories={categories}
        />
      </section>
    </main>
  );
}
