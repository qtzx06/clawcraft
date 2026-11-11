# ClawCraft Launch Night Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a competitive Minecraft arena platform where AI agents register teams, spawn sub-agents, and race to complete three goals — live on Twitch by midnight.

**Architecture:** Express API server manages teams and proxies commands to managed agent processes (child processes). PaperMC server runs in Docker. Goal tracker polls bot state every 5 seconds and broadcasts via SSE. Event page shows countdown then live leaderboard.

**Tech Stack:** Node.js, Express, Mineflayer, mineflayer-pathfinder, Docker, PaperMC (itzg/minecraft-server), RCON, SSE, vanilla HTML/JS for event page.

**Existing code to reuse:**
- `skills/clawcraft/agent.js` — sub-agent HTTP bridge (base for enhanced agent)
- `app/spectator/` — director, scorer, camera, RCON wrappers
- `app/x402-gateway.js` — payment middleware (for paid skin generation)
- `openclaw-mc-server/gcloud-startup-script.sh` — PaperMC config reference

---

## Task 1: Docker Compose — PaperMC + API Scaffold

**Files:**
- Modify: `docker-compose.yml`
- Modify: `Dockerfile`
- Modify: `package.json`
- Create: `app/server.js` (new main API server)

**Step 1: Update docker-compose.yml with PaperMC server**

```yaml
services:
  minecraft:
    image: itzg/minecraft-server:latest
    ports:
      - "25565:25565"
      - "25575:25575"
    environment:
      TYPE: PAPER
      VERSION: "LATEST"
      EULA: "TRUE"
      ONLINE_MODE: "FALSE"
      ENABLE_RCON: "TRUE"
      RCON_PASSWORD: "${RCON_PASSWORD:-clawcraft}"
      MEMORY: "4G"
      MAX_PLAYERS: 200
      MOTD: "ClawCraft Arena — 2b2t for AI Agents"
      SPAWN_PROTECTION: "0"
      ALLOW_FLIGHT: "TRUE"
      DIFFICULTY: "normal"
      VIEW_DISTANCE: "10"
      SIMULATION_DISTANCE: "8"
      SPIGET_RESOURCES: "2124"
    volumes:
      - mc-data:/data
    restart: unless-stopped

  api:
    build: .
    command: ["node", "app/server.js"]
    ports:
      - "3000:3000"
    env_file: .env
    environment:
      MC_HOST: minecraft
      RCON_HOST: minecraft
      RCON_PORT: 25575
      RCON_PASSWORD: "${RCON_PASSWORD:-clawcraft}"
    depends_on:
      minecraft:
        condition: service_healthy
    restart: unless-stopped

volumes:
  mc-data:
```

**Step 2: Create API server scaffold `app/server.js`**

```js
const express = require('express');
const pino = require('pino');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });
const app = express();
app.use(express.json());

const PORT = Number(process.env.API_PORT || 3000);

app.get('/health', (_req, res) => res.json({ ok: true, service: 'clawcraft-api' }));

app.listen(PORT, () => log.info({ port: PORT }, 'ClawCraft API listening'));
```

**Step 3: Add new deps to package.json**

```bash
cd /Users/qtzx/Desktop/codebase/clawcraft && bun add mineflayer-pathfinder mineflayer-collectblock mineflayer-pvp mineflayer-auto-eat mineflayer-tool uuid
```

**Step 4: Verify docker compose syntax**

```bash
docker compose config --quiet
```

**Step 5: Commit**

```bash
git add docker-compose.yml app/server.js package.json bun.lock
git commit -m "feat: add PaperMC server + API scaffold to docker compose"
```

---

## Task 2: Team Registration API

**Files:**
- Create: `app/teams.js` (team store + routes)
- Modify: `app/server.js` (mount routes)
- Create: `app/teams.test.js`

**Step 1: Write failing test for team registration**

```js
// app/teams.test.js
import { describe, it, expect, beforeEach } from 'bun:test';
import { TeamStore } from './teams.js';

describe('TeamStore', () => {
  let store;
  beforeEach(() => { store = new TeamStore(); });

  it('registers a team and returns api_key', () => {
    const result = store.register({ name: 'AlphaForge', wallet: '0xabc' });
    expect(result.ok).toBe(true);
    expect(result.team_id).toBe('alphaforge');
    expect(result.api_key).toMatch(/^clf_/);
  });

  it('rejects duplicate team names', () => {
    store.register({ name: 'AlphaForge', wallet: '0xabc' });
    const result = store.register({ name: 'AlphaForge', wallet: '0xdef' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('team_exists');
  });

  it('authenticates with api_key', () => {
    const { api_key } = store.register({ name: 'AlphaForge', wallet: '0xabc' });
    expect(store.authenticate(api_key)).toBeTruthy();
    expect(store.authenticate('bad_key')).toBeNull();
  });

  it('lists all teams', () => {
    store.register({ name: 'AlphaForge', wallet: '0xabc' });
    store.register({ name: 'DeepMine', wallet: '0xdef' });
    expect(store.list()).toHaveLength(2);
  });

  it('gets team by id', () => {
    store.register({ name: 'AlphaForge', wallet: '0xabc' });
    const team = store.get('alphaforge');
    expect(team.name).toBe('AlphaForge');
    expect(team.agents).toEqual([]);
  });
});
```

**Step 2: Run test — verify it fails**

```bash
bun test app/teams.test.js
```
Expected: FAIL — module not found

**Step 3: Implement TeamStore**

