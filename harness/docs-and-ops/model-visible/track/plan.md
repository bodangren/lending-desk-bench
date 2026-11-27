# Plan — Lending Desk docs and ops

Work phase by phase. Mark each task `[x]` as you finish it.

## Phase 1: Inspect

- [ ] Read the spec and the application source
- [ ] List the commands, routes, environment variables, and loan states

## Phase 2: Documentation

- [ ] Complete every required section in `docs/runbook.md`
- [ ] Remove all placeholders
- [ ] Check each repository fact against the source

## Phase 3: Operations

- [ ] Implement `ops/verify.ts`
- [ ] Accept the fixed valid manifest
- [ ] Reject the invalid manifest with sorted JSON errors
- [ ] Use the documented exit codes

## Phase 4: Verify

- [ ] Run `npm run typecheck`
- [ ] Run `npm run build`
- [ ] Run the verifier against both fixed manifests
- [ ] Set `metadata.json` to `status: "complete"`
