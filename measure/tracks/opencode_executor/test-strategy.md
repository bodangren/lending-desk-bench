# Test strategy — opencode_executor (track-wide, phases 1–4)

Revision: 2026-10-18, strategy role. Role base: `8e79027`. The worktree is
dirty with work of other tracks and an owner edit of `harness/go-pricing.json`.
Every gate runs against the working tree. Stage files by explicit path only.

Amendment 1: 2026-10-18, strategy role, role base `9f11dd4`, after the Phase 1
reviews A, B, and C. It changes the FR-7 usage source tests (sections 5.1 and
8), O3 (deny `subagent`), the ledger rule (4.2), the run-window check scope
(5.1), the task 4.3 usage proof (7), the audit scan variants (2), and the
live-run frame rule (7.1).

Amendment 2: 2026-10-18, strategy role, role base `418d0b9`. It adds the
runnable gate variants TRIPWIRE_R, P3R, and P4R (sections 2, 6, and 7). It
adds credential edge tests and an expiry warning test for task 2.3. It ties
row 2.7 to the Node discovery rule of `design.md`.

Amendment 3: 2026-10-18, strategy role, role base `ff607e6`, after Review B
RB-10. EXACT_AUDIT and SECRET_SCAN_HISTORY read the history without the
author and committer lines. EXACT_AUDIT exits 1 on a hit or on `values=0`.

## 1. Scope and risk summary

This track replaces the Pi executor with OpenCode 2 and the host Console
login. It also repairs the weekly self-check under cron. Risks, most
important first:

1. **Credential leak.** A Console token in a log, an evidence file, a run
   artifact, or an agent transcript goes to a third party. An agent
   transcript goes to the model provider of that agent.
2. **Quota overrun (NFR-4).** Before 2026-10-21 21:44 (+08:00), the track has
   a budget of two tiny prompts with a free Go model.
3. **Non-hermetic attestation (A11, FR-6).** An ambient variable changes
   attestation, freshness, or classification.
4. **Pi traffic or a broken cron on `main`.** Task 3.1 must land before
   task 3.8. The batch must fail closed (NFR-6).
5. **Mass staleness.** Edits to runner-hash files and to `harness/tests/**`
   make every existing run STALE-PROVENANCE (section 10).
6. **Deadline.** The go/no-go (task 4.6) is due 2026-10-24 18:00 (+08:00).
   The cron runs on Sun 2026-10-25 01:00 (+08:00).

## 2. Gate commands

The checker runs each command as one shell string from the repo root.

```
RED_TEST_COMMAND   = cd harness && npm run test:meta:logic
GREEN_TEST_COMMAND = cd harness && npm run test:meta:logic        # base value
ADV                = cd harness && BENCH_TRACK=change npm run test:meta:logic
```

**REHEARSAL (FR-9).** The cron toolchain is a sourceable file
`harness/toolchain.sh`. `cron-weekly.sh` sources it before `weekly.sh`. The
rehearsal runs the self-check line of `batch.sh` under that toolchain:

```
env -i HOME="$HOME" PATH=/snap/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin bash -c 'set -eu; cd /home/daniebo/Desktop/lending-desk-bench/harness; . ./toolchain.sh; . ./env.sh; env -u BENCH_TRACK npm run --silent test:meta:logic'
```

If `design.md` selects a different toolchain file, `design.md` must give the
replacement command. The orchestrator then amends this section in a committed
change before Red starts.

**TRIPWIRE (no real executor in tests).** A shim that records a hit and exits
97 sits first on `PATH`. A test that executes `opencode` or `pi` through the
ambient `PATH` creates `HIT`.

```
tw="$(mktemp -d)" && printf '#!/bin/sh\ntouch "$(dirname "$0")/HIT"; exit 97\n' > "$tw/opencode" && cp "$tw/opencode" "$tw/pi" && chmod +x "$tw/opencode" "$tw/pi"
```

**TRIPWIRE_R (runnable variant, amendment 2).** The original TRIPWIRE
contains `>`, `cp `, and `chmod `. The orchestrator and the audit roles deny
these texts. TRIPWIRE_R makes the same two shims with `node -e`,
`fs.writeFileSync`, and `fs.chmodSync`. The script uses `function` syntax and
contains no `>`.

```
tw="$(mktemp -d)" && node -e 'var fs=require("fs"),d=process.argv[1],s="#!/bin/sh\ntouch \"$(dirname \"$0\")/HIT\"; exit 97\n";["opencode","pi"].forEach(function(n){fs.writeFileSync(d+"/"+n,s);fs.chmodSync(d+"/"+n,0o755)})' "$tw"
```

The shim text is the same as in TRIPWIRE: it creates `HIT` beside itself and
exits 97. TRIPWIRE_R leaves its `mktemp -d` folder in place, because the audit
roles cannot delete it. The folder holds two small shims and no secret.

**SECRET_SCAN (pattern scan, no secret needed).** It prints file names only,
never the match. Zero output and exit 0 is a pass.

```
! grep -rlP --binary-files=text 'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/=-]{16,}|\b(?:sk|wrk|org)[-_][A-Za-z0-9]{12,}|"(?:access|refresh|token|accessToken|refreshToken|apiKey|secret)"\s*:\s*"[^"<]{8,}"|(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*[0-9])(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])' measure/tracks/opencode_executor measure/runs/opencode_executor
```

A false positive fails closed. Redact the value in the evidence. Never add an
exclusion to the pattern (A7).

**Audit scan variants (amendment 1, Review B RB-3).** The permission files of
the audit roles (Review A, B, C, `phase-acceptance`, `final-acceptance`) deny
every shell command that contains the character `>`. That includes `=>`,
`>=`, `2>&1`, and `> file`. They also deny `cp`, `mv`, `rm`, `tee`, `chmod`,
and `sed -i`. The section 4.1 frame, `REDACT`, and `EXACT` therefore cannot
run in an audit role. The tree SECRET_SCAN above contains no denied text, so
audit roles run it unchanged. The two variants below contain no `>` and no
denied command.

