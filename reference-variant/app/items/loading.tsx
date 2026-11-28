export default function ItemsLoading() {
  return (
    <main className="mx-auto max-w-6xl space-y-5 p-6">
      <h1 className="text-3xl font-bold text-slate-900">
        <span>Items</span>
      </h1>
      <div role="status" aria-label="Loading items" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <article key={`placeholder-${index}`} className="h-36 animate-pulse rounded-xl bg-slate-200">
            <span className="sr-only">Loading item</span>
          </article>
        ))}
      </div>
    </main>
  );
}
