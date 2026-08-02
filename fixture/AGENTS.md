# AGENTS.md — Lending Desk

## The task

Read `measure/tracks/lending_desk/spec.md` and `measure/tracks/lending_desk/plan.md`.
Work the plan phase by phase. Mark each task complete in `plan.md` as you finish it.
Do not stop with a partial plan: every checklist task must be marked `[x]` before completion.
At terminal closeout, set `metadata.json` to `status: "complete"` with `actual_tasks: 24`.

## This repo

Next.js 16, React 19, TypeScript strict, Tailwind v4. Data access is `src/db/index.ts`.

`/members` is a working read-only slice. It is the reference for the conventions used here —
file layout, import style, data-access idiom, Tailwind classes. When unsure how something
should look in this codebase, read the `/members` equivalent and match it.

## Rules

- Fill in the stub files named in the spec. Do not create new files.
- Do not rename or change any exported symbol or type signature. They are the contract.
- Do not modify `src/db/`, `src/lib/auth.ts`, `app/members/`, or `src/components/member-card.tsx`.
- No new dependencies.
- Use `now()` from `src/db/index.ts` for the current time.

## Verifying your work

```bash
npm run typecheck
npm run build
```

Both must pass. A submission that does not compile scores near zero no matter how much
was written.

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

Every checkbox in `spec.md` is satisfied, `plan.md` is fully marked, and typecheck and build pass.
The final `metadata.json` records `status: "complete"` and `actual_tasks: 24`.
