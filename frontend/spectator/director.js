const path = require('path');
require('dotenv').config({
  path: process.env.DOTENV_PATH || path.resolve(process.cwd(), '.env')
});

const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const mineflayer = require('mineflayer');
const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
const { Rcon } = require('rcon-client');
const pino = require('pino');

const { InterestScorer } = require('./scorer.js');
const { CameraController } = require('./camera.js');
const { SpectatorRcon } = require('./rcon.js');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

// --- Config ---
const MC_HOST = process.env.MC_HOST || '127.0.0.1';
const MC_PORT = Number(process.env.MC_PORT || 25565);
const RCON_HOST = process.env.RCON_HOST || MC_HOST;
const RCON_PORT = Number(process.env.RCON_PORT || 25575);
const RCON_PASSWORD = process.env.RCON_PASSWORD || 'changeme';
const DIRECTOR_PORT = Number(process.env.DIRECTOR_PORT || 3009);
const VIEWER_PORT = Number(process.env.VIEWER_PORT || 3007);
const SPECTATOR_USERNAME = process.env.SPECTATOR_USERNAME || 'SpectatorCam';
const CYCLE_MS = Number(process.env.DIRECTOR_CYCLE_MS || 10_000);
const DWELL_MS = Number(process.env.DIRECTOR_DWELL_MS || 5_000);
const COOLDOWN_MS = Number(process.env.DIRECTOR_COOLDOWN_MS || 30_000);
const VIEW_DISTANCE = Number(process.env.VIEWER_VIEW_DISTANCE || 6);

// --- Core modules ---
const scorer = new InterestScorer();
const camera = new CameraController(scorer, {
  dwellMs: DWELL_MS,
  cooldownMs: COOLDOWN_MS,
  cycleMs: CYCLE_MS,
});

// --- HUD state ---
let hudState = { agent: null, health: 0, food: 0, x: 0, y: 0, z: 0, tagline: '' };

// --- Websocket clients for HUD ---
const hudClients = new Set();

function broadcastHud(state) {
  hudState = state;
  const payload = JSON.stringify(state);
  for (const ws of hudClients) {
    if (ws.readyState === 1) ws.send(payload);
  }
}

// --- Express + websocket server ---
const app = express();
app.use(express.json());
app.use('/hud', express.static(path.join(__dirname, 'hud')));

app.get('/director/status', (_req, res) => {
  res.json({
    currentTarget: camera.getCurrentTarget(),
    override: camera.isOverridden(),
    hudState,
    viewerUrl: `http://localhost:${VIEWER_PORT}`,
  });
});

app.post('/director/focus/:username', (req, res) => {
  const { username } = req.params;
  camera.setOverride(username);
  log.info({ username }, 'Human override: focus');
  res.json({ ok: true, focus: username });
});

