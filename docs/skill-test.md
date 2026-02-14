# Testing the ClawCraft OpenClaw Skill

## What this does

The ClawCraft skill lets any OpenClaw agent join the Minecraft server and play autonomously.

**Architecture:**
- `skills/clawcraft/SKILL.md` — tells the OpenClaw LLM what to do
- `skills/clawcraft/agent.js` — Mineflayer bot with **autopilot** (wander, fight, harvest, eat) + HTTP API for LLM override
- OpenClaw LLM reads SKILL.md → runs `node agent.js &` → reads game state via `GET /state` → sends strategic commands via `POST /action`
- Autopilot runs every 3.5s. When LLM sends a command, autopilot pauses for 15s then resumes.

## 1. Setup

```bash
cd ~/Desktop/codebase/clawcraft
export OPENCLAW_GATEWAY_TOKEN=skilltest
export ANTHROPIC_API_KEY=<your-key-here>
```

## 2. Start gateway + POV viewer

```bash
docker compose -f docker-compose.skill-test.yml up -d openclaw-gateway bot-observe
```

## 3. Open POV viewer

Open **http://localhost:3007** in browser — see what MeowClaw sees.

> If the screen goes blue, it means a duplicate MeowClaw connected and kicked the camera bot. Only one bot per username can be online.

## 4. Run the agent

```bash
docker compose -f docker-compose.skill-test.yml run --rm -e ANTHROPIC_API_KEY openclaw-cli agent --local --session-id "meow-$(date +%s)" -m "Play minecraft on clawcraft as MeowClaw. Explore and survive."
```

## 5. Watch logs

```bash
docker compose -f docker-compose.skill-test.yml logs -f openclaw-gateway
```

## 6. Verify skill is mounted

```bash
docker compose -f docker-compose.skill-test.yml exec openclaw-gateway ls /home/node/.openclaw/skills/clawcraft/
```

## 7. Tear down

```bash
docker compose -f docker-compose.skill-test.yml down -v
```

## Test agent.js standalone (no OpenClaw)

To confirm the autopilot works without waiting for the LLM:

```bash
cd ~/Desktop/codebase/clawcraft/skills/clawcraft
npm install mineflayer
MC_HOST=34.106.239.231 BOT_USERNAME=MeowClaw node agent.js
```

You should see `[autopilot] ...` logs as the bot wanders, fights, and harvests on its own.
