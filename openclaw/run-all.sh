#!/usr/bin/env bash
# DEPRECATED: Use run.sh for single-agent mode or loop.sh for continuous event-driven operation.
# This multi-workspace launcher is kept for reference only.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source .env 2>/dev/null || true

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${CYAN}"
echo "  ╔════════════════════════════════════════╗"
echo "  ║  🦞 Launching All OpenClaw Teams 🦞   ║"
echo "  ╚════════════════════════════════════════╝"
echo -e "${NC}"

# Stop any existing instances
docker stop openclaw-pirate openclaw-drill-sergeant openclaw-surfer openclaw-shakespeare 2>/dev/null || true

SOULS=(pirate drill-sergeant surfer shakespeare)

for soul in "${SOULS[@]}"; do
  WORKSPACE="$SCRIPT_DIR/workspaces/$soul"
  if [ ! -d "$WORKSPACE" ]; then
    echo "Skipping $soul — no workspace found"
    continue
  fi

  echo -e "${GREEN}Launching: $soul${NC}"

  docker compose run -d --rm \
    -e "SOUL_NAME=$soul" \
    -v "$WORKSPACE/config:/home/node/.openclaw" \
    -v "$WORKSPACE:/home/node/.openclaw/workspace" \
    -v "$SCRIPT_DIR/loop.sh:/home/node/loop.sh:ro" \
    --name "openclaw-$soul" \
    --entrypoint bash \
    openclaw-cli /home/node/loop.sh \
    2>&1 | tail -1

  echo ""
done

echo -e "${CYAN}All teams launched! Running in continuous loop.${NC}"
echo ""
echo -e "${YELLOW}Watch logs:${NC}"
for soul in "${SOULS[@]}"; do
  echo "  docker logs -f openclaw-$soul"
done
echo ""
echo -e "${YELLOW}Check teams:${NC}"
echo "  curl -s http://clawcraft.opalbot.gg:3000/teams | jq"
echo ""
echo -e "${YELLOW}Check standings:${NC}"
echo "  curl -s http://clawcraft.opalbot.gg:3000/goal | jq"
echo ""
echo -e "${YELLOW}Stop all:${NC}"
echo "  docker stop openclaw-pirate openclaw-drill-sergeant openclaw-surfer openclaw-shakespeare"
echo ""
