const { buildAvatarPrompt } = require('../../persona/premium-primitives');
const { PremiumPersonaLLMClient } = require('../../llm/premium-persona-client');

async function avatarNode(state = {}) {
  const profile = state.profile || {};
  if (state?.llmConfig) {
    const client = state._llmClient || (state._llmClient = new PremiumPersonaLLMClient(state.llmConfig));
    const generated = await client.generateAvatar(profile);
    if (generated) {
      return { avatarPrompt: generated };
    }
  }

  return {
    avatarPrompt: buildAvatarPrompt(state.profile || {})
  };
}

module.exports = {
  avatarNode
};