```js
// app/teams.js
const crypto = require('node:crypto');

class TeamStore {
  constructor() {
    this.teams = new Map();     // team_id -> team
    this.apiKeys = new Map();   // api_key -> team_id
  }

  register({ name, wallet }) {
    const team_id = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (this.teams.has(team_id)) {
      return { ok: false, error: 'team_exists' };
    }
    const api_key = `clf_${crypto.randomBytes(16).toString('hex')}`;
    const team = {
      team_id,
      name,
      wallet: wallet || null,
      api_key,
      agents: [],
      created_at: Date.now(),
    };
    this.teams.set(team_id, team);
    this.apiKeys.set(api_key, team_id);
    return { ok: true, team_id, api_key, name };
  }

  authenticate(api_key) {
    const team_id = this.apiKeys.get(api_key);
    if (!team_id) return null;
    return this.teams.get(team_id);
  }

  get(team_id) {
    return this.teams.get(team_id) || null;
  }

  list() {
    return [...this.teams.values()].map(t => ({
      team_id: t.team_id,
      name: t.name,
      agents: t.agents.map(a => a.name),
      agent_count: t.agents.length,
    }));
  }

  addAgent(team_id, agent) {
    const team = this.teams.get(team_id);
    if (!team) return null;
    team.agents.push(agent);
    return agent;
  }

  getAgent(team_id, agentName) {
    const team = this.teams.get(team_id);
    if (!team) return null;
    return team.agents.find(a => a.name === agentName) || null;
  }

  removeAgent(team_id, agentName) {
    const team = this.teams.get(team_id);
    if (!team) return false;
    const idx = team.agents.findIndex(a => a.name === agentName);
    if (idx === -1) return false;
    team.agents.splice(idx, 1);
    return true;
  }
}

function teamRoutes(store) {
  const router = require('express').Router();

  // Auth middleware
  function requireAuth(req, res, next) {
    const key = req.headers['x-api-key'] || req.query.api_key;
    const team = store.authenticate(key);
    if (!team) return res.status(401).json({ ok: false, error: 'invalid_api_key' });
    req.team = team;
    next();
  }

  router.post('/teams', (req, res) => {
    const { name, wallet } = req.body || {};
    if (!name || name.length < 2 || name.length > 24) {
      return res.status(400).json({ ok: false, error: 'name must be 2-24 characters' });
    }
    const result = store.register({ name, wallet });
    if (!result.ok) return res.status(409).json(result);
    res.status(201).json(result);
  });

  router.get('/teams', (_req, res) => {
    res.json({ ok: true, teams: store.list() });
  });

  router.get('/teams/:id', (req, res) => {
    const team = store.get(req.params.id);
    if (!team) return res.status(404).json({ ok: false, error: 'team_not_found' });
    res.json({
      ok: true,
      team_id: team.team_id,
      name: team.name,
      agents: team.agents.map(a => ({
        name: a.name,
        display_name: a.display_name,
        role: a.role,
        status: a.status,
      })),
    });
  });

  return { router, requireAuth };
}

module.exports = { TeamStore, teamRoutes };
```

**Step 4: Run tests — verify they pass**

```bash
bun test app/teams.test.js
```
Expected: all PASS

**Step 5: Mount routes in server.js**

Add to `app/server.js`:
```js
const { TeamStore, teamRoutes } = require('./teams.js');
const teamStore = new TeamStore();
const { router: teamsRouter, requireAuth } = teamRoutes(teamStore);
app.use(teamsRouter);
```

**Step 6: Commit**

```bash
git add app/teams.js app/teams.test.js app/server.js
git commit -m "feat: team registration API with auth"
```

---

## Task 3: Agent Manager — Spawn & Control Managed Agents

**Files:**
- Create: `app/agent-manager.js` (spawn/kill/track child processes)
- Create: `app/agent-manager.test.js`

**Step 1: Write failing test**

```js
// app/agent-manager.test.js
import { describe, it, expect, beforeEach } from 'bun:test';
import { AgentManager } from './agent-manager.js';

describe('AgentManager', () => {
  let mgr;
  beforeEach(() => {
    mgr = new AgentManager({ mcHost: '127.0.0.1', mcPort: 25565, basePort: 4000, dryRun: true });
  });

  it('assigns sequential ports', () => {
    const a1 = mgr.allocatePort();
    const a2 = mgr.allocatePort();
    expect(a1).toBe(4000);
    expect(a2).toBe(4001);
  });

  it('tracks agent metadata', () => {
    mgr.register('alphaforge', {
      name: 'Zara', role: 'worker', port: 4000, display_name: '[AlphaForge] Zara',
    });
    const agent = mgr.getAgent('alphaforge', 'Zara');
    expect(agent).toBeTruthy();
    expect(agent.display_name).toBe('[AlphaForge] Zara');
  });

  it('lists agents for a team', () => {
    mgr.register('alphaforge', { name: 'Zara', role: 'worker', port: 4000 });
    mgr.register('alphaforge', { name: 'Rex', role: 'primary', port: 4001 });
    const agents = mgr.listAgents('alphaforge');
    expect(agents).toHaveLength(2);
  });

  it('removes agent', () => {
    mgr.register('alphaforge', { name: 'Zara', role: 'worker', port: 4000 });
    mgr.remove('alphaforge', 'Zara');
    expect(mgr.getAgent('alphaforge', 'Zara')).toBeNull();
  });
});
```

**Step 2: Run — verify fail**

```bash
bun test app/agent-manager.test.js
```

**Step 3: Implement AgentManager**

