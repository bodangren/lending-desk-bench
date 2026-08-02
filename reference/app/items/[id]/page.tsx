import { Suspense, cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findOpenLoan, getItem, listLoansForItem, listMembers, now } from "@/src/db";
import { computeLoanStatus } from "@/src/lib/loans";
import { CheckoutForm, ReturnButton } from "./checkout-form";

/**
 * The title and the body both need the item. `cache` makes that one read per
 * request instead of two — the store has no idea the two callers belong to the
 * same render, so the deduplication has to happen here.
 */
const loadItem = cache(getItem);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const item = await loadItem(id);
  if (!item) return { title: "Not found — Lending Desk" };
  return { title: `${item.name} — Lending Desk` };
}

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [item, openLoan] = await Promise.all([loadItem(id), findOpenLoan(id)]);
  if (!item) notFound();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{item.name}</h1>
      <p className="text-sm text-neutral-600">{item.category}</p>
      <p>{item.description}</p>

      <p className="text-sm">
        <span
          className={`inline-block rounded px-2 py-0.5 text-xs ${
            openLoan ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"
          }`}
        >
          {openLoan ? "On loan" : "Available"}
        </span>
      </p>

      {/* Everything above needs only the item, so it ships as soon as that read
          lands. The sections below wait on their own reads behind their own
          boundaries rather than holding the whole document back. */}
      {openLoan ? (
        // Needs no reads of its own, so it renders in the shell rather than
        // behind a boundary.
        <ReturnButton itemId={item.id} />
      ) : (
        <Suspense fallback={<div className="h-32 animate-pulse rounded-lg bg-neutral-100" />}>
          <CheckoutSection itemId={item.id} />
        </Suspense>
      )}

      <section className="space-y-2">
        <h2 className="font-medium">Loan history</h2>
        <Suspense fallback={<p className="text-sm text-neutral-600">Loading history…</p>}>
          <LoanHistory itemId={item.id} />
        </Suspense>
      </section>
    </div>
  );
}

async function CheckoutSection({ itemId }: { itemId: string }) {
  const members = await listMembers();
  return <CheckoutForm itemId={itemId} members={members} />;
}

async function LoanHistory({ itemId }: { itemId: string }) {
  const [loans, members] = await Promise.all([listLoansForItem(itemId), listMembers()]);
  if (loans.length === 0) {
    return <p className="text-sm text-neutral-600">No loans yet.</p>;
  }

  const at = now();
  // Stable: loans sharing a borrowedAt keep store order instead of being
  // reshuffled, and each row is keyed by the loan id, which is unique.
  const history = loans.toSorted(
    (a, b) => Date.parse(b.borrowedAt) - Date.parse(a.borrowedAt),
  );
  const nameById = new Map(members.map((m) => [m.id, m.name]));

  return (
    <ul className="divide-y divide-neutral-200 text-sm">
      {history.map((loan) => (
        <li key={loan.id} className="flex justify-between py-2">
          <span>{nameById.get(loan.memberId) ?? loan.memberId}</span>
          <span className="text-neutral-600">{computeLoanStatus(loan, at)}</span>
        </li>
      ))}
    </ul>
  );
}
