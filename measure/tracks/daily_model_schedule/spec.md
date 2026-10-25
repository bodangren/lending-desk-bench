# Daily model schedule: one model per day, untested first, then the stalest

Spec format: classic FR list. Track type: feature. Base commit: `aa94185`.

## Summary

The weekly matrix tests every batch model on one night each week. The owner
disabled it on 2026-10-25. This track adds a daily job that tests one model
on each day.

Each day, the job refreshes the model list. It then selects one model: a model
with no test, or else the model with the stalest last test date. It runs that
model through the existing batch path, and it publishes the site data. The job
sends no model call for any other model.

The track changes no scoring rule, no hashed file, and no price. It does not
re-enable the weekly cron.

## Owner requirement

The owner gave this requirement on 2026-10-25:

> We need to set the testing schedule to one model per day. 1. Refresh the model list. 2. Test one untested model if any exists. 3. If no untested models exist, test the model which has the stalest last test date.

## Evidence

All facts come from the files on disk and from read-only commands on
2026-10-25.

- **EV1. The live list.** `reports/go-catalog-refresh.json` holds the fetch
  of 2026-10-25 13:09. It lists 38 live models. Two live models have no price:
  `iceman-contributor-free` and `gemini-4-argon`. One priced model is gone
  from the endpoint: `deepseek-v4-flash-vision-exp`. The price table
  `harness/go-pricing.json` prices 37 models (`retrieved: 2026-10-24`). Thus
  36 live models have a price.
- **EV2. A failed fetch leaves an empty file.** `reports/go-catalog-2026w43.json`
  has 0 bytes. `harness/weekly.sh` redirects the fetch output into this file,
  and it continues when the fetch fails. The drift note of
  `harness/cron-weekly.sh` then reads nothing.
- **EV3. The executor does not serve every live model.** `opencode models`
  (opencode v2.1.4) lists 31 `opencode-go/` models. Eight priced live models
  are absent: `glm-5.1`, `grok-4.6`, `kimi-k2.6`, `minimax-m2.5`,
  `minimax-m2.7`, `omen-alpha`, `qwen3.6-plus`, and `qwen3.7-max`. The
  preflight of `harness/batch.sh` stops before any run directory when its
  first model is absent. A job that selects such a model fails on each day.
- **EV4. The run history.** 22 models have at least one OpenCode run. An
  OpenCode run has `executor.kind` `opencode` in `artifacts/provenance.json`.
  21 of these models are live and priced. 15 live priced models have no
  OpenCode run: `beam-free`, `deepseek-v4-pro`, `glm-5.1`, `glm-5.2`,
  `glm-5.3`, `grok-4.6`, `grok-4.7`, `hy4-preview`, `kimi-k2.6`,
  `kimi-k2.7-code`, `kimi-k3`, `kimi-k3.1-pro`, `qwen3.7-max`,
  `qwen3.8-max`, and `step-5-preview`. The latest OpenCode run of each of
  the 21 models carries the week token `2026w43`.
- **EV5. Many runs are not valid.** 59 of the 77 runs of week 2026w43 have
  `valid: false`. For example, `runs/bf-b-hy3-2026w43-r1` shows "agent
  emitted no output tokens". Its `session.err` shows "image not known".
- **EV6. A directory time is not a test date.** A regrade rewrites the time
  of a run directory. `runs/a-hy3-2026w37` is a run of week 2026w37
  (2026-09-07 to 2026-09-13). Its directory time is 2026-10-11 12:59. Track
  `rigor_a_h` plans a regrade of the OpenCode records. That regrade would give
  each record a new directory time.
- **EV7. The run id carries the week.** Run ids end in `-<YYYY>w<WW>` or
  `-<YYYY>w<WW>-r<N>`. `harness/export-site-data.py` (`WEEK_TOKEN`) and
  `harness/cleanup.sh` parse this token. The weekly cron started on Sunday
  at 01:00. The runs of 2026w37, 2026w38, and 2026w43 started on the Sundays
  2026-09-13, 2026-09-20, and 2026-10-25.
