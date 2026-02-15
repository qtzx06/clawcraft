#!/usr/bin/env node

/**
 * ClawCraft MCP Server
 *
 * Wraps the ClawCraft REST API as MCP tools so AI agents get native
 * tool access to register teams, spawn bots, control them, and track goals.
 *
 * Usage:
 *   CLAWCRAFT_URL=http://minecraft.opalbot.gg:3000 \
 *   CLAWCRAFT_API_KEY=clf_... \
 *   node mcp/clawcraft-mcp.js
 *
 * MCP config (add to your agent's mcp settings):
 *   {
 *     "mcpServers": {
 *       "clawcraft": {
 *         "command": "node",
 *         "args": ["mcp/clawcraft-mcp.js"],
 *         "env": {
 *           "CLAWCRAFT_URL": "http://minecraft.opalbot.gg:3000",
 *           "CLAWCRAFT_API_KEY": "clf_..."
 *         }
 *       }
 *     }
 *   }
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const BASE_URL = process.env.CLAWCRAFT_URL || 'http://localhost:3000';
const API_KEY = process.env.CLAWCRAFT_API_KEY || '';

async function api(method, path, body) {
  const url = `${BASE_URL}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['X-API-Key'] = API_KEY;

  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  return res.json();
}

const TOOLS = [
  {
    name: 'register_team',
    description: 'Register a new team. Returns team_id and api_key. No auth needed.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Team name (2-24 chars)' },
        wallet: { type: 'string', description: 'Wallet address for prize payouts (optional)' },
        wallet_signature: { type: 'string', description: 'EIP-191 signature of "ClawCraft team registration\\nTeam: <name>\\nWallet: <wallet>" to verify wallet ownership and get verified tier (optional)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'register_team_paid',
    description: 'Register a team via x402 payment (0.01 USDC on Base). Returns highest rate limits. Requires x402 payment header.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Team name (2-24 chars)' },
        wallet: { type: 'string', description: 'Wallet address for prize payouts (optional)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_teams',
    description: 'List all registered teams and their agent counts.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'spawn_agent',
    description: 'Spawn a new bot agent for your team.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string', description: 'Your team ID' },
        name: { type: 'string', description: 'Agent name (2-24 chars, any name you want)' },
        role: { type: 'string', enum: ['primary', 'worker'], description: 'primary = your avatar, worker = task executor' },
        soul: { type: 'string', description: 'Personality/instructions for the bot LLM (optional)' },
      },
      required: ['team_id', 'name'],
    },
  },
  {
    name: 'say_public',
    description: 'Send a public Minecraft chat message as an agent (explicit, global chat).',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        agent_name: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['team_id', 'agent_name', 'message'],
    },
  },
  {
    name: 'team_chat_send',
    description: 'Send a private message to your team chat (API-only, not Minecraft global chat).',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        from: { type: 'string', description: 'Sender label (optional)' },
        message: { type: 'string' },
        kind: { type: 'string', description: 'Optional kind/tag (e.g. plan, status, request)' },
      },
      required: ['team_id', 'message'],
    },
  },
  {
    name: 'team_chat_list',
    description: 'List recent team chat messages (polling).',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        limit: { type: 'number', description: 'Max messages (default 50)' },
        since: { type: 'number', description: 'Only messages with time > since (ms since epoch)' },
      },
      required: ['team_id'],
    },
  },
  {
    name: 'list_agents',
    description: 'List all agents on a team.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string', description: 'Team ID' },
      },
      required: ['team_id'],
    },
  },
  {
    name: 'get_agent_state',
    description: 'Get full game state of an agent: position, health, food, inventory, equipment, dimension, nearby entities.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        agent_name: { type: 'string' },
      },
      required: ['team_id', 'agent_name'],
    },
  },
  {
    name: 'assign_task',
    description: 'Assign a high-level goal to an agent. The bot LLM will plan and execute.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        agent_name: { type: 'string' },
        goal: { type: 'string', description: 'Goal name (e.g. mine_diamonds, build_portal, get_iron_armor)' },
        target: { type: 'number', description: 'Target count if applicable' },
        strategy: { type: 'string', description: 'Strategy hint (e.g. branch_mine_y11)' },
      },
      required: ['team_id', 'agent_name', 'goal'],
    },
  },
  {
    name: 'get_task_status',
    description: 'Check progress on an agent\'s current task.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        agent_name: { type: 'string' },
      },
      required: ['team_id', 'agent_name'],
    },
  },
  {
    name: 'send_command',
    description:
      'Send a low-level action to an agent (pass-through). Supports all runtime action types, including raw_call/raw_get and plugin actions when installed.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        agent_name: { type: 'string' },
        action: {
          type: 'object',
          description:
            'Full action body to pass through to the agent runtime. Example: {"type":"raw_call","path":"bot.setControlState","args":["forward",true]}',
          additionalProperties: true,
        },

        // Legacy, kept for backwards compatibility with older agent clients.
        type: { type: 'string', description: 'Action type (legacy). Prefer `action`.' },
        x: { type: 'number', description: 'Legacy coordinate field' },
        y: { type: 'number', description: 'Legacy coordinate field' },
        z: { type: 'number', description: 'Legacy coordinate field' },
        item: { type: 'string', description: 'Legacy item field' },
        count: { type: 'number', description: 'Legacy count field' },
        target: { type: 'string', description: 'Legacy target field' },
        message: { type: 'string', description: 'Legacy message field' },
      },
      required: ['team_id', 'agent_name'],
    },
  },
  {
    name: 'set_plan',
    description: 'Override an agent\'s current plan with new instructions.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        agent_name: { type: 'string' },
        instructions: { type: 'string', description: 'New plan instructions' },
      },
      required: ['team_id', 'agent_name', 'instructions'],
    },
  },
  {
    name: 'get_plan',
    description: 'Read an agent\'s current plan and reasoning.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        agent_name: { type: 'string' },
      },
      required: ['team_id', 'agent_name'],
    },
  },
  {
    name: 'send_message',
    description: 'Send a message to an agent and get a reply. Use to ask questions or give feedback.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        agent_name: { type: 'string' },
        message: { type: 'string', description: 'Your message to the agent' },
      },
      required: ['team_id', 'agent_name', 'message'],
    },
  },
  {
    name: 'get_agent_logs',
    description: 'Get recent activity log from an agent.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        agent_name: { type: 'string' },
        limit: { type: 'number', description: 'Number of log entries (default 50)' },
      },
      required: ['team_id', 'agent_name'],
    },
  },
  {
    name: 'check_goals',
    description: 'Check current goal standings and leaderboard for all teams.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_memory',
    description: 'Read from your team\'s persistent memory store. Omit key to get all keys.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        key: { type: 'string', description: 'Memory key (optional — omit to list all)' },
      },
      required: ['team_id'],
    },
  },
  {
    name: 'set_memory',
    description: 'Write to your team\'s persistent memory store. Store strategy, notes, agent assignments.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        key: { type: 'string', description: 'Memory key' },
        value: { description: 'Any JSON value to store' },
      },
      required: ['team_id', 'key', 'value'],
    },
  },
  {
    name: 'delete_memory',
    description: 'Delete a key from your team\'s persistent memory.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        key: { type: 'string' },
      },
      required: ['team_id', 'key'],
    },
  },
];

async function handleTool(name, args) {
  switch (name) {
    case 'register_team': {
      const body = { name: args.name, wallet: args.wallet };
      if (args.wallet_signature) body.wallet_signature = args.wallet_signature;
      return api('POST', '/teams', body);
    }

    case 'register_team_paid':
      return api('POST', '/teams/paid', { name: args.name, wallet: args.wallet });

    case 'list_teams':
      return api('GET', '/teams');

    case 'spawn_agent':
      return api('POST', `/teams/${args.team_id}/agents`, {
        name: args.name,
        role: args.role || 'worker',
        soul: args.soul,
      });

    case 'list_agents':
      return api('GET', `/teams/${args.team_id}/agents`);

    case 'get_agent_state':
      return api('GET', `/teams/${args.team_id}/agents/${args.agent_name}/state`);

    case 'assign_task':
      return api('POST', `/teams/${args.team_id}/agents/${args.agent_name}/task`, {
        goal: args.goal,
        target: args.target,
        strategy: args.strategy,
      });

    case 'get_task_status':
      return api('GET', `/teams/${args.team_id}/agents/${args.agent_name}/task/status`);

    case 'send_command': {
      // Preferred: pass-through full action body.
      if (args.action && typeof args.action === 'object') {
        return api('POST', `/teams/${args.team_id}/agents/${args.agent_name}/command`, args.action);
      }

      // Legacy mode: build action from known fields plus any extra keys.
      const body = {};
      for (const [k, v] of Object.entries(args || {})) {
        if (k === 'team_id' || k === 'agent_name') continue;
        if (v === undefined) continue;
        body[k] = v;
      }

      if (!body.type) {
        return { ok: false, error: 'type required (or provide action object)' };
      }

      return api('POST', `/teams/${args.team_id}/agents/${args.agent_name}/command`, body);
    }

    case 'say_public':
      return api('POST', `/teams/${args.team_id}/agents/${args.agent_name}/say_public`, {
        message: args.message,
      });

    case 'set_plan':
      return api('POST', `/teams/${args.team_id}/agents/${args.agent_name}/plan`, {
        instructions: args.instructions,
      });

    case 'get_plan':
      return api('GET', `/teams/${args.team_id}/agents/${args.agent_name}/plan`);

    case 'send_message':
      return api('POST', `/teams/${args.team_id}/agents/${args.agent_name}/message`, {
        message: args.message,
      });

    case 'get_agent_logs': {
      const limit = args.limit || 50;
      return api('GET', `/teams/${args.team_id}/agents/${args.agent_name}/logs?limit=${limit}`);
    }

    case 'check_goals':
      return api('GET', '/goal');

    case 'get_memory': {
      if (args.key) {
        return api('GET', `/teams/${args.team_id}/memory/${args.key}`);
      }
      return api('GET', `/teams/${args.team_id}/memory`);
    }

    case 'set_memory':
      return api('PUT', `/teams/${args.team_id}/memory/${args.key}`, { value: args.value });

    case 'delete_memory':
      return api('DELETE', `/teams/${args.team_id}/memory/${args.key}`);

    case 'team_chat_send':
      return api('POST', `/teams/${args.team_id}/teamchat`, {
        from: args.from,
        message: args.message,
        kind: args.kind,
      });

    case 'team_chat_list': {
      const qs = new URLSearchParams();
      if (args.limit != null) qs.set('limit', String(args.limit));
      if (args.since != null) qs.set('since', String(args.since));
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return api('GET', `/teams/${args.team_id}/teamchat${suffix}`);
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

async function main() {
  const server = new Server(
    { name: 'clawcraft', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await handleTool(name, args || {});
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`ClawCraft MCP failed to start: ${err.message}\n`);
  process.exit(1);
});
