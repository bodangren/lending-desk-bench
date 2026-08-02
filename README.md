# Lending Desk Bench

A hermetic Next.js implementation benchmark. A model receives an intentionally incomplete
`fixture/` and must complete the Measure track. The hidden harness grades the resulting
application through typecheck, build, API, browser, stream, and mutation-safety checks.

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
| `harness/` | Hidden runner, tests, collector, scorer, and control manifest. |
| `runs/<id>/` | One isolated candidate and its immutable grading artifacts. |
| `SCORING.md` | Scoring, validity, and calibration rules. |

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

## Regrade existing candidates (no API keys)

Historical `runs/*/artifacts/score.json` become **STALE-PROVENANCE** whenever the
harness or suite hash changes. To get current *functional* totals without re-running
models:

```bash
# One candidate → new run id (overlay provenance: diagnostic, not rankable)
./harness/regrade.sh a-deepseek-v4-flash-r1 rg-deepseek-now deepseek deepseek-v4-flash a

# Full matrix + reference calibration + REPORT.md
BENCH_IGNORE_LOAD=1 BENCH_WAIT_FOR_IDLE=60 ./harness/regrade-matrix.sh
./harness/summarize.sh
# → reports/REPORT.md
```

Overlay regrades are **CALIBRATION**: valid scores for comparison, never trusted
publishable rankings. For rankable agent runs use `./harness/batch.sh` with keys on a
quiet host.

## Install once

Use the lockfiles exactly. Benchmark runs never install packages or fetch quality tooling.

```bash
cd fixture && npm ci
cd ../harness && npm ci
./node_modules/.bin/playwright install chromium --only-shell
cd ..
```

A real model run additionally needs rootless Podman, the local `pi` executable, and one
allowlisted provider key. The runner passes only the selected provider credential into the
container; it does not mount host home, model configuration, harness, reference, or unrelated
workspace files.

## Run a model

```bash
./harness/run.sh <provider> <model> a run-001
./harness/run.sh <provider> <model> b run-002
```

Run IDs must match `[A-Za-z0-9][A-Za-z0-9_-]{0,79}`. A run ID is replaced only after that
validation and host preflight succeed.

| Arm | Model-visible material |
|---|---|
| `a` | The fixture and task prompt only; no skills, extensions, or context files. |
| `b` | The fixture `AGENTS.md` plus the five explicitly mounted skills named there. |

Both arms start from the same fixture and receive the same prompt. The only intentional
difference is the allowed instructional material.

### Provider credentials

Built-in providers select one environment variable: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
`OPENROUTER_API_KEY`, `GOOGLE_API_KEY`, `DEEPSEEK_API_KEY`, `GROQ_API_KEY`,
`MISTRAL_API_KEY`, `XAI_API_KEY`, `TOGETHER_API_KEY`, `CEREBRAS_API_KEY`,
`FIREWORKS_API_KEY`, or `XIAOMI_API_KEY`. For another provider, set
`BENCH_PROVIDER_ENV` to exactly one name from that allowlist. Missing or unallowlisted
credentials stop the run before an agent starts.

`BENCH_PI_ROOT` and `BENCH_AGENT_IMAGE` are explicit operator overrides. The default agent
image is pinned and runs read-only with a writable candidate bind mount and temporary `/tmp`.

## Isolation and candidate contract

The model container has a private filesystem view:

- candidate source is the only writable project mount;
- fixture dependencies are mounted read-only during the agent phase;
- the candidate gets a private physical dependency copy only after its protected files are
  verified;
- `reference/`, `harness/`, host home, extensions, and host loopback are absent;
- the candidate may modify only the nine task files and the Measure plan/metadata closeout
  files; adding files, dependencies, symlinks, or changing protected files invalidates it.

The runner records protected-file checksums and hashes of the candidate, runner, and complete
suite. Schema-4 provenance also binds the run ID to the resolved immutable image, Pi binary and
version, exact Arm-B skill tree, and inspectable runtime/CLI flags. Scoring rechecks these values,
so a stale regrade cannot become a current score.

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

If the host is busy, BENCH_IGNORE_LOAD=1 may prefix one of these commands for diagnostic
evidence only. The verifier preserves that explicit override, and its resulting runs remain untrusted.

Every selection receives a fresh, valid run ID and an adjacent `runs/<id>-overlay` copy of the
reference. The executor mutates only that copy, invokes the normal `run.sh`/`grade.sh` path, and
retains the raw reports, runner log, and `control-verification.json` under `runs/<id>/artifacts/`.
It rejects missing declared raw failures, undeclared collateral, a disagreement between raw
reports and `results.json`, and any gate, collection, or provenance invalidation; `fixture/` and
`reference/` are never writable inputs.

## Trust and host readiness

Before agent execution, `harness/preflight.sh` requires a quiet host: at most one load unit per
CPU, at least 2500 MB available memory, and at most 2000 MB used swap. `BENCH_WAIT_FOR_IDLE`
waits for that condition. `BENCH_IGNORE_LOAD=1` deliberately records `under_load: true`; those
results are retained for diagnosis but are never trusted, publishable, or ranked.

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
ARMS="a b" REPS=5 ./harness/batch.sh
./harness/summarize.sh
```

Batch resumes only current, trusted, publishable records. Stale or untrusted scores are
re-run (there is no "accept any existing score" override). Summary shows invalid,
gate-blocked, stale, under-load, and untrusted rows separately; only trusted rows enter a ranking.

Historical records from older runner or suite hashes remain on disk for audit but are excluded
from current comparisons.
