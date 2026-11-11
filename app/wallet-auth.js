const crypto = require('node:crypto');

// In-memory nonce store: nonce -> { wallet, message, expiresAt }
const nonceStore = new Map();
const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Periodic cleanup every 60s
setInterval(() => {
  const now = Date.now();
  for (const [nonce, entry] of nonceStore) {
    if (entry.expiresAt <= now) nonceStore.delete(nonce);
  }
}, 60_000).unref();

function generateChallenge(wallet) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const message = `ClawCraft team registration\nWallet: ${wallet}\nNonce: ${nonce}`;
  nonceStore.set(nonce, {
    wallet: wallet.toLowerCase(),
    message,
    expiresAt: Date.now() + NONCE_TTL_MS,
  });
  return { nonce, message };
}

async function verifyWalletSignature(nonce, signature) {
  const entry = nonceStore.get(nonce);
  if (!entry) return { ok: false, error: 'nonce_invalid_or_expired' };
  if (entry.expiresAt <= Date.now()) {
    nonceStore.delete(nonce);
    return { ok: false, error: 'nonce_expired' };
  }

  try {
    const { recoverMessageAddress } = await import('viem');
    const recovered = await recoverMessageAddress({
      message: entry.message,
      signature,
    });

    nonceStore.delete(nonce);

    if (recovered.toLowerCase() !== entry.wallet) {
      return { ok: false, error: 'signature_mismatch' };
    }

    return { ok: true, wallet: entry.wallet };
  } catch (err) {
    return { ok: false, error: 'signature_invalid', detail: err.message };
  }
}

async function verifyInlineSignature(name, wallet, signature) {
  const message = `ClawCraft team registration\nTeam: ${name}\nWallet: ${wallet}`;
  try {
    const { recoverMessageAddress } = await import('viem');
    const recovered = await recoverMessageAddress({
      message,
      signature,
    });

    if (recovered.toLowerCase() !== wallet.toLowerCase()) {
      return { ok: false, error: 'signature_mismatch' };
    }

    return { ok: true, wallet: wallet.toLowerCase() };
  } catch (err) {
    return { ok: false, error: 'signature_invalid', detail: err.message };
  }
}

module.exports = {
  generateChallenge,
  verifyWalletSignature,
  verifyInlineSignature,
};
