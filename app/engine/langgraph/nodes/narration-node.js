const { buildNarrationSeed } = require('../../persona/premium-primitives');

async function narrationNode(state = {}) {
  const action = state.action || {};
  const narrationSeed = buildNarrationSeed(state.profile || {}, state.gameState || {}, {
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
