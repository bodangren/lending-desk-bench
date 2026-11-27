## Loan state

A loan records `borrowedAt`, `dueAt`, and `returnedAt` timestamps. The status is
derived from those fields relative to `now()`:

- `returned` — the loan has a `returnedAt` value. A returned loan **stays returned**
  even after its due date has passed.
- `overdue` — an open loan whose `dueAt` is strictly before `now()`.
- `due-soon` — an open loan due at `now()` or within the next 48 hours.
- `ok` — an open loan due later than the next 48 hours.

The store enforces at most one open loan per item. Checkout and return requests
that lose a race to a concurrent request are answered as `409 Conflict` rather
than a server error.
