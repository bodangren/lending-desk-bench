#!/usr/bin/env bash
# Lending Desk benchmark runner.
#   ./run.sh <provider> <model> <arm: a|b> <run-id>
set -euo pipefail
RUN_ID_PATTERN='^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'


validate_run_id() {
  local run_id="$1"
  [[ "$run_id" =~ $RUN_ID_PATTERN && "$run_id" != "." && "$run_id" != ".." ]] || {
    echo "unsafe run id: $run_id" >&2; exit 2;
  }
}


PROVIDER="${1:?usage: run.sh <provider> <model> <a|b> <run-id>}"
MODEL="${2:?}"
ARM="${3:?}"
RUN_ID="${4:?}"
validate_run_id "$RUN_ID"
case "$ARM" in a|b) ;; *) echo "arm must be a or b" >&2; exit 2 ;; esac

RUNTIME_PROBE="${BENCH_RUNTIME_PROBE:-}"
case "$RUNTIME_PROBE" in
  ""|ports|container|dependency-copy) ;;
  *) echo "BENCH_RUNTIME_PROBE must be ports, container, or dependency-copy" >&2; exit 2 ;;
esac

RUNTIME_PROBE_HOLD_SECONDS="${BENCH_RUNTIME_PROBE_HOLD_SECONDS:-0}"
if ! [[ "$RUNTIME_PROBE_HOLD_SECONDS" =~ ^[0-9]{1,2}$ ]]; then
  echo "BENCH_RUNTIME_PROBE_HOLD_SECONDS must be an integer from 0 to 60" >&2
  exit 2
