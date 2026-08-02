"use client";

import { useActionState, useOptimistic, useTransition } from "react";
import { checkoutItem, returnItem } from "@/src/actions/loans";
import type { Member } from "@/src/db/schema";

type State = { error: string | null };

export function CheckoutForm({ itemId, members }: { itemId: string; members: Member[] }) {
  const [optimisticOnLoan, setOptimisticOnLoan] = useOptimistic(false);
  const [, startTransition] = useTransition();

  const [state, formAction, pending] = useActionState<State, FormData>(
    async (_prev, formData) => {
      const memberId = String(formData.get("memberId") ?? "");
      const dueAt = String(formData.get("dueAt") ?? "");
      startTransition(() => setOptimisticOnLoan(true));
      const result = await checkoutItem(itemId, memberId, new Date(dueAt).toISOString());
      return result.ok ? { error: null } : { error: result.error };
    },
    { error: null },
  );

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-neutral-200 p-4">
      {optimisticOnLoan && !state.error && (
        <span className="inline-block rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
          On loan
        </span>
      )}

      <div className="flex flex-wrap gap-3">
        <select name="memberId" aria-label="Member" defaultValue="" className="rounded border border-neutral-300 px-3 py-2 text-sm" required>
          <option value="" disabled>Select a member</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>

        <input type="date" name="dueAt" aria-label="Due date" required className="rounded border border-neutral-300 px-3 py-2 text-sm" />

        <button type="submit" disabled={pending} className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-60">
          {pending ? "Checking out…" : "Check out"}
        </button>
      </div>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

export function ReturnButton({ itemId }: { itemId: string }) {
  const [optimisticReturned, setOptimisticReturned] = useOptimistic(false);
  const [, startTransition] = useTransition();

  const [state, formAction, pending] = useActionState<State, FormData>(async () => {
    startTransition(() => setOptimisticReturned(true));
    const result = await returnItem(itemId);
    return result.ok ? { error: null } : { error: result.error };
  }, { error: null });

  return (
    <form action={formAction} className="space-y-3">
      {/* Shown before the server has answered; useOptimistic drops it again if
          the action comes back with an error. */}
      {optimisticReturned && !state.error && (
        <span className="inline-block rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900">
          Available
        </span>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-neutral-300 px-4 py-2 text-sm disabled:opacity-60"
      >
        {pending ? "Returning…" : "Return"}
      </button>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
