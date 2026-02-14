const { buildVoiceParams } = require('../../persona/premium-primitives');

async function voiceNode(state = {}) {
  return {
    voice: buildVoiceParams(state.profile || {})
  };
}

module.exports = {
  voiceNode
};
