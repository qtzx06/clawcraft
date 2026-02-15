#!/usr/bin/env node

/*
  ClawCraft ↔ Mindcraft bridge.

  Boots a Mindcraft Agent without MindServer, exposes our HTTP control API.

  Env:
    MC_HOST, MC_PORT, BOT_USERNAME, API_PORT
    CEREBRAS_API_KEY (required for LLM brain)
    SOUL (optional persona/instructions)
    TEAM_ID, AGENT_NAME
    LLM_MODEL (default: cerebras/gpt-oss-120b)
*/

import http from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const MC_HOST = process.env.MC_HOST || '127.0.0.1';
const MC_PORT = Number(process.env.MC_PORT || 25565);
const BOT_USERNAME = process.env.BOT_USERNAME || 'ClawAgent';
const API_PORT = Number(process.env.API_PORT || 4000);
const SOUL = process.env.SOUL || '';
const LLM_MODEL = process.env.LLM_MODEL || 'cerebras/gpt-oss-120b';
const TEAM_ID = process.env.TEAM_ID || '';
const AGENT_NAME = process.env.AGENT_NAME || '';

// ── 1. Write a dynamic profile from env ──────────────────────────

const profileDir = path.join(__dirname, 'profiles');
const profilePath = path.join(profileDir, '_clawcraft_agent.json');

const soulPrompt = SOUL
  ? `You are ${BOT_USERNAME}, a Minecraft bot competing in ClawCraft arena. ${SOUL}`
  : `You are ${BOT_USERNAME}, a Minecraft bot competing in ClawCraft arena. Complete tasks efficiently. Mine resources, craft items, survive, and win goals.`;

const profile = {
  name: BOT_USERNAME,
  model: LLM_MODEL,
  conversing: soulPrompt + '\n$SELF_PROMPT\nSummarized memory:\'$MEMORY\'\n$STATS\n$INVENTORY\n$COMMAND_DOCS\n$EXAMPLES\nConversation Begin:',
  modes: {
    self_preservation: true,
    unstuck: true,
    cowardice: false,
    self_defense: true,
    hunting: true,
    item_collecting: true,
    torch_placing: true,
    elbow_room: true,
    idle_staring: true,
    cheat: false,
  },
};

mkdirSync(profileDir, { recursive: true });
writeFileSync(profilePath, JSON.stringify(profile, null, 2));

// ── 2. Inject settings before any Mindcraft import ───────────────

process.env.SETTINGS_JSON = JSON.stringify({
  minecraft_version: 'auto',
  host: MC_HOST,
  port: MC_PORT,
  auth: 'offline',
  base_profile: 'survival',
  profiles: [profilePath],
  load_memory: false,
  init_message: `You are competing in ClawCraft. Focus on your assigned task. Use commands to act.`,
  only_chat_with: ['system'],  // only respond to self-prompter + API, not other bots' chat
  speak: false,
  language: 'en',
  chat_ingame: false,
  render_bot_view: false,
  allow_insecure_coding: true,
  allow_vision: false,
  blocked_actions: [],
  code_timeout_mins: -1,
  relevant_docs_count: 5,
  max_messages: 15,
  num_examples: 2,
  max_commands: -1,
  show_command_syntax: 'full',
  narrate_behavior: false,
  chat_bot_messages: false,
  spawn_timeout: 60,
  block_place_delay: 0,
  log_all_prompts: false,
  mindserver_port: 0,        // no mindserver
  auto_open_ui: false,
  task: null,
});

// ── 3. Stub MindServer proxy before Agent import ─────────────────
//    Mindcraft's Agent calls serverProxy.login() etc.
//    We replace the singleton with a no-op version.

const { serverProxy } = await import('../mindcraft/src/agent/mindserver_proxy.js');
const { setSettings } = await import('../mindcraft/src/agent/settings.js');

// Apply settings directly (bypass socket-based settings fetch)
const injected = JSON.parse(process.env.SETTINGS_JSON);
injected.profile = profile;
setSettings(injected);

