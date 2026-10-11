import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, cache } from "react";
import { findOpenLoan, getItem, listLoansForItem, listMembers, now } from "@/src/db";
import { computeLoanStatus } from "@/src/lib/loans";
import { CheckoutForm, ReturnButton } from "./checkout-form";

/** One item read per request, shared by the title and the page. */
const itemById = cache((id: string) => getItem(id));

/**
 * Item detail with loan history. See spec section D.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const item = await itemById((await params).id);
  return { title: item ? `${item.name} — Lending Desk` : "Unknown item — Lending Desk" };
}

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [item, openLoan] = await Promise.all([itemById(id), findOpenLoan(id)]);
  if (!item) notFound();

  return (
    <article className="space-y-4">
      <h1 className="text-xl font-bold">{item.name}</h1>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm">
        <dt className="text-neutral-500">Category</dt>
        <dd>{item.category}</dd>
        <dt className="text-neutral-500">About</dt>
        <dd>{item.description}</dd>
      </dl>
      <p className="text-sm">Status: {openLoan ? "On loan" : "Available"}</p>

      {openLoan ? (
        <ReturnButton itemId={item.id} />
      ) : (
        <Suspense fallback={<p className="text-sm text-neutral-500">Loading members…</p>}>
          <Checkout itemId={item.id} />
        </Suspense>
      )}

      <h2 className="font-semibold">History</h2>
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading history…</p>}>
        <History itemId={item.id} />
      </Suspense>
    </article>
  );
}

async function Checkout({ itemId }: { itemId: string }) {
  const members = await listMembers();
  return <CheckoutForm itemId={itemId} members={members} />;
}

async function History({ itemId }: { itemId: string }) {
  const [loans, members] = await Promise.all([listLoansForItem(itemId), listMembers()]);
  if (loans.length === 0) return <p className="text-sm text-neutral-500">This item has never been lent.</p>;
  const names = new Map(members.map((member) => [member.id, member.name]));
  const at = now();
  // ISO instants in one format order as strings; sort is stable for equal times.
  const newestFirst = [...loans].sort((a, b) => (a.borrowedAt < b.borrowedAt ? 1 : a.borrowedAt > b.borrowedAt ? -1 : 0));
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr>
          <th scope="col">Member</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {newestFirst.map((loan) => (
          <tr key={loan.id} className="border-t border-neutral-200">
            <td className="py-1">{names.get(loan.memberId) ?? loan.memberId}</td>
            <td className="py-1">{computeLoanStatus(loan, at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
