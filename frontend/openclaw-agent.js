const path = require('path');
require('dotenv').config({
  path: process.env.DOTENV_PATH || path.resolve(process.cwd(), '.env')
});

const express = require('express');
const mineflayer = require('mineflayer');
const pino = require('pino');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

const MC_HOST = process.env.MC_HOST || '127.0.0.1';
const MC_PORT = Number(process.env.MC_PORT || 25565);
const BOT_USERNAME = process.env.OPENCLAW_AGENT_USERNAME || process.env.BOT_USERNAME || 'OpenClawAgent';
const HEALTH_PORT = Number(process.env.OPENCLAW_AGENT_HEALTH_PORT || 3008);
const COMMAND_PREFIX = process.env.OPENCLAW_COMMAND_PREFIX || '!';
const SAY_ON_SPAWN = process.env.OPENCLAW_AGENT_SAY_ON_SPAWN || 'OpenClaw agent online';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'openclaw-agent',
    username: BOT_USERNAME
  });
});

app.post('/say', (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) {
    return res.status(400).json({ ok: false, reason: 'message is required' });
  }

  if (!bot.entity) {
    return res.status(409).json({ ok: false, reason: 'agent_not_spawned' });
  }

  bot.chat(message);
  return res.json({ ok: true, sent: true });
});

app.get('/status', (_req, res) => {
  res.json({
    username: BOT_USERNAME,
    spawned: !!bot.entity,
    x: bot.entity?.position?.x,
    y: bot.entity?.position?.y,
    z: bot.entity?.position?.z,
    health: bot.health,
    food: bot.food
  });
});

app.listen(HEALTH_PORT, () => {
  log.info({ health_port: HEALTH_PORT }, 'OpenClaw agent health endpoint up');
});

const bot = mineflayer.createBot({
  host: MC_HOST,
  port: MC_PORT,
  username: BOT_USERNAME,
  auth: 'offline',
  version: false
});

bot.on('spawn', () => {
  log.info({ username: BOT_USERNAME, host: MC_HOST, port: MC_PORT }, 'OpenClaw agent connected');

  if (SAY_ON_SPAWN) {
    bot.chat(SAY_ON_SPAWN);
  }
});

bot.on('chat', (username, message) => {
  if (username === bot.username) return;

  const normalized = String(message || '').trim();
  if (!normalized.startsWith(COMMAND_PREFIX)) return;

  const body = normalized.slice(COMMAND_PREFIX.length).trim();

  if (body === 'ping') {
    bot.chat(`pong ${username}`);
    return;
  }

  if (body === 'where') {
    const pos = bot.entity?.position;
    if (pos) {
      bot.chat(`I am at x:${Math.round(pos.x)} y:${Math.round(pos.y)} z:${Math.round(pos.z)}`);
    } else {
      bot.chat('I am not fully spawned yet');
    }
    return;
  }
});

bot.on('error', (err) => {
  log.error({ err: String(err) }, 'OpenClaw agent error');
});

bot.on('kicked', (reason) => {
  log.warn({ reason: String(reason) }, 'OpenClaw agent kicked');
});

bot.on('end', (reason) => {
  log.warn({ reason: String(reason) }, 'OpenClaw agent disconnected');
});
