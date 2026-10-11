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

BENCH_TRACK="${BENCH_TRACK:-build}"
case "$BENCH_TRACK" in build|bugfix|tests|change) ;; *) echo "BENCH_TRACK must be build, bugfix, tests, or change" >&2; exit 2 ;; esac
CONTRACT_ROOT="$ROOT/fixture"
CONTRACT_ARGS=(--track "$BENCH_TRACK")
if [ "$BENCH_TRACK" != "build" ]; then
  CONTRACT_ROOT="$ROOT/runs/$RUN_ID/variant"
  [ -d "$CONTRACT_ROOT" ] || { echo "[$RUN_ID] $BENCH_TRACK variant tree is missing: $CONTRACT_ROOT" >&2; exit 2; }
fi

write_invalid() {
  local reason="$1"
  node -e 'const fs=require("node:fs"); fs.writeFileSync(process.argv[1], JSON.stringify({schema:3,track:process.argv[6],valid:false,trusted:false,publishable:false,rankable:false,provenance_valid:false,suite_current:false,blocked_by_gate:false,invalid_reasons:[process.argv[5]],run_id:process.argv[2],model:process.argv[3],arm:process.argv[4],invalid:process.argv[5],total:null})+"\n");' "$OUT/score.json" "$RUN_ID" "$MODELFULL" "$ARM" "$reason" "$BENCH_TRACK"
}

score_record() {
  GRADE_END=$(date +%s)
  CANDIDATE="$CAND" VARIANT="$CONTRACT_ROOT" BENCH_TRACK="$BENCH_TRACK" ARTIFACTS="$OUT" AGENT_EXIT="${AGENT_EXIT:-0}" \
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
# cleanup.sh drains node_modules from published weeks. A regrade of such a
# candidate used to stop at the executable check below and overwrite a valid
# record with "required local executable is unavailable" (12 w38 runs). Restore
# the same private physical copy run.sh makes before the first grade.
if [ ! -x "$NEXT" ] && [ -d "$ROOT/fixture/node_modules" ]; then
  echo "[$RUN_ID] candidate dependencies are missing; restoring a private copy"
  rm -rf "$CAND/node_modules"
  cp -a "$ROOT/fixture/node_modules" "$CAND/node_modules"
fi
for executable in "$VITEST" "$PLAYWRIGHT" "$TSX" "$NEXT"; do
  [ -x "$executable" ] || { write_invalid "required local executable is unavailable"; exit 4; }
done
# 0 clean, 3 soft violations inside writable files (graded; adherence pays).
# run.sh grafts every other soft violation away before it calls this script.
CONTRACT_RC=0
"$TSX" "$H/candidate-contract.ts" "$CONTRACT_ROOT" "$CAND" "${CONTRACT_ARGS[@]}" > "$OUT/candidate-contract.json" || CONTRACT_RC=$?
if [ "$CONTRACT_RC" -ne 0 ] && [ "$CONTRACT_RC" -ne 3 ]; then
  echo "[$RUN_ID] candidate filesystem contract failed before grading" >&2
  write_invalid "candidate filesystem contract failed"
  exit 4
fi

if [ "$RUNTIME_PROBE" = "server" ]; then
  runtime_server_probe || exit 4
  exit 0
fi

GRADE_START=$(date +%s)

# A browser that cannot launch fails every browser-graded criterion inside a
# record that would otherwise stay valid (w36-w38: ~20 build, ~49 bugfix). That
# is a harness failure, so it must produce an invalid record, never a score.
# The tests track runs no browser suite.
if [ "$BENCH_TRACK" != "tests" ] && ! "$TSX" "$H/browser-check.ts" > "$OUT/browser-check.log" 2>&1; then
  echo "[$RUN_ID] $(tail -1 "$OUT/browser-check.log")" >&2
  write_invalid "browser unavailable: Playwright Chromium did not launch"
  exit 4
fi

# Host readiness. Advisory only under the always-publish policy: a busy host is
# recorded on the score record as advisory metadata; nothing is voided.
# Only exit 0 means the host was actually quiet; any other code was contended.
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

# The tests track grades the candidate's own suite against correct and defective
# apps; grade-tests.ts writes results.json and tests-results.json itself.
if [ "$BENCH_TRACK" = "tests" ]; then
  if ! CANDIDATE="$CAND" ARTIFACTS="$OUT" PORT="$API_PORT" "$TSX" "$H/tests-track/grade-tests.ts" \
      > "$OUT/tests-grade.log" 2>&1; then
    write_invalid "tests-track grading failed; see tests-grade.log"
    exit 4
  fi
  printf '{"valid":true,"status":"collected"}\n' > "$OUT/collection.json"
  if score_record && score_is_valid; then exit 0; else exit 1; fi
fi

# Suite selection by track:
#   M.* closeout criteria grade the build track's Measure files, which every
#   variant replaces, so the variant tracks skip the plan unit test.
#   X.* change criteria exist only on the change track.
UNIT_EXCLUDE=()
[ "$BENCH_TRACK" != "build" ] && UNIT_EXCLUDE=(--exclude 'tests/unit/track-plan.test.ts')
API_ARGS=(--no-file-parallelism)
[ "$BENCH_TRACK" != "change" ] && API_ARGS+=(--exclude 'tests/api/change.test.ts')
E2E_EXCLUDE="H\.error"
[ "$BENCH_TRACK" != "change" ] && E2E_EXCLUDE="H\.error|X\."

  CANDIDATE="$CAND" RESULT_FILE="$OUT/unit-raw.json" \
    "$VITEST" run tests/unit "${UNIT_EXCLUDE[@]}" --reporter=json --outputFile="$OUT/unit-raw.json" \
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
    "$VITEST" run tests/api "${API_ARGS[@]}" --reporter=json --outputFile="$OUT/api-raw.json" \
    > "$OUT/api.log" 2>&1
  cleanup_server

  # The fixture's grader-only route app/api/bench-state answers only this key.
  BENCH_STATE_KEY=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(16).toString("hex"))')
  export BENCH_STATE_KEY

  CANDIDATE="$CAND" PW_PORT="$E2E_PORT" PW_BASE_URL="http://127.0.0.1:$E2E_PORT" \
    BENCH_TRACE_FILE="$TRACE" E2E_RESULT_FILE="$OUT/e2e-raw.json" \
    "$PLAYWRIGHT" test --grep-invert "$E2E_EXCLUDE" > "$OUT/e2e.log" 2>&1

  # The error boundary receives a distinct Playwright web-server boot.
  CANDIDATE="$CAND" PW_PORT="$E2E_PORT" PW_BASE_URL="http://127.0.0.1:$E2E_PORT" \
    BENCH_FAIL_ITEMS=1 BENCH_TRACE_FILE="$TRACE" E2E_RESULT_FILE="$OUT/e2e-error-raw.json" \
    "$PLAYWRIGHT" test --grep "H\.error" > "$OUT/e2e-error.log" 2>&1

# The launch check above can still race a cache cleanup. Any launch error in a
# raw report voids the record for the same reason.
for report in "$OUT/e2e-raw.json" "$OUT/e2e-error-raw.json"; do
  if grep -qE "browserType\.launch|Executable doesn't exist" "$report" 2>/dev/null; then
    write_invalid "browser failed during the e2e pass"
    exit 4
  fi
done

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
          f\"{h.get('avail_mb')}MB avail — timing-sensitive failures are advisory under the always-publish policy\")
"
if [ "$SCORE_VALID" -ne 1 ]; then
  exit 1
fi
