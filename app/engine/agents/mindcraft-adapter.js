const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');
const { MineflayerAdapter } = require('./mineflayer-adapter');

const MINDCRAFT_INIT_MUTEX = { promise: Promise.resolve() };
let mindcraftModuleCache = null;
let mindcraftInitialized = false;
let socketIoClientFactory = null;

function hasMindcraftSource(mindcraftPath) {
  if (!mindcraftPath) return false;
  const normalized = path.resolve(process.cwd(), mindcraftPath);
  return fs.existsSync(normalized);
}

async function withMindcraftLock(task) {
  const next = MINDCRAFT_INIT_MUTEX.promise.then(task);
  MINDCRAFT_INIT_MUTEX.promise = next.catch(() => {});
  return next;
}

async function loadMindcraftModule(mindcraftPath) {
  if (mindcraftModuleCache) return mindcraftModuleCache;
  const resolvedPath = path.resolve(process.cwd(), mindcraftPath);
  const entry = path.join(resolvedPath, 'src', 'mindcraft', 'mindcraft.js');
  if (!fs.existsSync(entry)) {
    throw new Error(`Mindcraft entrypoint not found at ${entry}`);
  }

  const imported = await import(pathToFileURL(entry).href);
  if (!imported?.createAgent || !imported?.init) {
    throw new Error('Mindcraft module missing required exports');
  }

  mindcraftModuleCache = {
    module: imported,
    root: resolvedPath
  };
  return mindcraftModuleCache;
}

async function loadSocketIoClientFactory(mindcraftRoot) {
  if (socketIoClientFactory) return socketIoClientFactory;

  const req = createRequire(path.join(mindcraftRoot, 'package.json'));
  const moduleId = 'socket.io-client';
  try {
    const socketModule = req(moduleId);
    socketIoClientFactory = socketModule.io || socketModule.default?.io || socketModule;
  } catch (_error) {
    return null;
  }

  return socketIoClientFactory;
}

function buildMindcraftSettings(agent) {
  return {
    profile: {
      name: agent.username,
      model: process.env.MINDCRAFT_MODEL || agent.mindcraftModel || 'openai/gpt-4o-mini'
    },
    host: agent.host,
    port: Number(agent.port),
    auth: agent.auth || 'offline',
    minecraft_version: process.env.MINECRAFT_VERSION || 'auto',
    base_profile: process.env.MINDCRAFT_BASE_PROFILE || 'assistant',
    load_memory: false,
    init_message: `Agent ${agent.username} is ready.`,
    only_chat_with: [],
    speak: false,
    chat_ingame: true,
    chat_bot_messages: true,
    render_bot_view: false,
    task: null
  };
}

class MindcraftAdapter extends MineflayerAdapter {
  constructor(options = {}) {
    super(options);
    this.mindcraftPath = options.mindcraftPath || process.env.MINDCRAFT_PATH;
    this.mindcraftModel = options.mindcraftModel;
    this.preferMindcraft = Boolean(options.preferMindcraft);
    this.mindcraftReady = hasMindcraftSource(this.mindcraftPath);
    this.mindcraftPort = 8080;
    this.mindcraftClient = null;
    this.mindcraftSocket = null;
    this.mindcraftSocketConnected = false;
    this.mindcraftRoot = null;
  }

  async connect() {
    if (!this.preferMindcraft || !this.mindcraftReady) {
      return super.connect();
    }

    try {
      return await withMindcraftLock(async () => {
        const { module, root } = await loadMindcraftModule(this.mindcraftPath);
        this.mindcraftRoot = root;
        const previousCwd = process.cwd();
        process.chdir(root);

        try {
          if (!mindcraftInitialized) {
            await module.init(false, this.mindcraftPort, false);
            mindcraftInitialized = true;
          }

          const settings = buildMindcraftSettings({
            username: this.username,
            host: this.host,
            port: this.port,
            auth: this.auth,
            mindcraftModel: this.mindcraftModel
          });

          const response = await module.createAgent(settings);
          if (!response || response.success !== true) {
            throw new Error(response?.error || 'createAgent did not return success');
          }

          this.mindcraftClient = {
            settings,
            module
          };

          const socketClientFactory = await loadSocketIoClientFactory(root);
          if (socketClientFactory) {
            this.mindcraftSocket = socketClientFactory(`http://127.0.0.1:${this.mindcraftPort}`, {
              transports: ['websocket'],
              timeout: 5000,
              reconnection: false
            });

            await new Promise((resolve) => {
              const timeout = setTimeout(() => {
                this.mindcraftSocketConnected = false;
                resolve();
              }, 4000);
              const onConnect = () => {
                clearTimeout(timeout);
                this.mindcraftSocketConnected = true;
                this.mindcraftSocket.off('connect', onConnect);
                this.mindcraftSocket.off('connect_error', onError);
                resolve();
              };
              const onError = () => {
                clearTimeout(timeout);
                this.mindcraftSocketConnected = false;
                this.mindcraftSocket.off('connect', onConnect);
                this.mindcraftSocket.off('connect_error', onError);
                resolve();
              };

              this.mindcraftSocket.on('connect', onConnect);
              this.mindcraftSocket.on('connect_error', onError);
            });
          }

          this._connected = true;
          return this.mindcraftClient;
        } finally {
          process.chdir(previousCwd);
        }
      });
    } catch (_error) {
      return super.connect();
    }
  }

  async performAction(plan = {}) {
    if (!this.mindcraftClient) {
      return super.performAction(plan);
    }

    const narration = plan.narration || plan.text || `Action ${plan.kind || 'mindcraft'}`;
    if (this.mindcraftSocketConnected && this.mindcraftSocket) {
      this.mindcraftSocket.emit('send-message', this.username, {
        from: 'ADMIN',
        message: narration
      });
      return {
        kind: plan.kind || 'mindcraft',
        success: true,
        notes: 'delegated to mindcraft runtime via socket'
      };
    }

    return {
      kind: plan.kind || 'mindcraft',
      success: true,
      notes: 'delegated to mindcraft runtime'
    };
  }

  async disconnect() {
    if (this.mindcraftClient) {
      const maybe = this.mindcraftClient.module;
      try {
        if (this.mindcraftSocket) {
          this.mindcraftSocket.disconnect();
          this.mindcraftSocket = null;
          this.mindcraftSocketConnected = false;
        }
        maybe?.destroyAgent?.(this.username);
      } catch (_error) {}
      this.mindcraftClient = null;
      this._connected = false;
    }

    return super.disconnect();
  }
}

module.exports = {
  MindcraftAdapter,
  hasMindcraftSource
};
