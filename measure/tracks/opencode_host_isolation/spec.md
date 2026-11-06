# OpenCode host isolation: no benchmark opencode uses the shared store

Spec format: classic FR list. Track type: bug. Base commit: `f55d2aa`.
Author model: `claude-code/claude-opus-5-5[1m]#high`.

## Summary

Each `opencode` call that the harness makes on the host uses the shared
OpenCode store of the user. A plain CLI call of OpenCode v2 also starts a
detached background server on that store when no server is registered. On
2026-11-06 a dry run of the daily job started such a server. The server
stayed alive after the job, and it locked the shared SQLite database against
the OpenChamber server.

This track gives each harness job its own OpenCode folder. Every host call
runs with a private server (`--standalone`) and with all OpenCode paths in
that folder. One read of the shared store per job copies the Console
credential into the job store. A trap stops every OpenCode process of the job
and removes the folder. The daily job also uses the `logic` self-check, so
the 2026-11-08 live day can start. The served-list `models` call of the daily
job retries a transient failure, the same rule as `batch.sh` (D15).

## Owner requirement

The PM orchestrator sent the owner request on 2026-11-06. The words are
exact.

> FAULT, act now. Your session started a second OpenCode server at about 04:53: pid 1224243, `opencode.exe serve --service`, in scope heavy-run-1224018, now a child of systemd. It opens the shared ~/.local/share/opencode/opencode.db, and the OpenChamber server uses that same database. Two servers on one SQLite file lock each other. At 05:09 and 05:10, OpenChamber logged "Failed to drain Session: SqlError", and the Monorepo Storytime adversarial role restarted after "database is locked". Benchmark sessions in that database also make it grow (now 7.1 GB).

