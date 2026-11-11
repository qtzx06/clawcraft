const path = require('path');
require('dotenv').config({
  path: process.env.DOTENV_PATH || path.resolve(process.cwd(), '.env')
});

const express = require('express');
const mineflayer = require('mineflayer');
const client = require('prom-client');
const pino = require('pino');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

const MC_HOST = process.env.MC_HOST || '127.0.0.1';
const MC_PORT = Number(process.env.MC_PORT || 25565);
const BOT_USERNAME = process.env.MIND_BOT_USERNAME || process.env.BOT_USERNAME || 'MindFlayer';
const HEALTH_PORT = Number(process.env.MIND_BOT_HEALTH_PORT || 3009);
const COMMAND_PREFIX = process.env.MIND_BOT_COMMAND_PREFIX || '!';
const SAY_ON_SPAWN = process.env.MIND_BOT_SAY_ON_SPAWN || 'MindFlayer online';
const THINK_INTERVAL_MS = Number(process.env.MIND_BOT_THINK_INTERVAL_MS || 3500);
const WANDER_TIME_MS = Number(process.env.MIND_BOT_WANDER_TIME_MS || 3200);

const app = express();
app.use(express.json());

client.collectDefaultMetrics();

const actions = new client.Counter({
  name: 'mindflayer_actions_total',
  help: 'Number of bot actions executed',
  labelNames: ['action', 'outcome']
});

const energy = new client.Gauge({
  name: 'mindflayer_state',
  help: 'Bot health and hunger',
  labelNames: ['metric']
});

const botState = {
  mode: 'auto',
  goal: 'collect_and_explore',
  targetPlayer: null,
  lastAction: 'none',
  busy: false
};

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'mindflayer-agent',
    username: BOT_USERNAME,
    mode: botState.mode,
    goal: botState.goal
  });
});

app.get('/status', (_req, res) => {
  const position = bot.entity?.position;
  res.json({
    ok: true,
    username: BOT_USERNAME,
    mode: botState.mode,
    goal: botState.goal,
    targetPlayer: botState.targetPlayer,
    spawned: !!bot.entity,
    busy: botState.busy,
    position: position ? { x: position.x, y: position.y, z: position.z } : null,
    health: bot.health,
    food: bot.food,
    lastAction: botState.lastAction
  });
});

app.post('/mode', (req, res) => {
  const mode = String(req.body?.mode || '').trim();
  const allowed = new Set(['auto', 'collect', 'wander', 'defend', 'follow', 'idle']);
  if (!allowed.has(mode)) {
    return res.status(400).json({ ok: false, reason: 'invalid mode' });
  }

  botState.mode = mode;
  botState.targetPlayer = mode === 'follow' ? String(req.body?.target || '').trim() || null : null;
  return res.json({ ok: true, mode: botState.mode, targetPlayer: botState.targetPlayer });
});

app.post('/say', (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) {
    return res.status(400).json({ ok: false, reason: 'message required' });
  }
  if (!bot.entity) {
    return res.status(409).json({ ok: false, reason: 'bot not spawned' });
  }
  bot.chat(message);
  return res.json({ ok: true, sent: true });
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

app.listen(HEALTH_PORT, () => {
  log.info({ health_port: HEALTH_PORT }, 'MindFlayer metrics/control endpoint up');
});

const bot = mineflayer.createBot({
  host: MC_HOST,
  port: MC_PORT,
  username: BOT_USERNAME,
  auth: 'offline',
  version: false
});

const hostileNames = new Set([
  'zombie',
  'creeper',
  'spider',
  'skeleton',
  'stray',
  'drowned',
  'enderman',
  'witch',
  'husk',
  'blaze',
  'ghast',
  'phantom',
  'pillager',
  'guardian',
  'silverfish',
  'cave_spider'
]);

const harvestable = new Set([
  'log',
  'oak_log',
  'spruce_log',
  'birch_log',
  'jungle_log',
  'acacia_log',
  'dark_oak_log',
  'mangrove_log',
  'stone',
  'cobblestone',
  'dirt',
  'gravel',
  'sand',
  'coal_ore',
  'iron_ore',
  'netherrack'
]);

function emitEnergyMetrics() {
  energy.set({ metric: 'health' }, bot.health ?? 0);
  energy.set({ metric: 'food' }, bot.food ?? 0);
}

function record(action, outcome) {
  actions.labels(action, outcome).inc();
  botState.lastAction = `${action}:${outcome}`;
}

function nearestHostile(distance = 8) {
  const candidates = Object.values(bot.entities).filter((e) => {
    if (!e || e === bot.entity || !e.position || e.type !== 'mob') return false;
    const isHostileName = hostileNames.has(e.name);
    const inRange = bot.entity.position.distanceTo(e.position) <= distance;
    return isHostileName && inRange;
  });
  candidates.sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position));
  return candidates[0] || null;
}

