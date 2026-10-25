# Test strategy — domain_trust

This strategy tells Red, Green, the reviewers, the adversarial role, and the
UX role how the matrix is proved. Spec: `spec.md`. Plan: `plan.md`. Golden
preview: `preview.json`.

## 1. Scope and risk

The product of this track is a published claim: "model X is safe in domain
Y". A wrong claim sends a lead to assign work to a model that fails it. The
main risks are these:

| Risk | Effect | Defense |
|---|---|---|
| A cell reads `safe` on missing evidence | A lead trusts a domain that no run tested | Coverage cases of section 5.2, the empty-input case, and the `N_MIN` gap list |
| An unstated check counts as a failure | A model reads `risk` for a check it never had | The `since` cases of sections 5.2 and 5.3, and `FR3_CHECK` with `FR3_GUARD` |
| A probe sits in the wrong domain or kind | One domain loses a defect, and another gains one | The golden probe map (section 5.1) and the Review A map review (section 7) |
| The export changes the leaderboard | The ranking moves with no score change | `LEADERBOARD_SHA` and `SIDE_SHA` (section 2) |
| The track changes a hashed file | `plan-work.ts` schedules paid model runs | `PATH_CHECK`, `BASE_HASH`, and the work-list classes (section 2) |
| A legacy Pi record changes outside Git | The published history loses its byte identity, and `PATH_CHECK` does not see it | `PI_SHA` and `PI_CHECK` (section 2, anti-pattern A13) |
| The methodology text lacks a part of the rule | A lead reads a verdict with no definition | `METHOD_CHECK` (section 2) |
| The page shows a verdict by color only | A reader with low color vision misreads it | The word check of the browser review (section 8) |
| The matrix publishes before O2 | The weekly cron deploys an unapproved page | All edits stay on the branch until task 4.2 (spec NFR-7) |

## 2. Gate commands

Run every command from the worktree root (`../lending-desk-bench-trust`)
unless the line says `main`.

- `TRUST_TEST`:
  `cd harness && npx vitest run site-tests/domain-trust.test.ts`.
  It is the `RED_TEST_COMMAND` of Phase 2 and the `GREEN_TEST_COMMAND` of
  Phase 3.
- `PATH_CHECK`, `LEADERBOARD_SHA`, `SIDE_SHA`, `FR3_CHECK`, `BASE_HASH`,
  `PI_SHA`, `PI_CHECK`, and `STATUS_CHECK`: the exact commands of the plan.
- `METHOD_CHECK` (run after task 3.3; spec FR-6, AC-6). It reads the
  section `id="domain-trust"` of `docs/methodology.html` as static HTML.
  The section must not hold a nested `<section>`. The command checks the
  three kinds, `N_MIN`, the words "not graded", and an ordered list of the
  four verdicts in precedence order. It checks one table row for each
  probe of `preview.json`, with the id, the domain, and the kind as cells.
  It also checks that one paragraph of `README.md` names "domain trust".

  ```bash
  python3 - docs/methodology.html README.md measure/tracks/domain_trust/preview.json <<'PY'
  import html, json, re, sys
  page, readme, preview = (open(p).read() for p in sys.argv[1:4])
  m = re.search(r'<section\b[^>]*\bid="domain-trust"[^>]*>(.*?)</section>', page, re.S)
  assert m, 'METHOD_CHECK=fail no section id="domain-trust"'
  sec = m.group(1)
  def text(s): return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()
  words = text(sec)
  for w in ("spec", "robustness", "performance"):
      assert re.search(rf"\b{w}\b", words, re.I), f"METHOD_CHECK=fail kind {w}"
  assert re.search(r"\bN_MIN\b|\bn_min\b", words), "METHOD_CHECK=fail N_MIN"
  assert "not graded" in words.lower(), "METHOD_CHECK=fail missing-key rule"
  order = [("risk",), ("unproven",), ("unoptimized", "not optimized"), ("safe",)]
  lists = [[text(x).lower() for x in re.findall(r"<li\b[^>]*>(.*?)</li>", ol, re.S)] for ol in re.findall(r"<ol\b[^>]*>(.*?)</ol>", sec, re.S)]
  assert any(len(li) == 4 and all(any(w in t for w in ws) for t, ws in zip(li, order)) for li in lists), "METHOD_CHECK=fail verdict rule"
  rows = [[text(c) for c in re.findall(r"<t[dh]\b[^>]*>(.*?)</t[dh]>", r, re.S)] for r in re.findall(r"<tr\b[^>]*>(.*?)</tr>", sec, re.S)]
  probes = json.loads(preview)["probe_map"]
  for pid, p in probes.items():
      hit = [r for r in rows if pid in r and p["kind"] in [c.lower() for c in r] and any(re.fullmatch(p["domain"] + r"\b.*", c) for c in r)]
      assert len(hit) == 1, f"METHOD_CHECK=fail probe row {pid}"
  assert any("domain trust" in x.lower() for x in re.split(r"\n\s*\n", readme)), "METHOD_CHECK=fail README paragraph"
  print(f"METHOD_CHECK=pass probes={len(probes)} verdicts=4 kinds=3")
  PY
  ```

