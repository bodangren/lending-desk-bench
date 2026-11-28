# Test strategy — bench_v2 phase 7 (reopened 7.1, plus 7.2 / 7.4 / 7.5)

Revision: 2026-10-11, strategy agent re-record at role start and role end
(both identical):
- HEAD: `9403f5c0f3a72bc5a18225822b0092771d5eb859`
- tracked_diff_hash: `de63040a667d15b3c9444ab0e39e2c72e81f21b3`
- status_hash: `409d90ce2697ff7b764f02ed92cd903e3d2712a6`

Role end re-record: 2026-10-11T08:21:26+08:00, values unchanged. The strategy
file itself lives inside the untracked `measure/tracks/bench_v2/` directory,
so it does not alter the porcelain hash.

The whole bench_v2 implementation is uncommitted in the working tree. Every gate
command below runs against the working tree, never against HEAD.

## 1. Red diagnosis summary (evidence, not hypothesis)

All 15 meta failures share one trigger: a non-build `BENCH_TRACK` in the test
environment. Experiments run by this role on 2026-10-11 (quiet host):

| Environment | Result |
|---|---|
| `env -u BENCH_TRACK`, 6 of the 7 failing files | all pass (45 tests) |
| `BENCH_TRACK=build`, 5 fast failing files | all pass (34 tests) |
| `BENCH_TRACK=change`, same 5 files | 11 of the 15 failures reproduce exactly |

Mechanism:

1. `harness/batch.sh` line 42 runs `export BENCH_TRACK="$TRACK"` before the
   self-check block. The self-check (`npm run test:meta:logic`) inherits it.
2. `harness/score.ts` line 133 resolves the track env-first
   (`input.track ?? process.env.BENCH_TRACK`, default `build`). For a non-build
   track it requires a variant tree (`runs/<id>/variant`) and grades against it.
3. The synthetic fixtures write provenance with `track: "build"` and create no
   variant tree. Under a leaked non-build track the pipeline fails closed:
   missing variant root, contract invalid, score/provenance track mismatch.
4. The fail-closed attestation rejected the records **correctly**. The defects
   are the leak and the non-hermetic tests, not the attestation.

Cron evidence: `reports/weekly-cron-2026w39.log` and `-2026w41.log` show the
self-check failing on all four track batches. The bugfix, tests, and change
batch failures are explained by this leak (each exports its own non-build
`BENCH_TRACK`). The build batch failure (w41, 01:00) is **not** explained by
it; see section 3.

`BENCH_IGNORE_LOAD` is a legacy no-op (`preflight.sh` line 18) and is excluded
as a cause.

## 2. Classification of the 15 failures

Categories: (a) stale fixture needing schema-6 migration, (b) implementation
over-rejects valid records, (c) spec-level policy question.

**None of the 15 is (a), (b), or (c).** `tests/meta/schema4-fixtures.ts` already
emits `schema: 6` provenance (line 105) despite its stale file name. The
implementation rejects only under an environment/provenance contradiction,
which is the designed fail-closed behavior.

All 15 are class **E — environment leak**, split into two defects:

- **E1 (harness orchestration defect):** `batch.sh` exports `BENCH_TRACK` into
  the self-check environment. This is the production defect that broke the
  w39 and w41 weekly crons. `batch.sh` is not in the runner or suite hash
  (`provenance.ts currentHashes()`), so the E1 fix does not perturb hashes.
- **E2 (test hermeticity defect):** the meta tests build score records without
  pinning `BENCH_TRACK`. `score-helpers.ts applyEnv` and the `spawnSync`
  env merges (`...process.env`) pass a leaked value through. The suite outcome
  must not depend on the caller's environment. E2 fixes touch
  `harness/tests/**`, which **is** in `suite_sha256`; see the hash-freeze rule
  in section 6.

