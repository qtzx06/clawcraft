import { describe, test, expect, beforeEach } from 'bun:test';
import { InterestScorer } from './scorer.js';

describe('InterestScorer', () => {
  let scorer;

  beforeEach(() => {
    scorer = new InterestScorer();
  });

  test('death event scores 100', () => {
    scorer.recordEvent({ type: 'death', player: 'AgentAlpha', timestamp: Date.now() });
    const scores = scorer.getScores();
    expect(scores.get('AgentAlpha')).toBe(100);
  });

  test('combat event scores 80', () => {
    scorer.recordEvent({ type: 'combat', player: 'AgentBeta', timestamp: Date.now() });
    const scores = scorer.getScores();
    expect(scores.get('AgentBeta')).toBe(80);
  });

  test('cluster event scores 50', () => {
    scorer.recordEvent({ type: 'cluster', player: 'AgentGamma', timestamp: Date.now() });
    const scores = scorer.getScores();
    expect(scores.get('AgentGamma')).toBe(50);
  });

  test('join event scores 40', () => {
    scorer.recordEvent({ type: 'join', player: 'AgentDelta', timestamp: Date.now() });
    const scores = scorer.getScores();
    expect(scores.get('AgentDelta')).toBe(40);
  });

  test('chat event scores 30', () => {
    scorer.recordEvent({ type: 'chat', player: 'AgentEpsilon', timestamp: Date.now() });
    const scores = scorer.getScores();
    expect(scores.get('AgentEpsilon')).toBe(30);
  });

  test('build event scores 20', () => {
    scorer.recordEvent({ type: 'build', player: 'AgentZeta', timestamp: Date.now() });
    const scores = scorer.getScores();
    expect(scores.get('AgentZeta')).toBe(20);
  });

  test('multiple events for same player stack', () => {
    const now = Date.now();
    scorer.recordEvent({ type: 'chat', player: 'AgentAlpha', timestamp: now });
    scorer.recordEvent({ type: 'combat', player: 'AgentAlpha', timestamp: now });
    const scores = scorer.getScores();
    expect(scores.get('AgentAlpha')).toBe(110);
  });

  test('events decay over time', () => {
    const past = Date.now() - 20_000; // 20s ago
    scorer.recordEvent({ type: 'chat', player: 'AgentAlpha', timestamp: past });
    // chat decays over 10s, so after 20s it should be 0
    const scores = scorer.getScores();
    expect(scores.get('AgentAlpha')).toBe(0);
  });

  test('getTopPlayer returns highest scored player', () => {
    const now = Date.now();
    scorer.recordEvent({ type: 'chat', player: 'AgentAlpha', timestamp: now });
    scorer.recordEvent({ type: 'death', player: 'AgentBeta', timestamp: now });
    expect(scorer.getTopPlayer()).toBe('AgentBeta');
  });

  test('getTopPlayer returns null when no events', () => {
    expect(scorer.getTopPlayer()).toBeNull();
  });

  test('getTopPlayer skips excluded players', () => {
    const now = Date.now();
    scorer.recordEvent({ type: 'death', player: 'AgentAlpha', timestamp: now });
    scorer.recordEvent({ type: 'combat', player: 'AgentBeta', timestamp: now });
    expect(scorer.getTopPlayer({ exclude: ['AgentAlpha'] })).toBe('AgentBeta');
  });

  test('prune removes fully decayed events', () => {
    const old = Date.now() - 120_000; // 2 min ago
    scorer.recordEvent({ type: 'death', player: 'AgentAlpha', timestamp: old });
    scorer.prune();
    const scores = scorer.getScores();
    expect(scores.has('AgentAlpha')).toBe(false);
  });
});
