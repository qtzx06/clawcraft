const EVENT_CONFIG = {
  death:   { score: 100, decayMs: 0 },      // instant, no decay (show immediately)
  combat:  { score: 80,  decayMs: 5_000 },
  cluster: { score: 50,  decayMs: 15_000 },
  join:    { score: 40,  decayMs: 10_000 },
  chat:    { score: 30,  decayMs: 10_000 },
  build:   { score: 20,  decayMs: 30_000 },
};

class InterestScorer {
  constructor() {
    this.events = []; // { type, player, timestamp }
  }

  recordEvent(event) {
    this.events.push(event);
  }

  getScores() {
    const now = Date.now();
    const scores = new Map();

    for (const event of this.events) {
      const config = EVENT_CONFIG[event.type];
      if (!config) continue;

      let value = config.score;
      if (config.decayMs > 0) {
        const age = now - event.timestamp;
        const remaining = Math.max(0, 1 - age / config.decayMs);
        value = Math.round(config.score * remaining);
      } else {
        // instant events: full score if < 5s old, else 0
        const age = now - event.timestamp;
        value = age < 5_000 ? config.score : 0;
      }

      const current = scores.get(event.player) || 0;
      scores.set(event.player, current + value);
    }

    return scores;
  }

  getTopPlayer(opts = {}) {
    const exclude = new Set(opts.exclude || []);
    const scores = this.getScores();
    let best = null;
    let bestScore = 0;

    for (const [player, score] of scores) {
      if (exclude.has(player)) continue;
      if (score > bestScore) {
        best = player;
        bestScore = score;
      }
    }

    return best;
  }

  prune() {
    const now = Date.now();
    const maxAge = 60_000; // prune events older than 60s
    this.events = this.events.filter(e => now - e.timestamp < maxAge);
  }
}

module.exports = { InterestScorer, EVENT_CONFIG };