fi
if (( 10#$RUNTIME_PROBE_HOLD_SECONDS > 60 )); then
  echo "BENCH_RUNTIME_PROBE_HOLD_SECONDS must be an integer from 0 to 60" >&2
  exit 2
fi

if [ "$RUNTIME_PROBE" = "container" ]; then
  if ! [[ "${BENCH_RUNTIME_PROBE_LABEL:-}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]]; then
    echo "BENCH_RUNTIME_PROBE_LABEL must be a safe Podman label value" >&2
    exit 2
  fi
fi

port_for_run() {
  local salt="$1" hash
  hash=$(printf '%s' "${RUN_ID}:${salt}" | cksum | awk '{print $1}')
  printf '%s\n' "$((20000 + hash % 20000))"
}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
H="$ROOT/harness"
WORK="$ROOT/runs/$RUN_ID"
OUT="$WORK/artifacts"
CAND="$WORK/candidate"
THINKING="${THINKING:-max}"   # pi levels: off|minimal|low|medium|high|xhigh|max
PORT_LOCK_ROOT="$ROOT/runs/.port-locks"
PORT_LOCKS=()

PORT_LOCK_TOKEN=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(16).toString("hex"))')
[[ "$PORT_LOCK_TOKEN" =~ ^[a-f0-9]{16,}$ ]] || { echo "could not create port lock token" >&2; exit 2; }

lock_owner_fields() {
  local lock="$1"
  [ -s "$lock/owner.json" ] || return 1
  node -e 'const fs=require("node:fs"); const owner=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (owner.schema!==1||!Number.isInteger(owner.pid)||owner.pid<1||typeof owner.token!=="string"||!/^[a-f0-9]{16,}$/.test(owner.token)||!Number.isInteger(owner.port)) process.exit(1); console.log(`${owner.pid}\t${owner.token}\t${owner.port}`);' "$lock/owner.json"
}

write_lock_owner() {
  local lock="$1" port="$2" temporary="$lock/owner.json.$PORT_LOCK_TOKEN.tmp"
  LOCK_PID="$$" LOCK_TOKEN="$PORT_LOCK_TOKEN" LOCK_PORT="$port" node -e 'const owner={schema:1,pid:Number(process.env.LOCK_PID),token:process.env.LOCK_TOKEN,port:Number(process.env.LOCK_PORT)}; if (!Number.isInteger(owner.pid)||!Number.isInteger(owner.port)||!/^[a-f0-9]{16,}$/.test(owner.token)) process.exit(1); process.stdout.write(JSON.stringify(owner));' > "$temporary" || return 1
  mv "$temporary" "$lock/owner.json"
}

release_owned_port_lock() {
  local lock="$1" pid token port
  IFS=$'\t' read -r pid token port < <(lock_owner_fields "$lock" 2>/dev/null) || return 0
  [ "$pid" = "$$" ] && [ "$token" = "$PORT_LOCK_TOKEN" ] || return 0
  rm -f "$lock/owner.json"
  rmdir "$lock" 2>/dev/null || true
}

stale_port_lock() {
  local lock="$1" port="$2" pid token owner_port
  IFS=$'\t' read -r pid token owner_port < <(lock_owner_fields "$lock" 2>/dev/null) || return 1
  [ "$owner_port" = "$port" ] || return 1
  kill -0 "$pid" 2>/dev/null && return 1
  return 0
}

reclaim_stale_port_lock() {
  local lock="$1" port="$2" retired
  stale_port_lock "$lock" "$port" || return 1
  retired="$lock.stale.$PORT_LOCK_TOKEN"
  mv "$lock" "$retired" 2>/dev/null || return 1
  rm -rf "$retired"
  return 0
}
release_port_locks() {
  local lock
  for lock in "${PORT_LOCKS[@]}"; do
    release_owned_port_lock "$lock"
  done
}
trap release_port_locks EXIT INT TERM

valid_port_number() {
  local port="$1"
  [[ "$port" =~ ^[0-9]{1,5}$ ]] && [ "$port" -ge 1024 ] && [ "$port" -le 65535 ]
}

reclaim_stale_port_locks() {
  local lock port
  for lock in "$PORT_LOCK_ROOT"/*; do
    [ -d "$lock" ] || continue
    port="${lock##*/}"
    valid_port_number "$port" || continue
    reclaim_stale_port_lock "$lock" "$port" || true
  done
}

port_is_available() {
  local port="$1"
  ! ss -ltnH "sport = :$port" 2>/dev/null | grep -q .
}

claim_port() {
  local salt="$1" requested="$2" attempt port lock
  command -v ss >/dev/null || { echo "ss is required for safe port allocation" >&2; return 1; }
  mkdir -p "$PORT_LOCK_ROOT"
  reclaim_stale_port_locks
  if [ -n "$requested" ]; then
    valid_port_number "$requested" || { echo "invalid requested port: $requested" >&2; return 1; }
  fi
  for ((attempt = 0; attempt < 20000; attempt++)); do
    if [ -n "$requested" ]; then
      port="$requested"
    else
      port=$((20000 + ($(port_for_run "$salt:$attempt") - 20000 + attempt) % 20000))
    fi
    lock="$PORT_LOCK_ROOT/$port"
    if mkdir "$lock" 2>/dev/null; then
      if ! write_lock_owner "$lock" "$port"; then
        rmdir "$lock" 2>/dev/null || true
        continue
      fi
      if port_is_available "$port"; then
        PORT_LOCKS+=("$lock")
        CLAIMED_PORT="$port"
        return 0
      fi
      release_owned_port_lock "$lock"
    else
      for settle in 1 2 3; do
        [ -s "$lock/owner.json" ] && break
        sleep 0.01
      done
      if reclaim_stale_port_lock "$lock" "$port"; then
        continue
      fi
    fi
    [ -z "$requested" ] || break
  done
  echo "unable to reserve a free $salt port" >&2
  return 1
}

REQUESTED_API_PORT="${API_PORT:-}"
REQUESTED_E2E_PORT="${E2E_PORT:-}"
if [ "$RUNTIME_PROBE" != "container" ] && [ "$RUNTIME_PROBE" != "dependency-copy" ]; then
  claim_port api "$REQUESTED_API_PORT"
  API_PORT="$CLAIMED_PORT"
  claim_port e2e "$REQUESTED_E2E_PORT"
  E2E_PORT="$CLAIMED_PORT"
fi

runtime_port_probe() {
  mkdir -p "$OUT"
  printf '{"schema":1,"api_port":%s,"e2e_port":%s}\n' "$API_PORT" "$E2E_PORT" \
    > "$OUT/runtime-port-probe.json"
  if (( 10#$RUNTIME_PROBE_HOLD_SECONDS > 0 )); then
    sleep "$RUNTIME_PROBE_HOLD_SECONDS"
  fi
  exit 0
}

assert_candidate_contract() {
  if ! "$H/node_modules/.bin/tsx" "$H/candidate-contract.ts" "$ROOT/fixture" "$CAND" \
    > "$OUT/candidate-contract.json"; then
    echo "candidate filesystem contract rejected the run:" >&2
    node -e 'try { const c = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); console.error((c.reasons || []).join("; ") || "no contract reason was emitted"); } catch { console.error("the candidate contract did not emit valid JSON"); }' \
      "$OUT/candidate-contract.json" >&2 || true
    return 1
  fi
}

write_provenance() {
  local candidate_hash fixture_hash runner_hash suite_hash hashes contract_fields identity_hash
  [ -s "$OUT/candidate-contract.json" ] || return 1
  [ -s "$OUT/execution-identity.json" ] || return 1
  [ -s "$OUT/executor-cohort.json" ] || return 1
  contract_fields=$(node -e 'const c = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); const hex = /^[a-f0-9]{64}$/; if (c.schema !== 1 || c.valid !== true || !hex.test(c.candidate_sha256) || !hex.test(c.fixture_protected_sha256)) process.exit(1); process.stdout.write(`${c.candidate_sha256}\t${c.fixture_protected_sha256}`);' "$OUT/candidate-contract.json") || return 1
  IFS=$'\t' read -r candidate_hash fixture_hash <<< "$contract_fields"
  hashes=$("$H/node_modules/.bin/tsx" "$H/provenance.ts" --shell) || return 1
  IFS=$'\t' read -r runner_hash suite_hash <<< "$hashes"
  identity_hash=$("$H/node_modules/.bin/tsx" "$H/execution-identity.ts" --fingerprint "$OUT/execution-identity.json") || return 1
  [ -n "$runner_hash" ] && [ -n "$suite_hash" ] && [[ "$identity_hash" =~ ^[a-f0-9]{64}$ ]] || return 1
  ARM_VALUE="$ARM" RUN_ID_VALUE="$RUN_ID" MODE_VALUE="${RUN_MODE:-unknown}" MODEL_VALUE="$PROVIDER/$MODEL" CANDIDATE_HASH="$candidate_hash" FIXTURE_HASH="$fixture_hash" RUNNER_HASH="$runner_hash" SUITE_HASH="$suite_hash" ISOLATED_VALUE="${AGENT_ISOLATED:-false}" IDENTITY_PATH="$OUT/execution-identity.json" COHORT_PATH="$OUT/executor-cohort.json" IDENTITY_HASH="$identity_hash" node -e 'const fs=require("node:fs"); const e=process.env; if (!/^(a|b)$/.test(e.ARM_VALUE) || !/^(agent|overlay)$/.test(e.MODE_VALUE)) throw new Error("invalid provenance identity"); if ((e.MODE_VALUE === "agent") !== (e.ISOLATED_VALUE === "true")) throw new Error("invalid provenance isolation"); const executor=JSON.parse(fs.readFileSync(e.IDENTITY_PATH,"utf8")),cohort=JSON.parse(fs.readFileSync(e.COHORT_PATH,"utf8")); if (cohort.schema!==1||typeof cohort.id!=="string"||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(cohort.id)) throw new Error("invalid executor cohort"); console.log(JSON.stringify({ schema: 4, run_id: e.RUN_ID_VALUE, arm: e.ARM_VALUE, model: e.MODEL_VALUE, mode: e.MODE_VALUE, candidate_sha256: e.CANDIDATE_HASH, fixture_protected_sha256: e.FIXTURE_HASH, runner_sha256: e.RUNNER_HASH, suite_sha256: e.SUITE_HASH, agent_isolated: e.ISOLATED_VALUE === "true", candidate_contract_schema: 1, cohort_id: cohort.id, executor_cohort: cohort, executor, execution_identity_sha256: e.IDENTITY_HASH }));' > "$OUT/provenance.json"
}

json_array() {
  node -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' "$@"
}


write_executor_cohort() {
  [ -s "$OUT/execution-identity.json" ] || return 1
  EXECUTION_IDENTITY_PATH="$OUT/execution-identity.json" EXECUTOR_COHORT_ID="${BENCH_EXECUTOR_COHORT_ID:-}" node -e 'const fs=require("node:fs"),crypto=require("node:crypto"),e=process.env,identity=JSON.parse(fs.readFileSync(e.EXECUTION_IDENTITY_PATH,"utf8")); const strings=v=>Array.isArray(v)&&v.length>0&&v.every(x=>typeof x==="string"&&x.length>0); const stable=v=>v===null||["boolean","number","string"].includes(typeof v)?JSON.stringify(v):Array.isArray(v)?"["+v.map(stable).join(",")+"]":typeof v==="object"?"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+stable(v[k])).join(",")+"}":JSON.stringify(null); if (identity.schema!==1||!/^(a|b)$/.test(identity.arm)||typeof identity.run_id!=="string") throw new Error("execution identity is malformed"); let cohort; if (identity.kind==="not-invoked") cohort={schema:1,kind:"not-invoked",arms:{}}; else { if (!strings(identity.runtime_flags)||!strings(identity.cli_flags)||!identity.skills||typeof identity.skill_tree_sha256!=="string") throw new Error("execution identity flags or skills are malformed"); cohort={schema:1,image_reference:identity.image_reference,image_identity:identity.image_identity,pi:identity.pi,runtime_flags:identity.runtime_flags,cli_flags:identity.cli_flags,arms:{[identity.arm]:{skills:identity.skills,skill_tree_sha256:identity.skill_tree_sha256}}}; } const derived="executor-cohort-"+crypto.createHash("sha256").update(stable(cohort)).digest("hex").slice(0,24); const id=e.EXECUTOR_COHORT_ID||derived; if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) throw new Error("executor cohort ID is invalid"); cohort.id=id; console.log(JSON.stringify(cohort));' > "$OUT/executor-cohort.json"
}
write_overlay_identity() {
  EXECUTION_RUN_ID="$RUN_ID" EXECUTION_ARM="$ARM" EXECUTION_MODE=overlay \
    "$H/node_modules/.bin/tsx" "$H/execution-identity.ts" --from-env > "$OUT/execution-identity.json"
  write_executor_cohort
}

write_agent_identity() {
  local runtime_flags cli_flags
  runtime_flags=$(json_array "${podman_args[@]}" --entrypoint /usr/bin/timeout) || return 1
  cli_flags=$(json_array "${AGENT_TIMEOUT:-3600}" /opt/pi/bin/pi \
    --provider "$PROVIDER" --model "$MODEL" --print --mode json --no-session --thinking "$THINKING" --approve \
    --tools read,write,edit,bash,grep,find,ls "${pi_flags[@]}" "$PROMPT") || return 1
  EXECUTION_RUN_ID="$RUN_ID" EXECUTION_ARM="$ARM" EXECUTION_MODE=agent \
    EXECUTION_IMAGE_REFERENCE="$pi_image" EXECUTION_PI_PATH="$pi_root/bin/pi" EXECUTION_SKILL_ROOT="$skill_root" \
    EXECUTION_RUNTIME_FLAGS="$runtime_flags" EXECUTION_CLI_FLAGS="$cli_flags" \
    "$H/node_modules/.bin/tsx" "$H/execution-identity.ts" --from-env > "$OUT/execution-identity.json"
  write_executor_cohort
}
apply_overlay() {
  local overlay="$1" rel
  [ -d "$overlay" ] || { echo "overlay does not exist: $overlay" >&2; return 1; }
  for rel in "${WRITABLE_CANDIDATE_PATHS[@]}"; do
    [ -f "$overlay/$rel" ] || continue
    mkdir -p "$(dirname "$CAND/$rel")"
    cp "$overlay/$rel" "$CAND/$rel"
  done
}

write_invalid() {
  local reason="$1"
  RUN_ID="$RUN_ID" MODELFULL="$PROVIDER/$MODEL" ARM="$ARM" INVALID_REASON="$reason" \
    node -e 'console.log(JSON.stringify({schema:2,valid:false,trusted:false,publishable:false,rankable:false,provenance_valid:false,suite_current:false,blocked_by_gate:false,invalid_reasons:[process.env.INVALID_REASON],total:null,run_id:process.env.RUN_ID,model:process.env.MODELFULL,arm:process.env.ARM,invalid:process.env.INVALID_REASON}, null, 2))' \
    > "$OUT/score.json"
}

hydrate_candidate_dependencies() {
  # Pi gets fixture dependencies read-only. The host grader receives a private
  # physical copy: the lockfile cache is intentionally not an online requirement,
  # and hard links would let one candidate mutate the fixture or another run.
  rm -rf "$CAND/node_modules"
  cp -a "$ROOT/fixture/node_modules" "$CAND/node_modules"
}


run_container_probe() {
  local probe_image="${BENCH_AGENT_IMAGE:-docker.io/library/node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3}"
  local skill_root="${BENCH_SKILL_ROOT:-/home/daniel-bo/.agents/skills}"
  local probe_pi_root="${BENCH_PI_ROOT:-/home/daniel-bo/.local/share/fnm/node-versions/v22.22.3/installation}"
  local probe_loopback_port="${BENCH_RUNTIME_PROBE_LOOPBACK_PORT:-9}"
  local probe_host_home_path="${BENCH_RUNTIME_PROBE_HOST_HOME_PATH:-${HOME:-/home/daniel-bo}}"
  local probe_sibling_run_path="${BENCH_RUNTIME_PROBE_SIBLING_RUN_PATH:-$ROOT/runs}"
  local skill arm_a_agents_backup="" probe_contract=phase9 probe_rc
  local -a podman_args

  command -v podman >/dev/null || { echo "podman is required for isolated runtime probes" >&2; return 2; }
  [ -d "$ROOT/fixture/node_modules" ] || { echo "fixture node_modules is unavailable" >&2; return 2; }
  [ -f "$H/runtime-container-probe.cjs" ] || { echo "runtime probe helper is unavailable" >&2; return 2; }
  [ -d "$probe_pi_root" ] || { echo "runtime probe Pi root is unavailable: $probe_pi_root" >&2; return 2; }
  if ! [[ "$probe_loopback_port" =~ ^[0-9]{1,5}$ ]] || (( 10#$probe_loopback_port < 1 || 10#$probe_loopback_port > 65535 )); then
    echo "BENCH_RUNTIME_PROBE_LOOPBACK_PORT must be a valid TCP port" >&2
    return 2
  fi
  for probe_path in "$probe_host_home_path" "$probe_sibling_run_path"; do
    if [[ "$probe_path" != /* ]] || [ ! -d "$probe_path" ]; then
      echo "runtime probe host paths must be existing absolute directories" >&2
      return 2
    fi
  done
  [ "$MODEL" = "phase6-runtime-probe" ] && probe_contract=phase6
  mkdir -p "$CAND/node_modules"
  podman_args=(run --rm --pull=never --read-only
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=512m
    --cap-drop=ALL
    --security-opt=no-new-privileges
    --userns=keep-id
    --user "$(id -u):$(id -g)"
    --network slirp4netns:allow_host_loopback=false
    --workdir /workspace
    --env HOME=/tmp
    --env XDG_CONFIG_HOME=/tmp/config
    --env XDG_CACHE_HOME=/tmp/cache
    --env "BENCH_RUNTIME_PROBE_CONTRACT=$probe_contract"
    --env "BENCH_RUNTIME_PROBE_LOOPBACK_PORT=$probe_loopback_port"
    --env "BENCH_RUNTIME_PROBE_HOST_HOME_PATH=$probe_host_home_path"
    --env "BENCH_RUNTIME_PROBE_SIBLING_RUN_PATH=$probe_sibling_run_path"
    --mount "type=bind,src=$CAND,dst=/workspace,rw"
    --mount "type=bind,src=$ROOT/fixture/node_modules,dst=/workspace/node_modules,ro"
    --mount "type=bind,src=$H/runtime-container-probe.cjs,dst=/opt/runtime-container-probe.cjs,ro"
    --mount "type=bind,src=$probe_pi_root,dst=/opt/pi,ro")

  if [ "$RUNTIME_PROBE" = "container" ]; then
    podman_args+=(--label "lending-desk.runtime-probe=$BENCH_RUNTIME_PROBE_LABEL")
  fi

  case "$ARM" in
    a)
      arm_a_agents_backup="$OUT/arm-a-AGENTS.md"
      ;;
    b)
      for skill in measure next-best-practices vercel-react-best-practices vercel-composition-patterns build-graph; do
        [ -f "$skill_root/$skill/SKILL.md" ] || { echo "required Arm B skill unavailable: $skill" >&2; return 2; }
        podman_args+=(--mount "type=bind,src=$skill_root/$skill,dst=/opt/skills/$skill,ro")
      done
      ;;
    *) echo "arm must be a or b" >&2; return 2 ;;
  esac

  if [ -n "$arm_a_agents_backup" ]; then
    [ -f "$CAND/AGENTS.md" ] || { echo "Arm A candidate AGENTS.md is missing" >&2; return 2; }
    mv "$CAND/AGENTS.md" "$arm_a_agents_backup"
  fi

  if podman "${podman_args[@]}" "$probe_image" node /opt/runtime-container-probe.cjs; then
    probe_rc=0
  else
    probe_rc=$?
  fi
  if [ -n "$arm_a_agents_backup" ]; then
    mv "$arm_a_agents_backup" "$CAND/AGENTS.md" || return 2
  fi
  return "$probe_rc"
}

run_agent_container() {
  local pi_root="${BENCH_PI_ROOT:-/home/daniel-bo/.local/share/fnm/node-versions/v22.22.3/installation}"
  # BENCH_AGENT_IMAGE remains an explicit override; this default is the locally
  # verified Node image digest, so --pull=never cannot silently change it.
  local pi_image="${BENCH_AGENT_IMAGE:-docker.io/library/node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3}"
  local skill_root="${BENCH_SKILL_ROOT:-/home/daniel-bo/.agents/skills}"
  local secret_name="${BENCH_PROVIDER_ENV:-}" skill arm_a_agents_backup="" agent_rc
  local -a podman_args pi_flags

  command -v podman >/dev/null || { echo "podman is required for isolated agent runs" >&2; return 2; }
  [ -x "$pi_root/bin/pi" ] || { echo "Pi installation unavailable: $pi_root" >&2; return 2; }
  [ -d "$ROOT/fixture/node_modules" ] || { echo "fixture node_modules is unavailable" >&2; return 2; }

  # A model gets exactly one provider credential, never the process's full secret set.
  # Custom providers must nominate one of these names explicitly via BENCH_PROVIDER_ENV.
  case "$PROVIDER" in
    openai) secret_name="${BENCH_PROVIDER_ENV:-OPENAI_API_KEY}" ;;
    anthropic) secret_name="${BENCH_PROVIDER_ENV:-ANTHROPIC_API_KEY}" ;;
    openrouter) secret_name="${BENCH_PROVIDER_ENV:-OPENROUTER_API_KEY}" ;;
    google|gemini) secret_name="${BENCH_PROVIDER_ENV:-GOOGLE_API_KEY}" ;;
    deepseek) secret_name="${BENCH_PROVIDER_ENV:-DEEPSEEK_API_KEY}" ;;
    groq) secret_name="${BENCH_PROVIDER_ENV:-GROQ_API_KEY}" ;;
    mistral) secret_name="${BENCH_PROVIDER_ENV:-MISTRAL_API_KEY}" ;;
    xai) secret_name="${BENCH_PROVIDER_ENV:-XAI_API_KEY}" ;;
    together) secret_name="${BENCH_PROVIDER_ENV:-TOGETHER_API_KEY}" ;;
    cerebras) secret_name="${BENCH_PROVIDER_ENV:-CEREBRAS_API_KEY}" ;;
    fireworks) secret_name="${BENCH_PROVIDER_ENV:-FIREWORKS_API_KEY}" ;;
    xiaomi) secret_name="${BENCH_PROVIDER_ENV:-XIAOMI_API_KEY}" ;;
  esac
  case "$secret_name" in
    ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENROUTER_API_KEY|GOOGLE_API_KEY|GEMINI_API_KEY|DEEPSEEK_API_KEY|GROQ_API_KEY|MISTRAL_API_KEY|XAI_API_KEY|TOGETHER_API_KEY|CEREBRAS_API_KEY|FIREWORKS_API_KEY|XIAOMI_API_KEY) ;;
    *) echo "set BENCH_PROVIDER_ENV to one allowlisted provider key for $PROVIDER" >&2; return 2 ;;
  esac
  mkdir -p "$CAND/node_modules"
  podman_args=(run --rm --pull=never --read-only
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=512m
    --cap-drop=ALL
    --security-opt=no-new-privileges
    --userns=keep-id
    --user "$(id -u):$(id -g)"
    --network slirp4netns:allow_host_loopback=false
    --workdir /workspace
    --env HOME=/tmp
    --env XDG_CONFIG_HOME=/tmp/config
    --env XDG_CACHE_HOME=/tmp/cache
    --env PI_CODING_AGENT_DIR=/tmp/pi
    --env PI_TELEMETRY=0
    --env "$secret_name"
    --mount "type=bind,src=$CAND,dst=/workspace,rw"
    --mount "type=bind,src=$ROOT/fixture/node_modules,dst=/workspace/node_modules,ro"
    --mount "type=bind,src=$pi_root,dst=/opt/pi,ro")

  if [ "$RUNTIME_PROBE" = "container" ]; then
    podman_args+=(--label "lending-desk.runtime-probe=$BENCH_RUNTIME_PROBE_LABEL")
  fi

  case "$ARM" in
    a)
      pi_flags=(--no-skills --no-extensions --no-context-files --no-prompt-templates --no-themes)
      arm_a_agents_backup="$OUT/arm-a-AGENTS.md"
      ;;
    b)
      # Arm B reads the candidate's fixture AGENTS.md and the explicit skills below.
      pi_flags=(--no-extensions --no-prompt-templates --no-themes)
      for skill in measure next-best-practices vercel-react-best-practices vercel-composition-patterns build-graph; do
        [ -f "$skill_root/$skill/SKILL.md" ] || { echo "required Arm B skill unavailable: $skill" >&2; return 2; }
        podman_args+=(--mount "type=bind,src=$skill_root/$skill,dst=/opt/skills/$skill,ro")
        pi_flags+=(--skill "/opt/skills/$skill")
      done
      ;;
    *) echo "arm must be a or b" >&2; return 2 ;;
  esac

  write_agent_identity || { echo "could not resolve agent execution identity" >&2; return 2; }
  [ -n "${!secret_name:-}" ] || { echo "missing required provider environment: $secret_name" >&2; return 2; }
  if [ -n "$arm_a_agents_backup" ]; then
    [ -f "$CAND/AGENTS.md" ] || { echo "Arm A candidate AGENTS.md is missing" >&2; return 2; }
    mv "$CAND/AGENTS.md" "$arm_a_agents_backup"
  fi

  if podman "${podman_args[@]}" --entrypoint /usr/bin/timeout "$pi_image" \
    "${AGENT_TIMEOUT:-3600}" /opt/pi/bin/pi \
    --provider "$PROVIDER" --model "$MODEL" \
    --print --mode json --no-session --thinking "$THINKING" --approve \
    --tools read,write,edit,bash,grep,find,ls \
    "${pi_flags[@]}" "$PROMPT"; then
    agent_rc=0
  else
    agent_rc=$?
  fi
  if [ -n "$arm_a_agents_backup" ]; then
    mv "$arm_a_agents_backup" "$CAND/AGENTS.md" || return 2
  fi
  return "$agent_rc"
}


# 0. Host readiness. Checked before the agent runs so a loaded machine costs
# nothing rather than an hour of tokens followed by void timing results.
# 6 means "busy but BENCH_IGNORE_LOAD=1" — proceed; grade.sh flags the record.
if "$H/preflight.sh" "$RUN_ID"; then
  PF=0
else
  PF=$?
fi
[ "$PF" -eq 0 ] || [ "$PF" -eq 6 ] || exit 5

rm -rf "$WORK"; mkdir -p "$OUT"
if [ "$RUNTIME_PROBE" = "ports" ]; then
  runtime_port_probe
fi

# The bounded port probe must publish its allocation promptly. Normal runs
# still resolve the candidate contract before any fixture or agent work.
WRITABLE_PATHS=$("$H/node_modules/.bin/tsx" "$H/candidate-contract.ts" --writable-paths) || { echo "candidate contract allowlist is unavailable" >&2; exit 2; }
mapfile -t WRITABLE_CANDIDATE_PATHS <<< "$WRITABLE_PATHS"
[ "${#WRITABLE_CANDIDATE_PATHS[@]}" -gt 0 ] || { echo "candidate contract allowlist is empty" >&2; exit 2; }
unset WRITABLE_PATHS

echo "[$RUN_ID] $PROVIDER/$MODEL arm=$ARM"

# 1. Fresh fixture, byte-identical between arms.
mkdir -p "$CAND"
tar -C "$ROOT/fixture" --exclude=node_modules --exclude=.next --exclude=.git \
    --exclude='*.tsbuildinfo' -cf - . | tar -C "$CAND" -xf -
# Dependencies are mounted read-only for the agent and symlinked only after verification.


PROMPT='Read measure/tracks/lending_desk/spec.md and measure/tracks/lending_desk/plan.md, then implement the plan. Mark each plan task complete as you finish it. Run "npm run typecheck" and "npm run build" and make sure both pass before you stop.'

if [ "$RUNTIME_PROBE" = "container" ]; then
  echo "[$RUN_ID] running isolated container runtime probe"
  if run_container_probe > "$OUT/session.json" 2> "$OUT/session.err"; then
    exit 0
  else
    PROBE_RC=$?
    exit "$PROBE_RC"
  fi
fi

if [ "$RUNTIME_PROBE" = "dependency-copy" ]; then
  echo "[$RUN_ID] running bounded dependency-copy probe"
  if hydrate_candidate_dependencies; then
    exit 0
  else
    echo "[$RUN_ID] dependency-copy probe could not create a private copy" >&2
    exit 2
  fi
fi
# 2. Agent.
echo "[$RUN_ID] invoking agent..."
START=$(date +%s)
if [ "${AGENT_SKIP:-0}" = "1" ]; then
  RUN_MODE="overlay"; AGENT_ISOLATED=false
  if ! apply_overlay "${OVERLAY:-$ROOT/reference}"; then
    write_invalid "overlay could not be applied"
    exit 3
  fi
  if ! write_overlay_identity; then
    write_invalid "overlay execution identity could not be resolved"
    exit 3
  fi
  AGENT_EXIT=0
  echo "[$RUN_ID] AGENT_SKIP=1 - overlay ${OVERLAY:-$ROOT/reference} applied"
else
  RUN_MODE="agent"; AGENT_ISOLATED=true
  if run_agent_container > "$OUT/session.json" 2> "$OUT/session.err"; then
    AGENT_EXIT=0
  else
    AGENT_EXIT=$?
  fi
fi
END=$(date +%s)
echo "[$RUN_ID] agent exit=$AGENT_EXIT in $((END-START))s"

if ! assert_candidate_contract; then
  echo "[$RUN_ID] ABORT: candidate violates the filesystem contract" >&2
  write_invalid "candidate violates the filesystem contract"
  exit 3
fi
if ! write_provenance; then
  echo "[$RUN_ID] ABORT: candidate provenance could not be written" >&2
  write_invalid "candidate provenance could not be written"
  exit 3
fi

diff -ru "$ROOT/fixture" "$CAND" -x node_modules -x .next -x '*.tsbuildinfo' \
  > "$OUT/candidate.diff" 2>/dev/null || true

# 2b. Did the agent actually run? `pi` exits 0 on a provider error (no API key,
# lapsed token, refused request, unknown model id), which used to produce a graded
# score for an untouched fixture.
#
# Two signals, both about work actually produced:
#   - empty diff        (a-gpt-5.6-luna, 2026-07-31: lapsed OAuth token)
#   - no output tokens  (a-ling-3.0-flash-r1, 2026-08-01: an unresolvable model id
#                        returns one empty turn. Its diff was 1 line, so `! -s` did
#                        not fire, the gate went green, and it scored 3.1 for $0.)
#
# Do NOT add a check on pi's "not found for provider ... using custom model id"
# warning. It is emitted for any id outside pi's local registry and says nothing
# about whether the call succeeds: on 2026-08-01 both inclusionai/ling-3.0-flash
# (0 tokens, dead) and inclusionai/ling-3.0-flash:free (219MB transcript, 23KB diff,
# a real submission) printed it verbatim. Grepping for it aborted the working run.
if [ "${AGENT_SKIP:-0}" != "1" ]; then
  INVALID=""
  [ -s "$OUT/candidate.diff" ] || INVALID="agent produced no changes"
  OUT_TOKENS=$("$H/node_modules/.bin/tsx" "$H/usage.ts" "$OUT/session.json" 2>/dev/null \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('output',0))" 2>/dev/null || echo 0)
  [ "${OUT_TOKENS:-0}" -gt 0 ] 2>/dev/null || INVALID="agent emitted no output tokens"

  if [ -n "$INVALID" ]; then
    echo "[$RUN_ID] ABORT: $INVALID" >&2
    { grep -o '"errorMessage":"[^"]*"' "$OUT/session.json" 2>/dev/null | sort -u | head -3 >&2; } || true
    tail -3 "$OUT/session.err" >&2 2>/dev/null || true
    write_invalid "$INVALID"
    exit 3
  fi
fi

if ! hydrate_candidate_dependencies; then
  echo "[$RUN_ID] ABORT: unable to create private candidate dependencies" >&2
  write_invalid "unable to create private candidate dependencies"
  exit 3
fi

# here is what let it drift out of sync with collect.ts.
if AGENT_EXIT="$AGENT_EXIT" THINKING="$THINKING" API_PORT="$API_PORT" E2E_PORT="$E2E_PORT" \
  "$H/grade.sh" "$RUN_ID" "$PROVIDER/$MODEL" "$ARM" "$((END-START))"; then
  GRADE_RC=0
else
  GRADE_RC=$?
fi

# 6. Compress the transcript. pi repeats the whole message on every message_update,
# so these reach ~1GB each (a-deepseek-v4-flash: 939MB) and the matrix runs every
# model ten times. Done after scoring, since extractUsage reads it; usage.ts accepts
# the .gz form so a later standalone regrade still reports usage.
if [ -s "$OUT/session.json" ]; then
  gzip -f "$OUT/session.json" && echo "[$RUN_ID] transcript compressed -> session.json.gz"
fi
exit $GRADE_RC
