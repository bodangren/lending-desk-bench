"use client";

/**
 * Shown when the item catalogue fails to load. See spec section H.
 */
export default function ItemsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="space-y-3">
      <h1 className="text-xl font-bold">
        <span>Items</span>
      </h1>
      <p role="alert">Could not load items.</p>
      <button type="button" className="rounded border border-neutral-400 px-3 py-1 text-sm" onClick={() => reset()}>
        Try again
      </button>
      {error.digest ? <small className="block text-neutral-500">Reference {error.digest}</small> : null}
    </section>
  );
}
