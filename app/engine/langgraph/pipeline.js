const { personalityExtractionNode } = require('./nodes/personality-extraction-node');
const { voiceNode } = require('./nodes/voice-node');
const { avatarNode } = require('./nodes/avatar-node');
const { narrationNode } = require('./nodes/narration-node');
const { streamPriorityNode } = require('./nodes/stream-priority-node');

const DEFAULT_GRAPH = [
  {
    name: 'personalityExtraction',
    dependsOn: [],
    run: personalityExtractionNode
  },
  {
    name: 'voiceExtraction',
    dependsOn: ['personalityExtraction'],
    run: voiceNode
  },
  {
    name: 'avatarGeneration',
    dependsOn: ['personalityExtraction'],
    run: avatarNode
  },
  {
    name: 'narrationSeed',
    dependsOn: ['personalityExtraction', 'voiceExtraction', 'avatarGeneration'],
    run: narrationNode
  },
  {
    name: 'streamPriority',
    dependsOn: ['narrationSeed'],
    run: streamPriorityNode
  }
];

function buildPremiumPersonaGraph(customGraph = DEFAULT_GRAPH) {
  return {
    name: 'premium-persona-graph',
    nodes: customGraph.map((node) => ({ ...node }))
  };
}

async function executePremiumGraph(graph = buildPremiumPersonaGraph(), initialState = {}) {
  const state = { ...initialState };
  const pending = new Set(graph.nodes.map((node) => node.name));
  const done = new Set();
  const nodeByName = new Map(graph.nodes.map((node) => [node.name, node]));

  while (pending.size > 0) {
    let progressed = false;

    for (const name of [...pending]) {
      const node = nodeByName.get(name);
      const deps = node.dependsOn || [];
      const ready = deps.every((dep) => done.has(dep));
      if (!ready) continue;

      const update = node.run ? await node.run(state) : {};
      Object.assign(state, update || {});
      pending.delete(name);
      done.add(name);
      progressed = true;
    }

    if (!progressed) {
      const remaining = [...pending];
      const missing = remaining.filter((name) => {
        const node = nodeByName.get(name);
        return (node.dependsOn || []).some((dep) => !done.has(dep));
      });
      const error = new Error(`Premium graph stalled. Remaining nodes: ${missing.join(', ')}`);
      error.missingDependencies = missing;
      throw error;
    }
  }

  return state;
}

module.exports = {
  buildPremiumPersonaGraph,
  executePremiumGraph,
  DEFAULT_GRAPH
};
