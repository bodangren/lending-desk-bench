# Change-request benchmark — lending_desk_change

## Summary

Add a fourth benchmark track that measures whether a model can change working
code to meet new requirements without breaking existing behavior. The model
receives the complete, correct application and a spec with change requests.
The build track only fills stubs, and the bugfix track only repairs defects,
so neither measures changes to working code.

## Definitions

- **Clean app.** The r2 fixture with the `reference/` overlay.
- **Change request (CR).** One new or changed behavior, stated as acceptance
  criteria in the model-visible spec.
- **Change set.** A frozen, versioned list of CRs (`harness/change/sets/`).
- **Change criteria.** Suite IDs with the prefix `X.` that grade the CRs.
- **Change reference.** `reference-change/`, the clean app with every CR in the
  set implemented.

## Functional requirements

### FR-1 — Change set `c1`

- CR-1, catalogue status filter: `/items?status=available` and
  `?status=on-loan`; the filter combines with `q` and `category`; any other
  value shows every item.
- CR-2, API member filter: `GET /api/loans?memberId=` returns only that
  member's loans and combines with `itemId` and `overdue`.
- CR-3, due-date limit: a due date more than 60 days after now is refused by
  `checkoutItem` with `{ ok: false, error: "Due date must be within 60 days" }`
  and by `POST /api/loans` with `400` and the same error. Exactly 60 days is
  allowed.
- CR-4, borrower on the detail page: when an item is on loan, the detail page
  shows `On loan to <member name>, due <YYYY-MM-DD>`.

No CR adds an export, so the public surface stays the clean app's surface.

### FR-2 — Change criteria

| ID | Tier | CR |
|---|---|---|
| `X.status-available` | 1 | CR-1 |
| `X.status-on-loan` | 1 | CR-1 |
| `X.status-combined` | 1 | CR-1 |
| `X.api-member` | 1 | CR-2 |
| `X.api-member-combined` | 1 | CR-2 |
| `X.due-limit-api` | 1 | CR-3 |
| `X.due-limit-boundary` | 1 | CR-3 |
| `X.due-limit-action` | 1 | CR-3 |
| `X.detail-borrower` | 1 | CR-4 |

- Each ID passes on the change reference and fails on the clean app.
- Change criteria run only on the change track. Other tracks exclude them from
  the suites and from the declared ID set.
- Each ID has a sensitivity control against the change reference.

### FR-3 — Variant tree (model-visible)

- `measure/tracks/lending_desk/` is replaced by
  `measure/tracks/lending_desk_change/`. The spec restates A–H as behavior that
  must keep holding and lists the CRs as new acceptance criteria.
- `AGENTS.md` is the change version.

### FR-4 — Candidate contract

- Writable: the nine task files plus the track's `plan.md` and
  `metadata.json`. Protected: everything else in the variant.
- The soft and hard violation classes of `bench_v2` FR-8 apply.

### FR-5 — Scoring

```text
change     = tier-scaled pass rate over the X.* criteria
regression = tier-scaled weighted pass rate over the non-M build criteria
robustness = probe pass rate
adherence  = contract (bench_v2 FR-8)
quality    = soft-scaled on change at 0.6, times the doctor penalty
total      = round1(100 × (0.45 × change + 0.25 × regression
                           + 0.10 × robustness + 0.10 × adherence
                           + 0.10 × quality))
```

An untouched variant scores change 0 and a total near 45. Calibration records
the exact baseline.

### FR-6 — Provenance and calibration

- Provenance binds `track: "change"`, `change_set_id`, `change_set_sha256`, and
  the variant tree hash.
- Calibration: the change reference scores 100; the untouched variant scores
  change 0.

## Acceptance criteria

- [ ] FR-1/2: every X.* ID passes on the change reference and fails on the
      clean app.
- [ ] FR-3: the model-visible spec states every CR and no grader detail.
- [ ] FR-4: the contract accepts a change inside the task files.
- [ ] FR-5: meta tests verify the arithmetic on synthetic results.
- [ ] FR-6: the change canary scores 100.

## Out of scope

- CRs that need new store functions or new exports.
