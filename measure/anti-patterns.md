# Measure Anti-Patterns Catalog

> Project copy, seeded by `measure-orchestrator-audit` on 2026-10-11 from the
> canonical starter catalog at
> `/home/daniebo/.agents/skills/measure-orchestrator/references/anti-pattern-catalog.md`.
> The canonical A1 and A8 entries are retired there; their numbers stay reserved
> so A2–A10 keep their meaning. This file extends the catalog with a
> project-specific entry (A11) as new failure classes are caught.

> **Project note on detection recipes.** The canonical A2–A7,A9 recipes reference
> shell contract tests under `tests/*.sh` (a `tests/` directory at repo root). This
> repository has none; its contract surface is the TypeScript harness under
> `harness/` and `harness/tests/**`. Apply the intent of each recipe, not the
> literal glob. The A1/A8 recipes referenced `measure/automation-supervisor.py`,
> which does not exist in this repo (retired upstream; the skill was removed in
> track `skill_distribution_repair_20261005`).

---

## A1 — Substring-as-structured-signal in supervisor (retired, reserved)

**Retired 2026-10-05.** Checked `measure/automation-supervisor.py`, which was removed.
The number stays reserved so A2–A10 keep their numbers. Not applicable to this repo.

---

## A2 — Consent-blind publish gate

**Class:** orchestrator missing requirement
**Caught:** 2026-06-24 review
**Detection:**
```bash
for t in tests/*p4.sh tests/*_closeout.sh tests/cs_p*.sh; do
  if [ -f "$t" ]; then
    n=$(grep -ic 'consent\|anonym' "$t" 2>/dev/null || echo 0)
    echo "$t: $n consent/anonymization references"
    [ "$n" = "0" ] && echo "  WARN: publish gate has no consent or anonymization check"
  fi
done
```

**Symptoms:** A test that flips draft → published does not check consent artifacts
or anonymization.

**Fix:** For any publish gate, require EITHER an explicit anonymization marker OR a
non-empty `consent-<subject>.{md,pdf}` artifact with signatory + date.

**Guard:** `tests/cs_p4.sh` P4.1 (canonical; not present in this repo).

---

## A3 — Digit-only as a "labeled count"

**Class:** test fragility / vacuous assertion
**Caught:** 2026-06-24 review
**Detection:**
```bash
rg -nE "rg -q '\[0-9\]\+'" tests/*.sh
```

**Symptoms:** A count assertion matches any bare digit anywhere (`rg -q '[0-9]+'`),
passing on a date, year, or any digit in the section.

**Fix:** Require a labeled integer and parse it.

**Guard:** `tests/mir_p1.sh` A3 (canonical). This repo's analog: parse the labeled
vitest summary (`Test Files  N passed`, `Tests  N passed`, `N failed`) and the JSON
report, never a digit grep (see `measure/tracks/bench_v2/test-strategy.md` §4).

---

## A4 — Vacuous-pass on nothing-done

**Class:** test fragility / vacuous assertion
**Caught:** 2026-06-24 review
**Detection:**
```bash
for t in tests/mr_p1.sh tests/mr_p2.sh tests/mr_p3.sh tests/mr_p4.sh; do
  if [ -f "$t" ]; then
    pair=$(awk '/TILDES=/ && /-eq 0/ { t=1 } t && /XES=/ && /-eq 0/ { found=1; exit }
      END { print found+0 }' "$t")
    [ "$pair" = "1" ] && echo "  $t: vacuous 'markers consistent' PASS"
  fi
done
```

**Symptoms:** A "markers consistent" check passes when a phase has zero completed
tasks (all-`[~]`) AND when a phase has zero in-progress tasks (all-`[x]`).

**Fix:** Reclassify all-`[~]` as `INCOMPLETE` (FAIL); reserve PASS for all-`[x]` with
`>= 1 [x]`.

**Guard:** `tests/mir_p1.sh` A4 (canonical). This repo's analog: `M.plan-complete`
requires every task present before it can pass; an emptied plan.md fails.

---

## A5 — False-claim text vs test reality

**Class:** plan truthfulness
**Caught:** 2026-06-24 review
**Detection:**
```bash
rg -nE "PASS=[0-9]+.*FAIL=0|all checks pass" measure/tracks/*/plan.md
# For each hit, run the test the plan cites; if exit != 0, the claim is false.
```

**Symptoms:** A plan task claims "all checks pass" while the cited test exits 1.

**Fix:** Only write "all checks pass" when the test actually exits 0. Tie each `[x]`
to an evidence anchor (a commit SHA matching the interphase checker regex
`\b[0-9a-f]{7,40}\b`, or archived reports). Reopen the task when evidence is refuted.

**Guard:** `tests/mir_p1.sh` A5 (canonical). This repo's caught occurrence: bench_v2
task 7.1 carried a false `[x]` ("test:meta:logic passes") for ~2 weeks while
`reports/weekly-cron-2026w39.log` and `-2026w41.log` showed the self-check failing on
all four track batches (see A11).

---

## A6 — Registry-note overstatement

**Class:** marketing copy outrunning implementation
**Caught:** 2026-06-24 review
**Detection:**
```bash
rg -nE "API-key encryption (was )?resolved|encryption.*resolved|completely fixed|fully solved|all (checks |tests )?pass" measure/tracks.md
# For each hit, check the corresponding adversarial/contract test is green.
```

