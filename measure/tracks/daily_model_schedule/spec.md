# Daily model schedule: one model per day, untested first, then the stalest

Spec format: classic FR list. Track type: feature. Base commit: `aa94185`.

## Summary

The weekly matrix tests every batch model on one night each week. The owner
disabled it on 2026-10-25. This track adds a job that tests one model
on each run day. The run days are Wednesday and Sunday, at 01:00 local time.

On each run day, the job refreshes the model list. It then selects one
model: a model with no test, or else the model with the stalest last test
date. It runs that model through the existing batch path, and it publishes
the site data. The job sends no model call for any other model.

The track changes no scoring rule, no hashed file, and no price. It does not
re-enable the weekly cron.

## Owner requirement

The owner gave this requirement on 2026-10-25:

> We need to set the testing schedule to one model per day. 1. Refresh the model list. 2. Test one untested model if any exists. 3. If no untested models exist, test the model which has the stalest last test date.

The owner gave two more requirements on 2026-10-27. The source is the owner.
The PM orchestrator relayed the words (assignment A-23).

> Lending desk should be running only one models benchmark per day either the new ones that don't have benchmarks or the ones that have the stalest benchmarks.

> Let's only run this twice a week -- on Wednesday and Sunday.

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

- **Run day.** A Wednesday or a Sunday on which the job runs. The job runs
  at 01:00 local time on each run day (D9).
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
   change. This gives 12 agent runs each run day. The weekly matrix used the
   same profile, so a daily result and a weekly result are comparable. From
   EV11, a run day costs 1.07 USD on average and 3.24 USD at the observed
   maximum. At 2 run days per week, the spend is about 2.14 USD on average
   and 6.48 USD at the maximum. The existing variables `ARMS`, `REPS`, and
   `REPS_<TRACK>` still change the profile.
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
   or canary) creates no OpenCode run. The next run day then selects the same
   model again. Each run day's job exits non-zero until the operator removes
   the fault. A host fault is not a result of the model, so it must not move the
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
   then skips each trusted run, and the day gives no new result. Wednesday
   and Sunday of the same ISO week are two run days in one week. Rule 3
   keeps those two run days on two different models.
7. **D7. The entry point.** A new script `harness/cron-daily.sh` holds the
   daily job. A new script `harness/daily-pick.ts` holds the selection rule.
   `batch.sh` gets a flag `--model <id>` that runs one priced model.
   `weekly.sh` passes its arguments to each `batch.sh` call. The first cut
   of the job called `weekly.sh --model <id>` to reuse the full weekly
   sequence for one model. D12 supersedes this: the job now runs the four
   track batches itself, with one Go-guard read before each batch, and it
   runs the other `weekly.sh` steps in the order of D12. A flag does not
   leak into a test environment, and a variable does (EV10).
8. **D8. A failed fetch.** The job stops before the selection when the
   catalog fetch or `opencode models` fails, or when the live list is empty.
   It runs no model and exits non-zero. It writes each fetch to a temporary
   file, and it moves the file into place only on success (EV2).
9. **D9. Lock and time.** The job takes the lock of the weekly cron,
   `.tmp/weekly-cron.lock`. Thus the daily job and a weekly run never run at
   the same time. When the lock is held, the job exits 0 and selects
   nothing. The schedule comes from the systemd user timer of D11. The job
   runs on Wednesday and Sunday at 01:00 local time. Each day is a UTC date.
10. **D10. What the job publishes.** The job commits only `docs/`. It pushes
    that commit only under the push rule of D13. The first line of the
    commit message names the day, the model, and the reason. The body lists
    each unpriced, gone, and unservable model. The job makes no commit when
    `docs/` has no change.
