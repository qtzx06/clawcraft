class ObsController {
  constructor(ws) {
    this.ws = ws;
  }

  async switchScene(sceneName) {
    return this.ws.call('SetCurrentProgramScene', { sceneName });
  }

  async setTransition(transitionName, durationMs) {
    await this.ws.call('SetCurrentSceneTransition', { transitionName });
    if (durationMs != null) {
      await this.ws.call('SetCurrentSceneTransitionDuration', {
        transitionDuration: durationMs,
      });
    }
  }

  async cutTo(sceneName) {
    await this.setTransition('Cut');
    await this.switchScene(sceneName);
  }

  async fadeTo(sceneName, durationMs = 500) {
    await this.setTransition('Fade', durationMs);
    await this.switchScene(sceneName);
  }

  async refreshBrowserSource(inputName) {
    return this.ws.call('PressInputPropertiesButton', {
      inputName,
      propertyName: 'refreshnocache',
    });
  }
}

module.exports = { ObsController };
