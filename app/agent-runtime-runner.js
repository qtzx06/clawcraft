const fs = require('node:fs');
const path = require('node:path');

function resolveExisting(paths) {
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function resolveAgentEntrypoint() {
  const cwd = process.cwd();

  // New name (preferred). Old name is accepted for backwards compatibility.
  const explicit =
    process.env.AGENT_ENTRYPOINT ||
    process.env.MINDCRAFT_ENTRYPOINT || // legacy compat
    process.env.BOT_ENTRYPOINT;

  if (explicit) {
    const absolute = path.isAbsolute(explicit) ? explicit : path.resolve(cwd, explicit);
    if (fs.existsSync(absolute)) {
      return { path: absolute, source: 'env' };
    }
    return {
      path: null,
      source: 'env',
      error: `Agent entrypoint not found: ${absolute}`,
    };
  }

  const candidates = [
    path.resolve(cwd, 'vendor/mindcraft/clawcraft-entry.js'),   // Mindcraft LLM brain (preferred)
    path.resolve(cwd, 'vendor/agent-runtime/agent.js'),          // dumb command executor (fallback)
    path.resolve(cwd, 'vendor/agent-runtime/src/agent.js'),
    path.resolve(cwd, 'vendor/agent-runtime/index.js'),
    path.resolve(cwd, 'skills/clawcraft/agent.js'),
    path.resolve(cwd, 'app/agent-bridge.js'),
  ];

  const entry = resolveExisting(candidates);
  if (!entry) {
    return {
      path: null,
      source: 'auto',
      error: 'No agent runtime entrypoint found. Set AGENT_ENTRYPOINT or add vendor/agent-runtime.',
    };
  }

  return {
    path: entry,
    source: entry.includes('/vendor/agent-runtime/') ? 'vendor' : 'fallback',
  };
}

module.exports = { resolveAgentEntrypoint };

