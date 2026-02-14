#!/usr/bin/env node

const { AgentFleet } = require('./agents/agent-fleet');

function parseArgs() {
  const args = process.argv.slice(2);
  const configArg = args.find((value) => value.startsWith('--config='));
  return {
    configPath: configArg ? configArg.replace('--config=', '') : process.env.CLAWCRAFT_ENGINE_CONFIG || 'app/engine/config/agents.config.json'
  };
}

async function main() {
  const { configPath } = parseArgs();
  const fleet = new AgentFleet();
  const config = await AgentFleet.loadConfig(configPath);
  await fleet.initialize(config);
  await fleet.startAll();

  console.log(`ClawCraft engine running from config: ${configPath}`);
  console.log(`Agents online: ${fleet.agents.length}`);

  const stop = async () => {
    console.log('Stopping all agents...');
    await fleet.stopAll();
    process.exit(0);
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error) => {
  console.error('engine failed', error);
  process.exit(1);
});
