# Bug-fixing benchmark — lending_desk_bugfix

## Summary

Add a second benchmark track that measures finding and repairing undisclosed
defects in a working application, without regressions. The build track
(`lending_desk`) stays unchanged. The bug-fix track reuses the isolation,
arms, provenance, grading suites, and control machinery that already exist.

The core design: the sensitivity controls already define anchored mutations
that provably break specific suite criteria. A bug-fix variant is the same
operation applied up front to a correct tree. Every seeded bug therefore has a
pre-proven detector before any model runs.

## Definitions

- **Clean tree.** The `fixture/` tree with the `reference/` overlay applied to
  the nine task files. This is the complete, correct application.
- **Variant.** The clean tree with the seeded bugs from one task set applied.
  This is what the model sees and edits.
- **Bug.** A realistic, anchored source mutation that changes one behavior from
  correct to incorrect.
- **Detector.** A suite id that passes on the clean tree, fails on the single
  bug, and passes again on the repaired tree.
- **Task set.** A fixed, versioned list of bugs. Every model in one comparison
  cohort receives the identical variant.
- **Repair.** The candidate passes the detector of a seeded bug.

## Functional requirements

### FR-1 — Registry

`harness/bugfix/registry.ts` holds the bug registry. Each entry declares:

```ts
type BugEntry = {
  id: string;                  // "BUG-fn-boundary"
  class: "functional" | "security" | "performance" | "reliability";
  skill_rule: string | null;   // e.g. "async-parallel", or null for product logic
  target: string;              // writable relative path
  replacements: SourceReplacement[];  // anchored from/to pairs
  detectors: string[];         // CRITERIA or PROBES ids; at least one
  collateral: string[];        // other ids allowed to fail for this bug alone
  realism: string;             // why this mutation is a plausible mistake
};
```

Rules:

- Ids are unique and stable across set versions.
- Every detector id exists in `CRITERIA` or `PROBES`.
- Anchors must match the clean tree exactly once.
- Detectors of two bugs in one set must not overlap. Overlap is allowed only
  through the `collateral` field.
- A mutation must be realistic. Synthetic flips such as `if (false)` are
  rejected in review.

### FR-2 — Task sets

`harness/bugfix/sets/<version>.json` holds one task set:

```json
{
  "schema": 1,
  "id": "v1",
  "bugs": ["BUG-fn-boundary", "..."],
  "notes": "fixed cohort set for 2026-Q4"
}
```

Rules:

- v1 holds 11 bugs: 5 functional, 2 security, 2 performance, 2 reliability.
  Two original bugs were replaced or dropped after admission calibration
  proved their mutations invisible to any detector on Next 16 (see the
  registry notes).
- A set is frozen before any cohort run. Models never receive different bugs
  inside one comparison.
- Sets rotate on a declared schedule. The registry is larger than any set.
- The set file, registry hash, and clean-tree hash bind into provenance.

### FR-3 — Variant generation

`harness/bugfix/make-variant.ts` builds the variant:

1. Copy `fixture/` excluding `node_modules`, `.next`, `.git`.
2. Apply `reference/` over the nine task files.
3. Replace `measure/tracks/lending_desk/` with the model-visible bugfix track
   files (FR-4). The completed build plan never appears in the variant.
4. Apply every bug in the active set. Verify each anchor matches exactly once.
5. Emit `variant.json` with the per-file hashes.

Generation is deterministic. The same fixture, reference, registry, and set
always produce the same bytes.

### FR-4 — Model-visible contract

The variant contains `measure/tracks/lending_desk_bugfix/` with `spec.md`,
`plan.md`, and `metadata.json`. The spec restates the A–H acceptance criteria of
the build track as invariants the application must satisfy. It states that
defects exist. It does not state a count, classes, or locations. `AGENTS.md` is
the fixture `AGENTS.md` with the task section replaced.

The prompt:

> Read measure/tracks/lending_desk_bugfix/spec.md. This application is
> defective: it violates some of the acceptance criteria. Find and repair the
> defects. Do not change any exported symbol or type signature. Do not modify
> src/db/, src/lib/auth.ts, app/members/, or src/components/member-card.tsx.
> Add no files and no dependencies. Run "npm run typecheck" and "npm run build"
> and make sure both pass before you stop.

### FR-5 — Candidate contract

`candidate-contract.ts` gains a variant mode:

- The comparison root is the generated variant, not `fixture/`.
- Writable paths are the nine task files plus the bugfix track's `plan.md`
  and `metadata.json`.
- Protected files, the public API surface check, and symlink rejection are
  unchanged.
- The variant tree hash replaces the fixture protected hash in the record.

### FR-6 — Runner and grading

- `run.sh` accepts `BENCH_TRACK=bugfix|build` (default `build`).
- The bugfix track seeds the candidate from the generated variant.
- `grade.sh` gains one track-aware selection: the `M.*` closeout criteria
  grade the build track's `measure/tracks/lending_desk/` files, which the
  variant replaces. Bugfix runs exclude them from the Playwright pass and
  from the collector's declared ID set. Everything else is the same single
  grading implementation.
- For bugfix calibration, `AGENT_SKIP=1` seeds the candidate from the
  variant and applies no overlay.
- The unit, API, and e2e suites run otherwise unchanged: they already grade
  the complete application. Seeded bugs surface as specific criterion or
  probe failures.