app.post('/director/release', (_req, res) => {
  camera.releaseOverride();
  log.info('Human override: released');
  res.json({ ok: true, released: true });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/hud/ws' });

wss.on('connection', (ws) => {
  hudClients.add(ws);
  ws.send(JSON.stringify(hudState));
  ws.on('close', () => hudClients.delete(ws));
});

// --- Spectator bot (single bot: viewer + event listener) ---
let spectatorBot;
let viewerStarted = false;
let spectatorRcon;
let directorInterval;

function createSpectatorBot() {
  const bot = mineflayer.createBot({
    host: MC_HOST,
    port: MC_PORT,
    username: SPECTATOR_USERNAME,
    auth: 'offline',
    version: false,
  });

  bot.once('spawn', () => {
    log.info({ username: SPECTATOR_USERNAME }, 'Spectator bot spawned');

    // Start prismarine-viewer on first spawn
    if (!viewerStarted) {
      mineflayerViewer(bot, {
        port: VIEWER_PORT,
        firstPerson: true,
        viewDistance: VIEW_DISTANCE,
      });
      viewerStarted = true;
      log.info({ viewer_port: VIEWER_PORT }, 'Web viewer up');
    }
  });

  // --- Event ingestion (this bot is also the listener) ---
  bot.on('playerJoined', (player) => {
    if (player.username === SPECTATOR_USERNAME) return;
    scorer.recordEvent({ type: 'join', player: player.username, timestamp: Date.now() });
    log.debug({ player: player.username }, 'Player joined');
  });

  bot.on('playerLeft', (player) => {
    log.debug({ player: player.username }, 'Player left');
  });

  bot.on('entityHurt', (entity) => {
    if (entity.type !== 'player' || !entity.username) return;
    if (entity.username === SPECTATOR_USERNAME) return;
    scorer.recordEvent({ type: 'combat', player: entity.username, timestamp: Date.now() });
  });

  bot.on('chat', (username, message) => {
    if (username === SPECTATOR_USERNAME) return;
    scorer.recordEvent({ type: 'chat', player: username, timestamp: Date.now() });
    log.debug({ username, message }, 'Chat observed');
  });

  bot.on('error', (err) => log.error({ err: String(err) }, 'Spectator bot error'));

  bot.on('kicked', (reason) => {
    log.warn({ reason }, 'Spectator bot kicked — reconnecting in 5s');
    scheduleReconnect();
  });

  bot.on('end', (reason) => {
    log.warn({ reason }, 'Spectator bot disconnected — reconnecting in 5s');
    scheduleReconnect();
  });

  return bot;
}

let reconnectTimer = null;
function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    log.info('Reconnecting spectator bot...');
    spectatorBot = createSpectatorBot();
  }, 5000);
}

// --- Director loop ---
async function directorTick() {
  try {
    scorer.prune();

    const shouldSwitch = camera.shouldSwitch({ forceOnDeath: true });
    if (!shouldSwitch) return;

    const next = camera.pick();
    if (!next) return;

    const previous = camera.getCurrentTarget();
    if (previous) camera.addCooldown(previous);
    camera.setCurrentTarget(next);

    // Teleport spectator bot to the target player via RCON
    await spectatorRcon.teleportToPlayer(next);

    // Update HUD
    const targetPlayer = spectatorBot.players?.[next];
    const entity = targetPlayer?.entity;
    broadcastHud({
      agent: next,
      health: entity?.health ?? 0,
      food: entity?.food ?? 0,
      x: Math.round(entity?.position?.x ?? 0),
      y: Math.round(entity?.position?.y ?? 0),
      z: Math.round(entity?.position?.z ?? 0),
      tagline: '',
    });

    log.info({ from: previous, to: next }, 'Camera switched');
  } catch (err) {
    log.error({ err: String(err) }, 'Director tick error');
  }
}

// --- Startup ---
async function start() {
  // Connect RCON (for teleporting the spectator bot)
  const rconClient = await Rcon.connect({
    host: RCON_HOST,
    port: RCON_PORT,
    password: RCON_PASSWORD,
  });
  log.info({ host: RCON_HOST, port: RCON_PORT }, 'RCON connected');

  spectatorRcon = new SpectatorRcon({
    send: (cmd) => rconClient.send(cmd),
    spectatorUsername: SPECTATOR_USERNAME,
  });

  // Create spectator bot with prismarine-viewer
  spectatorBot = createSpectatorBot();

  spectatorBot.once('spawn', async () => {
    // Set bot to spectator mode so it's invisible and can fly
    await spectatorRcon.setSpectatorMode();
    log.info('Spectator mode set via RCON');

    // Start the director loop
    directorInterval = setInterval(directorTick, CYCLE_MS);
    log.info({ cycleMs: CYCLE_MS }, 'Director loop started');
  });

  server.listen(DIRECTOR_PORT, () => {
    log.info({ port: DIRECTOR_PORT }, 'Director service listening');
    log.info(`Web viewer: http://localhost:${VIEWER_PORT}`);
    log.info(`HUD overlay: http://localhost:${DIRECTOR_PORT}/hud`);
    log.info(`Director API: http://localhost:${DIRECTOR_PORT}/director/status`);
  });
}

start().catch((err) => {
  log.fatal({ err: String(err) }, 'Director failed to start');
  process.exit(1);
});
