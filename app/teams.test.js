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
});
