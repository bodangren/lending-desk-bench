# Test strategy — daily_model_schedule

This strategy tells Red, Green, the reviewers, the adversarial role, and the
orchestrator how the run-day schedule is proved. Spec: `spec.md`. Plan:
`plan.md`. Independent oracle: `pick-oracle.py`.

## 1. Scope and risk

The product of this track is an unattended job that spends money and
publishes a site on each run day. A run day is Wednesday or Sunday, at
01:00 local time. A wrong job runs the wrong model, runs too many
models, stops on one model for ever, or publishes the wrong files.

| Risk | Effect | Defense |
|---|---|---|
| The job selects two models on one day | Double spend, and the owner rule breaks | Rule 1 (resume) and the day record before the first batch; cases 6.3.4 and 6.3.5; `DAY_CHECK` |
| The job runs a model other than the day's model | Spend on a model that nobody selected | `batch.sh --model`; cases 6.2.1 and 6.2.6; `DAY_CHECK` |
| The job selects an unservable model | The job fails on each run day on the same model (spec EV3) | The served filter; case 6.1.11; adversarial case 12.4 |
| A directory time decides the stalest model | A regrade makes an old model look fresh (spec EV6) | The run date rule; case 6.1.5 |
| An empty or failed fetch feeds the selection | A model run from a stale or empty list (spec EV2) | Cases 6.1.18 and 6.3.2–6.3.3; `DAILY FAIL` line |
| The track changes a hashed file | `plan-work.ts` schedules paid runs for every model | `PATH_CHECK`, `BASE_HASH`, `WORKLIST_SHA` |
| The unpinned batch changes | The weekly path and its meta tests break | `BATCH_COMPAT`; `npm run test:meta:logic` |
| A new variable leaks into the meta tests | A false test result (spec EV10, A11) | A flag instead of a variable; cases 6.1.19 and 6.2.8 |
| The publish commit holds files outside `docs/` | A deploy of private or unrelated files | `PUBLISH_CHECK`; Review B |
| The job starts without owner consent | Paid runs and deploys with no approval | O1 with a date before `CRON_CHECK` (A2) |
| A recost changes a legacy Pi record | The history loses its byte identity, and Git does not see it (A13) | `PI_SHA` and `PI_CHECK` |

## 2. The phase base

The strategy role does not commit. The orchestrator commits `spec.md`,
`plan.md`, `test-strategy.md`, `pick-oracle.py`, `metadata.json`,
`index.md`, and the registry rows in one commit (plan task 1.1).

The orchestrator captures `PHASE_BASE` at this exact point:

1. Commit the task 1.1 files in `main`.
2. Do not make another commit in `main` before step 3.
3. Run `git rev-parse HEAD` in `main`. This is `PHASE_BASE`.
4. Create the worktree branch from `PHASE_BASE` (plan task 1.2).
5. Record `PHASE_BASE` in plan task 1.2. Never change it after this step.

`PHASE_BASE` must hold the committed strategy. This command must print
`PHASE_BASE=ok`:

```bash
git merge-base --is-ancestor "$(git log -1 --format=%H -- measure/tracks/daily_model_schedule/test-strategy.md)" "$PHASE_BASE" && git diff --quiet "$PHASE_BASE" -- measure/tracks/daily_model_schedule/test-strategy.md && echo PHASE_BASE=ok
```

The strategy embeds no SHA, because no commit holds it yet. The base commit
`aa94185` of the spec is the state before the strategy, and it is not
`PHASE_BASE`. For a role gate, `--baseline` is the HEAD of the branch before
the role starts.

## 3. Gate commands

Run each command from the root of the tree that the line names. "Worktree"
is `../lending-desk-bench-daily` on the branch `daily-schedule`.

- `SCHEDULE_TEST` (worktree, and `main` after the merge):
  `cd harness && npx vitest run schedule-tests/daily-schedule.test.ts`.
  It is the `RED_TEST_COMMAND` of Phase 2 and the `GREEN_TEST_COMMAND` of
  Phase 3. Read the result from the labeled Vitest lines `Test Files` and
  `Tests`, never from a bare digit (A3).
- `META_LOGIC` (worktree after Green, and `main` after the merge):
  `cd harness && npm run test:meta:logic`. It must exit 0. The
  `bench-incremental` meta tests run `batch.sh` dry runs, so they also guard
  the unpinned batch.
- `RED_PATH_CHECK` (worktree, Phase 2):

  ```bash
  test -n "$(git diff --name-only "$PHASE_BASE" HEAD -- harness/schedule-tests/)" && test -z "$(git diff --name-only "$PHASE_BASE" HEAD | grep -vE '^(harness/schedule-tests/[^/]+\.test\.ts|measure/.+)$')" && echo RED_PATH_CHECK=pass
  ```

- `PATH_CHECK` (worktree, Phase 3 and later):

  ```bash
  test -n "$(git diff --name-only "$PHASE_BASE" HEAD -- harness/daily-pick.ts)" && test -z "$(git diff --name-only "$PHASE_BASE" HEAD | grep -vE '^(harness/(daily-pick\.ts|cron-daily\.sh|batch\.sh|weekly\.sh|schedule-tests/[^/]+\.test\.ts)|README\.md|measure/.+)$')" && echo PATH_CHECK=pass
  ```

- `BASE_HASH` (`main` only): `cd harness && npx tsx provenance.ts --shell`.
  It prints the runner hash and the suite hash. On 2026-10-25 at `aa94185`,
  it printed
  `3e5a4c64c9bcd0b30d6143389c8e96b9a80d955681df7b072c394db937ab29ea` and
  `451652e5e03ee1d3030014c527bff7714740b96a38756853d5fc68276c522ae6`.