> 2. Fix the harness: every opencode that the benchmark starts uses its own data folder (XDG_DATA_HOME and XDG_STATE_HOME set to a folder in the run directory, or the harness's own setting for that). It must never use ~/.local/share/opencode. Stop the server at the end of the job, with a trap.

> 3. Add a test that fails when the harness opencode would use the shared data folder.

> Done when: no benchmark opencode uses the shared database, and the 11-08 01:00 run uses the new setting.

## Evidence

All facts come from the files on disk and from commands on 2026-11-06. The
orchestrator measured EV1 and EV9. The author measured the other items.

- **EV1. The stray server.** `harness/cron-daily.sh --dry-run` ran inside a
  heavy-run job. Line 120 (`opencode models`) started
  `opencode.exe serve --service` at about 04:54:08. The job was killed. The
  server stayed alive, and `systemd --user` became its parent. The
  orchestrator stopped it at about 05:35. The binary is
  `/home/daniebo/.nvm/versions/node/v24.19.0/lib/node_modules/@opencode/cli/bin/opencode.exe`
  (`opencode v2.2.4`). The OpenChamber server is a different process:
  `opencode serve --hostname 127.0.0.1 --port 43003` (pid 2558 on
  2026-11-06).
- **EV2. The stale registration.** `~/.local/state/opencode/service.json`
  has the mtime `2026-11-06 04:54:08.552313003 +0700`. That time is the start
  of the stray server. The file stays after the kill. Its SHA-256 on
  2026-11-06 05:55 was
  `047e87b91d193b68bf0a9dc61111a4e6c7b79e44a5eae0cd475cc0acadc39b67`.
- **EV3. The path rules of OpenCode v2.** `opencode debug paths` starts no
  server and opens no database. With `HOME` and the four XDG variables set
  to a new folder, it printed these paths: `data` under `XDG_DATA_HOME`,
  `cache` under `XDG_CACHE_HOME`, `config` under `XDG_CONFIG_HOME`, `state`
  under `XDG_STATE_HOME`, and `db` at `$XDG_DATA_HOME/opencode/opencode.db`.
  With `HOME` only, each path fell back under `$HOME` (`.local/share`,
  `.cache`, `.config`, `.local/state`). The `tmp` path was `/tmp/opencode`
  with no `TMPDIR`, and `$TMPDIR/opencode` with `TMPDIR` set. The
  troubleshooting page of OpenCode v2 states that `OPENCODE_DB` overrides
  the database path, that the shared server registers at
  `~/.local/state/opencode/service.json`, and that its configuration is at
  `~/.config/opencode/service.json`.
- **EV4. The cause, shown in an isolated folder.** With `HOME`, the four XDG
  variables, and `TMPDIR` in a new folder under `.tmp/`, a plain
  `opencode models` exited 0. It left a detached `opencode.exe serve
  --service` process with its own session (`sid` = `pid`) and a new
  `state/opencode/service.json`. That process held 4 file descriptors under
  the folder and 0 under `~/.local/share/opencode`. Its environment held the
  marker variable that the call set. It stopped on `SIGTERM` in less than 10
  s and removed its `service.json`.
- **EV5. The fix, shown in the same folder.** `opencode models --standalone`
  exited 0, printed 8 model lines, and left no process and no
  `service.json`. The help text of `opencode models` lists `--standalone`
  under `GLOBAL FLAGS`: "Run with a private server instead of the background
  service". A store with no credential lists only `opencode/*` free models,
  so the job store needs the Console credential before `models`.
- **EV6. The host calls.** These lines call the host `opencode` binary
  directly:
  - `harness/cron-daily.sh:120` `opencode models`
  - `harness/batch.sh:272` `--version` and `harness/batch.sh:316` `models`
  - `harness/opencode-credential.sh:126` `auth export opencode`
  - `harness/run.sh:606` `--version`
  - `harness/cron-weekly.sh:44` `opencode --version`
- **EV7. The indirect host calls.** These lines start
  `harness/opencode-credential.sh`, so each one reads the store:
  - `harness/batch.sh:278` `preflight`
  - `harness/run.sh:619` `export`, `harness/run.sh:624` `scan-values`, and
    `harness/run.sh:904` `check-window`
  - `harness/go-cost.ts:213` `export`, which `harness/cron-daily.sh:95` and
    `harness/weekly.sh:32` start through `go-cost.ts --catalog`
  These scripts start `harness/run.sh` in agent mode, so they reach the run.sh
  calls: `harness/rerun-missing.sh:36`, `harness/arm-a-reruns.sh:14`,
  `harness/rerun-suite2-finalize.sh:18`, `harness/rerun-hy3-retries.sh:21`,
  `harness/rerun-deepseek-v41-w38.sh:29`, `harness/regrade.sh:140`, and
  `harness/regrade-matrix.sh:48`. `harness/verify-controls.ts:284` and
  `harness/verify-bugs.ts:266` set `AGENT_SKIP`, so they call no OpenCode.
- **EV8. The calls that stay.** `harness/opencode-entry.sh:18`, `:38`,
  `:42`, and `:71` run inside the Podman container. `harness/run.sh:716-727`
  gives the container its own `HOME` and XDG folders under `/tmp`.
  `harness/execution-identity.ts:124` runs `<path> --version` only for an
  agent identity. The harness calls `execution-identity.ts --from-env` only
  with `EXECUTION_MODE=overlay` (`harness/run.sh:331`), and that mode returns
  before line 124 (`harness/execution-identity.ts:137-139`).
- **EV9. The self-check blocks the live day.** `cron-daily.sh` sets no
  `BENCH_SELFCHECK`, so `harness/batch.sh:219` uses `meta`: the full
  `npm run test:meta` and `verify-controls.ts --fast`. The preflight of
  2026-11-06 (04:54:59 to 05:41:53, live-day PATH) gave `test:meta` exit 1
  with 6 of 250 tests failed: 2 in `run-executor-provenance.test.ts`, 2 in
  `runtime-isolation-completion.test.ts`, 1 in `runtime-isolation.test.ts`,
  and 1 in `grade-exit.test.ts` (a timeout at 60 s; the test took 80 s at a
  load of 4.95 on 4 CPUs). `harness/cron-weekly.sh:38` already sets
  `BENCH_SELFCHECK="${BENCH_SELFCHECK:-logic}"`. `test:meta:logic`
  (`harness/package.json:10`) excludes `runtime-isolation*` and
  `run-executor-provenance`. It passed 238 of 238 on 2026-11-05
  (`grader_system_chrome` task 1.3). `grade-exit.test.ts` stays in it.
- **EV10. The two timeouts.** `harness/tests/meta/grade-exit.test.ts:51` and
  `:73` each set `60_000`. `harness/vitest.config.ts:22` sets 180 000 ms for
  the meta suite. No log names the test that timed out on 2026-11-06.
- **EV11. The hash lists.** `harness/provenance.ts:51-96` lists the
  `runner_sha256` files. The list holds `harness/run.sh`,
  `harness/opencode-credential.sh`, `harness/opencode-entry.sh`,
  `harness/toolchain.sh`, and `harness/go-cost.ts`. The `suite_sha256` list
  holds every file of `harness/tests/` (`harness/provenance.ts:37`).
  `harness/cron-daily.sh`, `harness/cron-weekly.sh`, `harness/weekly.sh`,
  `harness/batch.sh`, and `harness/schedule-tests/` sit in neither list.
- **EV12. The hash marker.** `reports/harness-hashes.sha` holds
  `cb2113170e4f7466ef90f6789b53a04fc0d54c601d82ef0fffc2a6099b3c627f` and
  `d9e2349d680990da9ac0079c5f0c0c521ca6e255f76cf8ef1b60c60154c0a626` (mtime
  2026-10-25). Both differ from the current values of `grader_system_chrome`
  task 1.4. The 2026-11-08 live day runs `WEEK=all ./rescore-doctor.sh` once
  (`harness/cron-daily.sh:372-376`) with or without this track.
- **EV13. The credential payload.** `harness/opencode-credential.sh:89-92`
  writes the container payload with `refresh: "inert"`. The container never
  gets the refresh token. `scan-values` (`:94-98`) prints `access`,
  `refresh`, and `orgID`. `harness/run.sh:624` and `:764` scan the run output
  for these values.
- **EV14. The schedule.** `harness/systemd/lending-desk-daily.service` runs
  `harness/cron-daily.sh` with
  `PATH=%h/.local/share/pnpm/bin:%h/.local/bin:%h/.nvm/versions/node/v24.19.0/bin:/usr/local/bin:/usr/bin:/bin`.
  Its output goes to `reports/cron-daily.log`. The timer starts it on Wed and
  Sun at 01:00. The next start is Sun 2026-11-08 01:00 +07.
- **EV15. The served list can fail on a transient host fault.** Run 2
  (14:56) of `harness/cron-daily.sh --dry-run` on code `18a942d` passed
  every isolation check. The job-store proof passed (CW1=0, CW2=0). Run 3
  (15:07 and 15:10, two attempts) failed at the served list:
  `DAILY FAIL served: opencode models failed`. The error was
  `ServiceUnavailableError: Location plugins did not finish activating`
  from `opencode models --standalone` in the job store
  (`harness/cron-daily.sh:140`). The seed export showed the same notice
  once in run 2. Its retry rule (3 calls, 5 s apart,
  `harness/opencode-credential.sh`) passed on the second call. Diagnosis 2
  (`77f66b1`): 5 of 5 `models --standalone` calls from the repository root
  in an isolated store exited 0. The fault depends on time and host load,
  not on the working directory. `harness/batch.sh:322-336` already retries
  `opencode models`: a transient exit 1 retries up to 2 times with a 5 s
  delay. The served-list call runs before the Go guard. So a fault there
  turns a clean guard skip into `DAILY FAIL served` (exit 1) on the live
  day.

## Definitions

- **Shared store.** The OpenCode folders of the user:
  `~/.local/share/opencode`, `~/.local/state/opencode`,
  `~/.config/opencode`, and `~/.cache/opencode`. The OpenChamber server uses
  them.
- **Job.** One process of `harness/cron-daily.sh`, `harness/cron-weekly.sh`,
  `harness/weekly.sh`, `harness/batch.sh`, the agent branch of
  `harness/run.sh`, or `harness/opencode-credential.sh` outside another job.
- **Job folder.** `$ROOT/.tmp/opencode-host-<job>-<pid>/`. `<job>` is
  `daily`, `weekly-cron`, `weekly`, `batch`, `run`, or `credential`. `<pid>`
  is the process id of the job.
- **Job store.** The OpenCode folders inside the job folder.
- **Owner.** The job that made the job folder. A nested job uses the folder
  of its owner.
- **Marker.** The environment line `BENCH_OPENCODE_JOB=<job folder>`. Only an
  OpenCode call of the harness carries it.
- **Seed.** The one read of the shared store per job folder, and the import
  of the result into the job store.

## Design decisions

Each decision below is a default by the orchestrator or the author,
2026-11-06. The PM can change it.

1. **D1. The job folder.** Each owner makes one job folder with the
   subfolders `home`, `config`, `data`, `state`, `cache`, `runtime`, and
   `tmp` (mode 700), and the file `owner.pid`. The owner exports
   `BENCH_OPENCODE_HOME=<job folder>`. A job that finds `BENCH_OPENCODE_HOME`
   set to an existing folder uses that folder and is not an owner. A job that
   finds the variable set to a missing folder makes its own folder and
   becomes the owner. The owners are `cron-daily.sh` (after the lock at
   line 77), `cron-weekly.sh` (after the lock at line 23), `weekly.sh`,
   `batch.sh`, `run.sh` (at the start of the agent branch, before line 904),
   and `opencode-credential.sh` when no job folder exists.
2. **D2. The call wrapper.** A new file `harness/opencode-host.sh` holds the
   shell functions of this track. Each job sources it. The function
   `opencode_host_run <args>` runs the binary with these settings and passes
   the arguments without change:
   - `HOME=<job folder>/home`
   - `XDG_CONFIG_HOME=<job folder>/config`
   - `XDG_DATA_HOME=<job folder>/data`
   - `XDG_STATE_HOME=<job folder>/state`
   - `XDG_CACHE_HOME=<job folder>/cache`
   - `XDG_RUNTIME_DIR=<job folder>/runtime`
   - `TMPDIR=<job folder>/tmp`
   - `OPENCODE_DISABLE_AUTOUPDATE=1`
   - `OPENCODE_DB` removed from the environment
   - the marker
   The binary is `BENCH_OPENCODE_BIN` when set, else `command -v opencode`.
   The function stops with exit 2 and the line
   `opencode-host: no job folder` when `BENCH_OPENCODE_HOME` is empty or
   names a folder that does not exist. So no call can make a removed folder
   again. A job
   never exports these XDG variables, `HOME`, or `TMPDIR` to its own shell,
   because Podman reads `XDG_DATA_HOME` for its image store and `run.sh`
   reads `XDG_RUNTIME_DIR` for the credential staging (`harness/run.sh:611`).
3. **D3. The private server.** Each `models` call and each `auth` call adds
   `--standalone` right after the subcommand words:
   `models --standalone`, `auth export --standalone opencode`, and
   `auth import --standalone`. A `--version` call adds no flag. When the
   Phase 2 preflight shows a usage error for `auth export --standalone
   opencode`, the maker changes the form to `auth export opencode
   --standalone` in the same task and records the change.
4. **D4. The seed.** `opencode-credential.sh` gets a new mode `seed`. It runs
   once per job folder, under `flock` on `<job folder>/seed.lock`, and it
   writes `<job folder>/seeded` on success. It runs `timeout 60
   "$OPENCODE_BIN" auth export --standalone opencode` with the caller's own
   `HOME` and XDG variables, plus the marker and
   `OPENCODE_DISABLE_AUTOUPDATE=1`. The variable name stays `OPENCODE_BIN`
   (`harness/opencode-credential.sh:33-37`). That call is the only call that
   reads the shared store. The present
   selection code (`harness/opencode-credential.sh:56-119`) makes the
   access-only payload (`refresh: "inert"`), and a pipe sends it to
   `opencode_host_run auth import --standalone`. The payload never touches a
   disk. The retry rule of `:121-142` applies to the shared read. The real
   refresh token never enters the job store, so no job store can rotate it.
   Every other mode first runs the seed when `<job folder>/seeded` is
   missing. Then it reads the job store with `opencode_host_run auth export
   --standalone opencode`. `cron-daily.sh` and `batch.sh` run
   `opencode-credential.sh seed` before their `models` call. The mode `seed`
   prints nothing and exits 0 on success. On a failure it exits 2 with the
   present `opencode-credential:` error line. Then `cron-daily.sh` prints
   `DAILY FAIL served: the Console credential seed failed` and exits 1, and
   `batch.sh` prints `executor preflight failed: the Console credential seed
   failed` and exits 3. A live day reads the shared store once. The
   alternative is owner question O1.
5. **D5. The scan values.** `scan-values` drops a value that equals `inert`.
   The job store holds `inert` as the refresh value, and the word `inert` in
   a transcript is no leak. The container never gets the real refresh token
   (EV13), so the scan of `access` and `orgID` stays complete.
6. **D6. The trap.** Only the owner cleans up. The function
   `opencode_host_cleanup` does nothing in a job that is not an owner, and a
   second call does nothing. The owner adds it to its `EXIT` trap. The owner
   sets `trap 'exit 130' INT` and `trap 'exit 143' TERM`, so the `EXIT` trap
   also runs on those signals. `cron-daily.sh` adds the call to its present
   `EXIT` trap (line 67). `run.sh` adds it to the traps at lines 164 and 748
   and keeps its present `TERM` and `INT` traps. The cleanup has these steps:
   1. Find each process of the user whose `/proc/<pid>/environ` holds the
      exact marker line. Skip `$$` and `$BASHPID`.
   2. Send `SIGTERM` to each. Wait up to 10 s, and test each pid each
      second with `kill -0`.
   3. Send `SIGKILL` to each process that is still alive.
   4. Find each process with a link in `/proc/<pid>/fd` that starts with
      `<job folder>/`. When one exists, print one
      `OPENCODE_HOME CLEANUP FAIL pid=<pid> path=<job folder>` line for each,
      and keep the folder.
   5. Else, remove the folder with `rm -rf --`, only when its path starts
      with `$ROOT/.tmp/opencode-host-`.
   6. Print `OPENCODE_HOME CLEANUP stopped=<n> path=<job folder>`. `<n>` is
      the count of processes of step 2.
   The cleanup never selects a process by its name or its command line, so
   it never stops the OpenChamber server or the OpenCode of another session.
7. **D7. The sweep.** A `SIGKILL` runs no trap. So each new owner first
   checks each `$ROOT/.tmp/opencode-host-*/` folder. When `kill -0` fails on
   the pid in its `owner.pid`, the owner runs steps 1 to 5 of D6 for that
   folder and prints `OPENCODE_HOME SWEEP stopped=<n> path=<folder>`. A
   folder with a live owner stays.
8. **D8. The log line.** `cron-daily.sh` prints
   `DAILY OPENCODE_HOME <job folder>` right after the lock, before the
   catalog fetch. `<job folder>` is the absolute path. A dry run prints the
   line too.
9. **D9. The self-check of the daily job.** `cron-daily.sh` sets
   `export BENCH_SELFCHECK="${BENCH_SELFCHECK:-logic}"` before the first
   batch, the same as `harness/cron-weekly.sh:38`. An explicit caller value
   stays. Each batch canary still proves the grading path.
10. **D10. The two timeouts.** `harness/tests/meta/grade-exit.test.ts:51` and
    `:73` change from `60_000` to `180_000`. Both tests check the exit
    semantics of `grade.sh`, not its time. No log names the test that timed
    out (EV10), so both change. This is a test-only change.
11. **D11. The hashes.** The change of `run.sh` and
    `opencode-credential.sh` moves `runner_sha256`. The change of
    `harness/tests/` (D10 and the test fakes of FR-9) moves `suite_sha256`.
    The marker of EV12 already differs, so the 2026-11-08 live day runs one
    rescore with or without this track. The rescore guard of
    `grader_system_chrome` D3 still holds each build, bugfix, or change score
    without a Chrome record. `harness/opencode-host.sh` stays out of both
    hash lists, because it changes no grade and no container input. The plan
    records the AFTER hashes and names this track to `grader_system_chrome`
    (its risk R4).
12. **D12. The scope.** These items stay out of scope. Phase 1 writes each one
    to `measure/runs/opencode_host_isolation/findings.md` for a later track:
    - F1: `run-executor-provenance.test.ts` expects provenance schema 6 and
      executor schema 1 (now 7 and 2) and a missing
      `execution-identity.json`.
    - F2: `runtime-isolation-completion.test.ts` expects
      `probe_pi_mounted: true`, but Pi is removed.
    - F3: the container probe environment held host provider keys
      (`OPENCODE_API_KEY`, `XIAOMI_API_KEY`) of the calling session.
    - F4: the real grade server probe of `runtime-isolation.test.ts` exited 4.
    - F5: the stale `~/.local/state/opencode/service.json` of EV2. Its
      removal is a human gate.
    - F6: the shared `opencode.db` holds 7.1 GB. Its clean-up is a human gate.
    - F7: `execution-identity.ts:124` stays unchanged, because no production
      path reaches it (EV8).
    - F8: the host calls run with the repository root as the working
      directory, and the user's project folder `.opencode/` (with
      `@opencode-ai/plugin`) may load. No fault is proven (EV15, diagnosis
      2). A later track may run host calls from the job folder.
