# Deployment Journal — DSA Runner on EC2

**Date:** 4 March 2026  
**Deployed By:** GitHub Copilot (Claude Sonnet 4.6)  
**Final Status:** Fully operational  
**Live endpoint:** `https://runner.czarflix.me`

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Phase 1 — Hardening Runner Source Code](#phase-1--hardening-runner-source-code)
3. [Phase 2 — Creating Deploy Artifacts](#phase-2--creating-deploy-artifacts)
4. [Phase 3 — Provisioning EC2](#phase-3--provisioning-ec2)
5. [Phase 4 — Installing Docker & cgroup v1](#phase-4--installing-docker--cgroup-v1)
6. [Phase 5 — Starting Judge0](#phase-5--starting-judge0)
7. [Phase 6 — Building and Starting the Runner](#phase-6--building-and-starting-the-runner)
8. [Phase 7 — E2E Validation](#phase-7--e2e-validation)
9. [Phase 8 — TLS with nginx + Let's Encrypt](#phase-8--tls-with-nginx--lets-encrypt)
10. [Phase 9 — CORS Tightening and Port Hardening](#phase-9--cors-tightening-and-port-hardening)
11. [Key Decisions and Why](#key-decisions-and-why)
12. [Problems Encountered and How They Were Solved](#problems-encountered-and-how-they-were-solved)
13. [Final Infrastructure State](#final-infrastructure-state)
14. [Current Product Semantics](#current-product-semantics)

---

## Architecture Overview

```
Browser (Netlify CDN)
       │  HTTPS :443
       ▼
  nginx (EC2 t3.medium ap-south-1)
  runner.czarflix.me / 13.127.112.212
       │  HTTP :8787 (loopback only, nginx proxies)
       ▼
  dsa-runner container (Node 20 Alpine, port 8787)
  /opt/dsa-runner/
       │  HTTP :2358 (docker bridge via host.docker.internal)
       ▼
  judge0/judge0:1.13.1 container (port 2358, 0.0.0.0)
  /opt/judge0/
       │
       ├── postgres:13-alpine  (named volume judge0-postgres)
       └── redis:6-alpine
```

Everything lives on a single EC2 `t3.medium` (2 vCPU / 4 GB RAM) in `ap-south-1` (Mumbai).  
Judge0 is **never exposed to the internet** — port 2358 is open inside Docker but blocked by the AWS Security Group.  
The runner is also not directly accessible externally — port 8787 is removed from the SG after TLS setup. All requests arrive via nginx on port 443.

---

## Phase 1 — Hardening Runner Source Code

### Problem
`config.mjs` stored `allowedOrigin` as a plain string `"*"`, and `server.mjs` would blindly echo it in the CORS header. This meant any website on the internet could call the runner (which holds a Supabase service role key).

### What Changed

**`runner-service/src/config.mjs`**

- Added `parseAllowedOrigins(str)`: splits a comma-separated env var string into a `Set<string>`.
- `runnerConfig.allowedOrigin` (string) → `runnerConfig.allowedOrigins` (Set).
- `*` wildcard is preserved — if the env var is `*`, the Set contains `"*"` and CORS passes everything (useful for local dev until you know the deploy URL).

```js
function parseAllowedOrigins(str = "") {
  if (!str.trim()) return new Set(["*"]);
  return new Set(str.split(",").map(s => s.trim()).filter(Boolean));
}
```

**`runner-service/src/server.mjs`**

- Added `getAllowedOrigin(requestOrigin)`:
  - If `allowedOrigins` contains `"*"`, returns `"*"`.
  - Otherwise, returns `requestOrigin` only if it's in the Set; otherwise returns `null`.
- `setCorsHeaders()` only writes the `Access-Control-Allow-Origin` header when `getAllowedOrigin` returns non-null.
- `OPTIONS` preflight returns `403 Forbidden` for origins not in the allowlist (previously returned `200` for everything).

This means a blocked origin gets a hard CORS error, not a permissive response.

---

## Phase 2 — Creating Deploy Artifacts

All deploy files live under `deploy/` in the project root:

```
deploy/
  judge0/
    docker-compose.yml        ← Judge0 CE + postgres + redis
    judge0.conf.example       ← Template — copy to judge0.conf and fill passwords
  runner/
    docker-compose.yml        ← Runner container
    .env.example              ← Template — copy to .env and fill values
    nginx.conf.example        ← nginx config template (before domain is known)
  ec2/
    phase1-install.sh         ← Install Docker + configure cgroup v1 on Ubuntu 22.04
    phase2-start.sh           ← Start Judge0 and runner containers
    sync-to-ec2.sh            ← rsync runner source to /opt/dsa-runner-src
    _provision.py             ← One-shot EC2 provisioner (key pair, SG, instance, EIP)
    _push_configs.py          ← SCP judge0.conf and runner .env to EC2
    _setup_tls.py             ← Install nginx + certbot, issue Let's Encrypt cert
    _update_cors.py           ← Update RUNNER_ALLOWED_ORIGIN on EC2 and restart
    .state                    ← Written by _provision.py; stores instance ID, IP, key path
  README.md                   ← Step-by-step operations guide
  docs/
    deployment-journal.md     ← This file
    migration-guide.md        ← How to move to another host
```

### `runner-service/Dockerfile`

Created a multi-stage Docker build:

1. **deps stage** — installs only `node_modules` (production only, `npm ci --omit=dev`).
2. **runtime stage** — copies `src/` and the pruned `node_modules` from deps stage.
3. Runs as non-root user `appuser` (uid 1001).
4. Built-in `HEALTHCHECK` pings `/healthz` every 15 s.

### `runner-service/.dockerignore`

Excludes `node_modules`, `.env*`, `*.log`, `.git` from Docker build context.  
Critical for preventing local `.env` secrets from being baked into the image.

---

## Phase 3 — Provisioning EC2

Ran `deploy/ec2/_provision.py` which did the following in sequence using `boto3` / AWS CLI:

### 1. Key Pair
```
aws ec2 create-key-pair --key-name dsa-runner --region ap-south-1
```
Private key saved to `~/.ssh/dsa-runner.pem` with `chmod 400`.

### 2. Security Group
Created `dsa-runner-sg` (in the default VPC) with inbound rules:
| Port | Protocol | Source | Purpose |
|------|----------|--------|---------|
| 22   | TCP | 0.0.0.0/0 | SSH |
| 80   | TCP | 0.0.0.0/0 | HTTP → HTTPS redirect (nginx) |
| 443  | TCP | 0.0.0.0/0 | HTTPS |

### 3. EC2 Instance
- AMI: Ubuntu 22.04 LTS (latest in ap-south-1, looked up via `describe-images`)
- Type: `t3.medium` (2 vCPU, 4 GB RAM — minimum for Judge0 workers)
- Root volume: 30 GB gp3
- Instance ID: `i-093ad65e8d39bfaf2`

### 4. Elastic IP
```
aws ec2 allocate-address --domain vpc --region ap-south-1
aws ec2 associate-address --instance-id i-... --allocation-id eipalloc-...
```
EIP: `13.127.112.212`  
Allocation ID: `eipalloc-0e5c3bd46f97c08cf`

This IP is **static** — it survives stop/start cycles and does not change unless explicitly released.

### 5. State file
`deploy/ec2/.state` was written with all identifiers so subsequent scripts don't need to hard-code anything:
```
EC2_HOST=13.127.112.212
EC2_KEY=~/.ssh/dsa-runner.pem
EC2_USER=ubuntu
INSTANCE_ID=i-093ad65e8d39bfaf2
ELASTIC_IP=13.127.112.212
ALLOCATION_ID=eipalloc-0e5c3bd46f97c08cf
REGION=ap-south-1
```

---

## Phase 4 — Installing Docker & cgroup v1

### Why cgroup v1?

Judge0 CE uses [`isolate`](https://github.com/ioi/isolate) as its sandbox. `isolate` requires cgroup v1 (the legacy hierarchy) to confine CPU, memory, and process counts per submission. Modern Ubuntu 22.04 defaults to cgroup v2 (`unified_cgroup_hierarchy=1`). Without v1, Judge0 workers start but fail every execution with:

```
ERROR: Cannot initialize cgroup subsystem 'memory'
```

and the submission returns:
```json
{ "stderr": "No such file or directory @ rb_sysopen - /box/script.py" }
```

### `phase1-install.sh`

Ran remotely via SSH:

```bash
# Install Docker CE
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
echo "deb [arch=amd64 signed-by=...] https://download.docker.com/linux/ubuntu jammy stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
usermod -aG docker ubuntu

# Configure cgroup v1
echo 'GRUB_CMDLINE_LINUX_DEFAULT="systemd.unified_cgroup_hierarchy=0"' \
  >> /etc/default/grub
update-grub
```

### Why the first reboot didn't work

Ubuntu 22.04 AMIs on AWS include `/etc/default/grub.d/50-cloudimg-settings.cfg` which sets `GRUB_CMDLINE_LINUX_DEFAULT=""`. Because GRUB merges files in alphabetical order and `50-*` comes after the main `grub` file, the AWS file **overwrote** the cgroup parameter we added to `GRUB_CMDLINE_LINUX_DEFAULT`.

After the first reboot, `/proc/cmdline` showed no `systemd.unified_cgroup_hierarchy=0` and `/sys/fs/cgroup/memory/` was empty/missing.

### The Fix

Instead of modifying `GRUB_CMDLINE_LINUX_DEFAULT` (which AWS overrides), we created a **higher-priority** file that modifies `GRUB_CMDLINE_LINUX` — a separate variable that AWS's file does not touch:

```bash
cat > /etc/default/grub.d/60-cgroup-v1.cfg << 'EOF'
GRUB_CMDLINE_LINUX="systemd.unified_cgroup_hierarchy=0"
EOF
update-grub
reboot
```

The file is named `60-*` so it loads **after** the `50-cloudimg-settings.cfg` and cannot be overridden.

After the second reboot, verification:
```bash
cat /proc/cmdline
# → ... systemd.unified_cgroup_hierarchy=0 ...

ls /sys/fs/cgroup/memory/ | wc -l
# → 43  (cgroup v1 subsystems mounted)
```

---

## Phase 5 — Starting Judge0

### Config file

`_push_configs.py` now writes and uploads config files from environment-provided secrets (no hardcoded secrets in repo). The final `/opt/judge0/judge0.conf` contains:

```
POSTGRES_PASSWORD=<redacted>
REDIS_PASSWORD=<redacted>
```
(actual values intentionally not stored in this repository)

### Starting

```bash
cd /opt/judge0
docker compose pull
docker compose up -d
```

Startup order (enforced by `depends_on` with health checks):
1. `db` (postgres) — health checked with `pg_isready -U judge0`
2. `redis`
3. `server` — runs Judge0 CE API, waits for db + redis
4. `workers` — runs `./scripts/workers`, pulls jobs from redis queue

### Language ID verification

```bash
curl -s http://localhost:2358/languages | python3 -c "
import sys, json
langs = json.load(sys.stdin)
py = [l for l in langs if 'Python' in l['name']]
print(py)
"
# → [{'id': 71, 'name': 'Python (3.8.1)'}]
```

Python 3.8 is language_id `71`. This is the ID the runner sends for all Python submissions.

### Smoke test

```bash
curl -s -X POST http://localhost:2358/submissions?wait=true \
  -H "Content-Type: application/json" \
  -d '{"source_code":"print(\"__OK__\")","language_id":71,"stdin":""}' | python3 -m json.tool
```

Response:
```json
{
  "stdout": "__OK__\n",
  "status": { "id": 3, "description": "Accepted" }
}
```

---

## Phase 6 — Building and Starting the Runner

### Source upload

```bash
rsync -az --exclude node_modules --exclude .env \
  -e "ssh -i ~/.ssh/dsa-runner.pem" \
  runner-service/ ubuntu@13.127.112.212:/opt/dsa-runner-src/
```

### Docker build

```bash
ssh -i ~/.ssh/dsa-runner.pem ubuntu@13.127.112.212 \
  "docker build -t dsa-runner:latest /opt/dsa-runner-src"
```

The Dockerfile is multi-stage so the final image contains no `devDependencies` and no `.env` files.

### `.env` file (`/opt/dsa-runner/.env`)

```
RUNNER_PORT=8787
RUNNER_ALLOWED_ORIGIN=http://localhost:5173,http://localhost:4173,https://czarflix.me,https://runner.czarflix.me
SUPABASE_URL=https://fjulxsdwycrmtamwfjxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<redacted>
JUDGE0_URL=http://host.docker.internal:2358
JUDGE0_API_KEY=
RUNNER_MAX_TESTS=150
RUNNER_MAX_CODE_CHARS=200000
RUNNER_TIME_LIMIT=5
RUNNER_WALL_TIME_LIMIT=10
RUNNER_MEMORY_LIMIT_KB=262144
```

`host.docker.internal` resolves to the Docker bridge gateway (`172.17.0.1`) from inside any container, pointing at the host — where Judge0 is listening on `0.0.0.0:2358`.

### Start

```bash
cd /opt/dsa-runner && docker compose up -d
curl http://localhost:8787/healthz
# → {"ok":true,"now":"..."}
```

---

## Phase 7 — E2E Validation

### Run (not persisted)

```
User: AYAAN | Problem: LC 217 (Contains Duplicate)
Result: status=passed, 94/94 tests passed
```

### Submit (persisted to Supabase)

```
User: MANTSHA | Problem: LC 217 (Contains Duplicate)
Result: status=passed, 94/94 tests passed
```

Supabase `progress` table check:
```sql
SELECT user_key, problem_lc, status, solved_at
FROM progress
WHERE user_key = 'MANTSHA' AND problem_lc = 217;
```
Result: `{ status: solved, solved_at: 2026-03-04T14:51:22Z }`

---

## Phase 8 — TLS with nginx + Let's Encrypt

### DNS

At Namecheap DNS panel:
- Type: **A Record**
- Host: `runner`
- Value: `13.127.112.212`
- TTL: Automatic

**Why A record, not CNAME:**  
The runner domain points directly to an IP address. CNAME requires a hostname target, not an IP. An A record maps a subdomain directly to an IPv4 address.

Verification:
```bash
dig +short runner.czarflix.me A
# → 13.127.112.212
```

### `_setup_tls.py`

1. Installed nginx and certbot:
   ```bash
   apt-get install -y nginx python3-certbot-nginx
   ```

2. Wrote `/etc/nginx/sites-available/runner`:
   ```nginx
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
   ```

3. Enabled the site, removed the default:
   ```bash
   ln -sf /etc/nginx/sites-available/runner /etc/nginx/sites-enabled/runner
   rm -f /etc/nginx/sites-enabled/default
   nginx -t && systemctl reload nginx
   ```

4. Issued Let's Encrypt certificate:
   ```bash
   certbot --nginx \
     --non-interactive --agree-tos \
     --email admin@czarflix.me \
     --redirect \
     -d runner.czarflix.me
   ```

   `--redirect` automatically adds an HTTP → HTTPS redirect block to the nginx config.

Certbot also installs a systemd timer (`certbot.timer`) that auto-renews certificates before expiry. No manual renewal needed.

Certificate details:
- Expiry: 2026-06-02 (90 days from issue)
- Path: `/etc/letsencrypt/live/runner.czarflix.me/`
- Auto-renewal: enabled via `certbot.timer`

---

## Phase 9 — CORS Tightening and Port Hardening

### CORS Update (`_update_cors.py`)

Updated `/opt/dsa-runner/.env` on EC2:
```
RUNNER_ALLOWED_ORIGIN=http://localhost:5173,http://localhost:4173,https://czarflix.me,https://runner.czarflix.me
```
Then restarted the container: `docker compose restart`.

The runner's `getAllowedOrigin()` now validates every request's `Origin` header against this Set. Any origin not in the list gets `403` on preflight and no CORS headers on actual requests.

### Port 8787 closure verification

```bash
aws ec2 describe-security-groups \
  --region ap-south-1 \
  --group-ids sg-0d3c388499e220b3b \
  --query 'SecurityGroups[0].IpPermissions'
```

All external traffic now goes through nginx on 443. Port 8787 is still **bound** inside EC2 (for nginx proxying) but not internet-reachable.

---

## Key Decisions and Why

| Decision | Reason |
|----------|--------|
| t3.medium over t3.small | Judge0 workers need at least 2 GB; small (2 GB) had OOM kills during multi-threaded test runs |
| Single EC2 host for Judge0 + runner | Runner talks to Judge0 on Docker bridge (zero network latency, no auth needed between them) |
| cgroup v1 required | `isolate` (Judge0 sandbox) only supports cgroup v1; cgroup v2 silently fails submissions |
| Elastic IP not just public IP | EC2 public IPs change on stop/start; Elastic IP is static → DNS stays valid forever |
| nginx in front of runner | Let's Encrypt requires a web server; nginx provides TLS termination, keeps port 8787 off the internet, enables future rate-limiting and request logging |
| Port 2358 bound to 0.0.0.0 (not 127.0.0.1) | Runner container runs on Docker bridge, not localhost. From container, `host.docker.internal` → `172.17.0.1` (not `127.0.0.1`). If bound to `127.0.0.1`, the container's TCP connections are refused. The SG blocks 2358 externally. |
| Python `_push_configs.py` instead of SSH heredocs | Terminal tool corrupted multi-line heredocs when the content contained special characters (dollar signs in passwords, quotes). Plain file write + SCP is reliable. |

---

## Problems Encountered and How They Were Solved

### 1. cgroup v1 not taking effect after first reboot

**Symptom:** `/sys/fs/cgroup/memory/` empty after reboot; `isolate` failed every submission.

**Root cause:** `/etc/default/grub.d/50-cloudimg-settings.cfg` (AWS) set `GRUB_CMDLINE_LINUX_DEFAULT=""`, which overrode our modification to the same variable.

**Fix:** Created `/etc/default/grub.d/60-cgroup-v1.cfg` modifying `GRUB_CMDLINE_LINUX` instead — a different variable, not touched by the AWS file, and with a higher sort order (60 > 50).

---

### 2. `cgroupns: host` caused Compose validation error

**Symptom:** `docker compose up` failed with `unknown field 'cgroupns'`.

**Root cause:** `cgroupns: host` was added to the Judge0 Compose file as an attempted fix for the cgroup issue. It is not supported in the Compose v5 schema (Compose v2.x+).

**Fix:** Removed `cgroupns: host` from both `server` and `workers` services. It was not needed once cgroup v1 was active at the kernel level.

---

### 3. Runner container couldn't reach Judge0

**Symptom:** `/runs` returned `"fetch failed"` immediately after submission.

**Root cause:** Judge0 was bound to `127.0.0.1:2358`. From inside the runner container, `host.docker.internal` resolves to `172.17.0.1` (the Docker bridge gateway), not `127.0.0.1`. A TCP connect to `172.17.0.1:2358` was refused because nothing was listening there.

**Fix:** Changed Judge0 Compose port from `127.0.0.1:2358:2358` to `2358:2358` (0.0.0.0). Port 2358 is blocked by the AWS Security Group, so it remains inaccessible from the internet.

---

### 4. Port 443 missing from Security Group

**Symptom:** `curl https://runner.czarflix.me/healthz` timed out immediately after TLS setup.

**Root cause:** An earlier `_provision.py` revision created an SG without port 443. HTTPS traffic was therefore blocked.

**Fix:**
```bash
aws ec2 authorize-security-group-ingress \
  --region ap-south-1 \
  --group-id sg-0d3c388499e220b3b \
  --protocol tcp --port 443 --cidr 0.0.0.0/0
```

**Note:** `_provision.py` was later hardened so new deployments include 22/80/443 by default.

---

### 5. Terminal heredoc corruption

**Symptom:** Judge0 config and runner `.env` files written via SSH heredocs contained garbled text — passwords with `$` signs were expanded as shell variables before reaching the remote shell.

**Fix:** Created `_push_configs.py` — writes the file content locally as a plain Python string, then `scp`s it to the server. No shell expansion possible.

---

## Final Infrastructure State

| Component | Value |
|-----------|-------|
| EC2 instance ID | `i-093ad65e8d39bfaf2` |
| Instance type | t3.medium |
| Region | ap-south-1 (Mumbai) |
| Elastic IP | `13.127.112.212` |
| EIP allocation ID | `eipalloc-0e5c3bd46f97c08cf` |
| Security Group | `sg-0d3c388499e220b3b` |
| Open ports | 22, 80, 443 (8787 closed) |
| Key pair | `dsa-runner` → `~/.ssh/dsa-runner.pem` |
| Judge0 image | `judge0/judge0:1.13.1` |
| Runner image | `dsa-runner:latest` (built from source) |
| nginx config | `/etc/nginx/sites-enabled/runner` |
| TLS cert | `/etc/letsencrypt/live/runner.czarflix.me/` |
| Cert expiry | 2026-06-02 (auto-renews) |
| cgroup config | `/etc/default/grub.d/60-cgroup-v1.cfg` |
| Judge0 dir | `/opt/judge0/` |
| Runner dir | `/opt/dsa-runner/` |
| Runner source | `/opt/dsa-runner-src/` |
| Frontend env | `VITE_RUNNER_API_URL=https://runner.czarflix.me` |

### Security Group rules (final)

| Port | Proto | Source | Purpose |
|------|-------|--------|---------|
| 22   | TCP | 0.0.0.0/0 | SSH admin |
| 80   | TCP | 0.0.0.0/0 | Redirect to HTTPS |
| 443  | TCP | 0.0.0.0/0 | HTTPS (nginx → runner) |

---

## Current Product Semantics

- `submit` + `passed` writes a solved state to `progress` for that `user_key + problem_lc`.
- The frontend now supports deleting historical `code_runs` entries from the Problem page.
- Solved status is reconciled from surviving submissions:
  - If at least one passed run exists with `runner_meta.mode = "submit"`, status remains `solved`.
  - If no passed submit runs remain, status is set to `unsolved`.
- Dashboard counts are based on `progress`, so they update to reflect the same solved/unsolved reality after invalidation/refetch.
- Result panel surfaces Judge + harness metadata in a compact form: mode, tests passed/total, runtime, memory, Judge status, and stderr/compile output.
