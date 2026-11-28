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

### Resolution (2026-11-27, guide_docs_ops regrade)

Commit `c3c6eb8` adds `executor` to the keep list of `harness/regrade-run.sh`. A regrade of an opencode-executor run now keeps the config snapshot, the binary record, and the session export. The regrades of the four stored docs-and-ops runs returned valid scores.

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

## 2026-11-23 — weekly_update_fix Phase 1 late findings (routed 2026-11-23, PM 2026-11-23)

Phase 1 closed with these nonblocking findings. Fixed items name the Green commit that closed them. Open items wait for a future round. Each source JSON records its own score impact.

- F1 (Review B pass 3, fixed): a relative `MODEL_GUIDE_PRIVATE_DIR` split the guard and the scan, so a seeded plant could ship. Green r10 (3911952) refuses a non-absolute value before any write. Score-impact was yes, now none (`review-b-p1-5905296.json`, `review-b-p1-ddd82b5.json`).
- F2 (adversarial pass 1, fixed): an empty private dir passed the guard and shipped a planted seed into `docs/index.html`. Green r9 (dbed5ee) added the seeded-input guard. Score-impact was yes, now none (`adversarial-p1-6c95b51.json`).
- F16 (Review A): a first publication without a baseline publishes the page but not the score file. The real repo tracks the file, so the weekly run takes the other branch. Score-impact: no (`review-a-p1-a4e85da.json`).
- F16 (Review C): the README and task 2.1 omit `update: committed <path>`, `update: no change`, and the score-change `review.json` commit. Score-impact: no (`review-c-p1-6c95b51.json`).
- F18 (Review A): the README omits the review outputs and the new refusals. The run log still names every committed path. Score-impact: no (`review-a-p1-a4e85da.json`).
- F19 (Review A): the guard counts Unicode code points while `leak-check.ts` counts UTF-16 units. Ten astral characters fail the guard before any write. It fails closed. Score-impact: no (`review-a-p1-5905296.json`).
- F20 (Review A): an empty-string `MODEL_GUIDE_PRIVATE_DIR` falls back to the guarded default instead of refusing. It fails closed. Score-impact: no (`review-a-p1-ddd82b5.json`).
- F21 (Review C): the README and task 2.1 omit the private-input contract (absolute path, seeded line shape, default location, refusal). Score-impact: no (`review-c-p1-ddd82b5.json`).
- F22 (phase acceptance): the P2B2-2 mtime race also fails at base 35a059c (2 of 4 ext4 runs), so Phase 1 did not cause it. Score-impact: no (`phase-acceptance-p1-019568c.json`).
- F23 (phase acceptance): test-strategy case 7 (`BENCH_TRACK=change`) has no test. No tool reads the variable. Score-impact: no (`phase-acceptance-p1-019568c.json`).
- F24 (phase acceptance): the record gaps. The plan now holds Late finding lines and `metadata.json` holds the `escalation` key. Score-impact: no (`phase-acceptance-p1-019568c.json`).
- F25 (phase acceptance): spec D4 and test-strategy L1 describe a scan after the copy, while `update.sh` scans the staged set before the copy, which is safer. Score-impact: no. The spec owner updates the wording (`phase-acceptance-p1-019568c.json`).
- F6 (Review A): the FR-1 to FR-5 claim exceeds the proven cases. Score-impact: no (`review-a-p1-8ceb628.json`).
- Review B pass-1 nit: a scanner error with empty stdout yields `update: leak ` with an empty path. It fails closed. Score-impact: no (`review-b-p1-8ceb628.json`).
- Review B F2 (pass 3): a `--`-prefixed private path prints a false leak line. The run still refuses before any write. Score-impact: no (`review-b-p1-5905296.json`).
- Review B stale-verify (pass 2): plan.md:180 and test-strategy.md:201 name the old leak-check invocation. The old command over-scans, so it never under-scans. Score-impact: no (`review-b-p1-6c95b51.json`).
- Review C F10: the usage line omits the supported `--docs` flag. Score-impact: no (`review-c-p1-8ceb628.json`).
- Review C F11: the README names docs-relative data paths for a preview-only run. Score-impact: no (`review-c-p1-8ceb628.json`).
- Review C F12: the Phase 2 precheck changes directory, so the next line in the same shell exits 127. Score-impact: no (`review-c-p1-8ceb628.json`).
- Review C F13: a rerun on a later calendar date can commit only the date field. Score-impact: no (`review-c-p1-8ceb628.json`).
- Review C F14: `publish.ts` prints one line per drifted path against its one-line promise. It predates the phase. Score-impact: no (`review-c-p1-8ceb628.json`).
- 2.1 The first weekly update (row 5.4, deferred): it waits for the PM export. Reopen trigger: the board unfreezes. Score-impact: none yet; the run has not happened.
- 2.2 The pilot gate (row 4.11, deferred): it waits for the PM word for new nights. Reopen trigger: the board unfreezes. Score-impact: none; one pass per route on `mg-2026-11a` already shows incomplete 1 of 3 passes.

