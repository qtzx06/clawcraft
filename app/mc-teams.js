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

async function applyTeam(scoreName, displayTag, color, loginName) {
  try {
    await sendRcon(`team add ${scoreName}`);
  } catch (_err) {
    // ignore — team may already exist
  }

  const prefix = JSON.stringify({ text: `[${displayTag}] `, color });
  await sendRcon(`team modify ${scoreName} prefix ${prefix}`);
  await sendRcon(`team modify ${scoreName} color ${color}`);
  await sendRcon(`team join ${scoreName} ${loginName}`);
}

async function setupAgentTeam(teamId, teamName, loginName) {
  const scoreName = mcTeamName(teamId);
  const color = teamColor(teamId);
  const displayTag = teamName.toUpperCase();

  // Try immediately, then retry after delays to catch slow-connecting bots.
  const delays = [0, 3000, 8000, 15000];
  for (const delay of delays) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      await applyTeam(scoreName, displayTag, color, loginName);
      log.info({ teamId, loginName, color, scoreName }, 'Agent added to MC team');
      return; // success
    } catch (err) {
      if (delay === delays[delays.length - 1]) {
        log.warn({ err: err.message, teamId, loginName }, 'Failed to setup MC team after retries');
      }
    }
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
