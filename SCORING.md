# Lending Desk scoring contract

This document describes the hidden harness. It is not copied into the model-visible fixture.
`harness/tests/criteria.ts`, `harness/tests/spec-matrix.ts`, and the control manifest are the
machine-readable source of truth; this document explains how their results are used.

Four tracks share the machinery:

| Track | Run-id prefix | Task |
|---|---|---|
| `build` | none | Fill the stubs of the `/items` slice (the original task) |
| `bugfix` | `bf-` | Repair seeded, undisclosed defects in the finished app |
| `tests` | `tt-` | Write a test suite for the finished app |
| `change` | `ch-` | Add four requested behaviors to the finished app |

The build sections below apply to the build track; each other track has its own section at
the end. Track design records: `measure/tracks/bench_v2`, `bugfix_bench`, `tests_bench`,
and `change_bench`.

## Fixture revisions

`harness/revisions.ts` names the model-visible fixture revision. r2 (from 2026w40) states the
export rule as "do not add, rename, change, or remove", forbids edits to `spec.md`, adds two
accessibility checkboxes to spec E, adds the protected grader-only route
`app/api/bench-state`, and adds `vitest` for the tests track. Every record carries
`fixture_revision`: the instructions the agent saw. `regrade-run.sh` grades an older run's
writable files on the current tree (a graft), so every week shares one ruler. A criterion
carries `since`, the revision whose spec first states it; a record is scored only on the
criteria of its own revision (`E.labels` and `E.error-announced` do not count for r1
records). Hidden probes are not spec-stated and apply to every record.

## Preconditions and gate

Each batch starts with a canary: the track's calibration candidate goes through the normal
`run.sh`/`grade.sh` path and must score a valid 100, or the batch stops. Each candidate is
then evaluated in this order:

1. Candidate filesystem contract (see Adherence) and provenance.
2. Chromium launch check. A browser that cannot start makes the record invalid.
3. `npm run typecheck` and `npm run build`.
4. If both pass, run unit, API, browser, error-boundary, and quality suites. A Playwright
   launch error in a raw report makes the record invalid.
5. Collect raw reports, validate their complete ID set, and calculate the score.

A failed typecheck or build is a **valid gate-blocked result** with `total: 0` and
`blocked_by_gate: true`. It is never treated as partial functional evidence or ranked.
Infrastructure/collection failures are different: they produce `valid: false` and
`total: null`.

## Functional completion (55%)

There is one primary executable assertion for every checkbox in
`fixture/measure/tracks/lending_desk/spec.md`. The spec matrix records the mapping. Additional
criteria may split a compound checkbox into independently observable behavior (for example,
response shape vs. status). They are visible in `criteria.ts` and are included deliberately
rather than inferred from source inspection.

The browser checks of sections E and F read and prepare the store through the protected route
`app/api/bench-state`, which answers only the key `grade.sh` gives the server. Under r1 they
used the candidate's own `/api/loans`, so a stub route cost about 25 E and F criteria.

Criteria have blast-radius tiers:

| Tier | Meaning | Examples |
|---|---|---|
| 0 | silent security/state corruption or absent core surface | authorization, current data, core pages, status helper |
| 1 | wrong contract or bounded user-visible behavior | filtering, history order, mutation errors, endpoint statuses, accessible names |
| 2 | degraded experience or formal closeout | metadata, pending/optimistic UI, streaming/error states, announced errors |

Higher tiers always contribute, but their weight is **soft-scaled** by lower-tier rates:

```text
scale(r) = min(1, r / 0.90)
weight_T1 = scale(T0_rate)
weight_T2 = scale(T0_rate) × scale(T1_rate)
```

A model at 80% Tier 0 still receives ~89% of its Tier 1 credit, not zero. A hard binary
unlock (credit only when Tier 0 ≥ 90%) collapsed every near-complete submission into the
same ~17-point pile and destroyed discrimination among near-complete models.

**Criterion weights.** On 29 real r1 runs, 17 criteria passed on 28 or more runs: the status
logic (A), the item card (B), the catalogue render and filters (C). They weigh
`SATURATED_WEIGHT = 0.25` inside completion. Tier rates stay count-based, so these criteria
still gate a broken submission exactly as before. Every other criterion weighs 1.

## Adversarial probes (20%)

Probes are intentionally absent from the fixture spec. They exercise realistic mistakes that
can superficially satisfy a product test: leaking the staff key, stale state after mutation,
read/write races in the API and in the actions, literal search handling, validation after I/O,
parsing before the staff check, an unguarded JSON parse, a form that stays stuck after a
rejected action, N+1 reads, duplicated detail reads, and axe-core name/label/ARIA violations
(pinned `axe-core`, colour contrast excluded).

Each probe carries the tier of the prerequisite it depends on, so a locked tier cannot add
adversarial points. Probe definitions and advertised failure modes are in `criteria.ts`.

