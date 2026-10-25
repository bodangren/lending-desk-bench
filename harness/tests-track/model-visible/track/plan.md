# Plan — Lending Desk test suite

Work phase by phase. Mark each task `[x]` as you finish it. Do not stop with a
partial plan.

## Phase 1: Understand

- [ ] Read `measure/tracks/lending_desk_tests/spec.md`, `src/db/seed.ts`, and `src/lib/auth.ts`
- [ ] Build and start the app; confirm `npm test` runs

## Phase 2: Write the suite

- [ ] Tests for section A (loan status)
- [ ] Tests for section B (catalogue)
- [ ] Tests for section C (item detail)
- [ ] Tests for section D (loans API), including authorization and races

## Phase 3: Verify

- [ ] The suite passes against the running app
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] `plan.md` is fully marked
