# Implementation plan — ingest_daily_20261127

PM decision 2026-11-27: light lane.

## Phase 1: Daily real-world ingest

- [~] 1.1 Commit the daily ingest code with trust rule A.
  Done when the committed ingest applies rule A to each outcome row.

- [ ] 1.2 Normalize legacy outcome rows.
  Done when each valid legacy row maps to its canonical route, and each row without a valid route is skipped.

- [ ] 1.3 Enable ingest in the daily timer.
  Done when `harness/cron-daily.sh` sets `INGEST_ENABLED=1` before the publish step.

- [ ] 1.4 Run the first daily ingest and publish its outputs.
  Done when the dated `ra-outcomes` export, `aa-reliability` data, `allowed-routes` data, `model-guide.json`, and `real-work.json` show real accept and reject outcomes for each model and role.

- [ ] 1.5 Check the live model guide.
  Done when the live accept and reject outcomes match the daily export for each model and role.
