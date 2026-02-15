const crypto = require('node:crypto');
const { sendRcon } = require('./rcon.js');
const pino = require('pino');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

const MC_COLORS = [
  'aqua', 'gold', 'light_purple', 'green', 'red', 'yellow',
  'blue', 'dark_aqua', 'dark_green', 'dark_purple', 'dark_red',
  'white', 'gray', 'dark_gray', 'dark_blue',
];

function teamColor(teamId) {
  const hash = crypto.createHash('sha256').update(teamId).digest();
  return MC_COLORS[hash[0] % MC_COLORS.length];
}

function mcTeamName(teamId) {
  // Scoreboard team names max 16 chars. "cc_" prefix + truncated teamId.
  return `cc_${teamId}`.slice(0, 16);
}

async function setupAgentTeam(teamId, teamName, loginName) {
  const scoreName = mcTeamName(teamId);
  const color = teamColor(teamId);
  const displayTag = teamName.toUpperCase();

  try {
    // Create team (idempotent — "already exists" is fine)
    await sendRcon(`team add ${scoreName}`);
  } catch (_err) {
    // ignore — team may already exist
  }

  try {
    const prefix = JSON.stringify({ text: `[${displayTag}] `, color });
    await sendRcon(`team modify ${scoreName} prefix ${prefix}`);
    await sendRcon(`team modify ${scoreName} color ${color}`);
    await sendRcon(`team join ${scoreName} ${loginName}`);
    log.info({ teamId, loginName, color, scoreName }, 'Agent added to MC team');
  } catch (err) {
    log.warn({ err: err.message, teamId, loginName }, 'Failed to setup MC team');
  }
}

async function removeFromTeam(loginName) {
  try {
    await sendRcon(`team leave ${loginName}`);
  } catch (err) {
    log.warn({ err: err.message, loginName }, 'Failed to remove from MC team');
  }
}

module.exports = { setupAgentTeam, removeFromTeam, teamColor, mcTeamName };
