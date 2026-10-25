# Spec: Lending Desk — change requests

## Goal

This repo is a complete, working equipment-lending app. Implement the change
requests below. Every existing behavior listed after them must keep holding.
Do not add, rename, change, or remove any exported symbol or type signature —
they are the contract. Do not edit this spec; record progress in `plan.md`.

Data access lives in `src/db/index.ts`. Types are in `src/db/schema.ts`. The fixed
clock is in `src/db/seed.ts`. Use `now()` from `src/db/index.ts` for the current
time; never `Date.now()` or a bare `new Date()`.

## Change requests

### CR-1. Catalogue status filter (`app/items/page.tsx`)
- [ ] `/items?status=available` lists only items with no open loan
- [ ] `/items?status=on-loan` lists only items with an open loan
- [ ] `status` applies together with `q` and `category`; an empty result renders the
      exact text `No items match your search.`
- [ ] Any other `status` value is ignored: the catalogue lists every item that matches
      the other filters

### CR-2. Loans API member filter (`app/api/loans/route.ts`)
- [ ] `GET /api/loans?memberId=<id>` returns only that member's loans
- [ ] `memberId` applies together with `itemId` and `overdue`

### CR-3. Due-date limit (`src/actions/loans.ts`, `app/api/loans/route.ts`)
- [ ] `checkoutItem` returns `{ ok: false, error: "Due date must be within 60 days" }` when
      `dueAt` is more than 60 days after now, and records no loan
- [ ] `POST /api/loans` returns `400` and `{ error: "Due date must be within 60 days" }` when
      `dueAt` is more than 60 days after now, and records no loan
- [ ] A `dueAt` exactly 60 days after now is accepted by both

### CR-4. Borrower on the detail page (`app/items/[id]/page.tsx`)
- [ ] When the item is on loan, the page shows the text
      `On loan to <member name>, due <YYYY-MM-DD>`, where the date is the UTC calendar
      date of the open loan's `dueAt`
- [ ] When the item is available, the page shows no such text

## Existing behavior that must keep holding

### A. Loan status (`src/lib/loans.ts` — `computeLoanStatus(loan, now)`)
- [ ] A loan with `returnedAt` set is `"returned"`, even when its due date has passed
- [ ] `"overdue"` when `dueAt` is strictly before `now`
- [ ] `"due-soon"` when `dueAt` is at or after `now` and no more than 48 hours after `now`
- [ ] `"ok"` when `dueAt` is more than 48 hours after `now`
- [ ] `dueAt` exactly equal to `now` is `"due-soon"`, not `"overdue"`

### B. Item card (`src/components/item-card.tsx` — `ItemCard`)
- [ ] Renders the item name and its category
- [ ] A badge reading `Available` when `openLoan` is null, otherwise `On loan`
- [ ] The whole card links to `/items/<item id>`
- [ ] `item.imageUrl` renders as an image whose alternative text is the item name

### C. Catalogue (`app/items/page.tsx`)
- [ ] Every item renders as an `ItemCard` with its current open loan if it has one
- [ ] `?q=` filters to items whose name contains that text, case-insensitively
- [ ] `?category=` filters to items in exactly that category; both filters apply together
- [ ] An empty result renders the exact text `No items match your search.`
- [ ] An `<h1>` reading `Items`
- [ ] The total item count and the category list are read without either waiting on the other

### D. Detail (`app/items/[id]/page.tsx`)
- [ ] Item name as an `<h1>`, plus its category and description
- [ ] Every loan for the item renders, newest `borrowedAt` first, each showing the
      member's name and the loan's status from A
- [ ] An unknown id renders the app's not-found page
- [ ] `CheckoutForm` renders only when the item has no open loan
- [ ] `ReturnButton` renders only when the item has an open loan
- [ ] `generateMetadata` returns a title of `<item name> — Lending Desk`

### E. Form (`app/items/[id]/checkout-form.tsx` — `CheckoutForm`, `ReturnButton`)
- [ ] A member selector listing `members` by name, and a due-date input
- [ ] Submitting calls `checkoutItem` with the item id, the selected member, and the due date
- [ ] While the submission is in flight the submit control is disabled and reads `Checking out…`
- [ ] The card shows the item as on loan immediately on submit, before the server
      responds, and reverts if the server rejects it
- [ ] When the action returns `{ ok: false }` the returned `error` string renders
- [ ] `ReturnButton` renders one control labelled `Return`; activating it calls
      `returnItem` with the item id
- [ ] While that request is in flight the control is disabled and reads `Returning…`
- [ ] The item shows as available immediately on activation, before the server
      responds, and reverts if the server rejects it
- [ ] When `returnItem` returns `{ ok: false }` the returned `error` string renders
- [ ] The member selector and the due-date input each have an accessible name (a
      `<label>` or an `aria-label`)
- [ ] An `error` string from either form is announced to assistive technology: it
      renders inside an element with `role="alert"` or inside an `aria-live` region

### F. Actions (`src/actions/loans.ts` — `checkoutItem`, `returnItem`)
- [ ] `checkoutItem` records a loan with `borrowedAt` of now and the given `dueAt`
- [ ] `returnItem` sets `returnedAt` to now on the item's open loan
- [ ] Both return `{ ok: false, error: "Not authorized" }` when the caller is not staff
- [ ] `checkoutItem` returns `{ ok: false, error: "Item is already on loan" }` when an
      open loan exists for that item — including when another request wins the race
- [ ] `checkoutItem` returns `{ ok: false, error: "Due date must be in the future" }`
      when `dueAt` is not after now
- [ ] `returnItem` returns `{ ok: false, error: "Item is not on loan" }` when none is open
- [ ] After either succeeds, `/items` and the item's detail page show the new state on
      the next visit without a manual reload

### G. API (`app/api/loans/route.ts`)
- [ ] `GET` returns `200` and `{ loans: Loan[] }`; `GET ?itemId=` and `GET ?overdue=true`
      filter correctly, alone and together
- [ ] `POST` with `{ itemId, memberId, dueAt }` creates a loan and returns `201` with
      `{ loan: Loan }`
- [ ] Any request that is not from staff returns `401` and `{ error: "Unauthorized" }`
- [ ] `POST` with a missing or non-string field returns `400` and `{ error: string }`
- [ ] `POST` for an item that already has an open loan returns `409` — including when
      another request wins the race for the write
- [ ] `PATCH` with `{ itemId }` closes that item's open loan and returns `200` with
      `{ loan: Loan }` whose `returnedAt` is set
- [ ] `PATCH` for an item with no open loan returns `409`; `PATCH` with a missing or
      non-string `itemId` returns `400`
- [ ] Every response reflects the current data; responses are not reused between requests

### H. Boundaries (`app/items/loading.tsx`, `app/items/error.tsx`)
- [ ] While the catalogue loads, the `Items` heading is already on screen and the grid
      area shows six placeholder tiles
- [ ] A failure loading the catalogue renders the exact text `Could not load items.`
      and a control labelled `Try again` that retries without a full page reload

## Out of Scope

- Any change to `src/db/`, `src/lib/auth.ts`, `app/members/`, or `src/components/member-card.tsx`
- New files or new dependencies