| # | File | Test | Class | Verified |
|---|---|---|---|---|
| 1 | score-attestation | complete schema-3 fixture, matching run/provenance/results | E1+E2 | yes |
| 2 | score-attestation | genuine gate-failed score as GATE-BLOCKED evidence | E1+E2 | yes |
| 3 | score-attestation | under-load agent score trusted and rankable | E1+E2 | yes |
| 4–6 | score-attestation | host load advisory (empty / under-load / non-boolean) | E1+E2 | yes |
| 7 | publication-freshness | quiet-host overlay calibration score valid, nonpublishable | E1+E2 | yes |
| 8 | publication-freshness | gate-blocked score nonpublishable on quiet host | E1+E2 | yes |
| 9 | executor-provenance | score rejects stale/incomplete/mismatched bindings | E1+E2 | yes |
| 10 | executor-provenance | freshness recomputes and rejects the same | E1+E2 | yes |
| 11 | executor-attestation | trusted score goes stale on executor cohort drift | E1+E2 | yes |
| 12 | grade-exit | exits nonzero on an invalid score record | E1+E2 | yes (spawned `grade.sh` inherits `...process.env`) |
| 13 | grade-exit | gate-blocked record stays nonpublishable/nonrankable | E1+E2 | yes (same) |
| 14 | runner-safety | standalone grade rejects protected mutation first | E1+E2 | yes (same) |
| 15 | provenance-validation | invalidates every mismatched provenance binding | E1+E2 | yes |

Policy note (not a blocker): `score.ts` resolves track env-first while
`score-freshness.ts` and `score-attestation.ts` resolve it record-first
(provenance). Env-first is the grading-path design (`run.sh`/`grade.sh` set
`BENCH_TRACK` per run). This strategy keeps it. Do not "fix" the asymmetry by
changing score semantics; that is a (c)-class owner question and is out of
scope for the unblock.

## 3. Open diagnosis item: the w41 01:00 build-batch failure

The build batch ran the self-check with `BENCH_TRACK=build`, which passes in
this role's experiments. Its failure is unexplained. Root-cause candidates:
host-load flake at 01:00 (several tests carry 60–180 s timeouts and spawn
`grade.sh`), or a full-suite interaction not visible in subset runs.

Resolution step (Red, before any fix): run the full suite under the exact cron
build-batch environment and record the result here:

```
cd harness && BENCH_TRACK=build BENCH_IGNORE_LOAD=1 BENCH_WAIT_FOR_IDLE=0 \
  BENCH_SELFCHECK=logic WEEK=2026w41 ARMS="a b" npm run test:meta:logic
```

- If it passes: treat the 01:00 failure as load flake. Defense is the
  stability gate in section 4 (two consecutive full passes), not code change.
- If it fails: classify the failing tests per section 2 and extend the fix
  surface before Green. Do not guess.

Result (2026-10-11, run by this role): **PASS.** Command exactly as above,
started 08:12:40 +08:00, exit 0, duration 492 s: 24 test files passed,
163/163 tests passed. Log: `/tmp/opencode/meta-suite-cron-build-env.log`.

Decision: the w41 01:00 build-batch failure is **not reproducible** from the
environment or the working tree. It is classified as a host-load flake at
01:00 (several tests spawn `grade.sh` under 60–180 s budgets on a 4-CPU
host). No additional fix surface. Defense: the stability gate in section 4
(two consecutive full passes) plus the E1/E2 fixes, which make the suite
outcome independent of the caller's environment. The w39 build-batch failure
predates the current tree state and is out of scope for Red diagnosis.

## 4. Phase 7.1R (reopened): meta suite green

Risk: **medium**. Test and `batch.sh` edits only, but the suite-hash change
couples into 7.4, and a wrong fix (weakened assertions) would defeat the
self-check that guards the whole bench.

### Red commands (targeted)