**SECRET_SCAN_HISTORY.** It scans the patch text of a commit range, also the
removed lines. The input form `git log -p --format=%B%n%N` gives the commit
messages, the git notes, and the diffs. It omits the author and committer
lines: these are public git metadata in every commit, not phase output
(amendment 3, Review B RB-10). Replace `RANGE` with the phase range, for
example `d27d414..HEAD`. It prints `history-scan-ok` on a pass. It never
prints a match.

```
R=RANGE; test "$(git rev-list --count "$R")" -ge 1 && test "$(git log -p --text --no-color --no-ext-diff --format=%B%n%N "$R" | grep -cP 'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/=-]{16,}|\b(?:sk|wrk|org)[-_][A-Za-z0-9]{12,}|"(?:access|refresh|token|accessToken|refreshToken|apiKey|secret)"\s*:\s*"[^"<]{8,}"|(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*[0-9])(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])')" = 0 && echo history-scan-ok
```

The first `test` fails on an empty or unknown range (A4). The second `test`
fails on one matching line. The pattern is the SECRET_SCAN pattern, unchanged.

**EXACT_AUDIT.** It pipes `opencode auth export opencode` straight into
`node -e`. No temporary file exists. The code uses `function` syntax and no
`>` comparison. It collects each string leaf of 16 characters or more from
the export, except `http` URLs. It scans the named folders, and it skips
symbolic links. After `--range`, it reads the patch text of each commit range
with `child_process.execFileSync('git', [...])`. The input form is
`git log -p --format=%B%n%N`, as in SECRET_SCAN_HISTORY: the commit messages,
the git notes, and the diffs, without the author and committer lines. The
scan keeps every export value and has no pattern exclusion (A7). It prints only
`exact-scan values=N hits=M`. Every failure prints only
`exact-scan failed stage=<args|export|tree|range>` and exits 3: no target, a
missing folder, an export that is not JSON, and an empty or unknown range.

```
EXACT_AUDIT='var g="args";try{var fs=require("fs"),path=require("path"),ch=require("child_process");var a=process.argv.slice(1),i=a.indexOf("--range"),roots=i===-1?a:a.slice(0,i),ranges=i===-1?[]:a.slice(i+1),s=new Set(),hits=0;if(roots.length+ranges.length===0)throw 0;g="export";(function w(v){if(typeof v==="string"){if(16<=v.length&&!/^https?:/.test(v))s.add(v)}else if(v&&typeof v==="object")Object.values(v).forEach(w)})(JSON.parse(fs.readFileSync(0,"utf8")));function has(t){for(var x of s)if(t.includes(x))return true;return false}function scan(f){var st=fs.lstatSync(f);if(st.isSymbolicLink())return;if(st.isDirectory())fs.readdirSync(f).forEach(function(n){scan(path.join(f,n))});else if(st.isFile()&&has(fs.readFileSync(f,"latin1")))hits++}g="tree";roots.forEach(function(r){fs.statSync(r);scan(r)});g="range";ranges.forEach(function(r){var t=ch.execFileSync("git",["log","-p","--text","--no-color","--no-ext-diff","--format=%B%n%N",r],{stdio:["ignore","pipe","ignore"],maxBuffer:1024*1024*1024}).toString("latin1");if(t.length===0)throw 0;if(has(t))hits++});console.log("exact-scan values="+s.size+" hits="+hits);process.exit(hits===0&&0<s.size?0:1)}catch(e){console.log("exact-scan failed stage="+g);process.exit(3)}'; opencode auth export opencode | node -e "$EXACT_AUDIT" -- FOLDER... --range RANGE...
```

Exit status (amendment 3): exit 0 only for `hits=0` with `values>=1`. Exit 1
for `hits` of 1 or more, or for `values=0`. Exit 3 for a stage failure. Any
exit other than 0 fails the audit. The `--` separator
is necessary: without it, `node` reads `--range` as its own option.

Test record (2026-10-18, strategy role, synthetic data only). A fake
`opencode` printed a planted export with 3 values of 16 characters or more,
one 10-character label, and one `https` URL. A synthetic repository planted a
value and a JWT-like string in one commit and removed them in the next.

| Case | Result |
|---|---|
| SECRET_SCAN_HISTORY, range with the planted and removed lines | exit 1 (fail) |
| SECRET_SCAN_HISTORY, clean non-empty range | `history-scan-ok`, exit 0 |
| SECRET_SCAN_HISTORY, empty range; unknown range | exit 1; exit 2 |
| EXACT_AUDIT, planted folder and planted range | `values=3 hits=2` |
| EXACT_AUDIT, clean folders and clean range | `values=3 hits=0` |
| EXACT_AUDIT, folder with a symbolic link to a planted file | `hits=0` (the link target alone gives `hits=1`) |
| EXACT_AUDIT, missing folder; empty range; unknown range; no target | `failed stage=tree`; `stage=range`; `stage=range`; `stage=args`, exit 3 |
| EXACT_AUDIT, export that is not JSON and holds a planted value | `failed stage=export`; the value is not printed |
| Both command lines, check against the denied text of the audit roles | no denied text |

Test record, amendment 3 (2026-10-18, strategy role, synthetic data only).
The fake export held 4 values of 16 characters or more. One value was an
account email. Every commit of the synthetic repository had that email as
the author email.

| Case | Result |
|---|---|
| EXACT_AUDIT before amendment 3, range with the author email only | `values=4 hits=1`, exit 0 (the RB-10 defect) |
| EXACT_AUDIT, range with the author email only | `values=4 hits=0`, exit 0 |
| EXACT_AUDIT, value planted in a commit message | `hits=1`, exit 1 |
| EXACT_AUDIT, value planted in a diff | `hits=1`, exit 1 |
| EXACT_AUDIT, value planted in a git note | `hits=1`, exit 1 |
| EXACT_AUDIT, value planted in a folder | `hits=1`, exit 1 |
| EXACT_AUDIT, clean folder and a range with the author email only | `values=4 hits=0`, exit 0 |
| EXACT_AUDIT, export with no value of 16 characters or more | `values=0 hits=0`, exit 1 |
| EXACT_AUDIT, empty range; unknown range; missing folder; no target; export that is not JSON | exit 3 each; the planted value is not printed |
| SECRET_SCAN_HISTORY grep count, token-like author name only: before; after | 1; 0 |
| SECRET_SCAN_HISTORY grep count, JWT-like message plant; Bearer diff plant; clean commit | 1; 1; 0 |
| SECRET_SCAN_HISTORY on the real range `d27d414..ff607e6` (28 commits): before; after | 0 matching lines; 0 matching lines |
| Both amended command lines, check against the denied text of the audit roles | no denied text |

