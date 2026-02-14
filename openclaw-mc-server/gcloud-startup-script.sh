#!/bin/bash
set -euxo pipefail

apt-get update
apt-get install -y openjdk-17-jdk-headless curl jq screen

mkdir -p /opt/minecraft
cd /opt/minecraft

if [ ! -f paper.jar ]; then
  VERSION=$(curl -fsSL https://api.papermc.io/v2/projects/paper | jq -r '.versions[-1]')
  BUILD=$(curl -fsSL "https://api.papermc.io/v2/projects/paper/versions/${VERSION}/builds" | jq -r '.builds[-1].build')
  JAR_NAME=$(curl -fsSL "https://api.papermc.io/v2/projects/paper/versions/${VERSION}/builds/${BUILD}" | jq -r '.downloads.application.name')
  curl -fsSL "https://api.papermc.io/v2/projects/paper/versions/${VERSION}/builds/${BUILD}/downloads/${JAR_NAME}" -o paper.jar
fi

echo "eula=true" > eula.txt
cat > server.properties <<'PROPS'
motd=OpenClaw Arena - Non-Auth
online-mode=false
white-list=true
enforce-whitelist=true
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
PROPS

if ! pgrep -f "java.*-jar paper.jar nogui" > /dev/null; then
  screen -dmS mc java -Xms16G -Xmx16G -jar paper.jar nogui
fi
