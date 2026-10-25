/**
 * Change track only (lending_desk_change): CR-2 and CR-3 over HTTP.
 * grade.sh excludes this file from every other track.
 *
 * Vitest does not order files by name, so loans.test.ts may run first. These
 * checks compare loan ids, which a close does not remove, and use items that
 * loans.test.ts never touches.
 */
import { describe, expect, it } from "vitest";
import { STAFF_KEY } from "@candidate/src/lib/auth";
import { NOW, seedLoans } from "@candidate/src/db/seed";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const staff = { "x-staff-key": STAFF_KEY, "content-type": "application/json" };
const DAY_MS = 86_400_000;
const afterNow = (ms: number) => new Date(Date.parse(NOW) + ms).toISOString();

const ids = async (qs: string): Promise<string[]> => {
  const response = await fetch(`${BASE}/api/loans${qs}`, { headers: staff, cache: "no-store" });
  expect(response.status).toBe(200);
  return ((await response.json()).loans as { id: string }[]).map((loan) => loan.id).sort();
};
const post = (body: unknown) =>
  fetch(`${BASE}/api/loans`, { method: "POST", headers: staff, body: JSON.stringify(body) });

describe("CR-2 member filter", () => {
  it("X.api-member", async () => {
    const expected = seedLoans.filter((loan) => loan.memberId === "mbr-003").map((loan) => loan.id).sort();
    expect(await ids("?memberId=mbr-003")).toEqual(expected);
  });

  it("X.api-member-combined", async () => {
    // itm-001 holds loans of two members, so the item filter alone is not enough.
    expect(await ids("?memberId=mbr-001&itemId=itm-001")).toEqual(["lon-004"]);
    expect(await ids("?memberId=mbr-001&overdue=true")).toEqual(["lon-001"]);
    expect(await ids("?memberId=mbr-002&overdue=true")).toEqual([]);
  });
});

describe("CR-3 due-date limit", () => {
  it("X.due-limit-api", async () => {
    const response = await post({ itemId: "itm-009", memberId: "mbr-001", dueAt: afterNow(61 * DAY_MS) });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Due date must be within 60 days");
    expect(await ids("?itemId=itm-009")).toEqual([]);
  });

  it("X.due-limit-boundary", async () => {
    const exact = await post({ itemId: "itm-019", memberId: "mbr-002", dueAt: afterNow(60 * DAY_MS) });
    expect(exact.status).toBe(201);
    const over = await post({ itemId: "itm-020", memberId: "mbr-002", dueAt: afterNow(60 * DAY_MS + 1) });
    expect(over.status).toBe(400);
    expect((await over.json()).error).toBe("Due date must be within 60 days");
  });
});
