# Pilot report: harness tests in a cloud container

## Scope

This report gives the results of four test steps in `harness/`.

- Repository: `bodangren/lending-desk-bench`.
- Branch: `pilot/cloud-lending-tests`. The branch was at commit `c613bc8`. We did a checkout of this branch.
- Host: Linux cloud container, Node.js v22.23.4, npm 10.9.9.
- We did not change a file that git holds. We added only this report.

## Safety conditions

- We did not set a provider key.
- We removed these variables from the test environment: `ANTHROPIC_BASE_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `GH_TOKEN`, `GITHUB_TOKEN`.
- We set `HTTP_PROXY` and `HTTPS_PROXY` to `http://127.0.0.1:9` for steps 2 to 4. This port is closed. Thus a network call from a test cannot go out.
- We did not start `run.sh`, `batch.sh`, `weekly.sh`, or a `cron-*.sh` script directly.
- Some tests start `run.sh`, `batch.sh`, `grade.sh`, or a copy of `cron-daily.sh`. These tests use fake OpenCode, fake Pi, and fake Podman binaries in temporary folders. They also use an explicit environment.
- The host does not have `opencode`, `pi`, or `podman`. Thus a real agent cannot start.
- No test tried to connect to a model provider. We did not stop a test.

## Changes to the work tree

- Step 1 made `harness/node_modules/`. Git ignores this folder.
- Step 2 wrote `harness/results.json`. Git ignores this file. We moved it out of the repository.
- For steps 3 and 4, we set `RESULT_FILE` to a path outside the repository.
- Step 3 made an empty `runs/` folder at the root. We removed it.

## Summary of results

| Step | Command (in `harness/`) | Exit status | Tests passed | Tests failed |
|---|---|---|---|---|
| 1 | `npm ci` | 0 | Not applicable | Not applicable |
| 2 | `npm run test:unit` | 1 | 1 of 8 | 7 of 8 |
| 3 | `npm run test:meta:logic` | 1 | 199 of 238 | 39 of 238 |
| 4 | `npx vitest run schedule-tests` | 0 | 111 of 111 | 0 of 111 |

No test was skipped. No test had a timeout.

## Failure types

| Type | Number of failures |
|---|---|
| Code defect | 0 |
| Dependency on host state that git does not hold | 46 |
| Timeout | 0 |

## Step 1: `npm ci`

- Exit status: 0.
- Result: npm added 304 packages in 8 seconds.
- Note: npm `audit` shows 14 vulnerabilities (8 moderate, 6 high). These do not stop the install.

## Step 2: `npm run test:unit`

- Exit status: 1.
- Test files: 2 failed.
- Tests: 1 passed, 7 failed.
- Duration: 0.2 seconds.

### Cause

The unit tests examine a candidate application. The `CANDIDATE` variable selects the candidate. When `CANDIDATE` is not set, the tests use `fixture/`. The `fixture/` folder is the blank start tree for an agent. It does not have an implementation. Thus a pass requires a completed candidate tree, for example a run folder in `runs/`. Git does not hold that tree.

Type for all 7 failures: dependency on host state that git does not hold (a candidate tree, `CANDIDATE` or `runs/`).

### Failed tests

| File | Test | First error lines |
|---|---|---|
| `tests/unit/loans.test.ts` | `computeLoanStatus > A.returned` | `Error: computeLoanStatus is not implemented` at `../fixture/src/lib/loans.ts:9:9` |
| `tests/unit/loans.test.ts` | `computeLoanStatus > A.overdue` | `Error: computeLoanStatus is not implemented` at `../fixture/src/lib/loans.ts:9:9` |
| `tests/unit/loans.test.ts` | `computeLoanStatus > A.due-soon` | `Error: computeLoanStatus is not implemented` at `../fixture/src/lib/loans.ts:9:9` |
| `tests/unit/loans.test.ts` | `computeLoanStatus > A.ok` | `Error: computeLoanStatus is not implemented` at `../fixture/src/lib/loans.ts:9:9` |
| `tests/unit/loans.test.ts` | `computeLoanStatus > A.boundary` | `Error: computeLoanStatus is not implemented` at `../fixture/src/lib/loans.ts:9:9` |
| `tests/unit/track-plan.test.ts` | `Measure track closeout > M.plan-complete` | `AssertionError: uncompleted track tasks:` followed by the 24 plan tasks, `expected [ …(24) ] to deeply equal []` |
| `tests/unit/track-plan.test.ts` | `Measure track closeout > M.closeout` | `AssertionError: expected 'pending' to be 'complete'` at `tests/unit/track-plan.test.ts:86:29` |

