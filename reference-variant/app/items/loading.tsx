const SLOTS = ["one", "two", "three", "four", "five", "six"];

/**
 * Shown while the item catalogue loads. See spec section H.
 */
export default function ItemsLoading() {
  return (
    <section className="space-y-5">
      <h1 className="text-xl font-bold">
        <span>Items</span>
      </h1>
      <ul className="grid gap-2 md:grid-cols-2" aria-busy="true">
        {SLOTS.map((slot) => (
          <li key={slot} className="h-24 animate-pulse rounded-md bg-neutral-100" />
        ))}
      </ul>
    </section>
  );
}
