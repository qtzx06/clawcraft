const crypto = require('node:crypto');

const DEFAULT_TIMEOUT_MS = 120000;

function encodeBase64(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64');
}

function parseBase64(value) {
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
  } catch (_err) {
    return null;
  }
}

function buildSignaturePayload(accept, resource) {
  return {
    challengeId: accept.challengeId,
    resource,
    amount: accept.amount,
    unit: accept.unit,
    issuedAt: accept.issuedAt,
    expiresAt: accept.expiresAt,
    chain: accept.chain
  };
}

function signPayload(payload, secret) {
  const serialized = JSON.stringify(payload);
  return crypto.createHmac('sha256', secret).update(serialized).digest('hex');
}

async function requestWithPayment(url, options, opts = {}) {
  const sendRequest = async (extra = {}) => {
    const timeoutMs = Number(opts.timeoutMs || DEFAULT_TIMEOUT_MS);
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

    try {
      return await fetch(url, {
        ...fetchOptions,
        ...extra,
        signal: extra.signal || timeoutController.signal
      });
    } finally {
      clearTimeout(timer);
    }
  };

  const fetchOptions = {
    method: options?.method || 'GET',
    headers: {
      'content-type': 'application/json',
      ...(options?.headers || {})
    },
    body: options?.body,
    signal: options?.signal
  };

  const paymentSecret = opts.paymentSecret;
  const wallet = opts.wallet || 'bot';
  const resource = new URL(url).pathname || '/';

  const first = await sendRequest();
  if (first.status !== 402) {
    return first;
  }

  const required = parseBase64(first.headers.get('PAYMENT-REQUIRED'));
  const accept = required?.accepts?.[0];
  if (!accept) {
    return first;
  }

  if (!paymentSecret) {
    const msg = 'x402 payment required but no paymentSecret configured';
    throw new Error(msg);
  }

  const signaturePayload = buildSignaturePayload(accept, resource);
  const paymentSignature = encodeBase64({
    ...signaturePayload,
    wallet,
    signature: signPayload(signaturePayload, paymentSecret)
  });

  const retryResponse = await fetch(url, {
    ...fetchOptions,
    headers: {
      ...fetchOptions.headers,
      'PAYMENT-SIGNATURE': paymentSignature
    }
  });

  return retryResponse;
}

module.exports = {
  requestWithPayment
};
