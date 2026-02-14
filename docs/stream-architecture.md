# Stream Architecture

## Overview

TV-production-style Twitch livestream of 50+ AI agents playing Minecraft. An auto-director watches game events, scores them for interest, and controls a headless spectator client + OBS to produce an engaging broadcast. A human can override camera decisions at any time.

## How It Works

Two VMs, one stream:

```
clawcraft-mc (existing)          clawcraft-stream (GPU VM)
┌──────────────────┐            ┌─────────────────────────────┐
│  PaperMC server  │            │  DirectorEye (mineflayer)   │
│  50+ agents      │◄──events──►│       ▼                     │
│  playing         │            │  Interest Scorer            │
│                  │            │  (death=100, combat=80...)   │
│                  │  RCON      │       ▼                     │
│                  │◄──────────►│  Camera Controller          │
│  SpectatorCam    │            │  (pick best, cooldowns)     │
│  (spectator mode)│            │       ▼                     │
└──────────────────┘            │  SpectatorCam teleports     │
                                │  to the interesting agent   │
                                │       ▼                     │
                                │  MC client renders on Xvfb  │
                                │       ▼                     │
                                │  OBS captures video +       │
                                │  HUD browser source overlay │
                                │       ▼                     │
                                │  RTMP → Twitch              │
                                └─────────────────────────────┘
```

## The Director Loop

Runs every ~10 seconds (configurable via `DIRECTOR_CYCLE_MS`):

1. **DirectorEye** (mineflayer bot) sits on the MC server watching events — deaths, combat, chat, players joining, clusters forming
2. Each event gets fed to the **Interest Scorer** which assigns a decaying score
3. The **Camera Controller** checks: has enough dwell time passed? Is there someone more interesting than who we're showing?
4. If yes → sends RCON command to teleport **SpectatorCam** to that agent's POV
5. Simultaneously tells **OBS** to trigger a transition (cut for deaths, fade for routine switches)
6. Updates the **HUD overlay** (browser source) with the new agent's name, health, position
7. OBS composites the MC video + HUD and pushes it to Twitch

## Interest Scoring

Events are scored and decay over time so the director naturally gravitates toward action:

| Event | Score | Decay Time | Behavior |
|---|---|---|---|
| Player death | 100 | instant (5s window) | Interrupts current shot immediately |
| Combat (entity hurt) | 80 | 5s | High priority, short-lived |
| Movement cluster (3+ nearby) | 50 | 15s | Something brewing |
| New player join | 40 | 10s | Introduce new agents |
| Chat message | 30 | 10s | Conversation happening |
| Building activity | 20 | 30s | Slow burn, long tail |

Scores stack — an agent fighting AND chatting scores higher than one just chatting.

## Camera Rules

- **Minimum dwell time** (default 5s): don't switch cameras faster than this, unless a death event fires
- **Death override**: a death anywhere on the server bypasses dwell time and triggers an immediate cut
- **Cooldown** (default 30s): after showing an agent, reduce their priority so you don't ping-pong between two agents
- **Fallback**: if only one agent has any score, show them even if they're on cooldown
- **Human override always wins**: pinned camera stays until explicitly released

## Human Override

The director exposes HTTP endpoints for manual control:

- `POST /director/focus/:username` — pin camera to a specific agent
- `POST /director/release` — release pin, return to auto-director
- `POST /director/scene/:sceneName` — force an OBS scene (AgentPOV, Overhead, PiP, BRB)
- `GET /director/status` — current target, override state, HUD state

## OBS Scenes

| Scene | What viewers see | When |
|---|---|---|
| AgentPOV | Full-screen first-person view through an agent's eyes + HUD overlay | Default, most of the stream |
| Overhead | High camera looking down at the arena | Establishing shots, agent clusters |
| PiP | Main POV full-screen + small inset of second view | Two agents interacting |
| BRB | Static/animated holding screen | Pre-stream, breaks, server restarts |

Transitions: cut for urgent events (deaths), fade (500ms) for routine cycling.

## HUD Overlay

Browser source at `http://localhost:3009/hud` served by the director service. Shows:

- Agent username (large, bottom-left)
- Health bar + food bar
- Position coordinates
- Personality tagline (if registered)

Updates via websocket whenever the camera target changes. CSS transitions for smooth animate in/out.

## Services

All four services run on the `clawcraft-stream` GPU VM, managed by systemd in dependency order:

1. `xvfb.service` — virtual display at 1920x1080x24
2. `minecraft-spectator.service` — headless MC client, connects to clawcraft-mc
3. `obs.service` — captures display, encodes NVENC 1080p60 6Mbps, streams to Twitch
4. `director.service` — runs the director loop, serves HUD, exposes control endpoints

## Code Layout

```
app/spectator/
  scorer.js          — interest scoring with time-based decay
  camera.js          — camera scheduling, cooldowns, human override
  rcon.js            — RCON wrapper for spectator teleport commands
  obs.js             — OBS websocket controller for scene switching
  director.js        — main service wiring everything together
  hud/
    index.html       — HUD overlay page (OBS browser source)
    hud.css          — styling
    hud.js           — websocket client for live updates
stream-server/
  gcloud-startup-script.sh   — GPU VM provisioning
  obs-scene-collection.json  — pre-baked OBS scene config
  mc-options.txt              — MC client rendering settings
  README.md                   — streaming VM runbook
```

## Infrastructure

```
Project:    clawcraft-487406
Zone:       us-west3-b
VM:         clawcraft-stream
Machine:    g2-standard-8 (1x L4 GPU, 8 vCPU, 32GB RAM)
Disk:       pd-ssd 200GB
```

See `stream-server/README.md` for VM creation, service management, and troubleshooting.

## MC Server Requirements

On the MC server (clawcraft-mc), whitelist and op the streaming bots:

```
whitelist add SpectatorCam
whitelist add DirectorEye
op SpectatorCam
```

SpectatorCam needs op for `/tp` and `/spectate` commands. DirectorEye only observes events.
