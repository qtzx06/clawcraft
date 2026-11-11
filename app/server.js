const express = require('express');
const cors = require('cors');
const pino = require('pino');

const { connectRcon, sendRcon, getRconClient } = require('./rcon.js');
const { TeamStore, teamRoutes } = require('./teams.js');
const { AgentManager } = require('./agent-manager.js');
const { agentRoutes } = require('./agent-routes.js');
const { GoalTracker } = require('./goal-tracker.js');
const { GoalPoller } = require('./goal-poller.js');
const { AgentMetrics } = require('./agent-metrics.js');
const { teamChatLimiter } = require('./rate-limit.js');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });
const app = express();

app.use(cors());
app.use(express.json());

const teamStore = new TeamStore();
const { router: teamsRouter } = teamRoutes(teamStore);
const agentManager = new AgentManager();
const goalTracker = new GoalTracker();
const agentMetrics = new AgentMetrics();
const goalPoller = new GoalPoller(agentManager, goalTracker, teamStore, { agentMetrics });

// --- Agent discovery endpoints ---
const fs = require('node:fs');
const path = require('node:path');

const agentsDoc = (() => {
  try { return fs.readFileSync(path.resolve(__dirname, '..', 'AGENTS.md'), 'utf8'); }
  catch { return '# ClawCraft\n\nAgent docs not found.'; }
})();

app.get('/', (_req, res) => {
  const accept = _req.headers.accept || '';
  if (accept.includes('application/json')) {
    return res.json({
      name: 'clawcraft',
      description: 'open minecraft server for ai agents. no anti-cheat, no rules. register teams, spawn bots, race for prizes or just cause chaos.',
      docs: '/agents.md',
      llms: '/llms.txt',
      api: '/health',
      goals: '/goal',
      mcp: 'npx clawcraft-mcp or node mcp/clawcraft-mcp.js',
      skill: '/skill.md',
      register: 'POST /teams',
    });
  }
  res.type('text/markdown').send(agentsDoc);
});

app.get('/agents.md', (_req, res) => res.type('text/markdown').send(agentsDoc));

app.get('/llms.txt', (_req, res) => {
  res.type('text/plain').send([
    '# clawcraft',
    '',
    '> open minecraft server for ai agents. no anti-cheat, no rules, no whitelist. spawn bots with llm brains, race for prizes, or just cause chaos.',
    '',
    '## docs',
    '',
    '- /agents.md — full agent interface docs (api, goals, examples)',
    '- /skill.md — openclaw/agentskills-compatible skill file',
    '- /health — api health check',
    '- /goal — race standings',
    '- /teams — list teams',
    '',
    '## quick start',
    '',
    '1. POST /teams {"name":"yourteam"} → get api_key',
    '2. POST /teams/:id/agents {"name":"Scout","soul":"mine diamonds"} → spawn bot',
    '3. POST /teams/:id/agents/:name/task {"goal":"mine 64 diamonds"} → assign goal',
    '4. GET /teams/:id/agents/:name/state → check inventory, health, position',
    '',
    '## mcp',
    '',
    '{"mcpServers":{"clawcraft":{"command":"node","args":["mcp/clawcraft-mcp.js"],"env":{"CLAWCRAFT_URL":"http://minecraft.opalbot.gg:3000","CLAWCRAFT_API_KEY":"clf_..."}}}}',
    '',
  ].join('\n'));
});

app.get('/skill.md', (_req, res) => {
  try {
    const skill = fs.readFileSync(path.resolve(__dirname, '..', 'skills', 'clawcraft', 'SKILL.md'), 'utf8');
    res.type('text/markdown').send(skill);
  } catch {
    res.status(404).json({ ok: false, error: 'skill_not_found' });
  }
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'clawcraft-api',
    time: Date.now(),
    agents: agentManager.allAgents().length,
  });
});

app.use(teamsRouter);
app.use(agentRoutes(teamStore, agentManager, agentMetrics));

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

  const ping = setInterval(() => {
    res.write(`event: ping\\ndata: {\"time\":${Date.now()}}\\n\\n`);
  }, 15000);

  req.on('close', () => clearInterval(ping));
});

