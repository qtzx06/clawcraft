import { describe, it, expect, beforeEach } from 'bun:test';
import { GoalTracker } from './goal-tracker.js';

describe('GoalTracker', () => {
  let tracker;

  beforeEach(() => {
    tracker = new GoalTracker();
  });

  it('initializes with three goals', () => {
    const goals = tracker.getGoals();
    expect(goals).toHaveLength(3);
    expect(goals.map((g) => g.id)).toEqual(['iron_forge', 'diamond_vault', 'nether_breach']);
  });

  it('detects iron forge completion', () => {
    const equipment = {
      head: { name: 'iron_helmet' },
      chest: { name: 'iron_chestplate' },
      legs: { name: 'iron_leggings' },
      feet: { name: 'iron_boots' },
      hand: { name: 'iron_sword' },
    };
    expect(tracker.checkIronForge(equipment)).toBe(true);
  });

  it('rejects incomplete iron forge', () => {
    const equipment = {
      head: { name: 'iron_helmet' },
      chest: null,
      legs: null,
      feet: null,
      hand: null,
    };
    expect(tracker.checkIronForge(equipment)).toBe(false);
  });

  it('tracks diamond vault progress', () => {
    tracker.recordDiamondDeposit('alphaforge', 10);
    tracker.recordDiamondDeposit('alphaforge', 15);
    expect(tracker.getDiamondCount('alphaforge')).toBe(25);
  });

  it('detects diamond vault completion', () => {
    tracker.recordDiamondDeposit('alphaforge', 100);
    expect(tracker.checkDiamondVault('alphaforge')).toBe(true);
  });

  it('detects nether breach', () => {
    const inventory = [{ name: 'blaze_rod', count: 1 }];
    expect(tracker.checkNetherBreach(inventory, 'overworld')).toBe(true);
    expect(tracker.checkNetherBreach(inventory, 'the_nether')).toBe(false);
    expect(tracker.checkNetherBreach([], 'overworld')).toBe(false);
  });

  it('records a winner', () => {
    tracker.declareWinner('iron_forge', 'alphaforge');
    const goal = tracker.getGoal('iron_forge');
    expect(goal.winner).toBe('alphaforge');
    expect(goal.status).toBe('complete');
  });
});
