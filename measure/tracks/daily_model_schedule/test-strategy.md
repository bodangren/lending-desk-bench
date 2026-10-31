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
| The job starts without owner consent | Paid runs and deploys with no approval | O1 with a date before `TIMER_CHECK` (A2) |
| A recost changes a legacy Pi record | The history loses its byte identity, and Git does not see it (A13) | `PI_SHA` and `PI_CHECK` |
| The Go guard reads a value above 80 and continues | The job draws on the paid Go credit balance (spec R3) | Cases 6.5.1 to 6.5.7 and 6.5.24; one skip line; exit 0; no later batch |
| The guard uses a string compare | `80.0` stops, or `80.0001` continues | Cases 6.5.2, 6.5.3, and 6.5.24 |
| The job pushes every local commit | A secret or another track reaches `origin` (spec R4) | Cases 6.5.14 to 6.5.17; `git push origin <sha>:main` |
| A selector exit 1 takes the no-pick path | A crashed selector exits 0 and spends nothing, with no fail line (spec D14) | Cases 6.5.18 and 6.5.19 |
| `Persistent=true` starts a missed run at boot | An unplanned paid run (spec D11) | `UNIT_CHECK`; `Persistent=false` |

## 2. The phase base

Task 1.1: the strategy role did not commit. The orchestrator commits
`spec.md`, `plan.md`, `test-strategy.md`, `pick-oracle.py`,
`metadata.json`, `index.md`, and the registry rows in one commit.

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

The strategy embeds no SHA for a baseline that the commit does not hold yet.
The base commit `aa94185` of the spec is the state before the first strategy,
and it is not `PHASE_BASE`. For a role gate, `--baseline` is the HEAD of the
branch before the role starts.

### Phase 4b baseline

`PHASE_BASE` stays the value in plan task 1.2. Do not recapture it.

The orchestrator captures the baseline for Phase 4b at this point:

1. Wait until the last commit of task 4b.1 is on `daily-schedule`.
2. Do not edit a file for task 4b.2 before step 3.
3. Run `git rev-parse HEAD` in the worktree. That SHA is the immutable
   `phase_base_sha` for Phase 4b. Store it as `PHASE_4B_STRATEGY`.
4. Record the SHA in the orchestrator notes. Do not write it into this file
   before the commit exists.
5. Use that SHA as `--baseline` for later Phase 4b role gates.
6. Use that SHA in `WEEKLY_SAME`.

`phase_base_sha` for Phase 4b is not the track `PHASE_BASE`. This file
embeds no value for it. Do not use a SHA from before this strategy commit.

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
  test -n "$(git diff --name-only "$PHASE_BASE" HEAD -- harness/daily-pick.ts)" && test -z "$(git diff --name-only "$PHASE_BASE" HEAD | grep -vE '^(harness/(daily-pick\.ts|cron-daily\.sh|batch\.sh|weekly\.sh|schedule-tests/[^/]+\.test\.ts|systemd/lending-desk-daily\.(service|timer))|README\.md|measure/.+)$')" && echo PATH_CHECK=pass
  ```

  The allow-list adds only
  `harness/systemd/lending-desk-daily.service` and
  `harness/systemd/lending-desk-daily.timer`. It does not allow every file
  under `harness/systemd/`. It fails when Green adds another path.
  `BATCH_COMPAT`, `WORKLIST_SHA`, `BASE_HASH`, and `PI_SHA` stay unchanged.

- `WEEKLY_SAME` (worktree, Phase 4b Green). `weekly.sh` stays unchanged
  after the Phase 4b baseline. The orchestrator sets `PHASE_4B_STRATEGY`
  from section 2. This file embeds no SHA.

  ```bash
  test -n "$PHASE_4B_STRATEGY" && test -z "$(git diff --name-only "$PHASE_4B_STRATEGY" HEAD -- harness/weekly.sh)" && echo WEEKLY_SAME=pass
  ```

  It fails when the diff of `harness/weekly.sh` is not empty. Case 6.4.1
  stays valid.

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

- `DOCS_CHECK` (worktree, Phase 4b Green; A5, A6). It reads the README
  section. Task 4.1 passed the previous command. Do not reopen task 4.1.
  The amended command is red until task 4b.3 updates the README.

  The section names the systemd timer and `Persistent=false`. It keeps
  `0,3` or the `OnCalendar` text. It does not present a crontab line as
  the install method. The activation-claim check stays.

  ```bash
  python3 -I - README.md <<'PY'
  import re, sys
  text = open(sys.argv[1], encoding="utf-8").read()
  m = re.search(r"^## Daily model schedule\n(.*?)(?=^## |\Z)", text, re.S | re.M)
  assert m, "DOCS_CHECK=fail no section"
  sec = m.group(1)
  need = (
      "harness/cron-daily.sh", "harness/daily-pick.ts", "--model",
      "reports/daily/", "harness/go-pricing.json", "https://opencode.ai/docs/go/",
      "cron-weekly.sh", "owner", "Wednesday", "Sunday",
      "harness/systemd/lending-desk-daily.service",
      "harness/systemd/lending-desk-daily.timer",
      "Persistent=false", "above 80", "own docs commit",
  )
  for w in need:
      assert w in sec, f"DOCS_CHECK=fail missing {w}"
  assert ("0,3" in sec) or ("OnCalendar" in sec), "DOCS_CHECK=fail missing schedule"
  assert not re.search(r"\b(is|now) (active|enabled|live)\b", sec, re.I), "DOCS_CHECK=fail activation claim"
  assert "Decision O1 is open" not in sec, "DOCS_CHECK=fail O1 still open"
  assert "sends every local commit" not in sec, "DOCS_CHECK=fail old push scope"
  assert "selector exit 1 takes the no-pick path" not in sec, "DOCS_CHECK=fail exit 1 claim"
  assert "short resume record omits" not in sec, "DOCS_CHECK=fail short record claim"
  assert not re.search(r"(?m)^[^#\n]*0 1 \* \* 0,3\s+\S*cron-daily\.sh", sec), "DOCS_CHECK=fail crontab install line"
  print("DOCS_CHECK=pass")
  PY
  ```

  It fails when a required token is absent. It fails when the section has
  no `0,3` and no `OnCalendar`. It fails on an activation claim. It fails
  when a crontab line is the install method. A sentence that says no
  crontab line is installed can stay.

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

- `PUBLISH_CHECK <day> [pushed|skipped]` (`main`, after a job that
  committed docs). The default mode is `pushed`. A resumed day uses the
  reason `resume` in the subject. The regex accepts `untested`, `stalest`,
  and `resume`. Green changes no file for this choice. The subject in
  `harness/cron-daily.sh` already writes the record reason.

  Mode `skipped` is the check before the one manual push. It accepts a
  local docs commit plus one `DAILY PUSH skipped:` line. It does not
  require the commit on `origin/main`.

  Mode `pushed` is the check after the manual push when the job pushed.
  It requires the commit on `origin/main`. It fails when the commit is
  only local.

  ```bash
  day="$1"; mode="${2:-pushed}"; c=$(git log -1 --format=%H --grep="^Publish daily ${day} ") && test -n "$c" && files=$(git show --name-only --format= "$c") && test -n "$files" && test -z "$(printf '%s\n' "$files" | grep -v '^docs/')" && git log -1 --format=%s "$c" | grep -qE '^Publish daily [0-9]{4}-[0-9]{2}-[0-9]{2} OpenCode Go results: [a-z0-9][a-z0-9.-]* \((untested|stalest|resume)\)\.$' && if [ "$mode" = skipped ]; then grep -qE '^DAILY PUSH skipped: ' reports/cron-daily.log; elif [ "$mode" = pushed ]; then git branch -r --contains "$c" | grep -q 'origin/main' && grep -qE '^DAILY PUBLISH [0-9a-f]' reports/cron-daily.log; else echo "PUBLISH_CHECK=fail mode" >&2; exit 1; fi && echo "PUBLISH_CHECK=pass $c"
  ```

  It fails when the subject reason is not one of the three words. It fails
  when the commit has no file, or a file outside `docs/`. It fails in
  `skipped` mode when the log has no `DAILY PUSH skipped:` line. It fails
  in `pushed` mode when `origin/main` does not contain the commit.

- `CONSENT_CHECK` (A2): the O1 row of `spec.md` holds `approved` and a date.
  `rg -n '^\| O1 \|.*\| approved 20[0-9]{2}-[0-9]{2}-[0-9]{2}' measure/tracks/daily_model_schedule/spec.md`
  prints 1 line.
- `CRON_CHECK` is retired. Do not install a crontab line. `TIMER_CHECK`
  replaces it for task 5.3.

- `UNIT_CHECK` (worktree, Phase 4b; FR-13, D11). It is an artifact check.
  It reads the two unit files. It does not install them. It fails when a
  file is absent, or when a required line is absent or different.

  ```bash
  python3 -I - <<'PY'
