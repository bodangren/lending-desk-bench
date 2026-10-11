import { NextResponse } from "next/server";
import { ItemOnLoanError, LoanAlreadyClosedError, closeLoan, findOpenLoan, insertLoan, listLoans, now } from "@/src/db";
import { computeLoanStatus } from "@/src/lib/loans";
import { getStaffSession } from "@/src/lib/auth";

export const dynamic = "force-dynamic";

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status });

/** The request body as a JSON object, or null for anything else. */
async function readObject(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Loans endpoint. See spec section G.
 * Supports `?itemId=` and `?overdue=true`.
 */
export async function GET(request: Request) {
  if (!(await getStaffSession())) return reply({ error: "Unauthorized" }, 401);
  const search = new URL(request.url).searchParams;
  const itemId = search.get("itemId");
  const overdueOnly = search.get("overdue") === "true";
  const at = now();
  const loans = (await listLoans()).filter(
    (loan) => (!itemId || loan.itemId === itemId) && (!overdueOnly || computeLoanStatus(loan, at) === "overdue"),
  );
  return reply({ loans });
}

/**
 * Create a loan from a JSON body of { itemId, memberId, dueAt }.
 * See spec section G.
 */
export async function POST(request: Request) {
  if (!(await getStaffSession())) return reply({ error: "Unauthorized" }, 401);
  const body = await readObject(request);
  const itemId = body?.itemId;
  const memberId = body?.memberId;
  const dueAt = body?.dueAt;
  if (typeof itemId !== "string" || typeof memberId !== "string" || typeof dueAt !== "string") {
    return reply({ error: "Send itemId, memberId, and dueAt as strings" }, 400);
  }
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return reply({ error: "dueAt is not a date" }, 400);
  try {
    const loan = await insertLoan({
      itemId,
      memberId,
      borrowedAt: now().toISOString(),
      dueAt: due.toISOString(),
      returnedAt: null,
    });
    return reply({ loan }, 201);
  } catch (error) {
    if (error instanceof ItemOnLoanError) return reply({ error: "Item is already on loan" }, 409);
    throw error;
  }
}

/**
 * Return an item from a JSON body of { itemId }.
 * See spec section G.
 */
export async function PATCH(request: Request) {
  if (!(await getStaffSession())) return reply({ error: "Unauthorized" }, 401);
  const body = await readObject(request);
  const itemId = body?.itemId;
  if (typeof itemId !== "string") return reply({ error: "Send itemId as a string" }, 400);
  const open = await findOpenLoan(itemId);
  if (!open) return reply({ error: "Item is not on loan" }, 409);
  try {
    const loan = await closeLoan(open.id, now().toISOString());
    return loan ? reply({ loan }) : reply({ error: "Item is not on loan" }, 409);
  } catch (error) {
    if (error instanceof LoanAlreadyClosedError) return reply({ error: "Item is not on loan" }, 409);
    throw error;
  }
}