```
# R1 — acceptance command (also the Green gate):
cd /home/daniebo/Desktop/lending-desk-bench/harness && npm run test:meta:logic

# R2 — leak reproduction; must fail before the fix and pass after:
cd /home/daniebo/Desktop/lending-desk-bench/harness && BENCH_TRACK=change npm run test:meta:logic

# R3 — fast iteration subset (seconds, covers 5 of the 7 files):
cd /home/daniebo/Desktop/lending-desk-bench/harness && BENCH_TRACK=change npm run test:meta:score \
  && BENCH_TRACK=change BENCH_META=1 npx vitest run \
       tests/meta/executor-attestation.test.ts tests/meta/runner-safety.test.ts --maxWorkers=1
```

Red state at strategy time: R2 fails with 15 failures (the section 2 list).
R1 passes in a scrubbed shell; that is expected and does not close the task —
the acceptance rule (section 8) requires R2 green plus the guard test.

### Green gate

1. R1 full pass (163/163, or more if a guard test is added).
2. R2 full pass. Spot-check `BENCH_TRACK=bugfix` once (same variant-tree path).
3. New guard test: `batch.sh` runs the self-check with a track-neutral
   environment (artifact test on the script text) and one live hermeticity
   test that scores a fixture with a poisoned `BENCH_TRACK` and expects
   build-track results.
4. Diff review: no assertion, expectation, fixture payload, or exclude-list
   entry weakened or deleted. Only environment construction may change in the
   7 files, plus `batch.sh`, plus additive guard tests.

### Closeout gate

- Two consecutive full R1 passes on this host (flake defense, section 3).
- R2 pass captured in the same evidence block.
- Evidence (command, timestamp, pass counts) attached to the plan handoff;
  only the acceptance role re-checks the 7.1 checkbox.

### Fix surface

Allowed: `harness/batch.sh`; `harness/tests/meta/score-helpers.ts`;
`harness/tests/meta/schema4-fixtures.ts`; environment construction in the 7
failing files; one new guard test file.

Frozen (escalate to owner if Green believes a change is needed): `score.ts`,
`score-freshness.ts`, `score-attestation.ts`, `provenance*.ts`,
`candidate-contract.ts`, `track-scoring.ts`, `track-bindings.ts`, and the
`test:meta:logic` exclude list in `harness/package.json`.

### Fixtures, mocks, live behavior

- Existing synthetic fixtures (`schema4-fixtures.ts`) stay; they are valid
  schema-6 producers. No fixture migration is needed or permitted.
- Live-behavior proof required: the adversarial-env full-suite runs (R2,
  bugfix spot check). An artifact-only guard test is not sufficient evidence.
- No mocks may replace the live `score.ts` / `score-freshness.ts` pipeline in
  the affected tests.

### Guardrails and changed-contract risks

- The self-check is fail-closed by design (spec FR-4). The fix must not add a
  bypass, a skip flag, or a weaker assertion path.
- Score record schema 3 and provenance schema 6 shapes are consumed by
  `summarize.sh`, `rescore-doctor.sh`, `regrade-run.sh`, and the export. Their
  shapes must not change in this phase.
- Any edit under `harness/tests/**` changes `suite_sha256`. That is accepted
  and intended, but it means 7.4 must run after these edits are final
  (plan execution note).

### Anti-pattern coverage (catalog: starter A1–A10; project registry missing, section 14)

| Anti-pattern | Defense in 7.1R |
|---|---|
| A5 false claim vs test reality (the reopen cause) | Acceptance requires captured command output with timestamps; the checkbox moves only on verified evidence |
| A6 registry-note overstatement | `metadata.json` note "Meta logic suite: 163 of 163 pass" stays stale until re-earned; tracks.md keeps `in-progress` |
| A4 vacuous-pass | Gate parses the vitest summary: `Tests <n> passed` with n ≥ 163 and `0 failed`; an empty or aborted run fails the gate |
| A3 digit-only counts | Pass counts come from the labeled vitest summary line and the JSON report, never a bare digit grep |
| A7 over-broad filter | The `test:meta:logic` exclude list is frozen; a guard diff fails if it grows |
| A11 candidate (new, section 14) inherited-environment fragility | R2 adversarial-env run is the standing guard test |