```js
// app/agent-manager.js
const { fork } = require('node:child_process');
const path = require('node:path');
const pino = require('pino');
const log = pino({ level: process.env.LOG_LEVEL || 'info' });

const AGENT_SCRIPT = path.resolve(__dirname, '../skills/clawcraft/agent.js');

class AgentManager {
  constructor(opts = {}) {
    this.mcHost = opts.mcHost || process.env.MC_HOST || '127.0.0.1';
    this.mcPort = opts.mcPort || Number(process.env.MC_PORT || 25565);
    this.basePort = opts.basePort || 4000;
    this.nextPort = this.basePort;
    this.agents = new Map();  // "teamId/agentName" -> agent record
    this.dryRun = opts.dryRun || false;
    this.cerebrasKey = opts.cerebrasKey || process.env.CEREBRAS_API_KEY || '';
  }

  allocatePort() {
    return this.nextPort++;
  }

  _key(teamId, name) {
    return `${teamId}/${name}`;
  }

  register(teamId, agentMeta) {
    const key = this._key(teamId, agentMeta.name);
    this.agents.set(key, {
      ...agentMeta,
      teamId,
      status: 'registered',
      process: null,
      logs: [],
      maxLogs: 200,
    });
    return this.agents.get(key);
  }

  async spawn(teamId, agentName) {
    const key = this._key(teamId, agentName);
    const agent = this.agents.get(key);
    if (!agent) return null;
    if (agent.process) return agent; // already running
    if (this.dryRun) {
      agent.status = 'running';
      return agent;
    }

    const env = {
      ...process.env,
      MC_HOST: this.mcHost,
      MC_PORT: String(this.mcPort),
      BOT_USERNAME: agent.display_name || `[${teamId}] ${agentName}`,
      API_PORT: String(agent.port),
      CEREBRAS_API_KEY: this.cerebrasKey,
    };

    const child = fork(AGENT_SCRIPT, [], { env, silent: true });

    child.stdout?.on('data', (d) => {
      const line = d.toString().trim();
      if (line) {
        agent.logs.push({ time: Date.now(), msg: line });
        if (agent.logs.length > agent.maxLogs) agent.logs.shift();
      }
    });
    child.stderr?.on('data', (d) => {
      const line = d.toString().trim();
      if (line) {
        agent.logs.push({ time: Date.now(), msg: `[err] ${line}` });
        if (agent.logs.length > agent.maxLogs) agent.logs.shift();
      }
    });
    child.on('exit', (code) => {
      log.warn({ teamId, agentName, code }, 'Agent process exited');
      agent.status = 'stopped';
      agent.process = null;
    });

    agent.process = child;
    agent.status = 'running';
    log.info({ teamId, agentName, port: agent.port, pid: child.pid }, 'Agent spawned');
    return agent;
  }

  getAgent(teamId, name) {
    return this.agents.get(this._key(teamId, name)) || null;
  }

  listAgents(teamId) {
    const results = [];
    for (const [key, agent] of this.agents) {
      if (agent.teamId === teamId) results.push(agent);
    }
    return results;
  }

  allAgents() {
    return [...this.agents.values()];
  }

  remove(teamId, name) {
    const key = this._key(teamId, name);
    const agent = this.agents.get(key);
    if (!agent) return false;
    if (agent.process) {
      agent.process.kill('SIGTERM');
      agent.process = null;
    }
    this.agents.delete(key);
    return true;
  }

  getLogs(teamId, name, limit = 50) {
    const agent = this.getAgent(teamId, name);
    if (!agent) return [];
    return agent.logs.slice(-limit);
  }

  async proxyRequest(teamId, name, method, path, body) {
    const agent = this.getAgent(teamId, name);
    if (!agent || agent.status !== 'running') {
      return { ok: false, error: 'agent_not_running' };
    }
    const url = `http://127.0.0.1:${agent.port}${path}`;
    try {
      const opts = { method, headers: { 'Content-Type': 'application/json' } };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(url, opts);
      return await res.json();
    } catch (err) {
      return { ok: false, error: `proxy_error: ${err.message}` };
    }
  }
}

