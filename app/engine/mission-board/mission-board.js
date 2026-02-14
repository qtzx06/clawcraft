const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');

const PRIORITY_ORDER = { low: 0, normal: 1, high: 2 };
const MAX_HISTORY = 200;

const DEFAULT_MISSION = {
  version: 1,
  collective_goal: 'Build an exciting village before nightfall.',
  missions: [],
  viewer_missions: [],
  updated_at: new Date(0).toISOString()
};

function nowIso() {
  return new Date().toISOString();
}

function clampPriority(value) {
  const normalized = String(value || 'normal').toLowerCase();
  if (PRIORITY_ORDER[normalized] === undefined) return 'normal';
  return normalized;
}

function clampSource(value) {
  const source = String(value || 'system').toLowerCase();
  return source === 'viewer' ? 'viewer' : 'system';
}

function normalizeMission(raw, source = 'system', status = 'open') {
  const missionSource = clampSource(raw.source || source);
  const normalized = {
    id: raw.id || randomUUID(),
    task: String(raw.task || '').trim(),
    source: missionSource,
    status: String(raw.status || status || 'open').toLowerCase(),
    assigned_to: raw.assigned_to || raw.assigned || null,
    priority: clampPriority(raw.priority || (missionSource === 'viewer' ? 'normal' : 'normal')),
    tipper: missionSource === 'viewer' ? String(raw.tipper || 'system').trim() : undefined,
    amount: missionSource === 'viewer' ? String(raw.amount || '0').trim() : undefined,
    depends_on: Array.isArray(raw.depends_on) ? raw.depends_on : [],
    progress: {
      text: String((raw.progress && raw.progress.text) || '').trim() || 'Waiting for agent',
      updated_at: String((raw.progress && raw.progress.updated_at) || nowIso())
    },
    created_at: String(raw.created_at || nowIso()),
    updated_at: String(raw.updated_at || nowIso()),
    metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {}
  };

  if (!normalized.task) {
    throw new Error('mission task required');
  }

  if (!['open', 'in_progress', 'done', 'blocked', 'failed'].includes(normalized.status)) {
    normalized.status = 'open';
  }

  if (normalized.assigned_to && normalized.status === 'open') {
    normalized.status = 'in_progress';
  }

  return normalized;
}

function sortMissions(a, b) {
  if (a.source !== b.source) {
    return a.source === 'viewer' ? -1 : 1;
  }

  const p = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
  if (p !== 0) return p;

  if (a.source === 'viewer' && b.source === 'viewer') {
    const va = Number.parseFloat(a.amount || '0') || 0;
    const vb = Number.parseFloat(b.amount || '0') || 0;
    if (va !== vb) return vb - va;
  }

  return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
}

class MissionBoard {
  constructor({ stateFilePath, seed = {} } = {}) {
    this.stateFilePath = path.resolve(process.cwd(), stateFilePath || path.join('app', 'engine', 'mission-board', 'state.runtime.json'));
    this.seed = seed || {};
    this.state = this._buildInitialState(seed);
    this._locked = Promise.resolve();
  }

  _buildInitialState(seed = {}) {
    const now = nowIso();
    const next = JSON.parse(JSON.stringify(DEFAULT_MISSION));
    next.collective_goal = seed.collective_goal || next.collective_goal;
    next.updated_at = now;
    next.missions = [];
    next.viewer_missions = [];
    return next;
  }

  async initialize(seed = this.seed) {
    return this._withLock(async () => {
      const fileState = await this._readStateFromDisk();
      const merged = this._mergeSeed(fileState, seed || {});
      this.seed = seed || {};
      this.state = merged;
      await this._persist();
      return this._snapshot();
    });
  }

  async _readStateFromDisk() {
    try {
      const raw = await fs.readFile(this.stateFilePath, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === 'ENOENT') return this._buildInitialState(this.seed);
      throw error;
    }
  }

  _mergeSeed(fileState, seed = {}) {
    const merged = this._buildInitialState(seed);
    if (!fileState || typeof fileState !== 'object') return merged;

    merged.collective_goal = fileState.collective_goal || merged.collective_goal;
    merged.missions = this._normalizeList(fileState.missions || [], 'system');
    merged.viewer_missions = this._normalizeList(fileState.viewer_missions || [], 'viewer');

    if (seed.missions) {
      merged.missions = this._normalizeList(seed.missions, 'system');
    }
    if (seed.viewer_missions) {
      merged.viewer_missions = this._normalizeList(seed.viewer_missions, 'viewer');
    }

    merged.version = fileState.version || merged.version;
    merged.updated_at = nowIso();
    return merged;
  }

  _normalizeList(inputList, source) {
    const list = Array.isArray(inputList) ? inputList : [];
    return list
      .map((entry) => {
        try {
          return normalizeMission(entry, source);
        } catch (_e) {
          return null;
        }
      })
      .filter(Boolean)
      .sort(sortMissions);
  }

  _snapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  async _persist() {
    const dir = path.dirname(this.stateFilePath);
    await fs.mkdir(dir, { recursive: true });
    const tempPath = `${this.stateFilePath}.tmp`;
    this.state.updated_at = nowIso();
    await fs.writeFile(tempPath, JSON.stringify(this.state, null, 2), 'utf8');
    await fs.rename(tempPath, this.stateFilePath);
  }

  async _withLock(task) {
    const run = this._locked.then(task);
    this._locked = run.catch(() => {});
    return run;
  }

  async getSnapshot() {
    return this._withLock(async () => this._snapshot());
  }