### FR-7 — Scoring

`score.json` moves to schema 3 with a `track` field. For `track: "bugfix"`:

```text
repair       = Σ(repaired_bug × weight) / Σ(weight)
               weight is 2 for the security class, 1 otherwise
regression   = tier-scaled pass rate over every criterion that is not a
               seeded detector and not declared collateral
               (M.* closeout criteria are excluded on this track)
robustness    = probe pass rate, excluding probes declared as collateral
quality       = completion-gated doctor + source-signal penalty, unchanged
total        = round1(100 × (0.50 × repair + 0.25 × regression
                            + 0.15 × robustness + 0.10 × quality))
```

- The record carries per-bug repair outcomes, per-class rates, and the
  churn advisory (changed-line count vs the variant).
- Churn is reported, never scored.
- An untouched variant passes most non-detector criteria by design. Its total
  sits near 40. Calibration (FR-9.2) verifies and records this baseline.
- Gate-blocked and invalid records follow the existing build-track policy.

### FR-8 — Provenance

Provenance moves to schema 5 for bugfix runs. It adds:

- `track: "bugfix"`
- `bug_set_id` and `bug_set_sha256`
- `registry_sha256`
- `variant_sha256` (the FR-3 output)

Freshness checks bind all of them. A registry or set edit invalidates old
bugfix scores, exactly as a harness edit invalidates build scores.

### FR-9 — Calibration

Before any cohort:

1. Clean variant: generate with an empty bug set. It must score 100.
2. Untouched variant: seed v1, grade with no agent. The repair
   axis must be 0. Every detector must fail.
3. Single-bug runs: apply exactly one registry bug to the clean tree and grade.
   Its detectors must fail; nothing outside `collateral` may fail. This is the
   admission test for every registry entry, run through a new
   `harness/verify-bugs.ts` that mirrors `verify-controls.ts`.
4. Pairwise check for the set: for every bug pair, detector sets stay disjoint
   outside declared collateral.
5. Concurrency, fresh-store, and under-load trust checks reuse the existing
   control paths.

Calibration runs grade a generated variant with no agent. They are diagnostic
and nonrankable, like overlay runs on the build track.

### FR-10 — Arms and reporting

- Arms `a` (No Skills) and `b` (Skills) are unchanged, with the same five
  skills mounted for `b`.
- The skills are the bug taxonomy: performance bugs map to
  `vercel-react-best-practices` rules; the Arms delta measures whether skill
  content transfers to detection and repair.
- `summarize.sh`, `export-site-data.py`, and the model pages report the two
  tracks separately: totals, per-class repair rates, and the No Skills /
  Skills delta per class.
- EMA and the 4-week range apply after the second weekly cohort, per the
  existing policy.

## Acceptance criteria

- [ ] FR-1 registry exists and validates under a meta test.
- [ ] FR-2 set v1 exists and validates under a meta test.
- [ ] FR-3 variant generation is deterministic; two runs produce identical
      `variant_sha256`.
- [ ] FR-4 model-visible spec states invariants only; no count, class, or
      location appears in any model-visible file.
- [ ] FR-5 candidate contract accepts a clean overlay fix and rejects a
      protected-file edit in variant mode.
- [ ] FR-6 both tracks run through the same `run.sh` and `grade.sh`.
- [ ] FR-7 schema-3 records compute the four axes; a meta test verifies the
      arithmetic on synthetic results.
- [ ] FR-8 provenance schema 5 binds set, registry, and variant hashes.
- [ ] FR-9 the calibration sequence passes and its records are nonrankable.
- [ ] FR-10 the site publishes per-class repair rates and the arm delta.

## Anti-gaming

- **Rewrite instead of fix.** Allowed. Regression, robustness, and quality
  score the outcome. Churn is advisory.
- **Delete the defective feature.** Fails the regression axis and usually the
  gate, because the suite grades complete behavior.
- **Memorize the variant.** Sets are frozen per cohort and rotate. The
  registry exceeds any set. Harness and sets are never model-visible.
- **Over-fix style.** Quality signals score introduced diagnostics, so
  gratuitous churn can cost, never help.
- **Reference coupling.** The audit found five criteria that graded the
  reference, not the spec. Detectors must pass the same review. A second
  correct implementation under `reference-variant/` (audit plan task 1.5) is
  the standing gate before a bug is admitted to the registry.

## Out of scope

- Random per-run bug generation.
- Minimal-diff or diff-location scoring.
- LLM-judged repair quality.
- A second application domain or fixture app.
- Scored Measure closeout for the bugfix track.
- Style-only advisories posed as bugs.

## Dependencies

- The repository must be private before any bugfix cohort (audit plan 6.1).
- `reference-variant/` (audit plan 1.5) gates registry admission.
- The harness self-check (audit plan 1.1) runs before every batch.

## Risks

| Risk | Mitigation |
|---|---|
| A detector grades reference incidentals | FR-9 admission test plus `reference-variant/` gate |
| Two bugs share a detector | Pairwise disjointness check at calibration |
| Variant bytes drift from fixture edits | Deterministic generation; hashes bind into provenance |
| Bug difficulty varies across classes | Per-class reporting; class weights only for security |
| Cohort leakage through a public repo | Private repo dependency |