- `FR3_GUARD`: `FR3_CHECK` passes on an empty history, so this guard runs
  first. It exits non-zero when no revision 1 history entry exists.
  `jq -e '[.history.models[] | (.no_skills, .skills) | select(. != null) | select((.fixture_revision // 1) < 2)] | length > 0' docs/assets/data/benchmark.json`
- `PREVIEW_CHECK` (run after `python3 harness/export-site-data.py`). It
  exits non-zero on any difference, and it prints
  `PREVIEW_CHECK=pass models=14 cells=112` on a match.

  ```bash
  python3 - docs/assets/data/benchmark.json measure/tracks/domain_trust/preview.json <<'PY'
  import json, sys
  out = json.load(open(sys.argv[1])).get("domain_trust")
  pre = json.load(open(sys.argv[2]))
  assert out is not None, "PREVIEW_CHECK=fail no domain_trust block"
  assert len(pre["models"]) == 14, "PREVIEW_CHECK=fail preview is not 14 models"
  n = out["rule"]["n_min"]
  assert n == pre["n_min"] == 2, f"PREVIEW_CHECK=fail n_min={n}"
  ids = [m["id"] for m in out["models"]]
  assert ids == sorted(ids), "PREVIEW_CHECK=fail rows not sorted by id"
  assert ids == sorted(pre["models"]), f"PREVIEW_CHECK=fail models {ids}"
  for pid, p in pre["probe_map"].items():
      hit = [c for c in out["checks"][p["domain"]] if c["id"] == pid]
      assert len(hit) == 1 and hit[0]["kind"] == p["kind"], f"PREVIEW_CHECK=fail probe {pid}"
  bad, cells = [], 0
  for m in out["models"]:
      p = pre["models"][m["id"]]
      if sorted(m["runs"]["run_ids"]) != sorted(p["runs"]) or m["runs"]["total"] != len(p["runs"]):
          bad.append(f"{m['id']}:runs")
      for d in "ABCDEFGH":
          g, e = m["cells"][d], p["cells"][d]
          cells += 1
          fail = {f["id"]: f"{f['failed']}/{f['graded']}" for f in g["failures"]}
          gaps = sorted(x["id"] for x in g["gaps"])
          if g["verdict"] != e["verdict"]: bad.append(f"{m['id']}:{d}:verdict")
          if fail != e["failures"]: bad.append(f"{m['id']}:{d}:failures")
          if gaps != sorted(e["gaps"]) or any(x["graded"] >= n for x in g["gaps"]): bad.append(f"{m['id']}:{d}:gaps")
  assert cells == 112, f"PREVIEW_CHECK=fail cells={cells}"
  assert not bad, "PREVIEW_CHECK=fail " + ",".join(bad)
  print(f"PREVIEW_CHECK=pass models={len(ids)} cells={cells}")
  PY
  ```

- `SITE_SERVE` (run in the worktree after the export, in the background):
  `python3 -m http.server 8765 --bind 127.0.0.1 --directory docs`. Set
  `PROJECT_DEV_URL=http://127.0.0.1:8765/results.html`. The page loads its
  data with `fetch`, so a `file://` URL does not work.
- Work-list comparison (run in `main`):
  `cd harness && npx tsx plan-work.ts --all`. Compare only the class of each
  track, arm, and model.

The strategy role ran these checks on 2026-10-25 in `main` at `2d45b17`.
All runs were read-only.