## 2026-11-25 — domain_trust late findings (routed 2026-11-25, PM late-findings rule)

The `domain_trust` track closed at 7aeaba8 with these nonblocking findings. No finding hides a wrong result in the published matrix. Each source JSON sits in `measure/archive/domain_trust/` or `measure/runs/domain_trust/`. The tags in this entry name the source role and the finding id.

### Phase 3 Review A (late findings)

- A-P3-3 (Nit): the spec map keeps shared probe surfaces. P.hydration-clean also visits D. P.no-key-leak checks the D detail payload for a defect assigned to F. P.stale-after-mutate, P.action-race, P.retry-after-error, and P.axe-clean also read other domains. Fix: note the shared surfaces in the spec map (`review-a-p3-e2a6259.json`).
- A-P3-4 (Nit): METHOD_CHECK accepts a methodology table with no probe rows when the preview `probe_map` is empty. It prints `METHOD_CHECK=pass probes=0`. The committed table and map hold all rows (`review-a-p3-e2a6259.json`).
- A-P3-5 (Nit): the export test does not check that `load_entry` keeps `E.labels` for revision 2. Its F.auth-return assertion also accepts the id fallback (`review-a-p3-e2a6259.json`).
- A-P3-6 (Nit): the refreshed preview holds 51 safe cells and 61 other cells. `test-strategy.md:349-350` still expects 63 non-safe cells. Fix: derive the expectation from the preview (`review-a-p3-e2a6259.json`).
- A-P3-7 (Nit): the unchanged P.dedup-item probe accepts zero traced reads. No bad verdict was observed (`review-a-p3-e2a6259.json`).
- A-P3-9 (Nit): the daily wrapper does not act on an exporter error. `harness/cron-daily.sh` checks the batch exit and not the export exit. The wrapper can stage other docs while the prior benchmark remains. The exporter writes nothing on failure, and the wrapper handling predates the phase (`review-a-p3-1036dec.json`).

### Phase 3 adversarial testing

