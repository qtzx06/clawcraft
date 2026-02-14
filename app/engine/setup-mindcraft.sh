#!/usr/bin/env bash
set -euo pipefail

REPO_URL=${1:-"${MINDCRAFT_REPO_URL:-https://github.com/davidwcode/mindcraft}"}
TARGET_DIR=${2:-"external/mindcraft"}

if [ -d "$TARGET_DIR/.git" ]; then
  echo "Mindcraft already exists at $TARGET_DIR"
  exit 0
fi

if [ -f ".gitmodules" ]; then
  git submodule update --init --recursive "$TARGET_DIR"
else
  git clone "$REPO_URL" "$TARGET_DIR"
  echo "Mindcraft checkout created at $TARGET_DIR"
fi
echo "Set MINDCRAFT_PATH=$TARGET_DIR when connecting an agent"