**Scan use per role.**

| Role | Tree SECRET_SCAN | SECRET_SCAN_HISTORY | Frame, `REDACT`, `EXACT` | EXACT_AUDIT |
|---|---|---|---|---|
| `measure-jr-green` (Phase 1, Phase 4) | yes | yes, before the gate | yes, only inside the section 4.1 frame | allowed |
| Review B | yes | yes, phase range | no | yes: the track, the runs folder, and the phase range; Phase 4 adds the run folders, `reports/`, and `docs/assets/data/` |
| Review A, Review C, `phase-acceptance`, `final-acceptance` | yes | yes, if the role audits the history | no | only on the orchestrator's request |
| Orchestrator | through the P1 composite | yes | no | no |

An audit role never runs `REDACT`. It reads the committed
`evidence/auth-export.shape.json`. The stderr of `opencode auth export
opencode` is not redirected in EXACT_AUDIT, because `2>` contains `>`.
Phase 1 recorded an empty export stderr.

**Final acceptance.** Each command exists in `harness/package.json` or is a
standard tool on this host.

```
PROJECT_LINT   = git ls-files -z 'harness/*.sh' | xargs -0 -r -n1 bash -n && python3 -c 'import ast,sys; [ast.parse(open(p).read(), p) for p in sys.argv[1:]]' harness/export-site-data.py harness/generate-model-pages.py
PROJECT_CHECKS = (cd harness && BENCH_TRACK=change npm run test:meta:logic) && <REHEARSAL>
PROJECT_TESTS  = cd harness && npm run test:meta:logic
```

The repo has no lint script, no `tsconfig.json`, and no `shellcheck`.
`PROJECT_LINT` is a syntax check only. It writes no file.

## 3. Roles and mechanical gates per phase

| Phase | Owner role | Mechanical gate | `GREEN_TEST_COMMAND` export |
|---|---|---|---|
| 1 Investigate and contract | `measure-jr-green` (investigation) | `jr-green` | P1 composite (section 4) |
| 2 Test | `measure-mid-red` | `mid-red` (`RED_TEST_COMMAND` must fail) | not used |
| 3 Implement (Green) | `measure-jr-green` | `jr-green` | P3R composite (section 6) |
| 4 Verify and document | `measure-jr-green` | `jr-green` | P4R composite (section 7) |

Phase 1 adds no failing test, so the `mid-red` gate cannot pass for it. The
`jr-green` gate fits: HEAD advances, each task is `[x]` with a SHA, and the
gate command passes. Red (Phase 2) and Green (Phase 3) use separate roles and
separate agents. After each `jr-green` or `mid-red` gate, Review A, B, and C
and `phase-acceptance` run per section 12. Each needs a passing audit JSON and
no incomplete phase task.

## 4. Phase 1: Investigate and contract

Risk: **critical.** The role handles the real Console credential and sends
live prompts. No harness file changes.

**Targeted Red command.** None. The phase adds no test. Task 1.2 records the
pre-fix reproduction as evidence R0:
`env -i HOME="$HOME" PATH=<crontab PATH> bash -c 'cd /home/daniebo/Desktop/lending-desk-bench/harness && npm run test:meta:logic'`.
R0 must show the labeled summary with 3 failed tests.

**Green gate (P1 composite).** The orchestrator exports `PHASE_BASE_SHA` and
this command:

```
test -z "$(git diff --name-only "$PHASE_BASE_SHA"..HEAD -- . ':(exclude)measure/tracks/opencode_executor/')" && <SECRET_SCAN> && (cd harness && npm run test:meta:logic)
```

The first part fails if a commit changes a path outside the track directory.
The last part proves that the suite stays green (170 of 170 under the nvm
`PATH`).

**Closeout gate.**

- Tasks 1.1–1.9 are `[x]` with a SHA.
- `design.md` gives each item that task 1.9 names. It records O1–O6 as fixed.
  It records O3 as deny `subagent` with the evidence (design section 7).
- `design.md` has a prompt ledger (section 4.2) with at most 2 live rows.
- The exact-value scan (below) reports `hits=0` and `values>=1`.
- Review B runs the tree SECRET_SCAN, SECRET_SCAN_HISTORY, and EXACT_AUDIT
  (section 2) over the track, the runs folder, and the range
  `d27d414..HEAD`. Each scan passes.
- Review B passes.

### 4.1 Credential evidence protocol (tasks 1.3, 1.4, 1.7)

Run each credential step inside one shell invocation with this frame:

```
set -euo pipefail; set +x; umask 077
d="$(mktemp -d "$XDG_RUNTIME_DIR/oe-p1.XXXXXX")"
trap 'rm -rf -- "$d"' EXIT INT TERM HUP
opencode auth export opencode > "$d/raw.json" 2> "$d/export.err"
node -e "$REDACT" < "$d/raw.json" > measure/tracks/opencode_executor/evidence/auth-export.shape.json
# ... import or probe steps; every output file goes to "$d" ...
node -e "$EXACT" "$d/raw.json" measure/tracks/opencode_executor measure/runs/opencode_executor
```

Rules:

1. The raw export goes only to `$d/raw.json`. It never goes to stdout, to a
   log, to the repo, or to the agent context. Never run `cat`, `head`,
   `jq .`, or an editor read on a file in `$d`.
