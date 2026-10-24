#!/usr/bin/env bash
# Install the pinned static musl ripgrep 15.1.0 for the run container (FR-4).
# The host distro rg does not run in the pinned image (glibc mismatch), so
# the harness ships the official release build. This script downloads the
# tarball, checks it against the upstream .sha256 file, extracts the binary,
# checks the binary hash, and installs it outside the repository. Run time
# never downloads: run.sh and batch.sh only resolve and verify the installed
# helper.
set -euo pipefail

VERSION="15.1.0"
ASSET="ripgrep-$VERSION-x86_64-unknown-linux-musl"
TARBALL_SHA256="1c9297be4a084eea7ecaedf93eb03d058d6faae29bbc57ecdaf5063921491599"
BINARY_SHA256="ebeaf56f8a25e102e9419933423738b3a2a613a444fd749d695e15eba53f71f2"
BASE_URL="https://github.com/BurntSushi/ripgrep/releases/download/$VERSION"
INSTALL_PATH="${BENCH_RG_BIN:-$HOME/.local/share/lending-desk-bench/rg}"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/lending-desk-rg.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

curl -fsSL -o "$WORK_DIR/$ASSET.tar.gz" "$BASE_URL/$ASSET.tar.gz"
curl -fsSL -o "$WORK_DIR/$ASSET.tar.gz.sha256" "$BASE_URL/$ASSET.tar.gz.sha256"

TARBALL_COMPUTED="$(sha256sum "$WORK_DIR/$ASSET.tar.gz" | awk '{print $1}')"
[ "$TARBALL_COMPUTED" = "$TARBALL_SHA256" ] || {
  echo "fetch-rg: tarball hash $TARBALL_COMPUTED does not match the pinned $TARBALL_SHA256" >&2
  exit 1
}
UPSTREAM="$(awk '{print $1}' "$WORK_DIR/$ASSET.tar.gz.sha256")"
[ -n "$UPSTREAM" ] && [ "$UPSTREAM" = "$TARBALL_COMPUTED" ] || {
  echo "fetch-rg: the upstream .sha256 file does not confirm the tarball hash" >&2
  exit 1
}

tar -xzf "$WORK_DIR/$ASSET.tar.gz" -C "$WORK_DIR"
BINARY="$WORK_DIR/$ASSET/rg"
BINARY_COMPUTED="$(sha256sum "$BINARY" | awk '{print $1}')"
[ "$BINARY_COMPUTED" = "$BINARY_SHA256" ] || {
  echo "fetch-rg: binary hash $BINARY_COMPUTED does not match the pinned $BINARY_SHA256" >&2
  exit 1
}

mkdir -p "$(dirname "$INSTALL_PATH")"
install -m 0755 "$BINARY" "$INSTALL_PATH"
"$INSTALL_PATH" --version
echo "fetch-rg: installed ripgrep $VERSION at $INSTALL_PATH"
