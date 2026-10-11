import type { Loan, LoanStatus } from "@/src/db/schema";

const HOUR_MS = 3_600_000;
const DUE_SOON_WINDOW_MS = 48 * HOUR_MS;

/**
 * Classify a loan relative to `now`.
 * See spec section A for the exact rules.
 */
export function computeLoanStatus(loan: Loan, now: Date): LoanStatus {
  if (loan.returnedAt !== null) return "returned";
  const remaining = new Date(loan.dueAt).getTime() - now.getTime();
  if (remaining < 0) return "overdue";
  return remaining <= DUE_SOON_WINDOW_MS ? "due-soon" : "ok";
}