- ADV-P3-1 (Major): nothing at export time compares `PROBE_MAP` with `PROBES`. A new probe with no map entry reaches no check list. If that probe fails in 2 of 2 records, the export exits 0 and all 8 cells read safe. A probe that leaves `PROBES` stays in the lists as a check named by its id. The FR-1 test is the only guard, and no script runs `harness/site-tests/`. The map equals `PROBES` today. The paused `rigor_a_h` track adds criteria. Fix: add an export-time equality check that exits before any write, or run TRUST_TEST in a scheduled self-check (`adversarial-p3-901cac0.json`).
- ADV-P3-2 (Nit): the regexes that read the TypeScript registry fail open on legal input (`harness/domain_trust.py:57,70-71,81,88`). A closing brace in a comment before `since: 2` makes E.labels read since 1. A backslash-quote in a SPEC_MATRIX text drops the row. A backslash-quote in an UNMAPPED_CRITERIA text or a catches text cuts the text. The real registry parses exactly (`adversarial-p3-901cac0.json`).
- ADV-P3-3 (Nit): the handler at `harness/export-site-data.py:40` catches `Exception`. A `SystemExit` from the companion passes. A `domain_trust.py` that calls `sys.exit(0)` at import makes the exporter exit 0 and write nothing. Fix: catch `SystemExit` with the other errors (`adversarial-p3-901cac0.json`).
- ADV-P3-4 (Nit): `trust_records` reads `results.json` of every counted run. A valid old run whose `results.json` holds a JSON scalar makes `domain_cells` raise TypeError and the whole export exits 1. The scorer writes objects only. Fix: skip a `results.json` that is not an object (`adversarial-p3-901cac0.json`).
- ADV-P3-5 (Nit): `domain_cells` has no lower bound for `n_min`. With `n_min` 0 or -1 and no record, a domain with checks reads safe with `min_coverage` 0. Only an edit of `N_MIN` reaches it. Fix: require `n_min` of 1 or more (`adversarial-p3-901cac0.json`).
- ADV-P3-6 (Nit): three weak spots in `harness/site-tests/domain-trust.test.ts`. Lines 90-98 compare registry-derived counts with literal sizes, so a new criterion fails the test. Lines 144-175 assert the verdict only, and strategy 5.2 asks for the full cell. The adversarial file closes the gaps (`adversarial-p3-901cac0.json`).
- ADV-P3-7 (Nit): PATH_CHECK (plan line 39) has no end anchors. The paths `harness/export-site-data.py.bak`, `harness/domain_trust.pyc`, and `README.md.orig` pass the filter. It is a plan gate command and not delivered product (`adversarial-p3-901cac0.json`).
- ADV-P3-8 (Nit): when `benchmark.json` holds no `domain_trust` block, `docs/results.html` still shows the heading, the lede line, and an empty table. Only a stale or partial data file reaches that state. Fix: hide the section (`adversarial-p3-901cac0.json`).

### Phase 3 UX browser review

- UX-P3-1 (Nit): the domain column headers show only the letters A to H. No title, tooltip, or legend names a domain. `data.domains` holds the titles (`ux-browser-review-r2-6f7451b.json`).
- UX-P3-2 (Nit): the link "How the verdict rule works" has no underline. Its contrast with the paragraph text is 1.2 to 1. Axe reports `link-in-text-block` (serious, WCAG 1.4.1) at both widths. The global rule `a { text-decoration: none }` in `docs/assets/css/site.css` causes this (`ux-browser-review-r2-6f7451b.json`).
- UX-P3-3 (Nit): the link to `methodology.html#domain-trust` lands with the heading under the sticky bar. `site.css` has no `scroll-margin-top` or `scroll-padding-top`. The older `#sources` anchor behaves the same (`ux-browser-review-r2-6f7451b.json`).
- UX-P3-4 (Nit): the failure-mode list is flat, with one long entry for each cell. The longest entry has 1,371 characters. A check prints twice when it failed and has coverage below N_MIN. At 390 px the section is about 19,000 px high. Fix: one heading for each model with a nested list (`ux-browser-review-r2-6f7451b.json`).
- UX-P3-5 (Nit): some list wording is unclear. A check graded above the threshold reads "graded 9 of 2 needed". Five checks show registry split notes that name internal criterion ids. Fix: rewrite the display text in `harness/domain_trust.py`, not at the source (`ux-browser-review-r2-6f7451b.json`).
- UX-P3-6 (Nit): the scroll hint has no CSS on `results.html`. It shows as a 16 px body paragraph. It also shows at 1280 px, where the matrix fits (`ux-browser-review-r2-6f7451b.json`).
- UX-P3-7 (Nit): at 390 px the Model column is not sticky. After a scroll to columns E to H, the model names leave the view. The heatmap has the same pattern (`ux-browser-review-r2-6f7451b.json`).
- UX-P3-8 (Nit): the verdict `unproven` uses the class `cell-dead`, a dull red-brown close to the risk color. The word separates the two verdicts. Fix: use a neutral grey (`ux-browser-review-r2-6f7451b.json`).
- UX-P3-9 (Nit): the Hy3 row reads "1 runs". The methodology section does not state the N_MIN value, 2 (`ux-browser-review-r2-6f7451b.json`).
- UX-P3-10 (Nit): the domain_trust code shares the try/catch of the whole results page. A block without a models list replaces the score table with an error. The exporter writes none of these shapes at this head (`ux-browser-review-r2-6f7451b.json`).
- UX-P3-11 (Nit): the page inserts six numeric fields into HTML without `escapeHtml`: `runs.opencode`, `runs.pi`, `runs.total`, `failed`, `graded`, and `rule.n_min`. The exporter writes integers only. Fix: escape the six fields (`ux-browser-review-r2-6f7451b.json`).

