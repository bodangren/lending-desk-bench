## Loan state

Loan type and status are defined in `src/db/schema.ts`:

```ts
export type LoanStatus = "returned" | "overdue" | "due-soon" | "ok";
```

Computed by `computeLoanStatus(loan, now)` in `src/lib/loans.ts` with `DUE_SOON_MS = 48 * 3600_000` (48 hours):

- `returned` — the loan has a non-null `returnedAt`. A returned loan stays returned after its due date.
- `overdue` — the loan is still open (`returnedAt === null`) and its `dueAt` is strictly before `now` (`due - now < 0`). An open loan is overdue strictly before `now`.
- `due-soon` — the loan is still open and its `dueAt` is at or after `now` but within the next 48 hours (`0 <= due - now <= 48 hours`). An open loan is due-soon from `now` through the next 48 hours.
- `ok` — the loan is still open and due more than 48 hours after `now`.
