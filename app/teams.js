const crypto = require('node:crypto');

function toTeamId(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

class TeamStore {
  constructor() {
    this.teams = new Map();
    this.apiKeys = new Map();
  }

  register(input = {}) {
    const name = String(input.name || '').trim();
    const wallet = input.wallet ? String(input.wallet).trim() : null;

    if (name.length < 2 || name.length > 24) {
      return { ok: false, error: 'name_invalid' };
    }

    const teamId = toTeamId(name);
    if (!teamId) {
      return { ok: false, error: 'name_invalid' };
    }

    if (this.teams.has(teamId)) {
      return { ok: false, error: 'team_exists' };
    }

    const apiKey = `clf_${crypto.randomBytes(16).toString('hex')}`;
    const team = {
      team_id: teamId,
      name,
      wallet,
      api_key: apiKey,
      agents: [],
      created_at: Date.now(),
    };

    this.teams.set(teamId, team);
    this.apiKeys.set(apiKey, teamId);

    return {
      ok: true,
      team_id: teamId,
      name,
      api_key: apiKey,
    };
  }

  authenticate(apiKey) {
    if (!apiKey) return null;
    const teamId = this.apiKeys.get(String(apiKey));
    if (!teamId) return null;
    return this.teams.get(teamId) || null;
  }

  get(teamId) {
    return this.teams.get(String(teamId || '')) || null;
  }

  list() {
    return [...this.teams.values()].map((team) => ({
      team_id: team.team_id,
      name: team.name,
      wallet: team.wallet,
      agent_count: team.agents.length,
      agents: team.agents.map((a) => a.name),
      created_at: team.created_at,
    }));
  }

  addAgent(teamId, agentMeta) {
    const team = this.get(teamId);
    if (!team) return null;
    team.agents.push(agentMeta);
    return agentMeta;
  }

  getAgent(teamId, name) {
    const team = this.get(teamId);
    if (!team) return null;
    return team.agents.find((agent) => agent.name === name) || null;
  }

  removeAgent(teamId, name) {
    const team = this.get(teamId);
    if (!team) return false;
    const idx = team.agents.findIndex((agent) => agent.name === name);
    if (idx < 0) return false;
    team.agents.splice(idx, 1);
    return true;
  }
}

function teamRoutes(store) {
  const router = require('express').Router();

  function requireAuth(req, res, next) {
    const key = req.headers['x-api-key'] || req.query.api_key;
    const team = store.authenticate(key);
    if (!team) {
      return res.status(401).json({ ok: false, error: 'invalid_api_key' });
    }
    req.team = team;
    return next();
  }

  router.post('/teams', (req, res) => {
    const result = store.register(req.body || {});
    if (!result.ok) {
      const code = result.error === 'team_exists' ? 409 : 400;
      return res.status(code).json(result);
    }
    return res.status(201).json(result);
  });

  router.get('/teams', (_req, res) => {
    return res.json({ ok: true, teams: store.list() });
  });

  router.get('/teams/:id', (req, res) => {
    const team = store.get(req.params.id);
    if (!team) {
      return res.status(404).json({ ok: false, error: 'team_not_found' });
    }

    return res.json({
      ok: true,
      team_id: team.team_id,
      name: team.name,
      wallet: team.wallet,
      agents: team.agents.map((agent) => ({
        name: agent.name,
        display_name: agent.display_name,
        role: agent.role,
        status: agent.status,
        self_hosted: Boolean(agent.self_hosted),
      })),
    });
  });

  return { router, requireAuth };
}

module.exports = {
  TeamStore,
  teamRoutes,
  toTeamId,
};
