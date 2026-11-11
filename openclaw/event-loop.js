#!/usr/bin/env node

/*
  OpenClaw Event-Driven Orchestrator

  Replaces the rigid 30-second bash loop with a smarter Node.js orchestrator
  that connects to SSE feeds, polls agent state, detects changes, and builds
  contextual prompts for each OpenClaw CLI turn.

  Shells out to: node dist/index.js agent --local --agent main -m "..."
*/

const { execSync } = require('node:child_process');
const http = require('node:http');
const https = require('node:https');

// ── Config ─────────────────────────────────────────────────────────

const API_BASE = process.env.CLAWCRAFT_URL || 'http://minecraft.opalbot.gg:3000';
const TEAM_ID = process.env.CLAWCRAFT_TEAM_ID || 'openclaw';
const API_KEY = process.env.CLAWCRAFT_API_KEY || 'clf_bd51ff60a827b94ac1dd82d56585d730';
const AGENT_NAME = process.env.CLAWCRAFT_AGENT_NAME || 'Ace';

const SLEEP_ACTIVE = 5_000;   // 5s when events pending
const SLEEP_IDLE = 15_000;    // 15s normal
const SLEEP_STALE = 30_000;   // 30s when nothing changed in 3+ turns
const STATE_POLL_MS = 10_000; // poll agent state every 10s

// ── State ──────────────────────────────────────────────────────────

const eventQueue = [];
let prevState = null;
let unchangedTurns = 0;
let turnCount = 0;
let goalStandings = null;
let lastStatePoll = 0;

// ── API helpers ────────────────────────────────────────────────────

function apiGet(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.get(url.toString(), { headers: { 'x-api-key': API_KEY } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (_err) { resolve(null); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── SSE feed listener ──────────────────────────────────────────────

function connectSSE(path, label) {
  const url = new URL(path, API_BASE);
  const mod = url.protocol === 'https:' ? https : http;

  function connect() {
    const req = mod.get(url.toString(), { headers: { 'x-api-key': API_KEY, Accept: 'text/event-stream' } }, (res) => {
      if (res.statusCode !== 200) {
        console.log(`[sse:${label}] HTTP ${res.statusCode}, retrying in 10s`);
        setTimeout(connect, 10_000);
        return;
      }
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk;
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data:')) {
            try {
              const data = JSON.parse(line.slice(5).trim());
              eventQueue.push({ source: label, data, time: Date.now() });
            } catch (_err) { /* ignore non-JSON SSE lines */ }
          }
        }
      });
      res.on('end', () => {
        console.log(`[sse:${label}] disconnected, reconnecting in 5s`);
        setTimeout(connect, 5_000);
      });
    });
    req.on('error', () => {
      setTimeout(connect, 10_000);
    });
  }

  connect();
}

// ── State diffing ──────────────────────────────────────────────────

function diffState(prev, curr) {
  const changes = [];
  if (!prev || !curr) return changes;

  // Health change
  if (prev.health !== curr.health) {
    const delta = curr.health - prev.health;
    changes.push(`health ${delta > 0 ? 'recovered' : 'dropped'} ${prev.health} → ${curr.health}`);
  }

  // Death detection
  if (prev.health > 0 && curr.health === 0) {
    changes.push('agent DIED');
  }

  // Food change
  if (prev.food !== curr.food) {
    changes.push(`food ${prev.food} → ${curr.food}`);
  }

  // Dimension change
  if (prev.dimension !== curr.dimension) {
    changes.push(`dimension changed: ${prev.dimension} → ${curr.dimension}`);
  }

  // Inventory count changes (item totals)
  const prevInv = countItems(prev.inventory || []);
  const currInv = countItems(curr.inventory || []);
  for (const [item, count] of Object.entries(currInv)) {
    const prevCount = prevInv[item] || 0;
    if (count > prevCount) {
      changes.push(`collected ${count - prevCount}x ${item} (total: ${count})`);
    }
  }
  for (const [item, count] of Object.entries(prevInv)) {
    if (!currInv[item]) {
      changes.push(`lost all ${count}x ${item}`);
    }
  }

  // Stuck detection (position unchanged)
  if (prev.position && curr.position) {
    const dx = Math.abs((prev.position.x || 0) - (curr.position.x || 0));
    const dy = Math.abs((prev.position.y || 0) - (curr.position.y || 0));
    const dz = Math.abs((prev.position.z || 0) - (curr.position.z || 0));
    if (dx < 2 && dy < 2 && dz < 2) {
      changes.push('agent has NOT moved since last check');
    }
  }

  return changes;
}

function countItems(inventory) {
  const counts = {};
  for (const item of inventory) {
    counts[item.name] = (counts[item.name] || 0) + item.count;
  }
  return counts;
}

// ── Prompt builder ─────────────────────────────────────────────────

