# Plan — Lending Desk bug fix

Work phase by phase. Mark each task `[x]` as you finish it. Do not stop with a
partial plan.

## Phase 1: Reproduce

- [ ] Read `measure/tracks/lending_desk_bugfix/spec.md` and list the invariants you can already show are violated
- [ ] Run `npm run typecheck` and `npm run build`; record the current state

## Phase 2: Diagnose and repair

- [ ] `src/lib/loans.ts` — verify every status invariant in A, including the boundaries
- [ ] `src/components/item-card.tsx` — verify every invariant in B
- [ ] `app/items/page.tsx` — verify every invariant in C, including how the reads are scheduled
- [ ] `app/items/[id]/page.tsx` — verify every invariant in D, including render boundaries and read deduplication
- [ ] `app/items/[id]/checkout-form.tsx` — verify every invariant in E
- [ ] `src/actions/loans.ts` — verify every invariant in F, including authorization and race handling
- [ ] `app/api/loans/route.ts` — verify every invariant in G, including authorization, status codes, and race handling
- [ ] `app/items/loading.tsx` and `app/items/error.tsx` — verify every invariant in H

## Phase 3: Verify

- [ ] Every invariant in the spec holds
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] `plan.md` is fully marked