13. **D13. The lanes.** The lane is light. One maker and one checker of a
    different model family. The checker is not a Kimi model.
    - Maker: `minimax-cn-coding-plan/MiniMax-M3.1-Flash`.
    - Code checker: `claude-code/claude-sonnet-5-5#high`.
    - Spec checker: `volcengine-agent-plan/glm-latest#high`.
14. **D14. The deadline.** The harness commit and the Phase 1 gates finish
    before Sat 2026-11-07 23:00 +07. When they do not, the orchestrator tells
    the PM at that time. The PM and Daniel then decide about the 2026-11-08
    timer. No role stops the timer.
15. **D15. The served-list retry.** The served-list call of `cron-daily.sh`
    (`opencode_host_run models --standalone`, line 140) uses the same retry
    rule as `batch.sh:322-336` (EV15): up to 3 calls in total, 5 s apart,
    while the call exits non-zero or writes an empty list. A non-empty list
    stops the retry at once. After the third failure the job prints the
    existing line `DAILY FAIL served: opencode models failed` and exits 1,
    as now. Each retry keeps `--standalone` and the job store (D2, D3).

## Functional requirements

### FR-1 — Each host call uses the job store

- Each host OpenCode call of the harness goes through `opencode_host_run`
  (D2), except the shared read of the seed (D4). This holds for the calls of
  EV6 and the indirect calls of EV7. The OpenCode data folder of each call
  resolves under `<job folder>/data`, never under `$HOME/.local/share`.
