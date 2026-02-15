const crypto = require('node:crypto');
const express = require('express');
const client = require('prom-client');
const pino = require('pino');

const log = pino({
  level: process.env.LOG_LEVEL || 'info'
});

const app = express();
app.use(express.json());

const PORT = Number(process.env.X402_PORT || 3100);
const FACILITATOR = process.env.X402_FACILITATOR || '0x000000000000000000000000000000000000dEaD';
const X402_CHAIN = process.env.X402_CHAIN || 'eip155:8453';
const USDC_TOKEN = process.env.X402_USDC_TOKEN || '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const CHALLENGE_TTL_MS = Number(process.env.X402_CHALLENGE_TTL_MS || 120000);
const PAYMENT_SECRET = process.env.X402_PAYMENT_SECRET || 'x402-local-secret';
const MOCK_BYPASS = process.env.X402_MOCK_BYPASS === '1' || process.env.NODE_ENV === 'development';
const STRICT_PAYMENT = process.env.X402_STRICT_VERIFICATION === '1' || process.env.X402_PAYMENT_SECRET;

const PRODUCTS = {
  voice: { endpoint: '/voice', amount: Number(process.env.X402_VOICE_PRICE || 0.01), unit: 'USDC' },
  avatar: { endpoint: '/avatar', amount: Number(process.env.X402_AVATAR_PRICE || 0.05), unit: 'USDC' },
  narrate: { endpoint: '/narrate', amount: Number(process.env.X402_NARRATE_PRICE || 0.01), unit: 'USDC' }
};

const challengeStore = new Map();

client.collectDefaultMetrics();

const paymentAttempts = new client.Counter({
  name: 'x402_payment_attempts_total',
  help: 'Count of x402 payment attempts by product and result',
  labelNames: ['product', 'result']
});

const paymentLatency = new client.Histogram({
  name: 'x402_route_latency_seconds',
  help: 'x402 route latency in seconds',
  labelNames: ['route'],
  buckets: [0.05, 0.2, 1, 2, 5]
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    mock_bypass: MOCK_BYPASS,
    strict_payment: STRICT_PAYMENT
  });
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

function parseJsonHeader(value) {
  if (!value) return null;
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    return parsed;
  } catch (_err) {
    return null;
  }
}

function signChallenge(challenge) {
  const payload = {
    challengeId: challenge.challengeId,
    resource: challenge.resource,
    amount: challenge.amount,
    unit: challenge.unit,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
    chain: challenge.chain
  };

  return crypto.createHmac('sha256', PAYMENT_SECRET).update(JSON.stringify(payload)).digest('hex');
}

function issueChallenge(product) {
  const issuedAt = Date.now();
  const challenge = {
    challengeId: crypto.randomUUID(),
    scheme: 'x402-v1-mock',
    resource: product.endpoint,
    amount: product.amount,
    unit: product.unit,
    chain: X402_CHAIN,
    asset: {
      address: USDC_TOKEN,
      symbol: product.unit,
      decimals: 6
    },
    to: FACILITATOR,
    issuedAt,
    expiresAt: issuedAt + CHALLENGE_TTL_MS
  };

  challengeStore.set(challenge.challengeId, challenge);
  return Buffer.from(JSON.stringify({ accepts: [challenge] }).trim(), 'utf8').toString('base64');
}

function cleanupChallenges() {
  const now = Date.now();
  for (const [id, challenge] of challengeStore.entries()) {
    if (challenge.expiresAt < now) {
      challengeStore.delete(id);
    }
  }
}

setInterval(cleanupChallenges, Math.min(CHALLENGE_TTL_MS, 30000)).unref();

function isSignedPaymentValid(productKey, signed, product) {
  if (!signed || typeof signed !== 'object') return false;
  const { challengeId } = signed;
  if (!challengeId || !signed.signature) return false;

  const challenge = challengeStore.get(challengeId);
  if (!challenge) return false;
  if (challenge.resource !== product.endpoint) return false;
  if (challenge.amount > product.amount) return false;
  if (signed.amount != null && Number(signed.amount) < product.amount) return false;
  if (signed.chain && signed.chain !== X402_CHAIN) return false;
  if (challenge.expiresAt < Date.now()) {
    challengeStore.delete(challengeId);
    return false;
  }

  const expected = signChallenge(challenge);
  if (typeof expected !== 'string' || expected.length !== String(signed.signature).length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(expected, 'utf8'),
    Buffer.from(String(signed.signature), 'utf8')
  );
}

function requirePayment(productKey) {
  const product = PRODUCTS[productKey];
  if (!product) throw new Error(`Unknown product key: ${productKey}`);

  return (req, res, next) => {
    const stop = paymentLatency.startTimer({ route: product.endpoint });
    try {
      if (MOCK_BYPASS && !STRICT_PAYMENT) {
        paymentAttempts.inc({ product: productKey, result: 'bypass' });
        log.info({ product: productKey, path: req.path }, 'x402 bypass enabled');
        return next();
      }

      const signed = parseJsonHeader(req.header('PAYMENT-SIGNATURE'));
      if (!isSignedPaymentValid(productKey, signed, product)) {
        const paymentRequired = issueChallenge(product);
        res.set('PAYMENT-REQUIRED', paymentRequired);
        paymentAttempts.inc({ product: productKey, result: 'required' });
        log.info(
          { product: productKey, path: req.path, reason: 'payment_required' },
          'Rejecting request with x402 challenge'
        );
        return res.status(402).json({
          error: 'payment_required',
          product: productKey,
          amount: product.amount,
          unit: product.unit,
          chain: X402_CHAIN
        });
      }

      paymentAttempts.inc({ product: productKey, result: 'ok' });
      const tx = crypto.createHash('sha256').update(req.header('PAYMENT-SIGNATURE')).digest('hex');
      const settlement = {
        tx,
        settledAt: Date.now(),
        chain: X402_CHAIN
      };
      res.set('PAYMENT-RESPONSE', Buffer.from(JSON.stringify(settlement)).toString('base64'));
      const signedChallenge = parseJsonHeader(req.header('PAYMENT-SIGNATURE'));
      if (signedChallenge?.challengeId) {
        challengeStore.delete(signedChallenge.challengeId);
      }
      log.info(
        { product: productKey, path: req.path },
        'x402 payment accepted'
      );
      next();
    } finally {
      stop();
    }
  };
}

app.post('/voice', requirePayment('voice'), (req, res) => {
  const { text } = req.body || {};
  log.info({ route: 'voice', hasText: typeof text === 'string' }, 'voice endpoint used');
  res.json({
    ok: true,
    product: 'voice',
    generated: true,
    text_snippet: typeof text === 'string' ? text.slice(0, 80) : null
  });
});

app.post('/avatar', requirePayment('avatar'), (req, res) => {
  const { persona } = req.body || {};
  log.info({ route: 'avatar', persona: !!persona }, 'avatar endpoint used');
  res.json({
    ok: true,
    product: 'avatar',
    image_ready: true,
    persona
  });
});

app.post('/narrate', requirePayment('narrate'), (req, res) => {
  const { narration } = req.body || {};
  log.info({ route: 'narrate', hasNarration: !!narration }, 'narrate endpoint used');
  res.json({
    ok: true,
    product: 'narrate',
    narration_ready: true,
    narration
  });
});

app.listen(PORT, () => {
  log.info({ port: PORT, strict_payment: STRICT_PAYMENT, mock_bypass: MOCK_BYPASS }, 'x402 gateway listening');
});
