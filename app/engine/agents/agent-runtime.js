const { parseSoul, normalizeProfile } = require('../persona/persona-parser');
const { buildPremiumContext } = require('../persona/persona-graph');
const { OpenAICompatibleClient } = require('../llm/openai-compatible-client');
const { MindcraftAdapter } = require('./mindcraft-adapter');
const { MineflayerAdapter } = require('./mineflayer-adapter');

class AgentRuntime {
  constructor({
    id,
    username,
    soulFile,
    board,
    mc = {},
    connector = 'mineflayer',
    llmConfig = {},
    missionPollMs = 8000,
    maxAttemptsPerMission = 2,
    logger = console
  }) {
    this.id = id;
    this.username = username;
    this.soulFile = soulFile;
    this.board = board;
    this.connector = connector;
    this.mc = mc;
    this.missionPollMs = missionPollMs;
    this.maxAttemptsPerMission = maxAttemptsPerMission;
    this.logger = logger;
    this.attemptCounts = {};
    this.currentMission = null;
    this.isRunning = false;
    this.interval = null;
    this.profile = null;
    this._llm = new OpenAICompatibleClient(llmConfig);
  }

  async start() {
    const soul = await parseSoul(this.soulFile);
    this.profile = normalizeProfile(soul);
    this.adapter = this.connector === 'mindcraft'
      ? new MindcraftAdapter({
          username: this.username,
          host: this.mc.host,
          port: this.mc.port,
          auth: this.mc.auth || 'offline',
          logger: this.logger,
          preferMindcraft: true,
          mindcraftPath: this.mc.mindcraftPath
        })
      : new MineflayerAdapter({
          username: this.username,
          host: this.mc.host,
          port: this.mc.port,
          auth: this.mc.auth || 'offline',
          logger: this.logger
        });

    await this.adapter.connect();
    this.isRunning = true;
    this.logger.info({ agent: this.id, username: this.username }, 'agent start');
    await this._tick();
    this.interval = setInterval(() => {
      this._tick().catch((error) => {
        this.logger.warn({ agent: this.id, error: String(error) }, 'agent tick error');
      });
    }, this.missionPollMs);
  }

  async stop() {
    this.isRunning = false;
    if (this.interval) clearInterval(this.interval);
    if (this.adapter) await this.adapter.disconnect();
  }

  async _tick() {
    if (!this.isRunning || !this.profile || !this.board) return;

    const state = await this.board.getMissionsForAgent(this.id);
    const current = state.find((mission) => mission.assigned_to === this.id && mission.status === 'in_progress');

    if (!this.currentMission && current.length > 0) {
      this.currentMission = current.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];
    }
    if (!current.length) this.currentMission = null;

    if (!this.currentMission) {
      this.currentMission = await this.board.claimMission(this.id, null);
      if (!this.currentMission) {
        const profileText = this.profile.speech_patterns?.[0] || 'Waiting for mission assignment.';
        await this.adapter.performAction({
          kind: 'chat',
          narration: profileText
        });
        return;
      }
    }

    const mission = this.currentMission;
    const missionId = mission.id;
    const attempts = this.attemptCounts[missionId] || 0;
    const gameState = await this.board.getSnapshot();
    const botState = this.adapter.getState ? this.adapter.getState() : {};
    const context = {
      mission,
      botState,
      gameState,
      personality: this.profile
    };
    const plan = await this._llm.planAction(context);
    const result = await this.adapter.performAction(plan);

    const nextAttempts = attempts + 1;
    this.attemptCounts[missionId] = nextAttempts;

    const premiumContext = buildPremiumContext(this.profile, gameState, {
      kind: plan.kind,
      text: plan.narration
    });
    const status = (
      plan.forceComplete ||
      result.success === true &&
      nextAttempts >= this.maxAttemptsPerMission
    )
      ? 'done'
      : 'in_progress';

    const progressText = `${plan.narration || 'Working'} ${result.notes ? `(${result.notes})` : ''}`.trim();

    await this.board.updateMission(missionId, {
      status,
      progress: { text: progressText },
      metadata: {
        attempts: nextAttempts,
        lastAction: {
          kind: plan.kind,
          details: plan.details || {},
          premiumPreview: {
            voice: premiumContext.voice,
            avatarPrompt: premiumContext.avatarPrompt
          }
        },
        lastResult: {
          success: result.success,
          reason: result.reason,
          notes: result.notes
        }
      }
    });

    if (status === 'done') {
      this.currentMission = null;
    }
  }

  getStatus() {
    return {
      id: this.id,
      username: this.username,
      connector: this.connector,
      hasMission: Boolean(this.currentMission),
      currentMission: this.currentMission,
      profile: this.profile ? {
        name: this.profile.name,
        archetype: this.profile.archetype,
        tone: this.profile.tone
      } : null
    };
  }
}

module.exports = {
  AgentRuntime
};
