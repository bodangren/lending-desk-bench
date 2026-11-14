# Spec Review: model_guide

Author model: claude-code/claude-opus-5-5[1m]#high
Reviser model: opencode/minimax-m3.1-flash-free#high (round 1 fixes)

The reviewer writes only under `measure/runs/model_guide/`. The author or a
Build session updates this file after a review.

## Round 1 — 2026-11-14

Reviewer model: nvidia/minimaxai/minimax-m3.1-flash#thinking
Reviewer result: `measure/runs/model_guide/spec-review-bbde00d.json`
Baseline: `ea36fae`. Reviewed HEAD: `bbde00d`.
Reviewer status: fail. The reviewer raised 4 Blocker findings, 7 Major
findings, and 1 Nit finding.

The author answers each finding below. Each Blocker has FIX, CONTEST, or
ESCALATE. Every finding has FIX.

### F1 [Blocker] — FIX

Finding: F1 [Blocker] spec.md D5-D7 and plan.md 3.1-3.5: Comprehension gap: The required operator catalog does not exist, so the seeding contract has no finite valid values. Rationale: D5 requires one named operator per plant, while D6 lists only examples and the lint must validate the field.

Author response: spec D6 now holds the closed catalog. It gives the operator id, the class, and the change of every operator from C1 to C9. The lint of FR-8 fails when the operator of a plant is not in the catalog of its class. The plan task 3.2 tests the lint with an operator outside the catalog.

### F2 [Blocker] — FIX

Finding: F2 [Blocker] spec.md D10-D11 and plan.md 3.1: The adjudication unit can contain different findings, but the spec gives one verdict for the whole group. Rationale: One verdict cannot classify each member of a mixed group. A favorable verdict can forgive false claims and compress route scores.

Author response: spec D11 now names one finding as the unit of adjudication. Each finding gets its own verdict. A group joins only the findings that make the same claim, and it exists for de-duplication. The plan task 3.4 tests a group with two different claims.

### F3 [Blocker] — FIX

Finding: F3 [Blocker] spec.md D16 and D18: Comprehension gap: The work-type rank and its score inputs are undefined. Rationale: The export gives work types only runs, pass, and fail, but D16 defines pass rate with error and blocking findings. The overview cannot select these rows without new rules.

Author response: spec D16 now defines the work-type tables. The pass rate of a work type is `pass / (pass + fail)`. The page shows the run count `pass + fail` beside each rate. A row with fewer than 10 runs gets the mark `few runs` and cannot pick. The rank uses the pass rate and then the run count. A work type with no row says "no pick yet". Spec D18 names the work-type table as the first source of the rows app code, docs and ops, print books, and tooling.

### F4 [Blocker] — FIX

Finding: F4 [Blocker] plan.md 0.2: The reviewer cannot write the required track review file under the report-only gate. Rationale: Task 0.2 assigns measure/tracks/model_guide/spec-review.md to the reviewer, but the role permits writes only under measure/runs/model_guide/. Red cannot pass the stated verification.

Author response: plan task 0.2 now says that the reviewer writes only under `measure/runs/model_guide/`. The author or a Build session updates `spec-review.md` after the review. The constraints of the plan hold the same rule. This file holds the round 1 record.

### F5 [Major] — FIX

Finding: F5 [Major] spec.md D4, D5, D11, D12, R3, and Q9: The same Anthropic family selects, seeds, and adjudicates the set while Claude Sonnet is ranked. Rationale: Hiding the route name does not hide model style. No independent selection or adjudication rule protects the ranked family from family bias.

Author response: the PM accepted the default on 2026-11-14 (spec OD5). Spec D11 now has two judges. The first judge is the route `claude-code/claude-opus-5-5[1m]#high`. The second judge is the route `opencode/minimax-m3.1-flash-free#high`, a family that is not Anthropic. Only the verdicts that both judges agree on count. A disagreement counts as unclear and never counts against the model. Spec D4 now selects each diff by rule. The tool takes the qualified commits in order and skips the diffs that a set holds. The fixture author chooses no diff. Risk R3 and question Q9 hold the new rule.

### F6 [Major] — FIX

Finding: F6 [Major] spec.md D5, D6, D8, D11, D13, and R1: The track has no difficulty calibration or minimum score spread. Rationale: Common one-line mutations and the rescue of wrong-line or wrong-class claims can produce the same high scores as the build track. No gate rejects an undiscriminating set before ranking.