module.exports = { AgentManager };
```

**Step 4: Run tests — verify pass**

```bash
bun test app/agent-manager.test.js
```

**Step 5: Commit**

```bash
git add app/agent-manager.js app/agent-manager.test.js
git commit -m "feat: agent manager for spawning/tracking bot instances"
```

---

## Task 4: Agent API Routes — Spawn, Control, Observe

**Files:**
- Create: `app/agent-routes.js`
- Modify: `app/server.js` (mount agent routes)

**Step 1: Implement agent routes**

```js
// app/agent-routes.js
function agentRoutes(teamStore, agentManager) {
  const router = require('express').Router();

  // Auth middleware
  function requireAuth(req, res, next) {
    const key = req.headers['x-api-key'] || req.query.api_key;
    const team = teamStore.authenticate(key);
    if (!team) return res.status(401).json({ ok: false, error: 'invalid_api_key' });
    if (req.params.id && req.params.id !== team.team_id) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    req.team = team;
    next();
  }

  // Spawn a new agent
  router.post('/teams/:id/agents', requireAuth, async (req, res) => {
    const { name, role, soul, skin, voice } = req.body || {};
    if (!name || name.length < 2 || name.length > 16) {
      return res.status(400).json({ ok: false, error: 'name must be 2-16 characters' });
    }
    const teamId = req.params.id;
    const display_name = `[${req.team.name}] ${name}`;
    const port = agentManager.allocatePort();
    const agentMeta = {
      name,
      display_name,
      role: role || 'worker',
      port,
      soul: soul || null,
      skin: skin || null,
      voice: voice || false,
      self_hosted: false,
      status: 'spawning',
    };

    agentManager.register(teamId, agentMeta);
    teamStore.addAgent(teamId, agentMeta);

    // Spawn the process
    await agentManager.spawn(teamId, name);

    res.status(201).json({
      ok: true,
      agent_name: name,
      display_name,
      role: agentMeta.role,
      port,
      control_url: `/teams/${teamId}/agents/${name}`,
    });
  });

  // Register self-hosted agent
  router.post('/teams/:id/agents/register', requireAuth, (req, res) => {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ ok: false, error: 'name required' });
    const teamId = req.params.id;
    const display_name = `[${req.team.name}] ${name}`;
    const agentMeta = {
      name,
      display_name,
      role: req.body.role || 'worker',
      port: null,
      self_hosted: true,
      status: 'registered',
    };
    agentManager.register(teamId, agentMeta);
    teamStore.addAgent(teamId, agentMeta);
    res.status(201).json({ ok: true, agent_name: name, display_name, self_hosted: true });
  });

  // List team agents
  router.get('/teams/:id/agents', (req, res) => {
    const agents = agentManager.listAgents(req.params.id);
    res.json({
      ok: true,
      agents: agents.map(a => ({
        name: a.name,
        display_name: a.display_name,
        role: a.role,
        status: a.status,
        self_hosted: a.self_hosted,
      })),
    });
  });

  // Proxy: GET state
  router.get('/teams/:id/agents/:name/state', requireAuth, async (req, res) => {
    const result = await agentManager.proxyRequest(req.params.id, req.params.name, 'GET', '/state');
    res.json(result);
  });

  // Proxy: POST action (low-level command)
  router.post('/teams/:id/agents/:name/command', requireAuth, async (req, res) => {
    const result = await agentManager.proxyRequest(req.params.id, req.params.name, 'POST', '/action', req.body);
    res.json(result);
  });

  // Proxy: POST task (high-level goal)
  router.post('/teams/:id/agents/:name/task', requireAuth, async (req, res) => {
    const result = await agentManager.proxyRequest(req.params.id, req.params.name, 'POST', '/task', req.body);
    res.json(result);
  });

  // Proxy: GET task status
  router.get('/teams/:id/agents/:name/task/status', requireAuth, async (req, res) => {
    const result = await agentManager.proxyRequest(req.params.id, req.params.name, 'GET', '/task/status');
    res.json(result);
  });

  // Proxy: GET/POST plan
  router.get('/teams/:id/agents/:name/plan', requireAuth, async (req, res) => {
    const result = await agentManager.proxyRequest(req.params.id, req.params.name, 'GET', '/plan');
    res.json(result);
  });

  router.post('/teams/:id/agents/:name/plan', requireAuth, async (req, res) => {
    const result = await agentManager.proxyRequest(req.params.id, req.params.name, 'POST', '/plan', req.body);
    res.json(result);
  });

  // Proxy: POST message
  router.post('/teams/:id/agents/:name/message', requireAuth, async (req, res) => {
    const result = await agentManager.proxyRequest(req.params.id, req.params.name, 'POST', '/message', req.body);
    res.json(result);
  });

  // Logs (from our buffer, not proxied)
  router.get('/teams/:id/agents/:name/logs', requireAuth, (req, res) => {
    const limit = Number(req.query.limit || 50);
    const logs = agentManager.getLogs(req.params.id, req.params.name, limit);
    res.json({ ok: true, logs });
  });

  return router;
}

module.exports = { agentRoutes };
```

**Step 2: Mount in server.js — add agentManager + agentRoutes**

```js
// Add to app/server.js
const { AgentManager } = require('./agent-manager.js');
const { agentRoutes } = require('./agent-routes.js');
const agentManager = new AgentManager();
app.use(agentRoutes(teamStore, agentManager));
```

**Step 3: Verify syntax**

```bash
node --check app/agent-routes.js && node --check app/server.js
```

**Step 4: Commit**

```bash
git add app/agent-routes.js app/server.js
git commit -m "feat: agent spawn/control/observe API routes"
```

---

## Task 5: Enhanced Agent — Task System, Pathfinder, Logs

**Files:**
- Modify: `skills/clawcraft/agent.js` (add /task, /plan, /message, /logs endpoints + pathfinder)

This is the biggest single task. We're upgrading the existing agent bridge to support:
- High-level tasks (goal-oriented behavior)
- Pathfinder navigation
- Plan read/write
- Message/reply
- Activity log buffer

**Step 1: Add pathfinder + new endpoints to agent.js**

Key additions to `skills/clawcraft/agent.js`:

After bot creation, add pathfinder:
```js
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
bot.loadPlugin(pathfinder);
bot.once('spawn', () => {
  const movements = new Movements(bot);
  bot.pathfinder.setMovements(movements);
});
```

Add task state:
```js
let currentTask = null;    // { goal, target, strategy, status, progress }
let currentPlan = null;    // string — LLM-generated or master-provided plan
const activityLog = [];
const MAX_LOG = 200;

function logActivity(action) {
  activityLog.push({ time: Date.now(), action });
  if (activityLog.length > MAX_LOG) activityLog.shift();
}
```

Add new HTTP routes (inside the existing http server handler):

```js
// GET /task/status
if (req.method === 'GET' && req.url === '/task/status') {
  res.end(JSON.stringify(currentTask || { status: 'idle' }));
  return;
}

// POST /task — set a high-level goal
if (req.method === 'POST' && req.url === '/task') {
  let body = ''; for await (const chunk of req) body += chunk;
  const task = JSON.parse(body);
  currentTask = { ...task, status: 'accepted', progress: 0, started_at: Date.now() };
  logActivity(`task accepted: ${task.goal}`);
  res.end(JSON.stringify({ ok: true, task: currentTask }));
  return;
}

// GET /plan
if (req.method === 'GET' && req.url === '/plan') {
  res.end(JSON.stringify({ ok: true, plan: currentPlan }));
  return;
}

// POST /plan — override plan
if (req.method === 'POST' && req.url === '/plan') {
  let body = ''; for await (const chunk of req) body += chunk;
  const { instructions } = JSON.parse(body);
  currentPlan = instructions;
  logActivity(`plan updated: ${instructions.slice(0, 80)}`);
  res.end(JSON.stringify({ ok: true, plan: currentPlan }));
  return;
}

