# Lending Desk implementation plan

Complete each phase in order. Mark each task `[X]` when it is complete.
Run `npm run typecheck` after each phase.

## Incidental implementation choices

This implementation uses a UTC `datetime-local` control. It sorts member options by name and omits a placeholder option.
The item card puts the badge first and uses a wide image. Both catalogue headings wrap `Items` in a `<span>`.
The catalogue reads items, categories, and loans through one `Promise.all`. It derives the total from the item read.
The detail page puts history before the loan action. It uses an ordered list and different labels.
The forms put the deadline before the borrower selector. They use local state, visible labels, and an assertive live region.
The API relies on the store conflict errors. It does not repeat a pre-write open-loan read.

## Phase 1: Data helpers
* [X] Implement `computeLoanStatus` in `src/lib/loans.ts` (spec A)
* [X] Verify all five A criteria by inspection against `src/db/seed.ts`

## Phase 2: Presentation
* [X] Implement `ItemCard` in `src/components/item-card.tsx` (spec B)
* [X] Implement the catalogue in `app/items/page.tsx` (spec C)
* [X] Confirm `/items` lists all 29 seeded items

## Phase 3: Filtering
* [X] Add `?q=` and `?category=` handling to `app/items/page.tsx` (spec C)
* [X] Add the empty-result message (spec C)

## Phase 4: Detail
* [X] Implement `app/items/[id]/page.tsx` including loan history and not-found (spec D)
* [X] Implement `generateMetadata` (spec D)

## Phase 5: Mutations
* [X] Implement `checkoutItem` and `returnItem` in `src/actions/loans.ts` (spec F)
* [X] Ensure `/items` and the detail page reflect a mutation on the next visit (spec F)

## Phase 6: HTTP endpoint
* [X] Implement `GET` in `app/api/loans/route.ts` with both filters (spec G)
* [X] Implement `POST` with its status codes (spec G)
* [X] Implement `PATCH` with its status codes (spec G)

## Phase 7: Interactive checkout
* [X] Implement `CheckoutForm` in `app/items/[id]/checkout-form.tsx` (spec E)
* [X] Wire it into the detail page, hidden when the item is on loan (spec D)

## Phase 8: Interactive return
* [X] Implement `ReturnButton` in `app/items/[id]/checkout-form.tsx` (spec E)
* [X] Wire it into the detail page, shown only when the item is on loan (spec D)
* [X] Confirm returning an item makes the checkout form available again (spec F)

## Phase 9: Loading and error states
* [X] Implement `app/items/loading.tsx` (spec H)
* [X] Implement `app/items/error.tsx` (spec H)

## Phase 10: Verify
* [X] `npm run typecheck` passes
* [X] `npm run build` passes
* [X] Every checkbox in `spec.md` is satisfied
