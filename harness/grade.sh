#!/usr/bin/env bash
# Grade an already-completed candidate: gate -> suites -> collect -> score.
#   ./grade.sh <run-id> <provider/model> <arm> [wall_seconds]
#
# This is the SINGLE implementation of the grading pipeline. run.sh calls it
# once it has produced a candidate; do not inline these steps anywhere else.
#
# Env overrides (set by run.sh): AGENT_EXIT, THINKING, API_PORT, E2E_PORT.
set -uo pipefail

RUN_ID="${1:?usage: grade.sh <run-id> <provider/model> <arm> [wall_seconds]}"
MODELFULL="${2:?}"; ARM="${3:?}"; WALL="${4:-0}"
RUN_ID_PATTERN='^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'
validate_run_id() {
  local run_id="$1"
  [[ "$run_id" =~ $RUN_ID_PATTERN && "$run_id" != "." && "$run_id" != ".." ]] || {
    echo "unsafe run id: $run_id" >&2
    exit 2
  }
}
validate_run_id "$RUN_ID"
case "$ARM" in a|b) ;; *) echo "arm must be a or b" >&2; exit 2 ;; esac

RUNTIME_PROBE="${BENCH_RUNTIME_PROBE:-}"
case "$RUNTIME_PROBE" in
  ""|server) ;;
  *) echo "BENCH_RUNTIME_PROBE must be server" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; H="$ROOT/harness"
WORK="$ROOT/runs/$RUN_ID"; OUT="$WORK/artifacts"; CAND="$WORK/candidate"
API_PORT="${API_PORT:?API_PORT is required}"
E2E_PORT="${E2E_PORT:?E2E_PORT is required}"

valid_port() {
  local port="$1"
  [[ "$port" =~ ^[0-9]{1,5}$ ]] && [ "$port" -ge 1024 ] && [ "$port" -le 65535 ]
}

valid_port "$API_PORT" || { echo "invalid API_PORT: $API_PORT" >&2; exit 2; }
valid_port "$E2E_PORT" || { echo "invalid E2E_PORT: $E2E_PORT" >&2; exit 2; }

VITEST="$H/node_modules/.bin/vitest"
PLAYWRIGHT="$H/node_modules/.bin/playwright"
TSX="$H/node_modules/.bin/tsx"
NEXT="$CAND/node_modules/.bin/next"

SRV_PID=""
cleanup_server() {
  local pid="$SRV_PID"
  [ -n "$pid" ] || return 0
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
  fi
  wait "$pid" 2>/dev/null || true
  SRV_PID=""
}
trap cleanup_server EXIT INT TERM

server_owns_port() {
  ss -ltnp "sport = :$API_PORT" 2>/dev/null | grep -q "pid=$SRV_PID,"
}

runtime_server_probe() {
  ( cd "$CAND" && BENCH_NOW=2026-03-15T12:00:00.000Z BENCH_LATENCY_MS=50 \
      "$NEXT" start --port "$API_PORT" ) > "$OUT/server.log" 2>&1 &
  SRV_PID=$!
  API_READY=false
  local i
  for i in $(seq 1 40); do
    if ! kill -0 "$SRV_PID" 2>/dev/null; then break; fi
    if server_owns_port && curl -sf -o /dev/null "http://127.0.0.1:$API_PORT/members"; then
      API_READY=true; break
    fi
    sleep 1
  done
  if [ "$API_READY" != true ]; then
    echo "runtime server probe did not become ready on $API_PORT" >&2
    return 1
  fi
  printf '{"schema":1,"api_port":%s,"server_pid":%s,"ready":true}\n' "$API_PORT" "$SRV_PID" > "$OUT/runtime-server-probe.json"
}

write_invalid() {
  local reason="$1"
  node -e 'const fs=require("node:fs"); fs.writeFileSync(process.argv[1], JSON.stringify({schema:2,valid:false,trusted:false,publishable:false,rankable:false,provenance_valid:false,suite_current:false,blocked_by_gate:false,invalid_reasons:[process.argv[5]],run_id:process.argv[2],model:process.argv[3],arm:process.argv[4],invalid:process.argv[5],total:null})+"\n");' "$OUT/score.json" "$RUN_ID" "$MODELFULL" "$ARM" "$reason"
}

