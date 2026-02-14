const fs = require('fs/promises');
const path = require('path');
const express = require('express');
require('dotenv').config({
  path: process.env.DOTENV_PATH || path.resolve(process.cwd(), '.env')
});

const { MissionBoard } = require('./mission-board/mission-board');
const { AgentRuntime } = require('./agents/agent-runtime');
const { buildPremiumContext } = require('./persona/persona-graph');

const DEFAULT_PORT = 3020;
const DEFAULT_SERVER_PORT = Number(process.env.OPENCLAW_BRIDGE_PORT || DEFAULT_PORT);
const PRIORITIES = new Set(['low', 'normal', 'high']);

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function parseJsonBody(req, res, next) {
  express.json({ limit: '1mb' })(req, res, (err) => {
    if (err) {
      return res.status(400).json({ ok: false, error: 'Invalid JSON payload' });
    }
    return next();
  });
}

function requireAuth(token) {
  return function auth(req, res, next) {
    if (!token) return next();
    const provided = req.get('authorization') || '';
    if (provided === `Bearer ${token}`) return next();
    return res.status(401).json({ ok: false, error: 'Missing or invalid authorization' });
  };
}

function normalizePort(raw, fallback = 25565) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
    throw new ApiError(400, 'port must be 1-65535');
  }
  return parsed;
}

function normalizeUsername(raw) {
  const username = String(raw || '').trim();
  if (!username) throw new ApiError(400, 'username is required');
  if (username.length > 16) throw new ApiError(400, 'username max length is 16');
  if (!/^[a-zA-Z0-9_]{1,16}$/.test(username)) {
    throw new ApiError(400, 'username must use letters, numbers, or underscore');
  }
  return username;
}

function normalizeConnector(raw = '') {
  const value = String(raw || '').toLowerCase().trim();
  return value === 'mindcraft' ? 'mindcraft' : 'mineflayer';
}

function normalizePriority(raw, fallback = 'normal') {
  const priority = String(raw || '').toLowerCase().trim();
  return PRIORITIES.has(priority) ? priority : fallback;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const portArg = args.find((value) => value.startsWith('--port='));
  const configArg = args.find((value) => value.startsWith('--config='));
  const boardArg = args.find((value) => value.startsWith('--board='));
  return {
    port: portArg ? Number(portArg.replace('--port=', '')) : null,
    configPath: configArg ? configArg.replace('--config=', '') : null,
    boardPath: boardArg ? boardArg.replace('--board=', '') : null
  };
}

function normalizePayload(payload = {}) {
  const host = String(payload.host || process.env.MC_HOST || '').trim();
  if (!host) throw new ApiError(400, 'host is required');

  return {
    host,
    port: normalizePort(payload.port || process.env.MC_PORT || 25565),
    username: normalizeUsername(payload.username),
    mission: payload.mission && String(payload.mission).trim(),
    task: payload.task && String(payload.task).trim(),
    missionTask: payload.mission || payload.task ? String(payload.mission || payload.task).trim() : null,
    soul: payload.soul && String(payload.soul),
    soulPath: payload.soul_path && String(payload.soul_path),
    soulFile: payload.soul_file && String(payload.soul_file),
    auth: payload.auth || process.env.MC_AUTH || 'offline',
    connector: normalizeConnector(payload.connector),
    replace: Boolean(payload.replace),
    missionPriority: normalizePriority(payload.mission_priority || payload.priority, 'normal'),
    llm: payload.llm || {}
  };
}

function normalizePremiumPayload(payload = {}) {
  const soul = payload.soul || payload.soul_file || payload.soul_path || payload.soulSource;
  if (!soul) throw new ApiError(400, 'soul is required');

  return {
    soul,
    gameState: payload.game_state && typeof payload.game_state === 'object'
      ? payload.game_state
      : payload.gameState && typeof payload.gameState === 'object'
        ? payload.gameState
        : {},
    action: payload.action && typeof payload.action === 'object' ? payload.action : {},
    mission: payload.mission && typeof payload.mission === 'object' ? payload.mission : {},
    llm: payload.llm || {},
    use_llm: payload.use_llm !== false
  };
}

