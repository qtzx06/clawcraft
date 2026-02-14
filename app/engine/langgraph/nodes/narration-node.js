const { buildNarrationSeed } = require('../../persona/premium-primitives');
const { PremiumPersonaLLMClient } = require('../../llm/premium-persona-client');

async function narrationNode(state = {}) {
  const action = state.action || {};
  const mission = state.mission || {};
  const profile = state.profile || {};
  const gameState = state.gameState || {};
  const generated = await (() => {
    if (state?.llmConfig) {
      const client = state._llmClient || (state._llmClient = new PremiumPersonaLLMClient(state.llmConfig));
      return client.generateNarration(profile, gameState, action, mission);
    }
    return Promise.resolve(null);
  })();

  const narrationSeed = generated?.text || buildNarrationSeed(profile, gameState, {
    kind: action.kind,
    text: action.text || action.narration || ''
  });

  return {
    narrationSeed,
    narration: {
      text: narrationSeed,
      in_character: true
    }
  };
}

module.exports = {
  narrationNode
};