score_record() {
  GRADE_END=$(date +%s)
  CANDIDATE="$CAND" ARTIFACTS="$OUT" AGENT_EXIT="${AGENT_EXIT:-0}" \
    WALL_SECONDS="$WALL" GRADING_SECONDS="$((GRADE_END-GRADE_START))" \
    MODEL="$MODELFULL" ARM="$ARM" RUN_ID="$RUN_ID" THINKING="${THINKING:-max}" \
    GATE_BLOCKED="${GATE_BLOCKED:-0}" \
    "$TSX" score.ts > "$OUT/score.json"
}

score_is_valid() {
  node -e 'const fs=require("node:fs"); const score=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.exit(score.valid === true ? 0 : 1);' "$OUT/score.json"
}
TRACE="$OUT/trace.jsonl"

mkdir -p "$OUT"
[ -d "$CAND" ] || { write_invalid "no candidate at $CAND"; echo "[$RUN_ID] no candidate at $CAND" >&2; exit 2; }
for executable in "$VITEST" "$PLAYWRIGHT" "$TSX" "$NEXT"; do
  [ -x "$executable" ] || { write_invalid "required local executable is unavailable"; exit 4; }
done
if ! "$TSX" "$H/candidate-contract.ts" "$ROOT/fixture" "$CAND" > "$OUT/candidate-contract.json"; then
  echo "[$RUN_ID] candidate filesystem contract failed before grading" >&2
  write_invalid "candidate filesystem contract failed"
  exit 4
fi

if [ "$RUNTIME_PROBE" = "server" ]; then
  runtime_server_probe || exit 4
  exit 0
fi

GRADE_START=$(date +%s)

# Host readiness. Unlike run.sh this does NOT abort: by the time we get here the
# agent may already have cost an hour, and throwing that away is worse than
# grading it and saying so. A busy host is recorded on the score record instead,
# so a result that fails only timing-sensitive assertions can be read as void.
# Only exit 0 means the host was actually quiet. 6 (BENCH_IGNORE_LOAD) and 5 both
# mean it was contended, so both flag the record.
UNDER_LOAD=0
"$H/preflight.sh" "$RUN_ID" || UNDER_LOAD=1
[ "$UNDER_LOAD" -eq 1 ] && echo "[$RUN_ID] grading on a contended host — timing assertions are advisory" >&2
HOST_CPUS=$(nproc)
HOST_LOAD=$(awk '{print $1}' /proc/loadavg)
HOST_AVAIL_MB=$(awk '/^MemAvailable:/{printf "%d", $2/1024}' /proc/meminfo)
export BENCH_UNDER_LOAD="$UNDER_LOAD" BENCH_HOST_CPUS="$HOST_CPUS" \
       BENCH_HOST_LOAD="$HOST_LOAD" BENCH_HOST_AVAIL_MB="$HOST_AVAIL_MB"

# ---- Gate -------------------------------------------------------------------
cd "$CAND"
TC=false; BD=false
npm run typecheck > "$OUT/typecheck.log" 2>&1 && TC=true
npm run build     > "$OUT/build.log"     2>&1 && BD=true
echo "{\"typecheck\":$TC,\"build\":$BD}" > "$OUT/gate.json"
echo "[$RUN_ID] gate typecheck=$TC build=$BD"

# ---- Suites (only meaningful if the gate held) -------------------------------
cd "$H"
if [ "$TC" != true ] || [ "$BD" != true ]; then
  printf '{"valid":true,"status":"blocked_by_gate"}\n' > "$OUT/collection.json"
  GATE_BLOCKED=1 score_record && score_is_valid
  exit $?
