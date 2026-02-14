const { parseSoul, normalizeProfile } = require('./persona-parser');
const { runPremiumPersonaGraph } = require('../langgraph');
const {
  buildVoiceParams,
  buildAvatarPrompt,
  buildNarrationSeed
} = require('./premium-primitives');

function normalizeProfileInput(profile) {
  if (typeof profile === 'string') {
    return parseSoul(profile);
  }
  return profile && typeof profile === 'object' ? profile : {};
}

function normalizeMissionInput(mission = {}) {
  return mission && typeof mission === 'object'
    ? {
      id: mission.id || null,
      task: String(mission.task || '').trim() || null,
      source: String(mission.source || '').trim() || null,
      status: String(mission.status || '').trim() || null,
      priority: String(mission.priority || '').trim() || null
    }
    : {};
}

function normalizeLlmConfig(llmConfig = {}) {
  const base = (llmConfig && typeof llmConfig === 'object') ? llmConfig : {};
  return {
    baseUrl: base.baseUrl,
    apiKey: base.apiKey || base.key || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY,
    model: base.model || process.env.LLM_MODEL || 'gpt-4o-mini',
    temperature: Number.isFinite(base.temperature) ? Number(base.temperature) : 0.4,
    timeoutMs: Number.isFinite(base.timeoutMs) ? Number(base.timeoutMs) : 15000,
    useRemote: base.useRemote !== false,
    provider: base.provider
  };
}

async function buildPremiumContext(profile = {}, gameState = {}, action = {}, options = {}) {
  const sourceProfile = await normalizeProfileInput(profile);
  const normalizedProfile = normalizeProfile(sourceProfile);
  const normalizedState = gameState && typeof gameState === 'object' ? gameState : {};
  const normalizedAction = action && typeof action === 'object' ? action : {};
  const normalizedMission = normalizeMissionInput(options?.mission);
  const normalizedLlmConfig = options?.disable_llm || ('llmConfig' in options && !options.llmConfig)
    ? null
    : normalizeLlmConfig(options?.llmConfig);

  const hasRemote = Boolean(normalizedLlmConfig?.apiKey);
  const graphLlmConfig = hasRemote && normalizedLlmConfig.provider !== 'disabled'
    ? normalizedLlmConfig
    : null;

  const graphResult = await runPremiumPersonaGraph({
    profile: normalizedProfile,
    gameState: normalizedState,
    action: normalizedAction,
    mission: normalizedMission,
    llmConfig: graphLlmConfig
  });
  const resolvedProfile = graphResult.profile || {};

  return {
    voice: graphResult.voice,
    avatarPrompt: graphResult.avatarPrompt,
    narrationSeed: graphResult.narrationSeed,
    profile: {
      ...(graphResult.profile || {
        archetype: normalizedProfile.archetype || 'Builder',
        tone: normalizedProfile.tone || 'steady',
        values: normalizedProfile.values || [],
        visual_aesthetic: normalizedProfile.visual_aesthetic || [],
        behavior_constraints: normalizedProfile.behavior_constraints || []
      }),
      constraints: resolvedProfile.behavior_constraints || []
    }
  };
}

module.exports = {
  buildVoiceParams,
  buildAvatarPrompt,
  buildNarrationSeed,
  buildPremiumContext
};
