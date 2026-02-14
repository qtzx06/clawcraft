const { parseSoul, normalizeProfile } = require('../../persona/persona-parser');

async function personalityExtractionNode(state = {}) {
  const hasProfile = state.profile && typeof state.profile === 'object' && Object.keys(state.profile).length > 0;
  const source = state.profileSource || state.soulSource || state.soulText;

  const extracted = hasProfile
    ? state.profile
    : source
      ? await parseSoul(source)
      : {};

  return {
    profile: normalizeProfile(extracted)
  };
}

module.exports = {
  personalityExtractionNode
};