// POST /message — ask bot a question
if (req.method === 'POST' && req.url === '/message') {
  let body = ''; for await (const chunk of req) body += chunk;
  const { message } = JSON.parse(body);
  // Simple: return current state as context for the reply
  const state = gameState();
  const reply = `Position: ${JSON.stringify(state.position)}, ` +
    `Health: ${state.health}, Inventory: ${state.inventory.map(i => `${i.count}x ${i.name}`).join(', ')}. ` +
    `Current task: ${currentTask?.goal || 'idle'}, Progress: ${currentTask?.progress || 0}`;
  logActivity(`message received: ${message}`);
  res.end(JSON.stringify({ ok: true, reply }));
  return;
}

// GET /logs
if (req.method === 'GET' && req.url === '/logs') {
  const url = new URL(req.url, `http://localhost`);
  const limit = Number(url.searchParams?.get('limit') || 50);
  res.end(JSON.stringify({ ok: true, logs: activityLog.slice(-limit) }));
  return;
}
```

Add `go_to` command type using pathfinder:
```js
case 'go_to': {
  const { GoalNear } = require('mineflayer-pathfinder').goals;
  const goal = new GoalNear(action.x, action.y, action.z, 2);
  bot.pathfinder.setGoal(goal);
  logActivity(`navigating to ${action.x}, ${action.y}, ${action.z}`);
  return { ok: true, action: 'go_to' };
}

case 'craft': {
  const mcData = require('minecraft-data')(bot.version);
  const item = mcData.itemsByName[action.item];
  if (!item) return { ok: false, error: `unknown item: ${action.item}` };
  const recipe = bot.recipesFor(item.id)[0];
  if (!recipe) return { ok: false, error: `no recipe for: ${action.item}` };
  const table = bot.findBlock({ matching: mcData.blocksByName.crafting_table?.id, maxDistance: 4 });
  await bot.craft(recipe, action.count || 1, table || undefined);
  logActivity(`crafted ${action.count || 1}x ${action.item}`);
  return { ok: true, action: 'craft', item: action.item };
}

case 'deposit': {
  // Find nearest chest and deposit items
  const mcData = require('minecraft-data')(bot.version);
  const chestBlock = bot.findBlock({ matching: mcData.blocksByName.chest?.id, maxDistance: 4 });
  if (!chestBlock) return { ok: false, error: 'no chest nearby' };
  const chest = await bot.openContainer(chestBlock);
  const depositItem = bot.inventory.items().find(i => i.name === action.item);
  if (!depositItem) { chest.close(); return { ok: false, error: `no ${action.item} in inventory` }; }
  await chest.deposit(depositItem.type, null, Math.min(action.count || depositItem.count, depositItem.count));
  chest.close();
  logActivity(`deposited ${action.count}x ${action.item} in chest`);
  return { ok: true, action: 'deposit', item: action.item };
}
```

Also hook into existing actions to populate the log:
```js
// Add logActivity() calls to existing mine, attack, eat, etc.
```

**Step 2: Verify syntax**

```bash
node --check skills/clawcraft/agent.js
```

**Step 3: Commit**

```bash
git add skills/clawcraft/agent.js
git commit -m "feat: enhanced agent with task system, pathfinder, logs"
```

---

## Task 6: Goal Tracker Service

**Files:**
- Create: `app/goal-tracker.js`
- Create: `app/goal-tracker.test.js`

**Step 1: Write failing test**

```js
// app/goal-tracker.test.js
import { describe, it, expect, beforeEach } from 'bun:test';
import { GoalTracker } from './goal-tracker.js';

describe('GoalTracker', () => {
  let tracker;
  beforeEach(() => { tracker = new GoalTracker(); });

  it('initializes with three goals', () => {
    const goals = tracker.getGoals();
    expect(goals).toHaveLength(3);
    expect(goals.map(g => g.id)).toEqual(['iron_forge', 'diamond_vault', 'nether_breach']);
  });

  it('detects iron forge completion', () => {
    const equipment = {
      head: { name: 'iron_helmet' },
      chest: { name: 'iron_chestplate' },
      legs: { name: 'iron_leggings' },
      feet: { name: 'iron_boots' },
      hand: { name: 'iron_sword' },
    };
    expect(tracker.checkIronForge(equipment)).toBe(true);
  });

  it('rejects incomplete iron forge', () => {
    const equipment = {
      head: { name: 'iron_helmet' },
      chest: null,
      legs: null,
      feet: null,
      hand: null,
    };
    expect(tracker.checkIronForge(equipment)).toBe(false);
  });

  it('tracks diamond vault progress', () => {
    tracker.recordDiamondDeposit('alphaforge', 10);
    tracker.recordDiamondDeposit('alphaforge', 15);
    expect(tracker.getDiamondCount('alphaforge')).toBe(25);
  });

  it('detects diamond vault completion', () => {
    tracker.recordDiamondDeposit('alphaforge', 100);
    expect(tracker.checkDiamondVault('alphaforge')).toBe(true);
  });

  it('detects nether breach', () => {
    const inventory = [{ name: 'blaze_rod', count: 1 }];
    expect(tracker.checkNetherBreach(inventory, 'overworld')).toBe(true);
    expect(tracker.checkNetherBreach(inventory, 'the_nether')).toBe(false);
    expect(tracker.checkNetherBreach([], 'overworld')).toBe(false);
  });

  it('records a winner', () => {
    tracker.declareWinner('iron_forge', 'alphaforge');
    const goal = tracker.getGoal('iron_forge');
    expect(goal.winner).toBe('alphaforge');
    expect(goal.status).toBe('complete');
  });
});
```

**Step 2: Run — verify fail**

```bash
bun test app/goal-tracker.test.js
```

**Step 3: Implement GoalTracker**

```js
// app/goal-tracker.js
const pino = require('pino');
const log = pino({ level: process.env.LOG_LEVEL || 'info' });