2. The `REDACT` filter keeps keys, types, and lengths only. It keeps the
   number `expires`, the 4-character prefix of `orgID`, and short lowercase
   values of `type`, `method`, `integration`, `server`, and `provider`. It
   renames a key that is not a short identifier.

   ```
   REDACT='let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const keep=new Set(["type","method","integration","server","provider"]);const r=(v,k)=>v===null?null:Array.isArray(v)?v.map(x=>r(x,k)):typeof v==="object"?Object.fromEntries(Object.entries(v).map(([kk,x],i)=>[/^[A-Za-z][A-Za-z0-9]{0,23}$/.test(kk)?kk:"<key"+i+" len="+kk.length+">",r(x,kk)])):k==="expires"&&typeof v==="number"?v:k==="orgID"&&typeof v==="string"?{type:"string",length:v.length,prefix:v.slice(0,4)}:keep.has(k)&&typeof v==="string"&&/^[a-z][a-z0-9.:\/-]{0,40}$/.test(v)?v:{type:typeof v,length:String(v).length};process.stdout.write(JSON.stringify(r(JSON.parse(s),""),null,2)+"\n")})'
   ```

3. The `EXACT` scan collects each string leaf of 16 characters or more from
   the raw export, except `http` URLs. It searches the named trees for each
   value. It prints only counts and file names. This is the frame form for
   Green. Audit roles use EXACT_AUDIT (section 2).

   ```
   EXACT='const fs=require("fs"),p=require("path");const s=new Set();(function w(v){if(typeof v==="string"){if(v.length>=16&&!/^https?:/.test(v))s.add(v)}else if(v&&typeof v==="object")Object.values(v).forEach(w)})(JSON.parse(fs.readFileSync(process.argv[1],"utf8")));const hits=[];const scan=f=>{if(!fs.existsSync(f))return;const st=fs.statSync(f);if(st.isDirectory())fs.readdirSync(f).forEach(n=>scan(p.join(f,n)));else{const t=fs.readFileSync(f,"latin1");for(const x of s)if(t.includes(x)){hits.push(f);break}}};process.argv.slice(2).forEach(scan);console.log("exact-scan values="+s.size+" hits="+hits.length+(hits.length?" files="+hits.join(","):""))'
   ```

4. Show a stderr file only as `wc -c` until SECRET_SCAN reports no hit on it.
5. The isolated store for task 1.3 uses `HOME`, `XDG_CONFIG_HOME`,
   `XDG_DATA_HOME`, `XDG_STATE_HOME`, and `XDG_CACHE_HOME` under `$d`. Inspect
   it with `find "$d" -printf '%P %m %s\n'` only.
6. To prove "no other copy", list host paths changed after a marker file with
   `find <dir> -newer "$d/marker" -printf '%p\n'`. Read metadata only.
7. For task 1.4, compare the host refresh value before and after a step
   inside the frame. Print only `equal=true` or `equal=false`.
8. Build the access-only copy with `node` inside the frame, in `$d`.
9. A container probe (task 1.7) writes its stdout and stderr to `$d`. Copy
   them to `evidence/` only after SECRET_SCAN and EXACT report zero hits.

### 4.2 Prompt budget proof (NFR-4)

- `design.md` keeps a ledger. Every `opencode run` command is one ledger
  row, live or not. Columns: number, time (+08:00), model, network, live,
  prompt text, prompt bytes, exit code, evidence file.
- A run with `--network=none` is not live. Every other run is live.
- The budget applies to live rows: at most 2 live rows before 2026-10-21
  21:44 (+08:00).
- Falsification: the count of `opencode run` commands in the role log and the
  evidence must equal the ledger row count. Each row that is not live must
  show `--network=none` in its evidence. A live row count above 2 fails the
  phase.
- Each prompt is 200 bytes or less. The ledger cites the source that shows
  the model is free.
- Phase 1 result at `9f11dd4`: 6 rows, 2 of them live (rows 4 and 5). O3 is
  deny `subagent` (design section 7).

### 4.3 Anti-pattern coverage

| Anti-pattern | Defense | Falsification |
|---|---|---|
| A3 | R0 and the gate cite the labeled Vitest summary | A digit grep is not evidence |
| A4 | EXACT must report `values>=1` | `values=0` proves a vacuous scan; the gate fails |
| A4 | SECRET_SCAN_HISTORY and EXACT_AUDIT fail on an empty or unknown range, a missing folder, or no target | The section 2 test record shows each failure case |
| A5 | Each `design.md` fact cites a redacted evidence file | A fact with no evidence file fails Review A |
| A7 | SECRET_SCAN has no word exclusions | A new exclusion in the pattern fails Review B |
| A11 | R0 records the full environment of the cron reproduction | — |

## 5. Phase 2: Test (Red)

Risk: **high.** These tests are the only defense for the credential, the
arm contract, and the hermeticity. A weak test lets a defect reach the cron.

**Targeted Red commands.**

```
R1: cd harness && npm run test:meta:logic                     # must fail; new tests only
R2: cd harness && BENCH_META=1 npx vitest run tests/meta/<file>.test.ts --maxWorkers=1
R3: <ADV>                                                     # failing set must equal R1
R4: <REHEARSAL>                                               # must fail: toolchain.sh is absent
```

**Placement rule.** `test:meta:logic` excludes `runtime-isolation*.ts` and
`run-executor-provenance.test.ts`. Plan task 2.2 names these files. Put every
assertion that a gate relies on in a file that `test:meta:logic` includes
(for example `tests/meta/opencode-executor.test.ts`). Use a fake `podman`
shim, as in `run-executor-provenance.test.ts` line 93. The excluded files
drop their fake `pi` but are not gate evidence. The exclude list stays frozen.

**Green gate.** Not applicable. The new tests stay red until Phase 3.

**Closeout gate (Red evidence, task 2.8).**

- The `mid-red` gate passes: HEAD advances, one task is `[~]` or all are `[x]`,
  only `harness/tests/**` and `measure/**` change, and R1 fails.
- R1 records the start and end time, the exit code, and the labeled summary.
- Every R1 failure is a new test. Each failure message names the missing
  behavior, not a syntax or import error of the test itself.
- The failing test names of R3 equal those of R1 (A11).
- R1 with TRIPWIRE on `PATH` leaves no `HIT` file. Audit roles use
  TRIPWIRE_R (section 2). Use the `opencode` shim
  only. Pi still exists in Phase 2.
- No pre-existing assertion is weakened, deleted, or skipped.

### 5.1 Required tests and falsification conditions

Each test uses the fake `opencode` (section 8) and canary credentials.

