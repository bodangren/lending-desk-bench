import type { Loan, LoanStatus } from "@/src/db/schema";

const SOON_LIMIT_MS = 2 * 24 * 60 * 60 * 1000;

export function computeLoanStatus(loan: Loan, now: Date): LoanStatus {
  if (loan.returnedAt !== null) return "returned";

  const remaining = new Date(loan.dueAt).getTime() - now.getTime();
  if (remaining < 0) return "overdue";
  if (remaining <= SOON_LIMIT_MS) return "due-soon";
  return "ok";
}
