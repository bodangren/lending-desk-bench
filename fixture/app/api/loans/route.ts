import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Loans endpoint. See spec section G.
 * Supports `?itemId=` and `?overdue=true`.
 */
export async function GET(request: Request) {
  // TODO: implement (spec G)
  return NextResponse.json({ loans: [] });
}

/**
 * Create a loan from a JSON body of { itemId, memberId, dueAt }.
 * See spec section G.
 */
export async function POST(request: Request) {
  // TODO: implement (spec G)
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}

/**
 * Return an item from a JSON body of { itemId }.
 * See spec section G.
 */
export async function PATCH(request: Request) {
  void request;
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}

