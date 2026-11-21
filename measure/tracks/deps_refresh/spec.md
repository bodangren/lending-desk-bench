# Dependency refresh: update the harness packages

Spec format: classic FR list. Track type: chore. Base commit: `7319344`.

## Summary

The track updates `harness/package.json` and `harness/package-lock.json`.
It fixes every critical and high audit advisory in `harness/`. It lists
each remaining moderate or low advisory with its reason. It touches no
fixture file. It lands no lock-file change during a night bench run.

## Owner requirement

PM P2 assignment, 2026-11-21. Daniel said on 2026-11-21 07:52:

> We do not need to migrate to a new provider yet but I want to make sure that our packages are up to date because these past 2 weeks have been hundreds of vulnerabilities

## Evidence

The audit ran before this track, on 2026-11-21 at about 08:0x, with
`npm audit` in each folder.

- **EV1. harness/: 0 critical, 6 high, 7 moderate, 0 low.**
  - High: brace-expansion, fast-uri, nanoid, source-map-js, vite, zod.
    All are fixable with no major bump.
  - Moderate: @eslint/config-array, eslint, @vitest/mocker, vitest
    (fix: vitest 4.1.12), deslop-js, minimatch, react-doctor
    (fix: react-doctor 0.9.23).
- **EV2. fixture/: 1 critical, 4 high, 2 moderate.**
  - Critical: next (fix: 16.4.6).
  - High: postcss, sharp (via next), source-map-js, vite.
  - Moderate: vitest, @vitest/mocker.
- **EV3. The fixture pin.** `fixture/` is the "Lending Desk" app that the
  benchmark gives to the models under test. Its `AGENTS.md` says
  "No new dependencies". The harness checks a protected hash of the
  fixture (`harness/candidate-contract.ts`, `SCORING.md`). `tech-debt.md`
  records that the fixture hash stays pinned for the w36-w39 cohort.
  A bump breaks score comparability. The fixture runs only on the local
  machine and is never deployed.

## Definitions

- **Harness scope.** The files `harness/package.json` and
  `harness/package-lock.json`. No other file changes in Green.
- **Done-when.** `npm audit` in `harness/` shows 0 critical and 0 high,
  or each leftover names its reason in the plan.
- **Night run.** The bench window 02:00-06:00 that uses `harness/`.
  No lock-file change lands inside it.
- **Heavy run.** A job that starts a browser or runs a full suite. It
  runs only through
  `/home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh`.
  Full suites run only 22:00-07:00, one file or suite at a time with
  `--maxWorkers=1`.

## Design decisions

1. **D1. fixture/ stays pinned.** The PM decided on 2026-11-21: no
   fixture bump. Reason: the fixture is the benchmark input. Its hash
   is protected. A bump breaks comparability of the w36-w39 cohort
   scores. The fixture never deploys. A fixture revision is a separate
   decision and starts a new cohort. This spec names each fixture
   advisory below with this reason, per the assignment.
   - next (critical, fix 16.4.6): pinned, cohort comparability.
   - postcss (high): pinned, cohort comparability.
   - sharp via next (high): pinned, cohort comparability.
   - source-map-js (high): pinned, cohort comparability.
   - vite (high): pinned, cohort comparability.
   - vitest (moderate): pinned, cohort comparability.
   - @vitest/mocker (moderate): pinned, cohort comparability.
2. **D2. Scope is harness only.** Green touches `harness/package.json`
   and `harness/package-lock.json` only.
3. **D3. Update policy.** Take every harness package to the latest
   version that works. Minor and patch first. A new major lands only
   when the gates pass. Else the plan defers it with its reason.
4. **D4. Advisory policy.** Fix all critical and high advisories in
   `harness/`. List each remaining moderate or low advisory with its
   reason: no upstream fix, or a breaking major deferred under D3.
5. **D5. Red form.** The Red evidence is the recorded gate command
   `npm audit --audit-level=high` in `harness/`, failing while any
   critical or high advisory remains. No checked-in test asserts this.
   Reason: `npm audit` reads the live registry, so a committed test
   cannot assert it offline without network. A saved-report assertion
   would test a stale file, not the tree. The recorded command output
   is the falsifiable form.
