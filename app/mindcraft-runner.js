const fs = require('node:fs');
const path = require('node:path');

function resolveExisting(paths) {
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function resolveMindcraftEntrypoint() {
  const cwd = process.cwd();
  const explicit = process.env.MINDCRAFT_ENTRYPOINT;

  if (explicit) {
    const absolute = path.isAbsolute(explicit) ? explicit : path.resolve(cwd, explicit);
    if (fs.existsSync(absolute)) {
      return { path: absolute, source: 'env' };
    }
    return {
      path: null,
      source: 'env',
      error: `MINDCRAFT_ENTRYPOINT not found: ${absolute}`,
    };
  }

  const candidates = [
    path.resolve(cwd, 'vendor/mindcraft/agent.js'),
    path.resolve(cwd, 'vendor/mindcraft/src/agent.js'),
    path.resolve(cwd, 'vendor/mindcraft/index.js'),
    path.resolve(cwd, 'skills/clawcraft/agent.js'),
    path.resolve(cwd, 'app/agent-bridge.js'),
  ];

  const entry = resolveExisting(candidates);
  if (!entry) {
    return {
      path: null,
      source: 'auto',
      error: 'No Mindcraft entrypoint found. Set MINDCRAFT_ENTRYPOINT or add vendor/mindcraft.',
    };
  }

  return {
    path: entry,
    source: entry.includes('/vendor/mindcraft/') ? 'vendor' : 'fallback',
  };
}

module.exports = { resolveMindcraftEntrypoint };
