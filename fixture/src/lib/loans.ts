import type { Loan, LoanStatus } from "@/src/db/schema";

/**
 * Classify a loan relative to `now`.
 * See spec section A for the exact rules.
 */
export function computeLoanStatus(loan: Loan, now: Date): LoanStatus {
  // TODO: implement (spec A)
  throw new Error("computeLoanStatus is not implemented");
}
