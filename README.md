# Lending Desk Bench

A hermetic Next.js implementation benchmark for OpenCode Go High Usage models. Pi receives an
intentionally incomplete `fixture/` and must complete the Measure track. The hidden harness
grades the result through typecheck, build, API, browser, stream, and mutation-safety checks.
Three more tracks use the same app: bug fixing, test writing, and change requests.

The fixture is deliberately incomplete. `reference/` is the golden answer used only for
calibration; it is never mounted into a model container.

## Public results site (GitHub Pages)

Presentation pages live in [`docs/`](./docs/) (Overview, Methodology, Results, per-model pages).

```bash
# After new regrades / agent runs, refresh the published data + model pages:
python3 harness/export-site-data.py
python3 harness/generate-model-pages.py
```

GitHub Pages is served from the `docs/` folder on `main`.

## Layout

| Path | Purpose |
|---|---|
| `fixture/` | The complete model-visible repository and task contract. |
| `reference/` | Golden writable-file overlay for calibration only. |
| `reference-variant/` | A second correct implementation (different markup and structure). It must score 100; the tests track grades suites against it. |
| `reference-change/` | The reference with the change requests implemented; the change track's canary. |
| `harness/` | Hidden runner, tests, collector, scorer, and control manifest. |
| `harness/bugfix/` | Bug registry, task sets, variant generator for the bug-fix track. |
| `harness/tests-track/` | Mutant sets, variant generator, grader, and oracle suite for the test-writing track. |
| `harness/change/` | Change requests, sets, and variant generator for the change-request track. |
| `harness/go-pricing.json` | Pinned OpenCode Go prices and monthly Usage column. |
| `runs/<id>/` | One isolated candidate and its immutable grading artifacts. |
| `SCORING.md` | Scoring, validity, and calibration rules. |
| `PLAN.md` | OpenCode Go rewrite plan. |
| `measure/tracks/bugfix_bench/` | Spec and plan for the bug-fix track. |
| `measure/tracks/bench_v2/` | Validity fixes, fixture r2, weights, adherence, new checks. |
| `measure/tracks/tests_bench/`, `change_bench/` | Specs and plans for the two newest tracks. |

## Tracks

| `BENCH_TRACK` | Prefix | Task |
|---|---|---|
| `build` (default) | none | Complete the `/items` slice from stubs. |
| `bugfix` | `bf-` | Repair seeded, undisclosed defects in a working variant, without regressions. |
| `tests` | `tt-` | Write a test suite; graded by mutants killed and by tests that stay valid on a second correct implementation. |
| `change` | `ch-` | Add four requested behaviors (set `c1`) and keep every existing behavior. |

```bash
BENCH_TRACK=bugfix ./harness/run.sh opencode-go mimo-v2.5 a bf-a-mimo-v2-5-2026w40-r1
BENCH_TRACK=tests  ARMS="a b" ./harness/batch.sh
./harness/verify-bugs.ts --list      # registry; --id / --set calibrate admission
```

Scoring, trust, arms, and provenance machinery are shared; see `SCORING.md` and the
track specs under `measure/tracks/`.

## Harness self-tests (read this before "fixing" scoring)

There are **two different test layers**. Mixing them up is the usual thrash loop.

| Layer | Command | What it is |
|---|---|---|
| Product suites | `cd harness && npm run test:unit` / Playwright e2e via `grade.sh` | Grade a **candidate** against the Lending Desk spec |
| Meta suites | `cd harness && npm run test:meta:logic` then `test:meta` | Prove the **harness itself** (provenance, attestation, contracts, isolation) |

**Do not treat a meta timeout as a broken scorer.** Meta tests used to spawn `tsx score.ts` per case (~10s cold start + full suite hash). Under parallel Vitest workers that exceeded default 5s timeouts and produced cascading "failed evaluations." Prefer in-process `buildScoreRecord` / `assessScoreFreshness` in meta tests. Run meta with `BENCH_META=1` (serialized, 180s budgets):

```bash
cd harness
npm run test:meta:score   # scoring / provenance only
npm run test:meta:logic   # skip Podman isolation
npm run test:meta         # full meta, including runtime isolation
```