## Adherence (15%)

The contract classifies each violation:

| Class | Violations | Effect |
|---|---|---|
| hard | symlink, special entry, nested runtime directory, `.git` | record invalid |
| soft | added file, missing file, protected edit, changed export, compiler suppression, test-file limits | graded; costs adherence |

For a soft violation, `run.sh` keeps the original verdict as `contract-violation.json` (bound
into provenance by hash) and, unless the violation lives inside a writable file, grafts the
writable files onto a fresh comparison tree. Added files and protected edits never reach the
grader. Under r1 any violation discarded the whole run (19 build runs).

```text
contract  = max(0, 1 − 0.5 × number of soft classes)
closeout  = pass rate of M.plan-complete, M.metadata-valid, M.closeout
adherence = (0.5 × contract + 0.5 × closeout) × min(1, completion / 0.6)
```

The M.* criteria feed adherence only, never completion. The gate on completion keeps an
untouched candidate from banking points: it breaks no rule, but it did no work.

## Code quality (10%)

`harness/doctor.ts` invokes the lockfile-pinned local `react-doctor` binary with supply-chain
and dead-code scans disabled, and adds the deterministic source signals in
`harness/source-signals.ts` over the track's writable files. It has no network dependency
during a grading run. Quality is a weighted penalty for diagnostics introduced above
`reference/doctor.json`, not the tool's raw health score.

The axis is gated on completion rather than multiplied by it. A missing, malformed, or
nonlocal doctor baseline invalidates the score rather than silently changing the ruler.

## Advisory modernization signals

The `ADVISORY` list is reported beside the score but never contributes to its total. An advisory
is retained only when the reference passes it and it has deterministic control coverage.

## Formula

For a valid non-gate-blocked build record:

```text
completion  = Σ(passed × tier_scale × weight) / Σ(weight)   over non-M criteria
adversarial = Σ(passed_probe × tier_scale) / |probes|
adherence   = (0.5 × contract + 0.5 × closeout) × min(1, completion / 0.6)
quality     = min(1, completion / 0.6) × max(0, 1 − doctor_penalty / PENALTY_FULL)
total       = round1(100 × (0.55 × completion + 0.20 × adversarial
                           + 0.15 × adherence + 0.10 × quality))
```

A score record also contains per-tier rates, individual criterion/probe outcomes, the
adherence evidence (`adherence.contract`, `adherence.classes`), doctor diagnostics, and
transcript usage so totals are auditable.

## Repeats and reporting

`batch.sh` runs every repeat as `<id>-r<N>`. The build track repeats 3 times a week
(`REPS_BUILD`); the other tracks repeat once (`REPS_BUGFIX`, `REPS_TESTS`, `REPS_CHANGE`;
`REPS` overrides all). The site publishes, per model and arm, the lower median of the latest
week's valid repeats, the worst repeat, and the count. The Skills effect is one paired value:
the mean over models of `median(Skills) − median(No Skills)` in a shared week, with the count
of models that improve and that get worse. The trend is an EMA over weekly medians; the
4-week range is a range, not a confidence interval.

## Validity and provenance

A numeric result is publishable only when the record has all of:

```text
valid === true
trusted === true
publishable === true
provenance_valid === true
suite_current === true
```

The runner hashes its grading implementation and every suite source, fixture/harness lockfile,
reference overlay (`reference/`, `reference-variant/`, `reference-change/`), model-visible
track file, frozen set, and quality baseline. It also records the protected fixture hash and
candidate tree hash. Changing any of these invalidates an old score; rescore or regrade.

Provenance schema 6 (`harness/provenance-record.ts`, checked by `provenance-check.ts`) binds
the run ID to its executor evidence (image digest, Pi path/hash/version, Arm-B skill-tree
hashes, runtime and CLI argument arrays), plus `fixture_revision`,
`contract_violation_sha256`, an optional `graft` block, and each variant track's set id, set
hash, registry hash, and variant hash. The executor is attested against the Pi binary the run
recorded, so a week graded before a Pi upgrade still rescores. Overlay calibration records an
explicit non-invocation identity; it can validate controls, but it cannot become a ranked
model result.

The collector rejects missing raw reports. The scorer rejects malformed gates/collections,
nonboolean results, missing IDs, orphan IDs, stale provenance, and launch errors in the
browser reports. Invalid records have `total: null`, never a numeric zero.

## Host trust

Some checks measure short state transitions or response flushes. Preflight logs host load,
waits only while `BENCH_WAIT_FOR_IDLE` allows, and never refuses a run. A contended host is
recorded as advisory `host.under_load: true` metadata; it never blocks a run or demotes a
score. Flush-order checks read chunk ordinals, not elapsed time.

## Sensitivity controls