| Task | Test | Falsification |
|---|---|---|
| 2.1 | Fake `opencode` writes its capture file | A test that finds no capture file fails (A4) |
| 2.2 | `run` argument list equals the `design.md` command line | An extra or missing flag fails; compare whole arrays |
| 2.2 | Mount set equals the FR-4 set for each arm | Set equality; an extra host mount fails |
| 2.2 | Container environment: private `HOME` and XDG paths; no `OPENCODE_API_KEY` | A host path or the key name fails |
| 2.2 | Arm A versus Arm B: only skill rules, skill mounts, and `AGENTS.md` differ | Any other difference in arguments or config fails |
| 2.2 | No Pi: the `pi` tripwire in the test `PATH` stays unhit | A `HIT` file fails |
| O1 | `--model opencode-go/<id>` has no `#`; `score.json` has `thinking_requested: "default"` | A `#variant` or another value fails |
| O2 | Config denies `websearch` and `question`; it has no deny for `webfetch` | Remove the `websearch` deny, or add a `webfetch` deny: the test fails |
| O3 | The generated config of each arm denies `subagent` (design section 7) | Remove the `subagent` deny, or add an allow for it: the test fails |
| 2.3 | Container stdin hash equals the hash of the expected access-only payload | A refresh field with a real value changes the hash |
| 2.3 | No canary token in argv capture, env capture, artifacts (the session export included), logs, provenance, or `score.json` | One canary hit fails |
| 2.3 | Staging under the test `XDG_RUNTIME_DIR` is empty after success, failure, and timeout | One remaining entry fails |
| 2.3 (NFR-1) | Staging is empty after an interruption: SIGINT and SIGTERM to the run process while the fake agent runs | One remaining entry fails. Non-vacuous: the fake `podman` writes a start marker, and the test sends the signal only after the marker exists and staging holds 1 or more entries |
| 2.3 (FR-3) | A missing, malformed, or non-finite `expires` stops the run before the agent. Cases: key absent, `null`, a string, a negative number, a fraction, and `1e999` (JSON parse gives `Infinity`) | One case with a fake `podman` call, a `run` argv, or exit 0 fails. Each case is a separate assertion |
| 2.3 (FR-3) | An ambiguous active Console connection stops the run before the agent: two active `opencode` connections in the export | A fake `podman` call or a container stdin payload fails |
| 2.3 (FR-3, NFR-1) | Other integrations never leave the host store: the export holds a second integration with its own canaries beside the Console connection | One canary of the other integration in the stdin capture, argv, env, artifacts, logs, or provenance fails. A stdin payload with an entry other than the selected Console connection fails |
| 2.3 (FR-3) | Weekly expiry warning, by the rule of the `design.md` section that defines the weekly 7-day expiry warning (now in "Selected FR-3 run-window option (fail closed)") | Test one `expires` value on each side of the 7-day boundary, each 1 hour or more from it. A missing warning on the near side, a warning on the far side, or a stop of a batch that the run window covers fails |
| 2.3 | Batch preflight: a short `expires` stops the batch before the first agent, with the FR-3 reason line | A fake `podman` call or a new run directory fails |
| 2.3 (design 2.2) | Per-run check: in a serial batch, a token that covers the first run window but not a later run stops that later run before its agent, with the same reason line | A fake `podman` call for the later run, a missing reason line, or a stop of the first run fails |
| 2.3 | A canary in `session.json` makes the run invalid and is redacted everywhere | A valid run or a remaining canary fails |
| 2.4 | Schema 7 fields; `credential` equals `{integration:"opencode",method:"oauth",refresh_token_delivered:false}`; no `orgID` | A missing field or the canary `orgID` fails |
| 2.4 | Fake upgrade at the recorded path keeps attestation and freshness | A changed verdict fails |
| 2.4 | A changed skill or config snapshot makes the run invalid | A valid verdict fails |
| 2.4 (FR-6) | `plan-work.ts --all` output is byte-identical, and freshness verdicts are equal, under each adversarial value (5.2) | One byte of difference fails |
| O5 | Arm B snapshot holds exactly the five IDs. A change to the source folder after the run keeps attestation | A live-folder hash flips the verdict and fails |
| 2.5 | The parser reads the session export fixture, plain and `.gz`, and returns hand-computed values: `output` equals `info.tokens.output` plus `info.tokens.reasoning`; `input`, `cacheRead`, and `cacheWrite` equal their `info.tokens` fields; `costUsd` equals `info.cost` (design section 4.4) | Each field has a non-zero value that differs from the other fields. The stream fixture lacks the final `step_finish`. A parser that reads the stream, drops reasoning, or swaps two fields returns another record and fails |
| 2.5 (design 4.3) | The entry script writes the export to the artifact path that design section 4.3 names | No file at that path fails |
| 2.5 (design 4.3) | The export call gets the session ID by the design section 4.3 rule, as one argument | The fake records the `session export` argv. Another ID or a split argument fails. A fake ID with a space and a `;` arrives as one argument |
| 2.5 (design 4.3) | A missing, empty, or unreadable export gives the run result that design section 4.3 names (run invalid, fail closed) | A valid run, or zero usage in a valid run, fails |
| 2.5 (design 4.3) | Timeout order: after a `timeout` kill of the fake `run`, the export step runs in the order that design section 4.3 gives | No `session export` call after the kill fails. An export call before `run` returns fails |
| 2.5 (RB-4) | The parser reads `info` only. Canaries in the export `messages` do not change the record. Row 2.3 finds and redacts them | A changed record or a remaining canary fails |
| 2.5 | Recost equals the formula computed in the test | A changed formula fails |
| 2.5 | Zero output tokens trip the existing gate | A valid run fails the test |
| 2.6 | Rescore and regrade print SKIP for a Pi run; `score.json` SHA-256 stays equal | A changed hash fails |
| 2.6 | `run.sh` refuses a Pi run directory; files stay unchanged | Exit 0 or a changed file fails |
| 2.6 | A Pi run with a higher score is not ranked; it shows in the labeled history block, also when STALE | A ranked Pi row or a missing history row fails |
| 2.6 | Site rows show the executor name and version | A missing field fails |
| O4 | Synthetic tree with Pi runs only: every batch model is `new` in each track and arm; the run count equals models × 2 × (3+1+1+1) | One `current` or `failing` row fails |
| 2.7 | Under `env -i` with the crontab `PATH`, `toolchain.sh` resolves `node` by the Node discovery rule of the `design.md` section "Cron toolchain and REHEARSAL (FR-9)", not to `/snap/bin/node` | Without the toolchain the test fails. The test builds a synthetic toolchain tree that the rule selects, with a fake `node`. A resolved path outside that tree fails. The result must not depend on the host Node version |
| 2.7 | `CRON START` logs the paths and versions of `node`, `npm`, and `opencode` | A missing item fails |
| 2.7 | Preflight fails closed for: no binary, version 1.x, no Console login, model not listed | Exit 0, a new run directory, a `run` argv, or a `pi` hit fails |
| 2.7 | `BENCH_DRY_RUN=1` runs the preflight and records no `run` argv | A `run` argv fails |

