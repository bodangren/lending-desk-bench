"use client";

import { useOptimistic, useState, useTransition, type FormEvent } from "react";
import { checkoutItem, returnItem } from "@/src/actions/loans";
import type { Member } from "@/src/db/schema";

/**
 * A datetime-local value names a wall-clock time with no zone. Read it as UTC, so
 * the stored day is the day the desk picked, whatever the browser's zone.
 */
function toInstant(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return `${value}:00.000Z`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

/**
 * Checkout control shown on the item detail page. See spec section E.
 */
export function CheckoutForm({
  itemId,
  members,
}: {
  itemId: string;
  members: Member[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [onLoan, markOnLoan] = useOptimistic(false, () => true);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const memberId = String(data.get("member") ?? "");
    const due = toInstant(String(data.get("due") ?? ""));
    startTransition(async () => {
      markOnLoan(null);
      setError(null);
      const result = await checkoutItem(itemId, memberId, due);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded border border-neutral-300 p-3">
      {onLoan && <p className="text-xs font-medium text-amber-800">On loan</p>}
      <label className="text-sm">
        Borrower
        <select name="member" className="ml-2 rounded border border-neutral-300 px-2 py-1">
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Due
        <input name="due" type="datetime-local" required className="ml-2 rounded border border-neutral-300 px-2 py-1" />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded bg-neutral-800 px-3 py-1 text-sm text-white disabled:opacity-50"
      >
        {pending ? "Checking out…" : "Check out"}
      </button>
      <div aria-live="polite" className="text-sm text-red-700">
        {error}
      </div>
    </form>
  );
}

/**
 * Return control shown when an item has an open loan. See spec section E.
 */
export function ReturnButton({ itemId }: { itemId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [returned, markReturned] = useOptimistic(false, () => true);

  function activate() {
    startTransition(async () => {
      markReturned(null);
      setError(null);
      const result = await returnItem(itemId);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {returned && <p className="text-xs font-medium text-emerald-800">Available</p>}
      <button
        type="button"
        disabled={pending}
        onClick={activate}
        className="self-start rounded border border-neutral-400 px-3 py-1 text-sm disabled:opacity-50"
      >
        {pending ? "Returning…" : "Return"}
      </button>
      <p role="alert" className="text-sm text-red-700">
        {error}
      </p>
    </div>
  );
}