Any edit under `harness/` that is hashed by `provenance.ts` changes `runner_sha256` / `suite_sha256` and **invalidates old `runs/*/artifacts/score.json`**. That is intended. Re-grade candidates; do not invent workarounds that weaken provenance.

## Regrade and rescore existing runs (no API keys)

Historical `runs/*/artifacts/score.json` become **STALE-PROVENANCE** whenever the
harness or suite hash changes.

```bash
# Scoring-only change (weights, axes): rebuild score.json from the stored results.
WEEK=2026w39 ./harness/rescore-doctor.sh

# Test change: grade the agent's writable files again on the current tree (a graft).
./harness/regrade-run.sh a-mimo-v2-5-2026w38
WEEKS="2026w37 2026w38 2026w39" ./harness/regrade-all.sh
python3 harness/export-site-data.py && python3 harness/generate-model-pages.py
```

A regrade keeps the run's identity, transcript, and executor evidence, records a `graft`
block in provenance, and takes contract violations from the run's original verdict. The
previous artifacts stay in `artifacts.prev-<stamp>/`. A regraded agent run stays rankable;
`regrade.sh` (overlay into a new run id) remains a diagnostic tool.

## Install once

Use the lockfiles exactly. Benchmark runs never install packages or fetch quality tooling.

```bash
cd fixture && npm ci
cd ../harness && npm ci
./node_modules/.bin/playwright install chromium --only-shell
cd ..
```

A Go run needs rootless Podman, the local `pi` executable, and `OPENCODE_API_KEY`. The runner
passes only that credential into the container. It does not mount host home, harness, or
reference.

## Run a model

```bash
./harness/run.sh opencode-go mimo-v2.5 a a-mimo-v2-5-2026w40-r1
./harness/run.sh opencode-go mimo-v2.5 b b-mimo-v2-5-2026w40-r1
```

Arm `a` is **No Skills**. Arm `b` is **Skills**. The build track repeats three times a
week per arm (`REPS_BUILD`, default 3); the other tracks run once (`REPS_BUGFIX`,
`REPS_TESTS`, `REPS_CHANGE`). `REPS` overrides every track.

```bash
ARMS="a b" ./harness/batch.sh
./harness/weekly.sh
```

Run IDs must match `[A-Za-z0-9][A-Za-z0-9_-]{0,79}`. A run ID is replaced only after that
validation succeeds. Host preflight records load and never blocks the replacement.

| Arm | Public name | Model-visible material |
|---|---|---|
| `a` | No Skills | The fixture and task prompt only; no skills, extensions, or context files. |
| `b` | Skills | The fixture `AGENTS.md` plus the five explicitly mounted skills named there. |

Both arms start from the same fixture and receive the same prompt. The only intentional
difference is the allowed instructional material.

Cost is percent of that model’s monthly Go Usage column. After a price change, update
`harness/go-pricing.json` and run `./harness/recost.sh`. Do not re-run the agent.

### Provider credentials

Put `OPENCODE_API_KEY` in `.env.local` at the repo root (gitignored). `run.sh` loads `.env` then `.env.local`. A live environment variable still wins.

OpenCode Go uses `OPENCODE_API_KEY`. Other built-in providers still select one of
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`,
`DEEPSEEK_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `XAI_API_KEY`, `TOGETHER_API_KEY`,
`CEREBRAS_API_KEY`, `FIREWORKS_API_KEY`, `XIAOMI_API_KEY`, or `ARK_API_KEY`. For another
provider, set `BENCH_PROVIDER_ENV` to exactly one name from that allowlist. Missing or
unallowlisted credentials stop the run before an agent starts.

`BENCH_PI_ROOT` and `BENCH_AGENT_IMAGE` are explicit operator overrides. The default agent
image is pinned and runs read-only with a writable candidate bind mount and temporary `/tmp`.

## Isolation and candidate contract

The model container has a private filesystem view:

- candidate source is the only writable project mount;
- fixture dependencies are mounted read-only during the agent phase;
- the candidate gets a private physical dependency copy only after its protected files are
  verified;
