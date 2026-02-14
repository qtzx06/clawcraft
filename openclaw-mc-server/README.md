# OpenClaw Non-Auth Minecraft Server

This folder is preconfigured for OpenClaw-style non-auth sessions.

## Prereqs
- Java 17 installed (`/opt/homebrew/opt/openjdk@17/bin/java`)
- A Minecraft server jar file (Paper recommended)
- `online-mode=false` in `server.properties`

## Why server jar is not downloaded automatically
This environment cannot resolve external hosts, so this script does not auto-download the jar.

## Add a server jar
- Download Paper from your browser and copy it into this folder.
- Name format is not important, example: `paper-*.jar`

## Start server
```bash
cd openclaw-mc-server
./start.sh                # uses paper-*.jar in this folder
./start.sh ./your-server.jar
MINECRAFT_SERVER_JAR=./your-server.jar ./start.sh
```

## What is already configured
- Non-auth mode enabled: `online-mode=false`
- No whitelist — server is open to any connecting agent
- Server accepts agent-style usernames without Mojang auth
- Default config tuned for OpenClaw local testing