The control manifest defines a minimal anchored mutation for every point-bearing criterion and
probe and for every reported advisory; `CHANGE_CONTROLS` does the same for the change track
against `reference-change/`. A control declares its target IDs, allowed collateral failures,
and the behavior it is meant to break. The control executor starts from the reference overlay,
applies exactly one declared mutation, runs the relevant harness path, and retains raw
reports. A control passes only if its declared raw target IDs fail for the named reason.

## Calibration sequence

Before comparing any model runs:

1. The weekly self-check runs the meta suite (`BENCH_SELFCHECK=logic` on hosts where the
   Podman probes hang).
2. Each track's canary scores 100: the reference (build), the clean set (bugfix), the oracle
   suite (tests), the change reference (change).
3. `reference-variant/`, a second correct implementation that differs in every incidental
   choice, scores 100 on the build track. A criterion it fails grades the reference, not the
   spec.
4. Run the deterministic mutation controls (`verify-controls.ts --all`) and verify every
   declared target fails while the reference remains green.
5. Run an incomplete/empty candidate and explicit typecheck/build gate controls. They must not
   yield rankable totals.

## Bugfix track (`lending_desk_bugfix`)

The bugfix track measures finding and repairing undisclosed defects in a working
application, without regressions. Design reference: `measure/tracks/bugfix_bench/spec.md`.

- The clean tree is `fixture/` plus `reference/` over the nine task files. A deterministic
  variant applies the bugs of one frozen set (`harness/bugfix/sets/*.json`).
- The bug registry (`harness/bugfix/registry.ts`) binds each bug to a class, an optional
  skill rule, anchored replacements, and existing suite detectors.

```text
repair       = Σ(repaired_bug × weight) / Σ(weight), weight 2 for security, 1 otherwise
regression   = tier-scaled weighted pass rate over criteria that are not a seeded
               detector and not declared collateral
robustness   = probe pass rate outside seeded detectors and collateral
adherence    = contract × min(1, repair / 0.6)
quality      = soft-scaled on repair at 0.6, times the doctor penalty
total        = round1(100 × (0.45 × repair + 0.20 × regression + 0.15 × robustness
                            + 0.10 × adherence + 0.10 × quality))
```

Detector and collateral IDs never enter the regression or robustness denominators, so one
defect is never charged twice. Churn (changed lines) is recorded and never scored. An
untouched variant scores repair 0 and a total near 35 by design.

## Tests track (`lending_desk_tests`)

The model writes tests under `tests/` for the finished app (fixture r2 plus `reference/`);
every application file is protected. Design reference: `measure/tracks/tests_bench/spec.md`.

- The suite runs twice against the clean app, once against `reference-variant/`, and once
  against each mutant of the frozen set (`harness/tests-track/sets/m1.json`: 12 mutants from
  the bug registry, the controls, and `tests-track/mutants.ts`). Every app gets a fresh server.
- A test is valid when it passes on both clean runs and on the variant. A test that fails on
  the variant grades incidental markup; it is excluded from kills and lowers validity.
- A mutant is killed when a valid test fails on it.

```text
kill      = Σ(killed × weight) / Σ(weight), weight 2 for security, 1 otherwise
validity  = valid tests / all tests (0 when the suite has no test)
adherence = contract × min(1, kill / 0.6)
quality   = soft-scaled on kill at 0.6, times the doctor penalty over the test files
total     = round1(100 × (0.60 × kill + 0.20 × validity + 0.10 × adherence + 0.10 × quality))
```

The oracle suite (`harness/tests-track/oracle-overlay/`) is the canary: it kills every mutant
and scores 100.

## Change track (`lending_desk_change`)

The model receives the finished app and four change requests (set `c1`): a catalogue status
filter, an API member filter, a 60-day due-date limit in the action and the API, and the
borrower line on the detail page. Design reference: `measure/tracks/change_bench/spec.md`.

- The X.* criteria (`CHANGE_CRITERIA`) grade the requests; they run on this track only.
- The build criteria and probes grade everything that must keep working.

```text
change     = tier-scaled pass rate over the X.* criteria
regression = tier-scaled weighted pass rate over the non-M build criteria
robustness = probe pass rate
adherence  = contract × min(1, change / 0.6)
quality    = soft-scaled on change at 0.6, times the doctor penalty
total      = round1(100 × (0.45 × change + 0.25 × regression + 0.10 × robustness
                          + 0.10 × adherence + 0.10 × quality))
```

An untouched variant scores change 0 and a total near 35. `reference-change/` is the canary
and scores 100.

## Validity (all tracks)

The build-track validity rules apply unchanged to every track: `valid`, `trusted`,
`publishable`, `provenance_valid`, and `suite_current`. The site publishes the variant tracks
from `docs/assets/data/tracks.json` with per-class or per-request rates and the same trust tags.
