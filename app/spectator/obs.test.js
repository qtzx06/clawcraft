import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { ObsController } from './obs.js';

describe('ObsController', () => {
  let obs;
  let mockCall;

  beforeEach(() => {
    mockCall = mock(() => Promise.resolve({}));
    obs = new ObsController({ call: mockCall });
  });

  test('switchScene calls SetCurrentProgramScene', async () => {
    await obs.switchScene('AgentPOV');
    expect(mockCall).toHaveBeenCalledWith('SetCurrentProgramScene', {
      sceneName: 'AgentPOV',
    });
  });

  test('setTransition calls SetCurrentSceneTransition', async () => {
    await obs.setTransition('Fade', 500);
    expect(mockCall).toHaveBeenCalledWith('SetCurrentSceneTransition', {
      transitionName: 'Fade',
    });
    expect(mockCall).toHaveBeenCalledWith('SetCurrentSceneTransitionDuration', {
      transitionDuration: 500,
    });
  });

  test('cutTo switches with Cut transition', async () => {
    await obs.cutTo('Overhead');
    expect(mockCall).toHaveBeenCalledWith('SetCurrentSceneTransition', {
      transitionName: 'Cut',
    });
    expect(mockCall).toHaveBeenCalledWith('SetCurrentProgramScene', {
      sceneName: 'Overhead',
    });
  });

  test('fadeTo switches with Fade transition', async () => {
    await obs.fadeTo('AgentPOV', 500);
    expect(mockCall).toHaveBeenCalledWith('SetCurrentSceneTransition', {
      transitionName: 'Fade',
    });
    expect(mockCall).toHaveBeenCalledWith('SetCurrentSceneTransitionDuration', {
      transitionDuration: 500,
    });
    expect(mockCall).toHaveBeenCalledWith('SetCurrentProgramScene', {
      sceneName: 'AgentPOV',
    });
  });

  test('refreshBrowserSource calls PressInputPropertiesButton', async () => {
    await obs.refreshBrowserSource('HUD');
    expect(mockCall).toHaveBeenCalledWith('PressInputPropertiesButton', {
      inputName: 'HUD',
      propertyName: 'refreshnocache',
    });
  });
});