### Phase acceptance

- PA-P3-1 (Nit): `plan.md` holds no `Late finding <id>:` line for these findings. This entry closes the tech-debt half. The plan lines stay open (`phase-acceptance-p3-4f53364.json`).
- PA-P3-2 (Nit): the preview refresh left old counts in four places. `plan.md:82` says `prints 34` and the command prints 58. `test-strategy.md:302-303`, `spec.md:81` (EV5), and `metadata.json` still describe the 34-run preview. Fix: update or date-stamp each line (`phase-acceptance-p3-4f53364.json`).
- PA-P3-3 (Major): no standing gate runs the adversarial file. TRUST_TEST (`plan.md:36`) runs only `site-tests/domain-trust.test.ts`. The 48 cases of `domain-trust-adversarial.test.ts` hold the regression tests for A-P3-1, A-P3-8, and the FR-1 drift guards. The file also needs commit 6a237be reachable. Fix: set TRUST_TEST to both files (`phase-acceptance-p3-4f53364.json`).
- PA-P3-4 (Nit): some plan evidence has no command. Tasks 3.2 and 3.3 quote PAGE_DESCRIBE_CHECK, AFFECTED_CELLS=17, COVERAGE_LABELS=251, PARTIAL_NO_BLOCK, and PARTIAL_BYTE_IDENTICAL without a command. Task 3.4 records only the aggregate work-list line. Fix: record the command next to each labeled line (`phase-acceptance-p3-4f53364.json`).
- PA-P3-5 (Nit): two Phase 4 gate details need a fix. (a) The 4.1 O1 Verify regex needs the text `| 2 2026-10-25`. The spec cell reads `2, approved by the owner 2026-10-25`. The command prints 0 lines. (b) PI_SHA depends on the sort locale. `LC_ALL=C` gives `aa8b2421...` and `en_US.UTF-8` gives `7af106ad...`. Fix: pin the locale in the plan command (`phase-acceptance-p3-4f53364.json`).
- PA-P4-1 (Nit): task 4.3 cites the merge SHA 9667d25. The test results first appear in the publish commit 7aeaba8. Both trees hold identical test and implementation files. Fix: record 7aeaba8 as the evidence SHA (`phase-acceptance-p4-7aeaba8.json`).

### Final acceptance (round 2)

- FA2-N1 (Major): `harness/site-tests/domain-trust.test.ts` and `domain-trust-adversarial.test.ts` read `measure/tracks/domain_trust/preview.json` at import. The archive move put the file at `measure/archive/domain_trust/preview.json`. Both test files now fail with ENOENT. No script or cron runs `site-tests`, so the failure shows only in a manual run. Exact fix: copy `preview.json` under `harness/site-tests`. Repoint `domain-trust.test.ts:14`, `domain-trust-adversarial.test.ts:24`, and the copy target at lines 1496-1501 of the adversarial file. Precedent: `harness/model-guide/publish-approval.md` (`final-acceptance-r2-7aeaba8.json`).
- FA2-N2 (Nit): the preview refresh left 34-run counts. `plan.md:82`, `spec.md:81` (EV5), `test-strategy.md:302`, and `metadata.json:11` still say 34 runs. The same finding as PA-P3-2 (`final-acceptance-r2-7aeaba8.json`).
- FA2-N3 (Nit): `plan.md` tasks 3.2 and 3.3 quote labeled results with no command. The same finding as PA-P3-4 (`final-acceptance-r2-7aeaba8.json`).
- FA2-N4 (Nit): at final acceptance, `tech-debt.md` held no entry for the late findings, and `plan.md` held no `Late finding <id>:` line. This entry closes the tech-debt half (`final-acceptance-r2-7aeaba8.json`).
- FA2-N5 (Nit): `plan.md:36` defines TRUST_TEST as one file. The 48 adversarial tests run only when a role names the file by path. The same finding as PA-P3-3 (`final-acceptance-r2-7aeaba8.json`).
- FA2-N6 (Nit): PROJECT_LINT and PROJECT_CHECKS are the shell word `true`, so both pass with no check. The repo has no lint script in `harness/package.json`, no `measure/doctor.sh`, and no `measure/gates.json` (`final-acceptance-r2-7aeaba8.json`).
- FA2-N7 (Nit): the phase-acceptance, review-a, adversarial, and ux results hold `track_base_sha` null. They bind a phase base and not the track base (`final-acceptance-r2-7aeaba8.json`).

