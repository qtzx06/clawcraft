# Twitch Livestream Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a TV-production-style Twitch streaming pipeline where an auto-director watches 50+ AI Minecraft agents and controls a headless spectator client + OBS to produce an engaging broadcast.

**Architecture:** Director service (Node.js) ingests game events from a mineflayer listener bot, scores them for interest, and controls a headless MC spectator client via RCON and OBS via obs-websocket. A browser-source HUD overlay shows the current agent's stats. Everything runs on a GPU VM in GCP alongside the existing MC server.

**Tech Stack:** Node.js, mineflayer, rcon-client, obs-websocket-js, express, pino, bun (test runner), HTML/CSS/JS (HUD overlay)

**Design doc:** `docs/plans/2026-02-14-twitch-stream-design.md`

---

### Task 1: Test Infrastructure

**Files:**
- Modify: `package.json`

**Step 1: Add test script to package.json**

Add to `scripts`:
```json
"test": "bun test",
"test:spectator": "bun test app/spectator/"
```

**Step 2: Verify bun test runner works**

Run: `bun test --help`
Expected: bun test help output (bun has a built-in test runner)

**Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add bun test runner scripts"
```

---

### Task 2: Interest Scorer — Pure Logic

This is the brain of the director. Pure functions, no I/O, highly testable.

**Files:**
- Create: `app/spectator/scorer.js`
- Create: `app/spectator/scorer.test.js`

**Step 1: Write failing tests for the scorer**

```js
import { describe, test, expect, beforeEach } from 'bun:test';
import { InterestScorer } from './scorer.js';

