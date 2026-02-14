#!/usr/bin/env node
// ClawCraft agent bridge — connects to MC, exposes HTTP API for LLM control
// Runs an autonomous autopilot loop that yields to LLM commands.
//
// Usage: MC_HOST=34.106.239.231 BOT_USERNAME=MyBot node agent.js

const http = require('http');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');

const MC_HOST = process.env.MC_HOST || '34.106.239.231';
const MC_PORT = Number(process.env.MC_PORT || 25565);
const BOT_USERNAME = process.env.BOT_USERNAME || 'MeowClaw';
const API_PORT = Number(process.env.API_PORT || 3100);

const AUTOPILOT_INTERVAL = 3500;  // ms between autopilot ticks
const LLM_OVERRIDE_TTL = 15000;   // ms autopilot pauses after LLM action

const chatLog = [];
const MAX_CHAT = 50;

const HOSTILE_MOBS = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch',
  'drowned', 'husk', 'stray', 'phantom', 'pillager', 'vindicator',
  'ravager', 'blaze', 'ghast', 'wither_skeleton', 'piglin_brute',
  'hoglin', 'zoglin', 'warden', 'cave_spider'
]);

const HARVESTABLE = new Set([
  'oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log',
  'cherry_log', 'mangrove_log',
  'coal_ore', 'iron_ore', 'copper_ore', 'gold_ore', 'diamond_ore',
  'deepslate_coal_ore', 'deepslate_iron_ore', 'deepslate_copper_ore',
  'deepslate_gold_ore', 'deepslate_diamond_ore'
]);

const FOOD_ITEMS = new Set([
  'bread', 'cooked_beef', 'cooked_porkchop', 'apple', 'golden_apple',
  'cooked_chicken', 'cooked_mutton', 'cooked_salmon', 'baked_potato',
  'cookie', 'pumpkin_pie', 'melon_slice', 'carrot', 'beetroot'
]);

// ── state ──

let llmOverrideUntil = 0;        // timestamp — autopilot paused until this
let autopilotMode = 'survive';   // survive | idle | follow:<player>
let autopilotBusy = false;       // prevent overlapping ticks
let lastAutopilotAction = null;

const bot = mineflayer.createBot({
  host: MC_HOST,
  port: MC_PORT,
  username: BOT_USERNAME,
  auth: 'offline',
  version: false
});

// ── helpers ──

function nearbyEntities(range = 16) {
  if (!bot.entity) return [];
  return Object.values(bot.entities)
    .filter(e => e && e !== bot.entity && e.position &&
      bot.entity.position.distanceTo(e.position) <= range)
    .map(e => ({
      name: e.name || e.username || 'unknown',
      type: e.type,
      position: { x: Math.floor(e.position.x), y: Math.floor(e.position.y), z: Math.floor(e.position.z) },
      distance: Math.round(bot.entity.position.distanceTo(e.position) * 10) / 10,
      health: e.health ?? null
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 20);
}

function nearbyBlocks(range = 8) {
  if (!bot.entity) return [];
  const blocks = [];
  const pos = bot.entity.position;
  for (let dx = -range; dx <= range; dx += 2) {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dz = -range; dz <= range; dz += 2) {
        const block = bot.blockAt(pos.offset(dx, dy, dz));
        if (block && block.name !== 'air' && block.name !== 'cave_air') {
          blocks.push({ name: block.name, x: block.position.x, y: block.position.y, z: block.position.z });
        }
      }
    }
  }
  const counts = {};
  for (const b of blocks) {
    if (!counts[b.name]) counts[b.name] = { count: 0, nearest: b };
    counts[b.name].count++;
  }
  return Object.entries(counts).map(([name, v]) => ({
    name, count: v.count, sample: { x: v.nearest.x, y: v.nearest.y, z: v.nearest.z }
  })).sort((a, b) => b.count - a.count).slice(0, 15);
}

function inventory() {
  return bot.inventory.items().map(i => ({
    name: i.name, count: i.count, slot: i.slot
  }));
}

function players() {
  return Object.keys(bot.players).filter(n => n !== BOT_USERNAME);
}

function gameState() {
  const pos = bot.entity?.position;
  return {
    username: BOT_USERNAME,
    spawned: !!bot.entity,
    position: pos ? { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } : null,
    health: bot.health,
    food: bot.food,
    time: bot.time?.timeOfDay ?? null,
    isRaining: bot.isRaining,
    biome: bot.entity ? bot.blockAt(bot.entity.position)?.biome?.name ?? null : null,
    players: players(),
    nearbyEntities: nearbyEntities(),
    nearbyBlocks: nearbyBlocks(),
    inventory: inventory(),
    recentChat: chatLog.slice(-20),
    gameMode: bot.game?.gameMode ?? null,
    autopilot: {
      mode: autopilotMode,
      llmOverrideActive: Date.now() < llmOverrideUntil,
      llmOverrideRemainingMs: Math.max(0, llmOverrideUntil - Date.now()),
      lastAction: lastAutopilotAction
    }
  };
}

// ── actions ──