- **Check.** The test of FR-7 passes. This command prints no line:

  ```
  rg -n -e '\$\(opencode ' -e '(^|[;&|!(]\s*|^\s*)opencode (models|auth|--version)' harness/cron-daily.sh harness/cron-weekly.sh harness/weekly.sh harness/batch.sh harness/run.sh
  ```

  This command prints exactly one line. The line is in
  `harness/opencode-credential.sh`, and it is the shared read of D4:

  ```
  rg -n '"\$(PREFLIGHT_OPENCODE_BIN|opencode_bin|OPENCODE_BIN)" +(models|auth|--version)' harness/ --glob '!node_modules' --glob '!tests' --glob '!schedule-tests'
  ```

### FR-2 — No call starts a detached server

- Each `models` and `auth` call carries `--standalone` (D3).
- **Check.** The test of FR-7 finds `--standalone` in the argument list of
  each recorded `models` and `auth` call.

### FR-3 — One shared read per job folder

- The seed of D4 runs at most once per job folder. All other credential
  reads use the job store. A live day reads the shared store once.
- **Check.** The test of FR-7 counts the calls that resolve to the shared
  data folder. The count is 1 for one `cron-daily.sh --dry-run`, and the call
  is `auth export --standalone opencode`. The Phase 2 shim log shows the same
  count.