class OpenClawBridge {
  constructor(config = {}) {
    this.port = config.port;
    this.configPath = config.configPath || process.env.CLAWCRAFT_ENGINE_CONFIG || 'app/engine/config/agents.config.json';
    this.boardPath = config.boardPath || process.env.CLAWCRAFT_MISSION_BOARD || 'app/engine/mission-board/state.runtime.json';
    this.runningAgents = new Map();
    this.app = express();
    this.board = null;
    this.serverConfig = {};
    this.logPrefix = '[openclaw-bridge]';
    this.authToken = process.env.OPENCLAW_BRIDGE_TOKEN;
    this.logger = {
      info: (...args) => console.log(...[this.logPrefix, ...args]),
      warn: (...args) => console.warn(...[this.logPrefix, ...args]),
      error: (...args) => console.error(...[this.logPrefix, ...args])
    };
  }

  async initialize() {
    this.app.use(requireAuth(this.authToken));
    this.serverConfig = await this.loadConfig(this.configPath);
    this.board = await this.loadBoard(this.serverConfig.seed);
    this.setupRoutes();
  }

  async loadConfig(configPath) {
    const resolved = path.resolve(process.cwd(), configPath);
    try {
      const raw = await fs.readFile(resolved, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        ...parsed,
        mc: parsed.mc || {},
        llm: parsed.llm || {},
        seed: parsed.seed || {}
      };
    } catch (_error) {
      return {
        mc: {},
        llm: {},
        seed: {},
        agents: []
      };
    }
  }

  async loadBoard(seed) {
    const board = new MissionBoard({
      stateFilePath: this.boardPath,
      seed: seed || {}
    });
    await board.initialize(seed || {});
    return board;
  }

  async loadSoul(contentOrPath = '') {
    const value = String(contentOrPath).trim();
    if (!value) throw new ApiError(400, 'soul is required');

    const candidate = path.resolve(process.cwd(), value);
    try {
      const stats = await fs.stat(candidate);
      if (stats.isFile()) {
        return fs.readFile(candidate, 'utf8');
      }
    } catch (_error) {
      // Not a filesystem path, try inline markdown.
    }

    if (!value.includes('\n') && value.length < 8 && !value.endsWith('.md')) {
      throw new ApiError(400, 'soul must be markdown content or a path to a .md file');
    }

    return value;
  }

  getLlmConfig(overrides = {}) {
    const llm = this.serverConfig.llm || {};
    const baseUrl = overrides.baseUrl || llm.baseUrl || process.env.LLM_BASE_URL;
    const apiKey = overrides.apiKey || llm.apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
    const model = overrides.model || llm.model || process.env.LLM_MODEL || 'gpt-4o-mini';
    const temperature = Number.isFinite(Number(overrides.temperature)) ? Number(overrides.temperature)
      : Number.isFinite(Number(process.env.LLM_TEMPERATURE))
        ? Number(process.env.LLM_TEMPERATURE)
        : Number.isFinite(Number(llm.temperature))
          ? Number(llm.temperature)
        : 0.4;
    const timeoutMs = Number.isFinite(Number(overrides.timeoutMs))
      ? Number(overrides.timeoutMs)
      : Number.isFinite(Number(llm.timeoutMs))
        ? Number(llm.timeoutMs)
        : Number.isFinite(Number(process.env.LLM_TIMEOUT_MS))
          ? Number(process.env.LLM_TIMEOUT_MS)
          : 15000;

    return {
      baseUrl: baseUrl || 'https://api.openai.com/v1',
      apiKey: apiKey || '',
      model,
      temperature,
      timeoutMs
    };
  }

  getMissionPollMs() {
    const value = Number(this.serverConfig.agentLoopMs || this.serverConfig.missionPollMs || 9000);
    return Number.isFinite(value) ? value : 9000;
  }

  getMaxAttempts() {
    const value = Number(this.serverConfig.maxAttemptsPerMission || 2);
    return Number.isFinite(value) ? value : 2;
  }