- `WORKLIST_SHA` (`main` only). Measure it just before and just after the
  merge, with no run between the two measurements.

  ```bash
  cd harness && out="$(env -u BENCH_TRACK -u REPS -u REPS_BUILD -u REPS_BUGFIX -u REPS_TESTS -u REPS_CHANGE npx tsx plan-work.ts --all 2>/dev/null)" && n=$(printf '%s' "$out" | jq -e '.classifications | length') && test "$n" -gt 0 && echo "WORKLIST_ROWS=$n" && printf '%s' "$out" | jq -S . | sha256sum | sed 's/ .*//; s/^/WORKLIST_SHA=/'
  ```

  On 2026-10-25, it printed `WORKLIST_ROWS=120` and
  `WORKLIST_SHA=2f5e65d6cf5df4aa2dc8e5f42d4650ced3040fc77903a1d7c06c395e59a61a28`.
  A new run changes this value. Thus only the pair around the merge proves
  FR-9.
- `BATCH_COMPAT` (any tree). It runs the unpinned dry run of each track over
  an empty runs root and the real price table. It stops when the count of
  planned runs is not 180.

  ```bash
  d=$(mktemp -d) && mkdir "$d/runs" && for t in build bugfix tests change; do env -u REPS -u REPS_BUILD -u REPS_BUGFIX -u REPS_TESTS -u REPS_CHANGE -u FORCE BENCH_TRACK=$t BENCH_DRY_RUN=1 BENCH_RUNS_ROOT="$d/runs" WEEK=2026w50 ARMS="a b" bash harness/batch.sh --dry-run; done > "$d/raw.txt" 2>&1; sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}[+-][0-9]{2}:[0-9]{2}/<ts>/g' "$d/raw.txt" > "$d/out.txt"; n=$(grep -c 'DRY-RUN START' "$d/out.txt"); test "$n" -eq 180 && echo "BATCH_COMPAT_RUNS=$n" && sha256sum < "$d/out.txt" | sed 's/ .*//; s/^/BATCH_COMPAT=/'; rm -rf "$d"
  ```

  On 2026-10-25 in `main` at `aa94185`, it printed `BATCH_COMPAT_RUNS=180`
  and
  `BATCH_COMPAT=b492c77c29fe854f1edae945ed5842974acd5bcc83331ec10aa6e4cb13cfeed7`.
  A change of the price table changes the value. Then the orchestrator
  measures the base again on the new table.
- `PICK_ORACLE` and `PICK_MATCH` (`main` after the merge). Fetch the inputs
  one time, then give the same files to both sides:

  ```bash
  mkdir -p .tmp && day=$(date -u +%F) && (cd harness && npx tsx go-cost.ts --catalog) > .tmp/daily-catalog.tmp && mv .tmp/daily-catalog.tmp .tmp/daily-catalog.json && opencode models > .tmp/daily-served.tmp && mv .tmp/daily-served.tmp .tmp/daily-served.txt && a=$(BENCH_DAILY_CATALOG=$PWD/.tmp/daily-catalog.json BENCH_DAILY_SERVED=$PWD/.tmp/daily-served.txt BENCH_DAILY_DATE=$day BENCH_DAILY_PUBLISH=0 bash harness/cron-daily.sh --dry-run 2>&1 | sed -n 's/^DAILY_PICK //p') && b=$(python3 -I measure/tracks/daily_model_schedule/pick-oracle.py .tmp/daily-catalog.json .tmp/daily-served.txt harness/go-pricing.json runs reports/daily "$day" | sed -n 's/^PICK_ORACLE //p') && test -n "$a" && test "$a" = "$b" && echo "PICK_MATCH=pass $a"
  ```

- `SELECTOR_MATCH` (worktree, plan task 3.2). It compares the selector
  directly with the oracle, before `cron-daily.sh` exists. The worktree
  `runs` link gives the real runs tree.

  ```bash
  mkdir -p .tmp && day=$(date -u +%F) && (cd harness && npx tsx go-cost.ts --catalog) > .tmp/daily-catalog.tmp && mv .tmp/daily-catalog.tmp .tmp/daily-catalog.json && opencode models > .tmp/daily-served.tmp && mv .tmp/daily-served.tmp .tmp/daily-served.txt && a=$(cd harness && npx tsx daily-pick.ts --catalog ../.tmp/daily-catalog.json --served ../.tmp/daily-served.txt --date "$day" --runs-root ../runs --day-dir ../reports/daily 2>&1 >/dev/null | sed -n 's/^DAILY_PICK //p') && b=$(python3 -I measure/tracks/daily_model_schedule/pick-oracle.py .tmp/daily-catalog.json .tmp/daily-served.txt harness/go-pricing.json runs reports/daily "$day" | sed -n 's/^PICK_ORACLE //p') && test -n "$a" && test "$a" = "$b" && echo "SELECTOR_MATCH=pass $a"
  ```

- `DOCS_CHECK` (worktree, plan task 4.1; A5, A6). It reads the README
  section, and it rejects a claim that the schedule is active.

  ```bash
  python3 -I - README.md <<'PY'
  import re, sys
  text = open(sys.argv[1]).read()
  m = re.search(r"^## Daily model schedule\n(.*?)(?=^## |\Z)", text, re.S | re.M)
  assert m, "DOCS_CHECK=fail no section"
  sec = m.group(1)
  for w in ("harness/cron-daily.sh", "harness/daily-pick.ts", "--model", "reports/daily/", "harness/go-pricing.json", "https://opencode.ai/docs/go/", "cron-weekly.sh", "owner", "Wednesday", "Sunday", "0,3"):
      assert w in sec, f"DOCS_CHECK=fail missing {w}"
  assert not re.search(r"\b(is|now) (active|enabled|live)\b", sec, re.I), "DOCS_CHECK=fail activation claim"
  print("DOCS_CHECK=pass")
  PY
  ```

