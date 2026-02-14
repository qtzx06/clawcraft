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

app.post('/admin/rcon', async (req, res) => {
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
