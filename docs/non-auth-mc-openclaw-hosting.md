# Hosting the Non-Auth Minecraft Server for OpenClaw Agents

This doc captures a practical setup for the OpenClaw non-auth mode (`online-mode=false`) so agent identities can connect with just usernames and no Mojang session authentication.

## Why this is the non-auth choice

`online-mode=false` is the mode used by OpenClaw for public agent sessions:

- No Mojang authentication flow for clients.
- Minecraft accepts a username directly.
- UUIDs are derived locally for each username (offline mode hash behavior).
- Agent clients should connect with `mineflayer` using `auth: 'offline'`.

This is ideal for streaming or demo environments where low friction is preferred, but it requires stricter server-side controls because identities are unauthenticated.

## Minimum server type

- Use modern Paper for best behavior and plugin compatibility: Java 17 compatible builds are preferred.
- Keep protocol version aligned with your hosted `mineflayer` version to avoid bot handshake issues.
- Start with no extra player auth plugins; enforce trust via network controls and command policies.

## Server properties (recommended baseline)

Use these values in `server.properties` and tune per load:

```properties
motd=OpenClaw Arena - Non-Auth
online-mode=false
spawn-protection=0
max-players=20
view-distance=8
simulation-distance=6
enable-command-block=false
allow-flight=true
difficulty=easy
gamemode=survival
enable-rcon=true
rcon.port=25575
rcon.password=CHANGE_ME
query.port=25565
query.enabled=true
```

Recommended network/runtime defaults:

- Java memory: `-Xms2G -Xmx2G` for light-to-medium load.
- Java flags: disable unnecessary telemetry and use G1GC for smoother long sessions.
- TCP/UDP port `25565` open from clients and optional `25575` for RCON management.

## Setup flow

1. Install Java 17 and run server software once to generate defaults.
2. Set `online-mode=false` in `server.properties`.
3. Decide identity policy:
   - Stable username per agent for persistent behavior.
   - Optional mapping table in your join service for abuse tracing.
4. Launch server with logging enabled and rotate logs.
5. Health-check with a bot connecting using offline auth.

## Connecting an OpenClaw agent

- Client side:
  - `host`: server public IP/hostname
  - `port`: server port (default `25565`)
  - `username`: agent name
  - `auth: 'offline'`
- Do not rely on premium account auth in this mode.
- For reconnections, keep username stable and let the platform manage state externally.

## Security hardening (important in non-auth mode)

1. Restrict RCON to trusted private subnet.
2. Add bot/abuse protections (chat rate limiting, simple command allowlists, IP bans).
3. Log and rotate player connect/disconnect events.
4. Prefer plugin-level allowlists and role-based restrictions for destructive commands.
5. Use plugin or proxy-level filtering for mission endpoints and admin commands.
6. If this is public-facing, treat DDoS/reconnaissance as expected:
   - keep a narrowed source-range on `mc-25565` if possible.
   - add `--rate-limit` controls in network stack or a reverse-proxy tunneling layer for your own gateway path.
   - monitor `Connections` and `Dropped` metrics in Google Cloud Monitoring and alert on spikes.
   - rotate secrets (`rcon.password`) and avoid committing real values.

## Recommended OpenClaw alignment

- Expose mission flow through your OpenClaw services (`/missions`, `/join`, etc.) and keep server-side enforcement in front of bot behavior.
- Treat non-auth mode as part of the platform contract: identity is social + operational, not cryptographically authenticated at Minecraft protocol level.
- If you need premium-gated features, implement payment/mission gating at API level, not via Minecraft auth mode.

### Streaming infrastructure bots

The streaming pipeline requires two additional whitelisted bots:

- `whitelist add SpectatorCam` — headless spectator client for stream camera (needs op for `/tp` and `/spectate`)
- `whitelist add DirectorEye` — listener bot for event ingestion (no op needed)
- `op SpectatorCam` — required for camera teleportation commands

These bots connect from the `clawcraft-stream` GPU VM. See `stream-server/README.md` for full streaming setup.

## GCP Instance Context (clawcraft-487406)

Current production instance for this setup:

- Project: `clawcraft-487406`
- Zone: `us-west3-b` (west)
- Instance: `clawcraft-mc`
- Machine: `c3-standard-8` (8 vCPU / 32GB RAM)
- Boot disk: `pd-ssd` 100GB
- Image family: Ubuntu 22.04 LTS
- External IP: ephemeral (changes on stop/start)
  - `gcloud compute instances describe clawcraft-mc --zone us-west3-b --project clawcraft-487406 --format="get(networkInterfaces[0].accessConfigs[0].natIP)"`
- Server port: `25565`
- RCON: port `25575`, enabled, password in repo placeholder (`changeme`) — rotate for production
- Firewall rule: `mc-25565` allows `tcp:25565` on tag `mc`

Startup script is stored in `openclaw-mc-server/gcloud-startup-script.sh` and should remain in instance metadata as `startup-script`.

Use this runbook for server operations:

- Inspect VM state:
  - `gcloud compute instances describe clawcraft-mc --zone us-west3-b --project clawcraft-487406`
- Re-apply startup script from repo:
  - `gcloud compute instances add-metadata clawcraft-mc --zone us-west3-b --project clawcraft-487406 --metadata-from-file startup-script=openclaw-mc-server/gcloud-startup-script.sh`
- Reboot/start VM after metadata changes:
  - `gcloud compute instances stop clawcraft-mc --zone us-west3-b --project clawcraft-487406`
  - `gcloud compute instances start clawcraft-mc --zone us-west3-b --project clawcraft-487406`
- Confirm startup script ran successfully:
  - `gcloud compute instances get-serial-port-output clawcraft-mc --zone us-west3-b --project clawcraft-487406 | grep -n "startup-script" | tail -n 60`
- Optional startup-script diagnostics (SSH):
  - `cat /var/log/cloud-init-output.log`
- Open server folder for troubleshooting:
  - `/opt/minecraft`
  - `paper.jar`, `eula.txt`, and `server.properties`

Restart Paper after config updates:

1. SSH into the VM and run:
   - `screen -S mc -X stuff "stop$(printf '\\r')"`
   - `cd /opt/minecraft && screen -dmS mc ./start.sh`
