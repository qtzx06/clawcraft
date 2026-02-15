const crypto = require('node:crypto');

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

function stableSuffix(teamId, agentName) {
  const h = crypto.createHash('sha256').update(`${teamId}:${agentName}`).digest('hex');
  return h.slice(0, 6);
}

function makeLoginUsername(teamId, agentName) {
  const baseTeam = sanitizeMcName(teamId).toLowerCase();
  const baseAgent = sanitizeMcName(agentName).toLowerCase();
  const suffix = stableSuffix(teamId, agentName);
  // Reserve: "cc_" + suffix + "_" + agent (trim to 16)
  // Keep suffix so collisions across teams are extremely unlikely.
  const prefix = `cc${suffix}_`;
  let tail = baseAgent || 'agent';
  const maxTail = 16 - prefix.length;
  if (maxTail <= 0) {
    return `cc${suffix}`.slice(0, 16);
  }
  if (tail.length > maxTail) tail = tail.slice(0, maxTail);
  const out = `${prefix}${tail}`;
  return out.slice(0, 16);
}

module.exports = { sanitizeMcName, makeLoginUsername };