from pathlib import Path
import shutil, subprocess, sys
svc = Path("harness/systemd/lending-desk-daily.service").read_text()
tmr = Path("harness/systemd/lending-desk-daily.timer").read_text()
need_svc = [
    "Type=oneshot",
    "WorkingDirectory=/home/daniebo/Desktop/lending-desk-bench",
    "ExecStart=/home/daniebo/Desktop/lending-desk-bench/harness/cron-daily.sh",
    "StandardOutput=append:/home/daniebo/Desktop/lending-desk-bench/reports/cron-daily.log",
    "StandardError=append:/home/daniebo/Desktop/lending-desk-bench/reports/cron-daily.log",
]
need_tmr = [
    "OnCalendar=Wed,Sun 01:00:00",
    "Persistent=false",
    "Unit=lending-desk-daily.service",
    "WantedBy=timers.target",
]
for line in need_svc:
    assert line in svc.splitlines(), f"UNIT_CHECK=fail service missing {line}"
for line in need_tmr:
    assert line in tmr.splitlines(), f"UNIT_CHECK=fail timer missing {line}"
assert "Persistent=true" not in tmr, "UNIT_CHECK=fail Persistent=true"
assert "0 1 * * 0,3" not in svc, "UNIT_CHECK=fail crontab line in service"
if shutil.which("systemd-analyze"):
    import tempfile
    top = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip()
    main = "/home/daniebo/Desktop/lending-desk-bench"
    tmp = Path(tempfile.mkdtemp(prefix="unit-check-"))
    try:
        (tmp / "lending-desk-daily.service").write_text(svc.replace(main, top))
        (tmp / "lending-desk-daily.timer").write_text(tmr.replace(main, top))
        r = subprocess.run(["systemd-analyze", "verify",
            str(tmp / "lending-desk-daily.service"),
            str(tmp / "lending-desk-daily.timer")])
    finally:
        shutil.rmtree(tmp)
    if r.returncode != 0:
        sys.exit("UNIT_CHECK=fail verify")
    print("UNIT_CHECK_VERIFY=pass")
else:
    print("UNIT_CHECK_VERIFY=skipped")
