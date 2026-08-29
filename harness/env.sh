# Shared env loader for runner scripts. Source this file; do not execute it.
if [ -z "${_BENCH_ENV_LOADED:-}" ]; then
  _BENCH_ENV_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  _bench_load_env_file() {
    local file="$1" line key val
    [ -f "$file" ] || return 0
    while IFS= read -r line || [ -n "$line" ]; do
      [[ "$line" =~ ^[[:space:]]*# ]] && continue
      [[ "$line" =~ ^[[:space:]]*$ ]] && continue
      [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
      key="${BASH_REMATCH[1]}"
      val="${BASH_REMATCH[2]}"
      val="${val#\"}"; val="${val%\"}"
      val="${val#\'}"; val="${val%\'}"
      if [ -z "${!key:-}" ]; then
        export "$key=$val"
      fi
    done < "$file"
  }
  _bench_load_env_file "$_BENCH_ENV_ROOT/.env"
  _bench_load_env_file "$_BENCH_ENV_ROOT/.env.local"
  if [ -z "${BENCH_PI_ROOT:-}" ] && command -v pi >/dev/null; then
    _bench_pi="$(command -v pi)"
    if [ -x "$_bench_pi" ]; then
      export BENCH_PI_ROOT="$(cd "$(dirname "$_bench_pi")/.." && pwd)"
    fi
  fi
  if [ -z "${BENCH_SKILL_ROOT:-}" ] && [ -d "${HOME}/.agents/skills" ]; then
    export BENCH_SKILL_ROOT="${HOME}/.agents/skills"
  fi
  export _BENCH_ENV_LOADED=1
fi