- `PI_SHA <name>` (`main`; A13). It stops on an empty Pi list. It writes
  `measure/runs/daily_model_schedule/pi-<name>.txt`.

  ```bash
  mkdir -p .tmp measure/runs/daily_model_schedule && for p in runs/*/artifacts/provenance.json; do jq -e '.executor.pi | type == "object"' "$p" >/dev/null 2>&1 && echo "${p%/provenance.json}"; done | LC_ALL=C sort > .tmp/daily-pi-artifacts.txt; test -s .tmp/daily-pi-artifacts.txt && { echo "PI_RUNS=$(wc -l < .tmp/daily-pi-artifacts.txt)"; while read -r a; do for f in score.json results.json provenance.json; do if [ -f "$a/$f" ]; then sha256sum "$a/$f"; fi; done; done < .tmp/daily-pi-artifacts.txt | sha256sum | sed 's/ .*//; s/^/PI_SHA=/'; } | tee measure/runs/daily_model_schedule/pi-<name>.txt
  ```

  On 2026-10-25, it gave `PI_RUNS=95` and
  `PI_SHA=cbb545a856d936c4ea4200ed4e8841362badc31fdd19a4962408e31bd2f297ca`.
  This value differs from the `domain_trust` value, because this command
  sorts in byte order.
- `PI_CHECK <a> <b>` (`main`):

  ```bash
  grep -qE '^PI_RUNS=[1-9][0-9]*$' measure/runs/daily_model_schedule/pi-<a>.txt && grep -qE '^PI_SHA=[0-9a-f]{64}$' measure/runs/daily_model_schedule/pi-<a>.txt && cmp -s measure/runs/daily_model_schedule/pi-<a>.txt measure/runs/daily_model_schedule/pi-<b>.txt && echo PI_CHECK=pass
  ```

- `DAY_CHECK <day>` (`main`, after the first live day). Before the day, the
  orchestrator runs `ls runs > .tmp/daily-runs-before.txt`.

  ```bash
  python3 -I - "<day>" <<'PY'
  import json, os, sys
  day = sys.argv[1]
  rec = json.load(open(f"reports/daily/{day}.json"))
  before = set(open(".tmp/daily-runs-before.txt").read().split())
  new = sorted(set(os.listdir("runs")) - before)
  assert new, "DAY_CHECK=fail no new run directory"
  models, harness, agent = set(), 0, []
  for n in new:
      if n.startswith("canary-"):
          harness += 1
          continue
      pv = json.load(open(f"runs/{n}/artifacts/provenance.json"))
      if pv["model"].startswith("local/"):
          harness += 1
          continue
      models.add(pv["model"].rsplit("/", 1)[-1])
      agent.append(n)
  assert models == {rec["model"]}, f"DAY_CHECK=fail models {sorted(models)}"
  assert 1 <= len(agent) <= 12, f"DAY_CHECK=fail runs={len(agent)}"
  assert sorted(rec["run_ids"]) == agent, "DAY_CHECK=fail run_ids"
  print(f"DAY_CHECK=pass model={rec['model']} runs={len(agent)} harness={harness}")
  PY
  ```

- `PUBLISH_CHECK <day>` (`main`, after the first live day):

  ```bash
  c=$(git log -1 --format=%H --grep="^Publish daily <day> ") && test -n "$c" && test -z "$(git show --name-only --format= "$c" | grep -v '^docs/')" && git log -1 --format=%s "$c" | grep -qE '^Publish daily [0-9]{4}-[0-9]{2}-[0-9]{2} OpenCode Go results: [a-z0-9][a-z0-9.-]* \((untested|stalest)\)\.$' && git branch -r --contains "$c" | grep -q 'origin/main' && echo "PUBLISH_CHECK=pass $c"
  ```

- `CONSENT_CHECK` (A2): the O1 row of `spec.md` holds `approved` and a date.
  `rg -n '^\| O1 \|.*\| approved 20[0-9]{2}-[0-9]{2}-[0-9]{2}' measure/tracks/daily_model_schedule/spec.md`
  prints 1 line.
- `CRON_CHECK`: the run-day line exists one time, and no active line runs
  `cron-weekly.sh`.

  ```bash
  test "$(crontab -l | grep -cxF '0 1 * * 0,3 /home/daniebo/Desktop/lending-desk-bench/harness/cron-daily.sh >> /home/daniebo/Desktop/lending-desk-bench/reports/cron-daily.log 2>&1')" -eq 1 && ! crontab -l | grep -qE '^[[:space:]]*[^#[:space:]].*cron-weekly\.sh' && echo CRON_CHECK=pass
  ```

- `STATUS_CHECK` (A12): run it from the root of the tree whose plan changed.

  ```bash
  p=measure/tracks/daily_model_schedule/plan.md; b=$(grep -c '^- \[b\]' "$p"); w=$(grep -c '^- \[~\]' "$p"); s=$(python3 ~/.agents/skills/measure-orchestrator/scripts/measure_interphase_checks.py status --repo . --track '^daily_model_schedule$') && { [ "$b" -eq 0 ] || { [ "$w" -eq 1 ] && printf '%s\n' "$s" | grep -qx 'closeout_candidates: 0'; }; } && echo "STATUS_CHECK=pass blocked=$b open=$w"
  ```

## 4. Test layers and owners