print("UNIT_CHECK=pass")
PY
  ```

  The text assertions read the repository files. Those files keep the
  main-checkout paths. `systemd-analyze verify` checks that `ExecStart`
  exists. The worktree does not hold that main path until the merge.
  The verify branch copies the two files to a temporary folder.
  It replaces the main root with `git rev-parse --show-toplevel` in the
  copies only. It runs verify on the copies. It then removes the folder.
  After the merge, the two roots are equal. Verify then reads the real
  paths. Use `systemd-analyze verify` only when that command exists.
  The fallback is the text assertions alone. Then the command prints
  `UNIT_CHECK_VERIFY=skipped` and `UNIT_CHECK=pass`. When verify exits
  non-zero, `UNIT_CHECK` fails. Task 5.1 runs `UNIT_CHECK` in `main`
  after the merge, and before the install.

- `TIMER_ABSENT` (worktree, Phase 4b closeout). The track installs nothing.
  This check is not the task 5.3 gate. After the owner install, this check
  fails, and that failure is expected.

  ```bash
  if command -v systemctl >/dev/null 2>&1; then test "$(systemctl --user is-enabled lending-desk-daily.timer 2>/dev/null || true)" != enabled && test "$(systemctl --user is-active lending-desk-daily.timer 2>/dev/null || true)" != active; fi && test ! -e "$HOME/.config/systemd/user/lending-desk-daily.timer" && test ! -e "$HOME/.config/systemd/user/lending-desk-daily.service" && ! crontab -l | grep -qE '^[[:space:]]*[^#[:space:]].*cron-daily\.sh' && ! crontab -l | grep -qE '^[[:space:]]*[^#[:space:]].*cron-weekly\.sh' && echo TIMER_ABSENT=pass
  ```

  It fails when the user timer is enabled or active. It fails when a unit
  file is copied into the user systemd directory. It fails when an active
  crontab line runs `cron-daily.sh` or `cron-weekly.sh`. When `systemctl`
  is absent, the file checks and the crontab checks are the whole gate.

- `TIMER_CHECK` (task 5.3, an owner action, after the install). The user
  timer is enabled and active. No active crontab line runs `cron-weekly.sh`
  or `cron-daily.sh`.

  ```bash
  test "$(systemctl --user is-enabled lending-desk-daily.timer)" = enabled && test "$(systemctl --user is-active lending-desk-daily.timer)" = active && test "$(crontab -l | grep -c '^# DISABLED 2026-10-25 by owner request')" -eq 1 && test "$(crontab -l | grep -c 'cron-daily')" -eq 0 && ! crontab -l | grep -qE '^[[:space:]]*[^#[:space:]].*cron-weekly\.sh' && echo TIMER_CHECK=pass
  ```

  It fails when the timer is not enabled. It fails when the timer is not
  active. It fails when an active line runs `cron-weekly.sh`. It fails
  when any crontab line contains `cron-daily`. The plan task 5.3 count of
  the disabled weekly comment stays in this command.

- `GUARD_CHECK` (worktree; FR-10, D12). It runs the guard cases, the
  order case, and the `80.0001` case. Red expects a non-zero exit. Green
  expects exit 0. Read the Vitest `Tests` line, not a bare digit (A3).

  ```bash
  cd harness && npx vitest run schedule-tests/daily-schedule.test.ts -t '6\.5\.(1|2|3|4|5|6|7|8|9|10|11|12|13|24)\b'
  ```

- `PUSH_RULE_CHECK` (worktree; FR-11, D13). It runs the four push cases
  on a temporary bare remote. It does not push the real `origin`.

  ```bash
  cd harness && npx vitest run schedule-tests/daily-schedule.test.ts -t '6\.5\.(14|15|16|17)\b'
  ```

- `SELECT_EXIT_CHECK` (worktree; FR-12, D14). It runs the selector exit
  cases 1, 2, 3, and 4.

  ```bash
  cd harness && npx vitest run schedule-tests/daily-schedule.test.ts -t '6\.5\.(18|19|20|21)\b'
  ```

  `UNIT_CHECK` is the gate command for FR-13. `TIMER_CHECK` is the owner
  install gate. It is not a substitute for `UNIT_CHECK`.

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
| Operator docs | `DOCS_CHECK` | Green | The README section names the timer, the guard, and the push rule | artifact |
| Unit files | `UNIT_CHECK`, case 6.5.22 | Red, Green | FR-13, D11 text | artifact |
| Go guard and order | `SCHEDULE_TEST` block "go guard" | Red, Green | FR-10, D12 | live behavior, no model call |
| Push rule | `SCHEDULE_TEST` block "push rule" | Red, Green | FR-11, D13, temporary bare remote | live git behavior, no real push |
| Selector exit | `SCHEDULE_TEST` block "selector exit" | Red, Green | FR-12, D14 | live behavior |
| Real-data pick | `PICK_MATCH` | Orchestrator | AC-5 on the real runs tree, through the job | live behavior, no model call |
| Live day | `DAY_CHECK`, `PUBLISH_CHECK`, `PI_CHECK`, `TIMER_CHECK` | Orchestrator | FR-6 to FR-13 on a real day | live behavior, paid |
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
  - For a resume, the selector stdout is the short object
    `{schema, date, week, model, reason: "resume"}`. Case 6.1.16 stays valid.
    The day record is not this short object. Section 5.4 states the record rule.
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

- The schedule is the systemd user timer of spec D11. The script does
  not install the timer. The header comment names the two unit files and
  `Persistent=false`. It does not present a crontab line as the install
  method. Case 6.4.5 proves the header.
- Order: toolchain, lock, day record check, catalog fetch, served list,
  selection, then the D12 sequence. The job does not call `weekly.sh`.
- The D12 order is fixed. Step 1 is the Playwright Chromium check.
  It fails closed. Step 2 is the price-marker block. A changed table runs
  `recost.sh`. Step 3 is the hash-marker block. Changed hashes run
  `rescore-doctor.sh` with `WEEK=all`. Step 4 reads the guard, then runs
  one batch, for each track in order: `build`, `bugfix`, `tests`, `change`.
  The batch call is `BENCH_TRACK=<track> <batch> --model <id>`.
  A clean read starts the batch. A stop does not start it.
  Step 5 runs `rescore-doctor.sh` with the week of the day.
  Step 6 runs `recost.sh`. Step 7 runs `export-site-data.py`.
  Step 8 runs `generate-model-pages.py`. Step 9 runs `cleanup.sh`.
  The run list, the record update, and the publish follow step 9.
- The seams of spec NFR-6, plus one test seam for D14.
  `BENCH_DAILY_PUBLISH=0` skips the commit and the push.
  `BENCH_DAILY_LOCK` defaults to `.tmp/weekly-cron.lock`.
  `BENCH_DAILY_QUOTA_CMD` names a command that prints the quota JSON.
  Without it, the job uses the live source below.
  `BENCH_DAILY_BATCH` replaces `harness/batch.sh`. The default is
  `harness/batch.sh`.
  `BENCH_DAILY_POST=0` skips steps (1) to (3) and (5) to (9).
  `BENCH_DAILY_SELECT`, when set, replaces `tsx daily-pick.ts`. The job
  passes the same selector arguments. It uses the command exit code.
  When unset, the job runs the real selector. This seam is not in spec
  NFR-6. Green adds the read in `harness/cron-daily.sh` only. Production
  leaves it unset.
  `BENCH_DAILY_RUNNER` is retired. A set value must not start a process.
- The live quota source runs only when `BENCH_DAILY_QUOTA_CMD` is unset.
  Run `openchamber status --json`. Read `port` from the first entry of
  `instances` only. A later entry does not count. GET
  `http://127.0.0.1:<port>/api/quota/opencode-go`. The host is
  `127.0.0.1` only. Read `usage.windows.weekly.usedPercent`.
  A failed status command stops the day. A missing port stops the day.
  A failed GET stops the day. An empty body stops the day.
  A body that is not JSON stops the day.
  The line is `DAILY SKIP go-guard: read failed`.
  Tests do not call `openchamber`. Case 6.4.6 reads the script text.
  The seam cases prove the stop.
