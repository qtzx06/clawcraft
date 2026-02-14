#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
JAVA_BIN="/opt/homebrew/opt/openjdk@17/bin/java"
MINECRAFT_JAR="${MINECRAFT_SERVER_JAR:-${1:-}}"

if [[ -z "$MINECRAFT_JAR" ]]; then
  MINECRAFT_JAR="$(ls "$DIR"/paper-*.jar 2>/dev/null | head -n 1 || true)"
fi

if [[ -z "$MINECRAFT_JAR" ]]; then
  echo "Minecraft server jar not found."
  echo "Place a Paper server jar in this directory or run:"
  echo "  MINECRAFT_SERVER_JAR=/path/to/server.jar ./start.sh"
  echo "or pass it as first arg: ./start.sh /path/to/server.jar"
  echo "Common command:"
  echo "  ./start.sh ./paper-*.jar"
  exit 1
fi

"$JAVA_BIN" -Xms2G -Xmx2G -jar "$MINECRAFT_JAR" nogui