11. **D11. Timer units.** The repository holds two unit files:
    `harness/systemd/lending-desk-daily.service` and
    `harness/systemd/lending-desk-daily.timer`. This path is the one name
    for the unit files in every file of this track. The timer holds
    `OnCalendar=Wed,Sun 01:00:00` (local time) and `Persistent=false`, so a
    missed run never starts at boot and spends Go use at an unplanned time.
    The service is `Type=oneshot`. Its `ExecStart` runs
    `harness/cron-daily.sh` in `/home/daniebo/Desktop/lending-desk-bench`,
    and it appends stdout and stderr to
    `/home/daniebo/Desktop/lending-desk-bench/reports/cron-daily.log`. The
    track commits the two files. It does not install them. The owner
    installs them after task 5.1, after the one manual push of D13, and
    after 2026-11-02 07:00 (the Go week reset). The first run day is
    Wednesday 2026-11-04 at 01:00. `cron-weekly.sh` stays disabled (EV12),
    and no crontab line exists for the daily job.
12. **D12. Go guard.** Before each track batch, the job reads the OpenCode Go
     weekly and monthly windows from one response. The live source is the
     port from `openchamber status --json` (the `port` field of the first
     entry of `instances`), then `GET
     http://127.0.0.1:<port>/api/quota/opencode-go`. The guard reads
     `usage.windows.weekly.usedPercent` first, then
     `usage.windows.monthly.usedPercent`, from that same GET response or the
     same `BENCH_DAILY_QUOTA_CMD` output.
     - Weekly checks run first. A failed read (the status command, the port,
       or the GET) stops the day with reason `read failed`. An absent or null
       weekly field stops the day with reason `missing field`. A weekly value
       that is not a finite JSON number stops the day with reason
       `not a number`. A finite weekly value below 0 stops the day with
       reason `weekly value <n> is below 0`. A weekly value above 80 stops
       the day with reason `weekly used <n> percent`.
     - Monthly checks run only after the weekly value passes. An absent or
       null monthly field stops the day with reason `monthly missing field`.
       A monthly value that is not a finite JSON number stops the day with
       reason `monthly not a number`. A finite monthly value below 0 stops
       the day with reason `monthly value <m> is below 0`. A monthly value
       above 80 stops the day with reason `monthly used <m> percent`.
     - Each stop prints one line `DAILY SKIP go-guard: <reason>`, makes no
       further model call, sets `go_guard_stop` to the exact `<reason>` text,
       and exits 0. A clean read prints
       `DAILY GO-GUARD weekly=<n> monthly=<m>`. The values `<n>` and `<m>`
       are the JSON number text, as the weekly line prints it now. A value
       of 80 continues, and 80.0001 stops, for both windows.
       A value of 0 continues. The job never draws on the paid Go credit
       balance.
    - Test seam: `BENCH_DAILY_QUOTA_CMD`. It names a command that prints the
      quota JSON in place of the live source. The tests set it. Without it,
      the job uses the live source. The guard logic is one shell function in
      `cron-daily.sh`, so the seam replaces only the read.
    - Reads: the job reads the guard before each of the 4 track batches
      (`build`, `bugfix`, `tests`, `change`), in that order. The PM accepted
      this within condition 2 on 2026-10-31. A clean read in the live mode
      prints one line `DAILY GO-GUARD weekly=<n> monthly=<m>`, so a run day shows 4
      such lines when no stop happens.
    - Place of the check: `weekly.sh` runs the 4 tracks in one loop, so the
      per-batch check cannot live there without a change of `weekly.sh`. The
      default place is `cron-daily.sh`: it runs each of the 4 track batches
      itself, as `BENCH_TRACK=<track> harness/batch.sh --model <id>`. It no
      longer calls `weekly.sh`. It runs the full `weekly.sh` sequence, split
      for the guard, in this exact order: (1) the Playwright Chromium check
      of `weekly.sh`, fail closed; (2) the price-marker block, with
      `recost.sh` on a changed table; (3) the hash-marker block, with
      `rescore-doctor.sh WEEK=all` on changed hashes; (4) for each track in
      `build bugfix tests change`: one guard read, then the batch on a clean
      read; (5) `rescore-doctor.sh` with the week of the day; (6)
      `recost.sh`; (7) `export-site-data.py`; (8) `generate-model-pages.py`;
      (9) `cleanup.sh`. `weekly.sh` itself stays unchanged for manual use.
    - A stop mid-day: the job skips the remaining batches. It still runs
      steps (5) to (9), the run list, and the record update, so the site
      matches the runs that ran. It then publishes under D10 and D13, and it
      exits 0. A guard stop is a clean skip, not a failure: the `DAILY FAIL
      runs` rule of D3 does not apply to a stop with zero runs.
    - The day record after a stop holds the run ids of the batches that ran
      before the stop, and the new field `go_guard_stop` with the exact
      `<reason>` text of the stop line. A day with no stop holds
      `go_guard_stop: null`.
    - Dry run: the dry run reads the guard one time, before the batch dry
      runs. On a clean read it prints `DAILY GO-GUARD weekly=<n> monthly=<m>` and then
      the planned run ids and `DAILY DRY-RUN planned=<n>`. On a stop
      condition it prints the `DAILY SKIP go-guard: <reason>` line and
      `DAILY DRY-RUN planned=0`, and it exits 0. The dry run makes no model
      call in any case.
    - Seams for the new order: `BENCH_DAILY_BATCH` replaces
      `harness/batch.sh`; the job calls it as `BENCH_TRACK=<track>
      <batch> --model <id>` (the four batches, and the dry runs in a dry
      run). `BENCH_DAILY_POST=0` skips steps (1) to (3) and (5) to (9); the
      tests use it with a stub batch. `BENCH_DAILY_RUNNER` is retired: the
      job runs the batches itself.
