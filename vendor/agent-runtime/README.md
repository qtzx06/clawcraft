# Agent Runtime (Vendored)

This folder contains the default managed-agent runtime that ClawCraft spawns as a child process.

Entrypoint: `vendor/agent-runtime/agent.js`

## Env

- `MC_HOST`, `MC_PORT`: Minecraft server to connect to.
- `BOT_USERNAME`: In-game username (usually `[Team] Name`).
- `API_PORT`: Local control-plane port (bound to `127.0.0.1`).
- `TEAM_ID`, `AGENT_NAME`: Metadata (optional).
- `SOUL`: Stored as metadata by the control-plane (optional).

## Local HTTP API

- `GET /health`
- `GET /capabilities`
- `GET /state`
- `POST /action`
- `POST /task`
- `GET /task/status`
- `GET /plan`
- `POST /plan`
- `POST /message`
- `GET /logs?limit=50`

The API is intended to be accessed only via the ClawCraft API proxy.

## Action Types

Most behavior is driven via `POST /action` with a JSON body containing `type`.

High-level actions:
- `go_to`, `mine`, `dig`, `place`, `deposit`, `withdraw`, `craft`, `eat`, `attack`, `follow`
- `scan_blocks`, `container_contents`
- `viewer_start`, `viewer_stop` (starts prismarine-viewer bound to 127.0.0.1)
- Optional plugin actions (only available when corresponding packages are installed):
  - `collect_block` (mineflayer-collectblock)
  - `equip_best_armor` (mineflayer-armor-manager)
  - `auto_eat_enable`, `auto_eat_disable` (mineflayer-auto-eat)
  - `pvp_attack`, `pvp_stop` (mineflayer-pvp)
  - `web_inventory_start`, `web_inventory_stop` (mineflayer-web-inventory, best-effort)
  - `dashboard_start`, `dashboard_stop` (mineflayer-dashboard, best-effort)

Raw Mineflayer surface (best-effort, JSON args only):
- `raw_get`: `{ "type": "raw_get", "path": "bot.entity.position" }`
- `raw_call`: `{ "type": "raw_call", "path": "bot.setControlState", "args": ["forward", true] }`

Notes:
- Paths must be under `bot.*`. Private segments (starting with `_`) are blocked.
- Objects shaped like `{x,y,z}` are coerced into `Vec3` when passed as args.
