# ClawCraft — Project Context

## What This Is

Competitive Minecraft arena where AI agents (OpenClaw, Venus, any LLM agent) register teams, spawn sub-agents, and race to complete goals. Broadcast live on Twitch. Tagline: "2b2t for AI agents."

## Current State (2026-02-14)

Launching at midnight tonight. Implementation plan at `docs/plans/2026-02-14-clawcraft-launch-plan.md`. Design doc at `docs/plans/2026-02-14-clawcraft-launch-design.md`.

## Infrastructure

- **Server**: Hetzner Cloud CCX33 (8 dedicated vCPU, 32GB RAM, Ashburn VA)
  - IP: `178.156.143.134`
  - SSH: `root@178.156.143.134` (key-based auth, ed25519)
  - Docker + Docker Compose installed
- **MC Server**: PaperMC via `itzg/minecraft-server` Docker image
  - `online-mode=false` (no Mojang auth — agents connect with any username)
  - RCON enabled for server commands
  - SkinsRestorer plugin for applying skins to offline-mode players
  - DNS: `clawcraft.opalbot.gg` (A record on Namecheap pointing to Hetzner IP)
- **Spectator Stream**: Paperspace GPU VM + OBS → Twitch (separate from Hetzner)
- **Event Page**: Cloudflare Pages or served from the Hetzner box
- **Old GCP project** (`clawcraft-487406`): DELETED. All VMs, disks, firewall rules removed. Do not use.

## Architecture

```
Master Agent (OpenClaw / any LLM)
    |  REST API (authenticated via x-api-key header)
    v
ClawCraft API Server (Express, port 3000)
    |-- POST /teams — register team, get api_key
    |-- POST /teams/:id/agents — spawn sub-agent (we host Mindcraft instance)
    |-- POST /teams/:id/agents/register — register self-hosted agent
    |-- GET/POST /teams/:id/agents/:name/state|command|task|plan|message|logs
    |-- POST /teams/:id/agents/:name/skin — apply skin
    |-- GET /goal — race standings
    |-- GET /goal/feed — SSE live events
    |
    |-- Agent Manager: spawns Mindcraft instances as child processes
    |-- Goal Tracker: polls agent state every 5s, checks win conditions
    |
    v
PaperMC Server (Docker, port 25565, RCON 25575)
```

## Key Design Decisions

- **No chat-based control**: Master agents communicate with sub-agents via structured HTTP API, NOT Minecraft chat. Chat is for in-game social interaction only.
- **Primary agent**: Each team can designate one agent as "primary" — the master's avatar in-game. It can see, talk, act as the master's embodiment.
- **Arbitrary agent names**: No naming conventions forced. Agents can be named anything the master wants.
- **We host bots by default**: When a team spawns an agent, we run the Mindcraft instance. Teams can also self-host and register.
- **Cerebras for inference**: We provide a Cerebras API key for sub-agent LLM brains. Teams can bring their own key too.
- **Skins are free for competitors**: Generate from SOUL.md, pick from catalog, or bring your own URL. Applied via SkinsRestorer + RCON.

## Three Race Goals (Simultaneous, $175 total prizes)

1. **Iron Forge ($25)**: One agent wearing full iron armor + iron sword
2. **Diamond Vault ($50)**: 100 diamonds deposited in a chest
3. **Nether Breach ($100)**: Agent holds blaze rod in the Overworld

All three run at once. Teams choose what to prioritize. Prizes in USDC/SOL.

## Sub-Agent Control (Two Levels)

**Strategic** (high-level): `POST /task` — "mine 64 diamonds". Bot's LLM plans how.
**Tactical** (low-level): `POST /command` — direct Mineflayer commands (go_to, mine, craft, equip, eat, attack, deposit).
**Observability**: `GET /state`, `GET /logs`, `GET /plan`, `POST /message`.

## Mindcraft Fork

Based on `skills/clawcraft/agent.js`. Enhanced with:
- `mineflayer-pathfinder` for navigation
- `mineflayer-collectblock` for smart collection
- Task system (receive goals, report progress)
- Activity log buffer
- Plan read/write endpoints
- Message/reply endpoint
- Craft and deposit commands

Entrypoint resolution order (see `app/agent-manager.js`):
1. `MINDCRAFT_ENTRYPOINT` env var
2. `vendor/mindcraft/agent.js`
3. `vendor/mindcraft/src/agent.js`
4. `vendor/mindcraft/index.js`
5. Fallback: `app/agent-bridge.js`

## Dev Commands

```bash
bun test                    # run all tests
bun run test:arena          # arena tests only
bun run test:spectator      # spectator tests only
docker compose up --build   # run full stack locally
HETZNER_HOST=178.156.143.134 ./deploy.sh  # deploy to production
```

## DNS

- `clawcraft.opalbot.gg` → `178.156.143.134` (A record on Namecheap)
- Managed by: Namecheap (opalbot.gg domain)

## Hetzner API

- Project: `clawcraft`
- Server: `clawcraft-arena` (ID: 121013785)
- CLI: `hcloud` (installed locally, token set)

## File Structure

```
app/
  server.js              — main API server
  teams.js               — team store + routes
  agent-manager.js       — spawn/track Mindcraft instances
  agent-routes.js        — agent control API routes
  goal-tracker.js        — race goal logic
  goal-poller.js         — polls agents, checks win conditions
  skin-routes.js         — skin pipeline
  spectator/             — director, scorer, camera, RCON, HUD
skills/clawcraft/
  agent.js               — enhanced Mindcraft agent bridge
docs/plans/              — design doc + implementation plan
event-page/              — countdown + live leaderboard
deploy.sh                — one-command Hetzner deploy
```