## Step 3: `npm run test:meta:logic`

- Exit status: 1.
- Test files: 7 failed, 23 passed (30 files).
- Tests: 199 passed, 39 failed (238 tests).
- Duration: 63 seconds.

### Cause A: the `runs/` folder is not present

Git ignores `runs/`. A fresh clone does not have it. `tests/meta/executor-attestation.test.ts` calls `mkdtempSync` in `runs/`. This call fails when the folder is not present. A later test file made `runs/`. Thus the result also depends on the order of the test files.

Type: dependency on host state that git does not hold (`runs/`).

### Cause B: the `fixture/node_modules` folder is not present

Git does not hold `fixture/node_modules`. These script lines need it:

- `harness/run.sh:592` stops with exit status 2 before it starts Podman. The message is `fixture node_modules is unavailable`.
- `harness/grade.sh:118` copies `fixture/node_modules` only when it is present. Then `harness/grade.sh:124` stops with exit status 4. The reason is `required local executable is unavailable`. This step occurs before the contract check writes `candidate-contract.json`.

The OpenCode tests expect `run.sh` to reach the fake Podman. Because `run.sh` stops at line 592, the fake Podman does not start. Thus the fake writes no capture file, no config, and no score.

We found this cause by code reading. We did not start `run.sh` directly to confirm it.

Type: dependency on host state that git does not hold (`fixture/node_modules`).

### Failed tests

