import { describe, it, expect, beforeEach } from 'bun:test';
import { TeamStore } from './teams.js';

describe('TeamStore', () => {
  let store;

  beforeEach(() => {
    store = new TeamStore();
  });

  it('registers a team and returns api_key', () => {
    const result = store.register({ name: 'AlphaForge', wallet: '0xabc' });
    expect(result.ok).toBe(true);
    expect(result.team_id).toBe('alphaforge');
    expect(result.api_key).toMatch(/^clf_/);
  });

  it('rejects duplicate team names', () => {
    store.register({ name: 'AlphaForge', wallet: '0xabc' });
    const result = store.register({ name: 'AlphaForge', wallet: '0xdef' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('team_exists');
  });

  it('authenticates with api_key', () => {
    const { api_key } = store.register({ name: 'AlphaForge', wallet: '0xabc' });
    expect(store.authenticate(api_key)).toBeTruthy();
    expect(store.authenticate('bad_key')).toBeNull();
  });

  it('lists all teams', () => {
    store.register({ name: 'AlphaForge', wallet: '0xabc' });
    store.register({ name: 'DeepMine', wallet: '0xdef' });
    expect(store.list()).toHaveLength(2);
  });

  it('gets team by id', () => {
    store.register({ name: 'AlphaForge', wallet: '0xabc' });
    const team = store.get('alphaforge');
    expect(team.name).toBe('AlphaForge');
    expect(team.agents).toEqual([]);
  });

  it('registers with tier=free and verified_wallet=null by default', () => {
    store.register({ name: 'FreeTeam' });
    const team = store.get('freeteam');
    expect(team.tier).toBe('free');
    expect(team.verified_wallet).toBeNull();
  });

  it('verifyWallet sets verified_wallet and upgrades tier to verified', () => {
    store.register({ name: 'WalletTeam', wallet: '0xABC' });
    const ok = store.verifyWallet('walletteam', '0xABC');
    expect(ok).toBe(true);
    const team = store.get('walletteam');
    expect(team.verified_wallet).toBe('0xabc');
    expect(team.tier).toBe('verified');
  });

  it('verifyWallet does not downgrade paid tier', () => {
    store.register({ name: 'PaidTeam' });
    store.setTier('paidteam', 'paid');
    store.verifyWallet('paidteam', '0xDEF');
    const team = store.get('paidteam');
    expect(team.verified_wallet).toBe('0xdef');
    expect(team.tier).toBe('paid'); // stays paid, not downgraded
  });

  it('setTier changes team tier', () => {
    store.register({ name: 'TierTeam' });
    expect(store.get('tierteam').tier).toBe('free');
    store.setTier('tierteam', 'paid');
    expect(store.get('tierteam').tier).toBe('paid');
  });

  it('setTier returns false for nonexistent team', () => {
    expect(store.setTier('nope', 'paid')).toBe(false);
  });

  it('verifyWallet returns false for nonexistent team', () => {
    expect(store.verifyWallet('nope', '0x123')).toBe(false);
  });

  it('list() exposes tier and verified_wallet', () => {
    store.register({ name: 'ListTeam', wallet: '0xaaa' });
    store.verifyWallet('listteam', '0xaaa');
    const teams = store.list();
    const t = teams.find((x) => x.team_id === 'listteam');
    expect(t.tier).toBe('verified');
    expect(t.verified_wallet).toBe('0xaaa');
  });
});
