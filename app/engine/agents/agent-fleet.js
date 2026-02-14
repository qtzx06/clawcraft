const fs = require('fs/promises');
const path = require('path');
const { MissionBoard } = require('../mission-board/mission-board');
const { AgentRuntime } = require('./agent-runtime');

class AgentFleet {
  constructor(config = {}) {
    this.config = config;
    this.missionBoard = null;
    this.agents = [];
    this.llm = null;
  }

  static async loadConfig(filePath) {
    const resolved = path.resolve(process.cwd(), filePath);
    const raw = await fs.readFile(resolved, 'utf8');
    return JSON.parse(raw);
  }

  async initialize(config = this.config) {
    this.config = config || {};
    const {
      missionBoardFile = path.join('app', 'engine', 'mission-board', 'state.runtime.json'),
      seed = {},
      agents = [],
      mc = {},
      missionPollMs = 7000,
      agentLoopMs = 9000,
      maxAttemptsPerMission = 2,
      llm = {}
    } = this.config;

    this.missionBoard = new MissionBoard({
      stateFilePath: missionBoardFile,
      seed
    });
    await this.missionBoard.initialize(seed);
    this.agents = agents.map((agent) => new AgentRuntime({
      id: agent.id,
      username: agent.username,
      soulFile: path.resolve(process.cwd(), agent.soul_file),
      connector: agent.connector || 'mineflayer',
      mc: {
        host: agent.mc_host || mc.host || '127.0.0.1',
        port: Number(agent.mc_port || mc.port || 25565),
        auth: mc.auth || 'offline',
        mindcraftPath: process.env.MINDCRAFT_PATH
      },
      board: this.missionBoard,
      missionPollMs: Number(agentLoopMs || missionPollMs),
      maxAttemptsPerMission: Number(maxAttemptsPerMission),
      llmConfig: {
        baseUrl: llm.baseUrl,
        apiKey: llm.apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY,
        model: llm.model,
        temperature: llm.temperature,
        timeoutMs: llm.timeoutMs
      }
    }));
    return this;
  }

  async startAll() {
    if (!this.missionBoard) throw new Error('fleet not initialized');
    await Promise.all(this.agents.map((agent) => agent.start()));
  }

  async stopAll() {
    await Promise.all(this.agents.map((agent) => agent.stop()));
  }

  async getAgentStatus() {
    return Promise.all(this.agents.map((agent) => agent.getStatus()));
  }
}

module.exports = {
  AgentFleet
};