function buildPrompt(state, stateChanges, events, standings) {
  const sections = [];

  // Events since last turn
  if (events.length > 0 || stateChanges.length > 0) {
    const lines = ['[EVENTS SINCE LAST TURN]'];
    for (const change of stateChanges) {
      lines.push(`- state: ${change}`);
    }
    for (const evt of events) {
      const d = evt.data;
      const summary = d.event || d.kind || JSON.stringify(d).slice(0, 120);
      lines.push(`- ${evt.source}: ${summary}`);
    }
    sections.push(lines.join('\n'));
  }

  // Current state
  if (state) {
    const pos = state.position ? `(${state.position.x}, ${state.position.y}, ${state.position.z})` : 'unknown';
    const inv = (state.inventory || []).map(i => `${i.count}x ${i.name}`).join(', ') || 'empty';
    const eq = state.equipment
      ? Object.entries(state.equipment).filter(([, v]) => v).map(([k, v]) => `${k}:${v.name}`).join(', ') || 'nothing'
      : 'unknown';
    const task = state.task || state.self_prompting ? `${state.task || 'active'} (self_prompting: ${state.self_prompting})` : 'idle';

    const viewerUrl = state.viewer_url || '';
    const invUrl = state.inventory_url || '';

    sections.push([
      '[CURRENT STATE]',
      `Position: ${pos} | Health: ${state.health}/20 | Food: ${state.food}/20`,
      `Dimension: ${state.dimension || 'overworld'}`,
      `Equipment: ${eq}`,
      `Inventory: ${inv}`,
      `Task: ${task}`,
      viewerUrl ? `Viewer: ${viewerUrl}` : null,
      invUrl ? `Inventory UI: ${invUrl}` : null,
    ].filter(Boolean).join('\n'));
  }

  // Goal standings
  if (standings) {
    const goals = standings.goals || standings;
    const lines = ['[GOAL STANDINGS]'];
    if (Array.isArray(goals)) {
      for (const g of goals) {
        lines.push(`- ${g.name || g.id}: ${g.winner ? `WON by ${g.winner}` : g.status || 'unclaimed'}`);
      }
    } else if (typeof goals === 'object') {
      for (const [key, val] of Object.entries(goals)) {
        const winner = val.winner ? `WON by ${val.winner}` : 'unclaimed';
        lines.push(`- ${key}: ${winner}`);
      }
    }
    sections.push(lines.join('\n'));
  }

  // Instruction
  sections.push(`[INSTRUCTION]\nTurn #${turnCount}. Assess the situation. Act decisively. Use curl to call the ClawCraft API at ${API_BASE}. Your team_id is "${TEAM_ID}", api_key is "${API_KEY}", agent is "${AGENT_NAME}".`);

  return sections.join('\n\n');
}

// ── Shell out to OpenClaw CLI ──────────────────────────────────────

function runOpenClawTurn(prompt) {
  const escaped = prompt.replace(/'/g, "'\\''");
  const cmd = `node dist/index.js agent --local --agent main -m '${escaped}'`;
  console.log(`\n[turn:${turnCount}] Running OpenClaw CLI...`);
  try {
    execSync(cmd, { stdio: 'inherit', timeout: 120_000 });
  } catch (err) {
    console.error(`[turn:${turnCount}] CLI error: ${err.message}`);
  }
}

// ── Main loop ──────────────────────────────────────────────────────

async function main() {
  console.log('[event-loop] Starting OpenClaw event-driven orchestrator');
  console.log(`[event-loop] API: ${API_BASE}, Team: ${TEAM_ID}, Agent: ${AGENT_NAME}`);

  // Connect to SSE feeds
  connectSSE('/goal/feed', 'goal');
  connectSSE(`/teams/${TEAM_ID}/teamchat/feed`, 'teamchat');

  // Initial first-turn prompt
  const firstPrompt = `You are joining ClawCraft. The API is at ${API_BASE} — use curl to interact.

Your team is already registered:
- team_id: ${TEAM_ID}
- api_key: ${API_KEY}

Check if you have an agent named "${AGENT_NAME}" already spawned. If not, spawn one.
Then check goal standings and start working toward the goals. Read your MEMORY.md for strategy.`;

  while (true) {
    turnCount++;

    // Poll agent state
    let state = null;
    let stateChanges = [];
    try {
      state = await apiGet(`/teams/${TEAM_ID}/agents/${AGENT_NAME}/state`);
      if (state && state.ok !== false) {
        stateChanges = diffState(prevState, state);
        prevState = state;
        lastStatePoll = Date.now();
      }
    } catch (_err) {
      // Agent may not exist yet on first turn
    }

    // Poll goal standings
    try {
      goalStandings = await apiGet('/goal');
    } catch (_err) { /* ignore */ }

    // Drain events
    const events = eventQueue.splice(0, eventQueue.length);

    // Build prompt
    let prompt;
    if (turnCount === 1) {
      prompt = firstPrompt;
    } else {
      prompt = buildPrompt(state, stateChanges, events, goalStandings);
    }

    // Run turn
    runOpenClawTurn(prompt);

    // Adaptive sleep
    const hasEvents = events.length > 0 || stateChanges.length > 0;
    if (hasEvents) {
      unchangedTurns = 0;
    } else {
      unchangedTurns++;
    }

    let sleepMs;
    if (eventQueue.length > 0) {
      sleepMs = SLEEP_ACTIVE;
    } else if (unchangedTurns >= 3) {
      sleepMs = SLEEP_STALE;
    } else {
      sleepMs = SLEEP_IDLE;
    }

    console.log(`[event-loop] turn=${turnCount} events=${events.length} changes=${stateChanges.length} unchanged=${unchangedTurns} sleep=${sleepMs / 1000}s`);
    await new Promise((r) => setTimeout(r, sleepMs));
  }
}

main().catch((err) => {
  console.error('[event-loop] Fatal:', err);
  process.exit(1);
});
