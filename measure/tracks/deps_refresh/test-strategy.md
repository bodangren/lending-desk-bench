# Test strategy — deps_refresh

This strategy tells Red, Green, the reviewers, and the orchestrator how the
harness dependency refresh is proved. Spec: `spec.md`. Plan: `plan.md`.
This is a light-lane chore. The change is two files in `harness/`. No
fixture file, source file, or product route changes. The strategy is short on
purpose. Every gate has a command and a falsification condition.

## 1. Scope, risk, and phase classification

The product is a lock-file refresh that clears critical and high advisories
in `harness/`. A wrong change either leaves a vulnerable version in place or
breaks the grading harness. The fixture stays pinned for cohort comparability
(spec D1).

| Risk | Effect | Defense |
|---|---|---|
| A critical or high advisory stays | A known-vulnerable package ships | The Red audit gate, the Green audit gate, and the after audit (task 3.2) |
| A new major breaks the harness | Grading fails on the night run | Task 3.1 suites and the tsc no-new-identity check; defer the major (task 2.1) |
| `@playwright/test` runner drifts | Browser grading breaks | The version check and one named e2e spec (spec D9, task 3.1) |
| The meta exclude list grows to reach green | Tests vanish and the suite lies | Frozen exclude list; scope guard (A7) |
| The fixture hash changes | w36-w39 scores lose comparability | `git diff --name-only` scope guard (FR-5); the protected hash in `candidate-contract.ts` stays |
| A change lands in the night run | A bench reads a half-written tree | Commit outside 02:00-07:00; gates only 22:00-01:30 (D7, FR-6) |
| `npm audit` flaps with the registry | A false red or false green | Dated command output; one rerun settles a flap (R3) |

Phase risk classification:

| Phase | Risk | Reason |
|---|---|---|
| Red — audit gate and base tsc identity set | low | Read only. The phase records a failing audit and a base identity set. It changes no file. |
| Green — the updates | high | This phase carries the supply-chain change. A bad version can reintroduce a vulnerability or break grading. Review B applies. |
| Verify — gates, after audit, residuals, push | medium | The gates detect most faults. Suite flake, an incomplete residual list, and the push carry the remaining risk. |

No phase is critical. The fixture is not deployed and no model code runs.

## 2. Phase base

The orchestrator captures the immutable `phase_base_sha` at this exact point:

1. Commit the strategy and the track-setup documents in `main` in one commit.
2. Make no other commit in `main` before step 3.
3. Run `git rev-parse HEAD` in `main`. That SHA is `phase_base_sha`.
4. Record the SHA in the orchestrator notes. Do not write it into this file.
5. Use it as the scope baseline: `git diff <phase_base_sha>..HEAD`.
6. Do not recapture it after Green or after the push.

This file embeds no SHA. The spec base `7319344` and the spec-review head
`04239eb` predate this strategy commit. Neither is `phase_base_sha`. The
orchestrator runs this check after step 3. It must print `PHASE_BASE=ok`:

```bash
S=$(git log -1 --format=%H -- measure/tracks/deps_refresh/test-strategy.md) && \
git merge-base --is-ancestor "$S" "$PHASE_BASE" && \
git diff --quiet "$PHASE_BASE" -- measure/tracks/deps_refresh/test-strategy.md && \
echo PHASE_BASE=ok
```

## 3. Gate commands

Run every command from the repository root unless the line says `cd harness`.
The wide gates run only 22:00-01:30 through `heavy-run.sh`, one at a time.

- `AUDIT_RED` / `AUDIT_GREEN`:
  `cd harness && npm audit --audit-level=high`. The Red phase records a
  non-zero exit, the counts by level, and the six high advisory names
  (spec EV1): brace-expansion, fast-uri, nanoid, source-map-js, vite, zod.
  The Green phase expects exit 0, or a reason for each remaining critical or
  high advisory in task 2.1. Parse the labeled counts by level.
- `TSC_BASE` (Red, task 1.1): the one bash block of plan task 3.1 with
  `RAW=measure/runs/deps_refresh/tsc-base-raw.txt` and
  `IDS=measure/runs/deps_refresh/tsc-base-ids-7319344.txt`. Expect exit 2,
  210 raw error lines, and 210 identities. Also run
  `sha256sum measure/runs/deps_refresh/tsc-base-ids-7319344.txt` and record
  the hash. The file is an ignored artifact (A13).
