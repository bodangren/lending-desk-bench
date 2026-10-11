import { NextResponse } from "next/server";
import { closeLoan, findOpenLoan, insertLoan, listLoans, now } from "@/src/db";

/**
 * Grader-only state hook. It is not part of the task: do not call or change it.
 *
 * The hidden grader reads and prepares the in-memory store through this route,
 * so that its browser checks of the forms do not depend on `/api/loans`, which
 * is graded separately. The route answers 404 unless the server was started with
 * BENCH_STATE_KEY and the request sends that value in `x-bench-state-key`.
 */
export const dynamic = "force-dynamic";

function allowed(request: Request): boolean {
  const key = process.env.BENCH_STATE_KEY;
  return Boolean(key) && request.headers.get("x-bench-state-key") === key;
}

const notFound = () => new NextResponse(null, { status: 404 });

export async function GET(request: Request) {
  if (!allowed(request)) return notFound();
  return NextResponse.json({ loans: await listLoans() });
}

/** `{ op: "open", itemId, memberId, dueAt }` or `{ op: "close", itemId }`. */
type Operation = { op?: string; itemId?: string; memberId?: string; dueAt?: string };

export async function POST(request: Request) {
  if (!allowed(request)) return notFound();
  const body = (await request.json()) as Operation;
  if (body.op === "open" && body.itemId && body.memberId && body.dueAt) {
    const loan = await insertLoan({
      itemId: body.itemId,
      memberId: body.memberId,
      borrowedAt: now().toISOString(),
      dueAt: body.dueAt,
      returnedAt: null,
    });
    return NextResponse.json({ loan }, { status: 201 });
  }
  if (body.op === "close" && body.itemId) {
    const open = await findOpenLoan(body.itemId);
    if (!open) return NextResponse.json({ error: "no open loan" }, { status: 409 });
    return NextResponse.json({ loan: await closeLoan(open.id, now().toISOString()) });
  }
  return NextResponse.json({ error: "unknown operation" }, { status: 400 });
}
