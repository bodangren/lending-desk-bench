# Plan — Lending Desk test suite

Work phase by phase. Mark each task `[x]` as you finish it. Do not stop with a
partial plan.

## Phase 1: Understand

- [x] Read `measure/tracks/lending_desk_tests/spec.md`, `src/db/seed.ts`, and `src/lib/auth.ts`
- [x] Build and start the app; confirm `npm test` runs

## Phase 2: Write the suite

- [x] Tests for section A (loan status)
- [x] Tests for section B (catalogue)
- [x] Tests for section C (item detail)
- [x] Tests for section D (loans API), including authorization and races

## Phase 3: Verify

- [x] The suite passes against the running app
- [x] `npm run typecheck` passes
- [x] `npm run build` passes
- [x] `plan.md` is fully marked