13. **D13. Push rule.** After its own docs commit, the job runs `git fetch
    origin`. It pushes only when `origin/main` equals the parent of its own
    docs commit. The push form is `git push origin <sha>:main`, where
    `<sha>` is the docs commit. The explicit sha keeps the push on the one
    commit that the check passed, even when another commit lands between
    the check and the push. In any other case (another local commit between
    `origin/main` and the docs commit, a moved or unreadable `origin/main`,
    or a failed fetch) the job keeps the commit local, prints one labeled
    line, and exits 0. The line is `DAILY PUSH skipped: <n> other local
    commits`, where `<n>` is `git rev-list --count origin/main..HEAD~1`,
    when `<n>` is at least 1. When `<n>` is 0, the line is
    `DAILY PUSH skipped: origin/main moved`. When the fetch failed, the
    line is `DAILY PUSH skipped: fetch failed`. A failed push after a
    passed check retries 3 times, as today;
    after the third failure the job prints `DAILY FAIL publish: git push
    failed after 3 attempts; the commit is local` and exits 1. Until
    Daniel's one manual push (task 5.1), `origin/main` trails the merged
    branch, so this rule skips every job push. After that push, the rule
    sends only the job's own docs commit.
14. **D14. Selector exit.** The selector exits 0 for a pick or a resume, 3
    for no eligible model, and 2 for an input fault (5.1 of the test
    strategy). Any other exit is a failure: the job prints `DAILY FAIL pick:
    the selector exited <n>` on stderr and exits with the same non-zero
    code. It runs no model (Review C finding 2, `cron-daily.sh:151`).

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

- The job commits only `docs/`, with the message of D10. It pushes only
  under the push rule of D13 (FR-11).
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

### FR-10 — Go guard

- The job reads Go weekly and monthly values from one response before each
  of the 4 track batches (D12). A value above 80 or a finite value below 0
  stops the day for either window. Weekly checks run first; monthly checks
  run only after weekly passes. A failed read, missing field, or non-finite
  value also stops the day: no further model call, one
  `DAILY SKIP go-guard: <reason>` line, exit 0.
- A stop mid-day keeps the runs that ran. The day record holds their run
  ids and `go_guard_stop` with the reason. The job never draws on the paid
  Go credit balance.
- **Check.** With a stub `BENCH_DAILY_QUOTA_CMD`, test each weekly and
  monthly stop reason, including the weekly below-0 reason. A stop before
  the first batch gives exit 0, the skip line, and no batch call. A monthly
  stop before the third batch keeps the first two batches' run ids and sets
  `go_guard_stop`. Values 80 and 0 continue, and 80.0001 stops for both
  windows. A clean read prints the weekly and monthly guard line. A dry-run
  monthly stop prints the skip line, plans zero runs, exits 0, and makes no
  model call.

