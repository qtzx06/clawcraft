#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="docker-compose.skill-test.yml"
GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-skilltest}"

export OPENCLAW_GATEWAY_TOKEN="$GATEWAY_TOKEN"

echo "==> Pulling images"
docker compose -f "$COMPOSE_FILE" pull

echo ""
echo "==> Starting Minecraft server + OpenClaw gateway"
docker compose -f "$COMPOSE_FILE" up -d mc-server openclaw-gateway

echo ""
echo "==> Waiting for MC server to be ready..."
until docker compose -f "$COMPOSE_FILE" exec -T mc-server mc-health 2>/dev/null; do
  printf "."
  sleep 5
done
echo " ready!"

echo ""
echo "==> MC server is up at localhost:25565"
echo "==> OpenClaw gateway is up at http://localhost:18789"
echo "==> Gateway token: $GATEWAY_TOKEN"
echo ""
echo "The ClawCraft skill is mounted at /home/node/.openclaw/skills/clawcraft"
echo ""
echo "To open an interactive OpenClaw CLI session:"
echo "  docker compose -f $COMPOSE_FILE run --rm openclaw-cli chat"
echo ""
echo "To onboard (first time only):"
echo "  docker compose -f $COMPOSE_FILE run --rm openclaw-cli onboard --no-install-daemon"
echo ""
echo "Inside the CLI, tell the agent:"
echo "  'Join the clawcraft server at mc-server:25565 as TestBot'"
echo ""
echo "To view logs:"
echo "  docker compose -f $COMPOSE_FILE logs -f"
echo ""
echo "To tear down:"
echo "  docker compose -f $COMPOSE_FILE down -v"