| Layer | File or command | Writer | What it proves | Kind |
|---|---|---|---|---|
| Selector cases | `harness/schedule-tests/daily-schedule.test.ts`, block "selector" | Red | FR-2 to FR-5, NFR-2, NFR-3 | live behavior |
| Batch pin cases | the same file, block "batch pin" | Red | FR-7 | live behavior |
| Job cases | the same file, block "daily job" | Red | FR-1, FR-6 | live behavior |
| Contract text cases | the same file, block "artifacts" | Red | `weekly.sh` passes `"$@"`; the self-check scrub list is unchanged | artifact |
| Compatibility | `BATCH_COMPAT`, `META_LOGIC` | Green, orchestrator | The unpinned path is unchanged | live behavior |
| Hash and path guards | `PATH_CHECK`, `BASE_HASH`, `WORKLIST_SHA` | Green, orchestrator | FR-9 | artifact |
| Oracle cross-check | `SELECTOR_MATCH` | Green | The selector equals `pick-oracle.py` on the real runs tree | live behavior, no model call |
| Operator docs | `DOCS_CHECK` | Green | The README section of plan task 4.1 | artifact |
| Real-data pick | `PICK_MATCH` | Orchestrator | AC-5 on the real runs tree, through the job | live behavior, no model call |
| Live day | `DAY_CHECK`, `PUBLISH_CHECK`, `PI_CHECK`, `CRON_CHECK` | Orchestrator | FR-6 to FR-9 on a real day | live behavior, paid |
| Adversarial cases | the same test file, block "adversarial" | Adversarial role | Section 12 | live behavior |

The test file sits outside `harness/tests/`, so it changes no suite hash
(spec EV8). Vitest collects it with the existing `harness/vitest.config.ts`.
No test sends a model call, a network request, a push, or a write outside its
temporary root.

## 5. Interfaces

Red writes the tests against these names. Each Red failure names one of
them.

### 5.1 `harness/daily-pick.ts`

- Selection mode:
  `tsx daily-pick.ts --catalog <file> --served <file> --date <YYYY-MM-DD> [--runs-root <dir>] [--pricing <file>] [--day-dir <dir>]`.
  The defaults are `<repo>/runs`, `harness/go-pricing.json`, and
  `<repo>/reports/daily`. A missing day directory means that no day record
  exists. It is not an input fault.
- Run-list mode: `tsx daily-pick.ts --day-runs <id> --week <YYYYwWW> [--runs-root <dir>] [--pricing <file>]`.
  It prints a JSON array of the sorted run ids of the OpenCode runs of `<id>`
  with that week token.
- The selector reads no environment value (NFR-2). It reads only its flags
  and files.
- Exit 0 for a pick or a resume, 3 for no eligible model, and 2 for an
  input fault. An input fault prints `daily-pick: <reason>` on stderr.
- Stdout of the selection mode: one JSON object.

  ```json
  {
    "schema": 1,
    "date": "2026-10-26",
    "week": "2026w44",
    "model": "hy4-preview",
    "reason": "untested",
    "last_test": null,
    "counts": { "live": 38, "candidates": 28, "eligible": 28, "untested": 11 },
    "excluded": { "unpriced": [], "gone": [], "unservable": [], "this_week": [] },
    "order": [{ "model": "hy4-preview", "last_test": null, "requests_per_month": 6770 }]
  }
  ```

  - `unpriced` is the live list less the price table. `gone` is the price
    table less the live list. `unservable` holds the priced live models that
    the served list does not hold. `this_week` holds the candidates with a
    run in the week of the day. Each list sorts in byte order.
  - `order` holds each eligible candidate in the order of rules 4 and 5.
  - For a resume, the object is `{schema, date, week, model, reason: "resume"}`.
  - For no pick, `model` and `last_test` are `null`, and `reason` is `none`.
- Stderr of the selection mode: one labeled line.
  `DAILY_PICK date=<day> model=<id|none> reason=<untested|stalest|none> last_test=<day|none> candidates=<n> eligible=<n> untested=<n>`.
  For a resume: `DAILY_PICK date=<day> model=<id> reason=resume`. The text
  after `DAILY_PICK ` equals the text after `PICK_ORACLE ` for the same
  inputs.
- Ids compare in byte order (`a < b`), not with `localeCompare`.
- A served model is an exact line `<provider>/<id>`. A substring match is a
  defect.

### 5.2 `harness/batch.sh --model <id>`

- The id must be a key of the price table at `BENCH_PRICING_PATH`. It must
  match `^[a-z0-9][a-z0-9.-]*$`. Else the batch exits 2 and plans nothing.
- The model line is `<provider>|<id>|<slug>`. The slug replaces each `.`
  with `-`, as `slugifyModelId` does.
- The batch prints `PINNED MODEL <id>` in place of the `WORK LIST` line. It
  ignores `FORCE` and the work list. All other steps stay: the dry run, the
  self-check, the preflight on this model, the canary, and the skip of a
  current trusted score.
- Without `--model`, the output stays byte-equal (`BATCH_COMPAT`).
- `weekly.sh` calls `./batch.sh "$@"` for each track.

### 5.3 `harness/cron-daily.sh [--dry-run]`

- The owner crontab line is `0 1 * * 0,3`. It starts the job on Wednesday
  and Sunday at 01:00 local time. The script does not install the line.
- Order: toolchain, lock, day record check, catalog fetch, served list,
  selection, day record write, runner, run list, publish.
- The seams of spec NFR-6. `BENCH_DAILY_RUNNER` defaults to
  `harness/weekly.sh`. `BENCH_DAILY_PUBLISH=0` skips the commit and the push.
  `BENCH_DAILY_LOCK` defaults to `.tmp/weekly-cron.lock`.
