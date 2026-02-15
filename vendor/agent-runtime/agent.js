#!/usr/bin/env node

/*
  ClawCraft Agent Runtime (vendored)

  This is the default managed-agent process spawned by `app/agent-manager.js`.
  It runs a Mineflayer bot and exposes a local HTTP control API.

  Env:
    MC_HOST, MC_PORT
    BOT_USERNAME
    API_PORT
    TEAM_ID, AGENT_NAME (optional)
    SOUL (optional; stored/returned but not executed here)
*/

const http = require('node:http');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const viewerMineflayer = require('./third_party/prismarine-viewer-mineflayer.js');

const MC_HOST = process.env.MC_HOST || '127.0.0.1';
const MC_PORT = Number(process.env.MC_PORT || 25565);
const BOT_USERNAME = process.env.BOT_USERNAME || 'ClawAgent';
const API_PORT = Number(process.env.API_PORT || 4000);
const VIEWER_PORT = process.env.VIEWER_PORT ? Number(process.env.VIEWER_PORT) : null;

const MAX_CHAT = 80;
const MAX_LOG = 500;
const ENTITY_SCAN_RADIUS = Math.max(4, Number(process.env.ENTITY_SCAN_RADIUS || 16));

const chatLog = [];
const activityLog = [];

let currentTask = null;
let currentPlan = null;

let stopRequested = false;
let actionChain = Promise.resolve();
let viewerInfo = null; // { host, port }
const pluginStatus = {}; // packageName -> { ok: boolean, error?: string }
let webInventoryInfo = null; // { host, port }
let dashboardInfo = null; // { host, port }
let taskEpoch = 0;
let taskRunnerActive = false;

const AUTO_RUN_TASKS = Number(process.env.AUTO_RUN_TASKS ?? 1);

/* ───────────────────── LLM Brain ───────────────────── */

const LLM_API_URL = process.env.LLM_API_URL || 'https://api.cerebras.ai/v1/chat/completions';
const LLM_API_KEY = process.env.LLM_API_KEY || process.env.CEREBRAS_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'llama-3.3-70b';
const SOUL = process.env.SOUL || '';
const LLM_MAX_ITERATIONS = Number(process.env.LLM_MAX_ITERATIONS || 200);
const LLM_THINK_DELAY_MS = Number(process.env.LLM_THINK_DELAY_MS || 1500);
const LLM_HISTORY_SIZE = 20; // sliding window of message pairs

const llmHistory = []; // {role, content}[]

function llmEnabled() {
  return Boolean(LLM_API_KEY);
}

function buildSystemPrompt() {
  const soulBlock = SOUL ? `# Your Identity\n${SOUL}\n\n` : '';
  return `${soulBlock}You are a Minecraft bot controlled by an AI brain. You observe your surroundings, think step-by-step, and decide the next action.

# Available Actions (respond with ONE action per turn)

Movement:
- {"type":"go_to","x":0,"y":64,"z":0} — pathfind to coordinates
- {"type":"move","direction":"forward","duration":750} — raw movement (forward/back/left/right)
- {"type":"look","x":0,"y":64,"z":0} — look at position

Mining & Building:
- {"type":"mine","block":"iron_ore","count":5,"maxDistance":32} — mine blocks by name
- {"type":"dig","x":0,"y":64,"z":0} — dig specific block at position
- {"type":"place","item":"chest","x":0,"y":64,"z":0} — place item at position
- {"type":"collect_block","block":"diamond_ore","count":3,"maxDistance":48} — pathfind + mine + pickup
- {"type":"scan_blocks","block":"iron_ore","maxDistance":32,"count":10} — find nearby blocks (returns positions)

Crafting & Items:
- {"type":"craft","item":"iron_pickaxe","count":1} — craft (needs crafting table nearby for complex recipes)
- {"type":"equip","item":"iron_helmet","slot":"head"} — equip item (slots: head, torso, legs, feet, hand)
- {"type":"equip_best_armor"} — auto-equip best armor from inventory
- {"type":"deposit","item":"diamond","count":10} — deposit into nearby chest
- {"type":"withdraw","item":"diamond","count":10} — withdraw from nearby chest
- {"type":"toss","item":"cobblestone","count":64} — throw items away

Survival:
- {"type":"eat"} — eat best food in inventory
- {"type":"auto_eat_enable"} — auto-eat when hungry
- {"type":"attack","target":"zombie"} — melee attack entity
- {"type":"pvp_attack","target":"player_name"} — sustained PVP attack

Utility:
- {"type":"chat","message":"hello"} — send message in game chat
- {"type":"stop"} — stop all movement
- {"type":"container_contents"} — check contents of nearby chest
- {"type":"inspect","x":0,"y":64,"z":0} — inspect block at position

# Response Format

Respond with ONLY a JSON object (no markdown, no backticks):
{"thought":"your reasoning about what to do next","action":{"type":"..."},"task_progress":"description of overall progress","done":false}

Set "done":true ONLY when the assigned task is fully completed.
If an action fails, adapt your plan — try a different approach.
If you're stuck, explain why in "thought" and try something creative.
Keep thoughts concise (1-2 sentences).`;
}

function compactState() {
  const pos = bot.entity?.position;
  const inv = bot.inventory.items().map((it) => `${it.name}x${it.count}`).join(', ') || 'empty';
  const eq = equipmentState();
  const eqStr = Object.entries(eq)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}:${v.name}`)
    .join(', ') || 'nothing';
  const entities = nearbyEntities().slice(0, 10);
  const entityStr = entities.length
    ? entities.map((e) => `${e.username || e.name || e.type}(${e.distance}m)`).join(', ')
    : 'none nearby';

  return [
    `Position: ${pos ? `${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)}` : 'unknown'}`,
    `Dimension: ${bot.game?.dimension || 'overworld'}`,
    `Health: ${bot.health}/20  Food: ${bot.food}/20`,
    `Inventory: ${inv}`,
    `Equipment: ${eqStr}`,
    `Nearby entities: ${entityStr}`,
  ].join('\n');
}

function buildUserMessage(task, lastActionResult) {
  const state = compactState();
  const taskStr = task
    ? `Goal: ${task.goal || 'unknown'}${task.target ? ` (target: ${task.target})` : ''}${task.strategy ? ` | Strategy: ${task.strategy}` : ''}`
    : 'No task assigned.';
  const planStr = currentPlan ? `Master's instructions: ${currentPlan}` : '';
  const resultStr = lastActionResult
    ? `Last action result: ${JSON.stringify(lastActionResult)}`
    : '';

  return [
    '--- Current State ---',
    state,
    '',
    '--- Task ---',
    taskStr,
    planStr,
    resultStr,
  ].filter(Boolean).join('\n');
}