class GoalTracker {
  constructor() {
    this.goals = [
      {
        id: 'iron_forge', title: 'Iron Forge', prize: '$25',
        description: 'One agent wears full iron armor + iron sword',
        status: 'active', winner: null, won_at: null,
        standings: {},
      },
      {
        id: 'diamond_vault', title: 'Diamond Vault', prize: '$50',
        description: 'Deposit 100 diamonds in a chest',
        status: 'active', winner: null, won_at: null,
        standings: {},
      },
      {
        id: 'nether_breach', title: 'Nether Breach', prize: '$100',
        description: 'Hold a blaze rod in the Overworld',
        status: 'active', winner: null, won_at: null,
        standings: {},
      },
    ];
    this.diamondCounts = new Map(); // teamId -> count
    this.events = [];  // SSE event buffer
    this.listeners = new Set(); // SSE response objects
    this.startedAt = null;
  }

  start() {
    this.startedAt = Date.now();
  }

  getGoals() {
    return this.goals;
  }

  getGoal(id) {
    return this.goals.find(g => g.id === id) || null;
  }

  // --- Iron Forge ---
  checkIronForge(equipment) {
    if (!equipment) return false;
    return (
      equipment.head?.name === 'iron_helmet' &&
      equipment.chest?.name === 'iron_chestplate' &&
      equipment.legs?.name === 'iron_leggings' &&
      equipment.feet?.name === 'iron_boots' &&
      equipment.hand?.name === 'iron_sword'
    );
  }

  // --- Diamond Vault ---
  recordDiamondDeposit(teamId, count) {
    const current = this.diamondCounts.get(teamId) || 0;
    this.diamondCounts.set(teamId, current + count);
  }

  getDiamondCount(teamId) {
    return this.diamondCounts.get(teamId) || 0;
  }

  checkDiamondVault(teamId) {
    return this.getDiamondCount(teamId) >= 100;
  }

  // --- Nether Breach ---
  checkNetherBreach(inventory, dimension) {
    if (!inventory || !Array.isArray(inventory)) return false;
    if (dimension !== 'overworld') return false;
    return inventory.some(i => i.name === 'blaze_rod');
  }

  // --- Winners ---
  declareWinner(goalId, teamId) {
    const goal = this.getGoal(goalId);
    if (!goal || goal.winner) return false;
    goal.winner = teamId;
    goal.status = 'complete';
    goal.won_at = Date.now();
    log.info({ goalId, teamId }, 'GOAL WON!');
    this.pushEvent({
      event: 'goal_complete',
      goal: goalId,
      title: goal.title,
      prize: goal.prize,
      winner: teamId,
      time: goal.won_at,
    });
    return true;
  }

  // --- SSE ---
  pushEvent(data) {
    this.events.push(data);
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const res of this.listeners) {
      try { res.write(payload); } catch (_) { /* noop */ }
    }
  }

  addListener(res) {
    this.listeners.add(res);
    res.on('close', () => this.listeners.delete(res));
  }

  // --- Leaderboard snapshot ---
  getStandings(teamStore) {
    const teams = teamStore.list();
    return this.goals.map(goal => ({
      ...goal,
      standings: teams.map(t => {
        const progress = goal.id === 'diamond_vault'
          ? `${this.getDiamondCount(t.team_id)}/100 diamonds`
          : goal.standings[t.team_id] || 'in progress';
        return { team: t.name, team_id: t.team_id, progress, agents: t.agent_count };
      }),
    }));
  }
}

module.exports = { GoalTracker };
```

**Step 4: Run tests — verify pass**

```bash
bun test app/goal-tracker.test.js
```

**Step 5: Add goal routes to server.js**

```js
// In app/server.js
const { GoalTracker } = require('./goal-tracker.js');
const goalTracker = new GoalTracker();

app.get('/goal', (_req, res) => {
  res.json({
    ok: true,
    started_at: goalTracker.startedAt,
    goals: goalTracker.getStandings(teamStore),
  });
});

app.get('/goal/feed', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  goalTracker.addListener(res);
});
```

**Step 6: Commit**

```bash
git add app/goal-tracker.js app/goal-tracker.test.js app/server.js
git commit -m "feat: goal tracker with iron forge, diamond vault, nether breach"
```

---

## Task 7: Goal Polling Loop

**Files:**
- Create: `app/goal-poller.js` (polls agent state, checks goals, emits events)
- Modify: `app/server.js` (start poller)

**Step 1: Implement poller**

```js
// app/goal-poller.js
const pino = require('pino');
const log = pino({ level: process.env.LOG_LEVEL || 'info' });

class GoalPoller {
  constructor(agentManager, goalTracker, teamStore, opts = {}) {
    this.agentManager = agentManager;
    this.goalTracker = goalTracker;
    this.teamStore = teamStore;
    this.intervalMs = opts.intervalMs || 5000;
    this.timer = null;
  }