- The job calls the runner as `<runner> --model <id>`, with `WEEK` set to
  the ISO week of the day.
- Labeled lines: `DAILY START`, `DAILY SKIP lock held`,
  `DAILY FAIL <step>: <reason>`, `DAILY_PICK ...`, `DAILY RUNNER exit=<n>`,
  `DAILY RUNS <n>`, `DAILY PUBLISH <sha|skipped|none>`, `DAILY END`.
  The job prints the `DAILY_PICK` line of the selector one time, and it
  prints no other line with that label.
- The dry run prints `DAILY_PICK` and each planned run id of
  `batch.sh --model <id> --dry-run` for the four tracks. It then prints
  `DAILY DRY-RUN planned=<n>`. It writes no day record and no file under
  `reports/`, and it calls no runner.

### 5.4 Day record `reports/daily/<day>.json`

- The selector object, plus `run_ids` (an array) and `runner_exit` (an
  integer or `null`).
- The job writes it to a temporary file, and it renames the file into place.
  It writes it before the runner with `run_ids: []`. It writes it again after
  the runner with the output of the run-list mode.
- A day record that is not valid JSON, or that has no `date` string or no
  `run_ids` array, is an input fault (exit 2).

## 6. Synthetic cases

Each case builds a temporary root with `runs/`, a price table, a catalog
file, a served file, and a day directory. A run is
`runs/<id>/artifacts/provenance.json` with `executor`, `model`, `arm`, and
`track`. Each case states the full expected output: the model, the reason,
the last test date, the counts, and the excluded lists. Thus each case
fails on any other output.

Each spawn gets an explicit environment: `PATH`, `HOME`, and the values of
the case. It never spreads `process.env` (A11).

### 6.1 Selector

1. **Untested first.** A is tested, B is untested with 50 requests, and C is
   untested with 80 requests. Expect C, `untested`, `last_test` `null`, and
   `untested` 2. A pick of A or B fails the case.
2. **Untested tie.** Two untested models with equal requests. Expect the
   lower id in byte order.
3. **Stalest.** No untested model. A has its latest run in 2026w40, and B in
   2026w42. Expect A, `stalest`, and `last_test` `2026-10-04`.
4. **Stalest tie.** Equal last test dates. Expect the model with more
   requests. With equal requests, expect the lower id.
5. **Directory time.** Case 3, after the test sets the directory times of
   A to now and of B to 2020-01-01. Expect A again. This case falsifies a
   rule that reads a directory time (spec EV6).
6. **Day record date.** A and B each have one run in 2026w41. A has more
   requests. A day record of 2026-10-06 lists the run of B. Expect B, with
   `last_test` `2026-10-06`. Without the record, expect A.
7. **The latest run counts.** A has runs in 2026w38 and 2026w41. B has one
   run in 2026w40. Expect B.
8. **No week token.** An OpenCode run `a-x-legacy` makes `x` tested with the
   date `0000-00-00`. Expect `x` as the stalest model.
9. **Unpriced.** A live model with no price and the most requests in the
   catalog is never selected. It appears in `excluded.unpriced`.
10. **Gone.** A priced untested model that is not live is never selected. It
    appears in `excluded.gone`.
11. **Unservable.** A priced live untested model is absent from the served
    list. It is never selected, and it appears in `excluded.unservable`. The
    served list holds `opencode-go/x-1.10` and the candidate is `x-1.1`.
    Expect `x-1.1` in `unservable`. This case falsifies a substring match.
12. **This week.** A is the stalest model, but it has a run in the week of
    `--date`. Expect B, and A in `excluded.this_week`.
13. **None.** Each candidate has a run in the week of the day. Expect exit
    3, `model` `null`, `reason` `none`, and the `DAILY_PICK` line with
    `model=none`.
14. **Identity.** Each of these runs leaves its model untested:
    - a Pi run, with an `executor.pi` object and no `kind`;
    - a run of `local/reference`;
    - a run with the arm `c`, or with the track `foo`;
    - a run whose `provenance.json` is not JSON. A run with
    `opencode-go/x-old`, where `aliases` maps `x-old` to `x`, makes `x`
    tested.
15. **A run that is not valid.** An OpenCode run with `valid: false` in
    `score.json` makes its model tested.
16. **Resume.** A day record for `--date` names Z. Z is not a candidate now.
    Expect Z, `resume`, exit 0, and the short `DAILY_PICK` line.
17. **Bad day record.** A day record that is not JSON, of any date. Expect
    exit 2 and no pick.
18. **Input faults.** Each of these inputs gives exit 2 and no stdout:
    - an empty catalog file, a catalog that is not JSON, no `live` key, or
      `live: []`;
    - an empty served file, or `--date 2026-13-01`;
    - a missing price table, or a missing runs root.
19. **Hermetic.** Case 3 with `BENCH_TRACK=change`, `REPS=9`,
    `BENCH_RUNS_ROOT=/nonexistent`, and `BENCH_PRICING_PATH=/nonexistent` in
    the environment. Expect byte-equal stdout and stderr.
20. **Determinism.** Case 6 with a shuffled live list and the run
    directories made in the other order. Expect byte-equal stdout.
21. **Run-list mode.** `--day-runs x --week 2026w44` lists only the
    OpenCode runs of `x` with the token `2026w44`, sorted. It omits the runs
    of other weeks, other models, Pi runs, and canary runs.
22. **The labeled line.** For case 1, stderr is exactly
    `DAILY_PICK date=<day> model=C reason=untested last_test=none candidates=3 eligible=3 untested=2`.

### 6.2 Batch pin

