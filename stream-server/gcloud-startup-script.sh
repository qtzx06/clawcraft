#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

LOG=/var/log/stream-setup.log
exec > >(tee -a "$LOG") 2>&1
echo "=== stream VM startup $(date) ==="

# --- NVIDIA drivers ---
if ! command -v nvidia-smi &>/dev/null; then
  apt-get update -y
  apt-get install -y linux-headers-$(uname -r) build-essential
  curl -fsSL https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.1-1_all.deb -o /tmp/cuda-keyring.deb
  dpkg -i /tmp/cuda-keyring.deb
  apt-get update -y
  apt-get install -y cuda-drivers
  echo "NVIDIA drivers installed, reboot may be needed"
fi

# --- Xvfb ---
apt-get install -y xvfb x11-utils

# --- OBS Studio ---
if ! command -v obs &>/dev/null; then
  add-apt-repository -y ppa:obsproject/obs-studio
  apt-get update -y
  apt-get install -y obs-studio
fi

# --- Java (for Minecraft client via Prism Launcher) ---
apt-get install -y openjdk-21-jre-headless

# --- Prism Launcher ---
if [ ! -f /opt/prismlauncher/PrismLauncher.AppImage ]; then
  mkdir -p /opt/prismlauncher
  PRISM_URL="https://github.com/PrismLauncher/PrismLauncher/releases/latest/download/PrismLauncher-Linux-x86_64.AppImage"
  curl -fsSL "$PRISM_URL" -o /opt/prismlauncher/PrismLauncher.AppImage
  chmod +x /opt/prismlauncher/PrismLauncher.AppImage
fi

# --- Node.js ---
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# --- FFmpeg ---
apt-get install -y ffmpeg

# --- Clone / pull repo ---
REPO_DIR=/opt/clawcraft
if [ -d "$REPO_DIR/.git" ]; then
  cd "$REPO_DIR" && git pull
else
  git clone https://github.com/openclaw/clawcraft.git "$REPO_DIR"
fi

cd "$REPO_DIR"
npm install --production

echo "=== stream VM startup complete $(date) ==="