function stopControls() {
  for (const s of ['forward', 'back', 'left', 'right', 'jump', 'sneak']) {
    bot.setControlState(s, false);
  }
}

async function doAction(action) {
  if (!bot.entity) return { ok: false, error: 'not spawned' };

  try {
    switch (action.type) {
      case 'chat':
        bot.chat(String(action.message || ''));
        return { ok: true, action: 'chat' };

      case 'move': {
        const dir = String(action.direction || 'forward');
        stopControls();
        bot.setControlState(dir, true);
        const ms = Number(action.duration || 1000);
        setTimeout(() => stopControls(), ms);
        return { ok: true, action: 'move', direction: dir, duration: ms };
      }

      case 'look': {
        if (action.x != null) {
          await bot.lookAt(new Vec3(action.x, action.y, action.z));
        } else if (action.yaw != null) {
          await bot.look(action.yaw, action.pitch || 0, false);
        }
        return { ok: true, action: 'look' };
      }

      case 'jump':
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 500);
        return { ok: true, action: 'jump' };

      case 'mine': {
        const target = bot.blockAt(new Vec3(action.x, action.y, action.z));
        if (!target || target.name === 'air') return { ok: false, error: 'no block at position' };
        if (!bot.canDigBlock(target)) return { ok: false, error: 'cannot dig this block' };
        await bot.lookAt(target.position);
        await bot.dig(target, 'ignore');
        return { ok: true, action: 'mine', block: target.name };
      }

      case 'attack': {
        const entities = Object.values(bot.entities).filter(e =>
          e && e !== bot.entity && e.position &&
          (e.name === action.target || e.username === action.target) &&
          bot.entity.position.distanceTo(e.position) <= 6
        );
        if (!entities.length) return { ok: false, error: `target not found: ${action.target}` };
        const nearest = entities.sort((a, b) =>
          bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position)
        )[0];
        await bot.lookAt(nearest.position);
        bot.attack(nearest);
        return { ok: true, action: 'attack', target: nearest.name || nearest.username };
      }

      case 'equip': {
        const item = bot.inventory.items().find(i => i.name === action.item);
        if (!item) return { ok: false, error: `item not in inventory: ${action.item}` };
        await bot.equip(item, action.destination || 'hand');
        return { ok: true, action: 'equip', item: item.name };
      }

      case 'place': {
        const ref = bot.blockAt({ x: action.x, y: action.y, z: action.z });
        if (!ref) return { ok: false, error: 'no reference block' };
        await bot.placeBlock(ref, { x: 0, y: 1, z: 0 });
        return { ok: true, action: 'place' };
      }

      case 'eat': {
        const food = bot.inventory.items().find(i => FOOD_ITEMS.has(i.name));
        if (!food) return { ok: false, error: 'no food in inventory' };
        await bot.equip(food, 'hand');
        await bot.consume();
        return { ok: true, action: 'eat', item: food.name };
      }

      case 'stop':
        stopControls();
        return { ok: true, action: 'stop' };

      case 'set_mode': {
        const mode = String(action.mode || 'survive');
        if (!['survive', 'idle', 'follow'].includes(mode.split(':')[0])) {
          return { ok: false, error: `unknown mode: ${mode}. valid: survive, idle, follow:<player>` };
        }
        autopilotMode = mode;
        return { ok: true, action: 'set_mode', mode: autopilotMode };
      }

      default:
        return { ok: false, error: `unknown action: ${action.type}` };
    }
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

// ── autopilot ──

function findNearestHostile(range = 10) {
  if (!bot.entity) return null;
  let best = null;
  let bestDist = range + 1;
  for (const e of Object.values(bot.entities)) {
    if (!e || e === bot.entity || !e.position || !e.name) continue;
    if (!HOSTILE_MOBS.has(e.name)) continue;
    const d = bot.entity.position.distanceTo(e.position);
    if (d < bestDist) { best = e; bestDist = d; }
  }
  return best;
}

function findNearestHarvestable(range = 8) {
  if (!bot.entity) return null;
  const pos = bot.entity.position;
  let best = null;
  let bestDist = range + 1;
  for (let dx = -range; dx <= range; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dz = -range; dz <= range; dz++) {
        const block = bot.blockAt(pos.offset(dx, dy, dz));
        if (!block || !HARVESTABLE.has(block.name)) continue;
        const d = pos.distanceTo(block.position);
        if (d < bestDist) { best = block; bestDist = d; }
      }
    }
  }
  return best;
}

function findFollowTarget() {
  if (!autopilotMode.startsWith('follow:')) return null;
  const targetName = autopilotMode.split(':')[1];
  const player = bot.players[targetName];
  if (!player || !player.entity) return null;
  return player.entity;
}