// Monkey-patch proxy to be a no-op
serverProxy.connected = true;   // prevent connect attempts
serverProxy.socket = {
  emit: () => {},
  on: () => {},
  off: () => {},
};
serverProxy.connect = async () => {};
serverProxy.login = () => {};
serverProxy.shutdown = () => {};
serverProxy.getSocket = () => serverProxy.socket;
serverProxy.getAgents = () => [];
serverProxy.getNumOtherAgents = () => 0;

// ── 4. Import and start the Mindcraft Agent ──────────────────────

const { Agent } = await import('../mindcraft/src/agent/agent.js');

const agent = new Agent();
serverProxy.setAgent(agent);

console.log(`[clawcraft] Starting Mindcraft agent: ${BOT_USERNAME}`);
await agent.start(false, null, 0);

// Optional extra plugins (keep runtime working even if absent).
try {
  const mod = require('mineflayer-tool');
  const plugin = mod?.plugin || mod?.default || mod;
  if (typeof plugin === 'function') agent.bot.loadPlugin(plugin);
} catch (_err) {}
try {
  const mod = require('mineflayer-death-event');
  const plugin = mod?.plugin || mod?.default || mod;
  if (typeof plugin === 'function') agent.bot.loadPlugin(plugin);
} catch (_err) {}

// ── 5. HTTP Control API (same contract as our agent-runtime) ─────

// Optional UI helpers (start/stop). Persist info across requests.
let viewerInfo = null;
let webInventoryInfo = null;

function writeJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function gameState() {
  const bot = agent.bot;
  const pos = bot?.entity?.position;
  const inv = bot?.inventory?.items().map(i => ({ name: i.name, count: i.count, slot: i.slot })) || [];
  const eq = {};
  if (bot?.inventory) {
    eq.head = bot.inventory.slots[5] ? { name: bot.inventory.slots[5].name } : null;
    eq.chest = bot.inventory.slots[6] ? { name: bot.inventory.slots[6].name } : null;
    eq.legs = bot.inventory.slots[7] ? { name: bot.inventory.slots[7].name } : null;
    eq.feet = bot.inventory.slots[8] ? { name: bot.inventory.slots[8].name } : null;
    eq.hand = bot?.heldItem ? { name: bot.heldItem.name } : null;
  }

  return {
    ok: true,
    spawned: Boolean(bot?.entity),
    username: BOT_USERNAME,
    team_id: TEAM_ID,
    agent_name: AGENT_NAME,
    position: pos ? { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } : null,
    health: bot?.health ?? 0,
    food: bot?.food ?? 0,
    dimension: bot?.game?.dimension || 'overworld',
    inventory: inv,
    equipment: eq,
    task: agent.self_prompter?.prompt || null,
    self_prompting: agent.self_prompter?.isActive() || false,
    mode: 'mindcraft',
  };
}

function isUnsafePathSegment(seg) {
  return (
    !seg ||
    seg === '__proto__' ||
    seg === 'prototype' ||
    seg === 'constructor' ||
    seg.startsWith('_')
  );
}

function resolveBotPath(bot, inputPath) {
  const raw = String(inputPath || '').trim();
  if (!raw) return { ok: false, error: 'path_required' };
  const clean = raw.startsWith('bot.') ? raw : (raw === 'bot' ? raw : `bot.${raw}`);
  const parts = clean.split('.').filter(Boolean);
  if (parts[0] !== 'bot') return { ok: false, error: 'path_must_start_with_bot' };
  for (const seg of parts) {
    if (isUnsafePathSegment(seg)) return { ok: false, error: 'unsafe_path' };
  }
  let obj = { bot };
  for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
  const key = parts[parts.length - 1];
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'path_not_found' };
  if (!(key in obj)) return { ok: false, error: 'path_not_found' };
  return { ok: true, obj, key, full: parts.join('.') };
}

