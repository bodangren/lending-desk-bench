# Tech debt

## 2026-09-22 — Arm-B skill `next-best-practices` is a frozen external dependency

Vercel removed the skill upstream. The repo `vercel-labs/next-skills` now holds only a pointer README. Vercel moved the knowledge into the Next.js 16.3+ bundled docs and the `AGENTS.md` / `CLAUDE.md` files that `next dev` generates.

The fixture runs Next.js 16.2.11. It cannot use the replacement. Arm B still needs the skill.

### What we did

We restored the last published copy from git history:

- Source: `vercel-labs/next-skills` commit `dc1de9caf761` (2026-05-07, last commit with the skills present).
- Restored folder: `~/.agents/skills/next-best-practices`.
- Verified per-skill sha256 `66f7408192818a0742ea30dd1a5b2da7ca272fefcf30f2d5b841fca1f7e85ea8` and tree hash `8db7cda6f7035f5c49740262f54dc949c979a94d1dc894d732ed1b946544bc07`. Both match the w36–w38 provenance pins.

### Why this is debt

- The restored copy sits outside the skills CLI lock file. A cleanup can delete it again. A missing skill aborts every arm-B run at preflight. Run `b-mimo-v2-6-pro-2026w39` failed this way on 2026-09-22.
- `run.sh` checks only that each `SKILL.md` exists. Nothing compares the five folders against the pinned hashes before a run. A silent content drift changes arm B. The drift shows only in provenance after the run.

### Pay-down options

1. Vendor the five arm-B skill folders into the repo, for example `harness/skills-arm-b/`. Pin them by hash. Point `BENCH_SKILL_ROOT` there. This makes arm B reproducible from the repo alone.
2. Or add a preflight check. Compare each skill folder hash to a pinned table. Fail fast on mismatch.
3. When the fixture moves to Next.js 16.3+, drop the skill deliberately. Document the cohort change in provenance. The bundled docs replace the knowledge then.

## 2026-09-22 — Live freshness scan cost grows with `runs/` and breaks the meta-suite wall clock

`summarize.sh` passes every `runs/*/artifacts/score.json` to one `score-freshness.ts --many` call. The checker re-walks and re-hashes each candidate source tree per record (`assessCandidateContract`, line 157). It ignores `node_modules`, `.next`, and `.git`.

`runs/` now holds 174 records and 29GB. The scan cost grows every week. A plain `find` over `runs/` took over 120s on this host on 2026-09-22, with 7GB of swap in use.

The test `summary rejects a forged trusted record when its live provenance is stale` allows 180s. It passed in 21s on 2026-09-06. It timed out twice on 2026-09-22, once in the full suite and once in isolation. The failure is a timeout, not an assertion. The rest of the suite passed: 146 of 147 tests, including every policy and attestation test.

### Why this is debt

- The weekly `test:meta` gate will flake more often as `runs/` grows. This is a load-sensitive wall clock, the same failure mode the always-publish policy removed from grading.
- Every reporting pass pays the full scan again. `summarize.sh` and `export-site-data.py` will slow down each week.

### Pay-down options

1. Raise the test timeout to 900s. This is a one-line change.
2. Cache freshness results by `score.json` mtime. Skip unchanged records in repeated scans.
3. Archive old weekly candidates to cold storage. Keep `artifacts/` online. This shrinks the live tree.

## 2026-09-22 — Stale Pi builds break every OpenCode Go run

