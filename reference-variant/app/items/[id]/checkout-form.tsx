"use client";

import { useState, useTransition, type FormEvent } from "react";
import { checkoutItem, returnItem } from "@/src/actions/loans";
import type { Member } from "@/src/db/schema";

function inputAsInstant(value: string): string {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  return new Date(hasZone ? value : `${value}Z`).toISOString();
}

export function CheckoutForm({ itemId, members }: { itemId: string; members: Member[] }) {
  const [error, setError] = useState<string | null>(null);
  const [onLoan, setOnLoan] = useState(false);
  const [pending, startTransition] = useTransition();
  const orderedMembers = members.slice().sort((left, right) => left.name.localeCompare(right.name));
  const memberControlId = `borrower-${itemId}`;
  const dueControlId = `deadline-${itemId}`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const memberId = String(formData.get("memberId") ?? "");
    const dueAt = String(formData.get("dueAt") ?? "");
    setError(null);
    setOnLoan(true);
    startTransition(async () => {
      const result = await checkoutItem(itemId, memberId, inputAsInstant(dueAt));
      if (!result.ok) {
        setError(result.error);
        setOnLoan(false);
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {onLoan && (
        <span className="inline-block rounded bg-amber-200 px-3 py-1 text-sm font-semibold text-amber-950">
          On loan
        </span>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={dueControlId} className="block text-sm font-medium">Return deadline</label>
          <input
            id={dueControlId}
            type="datetime-local"
            name="dueAt"
            required
            className="w-full rounded-lg border border-slate-400 p-2"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={memberControlId} className="block text-sm font-medium">Borrower</label>
          <select
            id={memberControlId}
            name="memberId"
            required
            className="w-full rounded-lg border border-slate-400 p-2"
          >
            {orderedMembers.map((member) => (
              <option key={member.id} value={member.id}>{member.name}</option>
            ))}
          </select>
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
      >
        {pending ? "Checking out…" : "Check out item"}
      </button>

      {error !== null && (
        <p aria-live="assertive" className="font-medium text-red-700">{error}</p>
      )}
    </form>
  );
}

export function ReturnButton({ itemId }: { itemId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [returned, setReturned] = useState(false);
  const [pending, startTransition] = useTransition();

  function activate() {
    setError(null);
    setReturned(true);
    startTransition(async () => {
      const result = await returnItem(itemId);
      if (!result.ok) {
        setError(result.error);
        setReturned(false);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {returned && (
        <span className="rounded bg-emerald-200 px-3 py-1 font-semibold text-emerald-950">Available</span>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={activate}
        className="rounded-lg border border-slate-500 px-4 py-2 font-semibold disabled:opacity-50"
      >
        {pending ? "Returning…" : "Return"}
      </button>
      {error !== null && (
        <p aria-live="assertive" className="font-medium text-red-700">{error}</p>
      )}
    </div>
  );
}