- `PREVIEW_CHECK` on a block built from `preview.json` printed
  `PREVIEW_CHECK=pass models=14 cells=112` (exit 0).
- `PREVIEW_CHECK` exited 1 on four bad blocks: one changed verdict, one
  changed failure count, one dropped run id, and one dropped probe.
- `PREVIEW_CHECK` on the current export exited 1 with
  `no domain_trust block`.
- `FR3_GUARD` printed `true` on the current export, and exited 1 on an
  empty history.
- `FR3_CHECK` printed `false` (exit 1) on the current export. This is the
  defect of spec EV2, so Green must make it print `true`.
- `LEADERBOARD_SHA` printed
  `0a05930b528abc1eaebd5a7b3e889aa1935ad2c379cb0caf3d318d4c5bff128d`, and
  `SIDE_SHA` printed
  `340951b530d9058a2cfe481c89b03da810b8826aece70833985e4559abfc6200`.
  These values are for information only. Task 1.3 records the values of the
  worktree export at the base.

The remediation of audit `4bc286a` ran these checks on 2026-10-25 in
`main`. The bad inputs were copies in a temporary directory.

- `PI_SHA` printed `PI_RUNS=95` and
  `PI_SHA=c41f6bae1aacc126e1a0c7f0a73be2758c82eeea97b20485fa0c695a88eab38b`.
  This is the value that `rigor_a_h` recorded. On a tree with no Pi record,
  it exited 1 and wrote no file.
- `PI_CHECK` printed `PI_CHECK=pass` on two equal files. It exited 1 after
  a change of one `score.json`, after the addition of one Pi record, and on
  a missing file.
- `METHOD_CHECK` printed `METHOD_CHECK=pass probes=15 verdicts=4 kinds=3`
  on a synthetic good page. It exited 1 on the current page and on four bad
  inputs. The bad inputs had a wrong probe domain, a wrong verdict order,
  no "not graded", and no README paragraph.
- `STATUS_CHECK` printed `STATUS_CHECK=pass blocked=12 open=1` on the plan.
  It exited 1 on the plan of `4bc286a`, which has no `[~]` task.

`PREVIEW_CHECK` requires `n_min` 2. Thus it runs at task 3.2 only. After
task 4.2 sets the O1 answer, the plan checks `rule.n_min` instead.

## 3. Test layers and owners

| Layer | File | Writer | What it proves |
|---|---|---|---|
| Module test | `harness/site-tests/domain-trust.test.ts`, block "probe map" | Red | FR-1 |
| Verdict test | the same file, block "verdict" | Red | FR-2 on synthetic records |
| Export test | the same file, block "export", on a temporary root | Red | FR-3 and FR-4 on synthetic runs |
| Real-record checks | `PREVIEW_CHECK`, `FR3_GUARD`, `FR3_CHECK`, `LEADERBOARD_SHA`, `SIDE_SHA`, `PI_SHA`, `PI_CHECK` | Green and orchestrator | AC-3, AC-4, and AC-7 on the stored records |
| Text check | `METHOD_CHECK` on `docs/methodology.html` and `README.md` | Green | FR-6 and AC-6 |
| Adversarial cases | the same test file, block "adversarial" | Adversarial role | The matrix cannot lie (section 9) |
| Browser review | `docs/results.html` through `SITE_SERVE` | UX role | FR-5 and NFR-6 |

The test file sits outside `harness/tests/`, so it changes no suite hash
(spec EV8). Vitest collects it with the existing `harness/vitest.config.ts`.
The file runs no server, no browser, and no grade.

## 4. Module interface

Red writes the tests against these names. A Red failure names one of them,
or one missing field of the export block (plan task 2.1).

- `PROBE_MAP`: a dict from each probe id to `{"domain": <A-H>, "kind": <kind>}`.
- `KINDS`: the tuple `("spec", "robustness", "performance")`.
- `VERDICTS`: the tuple `("risk", "unproven", "unoptimized", "safe")`, in
  precedence order.
- `domain_cells(checks, records, n_min)`: the pure function of FR-2.
  - `checks` maps each domain to a list of `{id, kind, since, text}`.
  - `records` is a list of `{revision, results}`.
  - It returns a dict from each domain A–H to a cell:
    `{verdict, min_coverage, failures, gaps}`.
  - Each failure is `{id, kind, text, failed, graded}`. Each gap is
    `{id, graded}`.