### FR-4 — The trap stops the job processes

- The owner runs the cleanup of D6 on a normal exit, on `SIGINT`, and on
  `SIGTERM`. A new owner runs the sweep of D7.
- **Check.** The test of FR-8 passes. After the Phase 2 preflight, `ps -eo
  pid,args | grep '[o]pencode'` prints only the OpenChamber server, and the
  job folder is gone.

### FR-5 — The daily log line

- `cron-daily.sh` prints `DAILY OPENCODE_HOME <job folder>` (D8). The owner
  prints `OPENCODE_HOME CLEANUP stopped=<n> path=<job folder>` at the end.
- **Check.** The Phase 2 log and the 2026-11-08 part of
  `reports/cron-daily.log` each hold one `DAILY OPENCODE_HOME` line and one
  `OPENCODE_HOME CLEANUP stopped=` line with the same path. Neither log holds
  an `OPENCODE_HOME CLEANUP FAIL` line.

### FR-6 — The daily self-check is logic

- `cron-daily.sh` exports `BENCH_SELFCHECK` with the default `logic` (D9).
- **Check.** The test of FR-9 passes. The 2026-11-08 part of
  `reports/cron-daily.log` holds `SELF-CHECK <time> — test:meta:logic` and
  no `sensitivity controls` line.