**Symptoms:** A registry note claims a state "resolved"/"complete" while the
adversarial/contract evidence for it is still missing, failing, or uncommitted.

**Fix:** A "complete" status is only valid when commit evidence exists and the
contract test is green. An untracked directory cannot be "complete".

**Guard:** Static check in `measure-orchestrator-audit`. This repo's caught
occurrence: `bugfix_bench`, `tests_bench`, `change_bench` are "complete" in
`measure/tracks.md` and in their `metadata.json`, but their contents are untracked
(no commit, no evidence SHA).

---

## A7 — Over-broad filter swallowing real hits

**Class:** test filter too coarse
**Caught:** 2026-06-24 review
**Detection:**
```bash
rg -nE 'rg -v "[^"]*(never|do not|do NOT|don.t|cannot say|forbidden|prohibited)[^"]*"' tests/*.sh
```

**Symptoms:** An exclusion filter uses bare English words as tokens; a real banned-term
line containing "never" is silently dropped.

**Fix:** Exclude only file-path contexts and policy-disclaimer markers, not bare words.

**Guard:** `tests/mir_p1.sh` A7 (canonical). This repo's analog: the frozen
`test:meta:logic` exclude list in `harness/package.json`; growing it to reach green is
forbidden (`measure/tracks/bench_v2/test-strategy.md` §10).

---

## A8 — `[ ]` (space) marker ambiguity (legacy) (retired, reserved)

**Retired 2026-10-05.** Checked `measure/automation-supervisor.py`, which was removed.
The number stays reserved. Not applicable to this repo.

---

## A9 — Pre-existing test references archived track paths

**Class:** test not updated on archive move
**Caught:** Multiple occurrences after archive moves
**Detection:**
```bash
rg -nE 'measure/tracks/([a-z_0-9-]+)/plan\.md' tests/*.sh
# For each id, if measure/archive/<id>/ exists and measure/tracks/<id>/ doesn't, the
# test is broken.
```

**Symptoms:** A test references a moved track path and fails forever.

**Fix:** Add a `track_dir_resolve()` helper that prefers `measure/archive/<id>`;
codify in `tests/_lib/track_dir.sh`.

**Guard:** Static check in `measure-orchestrator-audit`. No tracks are archived in
this repo yet, so no occurrence.

---

## A10 — Generated-facts drift after structural change

**Class:** CI gate that fights developers
**Caught:** Every `measure/doctor.sh` Check 5 failure
**Detection:**
```bash
ls -la .git/hooks/pre-commit 2>/dev/null
```

**Symptoms:** `measure/doctor.sh` Check 5 fails after every structural change because
no pre-commit hook regenerates generated facts.

**Fix:** Add a pre-commit hook that runs the generator and stages the result.

**Guard:** Static check in `measure-orchestrator-audit`. This repo: no
`.git/hooks/pre-commit` exists; `measure/generate.sh` and `measure/generated/` are not
present either, so Check 5 does not apply here yet.

---

## A11 — Inherited-environment test fragility

**Class:** environment non-hermeticity / test fragility
**Caught:** 2026-10-11 root-cause; incident spans 2026w39 (2026-09-27) and 2026w41
(2026-10-11)

**Description:** Tests or orchestration inherit the caller's environment (here
`BENCH_TRACK`) and change their verdicts as a result. Two sub-defects:
- **E1 (orchestration):** `harness/batch.sh` exported `BENCH_TRACK="$TRACK"` before
  the self-check block, so `npm run test:meta:logic` inherited a non-build track.
- **E2 (test hermeticity):** the meta tests built score records without pinning
  `BENCH_TRACK`; `score-helpers.ts applyEnv` and the `spawnSync` env merges
  (`...process.env`) passed a leaked value through.

**Detection:** run the suite under adversarial environment values:
```bash
cd harness && BENCH_TRACK=change npm run test:meta:logic
# Before the fix: 15 meta failures (17 with the two guard tests).
# After the fix: 165/165 passed.
```

**Symptoms:** The weekly cron's self-check failed on all four track batches
(build/bugfix/tests/change) in `reports/weekly-cron-2026w39.log` and
`reports/weekly-cron-2026w41.log` (`harness self-check failed: the meta suite did not
pass`), while a scrubbed shell (`env -u BENCH_TRACK`) passed. bench_v2 plan task 7.1's
`[x]` "test:meta:logic passes" was therefore false for ~2 weeks.

**Fix:** `batch.sh` runs the self-check under `env -u BENCH_TRACK`; the meta-test env
construction scrubs a leaked `BENCH_TRACK` unless a fixture pins one
(`envWithoutTrack()`, `applyEnv({})`). Commit `79894bc` (E1/E2). The fail-closed
attestation was correct and unchanged; the defects were the leak and the non-hermetic
tests.

**Guard:** the `BENCH_TRACK=change` adversarial full-suite run (R2), plus the artifact
guard `harness/tests/meta/selfcheck-env.test.ts` (added at Red `d94235b`), plus the
`BENCH_TRACK=bugfix` spot check. Caught occurrence root-caused 2026-10-11; full
diagnosis in `measure/tracks/bench_v2/test-strategy.md` §1–2.
