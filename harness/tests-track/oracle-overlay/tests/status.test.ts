import { describe, expect, it } from "vitest";
import { computeLoanStatus } from "@/src/lib/loans";
import { NOW } from "@/src/db/seed";
import type { Loan } from "@/src/db/schema";

const now = new Date(NOW);
const shift = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();
const loan = (dueInHours: number, returned = false): Loan => ({
  id: "lon-test",
  itemId: "itm-001",
  memberId: "mbr-001",
  borrowedAt: shift(-100),
  dueAt: shift(dueInHours),
  returnedAt: returned ? shift(-1) : null,
});

describe("computeLoanStatus", () => {
  it("reports a returned loan as returned, even past its due date", () => {
    expect(computeLoanStatus(loan(-50, true), now)).toBe("returned");
    expect(computeLoanStatus(loan(10, true), now)).toBe("returned");
  });

  it("reports a loan due before now as overdue", () => {
    expect(computeLoanStatus(loan(-1), now)).toBe("overdue");
  });

  it("treats a loan due exactly now as due-soon", () => {
    expect(computeLoanStatus(loan(0), now)).toBe("due-soon");
  });

  it("keeps due-soon up to and including 48 hours", () => {
    expect(computeLoanStatus(loan(1), now)).toBe("due-soon");
    expect(computeLoanStatus(loan(48), now)).toBe("due-soon");
  });

  it("reports ok after 48 hours", () => {
    expect(computeLoanStatus(loan(49), now)).toBe("ok");
  });
});