- **EV8. Hash boundaries.** `harness/provenance.ts` hashes a fixed file list
  into the runner hash. The list includes `harness/run.sh`,
  `harness/go-cost.ts`, `harness/toolchain.sh`, and
  `harness/opencode-credential.sh`. The suite hash covers every file under
  `harness/tests/`, `harness/package.json`, `harness/package-lock.json`,
  `harness/vitest.config.ts`, and `harness/playwright.config.ts`.
  `harness/batch.sh`, `harness/weekly.sh`, `harness/plan-work.ts`, and
  `harness/cron-weekly.sh` are outside both hashes. A change to a hashed file
  makes the stored records stale. `plan-work.ts` then schedules paid runs.
- **EV9. The batch cannot run the untested models today.** `batch.sh` runs
  the work list of `plan-work.ts`. The work list covers only the 15 models
  with `high_usage` and `batch`. None of the 15 untested models of EV4 is a
  batch model.
- **EV10. The meta tests inherit the environment.** `envWithoutTrack` in
  `harness/tests/meta/score-helpers.ts` copies `process.env` and removes only
  `BENCH_TRACK`. The meta tests pass this environment to `batch.sh` dry runs.
  A new variable that `batch.sh` reads would leak into those tests
  (anti-pattern A11).
- **EV11. Cost and time.** The 18 valid runs of 2026w43 cost 0.089 USD on
  average and 0.27 USD at most (`go.usd` in `score.json`). Their mean time on
  task is 800 s.
- **EV12. The weekly cron is off.** The crontab line of `cron-weekly.sh` is
  a comment: "DISABLED 2026-10-25 by owner request: A-H tests are saturated."

## Definitions

- **Day.** One UTC date, `YYYY-MM-DD`. The week of a day is its ISO week
  token, `<YYYY>w<WW>`.
- **Live list.** The `live` array of the catalog file that the job fetches on
  the day with `harness/go-cost.ts --catalog`.
- **Price table.** `harness/go-pricing.json`. A priced model is a key of
  `models`.
- **Served list.** The stdout of `opencode models`, one `<provider>/<id>` on
  each line.
- **Candidate.** A model id that is in the live list and in the price table,
  and whose line `<provider>/<id>` is in the served list. The provider is the
  `provider` value of the price table (`opencode-go`).
- **OpenCode run.** A directory under `runs/` whose
  `artifacts/provenance.json` satisfies all of these conditions:
  `executor.kind` is `opencode`; `model` resolves to a priced id through
  `resolveGoModelId` of `harness/go-cost.ts`; `arm` is `a` or `b`; and
  `track` is `build`, `bugfix`, `tests`, or `change`. A valid run and a run
  that is not valid both count. This is the identity rule of `plan-work.ts`,
  without its batch filter.
- **Untested model.** A candidate with no OpenCode run.
- **Day record.** The file `reports/daily/<day>.json` that the job writes for
  a day.
- **Run date.** The date of one OpenCode run:
  1. the latest day of a day record whose `run_ids` lists the run id;
  2. else the Sunday of the ISO week in the run id (EV7);
  3. else `0000-00-00`, when the run id has no week token.
- **Last test date.** The latest run date of the OpenCode runs of a model.
- **Day's model.** The one model that the job selects for a day.

## Selection rule

The job applies the first rule that gives a result.

1. **Resume.** A day record for the day exists. The day's model is the
   model of that record. The job makes no new selection.
2. **Candidates.** The job builds the candidate list.
3. **One test in each week.** The job removes each candidate that has an
   OpenCode run with the week of the day. The remaining candidates are
   eligible.
4. **Untested.** At least one eligible candidate is untested. The day's model
   is the first untested candidate in this order: `requests_per_month`,
   highest first, then the id in byte order. The reason is `untested`.
