const { createHash } = require('crypto');
const { parseSoul, normalizeProfile } = require('../persona/persona-parser');
const { buildPremiumContext } = require('../persona/persona-graph');
const { OpenAICompatibleClient } = require('../llm/openai-compatible-client');
const { MindcraftAdapter } = require('./mindcraft-adapter');
const { MineflayerAdapter } = require('./mineflayer-adapter');
const { ToolDispatcher } = require('../tools/tool-dispatcher');
const { TOOL_ACTIONS, isRemoteToolAction, normalizeToolPolicy, safeFallbackKind } = require('../tools/tool-contract');

class AgentRuntime {
  constructor({
    id,
    username,
    soulFile,
    board,
    mc = {},
    connector = 'mindcraft',
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
    this.toolPolicy = null;
    this._toolDispatcher = null;
    this._toolServiceConfig = {
      baseUrl: process.env.TOOL_SERVICE_URL || process.env.CLAWCRAFT_TOOL_SERVICE_URL || 'http://127.0.0.1:3040',
      token: process.env.TOOL_SERVICE_TOKEN || '',
      signatureSecret: process.env.TOOL_SERVICE_SIGNATURE_SECRET || '',
      timeoutMs: Number.isFinite(Number(process.env.TOOL_SERVICE_TIMEOUT_MS))
        ? Number(process.env.TOOL_SERVICE_TIMEOUT_MS)
        : 7000,
      retryCount: Number.isFinite(Number(process.env.TOOL_SERVICE_RETRY_COUNT))
        ? Number(process.env.TOOL_SERVICE_RETRY_COUNT)
        : 2,
      fallbackOnServiceFailure: process.env.TOOL_SERVICE_FAIL_OPEN === 'true'
    };
    this._llm = new OpenAICompatibleClient(llmConfig);
  }

  async start() {
    const soul = await parseSoul(this.soulFile);
    this.profile = normalizeProfile(soul);
    this.toolPolicy = this.profile?.tool_contract || this.profile?.tool_policy || {};
    const adapterOpts = {
      username: this.username,
      host: this.mc.host,
      port: this.mc.port,
      auth: this.mc.auth || 'offline',
      logger: this.logger
    };
    const requestedConnector = String(this.connector || 'mindcraft').toLowerCase();
    const shouldPreferMindcraft = requestedConnector === 'mindcraft' || requestedConnector === 'auto';

    if (shouldPreferMindcraft) {
      this.connector = 'mindcraft';
      try {
        this.adapter = new MindcraftAdapter({
          ...adapterOpts,
          preferMindcraft: true,
          mindcraftPath: this.mc.mindcraftPath
        });
        await this.adapter.connect();
        if (this.adapter.usingMindcraft === false) {
          this.logger.warn(
            {
              agent: this.id,
              requestedConnector,
              reason: 'mindcraft adapter requested fallback to mineflayer'
            },
            'mindcraft not available; using mineflayer fallback'
          );
          this.connector = 'mineflayer';
        }
      } catch (error) {
        this.logger.warn(
          {
            agent: this.id,
            requestedConnector,
            fallbackReason: String(error?.message || error)
          },
          'mindcraft adapter failed; falling back to mineflayer'
        );
        this.adapter = new MineflayerAdapter(adapterOpts);
        this.connector = 'mineflayer';
        await this.adapter.connect();
      }
    } else {
      this.connector = 'mineflayer';
      this.adapter = new MineflayerAdapter(adapterOpts);
      await this.adapter.connect();
    }
    this.isRunning = true;
    this._toolDispatcher = new ToolDispatcher({
      adapter: this.adapter,
      toolServiceConfig: this._toolServiceConfig,
      fallbackOnServiceFailure: this._toolServiceConfig.fallbackOnServiceFailure,
      logger: this.logger
    });
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
    const missions = Array.isArray(state) ? state : [];
    const current = missions.filter((mission) => mission.assigned_to === this.id && mission.status === 'in_progress');

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
      personality: this.profile,
      policy: this._normalizeToolPolicy()
    };
    const plan = await this._llm.planAction(context);
    const enforcedPlan = this._enforcePolicy(plan);
    const nextAttempts = attempts + 1;
    this.attemptCounts[missionId] = nextAttempts;

    const premiumContext = await buildPremiumContext(this.profile, gameState, {
      kind: enforcedPlan.kind,
      text: enforcedPlan.narration
    });
    const requestId = this._buildToolRequestId({
      missionId,
      action: enforcedPlan.kind,
      args: enforcedPlan.details,
      fallback: this.id
    });
    const result = await this._dispatchAction({
      missionId,
      action: enforcedPlan.kind,
      args: enforcedPlan.details || {},
      requestId,
      correlationId: missionId,
      narration: enforcedPlan.narration
    });
    if (!result.success && isRemoteToolAction(enforcedPlan.kind) && this._toolServiceConfig.fallbackOnServiceFailure) {
      try {
        await this.adapter.performAction({
          kind: 'chat',
          narration: `${enforcedPlan.kind} failed: ${result.notes || result.reason || 'tool service unavailable'}`
        });
      } catch (_error) {}
    }

    const isAsyncToolAction = isRemoteToolAction(enforcedPlan.kind) && result?.success === true && !!result.job_id;
    const status = (
      enforcedPlan.forceComplete ||
      isAsyncToolAction ||
      (result.success === true && nextAttempts >= this.maxAttemptsPerMission)
    )
      ? 'done'
      : 'in_progress';

    const progressText = `${enforcedPlan.narration || 'Working'} ${result.notes ? `(${result.notes})` : ''}`.trim();

    await this.board.updateMission(missionId, {
      status,
      progress: { text: progressText },
      metadata: {
        attempts: nextAttempts,
        lastAction: {
          kind: enforcedPlan.kind,
          request_id: requestId,
          correlation_id: missionId,
          source: result.source || 'local',
          details: enforcedPlan.details || {},
          tool_service: result.job_id ? { job_id: result.job_id, status: result.tool_status || null } : null,
          premiumPreview: {
            voice: premiumContext.voice,
            avatarPrompt: premiumContext.avatarPrompt
          },
          policy: {
            requested: enforcedPlan?.policy?.requested || enforcedPlan.kind,
            blocked: Boolean(enforcedPlan?.policy?.blocked),
            denied: enforcedPlan?.policy?.denied || this.toolPolicy?.denied_tools || []
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

  _buildToolRequestId({ missionId, action, args, fallback }) {
    const seed = `${fallback}:${missionId || 'unknown'}:${action}:${JSON.stringify(args || {})}`;
    return createHash('sha256').update(seed).digest('hex').slice(0, 24);
  }

  async _dispatchAction({
    missionId,
    action,
    args,
    requestId,
    correlationId,
    narration
  }) {
    return this._toolDispatcher.executeAction({
      agentId: this.id,
      missionId,
      action,
      args,
      requestId,
      correlationId,
      narration
    });
  }

  _normalizeToolPolicy() {
    return normalizeToolPolicy(this.toolPolicy || {});
  }

  _safeFallbackKind(policy = {}) {
    return safeFallbackKind(policy.allowed_tools);
  }

  _enforcePolicy(plan = {}) {
    const policy = this._normalizeToolPolicy();
    const requested = String(plan.kind || 'chat').toLowerCase();

    if (!plan || typeof plan !== 'object') {
      return {
        kind: this._safeFallbackKind(policy),
        narration: 'No valid action plan available.',
        forceComplete: false,
        policy: {
          requested,
          allowed: policy.allowed_tools,
          denied: policy.denied_tools,
          blocked: true
        }
      };
    }

    if (!policy.allowed_tools.includes(requested)) {
      const fallback = this._safeFallbackKind(policy);
      this.logger?.warn?.(
        {
          agent: this.id,
          requested,
          fallback,
          denied: policy.denied_tools
        },
        'action blocked by tool policy'
      );
      return {
        ...plan,
        kind: fallback,
        forceComplete: false,
        narration: `${plan.narration || `I will ${fallback} now.`} (tool-policy blocked ${requested})`,
        policy: {
          ...plan.policy,
          requested,
          allowed: policy.allowed_tools,
          denied: policy.denied_tools,
          blocked: true
        }
      };
    }

    return {
      ...plan,
      policy: {
        ...plan.policy,
        requested,
        allowed: policy.allowed_tools,
        denied: plan?.policy?.denied || policy.denied_tools,
        blocked: Boolean(plan?.policy?.blocked)
      }
    };
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
