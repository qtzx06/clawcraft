const { setTimeout: wait } = require('timers/promises');

const DEFAULT_TEMPERATURE = 0.4;
const FALLBACK_ACTIONS = ['mine', 'build', 'craft', 'explore', 'fight', 'eat', 'chat'];

function parseQuantity(text) {
  const match = String(text || '').match(/\b(\d+)\b/);
  return match ? Number(match[1]) : 1;
}

function cleanJson(input) {
  const trimmed = String(input || '').trim();
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) return null;
  const body = trimmed.slice(jsonStart, jsonEnd + 1);
  try {
    return JSON.parse(body);
  } catch (_e) {
    return null;
  }
}

class OpenAICompatibleClient {
  constructor({ baseUrl, apiKey, model, temperature = DEFAULT_TEMPERATURE, timeoutMs = 15000 } = {}) {
    this.baseUrl = String(baseUrl || process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.apiKey = apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '';
    this.model = model || process.env.LLM_MODEL || 'gpt-4o-mini';
    this.temperature = temperature;
    this.timeoutMs = timeoutMs;
    this._supportsRemote = Boolean(this.apiKey);
  }

  _heuristicAction(mission) {
    const task = String((mission && mission.task) || '').toLowerCase();
    const action = {
      kind: 'explore',
      details: {
        target: 'area',
        amount: 1
      },
      narration: 'I am taking a simple action for now.',
      forceComplete: false
    };

    if (/mine|gather|collect|dig|digging/.test(task)) {
      action.kind = 'mine';
      action.narration = 'I will mine for the requested resource.';
      const targetWords = task.match(/(oak|cobblestone|stone|iron|diamond|coal|sand|dirt|logs?)\b/);
      action.details.target = targetWords ? targetWords[1] : 'stone';
      action.details.amount = parseQuantity(task);
      action.forceComplete = true;
    } else if (/build|craft|make|construct/.test(task)) {
      action.kind = 'build';
      action.narration = 'I will start building toward this goal.';
      action.details.target = 'structure';
      action.details.amount = 1;
      action.forceComplete = false;
    } else if (/attack|kill|fight|defend|combat/.test(task)) {
      action.kind = 'fight';
      action.narration = 'I will handle combat with nearby threats.';
      action.details.target = 'nearest threat';
      action.details.amount = 1;
      action.forceComplete = false;
    } else if (/eat|food|hunger|hunger|starve/.test(task)) {
      action.kind = 'eat';
      action.narration = 'I will look for food and eat if needed.';
      action.forceComplete = true;
    } else if (/say|chat|announce|broadcast/.test(task)) {
      action.kind = 'chat';
      action.details.text = 'Working now.';
    } else if (/go|run|move|explore|patrol/.test(task)) {
      action.kind = 'explore';
      action.forceComplete = false;
    } else if (/status/.test(task)) {
      action.kind = 'chat';
      action.details.text = `Mission check-in: ${task}`;
      action.narration = 'I am updating my progress.';
      action.forceComplete = false;
    }

    return action;
  }

  _sanitizeAction(raw) {
    if (typeof raw === 'string') {
      const normalized = raw.toLowerCase();
      return FALLBACK_ACTIONS.includes(normalized) ? normalized : 'explore';
    }

    if (raw && typeof raw === 'object') {
      const candidate = String(raw.kind || '').toLowerCase();
      return FALLBACK_ACTIONS.includes(candidate) ? candidate : 'explore';
    }

    return 'explore';
  }

  async _callRemote(messages) {
    if (!this._supportsRemote) {
      throw new Error('LLM key missing');
    }

    const endpoint = `${this.baseUrl}/chat/completions`;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        signal: abort.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          temperature: this.temperature,
          response_format: {
            type: 'json_object'
          },
          messages
        })
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`llm error ${response.status} ${body}`);
      }

      const payload = await response.json();
      const text = payload?.choices?.[0]?.message?.content || '';
      return cleanJson(text);
    } finally {
      clearTimeout(timer);
    }
  }

  async planAction({ mission = {}, botState = {}, gameState = {}, personality = {} } = {}) {
    const prompt = [
      {
        role: 'system',
        content: `You are a Minecraft bot policy planner.
Return strict JSON with this shape:
{ "kind":"mine|build|craft|fight|eat|chat|explore", "details":{}, "narration":"...", "forceComplete":false }
Only use kinds listed, and keep details minimal.`
      },
      {
        role: 'user',
        content: JSON.stringify({
          personality,
          gameState,
          botState,
          mission: mission.task ? mission : {
            task: 'No mission'
          }
        })
      }
    ];

    try {
      const planned = await this._callRemote(prompt);
      if (!planned || typeof planned !== 'object') {
        return this._heuristicAction(mission);
      }

      const plannedKind = this._sanitizeAction(planned.kind || planned);
      const details = planned.details && typeof planned.details === 'object' ? planned.details : {};
      return {
        kind: plannedKind,
        details,
        narration: planned.narration || `I will ${plannedKind} now.`,
        forceComplete: Boolean(planned.forceComplete)
      };
    } catch (_error) {
      return this._heuristicAction(mission);
    }
  }

  async withRetry(actionPayload, attempts = 1) {
    if (attempts <= 1) {
      return this.planAction(actionPayload);
    }
    let lastError;
    for (let i = 0; i < attempts; i += 1) {
      try {
        return await this.planAction(actionPayload);
      } catch (error) {
        lastError = error;
        await wait(150 * (i + 1));
      }
    }
    throw lastError;
  }
}

module.exports = {
  OpenAICompatibleClient
};
