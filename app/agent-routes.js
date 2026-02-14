function agentRoutes(teamStore, agentManager) {
  const router = require('express').Router();

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

  router.post('/teams/:id/agents', requireAuth, async (req, res) => {
    const name = String(req.body?.name || '').trim();
    const role = String(req.body?.role || 'worker');

    if (name.length < 2 || name.length > 16) {
      return res.status(400).json({ ok: false, error: 'name must be 2-16 characters' });
    }

    const existing = agentManager.getAgent(req.params.id, name);
    if (existing) {
      return res.status(409).json({ ok: false, error: 'agent_exists' });
    }

    const teamId = req.params.id;
    const displayName = `[${req.team.name}] ${name}`;
    const port = agentManager.allocatePort();
    const meta = {
      name,
      role,
      soul: req.body?.soul || null,
      display_name: displayName,
      port,
      self_hosted: false,
      status: 'spawning',
    };

    agentManager.register(teamId, meta);
    teamStore.addAgent(teamId, meta);
    const spawned = await agentManager.spawn(teamId, name);

    return res.status(201).json({
      ok: true,
      team_id: teamId,
      agent_name: name,
      role,
      display_name: displayName,
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
    const meta = {
      name,
      role,
      display_name: displayName,
      self_hosted: true,
      port: null,
      status: 'registered',
    };

    agentManager.register(teamId, meta);
    teamStore.addAgent(teamId, meta);

    return res.status(201).json({
      ok: true,
      team_id: teamId,
      agent_name: name,
      display_name: displayName,
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

  router.post('/teams/:id/agents/:name/command', requireAuth, async (req, res) => {
    const result = await agentManager.proxyRequest(req.params.id, req.params.name, 'POST', '/action', req.body);
    return res.json(result);
  });

  router.post('/teams/:id/agents/:name/task', requireAuth, async (req, res) => {
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

  router.post('/teams/:id/agents/:name/plan', requireAuth, async (req, res) => {
    const result = await agentManager.proxyRequest(req.params.id, req.params.name, 'POST', '/plan', req.body);
    return res.json(result);
  });

  router.post('/teams/:id/agents/:name/message', requireAuth, async (req, res) => {
    const result = await agentManager.proxyRequest(req.params.id, req.params.name, 'POST', '/message', req.body);
    return res.json(result);
  });

  router.get('/teams/:id/agents/:name/logs', requireAuth, (req, res) => {
    const limit = Number(req.query.limit || 50);
    const logs = agentManager.getLogs(req.params.id, req.params.name, limit);
    return res.json({ ok: true, logs });
  });

  router.delete('/teams/:id/agents/:name', requireAuth, (req, res) => {
    const removed = agentManager.remove(req.params.id, req.params.name);
    if (!removed) {
      return res.status(404).json({ ok: false, error: 'agent_not_found' });
    }
    teamStore.removeAgent(req.params.id, req.params.name);
    return res.json({ ok: true, removed: true });
  });

  return router;
}

module.exports = { agentRoutes };