### FR-7 — The isolation test

- The file `harness/schedule-tests/opencode-host-isolation.test.ts` puts a
  fake `opencode` on `PATH` and in `BENCH_OPENCODE_BIN`. The fake appends one
  JSON line per call to a record file. The line holds `argv`, `HOME`,
  `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`,
  `TMPDIR`, and a flag that tells if `OPENCODE_DB` is set. The fake accepts
  `--standalone` at any place. It keeps its store in the resolved data
  folder (see below): `auth import` writes its standard input to
  `<data>/opencode/fake-auth.json`, and `auth export` prints that file. It
  prints `opencode v2.2.4` for `--version` and the model refs that the batch
  needs for `models`. The test sets `HOME` to a temp folder that stands for
  the shared home, and it removes the four XDG variables from the
  environment. Before each case, the test writes one fake Console export to
  `<shared home>/.local/share/opencode/fake-auth.json`. The export has a far
  `expires` value and fake token strings, for example `fake-access`,
  `fake-refresh`, and `fake-org`.
- Each test copies the scripts that it runs into a temp repo, the same as
  `harness/schedule-tests/rescore-guard.test.ts`. So `$ROOT/.tmp` is a temp
  folder, and no test writes under the real `.tmp/`, `runs/`, or
  `reports/`. The tests of FR-8 and FR-9 follow the same rule.
- The test resolves the data folder of each call: `XDG_DATA_HOME` when it is
  set, else `$HOME/.local/share`. It resolves the state folder the same way.
  It fails when a call resolves either folder under the temp shared home, or
  when `OPENCODE_DB` is set, except for the one
  `auth export --standalone opencode` call of the seed.
