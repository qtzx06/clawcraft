const pino = require('pino');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

class GoalTracker {
  constructor() {
    this.goals = [
      {
        id: 'iron_forge',
        title: 'Iron Forge',
        prize: '$25',
        description: 'One agent wears full iron armor and an iron sword',
        status: 'active',
        winner: null,
        won_at: null,
        standings: {},
      },
      {
        id: 'diamond_vault',
        title: 'Diamond Vault',
        prize: '$50',
        description: 'Deposit 100 diamonds in a chest',
        status: 'active',
        winner: null,
        won_at: null,
        standings: {},
      },
      {
        id: 'nether_breach',
        title: 'Nether Breach',
        prize: '$100',
        description: 'Hold a blaze rod in the Overworld',
        status: 'active',
        winner: null,
        won_at: null,
        standings: {},
      },
    ];

    this.diamondCounts = new Map();
    this.events = [];
    this.listeners = new Set();
    this.startedAt = null;
  }

  start() {
    this.startedAt = Date.now();
  }

  getGoals() {
    return this.goals;
  }

  getGoal(id) {
    return this.goals.find((goal) => goal.id === id) || null;
  }

  checkIronForge(equipment) {
    if (!equipment) return false;
    return (
      equipment.head?.name === 'iron_helmet' &&
      equipment.chest?.name === 'iron_chestplate' &&
      equipment.legs?.name === 'iron_leggings' &&
      equipment.feet?.name === 'iron_boots' &&
      equipment.hand?.name === 'iron_sword'
    );
  }

  recordDiamondDeposit(teamId, count) {
    const current = this.diamondCounts.get(teamId) || 0;
    this.diamondCounts.set(teamId, current + count);
  }

  getDiamondCount(teamId) {
    return this.diamondCounts.get(teamId) || 0;
  }

  checkDiamondVault(teamId) {
    return this.getDiamondCount(teamId) >= 100;
  }

  checkNetherBreach(inventory, dimension) {
    if (!Array.isArray(inventory)) return false;
    if (dimension !== 'overworld') return false;
    return inventory.some((item) => item?.name === 'blaze_rod');
  }

  declareWinner(goalId, teamId) {
    const goal = this.getGoal(goalId);
    if (!goal || goal.winner) return false;

    goal.winner = teamId;
    goal.status = 'complete';
    goal.won_at = Date.now();

    this.pushEvent({
      event: 'goal_complete',
      goal: goalId,
      title: goal.title,
      prize: goal.prize,
      winner: teamId,
      time: goal.won_at,
    });

    log.info({ goalId, teamId }, 'Goal won');
    return true;
  }

  pushEvent(data) {
    this.events.push(data);
    if (this.events.length > 500) {
      this.events.shift();
    }

    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const listener of this.listeners) {
      try {
        listener.write(payload);
      } catch (_err) {
        // ignore broken listeners
      }
    }
  }

  addListener(res) {
    this.listeners.add(res);
    res.on('close', () => {
      this.listeners.delete(res);
    });
  }

  getStandings(teamStore) {
    const teams = teamStore.list();
    return this.goals.map((goal) => ({
      ...goal,
      standings: teams.map((team) => {
        const progress = goal.id === 'diamond_vault'
          ? `${this.getDiamondCount(team.team_id)}/100 diamonds`
          : goal.standings[team.team_id] || 'in progress';

        return {
          team: team.name,
          team_id: team.team_id,
          agents: team.agent_count,
          progress,
        };
      }),
    }));
  }
}

module.exports = { GoalTracker };