function nearbyPlayerNameList() {
  return Object.keys(bot.players)
    .filter((name) => name && name !== BOT_USERNAME);
}

function findFollowTarget() {
  if (!botState.targetPlayer) return null;
  return bot.players[botState.targetPlayer]?.entity || null;
}

function pickHarvestBlock() {
  return bot.findBlock({
    matching: (block) => !!(block && harvestable.has(block.name)),
    maxDistance: 16
  });
}

function randomYaw() {
  return (Math.random() * Math.PI * 2) - Math.PI;
}

function stopControls() {
  bot.setControlState('forward', false);
  bot.setControlState('back', false);
  bot.setControlState('left', false);
  bot.setControlState('right', false);
  bot.setControlState('jump', false);
  bot.setControlState('sneak', false);
}

async function withLookAt(targetPosition, timeoutMs = 600) {
  return Promise.race([
    bot.lookAt(targetPosition, false),
    new Promise((resolve) => setTimeout(resolve, timeoutMs))
  ]);
}

async function harvestNearest() {
  const target = pickHarvestBlock();
  if (!target) {
    return false;
  }

  const distance = bot.entity.position.distanceTo(target.position);
  if (distance > 4.5) {
    return false;
  }

  if (!bot.canDigBlock(target)) {
    return false;
  }

  try {
    botState.busy = true;
    botState.lastAction = 'harvest';
    actions.labels('harvest', 'attempt').inc();
    await withLookAt(target.position);
    await bot.dig(target, 'ignore');
    actions.labels('harvest', 'success').inc();
    return true;
  } catch (err) {
    log.warn({ err: String(err), action: 'harvest' }, 'Harvest failed');
    actions.labels('harvest', 'failure').inc();
    return false;
  } finally {
    botState.busy = false;
  }
}

async function defendIfHostile() {
  const hostile = nearestHostile(7);
  if (!hostile) {
    return false;
  }

  try {
    botState.busy = true;
    botState.lastAction = 'defend';
    actions.labels('defend', 'attempt').inc();
    await withLookAt(hostile.position);
    if (bot.entity.position.distanceTo(hostile.position) <= 4) {
      bot.attack(hostile);
      await new Promise((resolve) => setTimeout(resolve, 500));
      actions.labels('defend', 'success').inc();
    } else {
      await bot.lookAt(hostile.position);
      actions.labels('defend', 'failure').inc();
    }
    return true;
  } catch (err) {
    log.warn({ err: String(err), action: 'defend' }, 'Defend failed');
    actions.labels('defend', 'failure').inc();
    return true;
  } finally {
    botState.busy = false;
  }
}

function wander() {
  stopControls();
  botState.lastAction = 'wander';
  botState.busy = true;
  actions.labels('wander', 'attempt').inc();
  bot.look(randomYaw(), 0, false);
  bot.setControlState('forward', true);
  bot.setControlState('jump', Math.random() < 0.3);
  setTimeout(() => {
    stopControls();
    botState.busy = false;
    actions.labels('wander', 'success').inc();
  }, WANDER_TIME_MS);
}