- A guard stop prints one line and exits 0. Use one of these exact lines.
  `DAILY SKIP go-guard: weekly used <n> percent`.
  `DAILY SKIP go-guard: read failed`.
  `DAILY SKIP go-guard: missing field`.
  `DAILY SKIP go-guard: not a number`.
  A clean read prints `DAILY GO-GUARD weekly=<n>`.
  A stop does not also print `DAILY GO-GUARD` for that read.
  `<n>` is the shortest decimal that round-trips to the JSON number.
  `81` prints `81`. `80.0001` prints `80.0001`.
  A truncated or rounded `<n>` fails the case.
- Compare the quota value as a number. A value above 80 stops. A value
  of 80 or 80.0 continues. Do not compare the text. Do not coerce a
  JSON string with `Number`. A string, a boolean, an object, or an array
  is `not a number`. A missing key or a null value is `missing field`.
  Empty output, whitespace-only output, a non-zero command exit, or
  text that is not JSON is `read failed`. A non-zero exit stops even
  when stdout holds JSON.
- A stop makes no further batch call and no model call. A stop before
  batch 1 writes the day record with `run_ids: []` and `go_guard_stop`
  set to the reason text. It does not print `DAILY FAIL runs`. A stop
  before batch 2, 3, or 4 keeps the run ids of the earlier batches and
  sets `go_guard_stop`. The job still runs steps (5) to (9) unless
  `BENCH_DAILY_POST=0`. The stop does not `exit` before those steps.
- The dry run reads the guard one time, before the batch dry runs. A
  clean read prints `DAILY GO-GUARD weekly=<n>`, the planned run ids, and
  `DAILY DRY-RUN planned=<n>`. A stop prints the skip line and
  `DAILY DRY-RUN planned=0`, and it exits 0. The dry run writes no day
  record and makes no model call.
- These labeled lines stay: `DAILY START` and `DAILY SKIP lock held`.
  `DAILY FAIL <step>: <reason>` stays. `DAILY_PICK ...` stays.
  `DAILY RUNNER exit=<n>` stays. `DAILY RUNS <n>` stays.
  `DAILY PUBLISH <sha|skipped|none>` stays. `DAILY END` stays.
  `DAILY RUNNER exit=<n>` is the summary of the four batches.
  It is the first non-zero batch exit, or 0 when every batch exits 0.
  The job prints the `DAILY_PICK` line of the selector one time.
- Push lines, after the docs commit: `DAILY PUSH skipped: <n> other local commits`,
  `DAILY PUSH skipped: origin/main moved`,
  `DAILY PUSH skipped: fetch failed`.
  A passed check pushes with `git push origin <sha>:main`. `<sha>` is the
  docs commit. The script must not run `git push origin main`.
  A failed push retries 3 times. After the third failure the job prints
  `DAILY FAIL publish: git push failed after 3 attempts; the commit is local`
  and exits 1. The commit stays local.
- Selector exit: exit 0 is a pick or a resume. Exit 3 is the no-pick path.
  Exit 2 keeps the current fail path. Any other exit, including 1 and 4
  or more, prints `DAILY FAIL pick: the selector exited <n>` and exits
  with the same code. The job calls no batch and writes no day record.

### 5.4 Day record `reports/daily/<day>.json`

- The selector object, plus `run_ids` (an array), `runner_exit` (an
  integer or `null`), and `go_guard_stop` (a string or `null`).
- A day with no guard stop holds `go_guard_stop: null`. A stopped day
  holds the exact reason text, for example `weekly used 81 percent` or
  `read failed`. The value is not the full labeled line.
- The job writes the record to a temporary file, and it renames the file
  into place. It writes it before the first batch with `run_ids: []`.
  It writes it again after the batches with the run-list output.
- Resume record rule (adversarial finding 2, spec D10). On a resume, the
  job keeps `counts`, `excluded`, `order`, and `last_test` from the first
  record of that day. It updates `run_ids` and `runner_exit` only. It
  does not replace the record with the short selector object. The publish
  body reads `excluded` from the day record. A resumed publish lists the
  same unpriced, gone, and unservable models as the first record.
  Green changes `harness/cron-daily.sh` only for this rule.
  `harness/daily-pick.ts` stays unchanged. Case 6.5.23 proves the rule.
  It fails when any of those four fields changes, or when the publish
  body omits an unpriced model that the first record lists.
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
23. **Untested beside a legacy no-week-token run.** A tested model whose only
    OpenCode run has no week token has the zero date. It must not win over an
    untested candidate with fewer requests.

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
9. **Empty value.** `--model ""` exits 2 and plans no run.

### 6.3 Daily job

Each case spawns `bash harness/cron-daily.sh` with an explicit environment.
The environment holds `PATH`, `HOME`, and the values of the case. It never
spreads `process.env` (A11).

Task 4b.2 retargets the daily-job fixture. `BENCH_DAILY_RUNNER` is retired.
The fixture sets `BENCH_DAILY_BATCH` to the stub and `BENCH_DAILY_POST=0`.
It sets `BENCH_DAILY_QUOTA_CMD` to a command that prints a clean reading of
10. The assertions of cases 6.3.2 to 6.3.12 stay. Green does not edit a
case to pass. A case that still sets only `BENCH_DAILY_RUNNER` is incomplete.

The stub logs each call. It creates one OpenCode run directory of the
`--model` value for each arm, with the week token of `WEEK`.
`BENCH_DAILY_PUBLISH` is `0` except in the publish cases.

1. **Dry run.** The quota seam prints 10. Expect one
   `DAILY GO-GUARD weekly=10` line, or `weekly=10.0` when the number parses
   as 10. Expect the `DAILY_PICK` line, 12 planned run ids, and
   `DAILY DRY-RUN planned=12`. The day directory stays empty. The runs root
   stays unchanged. The live batch stub is not called. It fails when the
   guard line is absent, or when a run directory appears.
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
11. **Shared lock.** The test holds the lock file with `flock -s`. Expect exit
    0, `DAILY SKIP lock held`, no day record, and no stub call.