### FR-11 — Push rule

- After its docs commit, the job fetches `origin` and pushes only when
  `origin/main` equals the parent of that commit, as `git push origin
  <sha>:main` (D13). Any other case keeps the commit local, prints one
  `DAILY PUSH skipped: <reason>` line, and exits 0.
- **Check.** In a temporary Git repository: with `origin/main` at the
  parent, the push runs and `origin/main` moves to the docs commit only;
  with one other local commit between, the job prints
  `DAILY PUSH skipped: 1 other local commits`, pushes nothing, and exits 0;
  with a failed fetch, the job prints `DAILY PUSH skipped: fetch failed`
  and exits 0.

### FR-12 — Selector exit

- Any selector exit other than 0 and 3 is a failure: `DAILY FAIL pick: the
  selector exited <n>` on stderr, and a non-zero exit (D14). The job runs
  no model.
- **Check.** A selector stub that exits 1 gives the fail line, exit 1, no
  batch call, and no day record change. Exit 2 keeps its current behavior.
  Exit 3 keeps the `none` path.

### FR-13 — Timer unit files

- The repository holds `harness/systemd/lending-desk-daily.service` and
  `harness/systemd/lending-desk-daily.timer` (D11). The timer holds
  `OnCalendar=Wed,Sun 01:00:00` and `Persistent=false`. The service runs
  `harness/cron-daily.sh` and appends to `reports/cron-daily.log`. The
  track installs nothing.
- **Check.** `TIMER_CHECK` (test strategy) reads the two files and asserts
  each named value. No systemd unit is installed and no crontab line exists
  before the owner action of task 5.3.

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
  with a non-zero exit and a labeled line. The Go guard of D12 is a clean
  skip, not an input fault: it exits 0 with its own labeled line, as the
  owner condition 2 states.
- **NFR-5 No new dependency.** The selector uses Node built-ins and the
  existing harness modules. The tests use the existing Vitest.
- **NFR-6 Test seams.** `cron-daily.sh` reads `BENCH_RUNS_ROOT`,
  `BENCH_PRICING_PATH`, `BENCH_DAILY_DIR`, `BENCH_DAILY_DATE`,
  `BENCH_DAILY_CATALOG`, `BENCH_DAILY_SERVED`, `BENCH_DAILY_PUBLISH`,
  `BENCH_DAILY_LOCK`, `BENCH_DAILY_QUOTA_CMD` (the guard source),
  `BENCH_DAILY_BATCH` (the batch command, default `harness/batch.sh`),
  `BENCH_DAILY_SELECT`, and `BENCH_DAILY_POST` (`0` skips the Playwright
  check, the two marker blocks, and the five post-batch steps).
  Each seam (`BENCH_DAILY_QUOTA_CMD`, `BENCH_DAILY_BATCH`, and
  `BENCH_DAILY_SELECT`) is the path of one executable, with no arguments.
  `BENCH_DAILY_RUNNER` is retired: the job runs the batches itself (D12).
  The tests use the seams. Without them, the job uses the real paths and
  commands.

## Owner decisions