Meta tests resolve the path of the real `opencode` at most. They never
execute it.

The per-run check test (design 2.2) must not depend on a wall-clock race.
Use one of two methods. Method 1: the fake `auth export` returns a smaller
`expires` on a later call. Method 2: the test sets `expires` and the fake run
duration with a margin of 5 s or more on each side of the boundary. The batch
has 2 or more runs.

### 5.2 Adversarial environment matrix (FR-6, carried finding)

Run `plan-work.ts --all` and the freshness assessment once with a scrubbed
environment. Then run them once per value below. Spawn `node` and `tsx` by
absolute path, so `PATH` is free to change.

| Variable | Adversarial values |
|---|---|
| `BENCH_SKILL_ROOT` | missing path; a tree with changed skill content |
| `BENCH_AGENT_IMAGE` | another digest |
| `BENCH_EXECUTOR_RUNTIME_FLAGS` | `[]`; `["--privileged"]`; invalid JSON |
| `BENCH_EXECUTOR_CLI_FLAGS` | `[]`; `["--thinking","max"]`; invalid JSON |
| `BENCH_OPENCODE_BIN` | missing path; a fake with another version and SHA-256 |
| `BENCH_PI_ROOT` | missing path; a fake Pi tree |
| `HOME` | missing path; a home with `.agents/skills` |
| `PATH` | a directory with a fake `opencode` and a fake `pi` first |

Non-vacuous rule: the synthetic tree holds one `new`, one `failing`, and one
`current` row, and one Arm B run with recorded skills. A sensitivity check
corrupts one snapshot in the tree; the output must then change.

### 5.3 Anti-pattern coverage

| Anti-pattern | Defense |
|---|---|
| A3 | Red evidence parses `Test Files` and `Tests` labeled counts |
| A4 | Capture file must exist; the tree has each class; a planted canary proves that the leak check reads the files; the interruption test signals only after the start marker exists and staging holds an entry |
| A5 | Task 2.8 records the command output, not a claim |
| A7 | `package.json` exclude list frozen; the `mid-red` gate flags a `package.json` change |
| A11 | R3 failing set equals R1; matrix 5.2; tests use `envWithoutTrack()` or `applyEnv` |

## 6. Phase 3: Implement (Green)

Risk: **critical.** The phase writes the credential delivery, the container
contract, the attestation, and the cron toolchain. Each existing run goes
STALE.

**Targeted Red command.** R1 and R2 from Phase 2. Before the phase, only the
Phase 2 tests fail.

**Order.** Task 3.1 (Pi removal and fail-closed preflight) lands before task
3.8. Review A verifies the commit order with `git log --format=%h:%s`.

**Green gate (P3 composite).**

```
<TRIPWIRE> && (cd harness && PATH="$tw:$PATH" npm run test:meta:logic) && test ! -e "$tw/HIT" && (cd harness && BENCH_TRACK=change PATH="$tw:$PATH" npm run test:meta:logic) && test ! -e "$tw/HIT" && <REHEARSAL>
```

**P3R composite (runnable variant, amendment 2).** It is the P3 composite with
TRIPWIRE_R in place of TRIPWIRE. The full line contains no `>`, `cp `,
`chmod `, `rm `, `mv `, `tee `, or `sed -i`.

```
tw="$(mktemp -d)" && node -e 'var fs=require("fs"),d=process.argv[1],s="#!/bin/sh\ntouch \"$(dirname \"$0\")/HIT\"; exit 97\n";["opencode","pi"].forEach(function(n){fs.writeFileSync(d+"/"+n,s);fs.chmodSync(d+"/"+n,0o755)})' "$tw" && (cd harness && PATH="$tw:$PATH" npm run test:meta:logic) && test ! -e "$tw/HIT" && (cd harness && BENCH_TRACK=change PATH="$tw:$PATH" npm run test:meta:logic) && test ! -e "$tw/HIT" && env -i HOME="$HOME" PATH=/snap/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin bash -c 'set -eu; cd /home/daniebo/Desktop/lending-desk-bench/harness; . ./toolchain.sh; . ./env.sh; env -u BENCH_TRACK npm run --silent test:meta:logic'
```

**Gate variant per role.**

| Role | P3 and P4 gate form |
|---|---|
| Orchestrator (`GREEN_TEST_COMMAND` export for the `jr-green` gate) | P3R and P4R only |
| Review A, Review B, Review C, `phase-acceptance`, `final-acceptance` | P3R and P4R only |
| `measure-jr-green`, `measure-adversarial-testing` | P3R and P4R; the original P3 and P4 composites stay valid |

Test record (2026-10-18, strategy role, synthetic data only). TRIPWIRE_R made
`opencode` and `pi` with mode 755. Each shim exited 97 and created `HIT`.
In P3R, `harness` was replaced by a synthetic folder, and REHEARSAL by
`echo rehearsal-ok`:

| Synthetic suite | Result |
|---|---|
| Calls no executor | exit 0 |
| Calls `opencode` through `PATH`, and the suite fails | exit 1 |
| Calls `pi` through `PATH`, and the suite fails | exit 1 |
| Calls `opencode`, ignores its error, and reports a pass | exit 1 (the `HIT` check fails) |