  async buildBot({
    host,
    port,
    username,
    soulContent,
    auth = 'offline',
    connector = 'mineflayer',
    llm = {}
  }) {
    const id = `openclaw-${username}`;
    const runtime = new AgentRuntime({
      id,
      username,
      soulFile: soulContent,
      connector,
      mc: {
        host,
        port: Number(port),
        auth,
        mindcraftPath: process.env.MINDCRAFT_PATH
      },
      board: this.board,
      missionPollMs: this.getMissionPollMs(),
      maxAttemptsPerMission: this.getMaxAttempts(),
      llmConfig: this.getLlmConfig(llm)
    });

    return runtime;
  }

  async startAgent(spec) {
    const payload = normalizePayload(spec);
    const id = `openclaw-${payload.username}`;

    if (this.runningAgents.has(id) && !payload.replace) {
      throw new ApiError(409, 'agent already running for username');
    }

    if (this.runningAgents.has(id) && payload.replace) {
      await this.stopAgent(payload.username);
    }

    const soulSource = payload.soul || payload.soulPath || payload.soulFile;
    const soulContent = await this.loadSoul(soulSource);
    const runtime = await this.buildBot({
      host: payload.host,
      port: payload.port,
      username: payload.username,
      soulContent,
      auth: payload.auth || this.serverConfig.mc?.auth || 'offline',
      connector: payload.connector,
      llm: payload.llm
    });

    await runtime.start();
    this.runningAgents.set(id, runtime);

    const mission = await this.enqueueMissionForAgent(id, payload);
    return {
      id,
      username: payload.username,
      host: payload.host,
      port: payload.port,
      connector: payload.connector,
      started: true,
      mission
    };
  }

  async stopAgent(username) {
    const id = `openclaw-${normalizeUsername(username)}`;
    const runtime = this.runningAgents.get(id);
    if (!runtime) {
      return { stopped: false, reason: 'not found' };
    }
    await runtime.stop();
    this.runningAgents.delete(id);
    return { stopped: true };
  }

  async listAgents() {
    if (!this.board) return { count: 0, bots: [], missions: { open: 0, in_progress: 0, done: 0 } };
    const snapshot = await this.board.getSnapshot();
    const botStatuses = [...this.runningAgents.values()].map((runtime) => runtime.getStatus());

    const open = snapshot.missions.filter((mission) => mission.status === 'open').length;
    const inProgress = snapshot.missions.filter((mission) => mission.status === 'in_progress').length;
    const done = snapshot.missions.filter((mission) => mission.status === 'done').length;
    const viewerOpen = snapshot.viewer_missions.filter((mission) => mission.status === 'open').length;
    const viewerInProgress = snapshot.viewer_missions.filter((mission) => mission.status === 'in_progress').length;
    const viewerDone = snapshot.viewer_missions.filter((mission) => mission.status === 'done').length;

    return {
      count: botStatuses.length,
      bots: botStatuses,
      missions: {
        open: open + viewerOpen,
        in_progress: inProgress + viewerInProgress,
        done: done + viewerDone
      }
    };
  }

  async enqueueMissionForAgent(agentId, payload) {
    const text = payload.missionTask;
    if (!text) return null;

    const mission = await this.board.addSystemMission({
      task: text,
      source: 'system',
      priority: payload.missionPriority
    });

    const claimed = await this.board.claimMission(agentId, mission.id);
    return {
      mission,
      claimed: Boolean(claimed)
    };
  }

  async addMission(payload = {}) {
    const hasUsername = typeof payload.username === 'string' && payload.username.trim();
    const username = hasUsername ? normalizeUsername(payload.username) : null;
    const task = payload.task ? String(payload.task).trim() : '';
    if (!task) throw new ApiError(400, 'task required');

    const requestedId = payload.assign_to ? `openclaw-${normalizeUsername(payload.assign_to)}` : null;
    const targetId = requestedId || (username ? `openclaw-${username}` : null);
    const assignTarget = targetId && this.runningAgents.has(targetId) ? targetId : null;

    const mission = await this.board.addSystemMission({
      task,
      priority: normalizePriority(payload.priority, 'normal'),
      source: 'system'
    });

    const claimTarget = assignTarget ? await this.board.claimMission(assignTarget, mission.id) : null;

    return {
      mission,
      assigned: Boolean(claimTarget),
      assigned_to: claimTarget ? assignTarget : null
    };
  }