12. **Zero runs.** The stub exits 0 and creates no run directory. Expect a
    non-zero exit, a `DAILY FAIL runs` line, `DAILY PUBLISH none`, and a
    record with `run_ids: []` and `runner_exit: 0`.

### 6.4 Artifacts

These cases read file text. They do not prove behavior. Case 4 also runs the
job in a temporary Git repository, so it proves the publish scope.
Task 4b.2 retargets case 4 to `BENCH_DAILY_BATCH`. The remote tip must
still equal the docs commit. Case 1 stays valid. Green does not edit
`weekly.sh`.

1. `harness/weekly.sh` holds `./batch.sh "$@"`. It fails when that call is
   absent, or when the track loop is gone.
2. The self-check line of `batch.sh` still unsets `BENCH_TRACK` and the
   repeat variables (the guard of `selfcheck-env.test.ts`).
3. The publish commit of `cron-daily.sh` is path-limited to `docs/`.
   The push form is `git push origin <sha>:main`. The script does not
   contain `git push origin main`. It fails when that old push line remains.
4. The publish commit of a temporary Git repository holds only `docs/`.
   `origin/main` starts at the parent of the docs commit. The remote tip
   equals that docs commit. It fails when the remote holds another file.
5. The header comment of `harness/cron-daily.sh` names
   `harness/systemd/lending-desk-daily.timer` and `Persistent=false`.
   It does not contain the install line `0 1 * * 0,3`. It fails when the
   crontab line is the install method, or when the timer name is absent.
6. The live quota source text is in `harness/cron-daily.sh`. The script
   contains `openchamber status --json`, `127.0.0.1`,
   `/api/quota/opencode-go`, and `usedPercent`. The GET host is
   `127.0.0.1` only. The port comes from the first `instances` entry.
   It fails when any token is absent. It fails when the guard URL uses
   another host. This case does not call `openchamber`.
7. After the four-track loop, the script still names `rescore-doctor.sh`,
   `recost.sh`, `export-site-data.py`, `generate-model-pages.py`, and
   `cleanup.sh`. A guard stop does not `exit` the script before those
   names. It fails when a stop branch exits before the post steps.
   This case reads text. It does not run the post steps.

### 6.5 O1 conditions

These cases are the Phase 4b Red cases. No case is `skip`, `todo`, or
`fails`. Each spawn uses an explicit environment (A11). No case calls a
model, `openchamber`, the real `origin`, crontab, or systemd.

The quota stub prints one JSON object:
`{"usage":{"windows":{"weekly":{"usedPercent":<n>}}}`.
The batch stub logs `BENCH_TRACK` and its arguments. It creates run ids
that contain the track token, so a later batch has different ids.
`BENCH_DAILY_POST=0` unless the case says otherwise.

A case fails when the labeled line differs, when the exit code differs,
or when a forbidden batch call exists.

1. **Stop before batch 1.** The quota command prints 81. Expect exit 0,
   exactly one line `DAILY SKIP go-guard: weekly used 81 percent`, no
   batch call, and no model call. The day record has `run_ids: []` and
   `go_guard_stop` `weekly used 81 percent`. Expect no `DAILY FAIL runs`
   line. It fails when a batch runs, or when the exit is not 0.
2. **Exactly 80 continues.** The quota command prints 80 on each read.
   Expect four batch calls, no skip line, and `go_guard_stop` null.
   It fails when the job stops.
3. **80.0 continues.** The quota command prints 80.0. Expect the same
   result as case 2. It fails when a string compare stops the day.
4. **Failed read.** The quota command exits 1. Stdout may hold valid JSON.
   Expect `DAILY SKIP go-guard: read failed`, exit 0, and no batch call.
   It fails when the job uses the stdout and continues.
5. **Missing field.** The quota command prints `{"ok":true}`. Expect
   `DAILY SKIP go-guard: missing field`, exit 0, and no batch call.
   A null `usedPercent` is the same result. It fails when the job continues.
6. **Not a number.** `usedPercent` is the string `high`. Expect
   `DAILY SKIP go-guard: not a number`, exit 0, and no batch call.
   It fails when the job coerces the string and continues.
7. **Empty output.** The quota command exits 0 and prints no bytes.
   Expect `DAILY SKIP go-guard: read failed`, exit 0, and no batch call.
   Whitespace-only output is the same result. It fails when the job
   continues, or when the reason is `not a number`.
8. **Stop before batch 2.** The first read is 10. The second read is 81.
   Expect one build batch only. The record holds the build run ids and
   `go_guard_stop` `weekly used 81 percent`. Bugfix, tests, and change
   do not run. It fails when a later batch runs, or when a build id is
   absent.
9. **Stop before batch 3.** The first two reads are 10. The third read
   is 81. The record holds the build and bugfix run ids and the stop
   reason. Tests and change do not run. It fails when a tests id is
   present, or when a build or bugfix id is absent.
10. **Stop before batch 4.** The first three reads are 10. The fourth
    read is 81. The record holds the build, bugfix, and tests run ids
    and the stop reason. Change does not run. It fails when a change id
    is present, or when an earlier id is absent.
11. **Dry-run clean read.** The quota command prints 10. Expect one
    `DAILY GO-GUARD weekly=10` line, the planned ids, and
    `DAILY DRY-RUN planned=<n>`. Expect no day record and no model call.
    It fails when the guard line is absent, or when a run directory appears.
12. **Dry-run stop.** The quota command prints 81. Expect the skip line,
    `DAILY DRY-RUN planned=0`, exit 0, no day record, and no model call.
    It fails when a batch dry run starts.
13. **Per-batch order.** Four clean reads of 10. The call log order is
    quota, build, quota, bugfix, quota, tests, quota, change. Each batch
    call is `--model <id>` with `BENCH_TRACK` set to that track. Expect
    four `DAILY GO-GUARD weekly=10` lines. `BENCH_DAILY_POST=0`. Set
    `BENCH_DAILY_RUNNER` to a script that creates a sentinel file. The
    sentinel must not exist after the job. It fails when the order differs,
    or when the retired runner starts.