async function llmChat(messages) {
  const resp = await fetch(LLM_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      temperature: 0.3,
      max_tokens: 512,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`LLM API ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

function parseLlmResponse(raw) {
  // Try to extract JSON from the response, handling markdown fences etc.
  let text = raw.trim();
  // Strip markdown code fences if present
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }
  try {
    return JSON.parse(text);
  } catch (_err) {
    // Try to find JSON object in the text
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (_err2) {
        return null;
      }
    }
    return null;
  }
}

async function thinkActLoop(task, epoch) {
  currentTask.status = 'running';
  currentTask.updated_at = Date.now();
  pushLog('llm:start', { goal: task.goal || 'unknown', model: LLM_MODEL });

  // Reset conversation history for new task
  llmHistory.length = 0;

  const systemMsg = { role: 'system', content: buildSystemPrompt() };
  let lastResult = null;
  let consecutiveErrors = 0;

  for (let i = 0; i < LLM_MAX_ITERATIONS; i++) {
    if (epoch !== taskEpoch) {
      currentTask.status = 'aborted';
      currentTask.updated_at = Date.now();
      pushLog('llm:aborted', { iteration: i });
      return;
    }

    // Wait for bot to be spawned
    if (!bot.entity) {
      pushLog('llm:waiting_spawn');
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }

    // Build user message with current state
    const userMsg = buildUserMessage(task, lastResult);
    llmHistory.push({ role: 'user', content: userMsg });

    // Trim history to sliding window
    while (llmHistory.length > LLM_HISTORY_SIZE * 2) {
      llmHistory.shift();
      llmHistory.shift();
    }

    // Call LLM
    let parsed;
    try {
      const messages = [systemMsg, ...llmHistory];
      const raw = await llmChat(messages);
      llmHistory.push({ role: 'assistant', content: raw });
      parsed = parseLlmResponse(raw);
    } catch (err) {
      pushLog('llm:api_error', { error: err.message, iteration: i });
      consecutiveErrors += 1;
      if (consecutiveErrors >= 5) {
        currentTask.status = 'error';
        currentTask.error = 'llm_api_failures';
        currentTask.updated_at = Date.now();
        pushLog('llm:giving_up', { errors: consecutiveErrors });
        return;
      }
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }

    consecutiveErrors = 0;

    if (!parsed || !parsed.action) {
      pushLog('llm:bad_response', { iteration: i });
      lastResult = { ok: false, error: 'llm_returned_invalid_json' };
      await new Promise((r) => setTimeout(r, LLM_THINK_DELAY_MS));
      continue;
    }

    // Log the thought
    pushLog('llm:think', {
      iteration: i,
      thought: String(parsed.thought || '').slice(0, 200),
      action_type: parsed.action?.type,
    });

    // Update task progress
    if (parsed.task_progress) {
      currentTask.progress_text = String(parsed.task_progress).slice(0, 200);
      currentTask.updated_at = Date.now();
    }

    // Check if task is done
    if (parsed.done === true) {
      currentTask.progress = 1;
      currentTask.status = 'completed';
      currentTask.completed_at = Date.now();
      currentTask.updated_at = Date.now();
      pushLog('llm:task_completed', { iteration: i, thought: parsed.thought });
      return;
    }

    // Execute the action
    try {
      lastResult = await enqueue(() => doAction(parsed.action));
      pushLog('llm:action', {
        iteration: i,
        type: parsed.action.type,
        ok: lastResult?.ok,
        error: lastResult?.error || null,
      });
    } catch (err) {
      lastResult = { ok: false, error: `action_error:${err.message}` };
      pushLog('llm:action_error', { iteration: i, error: err.message });
    }

    // Delay between think cycles
    await new Promise((r) => setTimeout(r, LLM_THINK_DELAY_MS));
  }

  // Hit max iterations
  currentTask.status = 'error';
  currentTask.error = 'max_iterations_reached';
  currentTask.updated_at = Date.now();
  pushLog('llm:max_iterations', { limit: LLM_MAX_ITERATIONS });
}

function pushLog(action, extra) {
  activityLog.push({ time: Date.now(), action, ...(extra || {}) });
  if (activityLog.length > MAX_LOG) activityLog.shift();
}

function enqueue(fn) {
  // Serialize actions to avoid Mineflayer state races.
  const next = actionChain.then(fn, fn);
  actionChain = next.catch(() => {});
  return next;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function countInventoryItemByName(name) {
  const n = String(name || '').trim();
  if (!n) return 0;
  let total = 0;
  for (const it of bot.inventory.items()) {
    if (it.name === n) total += it.count;
  }
  return total;
}

async function wanderOnce() {
  // Avoid pathfinder hangs by using short movement bursts.
  await enqueue(() => doAction({ type: 'look', yaw: Math.random() * Math.PI * 2, pitch: 0 }));
  await enqueue(() => doAction({ type: 'move', direction: 'forward', duration: 1200 }));
}

async function runMineDiamondsGoal(task, epoch) {
  const target = Math.max(1, Number(task?.target || 5));
  const baseline = countInventoryItemByName('diamond');
  let maxDistance = 64;
  let attempts = 0;

  currentTask.status = 'running';
  currentTask.target = target;
  currentTask.baseline = { diamond: baseline };
  currentTask.updated_at = Date.now();

  while (epoch === taskEpoch) {
    const have = countInventoryItemByName('diamond') - baseline;
    currentTask.progress = Math.round(Math.min(1, have / target) * 1000) / 1000;
    currentTask.mined = have;
    currentTask.attempts = attempts;
    currentTask.updated_at = Date.now();

    if (have >= target) {
      currentTask.progress = 1;
      currentTask.status = 'completed';
      currentTask.completed_at = Date.now();
      currentTask.updated_at = Date.now();
      pushLog('task:completed', { goal: 'mine_diamonds', mined: have });
      return;
    }

    const want = Math.max(1, Math.min(12, target - have));
    let res = await enqueue(() =>
      doAction({ type: 'collect_block', block: 'diamond_ore', count: want, maxDistance })
    );

    if (!res?.ok) {
      res = await enqueue(() =>
        doAction({ type: 'collect_block', block: 'deepslate_diamond_ore', count: want, maxDistance })
      );
    }

    // Fallback if collectblock isn't loaded: try basic digging.
    if (!res?.ok && String(res?.error || '').includes('collectblock_not_loaded')) {
      res = await enqueue(() => doAction({ type: 'mine', block: 'diamond_ore', count: want, maxDistance }));
    }

    if (!res?.ok) {
      currentTask.detail = `no_diamonds_found:radius=${maxDistance}`;
      await wanderOnce();
      maxDistance = Math.min(192, maxDistance + 16);
    } else {
      currentTask.detail = 'mining';
    }

    attempts += 1;
    if (attempts > 200) {
      currentTask.status = 'error';
      currentTask.error = 'attempt_limit';
      currentTask.updated_at = Date.now();
      pushLog('task:error', { goal: 'mine_diamonds', error: 'attempt_limit' });
      return;
    }

    await sleep(150);
  }

  currentTask.status = 'aborted';
  currentTask.updated_at = Date.now();
  pushLog('task:aborted', { goal: 'mine_diamonds' });
}

function normalizeTaskSteps(task) {
  if (Array.isArray(task?.steps)) {
    return task.steps.filter((s) => s && typeof s === 'object');
  }

  const goal = String(task?.goal || '').trim();
  const target = Number(task?.target || 0);
  const strategy = String(task?.strategy || '').trim();

  if (goal === 'mine_diamonds' || goal === 'collect_diamonds') {
    const count = Math.max(1, Math.min(128, Number.isFinite(target) && target > 0 ? target : 5));
    return [
      { type: 'auto_eat_enable' },
      { type: 'equip_best_armor' },
      { type: 'collect_block', block: 'diamond_ore', count, maxDistance: 64 },
    ];
  }

  if (goal === 'collect_block') {
    const block = String(task?.block || '').trim();
    if (!block) return [];
    const count = Math.max(
      1,
      Math.min(128, Number.isFinite(target) && target > 0 ? target : Number(task?.count || 1))
    );
    return [{ type: 'collect_block', block, count, maxDistance: Number(task?.maxDistance || 48) }];
  }

  if (goal === 'wander' || strategy === 'wander') {
    return [
      { type: 'move', direction: 'forward', duration: 1500 },
      { type: 'look', yaw: Math.random() * Math.PI * 2, pitch: 0 },
      { type: 'move', direction: 'forward', duration: 1500 },
    ];
  }

  return [];
}

async function runTask(task, epoch) {
  const goal = String(task?.goal || '').trim();

  // Dynamic goals: loop until the goal condition is met so bots feel "alive".
  if (goal === 'mine_diamonds' || goal === 'collect_diamonds') {
    pushLog('task:start', { goal, mode: 'dynamic' });
    await runMineDiamondsGoal(task, epoch);
    return;
  }

  const steps = normalizeTaskSteps(task);
  if (!steps.length) {
    // No hardcoded plan → try LLM brain if available
    if (llmEnabled()) {
      pushLog('task:start', { goal: goal || 'unknown', mode: 'llm' });
      await thinkActLoop(task, epoch);
      return;
    }
    currentTask.status = 'needs_plan';
    currentTask.error = 'no_steps_and_no_llm';
    pushLog('task:needs_plan', { goal: currentTask.goal || null });
    return;
  }

  currentTask.steps_total = steps.length;
  currentTask.step_index = 0;
  currentTask.progress = 0;
  currentTask.status = 'running';
  currentTask.started_at = currentTask.started_at || Date.now();
  currentTask.updated_at = Date.now();
  currentTask.error = null;

  pushLog('task:start', { goal: String(currentTask.goal || 'unknown'), steps: steps.length });

  for (let i = 0; i < steps.length; i++) {
    if (epoch !== taskEpoch) {
      currentTask.status = 'aborted';
      currentTask.updated_at = Date.now();
      pushLog('task:aborted', { at_step: i });
      return;
    }

    const step = steps[i];
    currentTask.step_index = i;
    currentTask.current_step = step;
    currentTask.progress = Math.round((i / steps.length) * 1000) / 1000;
    currentTask.updated_at = Date.now();
    pushLog('task:step', { i, type: step.type });

    const result = await enqueue(() => doAction(step));
    if (!result?.ok) {
      currentTask.status = 'error';
      currentTask.error = result?.error || 'step_failed';
      currentTask.failed_step = step;
      currentTask.updated_at = Date.now();
      pushLog('task:error', { i, error: currentTask.error });
      return;
    }
  }

  currentTask.progress = 1;
  currentTask.status = 'completed';
  currentTask.completed_at = Date.now();
  currentTask.updated_at = Date.now();
  pushLog('task:completed', { goal: String(currentTask.goal || 'unknown') });
}

function startTaskRunner() {
  if (taskRunnerActive) return;
  taskRunnerActive = true;
  const epoch = taskEpoch;
  Promise.resolve()
    .then(() => runTask(currentTask, epoch))
    .catch((err) => {
      if (currentTask) {
        currentTask.status = 'error';
        currentTask.error = `task_runner_error:${err.message}`;
        currentTask.updated_at = Date.now();
      }
      pushLog('task:runner_crash', { err: err.message });
    })
    .finally(() => {
      taskRunnerActive = false;
    });
}

const ACTION_TYPES = [
  'chat',
  'stop',
  'move',
  'look',
  'go_to',
  'equip',
  'craft',
  'eat',
  'attack',
  'mine',
  'dig',
  'place',
  'deposit',
  'withdraw',
  'toss',
  'use',
  'interact',
  'follow',
  'stop_follow',
  'inspect',
  'viewer_start',
  'viewer_stop',
  'scan_blocks',
  'container_contents',
  'raw_call',
  'raw_get',
  'collect_block',
  'equip_best_armor',
  'auto_eat_enable',
  'auto_eat_disable',
  'pvp_attack',
  'pvp_stop',
  'web_inventory_start',
  'web_inventory_stop',
  'dashboard_start',
  'dashboard_stop',
  'equip_for_block',
  'equip_for_entity',
  'cancel_task',
];

const botOptions = {
  host: MC_HOST,
  port: MC_PORT,
  username: BOT_USERNAME,
  auth: 'offline',
  version: false,
};

// Paper 1.21.x chat packets can trip prismarine-chat parsing in some stacks.
// Default to disabling chat parsing; opt-in with ENABLE_CHAT_PLUGIN=1 if needed.
if (!Number(process.env.ENABLE_CHAT_PLUGIN || 0)) {
  botOptions.plugins = { chat: false };
}

const bot = mineflayer.createBot(botOptions);

bot.loadPlugin(pathfinder);

function markPlugin(name, ok, extra) {
  pluginStatus[name] = { ok: Boolean(ok), ...(extra || {}) };
}

function tryLoadMineflayerPlugin(pkgName) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const mod = require(pkgName);
    const plugin = mod?.plugin || mod?.default || mod;
    if (typeof plugin !== 'function') {
      markPlugin(pkgName, false, { error: 'no_plugin_export' });
      return;
    }
    bot.loadPlugin(plugin);
    markPlugin(pkgName, true);
  } catch (err) {
    markPlugin(pkgName, false, { error: err.message });
  }
}

// Optional plugins. The runtime should still boot if they are absent.
tryLoadMineflayerPlugin('mineflayer-tool');
tryLoadMineflayerPlugin('mineflayer-collectblock');
tryLoadMineflayerPlugin('mineflayer-pvp');
tryLoadMineflayerPlugin('mineflayer-armor-manager');
tryLoadMineflayerPlugin('mineflayer-death-event');

async function tryLoadAutoEat() {
  const name = 'mineflayer-auto-eat';
  if (pluginStatus[name]?.ok) return;
  try {
    let mod;
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      mod = require(name);
    } catch (_err) {
      mod = await import(name);
    }
    const plugin =
      mod?.loader ||
      mod?.plugin ||
      mod?.default?.loader ||
      mod?.default?.plugin ||
      mod?.default ||
      mod;
    if (typeof plugin !== 'function') {
      markPlugin(name, false, { error: 'no_plugin_export' });
      return;
    }
    bot.loadPlugin(plugin);
    markPlugin(name, true);
  } catch (err) {
    markPlugin(name, false, { error: err.message });
  }
}

bot.once('spawn', () => {
  try {
    const movements = new Movements(bot);
    bot.pathfinder.setMovements(movements);
  } catch (err) {
    pushLog('pathfinder_init_error', { err: err.message });
  }
  void tryLoadAutoEat();
  pushLog('spawned');
  // Chat send is optional; the internal chat plugin may be disabled.
  try {
    if (typeof bot.chat === 'function') bot.chat(`${BOT_USERNAME} online`);
    else if (bot._client?.chat) bot._client.chat(`${BOT_USERNAME} online`);
  } catch (_err) {}
});

bot.on('chat', (username, message) => {
  chatLog.push({ username, message, time: Date.now() });
  if (chatLog.length > MAX_CHAT) chatLog.shift();
});

bot.on('death', () => pushLog('death'));
bot.on('respawn', () => pushLog('respawn'));
bot.on('health', () => pushLog('health', { health: bot.health, food: bot.food }));

bot.on('error', (err) => pushLog('error', { err: err.message }));
bot.on('kicked', (reason) => pushLog('kicked', { reason: String(reason) }));
bot.on('end', (reason) => pushLog('end', { reason: String(reason) }));

function stopControls() {
  stopRequested = true;
  try {
    for (const control of ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint']) {
      bot.setControlState(control, false);
    }
  } catch (_err) {}
  try {
    bot.pathfinder.setGoal(null);
  } catch (_err) {}
  setTimeout(() => {
    stopRequested = false;
  }, 50);
}

function invItems() {
  return bot.inventory.items().map((item) => ({
    name: item.name,
    count: item.count,
    slot: item.slot,
  }));
}

function equipmentState() {
  const held = bot.heldItem ? { name: bot.heldItem.name, count: bot.heldItem.count } : null;
  return {
    head: bot.inventory.slots[5] ? { name: bot.inventory.slots[5].name } : null,
    chest: bot.inventory.slots[6] ? { name: bot.inventory.slots[6].name } : null,
    legs: bot.inventory.slots[7] ? { name: bot.inventory.slots[7].name } : null,
    feet: bot.inventory.slots[8] ? { name: bot.inventory.slots[8].name } : null,
    hand: held,
  };
}

function fmtPos(p) {
  return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
}

function nearbyEntities() {
  const me = bot.entity?.position;
  if (!me) return [];
  const out = [];
  for (const e of Object.values(bot.entities)) {
    if (!e || e === bot.entity) continue;
    if (!e.position) continue;
    const d = e.position.distanceTo(me);
    if (d > ENTITY_SCAN_RADIUS) continue;
    out.push({
      id: e.id,
      type: e.type,
      name: e.name || null,
      username: e.username || null,
      position: fmtPos(e.position),
      distance: Math.round(d * 10) / 10,
    });
  }
  out.sort((a, b) => a.distance - b.distance);
  return out.slice(0, 50);
}

function gameState() {
  const pos = bot.entity?.position;
  return {
    ok: true,
    spawned: Boolean(bot.entity),
    username: BOT_USERNAME,
    team_id: process.env.TEAM_ID || null,
    agent_name: process.env.AGENT_NAME || null,
    position: pos ? { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } : null,
    health: bot.health,
    food: bot.food,
    dimension: bot.game?.dimension || 'overworld',
    inventory: invItems(),
    equipment: equipmentState(),
    recentChat: chatLog.slice(-20),
    task: currentTask,
    nearby_entities: nearbyEntities(),
    viewer: viewerInfo ? { ok: true, ...viewerInfo } : { ok: false },
    web_inventory: webInventoryInfo ? { ok: true, ...webInventoryInfo } : { ok: false },
    dashboard: dashboardInfo ? { ok: true, ...dashboardInfo } : { ok: false },
    plugins: pluginStatus,
  };
}

async function ensureSpawned() {
  if (!bot.entity) return { ok: false, error: 'not_spawned' };
  return null;
}

function findItemByName(name) {
  return bot.inventory.items().find((it) => it.name === name) || null;
}

function toSlotName(slot) {
  const s = String(slot || '').toLowerCase();
  if (s === 'hand' || s === 'mainhand') return 'hand';
  if (s === 'head' || s === 'helmet') return 'head';
  if (s === 'chest' || s === 'torso' || s === 'chestplate') return 'torso';
  if (s === 'legs' || s === 'leggings') return 'legs';
  if (s === 'feet' || s === 'boots') return 'feet';
  return null;
}

function coerceVec3(x, y, z) {
  const nx = Number(x);
  const ny = Number(y);
  const nz = Number(z);
  if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) return null;
  return new Vec3(nx, ny, nz);
}

async function goNear(x, y, z, range = 2) {
  bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, range));
  // Prefer goto when available, but keep compatibility.
  if (typeof bot.pathfinder.goto === 'function') {
    await bot.pathfinder.goto(new goals.GoalNear(x, y, z, range));
  }
}

async function digBlock(block) {
  if (!block) return { ok: false, error: 'block_not_found' };
  if (stopRequested) return { ok: false, error: 'stopped' };
  try {
    await goNear(block.position.x, block.position.y, block.position.z, 2);
  } catch (_err) {
    // continue; digging may still be possible
  }
  if (stopRequested) return { ok: false, error: 'stopped' };
  await bot.dig(block);
  return { ok: true };
}

function findEntityByName(name) {
  const n = String(name || '').trim();
  if (!n) return null;
  return (
    Object.values(bot.entities).find((e) => e?.username === n || e?.name === n) ||
    null
  );
}

function findNearbyContainerBlock() {
  // eslint-disable-next-line global-require
  const mcData = require('minecraft-data')(bot.version);
  const candidates = [
    mcData.blocksByName.chest?.id,
    mcData.blocksByName.trapped_chest?.id,
    mcData.blocksByName.barrel?.id,
  ].filter(Boolean);
  if (candidates.length === 0) return null;

  // mineflayer's findBlock doesn't accept an array in older versions, so try sequentially.
  for (const id of candidates) {
    const b = bot.findBlock({ matching: id, maxDistance: 4 });
    if (b) return b;
  }
  return null;
}

function containerToItems(container) {
  const items = [];
  for (const it of container.containerItems()) {
    items.push({ name: it.name, count: it.count, slot: it.slot });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

async function collectBlocksByName(blockName, count, maxDistance) {
  if (!bot.collectBlock || typeof bot.collectBlock.collect !== 'function') {
    return { ok: false, error: 'collectblock_not_loaded' };
  }
  // eslint-disable-next-line global-require
  const mcData = require('minecraft-data')(bot.version);
  const blockType = mcData.blocksByName[blockName];
  if (!blockType) return { ok: false, error: `unknown_block:${blockName}` };

  const positions = bot.findBlocks({ matching: blockType.id, maxDistance, count });
  const blocks = positions.map((p) => bot.blockAt(p)).filter(Boolean);
  if (blocks.length === 0) return { ok: false, error: 'no_blocks_found' };

  const ret = bot.collectBlock.collect(blocks);
  if (ret && typeof ret.then === 'function') {
    await ret;
  } else {
    await new Promise((resolve, reject) => {
      bot.collectBlock.collect(blocks, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  return { ok: true, collected: blocks.length };
}

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && (v.constructor === Object || Object.getPrototypeOf(v) === null);
}

function coerceArg(v) {
  // Allow JSON-y request bodies to express Vec3.
  if (isPlainObject(v) && Number.isFinite(Number(v.x)) && Number.isFinite(Number(v.y)) && Number.isFinite(Number(v.z))) {
    return new Vec3(Number(v.x), Number(v.y), Number(v.z));
  }
  if (Array.isArray(v)) return v.map(coerceArg);
  if (isPlainObject(v)) {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = coerceArg(val);
    return out;
  }
  return v;
}

function safeDescribe(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
  if (value instanceof Vec3) return { x: value.x, y: value.y, z: value.z };

  if (Array.isArray(value)) {
    if (depth >= 2) return `[array len=${value.length}]`;
    return value.slice(0, 50).map((v) => safeDescribe(v, depth + 1));
  }

  if (typeof value === 'object') {
    // Best-effort small projections for common mineflayer/prismarine types.
    const name = value.name || value.username || value.type || null;
    if (value.position && typeof value.position === 'object' && 'x' in value.position) {
      const pos = value.position;
      return { ...(name ? { name } : {}), position: fmtPos(pos) };
    }
    if (depth >= 2) return `[object ${value.constructor?.name || 'Object'}]`;

    const out = {};
    const keys = Object.keys(value).slice(0, 40);
    for (const k of keys) {
      // Avoid huge/cyclic internals.
      if (k.startsWith('_')) continue;
      try {
        out[k] = safeDescribe(value[k], depth + 1);
      } catch (_err) {
        out[k] = '[unreadable]';
      }
    }
    return out;
  }

  return `[${typeof value}]`;
}

function resolvePath(root, pathStr) {
  const raw = String(pathStr || '').trim();
  if (!raw) return { ok: false, error: 'path required' };
  const normalized = raw.startsWith('bot.') ? raw.slice(4) : raw;
  const parts = normalized.split('.').filter(Boolean);
  if (parts.length === 0) return { ok: false, error: 'path required' };
  for (const p of parts) {
    if (!/^[A-Za-z0-9_$]+$/.test(p)) return { ok: false, error: `invalid_path_segment:${p}` };
    if (p.startsWith('_')) return { ok: false, error: 'private_path_segment_blocked' };
    if (p === 'constructor' || p === '__proto__' || p === 'prototype') return { ok: false, error: 'proto_path_blocked' };
  }

  let obj = root;
  for (let i = 0; i < parts.length - 1; i++) {
    if (obj == null) return { ok: false, error: 'path_not_found' };
    obj = obj[parts[i]];
  }

  const key = parts[parts.length - 1];
  if (!obj || !(key in obj)) return { ok: false, error: 'path_not_found' };
  return { ok: true, obj, key, full: `bot.${parts.join('.')}` };
}

async function doAction(action) {
  const spawnErr = await ensureSpawned();
  if (spawnErr) return spawnErr;

  const type = String(action?.type || '').trim();
  if (!type) return { ok: false, error: 'type required' };

  function sendChat(msg) {
    const text = String(msg || '');
    try {
      if (typeof bot.chat === 'function') bot.chat(text);
      else if (bot._client?.chat) bot._client.chat(text);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `chat_error:${err.message}` };
    }
  }

  switch (type) {
    case 'chat': {
      const msg = String(action.message || '');
      const sent = sendChat(msg);
      pushLog('chat', { message: msg });
      return sent.ok ? { ok: true, action: 'chat' } : sent;
    }

    case 'say_public': {
      const msg = String(action.message || '');
      const sent = sendChat(msg);
      pushLog('say_public', { message: msg });
      return sent.ok ? { ok: true, action: 'say_public' } : sent;
    }

    case 'stop': {
      stopControls();
      pushLog('stop');
      return { ok: true, action: 'stop' };
    }

    case 'cancel_task': {
      taskEpoch += 1;
      stopControls();
      if (currentTask && currentTask.status === 'running') {
        currentTask.status = 'aborted';
        currentTask.updated_at = Date.now();
      }
      pushLog('task:abort');
      return { ok: true, action: 'cancel_task', aborted: true };
    }

    case 'move': {
      stopControls();
      const dir = String(action.direction || 'forward');
      const duration = Math.max(0, Number(action.duration || 750));
      bot.setControlState(dir, true);
      setTimeout(() => {
        try {
          bot.setControlState(dir, false);
        } catch (_err) {}
      }, duration);
      pushLog('move', { direction: dir, duration });
      return { ok: true, action: 'move', direction: dir, duration };
    }

    case 'look': {
      if (action.x != null && action.y != null && action.z != null) {
        await bot.lookAt(new Vec3(Number(action.x), Number(action.y), Number(action.z)));
      } else if (action.yaw != null) {
        await bot.look(Number(action.yaw), Number(action.pitch || 0), false);
      } else {
        return { ok: false, error: 'provide x,y,z or yaw' };
      }
      pushLog('look');
      return { ok: true, action: 'look' };
    }

    case 'go_to': {
      const x = Number(action.x);
      const y = Number(action.y);
      const z = Number(action.z);
      const range = Number.isFinite(Number(action.range)) ? Number(action.range) : 2;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return { ok: false, error: 'x,y,z required' };
      }
      stopRequested = false;
      await goNear(x, y, z, range);
      pushLog('go_to', { x, y, z, range });
      return { ok: true, action: 'go_to', x, y, z, range };
    }

    case 'equip': {
      const itemName = String(action.item || '').trim();
      const slotName = toSlotName(action.slot || 'hand');
      if (!itemName) return { ok: false, error: 'item required' };
      if (!slotName) return { ok: false, error: 'invalid slot' };
      const item = findItemByName(itemName);
      if (!item) return { ok: false, error: `missing_item:${itemName}` };
      await bot.equip(item, slotName);
      pushLog('equip', { item: itemName, slot: slotName });
      return { ok: true, action: 'equip', item: itemName, slot: slotName };
    }

    case 'craft': {
      const itemName = String(action.item || '').trim();
      const count = Math.max(1, Number(action.count || 1));
      if (!itemName) return { ok: false, error: 'item required' };
      // minecraft-data is usually present via mineflayer deps.
      // eslint-disable-next-line global-require
      const mcData = require('minecraft-data')(bot.version);
      const item = mcData.itemsByName[itemName];
      if (!item) return { ok: false, error: `unknown_item:${itemName}` };
      const recipe = bot.recipesFor(item.id, null, 1, null)[0];
      if (!recipe) return { ok: false, error: `no_recipe:${itemName}` };
      const table = bot.findBlock({
        matching: mcData.blocksByName.crafting_table?.id,
        maxDistance: 4,
      });
      await bot.craft(recipe, count, table || undefined);
      pushLog('craft', { item: itemName, count });
      return { ok: true, action: 'craft', item: itemName, count };
    }

    case 'eat': {
      const explicit = action.item ? String(action.item).trim() : null;
      const item = explicit ? findItemByName(explicit) : bot.inventory.items().find((it) => it.foodPoints > 0);
      if (!item) return { ok: false, error: 'no_food' };
      await bot.equip(item, 'hand');
      await bot.consume();
      pushLog('eat', { item: item.name });
      return { ok: true, action: 'eat', item: item.name };
    }

    case 'attack': {
      const targetName = action.target ? String(action.target).trim() : null;
      let target = null;
      if (targetName) {
        target = Object.values(bot.entities).find((e) => e.username === targetName || e.name === targetName) || null;
      } else {
        const me = bot.entity?.position;
        let best = null;
        let bestD = Infinity;
        for (const e of Object.values(bot.entities)) {
          if (!e || e === bot.entity) continue;
          if (!e.position || !me) continue;
          if (e.type !== 'mob' && e.type !== 'player') continue;
          const d = e.position.distanceTo(me);
          if (d < bestD) {
            bestD = d;
            best = e;
          }
        }
        target = best;
      }
      if (!target) return { ok: false, error: 'target_not_found' };
      bot.attack(target);
      pushLog('attack', { target: target.username || target.name || target.id });
      return { ok: true, action: 'attack' };
    }

    case 'mine': {
      const blockName = String(action.block || '').trim();
      const count = Math.max(1, Number(action.count || 1));
      const maxDistance = Math.max(1, Number(action.maxDistance || 32));
      if (!blockName) return { ok: false, error: 'block required' };
      // eslint-disable-next-line global-require
      const mcData = require('minecraft-data')(bot.version);
      const blockType = mcData.blocksByName[blockName];
      if (!blockType) return { ok: false, error: `unknown_block:${blockName}` };

      stopRequested = false;
      let mined = 0;
      for (let i = 0; i < count; i++) {
        if (stopRequested) return { ok: false, error: 'stopped', mined };
        const block = bot.findBlock({ matching: blockType.id, maxDistance });
        if (!block) break;
        try {
          const res = await digBlock(block);
          if (!res.ok) return { ok: false, error: res.error, mined };
          mined += 1;
          pushLog('mine', { block: blockName, mined });
        } catch (err) {
          return { ok: false, error: `mine_error:${err.message}`, mined };
        }
      }
      return { ok: true, action: 'mine', block: blockName, mined };
    }

    case 'dig': {
      const pos = coerceVec3(action.x, action.y, action.z);
      if (!pos) return { ok: false, error: 'x,y,z required' };
      const block = bot.blockAt(pos);
      if (!block) return { ok: false, error: 'block_not_found' };
      if (block.name === 'air') return { ok: false, error: 'block_is_air' };
      stopRequested = false;
      const res = await digBlock(block);
      if (!res.ok) return res;
      pushLog('dig', { position: fmtPos(pos), block: block.name });
      return { ok: true, action: 'dig', position: fmtPos(pos), block: block.name };
    }

    case 'place': {
      const itemName = String(action.item || '').trim();
      if (!itemName) return { ok: false, error: 'item required' };
      const target = coerceVec3(action.x, action.y, action.z);
      if (!target) return { ok: false, error: 'x,y,z required' };
      const item = findItemByName(itemName);
      if (!item) return { ok: false, error: `missing_item:${itemName}` };

      // Basic placement strategy: place on top of the block below target.
      const below = bot.blockAt(target.offset(0, -1, 0));
      if (!below || below.name === 'air') return { ok: false, error: 'no_support_block_below_target' };

      stopRequested = false;
      try {
        await goNear(target.x, target.y, target.z, 3);
      } catch (_err) {}

      await bot.equip(item, 'hand');
      await bot.placeBlock(below, new Vec3(0, 1, 0));
      pushLog('place', { item: itemName, position: fmtPos(target) });
      return { ok: true, action: 'place', item: itemName, position: fmtPos(target) };
    }

    case 'deposit': {
      const itemName = String(action.item || '').trim();
      const count = action.count != null ? Math.max(1, Number(action.count)) : null;
      if (!itemName) return { ok: false, error: 'item required' };
      const chestBlock =
        (action.x != null && action.y != null && action.z != null
          ? bot.blockAt(coerceVec3(action.x, action.y, action.z))
          : null) || findNearbyContainerBlock();
      if (!chestBlock) return { ok: false, error: 'no_container_nearby' };
      const invItem = findItemByName(itemName);
      if (!invItem) return { ok: false, error: `missing_item:${itemName}` };

      const chest = await bot.openContainer(chestBlock);
      try {
        const amt = Math.min(invItem.count, count || invItem.count);
        await chest.deposit(invItem.type, null, amt);
        pushLog('deposit', { item: itemName, count: amt });
        return { ok: true, action: 'deposit', item: itemName, count: amt };
      } finally {
        try {
          chest.close();
        } catch (_err) {}
      }
    }

    case 'withdraw': {
      const itemName = String(action.item || '').trim();
      const count = Math.max(1, Number(action.count || 1));
      if (!itemName) return { ok: false, error: 'item required' };

      const chestBlock =
        (action.x != null && action.y != null && action.z != null
          ? bot.blockAt(coerceVec3(action.x, action.y, action.z))
          : null) || findNearbyContainerBlock();
      if (!chestBlock) return { ok: false, error: 'no_container_nearby' };

      // eslint-disable-next-line global-require
      const mcData = require('minecraft-data')(bot.version);
      const item = mcData.itemsByName[itemName];
      if (!item) return { ok: false, error: `unknown_item:${itemName}` };

      const chest = await bot.openContainer(chestBlock);
      try {
        await chest.withdraw(item.id, null, count);
        pushLog('withdraw', { item: itemName, count });
        return { ok: true, action: 'withdraw', item: itemName, count };
      } finally {
        try {
          chest.close();
        } catch (_err) {}
      }
    }

    case 'toss': {
      const itemName = String(action.item || '').trim();
      const count = Math.max(1, Number(action.count || 1));
      if (!itemName) return { ok: false, error: 'item required' };
      const invItem = findItemByName(itemName);
      if (!invItem) return { ok: false, error: `missing_item:${itemName}` };
      const amt = Math.min(invItem.count, count);
      await bot.toss(invItem.type, null, amt);
      pushLog('toss', { item: itemName, count: amt });
      return { ok: true, action: 'toss', item: itemName, count: amt };
    }

    case 'use': {
      const pos = coerceVec3(action.x, action.y, action.z);
      if (!pos) return { ok: false, error: 'x,y,z required' };
      const block = bot.blockAt(pos);
      if (!block) return { ok: false, error: 'block_not_found' };
      try {
        await goNear(pos.x, pos.y, pos.z, 3);
      } catch (_err) {}
      await bot.activateBlock(block);
      pushLog('use', { block: block.name, position: fmtPos(pos) });
      return { ok: true, action: 'use', block: block.name, position: fmtPos(pos) };
    }

    case 'interact': {
      const targetName = String(action.target || '').trim();
      const target = findEntityByName(targetName);
      if (!target) return { ok: false, error: 'target_not_found' };
      await bot.activateEntity(target);
      pushLog('interact', { target: target.username || target.name || target.id });
      return { ok: true, action: 'interact' };
    }

    case 'follow': {
      const targetName = String(action.target || '').trim();
      const dist = Math.max(1, Number(action.distance || 2));
      const target = findEntityByName(targetName);
      if (!target) return { ok: false, error: 'target_not_found' };
      stopRequested = false;
      bot.pathfinder.setGoal(new goals.GoalFollow(target, dist), true);
      pushLog('follow', { target: targetName, distance: dist });
      return { ok: true, action: 'follow', target: targetName, distance: dist };
    }

    case 'stop_follow': {
      bot.pathfinder.setGoal(null);
      pushLog('stop_follow');
      return { ok: true, action: 'stop_follow' };
    }

    case 'inspect': {
      const pos = coerceVec3(action.x, action.y, action.z);
      if (!pos) return { ok: false, error: 'x,y,z required' };
      const block = bot.blockAt(pos);
      if (!block) return { ok: false, error: 'block_not_found' };
      pushLog('inspect', { position: fmtPos(pos), block: block.name });
      return {
        ok: true,
        action: 'inspect',
        block: {
          name: block.name,
          position: fmtPos(block.position),
          boundingBox: block.boundingBox,
          hardness: block.hardness,
        },
      };
    }

    case 'viewer_start': {
      if (viewerInfo) return { ok: true, action: 'viewer_start', already_running: true, ...viewerInfo };
      let port = VIEWER_PORT || (Number.isFinite(API_PORT) ? API_PORT + 1000 : 0);
      if (action.port != null) port = Number(action.port);
      if (!Number.isFinite(port) || port <= 0) return { ok: false, error: 'invalid port' };

      viewerInfo = viewerMineflayer(bot, { port, firstPerson: true, host: '127.0.0.1' });
      pushLog('viewer_start', viewerInfo);
      return { ok: true, action: 'viewer_start', ...viewerInfo };
    }

    case 'viewer_stop': {
      try {
        if (bot.viewer && typeof bot.viewer.close === 'function') bot.viewer.close();
      } catch (err) {
        pushLog('viewer_stop_error', { err: err.message });
      } finally {
        viewerInfo = null;
      }
      pushLog('viewer_stop');
      return { ok: true, action: 'viewer_stop' };
    }

    case 'scan_blocks': {
      const blockName = String(action.block || '').trim();
      const maxDistance = Math.max(1, Number(action.maxDistance || 32));
      const count = Math.max(1, Math.min(256, Number(action.count || 32)));
      if (!blockName) return { ok: false, error: 'block required' };

      // eslint-disable-next-line global-require
      const mcData = require('minecraft-data')(bot.version);
      const blockType = mcData.blocksByName[blockName];
      if (!blockType) return { ok: false, error: `unknown_block:${blockName}` };

      const positions = bot.findBlocks({
        matching: blockType.id,
        maxDistance,
        count,
      });

      pushLog('scan_blocks', { block: blockName, count: positions.length, maxDistance });
      return {
        ok: true,
        action: 'scan_blocks',
        block: blockName,
        positions: positions.map((p) => fmtPos(p)),
      };
    }

    case 'container_contents': {
      const block = findNearbyContainerBlock();
      if (!block) return { ok: false, error: 'no_container_nearby' };
      const container = await bot.openContainer(block);
      try {
        const items = containerToItems(container);
        pushLog('container_contents', { items: items.length, block: block.name });
        return { ok: true, action: 'container_contents', block: block.name, position: fmtPos(block.position), items };
      } finally {
        try {
          container.close();
        } catch (_err) {}
      }
    }

    case 'collect_block': {
      const blockName = String(action.block || '').trim();
      const count = Math.max(1, Math.min(128, Number(action.count || 1)));
      const maxDistance = Math.max(1, Number(action.maxDistance || 32));
      if (!blockName) return { ok: false, error: 'block required' };
      try {
        const result = await collectBlocksByName(blockName, count, maxDistance);
        if (!result.ok) return result;
        pushLog('collect_block', { block: blockName, count, maxDistance, collected: result.collected });
        return { ok: true, action: 'collect_block', block: blockName, count, maxDistance, collected: result.collected };
      } catch (err) {
        return { ok: false, error: `collect_block_error:${err.message}` };
      }
    }

    case 'equip_best_armor': {
      const mgr = bot.armorManager;
      if (!mgr) return { ok: false, error: 'armor_manager_not_loaded' };
      if (typeof mgr.equipAll === 'function') {
        await mgr.equipAll();
      } else if (typeof mgr.equipAllArmor === 'function') {
        await mgr.equipAllArmor();
      } else {
        return { ok: false, error: 'armor_manager_api_unknown' };
      }
      pushLog('equip_best_armor');
      return { ok: true, action: 'equip_best_armor' };
    }

    case 'equip_for_block': {
      const tool = bot.tool;
      if (!tool) return { ok: false, error: 'tool_not_loaded' };
      const pos = coerceVec3(action.x, action.y, action.z);
      if (!pos) return { ok: false, error: 'x,y,z required' };
      const block = bot.blockAt(pos);
      if (!block) return { ok: false, error: 'block_not_found' };
      if (typeof tool.equipForBlock !== 'function') return { ok: false, error: 'tool_api_unknown' };
      await tool.equipForBlock(block, action.opts && typeof action.opts === 'object' ? action.opts : {});
      pushLog('equip_for_block', { block: block.name, position: fmtPos(pos) });
      return { ok: true, action: 'equip_for_block', block: block.name, position: fmtPos(pos) };
    }

    case 'equip_for_entity': {
      const tool = bot.tool;
      if (!tool) return { ok: false, error: 'tool_not_loaded' };
      const targetName = String(action.target || '').trim();
      const target = targetName ? findEntityByName(targetName) : null;
      if (!target) return { ok: false, error: 'target_not_found' };
      if (typeof tool.equipForEntity !== 'function') return { ok: false, error: 'tool_api_unknown' };
      await tool.equipForEntity(target, action.opts && typeof action.opts === 'object' ? action.opts : {});
      pushLog('equip_for_entity', { target: targetName });
      return { ok: true, action: 'equip_for_entity', target: targetName };
    }

    case 'auto_eat_enable': {
      const ae = bot.autoEat;
      if (!ae) return { ok: false, error: 'auto_eat_not_loaded' };
      if (typeof ae.enableAuto === 'function') ae.enableAuto();
      else if (typeof ae.enable === 'function') ae.enable();
      else if (typeof ae.start === 'function') ae.start();
      else return { ok: false, error: 'auto_eat_api_unknown' };
      pushLog('auto_eat_enable');
      return { ok: true, action: 'auto_eat_enable' };
    }

    case 'auto_eat_disable': {
      const ae = bot.autoEat;
      if (!ae) return { ok: false, error: 'auto_eat_not_loaded' };
      if (typeof ae.disableAuto === 'function') ae.disableAuto();
      else if (typeof ae.disable === 'function') ae.disable();
      else if (typeof ae.stop === 'function') ae.stop();
      else return { ok: false, error: 'auto_eat_api_unknown' };
      pushLog('auto_eat_disable');
      return { ok: true, action: 'auto_eat_disable' };
    }

    case 'pvp_attack': {
      const pvp = bot.pvp;
      if (!pvp) return { ok: false, error: 'pvp_not_loaded' };
      const targetName = String(action.target || '').trim();
      const target = targetName ? findEntityByName(targetName) : null;
      if (!target) return { ok: false, error: 'target_not_found' };
      if (typeof pvp.attack !== 'function') return { ok: false, error: 'pvp_api_unknown' };
      pvp.attack(target);
      pushLog('pvp_attack', { target: targetName });
      return { ok: true, action: 'pvp_attack', target: targetName };
    }

    case 'pvp_stop': {
      const pvp = bot.pvp;
      if (!pvp) return { ok: false, error: 'pvp_not_loaded' };
      if (typeof pvp.stop === 'function') pvp.stop();
      else if (typeof pvp.stopAttack === 'function') pvp.stopAttack();
      else return { ok: false, error: 'pvp_api_unknown' };
      pushLog('pvp_stop');
      return { ok: true, action: 'pvp_stop' };
    }

    case 'web_inventory_start': {
      if (webInventoryInfo) {
        return { ok: true, action: 'web_inventory_start', already_running: true, ...webInventoryInfo };
      }
      let port = Number.isFinite(API_PORT) ? API_PORT + 1001 : 0;
      if (action.port != null) port = Number(action.port);
      if (!Number.isFinite(port) || port <= 0) return { ok: false, error: 'invalid port' };

      try {
        // eslint-disable-next-line global-require, import/no-dynamic-require
        const inventoryViewer = require('mineflayer-web-inventory');
        if (typeof inventoryViewer !== 'function') return { ok: false, error: 'web_inventory_api_unknown' };

        inventoryViewer(bot, { port, startOnLoad: false });
        if (!bot.webInventory || typeof bot.webInventory.start !== 'function') {
          return { ok: false, error: 'web_inventory_not_initialized' };
        }
        await bot.webInventory.start();
        // mineflayer-web-inventory does not expose host binding; it's typically localhost.
        webInventoryInfo = { host: '127.0.0.1', port };
        pushLog('web_inventory_start', webInventoryInfo);
        return { ok: true, action: 'web_inventory_start', ...webInventoryInfo };
      } catch (err) {
        return { ok: false, error: `web_inventory_start_error:${err.message}` };
      }
    }

    case 'web_inventory_stop': {
      try {
        if (bot.webInventory && typeof bot.webInventory.stop === 'function') {
          await bot.webInventory.stop();
        }
      } catch (err) {
        pushLog('web_inventory_stop_error', { err: err.message });
      }
      webInventoryInfo = null;
      pushLog('web_inventory_stop');
      return { ok: true, action: 'web_inventory_stop' };
    }

    case 'dashboard_start': {
      if (dashboardInfo) {
        return { ok: true, action: 'dashboard_start', already_running: true, ...dashboardInfo };
      }
      // mineflayer-dashboard is a TUI (terminal UI), not a web server.
      // It requires a real TTY; managed agents run headless, so block by default.
      if (!process.stdout.isTTY) return { ok: false, error: 'dashboard_requires_tty' };

      try {
        // eslint-disable-next-line global-require, import/no-dynamic-require
        const dash = require('mineflayer-dashboard');
        const plugin = dash?.default || dash;
        if (typeof plugin !== 'function') return { ok: false, error: 'dashboard_api_unknown' };

        // Use a fast chatPattern to avoid expensive default parsing where possible.
        bot.loadPlugin(plugin({ chatPattern: /^» \\w+? » / }));
        dashboardInfo = { type: 'tui', enabled: true };
        pushLog('dashboard_start', dashboardInfo);
        return { ok: true, action: 'dashboard_start', ...dashboardInfo };
      } catch (err) {
        return { ok: false, error: `dashboard_start_error:${err.message}` };
      }
    }

    case 'dashboard_stop': {
      return { ok: false, error: 'dashboard_cannot_stop' };
    }

    case 'raw_get': {
      const targetPath = action.path || action.target;
      const resolved = resolvePath(bot, targetPath);
      if (!resolved.ok) return { ok: false, error: resolved.error };
      const value = resolved.obj[resolved.key];
      pushLog('raw_get', { path: resolved.full });
      return { ok: true, action: 'raw_get', path: resolved.full, value: safeDescribe(value) };
    }

    case 'raw_call': {
      const targetPath = action.path || action.target;
      const resolved = resolvePath(bot, targetPath);
      if (!resolved.ok) return { ok: false, error: resolved.error };
      const fn = resolved.obj[resolved.key];
      if (typeof fn !== 'function') return { ok: false, error: 'target_not_callable' };
      const args = Array.isArray(action.args) ? action.args.map(coerceArg) : [];
      pushLog('raw_call', { path: resolved.full, argc: args.length });
      const result = await fn.apply(resolved.obj, args);
      return { ok: true, action: 'raw_call', path: resolved.full, result: safeDescribe(result) };
    }

    default:
      return { ok: false, error: `unknown_action:${type}` };
  }
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  return JSON.parse(body);
}

function writeJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      writeJson(res, 200, { ok: true, service: 'agent-runtime', time: Date.now() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/capabilities') {
      writeJson(res, 200, { ok: true, actions: ACTION_TYPES, plugins: pluginStatus });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/state') {
      writeJson(res, 200, gameState());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/action') {
      const action = await readJson(req);
      const result = await enqueue(() => doAction(action));
      writeJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/task') {
      const task = await readJson(req);
      taskEpoch += 1;
      currentTask = {
        ...task,
        status: 'accepted',
        progress: Number(task.progress || 0),
        started_at: Date.now(),
      };
      pushLog('task', { goal: String(task.goal || 'unknown') });
      if (AUTO_RUN_TASKS) startTaskRunner();
      writeJson(res, 200, { ok: true, task: currentTask });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/task/status') {
      writeJson(res, 200, currentTask || { status: 'idle' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/task/abort') {
      taskEpoch += 1;
      stopControls();
      if (currentTask && currentTask.status === 'running') {
        currentTask.status = 'aborted';
        currentTask.updated_at = Date.now();
      }
      pushLog('task:abort');
      writeJson(res, 200, { ok: true, aborted: true });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/plan') {
      writeJson(res, 200, { ok: true, plan: currentPlan });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/plan') {
      const payload = await readJson(req);
      currentPlan = payload.instructions || '';
      pushLog('plan:update', { chars: String(currentPlan).length });
      writeJson(res, 200, { ok: true, plan: currentPlan });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/message') {
      const payload = await readJson(req);
      const state = gameState();
      const reply = {
        ok: true,
        reply: {
          summary: `health=${state.health} food=${state.food} task=${currentTask?.goal || 'idle'}`,
          state,
          message: payload.message || '',
        },
      };
      pushLog('message', { bytes: JSON.stringify(payload || {}).length });
      writeJson(res, 200, reply);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/logs') {
      const limit = Math.max(1, Number(url.searchParams.get('limit') || 50));
      writeJson(res, 200, { ok: true, logs: activityLog.slice(-limit) });
      return;
    }

    writeJson(res, 404, { ok: false, error: 'not_found' });
  } catch (err) {
    writeJson(res, 400, { ok: false, error: err.message });
  }
});

server.listen(API_PORT, '127.0.0.1', () => {
  pushLog('api:listening', { port: API_PORT });
  // eslint-disable-next-line no-console
  console.log(`[agent-runtime] ${BOT_USERNAME} API on ${API_PORT}`);
});
