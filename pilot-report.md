# Pilot report: documentation drift check

Base commit: `c613bc8`. Branch: `pilot/cloud-lending-docs-drift`.

This report uses ASD-STE100 rules. Each sentence has one statement. All line numbers are 1-based.

## 1. Scope

We read these documents:

- `README.md`
- `SCORING.md`
- `docs/methodology.html`
- `docs/tracks.html`

We compared them with this code:

- `harness/score-calculation.ts`
- `harness/track-scoring.ts`
- `harness/score.ts`
- `harness/batch.sh`
- `harness/weekly.sh`

We compared the pages in `docs/models/` with `docs/assets/data/benchmark.json`.

We did not run `export-site-data.py`, `build-report.py`, or `generate-model-pages.py`. We did not change a file. We added only this report.

## 2. Result summary

| Area | Agreements | Mismatches | Claims without support in the listed code |
|---|---|---|---|
| Tracks | 4 tracks, prefixes, track order | 0 | 1 |
| Arms | 2 arms, default `a b` | 0 | 2 |
| Repeats | Default counts, `REPS` override | 1 (schedule and data) | 2 |
| Scoring weights | All 4 weight sets | 1 (comment) | 0 |
| Axes | All axis names and formulas | 4 | 1 |
| Validity rules | Validity fields, `total: null`, gate zero | 2 | 2 |
| Model pages | 14 pages | 9 pages | 0 |

## 3. Mismatches

### M1. "Three times a week" is not what the batch does

The documents say that the build track runs each model three times each week for each arm.

- `README.md:125-126`: "The build track repeats three times a week per arm (`REPS_BUILD`, default 3)".
- `SCORING.md:157-158`: "The build track repeats 3 times a week (`REPS_BUILD`)".
- `docs/methodology.html:110`: "The build track runs each model three times a week per arm."
- `docs/methodology.html:202`: "Three repeats a week reduce single-run noise".

The code uses a work list. The work list holds only "new" and "failing" models.

- `harness/batch.sh:25-27`: the batch runs "only new models (no agent run for this track and arm) and failing models (fewer trusted runs than the track's repeat count)".
- `harness/batch.sh:160-179`: the default path reads the work list from `plan-work.ts --work-list`.
- `harness/plan-work.ts:155-170` (outside the listed set, read for this check): the count of trusted runs includes all weeks. The count does not reset each week.

Thus a model with 3 trusted build runs at the current hashes gets no new run in a later week. The value "3" is a total count of trusted runs, not a count for each week.

The published data agrees with the code, not with the documents. Each current model has one run for each arm in week `2026w43`:

| Model | No Skills `repeats.n` | Skills `repeats.n` |
|---|---|---|
| `deepseek-v4.1-flash` | 1 (`benchmark.json:582`) | 1 (`benchmark.json:940`) |
| `gpt-6-luna` | 1 (`benchmark.json:1683`) | 1 (`benchmark.json:2041`) |
| `minimax-m3.1-flash` | 1 (`benchmark.json:2787`) | 1 (`benchmark.json:3147`) |
| `claude-haiku-5-5` | 1 (`benchmark.json:3893`) | 1 (`benchmark.json:4254`) |

Document value: 3 runs each week. Code value: runs until 3 trusted runs exist in total. Data value: 1 run.

### M2. A valid gate-blocked record is not trusted or publishable

- `README.md:223-224`: "Every valid agent record is trusted and publishable".
- `harness/score.ts:289-290`: `rankable = valid && gatePassed && mode === "agent" && agentIsolated`, and `trusted = rankable`.
- `harness/score.ts:299`: `publishable: trusted`.

A record with a failed typecheck or build is valid (`harness/score.ts:291`, total 0). For this record, `gatePassed` is false. Thus `trusted` and `publishable` are false.

Document value: every valid agent record is trusted. Code value: a valid gate-blocked agent record is not trusted.

Note: `SCORING.md:45-46` says that a gate-blocked result is "never ... ranked". That statement agrees with the code.

### M3. The tests-track "kill" axis is weighted

- `docs/tracks.html:58`: "Kill is the share of defective versions that a valid test catches".
- `harness/score-calculation.ts:385-387`: kill is a weighted sum. Security mutants have weight 2 (`harness/score-calculation.ts:43-45`).

Document value: a plain share of mutants. Code value: a weighted share, with security mutants counted two times.

Note: `SCORING.md:274` gives the weight correctly.

