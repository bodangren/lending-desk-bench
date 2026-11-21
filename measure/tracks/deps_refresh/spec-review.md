# Spec Review: deps_refresh

Author model: opencode-go/muse-spark-1.3-contributor#high

Review status: not yet reviewed. No reviewer ran in this session.
The author session wrote `spec.md` and `plan.md` from the PM
assignment and the audit facts. A fresh reviewer checks them before
Red task 1.1 starts.

Scope of the future review: the fixture pin reason (spec D1), the
Red form (spec D5), the gate commands (spec D6, plan task 3.1), and
the night-run rule (spec D7, plan task 3.3).

## Amendments after spec review

The reviewer (openai/gpt-6-luna#high) failed head `2fb569f` on
2026-11-21. Report: `measure/runs/deps_refresh/spec-review-2fb569f.json`.
The author amends spec and plan as follows. No other file changes.

- **F1 (blocker).** Review r2 keeps F1 open: the count rule can
  hide a new error behind a removed one. Review r3 keeps it open
  again: a bare pipe can hide a tsc failure behind an empty set.
  The plan now holds one bash block (task 3.1) with
  `set -o pipefail`. It runs tsc once into a raw file and keeps the
  exit code. Exit 0 needs an empty identity set and no `error TS`
  text in the raw file. Exit 2 needs the raw error-line count to
  equal the identity count before dedup, and a non-empty set. Any
  other exit fails the check. Then the block checks that the base
  file is non-empty and the after file exists, and runs
  `comm --check-order -13` of the base file against the after file,
  which must print nothing. A failed `comm` fails the check instead
  of passing as an empty difference. Sort and compare run
  under `LC_ALL=C`, since locale sort order disagrees with `comm`.
  Task 1.1 runs the same block for the base and records exit 2,
  210 raw error lines, and 210 identities. The r3 source-change
  fallback is gone: Green makes no source edit, and an update that
  needs one stops and defers with its reason in task 2.1.
- **F2 (blocker).** The "Daniel says push first" gate is gone. Plan
  task 3.3 sends the push through safe-push, dry run first, run
  alone, never chained (`plan.md` lines 120-133). Exit 2 stops the
  track and reports the range and app list to the PM. Exit 3 or 4
  stops the track and reports to the PM. No role pushes. The human
  gates keep only the deletion gate (`plan.md` lines 135-138).
- **F3 (major).** Spec D9 is new (`spec.md` lines 116-129). Playwright:
  the config uses system Chrome, so no browser download runs; when
  `@playwright/test` moves, task 3.1 adds a version check plus one
  named e2e spec (`tests/e2e/probes.spec.ts`) through `heavy-run.sh`
  (`plan.md` lines 100-103). react-doctor: the 0.9.23 bump defers,
  because it would change Axis 3 scores mid-cohort; the moderate
  advisory stays listed with that reason in tasks 2.1 and 3.2
  (`plan.md` lines 70-72, 113-116).
- **F4 (major).** Heavy gates run only 22:00-01:30, never 02:00-06:00.
  The order is: Green commit in the day, gates 22:00-01:30, then the
  push. A gate not done by 01:30 stops and resumes the next evening.
  Spec D7, FR-3, FR-6, NFR-3, and R2 name the window (`spec.md` lines
  108-113, 147-151, 175-182, 189-190, 217-219). Plan constraints,
  tasks 3.1 and 3.3, and risks match (`plan.md` lines 22-28, 83-86,
  120-123, 143-146).