| File | Test | First error lines | Cause |
|---|---|---|---|
| `tests/meta/executor-attestation.test.ts` | `current executor attestation fails closed for a fresh agent score missing 'both cohort fields'` | `Error: ENOENT: no such file or directory, mkdtemp '…/runs/meta-executor-missing-cohort-XXXXXX'` at line 336 | A |
| `tests/meta/executor-attestation.test.ts` | `current executor attestation fails closed for a fresh agent score missing 'cohort_id only'` | `Error: ENOENT: no such file or directory, mkdtemp '…/runs/meta-executor-missing-cohort-XXXXXX'` at line 336 | A |
| `tests/meta/executor-attestation.test.ts` | `current executor attestation fails closed for a fresh agent score missing 'executor_cohort only'` | `Error: ENOENT: no such file or directory, mkdtemp '…/runs/meta-executor-missing-cohort-XXXXXX'` at line 336 | A |
| `tests/meta/executor-attestation.test.ts` | `current executor attestation makes a previously trusted score stale and non-rankable when its live executor cohort drifts` | `Error: ENOENT: no such file or directory, mkdtemp '…/runs/meta-executor-freshness-XXXXXX'` at line 374 | A |
| `tests/meta/grade-exit.test.ts` | `standalone grade exit semantics keeps a structurally valid gate-blocked record nonpublishable and nonrankable` | `AssertionError: expected 4 to be +0` at line 60. The output of `grade.sh` was empty. | B |
| `tests/meta/runner-safety.test.ts` | `runner safety contract standalone grade rejects a protected candidate mutation before gate or suites` | `Error: ENOENT: no such file or directory, open '…/runs/grade-protected-54R8fC/artifacts/candidate-contract.json'` at line 92 | B |
| `tests/meta/opencode-credential.test.ts` | `OpenCode credential delivery streams only the selected Console access payload to Podman stdin, with an inert refresh` | `AssertionError: the fake Podman must record credential delivery: expected false to be true` at line 13 | B |
| `tests/meta/opencode-credential.test.ts` | `OpenCode credential delivery keeps Console canaries out of argv, environment, artifacts, logs, provenance, score, and the session export` | `AssertionError: the runner must export the Console credential before the leak check: expected false to be true` at line 34 | B |
| `tests/meta/opencode-credential.test.ts` | `OpenCode credential delivery removes credential staging after agent success` | `AssertionError: the fake Podman must start before cleanup is checked: expected undefined to be defined` at line 48 | B |
| `tests/meta/opencode-credential.test.ts` | `OpenCode credential delivery removes credential staging after agent failure` | `AssertionError: the fake Podman must start before cleanup is checked: expected undefined to be defined` at line 48 | B |
| `tests/meta/opencode-credential.test.ts` | `OpenCode credential delivery removes credential staging after agent timeout` | `AssertionError: the fake Podman must start before cleanup is checked: expected undefined to be defined` at line 48. This is not a test timeout. | B |
| `tests/meta/opencode-credential.test.ts` | `OpenCode credential delivery removes credential staging after SIGINT during the fake agent` | `AssertionError: the fake Podman must publish its start marker: expected false to be true` at line 64 | B |
| `tests/meta/opencode-credential.test.ts` | `OpenCode credential delivery removes credential staging after SIGTERM during the fake agent` | `AssertionError: the fake Podman must publish its start marker: expected false to be true` at line 64 | B |
| `tests/meta/opencode-credential.test.ts` | `OpenCode credential delivery keeps every other integration on the host and delivers only the active Console connection` | `AssertionError: the selected Console connection must reach the fake Podman: expected false to be true` at line 116 | B |
| `tests/meta/opencode-credential.test.ts` | `OpenCode credential delivery a serial batch checks the run window again before a later agent` | `AssertionError: only the first run window is covered: expected +0 to be 1` at line 150 | B |
| `tests/meta/opencode-credential.test.ts` | `OpenCode credential delivery the weekly near-side expiry warning preserves a covered batch` | `AssertionError: the warning must not stop the covered batch: expected +0 to be 1` at line 169 | B |
| `tests/meta/opencode-credential.test.ts` | `OpenCode credential delivery the weekly far-side expiry warning preserves a covered batch` | `AssertionError: the warning must not stop the covered batch: expected +0 to be 1` at line 169 | B |
| `tests/meta/opencode-credential.test.ts` | `OpenCode credential delivery redacts a canary from session output and the export and records an invalid credential-leak reason` | `AssertionError: the fake must plant a canary in the export: expected false to be true` at line 179 | B |
| `tests/meta/opencode-executor.test.ts` | `OpenCode executor and isolation contract Arm a: the whole Podman argv equals design 1.2, in order, including -i` | `AssertionError: run.sh must reach the fake Podman with the Console credential: expected false to be true` at line 32 | B |
| `tests/meta/opencode-executor.test.ts` | `OpenCode executor and isolation contract Arm a: the mount set equals FR-4 without any extra host mount` | `AssertionError: run.sh must reach the fake Podman with the Console credential: expected false to be true` at line 32 | B |
| `tests/meta/opencode-executor.test.ts` | `OpenCode executor and isolation contract Arm a: the container uses private HOME and XDG paths and the confirmed disable flags` | `AssertionError: run.sh must reach the fake Podman with the Console credential: expected false to be true` at line 32 | B |
| `tests/meta/opencode-executor.test.ts` | `OpenCode executor and isolation contract Arm a: the container never receives OPENCODE_API_KEY` | `AssertionError: run.sh must reach the fake Podman with the Console credential: expected false to be true` at line 32 | B |
| `tests/meta/opencode-executor.test.ts` | `OpenCode executor and isolation contract Arm a: the whole run argv uses standalone JSON auto mode and the default model variant` | `AssertionError: the entry script must invoke the fake OpenCode, not Pi: expected false to be true` at line 102 | B |
| `tests/meta/opencode-executor.test.ts` | `OpenCode executor and isolation contract Arm a: score.json records thinking_requested as default` | `AssertionError: O1 requires default even when THINKING=xhigh enters the host environment: expected undefined to be 'default'` at line 112 | B |
| `tests/meta/opencode-executor.test.ts` | `OpenCode executor and isolation contract Arm a: config denies question, websearch, and subagent but not webfetch` | `AssertionError: Arm a must write its generated OpenCode config: expected false to be true` at line 38 | B |
| `tests/meta/opencode-executor.test.ts` | `OpenCode executor and isolation contract Arm a: config contains exactly the arm rules, skill paths, and instruction entry` | `AssertionError: Arm a must write its generated OpenCode config: expected false to be true` at line 38 | B |
| `tests/meta/opencode-executor.test.ts` | `OpenCode executor and isolation contract Arm a: AGENTS.md presence and the five skill snapshots match the arm` | `AssertionError: run.sh must reach the fake Podman with the Console credential: expected false to be true` at line 32 | B |
| `tests/meta/opencode-executor.test.ts` | `OpenCode executor and isolation contract Arm b: the whole Podman argv equals design 1.2, in order, including -i` | `AssertionError: run.sh must reach the fake Podman with the Console credential: expected false to be true` at line 32 | B |
| `tests/meta/opencode-executor.test.ts` | `OpenCode executor and isolation contract Arm b: the mount set equals FR-4 without any extra host mount` | `AssertionError: run.sh must reach the fake Podman with the Console credential: expected false to be true` at line 32 | B |
| `tests/meta/opencode-executor.test.ts` | `OpenCode executor and isolation contract Arm b: the container uses private HOME and XDG paths and the confirmed disable flags` | `AssertionError: run.sh must reach the fake Podman with the Console credential: expected false to be true` at line 32 | B |
| `tests/meta/opencode-executor.test.ts` | `OpenCode executor and isolation contract Arm b: the container never receives OPENCODE_API_KEY` | `AssertionError: run.sh must reach the fake Podman with the Console credential: expected false to be true` at line 32 | B |
| `tests/meta/opencode-executor.test.ts` | `OpenCode executor and isolation contract Arm b: the whole run argv uses standalone JSON auto mode and the default model variant` | `AssertionError: the entry script must invoke the fake OpenCode, not Pi: expected false to be true` at line 102 | B |
| `tests/meta/opencode-executor.test.ts` | `OpenCode executor and isolation contract Arm b: score.json records thinking_requested as default` | `AssertionError: O1 requires default even when THINKING=xhigh enters the host environment: expected undefined to be 'default'` at line 112 | B |
| `tests/meta/opencode-executor.test.ts` | `OpenCode executor and isolation contract Arm b: config denies question, websearch, and subagent but not webfetch` | `AssertionError: Arm b must write its generated OpenCode config: expected false to be true` at line 38 | B |
| `tests/meta/opencode-executor.test.ts` | `OpenCode executor and isolation contract Arm b: config contains exactly the arm rules, skill paths, and instruction entry` | `AssertionError: Arm b must write its generated OpenCode config: expected false to be true` at line 38 | B |
| `tests/meta/opencode-executor.test.ts` | `OpenCode executor and isolation contract Arm b: AGENTS.md presence and the five skill snapshots match the arm` | `AssertionError: run.sh must reach the fake Podman with the Console credential: expected false to be true` at line 32 | B |
| `tests/meta/opencode-executor.test.ts` | `OpenCode executor and isolation contract the arms differ only in the skill rules, skills.paths, instructions, and skill mount` | `AssertionError: Arm a must write its generated OpenCode config: expected false to be true` at line 38 | B |
| `tests/meta/opencode-fixture.test.ts` | `OpenCode fixture contract the runner invokes the fake OpenCode and creates its capture file` | `AssertionError: run.sh must invoke OpenCode instead of Pi and write the fake capture file: expected false to be true` at line 43 | B |
| `tests/meta/opencode-recorded.test.ts` | `OpenCode recorded executor and environment matrix the runner records identity schema 2, all OpenCode evidence, and only the credential descriptor` | `AssertionError: a new agent run must record schema 7: expected undefined to be 7` at line 65 | B |

Number of failures for each cause: A has 4. B has 35.

## Step 4: `npx vitest run schedule-tests`

- Exit status: 0.
- Test files: 2 passed.
- Tests: 111 passed, 0 failed.
- Duration: 260 seconds.

The `daily-schedule-green.test.ts` file starts a copy of `cron-daily.sh` in a temporary repository. The copy uses fake batch, quota, and publish commands. It did not start an agent.

## Recommendations

These are recommendations only. We did not make these changes.

1. Make `runs/` before the meta tests start. Alternatively, make the tests use a temporary folder outside the repository.
2. Install the `fixture/` dependencies (`npm ci` in `fixture/`) in the cloud setup. Then do steps 2 and 3 again.
3. For step 2, set `CANDIDATE` to a completed candidate tree. Alternatively, do not include `tests/unit` in a check of a clean clone.
