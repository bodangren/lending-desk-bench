#!/usr/bin/env bash
# Host readiness check. Exits 0 when the machine is quiet enough to trust a run,
# 5 when it is not.
#
# Several assertions carry real-time budgets — E.optimistic 800ms, E.return-pending
# 3s, H.loading and P.streams-shell a >=100ms flush gap. Under contention those
# measure the host, not the submission. Two flakes on 2026-07-31 (D.renders timing
# out at 30s, P.history-stable returning an empty page) were traced to a host at
# load 28 with 5.3GB of 7.8GB swap in use. retries:1 and the dedicated socket in
# _stream.ts both help; neither makes the suite immune.
#
# Env:
#   MAX_LOAD_PER_CPU   default 1.0   1-minute loadavg divided by core count
#   MIN_AVAIL_MB       default 2500  MemAvailable
#   MAX_SWAP_USED_MB   default 2000  swap in use
#   BENCH_WAIT_FOR_IDLE  seconds to wait for the host to settle (default 0)
#   BENCH_IGNORE_LOAD=1  proceed anyway, exiting 6 so callers still flag the run
#
# Exit: 0 host ok | 5 host busy, refuse | 6 host busy, overridden (proceed AND flag)
set -uo pipefail

MAX_LOAD_PER_CPU="${MAX_LOAD_PER_CPU:-1.0}"
MIN_AVAIL_MB="${MIN_AVAIL_MB:-2500}"
MAX_SWAP_USED_MB="${MAX_SWAP_USED_MB:-2000}"
WAIT_FOR="${BENCH_WAIT_FOR_IDLE:-0}"
LABEL="${1:-preflight}"

read_state() {
  CPUS=$(nproc)
  LOAD1=$(awk '{print $1}' /proc/loadavg)
  LOAD_PER_CPU=$(awk -v l="$LOAD1" -v c="$CPUS" 'BEGIN{printf "%.2f", l/c}')
  AVAIL_MB=$(awk '/^MemAvailable:/{printf "%d", $2/1024}' /proc/meminfo)
  SWAP_TOTAL_MB=$(awk '/^SwapTotal:/{printf "%d", $2/1024}' /proc/meminfo)
  SWAP_FREE_MB=$(awk '/^SwapFree:/{printf "%d", $2/1024}' /proc/meminfo)
  SWAP_USED_MB=$((SWAP_TOTAL_MB - SWAP_FREE_MB))
}

is_quiet() {
  read_state
  awk -v a="$LOAD_PER_CPU" -v b="$MAX_LOAD_PER_CPU" 'BEGIN{exit !(a<=b)}' || return 1
  [ "$AVAIL_MB" -ge "$MIN_AVAIL_MB" ] || return 1
  [ "$SWAP_USED_MB" -le "$MAX_SWAP_USED_MB" ] || return 1
  return 0
}

DEADLINE=$(( $(date +%s) + WAIT_FOR ))
while : ; do
  if is_quiet; then
    echo "[$LABEL] host ok: load ${LOAD1} on ${CPUS} cpu (${LOAD_PER_CPU}/cpu), ${AVAIL_MB}MB avail, ${SWAP_USED_MB}MB swap used"
    exit 0
  fi
  [ "$(date +%s)" -lt "$DEADLINE" ] || break
  echo "[$LABEL] host busy (load ${LOAD_PER_CPU}/cpu, ${AVAIL_MB}MB avail, ${SWAP_USED_MB}MB swap) — waiting, $(( DEADLINE - $(date +%s) ))s left" >&2
  sleep 30
done

read_state
{
  echo "[$LABEL] HOST NOT READY"
  echo "  load        ${LOAD1} on ${CPUS} cpu = ${LOAD_PER_CPU}/cpu   (budget <= ${MAX_LOAD_PER_CPU})"
  echo "  available   ${AVAIL_MB}MB                    (budget >= ${MIN_AVAIL_MB}MB)"
  echo "  swap used   ${SWAP_USED_MB}MB                    (budget <= ${MAX_SWAP_USED_MB}MB)"
  echo "  top consumers:"
  ps -eo rss,pcpu,comm --sort=-rss | head -6 | sed 's/^/    /'
} >&2

# Exit 6, not 0: the override means "run anyway", never "the host is fine". Callers
# must still record under_load, or a whole matrix graded on a contended machine reports
# itself as clean — which is the one case the flag exists to catch.
if [ "${BENCH_IGNORE_LOAD:-0}" = "1" ]; then
  echo "[$LABEL] BENCH_IGNORE_LOAD=1 — continuing anyway; timing-sensitive results are not trustworthy" >&2
  exit 6
fi
echo "[$LABEL] refusing to run. Wait for the host to settle, set BENCH_WAIT_FOR_IDLE=<seconds>," >&2
echo "[$LABEL] or override with BENCH_IGNORE_LOAD=1 and treat timing failures as void." >&2
exit 5