- The test runs these entry points with test seams and a temp folder for all
  writes:
  - `cron-daily.sh --dry-run`. The test sets `BENCH_DAILY_CATALOG` to a temp
    catalog file, because `go-cost.ts --catalog` fetches from the network.
    It leaves `BENCH_DAILY_SERVED` unset, so the run reaches line 120. It
    sets `BENCH_DAILY_QUOTA_CMD`, `BENCH_DAILY_BATCH`, `BENCH_DAILY_LOCK`,
    `BENCH_DAILY_DIR`, and `BENCH_RUNS_ROOT` to temp values.
  - `batch.sh` with `BENCH_SELFCHECK=skip`. The test reads the record file
    with any exit code of `batch.sh`. The record must hold the `--version`
    call, the seed calls, and the `models` call.
  - `opencode-credential.sh` in each mode: `seed`, `export`, `check-window`,
    `warn`, `preflight`, and `scan-values`.
  - `run.sh` in agent mode, with a fake `podman` on `PATH`. The test follows
    the fakes of `harness/tests/meta/opencode-run-fixtures.ts`. The record
    must hold the `check-window` read of line 904, the `--version` call of
    line 606, and the `export` read of line 619. The test reads the record
    with any exit code of `run.sh`.
- The test also checks that `scan-values` in a job prints `fake-access` and
  `fake-org`, and no line `inert` (D5).
- The test fails on the base commit `f55d2aa`. The plan records that Red
  result.

### FR-8 — The trap test

- The file `harness/schedule-tests/opencode-host-trap.test.ts` uses a fake
  `opencode`. For `models`, the fake starts a detached child with `setsid`
  and returns at once. The child runs for 600 s, keeps the environment, and
  writes its pid to a file. It stands for `serve --service`. Its command
  line holds the text `fake-opencode`, so a `ps` check can find a rest.
- The test also starts a decoy process with no marker. The decoy stands for
  the OpenChamber server and for the OpenCode of another session.
- Case 1, normal exit: `cron-daily.sh --dry-run` exits 0. Then the child is
  dead, the decoy is alive, and the job folder is gone.
- Case 2, `SIGTERM`: the test starts `cron-daily.sh --dry-run` in its own
  process group. `BENCH_DAILY_QUOTA_CMD` writes a ready file and then waits
  30 s. The test waits for the ready file, and then sends `SIGTERM` to the
  process group. The child is not in that group. The test then waits up to
  20 s. Then the child is dead, the decoy is alive, and the job folder is
  gone.
- Case 3, the sweep: the test makes a job folder whose `owner.pid` names a
  dead pid, and starts a marked child for that folder. A new
  `cron-daily.sh --dry-run` prints `OPENCODE_HOME SWEEP stopped=1`. Then the
  child is dead, the decoy is alive, and the old folder is gone.
- The test stops the decoy at its end. It fails on the base commit `f55d2aa`.

### FR-9 — The self-check test and the meta fakes

- The file `harness/schedule-tests/daily-selfcheck-default.test.ts` runs
  `cron-daily.sh` with a fake `BENCH_DAILY_BATCH` that records the value of
  `BENCH_SELFCHECK`. With no caller value, each batch gets `logic`. With the
  caller value `meta`, each batch gets `meta`. The test fails on the base
  commit `f55d2aa`.
- The fakes in `harness/tests/meta/` that stand for `opencode` accept the new
  argument lists of D3 and the `auth import` call of D4. The assertions of
  those tests do not change.

### FR-10 — The live day uses the new setting

- The 2026-11-08 live day runs on the harness commit of this track.
- **Check.** The 2026-11-08 part of `reports/cron-daily.log` holds the lines
  of FR-5 and FR-6. After the service ends, `ps -eo pid,args | grep
  '[o]pencode'` prints only the OpenChamber server. No
  `$ROOT/.tmp/opencode-host-daily-*` folder exists. The SHA-256 of
  `~/.local/state/opencode/service.json` equals the value that task 3.1
  records before the live day.

### FR-11 — The served-list retry of the daily job

- The served-list `models` call of `cron-daily.sh` follows the retry rule
  of D15: up to 3 calls in total, 5 s apart, while the call exits non-zero
  or writes an empty list. A non-empty list stops the retry at once. After
  the third failure the job prints `DAILY FAIL served: opencode models
  failed` and exits 1. Each retry keeps `--standalone` and the job store
  (D2, D3).
- **Check.** The file `harness/schedule-tests/daily-served-retry.test.ts`
  passes. One case proves the transient path: a fake `opencode` fails the
  first `models --standalone` call and passes the second, the job reaches
  the dry-run plan, and the fake records exactly 2 `models` calls, both
  with `--standalone` and the job-store data folder. The other case proves
  the fail path: three failures give `DAILY FAIL served: opencode models
  failed`, exit 1, after exactly 3 calls.

