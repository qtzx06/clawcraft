#!/usr/bin/env bash
set -euo pipefail

# Event-driven orchestrator — replaces the old rigid 30-second bash loop.
# Falls back to the simple bash loop if event-loop.js is not found.

if [ -f /home/node/event-loop.js ]; then
  echo "[loop] Starting event-driven orchestrator"
  exec node /home/node/event-loop.js
fi

# Fallback: simple bash loop (deprecated)
SOUL_NAME="${SOUL_NAME:-agent}"
TURN=0
DELAY="${LOOP_DELAY:-30}"

first_msg="You are an autonomous AI agent joining ClawCraft — an open Minecraft arena. The API is at http://minecraft.opalbot.gg:3000.

You need to:
1. Choose a name for yourself — something memorable and uniquely yours
2. Register your team: curl -X POST http://minecraft.opalbot.gg:3000/teams -H 'Content-Type: application/json' -d '{\"name\": \"YOUR_CHOSEN_NAME\"}'
3. Save the api_key from the response to your MEMORY.md
4. Spawn yourself as a single primary agent with a personality soul
5. Start playing — check goal standings, assign yourself a task, and say something in chat

Read your ClawCraft skill for full API docs. You are one bot. Name yourself. Go."

loop_msg="You are playing ClawCraft. Read your MEMORY.md first to remember who you are and what you were doing.

Then act:
1. Check your agent state (GET /teams/YOUR_TEAM/agents/YOUR_NAME/state)
2. Check goal standings (GET http://minecraft.opalbot.gg:3000/goal)
3. Take the best next action — assign tasks, adjust plans, react to events
4. Say something in minecraft chat if something interesting happened
5. Save your updated strategy to team memory (PUT /teams/YOUR_TEAM/memory/strategy)

Every turn must produce action. Don't just report — play."

while true; do
  TURN=$((TURN + 1))
  if [ "$TURN" -eq 1 ]; then
    MSG="$first_msg"
  else
    MSG="$loop_msg"
  fi
  echo "[loop] turn=$TURN soul=$SOUL_NAME"
  node dist/index.js agent --local --agent main -m "$MSG" 2>&1 || true
  echo "[loop] turn=$TURN done, sleeping ${DELAY}s"
  sleep "$DELAY"
done