Each case spawns `bash harness/batch.sh --dry-run --model <id>` with
`BENCH_DRY_RUN=1`, `BENCH_RUNS_ROOT`, `BENCH_PRICING_PATH`, `WEEK=2026w50`,
and `ARMS="a b"`. The synthetic table holds `glm-5.2` with `batch: false`.

1. **Build.** `BENCH_TRACK=build`. Expect exactly these 6 run ids:
   `a-glm-5-2-2026w50-r1` to `-r3` and `b-glm-5-2-2026w50-r1` to `-r3`.
   Expect the line `PINNED MODEL glm-5.2`, and no `WORK LIST` line.
2. **Other tracks.** `bugfix`, `tests`, and `change` each plan 2 ids, with
   the prefixes `bf-`, `tt-`, and `ch-`.
3. **Unknown id.** `--model no-such-model` exits 2 and plans no run.
4. **No value.** `--model` as the last argument exits 2.
5. **Unsafe id.** `--model ../x`, `--model A`, and `--model 'x$(id)'` each
   exit 2 and plan no run.
6. **The pin wins.** `FORCE=1`, and a runs root where a batch model is
   failing. Expect only the 6 pinned ids.
7. **No pin.** Without `--model`, expect the exact run-id list of every
   batch model of the synthetic table.
8. **No variable pin.** `BENCH_MODEL=glm-5.2` in the environment and no
   flag. Expect the output of case 6.2.7.

### 6.3 Daily job

Each case spawns `bash harness/cron-daily.sh` with the seams of spec NFR-6.
`BENCH_DAILY_RUNNER` is a stub script in the temporary root. The stub writes
its arguments and a flag "record present" to a file. It then creates one
OpenCode run directory of the `--model` value for each arm, with the week
token of `WEEK`. `BENCH_DAILY_PUBLISH` is `0`.

1. **Dry run.** Expect the `DAILY_PICK` line of the selector, 12 planned run
   ids, and `DAILY DRY-RUN planned=12`. The day directory stays empty. The
   runs root stays unchanged. The stub is not called.
2. **Empty catalog.** An empty catalog file. Expect a non-zero exit, a
   `DAILY FAIL catalog` line, no `DAILY_PICK` line, and no day record.
3. **Other bad inputs.** The same result for a catalog that is not JSON, for
   `{"live": []}`, and for an empty served file (`DAILY FAIL served`).
4. **Live mode.** The stub receives `--model <pick>`. At the stub start, the
   day record exists with `run_ids: []`. After the job, the record holds
   the 2 stub run ids. Expect exit 0 and `DAILY PUBLISH skipped`.
5. **Second run, same day.** The served list changes so that a new
   selection would give another model. Expect the same `--model` value at
   the stub, and `reason=resume`.
6. **Next day.** A new date in the next week. Expect a new pick. The model
   of the first day now has the date of its day record.
7. **Lock held.** The test holds the lock file with `flock`. Expect exit 0,
   `DAILY SKIP lock held`, no day record, and no stub call.
8. **Bad day record.** A day record of the date that is not JSON. Expect a
   non-zero exit and no stub call.
9. **None.** Every candidate has a run in the week. Expect exit 0,
   `DAILY_PICK ... model=none`, no record, and no stub call.
10. **Runner failure.** The stub exits 4. Expect `runner_exit` 4 in the
    record, a non-zero exit, and `DAILY PUBLISH none`.

### 6.4 Artifacts

These cases read file text. They do not prove behavior.

1. `harness/weekly.sh` holds `./batch.sh "$@"`.
2. The self-check line of `batch.sh` still unsets `BENCH_TRACK` and the
   repeat variables (the guard of `selfcheck-env.test.ts`).

## 7. Real-data proof without a model call

Plan task 3.2 runs `SELECTOR_MATCH` in the worktree. Plan task 5.1 runs
`PICK_MATCH` in `main` after the merge. In each check, two independent
implementations must agree on the real runs tree and on one fetch.

The strategy role ran `pick-oracle.py` on 2026-10-25. It used
`reports/go-catalog-refresh.json` and the `opencode models` list of that day.
The runs were read-only.

- Date 2026-10-26:
  `PICK_ORACLE date=2026-10-26 model=hy4-preview reason=untested last_test=none candidates=28 eligible=28 untested=11`.
- Date 2026-10-25: the same model, with `eligible=11`. Each tested candidate
  has a run in 2026w43.
- A live list of the tested models only, date 2026-10-26:
  `PICK_ORACLE date=2026-10-26 model=muse-spark-1.2-contributor reason=stalest last_test=2026-10-25 candidates=17 eligible=17 untested=0`.
- The same list on 2026-10-25 gave exit 3 and `model=none`.
- A day record of 2026-10-27 that lists the 2026w43 runs of
  `muse-spark-1.2-contributor` gave `muse-spark-1.3-contributor` on
  2026-10-28. On 2026-10-27, it gave a resume.
- The empty file `reports/go-catalog-2026w43.json` and an empty served list
  each gave exit 1.

These values are for information only. The fetch of task 4.1 can differ.
`PICK_MATCH` compares the two sides on the same files.

## 8. Live proof

The first live day is the only proof of FR-8 and of the full FR-6 and FR-9.
It is a paid run, so it waits for O1 (A2).

1. Run `CONSENT_CHECK`. Stop when it prints no line.
2. Run `PI_SHA day0` and `ls runs > .tmp/daily-runs-before.txt`.
3. The owner installs the crontab line (plan task 5.3). Then run
   `CRON_CHECK`.
4. After the first job ends, run `DAY_CHECK <day>`, `PUBLISH_CHECK <day>`,
   `PI_SHA day1`, and `PI_CHECK day0 day1`.
5. Confirm that `reports/cron-daily.log` holds one `DAILY_PICK` line for
   the day, and that it equals the line of `PICK_ORACLE` for the inputs of
   the day record.

