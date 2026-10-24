# Implementation plan — go_catalog_w43

Refresh the pricing table from the live OpenCode Go catalog, recost the stored
scores, run the benchmark matrix for the new models, and publish the results.

The benchmark run depends on the `opencode_executor` track. That track
replaces the Pi executor with OpenCode 2 and the host Console login. The Pi
executor cannot run now because its API key expired on 2026-10-18.

Gate commands:

- `cd harness && npm run test:meta:logic`
- `cd harness && BENCH_TRACK=change npm run test:meta:logic`
- `cd harness && WEEK=all ./rescore-doctor.sh`
- `cd harness && ./recost.sh`

## Phase 1: Refresh the catalog

- [x] 1.1 Refresh `harness/go-pricing.json` from the live catalog and the Go
  docs. Add the new models. Update the changed limits and rates. Keep the
  retired entries that stored scores need. Update the `retrieved` date and the
  alias map. Verify with `harness/go-cost.ts --catalog` and
  `harness/go-cost.ts --batch-lines`.
  - Added `claude-haiku-5-5`, `gpt-6-luna`, `minimax-m3.1-flash` as batch
    models. Added `grok-4.7`, `kimi-k3.1-pro`, `step-5-preview`,
    `qwen3.7-max`, and `beam-free` as catalog entries. Raised the DeepSeek
    V4.1 Flash monthly limit to $80 and its request estimate to 173,330.
  - The live catalog holds 40 ids. The table holds 37 entries and 21 batch
    models. The catalog diff lists `deepseek-v4-flash-vision-exp` as missing
    and `gemini-4-argon` as extra.
  - `deepseek-v4-flash-vision-exp` left the Go catalog. Its entry stays for
    the recost of the old scores. Its `batch` flag is now false, so the
    weekly batch no longer schedules it.
  - The Go route serves one id for DeepSeek V4.1 Flash. A probe on 2026-10-25
    returned HTTP 200 for `deepseek-v4.1-flash`. The ids
    `deepseek-v4.1-flash-10-17` and `deepseek-v4.1-flash-0917` returned
    HTTP 400 "Model is unavailable". The 2026-10-17 release reached the Go
    route under the same id. The alias map resolves a recorded versioned id to
    the table entry.
  - The matrix now holds 15 models. Seven entries left the matrix on
    2026-10-25. The OpenCode executor cannot run them today:
    `minimax-m2.5` and `omen-alpha` and `qwen3.6-plus` are absent from the
    OpenCode model catalog, `minimax-m2.7` is deprecated in that catalog,
    `mimo-v2.5-pro` is rejected by the Go upstream, `minimax-m3` returns
    HTTP 404 for the executor request, and `deepseek-v4-flash-vision-exp`
    left the Go catalog. The entries stay for the recost of the stored
    scores. Each flag can return when the catalog or the upstream serves the
    id again.
- [x] 1.2 Recost every stored score with `harness/recost.sh`. Verify that no
  stored score lost its cost and that the retired ids resolve as unmapped.
  - `recost.sh` rewrote 230 score files and exited 0.

## Phase 2: Enable the OpenCode executor

This phase continues the `opencode_executor` track. Its plan holds the task
detail.

- [x] 2.1 Land the OpenCode executor in `harness/`. The Red suite in
  `harness/tests/meta/opencode-*.test.ts` holds the contract. Both gate
  commands must pass.
  - The `opencode_executor` track landed the executor. The logic gate and the
    adversarial gate each printed `Test Files  30 passed (30)` and
    `Tests  238 passed (238)`.

## Phase 3: Benchmark the new models [checkpoint: 8b6bf37]

- [x] 3.1 Run the batch for the new models. Use both arms. Use the build track
  repeat count. Record the run ids and the score verdicts.
  - The build track ran the three new models on 2026-10-25 with one repeat
    per arm. All six runs graded valid, trusted, publishable scores:
    `a-gpt-6-luna` 94.5, `b-gpt-6-luna` 98.7,
    `a-minimax-m3-1-flash` 91.1, `b-minimax-m3-1-flash` 96.7,
    `a-claude-haiku-5-5` 88.9, `b-claude-haiku-5-5` 97.7.
  - The weekly cron runs the other tracks. Its tests-track runs for
    `tt-a-gpt-6-luna` 93.5, `tt-a-minimax-m3-1-flash` 93.2, and
    `tt-a-claude-haiku-5-5` 98.7 graded valid.
  - The DeepSeek V4.1 Flash release changed under the same Go id. The build
    track graded both arms against it on 2026-10-25:
    `a-deepseek-v4-1-flash` 95.0, `b-deepseek-v4-1-flash` 97.7, delta +2.7.
    The weekly cron graded `tt-b-deepseek-v4-1-flash` 98.0.
- [x] 3.2 Rescore every run with `harness/rescore-doctor.sh`. Verify that each
  new run is valid, trusted, and publishable.
  - `WEEK=2026w43 ./rescore-doctor.sh` kept every total. The legacy Pi runs
    printed one SKIP line each and kept their bytes.

## Phase 4: Publish

- [x] 4.1 Export the site data with `harness/export-site-data.py`. Generate the
  model pages with `harness/generate-model-pages.py`. Verify that the new
  models appear with their executor and version.
  - The site data holds three ranked models and eleven history models. Every
    ranked row carries the executor `opencode` and the version `v2.1.4`.
  - The paired Skills delta for the new models: GPT 6 Luna +4.2,
    MiniMax M3.1 Flash +5.6, Claude Haiku 5.5 +8.8.
- [x] 4.2 Commit the site data, the model pages, the pricing table, and the
  track files. Stage only those paths. Push to `main` to publish the pages.
  - The commit `3ae55c6` holds the site data, the three new model pages, and
    the eleven history pages. The push reached `main`. GitHub Pages built the
    deployment and the live data shows the three ranked models.
