#!/usr/bin/env bash
# Container entry script for one OpenCode agent run (design 1.2, FR-1, FR-3).
# Runs inside the pinned Node image. Reads the access-only Console credential
# payload from stdin, imports it into the empty isolated store, runs the agent,
# then prints the session export between marker lines — the only channel from
# the container to the host. Never prints a token.
set -euo pipefail

mkdir -p /tmp /tmp/home /tmp/config /tmp/data /tmp/state /tmp/cache

# 1. Read the standard input (the access-only payload) into a temporary file.
CRED_FILE="$(mktemp /tmp/opencode-credential.XXXXXX)"
chmod 600 "$CRED_FILE"
trap 'rm -f "$CRED_FILE" /tmp/opencode-session-export.json' EXIT
cat > "$CRED_FILE"
# 2. Import the credential into the empty isolated store. No file argument:
# the payload file provides the standard input.
opencode auth import < "$CRED_FILE"
rm -f "$CRED_FILE"

# 3. Select the track prompt by probing the candidate tree, then run the agent.
# The prompt text mirrors harness/run.sh verbatim.
if [ -f /workspace/measure/tracks/lending_desk_tests/spec.md ]; then
  PROMPT='Read measure/tracks/lending_desk_tests/spec.md and measure/tracks/lending_desk_tests/plan.md, then implement the plan. This application is complete: write its test suite as *.test.ts files under tests/ and change no other file. Mark each plan task complete as you finish it. Build and start the app, and make sure "npm run typecheck", "npm run build", and "npm test" pass before you stop.'
elif [ -f /workspace/measure/tracks/lending_desk_change/spec.md ]; then
  PROMPT='Read measure/tracks/lending_desk_change/spec.md and measure/tracks/lending_desk_change/plan.md, then implement the change requests. Every existing behavior in the spec must keep working. Do not add, rename, change, or remove any exported symbol or type signature. Do not edit spec.md. Mark each plan task complete as you finish it. Run "npm run typecheck" and "npm run build" and make sure both pass before you stop.'
elif [ -f /workspace/measure/tracks/lending_desk_bugfix/spec.md ]; then
  PROMPT='Read measure/tracks/lending_desk_bugfix/spec.md. This application is defective: it violates some of the acceptance criteria. Find and repair the defects. Do not add, rename, change, or remove any exported symbol or type signature. Do not edit spec.md. Do not modify src/db/, src/lib/auth.ts, app/members/, or src/components/member-card.tsx. Add no files and no dependencies. Run "npm run typecheck" and "npm run build" and make sure both pass before you stop.'
else
  PROMPT='Read measure/tracks/lending_desk/spec.md and measure/tracks/lending_desk/plan.md, then implement the plan. Mark each plan task complete as you finish it. Run "npm run typecheck" and "npm run build" and make sure both pass before you stop.'
fi

MODEL_REF="$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync("/config/opencode.json", "utf8")).model)')"

# timeout wraps only the agent run; the export step below still runs after a
# timeout kill, because the session row exists from the start.
RUN_RC=0
timeout "${AGENT_TIMEOUT:-3600}" opencode run --standalone --format json --auto --model "$MODEL_REF" "$PROMPT" </dev/null || RUN_RC=$?

# 4. The event stream above is the run's artifacts/session.json on the host.
# 5. List the sessions; the export needs exactly one session row.
SESSION_LIST="$(opencode session list)"
SESSION_ID="$(SESSION_LIST="$SESSION_LIST" node -e '
const rows = [];
let raw = process.env.SESSION_LIST || "";
let parsed = null;
try { const value = JSON.parse(raw); if (Array.isArray(value)) parsed = value; } catch {}
if (parsed) {
  rows.push(...parsed);
} else {
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || /^[-+|\s]+$/.test(trimmed)) continue;
    if (/^id\b/i.test(trimmed)) continue; // table header
    const cells = trimmed.split("|").map((cell) => cell.trim()).filter(Boolean);
    rows.push({ id: cells.length > 1 ? cells[0] : trimmed.split(/\s+/)[0] });
  }
}
if (rows.length !== 1) {
  console.error("opencode-entry: expected exactly one OpenCode session in the isolated store, found " + rows.length);
  process.exit(1);
}
const id = rows[0] && (rows[0].id ?? rows[0].sessionID ?? "");
if (!id) { console.error("opencode-entry: the session row has no session ID"); process.exit(1); }
process.stdout.write(String(id));
')"
# 6. Export the session. The export can be larger than one pipe write, so it
#    lands in the candidate mount. The runner moves it to the run artifacts and
#    removes it from the candidate before the candidate contract settles.
EXPORT_PATH="/workspace/.opencode-session-export.json"
opencode session export "$SESSION_ID" > "$EXPORT_PATH"
# 7. Print a size-safe marker block. The export itself travels through the
#    candidate mount, not through this pipe.
printf '%s\n' '--- opencode-session-export-begin ---'
printf 'bytes: %s\n' "$(wc -c < "$EXPORT_PATH" | tr -d ' ')"
printf '%s\n' '--- opencode-session-export-end ---'
exit "$RUN_RC"
