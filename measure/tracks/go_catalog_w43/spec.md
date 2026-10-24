# Refresh the OpenCode Go catalog and benchmark the new models — go_catalog_w43

## Summary

The OpenCode Go catalog changed. New models appear, one model left, and the
DeepSeek V4.1 Flash entry now serves the 2026-10-17 release. The pricing table
in `harness/go-pricing.json` is the source of truth for the ranking and the
cost column. This track refreshes that table, runs the benchmark matrix for the
new models, and publishes the results.

The benchmark cannot run now. The Pi executor uses `OPENCODE_API_KEY`. That key
expired on 2026-10-18. The `opencode_executor` track replaces Pi with OpenCode 2
and the host Console login. This track depends on that track.

## Definitions

- **Live catalog.** The model ids that `https://opencode.ai/inference/go/v1/models`
  returns with the Console credential.
- **Pricing table.** `harness/go-pricing.json`. It holds prices, monthly usage
  USD, request estimates, and the batch flags.
- **Batch model.** A pricing table entry with `high_usage` and `batch` set.
- **New model.** A batch model with no agent run for a track and arm.
- **Score series.** The runs that rank together. The executor kind decides the
  series. OpenCode runs start a new series.

## Established facts

Verified on this host on 2026-10-24.

- The live catalog holds 40 ids. The pricing table holds 30.
- New live ids without a pricing entry: `beam-free`, `claude-haiku-5-5`,
  `gemini-4-argon-contributor`, `gpt-6-luna`, `grok-4.7`, `kimi-k3.1-pro`,
  `minimax-m3.1-flash`, `step-5-preview`.
- The pricing table holds `deepseek-v4-flash-vision-exp`. The live catalog does
  not list that id.
- The Go docs set the DeepSeek V4.1 Flash monthly limit to $80. The table says
  $15. The docs set the request estimate to 173,330 per month. The table says
  32,500.
- The Go docs set the Grok 4.7 rates. The table holds Grok 4.6.
- The Go docs set the MiniMax M3.1 Flash rates to $0.15 input, $0.60 output,
  and $0.015 cached read. The model ships with a $20 monthly limit.
- The Go docs set the Claude Haiku 5.5 rates to $0.10 input, $0.50 output,
  $0.01 cached read, and $0.125 cached write.
- The Go docs set the GPT 6 Luna rates to $0.10 input, $0.50 output,
  $0.01 cached read, and $0.125 cached write.
- The Console credential authorizes the Go inference endpoint. A request with
  the access token returns HTTP 200.
- The OpenCode Go API key in `.env.local` returns HTTP 401
  `api_key_expired`.
- `opencode models` lists 30 `opencode-go/*` ids. The live catalog lists 40.

## Functional requirements

### FR-1 — Catalog refresh

- The pricing table lists every live catalog id that the benchmark may rank.
- Each entry holds the Go docs rates, monthly usage USD, and request estimate.
- The `retrieved` date matches the refresh date.
- The alias map resolves every provider-prefixed model id.
- The table keeps an entry for a retired id when stored scores need it for a
  recost.

### FR-2 — Recost

- `harness/recost.sh` rewrites the `go` block of every stored `score.json`.
- A price change schedules no agent run.
- A retired id without a table entry produces an unmapped cost, not a failure.

### FR-3 — Benchmark run

- The OpenCode executor runs the matrix. The track `opencode_executor` must
  pass its gate commands first.
- The batch runs both arms for each new model.
- The build track runs three repeats. The other tracks run one.
- A run that fails its gate produces an invalid score. It never becomes a
  partial score.

### FR-4 — Publish

- `harness/export-site-data.py` and `harness/generate-model-pages.py` run after
  the batch.
- The site labels the executor name and version on every row.
- The site keeps the Pi rows as labeled history. It never ranks them.

## Non-functional requirements

- NFR-1 — No credential reaches a file, a log, a process argument list, or an
  exported environment variable.
- NFR-2 — The catalog refresh never calls a model.
- NFR-3 — The publish step stages only its own files.

## Acceptance criteria

- The pricing table matches the live catalog and the Go docs.
- `harness/recost.sh` completes with no error.
- One build-track run per arm produces a valid graded score with schema 7
  provenance.
- The site data shows the new models with their executor and version.
- The published pages keep the Pi rows outside the ranking.

## Out of scope

- The pricing values of models that the Go docs do not change.
- The fixture, the criteria, the scoring weights, and the run-ID format.
- A new score series for the Pi runs.