  start() {
    this.goalTracker.start();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    log.info({ intervalMs: this.intervalMs }, 'Goal poller started');
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    const teams = this.teamStore.list();

    for (const team of teams) {
      const agents = this.agentManager.listAgents(team.team_id);

      for (const agent of agents) {
        if (agent.status !== 'running' || agent.self_hosted) continue;

        try {
          const state = await this.agentManager.proxyRequest(
            team.team_id, agent.name, 'GET', '/state'
          );
          if (!state || !state.spawned) continue;

          // Check Iron Forge
          const ironGoal = this.goalTracker.getGoal('iron_forge');
          if (ironGoal && !ironGoal.winner) {
            const equipment = {
              head: state.equipment?.head || state.inventory?.find(i => i.name === 'iron_helmet' && i.slot === 5),
              chest: state.equipment?.chest || state.inventory?.find(i => i.name === 'iron_chestplate' && i.slot === 6),
              legs: state.equipment?.legs || state.inventory?.find(i => i.name === 'iron_leggings' && i.slot === 7),
              feet: state.equipment?.feet || state.inventory?.find(i => i.name === 'iron_boots' && i.slot === 8),
              hand: state.inventory?.find(i => i.name === 'iron_sword'),
            };
            if (this.goalTracker.checkIronForge(equipment)) {
              this.goalTracker.declareWinner('iron_forge', team.team_id);
            }
          }

          // Check Nether Breach
          const netherGoal = this.goalTracker.getGoal('nether_breach');
          if (netherGoal && !netherGoal.winner) {
            const dimension = state.dimension || 'overworld';
            if (this.goalTracker.checkNetherBreach(state.inventory || [], dimension)) {
              this.goalTracker.declareWinner('nether_breach', team.team_id);
            }
          }

          // Track diamonds deposited (emit events for notable finds)
          const diamonds = (state.inventory || []).filter(i => i.name === 'diamond');
          const diamondCount = diamonds.reduce((sum, i) => sum + i.count, 0);
          if (diamondCount > 0) {
            this.goalTracker.pushEvent({
              event: 'diamond_update',
              team: team.name,
              team_id: team.team_id,
              agent: agent.name,
              diamonds_held: diamondCount,
            });
          }

        } catch (err) {
          log.debug({ err: err.message, agent: agent.name }, 'Poll failed for agent');
        }
      }

      // Check Diamond Vault
      const dvGoal = this.goalTracker.getGoal('diamond_vault');
      if (dvGoal && !dvGoal.winner) {
        if (this.goalTracker.checkDiamondVault(team.team_id)) {
          this.goalTracker.declareWinner('diamond_vault', team.team_id);
        }
      }
    }
  }
}

module.exports = { GoalPoller };
```

**Step 2: Wire into server.js**

```js
const { GoalPoller } = require('./goal-poller.js');
const poller = new GoalPoller(agentManager, goalTracker, teamStore);
// Start after MC server is available
setTimeout(() => poller.start(), 5000);
```

**Step 3: Verify syntax**

```bash
node --check app/goal-poller.js && node --check app/server.js
```

**Step 4: Commit**

```bash
git add app/goal-poller.js app/server.js
git commit -m "feat: goal polling loop checks agent state every 5s"
```

---

## Task 8: Skin Pipeline

**Files:**
- Create: `app/skin-routes.js`
- Modify: `app/server.js`

**Step 1: Implement skin routes with RCON application**

```js
// app/skin-routes.js
const SKIN_CATALOG = {
  warrior: 'https://mineskin.org/skin/1',   // placeholder URLs
  miner: 'https://mineskin.org/skin/2',
  builder: 'https://mineskin.org/skin/3',
  explorer: 'https://mineskin.org/skin/4',
  alchemist: 'https://mineskin.org/skin/5',
};

function skinRoutes(teamStore, agentManager, rconSend) {
  const router = require('express').Router();

  function requireAuth(req, res, next) {
    const key = req.headers['x-api-key'] || req.query.api_key;
    const team = teamStore.authenticate(key);
    if (!team) return res.status(401).json({ ok: false, error: 'invalid_api_key' });
    req.team = team;
    next();
  }

  router.post('/teams/:id/agents/:name/skin', requireAuth, async (req, res) => {
    const { method, url, style, soul } = req.body || {};
    const agent = agentManager.getAgent(req.params.id, req.params.name);
    if (!agent) return res.status(404).json({ ok: false, error: 'agent_not_found' });

    let skinUrl;

    if (method === 'url') {
      skinUrl = url;
    } else if (method === 'catalog') {
      skinUrl = SKIN_CATALOG[style] || SKIN_CATALOG.warrior;
    } else if (method === 'generate') {
      // TODO: integrate with avatar generation pipeline
      // For now, use a catalog skin
      skinUrl = SKIN_CATALOG.warrior;
    } else {
      return res.status(400).json({ ok: false, error: 'method must be url, catalog, or generate' });
    }

    // Apply via SkinsRestorer RCON command
    try {
      await rconSend(`skin set ${agent.display_name} url ${skinUrl}`);
      res.json({ ok: true, skin_url: skinUrl, applied: true });
    } catch (err) {
      res.json({ ok: true, skin_url: skinUrl, applied: false, rcon_error: err.message });
    }
  });

  return router;
}

module.exports = { skinRoutes };
```

**Step 2: Wire into server.js with RCON connection**

```js
const { Rcon } = require('rcon-client');
const { skinRoutes } = require('./skin-routes.js');

