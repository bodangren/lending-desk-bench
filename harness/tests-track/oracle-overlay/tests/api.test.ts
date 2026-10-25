import http from "node:http";
import { describe, expect, it } from "vitest";
import { STAFF_KEY } from "@/src/lib/auth";
import { NOW, seedLoans } from "@/src/db/seed";

const endpoint = new URL("/api/loans", process.env.BASE_URL ?? "http://127.0.0.1:3100");
const staffHeaders: Record<string, string> = { "x-staff-key": STAFF_KEY, "content-type": "application/json" };
const dueAt = new Date(Date.parse(NOW) + 10 * 86_400_000).toISOString();

type LoanRow = { id: string; itemId: string; memberId: string; borrowedAt: string; dueAt: string; returnedAt: string | null };
type Reply = { status: number; body: { error?: string; loans?: LoanRow[]; loan?: LoanRow } };

async function send(method: string, payload?: unknown, headers = staffHeaders, query = ""): Promise<Reply> {
  const response = await fetch(endpoint.href + query, {
    method,
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: {} };
  }
}

const loanIds = async (query: string) =>
  ((await send("GET", undefined, staffHeaders, query)).body.loans ?? []).map((loan) => loan.id).sort();

/** One socket per request, so parallel calls really overlap in the server. */
function rawStatus(method: string, payload: unknown): Promise<number> {
  const data = JSON.stringify(payload);
  return new Promise((done, fail) => {
    const request = http.request(endpoint, {
      method,
      agent: false,
      headers: { ...staffHeaders, "content-length": Buffer.byteLength(data) },
    }, (response) => {
      response.resume();
      response.on("end", () => done(response.statusCode ?? 0));
    });
    request.on("error", fail);
    request.end(data);
  });
}

// Every test leaves each item as available or as on loan as the seed has it.
describe("loans API", () => {
  it("lists every loan", async () => {
    const reply = await send("GET");
    expect(reply.status).toBe(200);
    expect(reply.body.loans?.length).toBe(seedLoans.length);
  });

  it("filters by item and by overdue, alone and together", async () => {
    expect(await loanIds("?itemId=itm-001")).toEqual(["lon-004", "lon-005"]);
    expect(await loanIds("?overdue=true")).toEqual(["lon-001"]);
    expect(await loanIds("?itemId=itm-003&overdue=true")).toEqual(["lon-001"]);
    expect(await loanIds("?itemId=itm-001&overdue=true")).toEqual([]);
  });

  it("answers 401 to every method without the staff key", async () => {
    const outsiders: Record<string, string>[] = [{ "content-type": "application/json" }, { ...staffHeaders, "x-staff-key": "wrong" }];
    for (const headers of outsiders) {
      const reads = await send("GET", undefined, headers);
      const writes = await send("POST", { itemId: "itm-024", memberId: "mbr-001", dueAt }, headers);
      const returns = await send("PATCH", { itemId: "itm-010" }, headers);
      for (const reply of [reads, writes, returns]) {
        expect(reply.status).toBe(401);
        expect(reply.body.error).toBe("Unauthorized");
      }
    }
    expect(await loanIds("?itemId=itm-024")).toEqual([]);
    expect((await send("GET", undefined, staffHeaders, "?itemId=itm-010")).body.loans?.[0]?.returnedAt).toBeNull();
  });

  it("creates a loan borrowed now, then closes it", async () => {
    const created = await send("POST", { itemId: "itm-002", memberId: "mbr-001", dueAt });
    expect(created.status).toBe(201);
    expect(created.body.loan).toMatchObject({ itemId: "itm-002", memberId: "mbr-001", borrowedAt: NOW, returnedAt: null });
    expect(Date.parse(created.body.loan?.dueAt ?? "")).toBe(Date.parse(dueAt));
    const closed = await send("PATCH", { itemId: "itm-002" });
    expect(closed.status).toBe(200);
    expect(closed.body.loan?.returnedAt).toBe(NOW);
  });

  it("rejects missing or non-string fields with 400", async () => {
    for (const payload of [{ memberId: "mbr-001", dueAt }, { itemId: "itm-004", dueAt }, { itemId: "itm-004", memberId: "mbr-001" }, { itemId: 7, memberId: "mbr-001", dueAt }]) {
      const reply = await send("POST", payload);
      expect(reply.status, JSON.stringify(payload)).toBe(400);
      expect(typeof reply.body.error).toBe("string");
    }
    for (const payload of [{}, { itemId: 7 }]) {
      expect((await send("PATCH", payload)).status, JSON.stringify(payload)).toBe(400);
    }
  });

  it("answers 409 when the item is already on loan", async () => {
    expect((await send("POST", { itemId: "itm-003", memberId: "mbr-004", dueAt })).status).toBe(409);
  });

  it("lets exactly one of five racing checkouts win", async () => {
    const statuses = await Promise.all([1, 2, 3, 4, 5].map(() => rawStatus("POST", { itemId: "itm-006", memberId: "mbr-002", dueAt })));
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(4);
    expect((await send("PATCH", { itemId: "itm-006" })).status).toBe(200);
  });

  it("answers 409 to a return when nothing is open", async () => {
    expect((await send("PATCH", { itemId: "itm-029" })).status).toBe(409);
    expect((await send("POST", { itemId: "itm-011", memberId: "mbr-003", dueAt })).status).toBe(201);
    expect((await send("PATCH", { itemId: "itm-011" })).status).toBe(200);
    const again = await send("PATCH", { itemId: "itm-011" });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("Item is not on loan");
  });

  it("lets exactly one of five racing returns win", async () => {
    expect((await send("POST", { itemId: "itm-012", memberId: "mbr-005", dueAt })).status).toBe(201);
    const statuses = await Promise.all([1, 2, 3, 4, 5].map(() => rawStatus("PATCH", { itemId: "itm-012" })));
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(4);
  });
});
