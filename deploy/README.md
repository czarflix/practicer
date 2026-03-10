# DSA Tracker — EC2 Deployment Guide

Deploy **Judge0 CE** (code execution engine) and the **DSA runner service** on a single EC2 instance. The runner then replaces the public `ce.judge0.com` endpoint with your private hosted Judge0.

---

## Architecture

```
Browser (Netlify/Vite dev)
        │   HTTPS
        ▼
   Runner service          ← EC2, port 8787 (private to host; proxied by nginx)
        │   HTTP (internal)
        ▼
   Judge0 CE               ← EC2, port 2358 (host-exposed, blocked by SG)
        │
        ▼
   Supabase (code_runs, progress, problem_content, problem_test_cases)
```

---

## Step 0 — Create the EC2 Instance

| Setting | Value |
|---------|-------|
| AMI | Ubuntu 22.04 LTS (x86_64) |
| Instance type | **t3.medium** (2 vCPU / 4 GB RAM minimum) |
| Storage | 30 GB gp3 |
| Key pair | Create/select a `.pem` key |
| Security group | See below |

### Security group inbound rules

| Port | Protocol | Source | Purpose |
|------|----------|--------|---------|
| 22 | TCP | Your IP | SSH |
| 80 | TCP | 0.0.0.0/0 | HTTP → HTTPS redirect |
| 443 | TCP | 0.0.0.0/0 | HTTPS |

> Port 2358 (Judge0) is **NOT** opened to the internet — SG blocks inbound traffic to it.

---

## Step 1 — Upload project files

From your **local** machine:

```bash
export EC2_HOST=ec2-XX-XX-XX-XX.compute-1.amazonaws.com
export EC2_KEY=~/.ssh/your-key.pem
chmod +x deploy/ec2/sync-to-ec2.sh
./deploy/ec2/sync-to-ec2.sh
```

This rsyncs `runner-service/` and `deploy/` to `/opt/` on the instance.

---

## Step 2 — SSH in and run Phase 1

```bash
ssh -i ~/.ssh/your-key.pem ubuntu@$EC2_HOST
sudo /opt/dsa-deploy/ec2/phase1-install.sh
```

Phase 1 installs Docker, enables **cgroup v1** in GRUB (required by isolate), and sets up directories.

### Configure Judge0

```bash
cp /opt/judge0/judge0.conf.example /opt/judge0/judge0.conf
nano /opt/judge0/judge0.conf
```

Set **strong unique passwords**:
```
POSTGRES_PASSWORD=<random 32-char string>
REDIS_PASSWORD=<random 32-char string>
```

Optionally set an auth token (recommended if port 2358 is ever exposed):
```
AUTHN_TOKEN=<random token>
```

### Configure runner

```bash
cp /opt/dsa-runner/.env.example /opt/dsa-runner/.env
nano /opt/dsa-runner/.env
```

Fill in:
```env
RUNNER_ALLOWED_ORIGIN=https://your-app.netlify.app,http://localhost:5173
SUPABASE_SERVICE_ROLE_KEY=<your service role key>
JUDGE0_URL=http://host.docker.internal:2358
JUDGE0_API_KEY=<same as AUTHN_TOKEN in judge0.conf, or blank>
```

### Reboot

```bash
sudo reboot
```

---

## Step 3 — Run Phase 2 (after reboot)

```bash
ssh -i ~/.ssh/your-key.pem ubuntu@$EC2_HOST
/opt/dsa-deploy/ec2/phase2-start.sh
```

Phase 2 starts Judge0, waits for it to be ready, runs a Python smoke test, builds the runner image, and starts the runner.

---

## Step 4 — Update frontend env

In your Netlify environment variables (production):

```env
VITE_RUNNER_API_URL=https://runner.yourdomain.com
```

---

## Step 5 — Finalize runner env and restart

Whenever you update `/opt/dsa-runner/.env`, restart the runner:

```bash
cd /opt/dsa-runner
docker compose restart
```

---

## Manual Validation (API + UI)

### Health checks

```bash
# Judge0 (from EC2 SSH session)
curl http://localhost:2358/healthz

# Runner (from anywhere)
curl https://runner.yourdomain.com/healthz
```

### CORS and port hardening

