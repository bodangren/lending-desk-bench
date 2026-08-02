/** Spec A — pure logic. Vitest. */
import { describe, expect, it } from "vitest";
import { computeLoanStatus } from "@candidate/src/lib/loans";
import type { Loan } from "@candidate/src/db/schema";

const NOW = new Date("2026-03-15T12:00:00.000Z");
const at = (h: number) => new Date(NOW.getTime() + h * 3600_000).toISOString();
const loan = (dueAt: string, returnedAt: string | null = null): Loan => ({
  id: "lon-x", itemId: "itm-001", memberId: "mbr-001",
  borrowedAt: at(-100), dueAt, returnedAt,
});

describe("computeLoanStatus", () => {
  it("A.returned", () => {
    expect(computeLoanStatus(loan(at(-10), at(-5)), NOW)).toBe("returned");
    // a returned loan is "returned" even when its due date has passed
    expect(computeLoanStatus(loan(at(-500), at(-400)), NOW)).toBe("returned");
  });

  it("A.overdue", () => {
    expect(computeLoanStatus(loan(at(-1)), NOW)).toBe("overdue");
    expect(computeLoanStatus(loan(at(-72)), NOW)).toBe("overdue");
  });

  it("A.due-soon", () => {
    expect(computeLoanStatus(loan(at(1)), NOW)).toBe("due-soon");
    expect(computeLoanStatus(loan(at(47)), NOW)).toBe("due-soon");
  });

  it("A.ok", () => {
    expect(computeLoanStatus(loan(at(49)), NOW)).toBe("ok");
    expect(computeLoanStatus(loan(at(200)), NOW)).toBe("ok");
  });

  it("A.boundary", () => {
    // exactly now -> due-soon, not overdue
    expect(computeLoanStatus(loan(at(0)), NOW)).toBe("due-soon");
    // exactly 48h -> the boundary belongs to due-soon
    expect(computeLoanStatus(loan(at(48)), NOW)).toBe("due-soon");
  });
});
