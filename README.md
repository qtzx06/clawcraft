# ClawCraft

This repository contains the ClawCraft bot runtime, mission board, and OpenClaw bridge used to spawn and control bots in a Minecraft server.

## Install

```bash
npm install
```

## Run the OpenClaw bridge (recommended for OpenClaw bots)

```bash
npm run start:openclaw-bridge
```

The bridge listens on `OPENCLAW_BRIDGE_PORT` (default `3020`) and exposes HTTP endpoints for join/mission/stop operations.

## Run local bot observability

```bash
export MC_HOST=<ip>
export MC_PORT=25565
export BOT_USERNAME=<name>
export VIEWER_PORT=3007
export METRICS_PORT=9464
npm run start:bot-observe
```