async function autopilotTick() {
  if (!bot.entity) return;
  if (autopilotBusy) return;
  if (Date.now() < llmOverrideUntil) return;  // LLM is driving
  if (autopilotMode === 'idle') return;

  autopilotBusy = true;
  try {
    // Priority 1: Eat if low on health/food
    if (bot.health < 10 || bot.food < 6) {
      const food = bot.inventory.items().find(i => FOOD_ITEMS.has(i.name));
      if (food) {
        await bot.equip(food, 'hand');
        await bot.consume();
        lastAutopilotAction = `ate ${food.name}`;
        console.log(`[autopilot] ate ${food.name} (health=${bot.health} food=${bot.food})`);
        return;
      }
    }

    // Priority 2: Fight nearby hostiles
    const hostile = findNearestHostile(6);
    if (hostile) {
      await bot.lookAt(hostile.position);
      bot.attack(hostile);
      lastAutopilotAction = `attacked ${hostile.name}`;
      console.log(`[autopilot] attacking ${hostile.name}`);
      return;
    }

    // Priority 3: Follow mode
    if (autopilotMode.startsWith('follow:')) {
      const target = findFollowTarget();
      if (target) {
        const d = bot.entity.position.distanceTo(target.position);
        if (d > 3) {
          await bot.lookAt(target.position);
          stopControls();
          bot.setControlState('forward', true);
          if (d > 5) bot.setControlState('jump', true);
          setTimeout(() => stopControls(), Math.min(d * 200, 2000));
          lastAutopilotAction = `following ${autopilotMode.split(':')[1]}`;
        }
      }
      return;
    }

    // Priority 4: Harvest nearby resource (if within reach)
    const block = findNearestHarvestable(4.5);
    if (block && bot.canDigBlock(block)) {
      await bot.lookAt(block.position);
      await bot.dig(block, 'ignore');
      lastAutopilotAction = `mined ${block.name}`;
      console.log(`[autopilot] mined ${block.name} at ${block.position}`);
      return;
    }

    // Priority 5: Wander — pick a random direction and walk
    const yaw = Math.random() * Math.PI * 2 - Math.PI;
    await bot.look(yaw, 0, false);
    stopControls();
    bot.setControlState('forward', true);
    // Jump occasionally to get over obstacles
    if (Math.random() < 0.3) bot.setControlState('jump', true);
    const walkTime = 1500 + Math.random() * 2000;
    setTimeout(() => stopControls(), walkTime);
    lastAutopilotAction = 'wandering';

  } catch (err) {
    console.error(`[autopilot] error: ${err.message}`);
    lastAutopilotAction = `error: ${err.message}`;
  } finally {
    autopilotBusy = false;
  }
}

// ── HTTP API ──

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && req.url === '/state') {
    res.end(JSON.stringify(gameState(), null, 2));
    return;
  }

  if (req.method === 'POST' && req.url === '/action') {
    // LLM is sending a command — pause autopilot
    llmOverrideUntil = Date.now() + LLM_OVERRIDE_TTL;
    stopControls();

    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const action = JSON.parse(body);
      const result = await doAction(action);
      res.end(JSON.stringify(result));
    } catch (err) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: String(err.message || err) }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/actions') {
    // LLM is sending commands — pause autopilot
    llmOverrideUntil = Date.now() + LLM_OVERRIDE_TTL;
    stopControls();

    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const actions = JSON.parse(body);
      const results = [];
      for (const action of actions) {
        results.push(await doAction(action));
        await new Promise(r => setTimeout(r, 200));
      }
      // Extend override since batch took time
      llmOverrideUntil = Date.now() + LLM_OVERRIDE_TTL;
      res.end(JSON.stringify({ ok: true, results }));
    } catch (err) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: String(err.message || err) }));
    }
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'not found', routes: ['GET /state', 'POST /action', 'POST /actions'] }));
});

server.listen(API_PORT, () => {
  console.log(`[clawcraft] API listening on http://localhost:${API_PORT}`);
});

// ── events ──

let autopilotInterval = null;
bot.on('spawn', () => {
  console.log(`[clawcraft] ${BOT_USERNAME} connected to ${MC_HOST}:${MC_PORT}`);
  console.log(`[clawcraft] autopilot=${autopilotMode}, LLM override TTL=${LLM_OVERRIDE_TTL}ms`);
  autopilotBusy = false;  // reset in case of reconnect
  llmOverrideUntil = 0;
  if (!autopilotInterval) {
    autopilotInterval = setInterval(autopilotTick, AUTOPILOT_INTERVAL);
    console.log(`[clawcraft] autopilot loop started (every ${AUTOPILOT_INTERVAL}ms)`);
  }
  bot.chat(`${BOT_USERNAME} online`);
});

bot.on('chat', (username, message) => {
  chatLog.push({ username, message, time: Date.now() });
  if (chatLog.length > MAX_CHAT) chatLog.shift();
});

bot.on('death', () => {
  console.log(`[clawcraft] ${BOT_USERNAME} died — respawning`);
  lastAutopilotAction = 'died';
});

bot.on('error', (err) => console.error(`[clawcraft] error: ${err}`));
bot.on('kicked', (reason) => console.warn(`[clawcraft] kicked: ${JSON.stringify(reason)}`));
bot.on('end', (reason) => { stopControls(); console.warn(`[clawcraft] disconnected: ${reason}`); });

// autopilot loop now started in spawn handler above