5. **Stalest.** The day's model is the first eligible candidate in this
   order. First, the last test date, oldest first. Next,
   `requests_per_month`, highest first. Last, the id in byte order. The
   reason is `stalest`.
6. **None.** No candidate is eligible. The job runs no model and publishes
   nothing. The reason is `none`.

On 2026-10-26, this rule gives `hy4-preview` with the reason `untested`. The
inputs are EV1, EV3, and EV4: 28 candidates, of which 11 are untested. When
no untested model remains, the first stalest model is
`muse-spark-1.2-contributor`. All 17 tested candidates have the last test
date 2026-10-25.

## Design decisions

1. **D1. Test profile.** The day's model runs all four tracks, both arms, and
   the default repeats of `batch.sh`: build 3, and 1 for bugfix, tests, and
   change. This gives 12 agent runs each day. The weekly matrix used the
   same profile, so a daily result and a weekly result are comparable. From
   EV11, a day costs 1.07 USD on average and 3.24 USD at the observed
   maximum. The existing variables `ARMS`, `REPS`, and `REPS_<TRACK>` still
   change the profile.
2. **D2. Unpriced and gone models.** A live model with no price is not a
   candidate. The job does not edit the price table. The day record and the
   commit body list the model. When the operator adds a price, the model
   becomes an untested candidate. A priced model that the endpoint dropped is
   not a candidate. Its runs and its published rows stay.
3. **D3. A model that the executor cannot serve.** A live priced model that
   the served list does not hold is not a candidate (EV3). The day record
   lists it as `unservable`. A served model whose runs fail gets OpenCode
   runs with `valid: false`. These runs count as a test, so the model moves
   to the end of the order. Thus one model cannot stop the schedule on two
   days. A host fault before the first run directory (self-check, preflight,
   or canary) creates no OpenCode run. The next day then selects the same
   model again. Each day's job exits non-zero until the operator removes the
   fault. A host fault is not a result of the model, so it must not move the
   model in the order.
4. **D4. The record of each test date.** The job writes one day record for
   each day. The record holds the run ids of the day. A run that no day
   record lists gets the Sunday of its ISO week (EV7). The rule does not read
   a directory time (EV6). When the day records are lost, the rule falls back
   to the week of each run.
5. **D5. Tie-break.** Equal last test dates sort by `requests_per_month`,
   highest first. The model with more users has more readers. The id in byte
   order then makes the order total. The untested rule uses the same order.
6. **D6. One model in each week.** Rule 3 prevents a second test of a model
   in the same week. A second test would use the same run ids. `batch.sh`
   then skips each trusted run, and the day gives no new result.
7. **D7. The entry point.** A new script `harness/cron-daily.sh` holds the
   daily job. A new script `harness/daily-pick.ts` holds the selection rule.
   `batch.sh` gets a flag `--model <id>` that runs one priced model.
   `weekly.sh` passes its arguments to each `batch.sh` call. The job calls
   `weekly.sh --model <id>`, so it reuses the full weekly sequence for one
   model. A flag does not leak into a test environment, and a variable does
   (EV10).
8. **D8. A failed fetch.** The job stops before the selection when the
   catalog fetch or `opencode models` fails, or when the live list is empty.
   It runs no model and exits non-zero. It writes each fetch to a temporary
   file, and it moves the file into place only on success (EV2).
9. **D9. Lock and time.** The job takes the lock of the weekly cron,
   `.tmp/weekly-cron.lock`. Thus the daily job and a weekly run never run at
   the same time. When the lock is held, the job exits 0 and selects
   nothing. The crontab line is `0 1 * * *`, at 01:00 local time. Each day
   is a UTC date.
10. **D10. What the job publishes.** The job commits only `docs/`, and it
    pushes `origin main`, as `cron-weekly.sh` does. The first line of the
    commit message names the day, the model, and the reason. The body lists
    each unpriced, gone, and unservable model. The job makes no commit when
    `docs/` has no change.