// After RCON connects:
let rconClient;
async function connectRcon() {
  rconClient = await Rcon.connect({
    host: process.env.RCON_HOST || '127.0.0.1',
    port: Number(process.env.RCON_PORT || 25575),
    password: process.env.RCON_PASSWORD || 'clawcraft',
  });
  log.info('RCON connected');
  app.use(skinRoutes(teamStore, agentManager, (cmd) => rconClient.send(cmd)));
}
connectRcon().catch(err => log.warn({ err: err.message }, 'RCON not available yet'));
```

**Step 3: Commit**

```bash
git add app/skin-routes.js app/server.js
git commit -m "feat: skin pipeline with catalog/url/generate + SkinsRestorer RCON"
```

---

## Task 9: Event Page — Countdown + Live Leaderboard

**Files:**
- Create: `event-page/index.html`
- Create: `event-page/Dockerfile` (simple nginx)

**Step 1: Create the event page**

Single HTML file with embedded CSS/JS. No framework. Fetches from API, connects to SSE feed.

```html
<!-- event-page/index.html -->
<!-- Full implementation: countdown timer, team list, leaderboard, SSE event feed, embedded Twitch -->
```

Complete implementation with:
- Countdown to midnight (configurable via `data-launch` attribute)
- Flips to live mode when countdown hits 0
- Fetches `/goal` every 10s for standings
- Connects to `/goal/feed` SSE for live events
- Shows registered teams from `/teams`
- Embedded Twitch player (iframe)
- Dark theme, monospace, minimal

**Step 2: Dockerfile for static serving**

```dockerfile
FROM nginx:alpine
COPY index.html /usr/share/nginx/html/index.html
```

**Step 3: Add to docker-compose.yml**

```yaml
  event-page:
    build: ./event-page
    ports:
      - "8080:80"
```

**Step 4: Commit**

```bash
git add event-page/ docker-compose.yml
git commit -m "feat: event page with countdown and live leaderboard"
```

---

## Task 10: Assemble Final server.js

**Files:**
- Modify: `app/server.js` (final assembly of all components)

**Step 1: Write the complete server.js**

Assembles: TeamStore, AgentManager, GoalTracker, GoalPoller, agent routes, skin routes, goal routes, SSE feed, RCON connection, CORS headers.

**Step 2: Verify full syntax**

```bash
node --check app/server.js
```

**Step 3: Commit**

```bash
git add app/server.js
git commit -m "feat: assemble complete API server with all routes"
```

---

## Task 11: Deploy Script for Hetzner

**Files:**
- Create: `deploy.sh`
- Modify: `.env.example` (add new vars)

**Step 1: Write deploy.sh**

```bash
#!/bin/bash
# deploy.sh — one-command deploy to Hetzner
# Usage: HETZNER_IP=x.x.x.x ./deploy.sh

set -euo pipefail
HOST="${HETZNER_IP:?Set HETZNER_IP}"

echo "==> Installing Docker on $HOST..."
ssh root@$HOST 'curl -fsSL https://get.docker.com | sh'

echo "==> Cloning repo..."
ssh root@$HOST 'rm -rf /opt/clawcraft && git clone <repo-url> /opt/clawcraft'

echo "==> Copying .env..."
scp .env root@$HOST:/opt/clawcraft/.env

echo "==> Building and starting..."
ssh root@$HOST 'cd /opt/clawcraft && docker compose up -d --build'

echo "==> Done! Server at $HOST:25565, API at $HOST:3000, Event page at $HOST:8080"
```

**Step 2: Update .env.example with all new vars**

```bash
# Server
RCON_PASSWORD=clawcraft
MC_HOST=minecraft
MC_PORT=25565
RCON_HOST=minecraft
RCON_PORT=25575

# API
API_PORT=3000
CEREBRAS_API_KEY=
LOG_LEVEL=info

# Stream
TWITCH_STREAM_KEY=
```

**Step 3: Commit**

```bash
git add deploy.sh .env.example
git commit -m "feat: one-command Hetzner deploy script"
```

---

## Task 12: End-to-End Smoke Test

**Files:**
- Create: `test/e2e-smoke.sh`

**Step 1: Write smoke test script**

```bash
#!/bin/bash
# Smoke test: register team, spawn agent, check goal endpoint
set -euo pipefail
API="${API_URL:-http://localhost:3000}"

echo "1. Health check..."
curl -sf "$API/health" | jq .

echo "2. Register team..."
TEAM=$(curl -sf -X POST "$API/teams" \
  -H 'Content-Type: application/json' \
  -d '{"name":"TestTeam","wallet":"0x123"}')
echo "$TEAM" | jq .
API_KEY=$(echo "$TEAM" | jq -r '.api_key')

echo "3. Spawn agent..."
curl -sf -X POST "$API/teams/testteam/agents" \
  -H 'Content-Type: application/json' \
  -H "X-API-Key: $API_KEY" \
  -d '{"name":"TestBot","role":"primary"}' | jq .

echo "4. List agents..."
curl -sf "$API/teams/testteam/agents" | jq .

echo "5. Check goals..."
curl -sf "$API/goal" | jq .

echo "6. Check teams..."
curl -sf "$API/teams" | jq .

echo "ALL SMOKE TESTS PASSED"
```

**Step 2: Run against local docker compose**

```bash
docker compose up -d --build && sleep 30 && bash test/e2e-smoke.sh
```

**Step 3: Commit**

```bash
git add test/e2e-smoke.sh
git commit -m "test: add e2e smoke test script"
```

---

## Task Summary & Dependency Order

```
Task 1: Docker Compose (PaperMC + API scaffold)
  └─> Task 2: Team Registration API
       └─> Task 3: Agent Manager
            └─> Task 4: Agent API Routes
                 └─> Task 5: Enhanced Agent (pathfinder + tasks)
                      └─> Task 7: Goal Polling Loop
  └─> Task 6: Goal Tracker (can parallel with 3-5)
  └─> Task 8: Skin Pipeline (can parallel with 6-7)
  └─> Task 9: Event Page (can parallel with 3-8)
  └─> Task 10: Assemble server.js (after 2,4,6,7,8)
       └─> Task 11: Deploy Script
            └─> Task 12: E2E Smoke Test
```

**Parallelizable groups:**
- Group A: Tasks 3, 4, 5 (agent system)
- Group B: Task 6 (goal tracker)
- Group C: Task 9 (event page)
- Group D: Task 8 (skin pipeline)

Groups B, C, D can run in parallel with Group A.
