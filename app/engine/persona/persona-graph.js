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

async function buildPremiumContext(profile = {}, gameState = {}, action = {}) {
  const sourceProfile = await normalizeProfileInput(profile);
  const normalizedProfile = normalizeProfile(sourceProfile);
  const normalizedState = gameState && typeof gameState === 'object' ? gameState : {};
  const normalizedAction = action && typeof action === 'object' ? action : {};

  const graphResult = await runPremiumPersonaGraph({
    profile: normalizedProfile,
    gameState: normalizedState,
    action: normalizedAction
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
