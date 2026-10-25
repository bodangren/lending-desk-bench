# Plan — Lending Desk change requests

Work phase by phase. Mark each task `[x]` as you finish it. Do not stop with a
partial plan.

## Phase 1: Understand

- [ ] Read `measure/tracks/lending_desk_change/spec.md` and the files each change request names
- [ ] Run `npm run typecheck` and `npm run build`; record the current state

## Phase 2: Implement the change requests

- [ ] CR-1 — catalogue status filter in `app/items/page.tsx`
- [ ] CR-2 — member filter in `app/api/loans/route.ts`
- [ ] CR-3 — due-date limit in `src/actions/loans.ts` and `app/api/loans/route.ts`
- [ ] CR-4 — borrower and due date in `app/items/[id]/page.tsx`

## Phase 3: Verify

- [ ] Every change request holds
- [ ] Every existing behavior in the spec still holds
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] `plan.md` is fully marked
