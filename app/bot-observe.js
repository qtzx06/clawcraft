const path = require('path');
require('dotenv').config({
  path: process.env.DOTENV_PATH || path.resolve(process.cwd(), '.env')
});

const mineflayer = require('mineflayer');
const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
const express = require('express');
const client = require('prom-client');
const pino = require('pino');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

const MC_HOST = process.env.MC_HOST || '127.0.0.1';
const MC_PORT = Number(process.env.MC_PORT || 25565);
const BOT_USERNAME = process.env.BOT_USERNAME || 'ScoutBot';
const VIEWER_PORT = Number(process.env.VIEWER_PORT || 3007);
const METRICS_PORT = Number(process.env.METRICS_PORT || 9464);

client.collectDefaultMetrics();

const online = new client.Gauge({
  name: 'mc_bot_online',
  help: '1 when connected to Minecraft server'
});

const health = new client.Gauge({
  name: 'mc_bot_health',
  help: 'Current health value for bot'
});

const food = new client.Gauge({
  name: 'mc_bot_food',
  help: 'Current hunger value for bot'
});

const kicks = new client.Counter({
  name: 'mc_bot_kicks_total',
  help: 'Total number of kick events'
});

const errors = new client.Counter({
  name: 'mc_bot_errors_total',
  help: 'Total number of error events'
});

const chats = new client.Counter({
  name: 'mc_bot_chat_messages_total',
  help: 'Total chat messages observed from other users'
});

const app = express();

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

app.listen(METRICS_PORT, () => {
  log.info({ metrics_port: METRICS_PORT }, 'Metrics endpoint up');
});

const bot = mineflayer.createBot({
  host: MC_HOST,
  port: MC_PORT,
  username: BOT_USERNAME,
  auth: 'offline',
  version: false
});

bot.once('spawn', () => {
  online.set(1);
  mineflayerViewer(bot, {
    port: VIEWER_PORT,
    firstPerson: true,
    viewDistance: 6
  });
  log.info({ viewer_port: VIEWER_PORT }, 'POV viewer up');

  bot.setControlState('forward', true);
});

bot.on('health', () => {
  health.set(bot.health);
  food.set(bot.food);
});

bot.on('chat', (username, message) => {
  if (username !== bot.username) {
    chats.inc();
  }
  log.info({ username, message }, 'Chat observed');
});

bot.on('playerJoined', (player) => {
  log.info({ player: player.username }, 'Player joined');
});

bot.on('playerLeft', (player) => {
  log.info({ player: player.username }, 'Player left');
});

bot.on('kicked', (reason) => {
  kicks.inc();
  online.set(0);
  log.warn({ reason }, 'Bot kicked');
});

bot.on('error', (err) => {
  errors.inc();
  log.error({ err: String(err) }, 'Bot error');
});

bot.on('end', (reason) => {
  online.set(0);
  log.warn({ reason }, 'Bot disconnected');
});