- `TSC_AFTER` (Verify, task 3.1): the same block with the default `tsc-after`
  paths. It keeps the tsc exit code, rejects unparsed lines, and ends with
  `comm --check-order -13` of the base file against the after file. The
  command passes only when `comm` prints nothing.
- `UNIT_GATE`:
  `HEAVY_MIN_AVAIL_MB=1500 /home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh -c 'cd harness && npm run test:unit'`
- `META_GATE`:
  `HEAVY_MIN_AVAIL_MB=1500 /home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh -c 'cd harness && npm run test:meta:logic'`
- `BUN_GATE`: `bun test harness/model-guide-tests/review-run.test.ts` through
  the same wrapper.
- `SCOPE_GATE` (Green and Verify): `git status --short` and
  `git diff --name-only <phase_base_sha>..HEAD`. Expect only
  `harness/package.json` and `harness/package-lock.json`. No `fixture/` path.
  No source file. No change to the frozen meta exclude list.
- `RESIDUAL_GATE` (task 3.2): each moderate or low audit row has a matching
  plan row with a reason. The `react-doctor` 0.9.23 bump stays deferred under
  spec D9.
- `PUSH_GATE` (task 3.3): the orchestrator runs
  `/home/daniebo/Desktop/advantage-pr/scripts/jobs/safe-push /home/daniebo/Desktop/lending-desk-bench`
  with `--dry-run` first, then alone, never chained. No role pushes.

## 4. Per-phase gates

Each phase names its targeted Red command, its Green gate, and its closeout
gate. The closeout gate is the evidence that ends the phase.

### Phase 1 — Red: audit gate and base tsc identity set (risk: low)

- **Targeted Red:** `AUDIT_RED` must exit non-zero. `TSC_BASE` must record
  exit 2, 210 lines, 210 identities, and the base identity-file hash.
- **Green gate:** not applicable. No change lands in this phase.
- **Closeout gate:** task 1.1 records the command, the exit code, the counts
  by level, the six high advisory names, the tsc counts, and the SHA-256 of
  the base identity file. The recorded audit command is the one that Green
  must later turn green. Changing the command or its audit level to pass is a
  failure of this phase.
- **Fixtures and mocks:** the pinned base identity file is the only fixture.
  It is an ignored artifact, so its hash is recorded. No mocks. `npm audit`
  reads the live registry.
- **Live-behavior proof:** the dated audit output and the real tsc run over
  `git ls-files 'harness/*.ts'` are the proof. No saved report substitutes
  for them (spec D5).

### Phase 2 — Green: the updates (risk: high)

- **Targeted Red:** re-run `AUDIT_RED` to confirm the phase starts from the
  recorded red condition. The base audit output is the reference.
- **Green gate:** `AUDIT_GREEN` exits 0, or task 2.1 names each remaining
  critical or high advisory with its reason. `SCOPE_GATE` shows only the two
  lock-scope files. Minor and patch versions come first. A major lands only
  when the task 3.1 gates pass with it. `react-doctor` stays at 0.9.2 (D9).
- **Closeout gate:** the Green commit exists. Its timestamp sits outside
  02:00-07:00 (FR-6). The commit diff passes `SCOPE_GATE`. Any update that
  needs a source edit is deferred in task 2.1, and no source edit lands.
- **Fixtures and mocks:** none. Green edits no fixture and adds no test file.
- **Live-behavior proof:** the audit reads the live registry. The lock file
  is the product. A version that passes audit but breaks the suites fails at
  Verify, so Green defers it on the evidence.

### Phase 3 — Verify: gates, after audit, residuals, push (risk: medium)

- **Targeted Red:** `TSC_AFTER` is the intentionally-red aggregate check at
  base. It turns green only when the after identity set is a subset of the
  base set. A synthetic identity added to a copy of the after file must make
  `comm -13` print it and the block exit 1. That probe is the falsification
  of the tsc gate. It runs on a copy, never on the tracked file.
- **Green gate:** `UNIT_GATE`, `META_GATE`, and `BUN_GATE` each exit 0 inside
  `heavy-run.sh`. `TSC_AFTER` passes under its no-new-identity rule. When
  `@playwright/test` moved in Green, run `./node_modules/.bin/playwright
  --version` from `harness/` and one named e2e spec
  (`tests/e2e/probes.spec.ts`) through the wrapper. Read the labeled Vitest
  and version lines, never a bare digit (A3).
