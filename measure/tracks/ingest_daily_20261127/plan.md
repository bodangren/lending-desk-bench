# Implementation plan — ingest_daily_20261127

PM decision 2026-11-27: light lane.

## Phase 1: Daily real-world ingest

- [x] 1.1 Commit the daily ingest code with trust rule A.
  Result: ff8d906; remediation 8b6b5bb, ee5c223, a0752a7, da0cb92.
  Evidence: measure/runs/ingest_daily_20261127/review-b-ff8d906.json, measure/runs/ingest_daily_20261127/review-b-8b6b5bb.json, measure/runs/ingest_daily_20261127/review-b-ee5c223.json, measure/runs/ingest_daily_20261127/review-b-a0752a7.json.

- [x] 1.2 Skip or map legacy outcome rows.
  Result: ff8d906; read-only ingest exit 0; database hash unchanged.

- [x] 1.3 Enable ingest in the daily timer.
  Result: ff8d906; `harness/cron-daily.sh` sets `INGEST_ENABLED=1` before the publish step.

- [~] 1.4 Run the first daily ingest through the 01:00 timer or a manual run, and publish its outputs.
  Done when the dated `ra-outcomes` export, `aa-reliability` data, `allowed-routes` data, `model-guide.json`, and `real-work.json` show real accept and reject outcomes for each model and role.

- [~] 1.5 Check the live model guide.
  Done when the live accept and reject outcomes match the daily export for each model and role.

Deviation: Review B round limit reached at r4; F11 closed by the orchestrator through da0cb92 diff reading and the mechanical gates; Minor items F6, F8, F10, F12, F13 are tech-debt.
