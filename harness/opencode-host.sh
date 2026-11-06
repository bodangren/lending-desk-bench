#!/usr/bin/env bash
# The OpenCode host isolation of the harness (spec D1, D2, D6, D7).
#
# Each job gets its own OpenCode store. The job folder is
# $ROOT/.tmp/opencode-host-<job>-<pid>/. Its subfolders hold the HOME, the
# config, the data, the state, the cache, the runtime, and the tmp paths of
# the job. The owner exports BENCH_OPENCODE_HOME. A nested job uses the folder
# of its owner.
#
# The cleanup selects a process by the marker in its environment, never by its
# name. The marker is the environment line BENCH_OPENCODE_JOB=<job folder>.
#
#   opencode_host_begin <job>   Start a job. The owner makes the job folder.
#   opencode_host_run <args>    Run the host binary with the job store.
#   opencode_host_cleanup       Stop the marked processes and remove the folder.
#   opencode_host_sweep         Clean the folders of dead owners.
#
# Source this file; do not execute it.

# The root of the repository. Every owner uses the same root.
OPENCODE_HOST_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The job folder of this shell. The owner exports it.
BENCH_OPENCODE_HOME="${BENCH_OPENCODE_HOME:-}"
# The owner flag and the cleanup flag of this shell. They never leave the shell.
BENCH_OPENCODE_HOST_OWNER=0
BENCH_OPENCODE_HOST_DONE=0

# The pids of the user whose environment holds the marker of the folder. The
# shell of the owner and its subshell never appear in the list. The loop reads
# each /proc/<pid>/environ with a shell builtin, so it forks no helper per pid.
opencode_host_marked_pids() {
  local folder="$1" pid entry line
  for pid in /proc/[0-9]*; do
    pid="${pid#/proc/}"
    if [ "$pid" = "$$" ] || [ "$pid" = "$BASHPID" ]; then continue; fi
    if [ ! -r "/proc/$pid/environ" ]; then continue; fi
    entry=""
    while IFS= read -r -d '' line; do
      if [ "$line" = "BENCH_OPENCODE_JOB=$folder" ]; then entry=1; break; fi
    done < "/proc/$pid/environ"
    if [ -n "$entry" ]; then printf '%s\n' "$pid"; fi
  done
}

# A process is alive when it exists and is no zombie. A zombie holds no store
# and no folder link, so the cleanup treats it as stopped at once.
opencode_host_alive() {
  local stat
  stat="$(cat "/proc/$1/stat" 2>/dev/null)" || return 1
  stat="${stat##*) }"
  case "$stat" in
    Z*|X*) return 1 ;;
    *) return 0 ;;
  esac
}

# The pids with a link in the job folder. One find pass over /proc, no helper
# fork per file descriptor.
opencode_host_folder_holders() {
  local folder="$1"
  find /proc/[0-9]*/fd -lname "$folder/*" 2>/dev/null | cut -d/ -f3 | sort -u
}

# Stops the marked processes of the folder. It returns the number of processes
# that got the SIGTERM signal.
opencode_host_stop() {
  local folder="$1" pids pid waited alive stopped
  pids="$(opencode_host_marked_pids "$folder")"
  stopped=0
  if [ -n "$pids" ]; then
    stopped="$(printf '%s\n' "$pids" | wc -l | tr -d ' ')"
    for pid in $pids; do kill -TERM "$pid" 2>/dev/null || true; done
    waited=0
    while [ "$waited" -lt 10 ]; do
      alive=0
      for pid in $pids; do
        if kill -0 "$pid" 2>/dev/null && opencode_host_alive "$pid"; then alive=1; fi
      done
      if [ "$alive" != "1" ]; then break; fi
      sleep 1
      waited=$((waited + 1))
    done
    for pid in $pids; do
      if kill -0 "$pid" 2>/dev/null && opencode_host_alive "$pid"; then kill -KILL "$pid" 2>/dev/null || true; fi
    done
  fi
  printf '%s\n' "$stopped"
}

# Removes the job folder. It keeps the folder when a process holds a link in it.
opencode_host_remove() {
  local folder="$1" holders holder
  holders="$(opencode_host_folder_holders "$folder")"
  if [ -n "$holders" ]; then
    for holder in $holders; do
      echo "OPENCODE_HOME CLEANUP FAIL pid=$holder path=$folder"
    done
    return 1
  fi
  case "$folder" in
    "$OPENCODE_HOST_ROOT/.tmp/opencode-host-"*) rm -rf -- "$folder" ;;
  esac
  return 0
}

