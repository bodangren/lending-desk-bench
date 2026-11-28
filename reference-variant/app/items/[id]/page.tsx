import { cache, Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findOpenLoan, getItem, listLoansForItem, listMembers, now } from "@/src/db";
import { computeLoanStatus } from "@/src/lib/loans";
import { CheckoutForm, ReturnButton } from "./checkout-form";

const memoizedItem = cache(getItem);

type DetailParams = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: DetailParams }): Promise<Metadata> {
  const { id } = await params;
  const item = await memoizedItem(id);
  return { title: item ? `${item.name} — Lending Desk` : "Lending Desk — Not found" };
}

export default async function ItemDetailPage({ params }: { params: DetailParams }) {
  const { id } = await params;
  const [item, openLoan] = await Promise.all([memoizedItem(id), findOpenLoan(id)]);
  if (!item) notFound();

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-2 border-b border-slate-200 pb-4">
        <h1 className="text-3xl font-bold text-slate-900">
          <span>{item.name}</span>
        </h1>
        <p className="text-sm font-medium uppercase text-slate-500">{item.category}</p>
        <p className="text-slate-700">{item.description}</p>
      </header>

      <section aria-labelledby="history-heading" className="space-y-3">
        <h2 id="history-heading" className="text-xl font-semibold">Borrowing record</h2>
        <Suspense fallback={<p className="text-slate-500">Loading borrowing record…</p>}>
          <HistoryRecords itemId={item.id} />
        </Suspense>
      </section>

      <section aria-label="Loan action" className="rounded-xl bg-slate-50 p-4">
        {openLoan === null ? (
          <Suspense fallback={<p className="text-slate-500">Loading borrower list…</p>}>
            <BorrowerPicker itemId={item.id} />
          </Suspense>
        ) : (
          <ReturnButton itemId={item.id} />
        )}
      </section>
    </main>
  );
}

async function BorrowerPicker({ itemId }: { itemId: string }) {
  const members = await listMembers();
  return <CheckoutForm itemId={itemId} members={members} />;
}

async function HistoryRecords({ itemId }: { itemId: string }) {
  const [loans, members] = await Promise.all([listLoansForItem(itemId), listMembers()]);
  if (loans.length === 0) return <p className="text-slate-500">No borrowing record.</p>;

  const history = loans.slice().sort(
    (left, right) => Date.parse(right.borrowedAt) - Date.parse(left.borrowedAt),
  );
  const currentTime = now();

  return (
    <ol className="divide-y divide-slate-200">
      {history.map((loan) => {
        const borrower = members.find((member) => member.id === loan.memberId);
        return (
          <li key={loan.id} className="flex justify-between gap-4 py-2">
            <span>{borrower?.name ?? "Unknown member"}</span>
            <span className="text-slate-600">{computeLoanStatus(loan, currentTime)}</span>
          </li>
        );
      })}
    </ol>
  );
}
