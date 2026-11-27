## Loan state

Loan status is computed by `computeLoanStatus` in `src/lib/loans.ts` and is
one of `returned`, `overdue`, `due-soon`, or `ok`:

1. A loan with `returnedAt` set is `returned`. A returned loan stays returned
   after its due date — the return flag wins over the clock.
2. An open loan (`returnedAt === null`) whose `dueAt` is strictly before
   `now` is `overdue` (`dueAt - now < 0`).
3. An open loan due from `now` through the next 48 hours is `due-soon`
   (`0 <= dueAt - now <= 48 * 3600_000` milliseconds).
4. Any other open loan is `ok`.
