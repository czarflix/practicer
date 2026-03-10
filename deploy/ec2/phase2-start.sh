#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DSA Runner — EC2 Bootstrap Phase 2
# Run this AFTER rebooting from phase1-install.sh.
# Run as the deploy user (ubuntu), NOT as root.
#
# What it does:
#   1. Starts the Judge0 stack (/opt/judge0)
#   2. Waits for Judge0 API to be ready
#   3. Builds and starts the runner service (/opt/dsa-runner)
#   4. Validates health of both services
#   5. Performs a smoke test run against Judge0 directly
#
# Usage:
#   chmod +x phase2-start.sh && ./phase2-start.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

JUDGE0_DIR="/opt/judge0"
RUNNER_DIR="/opt/dsa-runner"
RUNNER_SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../runner-service" 2>/dev/null && pwd || echo "")"

# ─── Verify cgroup v1 is active ───────────────────────────────────────────────
echo "▶ Checking cgroup version..."
if [[ "$(cat /sys/fs/cgroup/cgroup.controllers 2>/dev/null)" != "" ]]; then
  echo "   WARNING: cgroup v2 unified hierarchy is active!"
  echo "   Make sure 'systemd.unified_cgroup_hierarchy=0' is in GRUB and you have rebooted."
  echo "   Continuing anyway — Judge0 may work in hybrid mode with cgroupns=host."
else
  echo "   cgroup v1 confirmed (or hybrid mode) ✓"
fi

# ─── Verify judge0.conf exists ────────────────────────────────────────────────
if [[ ! -f "$JUDGE0_DIR/judge0.conf" ]]; then
  echo ""
  echo "ERROR: $JUDGE0_DIR/judge0.conf not found."
  echo "  Run: cp $JUDGE0_DIR/judge0.conf.example $JUDGE0_DIR/judge0.conf"
  echo "  Then edit POSTGRES_PASSWORD and REDIS_PASSWORD before continuing."
  exit 1
fi

# ─── Verify runner .env exists ───────────────────────────────────────────────
if [[ ! -f "$RUNNER_DIR/.env" ]]; then
  echo ""
  echo "ERROR: $RUNNER_DIR/.env not found."
  echo "  Run: cp $RUNNER_DIR/.env.example $RUNNER_DIR/.env"
  echo "  Then fill in SUPABASE_SERVICE_ROLE_KEY and RUNNER_ALLOWED_ORIGIN."
  exit 1
fi

# ─── Start Judge0 ─────────────────────────────────────────────────────────────
echo ""
echo "▶ Starting Judge0 stack..."
cd "$JUDGE0_DIR"
docker compose pull --quiet
docker compose up -d

# ─── Wait for Judge0 API ──────────────────────────────────────────────────────
echo "▶ Waiting for Judge0 API to become ready..."
MAX_WAIT=120
ELAPSED=0
until curl -sf http://localhost:2358/languages > /dev/null 2>&1; do
  if [[ $ELAPSED -ge $MAX_WAIT ]]; then
    echo "ERROR: Judge0 did not respond after ${MAX_WAIT}s. Check logs:"
    echo "  docker compose -f $JUDGE0_DIR/docker-compose.yml logs server"
    exit 1
  fi
  sleep 5
  ELAPSED=$((ELAPSED + 5))
  echo "   ...${ELAPSED}s elapsed, retrying..."
done
echo "   Judge0 API is up ✓"

# ─── Smoke test Judge0 directly ───────────────────────────────────────────────
echo "▶ Smoke testing Judge0 Python (language_id=71)..."
RESPONSE=$(curl -sf -X POST 'http://localhost:2358/submissions?base64_encoded=false&wait=true&fields=stdout,stderr,status,compile_output,message' \
  -H "Content-Type: application/json" \
  -d '{"language_id":71,"source_code":"print(\"__OK__\")","stdin":""}' 2>&1)

STATUS_DESC=$(echo "$RESPONSE" | python3 -c 'import sys,json; d=json.load(sys.stdin); print((d.get("status") or {}).get("description",""))' 2>/dev/null || echo "")
STDOUT_VAL=$(echo "$RESPONSE" | python3 -c 'import sys,json; d=json.load(sys.stdin); print((d.get("stdout") or "").strip())' 2>/dev/null || echo "")

if [[ "$STATUS_DESC" == "Accepted" && "$STDOUT_VAL" == "__OK__" ]]; then
  echo "   Judge0 Python smoke test PASSED ✓"
else
  echo "   WARNING: Unexpected Judge0 response:"
  echo "   $RESPONSE"
  echo "   Judge0 may still be starting workers — wait 30s and retry manually:"
  echo "   curl -X POST 'http://localhost:2358/submissions?base64_encoded=false&wait=true' \\"
  echo "     -H 'Content-Type: application/json' \\"
  echo "     -d '{\"language_id\":71,\"source_code\":\"print(\\\"__OK__\\\")\",\"stdin\":\"\"}'"
fi

# ─── Build and start runner ───────────────────────────────────────────────────
echo ""
echo "▶ Building runner Docker image..."
if [[ -n "$RUNNER_SRC_DIR" && -f "$RUNNER_SRC_DIR/Dockerfile" ]]; then
  docker build -t dsa-runner:latest "$RUNNER_SRC_DIR"
  echo "   Built from $RUNNER_SRC_DIR ✓"
else
  echo "   WARNING: runner-service source not found at $RUNNER_SRC_DIR"
  echo "   Make sure you have uploaded the runner-service directory and set the correct path."
  echo "   Skipping build — 'docker compose up -d' below will fail if image doesn't exist."
fi

echo "▶ Starting runner service..."
cd "$RUNNER_DIR"
docker compose up -d

# ─── Wait for runner health ───────────────────────────────────────────────────
echo "▶ Waiting for runner healthz..."
ELAPSED=0
until curl -sf http://localhost:8787/healthz > /dev/null 2>&1; do
  if [[ $ELAPSED -ge 30 ]]; then
    echo "ERROR: Runner did not respond after 30s. Check logs:"
    echo "  docker compose -f $RUNNER_DIR/docker-compose.yml logs runner"
    exit 1
  fi
  sleep 3
  ELAPSED=$((ELAPSED + 3))
done
echo "   Runner healthz OK ✓"

# ─── Print summary ────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo " Phase 2 COMPLETE — Services running"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Judge0 (internal):  http://localhost:2358/healthz"
echo "  Runner (host only): http://127.0.0.1:8787/healthz"
echo ""
echo " Use nginx + TLS for public access:"
echo "   https://runner.yourdomain.com/healthz"
echo ""
echo " UPDATE runner-service/.env on this host:"
echo "   RUNNER_ALLOWED_ORIGIN=https://YOUR_NETLIFY_DOMAIN.netlify.app"
echo "   (then: cd $RUNNER_DIR && docker compose restart)"
echo ""
echo " Ensure SUPABASE_SERVICE_ROLE_KEY is set correctly in $RUNNER_DIR/.env"
echo ""
echo " VALIDATION curl:"
echo "   curl http://127.0.0.1:8787/healthz"
echo ""
