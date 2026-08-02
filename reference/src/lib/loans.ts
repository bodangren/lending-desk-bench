import type { Loan, LoanStatus } from "@/src/db/schema";

const DUE_SOON_MS = 48 * 3600_000;

export function computeLoanStatus(loan: Loan, now: Date): LoanStatus {
  if (loan.returnedAt) return "returned";
  const due = Date.parse(loan.dueAt);
  const delta = due - now.getTime();
  if (delta < 0) return "overdue";
  if (delta <= DUE_SOON_MS) return "due-soon";
  return "ok";
}
