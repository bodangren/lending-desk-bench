# Plan: Lending Desk — items slice

Work the phases in order. Mark each task `[x]` as you complete it.
Run `npm run typecheck` after each phase.

## Phase 1: Data helpers
- [x] Implement `computeLoanStatus` in `src/lib/loans.ts` (spec A)
- [x] Verify all five A criteria by inspection against `src/db/seed.ts`

## Phase 2: Presentation
- [x] Implement `ItemCard` in `src/components/item-card.tsx` (spec B)
- [x] Implement the catalogue in `app/items/page.tsx` (spec C)
- [x] Confirm `/items` lists all 29 seeded items

## Phase 3: Filtering
- [x] Add `?q=` and `?category=` handling to `app/items/page.tsx` (spec C)
- [x] Add the empty-result message (spec C)

## Phase 4: Detail
- [x] Implement `app/items/[id]/page.tsx` including loan history and not-found (spec D)
- [x] Implement `generateMetadata` (spec D)

## Phase 5: Mutations
- [x] Implement `checkoutItem` and `returnItem` in `src/actions/loans.ts` (spec F)
- [x] Ensure `/items` and the detail page reflect a mutation on the next visit (spec F)

## Phase 6: HTTP endpoint
- [x] Implement `GET` in `app/api/loans/route.ts` with both filters (spec G)
- [x] Implement `POST` with its status codes (spec G)
- [x] Implement `PATCH` with its status codes (spec G)

## Phase 7: Interactive checkout
- [x] Implement `CheckoutForm` in `app/items/[id]/checkout-form.tsx` (spec E)
- [x] Wire it into the detail page, hidden when the item is on loan (spec D)

## Phase 8: Interactive return
- [x] Implement `ReturnButton` in `app/items/[id]/checkout-form.tsx` (spec E)
- [x] Wire it into the detail page, shown only when the item is on loan (spec D)
- [x] Confirm returning an item makes the checkout form available again (spec F)

## Phase 9: Loading and error states
- [x] Implement `app/items/loading.tsx` (spec H)
- [x] Implement `app/items/error.tsx` (spec H)

## Phase 10: Verify
- [x] `npm run typecheck` passes
- [x] `npm run build` passes
- [x] Every checkbox in `spec.md` is satisfied
