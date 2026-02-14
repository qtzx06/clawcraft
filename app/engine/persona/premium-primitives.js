function clamp(value, min, max) {
  if (typeof value !== 'number' || Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

const ARCHETYPE_PRESETS = {
  builder: {
    pitch: 1.04,
    speed: 0.94,
    accent: 'calm'
  },
  fighter: {
    pitch: 0.82,
    speed: 1.12,
    accent: 'gritty'
  },
  explorer: {
    pitch: 1.0,
    speed: 1.02,
    accent: 'bright'
  },
  philosopher: {
    pitch: 0.97,
    speed: 0.96,
    accent: 'measured'
  },
  speedrunner: {
    pitch: 1.08,
    speed: 1.18,
    accent: 'urgent'
  }
};

const TONE_PRESETS = {
  bold: { pitch: +0.08, speed: +0.03 },
  optimistic: { pitch: +0.04, speed: +0.02 },
  reflective: { pitch: -0.03, speed: -0.06 },
  playful: { speed: +0.05 },
  aggressive: { pitch: +0.06, speed: +0.08 },
  calm: { pitch: -0.02, speed: -0.05 },
  dramatic: { pitch: +0.09, speed: +0.02 },
  energetic: { speed: +0.1 }
};

function profileToKey(profile = {}, key, fallback = '') {
  const raw = String(profile[key] || profile[key.toLowerCase()] || profile.title || fallback || '').toLowerCase();
  const first = raw.split('\n')[0].trim();
  return first.split(/[^a-z]/i).filter(Boolean).shift() || fallback.toLowerCase();
}

function buildVoiceParams(profile = {}) {
  const archetypeKey = profileToKey(profile, 'archetype', 'builder');
  const toneKey = profileToKey(profile, 'tone', '');

  const preset = ARCHETYPE_PRESETS[archetypeKey] || ARCHETYPE_PRESETS.builder;
  const tone = TONE_PRESETS[toneKey] || TONE_PRESETS[profile.tone?.toLowerCase()] || {};

  return {
    pitch: clamp(preset.pitch + (tone.pitch || 0), 0.75, 1.35),
    speed: clamp(preset.speed + (tone.speed || 0), 0.8, 1.4),
    accent: preset.accent,
    vocal_style: profileToKey(profile, 'tone', 'steady') || 'steady',
    prohibited_terms: profile.behavior_constraints || []
  };
}

function buildAvatarPrompt(profile = {}) {
  const base = `Minecraft-compatible avatar for ${profile.name || 'an agent'}.
Tone-driven persona: ${profile.tone || 'steady'}.
Archetype: ${profile.archetype || 'Builder'}.`;

  const styleBits = profile.visual_aesthetic && profile.visual_aesthetic.length > 0
    ? profile.visual_aesthetic.join(', ')
    : 'minimal utility armor and clean geometric textures';

  const values = profile.values && profile.values.length > 0
    ? profile.values.join(', ')
    : 'cooperative mining, structure, and expressive motion';

  return `${base}
Visual traits: ${styleBits}.
Personality cues: ${values}.
Render as a stylized cube-body figure in a game-consistent palette.`;
}

function buildNarrationSeed(profile = {}, gameState = {}, action = {}) {
  const actor = profile.name || 'agent';
  const goal = gameState.collective_goal || 'the shared village build';
  const actionText = action && action.text ? String(action.text) : `working on ${action.kind || 'an assigned mission'}`;
  return `${actor} is narrating in-character.
Current goal: ${goal}.
Latest intent: ${actionText}.
Tone style: ${profile.tone || 'steady'} with ${profile.archetype || 'builder'} restraint.
`;
}

module.exports = {
  clamp,
  profileToKey,
  buildVoiceParams,
  buildAvatarPrompt,
  buildNarrationSeed
};
