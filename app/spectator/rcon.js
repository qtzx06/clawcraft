class SpectatorRcon {
  constructor(opts) {
    this.send = opts.send;
    this.username = opts.spectatorUsername || 'SpectatorCam';
  }

  async teleportToPlayer(target) {
    return this.send(`tp ${this.username} ${target}`);
  }

  async teleportToPosition(x, y, z, pitch, yaw) {
    return this.send(`tp ${this.username} ${x} ${y} ${z} ${pitch} ${yaw}`);
  }

  async spectatePlayer(target) {
    return this.send(`spectate ${target} ${this.username}`);
  }

  async setSpectatorMode() {
    return this.send(`gamemode spectator ${this.username}`);
  }
}

module.exports = { SpectatorRcon };