6. **D6. Gates.** `harness/` has no lint script, no type-check script,
   no build script, and no tsconfig. The spec names the stand-ins:
   - Lint: none exists. The plan records that `npm run` offers no
     lint entry.
   - Type-check: `tsc --noEmit` on the touched files only, via the
     local binary (`./node_modules/.bin/tsc --noEmit --skipLibCheck`
     with explicit file paths).
   - Build: none exists. The harness is TypeScript source run with
     `tsx`. The meta suite through `heavy-run.sh` stands in for it.
   - Unit tests: `npm run test:unit` (`vitest run tests/unit`).
   - Meta suite: `npm run test:meta:logic` through `heavy-run.sh`.
   - Model-guide gate: `bun test
     harness/model-guide-tests/review-run.test.ts`, because that file
     runs with bun.
7. **D7. Night rule.** The lock-file commit lands outside 02:00-06:00.
   The plan records the lock check and the time of the commit.
8. **D8. Dates.** Critical and high done by 2026-11-23. The rest done
   by 2026-11-25.

## Functional requirements

### FR-1 — The harness audit is clean

- `npm audit` in `harness/` shows 0 critical and 0 high, or each
  leftover critical or high names its reason in the plan.
- **Check.** `cd harness && npm audit --audit-level=high` exits 0, or
  the plan names each remaining item with its reason.

### FR-2 — Only the harness scope changes

- Green touches `harness/package.json` and `harness/package-lock.json`
  only. No fixture file changes. No source file changes except what a
  major bump forces, and then the plan names each file.
- **Check.** `git status --short` after Green shows changes only in
  the two lock-scope files, plus any plan-named source file.

### FR-3 — The gates pass through heavy-run.sh

- The unit suite, the meta logic suite, and the bun review-run test
  pass. Each full-suite command runs through `heavy-run.sh`, only
  22:00-07:00, one suite at a time with `--maxWorkers=1`.
- **Check.** Each command below exits 0 inside the wrapper:
  - `HEAVY_MIN_AVAIL_MB=1500 .../heavy-run.sh -c 'cd harness && npm run test:unit'`
  - `HEAVY_MIN_AVAIL_MB=1500 .../heavy-run.sh -c 'cd harness && npm run test:meta:logic'`
  - `bun test harness/model-guide-tests/review-run.test.ts` through
    the wrapper.
  - `tsc --noEmit` on each touched source file.

### FR-4 — The residual list is complete

- The plan lists each remaining moderate or low advisory with its
  reason: no upstream fix, or a deferred breaking major.
- **Check.** Every `npm audit` row of level moderate or low has a
  matching plan row with a reason.

### FR-5 — The fixture stays untouched

- No commit of this track changes `fixture/`. The fixture advisories
  of D1 keep their pin reason.
- **Check.** `git diff --name-only` of each track commit shows no
  `fixture/` path.

### FR-6 — The work lands outside the night run

- The lock-file commit lands outside 02:00-07:00 local time. The plan
  records the commit time.
- **Check.** The commit timestamp sits outside the night window.

## Non-functional requirements

- **NFR-1 No fixture churn.** Score comparability of the cohort holds.
- **NFR-2 No deploy.** The fixture never deploys. The harness change
  needs no deploy.
- **NFR-3 The machine stays usable.** Full suites run only in the
  night window through `heavy-run.sh`.
- **NFR-4 No new tool.** The track adds no dependency and no script.

## Acceptance criteria

1. **AC-1** `npm audit --audit-level=high` exits 0 in `harness/`, or
   each leftover names its reason (FR-1).
2. **AC-2** Green changes only the two lock-scope files, plus any
   plan-named source file (FR-2).
3. **AC-3** All gate commands of FR-3 exit 0 through `heavy-run.sh`.
4. **AC-4** Each residual advisory has its reason (FR-4).
5. **AC-5** No track commit touches `fixture/` (FR-5).
6. **AC-6** The lock-file commit timestamp sits outside 02:00-07:00
   (FR-6).
7. **AC-7** The work is pushed by 2026-11-25.

## Out of scope

- Any change to `fixture/`, `reference*/`, or scoring.
- A provider migration.
- A new major that fails the gates (it defers with its reason).
- A fixture revision (a separate decision, a new cohort).

## Risks

- **R1 A major breaks the harness.** The gates catch it. The plan
  defers the major with its reason.
- **R2 A night run reads a half-written tree.** The install and the
  commit run outside 02:00-06:00 (D7, FR-6).
- **R3 `npm audit` flaps with the registry.** The plan records the
  command output and its date. A rerun settles a flap.
- **R4 The meta suite is slow.** It runs once at the end, through
  `heavy-run.sh`, inside the night window.
