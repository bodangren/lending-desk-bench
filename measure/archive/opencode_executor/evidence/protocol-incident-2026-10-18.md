# Protocol incident record — 2026-10-18 (first Green session, turn 4)

Review B finding RB-2 asked for this record. The facts come from
the committed evidence and the git history. No secret value
appears here.

## 1. What happened

During turn 4 of the first Green session (the live1 and live2
runs, 2026-10-11:32 to 11:33 +08:00), the session wrote
credential material and unredacted container outputs outside the
private frame protocol of `test-strategy.md` section 4.1:

- An access-only credential copy (inert refresh placeholder,
  live access token) at the fixed path
  `/tmp/oe-p1-access-only.json`. `/tmp` is outside the private
  frame directory.
- Unredacted container outputs at fixed `/tmp` paths, named
  `/tmp/oe-p1-live1-stdout.json` and
  `/tmp/oe-p1-live1-redacted.json` in the record.
- Run logs under the fixed path `/run/user/1000/oe-p1/`
  (predictable, not `mktemp -d` private).

Source: `evidence/task-1.1-headless-run.txt` section "Files
referenced" (the deleted-path note) and
`evidence/task-1.8-token-usage.txt` (same note).

The session also wrote SHA-256 hash values of the host refresh
token into the evidence files and committed them in `52beaa3`
(8 added lines: 4 in the deleted `prompt-ledger.md`, 3 in
`task-1.1-headless-run.txt`, 1 in
`task-1.3-1.4-credential.txt`). Review B also named `cef5b13`;
the added-value count for `cef5b13` in the track directory is 0,
so this record names `52beaa3` only.

## 2. Containment (done)

- The `/tmp` and `/run/user/1000/oe-p1/` files were deleted by
  exact path (evidence-fix turn, recorded in the deleted-path
  notes).
- The hash values were removed from the evidence files in
  `9a638b6` (6 removed lines with 64-hex values; further
  context lines removed with them). The files now record
  `equal=true` comparisons only, never a value.
- SECRET_SCAN and the EXACT scan are clean from `9a638b6` on.
  This turn re-ran EXACT in one credential frame:
  `exact-scan values=6 hits=0`.

## 3. What stays unproven

- The creation mode (umask, file mode) of
  `/tmp/oe-p1-access-only.json`. The file is deleted and no
  record states its mode. A `/tmp` file with mode 0644 was
  readable by other local users.
- The scan order of that turn. No timestamped scan log survives,
  so the record cannot show whether an EXACT scan ran before or
  after those files existed on disk.
- Whether the fixed-path `/run/user/1000/oe-p1/` directory or its
  files were readable by other local users before deletion.

## 4. History exposure and the owner decision

The refresh-token hash values remain in the git history of the
public repository:

- Added in `52beaa3`.
- Removed from the tracked files in `9a638b6`.
- The deleted `prompt-ledger.md` carried its 4 lines until the
  file was deleted in `c15b603`.

The values are SHA-256 hashes of the refresh token, not the
token. The host access token is valid until 2026-11-17
07:29:12 +08:00.

Owner decision (2026-10-18, about 13:10 +08:00): the owner
accepts the exposure with no action. No history rewrite, no
credential rotation. The history is published unchanged by the
next cron push. The same decision covers the short-lived
access-only copy under `/tmp` of section 1.

## 5. Rule changes this track already made

The corrected spec and design now require: the credential copy
lives only inside a `mktemp -d` private frame; the frame is
removed by exact path; EXACT runs at the end of each credential
frame; the record stores keys and shapes only. See
`design.md` section 2 and `spec.md` FR-3.
