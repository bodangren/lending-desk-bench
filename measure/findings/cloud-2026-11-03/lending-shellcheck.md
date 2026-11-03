# Pilot report: shellcheck on the shell scripts

## Scope

- Repository: `lending-desk-bench`.
- Branch: `pilot/cloud-lending-shellcheck`. The branch was at base commit `c613bc8`.
- Tool: ShellCheck 0.11.0. We installed it with `pip install shellcheck-py`.
- Command: `shellcheck -S warning <file>` on each file from `git ls-files '*.sh'` (28 files).
- We did not run the scripts. We read each finding in its context.
- We did not change a script. This report is the only new file.

## Summary

| Result | Number |
| --- | --- |
| Files with no finding | 14 |
| Files with one or more findings | 14 |
| Findings | 27 |
| Real defects | 4 |
| Possible defects | 12 |
| False positives | 11 |

Findings for the most important types:

- Unquoted paths in `rm`, `mv`, or `cp`: none. Also, a run with `-S info` shows no SC2086 finding in the 28 files.
- Unset variables: one possible defect (`harness/run.sh:106`, SC2318).
- Exit codes that a pipeline loses: none.

Most findings are SC2164 (`cd` with no `|| exit`). Each of these scripts uses `set -u` but not `set -e`. Thus, when `cd` fails, the script continues in the incorrect directory.

## Real defects

| Finding | Code | Reason |
| --- | --- | --- |
| `harness/arm-a-reruns.sh:3` | SC2164 | The `cd` uses a fixed absolute path in one home directory. On a different host, `cd` fails and the script continues. Then the wait loop on `../reports/missing-models.log` does not stop. |
| `harness/rerun-hy3-retries.sh:6` | SC2164 | The `cd` uses a fixed absolute path in one home directory. On a different host, `cd` fails. Then the wait loop on `../reports/rerun-missing-2026w35.log` does not stop. |
| `harness/rerun-missing.sh:9` | SC2164 | The `cd` uses a fixed absolute path in one home directory. On a different host, `cd` fails. Then `source ./env.sh` and each `./run.sh` call fail in the incorrect directory. |
| `harness/rerun-suite2-finalize.sh:6` | SC2164 | The `cd` uses a fixed absolute path in one home directory. On a different host, `cd` fails. Then `source ./env.sh` and the rerun steps fail in the incorrect directory. |

## Possible defects

| Finding | Code | Reason |
| --- | --- | --- |
| `harness/run.sh:106` | SC2318 | `temporary="$lock/..."` reads `lock` before the same `local` sets it. It works now only because the caller `claim_port` has a local `lock` with the same value. A different caller gets an unset variable error. |
| `harness/grade.sh:166` | SC2164 | Line 113 makes sure that `$CAND` exists, thus a failure is not probable. But if `cd` fails, `npm run typecheck` and `npm run build` run in the incorrect directory. Then the gate can record an incorrect result. |
| `harness/cron-daily.sh:449` | SC2164 | `$ROOT` comes from a `cd` that worked, thus a failure is not probable. But if `cd` fails, `git add docs/` and the publish steps run in the incorrect directory. |
| `harness/regrade-w38-inplace.sh:95` | SC2164 | `$ROOT` comes from a `cd` that worked, thus a failure is not probable. But if `cd` fails, `git add`, `git commit`, and `git push` run in the incorrect directory. |
| `harness/rerun-deepseek-v41-w38.sh:70` | SC2164 | `$ROOT` comes from a `cd` that worked, thus a failure is not probable. But if `cd` fails, `git add`, `git commit`, and `git push` run in the incorrect directory. |
| `harness/cron-daily.sh:355` | SC2164 | `$H` is a subdirectory of a known `$ROOT`, thus a failure is not probable. If `cd` fails, `./recost.sh` runs from the incorrect directory. |
| `harness/cron-daily.sh:395` | SC2164 | `$H` is a subdirectory of a known `$ROOT`, thus a failure is not probable. If `cd` fails, `./rescore-doctor.sh`, `./recost.sh`, and `./cleanup.sh` run from the incorrect directory. |
| `harness/grade.sh:174` | SC2164 | `$H` is a subdirectory of a known `$ROOT`, thus a failure is not probable. If `cd` fails, the suite steps run from the candidate directory. |
| `harness/regrade-w38-inplace.sh:10` | SC2164 | `$H` is a subdirectory of a known `$ROOT`, thus a failure is not probable. If `cd` fails, the relative `./` calls fail. |
| `harness/rerun-deepseek-v41-w38.sh:7` | SC2164 | `$H` is a subdirectory of a known `$ROOT`, thus a failure is not probable. If `cd` fails, the relative `./` calls fail. |
| `harness/batch.sh:35` | SC2164 | The script goes to its own directory, thus a failure is not probable. If `cd` fails, `source "./env.sh"` and the later relative calls fail. |
| `harness/summarize.sh:10` | SC2164 | The script goes to its own directory, thus a failure is not probable. If `cd` fails, `source "./env.sh"` fails. |

## False positives

| Finding | Code | Reason |
| --- | --- | --- |
| `harness/env.sh:1` | SC2148 | Scripts source this file. They do not run it. The bash scripts that source it set the shell. A `# shellcheck shell=bash` line removes the message. |
| `harness/rescore-doctor.sh:56` | SC1087 | `$WEEK_PATTERN[-rN]` is in an `echo` message. The text `[-rN]` is literal text, not an array index. |
| `harness/rescore-doctor.sh:93` | SC2098 | `VARIANT="$ROOT/runs/$RUN_ID/variant"` reads the shell `RUN_ID`. Line 50 sets that value. It is the same value as the prefix assignment on line 94. |
| `harness/rescore-doctor.sh:94` | SC2097 | `RUN_ID="$RUN_ID"` gives the same value to the child process. The shell value does not change. |
| `harness/run.sh:459` | SC2054 | The commas are in the `--tmpfs` mount options. Podman must get them as one argument. |
| `harness/run.sh:687` | SC2054 | The commas are in the `--tmpfs` mount options. Podman must get them as one argument. |
| `measure/tracks/opencode_executor/evidence/task-4.2/run-arm.sh:67` | SC2054 | The commas are in the `--tmpfs` mount options. Podman must get them as one argument. |
| `harness/run.sh:213` | SC2034 | `settle` is only a loop counter. The loop tries three times. |
| `harness/grade.sh:212` | SC2034 | `i` is only a loop counter. The loop tries 40 times. |
| `harness/rerun-deepseek-v41-w38.sh:76` | SC2034 | `i` is only a loop counter. The loop tries the push three times. |
| `harness/run.sh:900` | SC2034 | `AGENT_ISOLATED` is set but no script reads it. It is dead code with no effect on behavior. |

## Files with no finding

`harness/cleanup.sh`, `harness/cron-weekly.sh`, `harness/fetch-rg.sh`, `harness/finalize-rerun.sh`, `harness/opencode-credential.sh`, `harness/opencode-entry.sh`, `harness/preflight.sh`, `harness/recost.sh`, `harness/regrade-all.sh`, `harness/regrade-matrix.sh`, `harness/regrade-run.sh`, `harness/regrade.sh`, `harness/toolchain.sh`, `harness/weekly.sh`.

## Recommended actions

1. Replace the fixed absolute `cd` path in the four real defects. Use `cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1`.
2. Add `|| exit 1` to each `cd` in the possible defects. Do this first for the `cd` before `git` and `npm` steps.
3. In `harness/run.sh:106`, use two `local` statements. Set `temporary` after `lock`.