The full P3R and P4R lines, with the real REHEARSAL, PROJECT_LINT, and
SECRET_SCAN text, pass `bash -n` and contain no denied text.

**Closeout gate (task 3.9).**

- The P3 composite passes twice in a row on this host.
- Record `cd harness && ./node_modules/.bin/tsx provenance.ts --shell`
  before and after the phase.
- `grep -rn 'BENCH_PI_ROOT\|withRecordedExecutorEnvironment\|emitPiModelsJson\|--models-json\|OPENCODE_API_KEY\|BENCH_PROVIDER_ENV' harness --include='*.sh' --include='*.ts' --include='*.cjs' --exclude-dir=node_modules --exclude-dir=tests`
  prints no line.
- `grep -n 'process.env' harness/executor-attestation.ts harness/provenance-check.ts`
  shows no variable from the FR-6 list. This artifact check pairs with
  matrix 5.2.
- The new execution files (entry script, credential helper, parser) are in
  the runner hash list.

**Fix surface.** The FR-1 to FR-10 files that the plan names, the new
`harness/opencode-entry.sh`, `harness/toolchain.sh`, and a credential helper.
Frozen: Phase 2 assertions, fixtures, and the `test:meta:logic` exclude list.
A change to a test reopens Phase 2.

### Anti-pattern coverage

| Anti-pattern | Defense |
|---|---|
| A3 | The handoff cites labeled summaries for each run |
| A4 | TRIPWIRE `HIT` check proves no silent use of the real executor |
| A5 | Plan task 3.9 cites the composite output with times |
| A7 | Exclude list frozen; no new SKIP for a failing test |
| A11 | ADV and REHEARSAL in the composite; matrix 5.2 green |

## 7. Phase 4: Verify and document

Risk: **high.** Live graded runs use the real credential. The phase changes
public documentation and site data.

**Targeted Red command.** None. A defect found in Phase 4 needs a new failing
test first. Then a Green fix follows. Then task 4.3 runs again if the hashes
changed.

**Green gate (P4 composite).** The P3 composite, then `<PROJECT_LINT>`, then
`<SECRET_SCAN>`. The runnable variant P4R is `<P3R> && <PROJECT_LINT> &&
<SECRET_SCAN>`. Section 6 gives the gate variant per role. The test record
of section 6 covers P4R.

**Closeout gate.**

- 4.1: the composite output, with times, is in the plan.
- 4.2: the probe output under `reports/` shows the FR-4 contract for each arm.
  The probe sends no prompt.
- 4.3: run only after `test "$(date +%s)" -ge 1792590240` passes
  (2026-10-21 21:44 +08:00). Exactly one run per arm. Record
  `provenance.ts --shell` before 4.3. It must equal the value at the end of
  Phase 4. Run EXACT over the two run directories, `reports/`, and
  `docs/assets/data/` with `hits=0` and `values>=1`. `opencode auth list` on
  the host still shows the Console login. Step 7 of section 4.1 shows that
  the refresh value changed only through a host refresh.
- 4.3 usage proof (Review A N12). For each run, record as labeled values
  (A3): each `info.tokens` field of the export, and the sum of the same
  field over the `step_finish` events of the stream. Record the counts of
  `step_start` and `step_finish` events. All three checks must pass:
  1. Non-zero: export `input` and export `output` are greater than 0.
  2. Final step: when the stream has fewer `step_finish` events than
     `step_start` events, export `output` is greater than the stream sum.
     When the counts are equal, each export field equals its stream sum.
  3. Cross-check: each export field is greater than or equal to its stream
     sum.
  A failed check makes the export source unproven. Then task 4.3 fails, and
  a new Phase 2 test comes first.
- 4.3 ledger: each `opencode run` command of task 4.3 is one ledger row in
  the 4.3 evidence. The count-equality check of section 4.2 applies.
- 4.4: the dry run prints labeled `BATCH START (dry run)` counts per track.
  With 19 batch models the total is 228 (O4). `sha256sum` of each legacy Pi
  `score.json` is equal before and after `WEEK=all ./rescore-doctor.sh`.
- 4.5: Review C checks the documentation against the code.
- 4.6: the orchestrator gets the owner decision before the `jr-green` gate.
  The plan records it.

**Prompt budget proof.** Tasks 4.1, 4.2, and 4.4 send no prompt. The fake
or the TRIPWIRE covers 4.1. Task 4.3 starts after the time check above.

### 7.1 Live-run frame rule (amendment 1, Review B RB-2)

Phase 1 had a protocol incident: a credential copy and raw container output
went to fixed paths outside the private frame. This rule applies to every
Phase 4 step that handles the credential or a live container output.

1. Run the step inside the section 4.1 frame: `mktemp -d` under
   `$XDG_RUNTIME_DIR`, `umask 077`, and the cleanup `trap`.
2. Keep container stdout and stderr, the raw export, and every credential
   copy in `$d`. This includes the access-only copy.
3. Never use a fixed path under `/tmp` or `/run/user/<uid>/` for these
   files.
4. Copy a file out of `$d` only after SECRET_SCAN and EXACT report zero hits
   on it. Record the scan line and its time before the copy.
5. Record only `equal=true` or `equal=false` for a refresh comparison. Never
   record a value or a hash of a value.

The FR-3 harness staging of the graded runs has its own tests (rows 2.3).
This rule covers the operator steps around the runs.

Review B checks the rule from the evidence. Falsification: one evidence path
for a credential copy or a raw output outside a `mktemp -d` frame fails.
One copy-out without an earlier zero-hit scan line fails. One recorded
refresh value or hash fails. Review B also runs EXACT_AUDIT and
SECRET_SCAN_HISTORY (section 2) over the Phase 4 range.

### Anti-pattern coverage

| Anti-pattern | Defense |
|---|---|
| A3 | Dry-run counts come from the labeled `BATCH START` line; the 4.3 usage proof records labeled values |
| A4 | EXACT `values>=1`; the probe shows each listed source |
| A5 | Each `[x]` cites archived output or a commit |
| A6 | `tracks.md` and `metadata.json` change only after the gates pass |
| A11 | ADV in the composite; REHEARSAL on the final HEAD |

