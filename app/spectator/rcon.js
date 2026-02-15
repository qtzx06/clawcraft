class SpectatorRcon {
  constructor(opts) {
    this.send = opts.send;
    this.username = opts.spectatorUsername || 'SpectatorCam';
  }

  async teleportToPlayer(target) {
    // Namespaced to avoid plugin command conflicts.
    return this.send(`minecraft:tp ${this.username} ${target}`);
  }

  async teleportToPosition(x, y, z, pitch, yaw) {
    return this.send(`minecraft:tp ${this.username} ${x} ${y} ${z} ${pitch} ${yaw}`);
  }

  async spectatePlayer(target) {
    // Avoid GameProfile parsing issues by executing as the spectator and omitting the 2nd argument.
    // Also use an entity selector for the target so we're explicitly spectating a player entity.
    // Note: target/player names are expected to be standard MC usernames: [A-Za-z0-9_]+
    return this.send(
      `minecraft:execute as ${this.username} at ${this.username} run minecraft:spectate @e[type=player,name=${target},limit=1]`
    );
  }

  async setSpectatorMode() {
    // Run as the spectator to avoid selector/profile edge-cases.
    return this.send(`minecraft:execute as ${this.username} run minecraft:gamemode spectator @s`);
  }
}

module.exports = { SpectatorRcon };
