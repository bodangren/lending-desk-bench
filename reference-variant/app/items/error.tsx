"use client";

export default function ItemsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  void error;

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-3xl font-bold text-slate-900">
        <span>Items</span>
      </h1>
      <button
        type="button"
        onClick={reset}
        className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white"
      >
        Try again
      </button>
      <p className="text-slate-600">Could not load items.</p>
    </main>
  );
}