### M4. The change track also removes superseded criteria and probes

- `SCORING.md:295`: "regression = tier-scaled weighted pass rate over the non-M build criteria".
- `SCORING.md:296`: "robustness = probe pass rate".
- `harness/score-calculation.ts:338-340`: the code removes each `superseded` ID from the regression set and from the robustness set.
- `harness/track-scoring.ts:58`: the superseded list comes from the change set (`setSuperseded`).

Document value: all non-M build criteria, and all probes. Code value: all non-M build criteria and all probes, less the superseded IDs.

### M5. A low tier is scaled, not locked, for probes

- `SCORING.md:96-97`: "Each probe carries the tier of the prerequisite it depends on, so a locked tier cannot add adversarial points."
- `harness/score-calculation.ts:164`: each passed probe adds `scale[probe.tier]`.
- `harness/score-calculation.ts:122-126`: the scale is `min(1, rate / 0.9)`. The scale is 0 only when the lower-tier rate is 0.

Document value: a "locked" tier adds no points. Code value: no tier is locked. A tier adds points in proportion to the lower-tier rate.

### M6. The canary is not always the reference, and it can be skipped

- `docs/methodology.html:91`: "before any model run, the harness grades the reference solution. The batch stops unless it scores 100."
- `SCORING.md:34-35`: the canary "must score a valid 100, or the batch stops".
- `harness/batch.sh:341-346`: the canary is the reference only on the build track. The bugfix track uses the clean set. The tests track uses the oracle overlay. The change track uses `reference-change/`.
- `harness/batch.sh:336-337`: `BENCH_CANARY=0` skips the canary. The batch then continues.

Document value: the batch always stops without a canary score of 100. Code value: the batch continues when `BENCH_CANARY=0`.

Note: `README.md:245-246` and `SCORING.md:226-227` give the correct canary for each track and the skip.

### M7. Three different descriptions of the old hard gate

- `docs/methodology.html:117-118`: the hard rule "compressed mid-pack models into a 17-point band".
- `SCORING.md:79-80`: the hard rule "collapsed every near-complete submission into the same ~17-point pile".
- `harness/score-calculation.ts:18-19`: the hard rule collapsed "every model that missed two Tier-0 criteria into the same ~17-point pile".

The three texts name three different groups of models. The code cannot show which text is correct. This is a history claim.

### M8. Code comment: adherence points on the build track

- `harness/score-calculation.ts:69`: adherence gives "up to 10 on the build track".
- `harness/score-calculation.ts:33`: the build adherence weight is `0.15`. The maximum is 15 points.

Comment value: 10. Code value: 15. The value 10 is correct only for the other three tracks (`harness/score-calculation.ts:40`, `:48`, `:52`).

### M9. Code comment: `FORCE=1` and the exact-ID skip

- `harness/batch.sh:28`: "`FORCE=1` restores the full pricing matrix (exact-ID skip still applies)".
- `harness/batch.sh:370`: the skip check runs only when `FORCE` is not `1`, or when a model is pinned.

Comment value: the skip applies with `FORCE=1`. Code value: with `FORCE=1` and no `--model`, the batch does not skip a current trusted score. It runs again.

Note: `README.md:248-249` says that the batch "resumes only current, trusted, publishable records". This statement agrees with the default path only.

### M10. Model pages without data in `benchmark.json`

`benchmark.json` has 4 current models (`models`, line 235) and 11 history models (`history.models`, line 4664). One ID is in both lists. Thus the file has 14 model IDs.

`docs/models/` has 22 model pages. Each page reads its data by `MODEL_ID`. These 8 pages have an ID that is not in `benchmark.json`:

| Page (`MODEL_ID`) | Page result |
|---|---|
| `docs/models/deepseek-v4-flash-vision-exp.html:49` | Error at line 58: "Model not found" |
| `docs/models/deepseek-v4-flash.html:48` | Error at line 56: "Model not found" |
| `docs/models/mimo-v2.5-pro.html:49` | Error at line 58 |
| `docs/models/minimax-m2.5.html:49` | Error at line 58 |
| `docs/models/minimax-m2.7.html:49` | Error at line 58 |
| `docs/models/minimax-m3.html:49` | Error at line 58 |
| `docs/models/omen-alpha.html:49` | Error at line 58 |
| `docs/models/qwen3.6-plus.html:49` | Error at line 58 |

Page value: a model page exists. Data value: no current entry and no history entry.

