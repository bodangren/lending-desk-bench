#!/usr/bin/env bash
# Ark Agent Plan provider support for the OpenCode benchmark runner.
#
#   ark_is_route <provider> <model>   true for the two trial routes only
#   ark_is_ref <provider/model>       true for the two trial routes only
#   ark_config_file                   the operator opencode.json path on stdout
#   ark_quota_check                   true when the 5h and weekly windows are under 95 %
#
# Source this file; do not execute it. The helper reads no credential and
# writes no file. The quota check runs `arkcli usage plan` and parses its JSON.
ARK_PROVIDER="volcengine-agent-plan"
ARK_MODEL_FLASH="glm-5.3-flash"
ARK_MODEL_EVOLVING="doubao-seed-evolving"
ARK_QUOTA_LIMIT=95

ark_is_route() {
  [ "$1" = "$ARK_PROVIDER" ] || return 1
  case "$2" in
    "$ARK_MODEL_FLASH"|"$ARK_MODEL_EVOLVING") return 0 ;;
  esac
  return 1
}

ark_is_ref() {
  case "$1" in
    "$ARK_PROVIDER/$ARK_MODEL_FLASH"|"$ARK_PROVIDER/$ARK_MODEL_EVOLVING") return 0 ;;
  esac
  return 1
}

ark_config_file() {
  printf '%s\n' "${BENCH_ARK_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode/opencode.json}"
}

ark_quota_check() {
  local bin out rc=0
  bin="$(command -v arkcli || true)"
  [ -n "$bin" ] || return 2
  out="$("$bin" usage plan 2>/dev/null)" || return 2
  printf '%s\n' "$out" | ARK_QUOTA_LIMIT="$ARK_QUOTA_LIMIT" node -e '
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) process.exit(2);
  let doc;
  try { doc = JSON.parse(raw.slice(start, end + 1)); } catch { process.exit(2); }
  if (!doc || !Array.isArray(doc.items)) process.exit(2);
  const windows = {};
  for (const item of doc.items) {
    if (!item || !Array.isArray(item.periods)) continue;
    for (const period of item.periods) {
      if (!period || typeof period.label !== "string") continue;
      const value = period.percent;
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) windows[period.label] = value;
    }
  }
  const five = windows["5h"];
  const week = windows["weekly"];
  if (typeof five !== "number" || typeof week !== "number") process.exit(2);
  const limit = Number(process.env.ARK_QUOTA_LIMIT);
  if (!Number.isFinite(limit)) process.exit(2);
  if (five >= limit || week >= limit) process.exit(1);
  process.exit(0);
});
' || rc=$?
  return "$rc"
}
