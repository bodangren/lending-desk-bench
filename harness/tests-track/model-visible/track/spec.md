# Spec: Lending Desk — test suite

## Goal

This repo is a complete, working equipment-lending app. Write an automated test
suite for it under `tests/`. Do not change the application.

The grader runs your suite against this application and against a second
correct implementation of the same behavior that uses different markup, element
order, and code structure. Your tests must pass on both. The grader then runs
your suite against defective versions of the application. A good suite passes on
correct code and fails on defective code, so test the behavior below, not
incidental markup, class names, whitespace, or exact HTML.

## How the suite runs

- `npm test` runs every `tests/**/*.test.ts` file with Vitest, one file at a time.
- The app runs on a server at `process.env.BASE_URL` (default
  `http://127.0.0.1:3100`) with the seed data from `src/db/seed.ts` freshly
  loaded. Tests may change data, so keep your own tests independent of each
  other's changes (use different items, or check what you changed).
- The clock is fixed: `now()` in `src/db/index.ts` returns `NOW` from
  `src/db/seed.ts`.
- Staff requests send the header `x-staff-key` with `STAFF_KEY` from
  `src/lib/auth.ts`. Browsers use the `staff_key` cookie.
- Tests can reach the app over HTTP (`fetch`, `node:http`) and can import pure
  modules directly (for example `@/src/lib/loans`). The suite has no browser.

## Behavior to test

### A. Loan status (`src/lib/loans.ts` — `computeLoanStatus(loan, now)`)
- [ ] A loan with `returnedAt` set is `"returned"`, even when its due date has passed
- [ ] `"overdue"` when `dueAt` is strictly before `now`
- [ ] `"due-soon"` when `dueAt` is at or after `now` and no more than 48 hours after `now`
- [ ] `"ok"` when `dueAt` is more than 48 hours after `now`
- [ ] `dueAt` exactly equal to `now` is `"due-soon"`, not `"overdue"`

### B. Catalogue (`GET /items`)
- [ ] Every seeded item is listed, and each links to `/items/<item id>`
- [ ] Each item shows `Available` when it has no open loan, otherwise `On loan`
- [ ] `?q=` filters to items whose name contains that text, case-insensitively; the
      text is matched literally, not as a pattern
- [ ] `?category=` filters to items in exactly that category; both filters apply together
- [ ] An empty result shows the exact text `No items match your search.`

### C. Item detail (`GET /items/<id>`)
- [ ] Shows the item name, category, and description, and the page title
      `<item name> — Lending Desk`
- [ ] Lists every loan for the item, newest `borrowedAt` first, each with the
      member's name and the loan's status from A
- [ ] The staff key never appears in any page

### D. Loans API (`/api/loans`)
- [ ] `GET` returns `200` and `{ loans: Loan[] }`; `GET ?itemId=` and `GET ?overdue=true`
      filter correctly, alone and together
- [ ] `POST` with `{ itemId, memberId, dueAt }` creates a loan with `borrowedAt` of
      now and returns `201` with `{ loan: Loan }`
- [ ] Any request that is not from staff returns `401` and `{ error: "Unauthorized" }`,
      for every method
- [ ] `POST` with a missing or non-string field returns `400` and `{ error: string }`
- [ ] `POST` for an item that already has an open loan returns `409` — including when
      several requests race for the same item: exactly one gets `201`
- [ ] `PATCH` with `{ itemId }` closes that item's open loan and returns `200` with
      `{ loan: Loan }` whose `returnedAt` is set
- [ ] `PATCH` for an item with no open loan returns `409` — including when several
      returns race for the same loan: exactly one gets `200`
- [ ] `PATCH` with a missing or non-string `itemId` returns `400`

## Out of Scope

- Any change to the application, its configuration, or its dependencies
- Browser-only behavior (pending labels, optimistic updates)