# The cleanup of D6. Only the owner cleans up. A second call does nothing.
opencode_host_cleanup() {
  if [ "${BENCH_OPENCODE_HOST_OWNER:-0}" != "1" ]; then return 0; fi
  if [ "${BENCH_OPENCODE_HOST_DONE:-0}" = "1" ]; then return 0; fi
  BENCH_OPENCODE_HOST_DONE=1
  local folder="${BENCH_OPENCODE_HOME:-}"
  if [ -z "$folder" ]; then return 0; fi
  local stopped
  stopped="$(opencode_host_stop "$folder")"
  opencode_host_remove "$folder" || true
  echo "OPENCODE_HOME CLEANUP stopped=$stopped path=$folder"
}

# The sweep of D7. A folder of a dead owner is cleaned. A folder of a live
# owner stays.
opencode_host_sweep() {
  local folder owner_pid stopped
  for folder in "$OPENCODE_HOST_ROOT"/.tmp/opencode-host-*/; do
    folder="${folder%/}"
    if [ ! -d "$folder" ]; then continue; fi
    if [ "$folder" = "${BENCH_OPENCODE_HOME:-}" ]; then continue; fi
    owner_pid=""
    if [ -f "$folder/owner.pid" ]; then
      owner_pid="$(tr -dc '0-9' < "$folder/owner.pid" 2>/dev/null || true)"
    fi
    if [ -n "$owner_pid" ] && kill -0 "$owner_pid" 2>/dev/null && opencode_host_alive "$owner_pid"; then continue; fi
    stopped="$(opencode_host_stop "$folder")"
    opencode_host_remove "$folder" || true
    echo "OPENCODE_HOME SWEEP stopped=$stopped path=$folder"
  done
}

# Starts a job. The owner makes the job folder and exports it. A job that finds
# an existing job folder uses that folder and is not the owner.
opencode_host_begin() {
  local job="${1:-}"
  if [ -z "$job" ]; then
    echo "opencode-host: no job name" >&2
    return 2
  fi
  local existing="${BENCH_OPENCODE_HOME:-}"
  if [ -n "$existing" ] && [ -d "$existing" ]; then
    BENCH_OPENCODE_HOME="$existing"
    export BENCH_OPENCODE_HOME
    return 0
  fi
  opencode_host_sweep
  local folder="$OPENCODE_HOST_ROOT/.tmp/opencode-host-$job-$$"
  local sub
  mkdir -p "$folder" || return 2
  chmod 700 "$folder" || return 2
  for sub in home config data state cache runtime tmp; do
    mkdir -p "$folder/$sub" || return 2
    chmod 700 "$folder/$sub" || return 2
  done
  printf '%s\n' "$$" > "$folder/owner.pid" || return 2
  BENCH_OPENCODE_HOME="$folder"
  export BENCH_OPENCODE_HOME
  BENCH_OPENCODE_HOST_OWNER=1
  # The owner script sets the traps: trap 'exit 130' INT, trap 'exit 143' TERM,
  # and opencode_host_cleanup in its EXIT trap. run.sh keeps its present traps.
  return 0
}

# Runs the host binary with the job store. The job never exports these paths,
# so the Podman image store and the credential staging keep their own values.
opencode_host_run() {
  local folder="${BENCH_OPENCODE_HOME:-}"
  if [ -z "$folder" ] || [ ! -d "$folder" ]; then
    echo "opencode-host: no job folder" >&2
    return 2
  fi
  local bin="${BENCH_OPENCODE_BIN:-}"
  if [ -z "$bin" ]; then
    bin="$(command -v opencode || true)"
  fi
  if [ -z "$bin" ] || [ ! -x "$bin" ]; then
    echo "opencode-host: no opencode binary" >&2
    return 2
  fi
  env -u OPENCODE_DB \
    HOME="$folder/home" \
    XDG_CONFIG_HOME="$folder/config" \
    XDG_DATA_HOME="$folder/data" \
    XDG_STATE_HOME="$folder/state" \
    XDG_CACHE_HOME="$folder/cache" \
    XDG_RUNTIME_DIR="$folder/runtime" \
    TMPDIR="$folder/tmp" \
    OPENCODE_DISABLE_AUTOUPDATE=1 \
    BENCH_OPENCODE_JOB="$folder" \
    "$bin" "$@"
}