## Functional requirements

### FR-1 — Refresh the model list

- On each new day, the job fetches the catalog and the served list before
  the selection. On a resume, it uses the record of the day.
- The job stops before the selection on a failed fetch, an empty file, a
  file that is not JSON, or an empty live list (D8).
- **Check.** A dry run with an empty catalog file exits non-zero. It prints
  no `DAILY_PICK` line, and it writes no day record. The same check applies
  to a file that is not JSON, to `{"live": []}`, and to an empty served list.

### FR-2 — Candidates

- The candidate list is the live list, less each unpriced model and each
  unservable model (D2, D3).
- The selector output lists `unpriced`, `gone`, `unservable`, and
  `this_week` models by name.
- **Check.** On synthetic inputs, an unpriced live model, a priced model that
  is not live, and a model absent from the served list are never selected.
  Each one appears in its output list.

### FR-3 — Untested model first

- When an eligible candidate is untested, the day's model is untested, by
  the order of rule 4.
- **Check.** On a synthetic runs tree with tested and untested candidates,
  the selector selects the untested candidate with the highest
  `requests_per_month`. An invalid OpenCode run makes a model tested. A Pi
  run does not make a model tested.

### FR-4 — The stalest model

- When no eligible candidate is untested, the day's model has the oldest
  last test date, by rule 5.
- The run date follows the definition. It does not use a directory time.
- **Check.** The selector gives the same result after a change of each
  directory time. A day record that lists a run moves the run date to the day
  of the record. A run with no day record gets the Sunday of its week.

### FR-5 — Tie-break

- Equal last test dates sort by `requests_per_month`, highest first, then by
  id (D5).
- **Check.** Two candidates with the same last test date give the one with
  more requests. With equal requests, they give the lower id.

### FR-6 — One model on each day

- The job writes the day record before the first `batch.sh` call.
- A second run of the job on the same day selects the same model (rule 1).
- A model with an OpenCode run in the week of the day is not eligible
  (rule 3).
- After the batches, the job adds the run ids of the day's model in the week
  of the day to the record.
- **Check.** Two runs of the job on the same day pass the same `--model`
  value to the runner. This stays true after a change of the served list
  between the two runs. A day record that is not valid JSON stops the job
  with a non-zero exit. The job then selects no other model.

### FR-7 — Run one model

- `batch.sh --model <id>` plans only the runs of `<id>` for its track:
  `REPS` times the arms. It needs `<id>` in the price table, not a batch
  model. It does not read the work list.
- `batch.sh` without `--model` keeps its current output.
- `weekly.sh` passes its arguments to each `batch.sh` call.
- **Check.** The dry run of `batch.sh --model glm-5.2` for the build track
  plans 6 run ids, and each id holds the slug `glm-5-2`. An unpriced id
  exits 2 and plans nothing. `BATCH_COMPAT` gives the same hash before and
  after the change.

### FR-8 — Publish

- The job commits only `docs/`, with the message of D10, and pushes it.
- The job publishes nothing when it selects no model.
- **Check.** After the first live day, `PUBLISH_CHECK` passes (test
  strategy). On a day with the reason `none`, `git log` shows no new commit.

### FR-9 — No effect on hashes, work list, or records

- The track changes no file of the runner hash or the suite hash. It does
  not change `plan-work.ts`, `go-cost.ts`, `cron-weekly.sh`, or the price
  table.
- The job creates run directories for the day's model and for canaries only.
- Each legacy Pi record keeps every byte (anti-pattern A13).
- **Check.** `PATH_CHECK`, `BASE_HASH`, `WORKLIST_SHA`, `DAY_CHECK`, and
  `PI_CHECK` of the test strategy.

## Non-functional requirements

- **NFR-1 No other model call.** The job sends a model call for the day's
  model only. The canary runs with `AGENT_SKIP=1`. The catalog fetch and
  `opencode models` list models, and they send no prompt. The tests send no
  model call.
