# Lending Desk scoring contract

This document describes the hidden harness. It is not copied into the model-visible fixture.
`harness/tests/criteria.ts`, `harness/tests/spec-matrix.ts`, and the control manifest are the
machine-readable source of truth; this document explains how their results are used.

## Preconditions and gate

Each candidate is evaluated in this order:

1. Validate candidate/file-contract and provenance.
2. Run `npm run typecheck`.
3. Run `npm run build`.
4. If both pass, run unit, API, browser, error-boundary, and quality suites.
5. Collect raw reports, validate their complete ID set, and calculate the score.

A failed typecheck or build is a **valid gate-blocked result** with `total: 0` and
`blocked_by_gate: true`. It is never treated as partial functional evidence or ranked.
Infrastructure/collection failures are different: they produce `valid: false` and
`total: null`.

## Functional completion (60%)

There is one primary executable assertion for every checkbox in
`fixture/measure/tracks/lending_desk/spec.md`. The spec matrix records the mapping. Additional
criteria may split a compound checkbox into independently observable behavior (for example,
response shape vs. status) or validate Measure closeout integrity. They are visible in
`criteria.ts` and are included deliberately rather than inferred from source inspection.

Criteria have blast-radius tiers:

| Tier | Meaning | Examples |
|---|---|---|
| 0 | silent security/state corruption or absent core surface | authorization, current data, core pages, status helper |
| 1 | wrong contract or bounded user-visible behavior | filtering, history order, mutation errors, endpoint statuses |
| 2 | degraded experience or formal closeout | metadata, pending/optimistic UI, streaming/error states, Measure closeout |

Higher tiers always contribute, but their weight is **soft-scaled** by lower-tier rates:

```text
scale(r) = min(1, r / 0.90)
weight_T1 = scale(T0_rate)
weight_T2 = scale(T0_rate) × scale(T1_rate)
```

A model at 80% Tier 0 still receives ~89% of its Tier 1 credit, not zero. A hard binary
unlock (credit only when Tier 0 ≥ 90%) collapsed every near-complete submission into the
same ~17-point pile and destroyed discrimination among near-complete models. Soft scaling keeps
the incentive not to bank polish without basics, without a dead zone.

## Adversarial probes (20%)

Probes are intentionally absent from the fixture spec. They exercise realistic mistakes that
can superficially satisfy a product test: leaking the staff key, stale state after mutation,
read/write races, literal search handling, request waterfalls, validation after I/O, N+1 reads,
duplicated detail reads, and missing streaming boundaries.

Each probe carries the tier of the prerequisite it depends on, so a locked tier cannot add
adversarial points. Probe definitions and advertised failure modes are in `criteria.ts`.

## Code quality (20%)

`harness/doctor.ts` invokes the lockfile-pinned local `react-doctor` binary with supply-chain
and dead-code scans disabled. It has no network dependency during a grading run. Quality is a
weighted penalty for diagnostics introduced above `reference/doctor.json`, not the tool's raw
health score. This avoids rewarding a candidate for deleting implementation.

Quality is evaluated only after a valid, compiling functional result exists. A missing,
malformed, or nonlocal doctor baseline invalidates the score rather than silently changing the
ruler.

## Advisory modernization signals

The `ADVISORY` list is reported beside the score but never contributes to its total. An advisory
is retained only when the reference passes it and it has deterministic control coverage. This
keeps framework-preference signals separate from product correctness.

## Formula

For a valid non-gate-blocked record:

```text
completion = Σ (passed_criterion × tier_scale) / |criteria|
adversarial = Σ (passed_probe × tier_scale) / |probes|
quality = completion × max(0, 1 - doctor_penalty / PENALTY_FULL)
total = round1(100 × (0.60 × completion + 0.20 × adversarial + 0.20 × quality))
```

A score record also contains per-tier rates, individual criterion/probe outcomes, advisory
outcomes, doctor diagnostics, and transcript usage so totals are auditable.

## Validity and provenance

A numeric result is publishable only when the record has all of:

```text
valid === true
trusted === true
publishable === true
provenance_valid === true
suite_current === true
host.under_load !== true
```

The runner hashes its grading implementation and every suite source, fixture/harness lockfile,
and frozen quality baseline. It also records the protected fixture hash and candidate tree hash.
Changing any of these invalidates an old score; re-run the candidate rather than merely
re-score a stale `results.json`.
Schema-4 provenance also binds each run ID to its executor evidence: an immutable image digest,
the Pi path/hash/version, the exact Arm-B skill-tree hashes, and the runtime and CLI argument
arrays. Overlay calibration records an explicit non-invocation identity; it can validate controls,
but it cannot become a ranked model result.

The collector rejects missing raw reports. The scorer rejects malformed gates/collections,
nonboolean results, missing IDs, orphan IDs, and stale provenance. Duplicate result IDs are a
collector error. Invalid records have `total: null`, never a numeric zero.

## Host trust

Some checks intentionally measure short state transitions or response flushes. A result run
under load, low memory, or swap pressure is retained with `host.under_load: true` but must not
be ranked. `BENCH_IGNORE_LOAD=1` is a diagnostic override only; it does not make a busy host
acceptable.

## Sensitivity controls

The control manifest defines a minimal anchored mutation for every point-bearing criterion and
probe and for every reported advisory. A control declares its target IDs, allowed collateral
failures, and the behavior it is meant to break. The control executor starts from the reference
overlay, applies exactly one declared mutation, runs the relevant harness path, and retains raw
reports.

A control passes only if its declared raw target IDs fail for the named reason. A skipped test,
tier lock, infrastructure error, or an old model's accidental failure is not sensitivity
evidence. Separate controls cover gate failures, corrupted result artifacts, lifecycle
shortcuts, protected edits, port/isolation behavior, fresh-store behavior, and under-load trust.

## Calibration sequence

Before comparing any model runs:

1. Run the reference overlay on a quiet host. It must pass the gate, collect every declared ID,
   pass all weighted IDs, have a current valid provenance record, and score 100.
2. Run the deterministic mutation controls and verify every declared target fails while the
   reference remains green.
3. Run an incomplete/empty candidate and explicit typecheck/build gate controls. They must not
   yield rankable totals.
4. Run two distinct IDs concurrently and a repeat fresh-store control. Ports, stores, and
   dependency trees must remain separate.
5. Run one forced-under-load calibration. Its raw artifacts may be useful, but it must be
   untrusted and excluded from summary ranking.

Only after these gates may a model matrix use `batch.sh`. Use multiple repetitions and report
both the trusted distribution and the No Skills / Skills delta; a single weekly run is not a
stable ranking. Report EMA and the 4-week range after the second week.
