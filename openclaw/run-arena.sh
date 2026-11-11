#!/usr/bin/env bash
# Launch N autonomous OpenClaw agents.
# Each one registers its own team, names itself, and controls one bot.
#
# Usage:
#   ./run-arena.sh          # launch 4 agents (default)
#   ./run-arena.sh 2        # launch 2 agents
#   ./run-arena.sh stop     # stop all

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source .env 2>/dev/null || true

COUNT="${1:-4}"
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Stop all running arena agents
stop_all() {
  echo -e "${YELLOW}Stopping all arena agents...${NC}"
  for i in $(seq 1 20); do
    docker stop "openclaw-arena-${i}" 2>/dev/null && echo "  stopped openclaw-arena-${i}" || true
  done
  echo -e "${GREEN}Done.${NC}"
}

if [[ "$COUNT" == "stop" ]]; then
  stop_all
  exit 0
fi

echo -e "${CYAN}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║  🦞 Launching ${COUNT} OpenClaw Arena Agents 🦞  ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${NC}"

# Stop any existing instances first
stop_all 2>/dev/null

# Ensure template workspace exists
TEMPLATE="$SCRIPT_DIR/workspace"
if [ ! -f "$TEMPLATE/SOUL.md" ]; then
  echo -e "${RED}error: template workspace not found at $TEMPLATE${NC}"
  exit 1
fi

for i in $(seq 1 "$COUNT"); do
  ARENA_DIR="$SCRIPT_DIR/arena/agent-${i}"
  CONFIG_DIR="$ARENA_DIR/config"

  # Create fresh workspace from template (keep if already exists for memory persistence)
  mkdir -p "$ARENA_DIR" "$CONFIG_DIR"

  # Sync openclaw.json config (model settings) if not present or always update
  if [ -f "$SCRIPT_DIR/config/openclaw.json" ]; then
    cp "$SCRIPT_DIR/config/openclaw.json" "$CONFIG_DIR/openclaw.json"
  fi

  # Always sync skill and AGENTS.md from template (they may have been updated)
  mkdir -p "$ARENA_DIR/skills/clawcraft"
  if [ -f "$TEMPLATE/skills/clawcraft/SKILL.md" ]; then
    cp "$TEMPLATE/skills/clawcraft/SKILL.md" "$ARENA_DIR/skills/clawcraft/SKILL.md"
  fi
  if [ -f "$TEMPLATE/AGENTS.md" ]; then
    cp "$TEMPLATE/AGENTS.md" "$ARENA_DIR/AGENTS.md"
  fi

  # Only copy SOUL.md if it doesn't exist yet (agent may have modified it)
  if [ ! -f "$ARENA_DIR/SOUL.md" ]; then
    cp "$TEMPLATE/SOUL.md" "$ARENA_DIR/SOUL.md"
  fi

  # Fresh MEMORY.md if doesn't exist
  if [ ! -f "$ARENA_DIR/MEMORY.md" ]; then
    cat > "$ARENA_DIR/MEMORY.md" << 'MEMEOF'
# Memory

## ClawCraft
- **Status:** New agent, not yet registered
- **API:** http://minecraft.opalbot.gg:3000
MEMEOF
  fi

  echo -e "${GREEN}Launching: agent-${i}${NC}"

  docker compose run -d --rm \
    -e "SOUL_NAME=arena-agent-${i}" \
    -e "AGENT_NUMBER=${i}" \
    -v "$CONFIG_DIR:/home/node/.openclaw" \
    -v "$ARENA_DIR:/home/node/.openclaw/workspace" \
    -v "$SCRIPT_DIR/loop.sh:/home/node/loop.sh:ro" \
    --name "openclaw-arena-${i}" \
    --entrypoint bash \
    openclaw-cli /home/node/loop.sh \
    2>&1 | tail -1

  echo ""
done

echo -e "${CYAN}${COUNT} arena agents launched!${NC}"
echo ""
echo -e "${YELLOW}Watch logs:${NC}"
for i in $(seq 1 "$COUNT"); do
  echo "  docker logs -f openclaw-arena-${i}"
done
echo ""
echo -e "${YELLOW}Check teams:${NC}"
echo "  curl -s http://minecraft.opalbot.gg:3000/teams | jq"
echo ""
echo -e "${YELLOW}Stop all:${NC}"
echo "  ./run-arena.sh stop"
echo ""
