const express = require('express');
const cors = require('cors');
const pino = require('pino');
const { Rcon } = require('rcon-client');

const { TeamStore, teamRoutes } = require('./teams.js');
const { AgentManager } = require('./agent-manager.js');
const { agentRoutes } = require('./agent-routes.js');
const { GoalTracker } = require('./goal-tracker.js');
const { GoalPoller } = require('./goal-poller.js');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });
const app = express();

app.use(cors());
app.use(express.json());

const teamStore = new TeamStore();
const { router: teamsRouter } = teamRoutes(teamStore);
const agentManager = new AgentManager();
const goalTracker = new GoalTracker();
const goalPoller = new GoalPoller(agentManager, goalTracker, teamStore);

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'clawcraft-api',
    time: Date.now(),
    agents: agentManager.allAgents().length,
  });
});

app.use(teamsRouter);
app.use(agentRoutes(teamStore, agentManager));

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

app.post('/teams/:id/teamchat', requireTeamAuth, (req, res) => {
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

// --- RCON ---
let rconClient = null;

async function connectRcon() {
  const host = process.env.RCON_HOST || process.env.MC_HOST || '127.0.0.1';
  const port = Number(process.env.RCON_PORT || 25575);
  const password = process.env.RCON_PASSWORD || '';

  if (!password) {
    log.warn('RCON_PASSWORD not set; skipping RCON connection');
    return;
  }

  try {
    rconClient = await Rcon.connect({ host, port, password });
    log.info({ host, port }, 'RCON connected');
  } catch (err) {
    log.warn({ err: err.message }, 'RCON connection failed');
  }
}

function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_TOKEN || '';
  if (!expected) {
    // If no admin token is configured, treat admin endpoints as disabled.
    return res.status(404).json({ ok: false, error: 'not_found' });
  }
  const got = req.headers['x-admin-token'] || req.query.admin_token;
  if (!got || got !== expected) {
    return res.status(401).json({ ok: false, error: 'invalid_admin_token' });
  }
  return next();
}

app.post('/admin/rcon', requireAdmin, async (req, res) => {
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

const port = Number(process.env.API_PORT || 3000);
app.listen(port, () => {
  log.info({ port }, 'ClawCraft API listening');
  connectRcon();
  setTimeout(() => goalPoller.start(), 3000);
});