## 5. Phase 7.2: verify-controls and verify-bugs

Risk: **medium**. Each control costs one graded run (about 10 min on this
host). A control with undeclared collateral invalidates the check it guards.

### Red commands (targeted)

```
cd /home/daniebo/Desktop/lending-desk-bench/harness && ./node_modules/.bin/tsx verify-controls.ts \
  --id sensitivity-E.labels --id sensitivity-E.error-announced \
  --id sensitivity-P.auth-before-parse --id sensitivity-P.malformed-json \
  --id sensitivity-P.action-race --id sensitivity-P.retry-after-error \
  --id sensitivity-P.axe-clean
cd /home/daniebo/Desktop/lending-desk-bench/harness && ./node_modules/.bin/tsx verify-bugs.ts --all
```

Red condition: any new control that does not fail its target, or fails
anything outside its declared collateral; any bug detector that does not fail
its bug.

### Green gate

Every one of the 7 new r2 controls reports `sensitivity_passed: true` and
`calibration_passed: true` with only declared collateral. `verify-bugs --all`
reports every detector failing its bug and nothing else.

### Closeout gate

Control and bug reports archived under `reports/`, summarized in the plan
handoff with labeled counts (A3). Run sequentially in the background; finish
before the Sunday 01:00 cron.

### Fixtures / live behavior

Live graded runs only (the controls are the fixture). No meta-test substitute.
The meta tests `verify-controls-integrity` and `control-calibration-status`
are artifact guards and already pass; they do not replace the live runs.

### Anti-pattern coverage

A4 (a control run that graded nothing must fail the gate — require the
labeled per-control verdict lines), A3 (collateral counts parsed from labeled
report fields), A5 (plan claims cite archived reports).

## 6. Phase 7.4: historical regrade

Risk: **high**. Bulk mutation of historical run artifacts, multi-hour runtime
on a 4-CPU host, and a hard coupling to hash finality.

### Precondition (hash freeze)

All edits under `harness/tests/**` and every runner-hashed file
(`provenance.ts currentHashes()` list) are final. 7.1R and 7.2 are complete.
Record `tsx provenance.ts --shell` before starting; the same values must hold
at the end. `batch.sh` is not hashed, so the E1 fix does not affect this.

### Red commands (targeted)

```
# Single-run canary first (pick one w37 build agent run):
cd /home/daniebo/Desktop/lending-desk-bench && harness/regrade-run.sh <run-id>
# Then the full set, in the background, one run at a time:
cd /home/daniebo/Desktop/lending-desk-bench && WEEKS="2026w37 2026w38 2026w39" harness/regrade-all.sh
```

Red condition: the canary regrade produces an invalid or inconsistent record,
loses `artifacts/prev-<stamp>/`, or mis-resolves the recorded executor
(spec FR-12).

### Green gate

- Canary run: new schema-6 provenance with a `graft` block, valid score or a
  stated invalid reason, previous artifacts preserved.
- Full pass: every historical agent run of the target weeks is regraded or
  stays invalid with a stated reason (spec FR-10, acceptance criterion).
- Zero unexplained skips. Runs with no agent output stay invalid by design.

### Closeout gate

Parse the regrade-all log for the labeled `ok/fail/skip` summary (A3):
`fail = 0`, and `ok + skip` equals the enumerated run set (A4: an empty set
fails the gate). `summarize.sh` classifies the regraded runs without forged
trust. Finish before the Sunday cron; the cron grades from this tree.

### Fixtures / live behavior

Live regrades of real historical runs only. Executor resolution uses each
run's own recorded Pi path and hash (FR-12); ambient executor values are
forbidden for regrades.

### Anti-pattern coverage

