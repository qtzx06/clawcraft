const { setTimeout: wait } = require('timers/promises');

const DEFAULT_TEMPERATURE = 0.4;
const PLAN_KINDS = ['mine', 'build', 'craft', 'explore', 'fight', 'eat', 'chat'];

function parseQuantity(text) {
  const match = String(text || '').match(/\b(\d+)\b/);
  return match ? Number(match[1]) : 1;
}

function normalizeKind(raw) {
  return String(raw || '').toLowerCase().trim();
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

function normalizeToolContract(raw = {}) {
  const allowed = Array.isArray(raw.allowed_tools) ? raw.allowed_tools : [];
  const denied = Array.isArray(raw.denied_tools) ? raw.denied_tools : [];
  const normalizedAllowed = allowed.map(normalizeKind).filter((value) => PLAN_KINDS.includes(value));
  const normalizedDenied = denied.map(normalizeKind).filter((value) => PLAN_KINDS.includes(value));

  const computedAllowed = normalizedAllowed.length
    ? normalizedAllowed.filter((kind) => !normalizedDenied.includes(kind))
    : PLAN_KINDS.filter((kind) => !normalizedDenied.includes(kind));

  const safeAllowed = computedAllowed.length > 0 ? computedAllowed : ['chat'];
  return {
    allowed_tools: safeAllowed,
    denied_tools: normalizedDenied.filter((kind) => !normalizedAllowed.includes(kind)),
    constraints: Array.isArray(raw.constraints) ? raw.constraints : []
  };
}

function buildSafeFallback(allowed = []) {
  const safe = Array.isArray(allowed) && allowed.length > 0 ? allowed : PLAN_KINDS;
  return safe.includes('chat') ? 'chat' : safe[0];
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
      const normalized = normalizeKind(raw);
      return PLAN_KINDS.includes(normalized) ? normalized : 'chat';
    }

    if (raw && typeof raw === 'object') {
      const candidate = normalizeKind(raw.kind);
      return PLAN_KINDS.includes(candidate) ? candidate : 'chat';
    }

    return 'chat';
  }

  _sanitizeNarration(text) {
    return String(text || '').slice(0, 220);
  }

  _coercePlanWithPolicy(rawPlan, policy = {}) {
    const contract = normalizeToolContract(policy);
    const requested = this._sanitizeAction(rawPlan?.kind || rawPlan);
    const allowed = contract.allowed_tools;
    const blocked = !allowed.includes(requested);
    const fallbackKind = buildSafeFallback(allowed);
    const chosenKind = blocked ? fallbackKind : requested;
    const details = rawPlan && typeof rawPlan === 'object' && rawPlan.details && typeof rawPlan.details === 'object'
      ? rawPlan.details
      : {};

    return {
      kind: chosenKind,
      details,
      narration: this._sanitizeNarration(
        blocked
          ? `${rawPlan?.narration || `I will ${chosenKind} now.`} (policy constrained to ${chosenKind})`
          : rawPlan?.narration || `I will ${chosenKind} now.`
      ),
      forceComplete: blocked ? false : Boolean(rawPlan?.forceComplete),
      policy: {
        requested,
        allowed,
        denied: contract.denied_tools,
        constraints: contract.constraints,
        blocked
      }
    };
  }

  _fallbackWithPolicy(mission, policy = {}) {
    return this._coercePlanWithPolicy(this._heuristicAction(mission), policy);
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

  async planAction({ mission = {}, botState = {}, gameState = {}, personality = {}, policy = {} } = {}) {
    const policyContract = normalizeToolContract(policy);
    const allowed = policyContract.allowed_tools;
    const denied = policyContract.denied_tools;
    const constraints = policyContract.constraints;

    const prompt = [
      {
        role: 'system',
        content: `You are a Minecraft bot policy planner.
Return strict JSON with this shape:
{ "kind":"mine|build|craft|fight|eat|chat|explore", "details":{}, "narration":"...", "forceComplete":false }
Use only kinds in policy.allowed_tools and keep details minimal.
If uncertain, prefer chat or explore.
Do not return any kind in policy.denied_tools.
Policy constraints: ${constraints.length > 0 ? constraints.join('; ') : 'none'}`
      },
      {
        role: 'user',
        content: JSON.stringify({
          personality,
          gameState,
          botState,
          policy: {
            allowed_tools: allowed,
            denied_tools: denied,
            constraints: constraints
          },
          mission: mission.task ? mission : {
            task: 'No mission'
          }
        })
      }
    ];

    try {
      const planned = await this._callRemote(prompt);
      if (!planned || typeof planned !== 'object') {
        return this._fallbackWithPolicy(mission, policyContract);
      }

      const plannedKind = this._sanitizeAction(planned.kind || planned);
      if (!allowed.includes(plannedKind)) {
        return this._coercePlanWithPolicy(planned, policyContract);
      }

      return this._coercePlanWithPolicy(planned, policyContract);
    } catch (_error) {
      return this._fallbackWithPolicy(mission, policyContract);
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
