const fs = require('fs');
const path = require('path');
const { MineflayerAdapter } = require('./mineflayer-adapter');

function hasMindcraftSource(mindcraftPath) {
  if (!mindcraftPath) return false;
  const normalized = path.resolve(process.cwd(), mindcraftPath);
  return fs.existsSync(normalized);
}

class MindcraftAdapter extends MineflayerAdapter {
  constructor(options = {}) {
    super(options);
    this.mindcraftPath = options.mindcraftPath || process.env.MINDCRAFT_PATH;
    this.preferMindcraft = Boolean(options.preferMindcraft);
    this.mindcraftReady = hasMindcraftSource(this.mindcraftPath);
  }

  async connect() {
    if (!this.preferMindcraft || !this.mindcraftReady) {
      return super.connect();
    }

    try {
      const modulePath = path.resolve(process.cwd(), this.mindcraftPath);
      const maybe = require(modulePath);
      if (typeof maybe?.createAgent === 'function') {
        this.mindcraftAgent = maybe.createAgent({
          host: this.host,
          port: this.port,
          username: this.username,
          auth: this.auth
        });
        this._connected = true;
        return this.mindcraftAgent;
      }
    } catch (_error) {
      // fall through to Mineflayer fallback
    }

    return super.connect();
  }
}

module.exports = {
  MindcraftAdapter,
  hasMindcraftSource
};
