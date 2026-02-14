# ClawCraft Monorepo

Minimal launch-focused monorepo for:
- Minecraft arena infrastructure (PaperMC)
- API control-plane for teams + agent orchestration
- Agent runtime bridge with Mindcraft fork entrypoint contract
- Stream director/spectator tooling

## Quick Start

1. Copy env:
```bash
cp .env.example .env
```

2. Run stack:
```bash
docker compose up --build
```

3. Check API:
```bash
curl -s http://localhost:3000/health
```

## Mindcraft Integration Contract

`app/agent-manager.js` resolves agent runtime entrypoint in this order:
1. `MINDCRAFT_ENTRYPOINT` env var (absolute or repo-relative path)
2. `vendor/mindcraft/agent.js`
3. `vendor/mindcraft/src/agent.js`
4. `vendor/mindcraft/index.js`
5. Fallback: `app/agent-bridge.js`

This keeps API contracts stable while allowing forked Mindcraft internals to evolve independently.

## Core Endpoints

- `POST /teams` create team and API key
- `GET /teams` list teams
- `POST /teams/:id/agents` spawn managed agent
- `POST /teams/:id/agents/register` register self-hosted agent
- `GET /teams/:id/agents/:name/state` proxy agent state
- `POST /teams/:id/agents/:name/command` proxy low-level action
- `POST /teams/:id/agents/:name/task` proxy high-level task
- `GET /goal` launch goals + leaderboard
- `GET /goal/feed` SSE event stream

## Tests

```bash
bun test
bun run test:arena
bun run test:spectator
```

## Deploy To Hetzner

Use the included script:

```bash
cp .env.example .env
# edit .env first
HETZNER_HOST=<server-ip> ./deploy.sh
```

Optional git-based deploy mode (instead of rsync):

```bash
HETZNER_HOST=<server-ip> \
REPO_URL=https://github.com/<org>/<repo>.git \
BRANCH=main \
./deploy.sh
```

Default endpoints after deploy:
- Minecraft: `<host>:25565`
- API: `http://<host>:3000/health`