Author response: the PM accepted the default on 2026-11-14 (spec OD7). Spec D13 now holds the pilot gate. The pilot set has 6 diffs and at least 12 plants. It runs on 2 routes with 2 passes each. The set goes to ranking only when the best worst-of-2 score minus the lowest worst-of-2 score is 20 points or more, and when the best worst-of-2 score is below 90. A failed set gets a harder reseed. After 2 reseeds the orchestrator sends the set to the PM. Spec D10 and D11 now state that a claim on a wrong line or with a wrong class never counts as found. The plan task 4.11 holds the pilot gate.

### F7 [Major] — FIX

Finding: F7 [Major] spec.md D12, D15, EV10; plan.md task 4.1: The quota contract does not cover most plan routes. Rationale: harness/cron-daily.sh:305-330 reads only GET /api/quota/opencode-go. D12 uses claude-code, kimi-code-plan-cn, minimax-cn-coding-plan, bailian-token-plan, and nvidia routes, but D15 gives no quota source or mapping for them.

Author response: spec D15 now names the quota source of each provider. The sources are the OpenChamber endpoint `GET http://127.0.0.1:<port>/api/quota/<id>` with the ids `claude`, `kimi-for-coding`, `minimax-cn-coding-plan`, and `opencode-go`. The read gives one state for each route: `ready`, `wait`, or `stopped`. The providers nvidia, bailian, Ark, and the opencode free routes have no quota source. They run at most 1 pass per night and stop at the first quota or limit error. Spec FR-15 and the plan task 4.2 hold the contract and the test.

### F8 [Major] — FIX

Finding: F8 [Major] spec.md Owner requirement, D16, and Q4: The checker rank does not follow the PM order. Rationale: The quoted hand-off order says to rank by pass rate and blocking findings. D16 excludes blocking rate from checker rank. Q4 offers an unapproved default that uses pass rate only.

Author response: the PM accepted question Q4 on 2026-11-14 (spec OD3). The checker roles rank by pass rate only. The page shows the blocking rate beside the rate. Spec D16, FR-3, and the owner questions hold the decision. The spec changes nothing else for this finding.

### F9 [Major] — FIX

Finding: F9 [Major] spec.md Owner requirement, D17, and acceptance criterion 5: The preview can omit the required print-audit error types. Rationale: The PM order requires error types, but the spec accepts "Error types: not yet received." A complete page B can therefore miss one required data point.

Author response: the PM sent the error types on 2026-11-14 (spec OD6). The file `~/Desktop/handoff/a23-print-audit-error-types/print-audit-error-types-v13.json` holds them with the SHA-256 `f52a7bbf0f4263a84a16dba02cb4ccf4c76b6f40d3e70110104ebbf6140a6e87` and a `MANIFEST.txt` next to it. Spec D17 now gives the input check, the content, and the page block. The line "Error types: not yet received." does not exist in the track. The acceptance criterion 6 of the spec holds the error types with their counts. The plan task 2.4 writes the data file from the hand-off file.

### F10 [Major] — FIX

Finding: F10 [Major] spec.md D21 and FR-7: The publish tool can overwrite newer site files with stale preview files. Rationale: The daily job can change docs/ between preview and approval. The publish check validates preview hashes, but it does not compare the current docs source.

Author response: spec D21 now holds the drift check. The preview records the SHA-256 of each copied file of `docs/` in `preview-base.json`. The publish tool compares the current files with that record. On a drift it gives exit 2, names each drifted file, and writes nothing. Spec FR-7 and the plan tasks 1.3 and 5.3 hold the check.

### F11 [Major] — FIX

Finding: F11 [Major] plan.md tasks 1.2, 2.2, 3.2, and 4.2: The Red and Green units bundle many independent tools and pages. Rationale: Phase 3 alone asks one Green task to write six tools. A failed component cannot have a small repair or verification boundary.

Author response: the plan now gives each Green task one tool or one page and its own verify line. Each Red task writes one test file. The tasks of Phases 1 to 4 have the new numbering, and the constraints of the plan hold the rule.

### F12 [Nit] — FIX

Finding: F12 [Nit] plan.md task 0.1: The completed registry task has no commit SHA. Rationale: The plan marker rules require that SHA on the first line of each completed task, and the anti-pattern catalog rejects completed tasks without evidence.

Author response: plan task 0.1 now starts with the SHA `bbde00d` on its first line.

## Round 2 — pending

The reviewer of round 1 reads the revised spec and plan. The reviewer writes
only under `measure/runs/model_guide/`. The author or a Build session updates
this file after that review.