14. **Push at the parent.** Use a temporary repository and a bare remote.
    Set `user.email` and `user.name`. Do not use the real `origin`.
    `origin/main` equals the parent of the docs commit. Expect
    `git push origin <sha>:main`. The remote tip equals that docs commit
    and no other new commit. Expect exit 0 and `DAILY PUBLISH <sha>`.
    It fails when the remote tip differs, or when the script pushes
    `origin main`.
15. **Other local commits.** One local commit sits between `origin/main`
    and the docs commit. Expect
    `DAILY PUSH skipped: 1 other local commits`, exit 0, no push, and the
    docs commit still local. It fails when the remote moves, or when the
    count is wrong.
16. **origin/main moved.** Start from the parent commit.
    Move `origin/main` to a later commit that is not the parent.
    `git rev-list --count origin/main..HEAD~1` must equal 0.
    Expect `DAILY PUSH skipped: origin/main moved`.
    Expect exit 0 and no push. The docs commit stays local.
    It fails when the job pushes.
    It fails when the line says `other local commits`.
17. **Failed fetch.** Point `origin` at a missing path after the parent
    exists. Expect `DAILY PUSH skipped: fetch failed`, exit 0, the docs
    commit local, and the remote unchanged. It fails when the exit is not 0,
    or when the reason is another skip reason.
18. **Selector exit 1.** `BENCH_DAILY_SELECT` exits 1. Expect
    `DAILY FAIL pick: the selector exited 1`, exit 1, no batch call, and
    no day record. It fails when the job takes the no-pick path.
19. **Selector exit 4.** The stub exits 4. Expect
    `DAILY FAIL pick: the selector exited 4`, exit 4, no batch call, and
    no day record. It fails when the exit is 0, or when the line omits 4.
20. **Selector exit 2.** The stub exits 2. Expect
    `DAILY FAIL pick: the selector exited 2`, exit 2, no batch call, and
    no day record. It fails when the job selects a model.
21. **Selector exit 3.** The stub exits 3. Expect the no-pick path, exit 0,
    `DAILY PUBLISH none`, and no batch call. It fails when the job prints
    `DAILY FAIL pick`.
22. **Unit files.** Read the two files of D11. Expect each line that
    `UNIT_CHECK` requires. It fails when a file is absent. This case is
    an artifact check. It does not install a unit.
23. **Resume record.** The first run writes `counts`, `excluded` with one
    unpriced model, `order`, and `last_test`. The second run of the same
    day resumes. Those four fields stay byte-equal. The publish body names
    the unpriced model. The selector stdout stays the short object of
    case 6.1.16. It fails when a field is dropped, or when the body lists
    no unpriced model. Green changes `harness/cron-daily.sh` only.
24. **Value 80.0001.** The first read prints 80.0001. Expect
    `DAILY SKIP go-guard: weekly used 80.0001 percent`, exit 0, and no
    batch call. It fails when the line prints `80` or `80.0`. It fails
    when an integer compare continues or aborts the job.

Case 6.4.6 is the port-rule artifact. The seam cases above prove the
stop behavior. A test that calls the live port fails this strategy.

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
3. The owner installs the two unit files (plan task 5.3). Then run
   `TIMER_CHECK`. Do not install a crontab line.
4. After the first job ends, run `DAY_CHECK <day>`, `PUBLISH_CHECK <day>`,
   `PI_SHA day1`, and `PI_CHECK day0 day1`. Use `PUBLISH_CHECK <day> pushed`
   when the log shows `DAILY PUBLISH`. Use `PUBLISH_CHECK <day> skipped`
   when the log shows `DAILY PUSH skipped:`.
5. Confirm one `DAILY_PICK` line for the day in `reports/cron-daily.log`.
   That line must equal the `PICK_ORACLE` line for the day-record inputs.
6. Confirm the guard lines. A full day holds four
   `DAILY GO-GUARD weekly=<n>` lines. A stopped day holds one
   `DAILY SKIP go-guard: <reason>` line. Confirm the push result line.

## 9. Phases

