const crypto = require('node:crypto');

function toTeamId(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

class TeamStore {
  constructor() {
    this.teams = new Map();
    this.apiKeys = new Map();
    this.memory = new Map(); // teamId -> Map(key -> value)
    this.teamChat = new Map(); // teamId -> [{id,time,from,message}]
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
      verified_wallet: null,
      tier: 'free',
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
      verified_wallet: team.verified_wallet,
      tier: team.tier,
      agent_count: team.agents.length,
      agents: team.agents.map((a) => a.name),
      created_at: team.created_at,
    }));
  }

  verifyWallet(teamId, wallet) {
    const team = this.get(teamId);
    if (!team) return false;
    team.verified_wallet = wallet.toLowerCase();
    if (team.tier === 'free') team.tier = 'verified';
    return true;
  }

  setTier(teamId, tier) {
    const team = this.get(teamId);
    if (!team) return false;
    team.tier = tier;
    return true;
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

  getMemory(teamId) {
    const mem = this.memory.get(teamId);
    if (!mem) return {};
    return Object.fromEntries(mem);
  }

  getMemoryKey(teamId, key) {
    const mem = this.memory.get(teamId);
    if (!mem || !mem.has(key)) return undefined;
    return mem.get(key);
  }

  setMemoryKey(teamId, key, value) {
    if (!this.memory.has(teamId)) {
      this.memory.set(teamId, new Map());
    }
    this.memory.get(teamId).set(key, value);
  }

  deleteMemoryKey(teamId, key) {
    const mem = this.memory.get(teamId);
    if (!mem) return false;
    return mem.delete(key);
  }

  pushTeamChat(teamId, msg) {
    const team = this.get(teamId);
    if (!team) return null;
    const list = this.teamChat.get(teamId) || [];
    const id = `tc_${crypto.randomBytes(10).toString('hex')}`;
    const message = {
      id,
      time: Date.now(),
      from: String(msg?.from || 'team'),
      message: String(msg?.message || ''),
      kind: String(msg?.kind || 'team'),
    };
    list.push(message);
    // Keep memory bounded.
    const max = Math.max(50, Number(process.env.TEAMCHAT_MAX || 500));
    while (list.length > max) list.shift();
    this.teamChat.set(teamId, list);
    return message;
  }

  listTeamChat(teamId, opts = {}) {
    const list = this.teamChat.get(teamId) || [];
    const since = opts.since != null ? Number(opts.since) : null;
    const limit = Math.max(1, Number(opts.limit || 50));
    const filtered = since ? list.filter((m) => m.time > since) : list;
    return filtered.slice(-limit);
  }
}

function teamRoutes(store) {
  const router = require('express').Router();
  const { registrationLimiter } = require('./rate-limit.js');
  const { generateChallenge, verifyWalletSignature, verifyInlineSignature } = require('./wallet-auth.js');

  function requireAuth(req, res, next) {
    const key = req.headers['x-api-key'] || req.query.api_key;
    const team = store.authenticate(key);
    if (!team) {
      return res.status(401).json({ ok: false, error: 'invalid_api_key' });
    }
    req.team = team;
    return next();
  }

  router.post('/teams', registrationLimiter, async (req, res) => {
    const result = store.register(req.body || {});
    if (!result.ok) {
      const code = result.error === 'team_exists' ? 409 : 400;
      return res.status(code).json(result);
    }

    // Inline wallet verification: if wallet + wallet_signature provided, verify and upgrade
    if (req.body?.wallet && req.body?.wallet_signature) {
      const verify = await verifyInlineSignature(
        req.body.name,
        req.body.wallet,
        req.body.wallet_signature,
      );
      if (verify.ok) {
        store.verifyWallet(result.team_id, verify.wallet);
        result.tier = 'verified';
        result.verified_wallet = verify.wallet;
      }
    }

    result.tier = result.tier || 'free';
    return res.status(201).json(result);
  });

  // x402-gated paid registration — middleware applied in server.js if configured
  router.post('/teams/paid', async (req, res) => {
    const result = store.register(req.body || {});
    if (!result.ok) {
      const code = result.error === 'team_exists' ? 409 : 400;
      return res.status(code).json(result);
    }
    store.setTier(result.team_id, 'paid');
    if (req.body?.wallet) {
      store.verifyWallet(result.team_id, req.body.wallet);
    }
    result.tier = 'paid';
    return res.status(201).json(result);
  });

  // Challenge-response wallet verification
  router.post('/auth/challenge', (req, res) => {
    const wallet = String(req.body?.wallet || '').trim();
    if (!wallet) {
      return res.status(400).json({ ok: false, error: 'wallet_required' });
    }
    const challenge = generateChallenge(wallet);
    return res.json({ ok: true, ...challenge });
  });

  router.post('/auth/verify', requireAuth, async (req, res) => {
    const { nonce, signature } = req.body || {};
    if (!nonce || !signature) {
      return res.status(400).json({ ok: false, error: 'nonce_and_signature_required' });
    }
    const result = await verifyWalletSignature(nonce, signature);
    if (!result.ok) {
      return res.status(400).json(result);
    }
    store.verifyWallet(req.team.team_id, result.wallet);
    return res.json({ ok: true, tier: 'verified', verified_wallet: result.wallet });
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
      verified_wallet: team.verified_wallet,
      tier: team.tier,
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