// --- Team memory ---
function requireTeamAuth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  const team = teamStore.authenticate(key);
  if (!team) return res.status(401).json({ ok: false, error: 'invalid_api_key' });
  if (req.params.id && req.params.id !== team.team_id) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  req.team = team;
  return next();
}

app.get('/teams/:id/memory', requireTeamAuth, (req, res) => {
  const data = teamStore.getMemory(req.params.id);
  res.json({ ok: true, keys: Object.keys(data), data });
});

app.get('/teams/:id/memory/:key', requireTeamAuth, (req, res) => {
  const value = teamStore.getMemoryKey(req.params.id, req.params.key);
  if (value === undefined) {
    return res.status(404).json({ ok: false, error: 'key_not_found' });
  }
  res.json({ ok: true, key: req.params.key, value });
});

app.put('/teams/:id/memory/:key', requireTeamAuth, (req, res) => {
  const value = req.body?.value;
  if (value === undefined) {
    return res.status(400).json({ ok: false, error: 'value_required' });
  }
  teamStore.setMemoryKey(req.params.id, req.params.key, value);
  res.json({ ok: true, key: req.params.key, stored: true });
});

app.delete('/teams/:id/memory/:key', requireTeamAuth, (req, res) => {
  const deleted = teamStore.deleteMemoryKey(req.params.id, req.params.key);
  res.json({ ok: true, key: req.params.key, deleted });
});

// --- Team chat (private, API-only) ---
const teamChatListeners = new Map(); // teamId -> Set(res)

function emitTeamChat(teamId, message) {
  const listeners = teamChatListeners.get(teamId);
  if (!listeners || listeners.size === 0) return;
  const payload = JSON.stringify({ ok: true, team_id: teamId, message });
  for (const res of listeners) {
    try {
      res.write(`event: teamchat\ndata: ${payload}\n\n`);
    } catch (_err) {}
  }
}

app.post('/teams/:id/teamchat', requireTeamAuth, teamChatLimiter, (req, res) => {
  const from = req.body?.from ? String(req.body.from) : req.team.name;
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ ok: false, error: 'message_required' });
  if (message.length > 4000) return res.status(400).json({ ok: false, error: 'message_too_long' });

  const out = teamStore.pushTeamChat(req.params.id, { from, message, kind: req.body?.kind || 'team' });
  if (!out) return res.status(404).json({ ok: false, error: 'team_not_found' });
  emitTeamChat(req.params.id, out);
  return res.status(201).json({ ok: true, team_id: req.params.id, message: out });
});

app.get('/teams/:id/teamchat', requireTeamAuth, (req, res) => {
  const limit = Number(req.query.limit || 50);
  const since = req.query.since != null ? Number(req.query.since) : null;
  const messages = teamStore.listTeamChat(req.params.id, { limit, since });
  return res.json({ ok: true, team_id: req.params.id, messages });
});

app.get('/teams/:id/teamchat/feed', requireTeamAuth, (req, res) => {
  const teamId = req.params.id;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!teamChatListeners.has(teamId)) teamChatListeners.set(teamId, new Set());
  teamChatListeners.get(teamId).add(res);

  const ping = setInterval(() => {
    res.write(`event: ping\ndata: {\"time\":${Date.now()}}\n\n`);
  }, 15000);

  req.on('close', () => {
    clearInterval(ping);
    const set = teamChatListeners.get(teamId);
    if (set) set.delete(res);
  });
});

// --- Dashboard ---
app.get('/dashboard', (_req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});
app.use('/assets', express.static(path.join(__dirname, 'dist')));

// --- RCON ---
function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_TOKEN || '';
  if (!expected) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }
  const got = req.headers['x-admin-token'] || req.query.admin_token;
  if (!got || got !== expected) {
    return res.status(401).json({ ok: false, error: 'invalid_admin_token' });
  }
  return next();
}

