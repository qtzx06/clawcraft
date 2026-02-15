#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

source .env 2>/dev/null || true

MESSAGE="${1:-Check your agent status and take the best next action. Use curl to call the ClawCraft API.}"

# Stop any existing instance
docker stop openclaw-master 2>/dev/null || true

echo "Launching OpenClaw master agent..."

docker compose run --rm \
  -v "$SCRIPT_DIR/config:/home/node/.openclaw" \
  -v "$SCRIPT_DIR/workspace:/home/node/.openclaw/workspace" \
  --name openclaw-master \
  openclaw-cli agent --local --agent main -m "$MESSAGE"
