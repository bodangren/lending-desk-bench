import { NextResponse } from "next/server";
import {
  ItemOnLoanError,
  LoanAlreadyClosedError,
  closeLoan,
  findOpenLoan,
  getItem,
  getMember,
  insertLoan,
  listLoans,
  now,
} from "@/src/db";
import { computeLoanStatus } from "@/src/lib/loans";
import { getStaffSession } from "@/src/lib/auth";

export const dynamic = "force-dynamic";

const unauthorized = () =>
  NextResponse.json({ error: "Unauthorized" }, { status: 401 });

export async function GET(request: Request) {
  if (!(await getStaffSession())) return unauthorized();

  const url = new URL(request.url);
  const itemId = url.searchParams.get("itemId");
  const overdue = url.searchParams.get("overdue") === "true";
  const at = now();

  let loans = await listLoans();
  if (itemId) loans = loans.filter((l) => l.itemId === itemId);
  if (overdue) loans = loans.filter((l) => computeLoanStatus(l, at) === "overdue");

  return NextResponse.json({ loans });
}

export async function POST(request: Request) {
  if (!(await getStaffSession())) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const { itemId, memberId, dueAt } = (body ?? {}) as Record<string, unknown>;
  if (typeof itemId !== "string" || typeof memberId !== "string" || typeof dueAt !== "string") {
    return NextResponse.json(
      { error: "itemId, memberId and dueAt are required strings" },
      { status: 400 },
    );
  }

  const due = Date.parse(dueAt);
  if (Number.isNaN(due)) {
    return NextResponse.json({ error: "dueAt must be an ISO 8601 date" }, { status: 400 });
  }

  const [item, member] = await Promise.all([getItem(itemId), getMember(memberId)]);
  if (!item || !member) {
    return NextResponse.json({ error: "Unknown item or member" }, { status: 400 });
  }

  if (await findOpenLoan(itemId)) {
    return NextResponse.json({ error: "Item is already on loan" }, { status: 409 });
  }

  try {
    const loan = await insertLoan({
      itemId,
      memberId,
      borrowedAt: now().toISOString(),
      dueAt: new Date(due).toISOString(),
      returnedAt: null,
    });
    return NextResponse.json({ loan }, { status: 201 });
  } catch (error) {
    // The findOpenLoan above is a read. Concurrent requests all pass it and then
    // race for the write; every loser has to come back as a conflict, not a 500.
    if (error instanceof ItemOnLoanError) {
      return NextResponse.json({ error: "Item is already on loan" }, { status: 409 });
    }
    throw error;
  }
}

export async function PATCH(request: Request) {
  if (!(await getStaffSession())) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const { itemId } = (body ?? {}) as Record<string, unknown>;
  if (typeof itemId !== "string") {
    return NextResponse.json({ error: "itemId is required and must be a string" }, { status: 400 });
  }

  const open = await findOpenLoan(itemId);
  if (!open) {
    return NextResponse.json({ error: "Item is not on loan" }, { status: 409 });
  }

  try {
    const loan = await closeLoan(open.id, now().toISOString());
    if (!loan) {
      return NextResponse.json({ error: "Item is not on loan" }, { status: 409 });
    }
    return NextResponse.json({ loan });
  } catch (error) {
    // Same shape as POST: the read above cannot bind the loan, so a concurrent
    // return may close it first. That is a conflict, not a server fault.
    if (error instanceof LoanAlreadyClosedError) {
      return NextResponse.json({ error: "Item is not on loan" }, { status: 409 });
    }
    throw error;
  }
}
