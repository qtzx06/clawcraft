const { buildPremiumPersonaGraph, executePremiumGraph, DEFAULT_GRAPH } = require('./pipeline');

async function runPremiumPersonaGraph(input = {}) {
  const graph = buildPremiumPersonaGraph(DEFAULT_GRAPH);
  const state = await executePremiumGraph(graph, input);

  return {
    profile: state.profile,
    voice: state.voice,
    avatarPrompt: state.avatarPrompt,
    narrationSeed: state.narrationSeed,
    narration: state.narration,
    streamPriority: state.streamPriority,
    action: state.action || {},
    mission: state.mission || null,
    executedNodes: graph.nodes.map((node) => node.name)
  };
}

module.exports = {
  runPremiumPersonaGraph,
  buildPremiumPersonaGraph,
  executePremiumGraph,
  DEFAULT_GRAPH
};
