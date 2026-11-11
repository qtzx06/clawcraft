const pino = require('pino');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

class AgentMetrics {
  constructor() {
    // key: "teamId/agentName" → metrics object
    this.metrics = new Map();
  }

  _key(teamId, agentName) {
    return `${teamId}/${agentName}`;
  }

  _ensure(teamId, agentName) {
    const key = this._key(teamId, agentName);
    if (!this.metrics.has(key)) {
      this.metrics.set(key, {
        teamId,
        agentName,
        firstSeen: Date.now(),
        lastUpdate: 0,
        // Cumulative stats
        totalDistance: 0,
        deaths: 0,
        itemsCollected: 0,
        tasksCompleted: 0,
        // Snapshot tracking
        snapshots: 0,
        idleSnapshots: 0,
        // Recent health/food (last 60s worth, ~12 at 5s interval)
        healthHistory: [],
        foodHistory: [],
        // Previous state for diffing
        _prevPosition: null,
        _prevHealth: null,
        _prevInventoryCount: 0,
      });
    }
    return this.metrics.get(key);
  }

  recordSnapshot(teamId, agentName, state) {
    if (!state || !state.spawned) return;

    const m = this._ensure(teamId, agentName);
    m.lastUpdate = Date.now();
    m.snapshots++;

    // Distance traveled
    if (state.position && m._prevPosition) {
      const dx = (state.position.x || 0) - (m._prevPosition.x || 0);
      const dy = (state.position.y || 0) - (m._prevPosition.y || 0);
      const dz = (state.position.z || 0) - (m._prevPosition.z || 0);
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < 500) { // ignore teleports
        m.totalDistance += dist;
      }
      // Idle detection: moved less than 2 blocks
      if (dist < 2) {
        m.idleSnapshots++;
      }
    }
    if (state.position) {
      m._prevPosition = { ...state.position };
    }

    // Death detection
    if (m._prevHealth !== null && m._prevHealth > 0 && (state.health || 0) === 0) {
      m.deaths++;
      log.info({ teamId, agentName }, 'Agent death detected');
    }
    m._prevHealth = state.health || 0;

    // Items collected (inventory count increases)
    const currentCount = (state.inventory || []).reduce((sum, item) => sum + (item.count || 0), 0);
    if (currentCount > m._prevInventoryCount) {
      m.itemsCollected += currentCount - m._prevInventoryCount;
    }
    m._prevInventoryCount = currentCount;

    // Health/food history (keep last 12 entries ~60s)
    const MAX_HISTORY = 12;
    m.healthHistory.push({ time: Date.now(), value: state.health || 0 });
    m.foodHistory.push({ time: Date.now(), value: state.food || 0 });
    if (m.healthHistory.length > MAX_HISTORY) m.healthHistory.shift();
    if (m.foodHistory.length > MAX_HISTORY) m.foodHistory.shift();
  }

  recordTaskCompletion(teamId, agentName) {
    const m = this._ensure(teamId, agentName);
    m.tasksCompleted++;
  }

  getMetrics(teamId, agentName) {
    const m = this.metrics.get(this._key(teamId, agentName));
    if (!m) return null;

    const uptimeMs = m.lastUpdate - m.firstSeen;
    const uptimeMin = Math.max(1, uptimeMs / 60_000);

    return {
      teamId: m.teamId,
      agentName: m.agentName,
      uptime_ms: uptimeMs,
      snapshots: m.snapshots,
      // Cumulative
      total_distance: Math.round(m.totalDistance * 10) / 10,
      deaths: m.deaths,
      items_collected: m.itemsCollected,
      tasks_completed: m.tasksCompleted,
      // Rates
      items_per_min: Math.round((m.itemsCollected / uptimeMin) * 100) / 100,
      deaths_per_hr: Math.round((m.deaths / (uptimeMin / 60)) * 100) / 100,
      distance_per_min: Math.round((m.totalDistance / uptimeMin) * 10) / 10,
      idle_ratio: m.snapshots > 0 ? Math.round((m.idleSnapshots / m.snapshots) * 1000) / 1000 : 0,
      // Trends
      health_trend: m.healthHistory.slice(-6),
      food_trend: m.foodHistory.slice(-6),
    };
  }

  getAllMetrics() {
    const out = [];
    for (const m of this.metrics.values()) {
      out.push(this.getMetrics(m.teamId, m.agentName));
    }
    return out;
  }
}

module.exports = { AgentMetrics };