async function followPlayer() {
  const target = findFollowTarget();
  if (!target) {
    log.info({ targetPlayer: botState.targetPlayer }, 'follow target missing');
    botState.mode = 'auto';
    return;
  }

  const distance = bot.entity.position.distanceTo(target.position);
  if (distance <= 2.2) {
    stopControls();
    return true;
  }

  try {
    botState.busy = true;
    botState.lastAction = 'follow';
    actions.labels('follow', 'attempt').inc();
    await withLookAt(target.position);
    bot.setControlState('forward', true);
    bot.setControlState('sneak', distance < 4);
    setTimeout(() => {
      stopControls();
      botState.busy = false;
      actions.labels('follow', 'success').inc();
    }, 900);
    return true;
  } catch (err) {
    log.warn({ err: String(err), action: 'follow' }, 'Follow failed');
    botState.busy = false;
    actions.labels('follow', 'failure').inc();
    return false;
  }
}

async function think() {
  if (!bot.entity || botState.busy) return;
  if (botState.mode === 'idle') return;

  if (botState.mode !== 'collect' && botState.mode !== 'wander') {
    const defended = await defendIfHostile();
    if (defended) {
      return;
    }
  }

  if (botState.mode === 'defend') {
    return;
  }

  if (botState.mode === 'follow' || botState.mode === 'auto') {
    if (botState.mode === 'follow') {
      if (findFollowTarget()) {
        followPlayer();
        return;
      }
      botState.mode = 'auto';
      return;
    }
  }

  if (botState.mode === 'collect' || botState.mode === 'auto') {
    harvestNearest().then((didHarvest) => {
      if (didHarvest) return;
      if (botState.mode === 'collect') return;
      wander();
    });
    return;
  }

  if (botState.mode === 'wander') {
    wander();
  }
}

setInterval(() => {
  if (bot.entity) {
    emitEnergyMetrics();
    void think();
  }
}, THINK_INTERVAL_MS);

bot.on('spawn', () => {
  botState.busy = false;
  log.info({ username: BOT_USERNAME, host: MC_HOST, port: MC_PORT }, 'MindFlayer connected');
  if (SAY_ON_SPAWN) bot.chat(SAY_ON_SPAWN);
});

bot.on('chat', (username, message) => {
  if (username === bot.username) return;
  const raw = String(message || '').trim();
  if (!raw.startsWith(COMMAND_PREFIX)) return;

  const clean = raw.slice(COMMAND_PREFIX.length).trim();
  const [rawCmd, ...parts] = clean.split(/\s+/);
  const cmd = rawCmd.toLowerCase();
  const arg = parts.join(' ');

  if (cmd === 'mode') {
    const mode = (arg || '').toLowerCase();
    if (['auto', 'collect', 'wander', 'defend', 'follow', 'idle'].includes(mode)) {
      botState.mode = mode;
      bot.chat(`mode set to ${mode}`);
      if (mode !== 'follow') {
        botState.targetPlayer = null;
      }
      return;
    }
    bot.chat('valid modes: auto, collect, wander, defend, follow <name>, idle');
    return;
  }

  if (cmd === 'follow') {
    const target = arg.trim();
    if (!target || !bot.players[target]) {
      bot.chat(`follow target not found: ${target || '<none>'}`);
      return;
    }
    botState.mode = 'follow';
    botState.targetPlayer = target;
    bot.chat(`following ${target}`);
    return;
  }

  if (cmd === 'harvest') {
    botState.mode = 'collect';
    bot.chat('mission set: collect');
    return;
  }

  if (cmd === 'wander') {
    botState.mode = 'wander';
    bot.chat('mission set: wander');
    return;
  }

  if (cmd === 'where') {
    const pos = bot.entity?.position;
    if (pos) {
      bot.chat(`x ${Math.floor(pos.x)} y ${Math.floor(pos.y)} z ${Math.floor(pos.z)}`);
    }
    return;
  }
});

bot.on('death', () => {
  log.warn({ username: BOT_USERNAME }, 'MindFlayer died');
  emitEnergyMetrics();
});

bot.on('health', () => {
  emitEnergyMetrics();
});

bot.on('error', (err) => {
  log.error({ err: String(err) }, 'MindFlayer bot error');
});

bot.on('kicked', (reason) => {
  log.warn({ reason: String(reason) }, 'MindFlayer kicked');
});

bot.on('end', (reason) => {
  stopControls();
  emitEnergyMetrics();
  log.warn({ reason: String(reason) }, 'MindFlayer ended');
});

bot.on('playerJoined', (player) => {
  log.info({ player: player.username }, 'Player joined');
});