### Deviations

- Final acceptance ran on `claude-agent/sonnet#xhigh`. `SKILL.md:144-145` asks for a family other than Review A and phase acceptance. The route `opencode/deepseek-v4.1-flash-free#high` hit its free limit. The PM approved the substitution on 2026-11-25 (`final-acceptance-r2-7aeaba8.json`, DEV-1).
- Phases 1 and 2 have no separate phase acceptance. Neither `SKILL.md` nor `contracts.md` requires one. The Phase 3 result reproduced the Red proof and the task 1.1 base values. Precedent: `weekly_update_fix` passed final acceptance with one phase result (`final-acceptance-r2-7aeaba8.json`, DEV-2).

## 2026-11-27 — executor_model_route phase 1 late findings (routed 2026-11-27, PM closure order)

Source files: `measure/runs/executor_model_route_20261126/review-a-7b6f063.json` and `measure/runs/executor_model_route_20261126/phase-acceptance-7b6f063.json`. The track accepted at HEAD 7b6f0639e1a22b7259863b0b92a505dfd6063f04.

- F16 (Minor, review-a): `harness/tests/meta/executor-model-route.test.ts:1345-1349,1367-1368`. The `short20` fixture sends 40 bytes fewer than declared. The `shortlen` fixture covers exactly 20 missing bytes. Fix: correct the fixture arithmetic and the comments.
- F17 (Minor, review-a): `harness/tests/meta/executor-model-route.test.ts:1530-1549,1578-1611`. The chunked and close-delimited success controls cover both helper modes but not the real runner. Fix: retain both runner probes as regression tests.
- F18 (Minor, phase-acceptance A11): `harness/tests/meta/executor-model-route.test.ts:193` inherits the caller environment. Line 377 asserts that `BENCH_EXECUTOR_COHORT_ID` is absent. Fix: use an explicit environment as in `harness/tests/meta/opencode-run-fixtures.ts:169-182`.

## 2026-11-27 — ingest_daily Review B follow-up work

- F6: `harness/model-guide-tests/update.test.ts:360-364` adds `review.html` to the weekly update commit-path expectation. Move the weekly update correction into its own maintenance change, or record its reason. Evidence: `measure/runs/ingest_daily_20261127/review-b-ff8d906.json` and `measure/runs/ingest_daily_20261127/review-b-8b6b5bb.json`.
- F8: `harness/model-guide/ingest.py:45,111-130` uses a tracked raw export as the schema reference. Replace it with reviewed schema-only data. Review the historical public exports separately. Evidence: `measure/runs/ingest_daily_20261127/review-b-ff8d906.json` and `measure/runs/ingest_daily_20261127/review-b-8b6b5bb.json`.
- F10: The direct dry-run CLI at `harness/model-guide/ingest.py:435-442` accepts existing files without owner-only modes. Require a fresh private dry-run destination. Evidence: `measure/runs/ingest_daily_20261127/review-b-8b6b5bb.json`.
- F12: Publication cleanup at `harness/cron-daily.sh:113-117,238-245,504-505` can remove its directory while a Git worktree record remains. Use a dedicated publication directory, and reconcile stale worktree records before the next run. Evidence: `measure/runs/ingest_daily_20261127/review-b-ee5c223.json`.
- F13: The no-renames diff at `harness/cron-daily.sh:301` omits the unchanged source of a copy. Add a checked copy-aware name-status diff, and validate each reported path. Evidence: `measure/runs/ingest_daily_20261127/review-b-a0752a7.json`.

