#!/usr/bin/env bash
# One arm of the task 4.2 container probe. The script runs inside the shared
# heavy-job wrapper. It builds the arm config with the same code as
# harness/run.sh and starts one fresh container with --network=none.
set -euo pipefail

ARM="${1:?usage: run-arm.sh <a|b>}"
FRAME="${PROBE_FRAME:?PROBE_FRAME must point at the private frame}"
MODE="${PROBE_MODE:-probe}"
IMAGE="${PROBE_IMAGE:?}"
OPENCODE_BIN="${PROBE_OPENCODE_BIN:?}"
RG_BIN="${PROBE_RG:-}"
MODEL_REF="${PROBE_MODEL_REF:-opencode-go/gpt-6-luna}"
SKILL_ROOT="${PROBE_SKILL_ROOT:-$HOME/.agents/skills}"
FIXTURE="${PROBE_FIXTURE:?}"
PW="${PROBE_PW:?}"
SCRIPT="${PROBE_SCRIPT:?}"

NAME="oe42-arm-$ARM"
OUTDIR="$FRAME/frame-$ARM"
WORKSPACE="$FRAME/workspace-$ARM"
CONFIG="$FRAME/arm-$ARM.json"
read -r -a ENTRY_CMD <<< "${PROBE_ENTRY:-node /probe/probe.cjs}"

mkdir -p "$OUTDIR" "$WORKSPACE"
: > "$OUTDIR/stdout.txt"

# The arm config: the same generation as harness/run.sh (FR-4).
ARM_B="$([ "$ARM" = "b" ] && echo 1 || echo 0)" MODEL_REF="$MODEL_REF" \
  CONFIG_PATH="$CONFIG" \
  node -e '
const fs = require("node:fs");
const armB = process.env.ARM_B === "1";
const config = {
  $schema: "https://opencode.ai/config.json",
  model: process.env.MODEL_REF,
  ...(armB ? { skills: { paths: ["/opt/skills"] }, instructions: ["/workspace/AGENTS.md"] } : {}),
  permissions: [
    { action: "question", resource: "*", effect: "deny" },
    { action: "websearch", resource: "*", effect: "deny" },
    { action: "subagent", resource: "*", effect: "deny" },
    { action: "read", resource: "/tmp/data/**", effect: "deny" },
    { action: "edit", resource: "/tmp/data/**", effect: "deny" },
    { action: "skill", resource: "*", effect: "deny" },
    ...(armB ? ["measure", "next-best-practices", "vercel-react-best-practices", "vercel-composition-patterns", "build-graph"]
      .map((resource) => ({ action: "skill", resource, effect: "allow" })) : []),
  ],
};
fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
'

# The workspace carries the candidate AGENTS.md in Arm B only.
if [ "$ARM" = "b" ]; then
  cp "$FIXTURE/AGENTS.md" "$WORKSPACE/AGENTS.md"
  # Arm B mounts a per-run skill snapshot. The host folders are never mounted.
  SKILLS="$FRAME/skills"
  mkdir -p "$SKILLS"
  for skill in measure next-best-practices vercel-react-best-practices vercel-composition-patterns build-graph; do
    [ -f "$SKILL_ROOT/$skill/SKILL.md" ] || { echo "required Arm B skill unavailable: $skill" >&2; exit 2; }
    rm -rf "${SKILLS:?}/$skill"
    cp -R "$SKILL_ROOT/$skill" "$SKILLS/$skill"
  done
fi

TTY_FLAG=()
if [ "${PROBE_TTY:-0}" = "1" ]; then TTY_FLAG=(-t); fi
PODMAN_ARGS=(run "${TTY_FLAG[@]}" --rm --pull=never --read-only
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=512m
  --tmpfs /run/opencode:rw,nosuid,nodev,size=64m
  --cap-drop=ALL
  --security-opt=no-new-privileges
  --userns=keep-id
  --user "$(id -u):$(id -g)"
  --network none
  --name "$NAME"  --mount "type=bind,src=$OPENCODE_BIN,dst=/usr/local/bin/opencode,ro"
  --mount "type=bind,src=$CONFIG,dst=/config/opencode.json,ro"
  --mount "type=bind,src=$WORKSPACE,dst=/workspace,rw"
  --mount "type=bind,src=$OUTDIR,dst=/out,rw"
  --mount "type=bind,src=$SCRIPT,dst=/probe/probe.cjs,ro")

if [ -n "${PROBE_EXTRA_SCRIPT:-}" ] && [ -f "${PROBE_EXTRA_SCRIPT:-}" ]; then
  PODMAN_ARGS+=(--mount "type=bind,src=$PROBE_EXTRA_SCRIPT,dst=/probe/extra.sh,ro")
fi

if [ -n "$RG_BIN" ] && [ -x "$RG_BIN" ]; then
  PODMAN_ARGS+=(--mount "type=bind,src=$RG_BIN,dst=/usr/local/bin/rg,ro")
fi
if [ "$ARM" = "b" ]; then
  PODMAN_ARGS+=(--mount "type=bind,src=$FRAME/skills,dst=/opt/skills,ro")
fi

PODMAN_ARGS+=(
  --env HOME=/tmp/home
  --env XDG_CONFIG_HOME=/tmp/config
  --env XDG_DATA_HOME=/tmp/data
  --env XDG_STATE_HOME=/tmp/state
  --env XDG_CACHE_HOME=/tmp/cache
  --env OPENCODE_CONFIG=/config/opencode.json
  --env OPENCODE_DISABLE_PROJECT_CONFIG=1
  --env OPENCODE_DISABLE_CLAUDE_CODE=1
  --env OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1
  --env OPENCODE_DISABLE_AUTOUPDATE=1
  --env OPENCODE_DISABLE_MODELS_FETCH=1
  --env OPENCODE_SERVER_PASSWORD="$PW"
  --env PROBE_ARM="$ARM"
  --env PROBE_OUT=/out
  --env PROBE_MODE="$MODE"
  --env PROBE_LOG_FLAGS=1
  --env PROBE_PORT=4123)

if [ "${PROBE_TTY:-0}" = "1" ]; then
  PODMAN_ARGS+=(--env TERM=xterm-256color)
fi

PODMAN_ARGS+=(
  --workdir /workspace
  "$IMAGE"
  "${ENTRY_CMD[@]}")

set +e
podman "${PODMAN_ARGS[@]}" > "$OUTDIR/stdout.txt" 2> "$OUTDIR/stderr.txt"
RC=$?
set -e
podman rm -f "$NAME" >/dev/null 2>&1 || true
echo "arm=$ARM container_exit=$RC"
exit "$RC"
