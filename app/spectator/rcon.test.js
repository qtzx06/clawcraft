import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { SpectatorRcon } from './rcon.js';

describe('SpectatorRcon', () => {
  let rcon;
  let mockSend;

  beforeEach(() => {
    mockSend = mock(() => Promise.resolve('Teleported SpectatorCam'));
    rcon = new SpectatorRcon({
      send: mockSend,
      spectatorUsername: 'SpectatorCam',
    });
  });

  test('teleportToPlayer sends /tp command', async () => {
    await rcon.teleportToPlayer('AgentAlpha');
    expect(mockSend).toHaveBeenCalledWith('minecraft:tp SpectatorCam AgentAlpha');
  });

  test('teleportToPosition sends /tp with coords', async () => {
    await rcon.teleportToPosition(100, 80, 200, 45, 0);
    expect(mockSend).toHaveBeenCalledWith('minecraft:tp SpectatorCam 100 80 200 45 0');
  });

  test('spectatePlayer sends /spectate command', async () => {
    await rcon.spectatePlayer('AgentBeta');
    expect(mockSend).toHaveBeenCalledWith(
      'minecraft:execute as SpectatorCam at SpectatorCam run minecraft:spectate @e[type=player,name=AgentBeta,limit=1]'
    );
  });

  test('setSpectatorMode sends /gamemode command', async () => {
    await rcon.setSpectatorMode();
    expect(mockSend).toHaveBeenCalledWith('minecraft:execute as SpectatorCam run minecraft:gamemode spectator @s');
  });
});
