# Weekly update fix: approval path, page refresh, leak check, and executable bit

Spec format: classic FR list. Track type: bug. Base commit: `0b75b9c`.
Author model: `opencode-go/muse-spark-1.3-contributor#high` (Muse). Date: 2026-11-22.
Due: Mon 2026-11-23, before the next weekly export (expected about 2026-11-24).

## Summary

The model_guide closeout moved `measure/tracks/model_guide/publish-approval.md` to
`measure/archive/model_guide/publish-approval.md`. The weekly update still reads the old
path. It also leaves the public pages stale, skips the leak check, and ships a script
without the executable bit. This track fixes those four defects. It then runs the first
weekly update when the PM sends the export. It also carries the deferred pilot gate.

## Owner requirement

PM 2026-11-22 scopes this track to five items, due Mon 2026-11-23:

1. Fix the approval path that the closeout moved.
2. Rebuild the affected pages in the weekly update (Review A 5 F2).
3. Run the leak check in the weekly update (Review B 5 F1).
4. Set the executable bit and fix the README wording (Review C 5 F1).
5. Move model_guide rows 4.11 and 5.4 into this track.

## Evidence

The author measured each item on 2026-11-22 at HEAD `0b75b9c`.

- **EV1. The moved approval path.** `harness/model-guide/update.sh:51` sets
  `APPROVAL="$ROOT/measure/tracks/model_guide/publish-approval.md"`, and line 125
  takes the preview-only branch when that file is missing. `harness/model-guide/publish.ts:62`
  reads the same path. The header comments (`update.sh:17`, `publish.ts:6`) name the same
  path. That path no longer exists: the closeout moved the record to
  `measure/archive/model_guide/publish-approval.md`, which holds the six approved rows
  (index.html, review.html, real-work.html, and three data files). Effect today: `update.sh`
  takes the preview-only branch silently, and `publish.ts` refuses with
  `publish: no approval record`.
- **EV2. The stale pages (Review A 5 F2).** `update.sh:132-143` copies and commits only
  `docs/assets/data/real-work.json` and `docs/assets/data/model-guide.json`.
  `docs/index.html:44-49` and `docs/real-work.html` hold static results and load no JSON,
  so a weekly update leaves the pages stale. `README.md:287` sends the operator to
  `update.sh`. Finding F2 of `measure/runs/model_guide/review-a-5-a8835be.json` records
  this gap as nonblocking with score-impact no.
- **EV3. The missing leak check (Review B 5 F1).** `update.sh:82-143` runs only the
  real-work input check and `guide.ts` before it copies the two data files into
  `docs/assets/data/` and commits them. It never calls `leak-check.ts`. Finding F1 of
  `measure/runs/model_guide/review-b-5-a8835be.json` records this gap as nonblocking
  with score-impact no.
- **EV4. The missing executable bit (Review C 5 F1).** `git ls-tree` reports mode
  `100644` for `harness/model-guide/update.sh`, and `stat` reports mode 664 with no
  execute bit. `README.md:287` names `harness/model-guide/update.sh` as a command with
  no `bash` prefix. The same README line promises preview copies after the approval,
  but `update.sh:125-129` writes preview copies only before the approval (Review A 5 F3).
  Finding F1 of `measure/runs/model_guide/review-c-5-a8835be.json` records the bit gap
  as nonblocking with score-impact no.
- **EV5. The moved rows.** `measure/archive/model_guide/plan.md:2551` holds row 4.11
  as `[b] deferred (PM 2026-11-22)`, and `plan.md:2840` holds row 5.4 as
  `[b] deferred: moved to the weekly update job (PM 2026-11-22)`. The full text of both
  rows is copied into the plan of this track.

## Definitions

- **Stable record.** `harness/model-guide/publish-approval.md`: a copy of the archived
  approval record with the same six rows. It lives with the tools that read it.
- **Docs update request.** An explicit operator request for the docs write: `update.sh`
  run with the `--docs` flag. Without the flag the script keeps the preview-only branch.
- **Affected pages.** The public pages that show the refreshed data: `docs/index.html`
  (the overview table) and `docs/real-work.html`. `docs/review.html` joins them only
  when the score file changed.
- **Leak hit.** A `leak-check.ts` finding of key shape, key field, private path, or
  seeded line in a file the update is about to commit.

## Design decisions

1. **D1. The spec chooses the stable path.** `update.sh` and `publish.ts` read
   `harness/model-guide/publish-approval.md`, not the archive path. The archive path
   moves with closeout conventions, and that move caused this defect. The stable path
   sits next to the tools that read it, so a future archival cannot move it again.
   The six rows stay byte-identical to the archived record.
2. **D2. A missing record is a named refusal.** Before the approval, the preview-only
   branch is correct behavior for a plain run. But when the operator asks for a docs
   update (`update.sh --docs`) and the stable record is missing, the script refuses
   with `update: no approval record` on stdout, exit 2, and no write and no commit.
   A silent preview-only run would mislead the operator into shipping nothing.
3. **D3. The pages rebuild through the existing tools.** After the approval, `update.sh`
   rebuilds the affected pages through `preview.sh` and `guide.ts`, the same path the
   first publish used. The commit then holds the two data files plus those pages, with
   explicit paths only.
4. **D4. The leak check runs over the commit set.** `update.sh` runs `leak-check.ts`
   over the files it is about to commit, after the copy and before `git add`. On a leak
   hit it refuses with one line, exit 2, and no commit: `update: leak <path>`.
5. **D5. The bit is set in Green.** The Green role runs
   `git update-index --chmod=+x -- harness/model-guide/update.sh`. The README states
   the two branches separately: preview copies before the approval, docs data plus the
   rebuilt pages after it.

## Functional requirements

- **FR-1. Stable approval path.** `update.sh` and `publish.ts` (with their header
  comments) read `harness/model-guide/publish-approval.md`. That file holds the same
  six rows as the archived record. The old `measure/tracks/model_guide/` path appears
  nowhere in either tool.
  - Verify: `rg -n "measure/tracks/model_guide/publish-approval" harness/model-guide/`
    prints no line.
- **FR-2. Named refusal on a missing record.** `update.sh --docs` with no stable record
  prints `update: no approval record` on stdout, exits 2, and writes no file and makes
  no commit. A plain run without `--docs` keeps the preview-only branch.
  - Verify: the update-approval test file exits 0 (plan task 1.1).
- **FR-3. Page refresh.** After the approval, `update.sh` rebuilds the affected pages
  through `preview.sh` and `guide.ts`. The commit holds the two data files plus those
  pages, staged by explicit path only. A rerun with unchanged data exits 0 and makes
  no commit.
  - Verify: the update-pages test file exits 0 (plan task 1.2).
- **FR-4. Leak check.** `update.sh` runs `leak-check.ts` over the files it is about to
  commit and refuses with one line, exit 2, and no commit on a leak hit.
  - Verify: the update-leak test file exits 0 (plan task 1.3).
- **FR-5. Executable bit and README wording.** `harness/model-guide/update.sh` has mode
  `100755` in the index. `README.md` names the command so that it runs as written, and
  it states the preview-only branch and the docs branch separately.
  - Verify: `git ls-files -s harness/model-guide/update.sh` shows `100755`, and the
    update-exec test file exits 0 (plan task 1.4).

## Owner questions

None. The PM set the scope and the choice of the stable path. Row 4.11 needs the PM
word for new nights before it runs; the plan marks it deferred.
