# DSA Runner Service (Python-only)

This service powers:

- `POST /runs`
- `GET /runs/:id?user_key=AYAAN`

It reads active test cases from Supabase, executes code through Judge0, and writes run history to `code_runs`.

## 1) Prerequisites

1. Supabase migrations already applied:
   - `problem_content`, `problem_test_cases`, `code_runs`
   - multi-user upgrade (`user_key` on `code_runs`)
2. Judge0 CE running (local, EC2, or private network)
3. Node.js 20+

## 2) Configure env

Copy and edit env:

```bash
cp .env.example .env
```

Required values:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JUDGE0_URL`

Optional tuning:

- `RUNNER_ALLOWED_ORIGIN` (frontend origin)
- `RUNNER_MAX_TESTS`
- `RUNNER_MAX_CODE_CHARS`
- `RUNNER_TIME_LIMIT`
- `RUNNER_WALL_TIME_LIMIT`
- `RUNNER_MEMORY_LIMIT_KB`

## 3) Run

```bash
npm install
npm run dev
```

or production:

```bash
npm run start
```

Health check:

```bash
curl http://localhost:8787/healthz
```

## 4) Frontend wiring

In app `.env.local`:

```bash
VITE_RUNNER_API_URL=http://localhost:8787
```

The frontend already posts `user_key`, `problem_lc`, `code`, `mode`.

## 5) Judge0 quick start (Docker)

Example:

```bash
docker run -d --name judge0 -p 2358:2358 judge0/judge0:1.13.1
```

If you deploy Judge0 CE via Docker Compose on EC2, set `JUDGE0_URL` to that internal/private endpoint.

## 6) Security notes

- Keep this service behind your own network boundary or reverse proxy.
- Do not expose Supabase service role key to the frontend.
- Keep `RUNNER_ALLOWED_ORIGIN` restricted in production.