## 8. Fixtures, mocks, and live-behavior proof

- **Fake `opencode`** (FR-10). It prints `opencode v2.x`. It writes its
  argument list, its environment as `name=value`, and a SHA-256 of its stdin
  to a capture file. `run` emits the fixed event stream. `auth export`
  emits canary values (`CANARY-ACCESS-<n>`, `CANARY-REFRESH-<n>`,
  `org_CANARY<n>`). `models` lists the test model. `session export <id>`
  prints the session export fixture. The fake also gives the subcommand
  that the design section 4.3 session ID rule reads. It records the argv of
  each call. It opens no network connection.
- **Session export fixture (the usage source, FR-7).** Red builds a synthetic
  export from the shape of `evidence/offline-session-export.redacted.json`.
  Each `info.tokens` field and `info.cost` has a non-zero value that differs
  from the other fields. The `messages` hold planted canaries. A `.gz` copy
  exists.
- **Event stream fixture (cross-check only).** Red copies a redacted live
  stream of task 1.8 to `harness/tests/meta/fixtures/`. Redact the nested
  subagent session ID of `live2` first (Review B RB-7). The stream lacks the
  final `step_finish`, so its sums differ from the export totals. O3 denies
  `subagent`, so no subagent usage mapping exists.
- **Fake `podman`.** It records its argument list and stdin hash. It never
  starts a container in the gate suite.
- **No real credential, model, or network** in any meta test (NFR-3).
- **Live proof.** Phase 1 evidence, task 4.2 probe, task 4.3 runs, task 4.4
  dry run, and REHEARSAL. A meta test is not live proof of the container.

## 9. Intentionally-red aggregate suites

- The meta suite holds negative tests. Only the labeled summary decides a
  gate.
- In Phase 2, R1 and R4 are red by design. In Phase 1, 3, and 4 the same
  commands must be green.
- `test:meta:logic` excludes the Podman probe files by fixed policy. Do not
  grow the exclude list (A7).
- Baseline at role start (2026-10-18 08:27–08:28 +08:00): `Test Files  26
  passed (26)`, `Tests  170 passed (170)`. The count includes untracked
  `bugfix-*.test.ts` files of another track. Compare test names, not only
  totals.
- `npm run test:unit` and `test:e2e` need a candidate tree. They are red
  against `fixture/` and are not gates of this track.

## 10. Architecture guardrails and changed-contract risks

- **Runner hash list.** Edits to `run.sh`, `execution-identity.ts`,
  `executor-attestation.ts`, `go-cost.ts`, `usage.ts`, `provenance-check.ts`,
  and `provenance-record.ts` make every run STALE-PROVENANCE until the weekly
  rescore. Phase 2 changes `harness/tests/**`, which is in `suite_sha256`.
  The rescore skips Pi runs, so they stay STALE. The site must still show them
  in the history block (test 2.6).
- **Hash freeze before 4.3.** A runner or suite change after task 4.3 makes
  the smoke runs STALE. Run 4.3 again in that case.
- **Schema 7 and identity schema 2.** `summarize.sh`, `rescore-doctor.sh`,
  `regrade-run.sh`, `recost.sh`, and the export read them. Schema 6 records
  stay readable.
- **Removed operator interface.** `BENCH_PI_ROOT`, `BENCH_PROVIDER_ENV`,
  `OPENCODE_API_KEY`, `.env.local` key, `--models-json`. Review C checks the
  docs.
- **Classification inputs.** `runs/`, `go-pricing.json`, and the harness
  hashes only (NFR-2).
- **No proxy.** The harness rewrites no header (NFR-5).
- **Dirty tree.** Never stage `harness/go-pricing.json` or paths of other
  tracks.

## 11. Artifact tests versus live-behavior tests

Artifact tests read file text: grep checks for removed names, the `cron-weekly.sh`
source line, the hash list. They prove wiring only. Each artifact check pairs
with a test that runs the behavior: the env matrix, the fake executor run,
REHEARSAL, and the Phase 4 live evidence. A claim with only an artifact test
does not pass a gate.

## 12. Review applicability

| Review | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|---|---|---|---|---|
| A correctness | yes: facts against evidence; O3 deny | yes: falsification of each test | yes: FR-1 to FR-10; task order | yes: acceptance evidence; 4.3 usage proof |
| B security | **yes, required**: protocol 4.1, SECRET_SCAN, SECRET_SCAN_HISTORY, EXACT_AUDIT, ledger | yes: canaries only; no real credential | yes: delivery, cleanup trap, redaction, argv and env | yes: frame rule 7.1, EXACT_AUDIT, SECRET_SCAN_HISTORY, host login, README risk text |
| C UX/API | yes: CLI flags, event stream, schema 7 list in `design.md` | yes: contracts frozen at Red | yes: schema 7, site data rows, removed variables | yes: docs and site rows match code |
| Adversarial testing | no: no harness change | yes: R3 and matrix 5.2 | yes: P3 composite, canary leak, TRIPWIRE | yes: P4 composite, EXACT on live output |
| UX browser | no (`UX_REQUIRED=never`) | no | no | no |

Browser review does not apply: the owner fixed `UX_REQUIRED=never`. Site
data changes have generated-data tests (2.6) and Review C.

## 13. `phase_base_sha` capture point

Capture `phase_base_sha` immediately after the commit that adds this file.
Do it before the Phase 1 role starts:

```
git rev-parse HEAD                                 # -> phase_base_sha (Phase 1)
git diff HEAD | git hash-object --stdin            # tracked_diff_hash
git status --porcelain | git hash-object --stdin   # status_hash
```

Do not use `8e79027`. It predates this strategy commit. For Phase 2, 3, and
4, capture the base at the start of the phase, after the acceptance of the
phase before it. Export it as `PHASE_BASE_SHA` for the P1 composite.

Amendment 1 keeps the Phase 1 base `d27d414`. Phase 1 is in retry, and the
P1 composite allows commits in the track folder. Capture the Phase 2
`phase_base_sha` after the amendment 1 commit and after Phase 1 acceptance.
Never use a SHA that predates the amendment 1 commit as a Phase 2, 3, or 4
base.
