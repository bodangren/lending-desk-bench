# Spec: Lending Desk — items slice

## Goal

This repo is an equipment-lending app. The `/members` slice is built and working. Build the
`/items` slice by filling in the stub files below.

Every file, export name, and type signature already exists. Do not create files, rename
exports, or change signatures — they are the contract.

Data access lives in `src/db/index.ts`. Types are in `src/db/schema.ts`. Seed data and the
fixed clock are in `src/db/seed.ts`. Use `now()` from `src/db/index.ts` for the current time;
never `Date.now()` or a bare `new Date()`.

## Acceptance Criteria

### A. `src/lib/loans.ts` — `computeLoanStatus(loan, now)`
- [ ] Returns `"returned"` when `loan.returnedAt` is set
- [ ] Returns `"overdue"` when `dueAt` is strictly before `now`
- [ ] Returns `"due-soon"` when `dueAt` is at or after `now` and no more than 48 hours after `now`
- [ ] Returns `"ok"` when `dueAt` is more than 48 hours after `now`
- [ ] A loan with `dueAt` exactly equal to `now` is `"due-soon"`, not `"overdue"`

### B. `src/components/item-card.tsx` — `ItemCard`
- [ ] Renders the item name and its category
- [ ] Renders a badge reading `Available` when `openLoan` is null, otherwise `On loan`
- [ ] The whole card is a link to `/items/<item id>`
- [ ] Renders `item.imageUrl` as an image whose alternative text is the item name

### C. `app/items/page.tsx` — catalogue
- [ ] Renders every item as an `ItemCard`, each with its current open loan if it has one
- [ ] `?q=` filters to items whose name contains that text, case-insensitively
- [ ] `?category=` filters to items in exactly that category
- [ ] `?q=` and `?category=` apply together
- [ ] An empty result renders the exact text `No items match your search.`
- [ ] Renders an `<h1>` reading `Items`
- [ ] The total item count and the category list are read without either waiting on the other

### D. `app/items/[id]/page.tsx` — detail
- [ ] Renders the item name as an `<h1>`, plus its category and description
- [ ] Renders every loan for that item, newest `borrowedAt` first, each showing the member's
      name and the loan's status from A
- [ ] An unknown id renders the app's not-found page
- [ ] Renders `CheckoutForm` only when the item has no open loan
- [ ] Renders `ReturnButton` only when the item has an open loan
- [ ] `generateMetadata` returns a title of `<item name> — Lending Desk`

### E. `app/items/[id]/checkout-form.tsx` — `CheckoutForm`, `ReturnButton`
- [ ] Renders a member selector listing `members` by name, and a due-date input
- [ ] Submitting calls `checkoutItem` with the item id, the selected member, and the due date
- [ ] While the submission is in flight the submit control is disabled and reads
      `Checking out…`
- [ ] The card shows the item as on loan immediately on submit, before the server responds,
      and reverts if the server rejects it
- [ ] When the action returns `{ ok: false }` the returned `error` string is rendered
- [ ] `ReturnButton` renders one control labelled `Return`, and activating it calls
      `returnItem` with the item id
- [ ] While that request is in flight the control is disabled and reads `Returning…`
- [ ] The item shows as available immediately on activation, before the server responds, and
      reverts if the server rejects it
- [ ] When `returnItem` returns `{ ok: false }` the returned `error` string is rendered

### F. `src/actions/loans.ts` — `checkoutItem`, `returnItem`
- [ ] `checkoutItem` records a loan with `borrowedAt` of now and the given `dueAt`
- [ ] `returnItem` sets `returnedAt` to now on the item's open loan
- [ ] Both return `{ ok: false, error: "Not authorized" }` when the caller is not staff
- [ ] `checkoutItem` returns `{ ok: false, error: "Item is already on loan" }` when an open
      loan exists for that item
- [ ] `checkoutItem` returns `{ ok: false, error: "Due date must be in the future" }` when
      `dueAt` is not after now
- [ ] `returnItem` returns `{ ok: false, error: "Item is not on loan" }` when none is open
- [ ] After either succeeds, `/items` and the item's detail page show the new state on the
      next visit without a manual reload

### G. `app/api/loans/route.ts` — loans endpoint
- [ ] `GET` returns `200` and `{ loans: Loan[] }`
- [ ] `GET ?itemId=` returns only that item's loans
- [ ] `GET ?overdue=true` returns only loans whose status from A is `"overdue"`
- [ ] `GET` supports both filters together
- [ ] `POST` with `{ itemId, memberId, dueAt }` creates a loan and returns `201` with
      `{ loan: Loan }`
- [ ] Any request that is not from staff returns `401` and `{ error: "Unauthorized" }`
- [ ] `POST` with a missing or non-string field returns `400` and `{ error: string }`
- [ ] `POST` for an item that already has an open loan returns `409`
- [ ] `PATCH` with `{ itemId }` closes that item's open loan and returns `200` with
      `{ loan: Loan }` whose `returnedAt` is set
- [ ] `PATCH` for an item with no open loan returns `409` and `{ error: "Item is not on loan" }`
- [ ] `PATCH` with a missing or non-string `itemId` returns `400` and `{ error: string }`
- [ ] Every response reflects the current data; responses are not reused between requests

### H. `app/items/loading.tsx`, `app/items/error.tsx`
- [ ] While the catalogue loads, the `Items` heading is already on screen and the grid area
      shows six placeholder tiles
- [ ] A failure loading the catalogue renders the exact text `Could not load items.` and a
      control labelled `Try again` that retries without a full page reload

## Out of Scope

- Any change to `src/db/`, `src/lib/auth.ts`, `app/members/`, or `src/components/member-card.tsx`
- Authentication UI. `getStaffSession()` in `src/lib/auth.ts` returns the staff session or null.
- New dependencies.
- Tests. The grader supplies its own.
