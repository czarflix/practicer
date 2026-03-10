# Migration Guide — Moving the Runner Stack to a New Host

This guide covers everything you need to move the Judge0 + runner service stack off the current AWS EC2 instance and onto any Linux VPS or cloud VM — DigitalOcean, Hetzner, Linode, Vultr, GCP, Azure, or any dedicated server.

---

## Table of Contents

1. [Requirements for Any New Host](#1-requirements-for-any-new-host)
2. [What Lives Where (Inventory)](#2-what-lives-where-inventory)
3. [Step 1 — Provision the New Server](#step-1--provision-the-new-server)
4. [Step 2 — Install Docker and Configure cgroup v1](#step-2--install-docker-and-configure-cgroup-v1)
5. [Step 3 — Upload Files and Configs](#step-3--upload-files-and-configs)
6. [Step 4 — Start Judge0](#step-4--start-judge0)
7. [Step 5 — Build and Start the Runner](#step-5--build-and-start-the-runner)
8. [Step 6 — Set Up nginx + TLS](#step-6--set-up-nginx--tls)
9. [Step 7 — Update DNS and Frontend](#step-7--update-dns-and-frontend)
10. [Step 8 — Validate](#step-8--validate)
11. [Step 9 — Decommission the Old Server](#step-9--decommission-the-old-server)
12. [Provider-Specific Notes](#provider-specific-notes)
13. [What You Do NOT Need to Migrate](#what-you-do-not-need-to-migrate)
14. [Secrets Reference](#secrets-reference)
15. [Rollback Plan](#rollback-plan)
16. [Cheatsheet — Full Command Sequence](#full-command-cheatsheet)

---

## 1. Requirements for Any New Host

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| OS | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |
| CPU | 2 vCPU | 2+ vCPU |
| RAM | 3 GB | 4 GB |
| Disk | 20 GB | 30 GB SSD |
| Kernel | Linux 5.x+ | Linux 5.15+ |
| Architecture | x86_64 (amd64) | x86_64 |
| Open ports | 22, 80, 443 | 22, 80, 443 |

**Ubuntu 22.04 is strongly recommended.** The cgroup v1 fix described below targets Ubuntu's GRUB setup. Other distros (Debian, CentOS, etc.) have different GRUB config paths — see [Provider-Specific Notes](#provider-specific-notes).

**Why 4 GB RAM?** Judge0 runs a postgres container, a redis container, an API server, and multiple sandbox worker processes. On 2 GB, workers are OOM-killed during parallel submissions.

**Why amd64?** The `judge0/judge0:1.13.1` image only publishes amd64 builds. ARM instances (e.g. AWS Graviton, Ampere on Oracle) will not work.

---

## 2. What Lives Where (Inventory)

Everything you need is already in this repo. Nothing is stateful except the Judge0 postgres volume (submission history) — and that doesn't need to be migrated since it just stores Judge0 run logs, not your app data (that's in Supabase).

| What | Current location (EC2) | Source (your repo) |
|------|----------------------|-------------------|
| Judge0 Compose stack | `/opt/judge0/` | `deploy/judge0/` |
| Judge0 config | `/opt/judge0/judge0.conf` | Not in repo — use [Secrets Reference](#secrets-reference) |
| Runner source | `/opt/dsa-runner-src/` | `runner-service/` |
| Runner Compose | `/opt/dsa-runner/docker-compose.yml` | `deploy/runner/docker-compose.yml` |
| Runner .env | `/opt/dsa-runner/.env` | Not in repo — use [Secrets Reference](#secrets-reference) |
| nginx site config | `/etc/nginx/sites-available/runner` | Auto-written by setup script |
| TLS certificates | `/etc/letsencrypt/` | Re-issued on new server (free) |
| cgroup v1 config | `/etc/default/grub.d/60-cgroup-v1.cfg` | One command to recreate |

---

## Step 1 — Provision the New Server

### Option A: DigitalOcean Droplet
1. Create Droplet → Ubuntu 22.04 → Basic → Regular → 2 GB RAM minimum (4 GB recommended) → choose datacenter → add your SSH key → Create.
2. Note the public IP.

### Option B: Hetzner Cloud
1. New Server → Ubuntu 22.04 → CX22 (2 vCPU / 4 GB) or CX32 → add SSH key → Create.
2. Note the public IP.

### Option C: Linode / Akamai
1. Create Linode → Ubuntu 22.04 LTS → Shared CPU → Linode 4GB → region → SSH key → Create.
2. Note the IP.

### Option D: AWS EC2 (different region or new account)
Reuse `deploy/ec2/_provision.py` — edit the `REGION` variable at the top:
```python
REGION = "us-east-1"   # or whatever region you want
```
Then run:
```bash
cd /path/to/dsa-app
python3 deploy/ec2/_provision.py
```
This creates a new key pair, security group, instance, and Elastic IP automatically.

### Option E: Any VPS with root SSH access
All you need is the server's IP and root/sudo SSH access. The rest of the steps are the same.

---

### Firewall / Security Group rules you need open

| Port | Protocol | Notes |
|------|----------|-------|
| 22   | TCP | SSH — restrict to your IP if possible |
| 80   | TCP | HTTP (certbot ACME challenge + redirect) |
| 443  | TCP | HTTPS |

Do **not** open ports 2358 (Judge0) or 8787 (runner direct). They are only needed internally.

---

## Step 2 — Install Docker and Configure cgroup v1

SSH into the new server, then run `phase1-install.sh` from the repo:

```bash
# From your local machine
scp -i /path/to/key.pem deploy/ec2/phase1-install.sh ubuntu@NEW_SERVER_IP:/tmp/
ssh -i /path/to/key.pem ubuntu@NEW_SERVER_IP "chmod +x /tmp/phase1-install.sh && sudo /tmp/phase1-install.sh"
```

This script:
1. Updates apt and installs Docker CE + Compose plugin
2. Adds `ubuntu` to the `docker` group
3. Writes the cgroup v1 GRUB config
4. Reboots

Wait ~60 seconds for the reboot, then reconnect and verify:

```bash
ssh -i /path/to/key.pem ubuntu@NEW_SERVER_IP

# Must see: systemd.unified_cgroup_hierarchy=0
cat /proc/cmdline

# Must return a number >= 10
ls /sys/fs/cgroup/memory/ | wc -l
```

If `/sys/fs/cgroup/memory/` is empty or missing, cgroup v1 did not activate. See [Troubleshooting cgroup v1](#troubleshooting-cgroup-v1-on-non-aws-hosts) below.

### Troubleshooting cgroup v1 on non-AWS hosts

**Ubuntu 22.04 non-AWS (DigitalOcean, Hetzner, Linode, etc.)**

These hosts do not have the `50-cloudimg-settings.cfg` override, so modifying the main grub file works directly:

```bash
# Edit /etc/default/grub
sudo sed -i 's/^GRUB_CMDLINE_LINUX_DEFAULT=.*/GRUB_CMDLINE_LINUX_DEFAULT="systemd.unified_cgroup_hierarchy=0"/' /etc/default/grub
sudo update-grub
sudo reboot
```

**AWS EC2 (any region)**

AWS ships `/etc/default/grub.d/50-cloudimg-settings.cfg` which overrides `GRUB_CMDLINE_LINUX_DEFAULT`. The fix is to use a higher-numbered file modifying `GRUB_CMDLINE_LINUX`:

```bash
sudo bash -c 'cat > /etc/default/grub.d/60-cgroup-v1.cfg << EOF
GRUB_CMDLINE_LINUX="systemd.unified_cgroup_hierarchy=0"
EOF'
sudo update-grub
sudo reboot
```

`phase1-install.sh` already does this AWS-safe version, so it works on both AWS and non-AWS.

**Debian (non-Ubuntu)**

Same as Ubuntu but the GRUB config is at `/etc/default/grub` and the command is `update-grub`. The file paths are identical.

**CentOS / RHEL / Rocky Linux / AlmaLinux**

```bash
sudo grubby --update-kernel=ALL --args="systemd.unified_cgroup_hierarchy=0"
sudo reboot
```

No `/etc/default/grub` involved — `grubby` modifies the bootloader directly.

---

## Step 3 — Upload Files and Configs

### 3a. Upload deploy files from your local repo

```bash
# From your local machine, inside dsa-app/
NEW_IP=YOUR_SERVER_IP
KEY=/path/to/your/key.pem

# Create directories on the new server
ssh -i $KEY ubuntu@$NEW_IP "sudo mkdir -p /opt/judge0 /opt/dsa-runner /opt/dsa-runner-src && sudo chown ubuntu:ubuntu /opt/judge0 /opt/dsa-runner /opt/dsa-runner-src"

# Upload Judge0 Compose file
scp -i $KEY deploy/judge0/docker-compose.yml ubuntu@$NEW_IP:/opt/judge0/

# Upload runner Compose file
scp -i $KEY deploy/runner/docker-compose.yml ubuntu@$NEW_IP:/opt/dsa-runner/

# Upload runner source (excludes node_modules and .env)
rsync -az --exclude node_modules --exclude .env \
  -e "ssh -i $KEY" \
  runner-service/ ubuntu@$NEW_IP:/opt/dsa-runner-src/
```

### 3b. Create Judge0 config

On your local machine, create a file called `judge0.conf`:

```
POSTGRES_PASSWORD=PICK_A_LONG_RANDOM_STRING
REDIS_PASSWORD=PICK_A_DIFFERENT_LONG_RANDOM_STRING
```

Generate random passwords:
```bash
openssl rand -hex 20   # run twice — once for postgres, once for redis
```

Then upload:
```bash
scp -i $KEY judge0.conf ubuntu@$NEW_IP:/opt/judge0/judge0.conf
rm judge0.conf  # don't leave it on your local machine
```

### 3c. Create runner `.env`

Create a file called `runner.env` locally:

```
RUNNER_PORT=8787
RUNNER_ALLOWED_ORIGIN=http://localhost:5173,http://localhost:4173,https://czarflix.me,https://runner.czarflix.me
SUPABASE_URL=https://fjulxsdwycrmtamwfjxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your Supabase service role key>
JUDGE0_URL=http://host.docker.internal:2358
JUDGE0_API_KEY=
RUNNER_MAX_TESTS=150
RUNNER_MAX_CODE_CHARS=200000
RUNNER_TIME_LIMIT=5
RUNNER_WALL_TIME_LIMIT=10
RUNNER_MEMORY_LIMIT_KB=262144
```

Then upload:
```bash
scp -i $KEY runner.env ubuntu@$NEW_IP:/opt/dsa-runner/.env
rm runner.env
```

---

## Step 4 — Start Judge0

```bash
ssh -i $KEY ubuntu@$NEW_IP

cd /opt/judge0
docker compose pull
docker compose up -d

# Watch startup logs (takes ~30–60 seconds for db to initialize)
docker compose logs -f
```

Once all containers are running, run the smoke test:

```bash
curl -s -X POST http://localhost:2358/submissions?wait=true \
  -H "Content-Type: application/json" \
  -d '{"source_code":"print(\"__OK__\")","language_id":71,"stdin":""}' \
  | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('stdout'), r.get('status'))"
```

**Expected output:**
```
__OK__

{'id': 3, 'description': 'Accepted'}
```

**If you get `status.id: 11` (Runtime Error) or `status.id: 5` (Time Limit Exceeded):**  
→ cgroup v1 is not active. Re-check Step 2.

**If Judge0 containers crash immediately:**  
→ Check `docker compose logs db` — postgres might be initializing. Wait 30 seconds and try again.

---

## Step 5 — Build and Start the Runner

```bash
ssh -i $KEY ubuntu@$NEW_IP

# Build image from uploaded source
docker build -t dsa-runner:latest /opt/dsa-runner-src

# Start runner
cd /opt/dsa-runner
docker compose up -d

# Health check
curl http://localhost:8787/healthz
```

**Expected:** `{"ok":true,"now":"..."}`

---

## Step 6 — Set Up nginx + TLS

Run the setup script from your local machine:

```bash
python3 deploy/ec2/_setup_tls.py --host $NEW_IP --key $KEY --domain runner.czarflix.me
```

If you want to do it manually:

```bash
ssh -i $KEY ubuntu@$NEW_IP

# Install nginx and certbot
sudo apt-get install -y nginx python3-certbot-nginx

# Write nginx config
sudo tee /etc/nginx/sites-available/runner > /dev/null << 'NGINX'
server {
    listen 80;
    server_name runner.czarflix.me;

    location / {
        proxy_pass http://localhost:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX

# Enable site
sudo ln -sf /etc/nginx/sites-available/runner /etc/nginx/sites-enabled/runner
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# Issue TLS certificate
sudo certbot --nginx \
  --non-interactive --agree-tos \
  --email admin@czarflix.me \
  --redirect \
  -d runner.czarflix.me
```

Certbot modifies the nginx config to add TLS, and installs a renewal timer automatically.

---

## Step 7 — Update DNS and Frontend

### Update DNS

At your DNS provider (Namecheap), update the A record for `runner.czarflix.me`:
- Change Value from `13.127.112.212` (old IP) to the new server's IP.

Wait for propagation (typically 1–5 minutes with low TTL, up to 24h with default TTL):

```bash
# Check from your local machine
watch -n 5 "dig +short runner.czarflix.me A"
```

When it shows the new IP, DNS has propagated.

### Update frontend `.env.local` (if domain changed)

If you kept the same domain (`runner.czarflix.me`), no change needed to `.env.local` or Netlify.

If you used a different domain:
```bash
# In dsa-app/.env.local
VITE_RUNNER_API_URL=https://your-new-domain.example.com
```

Also update in Netlify's environment variables panel.

---

## Step 8 — Validate

```bash
# 1. HTTPS health check
curl -s https://runner.czarflix.me/healthz
# → {"ok":true,"now":"..."}

# 2. CORS check — simulate a browser preflight
curl -sv -X OPTIONS https://runner.czarflix.me/runs \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST" \
  2>&1 | grep -E "< HTTP|Access-Control"
# → HTTP/1.1 200 or 204
# → Access-Control-Allow-Origin: http://localhost:5173

# 3. Full run from the UI
# → Open http://localhost:5173, pick any problem, run code, confirm test results appear
```

---

## Step 9 — Decommission the Old Server

Only do this after confirming the new server is fully working.

### If old server is AWS EC2

```bash
# Read state file
cat deploy/ec2/.state

# Disassociate and release Elastic IP (stops billing)
aws ec2 disassociate-address --region ap-south-1 --association-id <from .state>
aws ec2 release-address --region ap-south-1 --allocation-id eipalloc-0e5c3bd46f97c08cf

# Terminate instance
aws ec2 terminate-instances --region ap-south-1 --instance-ids i-093ad65e8d39bfaf2

# Optionally delete security group and key pair
aws ec2 delete-security-group --region ap-south-1 --group-id sg-0d3c388499e220b3b
aws ec2 delete-key-pair --region ap-south-1 --key-name dsa-runner
rm ~/.ssh/dsa-runner.pem
```

**Important:** Releasing the Elastic IP stops its ~$4/month charge. Terminated instances stop billing immediately.

### If old server is a VPS

Use the provider's control panel to destroy the VPS/droplet/server.

---

## Provider-Specific Notes

### DigitalOcean

- Security: Use the **Firewall** product (not `ufw`) — it works at the network level like AWS SGs.
  - Create a Firewall → Inbound rules: TCP 22, 80, 443 → Apply to your Droplet.
- For a static IP: use a **Reserved IP** (free when attached to a Droplet).
- cgroup v1: Standard fix works. Non-AWS GRUB, no `50-cloudimg-settings.cfg` override.
- Docker install: `phase1-install.sh` works as-is.

### Hetzner Cloud

- Security: Use **Firewall** in the Hetzner console — same concept as DO.
- For a static IP: use a **Floating IP** (€0/month if attached, €1/month if detached).
- cgroup v1: Standard fix works.
- Docker install: `phase1-install.sh` works as-is.
- Hetzner's Ubuntu 22.04 images are clean and fast to boot.

### Linode / Akamai

- Security: Linode has no managed firewall by default — enable `ufw` on the server:
  ```bash
  sudo ufw allow 22/tcp
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  sudo ufw enable
  ```
- For a static IP: all Linode IPs are static by default.
- cgroup v1: Standard fix works.

### Vultr

- Security: Use the **Firewall Group** feature or `ufw` on the host.
- Static IPs are default.
- cgroup v1: Standard fix works.

### GCP Compute Engine

- Security: Use **VPC Firewall Rules** — allow ingress TCP 22, 80, 443.
- Static IP: "Reserve a static external IP address" and attach to the VM.
- Default username: `your-google-username`, not `ubuntu`. SSH via `gcloud compute ssh`.
- cgroup v1: Standard Ubuntu fix works. GCP does not override GRUB_CMDLINE_LINUX_DEFAULT.
- Docker install: `phase1-install.sh` works. Replace `ubuntu` user references with your GCP username.

### Azure VM

- Security: Use **Network Security Group** (NSG) with inbound rules for 22, 80, 443.
- Static IP: Use a **Static** Public IP allocation (not Dynamic).
- Default username: whatever you set during VM creation.
- cgroup v1: Standard Ubuntu fix works.

### Oracle Cloud (Free Tier)

- Oracle's free Ampere A1 instances are **ARM/aarch64** — Judge0 images are amd64-only and will not run.
- Use the AMD VM.Standard.E2.1.Micro (free tier, 1 OCPU / 1 GB) — too small for Judge0.
- **Oracle Cloud is not recommended for this stack.** Use any other provider.

---

## What You Do NOT Need to Migrate

| Data | Reason |
|------|--------|
| Supabase database | Cloud-hosted, untouched — same URL and keys work anywhere |
| Let's Encrypt certificates | Re-issued for free on new server with `certbot` |
| Judge0 postgres volume | Contains only submission history/logs for Judge0 internals — not your app data |
| Netlify frontend | Stays on Netlify, no changes needed (just update `VITE_RUNNER_API_URL` if domain changes) |

---

## Secrets Reference

These are the values you need on the new server that are not stored in the repo.

### `/opt/judge0/judge0.conf`

| Key | Current value on EC2 | Notes |
|-----|---------------------|-------|
| `POSTGRES_PASSWORD` | `<redacted>` | Generate a new long random value on each deployment |
| `REDIS_PASSWORD` | `<redacted>` | Generate a different long random value |

> These passwords only protect internal postgres/redis — they are not exposed to the internet and don't authenticate any external service. You can change them freely on a new deployment.

### `/opt/dsa-runner/.env`

| Key | Where to find it |
|-----|----------------|
| `SUPABASE_URL` | Supabase dashboard → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Project Settings → API → service_role key |
| All `RUNNER_*` settings | See `deploy/runner/.env.example` for defaults |

The `SUPABASE_SERVICE_ROLE_KEY` is the most sensitive secret. It allows bypass of all RLS policies. Handle it carefully:
- Never commit it to git
- Pass it via SCP/secure file upload from local environment variables (as done in `_push_configs.py`), never commit it
- Consider rotating it in Supabase if you suspect exposure

---

## Rollback Plan

If the migration goes wrong and the new server doesn't work:

1. **Don't touch DNS yet** — the old server is still answering while you debug.
2. SSH into the new server and check `docker compose logs` for both Judge0 and the runner.
3. Common fixes: re-run cgroup v1 GRUB step, wait longer for Judge0 initial db migration, check firewall rules.
4. If you can't fix it quickly, simply don't update DNS — users continue hitting the old server.
5. Once the new server is healthy, update DNS. At that point the old server can be decommissioned.

---

## Full Command Cheatsheet

Replace `NEW_IP`, `KEY`, and `DOMAIN` with your values.

```bash
NEW_IP=1.2.3.4
KEY=~/.ssh/new-server.pem
DOMAIN=runner.czarflix.me

# ── Step 2: Install Docker + cgroup v1 ──────────────────────────
scp -i $KEY deploy/ec2/phase1-install.sh ubuntu@$NEW_IP:/tmp/
ssh -i $KEY ubuntu@$NEW_IP "chmod +x /tmp/phase1-install.sh && sudo /tmp/phase1-install.sh"
# wait ~60s for reboot
ssh -i $KEY ubuntu@$NEW_IP "cat /proc/cmdline && ls /sys/fs/cgroup/memory/ | wc -l"

# ── Step 3: Upload files ─────────────────────────────────────────
ssh -i $KEY ubuntu@$NEW_IP "sudo mkdir -p /opt/judge0 /opt/dsa-runner /opt/dsa-runner-src && sudo chown ubuntu:ubuntu /opt/judge0 /opt/dsa-runner /opt/dsa-runner-src"
scp -i $KEY deploy/judge0/docker-compose.yml ubuntu@$NEW_IP:/opt/judge0/
scp -i $KEY deploy/runner/docker-compose.yml ubuntu@$NEW_IP:/opt/dsa-runner/
rsync -az --exclude node_modules --exclude .env -e "ssh -i $KEY" runner-service/ ubuntu@$NEW_IP:/opt/dsa-runner-src/

# Create and upload judge0.conf (fill in passwords)
echo -e "POSTGRES_PASSWORD=$(openssl rand -hex 20)\nREDIS_PASSWORD=$(openssl rand -hex 20)" > /tmp/_j0.conf
scp -i $KEY /tmp/_j0.conf ubuntu@$NEW_IP:/opt/judge0/judge0.conf
rm /tmp/_j0.conf

# Create and upload runner .env (fill in Supabase values)
cat > /tmp/_runner.env << 'EOF'
RUNNER_PORT=8787
RUNNER_ALLOWED_ORIGIN=http://localhost:5173,http://localhost:4173,https://czarflix.me,https://runner.czarflix.me
SUPABASE_URL=https://fjulxsdwycrmtamwfjxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=PASTE_KEY_HERE
JUDGE0_URL=http://host.docker.internal:2358
JUDGE0_API_KEY=
RUNNER_MAX_TESTS=150
RUNNER_MAX_CODE_CHARS=200000
RUNNER_TIME_LIMIT=5
RUNNER_WALL_TIME_LIMIT=10
RUNNER_MEMORY_LIMIT_KB=262144
EOF
scp -i $KEY /tmp/_runner.env ubuntu@$NEW_IP:/opt/dsa-runner/.env
rm /tmp/_runner.env

# ── Step 4: Start Judge0 ─────────────────────────────────────────
ssh -i $KEY ubuntu@$NEW_IP "cd /opt/judge0 && docker compose pull && docker compose up -d"
# smoke test (run after ~60s)
ssh -i $KEY ubuntu@$NEW_IP "curl -s -X POST http://localhost:2358/submissions?wait=true -H 'Content-Type: application/json' -d '{\"source_code\":\"print(\\\"__OK__\\\")\",\"language_id\":71,\"stdin\":\"\"}'"

# ── Step 5: Build and start runner ───────────────────────────────
ssh -i $KEY ubuntu@$NEW_IP "docker build -t dsa-runner:latest /opt/dsa-runner-src && cd /opt/dsa-runner && docker compose up -d"
ssh -i $KEY ubuntu@$NEW_IP "curl -s http://localhost:8787/healthz"

# ── Step 6: nginx + TLS ──────────────────────────────────────────
ssh -i $KEY ubuntu@$NEW_IP "sudo apt-get install -y nginx python3-certbot-nginx"
# write nginx config (see Step 6 in guide for full config)
ssh -i $KEY ubuntu@$NEW_IP "sudo certbot --nginx --non-interactive --agree-tos --email admin@czarflix.me --redirect -d $DOMAIN"

# ── Step 7: Update DNS at Namecheap ──────────────────────────────
# A record: runner → $NEW_IP

# ── Step 8: Validate ─────────────────────────────────────────────
curl -s https://$DOMAIN/healthz
```
