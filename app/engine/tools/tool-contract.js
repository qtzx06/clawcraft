const LOCAL_TOOL_ACTIONS = Object.freeze([
  'mine',
  'build',
  'craft',
  'fight',
  'eat',
  'chat',
  'explore'
]);

const TWITCH_TOOL_ACTIONS = Object.freeze([
  'twitch.start_stream',
  'twitch.stop_stream',
  'twitch.set_title',
  'twitch.set_game',
  'twitch.post_chat_message',
  'twitch.create_clip'
]);

const TOOL_ACTIONS = Object.freeze([...LOCAL_TOOL_ACTIONS, ...TWITCH_TOOL_ACTIONS]);
const REMOTE_TOOL_ACTIONS = Object.freeze(TWITCH_TOOL_ACTIONS);
const ASYNC_TOOL_ACTIONS = Object.freeze([
  'twitch.start_stream',
  'twitch.stop_stream'
]);

const TWITCH_TOOL_SCHEMAS = Object.freeze({
  'twitch.start_stream': {
    required: ['channel'],
    allow: ['channel', 'title', 'game', 'quality'],
    fields: {
      channel: { type: 'string', minLength: 1, maxLength: 64 },
      title: { type: 'string', minLength: 0, maxLength: 160 },
      game: { type: 'string', minLength: 0, maxLength: 120 },
      quality: { type: 'string', enum: ['low', 'medium', 'high', 'source'] }
    }
  },
  'twitch.stop_stream': {
    required: [],
    allow: ['reason'],
    fields: {
      reason: { type: 'string', minLength: 0, maxLength: 220 }
    }
  },
  'twitch.set_title': {
    required: ['title'],
    allow: ['title'],
    fields: {
      title: { type: 'string', minLength: 1, maxLength: 140 }
    }
  },
  'twitch.set_game': {
    required: ['game'],
    allow: ['game'],
    fields: {
      game: { type: 'string', minLength: 1, maxLength: 100 }
    }
  },
  'twitch.post_chat_message': {
    required: ['message'],
    allow: ['message'],
    fields: {
      message: { type: 'string', minLength: 1, maxLength: 250 }
    }
  },
  'twitch.create_clip': {
    required: [],
    allow: ['title'],
    fields: {
      title: { type: 'string', minLength: 0, maxLength: 100 }
    }
  }
});

function normalizeToolKind(raw) {
  return String(raw || '').toLowerCase().trim();
}

function isLocalToolAction(rawKind) {
  return LOCAL_TOOL_ACTIONS.includes(normalizeToolKind(rawKind));
}

function isRemoteToolAction(rawKind) {
  return REMOTE_TOOL_ACTIONS.includes(normalizeToolKind(rawKind));
}

function isKnownToolAction(rawKind) {
  return TOOL_ACTIONS.includes(normalizeToolKind(rawKind));
}

function isAsyncToolAction(rawKind) {
  return ASYNC_TOOL_ACTIONS.includes(normalizeToolKind(rawKind));
}

function getSchema(rawKind) {
  return TWITCH_TOOL_SCHEMAS[normalizeToolKind(rawKind)] || null;
}

function normalizeToolPolicy(raw = {}) {
  const allowed = Array.isArray(raw.allowed_tools) ? raw.allowed_tools : [];
  const denied = Array.isArray(raw.denied_tools) ? raw.denied_tools : [];
  const normalizedAllowed = allowed
    .map((v) => normalizeToolKind(v))
    .filter((v) => TOOL_ACTIONS.includes(v));
  const normalizedDenied = denied
    .map((v) => normalizeToolKind(v))
    .filter((v) => TOOL_ACTIONS.includes(v));

  const computedAllowed = normalizedAllowed.length > 0
    ? normalizedAllowed.filter((kind) => !normalizedDenied.includes(kind))
    : TOOL_ACTIONS.filter((kind) => !normalizedDenied.includes(kind));

  const safeAllowed = computedAllowed.length > 0 ? computedAllowed : ['chat'];
  return {
    allowed_tools: safeAllowed,
    denied_tools: normalizedDenied.filter((kind) => !normalizedAllowed.includes(kind)),
    constraints: Array.isArray(raw.constraints) ? raw.constraints : []
  };
}

function safeFallbackKind(allowed = []) {
  const safe = Array.isArray(allowed) && allowed.length > 0 ? allowed : TOOL_ACTIONS;
  return safe.includes('chat') ? 'chat' : safe[0];
}

module.exports = {
  LOCAL_TOOL_ACTIONS,
  REMOTE_TOOL_ACTIONS,
  TOOL_ACTIONS,
  ASYNC_TOOL_ACTIONS,
  TWITCH_TOOL_ACTIONS,
  TWITCH_TOOL_SCHEMAS,
  normalizeToolKind,
  normalizeToolPolicy,
  safeFallbackKind,
  isLocalToolAction,
  isRemoteToolAction,
  isKnownToolAction,
  isAsyncToolAction,
  getSchema
};