## 2026-11-27 — Model API null input rejection test

Add an explicit test that rejects a model API entry whose `input` value is `null`. Evidence: Review A F1 in `measure/runs/executor_input_limit_optional_20261127/review-a-a514336.json`.

## 2026-11-27 — guide_docs_ops documentation grader clause recognition (routed 2026-11-27, PM closure order)

Source files: `measure/runs/guide_docs_ops_20261127/review-a-fb5e0c3.json` and `measure/runs/guide_docs_ops_20261127/review-a-25133bf.json`.

Precondition for any further docs-and-ops run: the documentation grader's clause-level recognisers pass natural wordings and reject inversions.

### Major findings

- F10: the release recogniser accepts a contrast that keeps the current release instead of returning to the previous release. It also accepts an instruction to deploy the new release and an unrelated release noun. Bind an affirmative restoration action to a previous release object in the same clause. Treat "rather than" and "instead of" as clause boundaries with opposite polarity.
- F11: the preservation recogniser accepts the list item "Do not preserve the loan records." It also accepts a deletion instruction and an unrelated keep sentence. Apply the negation to the preservation verb itself. Require a preservation or no-deletion statement about loan records in the same clause.
- F12: the boundary recogniser accepts a due-soon window of 48 minutes and a table row that classifies returned loans as overdue. Bind each status to its subject, comparison, and window in the same statement or table row. Require the duration with its unit. Reject a returned-loan overdue classification beside a correct separate rule.
- F13: the rollback recogniser rejects correct instructions. The rejected wordings state a prior version with no removal, a switch back to a known-good release, a valid reverse contrast, and a prohibition against wiping or resetting loan records. Recognise common restoration paraphrases and scoped contrast. Accept correctly negated destruction verbs.
- F14: the boundary recogniser rejects correct loan-state descriptions. The rejected wordings use "earlier than now", keep the returned status after the due date, and use an inclusive 48-hour window. Recognise the equivalent returned-state, strict comparison, and inclusive duration expressions. Keep the relation and the duration bound to their status.

### Minor findings

- F7: `harness/tests/meta/docs-ops-registration.test.ts:49-64` checks the canary and the regrade with source assertions. Add temporary-artifact integration coverage.
- F9: `harness/docs-and-ops/grade-docs-ops.ts:415` writes a worker wrapper that reads a `.mutation` control file from the candidate workspace. Move the startup fault injection to a grader-owned test seam outside the candidate workspace.

### Review A r2 findings (routed 2026-11-28, orchestrator decision for card runs_docs_ops_hungerg_20261128)

Evidence: `measure/runs/runs_docs_ops_hungerg_20261128/review-a-88abf98.json`. The remediation round limit was reached; the grader at `9f379df` is accepted for that card.

- F3 r2: `harness/docs-and-ops/grade-docs-ops.ts:140,156-164` accepts a negated destruction verb about another object as loan preservation. The sentence "Restore the previous release and do not drop logs but delete loan records." passes every check. Bind each negation to its own verb and each verb to its own object. Reject an affirmative deletion of loan records.
- F4 r2: `harness/docs-and-ops/grade-docs-ops.ts:140-149` removes a negation that applies to two coordinated verbs. The sentence "Do not delete loan records or restore the previous release." passes every check, although it prohibits restoration. Keep the polarity of the restoration verb when one negation covers coordinated actions.
- F5 r2: correct rollback instructions still fail `D.sections.rollback`. The wordings are "Restore the previous release without deleting loan records.", "Restore the previous release and do not remove loan records.", "Restore the previous release, not the new one. Keep the loan records." and "Restore the previous release, not the new release. Keep the loan records." These are wording gaps under F13, not regressions.