## 9. Phases

| Phase | Risk | Red command | Green gate | Closeout gate |
|---|---|---|---|---|
| 1 Contract and setup | low | none: this phase adds no code | role gate `strategy` prints `PASS: strategy gate passed`; the task 1.1 commit holds the strategy and the oracle | `PHASE_BASE=ok`; task 1.2 holds `PHASE_BASE`, `BASE_HASH`, `WORKLIST_SHA`, `BATCH_COMPAT`, and the `PI_SHA base` lines; `STATUS_CHECK` passes |
| 2 Test (Red) | medium | `SCHEDULE_TEST` exits non-zero | each failure names a missing interface of section 5; `RED_PATH_CHECK=pass` | role gate `mid-red` with `RED_TEST_COMMAND=SCHEDULE_TEST` passes; task 2.2 records the `Tests` line |
| 3 Implement (Green) | high | `SCHEDULE_TEST` of Phase 2 | `SCHEDULE_TEST` exits 0; `SELECTOR_MATCH=pass`; `PATH_CHECK=pass`; `BATCH_COMPAT` equals task 1.2; `META_LOGIC` exits 0 in the worktree | role gate `jr-green` passes; Reviews A, B, and C and the adversarial file show `status: pass` |
| 4 Docs | low | `DOCS_CHECK` exits non-zero before task 4.1 | `DOCS_CHECK=pass`; `PATH_CHECK=pass`; `SCHEDULE_TEST` exits 0 | Review C finds no flag or path in the README that the code lacks |
| 5 Doctor and owner gate | critical | none: no new code | after the merge: `BASE_HASH` and the `WORKLIST_SHA` pair are equal; `BATCH_COMPAT` equals task 1.2; `PICK_MATCH=pass`; `SCHEDULE_TEST` and `META_LOGIC` exit 0 | O1 recorded; when approved, `CONSENT_CHECK`, `CRON_CHECK`, `DAY_CHECK`, `PUBLISH_CHECK`, and `PI_CHECK day0 day1` pass |

### Anti-pattern coverage

| Phase | Class | Defense | It fails when |
|---|---|---|---|
| 1 | A5 | Each `[x]` task holds a SHA and the labeled line of its command | a task claims a result with no command line |
| 1 | A6 | The registry row says `pending` until the live day | the row says complete before `DAY_CHECK` |
| 1 | A12, A14 | One `[~]` task while a `[b]` task remains; `STATUS_CHECK`; the registry note names the first open task | the status command lists the track as a closeout candidate, or the note names a closed task |
| 1 | A13 | `PI_SHA base` stops on an empty Pi list | `PI_RUNS` is 0 or absent |
| 2 | A3 | The tests parse JSON fields and exact labeled lines | a case matches a bare digit or a substring of a line |
| 2 | A4 | Each case asserts one named model and the full counts; each input fault must fail | a case passes on empty output, or on any model |
| 2 | A7 | The tests compare exact run-id lists; `RED_PATH_CHECK` uses an exact allow-list | a filter drops a real line, or a broad pattern admits a path |
| 2 | A11 | Each spawn has an explicit environment; case 6.1.19 poisons it | the poisoned environment changes the output |
| 3 | A11 | `--model` is a flag; case 6.2.8; `META_LOGIC` | `BENCH_MODEL` changes a batch, or the meta suite fails |
| 3 | A4 | `PATH_CHECK` needs a change of `harness/daily-pick.ts`; `BATCH_COMPAT` needs 180 runs | the diff is empty, or the dry run plans no run |
| 3 | A13 | No test writes under the real `runs/`; the job creates only run directories of the day's model | `DAY_CHECK` finds another model |
| 3 | A3, A4 | `SELECTOR_MATCH` compares two full labeled lines, and it needs a non-empty line | the line is empty, or one field differs |
| 4 | A5 | `DOCS_CHECK` reads the README section; Review C compares each named flag with the code | the README names a flag or a path that the code lacks |
| 4 | A6 | `DOCS_CHECK` rejects an activation claim | the README says that the schedule is active before O1 |
| 5 | A2 | `CONSENT_CHECK` before `CRON_CHECK` | the crontab line exists with no dated approval |
| 5 | A4 | `DAY_CHECK` needs at least one new run; `PUBLISH_CHECK` needs one commit | the day made no run, or no commit names the day |
| 5 | A5, A6 | The plan claims the live day only with the four labeled lines; the registry row stays `pending` until task 5.4 | a claim has no labeled line |
| 5 | A13 | `PI_CHECK day0 day1` | `recost.sh` or a rescore changed one Pi byte |

A1, A8, and A10 do not apply. A1 and A8 are retired. This repository has no
generated facts for A10. A9 does not apply, because no test reads a path
under `measure/tracks/`.

## 10. The intentionally-red suite

- In Phase 2, the only red file is
  `harness/schedule-tests/daily-schedule.test.ts`. The orchestrator does
  not count its failure as a regression.
- `npm run test:meta` and `npm run test:meta:logic` collect only
  `tests/meta`. They do not collect the new file, so they stay green in
  every phase.
- No role runs a bare `npx vitest run` as a gate. That command also
  collects the product suites, which need a candidate server.
- Red must not mark a case `skip`, `todo`, or `fails`. A skipped case hides
  a requirement.
- At the Phase 3 gate, the red file must be fully green. A case that stays
  red sends the work back to Green. Nobody edits a case to pass.

## 11. Artifact tests and live tests

