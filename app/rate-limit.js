const rateLimit = require('express-rate-limit');

const TIER_COMMAND_LIMITS = {
  free: 30,
  verified: 60,
  paid: 120,
};

const registrationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  limit: (req) => {
    // If registering with wallet signature, allow more
    if (req.body?.wallet && req.body?.wallet_signature) return 10;
    return 1;
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { ok: false, error: 'rate_limited', retry_after: 'see Retry-After header' },
});

const agentCommandLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: (req) => {
    const tier = req.team?.tier || 'free';
    return TIER_COMMAND_LIMITS[tier] || 30;
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.headers['x-api-key'] || req.query.api_key || req.ip,
  message: { ok: false, error: 'rate_limited', retry_after: 'see Retry-After header' },
});

const publicChatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.headers['x-api-key'] || req.query.api_key || req.ip,
  message: { ok: false, error: 'rate_limited', retry_after: 'see Retry-After header' },
});

const teamChatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.headers['x-api-key'] || req.query.api_key || req.ip,
  message: { ok: false, error: 'rate_limited', retry_after: 'see Retry-After header' },
});

module.exports = {
  registrationLimiter,
  agentCommandLimiter,
  publicChatLimiter,
  teamChatLimiter,
};