### M11. One model page uses an old template

`docs/models/deepseek-v4-flash.html` is different from the other 21 pages:

- Lines 17-22: the navigation has no "Tracks" link. The other pages have it (for example `docs/models/omen-alpha.html:22`).
- Line 27: the kicker has no `id`. Thus the page cannot show the "History (not ranked)" label.
- Lines 55-56: the page reads only `data.models`. It does not read `data.history.models`.
- The page shows "Soft score". The other pages show "Score (week median)" and "Worst repeat".

Page value: old template. Other pages: current template with history support.

### Model pages that agree with the data

For the other 14 pages, `MODEL_ID` is in `benchmark.json`. The static `<title>` (line 6) agrees with the `name` field in each case. The current pages are `claude-haiku-5-5`, `deepseek-v4.1-flash`, `gpt-6-luna`, and `minimax-m3.1-flash`. The history pages are `glm-5.3-flash`, `gpt-5.6-luna`, `hy3`, `longcat-2.0`, `mimo-v2.5`, `mimo-v2.6-flash`, `muse-spark-1.2-contributor`, `muse-spark-1.3-contributor`, `qwen3.7-plus`, and `qwen3.8-flash`.

The Skills delta agrees with its pairs. `benchmark.json:36-68` gives a mean of 5.3. The mean of 2.7, 4.2, 5.6, and 8.8 is 5.325.

## 4. Claims that the listed code does not support

The listed code does not contain these values. Some values are in other files. We show those files where we found them. We did not change a file.

| # | Document location | Claim | Status |
|---|---|---|---|
| U1 | `docs/tracks.html:30-31`, `README.md:251-252`, `SCORING.md:159-163` | The site shows the lower median, the worst repeat, the count, an EMA trend, and a 4-week range. | Not in the listed code. The site export does this. We did not run it. |
| U2 | `SCORING.md:160-162`, `docs/methodology.html:112-113` | The Skills effect is the mean of paired medians in a shared week. | Not in the listed code. The data value agrees (see section 3). |
| U3 | `README.md:134` | Run IDs must match `[A-Za-z0-9][A-Za-z0-9_-]{0,79}`. | Not in the listed code. `harness/batch.sh:193` and `:366` make the ID form only. |
| U4 | `README.md:140`, `docs/methodology.html:75`, `docs/methodology.html:156-158` | Arm `b` gets `AGENTS.md` and five named skills. | Not in the listed code. |
| U5 | `docs/methodology.html:80-81` | The executor changed from Pi to OpenCode 2 on 2026-10-25. | No code supports the date. |
| U6 | `SCORING.md:82-83` | "On 29 real r1 runs, 17 criteria passed on 28 or more runs". | History claim. `harness/tests/criteria.ts` has 17 criteria with `SATURATED_WEIGHT` (0.25). The run counts have no support. |
| U7 | `SCORING.md:111` | "Under r1 any violation discarded the whole run (19 build runs)." | History claim. No support. |
| U8 | `SCORING.md:105` | The hard contract classes are symlink, special entry, nested runtime directory, and `.git`. | Not in the listed code. `harness/score.ts:150-152` only makes a non-gradeable contract invalid. |
| U9 | `SCORING.md:130-131` | A "nonlocal" doctor baseline invalidates the score. | `harness/score.ts:258-269` checks a missing, malformed, or invalid baseline. We found no "local" check in `harness/score.ts` or in `loadBaseline` (`harness/doctor.ts`). |
| U10 | `docs/methodology.html:164-167`, `:173` | `react-doctor` 0.9.2; category weights 2.0, 1.5, 1.0, 1.0, 0.5; severity weights 3 and 1; 30 points give zero quality. | Not in the listed code. `harness/doctor.ts:16-28` agrees with all values. |
| U11 | `docs/methodology.html:142` | The Vercel guide has 70 rules in 8 categories. | External claim. No code supports it. |
| U12 | `SCORING.md:267` | The set `m1` has 12 mutants. | Not in the listed code. `harness/tests-track/sets/m1.json` has 12 mutants. |
| U13 | `SCORING.md:200` | The collector rejects missing raw reports. | Not in the listed code. `harness/score.ts:165-175` rejects an invalid `collection.json` only. |
| U14 | `README.md:50`, `SCORING.md:286-288` | The change set `c1` has four requests. | Not in the listed code. `harness/track-scoring.ts:52-58` loads a change set but does not name `c1`. |

