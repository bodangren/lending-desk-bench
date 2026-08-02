/**
 * Spec G + the F/probe cases reachable over HTTP.
 * Assumes a candidate server on BASE_URL with the seed loaded.
 * Mutating tests each use a distinct item so they cannot collide.
 */
import { describe, expect, it } from "vitest";
import http from "node:http";
import { STAFF_KEY } from "@candidate/src/lib/auth";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const staff = { "x-staff-key": STAFF_KEY, "content-type": "application/json" };
const anon = { "content-type": "application/json" };
const future = new Date(Date.parse("2026-03-15T12:00:00.000Z") + 240 * 3600_000).toISOString();

const get = (qs = "", h: HeadersInit = staff) =>
  fetch(`${BASE}/api/loans${qs}`, { headers: h, cache: "no-store" });
const post = (body: unknown, h: HeadersInit = staff) =>
  fetch(`${BASE}/api/loans`, { method: "POST", headers: h, body: JSON.stringify(body) });
const patch = (body: unknown, h: HeadersInit = staff) =>
  fetch(`${BASE}/api/loans`, { method: "PATCH", headers: h, body: JSON.stringify(body) });

describe("GET /api/loans", () => {
  it("G.get200", async () => {
    const r = await get();
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(Array.isArray(j.loans)).toBe(true);
    expect(j.loans.length).toBeGreaterThanOrEqual(19);
    expect(j.loans[0]).toHaveProperty("dueAt");
  });

  it("G.401", async () => {
    const r = await get("", anon);
    expect(r.status).toBe(401);
    expect((await r.json()).error).toBe("Unauthorized");
    const invalid = { "x-staff-key": "wrong", "content-type": "application/json" };
    const bad = await get("", invalid);
    expect(bad.status).toBe(401);
    // The policy applies to every mutating method, not merely GET. Both a
    // missing and a wrong key must be rejected before either write can land.
    const beforeCheckout = await (await get("?itemId=itm-024")).json();
    const beforeReturn = await (await get("?itemId=itm-027")).json();
    for (const headers of [anon, invalid]) {
      const checkout = await post(
        { itemId: "itm-024", memberId: "mbr-001", dueAt: future },
        headers,
      );
      expect(checkout.status).toBe(401);
      expect((await checkout.json()).error).toBe("Unauthorized");
      const returning = await patch({ itemId: "itm-027" }, headers);
      expect(returning.status).toBe(401);
      expect((await returning.json()).error).toBe("Unauthorized");
    }
    expect(await (await get("?itemId=itm-024")).json()).toEqual(beforeCheckout);
    expect(await (await get("?itemId=itm-027")).json()).toEqual(beforeReturn);
  });

  it("G.filter-item", async () => {
    const j = await (await get("?itemId=itm-001")).json();
    expect(j.loans.length).toBe(2);
    expect(j.loans.every((l: any) => l.itemId === "itm-001")).toBe(true);
  });

  it("G.filter-overdue", async () => {
    const j = await (await get("?overdue=true")).json();
    // seed has exactly one open overdue loan: lon-001 on itm-003
    expect(j.loans.map((l: any) => l.id)).toEqual(["lon-001"]);
  });

  it("G.filter-both", async () => {
    // Both filters must intersect, not override one another.
    const hit = await (await get("?itemId=itm-003&overdue=true")).json();
    expect(hit.loans.map((l: any) => l.id)).toEqual(["lon-001"]);
    // itm-001's loans are all returned, so the intersection is empty even though
    // each filter on its own is non-empty.
    const miss = await (await get("?itemId=itm-001&overdue=true")).json();
    expect(miss.loans).toEqual([]);
  });

  it("G.fresh", async () => {
    const before = (await (await get("?itemId=itm-011")).json()).loans.length;
    const r = await post({ itemId: "itm-011", memberId: "mbr-001", dueAt: future });
    expect(r.status).toBe(201);
    const after = (await (await get("?itemId=itm-011")).json()).loans.length;
    expect(after).toBe(before + 1);
  });
});

