# AGENTS.md — Lending Desk

## The task

Read `measure/tracks/lending_desk_tests/spec.md` and
`measure/tracks/lending_desk_tests/plan.md`.
This application is complete. Your task is to write its automated test suite.
Work the plan phase by phase and mark each plan task complete as you finish it.
Do not stop with a partial plan: every checklist task must be marked `[x]` before completion.

## This repo

Next.js 16, React 19, TypeScript strict, Vitest 4. Data access is `src/db/index.ts`,
seed data and the fixed clock are in `src/db/seed.ts`, and the staff key is in
`src/lib/auth.ts`.

## Rules

- Write test files only, under `tests/`, named `*.test.ts`. At most 20 files.
- Do not create, edit, rename, or delete any other file. The application is the contract.
- Do not edit `spec.md`. Record progress in `plan.md` and `metadata.json` only.
- No new dependencies. Use `vitest`, Node's `fetch`, and `node:http`.

## Running the app and the tests

```bash
npm run build
npx next start --port 3100 &          # the app, with the seed data loaded
BASE_URL=http://127.0.0.1:3100 npm test
```

Tests read the app's address from `process.env.BASE_URL` and fall back to
`http://127.0.0.1:3100`. Restart the app to restore the seed data.

## Verifying your work

```bash
npm run typecheck
npm run build
npm test
```

All three must pass against the running app.

## Available skills

Load a skill when it is relevant to the file you are working on. Do not load them all up
front — context spent on unread reference material is context unavailable for the task.

| Skill | Use for |
|---|---|
| `measure` | Working the phased plan; marking tasks complete |
| `next-best-practices` | App Router: routing, data fetching, route handlers, file conventions |
| `vercel-react-best-practices` | Waterfalls, bundle size, server-side patterns, re-renders |
| `vercel-composition-patterns` | Component API design, state placement, React 19 idiom |
| `build-graph` | Structural questions about the existing codebase |

## Definition of done

The suite passes against the running app, `plan.md` is fully marked, and typecheck and
build pass. Do not edit `spec.md`.
