# Design: Twitch Livestream Production Pipeline

## Summary

TV-production-style Twitch livestream of 50+ AI agents playing Minecraft. A headless spectator client renders the game at full quality, a director service decides what to show based on game events, and OBS composites video + overlays and pushes RTMP to Twitch. A human operator can override the auto-director at any time.

## Architecture

Four services, two VMs:

| Service | Runs On | Job |
|---|---|---|
| MC Server | `clawcraft-mc` (existing) | PaperMC, hosts the game, 50+ agents connect |
| Spectator Client | `clawcraft-stream` (new GPU VM) | Headless Minecraft client in spectator mode, renders game at 1080p60 |
| Director Service | `clawcraft-stream` | Decides what's interesting, controls spectator client + OBS |
| OBS Studio | `clawcraft-stream` | Composites video + overlays, streams to Twitch |

```
Agents (50+) ──connect──> MC Server
                              │
                              │ game events (chat, combat, movement, deaths)
                              ▼
                      Director Service ──RCON──> Spectator Client (teleport to player X)
                              │                         │
                              │                    game video (Xvfb capture)
                              │                         ▼
                              └──obs-websocket──> OBS (scene switches, overlays)
                                                      │
                                                 RTMP to Twitch
```

## Director Service

Node.js service at `app/spectator/director.js`. Three responsibilities:

### Event Ingestion

A mineflayer bot connects to the MC server in spectator mode and listens:

- `playerJoined` / `playerLeft` — track who's online
- `chat` — conversations, commands, mission claims
- `entityHurt` / `playerDeath` — combat
- `blockPlace` / `blockBreak` — building
- Player position polling — detect clusters (3+ agents near each other)

### Interest Scoring

Each event gets a score. Director maintains a priority queue.

| Event | Base Score | Decay |
|---|---|---|
| Player death | 100 | instant |
| Combat (entity hurt) | 80 | 5s |
| Movement cluster (3+ nearby) | 50 | 15s |
| New player join | 40 | 10s |
| Chat message | 30 | 10s |
| Building activity | 20 | 30s |

### Camera Controller

Every 8-12s (configurable), picks the highest-scored target and:

1. Sends RCON command to teleport spectator client to that player
2. Tells OBS to trigger a transition
3. Updates HUD overlay with the agent's info

Rules:
- Minimum dwell time: 5s per shot (unless death event fires)
- No same-agent twice in a row unless only interesting thing happening
- 30s cooldown per agent after being shown
- Human override always takes priority

### Endpoints

- `GET /director/status` — current target, queue, override state
- `POST /director/focus/:username` — pin camera to agent (human override)
- `POST /director/release` — release override, return to auto
- `POST /director/scene/:sceneName` — force OBS scene switch
- `GET /director/events` — SSE stream of decisions (debugging/dashboard)

## Spectator Client

Headless Minecraft client on the GPU VM.

### Setup

- Prism Launcher (open source, CLI-friendly) runs a full MC client
- Xvfb provides virtual framebuffer at 1920x1080x24
- MC client renders to virtual display at 1080p60
- OBS captures the virtual display via xcomposite/x11grab

### Account

- Username: `SpectatorCam`, whitelisted on MC server
- Auto-set to spectator mode on join (via RCON or PaperMC plugin)
- Op'd for teleport permissions

### Camera Control via RCON

- `/spectate <target> SpectatorCam` — lock to player's first-person view
- `/tp SpectatorCam <x> <y> <z> <pitch> <yaw>` — overhead/cinematic shots
- `/tp SpectatorCam <target>` — teleport to player position

### Rendering Settings

- Render distance: 12-16 chunks
- Graphics: Fancy (not Fabulous)
- Smooth lighting: On
- Max framerate: 60
- Shaders: optional (test L4 performance first)

## OBS Configuration

### Scenes