describe("POST /api/loans", () => {
  it("G.post201", async () => {
    const r = await post({ itemId: "itm-002", memberId: "mbr-001", dueAt: future });
    expect(r.status).toBe(201);
    const j = await r.json();
    expect(j.loan).toMatchObject({ itemId: "itm-002", memberId: "mbr-001", returnedAt: null });
    expect(typeof j.loan.id).toBe("string");
  });

  it("G.400", async () => {
    for (const body of [
      { memberId: "mbr-001", dueAt: future },
      { itemId: "itm-004", dueAt: future },
      { itemId: "itm-004", memberId: "mbr-001" },
      { itemId: 42, memberId: "mbr-001", dueAt: future },
    ]) {
      const r = await post(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(typeof (await r.json()).error).toBe("string");
    }
  });

  it("G.409", async () => {
    // itm-003 already has an open loan in the seed
    const r = await post({ itemId: "itm-003", memberId: "mbr-004", dueAt: future });
    expect(r.status).toBe(409);
  });

  it("P.concurrent-checkout", async () => {
    // `fetch` pools every request onto one socket, which serialises them and turns
    // this into four repeats of G.409. Dial the sockets ourselves so the five
    // requests are genuinely in flight together, and land inside each other's
    // read-then-write window (insertLoan awaits before it commits).
    //
    // A read-first guard cannot hold here: all five read "no open loan" before any
    // of them writes. Only the request that wins the write may return 201, and the
    // rest must surface the store's rejection as 409 — not an unhandled 500.
    const statuses = await Promise.all(
      Array.from({ length: 5 }, () => rawPost("itm-012", "mbr-002")),
    );
    expect(statuses.filter((s) => s === 201).length, statuses.join(",")).toBe(1);
    expect(statuses.filter((s) => s === 409).length, statuses.join(",")).toBe(4);
  });
});

describe("PATCH /api/loans", () => {
  it("G.patch200", async () => {
    const r = await patch({ itemId: "itm-027" });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.loan).toMatchObject({ itemId: "itm-027" });
    // Closed, not deleted.
    expect(typeof j.loan.returnedAt).toBe("string");
    const after = (await (await get("?itemId=itm-027")).json()).loans;
    expect(after.length).toBe(1);
    expect(after[0].returnedAt).not.toBeNull();
  });

  it("G.patch409", async () => {
    // itm-029 has never been lent.
    const r = await patch({ itemId: "itm-029" });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("Item is not on loan");
    // And an already-returned item is equally not on loan.
    const again = await patch({ itemId: "itm-027" });
    expect(again.status).toBe(409);
  });

  it("G.patch400", async () => {
    for (const body of [{}, { itemId: 42 }, { itemId: null }]) {
      const r = await patch(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(typeof (await r.json()).error).toBe("string");
    }
  });

  it("P.concurrent-return", async () => {
    // Mirror of P.concurrent-checkout on the way out. Reading "there is an open
    // loan" does not reserve it: four of these five find the loan and then lose
    // the race to close it. Losing must read as a conflict, not a 500.
    const statuses = await Promise.all(
      Array.from({ length: 5 }, () => rawPatch("itm-028")),
    );
    expect(statuses.filter((s) => s === 200).length, statuses.join(",")).toBe(1);
    expect(statuses.filter((s) => s === 409).length, statuses.join(",")).toBe(4);
  });
});

/** One request per socket, so N of these overlap in time instead of queueing. */
function raw(method: string, body: unknown): Promise<number> {
  const payload = JSON.stringify(body);
  const url = new URL(BASE);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: url.hostname,
        port: url.port,
        path: "/api/loans",
        method,
        agent: new http.Agent({ keepAlive: false }),
        headers: { ...staff, "content-length": Buffer.byteLength(payload) },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

const rawPost = (itemId: string, memberId: string) =>
  raw("POST", { itemId, memberId, dueAt: future });
const rawPatch = (itemId: string) => raw("PATCH", { itemId });

describe("API record fields", () => {
  it("G.post-fields", async () => {
    const r = await post({ itemId: "itm-024", memberId: "mbr-005", dueAt: future });
    expect(r.status).toBe(201);
    const { loan } = await r.json();
    expect(loan).toMatchObject({
      itemId: "itm-024",
      memberId: "mbr-005",
      borrowedAt: "2026-03-15T12:00:00.000Z",
      dueAt: future,
      returnedAt: null,
    });
  });
});