```bash
# Allowed origin should pass preflight
curl -i -X OPTIONS "https://runner.yourdomain.com/runs" \
  -H "Origin: https://your-app.netlify.app" \
  -H "Access-Control-Request-Method: POST"

# Blocked origin should be denied
curl -i -X OPTIONS "https://runner.yourdomain.com/runs" \
  -H "Origin: https://evil.example" \
  -H "Access-Control-Request-Method: POST"

# Direct ports should not be internet-reachable
curl --max-time 5 http://YOUR_EC2_IP:8787/healthz
curl --max-time 5 http://YOUR_EC2_IP:2358/languages
```

### Test run (LC 217 — Contains Duplicate)

```bash
curl -s -X POST https://runner.yourdomain.com/runs \
  -H "Content-Type: application/json" \
  -d '{
    "user_key": "AYAAN",
    "problem_lc": 217,
    "code": "from typing import List\nclass Solution:\n    def containsDuplicate(self, nums: List[int]) -> bool:\n        return len(nums) != len(set(nums))",
    "mode": "run"
  }' | python3 -m json.tool
```

Copy the `id` from the response, then poll:

```bash
curl -s "https://runner.yourdomain.com/runs/<RUN_ID>?user_key=AYAAN" | python3 -m json.tool
```

Expected: `"status": "passed"`, `"tests_passed": 94`, `"tests_total": 94`.

### Submit test (updates `progress`)

Same as above but `"mode": "submit"`. Verify in Supabase:

```sql
SELECT * FROM progress WHERE user_key = 'AYAAN' AND problem_lc = 217;
SELECT * FROM code_runs WHERE user_key = 'AYAAN' AND problem_lc = 217 ORDER BY created_at DESC LIMIT 2;
```

### App behavior checks (submission delete + solved state)

1. Open `/problem/217` as a user (`AYAAN` or `MANTSHA`).
2. Submit passing code once.
3. Confirm status becomes `Solved` and dashboard solved count increases.
4. Submit passing code a second time.
5. Delete one passed `submit` run from History.
6. Confirm status stays `Solved` (at least one valid passed submit remains).
7. Delete the remaining passed `submit` run(s).
8. Confirm status flips to `Unsolved` and dashboard count drops accordingly.

Current rule: a problem is treated as solved if and only if at least one passed run exists with `runner_meta.mode = "submit"` for that user + problem.

### Result panel fields shown in UI

After any run/submit, the Result/History panel displays:
- mode (`run` / `submit`)
- tests passed/total
- runtime (ms)
- memory (kb)
- Judge0 status text
- stderr/compile output (trimmed for compact display)

---

## Optional: TLS via nginx

Install nginx and certbot on the EC2 instance:

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo certbot --nginx -d runner.yourdomain.com
sudo cp /opt/dsa-deploy/runner/nginx.conf.example /etc/nginx/sites-available/dsa-runner
# Edit server_name and cert paths, then:
sudo ln -s /etc/nginx/sites-available/dsa-runner /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

This requires a domain pointing to your EC2 Elastic IP.

---

## Redeploy runner after code changes

```bash
# From local machine:
./deploy/ec2/sync-to-ec2.sh

# From EC2:
docker build -t dsa-runner:latest /opt/dsa-runner-src
cd /opt/dsa-runner && docker compose up -d --force-recreate
```

---

## Python 3.8 compatibility note

Judge0 CE uses Python 3.8 in the sandbox. The harness already handles this, but user-submitted code must not use 3.9+ syntax such as:
- `list[int]` → use `from typing import List; List[int]`
- `dict[str, int]` → use `from typing import Dict; Dict[str, int]`
- `X | Y` union types → use `from typing import Union; Union[X, Y]`

The problem detail page should show a language note about this.

---

## Directory layout on EC2

```
/opt/
├── judge0/                 # Judge0 stack
│   ├── docker-compose.yml
│   └── judge0.conf         # (created from .example — contains secrets)
├── dsa-runner/             # Runner stack
│   ├── docker-compose.yml
│   └── .env                # (created from .example — contains secrets)
├── dsa-runner-src/         # runner-service/ source (for docker build)
└── dsa-deploy/             # deploy/ scripts
```
