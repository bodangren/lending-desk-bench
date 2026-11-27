# AGENTS.md — Lending Desk docs and ops

## The task

Read `measure/tracks/lending_desk_docs_ops/spec.md` and
`measure/tracks/lending_desk_docs_ops/plan.md`.
Complete the documentation task and the operations task in that plan.
Mark each plan task complete as you finish it.

## This repo

The application is a complete Next.js equipment-lending app.
Read the repository before you write the runbook.
Use the commands, routes, data model, and environment variables that exist here.

## Rules

- Edit only `docs/runbook.md` and `ops/verify.ts`.
- Do not edit `spec.md`.
- Do not change application files, dependencies, or exported symbols.
- Record progress in `measure/tracks/lending_desk_docs_ops/plan.md`.
- Set `metadata.json` to `status: "complete"` when both tasks pass.

## Verifying your work

Run `npm run typecheck` and `npm run build`.
Run the verifier against the valid and invalid manifests from the spec.
The verifier must print sorted JSON errors and use the documented exit codes.

## Definition of done

The runbook covers each required section with repository facts.
The verifier accepts the valid manifest and rejects the invalid manifest.
The plan and metadata record the completed work.
