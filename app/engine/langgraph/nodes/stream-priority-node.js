function calculateStreamPriorityScore(input = {}) {
  const action = input.action || {};
  const mission = input.mission || {};
  const missionTask = String(mission.task || '').toLowerCase();
  let score = 50;

  if (mission.source === 'viewer') {
    score += 30;
  }

  const amount = Number.parseFloat(mission.amount || '0') || 0;
  if (amount > 0) {
    score += Math.min(30, Math.round(amount * 10));
  }

  const missionPriority = String(mission.priority || 'normal').toLowerCase();
  if (missionPriority === 'high') score += 20;
  if (missionPriority === 'low') score -= 10;

  if (/fight|combat|danger|lava|mobs|raid/.test(missionTask)) score += 15;
  if (/build|construct|bridge|repair/.test(missionTask)) score += 5;
  if (/dig|mine|collect|gather/.test(missionTask)) score += 8;

  if (action.kind === 'fight' || action.kind === 'explore') score += 8;

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  let level = 'normal';
  if (clamped >= 85) level = 'critical';
  else if (clamped >= 65) level = 'high';
  else if (clamped >= 40) level = 'normal';
  else level = 'low';

  return {
    score: clamped,
    level,
    reason: `mission=${missionTask || 'manual'}; kind=${action.kind || 'idle'}; amount=${mission.amount || '0'}; priority=${missionPriority}`
  };
}

async function streamPriorityNode(state = {}) {
  return {
    streamPriority: calculateStreamPriorityScore(state)
  };
}

module.exports = {
  calculateStreamPriorityScore,
  streamPriorityNode
};