The test calls Python with `spawnSync`, as
`harness/tests/meta/bench-incremental.test.ts` does. For a function call, it
runs `python3 -c` with `harness/` on `sys.path`. It sends the arguments as
JSON on stdin, and it reads JSON from stdout with sorted keys. The test
imports `PROBES` and `CRITERIA` from `../tests/criteria` directly.

## 5. Synthetic cases

### 5.1 Probe map (FR-1, task 2.1)

1. The keys of `PROBE_MAP` equal the keys of `PROBES`. A probe with no
   entry fails the test. An entry with an id outside `PROBES` fails it.
2. Each domain is one of A–H. Each kind is `robustness` or `performance`.
3. `PROBE_MAP` equals `probe_map` of `preview.json`. The spec table and the
   preview hold the same 15 entries, so the golden file fixes the map.
4. Each domain A–H has at least one check in the real check list.
5. The size of each real check list equals the count of `CRITERIA` ids
   with the domain prefix, plus the `PROBE_MAP` entries of the domain. The
   test derives the size from the registry, so a new criterion needs no
   test edit. On the base registry, the sizes are A 5, B 6, C 12, D 8,
   E 12, F 12, G 18, and H 2.
6. No list holds an id that starts with `ADV.`, `M.`, or `X.`. The prefix
   test is the domain letter and a dot, so `ADV.useActionState` never joins
   domain A.

### 5.2 Verdicts (FR-2, task 2.1)

Each case uses `N_MIN` 2 unless the case states another value. Each case
gives the full expected cell, not only the verdict.

1. **Safe.** Two checks of kind `spec`, two records, all `true`. The cell is
   `safe`, `min_coverage` 2, with no failures and no gaps.
2. **Risk from spec.** One `spec` check fails in 1 of 3 records. The cell is
   `risk`, with the failure `failed 1, graded 3`.
3. **Risk from robustness.** One `robustness` probe fails in 1 of 2 records.
   The cell is `risk`.
4. **Unoptimized.** Only a `performance` check fails, and each check has a
   coverage of 2. The cell is `unoptimized`.
5. **Risk before unproven.** A `spec` failure, and another check with a
   coverage of 1. The cell is `risk`, and its gap list is empty. Preview
   cell hy3 F has this shape.
6. **Unproven before unoptimized.** A `performance` failure, and a check
   with a coverage of 1. The cell is `unproven`. It lists the failure and
   each check below `N_MIN`. Preview cell hy3 C has this shape.
7. **The `since` rule.** A check with `since` 2. Two revision 1 records hold
   it as `false`. Two revision 2 records hold it as `true`. The cell is
   `safe`, and the coverage of the check is 2.
8. **The `since` rule for probes.** A probe counts in a revision 1 record.
   A probe failure in a revision 1 record gives `risk`.
9. **Missing key.** One of two records has no key for a check. The cell is
   `unproven`, with no failure. Its gap is `{id, graded: 1}`.
10. **Not a boolean.** A value of `null` or a string is not graded. It is
    not a failure.
11. **Higher `N_MIN`.** `N_MIN` 3 with two clean records. The cell is
    `unproven`, with `min_coverage` 2. Preview note: the frontier rows read
    `unproven` in all 8 domains at 3.
12. **Empty input.** No records. Every cell is `unproven`, with
    `min_coverage` 0. No cell is `safe`.
13. **Failure order.** Failures sort by `failed`, highest first, then by id.
14. **Determinism.** The same records in a shuffled order give the same
    output (NFR-4).

### 5.3 Export (FR-3 and FR-4, task 2.1)

The test builds a temporary root, as the export test of
`bench-incremental.test.ts` does. It copies these files:

- `harness/export-site-data.py` and `harness/domain_trust.py`;
- `harness/tests/criteria.ts` and `harness/tests/spec-matrix.ts`;
- `harness/tests/meta/spec-matrix-contract.ts`, for `UNMAPPED_CRITERIA`.

It writes a `harness/go-pricing.json` with two batch models, and runs with
`score.json`, `results.json`, and `provenance.json`. A Pi run has an
`executor.pi` object. An OpenCode run has `executor.kind` `opencode`.
Required cases:

