#!/usr/bin/env node

const http = require('node:http');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');

const MC_HOST = process.env.MC_HOST || '127.0.0.1';
const MC_PORT = Number(process.env.MC_PORT || 25565);
const BOT_USERNAME = process.env.BOT_USERNAME || 'ClawAgent';
const API_PORT = Number(process.env.API_PORT || 4000);

const MAX_CHAT = 50;
const MAX_LOG = 300;

const chatLog = [];
const activityLog = [];
let currentTask = null;
let currentPlan = null;

function pushLog(action) {
  activityLog.push({ time: Date.now(), action });
  if (activityLog.length > MAX_LOG) activityLog.shift();
}

const bot = mineflayer.createBot({
  host: MC_HOST,
  port: MC_PORT,
  username: BOT_USERNAME,
  auth: 'offline',
  version: false,
});

bot.loadPlugin(pathfinder);

bot.once('spawn', () => {
  const movements = new Movements(bot);
  bot.pathfinder.setMovements(movements);
  bot.chat(`${BOT_USERNAME} online`);
  pushLog('spawned');
});

bot.on('chat', (username, message) => {
  chatLog.push({ username, message, time: Date.now() });
  if (chatLog.length > MAX_CHAT) chatLog.shift();
});

bot.on('error', (err) => pushLog(`error: ${err.message}`));
bot.on('kicked', (reason) => pushLog(`kicked: ${String(reason)}`));
bot.on('end', (reason) => pushLog(`end: ${String(reason)}`));

function inventory() {
  return bot.inventory.items().map((item) => ({
    name: item.name,
    count: item.count,
    slot: item.slot,
  }));
}

function gameState() {
  const pos = bot.entity?.position;
  const held = bot.heldItem ? { name: bot.heldItem.name, count: bot.heldItem.count } : null;
  return {
    ok: true,
    spawned: Boolean(bot.entity),
    username: BOT_USERNAME,
    position: pos ? { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } : null,
    health: bot.health,
    food: bot.food,
    dimension: bot.game?.dimension || 'overworld',
    inventory: inventory(),
    equipment: {
      head: bot.inventory.slots[5] ? { name: bot.inventory.slots[5].name } : null,
      chest: bot.inventory.slots[6] ? { name: bot.inventory.slots[6].name } : null,
      legs: bot.inventory.slots[7] ? { name: bot.inventory.slots[7].name } : null,
      feet: bot.inventory.slots[8] ? { name: bot.inventory.slots[8].name } : null,
      hand: held,
    },
    recentChat: chatLog.slice(-20),
    task: currentTask,
  };
}

function stopControls() {
  for (const control of ['forward', 'back', 'left', 'right', 'jump', 'sneak']) {
    bot.setControlState(control, false);
  }
  bot.pathfinder.setGoal(null);
}

async function doAction(action) {
  if (!bot.entity) {
    return { ok: false, error: 'not_spawned' };
  }

  switch (action.type) {
    case 'chat': {
      bot.chat(String(action.message || ''));
      pushLog(`chat:${action.message || ''}`);
      return { ok: true, action: 'chat' };
    }

    case 'move': {
      stopControls();
      const dir = String(action.direction || 'forward');
      const duration = Number(action.duration || 1000);
      bot.setControlState(dir, true);
      setTimeout(() => bot.setControlState(dir, false), duration);
      pushLog(`move:${dir}:${duration}`);
      return { ok: true, action: 'move', direction: dir, duration };
    }

    case 'go_to': {
      const x = Number(action.x);
      const y = Number(action.y);
      const z = Number(action.z);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return { ok: false, error: 'x,y,z required' };
      }
      bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, 2));
      pushLog(`go_to:${x},${y},${z}`);
      return { ok: true, action: 'go_to', x, y, z };
    }

    case 'look': {
      if (action.x != null && action.y != null && action.z != null) {
        await bot.lookAt(new Vec3(Number(action.x), Number(action.y), Number(action.z)));
      } else if (action.yaw != null) {
        await bot.look(Number(action.yaw), Number(action.pitch || 0), false);
      }
      pushLog('look');
      return { ok: true, action: 'look' };
    }

    case 'stop': {
      stopControls();
      pushLog('stop');
      return { ok: true, action: 'stop' };
    }

    default:
      return { ok: false, error: `unknown_action:${action.type}` };
  }
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  return JSON.parse(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Content-Type', 'application/json');

  try {
    if (req.method === 'GET' && url.pathname === '/state') {
      res.end(JSON.stringify(gameState()));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/action') {
      const action = await readJson(req);
      const result = await doAction(action);
      res.end(JSON.stringify(result));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/task') {
      const task = await readJson(req);
      currentTask = {
        ...task,
        status: 'accepted',
        progress: Number(task.progress || 0),
        started_at: Date.now(),
      };
      pushLog(`task:${task.goal || 'unknown'}`);
      res.end(JSON.stringify({ ok: true, task: currentTask }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/task/status') {
      res.end(JSON.stringify(currentTask || { status: 'idle' }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/plan') {
      res.end(JSON.stringify({ ok: true, plan: currentPlan }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/plan') {
      const payload = await readJson(req);
      currentPlan = payload.instructions || '';
      pushLog('plan:update');
      res.end(JSON.stringify({ ok: true, plan: currentPlan }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/message') {
      const payload = await readJson(req);
      const state = gameState();
      const reply = `health=${state.health} food=${state.food} pos=${JSON.stringify(state.position)} task=${currentTask?.goal || 'idle'} message=${payload.message || ''}`;
      pushLog('message:received');
      res.end(JSON.stringify({ ok: true, reply }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/logs') {
      const limit = Math.max(1, Number(url.searchParams.get('limit') || 50));
      res.end(JSON.stringify({ ok: true, logs: activityLog.slice(-limit) }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: 'not_found' }));
  } catch (err) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
});

server.listen(API_PORT, () => {
  pushLog(`api:listening:${API_PORT}`);
  console.log(`[agent-bridge] ${BOT_USERNAME} API on ${API_PORT}`);
});