- **Closeout gate:** `RESIDUAL_GATE` passes. `SCOPE_GATE` still shows no
  fixture or source change. Task 3.3 records the Green commit SHA, its
  timestamp outside the night window, and the push date after `PUSH_GATE`.
  A `safe-push` exit 2, 3, or 4 stops the track and reports to the PM.
- **Fixtures and mocks:** the base identity file is the fixture for
  `TSC_AFTER`. Verify its SHA-256 against the Red record before the compare.
  Playwright uses system Chrome (`channel: "chrome"`). No browser download
  runs. No mocks. The suites and the audit are live.
- **Live-behavior proof:** the three wrapped suites, the real tsc run, the
  dated after audit, and the conditional Playwright version and e2e spec are
  live behavior. The identity-file subset, the scope diff, the residual
  list, and the commit timestamp are artifact checks.

### Intentionally-red aggregate handling

The full-tree tsc command exits 2 with 210 base diagnostics. It is expected
red at the base. The gate never lowers the bar to reach exit 0. It compares
identity sets instead, so a fixed diagnostic reduces the count and a new
diagnostic fails the gate. The Red audit gate stays red until Green fixes the
advisories. No role edits the audit level, the diagnostic filter, or the
exclude list to hide a failure. A gate that is not done by 01:30 stops and
resumes the next evening (D7).

### Architecture guardrails and changed-contract risks

- Green touches only `harness/package.json` and `harness/package-lock.json`.
  No source edit. No new dependency or script (NFR-4).
- `harness/` has no tsconfig, lint script, or build script. The meta suite
  stands in for the build (D6). The tsc flags in the plan are the contract.
- The frozen `test:meta:logic` exclude list in `harness/package.json` is a
  changed-contract risk. It must not grow to reach green (A7).
- `harness/doctor.ts` hard-codes `DOCTOR_VERSION = "0.9.2"`, and
  `harness/source-signals.ts` assumes its blind spots. Bumping react-doctor
  to 0.9.23 changes Axis 3 scores mid-cohort. The bump defers (D9).
- `harness/playwright.config.ts` uses system Chrome. Runner drift in
  `@playwright/test` can break grading. The version check plus one e2e spec
  cover that contract (D9).
- The fixture hash in `candidate-contract.ts` and `SCORING.md` stays pinned.

## 5. Review gate assignments

The lane is light. One maker. The gates still run. Reviews are bounded to the
lock-file change.

| Role | Applies | Focus |
|---|---|---|
| Review A (correctness) | yes, bounded | Check that each critical and high advisory is fixed or named with a reason. Check that the tsc compare uses the correct base file and that `comm` failures fail closed. Check that the residual list matches the after audit, that `SCOPE_GATE` holds, and that no source or fixture file changed. No feature correctness review. |
| Review B (security) | yes | Supply-chain and advisory handling. Confirm 0 critical and 0 high in `harness/`, or a reason for each. Confirm the lock file adds no unexpected registry source, no lifecycle script, and no new tool (NFR-4). Confirm the six Red high advisories no longer appear at a vulnerable version. Confirm Playwright uses system Chrome, so no browser download runs. Keep every fixture advisory pinned with its cohort reason (D1). |
| Review C (API and UX) | no | The track changes no product route, page, endpoint, or input. It edits two harness package files only. There is no API contract or user flow to review. |
| Adversarial testing | yes, bounded | A lock-file bump has a narrow adversarial surface. Test a known-vulnerable version range: pick a fixed high advisory from EV1 and confirm its resolved version in `package-lock.json` is outside the vulnerable range. Test the gates: add a synthetic new identity to a copy of the after file and confirm `TSC_AFTER` fails; remove a residual reason and confirm `RESIDUAL_GATE` fails. These are mutation probes on copies. No full adversarial suite and no model runs. |
| UX browser review | no | No user-facing change. No page, layout, or text that a user sees. The conditional e2e spec is a smoke gate for the grader, not a UX review. |
| Phase acceptance | yes, per phase | Red closes on task 1.1 evidence. Green closes on the clean audit, the two-file scope, and the commit window. Verify closes on task 3.1 gates, the residual list, and the safe-push record. Acceptance uses AC-1 to AC-7 of the spec. |