| ID | Decision | Proposed default | Answer |
|---|---|---|---|
| O1 | Install the systemd user timer of D11 (unit files `harness/systemd/lending-desk-daily.service` and `harness/systemd/lending-desk-daily.timer`, `OnCalendar` Wednesday and Sunday 01:00 local time, `Persistent=false`). This starts a paid run of 12 agent runs on each run day. The run days are Wednesday and Sunday. The job pushes its own `docs/` commit under the push rule of D13. Spend is 1.07 USD per run day on average and 3.24 USD at the observed maximum. The week has about 2 run days. | Approve after the real-data dry run of task 4.1 passes and `opencode_executor` task 4.2 closes. Spend from EV11: 1.07 USD each run day on average, 3.24 USD at the observed maximum. | approved 2026-10-31 — Daniel answered "Approve with conditions" (Tasks, 2026-10-31 12:01 ICT, relayed by the PM orchestrator), with 3 conditions, exact in quotation: (1) "A systemd user timer, not a crontab line (house rule: every scheduled job is a systemd user unit + timer). Same schedule: Wednesday and Sunday 01:00. Use Persistent=false, so a missed run never starts at boot and spends Go use at an unplanned time. Put the .service and .timer files in your repo; do not install them yet." (2) "Go guard: the job skips a run day (exit 0, one clear log line, no model call) when the OpenCode Go weekly window is above 80 %, or when it cannot read the window. Read it from OpenChamber: port from `openchamber status --json`, GET /api/quota/opencode-go, usage.windows.weekly.usedPercent. The job must never draw on the paid Go credit balance." (3) "Push: no push by the job until one manual push. After your merge (task 5.1), tell me the commit range; I scan it for secrets, then Daniel says \"push\" once. After that, the job pushes only its own docs commit." Within condition 2 the PM also accepted (2026-10-31): "read the Go guard again before each of the 4 track batches, and stop the day at the first reading above 80 % or at an unreadable window. Log one line for each stop." Rules: D11, D12, D13, D14. Timing (PM): the owner installs after task 5.1, after the secret scan and the one manual push, after the selector exit fix (D14), and after 2026-11-02 07:00 (the Go week reset). First run day: Wednesday 2026-11-04 01:00. Orchestrator default amendment within condition 2: include the monthly window. The default was sent to the PM on 2026-10-31, and the PM recommended it. No owner answer had arrived when this change started. |

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
7. **AC-7** O1 has a recorded answer and date before the systemd timer
   units are installed (FR-13, D11). The units stay uninstalled until the
   owner action of task 5.3.
8. **AC-8** After the first live day, `DAY_CHECK`, `PUBLISH_CHECK`, and
   `PI_CHECK` pass (FR-8, FR-9).
9. **AC-9** The Go guard reads weekly and monthly values from one response.
   Either window stops the day above 80 or below 0. Weekly checks run first;
   monthly checks run only after weekly passes. Read failure, missing field,
   or non-finite value stops the day with its specified reason: exit 0, one
   `DAILY SKIP go-guard` line, and no model call after the stop (FR-10).
10. **AC-10** The job pushes only its own docs commit, and only when
    `origin/main` equals its parent. Every other case prints one
    `DAILY PUSH skipped` line and exits 0 (FR-11).
11. **AC-11** A selector exit other than 0 and 3 prints `DAILY FAIL pick`
    and exits non-zero (FR-12).
12. **AC-12** The two unit files exist in the repository with the values of
    D11, and `TIMER_CHECK` passes (FR-13).

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
- **R3 Spend.** Each run day spends up to 12 agent runs (D1). O1 approved
  it on 2026-10-31 with 3 conditions. The Go guard of D12 stops a run day
  when either window is above 80 percent or below 0, so the job never draws on the paid
  Go credit balance.
- **R4 The push publishes other commits.** The old `git push origin main`
  sent every local commit of `main`. D13 removes this path: the job pushes
  only when `origin/main` equals the parent of its own docs commit, and it
  pushes that commit by sha. Until the one manual push of task 5.1, every
  job push skips. Review B checks this path.
- **R5 Staged site edits of other tracks.** `git add docs/` stages each edit
  under `docs/` in `main`. Track `domain_trust` keeps its page edits on a
  branch until its decision O2 (its NFR-7).
- **R6 A long run day.** The worst case is 12 runs at the agent timeout of
  3600 s, plus the grade time. The next run day follows after at least two
  days (Wednesday to Sunday, Sunday to Wednesday). A run day that still
  holds the lock at the next run day makes that job exit 0. That next run
  day then gets no model.
- **R7 Overrun inside one track batch.** The guard reads both windows only
   between batches (D12). Either window can pass the 80 percent line during
   one batch. The guard stops either finite value below 0. The build batch
  holds up to 6 agent runs, so up to 0.53 USD on average and 1.62 USD at
  the observed maximum (EV11) can land above the line before the next read
  stops the day. The margin is one batch. It stays an open risk: the owner
  condition names the read points between the 4 batches, and a read inside
  a batch would need a change of `batch.sh`, which this track does not do.
