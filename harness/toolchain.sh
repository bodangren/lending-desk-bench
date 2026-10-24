#!/usr/bin/env bash
# Operator toolchain for cron entry points (FR-9). Source this file; do not
# execute it. The crontab PATH resolves node to the snap dispatcher, which
# breaks tsx; this script prepends the operator nvm Node bin directory so
# node, npm, and opencode resolve to the same files as the operator shell.
# It stops when it cannot resolve a Node directory. Sourcing this file does
# not change the caller's shell options.

NVM_DIR="${NVM_DIR:-${HOME}/.nvm}"
ALIAS_FILE="$NVM_DIR/alias/default"
if [ ! -f "$ALIAS_FILE" ]; then
  echo "toolchain: no nvm default alias at $ALIAS_FILE" >&2
  return 1 2>/dev/null || exit 1
fi
ALIAS_VALUE="$(tr -d '[:space:]' < "$ALIAS_FILE")"
if [ -z "$ALIAS_VALUE" ]; then
  echo "toolchain: the nvm default alias is empty" >&2
  return 1 2>/dev/null || exit 1
fi

if [[ "$ALIAS_VALUE" == v* ]]; then
  NODE_DIR="$NVM_DIR/versions/node/$ALIAS_VALUE"
else
  NODE_DIR=""
  for candidate in "$NVM_DIR"/versions/node/v"$ALIAS_VALUE".*; do
    [ -d "$candidate" ] || continue
    if [ -z "$NODE_DIR" ] || [[ "$(printf '%s\n%s\n' "$NODE_DIR" "$candidate" | sort -V | tail -n 1)" == "$candidate" ]]; then
      NODE_DIR="$candidate"
    fi
  done
fi
if [ -z "$NODE_DIR" ] || [ ! -d "$NODE_DIR/bin" ]; then
  echo "toolchain: no installed Node directory matches the nvm default alias '$ALIAS_VALUE'" >&2
  return 1 2>/dev/null || exit 1
fi
export PATH="$NODE_DIR/bin:$PATH"
hash -r 2>/dev/null || true
if ! command -v node >/dev/null; then
  echo "toolchain: node does not resolve from $NODE_DIR/bin" >&2
  return 1 2>/dev/null || exit 1
fi
