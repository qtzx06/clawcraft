const path = require('path');
require('dotenv').config({
  path: process.env.DOTENV_PATH || path.resolve(process.cwd(), '.env'),
});

const mineflayer = require('mineflayer');
const pino = require('pino');

const { SpectatorRcon } = require('./rcon.js');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

const MC_HOST = process.env.MC_HOST || '127.0.0.1';
const MC_PORT = Number(process.env.MC_PORT || 25565);

// Control options:
// - Default: connect directly to RCON (requires network access to RCON port).
// - Hosted-friendly: call the ClawCraft API's /admin/rcon (requires ADMIN_TOKEN).
const CLAWCRAFT_URL = process.env.CLAWCRAFT_URL || process.env.API_URL || '';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

const RCON_HOST = process.env.RCON_HOST || MC_HOST;
const RCON_PORT = Number(process.env.RCON_PORT || 25575);
const RCON_PASSWORD = process.env.RCON_PASSWORD || 'changeme';

// This is the *in-game* username you want to control via /spectate.
// It must be online, and the server must allow RCON to run commands for it.
const SPECTATOR_USERNAME = process.env.SPECTATOR_USERNAME || 'opalbotgg';

// Separate observer account used only to detect joins (mineflayer).
const LISTENER_USERNAME = process.env.LISTENER_USERNAME || 'AutoSpectateEye';

// Minimum time between camera switches (prevents spam if many join quickly).
const DWELL_MS = Number(process.env.AUTO_SPECTATE_DWELL_MS || 2000);

// Delay after join before trying to spectate (lets the entity fully exist server-side).
const JOIN_DELAY_MS = Number(process.env.AUTO_SPECTATE_JOIN_DELAY_MS || 750);

let spectatorRcon;
let lastSwitchAt = 0;
let pending = null;
let listenerBot;

async function sendViaApi(cmd) {
  if (!CLAWCRAFT_URL) throw new Error('CLAWCRAFT_URL required for ADMIN_TOKEN mode');
  if (!ADMIN_TOKEN) throw new Error('ADMIN_TOKEN required for ADMIN_TOKEN mode');

  const base = String(CLAWCRAFT_URL).replace(/\/+$/, '');
  const res = await fetch(`${base}/admin/rcon`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': ADMIN_TOKEN,
    },
    body: JSON.stringify({ command: cmd }),
  });

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_err) {}
  if (!res.ok) {
    const msg = json?.error || text || `http_${res.status}`;
    throw new Error(msg);
  }

  return json?.response || text || 'ok';
}

async function connectControl() {
  const useApi = Boolean(ADMIN_TOKEN);
  if (!useApi) {
    // Lazy-require so we don't need rcon-client in environments that only use API mode.
    // eslint-disable-next-line global-require
    const { Rcon } = require('rcon-client');
    const rconClient = await Rcon.connect({
      host: RCON_HOST,
      port: RCON_PORT,
      password: RCON_PASSWORD,
    });
    log.info({ host: RCON_HOST, port: RCON_PORT }, 'RCON connected');

    // Useful debug: shows the server's exact online player-name casing.
    try {
      const listResp = await rconClient.send('minecraft:list');
      log.info({ resp: listResp }, 'minecraft:list');
    } catch (_err) {}

    return new SpectatorRcon({
      send: (cmd) => rconClient.send(cmd),
      spectatorUsername: SPECTATOR_USERNAME,
    });
  }

  log.info({ clawcraft_url: CLAWCRAFT_URL }, 'Using /admin/rcon (ADMIN_TOKEN mode)');
  try {
    const listResp = await sendViaApi('minecraft:list');
    log.info({ resp: listResp }, 'minecraft:list');
  } catch (_err) {}

  return new SpectatorRcon({
    send: (cmd) => sendViaApi(cmd),
    spectatorUsername: SPECTATOR_USERNAME,
  });
}

function connectListener() {
  const bot = mineflayer.createBot({
    host: MC_HOST,
    port: MC_PORT,
    username: LISTENER_USERNAME,
    auth: 'offline',
    version: false,
  });

  bot.once('spawn', () => {
    log.info({ username: LISTENER_USERNAME }, 'Listener bot spawned');
  });

  bot.on('playerJoined', (player) => {
    const username = player?.username;
    if (!username) return;
    if (username === SPECTATOR_USERNAME || username === LISTENER_USERNAME) return;
    setTimeout(() => queueSpectate(username), JOIN_DELAY_MS);
  });

  bot.on('error', (err) => log.error({ err: String(err) }, 'Listener bot error'));
  bot.on('kicked', (reason) => log.warn({ reason }, 'Listener bot kicked'));

  return bot;
}

function canonicalizeFromListener(desired) {
  const want = String(desired || '').trim();
  if (!want || !listenerBot?.players) return want;
  const wantLower = want.toLowerCase();
  for (const actual of Object.keys(listenerBot.players)) {
    if (String(actual).toLowerCase() === wantLower) return actual;
  }
  return want;
}

function queueSpectate(username) {
  const now = Date.now();
  const msSince = now - lastSwitchAt;
  if (msSince >= DWELL_MS) {
    spectateNow(username).catch((err) => log.warn({ err: String(err), username }, 'Spectate failed'));
    return;
  }

  // Replace pending target; we always want the most recent join.
  pending = username;
  const delay = DWELL_MS - msSince;
  setTimeout(() => {
    if (!pending) return;
    const next = pending;
    pending = null;
    spectateNow(next).catch((err) => log.warn({ err: String(err), username: next }, 'Spectate failed'));
  }, delay);
}

async function spectateNow(username) {
  lastSwitchAt = Date.now();

  // Ensure we use the server's exact online casing for both names.
  const spectator = canonicalizeFromListener(SPECTATOR_USERNAME);
  const target = canonicalizeFromListener(username);
  spectatorRcon.username = spectator;

  // Ensure spectator is in spectator mode (no-op if offline; RCON will reply with an error string).
  await spectatorRcon.setSpectatorMode();
  const resp = await spectatorRcon.spectatePlayer(target);
  log.info({ username: target, spectator, resp }, 'Spectating new player');
}

async function start() {
  spectatorRcon = await connectControl();
  listenerBot = connectListener();
  log.info(
    {
      mc: `${MC_HOST}:${MC_PORT}`,
      spectator: SPECTATOR_USERNAME,
      dwell_ms: DWELL_MS,
      join_delay_ms: JOIN_DELAY_MS,
      listener: LISTENER_USERNAME,
      mode: ADMIN_TOKEN ? 'admin_token' : 'direct_rcon',
    },
    'Auto-spectate joins started'
  );
}

start().catch((err) => {
  log.fatal({ err: String(err) }, 'Auto-spectate joins failed to start');
  process.exit(1);
});
