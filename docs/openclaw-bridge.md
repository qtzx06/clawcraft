# OpenClaw Bridge

This bridge is the runtime endpoint OpenClaw can call to launch bot instances into the existing ClawCraft engine.

## Why this bridge exists

- OpenClaw sends one JSON payload per bot:
  - `host`
  - `port`
  - `username`
  - `soul`
- The bridge creates a normal `AgentRuntime` with Mineflayer or Mindcraft connector.
- Bot lifecycle and missioning are handled through the same shared mission board used by local runtime.

## Start the bridge

```bash
npm run start:openclaw-bridge
```

- Optional env:
  - `OPENCLAW_BRIDGE_PORT` (default `3020`)
  - `OPENCLAW_BRIDGE_TOKEN` (requires `Authorization: Bearer <token>`)
- Optional config defaults:
  - `CLAWCRAFT_ENGINE_CONFIG` (default `app/engine/config/agents.config.json`)
  - `CLAWCRAFT_MISSION_BOARD` (default `app/engine/mission-board/state.runtime.json`)

## Health

```bash
curl http://localhost:3020/health
```

## Endpoint: POST `/openclaw/join`

Use this to start a bot.

- Requires JSON body.
- `username` must be 1-16 chars: letters, numbers, underscore.

```json
{
  "host": "34.106.239.231",
  "port": 25565,
  "username": "ryunzz_bot",
  "auth": "offline",
  "connector": "mineflayer",
  "replace": false,
  "soul": "# Name\nA builder bot that helps with resource loops and safety.\n\n## Tool permissions\n- mine\n- build\n- chat"
}
```

Notes:
- `soul` can be full markdown content (preferred for remote callers) or any readable file path accessible to this service.
- `connector`: `mineflayer` (default) or `mindcraft`.
- If `replace: true`, it will stop and relaunch an existing bot with the same username.

Response shape:

```json
{
  "ok": true,
  "output": {
    "id": "openclaw-ryunzz_bot",
    "username": "ryunzz_bot",
    "host": "34.106.239.231",
    "port": 25565,
    "connector": "mineflayer",
    "started": true
  },
  "action": "joined"
}
```

## Endpoint: POST `/openclaw/stop`

```json
{ "username": "ryunzz_bot" }
```

Response:

```json
{ "ok": true, "action": "stopped", "stopped": true }
```

## Endpoint: POST `/openclaw/missions`

Post a mission that will be assigned to the provided `username` by default.

```json
{
  "username": "ryunzz_bot",
  "task": "Collect 5 stacks of stone",
  "priority": "normal",
  "assign_to": "optional-other-username"
}
```

## Endpoint: GET `/openclaw/agents`

Returns runtime status for all running bridge-created agents plus basic mission counters.

## Endpoint: GET `/openclaw/board`

Returns full mission board snapshot.

## Notes

- OpenClaw does not need to set local `.env` values to make a bot join.
- It only needs to call the bridge endpoint with the 4 required fields and a SOUL payload.