## 5. Claims that agree with the code

These claims agree with the listed code. We list them so that a reader can see the full check.

- Tracks and prefixes: `README.md:45-50`, `SCORING.md:9-14`, and `harness/batch.sh:107-112`. Build has no prefix. Bugfix is `bf-`, tests is `tt-`, change is `ch-`.
- Track order: `harness/weekly.sh:71` runs build, bugfix, tests, and change. A failed track does not stop the others (`harness/weekly.sh:72-75`).
- Arms: `harness/batch.sh:101` sets `ARMS` to `a b`. `harness/weekly.sh:17` does the same.
- Default repeat counts: `harness/batch.sh:108-111` gives build 3 and other tracks 1. `REPS` overrides all (`harness/batch.sh:115`). This agrees with `README.md:125-127` and `SCORING.md:157-159`. M1 is about the weekly schedule only.
- Build weights 0.55, 0.20, 0.15, 0.10: `SCORING.md:147-148`, `docs/methodology.html:96`, and `harness/score-calculation.ts:33`.
- Bugfix weights 0.45, 0.20, 0.15, 0.10, 0.10: `SCORING.md:253-254` and `harness/score-calculation.ts:40`.
- Tests weights 0.60, 0.20, 0.10, 0.10: `SCORING.md:278` and `harness/score-calculation.ts:52`.
- Change weights 0.45, 0.25, 0.10, 0.10, 0.10: `SCORING.md:299-300` and `harness/score-calculation.ts:48`.
- Axis names on `docs/tracks.html:52`, `:59`, and `:66` agree with `harness/score-calculation.ts:290`, `:404`, and `:358`.
- Soft tier scale with gate 0.9: `SCORING.md:73-75` and `harness/score-calculation.ts:24`, `:100-105`, `:122-126`.
- Saturated weight 0.25: `SCORING.md:84` and `harness/tests/criteria.ts:11`.
- Contract score `max(0, 1 − 0.5 × classes)`: `SCORING.md:114` and `harness/score-calculation.ts:61-64`.
- Build adherence formula and gate 0.6: `SCORING.md:116` and `harness/score-calculation.ts:71-72`, `:169`.
- Quality gate 0.6 and penalty: `SCORING.md:146` and `harness/score-calculation.ts:175-177`.
- Bug and mutant weight 2 for security: `SCORING.md:247`, `:274`, and `harness/score-calculation.ts:43-45`.
- Bugfix regression and robustness remove detectors and collateral: `SCORING.md:248-250` and `harness/score-calculation.ts:260-266`.
- Tests validity is 0 with no test: `SCORING.md:275` and `harness/score-calculation.ts:388`.
- Criteria count only for the record revision: `SCORING.md:28-30` and `harness/score-calculation.ts:8`, `:158`.
- Validity fields: `README.md:229`, `SCORING.md:168-175`, and `harness/score.ts:297-299`, `:335-336`.
- An invalid record has `total: null`. A gate-blocked record has `total: 0`: `SCORING.md:45-48`, `README.md:232-234`, and `harness/score.ts:291`, `:302`.
- A browser launch error makes the record invalid: `SCORING.md:39`, `:41-42`, and `harness/score.ts:234-242`.
- Missing and orphan result IDs make the record invalid: `README.md:232` and `harness/score.ts:244-247`.
- Churn is recorded and not scored: `SCORING.md:258` and `harness/score.ts:317`.
- Host load does not block a run or change trust: `README.md:220-224` and `harness/score.ts:286-290`.
- Self-check modes `meta`, `logic`, `full`, `skip`: `README.md:244` and `harness/batch.sh:211-223`.
- Model pin with `--model`: `README.md:267` and `harness/batch.sh:52-77`, `:142-155`.

## 6. Recommended actions

These are recommendations only. We did not do them.

1. Correct M1 in `README.md`, `SCORING.md`, and `docs/methodology.html`. Say that the batch runs a model until it has the repeat count of trusted runs.
2. Correct M2 in `README.md:223`. Say that a gate-blocked record is valid but not trusted.
3. Correct M3, M4, M5, and M6 in the documents.
4. Use one description of the old hard gate (M7).
5. Correct the code comments in M8 and M9, or correct the code.
6. Remove the 8 model pages in M10, or add their data. Use the generator for this change.
7. Make `docs/models/deepseek-v4-flash.html` again from the current template (M11).
