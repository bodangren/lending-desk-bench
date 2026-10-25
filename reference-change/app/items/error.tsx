"use client";

export default function ItemsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Items</h1>
      <p className="text-neutral-600">Could not load items.</p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white"
      >
        Try again
      </button>
    </div>
  );
}
