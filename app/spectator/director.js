const path = require('path');
require('dotenv').config({
  path: process.env.DOTENV_PATH || path.resolve(process.cwd(), '.env')
});

const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const mineflayer = require('mineflayer');
const { Rcon } = require('rcon-client');
const OBSWebSocket = require('obs-websocket-js').default;
const pino = require('pino');

const { InterestScorer } = require('./scorer.js');
const { CameraController } = require('./camera.js');
const { SpectatorRcon } = require('./rcon.js');
const { ObsController } = require('./obs.js');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

// --- Config ---
const MC_HOST = process.env.MC_HOST || '127.0.0.1';
const MC_PORT = Number(process.env.MC_PORT || 25565);
const RCON_HOST = process.env.RCON_HOST || MC_HOST;
const RCON_PORT = Number(process.env.RCON_PORT || 25575);
const RCON_PASSWORD = process.env.RCON_PASSWORD || 'changeme';
const OBS_WS_URL = process.env.OBS_WS_URL || 'ws://localhost:4455';
const OBS_WS_PASSWORD = process.env.OBS_WS_PASSWORD || '';
const DIRECTOR_PORT = Number(process.env.DIRECTOR_PORT || 3009);
const SPECTATOR_USERNAME = process.env.SPECTATOR_USERNAME || 'SpectatorCam';
const LISTENER_USERNAME = process.env.LISTENER_USERNAME || 'DirectorEye';
const CYCLE_MS = Number(process.env.DIRECTOR_CYCLE_MS || 10_000);
const DWELL_MS = Number(process.env.DIRECTOR_DWELL_MS || 5_000);
const COOLDOWN_MS = Number(process.env.DIRECTOR_COOLDOWN_MS || 30_000);

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

app.post('/director/scene/:sceneName', async (req, res) => {
  const { sceneName } = req.params;
  try {
    await obsCtrl.switchScene(sceneName);
    res.json({ ok: true, scene: sceneName });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/hud/ws' });

wss.on('connection', (ws) => {
  hudClients.add(ws);
  ws.send(JSON.stringify(hudState));
  ws.on('close', () => hudClients.delete(ws));
});

// --- Connect to services ---
let rconClient;
let obsWs;
let obsCtrl;
let listenerBot;
let directorInterval;

async function connectRcon() {
  rconClient = await Rcon.connect({
    host: RCON_HOST,
    port: RCON_PORT,
    password: RCON_PASSWORD,
  });
  log.info({ host: RCON_HOST, port: RCON_PORT }, 'RCON connected');
  return new SpectatorRcon({
    send: (cmd) => rconClient.send(cmd),
    spectatorUsername: SPECTATOR_USERNAME,
  });
}

async function connectObs() {
  obsWs = new OBSWebSocket();
  await obsWs.connect(OBS_WS_URL, OBS_WS_PASSWORD || undefined);
  log.info({ url: OBS_WS_URL }, 'OBS websocket connected');
  return new ObsController(obsWs);
}

function connectListener() {
  const bot = mineflayer.createBot({
    host: MC_HOST,
    port: MC_PORT,
    username: LISTENER_USERNAME,
    auth: 'offline',
    version: false,
  });

  bot.on('spawn', () => {
    log.info({ username: LISTENER_USERNAME }, 'Listener bot spawned');
  });

  bot.on('playerJoined', (player) => {
    if (player.username === SPECTATOR_USERNAME || player.username === LISTENER_USERNAME) return;
    scorer.recordEvent({ type: 'join', player: player.username, timestamp: Date.now() });
  });

  bot.on('entityHurt', (entity) => {
    if (entity.type !== 'player' || !entity.username) return;
    scorer.recordEvent({ type: 'combat', player: entity.username, timestamp: Date.now() });
  });

  bot.on('playerCollect', (collector) => {
    if (collector.username) {
      scorer.recordEvent({ type: 'build', player: collector.username, timestamp: Date.now() });
    }
  });

  bot.on('chat', (username, message) => {
    if (username === LISTENER_USERNAME || username === SPECTATOR_USERNAME) return;
    scorer.recordEvent({ type: 'chat', player: username, timestamp: Date.now() });
  });

  bot.on('error', (err) => log.error({ err: String(err) }, 'Listener bot error'));
  bot.on('kicked', (reason) => log.warn({ reason }, 'Listener bot kicked'));

  return bot;
}

// --- Director loop ---
let spectatorRcon;

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

    // Teleport spectator
    await spectatorRcon.spectatePlayer(next);

    // Transition OBS
    const isUrgent = scorer.getScores().get(next) >= 100;
    if (isUrgent) {
      await obsCtrl.cutTo('AgentPOV');
    } else {
      await obsCtrl.fadeTo('AgentPOV', 500);
    }

    // Update HUD
    const bot = listenerBot;
    const targetPlayer = bot.players?.[next];
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

    log.info({ from: previous, to: next, urgent: isUrgent }, 'Camera switched');
  } catch (err) {
    log.error({ err: String(err) }, 'Director tick error');
  }
}

// --- Startup ---
async function start() {
  spectatorRcon = await connectRcon();
  obsCtrl = await connectObs();
  listenerBot = connectListener();

  listenerBot.once('spawn', async () => {
    await spectatorRcon.setSpectatorMode();
    directorInterval = setInterval(directorTick, CYCLE_MS);
    log.info({ cycleMs: CYCLE_MS }, 'Director loop started');
  });

  server.listen(DIRECTOR_PORT, () => {
    log.info({ port: DIRECTOR_PORT }, 'Director service listening');
  });
}

start().catch((err) => {
  log.fatal({ err: String(err) }, 'Director failed to start');
  process.exit(1);
});
