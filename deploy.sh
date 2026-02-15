#!/usr/bin/env bash
# Deploy ClawCraft stack to a Hetzner box over SSH.
#
# Required:
#   HETZNER_HOST or HETZNER_IP
#
# Optional:
#   SSH_USER=root
#   REMOTE_DIR=/opt/clawcraft
#   BRANCH=main
#   REPO_URL=<git remote url>    # if set, remote clone/pull mode
#   LOCAL_ENV_FILE=.env

set -euo pipefail

HOST="${HETZNER_HOST:-${HETZNER_IP:-}}"
SSH_USER="${SSH_USER:-root}"
REMOTE_DIR="${REMOTE_DIR:-/opt/clawcraft}"
BRANCH="${BRANCH:-main}"
REPO_URL="${REPO_URL:-}"
LOCAL_ENV_FILE="${LOCAL_ENV_FILE:-.env}"

if [[ -z "$HOST" ]]; then
  echo "error: set HETZNER_HOST or HETZNER_IP"
  exit 1
fi

if [[ ! -f "$LOCAL_ENV_FILE" ]]; then
  echo "error: local env file not found: $LOCAL_ENV_FILE"
  exit 1
fi

TARGET="${SSH_USER}@${HOST}"

echo "==> verifying ssh connectivity: ${TARGET}"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$TARGET" "echo ok" >/dev/null

echo "==> ensuring docker is installed"
ssh "$TARGET" '
  set -e
  if ! command -v git >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      apt-get update -y >/dev/null
      apt-get install -y git >/dev/null
    fi
  fi
  if ! command -v docker >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sh
  fi
  systemctl enable docker >/dev/null 2>&1 || true
  systemctl start docker >/dev/null 2>&1 || true
'

if [[ -n "$REPO_URL" ]]; then
  echo "==> syncing code via git clone/pull (${REPO_URL} @ ${BRANCH})"
  ssh "$TARGET" "
    set -e
    mkdir -p \"$REMOTE_DIR\"
    if [ ! -d \"$REMOTE_DIR/.git\" ]; then
      rm -rf \"$REMOTE_DIR\"
      git clone \"$REPO_URL\" \"$REMOTE_DIR\"
    fi
    cd \"$REMOTE_DIR\"
    git fetch --all --prune
    git checkout \"$BRANCH\"
    git pull --ff-only origin \"$BRANCH\"
    git submodule sync --recursive
    git submodule update --init --recursive
  "
else
  echo "==> syncing code via rsync (local workspace -> remote)"
  rsync -az --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude 'app/node_modules' \
    --exclude 'app/dist' \
    --exclude '.env' \
    ./ "$TARGET:$REMOTE_DIR/"
fi

echo "==> uploading env file"
scp "$LOCAL_ENV_FILE" "$TARGET:$REMOTE_DIR/.env" >/dev/null

echo "==> building and starting services"
ssh "$TARGET" "
  set -e
  cd \"$REMOTE_DIR\"
  docker compose up -d --build --remove-orphans
"

echo "==> deploy complete"
echo "minecraft: ${HOST}:25565"
echo "api:       http://${HOST}:3000/health"
