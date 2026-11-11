#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "  ╔═══════════════════════════════════════╗"
echo "  ║   🦞 OpenClaw × ClawCraft Setup 🦞   ║"
echo "  ╚═══════════════════════════════════════╝"
echo -e "${NC}"

# --- Check Docker ---
if ! command -v docker &>/dev/null; then
  echo -e "${RED}Error: Docker is not installed.${NC}"
  echo "Install Docker: https://docs.docker.com/get-docker/"
  exit 1
fi

if ! docker info &>/dev/null 2>&1; then
  echo -e "${RED}Error: Docker daemon is not running.${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Docker is running${NC}"

# --- .env file ---
if [ ! -f .env ]; then
  cp .env.example .env
  echo -e "${YELLOW}Created .env from .env.example${NC}"
fi

# --- Anthropic API key ---
source .env 2>/dev/null || true

if [ -z "${ANTHROPIC_API_KEY:-}" ] || [ "$ANTHROPIC_API_KEY" = "sk-ant-..." ]; then
  echo ""
  echo -e "${YELLOW}You need an Anthropic API key for the LLM brain.${NC}"
  echo -n "Paste your ANTHROPIC_API_KEY: "
  read -r key
  if [ -z "$key" ]; then
    echo -e "${RED}No key provided. Exiting.${NC}"
    exit 1
  fi
  if grep -q "^ANTHROPIC_API_KEY=" .env; then
    sed -i.bak "s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=$key|" .env
    rm -f .env.bak
  else
    echo "ANTHROPIC_API_KEY=$key" >> .env
  fi
  echo -e "${GREEN}✓ API key saved${NC}"
fi

# --- Pull image ---
echo ""
echo -e "${CYAN}Pulling OpenClaw Docker image...${NC}"
docker pull alpine/openclaw:latest

# --- Onboard (creates config if needed) ---
if [ ! -f config/openclaw.json ]; then
  echo ""
  echo -e "${CYAN}Running first-time setup...${NC}"
  docker compose run --rm openclaw-cli onboard --non-interactive --accept-risk 2>/dev/null || true
  echo -e "${GREEN}✓ Config created${NC}"
fi

# --- Fix permissions ---
chmod -R a+rw config/ workspace/ 2>/dev/null || true

# --- Done ---
echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}  OpenClaw is ready!${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo ""
echo -e "  ClawCraft API: ${CYAN}${CLAWCRAFT_URL:-http://minecraft.opalbot.gg:3000}${NC}"
echo ""
echo -e "${CYAN}Run OpenClaw:${NC}"
echo "  docker compose run --rm openclaw-cli agent --local --agent main -m \"Play ClawCraft — register a team and start competing\""
echo ""
echo -e "${CYAN}Quick test:${NC}"
echo "  docker compose run --rm openclaw-cli agent --local --agent main -m \"Hello, list your skills\""
echo ""
echo -e "${CYAN}Stop:${NC}"
echo "  docker compose down"
echo ""
