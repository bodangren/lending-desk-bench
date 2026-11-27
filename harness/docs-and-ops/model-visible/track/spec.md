# Spec: Lending Desk documentation and operations

## Goal

Complete `docs/runbook.md` and `ops/verify.ts` for this repository.
The application code is complete and protected.
Do not edit this spec.

## Documentation task

Write these sections in `docs/runbook.md`:

- Setup
- Scripts
- Environment
- API routes
- Loan state
- Verification
- Rollback

Use facts from the repository.

### Required facts

- Setup uses `npm ci`.
- Scripts include `npm run dev`, `npm run typecheck`, `npm run build`, and `npm run start`.
- Environment documents `BENCH_NOW`, `BENCH_LATENCY_MS`, `BENCH_FAIL_ITEMS`, and `BENCH_TRACE_FILE`.
- Routes include `/`, `/items`, `/items/[id]`, `/members`, and `/api/loans`.
- `/api/loans` supports `GET`, `POST`, and `PATCH`.
- Staff access uses the `x-staff-key` header or the `staff_key` cookie.
- Loan status uses `returned`, `overdue`, `due-soon`, and `ok`.
- A returned loan stays returned after its due date.
- An open loan is overdue strictly before `now`.
- An open loan is due-soon from `now` through the next 48 hours.
- Verification includes typecheck, build, and the operations verifier.
- Rollback restores the previous release and does not delete loan records.

Remove every placeholder from the final runbook.

## Operations task

Implement `ops/verify.ts` as a deterministic manifest verifier.

### Command

```bash
./node_modules/.bin/tsx ops/verify.ts <manifest-path>
```

The command reads one JSON manifest from the given path.
It prints a JSON array of error strings to stdout.
It sorts the error strings and prints one newline after the JSON array.

Use exit code 0 when the error array is empty.
Use exit code 1 when the manifest has validation errors.
Use exit code 2 for a usage error, a read error, or malformed JSON.

For a usage error, print this line to stderr:

```text
usage: tsx ops/verify.ts <manifest-path>
```

For a read error, print `["manifest file could not be read"]` to stdout.
For malformed JSON, print `["manifest must be valid JSON"]` to stdout.

### Fixed manifest

The verifier must accept this manifest:

```json
{
  "schema": 1,
  "service": "lending-desk",
  "commands": {
    "install": "npm ci",
    "develop": "npm run dev",
    "typecheck": "npm run typecheck",
    "build": "npm run build",
    "start": "npm run start"
  },
  "routes": {
    "home": "/",
    "catalogue": "/items",
    "detail": "/items/[id]",
    "members": "/members",
    "loans": "/api/loans"
  },
  "environment": ["BENCH_NOW", "BENCH_LATENCY_MS"]
}
```

The verifier must reject this manifest:

```json
{
  "schema": 2,
  "service": "lending-desk",
  "commands": {
    "install": "npm ci",
    "develop": "npm run dev",
    "typecheck": "tsc",
    "build": "npm run build",
    "start": "npm run start"
  },
  "routes": {
    "home": "/",
    "catalogue": "/items",
    "detail": "/items/:id",
    "members": "/members",
    "loans": "/api/loans"
  },
  "environment": ["BENCH_LATENCY_MS"]
}
```

It must print these errors in this order:

```json
["commands.typecheck must equal npm run typecheck","environment must equal the fixed environment list","routes.detail must equal /items/[id]","schema must be 1"]
```

The manifest must be an object.
The `schema` must equal 1.
The `service` must equal `lending-desk`.
Each `commands` entry must equal its fixed value.
Each `routes` entry must equal its fixed value.
The `environment` array must equal the fixed array in order.

Use these validation messages:

- `manifest must be an object`
- `schema must be 1`
- `service must be lending-desk`
- `commands.<key> must equal <value>`
- `routes.<key> must equal <value>`
- `environment must equal the fixed environment list`

A missing entry uses the same message as a wrong entry.
Sort all validation messages before output.

## Out of scope

- Application code changes
- New dependencies
- Network access
- Edits to files other than the two task files and the plan metadata