| Phase | Risk | Red command | Green gate | Closeout gate |
|---|---|---|---|---|
| 1 Contract and setup | low | none: this phase adds no code | role gate `strategy` prints `PASS: strategy gate passed`; the task 1.1 commit holds the strategy and the oracle | `PHASE_BASE=ok`; task 1.2 holds `PHASE_BASE`, `BASE_HASH`, `WORKLIST_SHA`, `BATCH_COMPAT`, and the `PI_SHA base` lines; `STATUS_CHECK` passes |
| 2 Test (Red) | medium | `SCHEDULE_TEST` exits non-zero | each failure names a missing interface of section 5; `RED_PATH_CHECK=pass` | role gate `mid-red` with `RED_TEST_COMMAND=SCHEDULE_TEST` passes; task 2.2 records the `Tests` line |
| 3 Implement (Green) | high | `SCHEDULE_TEST` of Phase 2 | `SCHEDULE_TEST` exits 0; `SELECTOR_MATCH=pass`; `PATH_CHECK=pass`; `BATCH_COMPAT` equals task 1.2; `META_LOGIC` exits 0 in the worktree | role gate `jr-green` passes; Reviews A, B, and C and the adversarial file show `status: pass` |
| 4 Docs | low | `DOCS_CHECK` exits non-zero before task 4.1 | `DOCS_CHECK=pass` at task 4.1 used the previous command; `PATH_CHECK=pass`; `SCHEDULE_TEST` exits 0 | Review C finds no flag or path in the README that the code lacks. Recorded deviation: this closeout runs with the Phase 4b reviews, on the final Phase 4b HEAD |
| 4b O1 conditions | high | `SCHEDULE_TEST` exits non-zero; each new failure names a missing interface of D11 to D14; `RED_PATH_CHECK=pass`; `UNIT_CHECK` and the amended `DOCS_CHECK` exit non-zero | `SCHEDULE_TEST` exits 0; `GUARD_CHECK`, `PUSH_RULE_CHECK`, and `SELECT_EXIT_CHECK` exit 0; `UNIT_CHECK=pass`; `DOCS_CHECK=pass`; `PATH_CHECK=pass`; `WEEKLY_SAME=pass`; `BATCH_COMPAT` equals task 1.2; `bash -n harness/cron-daily.sh` exits 0 | role gate `jr-green` passes; Reviews A, B, and C and the adversarial file show `status: pass`; `TIMER_ABSENT=pass`; Phase 4 Review C runs on this HEAD and finds no flag or path in the README that the code lacks |
| 5 Doctor and owner gate | critical | none: no new code | after the merge: `BASE_HASH` and the `WORKLIST_SHA` pair are equal; `BATCH_COMPAT` equals task 1.2; `PICK_MATCH=pass`; `SCHEDULE_TEST` and `META_LOGIC` exit 0; `UNIT_CHECK=pass` in `main` | O1 recorded; when approved, `CONSENT_CHECK`, `TIMER_CHECK`, `DAY_CHECK`, `PUBLISH_CHECK`, and `PI_CHECK day0 day1` pass |

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
| 4 | A6 | `DOCS_CHECK` rejects an activation claim | the README says that the schedule is active before the owner install |
| 4b | A2 | `TIMER_ABSENT` before the owner install; `CONSENT_CHECK` already passed | a unit is enabled, or an active crontab line runs the job |
| 4b | A3 | Cases parse exact labeled lines and JSON fields; `80`, `80.0`, and `80.0001` are numbers, not digit searches | a case matches a bare digit, or accepts a truncated percent |
| 4b | A4 | A guard stop must show zero batch calls; a push skip must show a local commit; `UNIT_CHECK` fails when a file is absent | a case passes on empty output, or on no commit |
| 4b | A5 | Each new gate prints its labeled line; the plan claims a pass only with that line | a task claims `UNIT_CHECK=pass` with no command output |
| 4b | A6 | `DOCS_CHECK` rejects `Decision O1 is open` and the old push sentence | the README says the schedule is active, or that the job sends every local commit |
| 4b | A7 | `PATH_CHECK` names the two unit files, not `harness/systemd/`; `DOCS_CHECK` rejects the install line, not the word crontab | an extra unit file passes, or a real install line is dropped by a broad filter |
| 4b | A11 | Each spawn has an explicit environment; the quota seam replaces the live port | a test calls `openchamber`, or ambient `BENCH_TRACK` changes the guard |
| 4b | A12, A14 | One `[~]` task while a `[b]` task remains; `STATUS_CHECK`; the registry note says Phase 4b Red next | the status command lists the track as a closeout candidate |
| 4b | A13 | No test writes under the real `runs/`; push cases use a temporary remote | a case pushes the real `origin`, or edits a Pi record |
| 5 | A2 | `CONSENT_CHECK` before `TIMER_CHECK` | the timer is enabled with no dated approval |
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
- Phase 4b Red makes `SCHEDULE_TEST` red again. The orchestrator does not
  count that failure as a regression. `META_LOGIC` stays green. At the
  Phase 4b Green gate, the file must be fully green. Nobody edits a case
  to pass.

## 11. Artifact tests and live tests

- An artifact test reads file text, a Git diff, or a hash.
  The artifact examples are section 6.4 and case 6.5.22.
  They also include `PATH_CHECK`, `RED_PATH_CHECK`, and `BASE_HASH`.
  They also include `DOCS_CHECK`, `UNIT_CHECK`, and `CONSENT_CHECK`.
  `STATUS_CHECK` and the role gates are artifact checks.
  `UNIT_CHECK` does not prove that the guard stops a day.
  The cases of section 6.5 prove that.
- A live behavior test runs the real code.
  The live examples are sections 6.1 to 6.3.
  Section 6.5 is live except case 6.5.22.
  `BATCH_COMPAT`, `META_LOGIC`, and `SELECTOR_MATCH` are live.
  `PICK_MATCH`, `DAY_CHECK`, `PUBLISH_CHECK`, and `PI_CHECK` are live.
  The push cases use a temporary Git repository.
  They are live git behavior. They are not a push to the real `origin`.
- An artifact test never closes a behavior requirement alone. For example,
  case 6.4.1 shows the argument pass in `weekly.sh`. Only `DAY_CHECK` shows
  that the live job ran one model. Case 6.4.6 shows the port text. The
  seam cases show the stop.

| Requirement | Live proof |
|---|---|
| FR-1 | 6.3.2, 6.3.3, 6.1.18 |
| FR-2 | 6.1.9 to 6.1.11, 6.1.14 |
| FR-3 | 6.1.1, 6.1.2, 6.1.15 |
| FR-4 | 6.1.3, 6.1.5 to 6.1.8 |
| FR-5 | 6.1.4 |
| FR-6 | 6.1.12, 6.1.16, 6.3.4 to 6.3.8, `DAY_CHECK` |
| FR-7 | 6.2.1 to 6.2.8, `BATCH_COMPAT`, `DAY_CHECK` |
| FR-8 | `PUBLISH_CHECK`, cases 6.5.14 to 6.5.17 |
| FR-9 | `WORKLIST_SHA` pair, `DAY_CHECK`, `PI_CHECK` |
| FR-10 | 6.5.1 to 6.5.13, 6.5.24, `GUARD_CHECK` |
| FR-11 | 6.5.14 to 6.5.17, `PUSH_RULE_CHECK` |
| FR-12 | 6.5.18 to 6.5.21, `SELECT_EXIT_CHECK` |
| FR-13 | 6.5.22, `UNIT_CHECK`; live install proof is `TIMER_CHECK` only |

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

### Resolutions of task 3.9

These two findings are resolved here. They are not open contradictions.

1. **Resume reason.** A resumed day publishes the reason `resume`.
   `PUBLISH_CHECK` accepts `untested`, `stalest`, and `resume`. Green
   changes no file for this finding. The subject in `harness/cron-daily.sh`
   already writes the record reason. It fails when the regex rejects
   `(resume)`, or when Green changes the subject to another reason.
2. **Resume record.** The day record on a resume keeps `counts`,
   `excluded`, `order`, and `last_test`. Case 6.5.23 proves it. Green
   changes `harness/cron-daily.sh` only. The selector stdout stays short.
   It fails when the second record drops one of those fields.

### Phase 4b cases (task 4b.5)

The adversarial role adds these cases. A case that section 6.5 already
holds is not copied. The role extends it. Each case fails when the job
accepts the hostile input.

8. **Hostile quota output.** The quota command prints a JSON string
   `81; touch <temp>/pwned`, and a second run prints raw text
   `$(touch <temp>/pwned)`. `<temp>` is the temporary root, not a shared
   directory. Expect `not a number` for the JSON string, and `read failed`
   for the raw text. Expect exit 0, no batch call, and no file `pwned`.
   It fails when the shell evaluates the text, or when the string `81`
   becomes a numeric stop.