- An artifact test reads file text, a Git diff, or a hash. Examples: the
  cases of section 6.4, `PATH_CHECK`, `RED_PATH_CHECK`, `BASE_HASH`,
  `DOCS_CHECK`, `CONSENT_CHECK`, `STATUS_CHECK`, and the role gates.
- A live behavior test runs the real code. Examples: the cases of sections
  6.1 to 6.3, `BATCH_COMPAT`, `META_LOGIC`, `SELECTOR_MATCH`, `PICK_MATCH`,
  `DAY_CHECK`,
  `PUBLISH_CHECK`, and `PI_CHECK`.
- An artifact test never closes a behavior requirement alone. For example,
  case 6.4.1 shows the argument pass in `weekly.sh`. Only `DAY_CHECK` shows
  that the live job ran one model.

| Requirement | Live proof |
|---|---|
| FR-1 | 6.3.2, 6.3.3, 6.1.18 |
| FR-2 | 6.1.9 to 6.1.11, 6.1.14 |
| FR-3 | 6.1.1, 6.1.2, 6.1.15 |
| FR-4 | 6.1.3, 6.1.5 to 6.1.8 |
| FR-5 | 6.1.4 |
| FR-6 | 6.1.12, 6.1.16, 6.3.4 to 6.3.8, `DAY_CHECK` |
| FR-7 | 6.2.1 to 6.2.8, `BATCH_COMPAT`, `DAY_CHECK` |
| FR-8 | `PUBLISH_CHECK` |
| FR-9 | `WORKLIST_SHA` pair, `DAY_CHECK`, `PI_CHECK` |

## 12. Adversarial cases

The adversarial role adds cases to the test file. Each case tries to make the
job break a rule. A case that passes against wrong output sends the code back
to Green.

1. Make the job select two models on one day: two runs of the job, a new
   live list between them, and a deleted record between them. The last case
   must give a new pick, and the plan must name it as an operator action.
2. Make the job select an unpriced model. Put the model id in `aliases`
   only, and not in `models`.
3. Make an old model look fresh: touch its run directories, and add an
   unrelated day record with a later date.
4. Make the job fail on one model on each day: a served model whose stub
   runs all have `valid: false`. On the next day, the job must select
   another model.
5. Feed a hostile id from the endpoint: `live` holds
   `x; touch /tmp/pwned`, `$(id)`, and `../../etc`. The job must not select
   the id. No file named `pwned` may exist after the job.
6. Make the dry run write a file: compare a listing of the temporary root
   before and after the dry run.
7. Make a day record forge a date: a record whose `run_ids` names a run of
   another model. The date applies only to the listed run. The case states
   the expected result.

The role writes `measure/runs/daily_model_schedule/adversarial-<short head>.json`.

## 13. Review assignments

| Role | Applies | Focus |
|---|---|---|
| Review A (correctness) | yes | The selection rule against spec rules 1 to 6; the run date rule; the identity rule against `plan-work.ts`; the byte order; `--day-runs` |
| Review B (security) | yes | Endpoint data in the shell; the id check of `--model`; temporary files and the rename; the lock; the credential stays out of each log; `git add docs/` and the push scope (spec R4, R5); the unattended cron |
| Review C (UX and API) | yes, API only | The contracts of section 5: the `batch.sh` flag, the `weekly.sh` arguments, the selector JSON, the day record, and the labeled lines. Backward compatibility of the unpinned batch. No user interface changes. |
| UX browser review | no | The track changes no file under `docs/`. The daily export uses the existing site code. |
| Adversarial testing | yes | Section 12 |

## 14. Architecture guardrails and changed contracts

- Do not edit a file of the runner hash or the suite hash (spec EV8). The
  selector imports `resolveGoModelId` and `loadPricing` from
  `harness/go-cost.ts`, and `BENCH_TRACKS` from
  `harness/candidate-contract.ts`. It does not edit them.
- Do not edit `plan-work.ts`, `cron-weekly.sh`, `go-pricing.json`, or the
  crontab line of the weekly cron.
- Do not add an npm script, a dependency, or a Vitest setting. Each is a
  suite-hash file.
- Keep the selector pure: no network, no write, and no environment read.
  Keep the writes in `cron-daily.sh`.
- Changed contracts:
  - `batch.sh` gets `--model <id>`. The old call without arguments keeps its
    behavior.
  - `weekly.sh` passes its arguments to `batch.sh`. The old call without
    arguments keeps its behavior.
  - The job adds `reports/daily/` and `reports/cron-daily.log`. Both are
    under the ignored `reports/`.
  - The job adds a daily commit `Publish daily <day> ...` on `main`.
- Dependency: the activation in Phase 5 waits for `opencode_executor` task
  4.2, the container probe. The runs of 2026w43 failed with "image not
  known" (spec EV5), and the canary does not start the agent image.

## 15. Evidence to record

For each task, the plan records the command, the labeled output line, and the
report path.

- Task 1.2: `PHASE_BASE`, `PHASE_BASE=ok`, `BASE_HASH`, `WORKLIST_SHA`,
  `BATCH_COMPAT`, and the `PI_SHA base` lines.
- Task 2.2: the start time, the end time, the exit code, and the `Tests`
  line.
- Task 3.2: the `SELECTOR_MATCH` line.
- Task 3.5: `PATH_CHECK`, `BATCH_COMPAT`, and the `META_LOGIC` summary.
- Task 4.1: the `DOCS_CHECK` line.
- Task 5.1: `BASE_HASH`, the `WORKLIST_SHA` pair, and the `PICK_MATCH` line.
- Task 5.2: the O1 answer and its date.
- Task 5.3: `CRON_CHECK` and the `PI_SHA day0` lines.
- Task 5.4: `DAY_CHECK`, `PUBLISH_CHECK`, and `PI_CHECK`.