| Scene | Content | When |
|---|---|---|
| `AgentPOV` | Full-screen spectator view + HUD overlay | Default, most of the stream |
| `Overhead` | Spectator at fixed high position, arena view | Establishing shots, agent clusters |
| `PiP` | Main POV full-screen + small inset of second view | Two agents interacting |
| `BRB` | Static/animated holding screen | Pre-stream, breaks, restarts |

### HUD Overlay

Browser source at `http://localhost:3009/hud`, served by director service. Shows:

- Agent username (large, bottom-left)
- Health bar + food bar (MC-style icons)
- Position coordinates
- Personality tagline (one-liner from soul.md or registration)
- Active mission indicator

Director pushes updates via websocket on camera target change. CSS transitions for smooth animate in/out.

### Encoding

- Codec: NVENC (L4 GPU) or x264 fallback
- Resolution: 1920x1080
- Framerate: 60fps
- Bitrate: 6000kbps CBR
- Output: RTMP to `rtmp://live.twitch.tv/app/{STREAM_KEY}`

### Transitions

- Cut: urgent events (deaths, combat)
- Fade (500ms): routine camera cycling
- Stinger (optional): scene type changes (POV to Overhead)

## Infrastructure

### New VM: `clawcraft-stream`

```
Project:    clawcraft-487406
Zone:       us-west3-b
Machine:    g2-standard-8 (1x L4 GPU, 8 vCPU, 32GB RAM)
Disk:       pd-ssd 200GB
Image:      Ubuntu 22.04 LTS
Firewall:   No inbound needed (RTMP pushes out, director on internal network)
```

### Software Stack

1. NVIDIA L4 drivers + CUDA
2. Xvfb (virtual display)
3. Prism Launcher + Minecraft client
4. OBS Studio 30+ with obs-websocket
5. Node.js (director service)
6. FFmpeg (utility)

### Startup Order (systemd)

```
1. xvfb.service                 — virtual display
2. minecraft-spectator.service  — MC client, connects to clawcraft-mc
3. obs.service                  — captures display, starts streaming
4. director.service             — connects to OBS + RCON, runs event loop
```

Each depends on the previous. Director waits for OBS websocket + RCON to be reachable.

### Config (env vars)

```
MC_HOST=<clawcraft-mc internal IP>
MC_PORT=25565
RCON_HOST=<clawcraft-mc internal IP>
RCON_PORT=25575
RCON_PASSWORD=<from secrets>
OBS_WS_URL=ws://localhost:4455
OBS_WS_PASSWORD=<generated>
TWITCH_STREAM_KEY=<from secrets>
DIRECTOR_PORT=3009
SPECTATOR_USERNAME=SpectatorCam
```

## Repo Structure

```
app/spectator/
  director.js       — director service (event ingestion, scoring, camera, OBS control, HUD server)
  hud/
    index.html      — HUD overlay page
    hud.css
    hud.js          — websocket client
stream-server/
  gcloud-startup-script.sh    — VM provisioning
  obs-scene-collection.json   — pre-baked OBS scenes
  mc-options.txt              — MC client settings
  README.md                   — streaming VM runbook
```

## Docs to Update During Implementation

- `docs/stream-architecture.md` — living version of this design
- `docs/non-auth-mc-openclaw-hosting.md` — add SpectatorCam whitelist entry, firewall notes
- `docs/architecture.mermaid` — add streaming layer to the diagram
- `stream-server/README.md` — runbook for start/stop/troubleshoot

## Key Decisions

- **Spectator client over prismarine-viewer** — full MC rendering quality, scales to 50+ agents via teleport instead of per-agent renderers
- **OBS for compositing** — battle-tested, obs-websocket API, handles transitions/overlays/encoding natively
- **Hybrid director** — auto-director with human override, not fully manual or fully autonomous
- **Same GCP project** — low latency to MC server, shared networking, single billing
- **HUD only for v1** — agent stats overlay. Mission board, leaderboard, chat integration are future additions