fi

  CANDIDATE="$CAND" RESULT_FILE="$OUT/unit-raw.json" \
    "$VITEST" run tests/unit --reporter=json --outputFile="$OUT/unit-raw.json" \
    > "$OUT/unit.log" 2>&1

  ( cd "$CAND" && BENCH_NOW=2026-03-15T12:00:00.000Z BENCH_LATENCY_MS=50 \
      "$NEXT" start --port "$API_PORT" ) > "$OUT/server.log" 2>&1 &
  SRV_PID=$!
  API_READY=false
  for i in $(seq 1 40); do
    if ! kill -0 "$SRV_PID" 2>/dev/null; then break; fi
    if server_owns_port && curl -sf -o /dev/null "http://127.0.0.1:$API_PORT/members"; then
      API_READY=true; break
    fi
    sleep 1
  done
  if [ "$API_READY" != true ]; then
    write_invalid "API server did not become ready on its assigned port"
    exit 4
  fi
  CANDIDATE="$CAND" BASE_URL="http://127.0.0.1:$API_PORT" RESULT_FILE="$OUT/api-raw.json" \
    "$VITEST" run tests/api --reporter=json --outputFile="$OUT/api-raw.json" \
    > "$OUT/api.log" 2>&1
  cleanup_server

  CANDIDATE="$CAND" PW_PORT="$E2E_PORT" PW_BASE_URL="http://127.0.0.1:$E2E_PORT" \
    BENCH_TRACE_FILE="$TRACE" E2E_RESULT_FILE="$OUT/e2e-raw.json" \
    "$PLAYWRIGHT" test --grep-invert "H\.error" > "$OUT/e2e.log" 2>&1

  # The error boundary receives a distinct Playwright web-server boot.
  CANDIDATE="$CAND" PW_PORT="$E2E_PORT" PW_BASE_URL="http://127.0.0.1:$E2E_PORT" \
    BENCH_FAIL_ITEMS=1 BENCH_TRACE_FILE="$TRACE" E2E_RESULT_FILE="$OUT/e2e-error-raw.json" \
    "$PLAYWRIGHT" test --grep "H\.error" > "$OUT/e2e-error.log" 2>&1

if ! "$TSX" collect.ts "$OUT/unit-raw.json" "$OUT/api-raw.json" \
  "$OUT/e2e-raw.json" "$OUT/e2e-error-raw.json" "$OUT/results.json" \
  > "$OUT/collect.log" 2>&1; then
  write_invalid "collection failed or raw reports were missing"
  exit 4
fi
printf '{"valid":true,"status":"collected"}\n' > "$OUT/collection.json"
if score_record && score_is_valid; then
  SCORE_VALID=1
else
  SCORE_VALID=0
fi

python3 -c "
import json
d=json.load(open('$OUT/score.json'))
u=d['usage']; dd=d['doctor']
print(f\"[$RUN_ID] TOTAL {d['total']}  gate={d['gate']['passed']}  \"
      f\"T0={d['tiers']['0']['rate']:.0%} T1={d['tiers']['1']['rate']:.0%} T2={d['tiers']['2']['rate']:.0%}\")
print(f\"[$RUN_ID] doctor ran={dd['ran']} err={dd['errors']} warn={dd['warnings']} \"
      f\"penalty={dd['penalty_over_reference']} | quality={d['axes']['quality']:.2f}\")
print(f\"[$RUN_ID] {d['time_on_task_seconds']}s on task | in {u['input']} out {u['output']} \"
      f\"cacheR {u['cacheRead']} cacheW {u['cacheWrite']} | \${u['costUsd']:.4f} | {u['assistantTurns']} turns\")
m=d.get('missing_criteria') or []
if m:
    print(f\"[$RUN_ID] SUSPECT: {len(m)} declared id(s) never collected -> {', '.join(m[:6])}\"
          + (' ...' if len(m)>6 else ''))
h=d.get('host') or {}
if h.get('under_load'):
    print(f\"[$RUN_ID] SUSPECT: graded under load {h.get('load1')} on {h.get('cpus')} cpu, \"
          f\"{h.get('avail_mb')}MB avail — timing-sensitive failures are void, not scores\")
"
if [ "$SCORE_VALID" -ne 1 ]; then
  exit 1
fi