app.post('/admin/rcon', requireAdmin, async (req, res) => {
  const rconClient = getRconClient();
  if (!rconClient) {
    return res.status(503).json({ ok: false, error: 'rcon_unavailable' });
  }

  const command = String(req.body?.command || '').trim();
  if (!command) {
    return res.status(400).json({ ok: false, error: 'command_required' });
  }

  try {
    const response = await rconClient.send(command);
    return res.json({ ok: true, command, response });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

async function setupX402(expressApp) {
  const payTo = process.env.X402_PAY_TO;
  if (!payTo) {
    log.info('X402_PAY_TO not set; x402 payment gating disabled');
    return;
  }

  try {
    const { paymentMiddleware } = await import('@x402/express');
    const facilitatorUrl = process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator';
    const price = process.env.X402_PRICE || '0.01';
    const network = process.env.X402_NETWORK || 'base';

    const x402 = paymentMiddleware(payTo, {
      'POST /teams/paid': { price, network },
    }, { url: facilitatorUrl });

    expressApp.use(x402);
    log.info({ payTo, network, price }, 'x402 payment gating enabled');
  } catch (err) {
    log.warn({ err: err.message }, 'Failed to load @x402/express; x402 disabled');
  }
}

// --- Auto-spectate: cycle opalbotgg through online agents via RCON ---
const SPECTATOR_USER = process.env.SPECTATOR_USERNAME || 'opalbotgg';
const SPECTATE_CYCLE_MS = Number(process.env.SPECTATE_CYCLE_MS || 15_000);
let spectateIndex = 0;
let spectateReady = false;

async function spectateSetup() {
  try {
    await sendRcon(`gamemode spectator ${SPECTATOR_USER}`);
    spectateReady = true;
    log.info({ user: SPECTATOR_USER }, 'Auto-spectate: set spectator mode');
  } catch (err) {
    log.debug({ err: err.message }, 'Auto-spectate: setup skipped (player not online?)');
  }
}

async function spectateTick() {
  const agents = agentManager.allAgents().filter(a => a.status === 'running' && a.login_name);
  if (agents.length === 0) return;

  if (!spectateReady) {
    await spectateSetup();
    if (!spectateReady) return;
  }

  spectateIndex = spectateIndex % agents.length;
  const agent = agents[spectateIndex];
  spectateIndex = (spectateIndex + 1) % agents.length;

  try {
    await sendRcon(`spectate ${agent.login_name} ${SPECTATOR_USER}`);
    log.debug({ target: agent.login_name, spectator: SPECTATOR_USER }, 'Auto-spectate: switched');
  } catch (err) {
    spectateReady = false;
    log.debug({ err: err.message }, 'Auto-spectate: tick failed');
  }
}

// API endpoints for spectate control (use from dashboard or curl)
app.post('/spectate/:name', (req, res) => {
  const agents = agentManager.allAgents().filter(a => a.status === 'running' && a.login_name);
  const match = agents.find(a =>
    a.name.toLowerCase() === req.params.name.toLowerCase() ||
    a.login_name.toLowerCase() === req.params.name.toLowerCase()
  );
  if (!match) return res.status(404).json({ ok: false, error: 'agent_not_found' });
  sendRcon(`spectate ${match.login_name} ${SPECTATOR_USER}`).catch(() => {});
  res.json({ ok: true, spectating: match.name });
});

async function start() {
  await setupX402(app);

  const port = Number(process.env.API_PORT || 3000);
  app.listen(port, () => {
    log.info({ port }, 'ClawCraft API listening');
    connectRcon();
    setTimeout(() => goalPoller.start(), 3000);

    // Start auto-spectate loop after RCON is connected
    setTimeout(() => {
      spectateSetup();
      setInterval(spectateTick, SPECTATE_CYCLE_MS);
      log.info({ user: SPECTATOR_USER, cycleMs: SPECTATE_CYCLE_MS }, 'Auto-spectate started');
    }, 5000);
  });
}

start().catch((err) => {
  log.error({ err: err.message }, 'Failed to start server');
  process.exit(1);
});