## Non-functional requirements

- **NFR-1 No model call.** The tests and the preflight send no prompt. The
  dry run calls no model.
- **NFR-2 No secret in a log.** No test, log, or record holds a real token.
  The fake export uses fake strings. No role reads `harness/results.json`.
- **NFR-3 No change of the container.** The Podman argument list, the
  container payload, `opencode-entry.sh`, and the execution identity stay the
  same.
- **NFR-4 No touch of the shared store outside the seed.** No role edits,
  removes, or copies a file of the shared store.
- **NFR-5 Each test file runs alone.** `cd harness && npx vitest run
  schedule-tests/<file> --configLoader native` exits 0 for each new file.
- **NFR-6 The heavy runs use the wrapper.** Each heavy command runs through
  `/home/daniebo/Desktop/advantage-pr/scripts/jobs/heavy-run.sh` with
  `HEAVY_MIN_AVAIL_MB=1500`.

## Owner decisions

| ID | Decision | Proposed default | Answer |
|---|---|---|---|
| O1 | The source of the Console credential. The seed of D4 reads the shared store once per job folder, with a private server that exits with the call. The alternative: Daniel logs in once to a store that only the benchmark owns, for example `~/.local/share/lending-desk-bench/opencode-store/`, and the seed reads that store. Then no harness call reads the shared store. That needs one interactive `opencode auth login` by Daniel with that store in `HOME` and the XDG variables. | D4: one shared read per job folder with `--standalone`. | open — the PM asks the owner |

## Acceptance criteria

1. **AC-1** Each host call of EV6 and EV7 resolves its data and state
   folders under the job folder, except the one seed read (FR-1, FR-3).
2. **AC-2** Each `models` and `auth` call carries `--standalone` (FR-2).
3. **AC-3** The trap stops each marked process on a normal exit and on
   `SIGTERM`, the sweep stops the marked processes of a dead owner, and the
   decoy stays alive (FR-4, FR-8).
4. **AC-4** `cron-daily.sh` prints `DAILY OPENCODE_HOME <job folder>` and the
   cleanup line (FR-5).
5. **AC-5** `cron-daily.sh` runs the batches with `BENCH_SELFCHECK=logic` by
   default, and an explicit caller value stays (FR-6, FR-9).
6. **AC-6** The three new test files fail on `f55d2aa` and pass on the
   harness commit, each alone (FR-7, FR-8, FR-9, NFR-5).
7. **AC-7** `schedule-tests/` and `npm run test:meta:logic` pass inside the
   heavy-run wrapper (FR-9).
8. **AC-8** The Phase 2 preflight exits 0, plans more than 0 runs, leaves no
   job process, and leaves the shared `service.json` unchanged (FR-4).
9. **AC-9** The 2026-11-08 live day uses the new setting (FR-10).
10. **AC-10** The maker and the checker sit in different model families, and
    the checker is not a Kimi model (D13).
11. **AC-11** The served-list call of `cron-daily.sh` retries up to 3 calls,
    5 s apart, keeps `--standalone` and the job store on each retry, and
    prints the existing failure line after the third failure (FR-11, D15).

## Out of scope

- The items F1 to F8 of D12.
- A change of the container, of `opencode-entry.sh`, or of the Podman
  argument list.
- A clean-up of the shared `opencode.db` or of the stale `service.json`.
- A change of the scoring, of the run schedule, or of the model list.
- The `opencode service set disabled true` setting. It is a setting of the
  user, not of the harness.

## Risks

- **R1 The access token can expire during a long day.** The job store holds
  the access token of the seed time, and the job store cannot refresh it.
  The check of each batch preflight and of each run (`check-window`) still
  fails closed. The present Console tokens expire after days (the weekly
  warning uses 7 days), so a 16 h day stays inside the window.
- **R2 The flag place of `--standalone`.** The author saw the help text of
  `models` only, because the safety rules forbid an `auth export` call. The
  Phase 2 preflight runs the real `auth export` and `auth import` calls. D3
  gives the fallback form.
- **R3 The hashes move again.** EV12 shows that the live day rescores in any
  case. The plan records the AFTER hashes.
- **R4 A hard kill leaves a process.** A `SIGKILL` of the job runs no trap.
  The private server of D3 exits with its CLI call, and the sweep of D7 stops
  any rest at the next owner start.
- **R5 Another session starts a shared server during the check.** The check
  of the shared `service.json` then fails with no fault of the harness. The
  shim log of Phase 2 is the second proof.
