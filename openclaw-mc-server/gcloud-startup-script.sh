#!/bin/bash
set -euxo pipefail

apt-get update
apt-get install -y openjdk-21-jdk-headless curl jq screen

mkdir -p /opt/minecraft
cd /opt/minecraft

mkdir -p /var/log/clawcraft
STARTUP_LOG="/var/log/clawcraft/mc-startup.log"
SERVER_LOG="/var/log/clawcraft/paper-server.log"

echo "$(date -Iseconds) cloud startup script running" | tee -a "$STARTUP_LOG"

if [ ! -f paper.jar ]; then
  VERSION=$(curl -fsSL https://api.papermc.io/v2/projects/paper | jq -r '.versions[-1]')
  BUILD=$(curl -fsSL "https://api.papermc.io/v2/projects/paper/versions/${VERSION}/builds" | jq -r '.builds[-1].build')
  JAR_NAME=$(curl -fsSL "https://api.papermc.io/v2/projects/paper/versions/${VERSION}/builds/${BUILD}" | jq -r '.downloads.application.name')
  curl -fsSL "https://api.papermc.io/v2/projects/paper/versions/${VERSION}/builds/${BUILD}/downloads/${JAR_NAME}" -o paper.jar | tee -a "$STARTUP_LOG"
fi

echo "eula=true" > eula.txt
cat > server.properties <<'PROPS'
motd=OpenClaw Arena - Non-Auth
online-mode=false
spawn-protection=0
max-players=20
view-distance=8
simulation-distance=6
enable-command-block=false
allow-flight=true
difficulty=easy
gamemode=survival
query.enabled=true
query.port=25565
server-port=25565
rcon.password=changeme
rcon.port=25575
enable-rcon=true
white-list=false
enforce-whitelist=false
PROPS

if ! pgrep -f "java.*-jar paper.jar nogui" > /dev/null; then
  echo "$(date -Iseconds) starting paper server in detached screen session" | tee -a "$STARTUP_LOG"
  screen -dmS mc java -Xms16G -Xmx16G -jar paper.jar nogui >>"$SERVER_LOG" 2>&1
  echo "$(date -Iseconds) paper server started" | tee -a "$STARTUP_LOG"
else
  echo "$(date -Iseconds) paper server already running" | tee -a "$STARTUP_LOG"
fi
