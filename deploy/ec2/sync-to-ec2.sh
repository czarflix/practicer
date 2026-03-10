#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Upload project files to EC2 and trigger the deployment.
# Run from your LOCAL machine (macOS).
#
# Prerequisites:
#   - EC2 instance created (Ubuntu 22.04, t3.medium recommended)
#   - Key pair downloaded, e.g. ~/.ssh/dsa-ec2.pem
#   - Security group allows SSH (22) and your runner port (8787) from your IP
#
# Usage:
#   export EC2_HOST=ec2-XX-XX-XX-XX.compute-1.amazonaws.com
#   export EC2_KEY=~/.ssh/dsa-ec2.pem
#   chmod +x sync-to-ec2.sh && ./sync-to-ec2.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR_INNER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Auto-load from .state file written by _provision.py
if [[ -f "$SCRIPT_DIR_INNER/.state" ]]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR_INNER/.state"
fi

EC2_HOST="${EC2_HOST:?Set EC2_HOST or run _provision.py first}"
EC2_KEY="${EC2_KEY:-~/.ssh/dsa-runner.pem}"
EC2_USER="${EC2_USER:-ubuntu}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(realpath "$SCRIPT_DIR/../..")"

SSH_OPTS="-i $EC2_KEY -o StrictHostKeyChecking=accept-new -o LogLevel=ERROR"

echo "▶ Uploading runner-service to $EC2_HOST..."
rsync -avz \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude '*.log' \
  -e "ssh $SSH_OPTS" \
  "$PROJECT_ROOT/runner-service/" \
  "$EC2_USER@$EC2_HOST:/opt/dsa-runner-src/"

echo "▶ Uploading deploy scripts and compose files..."
rsync -avz \
  -e "ssh $SSH_OPTS" \
  "$SCRIPT_DIR/../" \
  "$EC2_USER@$EC2_HOST:/opt/dsa-deploy/"

echo "▶ Making scripts executable on EC2..."
ssh $SSH_OPTS "$EC2_USER@$EC2_HOST" \
  "chmod +x /opt/dsa-deploy/ec2/phase1-install.sh /opt/dsa-deploy/ec2/phase2-start.sh"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo " Files uploaded. SSH in and run phase 1:"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  ssh -i $EC2_KEY $EC2_USER@$EC2_HOST"
echo "  sudo /opt/dsa-deploy/ec2/phase1-install.sh"
echo ""
echo " Then follow the printed instructions (edit conf files, reboot, run phase2)."
echo ""
