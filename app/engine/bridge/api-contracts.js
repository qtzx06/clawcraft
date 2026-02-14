const fs = require('fs/promises');
const path = require('path');
const { MissionBoard } = require('../mission-board/mission-board');
const { buildPremiumContext } = require('../persona/persona-graph');

let boardSingleton = null;
let configSeed = null;

async function readSeedFromConfig(configPath = path.join('app', 'engine', 'config', 'agents.config.json')) {
  if (configSeed) return configSeed;
  const resolved = path.resolve(process.cwd(), configPath);
  const raw = await fs.readFile(resolved, 'utf8');
  const config = JSON.parse(raw);
  configSeed = config.seed || {};
  return configSeed;
}

function boardConfigPath() {
  return process.env.CLAWCRAFT_MISSION_BOARD || path.join('app', 'engine', 'mission-board', 'state.runtime.json');
}

async function getBoard() {
  if (boardSingleton) return boardSingleton;
  const seed = await readSeedFromConfig();
  boardSingleton = new MissionBoard({
    stateFilePath: boardConfigPath(),
    seed
  });
  await boardSingleton.initialize(seed);
  return boardSingleton;
}

async function getMissionBoard() {
  const board = await getBoard();
  return board.getSnapshot();
}

async function claimMission({ agent_id, mission_id }) {
  const board = await getBoard();
  return board.claimMission(agent_id, mission_id || null);
}

async function updateMissionProgress({ mission_id, status, progress }) {
  const board = await getBoard();
  return board.updateMission(mission_id, {
    status: status || 'in_progress',
    progress: {
      text: progress || 'update'
    }
  });
}

async function postViewerMission({ task, tipper = 'anonymous', amount = '0', priority = 'normal' }) {
  const board = await getBoard();
  return board.addViewerMission({ task, tipper, amount, priority });
}

async function missionForAgent(agentId) {
  const board = await getBoard();
  const missions = await board.getMissionsForAgent(agentId);
  return missions.find((m) => m.status === 'in_progress') || null;
}

async function premiumContextFromSoul(soulSource) {
  return buildPremiumContext(soulSource, {}, {});
}

async function clearMissionBoard() {
  const board = await getBoard();
  return board.reset(configSeed || {});
}

module.exports = {
  getMissionBoard,
  claimMission,
  updateMissionProgress,
  postViewerMission,
  missionForAgent,
  premiumContextFromSoul,
  clearMissionBoard
};
