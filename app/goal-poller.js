const pino = require('pino');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

class GoalPoller {
  constructor(agentManager, goalTracker, teamStore, opts = {}) {
    this.agentManager = agentManager;
    this.goalTracker = goalTracker;
    this.teamStore = teamStore;
    this.agentMetrics = opts.agentMetrics || null;
    this.intervalMs = opts.intervalMs || Number(process.env.GOAL_POLL_MS || 5000);
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.goalTracker.start();
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        log.warn({ err: err.message }, 'Goal poll tick failed');
      });
    }, this.intervalMs);
    log.info({ intervalMs: this.intervalMs }, 'Goal poller started');
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    const teams = this.teamStore.list();

    for (const team of teams) {
      const agents = this.agentManager.listAgents(team.team_id);

      for (const agent of agents) {
        if (agent.status !== 'running' || agent.self_hosted) continue;

        const state = await this.agentManager.proxyRequest(team.team_id, agent.name, 'GET', '/state');
        if (!state || !state.spawned) continue;

        // Record metrics snapshot
        if (this.agentMetrics) {
          this.agentMetrics.recordSnapshot(team.team_id, agent.name, state);
        }

        const ironGoal = this.goalTracker.getGoal('iron_forge');
        if (ironGoal && !ironGoal.winner) {
          const equipment = {
            head: state.equipment?.head || null,
            chest: state.equipment?.chest || null,
            legs: state.equipment?.legs || null,
            feet: state.equipment?.feet || null,
            hand: state.equipment?.hand || (state.inventory || []).find((item) => item.name === 'iron_sword') || null,
          };

          if (this.goalTracker.checkIronForge(equipment)) {
            this.goalTracker.declareWinner('iron_forge', team.team_id);
          }
        }

        const netherGoal = this.goalTracker.getGoal('nether_breach');
        if (netherGoal && !netherGoal.winner) {
          const dimension = state.dimension || 'overworld';
          if (this.goalTracker.checkNetherBreach(state.inventory || [], dimension)) {
            this.goalTracker.declareWinner('nether_breach', team.team_id);
          }
        }

        const diamondsHeld = (state.inventory || [])
          .filter((item) => item.name === 'diamond')
          .reduce((sum, item) => sum + Number(item.count || 0), 0);

        if (diamondsHeld > 0) {
          this.goalTracker.pushEvent({
            event: 'diamond_update',
            team_id: team.team_id,
            team: team.name,
            agent: agent.name,
            diamonds_held: diamondsHeld,
            time: Date.now(),
          });
        }
      }

      const diamondGoal = this.goalTracker.getGoal('diamond_vault');
      if (diamondGoal && !diamondGoal.winner) {
        if (this.goalTracker.checkDiamondVault(team.team_id)) {
          this.goalTracker.declareWinner('diamond_vault', team.team_id);
        }
      }
    }
  }
}

module.exports = { GoalPoller };
