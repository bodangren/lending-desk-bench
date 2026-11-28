import { NextResponse } from "next/server";
import {
  ItemOnLoanError,
  LoanAlreadyClosedError,
  closeLoan,
  findOpenLoan,
  insertLoan,
  listLoans,
  now,
} from "@/src/db";
import { computeLoanStatus } from "@/src/lib/loans";
import { getStaffSession } from "@/src/lib/auth";

export const dynamic = "force-dynamic";

function anonymousResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  if (!(await getStaffSession())) return anonymousResponse();

  const url = new URL(request.url);
  const itemId = url.searchParams.get("itemId");
  const overdueOnly = url.searchParams.get("overdue") === "true";
  const currentTime = now();
  let loans = await listLoans();

  if (itemId !== null) loans = loans.filter((loan) => loan.itemId === itemId);
  if (overdueOnly) {
    loans = loans.filter((loan) => computeLoanStatus(loan, currentTime) === "overdue");
  }
  return NextResponse.json({ loans });
}

export async function POST(request: Request) {
  if (!(await getStaffSession())) return anonymousResponse();

  const body = await readJson(request);
  const fields = body !== null && typeof body === "object" ? body as Record<string, unknown> : {};
  const { itemId, memberId, dueAt } = fields;
  if (typeof itemId !== "string" || typeof memberId !== "string" || typeof dueAt !== "string") {
    return NextResponse.json(
      { error: "itemId, memberId and dueAt must be strings" },
      { status: 400 },
    );
  }

  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) {
    return NextResponse.json({ error: "dueAt must be an ISO 8601 value" }, { status: 400 });
  }

  try {
    const loan = await insertLoan({
      itemId,
      memberId,
      borrowedAt: now().toISOString(),
      dueAt,
      returnedAt: null,
    });
    return NextResponse.json({ loan }, { status: 201 });
  } catch (error) {
    if (error instanceof ItemOnLoanError) {
      return NextResponse.json({ error: "Item is already on loan" }, { status: 409 });
    }
    throw error;
  }
}

export async function PATCH(request: Request) {
  if (!(await getStaffSession())) return anonymousResponse();

  const body = await readJson(request);
  const fields = body !== null && typeof body === "object" ? body as Record<string, unknown> : {};
  const itemId = fields.itemId;
  if (typeof itemId !== "string") {
    return NextResponse.json({ error: "itemId must be a string" }, { status: 400 });
  }

  const openLoan = await findOpenLoan(itemId);
  if (!openLoan) {
    return NextResponse.json({ error: "Item is not on loan" }, { status: 409 });
  }

  try {
    const loan = await closeLoan(openLoan.id, now().toISOString());
    if (!loan) {
      return NextResponse.json({ error: "Item is not on loan" }, { status: 409 });
    }
    return NextResponse.json({ loan });
  } catch (error) {
    if (error instanceof LoanAlreadyClosedError) {
      return NextResponse.json({ error: "Item is not on loan" }, { status: 409 });
    }
    throw error;
  }
}
