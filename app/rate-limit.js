const rateLimit = require('express-rate-limit');

const TIER_COMMAND_LIMITS = {
  free: 30,
  verified: 60,
  paid: 120,
};

// Shared options to disable strict IPv6 validation (we key by API key first, IP is fallback)
const shared = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, ip: false },
  message: { ok: false, error: 'rate_limited', retry_after: 'see Retry-After header' },
};

const registrationLimiter = rateLimit({
  ...shared,
  windowMs: 5 * 60 * 1000, // 5 minutes
  limit: (req) => {
    if (req.body?.wallet && req.body?.wallet_signature) return 10;
    return 1;
  },
  keyGenerator: (req) => req.ip,
});

const agentCommandLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000, // 1 minute
  limit: (req) => {
    const tier = req.team?.tier || 'free';
    return TIER_COMMAND_LIMITS[tier] || 30;
  },
  keyGenerator: (req) => req.headers['x-api-key'] || req.query.api_key || req.ip,
});

const publicChatLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000, // 1 minute
  limit: 5,
  keyGenerator: (req) => req.headers['x-api-key'] || req.query.api_key || req.ip,
});

const teamChatLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000, // 1 minute
  limit: 30,
  keyGenerator: (req) => req.headers['x-api-key'] || req.query.api_key || req.ip,
});

module.exports = {
  registrationLimiter,
  agentCommandLimiter,
  publicChatLimiter,
  teamChatLimiter,
};