- **NFR-2 Hermetic selection.** The selector output depends only on its
  flags and its input files. `BENCH_TRACK`, `REPS`, and other ambient values
  do not change it (anti-pattern A11).
- **NFR-3 Determinism.** The same inputs give the same output, in the same
  byte order.
- **NFR-4 Fail closed.** Each input fault stops the job before a model run,
  with a non-zero exit and a labeled line.
- **NFR-5 No new dependency.** The selector uses Node built-ins and the
  existing harness modules. The tests use the existing Vitest.
- **NFR-6 Test seams.** `cron-daily.sh` reads `BENCH_RUNS_ROOT`,
  `BENCH_PRICING_PATH`, `BENCH_DAILY_DIR`, `BENCH_DAILY_DATE`,
  `BENCH_DAILY_CATALOG`, `BENCH_DAILY_SERVED`, `BENCH_DAILY_RUNNER`,
  `BENCH_DAILY_PUBLISH`, and `BENCH_DAILY_LOCK`. The tests use them. Without
  them, the job uses the real paths.

## Owner decisions

| ID | Decision | Proposed default | Answer |
|---|---|---|---|
| O1 | Install the daily crontab line. This starts a paid run of 12 agent runs each day and a daily push of `docs/` to GitHub Pages. | Approve after the real-data dry run of task 4.1 passes and `opencode_executor` task 4.2 closes. Spend from EV11: 1.07 USD each day on average, 3.24 USD at the observed maximum. | open — the owner 2026-10-25 chose to approve only after the two prerequisites close |

## Acceptance criteria

1. **AC-1** The selector applies the selection rule on every synthetic case
   of the test strategy (FR-2 to FR-5).
2. **AC-2** A failed or empty fetch stops the job before the selection
   (FR-1).
3. **AC-3** A second run on the same day keeps the day's model (FR-6).
4. **AC-4** `batch.sh --model` plans one model, and `BATCH_COMPAT` is
   unchanged (FR-7).
5. **AC-5** The real-data dry run prints the `DAILY_PICK` line, and the
   independent `PICK_ORACLE` prints the same model, reason, and counts.
6. **AC-6** `PATH_CHECK` passes. `BASE_HASH` and `WORKLIST_SHA` are
   unchanged (FR-9).
7. **AC-7** O1 has a recorded answer and date before the crontab line exists.
8. **AC-8** After the first live day, `DAY_CHECK`, `PUBLISH_CHECK`, and
   `PI_CHECK` pass (FR-8, FR-9).

## Out of scope

- A refresh of the price table, or a price for a model from the endpoint.
- The weekly cron and its crontab line. Both stay off.
- The scoring formula, the axis weights, and `SATURATED_WEIGHT`.
- A site section for the schedule.
- A selection by score or by failure count.
- A rule that tells a host fault from a model fault in a run that is not
  valid.

## Risks

- **R1 A host fault after the preflight.** The runs of the day are not
  valid, and the model counts as tested. It then waits one full rotation, 28
  days today. The canary and the container probe of `opencode_executor` task
  4.2 stop most host faults before the first run directory (D3).
- **R2 Loss of the day records.** `reports/` is not in Git. A loss changes
  each run date to the Sunday of its week (D4). The order then changes inside
  a week only.
- **R3 Spend.** Each day spends up to 12 agent runs (D1). O1 approves it.
- **R4 The push publishes other commits.** `git push origin main` sends every
  local commit of `main`, as `cron-weekly.sh` does. A daily job does this
  each day. Review B checks this path, and O1 states it.
- **R5 Staged site edits of other tracks.** `git add docs/` stages each edit
  under `docs/` in `main`. Track `domain_trust` keeps its page edits on a
  branch until its decision O2 (its NFR-7).
- **R6 A long day.** The worst case is 12 runs at the agent timeout of
  3600 s, plus the grade time. A day that runs past the next 01:00 holds the
  lock. The next job then exits 0, and that day gets no model.
