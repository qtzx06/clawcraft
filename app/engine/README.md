ClawCraft Engine Runtime (Person 3)
===================================

This folder contains a local implementation of the game engine side:

- SOUL.md-driven bot identity ingestion.
- Shared mission board with persisted JSON state.
- Multi-agent runtime loop with Mineflayer adapters.
- Lightweight premium-profile extraction surface for the LangGraph phase.

This does not include the landing page or payment APIs, which are handled by
the API/server stream team.

Quick start
-----------

1. Start a Minecraft server in `online-mode=false`.
2. Copy the default config into place:
   - `app/engine/config/agents.config.json`
3. Set optional runtime env vars in `.env`:
   - `MC_HOST`
   - `MC_PORT`
   - `LLM_API_KEY` (optional for heuristic mode fallback)
   - `MINDCRAFT_PATH` (optional external mindcraft fork path)
4. Start fleet:
   - `npm run start:engine`
5. Optional: start the OpenClaw bridge to let tools spawn agents dynamically:
   - `npm run start:openclaw-bridge`
   - Set `OPENCLAW_BRIDGE_PORT` for a custom port
   - Optional token guard with `OPENCLAW_BRIDGE_TOKEN`

What this implementation includes
--------------------------------

- `app/engine/mission-board/mission-board.js`: shared JSON mission board service.
- `app/engine/persona/persona-parser.js`: SOUL.md parser.
- `app/engine/persona/persona-graph.js`: legacy premium context facade used by engine routes.
- `app/engine/langgraph/`: node graph for SOUL persona-to-actions extraction.
  - `pipeline.js`: orchestrates nodes and dependency execution order.
  - `nodes/personality-extraction-node.js`: parses/normalizes SOUL.md profile.
  - `nodes/voice-node.js`: produces TTS voice profile.
  - `nodes/avatar-node.js`: produces avatar/overlay prompt.
  - `nodes/narration-node.js`: creates in-character narration seed.
  - `nodes/stream-priority-node.js`: scores camera priority for Twitch feed.
- `app/engine/llm/openai-compatible-client.js`: optional LLM policy planner.
- `app/engine/agents/*`: Mineflayer + optional Mindcraft shim adapters.
- `app/engine/bridge/api-contracts.js`: pure functions for API integration.
- `app/engine/run-fleet.js`: CLI entrypoint.

External Mindcraft fork
-----------------------

If you want the full Mindcraft stack, initialize the submodule:

- `git submodule update --init --recursive`

This checks out `external/mindcraft` from:

- `https://github.com/davidwcode/mindcraft`

You can also pull a local copy manually with:

```bash
./app/engine/setup-mindcraft.sh
```

If `MINDCRAFT_PATH` is not present, bots still run with the Mineflayer adapter.
