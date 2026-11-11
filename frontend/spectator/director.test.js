import { describe, test, expect, mock } from 'bun:test';
import { InterestScorer } from './scorer.js';
import { CameraController } from './camera.js';
import { SpectatorRcon } from './rcon.js';
import { ObsController } from './obs.js';

describe('Director integration', () => {
  test('full tick cycle: event -> score -> pick -> rcon + obs', async () => {
    const scorer = new InterestScorer();
    const camera = new CameraController(scorer, {
      dwellMs: 0,
      cooldownMs: 100,
      cycleMs: 50,
    });

    const rconSend = mock(() => Promise.resolve('ok'));
    const rcon = new SpectatorRcon({ send: rconSend, spectatorUsername: 'SpectatorCam' });

    const obsCall = mock(() => Promise.resolve({}));
    const obs = new ObsController({ call: obsCall });

    // Simulate events
    scorer.recordEvent({ type: 'death', player: 'AgentAlpha', timestamp: Date.now() });
    scorer.recordEvent({ type: 'chat', player: 'AgentBeta', timestamp: Date.now() });

    // Director tick
    const next = camera.pick();
    expect(next).toBe('AgentAlpha');

    camera.setCurrentTarget(next);
    await rcon.spectatePlayer(next);
    await obs.cutTo('AgentPOV');

    expect(rconSend).toHaveBeenCalledWith('spectate AgentAlpha SpectatorCam');
    expect(obsCall).toHaveBeenCalledWith('SetCurrentProgramScene', { sceneName: 'AgentPOV' });

    // Second tick: Alpha on cooldown, should pick Beta
    camera.addCooldown('AgentAlpha');
    scorer.recordEvent({ type: 'combat', player: 'AgentBeta', timestamp: Date.now() });
    const next2 = camera.pick();
    expect(next2).toBe('AgentBeta');
  });
});
