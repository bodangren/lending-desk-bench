# Lending Desk runbook

## Setup

Run `npm ci` to install the locked dependencies.

## Scripts

- `npm run dev` starts the development server.
- `npm run typecheck` runs TypeScript without emitting files.
- `npm run build` creates the production build.
- `npm run start` serves the production build.

## Environment

- `BENCH_NOW` sets the fixed application clock.
- `BENCH_LATENCY_MS` sets the artificial data-read delay.
- `BENCH_FAIL_ITEMS` makes catalogue reads fail when set.
- `BENCH_TRACE_FILE` names the optional data-read trace file.

The API accepts staff access through the `x-staff-key` header or the `staff_key` cookie.

## API routes

| Route | Methods | Purpose |
|---|---|---|
| `/` | `GET` | Home page |
| `/items` | `GET` | Catalogue with `q` and `category` filters |
| `/items/[id]` | `GET` | Item detail and loan history |
| `/members` | `GET` | Member directory |
| `/api/loans` | `GET`, `POST`, `PATCH` | Loan reads and mutations |

`GET /api/loans` accepts `itemId` and `overdue=true` filters.
`POST /api/loans` accepts `itemId`, `memberId`, and `dueAt`.
`PATCH /api/loans` accepts `itemId` and closes the open loan.
A request without staff access returns 401.
A malformed request returns 400.
An item with an open loan returns 409 on checkout.

## Loan state

A loan with `returnedAt` set has status `returned`.
A returned loan stays returned after its due date.
An open loan is `overdue` strictly before `now`.
An open loan is `due-soon` from `now` through the next 48 hours.
An open loan due later than 48 hours is `ok`.

## Verification

Run `npm run typecheck` and `npm run build`.
Run `node --no-warnings ops/verify.ts <manifest-path>` against the fixed manifests.
The verifier prints sorted JSON errors and exits 0 for a valid manifest.

## Rollback

Deploy the previous release.
Keep the existing data store and loan records.
Run typecheck, build, and the verifier before traffic returns.