9. **String number.** `usedPercent` is the JSON string `"81"`. Expect
   `DAILY SKIP go-guard: not a number`. Do not expect
   `weekly used 81 percent`. It fails when the job coerces the string.
   This is the plan 4b.5 string-number case.
10. **Wrong JSON from the port seam.** The command prints
    `{"usage":{"windows":{"daily":{"usedPercent":10}}}}`. Expect
    `DAILY SKIP go-guard: missing field`, exit 0, and no batch call.
    It fails when a daily window satisfies the weekly field. This is the
    plan 4b.5 wrong-JSON case. The case does not open a port.
11. **Value 80.0001 after two clean reads.** The first two reads are 80.
    The third read is 80.0001. Expect a stop before batch 3.
    Expect the exact line `DAILY SKIP go-guard: weekly used 80.0001 percent`.
    Tests and change do not run. Case 6.5.24 stops on the first read.
    This case fails when an integer compare continues after 80.0001.
    It fails when the line truncates the number.
12. **Remote rejects the push.** The parent matches. A wrapper rejects
    `git push` three times. Put a no-op `sleep` on `PATH`, so the case
    does not wait 180 seconds. Expect three push attempts and exit 1.
    Expect the fail line `DAILY FAIL publish: git push failed after 3 attempts; the commit is local`.
    The docs commit stays local. The remote stays unchanged.
    It fails when the attempt count is not 3.
    It fails when the remote moves.
13. **Push race.** A `git` wrapper on `PATH` runs the real git. On `fetch`,
    it also creates one extra local commit with a subject that is not
    `Publish daily`. The remote tip must be the docs commit, identified by
    the publish subject. It must not be the extra commit. It fails when
    the remote tip is the extra commit. That result falsifies
    `git push origin main` and `git push origin HEAD:main`.

The Phase 4b role writes
`measure/runs/daily_model_schedule/adversarial-4b-<short head>.json`.
The Phase 3 file name stays
`measure/runs/daily_model_schedule/adversarial-<short head>.json`.

## 13. Review assignments

| Role | Applies | Focus |
|---|---|---|
| Review A (correctness) | yes, Phase 4b | The guard compare against D12; the batch order `build`, `bugfix`, `tests`, `change`; a stop keeps earlier run ids; the resume record rule of case 6.5.23 |
| Review B (security) | yes, Phase 4b | The push rule of D13; `git push origin <sha>:main`; the quota GET to `127.0.0.1` only; no credential in the log; the unattended timer; `Persistent=false` |
| Review C (UX and API) | yes, API and operator text | The new seams, the new labeled lines, the `go_guard_stop` field, and the unit-file text. On the final README, Review C finds no flag or path that the code lacks. That sentence is also the Phase 4 closeout gate. |
| UX browser review | no | The track changes no browser page. The README is operator text. Review C covers that text. No browser review is required. |
| Adversarial testing | yes, Phase 4b | Section 12 cases 8 to 13, plus the resolutions of task 3.9 |
| Security review | yes | Review B above. It applies to Phase 4b. |
| Phase 4 Review C and Phase 4 acceptance | yes, with Phase 4b | Recorded deviation. Both run on the final Phase 4b HEAD, together with the Phase 4b reviews and acceptance. They do not run on the Phase 4 docs commit alone. |

## 14. Architecture guardrails and changed contracts

- Do not edit a file of the runner hash or the suite hash (spec EV8). The
  selector imports `resolveGoModelId` and `loadPricing` from
  `harness/go-cost.ts`, and `BENCH_TRACKS` from
  `harness/candidate-contract.ts`. It does not edit them.
- Do not edit `plan-work.ts`, `cron-weekly.sh`, `go-pricing.json`,
  `go-cost.ts`, or the crontab line of the weekly cron.
- Do not edit `harness/weekly.sh` in Phase 4b. `WEEKLY_SAME` fails when
  that file changes after `PHASE_4B_STRATEGY`. Case 6.4.1 stays valid.
- Do not add an npm script, a dependency, or a Vitest setting. Each is a
  suite-hash file.
- Keep the selector pure: no network, no write, and no environment read.
  Keep the writes in `cron-daily.sh`.
- Changed contracts:
  - `batch.sh` gets `--model <id>`. The old call without arguments keeps its
    behavior.
  - `weekly.sh` passes its arguments to `batch.sh`. The old call without
    arguments keeps its behavior. Phase 4b does not change `weekly.sh`.
  - The job adds `reports/daily/` and `reports/cron-daily.log`. Both are
    under the ignored `reports/`.
  - The job adds a daily commit `Publish daily <day> ...` on `main`.
  - Phase 4b retires `BENCH_DAILY_RUNNER`. The job runs the four batches
    itself. A set runner value must not start a process.
  - Phase 4b adds `BENCH_DAILY_QUOTA_CMD`, `BENCH_DAILY_BATCH`,
    `BENCH_DAILY_POST`, and the test seam `BENCH_DAILY_SELECT`.
  - The day record adds `go_guard_stop`.
  - The push form changes from `git push origin main` to
    `git push origin <sha>:main`.
  - The repository adds the two unit files under `harness/systemd/`.
    The track does not install them.
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
- Task 4.1: the `DOCS_CHECK` line of the previous command. Do not reopen
  the task when the amended command is red.
- Task 4b.2: the `Tests` line of the red `SCHEDULE_TEST`, and
  `RED_PATH_CHECK=pass`.
- Task 4b.3: `SCHEDULE_TEST` exit 0, `UNIT_CHECK=pass`, `DOCS_CHECK=pass`,
  `PATH_CHECK=pass`, `WEEKLY_SAME=pass`, and `BATCH_COMPAT`.
- Task 5.1: `BASE_HASH`, the `WORKLIST_SHA` pair, the `PICK_MATCH` line,
  and `UNIT_CHECK=pass` in `main` after the merge, before the install.
- Task 5.2: the O1 answer and its date.
- Task 5.3: `TIMER_CHECK` and the `PI_SHA day0` lines.
- Task 5.4: `DAY_CHECK`, `PUBLISH_CHECK`, the guard lines, the push result
  line, and `PI_CHECK`.