A4 (0-runs-regraded is a failure), A3 (labeled ok/fail/skip counts), A10
(scores are recomputed from persisted results and live hashes; a stale
`score.json` is never trusted — the attestation enforces this, the gate
verifies the enforcement by regrading one record with a hand-staled
provenance and expecting STALE/INVALID), A5 (plan claims cite the log).

## 7. Phase 7.5: export

Risk: **low**. Read-only over run artifacts; writes generated site data only.

### Red command

```
cd /home/daniebo/Desktop/lending-desk-bench/harness && \
  python3 export-site-data.py && python3 generate-model-pages.py
```

Red condition: export fails, drops the regraded cohort, or emits repeat
statistics that disagree with the regraded records.

### Green gate

Export completes. Site data shows repeat grouping (median, worst, count), the
paired Skills delta, `fixture_revision` cohort labels, and the four tracks
(spec FR-11). Rows reflect the 7.4 regrade.

### Closeout gate

Reproducibility: two consecutive exports are byte-identical (A10 guard).
`docs/` changes are reviewed and committed through the normal publish path.

### Anti-pattern coverage

A10 (regenerate before diff; byte-identical repeat), A3 (row counts labeled
by week and track), A5/A6 (no "exported" claim before the diff is reviewed).

## 8. Acceptance rule for reopened 7.1

1. Full `npm run test:meta:logic` passes on this host (twice consecutively).
2. `BENCH_TRACK=change npm run test:meta:logic` also passes (hermeticity).
3. No test skipped, deleted, or weakened. The exclude list is unchanged.
4. Test changes are limited to environment pinning and additive guard tests;
   each changed file carries a stated schema-6/hermeticity justification in
   the Green handoff.
5. The fail-closed design is intact: every negative test in section 2's files
   still rejects its mutation cases.
6. `batch.sh` runs the self-check track-neutral, proven by the guard test and
   by inspection of the invocation line.

## 9. Commit partition rule (Green, owner-approved "commit when green")

Commits contain bench_v2 deliverables only, in reviewable increments. Each
increment leaves `npm run test:meta:logic` green.

bench_v2 set: `harness/{batch.sh,candidate-contract.ts,cron-weekly.sh,
doctor.ts,executor-attestation.ts,grade.sh,package*.json,playwright.config.ts,
preflight.sh,provenance.ts,provenance-check.ts,provenance-record.ts,recost.sh,
regrade.sh,regrade-run.sh,regrade-all.sh,rescore-doctor.sh,revisions.ts,
run.sh,score*.ts,source-signals.ts,summarize.sh,track-bindings.ts,
track-scoring.ts,verify-controls.ts,vitest.config.ts,weekly.sh,
browser-check.ts,export-site-data.py,generate-model-pages.py}`;
`harness/tests/**` except the sibling files below; `fixture/{AGENTS.md,
package*.json,measure/tracks/lending_desk/spec.md,app/api/bench-state/}`;
`reference/app/items/[id]/checkout-form.tsx`; `reference-variant/`;
`README.md`; `SCORING.md`; `measure/index.md`; `measure/tracks.md`;
`measure/tracks/bench_v2/**`.

Sibling closeouts (never in a bench_v2 commit):
- bugfix_bench: `harness/bugfix/**`, `harness/verify-bugs.ts`,
  `harness/tests/meta/bugfix-*.test.ts`
- tests_bench: `harness/tests-track/**`
- change_bench: `harness/change/**`, `reference-change/**`,
  `harness/tests/api/change.test.ts`, `harness/tests/e2e/change.spec.ts`

Never commit: `.opencode/`, `harness/__pycache__/`, `runs/`, `reports/`,
`harness/meta-selfcheck.log`, `harness/results.json`.

Escalate to the orchestrator, do not sweep: `harness/cleanup.sh` (untracked
infrastructure, predates this closeout), `harness/go-pricing.json` (modified;
catalog refresh, ownership unclear), `harness/regrade-w38-inplace.sh` and
`harness/rerun-deepseek-v41-w38.sh` (one-off scratch scripts; recommend
deletion or an owner decision).