1. **`since` in `domains`.** A revision 1 Pi record holds `E.labels` and
   `E.error-announced` as `false`. Its history entry does not list them in
   `domains.E.failed`. A revision 2 record with `E.labels` `false` lists it.
2. **Counted records.** A run with `valid: false` does not count. A run with
   no `results.json` does not count. A model outside the catalog gets no
   row. A run id with a sibling slug does not count.
3. **Pooling.** One model with an OpenCode run in arm a and a Pi run in arm
   b. The row shows `total` 2, `opencode` 1, `pi` 1, `arm_a` 1, `arm_b` 1,
   and the sorted `run_ids`.
4. **Order.** The model with the lower score and the lower id comes first.
   The rows sort by id, never by score.
5. **Block shape.** `schema` 1, `rule.n_min` 2, the four verdicts in
   precedence order, and one sentence for each kind.
6. **Text sources.** A criterion text comes from its `SPEC_MATRIX` row
   (`A.returned`: "returned status"). A split criterion text comes from
   `UNMAPPED_CRITERIA` (`F.auth-return`). A probe text comes from `catches`
   (`P.no-key-leak`). No text is empty.
7. **Other keys.** The top-level keys of `benchmark.json` are the keys of
   the base export plus `domain_trust`. The test holds the base key list as
   a constant. On the real records, `LEADERBOARD_SHA` and `SIDE_SHA` prove
   that the values outside `domain_trust` and `domains` stay equal.
8. **Determinism.** Two exports of the same root give the same
   `domain_trust` block.

## 6. The preview data

`preview.json` is the golden result of the verdict rule on the stored
records. The strategy role of `rigor_a_h` built it on 2026-10-25. It holds
the probe map, and one row for each of 14 catalog models.

- **Source.** The run filter of the export: a run directory that matches
  `find_arm_runs` for a model of `harness/go-pricing.json` with `high_usage`
  and `batch`. The run has `valid === true` in `score.json` and a
  `results.json`. Both arms and both executors count.
- **Size.** 34 runs, 112 cells: 49 `safe`, 14 `unoptimized`, 32 `risk`, and
  17 `unproven`.
- **Form.** A failure is `"<failed>/<graded>"` under its id. A gap is an id
  only.
- **How a verdict is checked.** `PREVIEW_CHECK` compares each cell of the
  export with the preview cell. It compares the verdict, each failure count
  and coverage, the set of gaps, and the run list of each model. It also
  checks that each gap has a coverage below `n_min`.
- **When the records change.** A new run of a catalog model changes the
  matrix. Then `PREVIEW_CHECK` fails for a correct reason. Green does not
  edit `preview.json` to pass. Green reports the new run ids to the
  orchestrator, and the orchestrator decides on a preview update.

## 7. Probe map review (Review A, task 3.5)

Review A checks each row of the spec probe map against the test that grades
the probe. For each probe, it records the test file, the surface, and the
domain whose checkbox text names that surface.

1. A probe that touches two domains goes to the domain of the action that it
   grades. Review A writes the second domain as a finding, not as a change.
2. A `performance` probe grades wasted work only. A probe that can show a
   wrong result to a user is `robustness`.
3. `P.dedup-item` (spec R2, R6): Review A reads two candidate trees. One
   tree passes the probe (`a-glm-5-3-flash-2026w37`). One frontier tree
   fails it. Review A confirms the second calls `getItem` two times in one
   request, and that the reference wraps it in React `cache`.
4. Review A confirms that the verdict function applies the spec rule in its
   precedence order. It also confirms that the text of each check comes from
   the registry.

## 8. Browser review (UX role, task 3.7)

The UX role runs `SITE_SERVE` in the worktree after the export, and opens
`PROJECT_DEV_URL`. It uses widths of 1280 px and 390 px.

1. The section "Domain trust" is below the score table.
2. The table has 14 rows and 8 domain columns, in the order A–H.
3. Each cell shows its verdict as a word. `unoptimized` shows as "Safe, not
   optimized". The accessibility snapshot holds each word.
