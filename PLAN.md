# OpenCode Go bench plan

Keep Pi as the agent. Add OpenCode Go as a Pi provider. Keep the Lending Desk grader.

## Goal

Measure OpenCode Go High Usage models on this fixture. Cost is percent of that model’s monthly Usage column. Recalculate that percent when the price table changes. Do not re-run the agent for a price change.

## Keep

Fixture, reference overlay, `grade.sh`, scoring formula, candidate contract, Podman isolation, Arm machine ids `a` and `b`, control calibration.

## Change

1. Pin `harness/go-pricing.json` from https://opencode.ai/docs/go/ (prices, monthly Usage USD, request estimates, API type).
2. Recost from transcript tokens. Ignore Pi `costUsd` for published economics.
3. Generate Pi `models.json` from that table. Provider id is `opencode-go`. Auth is `OPENCODE_API_KEY`.
4. Run **No Skills** (`a`) once per model and **Skills** (`b`) once per model each week.
5. Rank only Go High Usage models (>7000 requests/month). Skip Muse Spark (training) and Flash Vision Exp (vision SKU).
6. Weekly timer: new run ids, catalog add/drop, EMA + 4-week range. Label the band as a range, not a confidence interval.
7. Public names: No Skills / Skills. Keep `a` / `b` in the runner.

## Recost

```
go_usd = in/1e6×P_in + out/1e6×P_out + cacheRead/1e6×P_cache + cacheWrite/1e6×P_write
monthly_pct = 100 × go_usd / model_usage_usd
```

DeepSeek uses off-peak rates only. Context-length tiers apply when total input tokens exceed the threshold. A price edit updates `go-pricing.json` and `recost.sh`. It does not change functional totals or provenance.

## Matrix (batch)

`mimo-v2.5`, `longcat-2.0`, `deepseek-v4-flash`, `qwen3.8-flash`, `qwen3.7-plus`, `hy3`, `minimax-m2.7`, `mimo-v2.5-pro`, `qwen3.6-plus`, `minimax-m3`, `gpt-5.6-luna`, `glm-5.3-flash`.

Spread runs across the week. Go limits are $12 / 5 hours and $30 / week.

## History

Keep old Pi/flash runs on disk. Recost only aliased SKUs. Do not rank them as Go results.

## Files

| Path | Role |
|---|---|
| `harness/go-pricing.json` | Pinned prices and catalog flags |
| `harness/go-cost.ts` | Recost, Pi models.json, batch lines, trend |
| `harness/recost.sh` | Rewrite `go` on existing score.json |
| `harness/weekly.sh` | Catalog + batch + recost + site export |
| `harness/run.sh` | `opencode-go` + `OPENCODE_API_KEY` |
| `harness/batch.sh` | High Usage matrix, ISO-week run ids |
