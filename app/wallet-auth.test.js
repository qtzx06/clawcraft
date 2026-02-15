import { describe, it, expect } from 'bun:test';
import { generateChallenge, verifyWalletSignature, verifyInlineSignature } from './wallet-auth.js';

// viem/accounts is ESM — dynamic import
async function makeWallet() {
  const { generatePrivateKey, privateKeyToAccount } = await import('viem/accounts');
  const key = generatePrivateKey();
  return privateKeyToAccount(key);
}

describe('generateChallenge', () => {
  it('returns nonce and message containing the wallet', () => {
    const wallet = '0x63ab3Cc15A5249350655378EF5B19564Ef446de4';
    const { nonce, message } = generateChallenge(wallet);
    expect(nonce).toHaveLength(32); // 16 bytes hex
    expect(message).toContain(wallet);
    expect(message).toContain('ClawCraft team registration');
    expect(message).toContain(nonce);
  });
});

describe('verifyWalletSignature', () => {
  it('verifies a valid signature against challenge nonce', async () => {
    const account = await makeWallet();
    const { nonce, message } = generateChallenge(account.address);
    const signature = await account.signMessage({ message });

    const result = await verifyWalletSignature(nonce, signature);
    expect(result.ok).toBe(true);
    expect(result.wallet).toBe(account.address.toLowerCase());
  });

  it('rejects an invalid nonce', async () => {
    const result = await verifyWalletSignature('nonexistent', '0xdeadbeef');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('nonce_invalid_or_expired');
  });

  it('rejects a signature from the wrong wallet', async () => {
    const account1 = await makeWallet();
    const account2 = await makeWallet();
    const { nonce, message } = generateChallenge(account1.address);
    // sign with account2 instead
    const signature = await account2.signMessage({ message });

    const result = await verifyWalletSignature(nonce, signature);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('signature_mismatch');
  });

  it('consumes the nonce (cannot reuse)', async () => {
    const account = await makeWallet();
    const { nonce, message } = generateChallenge(account.address);
    const signature = await account.signMessage({ message });

    const first = await verifyWalletSignature(nonce, signature);
    expect(first.ok).toBe(true);

    const second = await verifyWalletSignature(nonce, signature);
    expect(second.ok).toBe(false);
    expect(second.error).toBe('nonce_invalid_or_expired');
  });
});

describe('verifyInlineSignature', () => {
  it('verifies inline signature for team registration', async () => {
    const account = await makeWallet();
    const name = 'TestTeam';
    const message = `ClawCraft team registration\nTeam: ${name}\nWallet: ${account.address}`;
    const signature = await account.signMessage({ message });

    const result = await verifyInlineSignature(name, account.address, signature);
    expect(result.ok).toBe(true);
    expect(result.wallet).toBe(account.address.toLowerCase());
  });

  it('rejects signature from wrong wallet', async () => {
    const account1 = await makeWallet();
    const account2 = await makeWallet();
    const name = 'TestTeam';
    const message = `ClawCraft team registration\nTeam: ${name}\nWallet: ${account1.address}`;
    const signature = await account2.signMessage({ message });

    const result = await verifyInlineSignature(name, account1.address, signature);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('signature_mismatch');
  });

  it('rejects garbage signature', async () => {
    const result = await verifyInlineSignature('TestTeam', '0xabc', 'not-a-sig');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('signature_invalid');
  });
});