  async getPremiumContext(payload = {}) {
    const normalized = normalizePremiumPayload(payload);
    const soul = await this.loadSoul(normalized.soul);
    const llmConfig = normalized.use_llm ? this.getLlmConfig(normalized.llm) : null;
    const context = await buildPremiumContext(soul, normalized.gameState, normalized.action, {
      mission: normalized.mission,
      llmConfig
    });

    return context;
  }

  async getPremiumVoice(payload = {}) {
    const context = await this.getPremiumContext(payload);
    return { voice: context.voice };
  }

  async getPremiumAvatar(payload = {}) {
    const context = await this.getPremiumContext(payload);
    return { avatarPrompt: context.avatarPrompt };
  }

  async getPremiumNarration(payload = {}) {
    const context = await this.getPremiumContext(payload);
    return { narration: {
      text: context.narrationSeed || '',
      in_character: true
    } };
  }

  setupRoutes() {
    const safeParse = (handler) => async (req, res) => {
      try {
        const payload = await handler(req, res);
        if (!res.headersSent) {
          res.status(200).json({ ok: true, ...payload });
        }
      } catch (error) {
        const status = error instanceof ApiError ? error.status : 400;
        this.logger.warn(String(error.message || error));
        if (!res.headersSent) {
          res.status(status).json({ ok: false, error: String(error.message || error) });
        }
      }
    };

    this.app.get('/health', safeParse(async () => ({ status: 'ok' })));

    this.app.post('/openclaw/join', parseJsonBody, safeParse(async (req) => {
      const output = await this.startAgent(req.body || {});
      return { action: 'joined', output };
    }));

    this.app.post('/openclaw/stop', parseJsonBody, safeParse(async (req) => {
      const username = normalizeUsername(req.body?.username);
      const stopped = await this.stopAgent(username);
      return { action: 'stopped', username, ...stopped };
    }));

    this.app.post('/openclaw/missions', parseJsonBody, safeParse(async (req) => ({
      action: 'mission_posted',
      result: await this.addMission(req.body || {})
    })));

    this.app.post('/openclaw/premium/context', parseJsonBody, safeParse(async (req) => ({
      action: 'premium_context',
      result: await this.getPremiumContext(req.body || {})
    })));

    this.app.post('/openclaw/premium/voice', parseJsonBody, safeParse(async (req) => ({
      action: 'premium_voice',
      result: await this.getPremiumVoice(req.body || {})
    })));

    this.app.post('/openclaw/premium/avatar', parseJsonBody, safeParse(async (req) => ({
      action: 'premium_avatar',
      result: await this.getPremiumAvatar(req.body || {})
    })));

    this.app.post('/openclaw/premium/narrate', parseJsonBody, safeParse(async (req) => ({
      action: 'premium_narrate',
      result: await this.getPremiumNarration(req.body || {})
    })));

    this.app.get('/openclaw/agents', safeParse(async () => ({
      action: 'agents_list',
      result: await this.listAgents()
    })));

    this.app.get('/openclaw/board', safeParse(async () => ({
      action: 'board_snapshot',
      board: await this.board.getSnapshot()
    })));
  }

  async start() {
    await this.initialize();

    return new Promise((resolve, reject) => {
      const server = this.app.listen(this.port, () => {
        this.logger.info(`openclaw bridge running on :${this.port}`);
        resolve(server);
      });
      server.on('error', (error) => {
        reject(error);
      });
    });
  }
}

async function main() {
  const args = parseArgs();
  const port = args.port || DEFAULT_SERVER_PORT;
  const configPath = args.configPath || process.env.CLAWCRAFT_ENGINE_CONFIG || 'app/engine/config/agents.config.json';
  const boardPath = args.boardPath || process.env.CLAWCRAFT_MISSION_BOARD || 'app/engine/mission-board/state.runtime.json';

  const bridge = new OpenClawBridge({
    port,
    configPath,
    boardPath
  });

  try {
    await bridge.start();
  } catch (error) {
    console.error('openclaw bridge failed', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  OpenClawBridge,
  ApiError
};