describe('InterestScorer', () => {
  let scorer;

  beforeEach(() => {
    scorer = new InterestScorer();
  });

  test('death event scores 100', () => {
    scorer.recordEvent({ type: 'death', player: 'AgentAlpha', timestamp: Date.now() });
    const scores = scorer.getScores();
    expect(scores.get('AgentAlpha')).toBe(100);
  });

  test('combat event scores 80', () => {
    scorer.recordEvent({ type: 'combat', player: 'AgentBeta', timestamp: Date.now() });
    const scores = scorer.getScores();
    expect(scores.get('AgentBeta')).toBe(80);
  });

  test('cluster event scores 50', () => {
    scorer.recordEvent({ type: 'cluster', player: 'AgentGamma', timestamp: Date.now() });
    const scores = scorer.getScores();
    expect(scores.get('AgentGamma')).toBe(50);
  });

  test('join event scores 40', () => {
    scorer.recordEvent({ type: 'join', player: 'AgentDelta', timestamp: Date.now() });
    const scores = scorer.getScores();
    expect(scores.get('AgentDelta')).toBe(40);
  });

  test('chat event scores 30', () => {
    scorer.recordEvent({ type: 'chat', player: 'AgentEpsilon', timestamp: Date.now() });
    const scores = scorer.getScores();
    expect(scores.get('AgentEpsilon')).toBe(30);
  });

  test('build event scores 20', () => {
    scorer.recordEvent({ type: 'build', player: 'AgentZeta', timestamp: Date.now() });
    const scores = scorer.getScores();
    expect(scores.get('AgentZeta')).toBe(20);
  });

  test('multiple events for same player stack', () => {
    const now = Date.now();
    scorer.recordEvent({ type: 'chat', player: 'AgentAlpha', timestamp: now });
    scorer.recordEvent({ type: 'combat', player: 'AgentAlpha', timestamp: now });
    const scores = scorer.getScores();
    expect(scores.get('AgentAlpha')).toBe(110);
  });

  test('events decay over time', () => {
    const past = Date.now() - 20_000; // 20s ago
    scorer.recordEvent({ type: 'chat', player: 'AgentAlpha', timestamp: past });
    // chat decays over 10s, so after 20s it should be 0
    const scores = scorer.getScores();
    expect(scores.get('AgentAlpha')).toBe(0);
  });

  test('getTopPlayer returns highest scored player', () => {
    const now = Date.now();
    scorer.recordEvent({ type: 'chat', player: 'AgentAlpha', timestamp: now });
    scorer.recordEvent({ type: 'death', player: 'AgentBeta', timestamp: now });
    expect(scorer.getTopPlayer()).toBe('AgentBeta');
  });

  test('getTopPlayer returns null when no events', () => {
    expect(scorer.getTopPlayer()).toBeNull();
  });

  test('getTopPlayer skips excluded players', () => {
    const now = Date.now();
    scorer.recordEvent({ type: 'death', player: 'AgentAlpha', timestamp: now });
    scorer.recordEvent({ type: 'combat', player: 'AgentBeta', timestamp: now });
    expect(scorer.getTopPlayer({ exclude: ['AgentAlpha'] })).toBe('AgentBeta');
  });

  test('prune removes fully decayed events', () => {
    const old = Date.now() - 120_000; // 2 min ago
    scorer.recordEvent({ type: 'death', player: 'AgentAlpha', timestamp: old });
    scorer.prune();
    const scores = scorer.getScores();
    expect(scores.get('AgentAlpha')).toBe(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test app/spectator/scorer.test.js`
Expected: FAIL — cannot find `./scorer.js`

**Step 3: Implement the scorer**

```js
const EVENT_CONFIG = {
  death:   { score: 100, decayMs: 0 },      // instant, no decay (show immediately)
  combat:  { score: 80,  decayMs: 5_000 },
  cluster: { score: 50,  decayMs: 15_000 },
  join:    { score: 40,  decayMs: 10_000 },
  chat:    { score: 30,  decayMs: 10_000 },
  build:   { score: 20,  decayMs: 30_000 },
};

class InterestScorer {
  constructor() {
    this.events = []; // { type, player, timestamp }
  }

  recordEvent(event) {
    this.events.push(event);
  }

  getScores() {
    const now = Date.now();
    const scores = new Map();

    for (const event of this.events) {
      const config = EVENT_CONFIG[event.type];
      if (!config) continue;

      let value = config.score;
      if (config.decayMs > 0) {
        const age = now - event.timestamp;
        const remaining = Math.max(0, 1 - age / config.decayMs);
        value = Math.round(config.score * remaining);
      } else {
        // instant events: full score if < 5s old, else 0
        const age = now - event.timestamp;
        value = age < 5_000 ? config.score : 0;
      }

      const current = scores.get(event.player) || 0;
      scores.set(event.player, current + value);
    }

    return scores;
  }

  getTopPlayer(opts = {}) {
    const exclude = new Set(opts.exclude || []);
    const scores = this.getScores();
    let best = null;
    let bestScore = 0;

    for (const [player, score] of scores) {
      if (exclude.has(player)) continue;
      if (score > bestScore) {
        best = player;
        bestScore = score;
      }
    }

    return best;
  }

  prune() {
    const now = Date.now();
    const maxAge = 60_000; // prune events older than 60s
    this.events = this.events.filter(e => now - e.timestamp < maxAge);
  }
}

module.exports = { InterestScorer, EVENT_CONFIG };
```

**Step 4: Run tests to verify they pass**

Run: `bun test app/spectator/scorer.test.js`
Expected: All 12 tests PASS

**Step 5: Commit**

```bash
git add app/spectator/scorer.js app/spectator/scorer.test.js
git commit -m "feat(spectator): add interest scorer with event decay"
```

---

### Task 3: Camera Controller — Scheduling Logic

Decides when to switch cameras and enforces dwell time + cooldowns. Depends on the scorer but does not talk to RCON or OBS directly — it emits decisions.

**Files:**
- Create: `app/spectator/camera.js`
- Create: `app/spectator/camera.test.js`

**Step 1: Write failing tests**

```js
import { describe, test, expect, beforeEach } from 'bun:test';
import { CameraController } from './camera.js';
import { InterestScorer } from './scorer.js';

describe('CameraController', () => {
  let scorer;
  let camera;

  beforeEach(() => {
    scorer = new InterestScorer();
    camera = new CameraController(scorer, {
      dwellMs: 100,     // short for tests
      cooldownMs: 200,
      cycleMs: 50,
    });
  });

  test('pick returns top scorer', () => {
    scorer.recordEvent({ type: 'death', player: 'Alpha', timestamp: Date.now() });
    scorer.recordEvent({ type: 'chat', player: 'Beta', timestamp: Date.now() });
    expect(camera.pick()).toBe('Alpha');
  });

  test('pick avoids current target if dwell not elapsed', () => {
    scorer.recordEvent({ type: 'death', player: 'Alpha', timestamp: Date.now() });
    camera.setCurrentTarget('Alpha');
    // Alpha is current, should still return Alpha since it's the only interesting one
    expect(camera.pick()).toBe('Alpha');
  });

  test('pick skips cooldown players when alternatives exist', async () => {
    const now = Date.now();
    scorer.recordEvent({ type: 'death', player: 'Alpha', timestamp: now });
    scorer.recordEvent({ type: 'combat', player: 'Beta', timestamp: now });
    camera.addCooldown('Alpha');
    expect(camera.pick()).toBe('Beta');
  });

  test('pick returns cooldown player if no alternatives', () => {
    scorer.recordEvent({ type: 'death', player: 'Alpha', timestamp: Date.now() });
    camera.addCooldown('Alpha');
    // Only Alpha has events, so return Alpha despite cooldown
    expect(camera.pick()).toBe('Alpha');
  });

  test('shouldSwitch returns false before dwell time', () => {
    camera.setCurrentTarget('Alpha');
    expect(camera.shouldSwitch()).toBe(false);
  });

  test('shouldSwitch returns true after dwell time', async () => {
    camera.setCurrentTarget('Alpha');
    await new Promise(r => setTimeout(r, 150)); // wait > dwellMs
    scorer.recordEvent({ type: 'death', player: 'Beta', timestamp: Date.now() });
    expect(camera.shouldSwitch()).toBe(true);
  });

  test('shouldSwitch returns true immediately for death override', () => {
    camera.setCurrentTarget('Alpha');
    scorer.recordEvent({ type: 'death', player: 'Beta', timestamp: Date.now() });
    expect(camera.shouldSwitch({ forceOnDeath: true })).toBe(true);
  });

  test('human override pins to specific target', () => {
    scorer.recordEvent({ type: 'death', player: 'Alpha', timestamp: Date.now() });
    camera.setOverride('Beta');
    expect(camera.pick()).toBe('Beta');
    expect(camera.isOverridden()).toBe(true);
  });

  test('release override returns to auto', () => {
    camera.setOverride('Beta');
    camera.releaseOverride();
    scorer.recordEvent({ type: 'death', player: 'Alpha', timestamp: Date.now() });
    expect(camera.pick()).toBe('Alpha');
    expect(camera.isOverridden()).toBe(false);
  });

  test('getCurrentTarget returns null initially', () => {
    expect(camera.getCurrentTarget()).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test app/spectator/camera.test.js`
Expected: FAIL — cannot find `./camera.js`

**Step 3: Implement camera controller**

```js
class CameraController {
  constructor(scorer, opts = {}) {
    this.scorer = scorer;
    this.dwellMs = opts.dwellMs ?? 8_000;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
    this.cycleMs = opts.cycleMs ?? 10_000;

    this.currentTarget = null;
    this.targetSetAt = 0;
    this.cooldowns = new Map(); // player -> expiry timestamp
    this.override = null;
  }

  pick() {
    if (this.override) return this.override;

    const cooledDown = [];
    const now = Date.now();
    for (const [player, expiry] of this.cooldowns) {
      if (now < expiry) cooledDown.push(player);
    }

    // Try without cooldown players first
    const best = this.scorer.getTopPlayer({ exclude: cooledDown });
    if (best) return best;

    // Fall back to cooldown players if nothing else
    return this.scorer.getTopPlayer();
  }

  shouldSwitch(opts = {}) {
    const now = Date.now();
    const dwellElapsed = now - this.targetSetAt >= this.dwellMs;

    if (opts.forceOnDeath) {
      const scores = this.scorer.getScores();
      for (const [player, score] of scores) {
        if (player !== this.currentTarget && score >= 100) return true;
      }
    }

    if (!dwellElapsed) return false;

    const next = this.pick();
    return next !== null && next !== this.currentTarget;
  }

  setCurrentTarget(player) {
    this.currentTarget = player;
    this.targetSetAt = Date.now();
  }

  getCurrentTarget() {
    return this.currentTarget;
  }

  addCooldown(player) {
    this.cooldowns.set(player, Date.now() + this.cooldownMs);
  }

  setOverride(player) {
    this.override = player;
  }

  releaseOverride() {
    this.override = null;
  }

  isOverridden() {
    return this.override !== null;
  }
}

module.exports = { CameraController };
```

**Step 4: Run tests to verify they pass**

Run: `bun test app/spectator/camera.test.js`
Expected: All 10 tests PASS

**Step 5: Commit**

```bash
git add app/spectator/camera.js app/spectator/camera.test.js
git commit -m "feat(spectator): add camera controller with cooldowns and human override"
```

---

### Task 4: RCON Client Wrapper

Thin wrapper around `rcon-client` for spectator teleport commands. Minimal logic, mostly integration.

**Files:**
- Create: `app/spectator/rcon.js`
- Create: `app/spectator/rcon.test.js`

**Step 1: Install rcon-client**

Run: `bun add rcon-client`

**Step 2: Write failing tests (mock-based)**

```js
import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { SpectatorRcon } from './rcon.js';

describe('SpectatorRcon', () => {
  let rcon;
  let mockSend;

  beforeEach(() => {
    mockSend = mock(() => Promise.resolve('Teleported SpectatorCam'));
    rcon = new SpectatorRcon({
      send: mockSend,
      spectatorUsername: 'SpectatorCam',
    });
  });

  test('teleportToPlayer sends /tp command', async () => {
    await rcon.teleportToPlayer('AgentAlpha');
    expect(mockSend).toHaveBeenCalledWith('tp SpectatorCam AgentAlpha');
  });

  test('teleportToPosition sends /tp with coords', async () => {
    await rcon.teleportToPosition(100, 80, 200, 45, 0);
    expect(mockSend).toHaveBeenCalledWith('tp SpectatorCam 100 80 200 45 0');
  });

  test('spectatePlayer sends /spectate command', async () => {
    await rcon.spectatePlayer('AgentBeta');
    expect(mockSend).toHaveBeenCalledWith('spectate AgentBeta SpectatorCam');
  });

  test('setSpectatorMode sends /gamemode command', async () => {
    await rcon.setSpectatorMode();
    expect(mockSend).toHaveBeenCalledWith('gamemode spectator SpectatorCam');
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `bun test app/spectator/rcon.test.js`
Expected: FAIL — cannot find `./rcon.js`

**Step 4: Implement RCON wrapper**

```js
class SpectatorRcon {
  constructor(opts) {
    this.send = opts.send;
    this.username = opts.spectatorUsername || 'SpectatorCam';
  }

  async teleportToPlayer(target) {
    return this.send(`tp ${this.username} ${target}`);
  }

  async teleportToPosition(x, y, z, pitch, yaw) {
    return this.send(`tp ${this.username} ${x} ${y} ${z} ${pitch} ${yaw}`);
  }

  async spectatePlayer(target) {
    return this.send(`spectate ${target} ${this.username}`);
  }

  async setSpectatorMode() {
    return this.send(`gamemode spectator ${this.username}`);
  }
}

module.exports = { SpectatorRcon };
```

**Step 5: Run tests to verify they pass**

Run: `bun test app/spectator/rcon.test.js`
Expected: All 4 tests PASS

**Step 6: Commit**

```bash
git add app/spectator/rcon.js app/spectator/rcon.test.js package.json bun.lockb
git commit -m "feat(spectator): add RCON wrapper for spectator camera control"
```

---

### Task 5: OBS Controller Wrapper

Thin wrapper around `obs-websocket-js` for scene switching and transitions.

**Files:**
- Create: `app/spectator/obs.js`
- Create: `app/spectator/obs.test.js`

**Step 1: Install obs-websocket-js**

Run: `bun add obs-websocket-js`

**Step 2: Write failing tests (mock-based)**

```js
import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { ObsController } from './obs.js';

describe('ObsController', () => {
  let obs;
  let mockCall;

  beforeEach(() => {
    mockCall = mock(() => Promise.resolve({}));
    obs = new ObsController({ call: mockCall });
  });

  test('switchScene calls SetCurrentProgramScene', async () => {
    await obs.switchScene('AgentPOV');
    expect(mockCall).toHaveBeenCalledWith('SetCurrentProgramScene', {
      sceneName: 'AgentPOV',
    });
  });

  test('setTransition calls SetCurrentSceneTransition', async () => {
    await obs.setTransition('Fade', 500);
    expect(mockCall).toHaveBeenCalledWith('SetCurrentSceneTransition', {
      transitionName: 'Fade',
    });
    expect(mockCall).toHaveBeenCalledWith('SetCurrentSceneTransitionDuration', {
      transitionDuration: 500,
    });
  });

  test('cutTo switches with Cut transition', async () => {
    await obs.cutTo('Overhead');
    expect(mockCall).toHaveBeenCalledWith('SetCurrentSceneTransition', {
      transitionName: 'Cut',
    });
    expect(mockCall).toHaveBeenCalledWith('SetCurrentProgramScene', {
      sceneName: 'Overhead',
    });
  });

  test('fadeTo switches with Fade transition', async () => {
    await obs.fadeTo('AgentPOV', 500);
    expect(mockCall).toHaveBeenCalledWith('SetCurrentSceneTransition', {
      transitionName: 'Fade',
    });
    expect(mockCall).toHaveBeenCalledWith('SetCurrentSceneTransitionDuration', {
      transitionDuration: 500,
    });
    expect(mockCall).toHaveBeenCalledWith('SetCurrentProgramScene', {
      sceneName: 'AgentPOV',
    });
  });

  test('refreshBrowserSource calls PressInputPropertiesButton', async () => {
    await obs.refreshBrowserSource('HUD');
    expect(mockCall).toHaveBeenCalledWith('PressInputPropertiesButton', {
      inputName: 'HUD',
      propertyName: 'refreshnocache',
    });
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `bun test app/spectator/obs.test.js`
Expected: FAIL — cannot find `./obs.js`

**Step 4: Implement OBS controller**

```js
class ObsController {
  constructor(ws) {
    this.ws = ws;
  }

  async switchScene(sceneName) {
    return this.ws.call('SetCurrentProgramScene', { sceneName });
  }

  async setTransition(transitionName, durationMs) {
    await this.ws.call('SetCurrentSceneTransition', { transitionName });
    if (durationMs != null) {
      await this.ws.call('SetCurrentSceneTransitionDuration', {
        transitionDuration: durationMs,
      });
    }
  }

  async cutTo(sceneName) {
    await this.setTransition('Cut');
    await this.switchScene(sceneName);
  }

  async fadeTo(sceneName, durationMs = 500) {
    await this.setTransition('Fade', durationMs);
    await this.switchScene(sceneName);
  }

  async refreshBrowserSource(inputName) {
    return this.ws.call('PressInputPropertiesButton', {
      inputName,
      propertyName: 'refreshnocache',
    });
  }
}

module.exports = { ObsController };
```

**Step 5: Run tests to verify they pass**

Run: `bun test app/spectator/obs.test.js`
Expected: All 5 tests PASS

**Step 6: Commit**

```bash
git add app/spectator/obs.js app/spectator/obs.test.js package.json bun.lockb
git commit -m "feat(spectator): add OBS websocket controller for scene switching"
```

---

### Task 6: Director Service — Wires Everything Together

The main process that connects scorer, camera, RCON, OBS, and exposes HTTP endpoints + HUD websocket.

**Files:**
- Create: `app/spectator/director.js`

**Step 1: Implement the director service**

This is the integration layer. It wires the pure-logic modules (scorer, camera) to the I/O modules (rcon, obs, mineflayer, express). Key parts:

- Mineflayer listener bot connects to MC server, feeds events to scorer
- Tick loop: every `cycleMs`, checks `camera.shouldSwitch()`, calls RCON + OBS
- Express server for human override endpoints
- Websocket server for HUD updates
- Graceful shutdown

```js
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
```

**Step 2: Add start script to package.json**

Add to `scripts`:
```json
"start:director": "node app/spectator/director.js",
"check:director": "node --check app/spectator/director.js"
```

**Step 3: Verify syntax**

Run: `node --check app/spectator/director.js`
Expected: No output (clean syntax)

**Step 4: Commit**

```bash
git add app/spectator/director.js package.json
git commit -m "feat(spectator): add director service wiring scorer, camera, RCON, OBS"
```

---

### Task 7: HUD Overlay — Browser Source

Static HTML/CSS/JS page that OBS loads as a browser source. Connects to director via websocket.

**Files:**
- Create: `app/spectator/hud/index.html`
- Create: `app/spectator/hud/hud.css`
- Create: `app/spectator/hud/hud.js`

**Step 1: Create the HTML**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=1920, height=1080">
  <title>ClawCraft HUD</title>
  <link rel="stylesheet" href="hud.css">
</head>
<body>
  <div id="hud" class="hud hidden">
    <div class="agent-name" id="agent-name"></div>
    <div class="agent-stats">
      <span class="stat" id="health"></span>
      <span class="stat" id="food"></span>
    </div>
    <div class="agent-pos" id="pos"></div>
    <div class="agent-tagline" id="tagline"></div>
  </div>
  <script src="hud.js"></script>
</body>
</html>
```

**Step 2: Create the CSS**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  width: 1920px;
  height: 1080px;
  overflow: hidden;
  background: transparent;
  font-family: 'Segoe UI', system-ui, sans-serif;
  color: #fff;
}

.hud {
  position: absolute;
  bottom: 40px;
  left: 40px;
  padding: 16px 24px;
  background: rgba(0, 0, 0, 0.65);
  border-left: 4px solid #e94560;
  border-radius: 4px;
  transition: opacity 0.4s ease, transform 0.4s ease;
}

.hud.hidden {
  opacity: 0;
  transform: translateY(20px);
}

.agent-name {
  font-size: 32px;
  font-weight: 700;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}

.agent-stats {
  display: flex;
  gap: 16px;
  font-size: 18px;
  margin-bottom: 4px;
}

.stat::before {
  margin-right: 4px;
}

#health::before { content: '\2764'; }
#food::before { content: '\1F356'; }

.agent-pos {
  font-size: 14px;
  opacity: 0.7;
  font-family: monospace;
}

.agent-tagline {
  font-size: 16px;
  font-style: italic;
  opacity: 0.8;
  margin-top: 6px;
}
```

**Step 3: Create the JS**

```js
(function () {
  const hud = document.getElementById('hud');
  const nameEl = document.getElementById('agent-name');
  const healthEl = document.getElementById('health');
  const foodEl = document.getElementById('food');
  const posEl = document.getElementById('pos');
  const taglineEl = document.getElementById('tagline');

  const wsUrl = `ws://${location.host}/hud/ws`;
  let ws;

  function connect() {
    ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      update(data);
    };

    ws.onclose = () => {
      setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  function update(data) {
    if (!data.agent) {
      hud.classList.add('hidden');
      return;
    }

    nameEl.textContent = data.agent;
    healthEl.textContent = Math.round(data.health);
    foodEl.textContent = Math.round(data.food);
    posEl.textContent = `${data.x} / ${data.y} / ${data.z}`;
    taglineEl.textContent = data.tagline || '';
    taglineEl.style.display = data.tagline ? 'block' : 'none';

    hud.classList.remove('hidden');
  }

  connect();
})();
```

**Step 4: Verify director serves HUD**

Run: `node --check app/spectator/director.js` (should still pass with hud/ static dir)
Expected: No output

**Step 5: Commit**

```bash
git add app/spectator/hud/
git commit -m "feat(spectator): add HUD overlay browser source for OBS"
```

---

### Task 8: Stream Server Infrastructure

Startup script, OBS scene config, MC client settings for the streaming VM.

**Files:**
- Create: `stream-server/gcloud-startup-script.sh`
- Create: `stream-server/obs-scene-collection.json`
- Create: `stream-server/mc-options.txt`

**Step 1: Create the GCP startup script**

```bash
#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

LOG=/var/log/stream-setup.log
exec > >(tee -a "$LOG") 2>&1
echo "=== stream VM startup $(date) ==="

# --- NVIDIA drivers ---
if ! command -v nvidia-smi &>/dev/null; then
  apt-get update -y
  apt-get install -y linux-headers-$(uname -r) build-essential
  curl -fsSL https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.1-1_all.deb -o /tmp/cuda-keyring.deb
  dpkg -i /tmp/cuda-keyring.deb
  apt-get update -y
  apt-get install -y cuda-drivers
  echo "NVIDIA drivers installed, reboot may be needed"
fi

# --- Xvfb ---
apt-get install -y xvfb x11-utils

# --- OBS Studio ---
if ! command -v obs &>/dev/null; then
  add-apt-repository -y ppa:obsproject/obs-studio
  apt-get update -y
  apt-get install -y obs-studio
fi

# --- Java (for Minecraft client via Prism Launcher) ---
apt-get install -y openjdk-21-jre-headless

# --- Prism Launcher ---
if [ ! -f /opt/prismlauncher/PrismLauncher ]; then
  mkdir -p /opt/prismlauncher
  PRISM_URL="https://github.com/PrismLauncher/PrismLauncher/releases/latest/download/PrismLauncher-Linux-x86_64.AppImage"
  curl -fsSL "$PRISM_URL" -o /opt/prismlauncher/PrismLauncher.AppImage
  chmod +x /opt/prismlauncher/PrismLauncher.AppImage
fi

# --- Node.js ---
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# --- FFmpeg ---
apt-get install -y ffmpeg

# --- Clone / pull repo ---
REPO_DIR=/opt/clawcraft
if [ -d "$REPO_DIR/.git" ]; then
  cd "$REPO_DIR" && git pull
else
  git clone https://github.com/openclaw/clawcraft.git "$REPO_DIR"
fi

cd "$REPO_DIR"
npm install --production

echo "=== stream VM startup complete $(date) ==="
```

**Step 2: Create OBS scene collection skeleton**

This is a minimal JSON that can be imported into OBS. Actual source UUIDs get generated on first import — this provides the structure.

```json
{
  "name": "ClawCraft Stream",
  "scenes": [
    {
      "name": "AgentPOV",
      "sources": [
        { "name": "GameCapture", "type": "xcomposite_input" },
        { "name": "HUD", "type": "browser_source", "url": "http://localhost:3009/hud", "width": 1920, "height": 1080 }
      ]
    },
    {
      "name": "Overhead",
      "sources": [
        { "name": "GameCapture", "type": "xcomposite_input" }
      ]
    },
    {
      "name": "PiP",
      "sources": [
        { "name": "GameCapture", "type": "xcomposite_input" },
        { "name": "HUD", "type": "browser_source", "url": "http://localhost:3009/hud", "width": 1920, "height": 1080 }
      ]
    },
    {
      "name": "BRB",
      "sources": [
        { "name": "BRBImage", "type": "image_source" }
      ]
    }
  ],
  "transitions": [
    { "name": "Cut", "type": "cut_transition" },
    { "name": "Fade", "type": "fade_transition", "duration": 500 }
  ],
  "streaming": {
    "service": "Twitch",
    "server": "rtmp://live.twitch.tv/app",
    "key_placeholder": "SET_VIA_ENV"
  },
  "output": {
    "encoder": "nvenc",
    "resolution": "1920x1080",
    "fps": 60,
    "bitrate": 6000
  }
}
```

**Step 3: Create MC client options**

```
version:1.21.4
renderDistance:14
simulationDistance:8
maxFps:60
graphicsMode:1
ao:true
guiScale:2
fov:70.0
gamma:1.0
renderClouds:false
particles:1
```

**Step 4: Commit**

```bash
git add stream-server/
git commit -m "feat(stream-server): add GCP startup script, OBS config, MC settings"
```

---

### Task 9: Docs Updates

Update existing docs and create the streaming VM runbook.

**Files:**
- Modify: `docs/architecture.mermaid` — add streaming layer
- Modify: `docs/non-auth-mc-openclaw-hosting.md` — add SpectatorCam + DirectorEye whitelist entries
- Modify: `package.json` — ensure all new scripts are present
- Create: `stream-server/README.md` — runbook

**Step 1: Update architecture mermaid**

Add a `streaming` subgraph to `docs/architecture.mermaid` containing:
- spectator client
- director service
- OBS
- Twitch output

Connect `mc` -> `streaming` subgraph -> `twitch` (which already exists).

**Step 2: Update hosting docs**

Add to the whitelist section of `docs/non-auth-mc-openclaw-hosting.md`:
- `whitelist add SpectatorCam` — headless spectator client for stream camera
- `whitelist add DirectorEye` — listener bot for event ingestion
- Note: SpectatorCam needs op for `/tp` and `/spectate` commands

**Step 3: Create stream-server README**

Cover:
- What the streaming VM does
- How to create the VM (`gcloud compute instances create ...`)
- How to apply the startup script
- How to start/stop/restart individual services
- How to verify OBS is streaming
- Troubleshooting: Xvfb, NVIDIA drivers, OBS websocket

**Step 4: Commit**

```bash
git add docs/ stream-server/README.md package.json
git commit -m "docs: update architecture, hosting docs, and add stream-server runbook"
```

---

### Task 10: Integration Test — Director Smoke Test

A test that wires scorer + camera + mock RCON + mock OBS and runs a few ticks to verify the director loop logic works end-to-end without real connections.

**Files:**
- Create: `app/spectator/director.test.js`

**Step 1: Write the integration test**

```js
import { describe, test, expect, mock } from 'bun:test';
import { InterestScorer } from './scorer.js';
import { CameraController } from './camera.js';
import { SpectatorRcon } from './rcon.js';
import { ObsController } from './obs.js';

describe('Director integration', () => {
  test('full tick cycle: event -> score -> pick -> rcon + obs', async () => {
    const scorer = new InterestScorer();
    const camera = new CameraController(scorer, {
      dwellMs: 0,
      cooldownMs: 100,
      cycleMs: 50,
    });

    const rconSend = mock(() => Promise.resolve('ok'));
    const rcon = new SpectatorRcon({ send: rconSend, spectatorUsername: 'SpectatorCam' });

    const obsCall = mock(() => Promise.resolve({}));
    const obs = new ObsController({ call: obsCall });

    // Simulate events
    scorer.recordEvent({ type: 'death', player: 'AgentAlpha', timestamp: Date.now() });
    scorer.recordEvent({ type: 'chat', player: 'AgentBeta', timestamp: Date.now() });

    // Director tick
    const next = camera.pick();
    expect(next).toBe('AgentAlpha');

    camera.setCurrentTarget(next);
    await rcon.spectatePlayer(next);
    await obs.cutTo('AgentPOV');

    expect(rconSend).toHaveBeenCalledWith('spectate AgentAlpha SpectatorCam');
    expect(obsCall).toHaveBeenCalledWith('SetCurrentProgramScene', { sceneName: 'AgentPOV' });

    // Second tick: Alpha on cooldown, should pick Beta
    camera.addCooldown('AgentAlpha');
    scorer.recordEvent({ type: 'combat', player: 'AgentBeta', timestamp: Date.now() });
    const next2 = camera.pick();
    expect(next2).toBe('AgentBeta');
  });
});
```

**Step 2: Run all tests**

Run: `bun test app/spectator/`
Expected: All tests pass (scorer: 12, camera: 10, rcon: 4, obs: 5, integration: 1 = 32 total)

**Step 3: Commit**

```bash
git add app/spectator/director.test.js
git commit -m "test(spectator): add director integration smoke test"
```

---

## Summary

| Task | What | Files |
|---|---|---|
| 1 | Test infrastructure | `package.json` |
| 2 | Interest scorer | `scorer.js`, `scorer.test.js` |
| 3 | Camera controller | `camera.js`, `camera.test.js` |
| 4 | RCON wrapper | `rcon.js`, `rcon.test.js` |
| 5 | OBS controller | `obs.js`, `obs.test.js` |
| 6 | Director service | `director.js` |
| 7 | HUD overlay | `hud/index.html`, `hud.css`, `hud.js` |
| 8 | Stream server infra | `stream-server/*` |
| 9 | Docs updates | `docs/*`, `stream-server/README.md` |
| 10 | Integration test | `director.test.js` |

Dependencies: Task 3 depends on 2. Task 6 depends on 2-5. Everything else is independent.
