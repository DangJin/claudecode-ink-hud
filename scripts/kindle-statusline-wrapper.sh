#!/bin/bash
# Wrapper: pushes metrics to local Kindle server, then pipes stdin to claude-hud

KINDLE_URL="${KINDLE_STATUS_URL:-http://localhost:3456}"

stdin_data=$(cat)

(
  if [ -z "$stdin_data" ] || ! command -v jq &>/dev/null; then exit 0; fi

  model=$(echo "$stdin_data" | jq -r '.model.display_name // .model.id // ""' 2>/dev/null)
  ctx_pct=$(echo "$stdin_data" | jq -r '.context_window.used_percentage // ""' 2>/dev/null)
  usage_5h=$(echo "$stdin_data" | jq -r '.rate_limits.five_hour.used_percentage // ""' 2>/dev/null)
  usage_7d=$(echo "$stdin_data" | jq -r '.rate_limits.seven_day.used_percentage // ""' 2>/dev/null)

  payload=$(jq -n --arg mo "$model" --arg cp "$ctx_pct" --arg h5 "$usage_5h" --arg d7 "$usage_7d" \
    '{type:"statusline",model:$mo,contextPercent:$cp,usage5h:$h5,usage7d:$d7}')

  curl -s -X POST "${KINDLE_URL}/status" -H "Content-Type: application/json" -d "$payload" > /dev/null 2>&1
) &

plugin_dir=$(ls -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/claude-hud/claude-hud/*/ 2>/dev/null | awk -F/ '{ print $(NF-1) "\t" $(0) }' | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | tail -1 | cut -f2-)
echo "$stdin_data" | exec bun --env-file /dev/null "${plugin_dir}src/index.ts"
