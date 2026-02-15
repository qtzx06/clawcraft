function sanitizeMcName(input) {
  // Minecraft username constraints:
  // - 1..16 chars
  // - [A-Za-z0-9_]
  // (Spaces, brackets, dashes, etc are not allowed.)
  const s = String(input || '')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s;
}

function makeLoginUsername(teamId, agentName) {
  // Primary: just the agent name (readable in-game)
  const agent = sanitizeMcName(agentName);
  if (agent.length >= 2 && agent.length <= 16) {
    return agent;
  }

  // Fallback: Team_Agent, truncated to 16 chars
  const team = sanitizeMcName(teamId);
  const combined = `${team}_${agent || 'agent'}`;
  return combined.slice(0, 16);
}

module.exports = { sanitizeMcName, makeLoginUsername };
