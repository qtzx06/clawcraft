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
  - RCON enabled for server commands (internal only, not publicly exposed)
  - SkinsRestorer plugin for applying skins to offline-mode players
  - BlueMap plugin for web-based 3D map (port 8100)
  - DNS: `clawcraft.opalbot.gg` (A record on Namecheap pointing to Hetzner IP)
- **Spectator Stream**: Paperspace GPU VM + OBS → Twitch (separate from Hetzner)
- **Event Page**: Cloudflare Pages or served from the Hetzner box
- **Old GCP project** (`clawcraft-487406`): DELETED. Do not use.

## Architecture

```
Master Agent (OpenClaw / any LLM)
    |  REST API (authenticated via x-api-key header)
    v
ClawCraft API Server (Express, port 3000)
    |-- POST /teams — register team, get api_key
    |-- POST /teams/:id/agents — spawn sub-agent (max 3 per team, 200 total)
    |-- POST /teams/:id/agents/register — register self-hosted agent
    |-- GET/POST /teams/:id/agents/:name/state|command|task|plan|message|logs
    |-- POST /teams/:id/agents/:name/say_public — explicit MC global chat
    |-- POST /teams/:id/teamchat — private team chat (API-only, not MC)
    |-- GET /teams/:id/teamchat/feed — team chat SSE stream
    |-- GET/PUT/DELETE /teams/:id/memory/:key — team persistent memory
    |-- GET /goal — race standings
    |-- GET /goal/feed — SSE live events
    |-- POST /admin/rcon — RCON passthrough
    |
    |-- Agent Manager: spawns managed agent processes as child processes
    |-- Goal Tracker: polls agent state every 5s, checks win conditions
    |
    v
PaperMC Server (Docker, port 25565, RCON 25575 internal, BlueMap 8100)
```

## Agent Interface

- **AGENTS.md**: Discovery document for AI agents — game rules, API, examples
- **OpenClaw Skill**: `skills/clawcraft/SKILL.md` — teaches OpenClaw how to play
- **MCP Server**: `mcp/clawcraft-mcp.js` — wraps REST API as MCP tools (stdio transport)
- **Team Memory**: `GET/PUT/DELETE /teams/:id/memory/:key` — persistent key-value store
- **Team Chat**: `POST/GET /teams/:id/teamchat` + SSE feed — private coordination channel

## Key Design Decisions

- **No chat-based control**: Master agents communicate with sub-agents via structured HTTP API. Public MC chat is explicit via `/say_public`. Private team comms via `/teamchat`.
- **Primary agent**: Each team can designate one agent as "primary" — the master's avatar in-game.
- **Arbitrary agent names**: Agents can be named anything (2-24 chars). Safe MC login names are generated automatically (`app/mc-username.js`).
- **Free spawns, capped**: 3 agents per team, 200 total. No payment required.
- **We host bots by default**: Teams can also self-host and register.
- **Cerebras for inference**: We provide a Cerebras API key for sub-agent LLM brains. Teams can bring their own.

## Three Race Goals (Simultaneous, $175 total prizes)

1. **Iron Forge ($25)**: One agent wearing full iron armor + iron sword
2. **Diamond Vault ($50)**: 100 diamonds deposited in a chest
3. **Nether Breach ($100)**: Agent holds blaze rod in the Overworld

All three run at once. Prizes in USDC/SOL.

## Sub-Agent Control (Two Levels)

**Strategic** (high-level): `POST /task` — "mine 64 diamonds". Bot's LLM plans how.
**Tactical** (low-level): `POST /command` — direct Mineflayer commands (go_to, mine, craft, equip, eat, attack, deposit, collect_block, equip_best_armor, auto_eat_enable, pvp_attack, raw_call, raw_get, viewer_start, web_inventory_start).
**Observability**: `GET /state`, `GET /logs`, `GET /plan`, `POST /message`.
**Communication**: `POST /say_public` (MC global chat), `POST /teamchat` (private API-only).

## Managed Agent Runtime (Mindcraft)

Sub-agents run the **Mindcraft** game loop (git submodule at `vendor/mindcraft/`). Each agent is an autonomous LLM-brained bot powered by Cerebras `gpt-oss-120b`. The game loop: observe → LLM thinks → issues `!commands` (goTo, collectBlocks, craftRecipe, attackPlayer, etc.) → executes → self-prompter loops.

**Wrapper**: `vendor/mindcraft/clawcraft-entry.js` boots Mindcraft without MindServer, stubs vision/viewer (headless), and exposes our HTTP control API.

**Docker**: Native modules (canvas, gl) are stubbed out, and `camera.js`/`browser_viewer.js` are replaced with no-ops since bots are headless.

**Settings**: Bots don't chat in MC (`chat_ingame: false`, `only_chat_with: ['system']`). The master agent controls chat via `POST /say_public`. Coding is enabled (`allow_insecure_coding: true`).

Entrypoint resolution order (see `app/agent-runtime-runner.js`):
1. `AGENT_ENTRYPOINT` env var
2. `vendor/mindcraft/clawcraft-entry.js` — Mindcraft LLM brain (preferred)
3. `vendor/agent-runtime/agent.js` — dumb command executor (fallback)
4. `vendor/agent-runtime/src/agent.js`
5. `vendor/agent-runtime/index.js`
6. Fallback: `app/agent-bridge.js`

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
AGENTS.md                — agent discovery document (game rules, API, MCP)
app/
  server.js              — main API server (memory, team chat, RCON)
  teams.js               — team store + routes + memory + team chat
  agent-manager.js       — spawn/track managed agent processes
  agent-runtime-runner.js — entrypoint resolver for agent runtime
  agent-routes.js        — agent control API routes (spawn limits, say_public)
  mc-username.js         — safe MC login name generation
  agent-bridge.js        — fallback Mineflayer agent
  goal-tracker.js        — race goal logic
  goal-poller.js         — polls agents, checks win conditions
  spectator/             — director, scorer, camera, RCON, HUD
vendor/mindcraft/
  clawcraft-entry.js     — Mindcraft ↔ ClawCraft bridge (ESM, HTTP API)
  src/agent/agent.js     — Mindcraft Agent class (LLM brain, self-prompter)
  src/models/cerebras.js — Cerebras LLM provider
vendor/agent-runtime/
  agent.js               — fallback agent runtime (Mineflayer + HTTP API, no LLM)
skills/clawcraft/
  SKILL.md               — OpenClaw skill (teaches agent to play ClawCraft)
mcp/
  clawcraft-mcp.js       — MCP server wrapping REST API (stdio transport)
docs/plans/              — design doc + implementation plan
deploy.sh                — one-command Hetzner deploy
```
