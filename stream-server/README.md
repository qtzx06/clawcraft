# Stream Server (clawcraft-stream)

GPU VM that runs the headless Minecraft spectator client, OBS, and director service for the Twitch livestream.

## VM Spec

```
Project:    clawcraft-487406
Zone:       us-west3-b
Machine:    g2-standard-8 (1x L4 GPU, 8 vCPU, 32GB RAM)
Disk:       pd-ssd 200GB
Image:      Ubuntu 22.04 LTS
```

## Create the VM

```bash
gcloud compute instances create clawcraft-stream \
  --project clawcraft-487406 \
  --zone us-west3-b \
  --machine-type g2-standard-8 \
  --accelerator type=nvidia-l4,count=1 \
  --boot-disk-size 200GB \
  --boot-disk-type pd-ssd \
  --image-family ubuntu-2204-lts \
  --image-project ubuntu-os-cloud \
  --maintenance-policy TERMINATE \
  --metadata-from-file startup-script=stream-server/gcloud-startup-script.sh
```

## Apply startup script updates

```bash
gcloud compute instances add-metadata clawcraft-stream \
  --zone us-west3-b \
  --project clawcraft-487406 \
  --metadata-from-file startup-script=stream-server/gcloud-startup-script.sh
```

## Services (systemd)

Startup order — each depends on the previous:

1. `xvfb.service` — Virtual display at 1920x1080x24
2. `minecraft-spectator.service` — MC client connects to clawcraft-mc
3. `obs.service` — Captures display, streams to Twitch
4. `director.service` — Controls spectator + OBS, serves HUD

### Start/stop

```bash
sudo systemctl start xvfb minecraft-spectator obs director
sudo systemctl stop director obs minecraft-spectator xvfb
sudo systemctl restart director
```

### Logs

```bash
journalctl -u director -f
journalctl -u obs -f
journalctl -u minecraft-spectator -f
```

## Environment variables

Set in `/opt/clawcraft/.env` on the VM:

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
LISTENER_USERNAME=DirectorEye
```

## Whitelist requirements

On the MC server, add both bots:

```
whitelist add SpectatorCam
whitelist add DirectorEye
op SpectatorCam
```

SpectatorCam needs op for `/tp` and `/spectate` commands.

## Troubleshooting

### Xvfb not starting
```bash
Xvfb :99 -screen 0 1920x1080x24 &
export DISPLAY=:99
```

### NVIDIA drivers missing
```bash
nvidia-smi  # should show L4 GPU
# If not, re-run startup script or install manually
```

### OBS not connecting to websocket
```bash
# Check OBS is running
ps aux | grep obs
# Check websocket port
ss -tlnp | grep 4455
```

### Director can't reach RCON
```bash
# Test RCON from stream VM
nc -zv <mc-host> 25575
```