function safeDescribe(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'function') return '[Function]';
  if (Array.isArray(value)) {
    if (depth >= 2) return `[Array(${value.length})]`;
    return value.slice(0, 50).map((v) => safeDescribe(v, depth + 1));
  }
  if (typeof value === 'object') {
    if (depth >= 2) return '[Object]';
    const out = {};
    const keys = Object.keys(value).slice(0, 50);
    for (const k of keys) {
      if (isUnsafePathSegment(k)) continue;
      try {
        out[k] = safeDescribe(value[k], depth + 1);
      } catch (_err) {
        out[k] = '[Unreadable]';
      }
    }
    return out;
  }
  return String(value);
}

function findEntityByName(bot, name) {
  const targetName = String(name || '').trim();
  if (!targetName) return null;

  const player = bot.players?.[targetName]?.entity;
  if (player) return player;

  return bot.nearestEntity((e) => {
    const n = e?.username || e?.name || '';
    return String(n).toLowerCase() === targetName.toLowerCase();
  });
}

function findNearbyContainerBlock(bot) {
  return bot.findBlock({
    maxDistance: 8,
    matching: (b) => b && (b.name.includes('chest') || b.name.includes('barrel') || b.name.includes('shulker_box')),
  });
}

const apiServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  try {
    // Health
    if (req.method === 'GET' && url.pathname === '/health') {
      return writeJson(res, 200, { ok: true, service: 'mindcraft-agent', time: Date.now() });
    }

    // State
    if (req.method === 'GET' && url.pathname === '/state') {
      return writeJson(res, 200, gameState());
    }

    // Task — inject as a self-prompt goal
    if (req.method === 'POST' && url.pathname === '/task') {
      const body = await readBody(req);
      const goal = body.goal || body.instructions || body.prompt || 'Complete the assigned task.';
      const target = body.target ? ` Target: ${body.target}.` : '';
      const strategy = body.strategy ? ` Strategy: ${body.strategy}.` : '';
      const prompt = `${goal}${target}${strategy}`;

      agent.self_prompter.start(prompt);
      return writeJson(res, 200, { ok: true, task: { goal, status: 'started', prompt } });
    }

    // Task status
    if (req.method === 'GET' && url.pathname === '/task/status') {
      return writeJson(res, 200, {
        ok: true,
        active: agent.self_prompter.isActive(),
        prompt: agent.self_prompter.prompt || null,
        status: agent.self_prompter.isActive() ? 'running' : 'idle',
      });
    }

    // Plan — inject instructions as a system message
    if (req.method === 'POST' && url.pathname === '/plan') {
      const body = await readBody(req);
      const instructions = body.instructions || '';
      await agent.handleMessage('system', instructions);
      return writeJson(res, 200, { ok: true, plan: instructions });
    }

    if (req.method === 'GET' && url.pathname === '/plan') {
      return writeJson(res, 200, { ok: true, plan: agent.self_prompter?.prompt || null });
    }

    // Message — send a message and get the bot's reply
    if (req.method === 'POST' && url.pathname === '/message') {
      const body = await readBody(req);
      const message = body.message || '';
      await agent.handleMessage('system', message);
      const state = gameState();
      return writeJson(res, 200, {
        ok: true,
        reply: {
          summary: `health=${state.health} food=${state.food} task=${agent.self_prompter?.prompt || 'idle'}`,
          state,
          message,
        },
      });
    }

    // Action — direct Mineflayer command (bypass LLM, execute directly)
    if (req.method === 'POST' && url.pathname === '/action') {
      const body = await readBody(req);
      const type = String(body.type || '').trim();
      const bot = agent.bot;
      if (!bot?.entity) return writeJson(res, 409, { ok: false, error: 'bot_not_spawned' });

      // Prefer to stop any in-flight Mindcraft action before executing a tactical command.
      try {
        const { executeCommand } = await import('../mindcraft/src/agent/commands/index.js');
        await executeCommand(agent, '!stop');
      } catch (_err) {}

      // Actions implemented via Mindcraft command layer (keeps behavior consistent).
      const commandMap = {
        go_to: () => `!goToCoordinates(${body.x}, ${body.y}, ${body.z}, ${body.range || 2})`,
        mine: () => `!collectBlocks("${body.block}", ${body.count || 1})`,
        collect_block: () => `!collectBlocks("${body.block}", ${body.count || 1})`,
        craft: () => `!craftRecipe("${body.item}", ${body.count || 1})`,
        equip: () => `!equip("${body.item}")`,
        attack: () => {
          const t = String(body.target || '').trim();
          if (!t) return null;
          // If it looks like a player, use the player-specific command.
          if (bot.players?.[t]?.entity) return `!attackPlayer("${t}")`;
          return `!attack("${t}")`;
        },
        stop: () => `!stop`,
      };

      const cmdFn = commandMap[type];
      if (cmdFn) {
        const cmd = cmdFn();
        if (!cmd) return writeJson(res, 400, { ok: false, error: 'invalid_action_args' });
        const { executeCommand } = await import('../mindcraft/src/agent/commands/index.js');
        const result = await executeCommand(agent, cmd);
        return writeJson(res, 200, { ok: true, action: type, result });
      }

      // Direct Mineflayer actions (feature parity with vendor/agent-runtime).
      if (type === 'chat' || type === 'say_public') {
        bot.chat(String(body.message || ''));
        return writeJson(res, 200, { ok: true, action: type });
      }

      if (type === 'eat') {
        const { consume } = await import('../mindcraft/src/agent/library/skills.js');
        let item = String(body.item || '').trim();
        if (!item) {
          const preference = [
            'golden_carrot',
            'cooked_beef',
            'cooked_porkchop',
            'cooked_chicken',
            'cooked_mutton',
            'baked_potato',
            'bread',
            'cooked_cod',
            'cooked_salmon',
            'apple',
            'carrot',
            'potato',
            'beetroot',
            'sweet_berries',
          ];
          const inv = bot.inventory?.items?.() || [];
          const found = preference.find((n) => inv.some((it) => it.name === n));
          item = found || '';
        }
        if (!item) return writeJson(res, 400, { ok: false, error: 'no_food_found' });
        const ok = await consume(bot, item);
        return writeJson(res, 200, { ok: Boolean(ok), action: type, item });
      }

      if (type === 'auto_eat_enable') {
        const ae = bot.autoEat;
        if (!ae) return writeJson(res, 409, { ok: false, error: 'auto_eat_not_loaded' });
        if (typeof ae.enableAuto === 'function') ae.enableAuto();
        else if (typeof ae.enable === 'function') ae.enable();
        else if (typeof ae.start === 'function') ae.start();
        else return writeJson(res, 409, { ok: false, error: 'auto_eat_api_unknown' });
        return writeJson(res, 200, { ok: true, action: type });
      }

      if (type === 'auto_eat_disable') {
        const ae = bot.autoEat;
        if (!ae) return writeJson(res, 409, { ok: false, error: 'auto_eat_not_loaded' });
        if (typeof ae.disableAuto === 'function') ae.disableAuto();
        else if (typeof ae.disable === 'function') ae.disable();
        else if (typeof ae.stop === 'function') ae.stop();
        else return writeJson(res, 409, { ok: false, error: 'auto_eat_api_unknown' });
        return writeJson(res, 200, { ok: true, action: type });
      }

      if (type === 'equip_best_armor') {
        const mgr = bot.armorManager;
        if (!mgr) return writeJson(res, 409, { ok: false, error: 'armor_manager_not_loaded' });
        if (typeof mgr.equipAll === 'function') await mgr.equipAll();
        else if (typeof mgr.equipAllArmor === 'function') await mgr.equipAllArmor();
        else return writeJson(res, 409, { ok: false, error: 'armor_manager_api_unknown' });
        return writeJson(res, 200, { ok: true, action: type });
      }

      if (type === 'equip_for_block') {
        const tool = bot.tool;
        if (!tool) return writeJson(res, 409, { ok: false, error: 'tool_not_loaded' });
        const x = Number(body.x);
        const y = Number(body.y);
        const z = Number(body.z);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          return writeJson(res, 400, { ok: false, error: 'x_y_z_required' });
        }
        const { Vec3 } = require('vec3');
        const block = bot.blockAt(new Vec3(x, y, z));
        if (!block) return writeJson(res, 404, { ok: false, error: 'block_not_found' });
        if (typeof tool.equipForBlock !== 'function') return writeJson(res, 409, { ok: false, error: 'tool_api_unknown' });
        await tool.equipForBlock(block, body.opts && typeof body.opts === 'object' ? body.opts : {});
        return writeJson(res, 200, { ok: true, action: type, block: block.name, position: { x, y, z } });
      }

      if (type === 'equip_for_entity') {
        const tool = bot.tool;
        if (!tool) return writeJson(res, 409, { ok: false, error: 'tool_not_loaded' });
        const target = findEntityByName(bot, body.target);
        if (!target) return writeJson(res, 404, { ok: false, error: 'target_not_found' });
        if (typeof tool.equipForEntity !== 'function') return writeJson(res, 409, { ok: false, error: 'tool_api_unknown' });
        await tool.equipForEntity(target, body.opts && typeof body.opts === 'object' ? body.opts : {});
        return writeJson(res, 200, { ok: true, action: type, target: body.target });
      }

      if (type === 'pvp_attack') {
        const pvp = bot.pvp;
        if (!pvp) return writeJson(res, 409, { ok: false, error: 'pvp_not_loaded' });
        const target = findEntityByName(bot, body.target);
        if (!target) return writeJson(res, 404, { ok: false, error: 'target_not_found' });
        if (typeof pvp.attack !== 'function') return writeJson(res, 409, { ok: false, error: 'pvp_api_unknown' });
        pvp.attack(target);
        return writeJson(res, 200, { ok: true, action: type, target: body.target });
      }

      if (type === 'pvp_stop') {
        const pvp = bot.pvp;
        if (!pvp) return writeJson(res, 409, { ok: false, error: 'pvp_not_loaded' });
        if (typeof pvp.stop === 'function') pvp.stop();
        else if (typeof pvp.stopAttack === 'function') pvp.stopAttack();
        else return writeJson(res, 409, { ok: false, error: 'pvp_api_unknown' });
        return writeJson(res, 200, { ok: true, action: type });
      }

      if (type === 'deposit') {
        const { putInChest } = await import('../mindcraft/src/agent/library/skills.js');
        const item = String(body.item || '').trim();
        const count = Math.max(1, Number(body.count || 1));
        if (!item) return writeJson(res, 400, { ok: false, error: 'item_required' });
        const ok = await putInChest(bot, item, count);
        return writeJson(res, 200, { ok: Boolean(ok), action: type, item, count });
      }

      if (type === 'withdraw') {
        const { takeFromChest } = await import('../mindcraft/src/agent/library/skills.js');
        const item = String(body.item || '').trim();
        const count = Math.max(1, Number(body.count || 1));
        if (!item) return writeJson(res, 400, { ok: false, error: 'item_required' });
        const ok = await takeFromChest(bot, item, count);
        return writeJson(res, 200, { ok: Boolean(ok), action: type, item, count });
      }

      if (type === 'place') {
        const { placeBlock } = await import('../mindcraft/src/agent/library/skills.js');
        const item = String(body.item || '').trim();
        const x = Number(body.x);
        const y = Number(body.y);
        const z = Number(body.z);
        if (!item) return writeJson(res, 400, { ok: false, error: 'item_required' });
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          return writeJson(res, 400, { ok: false, error: 'x_y_z_required' });
        }
        const ok = await placeBlock(bot, item, x, y, z, 'bottom', true);
        return writeJson(res, 200, { ok: Boolean(ok), action: type, item, position: { x, y, z } });
      }

      if (type === 'scan_blocks') {
        const blockName = String(body.block || '').trim();
        const maxDistance = Math.max(1, Number(body.maxDistance || 32));
        const count = Math.max(1, Math.min(256, Number(body.count || 32)));
        if (!blockName) return writeJson(res, 400, { ok: false, error: 'block_required' });
        const mcData = require('minecraft-data')(bot.version);
        const blockType = mcData.blocksByName?.[blockName];
        if (!blockType) return writeJson(res, 400, { ok: false, error: `unknown_block:${blockName}` });
        const positions = bot.findBlocks({ matching: blockType.id, maxDistance, count });
        return writeJson(res, 200, {
          ok: true,
          action: type,
          block: blockName,
          positions: positions.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        });
      }

      if (type === 'container_contents') {
        const block = findNearbyContainerBlock(bot);
        if (!block) return writeJson(res, 404, { ok: false, error: 'no_container_nearby' });
        const container = await bot.openContainer(block);
        try {
          const items = (container.containerItems?.() || []).map((i) => ({ name: i.name, count: i.count, slot: i.slot }));
          return writeJson(res, 200, {
            ok: true,
            action: type,
            block: block.name,
            position: { x: block.position.x, y: block.position.y, z: block.position.z },
            items,
          });
        } finally {
          try { container.close(); } catch (_err) {}
        }
      }

      if (type === 'viewer_start') {
        if (viewerInfo) return writeJson(res, 200, { ok: true, action: type, already_running: true, ...viewerInfo });
        const port = Number.isFinite(Number(body.port)) ? Number(body.port) : (Number.isFinite(API_PORT) ? API_PORT + 1000 : 0);
        if (!Number.isFinite(port) || port <= 0) return writeJson(res, 400, { ok: false, error: 'invalid_port' });
        // eslint-disable-next-line global-require, import/no-dynamic-require
        const viewerMineflayer = require('../agent-runtime/third_party/prismarine-viewer-mineflayer.js');
        viewerInfo = viewerMineflayer(bot, { port, firstPerson: true, host: '127.0.0.1' });
        return writeJson(res, 200, { ok: true, action: type, ...viewerInfo });
      }

      if (type === 'viewer_stop') {
        try {
          if (bot.viewer && typeof bot.viewer.close === 'function') bot.viewer.close();
        } catch (_err) {}
        viewerInfo = null;
        return writeJson(res, 200, { ok: true, action: type });
      }

      if (type === 'web_inventory_start') {
        if (webInventoryInfo) return writeJson(res, 200, { ok: true, action: type, already_running: true, ...webInventoryInfo });
        const port = Number.isFinite(Number(body.port)) ? Number(body.port) : (Number.isFinite(API_PORT) ? API_PORT + 1001 : 0);
        if (!Number.isFinite(port) || port <= 0) return writeJson(res, 400, { ok: false, error: 'invalid_port' });
        // eslint-disable-next-line global-require, import/no-dynamic-require
        const inventoryViewer = require('mineflayer-web-inventory');
        if (typeof inventoryViewer !== 'function') return writeJson(res, 500, { ok: false, error: 'web_inventory_api_unknown' });
        inventoryViewer(bot, { port, startOnLoad: false });
        if (!bot.webInventory || typeof bot.webInventory.start !== 'function') {
          return writeJson(res, 500, { ok: false, error: 'web_inventory_not_initialized' });
        }
        await bot.webInventory.start();
        webInventoryInfo = { host: '127.0.0.1', port };
        return writeJson(res, 200, { ok: true, action: type, ...webInventoryInfo });
      }

      if (type === 'web_inventory_stop') {
        try {
          if (bot.webInventory && typeof bot.webInventory.stop === 'function') await bot.webInventory.stop();
        } catch (_err) {}
        webInventoryInfo = null;
        return writeJson(res, 200, { ok: true, action: type });
      }

      if (type === 'follow') {
        const target = findEntityByName(bot, body.target);
        const dist = Math.max(1, Number(body.distance || 2));
        if (!target) return writeJson(res, 404, { ok: false, error: 'target_not_found' });
        if (!bot.pathfinder) return writeJson(res, 409, { ok: false, error: 'pathfinder_not_loaded' });
        // eslint-disable-next-line global-require, import/no-dynamic-require
        const { goals } = require('mineflayer-pathfinder');
        bot.pathfinder.setGoal(new goals.GoalFollow(target, dist), true);
        return writeJson(res, 200, { ok: true, action: type, target: body.target, distance: dist });
      }

      if (type === 'stop_follow') {
        if (bot.pathfinder) bot.pathfinder.setGoal(null);
        return writeJson(res, 200, { ok: true, action: type });
      }

      if (type === 'raw_get') {
        const resolved = resolveBotPath(bot, body.path || body.target);
        if (!resolved.ok) return writeJson(res, 400, { ok: false, error: resolved.error });
        const value = resolved.obj[resolved.key];
        return writeJson(res, 200, { ok: true, action: type, path: resolved.full, value: safeDescribe(value) });
      }

      if (type === 'raw_call') {
        const resolved = resolveBotPath(bot, body.path || body.target);
        if (!resolved.ok) return writeJson(res, 400, { ok: false, error: resolved.error });
        const fn = resolved.obj[resolved.key];
        if (typeof fn !== 'function') return writeJson(res, 400, { ok: false, error: 'path_not_callable' });
        const args = Array.isArray(body.args) ? body.args : [];
        const result = await fn.apply(resolved.obj, args);
        return writeJson(res, 200, { ok: true, action: type, path: resolved.full, result: safeDescribe(result) });
      }

      return writeJson(res, 400, { ok: false, error: `unknown_action:${type}` });
    }

    // Logs
    if (req.method === 'GET' && url.pathname === '/logs') {
      const history = agent.history?.getHistory() || [];
      const limit = Number(url.searchParams.get('limit') || 50);
      return writeJson(res, 200, { ok: true, logs: history.slice(-limit) });
    }

    // Capabilities
    if (req.method === 'GET' && url.pathname === '/capabilities') {
      const bot = agent.bot;
      const actions = [
        'go_to',
        'mine',
        'collect_block',
        'craft',
        'equip',
        'equip_best_armor',
        'equip_for_block',
        'equip_for_entity',
        'eat',
        'attack',
        'pvp_attack',
        'pvp_stop',
        'deposit',
        'withdraw',
        'place',
        'follow',
        'stop_follow',
        'stop',
        'chat',
        'say_public',
        'scan_blocks',
        'container_contents',
        'viewer_start',
        'viewer_stop',
        'web_inventory_start',
        'web_inventory_stop',
        'auto_eat_enable',
        'auto_eat_disable',
        'raw_get',
        'raw_call',
      ];
      return writeJson(res, 200, {
        ok: true,
        runtime: 'mindcraft',
        model: LLM_MODEL,
        self_prompting: true,
        supported_actions: actions,
        plugins: {
          pathfinder: Boolean(bot?.pathfinder),
          collectblock: Boolean(bot?.collectBlock),
          pvp: Boolean(bot?.pvp),
          auto_eat: Boolean(bot?.autoEat),
          armor_manager: Boolean(bot?.armorManager),
          tool: Boolean(bot?.tool),
          viewer: Boolean(viewerInfo),
          web_inventory: Boolean(webInventoryInfo),
        },
      });
    }

    writeJson(res, 404, { ok: false, error: 'not_found' });
  } catch (err) {
    console.error('[clawcraft-api]', err);
    writeJson(res, 500, { ok: false, error: err.message });
  }
});

apiServer.listen(API_PORT, '127.0.0.1', () => {
  console.log(`[clawcraft] ${BOT_USERNAME} API on ${API_PORT}`);
});
