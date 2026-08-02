export default function ItemsLoading() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Items</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-40 animate-pulse rounded-lg bg-neutral-100" />
        ))}
      </div>
    </div>
  );
}