4. Five sampled cells equal the preview:
   - claude-haiku-5-5 D is "Safe, not optimized".
   - hy3 F is `risk`.
   - mimo-v2.6-flash B is `risk`.
   - gpt-5.6-luna B is `unproven`.
   - longcat-2.0 G is `risk`, and its list shows `G.401` failed 3 of 3.
5. Each row shows the run count for each executor.
6. The failure-mode list names each cell that is not `safe`. The preview
   has 63 such cells.
7. The rule paragraph links to `methodology.html`. It says that `safe` means
   "no failure in the checks that ran".
8. The score table shows the same rows, order, and totals as the base
   export.
9. At 390 px, the page has no horizontal overflow. The matrix scrolls in its
   own box.
10. The console shows no error.

The role saves one screenshot for each width and for the failure-mode list.
It writes `measure/runs/domain_trust/ux-browser-review-<short head>.json`
with the UX fields of the audit contract.

## 9. Adversarial cases (task 3.6)

The adversarial role adds cases to the test file. Each case tries to make
the matrix lie. A case that passes against wrong output sends the code back
to Green.

1. `safe` with no records, or with one record at `N_MIN` 2.
2. An unstated `since` 2 check counts as a failure in a revision 1 record.
3. A `false` value in a key that no check list holds changes a cell.
4. An `ADV.` key changes domain A.
5. Rows sort by score, or by run count.
6. A probe drops from `PROBES`, and the map still passes.
7. A record with `valid: false` adds a failure.
8. A failure text holds HTML, for example `<img src=x onerror=alert(1)>`.
   The page shows it as text. This case runs in the browser review.

The role writes `measure/runs/domain_trust/adversarial-<short head>.json`.

## 10. Review assignments

| Role | Applies | Focus |
|---|---|---|
| Review A (correctness) | yes | Section 7, the verdict rule, the text sources, and the `since` rule in `load_entry` |
| Review B (security) | no | The track reads repository files and stored JSON only. It runs no model code, adds no route, and adds no input. Adversarial case 8 covers the HTML escape. |
| Review C (API and user flow) | no | The track changes no product route. Section 5.3 fixes the export contract. |
| UX browser review | yes | Section 8 |
| Adversarial testing | yes | Section 9 |

## 11. Anti-pattern checks

- **A3.** Gates parse labeled lines, for example `PREVIEW_CHECK=pass`, never
  a bare number.
- **A4.** No check passes on an empty input. `PREVIEW_CHECK` stops on an
  absent block, a preview that is not 14 models, or a count that is not 112
  cells. `FR3_GUARD` stops on an empty history. Case 5.2.12 forbids `safe`
  on zero records. `PATH_CHECK` passes on an empty diff. Thus the plan
  pairs it with `TRUST_TEST` and `PREVIEW_CHECK`. `PI_SHA` stops on an
  empty Pi list, and `PI_CHECK` needs a `PI_RUNS` value above 0.
- **A5.** The plan claims a result only with the quoted labeled line and its
  command.
- **A11.** `TRUST_TEST` passes under `BENCH_TRACK=change`, because it reads
  no environment value.
- **A12.** `measure_interphase_checks.py status` reads only `[ ]`, `[~]`,
  and `[x]` tasks. It also skips a task whose first line holds the word
  `deferred`. A plan with only `[x]` and `[b]` tasks thus shows as a
  closeout candidate. The checker is a shared skill install, and this
  project does not edit it. Thus the plan keeps exactly one `[~]` task while
  a `[b]` task remains (plan section "Marker use"). The orchestrator runs
  `STATUS_CHECK` after each marker change.
- **A13.** `PATH_CHECK` reads Git paths only, and `.gitignore` ignores
  `runs/`. `PI_SHA` and `PI_CHECK` prove that each legacy Pi record keeps
  every byte (spec FR-7).

## 12. Evidence to record

For each task, the plan records the command, the labeled output line, and
the report path. Task 1.3 records the five base values, with the
`PI_RUNS` and `PI_SHA` lines. Task 2.2 records the Red summary line. Task
3.2 records `FR3_GUARD`, `FR3_CHECK`, `PREVIEW_CHECK`, `LEADERBOARD_SHA`,
and `SIDE_SHA`. Task 3.3 records the `METHOD_CHECK` line. Tasks 3.4 and
4.2 record the `PI_CHECK` line. Task 4.1 records O1 and O2 with their
dates.
