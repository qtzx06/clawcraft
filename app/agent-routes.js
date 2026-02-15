function agentRoutes(teamStore, agentManager) {
  const router = require('express').Router();
  const { makeLoginUsername } = require('./mc-username.js');
  const { setupAgentTeam, removeFromTeam } = require('./mc-teams.js');
  const { agentCommandLimiter, publicChatLimiter } = require('./rate-limit.js');

  function requireAuth(req, res, next) {
    const key = req.headers['x-api-key'] || req.query.api_key;
    const team = teamStore.authenticate(key);
    if (!team) {
      return res.status(401).json({ ok: false, error: 'invalid_api_key' });
    }
    if (req.params.id && req.params.id !== team.team_id) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    req.team = team;
    return next();
  }

  const MAX_AGENTS_PER_TEAM = Number(process.env.MAX_AGENTS_PER_TEAM || 3);
  const MAX_TOTAL_AGENTS = Number(process.env.MAX_TOTAL_AGENTS || 200);

  router.post('/teams/:id/agents', requireAuth, async (req, res) => {
    const name = String(req.body?.name || '').trim();
    const role = String(req.body?.role || 'worker');

    if (name.length < 2 || name.length > 24) {
      return res.status(400).json({ ok: false, error: 'name must be 2-24 characters' });
    }

    const existing = agentManager.getAgent(req.params.id, name);
    if (existing) {
      return res.status(409).json({ ok: false, error: 'agent_exists' });
    }

    const teamId = req.params.id;

    // Spawn limits
    const teamAgents = agentManager.listAgents(teamId);
    if (teamAgents.length >= MAX_AGENTS_PER_TEAM) {
      return res.status(429).json({ ok: false, error: 'max_agents_per_team', limit: MAX_AGENTS_PER_TEAM });
    }
    if (agentManager.allAgents().length >= MAX_TOTAL_AGENTS) {
      return res.status(429).json({ ok: false, error: 'max_total_agents', limit: MAX_TOTAL_AGENTS });
    }

    const displayName = `[${req.team.name}] ${name}`;
    const loginName = makeLoginUsername(teamId, name);
    const port = agentManager.allocatePort();
    const meta = {
      name,
      role,
      soul: req.body?.soul || null,
      display_name: displayName,
      login_name: loginName,
      port,
      self_hosted: false,
      status: 'spawning',
    };

    agentManager.register(teamId, meta);
    teamStore.addAgent(teamId, meta);
    const spawned = await agentManager.spawn(teamId, name);

    // Fire-and-forget: assign MC scoreboard team for colored prefix
    setupAgentTeam(teamId, req.team.name, loginName).catch(() => {});

    return res.status(201).json({
      ok: true,
      team_id: teamId,
      agent_name: name,
      role,
      display_name: displayName,
      login_name: loginName,
      port,
      status: spawned?.status || 'registered',
      control_url: `/teams/${teamId}/agents/${name}`,
    });
  });

  router.post('/teams/:id/agents/register', requireAuth, (req, res) => {
    const name = String(req.body?.name || '').trim();
    const role = String(req.body?.role || 'worker');
    if (!name) {
      return res.status(400).json({ ok: false, error: 'name required' });
    }

    const teamId = req.params.id;
    const displayName = `[${req.team.name}] ${name}`;
    const loginName = req.body?.login_name ? String(req.body.login_name).trim() : makeLoginUsername(teamId, name);
    const meta = {
      name,
      role,
      display_name: displayName,
      login_name: loginName,
      self_hosted: true,
      port: null,
      status: 'registered',
    };

    agentManager.register(teamId, meta);
    teamStore.addAgent(teamId, meta);

    // Fire-and-forget: assign MC scoreboard team for colored prefix
    setupAgentTeam(teamId, req.team.name, loginName).catch(() => {});

    return res.status(201).json({
      ok: true,
      team_id: teamId,
      agent_name: name,
      display_name: displayName,
      login_name: loginName,
      self_hosted: true,
    });
  });

  router.get('/teams/:id/agents', (req, res) => {
    const agents = agentManager.listAgents(req.params.id);
    return res.json({
      ok: true,
      agents: agents.map((a) => ({
        name: a.name,
        display_name: a.display_name,
        login_name: a.login_name || null,
        role: a.role,
        status: a.status,
        self_hosted: Boolean(a.self_hosted),
        port: a.port,
      })),
    });
  });

  router.get('/teams/:id/agents/:name/state', requireAuth, async (req, res) => {
    const result = await agentManager.proxyRequest(req.params.id, req.params.name, 'GET', '/state');
    return res.json(result);
  });

  router.get('/teams/:id/agents/:name/capabilities', requireAuth, async (req, res) => {
    const result = await agentManager.proxyRequest(req.params.id, req.params.name, 'GET', '/capabilities');
    return res.json(result);
  });

  router.post('/teams/:id/agents/:name/command', requireAuth, agentCommandLimiter, async (req, res) => {
    const result = await agentManager.proxyRequest(req.params.id, req.params.name, 'POST', '/action', req.body);
    return res.json(result);
  });

  // Explicit public chat endpoint so agent frameworks don't "accidentally" use it.
  router.post('/teams/:id/agents/:name/say_public', requireAuth, publicChatLimiter, async (req, res) => {
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ ok: false, error: 'message_required' });
    const result = await agentManager.proxyRequest(req.params.id, req.params.name, 'POST', '/action', {
      type: 'say_public',
      message,
    });
    return res.json(result);
  });

  router.post('/teams/:id/agents/:name/task', requireAuth, agentCommandLimiter, async (req, res) => {
    const result = await agentManager.proxyRequest(req.params.id, req.params.name, 'POST', '/task', req.body);
    return res.json(result);
  });

  router.get('/teams/:id/agents/:name/task/status', requireAuth, async (req, res) => {
    const result = await agentManager.proxyRequest(req.params.id, req.params.name, 'GET', '/task/status');
    return res.json(result);
  });

  router.get('/teams/:id/agents/:name/plan', requireAuth, async (req, res) => {
    const result = await agentManager.proxyRequest(req.params.id, req.params.name, 'GET', '/plan');
    return res.json(result);
  });

  router.post('/teams/:id/agents/:name/plan', requireAuth, agentCommandLimiter, async (req, res) => {
    const result = await agentManager.proxyRequest(req.params.id, req.params.name, 'POST', '/plan', req.body);
    return res.json(result);
  });

  router.post('/teams/:id/agents/:name/message', requireAuth, agentCommandLimiter, async (req, res) => {
    const result = await agentManager.proxyRequest(req.params.id, req.params.name, 'POST', '/message', req.body);
    return res.json(result);
  });

  router.get('/teams/:id/agents/:name/logs', requireAuth, (req, res) => {
    const limit = Number(req.query.limit || 50);
    const logs = agentManager.getLogs(req.params.id, req.params.name, limit);
    return res.json({ ok: true, logs });
  });

  router.delete('/teams/:id/agents/:name', requireAuth, (req, res) => {
    const agent = agentManager.getAgent(req.params.id, req.params.name);
    const loginName = agent?.login_name;
    const removed = agentManager.remove(req.params.id, req.params.name);
    if (!removed) {
      return res.status(404).json({ ok: false, error: 'agent_not_found' });
    }
    teamStore.removeAgent(req.params.id, req.params.name);
    if (loginName) removeFromTeam(loginName).catch(() => {});
    return res.json({ ok: true, removed: true });
  });

  return router;
}

module.exports = { agentRoutes };
