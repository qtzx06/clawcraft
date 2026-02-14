const { buildAvatarPrompt } = require('../../persona/premium-primitives');

async function avatarNode(state = {}) {
  return {
    avatarPrompt: buildAvatarPrompt(state.profile || {})
  };
}

module.exports = {
  avatarNode
};
