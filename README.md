# ClawCraft Observability

This repository contains three Node services:

- `bot-observe` (`app/bot-observe.js`)
- `x402-gateway` (`app/x402-gateway.js`)

## Docker

Build and run both services with Docker Compose:

```bash
cp .env.example .env  # optional: adjust values first
docker compose up --build
```

Services:

- `bot-observe` on `3007` (viewer) and `9464` (metrics)
- `x402-gateway` on `3100` (API) and `9465` (metrics host mapping)
- `mindflayer-agent` on `3009` (health/status/control API)
- `openclaw-agent` on `3008` (command-only control API)

x402 helper:

- `app/x402-client.js` provides `requestWithPayment(url, options, opts)` for automatic 402 retry + signature challenge flow.

If you want a bot that actually does gameplay actions, use the mindflayer bot:

- `start:mindflayer` on port `3009` (`/health`, `/status`, `/mode`, `/say`, `/metrics`)
- Supports autonomous cycles: follows nearby players, hunts nearby hostile entities, harvests nearby blocks, and wanders when idle.

Run a single service:

```bash
docker compose up --build bot-observe
docker compose up --build x402-gateway
```

To run locally in the container directly:

```bash
docker build -t clawcraft .
docker run --rm --env-file .env -p 3007:3007 -p 9464:9464 clawcraft
```

## OpenClaw local agent test setup

Use this when you want a local OpenClaw-style agent to run from this repo and connect to your Minecraft server.

```bash
cp .env.example .env   # then edit .env for your OpenClaw server
```

Set at minimum:

- `MC_HOST=host.docker.internal` (if your MC server is on the host machine)
- `MC_PORT=25565`
- `OPENCLAW_AGENT_USERNAME=<agent username>`

Run:

```bash
docker compose -f docker-compose.openclaw.yml up --build
```

`docker-compose.openclaw.yml` contains two bot services:

- `openclaw-agent`: simple command-response bot
- `mindflayer-agent`: autonomous gameplay bot

Your openclaw-agent will post connection logs and chat commands:

- `COMMAND_PREFIX=!` responds:
  - `!ping` -> `pong <username>`
- `!where` -> current coordinates
- `mindflayer-agent` also supports:
  - `/mode` API POST with `{ "mode": "auto|collect|wander|defend|follow|idle" }`
  - chat commands `!mode`, `!follow`, `!harvest`, `!wander`, `!where`
- health/status endpoint: `http://localhost:3008/health`

You can also send a message via API:

```bash
curl -X POST http://localhost:3008/say \
  -H 'content-type: application/json' \
  -d '{"message":"hello from control plane"}'
```
