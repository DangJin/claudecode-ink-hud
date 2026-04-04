#!/bin/bash
# Claude Code hook — writes status to local Kindle server (zero cloud, zero cost)

KINDLE_URL="${KINDLE_STATUS_URL:-http://localhost:3456}"

input=$(cat)

(
  tool=$(echo "$input" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -z "$tool" ] && exit 0

  file=$(echo "$input" | grep -o '"file_path":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -z "$file" ]; then
    file=$(echo "$input" | grep -o '"command":"[^"]*"' | head -1 | cut -d'"' -f4 | head -c 80)
  fi

  session_file=$(ls -t ~/.claude/sessions/*.json 2>/dev/null | head -1)
  project="" ; session_start=""
  if [ -n "$session_file" ]; then
    project=$(grep -o '"cwd":"[^"]*"' "$session_file" | head -1 | cut -d'"' -f4)
    session_start=$(grep -o '"startedAt":[0-9]*' "$session_file" | head -1 | cut -d: -f2)
  fi

  git_branch="" ; git_status=""
  work_dir="${project:-$(pwd)}"
  if git -C "$work_dir" rev-parse --git-dir &>/dev/null; then
    git_branch=$(git -C "$work_dir" rev-parse --abbrev-ref HEAD 2>/dev/null)
    git_modified=$(git -C "$work_dir" diff --numstat 2>/dev/null | wc -l | tr -d ' ')
    git_staged=$(git -C "$work_dir" diff --cached --numstat 2>/dev/null | wc -l | tr -d ' ')
    git_untracked=$(git -C "$work_dir" ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ')
    git_status="+${git_staged} ~${git_modified} ?${git_untracked}"
  fi

  [ -n "$file" ] && message="Using ${tool} on ${file}" || message="Using ${tool}"

  # jq strongly recommended: brew install jq
  if command -v jq &>/dev/null; then
    payload=$(jq -n --arg t "$tool" --arg f "$file" --arg m "$message" \
      --arg p "$project" --arg ss "$session_start" --arg gb "$git_branch" --arg gs "$git_status" \
      '{tool:$t,file:$f,message:$m,project:$p,sessionStart:$ss,gitBranch:$gb,gitStatus:$gs}')
  else
    # Fallback: strip all quotes and backslashes from values to produce safe JSON
    clean() { echo "$1" | tr -d '"\\\n\r'; }
    payload="{\"tool\":\"$(clean "$tool")\",\"file\":\"$(clean "$file")\",\"message\":\"$(clean "$message")\",\"project\":\"$(clean "$project")\",\"sessionStart\":\"${session_start}\",\"gitBranch\":\"$(clean "$git_branch")\",\"gitStatus\":\"$(clean "$git_status")\"}"
  fi

  curl -s -X POST "${KINDLE_URL}/status" -H "Content-Type: application/json" -d "$payload" > /dev/null 2>&1
) &

exit 0