## 10. Intentionally-red aggregate-suite handling

- Many meta tests are negative tests: they expect INVALID/STALE rejections
  (executor-provenance mutate cases, attestation rejection cases). Their
  internal reds are the assertion; only the vitest summary decides the gate.
- `test:meta:logic` intentionally excludes `runtime-isolation*.ts` and
  `run-executor-provenance.test.ts` (Podman probes hang on this host; see
  `cron-weekly.sh` comment). The exclusion is fixed policy. Growing it to
  reach green is forbidden (A7).
- `npm run test:unit` requires a candidate tree. Against the default
  `fixture/` it is red by design: the fixture is the task starting point.
  Final-acceptance values proposed: `PROJECT_LINT`: n/a (no lint script
  exists); `PROJECT_CHECKS`: `cd harness && npm run test:meta:logic`;
  `PROJECT_TESTS`: `cd harness && CANDIDATE=<tree with installed deps> npm run
  test:unit` — the acceptance role must pick and verify the tree (`reference/`
  currently has no `node_modules`).

## 11. Artifact tests vs live-behavior tests

Artifact tests assert file text (e.g. runner-safety "uses the shared
allowlist…", publication-freshness "routes batch resumption…",
control-calibration-status). They guard wiring and cannot prove behavior.
Live-behavior tests execute the pipeline (score/freshness in-process runs,
`grade.sh` and `summarize.sh` spawns, control runs, regrades). Every gate in
this strategy requires the live-behavior form of its claim; artifact tests
may only supplement. The new `batch.sh` guard is an artifact test by
necessity and is paired with the live R2 run.

## 12. Review gate applicability

| Gate | 7.1R | 7.2 | 7.4 | 7.5 |
|---|---|---|---|---|
| Review A (correctness) | yes | yes | yes | yes |
| Review B (security) | yes — env handling in `batch.sh`; fail-closed attestation untouched; key-gated bench-state route and the runner-safety contract stay enforced (runner-safety suite is the regression guard) | yes — control runs execute candidate mutations under contract | yes — FR-12 executor resolution from recorded hashes; run-id validation; graft confinement | no new surface |
| Review C (UX/API) | record schemas 3/6 unchanged (API stability only) | no | no | yes — export JSON is the site consumer contract |
| Adversarial testing | yes — R2 adversarial-env runs are the adversarial evidence | controls are the adversarial surface | yes — one hand-staled record must regrade to STALE/INVALID | no |
| UX browser review | not applicable (data-only phase, no UI change) | not applicable | not applicable | not applicable; owner may spot-check the published site |

## 13. `phase_base_sha` capture point

Capture `phase_base_sha` **immediately after the commit that adds this
strategy file** and before any Red-phase file change:

```
git rev-parse HEAD            # -> phase_base_sha
git diff HEAD | git hash-object --stdin        # re-record tracked_diff_hash
git status --porcelain | git hash-object --stdin  # re-record status_hash
```

Do not use `9403f5c0f3a72bc5a18225822b0092771d5eb859`; it predates the
committed strategy. The tree stays dirty, so the two diff hashes are part of
the phase base alongside the commit id.

## 14. Gap: project anti-pattern registry missing

`measure/anti-patterns.md` does not exist in this repo. This strategy used the
starter catalog at
`/home/daniebo/.agents/skills/measure-orchestrator/references/anti-pattern-catalog.md`
(A1–A10, with A1 and A8 retired). Recommended orchestrator actions:

1. Create `measure/anti-patterns.md` from the starter catalog.
2. Add project entry **A11 — inherited-environment test fragility**: tests or
   orchestration that inherit caller environment (`BENCH_TRACK` here) and
   change verdicts. Detection: run the suite under adversarial env values.
   Guard: the R2 run in section 4. This incident (w39/w41 cron failures) is
   the caught occurrence.