  async getOpenMissions() {
    return this._withLock(async () => {
      return [...this.state.missions, ...this.state.viewer_missions]
        .filter((m) => m.status === 'open')
        .sort(sortMissions)
        .map((mission, index) => ({ ...mission, rank: index + 1 }));
    });
  }

  async getMissionsForAgent(agentId) {
    return this._withLock(async () => {
      const filtered = [...this.state.missions, ...this.state.viewer_missions].filter(
        (m) => m.assigned_to === agentId
      );
      return filtered.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    });
  }

  async _findMission(missionId) {
    const all = [...this.state.missions, ...this.state.viewer_missions];
    const index = all.findIndex((item) => String(item.id) === String(missionId));
    if (index === -1) return null;
    return { mission: all[index], fromMissions: index < this.state.missions.length ? 'missions' : 'viewer_missions', index };
  }

  async _appendMission(rawMission, source = 'system') {
    const mission = normalizeMission(rawMission, source);
    const key = mission.source === 'viewer' ? 'viewer_missions' : 'missions';
    const list = [...this.state[key], mission];
    this.state[key] = list.sort(sortMissions);
    this._persist();
    return mission;
  }

  async addSystemMission(mission) {
    return this._withLock(async () => {
      const created = await this._appendMission(mission, 'system');
      await this._persist();
      return created;
    });
  }

  async addViewerMission({ task, tipper = 'anonymous', amount = '0', priority = 'normal' }) {
    return this._withLock(async () => {
      const created = await this._appendMission(
        { task, tipper, amount, priority, source: 'viewer' },
        'viewer'
      );
      await this._persist();
      return created;
    });
  }

  async claimMission(agentId, missionId = null) {
    return this._withLock(async () => {
      const open = await this.getOpenMissions();
      const missionToClaim = missionId
        ? open.find((mission) => String(mission.id) === String(missionId))
        : open[0];

      if (!missionToClaim) return null;

      const located = await this._findMission(missionToClaim.id);
      if (!located) return null;

      const list = located.fromMissions === 'missions' ? this.state.missions : this.state.viewer_missions;
      const target = list[located.index];
      if (!target || target.status !== 'open') return null;

      target.status = 'in_progress';
      target.assigned_to = agentId;
      target.updated_at = nowIso();
      target.progress = {
        text: `Claimed by ${agentId}`,
        updated_at: nowIso()
      };
      list[located.index] = target;
      await this._persist();
      return this._snapshotForMission(target);
    });
  }

  async releaseMission(agentId, missionId, reason = 'released') {
    return this._withLock(async () => {
      const missionMeta = await this._findMission(missionId);
      if (!missionMeta) return false;
      const target = missionMeta.mission;
      if (target.assigned_to !== agentId) return false;
      target.assigned_to = null;
      target.status = 'open';
      target.updated_at = nowIso();
      target.progress = {
        text: reason,
        updated_at: nowIso()
      };
      await this._persist();
      return true;
    });
  }

  async updateMission(missionId, patch = {}) {
    return this._withLock(async () => {
      const missionMeta = await this._findMission(missionId);
      if (!missionMeta) return null;

      const target = missionMeta.mission;
      const updates = typeof patch === 'object' && patch ? patch : {};
      const next = { ...target, ...updates };
      if (updates.status) next.status = updates.status;
      if (updates.assigned_to !== undefined) next.assigned_to = updates.assigned_to;
      next.progress = {
        text: (updates.progress && updates.progress.text) || target.progress.text,
        updated_at: nowIso()
      };
      next.updated_at = nowIso();

      if (!Array.isArray(next.depends_on)) next.depends_on = [];
      if (!['open', 'in_progress', 'done', 'blocked', 'failed'].includes(next.status)) {
        next.status = 'in_progress';
      }

      if (next.assigned_to && next.status === 'open') {
        next.status = 'in_progress';
      }

      missionMeta.fromMissions === 'missions'
        ? this.state.missions[missionMeta.index] = next
        : this.state.viewer_missions[missionMeta.index] = next;

      this.state.missions = this.state.missions.sort(sortMissions);
      this.state.viewer_missions = this.state.viewer_missions.sort(sortMissions);
      await this._persist();
      return this._snapshotForMission(next);
    });
  }

  async completeMission(agentId, missionId, summary = '') {
    return this.updateMission(missionId, {
      status: 'done',
      assigned_to: agentId,
      progress: {
        text: summary || 'completed',
        updated_at: nowIso()
      },
      metadata: { completed_by: agentId }
    });
  }

  async failMission(agentId, missionId, summary = '') {
    return this.updateMission(missionId, {
      status: 'failed',
      assigned_to: agentId,
      progress: {
        text: summary || 'failed',
        updated_at: nowIso()
      },
      metadata: { failed_by: agentId }
    });
  }

  async blockMission(agentId, missionId, summary = '') {
    return this.updateMission(missionId, {
      status: 'blocked',
      assigned_to: agentId,
      progress: {
        text: summary || 'blocked',
        updated_at: nowIso()
      },
      metadata: { blocked_by: agentId }
    });
  }

  _snapshotForMission(mission) {
    return {
      ...mission,
      history: mission.history
        ? mission.history.slice(-MAX_HISTORY)
        : []
    };
  }

  async reset(seed = this.seed) {
    return this._withLock(async () => {
      this.state = this._mergeSeed({
        ...this._buildInitialState(seed),
        missions: seed.missions || [],
        viewer_missions: seed.viewer_missions || []
      }, seed);
      await this._persist();
      return this._snapshot();
    });
  }
}

module.exports = {
  MissionBoard,
  normalizeMission,
  sortMissions
};
