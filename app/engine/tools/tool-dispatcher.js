const { setTimeout: wait } = require('timers/promises');
const { createHash, createHmac } = require('crypto');
const {
  normalizeToolKind,
  isLocalToolAction,
  isRemoteToolAction,
  isKnownToolAction
} = require('./tool-contract');

class ToolServiceClient {
  constructor({
    baseUrl,
    token,
    signatureSecret,
    timeoutMs = 7000,
    retryCount = 1,
    logger = console
  }) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.token = token || '';
    this.signatureSecret = signatureSecret || '';
    this.timeoutMs = timeoutMs;
    this.retryCount = Math.max(1, Number(retryCount) || 1);
    this.logger = logger;
  }

  async execute(actionPayload) {
    const url = `${this.baseUrl}/tools/execute`;
    const raw = JSON.stringify(actionPayload);
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json'
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (this.signatureSecret) {
      const sig = createHmac('sha256', this.signatureSecret).update(raw).digest('hex');
      headers['x-tool-signature'] = sig;
    }

    let attempt = 0;
    let lastError = null;
    while (attempt < this.retryCount) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: raw,
          signal: controller.signal
        });
        clearTimeout(timer);
        const rawResponse = await response.text();
        let parsed = null;
        try {
          parsed = JSON.parse(rawResponse);
        } catch (_error) {
          parsed = null;
        }
        if (!response.ok) {
          const reason = parsed?.error || parsed?.message || rawResponse || `HTTP ${response.status}`;
          return {
            kind: actionPayload.action,
            source: 'tool_service',
            success: false,
            reason: 'tool_service_http_error',
            notes: reason
          };
        }
        if (!parsed || parsed.ok !== true) {
          return {
            kind: actionPayload.action,
            source: 'tool_service',
            success: false,
            reason: parsed?.error || parsed?.reason || 'tool_service_rejected',
            notes: parsed?.message || 'tool service rejected request'
          };
        }
        const toolResult = parsed.result || parsed;
        return {
          kind: actionPayload.action,
          source: 'tool_service',
          success: parsed.ok === true,
          reason: toolResult?.reason || null,
          job_id: toolResult?.job_id || toolResult?.jobId,
          tool_status: toolResult?.status,
          notes: toolResult?.notes || toolResult?.message || 'tool request submitted',
          result: toolResult,
          duration_ms: parsed.duration_ms || 0
        };
      } catch (error) {
        clearTimeout(timer);
        lastError = error;
      } finally {
        clearTimeout(timer);
      }

      attempt += 1;
      if (attempt >= this.retryCount) break;
      await wait(120 * attempt);
    }

    this.logger?.warn?.(
      { error: String(lastError || 'tool-service error'), action: actionPayload.action },
      'tool service unreachable'
    );
    return {
      kind: actionPayload.action,
      source: 'tool_service',
      success: false,
      reason: 'tool_service_unavailable',
      notes: `tool service call failed: ${String(lastError?.message || lastError || 'network error')}`
    };
  }
}

class ToolDispatcher {
  constructor({
    adapter,
    toolServiceConfig = {},
    fallbackOnServiceFailure = false,
    logger = console
  }) {
    this.adapter = adapter;
    this.logger = logger;
    this.fallbackOnServiceFailure = fallbackOnServiceFailure;
    this.toolServiceConfig = toolServiceConfig;
    this.toolServiceClient = null;
    this._signatureSecret = toolServiceConfig.signatureSecret || '';
  }

  isConfigured() {
    return Boolean(String(this.toolServiceConfig.baseUrl || '').trim());
  }

  _ensureClient() {
    if (this.toolServiceClient) return this.toolServiceClient;
    this.toolServiceClient = new ToolServiceClient({
      baseUrl: this.toolServiceConfig.baseUrl,
      token: this.toolServiceConfig.token,
      signatureSecret: this.toolServiceConfig.signatureSecret,
      timeoutMs: this.toolServiceConfig.timeoutMs,
      retryCount: this.toolServiceConfig.retryCount,
      logger: this.logger
    });
    return this.toolServiceClient;
  }

  _normalizeArgs(rawArgs = {}) {
    if (!rawArgs || typeof rawArgs !== 'object') return {};
    return rawArgs;
  }

  _buildJobSeed({ agentId, missionId, action, args }) {
    const seed = `${agentId}:${missionId || 'unknown'}:${action}:${JSON.stringify(args || {})}`;
    return createHash('sha256').update(seed).digest('hex').slice(0, 18);
  }

  async executeAction({
    agentId,
    missionId,
    action,
    args = {},
    requestId,
    correlationId,
    narration
  }) {
    const kind = normalizeToolKind(action);
    const normalizedArgs = this._normalizeArgs(args);

    if (!isKnownToolAction(kind)) {
      return {
        kind,
        success: false,
        source: 'runtime',
        reason: 'unsupported_tool',
        notes: `Tool "${kind}" is not in allowlisted tool contract.`
      };
    }

    if (isLocalToolAction(kind)) {
      return this.adapter.performAction({
        kind,
        details: normalizedArgs,
        narration,
        mission_id: missionId
      }).then((result) => ({
        ...result,
        source: 'local',
        kind,
        correlation_id: correlationId,
        request_id: requestId
      }));
    }

    if (!this.isConfigured()) {
      return {
        kind,
        source: 'tool_service',
        success: false,
        reason: 'tool_service_unconfigured',
        notes: 'No TOOL_SERVICE_URL configured'
      };
    }

    if (!isRemoteToolAction(kind)) {
      return {
        kind,
        success: false,
        source: 'tool_service',
        reason: 'tool_not_supported_remotely',
        notes: `Tool "${kind}" is not mapped for remote execution.`
      };
    }

    const payload = {
      request_id: requestId || this._buildJobSeed({ agentId, missionId, action: kind, args: normalizedArgs }),
      agent_id: agentId,
      action: kind,
      args: normalizedArgs,
      mission_id: missionId,
      correlation_id: correlationId || missionId
    };
    return this._ensureClient().execute(payload);
  }
}

module.exports = {
  ToolDispatcher,
  ToolServiceClient
};