- `reference/`, `harness/`, host home, extensions, and host loopback are absent;
- the candidate may modify only the track's writable files (the nine task files and the
  Measure closeout on the build, bugfix, and change tracks; new `tests/*.test.ts` files on
  the tests track). A symlink or special file invalidates the run. Any other violation (an
  added file, a protected edit, a changed export) is recorded, the writable files are
  grafted onto a fresh tree, and the violation costs the adherence axis.

The runner records protected-file checksums and hashes of the candidate, runner, and complete
suite. Schema-6 provenance also binds the run ID to the resolved immutable image, Pi binary and
version, exact Arm-B skill tree, inspectable runtime/CLI flags, the fixture revision, the
contract-violation record, and any graft. Scoring rechecks these values, so a stale record
cannot become a current score.

## Calibration and controls

A reference calibration uses the overlay path; it is not a model result:

```bash
AGENT_SKIP=1 OVERLAY=reference ./harness/run.sh local reference a reference-calibration
```

`AGENT_SKIP` copies only allowed candidate paths. It is intended for reference, mutation, and
regrade controls, never for model rankings; its provenance explicitly records that no agent was
invoked, so it remains diagnostic and nonrankable. The control manifest under `harness/tests/`
maps every reported criterion/probe to a deterministic reference mutation. Its executor retains
raw artifacts and verifies expected failures before a test is considered sensitive.

Run the harness-owned control verifier from the repository root:

```bash
# Inspect the declarative controls without modifying any source.
harness/node_modules/.bin/tsx harness/verify-controls.ts --list

# Run a small unit/API/browser/advisory representative set, or one named control.
harness/node_modules/.bin/tsx harness/verify-controls.ts --fast
harness/node_modules/.bin/tsx harness/verify-controls.ts --id sensitivity-G.get200

# Run every declared control only as an explicit calibration operation.
harness/node_modules/.bin/tsx harness/verify-controls.ts --all
```

Controls run regardless of host load. Preflight logs load, and `under_load` stays advisory
metadata on the record.

Every selection receives a fresh, valid run ID and an adjacent `runs/<id>-overlay` copy of the
reference. The executor mutates only that copy, invokes the normal `run.sh`/`grade.sh` path, and
retains the raw reports, runner log, and `control-verification.json` under `runs/<id>/artifacts/`.
It rejects missing declared raw failures, undeclared collateral, a disagreement between raw
reports and `results.json`, and any gate, collection, or provenance invalidation; `fixture/` and
`reference/` are never writable inputs.

## Trust and host readiness

Before agent execution, `harness/preflight.sh` measures host load: load units per
CPU, available memory, and used swap. It never refuses a run; it waits only while
`BENCH_WAIT_FOR_IDLE` allows. A busy host is recorded as advisory `under_load: true`
metadata. Every valid agent record is trusted and publishable; load never blocks a
run or demotes a score.

Every score record has explicit validity fields. A total is rankable only when all are true:

```text
valid, trusted, publishable, provenance_valid, suite_current
```

Missing reports, malformed JSON, missing/orphan/duplicate result IDs, stale hashes, and
candidate-contract violations produce an invalid record with `total: null`. A compile/build
gate failure is a valid, explicit `blocked_by_gate` zero rather than a misleading partial
score. See `SCORING.md` for the exact policy.

## Batch and reporting

```bash
ARMS="a b" ./harness/weekly.sh
./harness/summarize.sh
```

Each batch first runs the self-check (`BENCH_SELFCHECK`: `meta`, `logic`, `full`, or `skip`;
the cron uses `logic`) and then the track's canary: the calibration candidate must score a
valid 100, or the batch grades nothing (`BENCH_CANARY=0` skips it with a warning).

Batch resumes only current, trusted, publishable records. Stale or untrusted scores are
re-run (there is no "accept any existing score" override). Summary shows invalid,
gate-blocked, stale, and untrusted rows separately; only trusted rows enter a ranking.
The site shows each model's lower-median repeat, the worst repeat, and one paired Skills
delta per week.

Historical records from older runner or suite hashes remain on disk for audit but are excluded
from current comparisons.