Phase acceptance does not treat the base tsc exit 2 as a failure. It treats a
new identity, an unlisted residual advisory, a fixture change, or a commit in
the night window as a failure.

## 6. Anti-pattern coverage

Each item names the anti-pattern, the defense, and the condition that
falsifies the test. Retired or inapplicable patterns are listed at the end.

### Red phase

- **A3.** Defense: parse the labeled audit counts by level and the labeled
  tsc counts (exit, raw lines, identities). Falsifies: a gate reads a digit
  from a date or a version string.
- **A4.** Defense: the base gate fails on an empty identity file, on exit
  other than 2 with zero lines, and on an audit that shows zero high at Red.
  Falsifies: an empty or zero-high input passes the Red phase.
- **A5.** Defense: task 1.1 holds the quoted command output and its date.
  Falsifies: a recorded claim has no command output.
- **A13.** Defense: record the SHA-256 of the ignored base identity file.
  Falsifies: the base file changes after the hash is recorded.
- **A11.** Defense: the tsc run reads `git ls-files`, not an environment
  value. Falsifies: the base identity set changes under `BENCH_TRACK=change`.

### Green phase

- **A4.** Defense: the audit turns green through version changes, not by
  changing `AUDIT_GREEN` to a weaker level. Falsifies: the recorded Green
  command differs from `AUDIT_RED`.
- **A7.** Defense: `SCOPE_GATE` forbids growth of the frozen meta exclude
  list. Falsifies: the diff adds an exclusion or edits a test file.
- **A5.** Defense: each deferred major and the react-doctor deferral carries
  a reason in task 2.1, and `[x]` carries a SHA. Falsifies: a bump has no
  reason or no evidence anchor.
- **A6.** Defense: no registry "complete" claim before the gates and push.
  Falsifies: `measure/tracks.md` says complete at Green.
- **A3.** Defense: parse the Green audit counts as labeled integers.
  Falsifies: a digit grep decides the verdict.

### Verify phase

- **A3.** Defense: read the labeled Vitest `Test Files` and `Tests` lines and
  the audit counts. Falsifies: a bare digit sets a gate verdict.
- **A4.** Defense: the tsc block checks a non-empty base and an existing
  after file; any filtered suite run that matches zero cases fails. Falsifies:
  an empty input passes a gate.
- **A5.** Defense: each gate records the command, the labeled line, the
  timestamp, and the report path; `[x]` carries a SHA. Falsifies: a gate is
  marked pass with no output.
- **A11.** Defense: run `META_GATE` under `env -u BENCH_TRACK`, or spot check
  with `BENCH_TRACK=change`; compare the verdict. Falsifies: a leaked
  environment value changes the result.
- **A12.** Defense: keep exactly one `[~]` task while any `[b]` task remains,
  and run the status check. Falsifies: the status command lists a closeout
  candidate while a `[b]` task is open.
- **A13.** Defense: verify the base identity-file SHA-256 before the subset
  compare and confirm the fixture pin hash is unchanged. Falsifies: an
  ignored artifact changes without detection.
- **A14.** Defense: the `measure/tracks.md` note matches the first open plan
  task after each phase. Falsifies: the note still names test strategy as
  next after this strategy is committed.

### Not applicable

- **A1, A8:** retired and reserved.
- **A2:** no publish gate. The push goes through safe-push with a dry run.
- **A9:** no test references an archived track path.
- **A10:** no generated facts or pre-commit hook in scope.

## 7. Evidence to record

- Task 1.1: the Red audit output with counts and names, the tsc exit code and
  counts, and the base identity-file SHA-256.
- Task 2.1: the Green audit output, the version decisions, each deferred
  update with its reason, and the Green commit SHA and timestamp.
- Task 3.1: each gate command, its labeled output, its timestamp, and its
  report path under `measure/runs/deps_refresh/`.
- Task 3.2: the after audit counts and one plan row for each moderate or low
  advisory with a reason.
- Task 3.3: the Green commit SHA, the commit timestamp, and the safe-push
  dry-run and push results.

The strategy role changed no product file. It ran no install, no suite, and
no push. All probe ideas in this file are falsification conditions for the
role that runs each gate, not results claimed here.
