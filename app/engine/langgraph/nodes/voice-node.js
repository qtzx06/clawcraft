const { buildVoiceParams } = require('../../persona/premium-primitives');
const { PremiumPersonaLLMClient } = require('../../llm/premium-persona-client');

async function voiceNode(state = {}) {
  const profile = state.profile || {};
  if (state?.llmConfig) {
    const client = state._llmClient || (state._llmClient = new PremiumPersonaLLMClient(state.llmConfig));
    const generated = await client.generateVoice(profile);
    if (generated) {
      return { voice: generated };
    }
  }

  return {
    voice: buildVoiceParams(state.profile || {})
  };
}

module.exports = {
  voiceNode
};
