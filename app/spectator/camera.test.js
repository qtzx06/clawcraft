import { describe, test, expect, beforeEach } from 'bun:test';
import { CameraController } from './camera.js';
import { InterestScorer } from './scorer.js';

describe('CameraController', () => {
  let scorer;
  let camera;

  beforeEach(() => {
    scorer = new InterestScorer();
    camera = new CameraController(scorer, {
      dwellMs: 100,     // short for tests
      cooldownMs: 200,
      cycleMs: 50,
    });
  });

  test('pick returns top scorer', () => {
    scorer.recordEvent({ type: 'death', player: 'Alpha', timestamp: Date.now() });
    scorer.recordEvent({ type: 'chat', player: 'Beta', timestamp: Date.now() });
    expect(camera.pick()).toBe('Alpha');
  });

  test('pick avoids current target if dwell not elapsed', () => {
    scorer.recordEvent({ type: 'death', player: 'Alpha', timestamp: Date.now() });
    camera.setCurrentTarget('Alpha');
    // Alpha is current, should still return Alpha since it's the only interesting one
    expect(camera.pick()).toBe('Alpha');
  });

  test('pick skips cooldown players when alternatives exist', () => {
    const now = Date.now();
    scorer.recordEvent({ type: 'death', player: 'Alpha', timestamp: now });
    scorer.recordEvent({ type: 'combat', player: 'Beta', timestamp: now });
    camera.addCooldown('Alpha');
    expect(camera.pick()).toBe('Beta');
  });

  test('pick returns cooldown player if no alternatives', () => {
    scorer.recordEvent({ type: 'death', player: 'Alpha', timestamp: Date.now() });
    camera.addCooldown('Alpha');
    // Only Alpha has events, so return Alpha despite cooldown
    expect(camera.pick()).toBe('Alpha');
  });

  test('shouldSwitch returns false before dwell time', () => {
    camera.setCurrentTarget('Alpha');
    expect(camera.shouldSwitch()).toBe(false);
  });

  test('shouldSwitch returns true after dwell time', async () => {
    camera.setCurrentTarget('Alpha');
    await new Promise(r => setTimeout(r, 150)); // wait > dwellMs
    scorer.recordEvent({ type: 'death', player: 'Beta', timestamp: Date.now() });
    expect(camera.shouldSwitch()).toBe(true);
  });

  test('shouldSwitch returns true immediately for death override', () => {
    camera.setCurrentTarget('Alpha');
    scorer.recordEvent({ type: 'death', player: 'Beta', timestamp: Date.now() });
    expect(camera.shouldSwitch({ forceOnDeath: true })).toBe(true);
  });

  test('human override pins to specific target', () => {
    scorer.recordEvent({ type: 'death', player: 'Alpha', timestamp: Date.now() });
    camera.setOverride('Beta');
    expect(camera.pick()).toBe('Beta');
    expect(camera.isOverridden()).toBe(true);
  });

  test('release override returns to auto', () => {
    camera.setOverride('Beta');
    camera.releaseOverride();
    scorer.recordEvent({ type: 'death', player: 'Alpha', timestamp: Date.now() });
    expect(camera.pick()).toBe('Alpha');
    expect(camera.isOverridden()).toBe(false);
  });

  test('getCurrentTarget returns null initially', () => {
    expect(camera.getCurrentTarget()).toBeNull();
  });
});
