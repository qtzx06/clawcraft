class CameraController {
  constructor(scorer, opts = {}) {
    this.scorer = scorer;
    this.dwellMs = opts.dwellMs ?? 8_000;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
    this.cycleMs = opts.cycleMs ?? 10_000;

    this.currentTarget = null;
    this.targetSetAt = 0;
    this.cooldowns = new Map(); // player -> expiry timestamp
    this.override = null;
  }

  pick() {
    if (this.override) return this.override;

    const cooledDown = [];
    const now = Date.now();
    for (const [player, expiry] of this.cooldowns) {
      if (now < expiry) cooledDown.push(player);
    }

    // Try without cooldown players first
    const best = this.scorer.getTopPlayer({ exclude: cooledDown });
    if (best) return best;

    // Fall back to cooldown players if nothing else
    return this.scorer.getTopPlayer();
  }

  shouldSwitch(opts = {}) {
    const now = Date.now();
    const dwellElapsed = now - this.targetSetAt >= this.dwellMs;

    if (opts.forceOnDeath) {
      const scores = this.scorer.getScores();
      for (const [player, score] of scores) {
        if (player !== this.currentTarget && score >= 100) return true;
      }
    }

    if (!dwellElapsed) return false;

    const next = this.pick();
    return next !== null && next !== this.currentTarget;
  }

  setCurrentTarget(player) {
    this.currentTarget = player;
    this.targetSetAt = Date.now();
  }

  getCurrentTarget() {
    return this.currentTarget;
  }

  addCooldown(player) {
    this.cooldowns.set(player, Date.now() + this.cooldownMs);
  }

  setOverride(player) {
    this.override = player;
  }

  releaseOverride() {
    this.override = null;
  }

  isOverridden() {
    return this.override !== null;
  }
}

module.exports = { CameraController };
