const { buildAvatarPrompt, buildNarrationSeed, buildVoiceParams, clamp } = require('../persona/premium-primitives');
const { OpenAICompatibleClient } = require('./openai-compatible-client');

const MAX_NARRATION_TEXT = 360;

function asString(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function asStringArray(raw = []) {
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function sanitizeProfileForPrompt(profile = {}) {
  return {
    name: profile.name || 'agent',
    archetype: profile.archetype || 'Builder',
    tone: profile.tone || 'steady',
    values: asStringArray(profile.values || []),
    visual_aesthetic: asStringArray(profile.visual_aesthetic || []),
    behavior_constraints: asStringArray(profile.behavior_constraints || []),
    speech_patterns: asStringArray(profile.speech_patterns || [])
  };
}

function sanitizeVoiceResult(raw = {}, fallback = {}) {
  const next = {
    pitch: clamp(Number(raw.pitch), 0.75, 1.35),
    speed: clamp(Number(raw.speed), 0.8, 1.4),
    accent: asString(raw.accent, fallback.accent || 'neutral'),
    vocal_style: asString(raw.vocal_style, fallback.vocal_style || 'steady'),
    prohibited_terms: asStringArray(raw.prohibited_terms || fallback.prohibited_terms || [])
  };

  return {
    pitch: Number.isFinite(next.pitch) ? next.pitch : fallback.pitch,
    speed: Number.isFinite(next.speed) ? next.speed : fallback.speed,
    accent: next.accent,
    vocal_style: next.vocal_style,
    prohibited_terms: next.prohibited_terms.length > 0 ? next.prohibited_terms : fallback.prohibited_terms
  };
}

function sanitizeAvatarPrompt(raw = {}, fallback = '') {
  const prompt = asString(raw.avatarPrompt, asString(raw.prompt, asString(raw.description, fallback)));
  return prompt || fallback;
}

function sanitizeNarration(raw = {}, fallback = '') {
  const text = asString(raw.text, asString(raw.narration, asString(raw.seed, fallback)));
  return {
    text: text.slice(0, MAX_NARRATION_TEXT),
    in_character: raw.in_character === undefined ? true : Boolean(raw.in_character)
  };
}

class PremiumPersonaLLMClient extends OpenAICompatibleClient {
  constructor(config = {}) {
    super(config);
    this._useRemote = config.useRemote !== false;
  }

  async _runWithFallback(prompt, fallback, parser) {
    if (!this._useRemote || !this.apiKey) {
      return fallback();
    }

    try {
      const raw = await this._callRemote(prompt);
      if (!raw || typeof raw !== 'object') {
        return fallback();
      }
      const parsed = parser ? parser(raw) : raw;
      return parsed;
    } catch (_error) {
      return fallback();
    }
  }

  async generateVoice(profile = {}) {
    const fallback = buildVoiceParams(profile);
    const prompt = [
      {
        role: 'system',
        content:
          'You are a premium persona extraction engine for ClawCraft. ' +
          'Return strict JSON: { "pitch": number, "speed": number, "accent": "string", "vocal_style": "string", "prohibited_terms": ["..."] }'
      },
      {
        role: 'user',
        content: JSON.stringify({
          profile: sanitizeProfileForPrompt(profile),
          schema: {
            pitchRange: [0.75, 1.35],
            speedRange: [0.8, 1.4],
            example: fallback
          },
          constraints: sanitizeProfileForPrompt(profile).behavior_constraints
        })
      }
    ];

    return this._runWithFallback(prompt, () => fallback, (raw) => sanitizeVoiceResult(raw, fallback));
  }

  async generateAvatar(profile = {}) {
    const fallback = buildAvatarPrompt(profile);
    const prompt = [
      {
        role: 'system',
        content:
          'You are a visual prompt architect for ClawCraft avatars. ' +
          'Return strict JSON: { "avatarPrompt": "string", "notes": "optional" }'
      },
      {
        role: 'user',
        content: JSON.stringify({
          profile: sanitizeProfileForPrompt(profile),
          fallback,
          constraints: sanitizeProfileForPrompt(profile).behavior_constraints
        })
      }
    ];

    return this._runWithFallback(prompt, () => fallback, (raw) => sanitizeAvatarPrompt(raw, fallback));
  }

  async generateNarration(profile = {}, gameState = {}, action = {}, mission = {}) {
    const fallback = buildNarrationSeed(profile, gameState, {
      kind: action?.kind,
      text: action?.text || action?.narration || ''
    });

    const prompt = [
      {
        role: 'system',
        content:
          'You are a Minecraft in-character narration writer. ' +
          'Return strict JSON: { "text": "string", "in_character": true, "mood": "string" }. ' +
          `Keep text to <= ${MAX_NARRATION_TEXT} chars.`
      },
      {
        role: 'user',
        content: JSON.stringify({
          profile: sanitizeProfileForPrompt(profile),
          gameState: gameState || {},
          action: {
            kind: action?.kind || 'idle',
            text: action?.text || action?.narration || ''
          },
          mission: {
            id: mission?.id || null,
            task: mission?.task || 'inferred mission'
          }
        })
      }
    ];

    const generated = await this._runWithFallback(prompt, () => sanitizeNarration({}, fallback), (raw) => {
      const candidate = sanitizeNarration(raw, fallback);
      return {
        ...candidate,
        text: candidate.text.slice(0, MAX_NARRATION_TEXT),
        in_character: true
      };
    });
    return {
      text: asString(generated.text, fallback).slice(0, MAX_NARRATION_TEXT),
      in_character: generated.in_character !== false
    };
  }
}

module.exports = {
  PremiumPersonaLLMClient
};
