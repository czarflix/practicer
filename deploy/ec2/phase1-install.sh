#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DSA Runner — EC2 Bootstrap Phase 1
# Run this ONCE on a fresh Ubuntu 22.04 instance as the ubuntu user (sudo works).
#
# What it does:
#   1. Installs Docker CE + Compose plugin
#   2. Enables cgroup v1 (required by isolate inside Judge0)
#   3. Prepares /opt/judge0 and /opt/dsa-runner directories
#   4. Prints next steps — you will reboot, then run phase2-start.sh
#
# Recommended EC2 instance: t3.medium (2 vCPU, 4 GB RAM), Ubuntu 22.04 LTS
# Security group inbound rules needed:
#   22 (SSH)   — your IP only
#   80  (TCP)  — 0.0.0.0/0 (HTTP redirect to HTTPS)
#   443 (TCP)  — 0.0.0.0/0 (HTTPS)
#
# Usage:
#   chmod +x phase1-install.sh && sudo ./phase1-install.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DEPLOY_USER="${SUDO_USER:-ubuntu}"
JUDGE0_DIR="/opt/judge0"
RUNNER_DIR="/opt/dsa-runner"

echo "▶ Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

echo "▶ Installing Docker CE..."
apt-get install -y -qq ca-certificates curl gnupg lsb-release git

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable docker
systemctl start docker
usermod -aG docker "$DEPLOY_USER"

echo "▶ Docker installed: $(docker --version)"
echo "▶ Docker Compose: $(docker compose version)"

# ─── Enable cgroup v1 (isolate inside Judge0 requires v1 memory controller) ──
CGROUP_PARAM="systemd.unified_cgroup_hierarchy=0"
GRUB_DROPIN="/etc/default/grub.d/60-cgroup-v1.cfg"

if grep -q "$CGROUP_PARAM" /proc/cmdline 2>/dev/null; then
  echo "▶ cgroup v1 kernel arg already active — skipping grub update."
else
  echo "▶ Configuring cgroup v1 via $GRUB_DROPIN ..."
  cat > "$GRUB_DROPIN" <<EOF
GRUB_CMDLINE_LINUX="$CGROUP_PARAM"
EOF
  update-grub
  echo "▶ GRUB updated — reboot required."
fi

# ─── Prepare Judge0 directory ─────────────────────────────────────────────────
echo "▶ Preparing $JUDGE0_DIR..."
mkdir -p "$JUDGE0_DIR"
chown "$DEPLOY_USER:$DEPLOY_USER" "$JUDGE0_DIR"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JUDGE0_COMPOSE_SRC="$(realpath "$SCRIPT_DIR/../judge0" 2>/dev/null || echo "")"

if [[ -n "$JUDGE0_COMPOSE_SRC" && -f "$JUDGE0_COMPOSE_SRC/docker-compose.yml" ]]; then
  cp "$JUDGE0_COMPOSE_SRC/docker-compose.yml" "$JUDGE0_DIR/"
  cp "$JUDGE0_COMPOSE_SRC/judge0.conf.example" "$JUDGE0_DIR/"
  echo "▶ Copied judge0 compose files to $JUDGE0_DIR"
else
  echo "▶ WARNING: judge0 compose source not found at $JUDGE0_COMPOSE_SRC"
  echo "           Manually copy deploy/judge0/docker-compose.yml and judge0.conf.example"
fi

# ─── Prepare runner directory ─────────────────────────────────────────────────
echo "▶ Preparing $RUNNER_DIR..."
mkdir -p "$RUNNER_DIR"
chown "$DEPLOY_USER:$DEPLOY_USER" "$RUNNER_DIR"

RUNNER_COMPOSE_SRC="$(realpath "$SCRIPT_DIR/../runner" 2>/dev/null || echo "")"
if [[ -n "$RUNNER_COMPOSE_SRC" && -f "$RUNNER_COMPOSE_SRC/docker-compose.yml" ]]; then
  cp "$RUNNER_COMPOSE_SRC/docker-compose.yml" "$RUNNER_DIR/"
  cp "$RUNNER_COMPOSE_SRC/.env.example" "$RUNNER_DIR/.env.example"
  echo "▶ Copied runner compose files to $RUNNER_DIR"
fi

# ─── Print next steps ─────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo " Phase 1 COMPLETE"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo " NEXT STEPS:"
echo ""
echo " 1. Edit Judge0 config:"
echo "      cp $JUDGE0_DIR/judge0.conf.example $JUDGE0_DIR/judge0.conf"
echo "      nano $JUDGE0_DIR/judge0.conf"
echo "       → Set POSTGRES_PASSWORD and REDIS_PASSWORD to strong random values"
echo "       → Set AUTHN_TOKEN if you want auth (optional, private net only)"
echo ""
echo " 2. Edit runner env:"
echo "      cp $RUNNER_DIR/.env.example $RUNNER_DIR/.env"
echo "      nano $RUNNER_DIR/.env"
echo "       → Set SUPABASE_SERVICE_ROLE_KEY"
echo "       → Set RUNNER_ALLOWED_ORIGIN to your frontend domain"
echo "       → Set JUDGE0_API_KEY if you set AUTHN_TOKEN above"
echo ""
echo " 3. REBOOT the instance (required for cgroup v1 to activate):"
echo "      sudo reboot"
echo ""
echo " 4. After reboot, run phase2-start.sh as $DEPLOY_USER:"
echo "      chmod +x $SCRIPT_DIR/phase2-start.sh && $SCRIPT_DIR/phase2-start.sh"
echo ""
