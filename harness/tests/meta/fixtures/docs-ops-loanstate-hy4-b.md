## Loan state

`computeLoanStatus` in `src/lib/loans.ts` derives one of four statuses from a
loan and the fixed `now()` clock:

- `returned` — the loan has a `returnedAt` timestamp. This check comes first, so
  a returned loan stays `returned` forever, even after its due date passes.
- `overdue` — an open loan whose `dueAt` is strictly before `now()` (`delta < 0`).
  A loan due exactly at `now()` is not overdue.
- `due-soon` — an open loan due from `now()` through the next 48 hours,
  inclusive (`0 <= delta <= 48 * 3600_000` ms).
- `ok` — an open loan due later than the 48-hour window.

Only open loans (`returnedAt === null`) can be overdue, due-soon, or ok; the
store enforces at most one open loan per item. Conflicts from concurrent
checkout or return are reported as HTTP `409`, never as a server error.