OpenCode Go began to require the `x-opencode-session` header around 2026-09-21. Pi sends that header since v0.86.0 (upstream issue #9326). The bench ran Pi 0.84.1, which predates the fix.

Symptom: the agent reads the fixture, then stops. Long generations terminate. Short requests still pass. The run aborts with "agent produced no changes". Four runs failed this way on 2026-09-22. A raw API probe proved the models work: `mimo-v2.6-flash` emitted a correct `write_file` tool call once the header was present.

The failure hits every Go model, not one model. The weekly batch would fail the same way.

### What we did

We installed Pi 0.87.0 into an isolated prefix, `~/.bench-pi-root`. Benchmark runs set `BENCH_PI_ROOT` to it. The global Pi install stays at 0.84.1 and remains untouched.

### Pay-down options

1. Track Pi releases that change provider adapters. Update the isolated prefix before each weekly batch.
2. Or update the global Pi install and drop the isolated prefix.
3. Add a cheap pre-run probe: send one short completion through the container and reject runs when the endpoint reports `MissingSessionID`.

## 2026-09-23 — `mimo-v2.6-pro` returns empty completions at bench-scale context

The model serves fine at small scale. A raw probe with the session header returned a correct `write_file` tool call. The agent writes files on a trivial task.

On the bench task, the model stops after the read phase. The last assistant turns are empty: no text, no reasoning, no tool calls. The stall reproduces at `--thinking max` and `--thinking high`, host-side and in the container, on both arms. Four runs aborted with "agent produced no changes" between 2026-09-22 and 2026-09-23. The two arm records stay as invalid no-change runs.

`mimo-v2.6-flash` completes the same task on the same transport.

On 2026-09-23 the model also completed a small task through an OpenCode subagent: it read a plan and five files, wrote code, and passed its tests. Three client stacks agree: raw curl, Pi 0.87.0, and OpenCode. The model is healthy at small context on every stack. The defect triggers at bench-scale context only.

### Pay-down options

1. Retry `mimo-v2.6-pro` at the next weekly batch. The provider deployed it around 2026-09-21; the defect is likely teething.
2. Before the retry, run the host-side replica: a 900s Pi run on a scratch fixture copy. It costs cents and shows the stall in minutes.

### Resolution (2026-09-24)

The defect is confined to the OpenCode Go bucket. The model serves at bench scale on the Xiaomi PAYG channel. Benchmark runs use that channel for this model, and the records keep `model: xiaomi/mimo-v2.6-pro` for traceability. The PAYG key swaps into `~/.pi/agent/auth.json` for each run window and restores from `auth.json.bench-bak` on exit.

- 2026-09-24, arm A, two runs: the model worked 52 turns and implemented all seven spec-target files. Transport held for the full window. Both runs were rejected at contract grading, not by transport; see the next entry.
- 2026-09-24, arm B, two runs: 65 turns and 19 file writes at peak. Attempt 1 failed both checks: added exports plus protected-file edits. Attempt 2 kept the export surface clean and closed out `plan.md` and `metadata.json` as instructed. It failed only because it rewrote the acceptance checkboxes inside `spec.md`, the one protected file no instruction invites.
- Final: four runs, four contract rejections, zero valid records. The model transports cleanly and works hard on the PAYG channel. It does not conform to the fixture contract this cohort. Pro publishes nothing for w39; retry at the next batch.
- Evening windows (20:00–22:00) on the channel still stall streams. Morning windows are stable. Schedule pro runs in the morning.
- `run.sh` now stages a tuned `settings.json` into each run's provenance `pi-agent` dir: `retry.maxRetries: 10`, `httpIdleTimeoutMs: 120000`. A stall now costs 120s instead of 300s, and the agent gets ten retries.
- Runs launch detached (`setsid` plus `flock` plus a pidfile). The OpenCode client TERM-kills its background children when a session closes; a detached run survives. Never guard a launch with `pgrep -f <script name>` from a command that contains the name; it self-matches.
- The Go bucket defect is upstream and open. Retry pro there at a weekly batch after the provider fixes the serving path.

## 2026-09-24 — `fixture/AGENTS.md` under-states the export-surface contract

The checker (`harness/candidate-contract.ts`, `assessCandidateContract`) compares the canonical public surface of every writable file. The surfaces must match exactly. An added export fails the run with "candidate changed a writable public export or type signature".

`fixture/AGENTS.md` states: "Do not rename or change any exported symbol or type signature." It does not prohibit additions.

### Impact

`mimo-v2.6-pro` lost two arm-A runs this way on 2026-09-24. Both runs did full work: 52 turns, seven files implemented, transport stable. The candidate added three exported hooks in `src/components/item-card.tsx` and `export const dynamic` in two page files. The spec did not ask for them: spec F wants the new state "on the next visit without a manual reload", and server revalidation satisfies that. `mimo-v2.6-flash` did the same task inside the pinned surface and passed.

A literal reading of `AGENTS.md` permits additions. A capable model that follows the letter loses the whole run. The instruction and the checker disagree.

The arm-B runs add a second face of the same gap. The definition of done says "Every checkbox in `spec.md` is satisfied". A literal model can read "satisfied" as "checked" and edit the spec. `spec.md` is protected, and the run aborts. The final pro run lost everything to that one file.

### Pay-down options

1. At the next fixture revision, reword the rule: "Do not add, rename, change, or remove any exported symbol or type signature." Also reword the definition of done: "Every acceptance criterion in `spec.md` is met. Do not edit `spec.md`." The current fixture is hash-pinned for the w36–w39 cohort; a reword breaks comparability, so the fix waits for a revision.
2. Make the checker report the offending file and export in the reason. Today the reason names no file, and diagnosis needs a manual surface diff.

### Resolution (2026-09-24, bench_v2)

- Fixture r2 states "Do not add, rename, change, or remove any exported symbol or type signature" and forbids edits to `spec.md`, in `AGENTS.md`, the spec goal, and the bugfix and change prompts.
- The checker adds a reason that names the file: `public surface changed in <path>`.
- A contract violation no longer discards the run. Soft violations are graded on a graft and cost the adherence axis; only hard violations (symlinks, special entries) stay invalid.

## 2026-09-24 — `rescore-doctor.sh` without `BENCH_PI_ROOT` reports every valid run as invalid

Run without `BENCH_PI_ROOT`, the executor attestation cannot resolve. The doctor prints `FAIL ... INVALID:["executor attestation: could not resolve environment executor: BENCH_PI_ROOT is not set"]` for every run of the week. The `score.json` files stay untouched, but the operator sees a full week marked invalid from one misconfigured shell.

### Pay-down options

1. Refuse to start when `BENCH_PI_ROOT` is unset. Print one clear error instead of per-run FAIL lines.
2. Or resolve the executor from each run's provenance instead of the ambient environment.

### Resolution (2026-09-24, bench_v2)

Option 2. `executor-attestation.ts` resolves the Pi install from the path the run recorded, when that binary still exists; its hash must still match. The ambient `BENCH_PI_ROOT` names the executor for new runs only. `rescore-doctor.sh` now covers all four tracks and keeps each run's identity and graft record.

## 2026-09-24 — Candidate code runs on the host during grading

The agent works in a container, but grading runs outside it. `next start` executes the candidate's app code on the host, and the tests track runs the candidate's test files on the host with Vitest. `grade-tests.ts` gives those processes a minimal environment (no provider keys) and hard-linked `node_modules` from the run's own copy. The processes can still read and write any path the user can.

### Pay-down options

1. Run the grading servers and the candidate test suites in the same rootless Podman sandbox as the agent, with the network disabled.
2. At least run them under a separate Unix user with no access to the home directory.

## 2026-09-24 — `runs/.tests-track-cache` has no pruning

Every distinct app tree (clean, variant, each mutant) is built once and kept under its content hash. `node_modules` is hard-linked, so an entry costs about 10 MB. A fixture, reference, or mutant change adds a new set of entries; old ones stay.

### Pay-down options

1. Delete cache entries older than 30 days in `cleanup.sh`.

## 2026-09-24 — The change track has one hand-written spec

`harness/change/model-visible/track/spec.md` states the requests of set `c1`. `make-variant.ts` refuses any other set id. A new set needs its own spec, reference, criteria, and controls.

### Pay-down options

1. Generate the change-request section of the spec from `CHANGE_REQUESTS` when a second set is written.

## 2026-09-24 — Weekly batch length

bench_v2 runs four tracks: build with 3 repeats, the others with 1. At 17 models and 2 arms that is 102 + 3 × 34 = 204 agent runs. At 10–15 minutes each on this host, a weekly batch takes about 34–51 hours, and about $12 of the $30 weekly Go limit.

### Pay-down options

1. Lower `REPS_BUILD` to 2 for low-variance models (spread under 3 points for 4 weeks).
2. Run the variant tracks every second week.

## 2026-09-24 — w37–w39 records ran on fixture r1

The regrade grafted their writable files onto fixture r2, so they share one ruler with later weeks. Their agents saw the r1 instructions (the weaker export rule), and some of them lost work to the contract under r1 that r2 would have prevented. The site labels each row with its fixture revision.

## 2026-09-24 — Public repository and answer material

Owner decision (2026-09-24): the repository stays public. `reference/`, `reference-variant/`, `reference-change/`, the tests-track oracle, the bug registry, and every frozen set are readable, and the agent container has open network access.

## 2026-11-16 — `preview.sh` follows a symlinked `.tmp` parent and writes outside the repo

`harness/model-guide/preview.sh:80` resolves the preview folder with `realpath -m`. That call follows a symlinked parent. A probe in `/tmp/opencode/p2b4-probe` made `<root>/.tmp` a symlink to `/tmp/opencode/p2b4-outside`. Then `preview.sh --export fixture/real-work-mini.json` exited 0 and wrote the whole preview into that outside folder: `index.html`, `real-work.html`, `real-work.json`, `model-guide.json`, `preview-base.json`, and a copy of `docs/`.

The refusals cover the root path, the nesting under `docs/`, links inside an existing preview folder, and links under `docs/`. They do not cover the parent of the default preview folder. Found by `review-b` round 4 as P2B4-1 (`measure/runs/model_guide/review-b-b4fba01.json`).

### Why this is debt

The item is nonblocking. `preview.sh` supports an outside `--preview` folder by design, so in-repo containment is not part of its stated contract. The final folder name is fixed (`model-guide-preview`), and the written data is the public `docs/` copy plus sanitized aggregates. Planting the link needs write access at the repo root, the same access that allows direct tampering. The gap matters because a future reader may assume that the default path always stays inside `.tmp/`.

### Pay-down options

1. When the default preview path is used, refuse when the resolved `PREVIEW_ABS` differs from the literal `$ROOT/.tmp/model-guide-preview`.
2. Or apply the `update.sh` parent-chain `-L` walk to the default preview path, as `update.sh` already does for its own preview folder.
3. Or print the resolved preview path at exit 0, so the operator sees where the files went.

## 2026-11-21 — regrade-run.sh: tsx steps give no result in the scripted context (found by deps_refresh task 3.1, 2026-11-21)

Inside `harness/regrade-run.sh` through `heavy-run.sh`, the hash step at lines 127-129 returns an empty `candidate_sha256`.
Both stdout and stderr are empty at that point.
The script then exits 4 with "original tree could not be hashed".
With that line worked around, the graft step at line 125 exits 0 but creates no candidate tree.
`grade.sh` then exits 2 ("no candidate").
The same tsx commands return correct output by hand and directly under `heavy-run.sh`.
The fault also occurs on the base lock (`b4c2e45`), so it predates the refresh.
The script ignores the exit code of the hash command and hides its stderr (`2>/dev/null`).
Evidence lives in `measure/runs/deps_refresh/rescore-ab/diag-r4/` and `rescore-ab/r5/`.

Root cause: `harness/candidate-contract.ts:309` runs its CLI only when `fileURLToPath(import.meta.url)` equals `resolve(process.argv[1])`.
Under the `/tmp/opencode` to `/home/daniebo/.cache/opencode` symlink, tsx reports the real path while `resolve()` keeps the `/tmp` path.
The CLI block therefore never runs, with exit 0, no output, and no effect.
Every harness tsx CLI with the same guard is exposed when started from a symlinked path.
Fix: compare realpaths in the guard.
Evidence for the cause lives in `measure/runs/deps_refresh/rescore-ab/r6/`.

### Why this is debt

- A silent empty hash aborts every scripted re-score at exit 4.
- A silent empty graft wastes the run and fails grading at exit 2.
- The hidden stderr removes the only signal that names the cause.

### Pay-down options

1. Check each tsx exit code and keep stderr.
2. Assert non-empty output before use.
3. Find the cause of the empty result in the scripted context.

## 2026-11-21 — Meta fixture hard-codes /tmp/opencode (found by deps_refresh task 3.1, 2026-11-21)

`harness/tests/meta/opencode-run-fixtures.ts:17-18` creates the fake executor under `/tmp/opencode`.
On this host `/tmp/opencode` is a symlink to `/home/daniebo/.cache/opencode` since 2026-11-20 08:13.
Six exact-path assertions in `test:meta:logic` therefore fail.
Each one expects `/tmp/opencode/executor-red-*` and receives the resolved cache path.

Related: the same `/tmp/opencode` symlink triggers the tsx CLI guard fault above.

### Pay-down options

1. Resolve the real path (`realpath`) in the fixture or the assertion.

## 2026-11-21 — regrade-run.sh:92 keep list drops artifacts/executor/ (found by deps_refresh task 3.1, 2026-11-21)

For an opencode-executor run, the regrade keeps only `session.json.gz`, `session.json`, `session.err`, `execution-identity.json`, `executor-cohort.json`, `candidate.diff`, and `pi-agent`.
It drops `executor/opencode.json`, `opencode-binary.json`, and `session-export.json`.
The new score is then invalid: "executor config snapshot is missing" and "session export is missing".
Evidence lives in `measure/runs/deps_refresh/rescore-ab/r7/` and `r8/`.

### Pay-down options

1. Add `executor` to the keep list.

## 2026-11-21 — Orphan collected criteria at HEAD make every regrade invalid (found by deps_refresh task 3.1, 2026-11-21)

At HEAD `8437779` a regrade of `runs/a-deepseek-v4-1-flash-2026w43-r1` gives `valid=false` and `total=null`.
The invalid reason is "orphan collected criteria: ranks a fresh, repeated row, ... is imported by both pages".
The harness collects its own `tests/unit/board-standing.test.ts` cases as criteria.
The axes are still computed.
Evidence lives in `measure/runs/deps_refresh/rescore-ab/r8/`.

### Pay-down options

1. Keep harness-internal tests out of candidate criteria collection, or map them.

## 2026-11-21 — E2E criterion E.return-submits is flaky in regrade (found by deps_refresh task 3.1, 2026-11-21)

In six regrades of `runs/a-deepseek-v4-1-flash-2026w43-r1` at HEAD `8437779`, `E.return-submits` passed 3/3 on the base lock and 2/3 on the refreshed lock.
The runs shared the scoring code, the runner hash `8985c00f…a2a0`, and system Chrome.
One failure moved `axes.completion` from 1 to 0.9788359788359788 and `tiers["1"].rate` from 1 to 0.972972972972973.
Every other compared field stayed identical.
The PM flake rule classed it as a flake.
Risk: one flaky e2e criterion can move a completion score by about 0.02 between runs.
Evidence lives in `measure/runs/deps_refresh/rescore-ab/r8/`.

### Pay-down options

1. Find the timing cause in the e2e probe for return submit, or rerun-and-majority for e2e criteria.

## 2026-11-22 — model_guide Phase 4b nonblocking findings (carried 2026-11-22, PM round cap 2026-11-19)

Phase 4b reviews left these items nonblocking under the PM round cap. None is a key leak into a committed file or a public page.

- Review A F3: both selectors treat any non-empty finish except exact tool-calls as terminal and accept any finite completed time (`review-a-4.16-23f16f1.json`).
- Review A F5: the judge N10 and N27 copies lack direct cases, and two guard messages misstate the link position (`review-a-4.15-7773823.json`).
- Review A F8: the truncated-token case stays open; both readers keep tokens_complete true after a cut final step_finish (`review-a-4.15-7773823.json`).
- Review A F9: the judge seed refusal lacks a direct case at judge-run.sh:569-584 (`review-a-4.15-7773823.json`).
- Review A F10: pilot instructions still name the removed free route opencode/hy4-flash-free (`review-a-4.15-7773823.json`).
- Review A F11: R12 and R14 still use the 5000 ms test budget against 15000 and 10000 ms assertions (`review-a-4.15-7773823.json`).
- Review C F1: ADV-R-12 still calls the unscoped fake, so the orphan check can include foreign fakes (`review-c-4.15-7773823.json`).
- Review C F3: stopped quota reasons repeat the quota prefix in records (`review-c-4.15-7773823.json`).
- Review C F4: runner tests lack direct N32 cases and judge tests lack seed-refusal cases (the same as Review A F3 and F9) (`review-c-4.15-7773823.json`).
- Review B 4b N1: KEY_SHAPE_RE omits PEM blocks and other token shapes, also for --incomplete-reason (`review-b-4b-dc31a0a.json`).
- Review B 4b N2: the private folder path sits in eight ignored run records (`review-b-4b-dc31a0a.json`).
- Review C 4b C2 legend part: no C1-C9 legend, no "provisional" definition, "PM" not expanded (`review-c-4b-dc31a0a.json`).
- ADV-P4D-1: seed reason patterns accept trailing credential text; both probes printed the synthetic value (`adversarial-4.15-7773823.json`).
- ADV-P4D-2: the 499-byte cut can split a UTF-8 code point and emit invalid UTF-8 (`adversarial-4.15-7773823.json`).
- ADV-P4D-3: a cut final step_finish event leaves tokens_complete true after a valid event (`adversarial-4.15-7773823.json`).
- A-F1 (skipped): a same-second answer that predates call entry is accepted (`adversarial-p4f.test.ts:343`, it.skip).
- P4F-2 (skipped): a matching top sessionID hides a foreign info.sessionID (`adversarial-p4f.test.ts:374`, it.skip).
- P4F-3 (skipped): negative or reversed completed times and unknown, whitespace, or padded finish strings are accepted (`adversarial-p4f.test.ts:404`, it.skip.each).
- Review B F-B1: the L5 send-timeout test is timing sensitive and failed once under load, then passed (`review-b-4.16-2bdf5cb.json`).
- Review B F-B3: the live LIVE_KEY_SHAPE scan omits PEM private key blocks (`review-b-4.16-2bdf5cb.json`).
- Review B F-B4: the owner check passes a foreign message with no sessionID; freshness and server scoping still apply (`review-b-4.16-3337418.json`).
- Review B F-B5: the F20 token expectation is a fixture timing artifact under r9 sum semantics (`review-b-4.16-23f16f1.json`).
- Review C F-C4: the F20 token assertion failed twice from read-time stamps, then passed unchanged (`review-c-4.16-23f16f1.json`).
- Night driver nit: `reachable()` greps the whole probe file, not the last block (`~/.local/share/lending-desk-bench/model-guide/jobs/night-4.11.sh`).
- Judge-run nit: the live quota endpoint answered slower than the 5 s quota read timeout twice during the 4.13 judge runs; the runner stops with groups open and needs a rerun (`measure/runs/model_guide/adjudicate-judge-a.log`).

## model_guide Phase 4b/5 late findings (carried 2026-11-22, PM late-findings rule)

These findings were raised after the round cap. Each source JSON records score-impact: no.

- Review B 4b NB1: `--pilot-routes` refusal branches lack tests. Direct probes show each refusal prints only `score: pilot-routes` with exit 2 (`review-b-4b-99ec28c.json`).
- Review B 4b NB2: pilot-array validation drops non-object items, empty routes, and duplicates silently. A malformed pilot file then under-reports routes (`review-b-4b-99ec28c.json`).
- Review B 4b NB3: a pilot route string with a key shape lands unscanned in the pilot file and the score file. `KEY_SHAPE_RE` covers `--incomplete-reason` only (`review-b-4b-99ec28c.json`).
- UX 4b F1: at 390 px the route cell is about 58 px wide. Route names and the reason wrap, and rows grow to 470-506 px. The table stays horizontally scrollable (`ux-browser-4b-8fd8882.json`).
- UX 4b F2: at 390 px the named table region takes focus, but ArrowRight and ArrowLeft do not move its scroll position. Pointer and touch scrolling work (`ux-browser-4b-8fd8882.json`).
- Review A 5 F2: the weekly update leaves the public static HTML unchanged. An HTML refresh task is needed before the next export (`review-a-5-a8835be.json`).
- Review A 5 F3: the README describes one preview-copy branch. Preview copies run only before approval; the post-approval step writes docs data only (`review-a-5-a8835be.json`).
- Review B 5 F1: `update.sh` commits public data with no leak-check step. A future export with private text would reach docs unscanned (`review-b-5-a8835be.json`).
- Review C 5 F1: the README names `harness/model-guide/update.sh` without `bash`. The file has no execute bit, so the documented command cannot run (`review-c-5-a8835be.json`).
- UX 5 F2: at 390 px the named table region takes focus, but ArrowRight and ArrowLeft do not scroll it. Pointer and touch scrolling work (`ux-browser-5-3ba285f.json`).

None of these findings is a key leak into a committed file or a public page. None has score impact: none can hide a wrong result in the current scores or the published page.
