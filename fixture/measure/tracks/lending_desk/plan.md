# Plan: Lending Desk — items slice

Work the phases in order. Mark each task `[x]` as you complete it.
Run `npm run typecheck` after each phase.

## Phase 1: Data helpers
- [ ] Implement `computeLoanStatus` in `src/lib/loans.ts` (spec A)
- [ ] Verify all five A criteria by inspection against `src/db/seed.ts`

## Phase 2: Presentation
- [ ] Implement `ItemCard` in `src/components/item-card.tsx` (spec B)
- [ ] Implement the catalogue in `app/items/page.tsx` (spec C)
- [ ] Confirm `/items` lists all 29 seeded items

## Phase 3: Filtering
- [ ] Add `?q=` and `?category=` handling to `app/items/page.tsx` (spec C)
- [ ] Add the empty-result message (spec C)

## Phase 4: Detail
- [ ] Implement `app/items/[id]/page.tsx` including loan history and not-found (spec D)
- [ ] Implement `generateMetadata` (spec D)

## Phase 5: Mutations
- [ ] Implement `checkoutItem` and `returnItem` in `src/actions/loans.ts` (spec F)
- [ ] Ensure `/items` and the detail page reflect a mutation on the next visit (spec F)

## Phase 6: HTTP endpoint
- [ ] Implement `GET` in `app/api/loans/route.ts` with both filters (spec G)
- [ ] Implement `POST` with its status codes (spec G)
- [ ] Implement `PATCH` with its status codes (spec G)

## Phase 7: Interactive checkout
- [ ] Implement `CheckoutForm` in `app/items/[id]/checkout-form.tsx` (spec E)
- [ ] Wire it into the detail page, hidden when the item is on loan (spec D)

## Phase 8: Interactive return
- [ ] Implement `ReturnButton` in `app/items/[id]/checkout-form.tsx` (spec E)
- [ ] Wire it into the detail page, shown only when the item is on loan (spec D)
- [ ] Confirm returning an item makes the checkout form available again (spec F)

## Phase 9: Loading and error states
- [ ] Implement `app/items/loading.tsx` (spec H)
- [ ] Implement `app/items/error.tsx` (spec H)

## Phase 10: Verify
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] Every checkbox in `spec.md` is satisfied
