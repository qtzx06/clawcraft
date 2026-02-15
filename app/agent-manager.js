const { fork } = require('node:child_process');
const pino = require('pino');
const { resolveAgentEntrypoint } = require('./agent-runtime-runner.js');
const { makeLoginUsername } = require('./mc-username.js');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

class AgentManager {
  constructor(opts = {}) {
    this.mcHost = opts.mcHost || process.env.MC_HOST || '127.0.0.1';
    this.mcPort = opts.mcPort || Number(process.env.MC_PORT || 25565);
    this.basePort = opts.basePort || Number(process.env.AGENT_BASE_PORT || 4000);
    this.nextPort = this.basePort;
    this.dryRun = Boolean(opts.dryRun || Number(process.env.DRY_RUN_AGENTS || 0));
    this.agents = new Map();
  }

  allocatePort() {
    const port = this.nextPort;
    this.nextPort += 1;
    return port;
  }

  key(teamId, name) {
    return `${teamId}/${name}`;
  }

  register(teamId, agentMeta) {
    const key = this.key(teamId, agentMeta.name);
    const existing = this.agents.get(key);
    if (existing) return existing;

    const agent = {
      ...agentMeta,
      teamId,
      status: 'registered',
      process: null,
      pid: null,
      logs: [],
      maxLogs: 300,
      started_at: null,
      stopped_at: null,
      exit_code: null,
    };

    this.agents.set(key, agent);
    return agent;
  }

  getAgent(teamId, name) {
    return this.agents.get(this.key(teamId, name)) || null;
  }

  listAgents(teamId) {
    const out = [];
    for (const agent of this.agents.values()) {
      if (agent.teamId === teamId) out.push(agent);
    }
    return out;
  }

  allAgents() {
    return [...this.agents.values()];
  }

  appendLog(agent, msg) {
    agent.logs.push({ time: Date.now(), msg });
    if (agent.logs.length > agent.maxLogs) {
      agent.logs.shift();
    }
  }

  async spawn(teamId, name) {
    const agent = this.getAgent(teamId, name);
    if (!agent) return null;
    if (agent.process || agent.status === 'running') return agent;
    if (agent.self_hosted) {
      agent.status = 'registered';
      return agent;
    }

    if (this.dryRun) {
      agent.status = 'running';
      agent.started_at = Date.now();
      this.appendLog(agent, '[dry-run] spawned');
      return agent;
    }

    const entry = resolveAgentEntrypoint();
    if (!entry.path) {
      agent.status = 'error';
      this.appendLog(agent, `[spawn_error] ${entry.error}`);
      return agent;
    }

    const env = {
      ...process.env,
      MC_HOST: this.mcHost,
      MC_PORT: String(this.mcPort),
      // Login username must be valid MC username (no spaces/brackets).
      BOT_USERNAME: agent.login_name || makeLoginUsername(teamId, name),
      API_PORT: String(agent.port),
      TEAM_ID: teamId,
      AGENT_NAME: name,
      SOUL: agent.soul || '',
      CHAT_WHITELIST: process.env.CHAT_WHITELIST || '',
      RUNNER_SOURCE: entry.source,
    };

    // Mindcraft reads ./profiles/ relative to cwd. The bridge lives in
    // vendor/mindcraft-bridge/ but profiles are in vendor/mindcraft/, so
    // always set cwd to vendor/mindcraft/ when using either bridge or mindcraft entry.
    const entryDir = require('node:path').dirname(entry.path);
    const cwd = entryDir.includes('mindcraft-bridge')
      ? require('node:path').resolve(entryDir, '..', 'mindcraft')
      : entryDir;
    const child = fork(entry.path, [], { env, silent: true, cwd });

    child.stdout?.on('data', (chunk) => {
      const line = String(chunk).trim();
      if (line) this.appendLog(agent, line);
    });

    child.stderr?.on('data', (chunk) => {
      const line = String(chunk).trim();
      if (line) this.appendLog(agent, `[err] ${line}`);
    });

    child.on('exit', (code) => {
      agent.process = null;
      agent.pid = null;
      agent.stopped_at = Date.now();
      agent.exit_code = code;
      this.appendLog(agent, `[exit] code=${code}`);
      log.warn({ teamId, name, code }, 'Agent process exited');

      // auto-respawn on crash (max 5 attempts, 8s delay, backoff on rapid crashes)
      const maxRespawns = 5;
      agent._respawnCount = (agent._respawnCount || 0) + 1;
      const timeSinceStart = Date.now() - (agent.started_at || 0);
      if (timeSinceStart > 60_000) agent._respawnCount = 1; // reset if ran >1min

      if (agent._respawnCount <= maxRespawns && !agent._removed) {
        const delay = Math.min(8_000 * agent._respawnCount, 30_000);
        agent.status = 'respawning';
        this.appendLog(agent, `[respawn] attempt ${agent._respawnCount}/${maxRespawns} in ${delay / 1000}s`);
        log.info({ teamId, name, attempt: agent._respawnCount, delay }, 'Auto-respawning agent');
        setTimeout(() => {
          if (agent._removed) return;
          this.spawn(teamId, name).catch(err => {
            log.error({ teamId, name, err: err.message }, 'Auto-respawn failed');
          });
        }, delay);
      } else {
        agent.status = 'stopped';
        this.appendLog(agent, `[respawn] gave up after ${agent._respawnCount} attempts`);
      }
    });

    agent.process = child;
    agent.pid = child.pid || null;
    agent.status = 'running';
    agent.started_at = Date.now();
    agent.exit_code = null;
    this.appendLog(agent, `[spawned] pid=${child.pid} entry=${entry.path}`);
    log.info({ teamId, name, pid: child.pid, port: agent.port, entry: entry.path }, 'Agent spawned');

    return agent;
  }

  remove(teamId, name) {
    const key = this.key(teamId, name);
    const agent = this.agents.get(key);
    if (!agent) return false;
    agent._removed = true;

    if (agent.process) {
      agent.process.kill('SIGTERM');
      agent.process = null;
      agent.pid = null;
      agent.status = 'stopped';
    }

    this.agents.delete(key);
    return true;
  }

  getLogs(teamId, name, limit = 50) {
    const agent = this.getAgent(teamId, name);
    if (!agent) return [];
    return agent.logs.slice(-Math.max(1, Number(limit || 50)));
  }

  async proxyRequest(teamId, name, method, routePath, body) {
    const agent = this.getAgent(teamId, name);
    if (!agent || agent.status !== 'running' || !agent.port) {
      return { ok: false, error: 'agent_not_running' };
    }

    const url = `http://127.0.0.1:${agent.port}${routePath}`;
    try {
      const options = {
        method,
        headers: { 'Content-Type': 'application/json' },
      };
      if (body != null) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);
      const text = await response.text();
      if (!text) {
        return { ok: response.ok, status: response.status };
      }

      try {
        return JSON.parse(text);
      } catch (_err) {
        return { ok: response.ok, status: response.status, body: text };
      }
    } catch (err) {
      return { ok: false, error: `proxy_error:${err.message}` };
    }
  }
}

module.exports = { AgentManager };
