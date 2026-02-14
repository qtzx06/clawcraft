const mineflayer = require('mineflayer');
const { setTimeout: wait } = require('timers/promises');

class MineflayerAdapter {
  constructor({ username, host = '127.0.0.1', port = 25565, auth = 'offline', logger = console, version = false } = {}) {
    this.username = username;
    this.host = host;
    this.port = port;
    this.auth = auth;
    this.version = version;
    this.logger = logger;
    this.bot = null;
    this._connected = false;
  }

  async connect() {
    if (this.bot && this._connected) return this.bot;
    if (this.bot && !this._connected) {
      throw new Error('bot connecting already');
    }

    const bot = mineflayer.createBot({
      host: this.host,
      port: this.port,
      username: this.username,
      auth: this.auth,
      version: this.version
    });
    this.bot = bot;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('bot connect timeout'));
      }, 15000);

      const cleanup = () => {
        clearTimeout(timeout);
        bot.off('spawn', onSpawn);
        bot.off('error', onError);
        bot.off('end', onEnd);
      };

      const onSpawn = async () => {
        this._connected = true;
        bot.chat(`/say ${this.username} entered the arena`);
        this._bindEvents(bot);
        cleanup();
        resolve(bot);
      };

      const onError = (error) => {
        cleanup();
        this.logger?.error ? this.logger.error({ error }, 'bot error') : console.error(error);
        reject(error);
      };

      const onEnd = (reason) => {
        this._connected = false;
        this.logger?.warn ? this.logger.warn({ reason }, 'bot end') : console.warn(reason);
      };

      bot.once('spawn', onSpawn);
      bot.once('error', onError);
      bot.once('end', onEnd);
    });
  }

  _bindEvents(bot) {
    bot.on('kicked', (reason) => this.logger?.warn?.({ reason }, 'bot kicked'));
    bot.on('error', (error) => this.logger?.error?.({ error }, 'bot runtime error'));
    bot.on('chat', (username, message) => {
      if (username === bot.username) return;
      this.logger?.info?.({ username, message }, 'chat observed');
    });
    bot.on('health', () => {
      this.lastHealth = bot.health;
    });
    bot.on('entitySpawn', (entity) => {
      this.lastEntities = (this.lastEntities || 0) + 1;
    });
    bot.on('entityGone', () => {
      this.lastEntities = Math.max(0, (this.lastEntities || 0) - 1);
    });
  }

  getState() {
    if (!this.bot || !this.bot.entity) {
      return {
        connected: this._connected,
        health: this.bot?.health || 0,
        food: this.bot?.food || 0,
        nearby_entities: this.lastEntities || 0
      };
    }

    return {
      connected: true,
      position: this.bot.entity.position,
      yaw: this.bot.entity.yaw,
      pitch: this.bot.entity.pitch,
      health: this.bot.health,
      food: this.bot.food,
      nearby_entities: this.lastEntities || 0,
      inventory_size: this.bot.inventory?.items()?.length || 0
    };
  }

  async chat(text = '') {
    if (!this.bot) return false;
    const safeText = String(text || '').slice(0, 150);
    if (!safeText) return false;
    this.bot.chat(safeText);
    return true;
  }

  async performAction(plan = {}) {
    const kind = String(plan.kind || 'chat').toLowerCase();
    const details = plan.details || {};

    try {
      if (!this.bot || !this.bot.entity) {
        return {
          kind,
          success: false,
          reason: 'not_connected',
          notes: 'bot not connected'
        };
      }

      if (kind === 'chat') {
        await this.chat(plan.narration || details.text || `${this.username} is taking a small action.`);
        return { kind, success: true, notes: 'spoken' };
      }

      if (kind === 'mine') {
        return await this._mine(details);
      }

      if (kind === 'build') {
        await this.chat(`${this.username} is building for the mission.`);
        await this._briefWander(1800);
        return { kind, success: true, notes: 'build attempt complete' };
      }

      if (kind === 'craft') {
        await this.chat(`${this.username} is crafting with available materials.`);
        await this._briefWander(1200);
        return { kind, success: true, notes: 'craft attempt complete' };
      }

      if (kind === 'fight') {
        const nearby = Object.values(this.bot.entities || {})
          .find((entity) => entity.type === 'mob' || entity.type === 'player');
        if (nearby) {
          await this.bot.lookAt(nearby.position, true);
          await this.bot.attack(nearby);
          await wait(900);
          return { kind, success: true, notes: 'fighting attempt completed' };
        }
        return { kind, success: false, notes: 'no target found' };
      }

      if (kind === 'eat') {
        const food = this.bot.inventory
          .items()
          .find((item) => String(item.name || '').includes('apple') || String(item.name || '').includes('bread') || String(item.name || '').includes('steak'));
        if (!food) {
          await this.chat(`${this.username} is looking for food.`);
          return { kind, success: false, notes: 'no food in quick inventory scan' };
        }
        await this.bot.equip(food, 'hand');
        await wait(500);
        await this.bot.consume();
        return { kind, success: true, notes: `consumed ${food.name}` };
      }

      if (kind === 'explore' || kind === 'idle') {
        await this._briefWander(2000);
        return { kind, success: true, notes: 'explored local area' };
      }

      await this.chat(`${this.username} is idle.`);
      return { kind: 'idle', success: true, notes: 'fallback idle' };
    } catch (error) {
      this.logger?.warn?.({ error }, 'action failed');
      return {
        kind,
        success: false,
        notes: String(error.message || error),
        reason: 'execution_error'
      };
    }
  }

  async _mine(details = {}) {
    const targetName = String(details.target || 'stone').toLowerCase();
    const block = this.bot.findBlock?.({
      matching: (block) => Boolean(block && String(block.name).includes(targetName)),
      maxDistance: 8
    });

    if (!block) {
      await this.chat(`No ${targetName} visible nearby, moving and retrying.`);
      await this._briefWander(1000);
      return { kind: 'mine', success: false, notes: `no ${targetName} nearby` };
    }

    await this.bot.lookAt(block.position, true);
    await wait(250);
    try {
      await this.bot.dig(block);
    } catch (_error) {
      await this.chat('Dig failed, adjusting position.');
      await this._briefWander(600);
      return { kind: 'mine', success: false, notes: 'dig failed' };
    }

    return { kind: 'mine', success: true, notes: `mined ${block.name || targetName}` };
  }

  async _briefWander(durationMs = 800) {
    if (!this.bot || !this.bot.entity) return;
    this.bot.setControlState('forward', true);
    await wait(durationMs);
    this.bot.setControlState('forward', false);
  }

  async disconnect() {
    if (!this.bot) return;
    await this.bot.end();
    this.bot = null;
    this._connected = false;
  }
}

module.exports = {
  MineflayerAdapter
};
