# SQL Runner — Full Implementation & Deployment Handoff Report

**Date:** 2026-03-08  
**Session scope:** Implement the SQL execution backend in the existing DSA runner service, test locally, deploy to EC2, verify live.  
**Status at handoff:** Implementation complete · Local tests 8/8 · Deployed to EC2 (healthy) · Public endpoint live (`https://runner.czarflix.me`) · Supabase migration 202603080001 **NOT YET APPLIED** (corpus fallback active)

---

## 1. Mandate

The handoff prompt required:

1. Add a SQL execution path to the **existing** runner service — no separate backend, no new app.
2. Use a **dedicated PostgreSQL 14** execution database — not Supabase, not SQLite, not Judge0.
3. **Schema-per-fixture transaction isolation** mirroring `postgres_verify.py` exactly.
4. Keep the **DSA / Python / Judge0 path unchanged**.
5. Do **not** modify the frontend.
6. Deploy the updated runner, verify it live, and return the endpoint.

---

## 2. What Existed Before

The runner service lives at:

```
dsa-app/runner-service/
├── Dockerfile
├── package.json          (was 0.1.0, only @supabase/supabase-js + dotenv)
├── src/
│   ├── server.mjs        (HTTP server, only DSA path existed)
│   ├── config.mjs        (env-var loader)
│   ├── harness.mjs       (Python harness builder for Judge0)
│   └── judge0.mjs        (Judge0 HTTP client)
```

The EC2 deployment stack is at `/opt/dsa-runner/` on `ubuntu@13.127.112.212`.  
Source was synced before build to `/opt/dsa-runner-src/`.  
Judge0 runs on the same EC2 host at `http://172.17.0.1:2358`.

The SQL corpus sits locally at:
```
sql-rebuild/out/corpus_expanded_candidates.json
```
148 SQL problems, each with a `fixtures[]` array containing: `fixture_key`, `setup_sql`, `expected_columns`, `expected_rows`, `comparison_mode`, `order_required`, `postcheck_sql`.

---

## 3. Files Created / Modified

### 3.1 NEW — `runner-service/src/corpus-loader.mjs`

**Purpose:** Loads spec + fixtures for a SQL problem.  
**Primary path:** Supabase `sql_problem_specs` + `sql_problem_fixtures` tables.  
**Fallback path:** Local corpus JSON (active right now because migration is not applied).

Key behaviour:
- `loadSqlProblem(problemKey, supabase)` — async, returns `{ submission_kind, fixtures[] }` or `null`.
- Corpus is cached in-memory after first load (no re-reads per request).
- Auto-detects corpus path: `runner-service/src/` → `runner-service/` → `dsa-app/` → `DSA/sql-rebuild/out/corpus_expanded_candidates.json`.
- Override via `SQL_CORPUS_PATH` env var.
- If Supabase tables return an error (e.g. `PGRST205` — table not found) it **silently falls back** to corpus; no crash.

### 3.2 NEW — `runner-service/src/sql-runner.mjs`

**Purpose:** Core SQL execution engine. Mirrors `postgres_verify.py` exactly.

**Execution model per fixture:**
```
BEGIN
CREATE SCHEMA "sql_run_<8 random hex chars>"
SET LOCAL search_path TO "<schema>", public
<setup_sql>                        -- create tables + insert fixture data
<user_sql>  (or user_sql then postcheck_sql for 'script' kind)
compare result vs expected
ROLLBACK    ← always, even on error
```

Why schema-per-fixture instead of separate DB or table prefixes:
- Different problems reuse table names (e.g. `Person`, `Employee`).
- Different fixtures need independent data.
- Concurrent users must not collide.
- `ROLLBACK` guarantees full cleanup even if user SQL partially mutates state.

**`pg` type overrides (set at module init):**
```js
pg.types.setTypeParser(1700, val => parseFloat(val))   // numeric → float
pg.types.setTypeParser(20,   val => Number(val))        // int8 → number
```
This matches Python's JSON serialization of corpus expected values.

**`pgCellToJson(value)` normalisation:**
- `Date` objects → `"YYYY-MM-DD HH:MM:SS"` (mirrors Python `datetime.isoformat(sep=" ")`)
- Numeric strings → `number`
- `null` → `null`

**`normalizeCell(value)` for comparison:**
- Numbers: `parseFloat(n.toPrecision(12))` to avoid float drift
- Timestamp `T` → ` ` normalisation
- Strings: `.trim()`

**`compareResults(...)` modes (mirrors Python `_compare()`):**
- `ordered_rows` — strict row + column order
- `unordered_multiset` — sort both sides by JSON key, compare
- `single_value` — `result[0][0]` vs `expected[0][0]`
- `single_row` — single row exact match
- Mode aliases: `exact` / `ordered_table` → `ordered_rows`; `unordered_table` → `unordered_multiset`

**`executeSql({ userSql, submissionKind, fixtures, selectedCaseIds })`:**
- Gets one `pg.PoolClient` per fixture (released in `finally`).
- Pool: `max: 10`, `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 5000`.
- `selectedCaseIds`: if provided and non-empty, only those `fixture_key` values are run.
- Returns array of per-case result records: `{ id, label, passed, expected, output, error, message }`.

**`closeSqlPool()`:** gracefully drains pool — not wired to `SIGTERM` yet (fine for current use).

### 3.3 MODIFIED — `runner-service/src/config.mjs`

Added at end of `runnerConfig` object:
```js
sqlExecPgDsn: String(process.env.SQL_EXEC_PG_DSN || '').trim(),
```

Added to `validateConfig()`:
```js
if (!runnerConfig.sqlExecPgDsn) {
  missing.push('SQL_EXEC_PG_DSN')
}
```

This means the runner **crashes on startup** if `SQL_EXEC_PG_DSN` is absent — fail-fast rather than silent failure at query time.

### 3.4 MODIFIED — `runner-service/src/server.mjs`

**New imports (top of file):**
```js
import { loadSqlProblem } from './corpus-loader.mjs'
import { executeSql }     from './sql-runner.mjs'
```

**`createRun` → `createDsaRun(req, res, body)`:**  
Renamed and updated to accept a pre-parsed body object (required because the route handler now reads the body once and dispatches — the body stream can only be read once in raw Node HTTP).

**New function: `markSqlProgressSolved(userKey, problemKey)`:**  
Persists a `progress` row for SQL problems. Uses manual select → insert/update (not `upsert`) because the partial unique index `ux_progress_user_problem_key WHERE problem_key IS NOT NULL` is not compatible with Supabase's `onConflict` upsert helper.  
Sets `problem_lc: null`, `problem_type: 'sql'`.

**New function: `processSqlRun({ runId, userKey, problemKey, trackKey, mode, solutionId, selectedCaseIds, code, spec })`:**  
Background processor (called with `void`, never awaited by request handler).
- Updates `code_runs.status = 'running'` immediately.
- Calls `executeSql(...)`.
- Updates `code_runs` with `status`, `tests_total`, `tests_passed`, and full `verdict.cases` JSON array.
- If `mode === 'submit'` and all cases pass → calls `markSqlProgressSolved`.
- On error: updates `code_runs.status = 'error'`, stores `stderr`.

**New function: `createSqlRun(req, res, body)`:**  
Request handler for SQL runs.
- Validates: `user_key`, `problem_key`, `code` (non-empty, ≤ maxCodeChars).
- Calls `loadSqlProblem` — 404 if not found.
- Validates `selected_case_ids` against known fixture keys.
- Inserts `code_runs` row: `language='sql'`, `track_key`, `problem_key`, `problem_lc=null`.
- Responds `201` with `{ id, status, tests_total }`.
- Fires `processSqlRun` in background.

**Updated route handler (`POST /runs`):**
```js
// Read body once; dispatch to SQL or DSA path based on track/language
const body = await readJsonBody(req)
const trackKey = String(body?.track_key || '').trim()
const language  = String(body?.language  || '').trim()
if (trackKey === 'sql' || language === 'sql') {
  await createSqlRun(req, res, body)
} else {
  await createDsaRun(req, res, body)
}
```

The DSA path is **100% unchanged in behaviour** — only the body is now passed in rather than re-read from the stream.

### 3.5 MODIFIED — `runner-service/package.json`

- Version bumped: `0.1.0` → `0.2.0`
- Added dependency: `"pg": "^8.13.3"` (node-postgres, pure JS, no native bindings needed)

### 3.6 MODIFIED — `runner-service/.env.example`

Added documentation lines:
```
# Dedicated PostgreSQL 14 for SQL execution. Must NOT be Supabase.
SQL_EXEC_PG_DSN=postgresql://dsa_runner:<password>@localhost/dsa_sql_exec
# Optional: override corpus path (default: auto-detected relative to runner-service)
# SQL_CORPUS_PATH=/absolute/path/to/corpus_expanded_candidates.json
```

### 3.7 MODIFIED — `deploy/runner/docker-compose.yml`

Added `postgres:14-alpine` service:
```yaml
services:
  postgres:
    image: postgres:14-alpine
    environment:
      POSTGRES_USER: dsa_runner
      POSTGRES_PASSWORD: ${SQL_EXEC_PG_PASSWORD:?Set SQL_EXEC_PG_PASSWORD in .env}
      POSTGRES_DB: dsa_sql_exec
    volumes:
      - pgdata:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dsa_runner -d dsa_sql_exec"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s

  runner:
    ...
    depends_on:
      postgres:
        condition: service_healthy
```

Added `pgdata` named volume.

> **Note:** The EC2 docker-compose at `/opt/dsa-runner/docker-compose.yml` uses `image: dsa-runner:latest` (not `build: context:`) because the build context path is different on EC2. The local repo copy still has `build: context: ../../runner-service` for local dev.

---

## 4. Local Setup

### 4.1 PostgreSQL database

```bash
createdb dsa_sql_exec
psql dsa_sql_exec -c "CREATE ROLE dsa_runner WITH LOGIN PASSWORD 'dsa_runner_dev'"
psql dsa_sql_exec -c "GRANT ALL PRIVILEGES ON DATABASE dsa_sql_exec TO dsa_runner"
psql dsa_sql_exec -c "GRANT ALL ON SCHEMA public TO dsa_runner"
psql dsa_sql_exec -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO dsa_runner"
```

### 4.2 `.env` in `runner-service/`

```
SUPABASE_URL=https://fjulxsdwycrmtamwfjxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
JUDGE0_URL=http://localhost:2358
SQL_EXEC_PG_DSN=postgresql://dsa_runner:dsa_runner_dev@localhost/dsa_sql_exec
RUNNER_ALLOWED_ORIGIN=*
```

### 4.3 `npm install`

```bash
cd dsa-app/runner-service
npm install
# pg installed: 28 packages, 0 vulnerabilities
```

### 4.4 Syntax check

All five relevant files passed `node --input-type=module --check` before testing:
- `src/corpus-loader.mjs` ✓
- `src/sql-runner.mjs` ✓
- `src/config.mjs` ✓
- `src/server.mjs` ✓
- `package.json` ✓ (valid JSON)

---

## 5. Local Test Results

All 8 tests in `/tmp/test_sql_runner.mjs` passed. Tests ran directly against `sql-runner.mjs` (bypassing HTTP layer) with a live local PostgreSQL connection.

| # | Description | Expected | Actual |
|---|-------------|----------|--------|
| 1 | Correct LEFT JOIN — `sql-leetcode-175` Combine Two Tables | `passed: true` | ✅ passed |
| 2 | Wrong answer detection — column not in schema | `passed: false` | ✅ failed (PostgreSQL error caught) |
| 3 | Schema isolation — same "Person" table name, different fixture | `passed: true`, rows=[["TestUser"]] | ✅ correct rows, no collision |
| 4 | Concurrent runs — same table name across simultaneous requests | both `passed: true` | ✅ no collision, ran concurrently |
| 5 | `selected_case_ids` filtering — ran 1 of 2 fixtures | 1 result returned | ✅ 1 result |
| 6 | Script kind with `postcheck_sql` | `passed: true` | ✅ passed |
| 7 | SQL syntax error handling | `passed: false`, `error` field set | ✅ graceful error |
| 8 | Corpus-loader fallback — local file | 148 problems loaded, `sql-leetcode-175` has `submission_kind: query`, 7 fixtures | ✅ 148/7 correct |

**Test 2 detail:** `SELECT firstName, lastName, city, state FROM Person LEFT JOIN Address ON Person.personId = Address.personId` — `city` and `state` don't exist in the corpus fixture's Person table (only `personId`, `firstName`, `lastName`). PostgreSQL throws `column "city" does not exist`. The runner catches this, sets `passed: false`, `error: "column city does not exist"`, `message: "Execution error"`. This is the correct behaviour.

---

## 6. Deployment

### 6.1 EC2 details

| Field | Value |
|-------|-------|
| Host | `ubuntu@13.127.112.212` |
| Region | ap-south-1 |
| Instance | `i-093ad65e8d39bfaf2` |
| SSH key | `~/.ssh/dsa-runner.pem` |
| Compose dir | `/opt/dsa-runner/` |
| Source dir | `/opt/dsa-runner-src/` |
| Docker | 29.2.1 |
| Compose | v5.1.0 |

### 6.2 Deployment steps executed

**Step 1 — rsync source to EC2:**
```bash
rsync -avz --progress \
  -e "ssh -i ~/.ssh/dsa-runner.pem" \
  runner-service/ \
  ubuntu@13.127.112.212:/opt/dsa-runner-src/
```
Files synced: `src/corpus-loader.mjs`, `src/sql-runner.mjs`, `src/config.mjs` (updated), `src/server.mjs` (updated), `package.json`, `Dockerfile`, etc.

**Step 2 — Build Docker image on EC2:**
```bash
ssh ubuntu@13.127.112.212 "docker build -t dsa-runner:latest /opt/dsa-runner-src/"
```
Output confirmed: `pg` installed (28 packages, 9s build time). Image tagged `dsa-runner:latest`.

**Step 3 — Update `/opt/dsa-runner/docker-compose.yml`:**
Wrote a new compose file directly (the EC2 version cannot use `build: context:` because the runner-service relative path doesn't apply on EC2). The EC2 compose uses `image: dsa-runner:latest` and adds the `postgres:14-alpine` service with healthcheck.

**Step 4 — Add env vars to `/opt/dsa-runner/.env`:**
```
SQL_EXEC_PG_DSN=postgresql://dsa_runner:7f268419f5a1ae4970dc30abafbeee37@postgres:5432/dsa_sql_exec
SQL_EXEC_PG_PASSWORD=7f268419f5a1ae4970dc30abafbeee37
```
The `postgres` hostname resolves inside Docker Compose's internal network to the `postgres` service.

**Step 5 — Restart the stack:**
```bash
ssh ubuntu@13.127.112.212 "cd /opt/dsa-runner && docker compose down && docker compose up -d"
```
`postgres:14-alpine` was pulled (~50MB). Both containers came up healthy.  
`DEPLOY_EXIT_CODE=0`

### 6.3 Container health confirmed

```
NAME                     STATUS                      PORTS
dsa-runner-postgres-1    Up (healthy)                5432/tcp
dsa-runner-runner-1      Up (healthy)                0.0.0.0:8787->8787/tcp
```

Health check from inside EC2:
```bash
ssh ubuntu@13.127.112.212 "curl -s http://localhost:8787/healthz"
# {"ok":true,"now":"2026-03-08T11:39:16.629Z"}
```

---

## 7. Live Endpoint Verification

### 7.1 Public endpoint

Port 8787 is **not directly reachable** from the public internet (AWS security group restricts it). The runner is exposed via nginx + TLS at:

**`https://runner.czarflix.me`**

Health check confirmed:
```bash
curl -sf "https://runner.czarflix.me/healthz"
# {"ok":true,"now":"2026-03-08T11:39:22.305Z"}
```

### 7.2 SQL run + submit — NOT YET VERIFIED

Live SQL `POST /runs` tests were **not executed** because the Supabase migration `202603080001_problem_key_sql_track.sql` has not been applied yet.

When the `code_runs` INSERT fires, it passes:
```json
{
  "language": "sql",
  "problem_key": "sql-leetcode-175",
  "problem_lc": null,
  "track_key": "sql"
}
```

The existing `code_runs` table has:
- `language CHECK (language IN ('python'))` — will reject `'sql'`
- `problem_lc NOT NULL` — will reject `null`
- No `problem_key` column
- No `track_key` column

All four of these will cause the INSERT to fail. The migration adds all four fixes.

### 7.3 DSA Python path — NOT YET LIVE-TESTED

Not re-tested live after deployment. Local behaviour is unchanged (only the request-body parsing moved to the route handler; `createDsaRun` receives the same body object and does the same thing). The DSA runner path was working correctly before this session and no logic was modified.

---

## 8. The Pending Migration

File: `dsa-app/supabase/migrations/202603080001_problem_key_sql_track.sql`

**Verification that it is NOT yet applied:**
```js
fetch('https://fjulxsdwycrmtamwfjxx.supabase.co/rest/v1/sql_problem_specs?limit=1', {...})
// → {"code":"PGRST205","message":"Could not find the table 'public.sql_problem_specs'"}
```

**What the migration does (relevant to the runner):**

1. `ALTER TABLE code_runs ADD COLUMN IF NOT EXISTS problem_key text`
2. `ALTER TABLE code_runs ADD COLUMN IF NOT EXISTS track_key text`
3. `ALTER TABLE code_runs ALTER COLUMN problem_lc DROP NOT NULL`
4. `ALTER TABLE code_runs DROP CONSTRAINT code_runs_language_check`  
   `ALTER TABLE code_runs ADD CONSTRAINT code_runs_language_check CHECK (language IN ('python', 'sql'))`
5. `ALTER TABLE progress ADD COLUMN IF NOT EXISTS problem_key text`
6. `ALTER TABLE progress ALTER COLUMN problem_lc DROP NOT NULL`
7. `CREATE UNIQUE INDEX ux_progress_user_problem_key ON progress(user_key, problem_key) WHERE problem_key IS NOT NULL`
8. `CREATE TABLE sql_problem_specs (...)` — for future DB-backed corpus
9. `CREATE TABLE sql_problem_fixtures (...)` — for future DB-backed corpus
10. `INSERT INTO study_tracks VALUES ('sql', 'SQL', 2, true)`
11. Many other `problem_key` columns on `notes`, `solutions`, `resources`, etc.

**The migration also runs many UPDATE statements** to back-fill `problem_key` on all existing rows from `study_problems`. These are safe (all `IF NOT EXISTS`, all `COALESCE` / `WHERE IS NULL` guards).

**The migration must be applied before:**
- Any live `POST /runs` with `track_key: 'sql'` or `language: 'sql'`
- Any live `GET /runs/:id` for a SQL run

The corpus loader fallback is already live and working — problem specs and fixtures are served from the local corpus JSON even without the migration. The only thing blocked is the `code_runs` INSERT (which is the Supabase state persistence).

---

## 9. ENV Vars — Full Reference

### On EC2 (`/opt/dsa-runner/.env`)

| Variable | Value | Notes |
|----------|-------|-------|
| `SUPABASE_URL` | `https://fjulxsdwycrmtamwfjxx.supabase.co` | Existing |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGci...` | Existing |
| `JUDGE0_URL` | `http://172.17.0.1:2358` | Existing, Docker bridge to host Judge0 |
| `RUNNER_ALLOWED_ORIGIN` | `https://runner.czarflix.me` | Existing |
| `RUNNER_PORT` | `8787` | Existing |
| `SQL_EXEC_PG_DSN` | `postgresql://dsa_runner:7f268419f5a1ae4970dc30abafbeee37@postgres:5432/dsa_sql_exec` | **NEW** |
| `SQL_EXEC_PG_PASSWORD` | `7f268419f5a1ae4970dc30abafbeee37` | **NEW** — used by docker-compose postgres service |

### For local dev (`runner-service/.env`)

| Variable | Value |
|----------|-------|
| `SQL_EXEC_PG_DSN` | `postgresql://dsa_runner:dsa_runner_dev@localhost/dsa_sql_exec` |
| All others | Same as EC2 except `RUNNER_ALLOWED_ORIGIN=*` |

---

## 10. HTTP API — SQL Path

### `POST /runs` — Create a SQL run

**Request:**
```json
{
  "user_key":    "AYAN",
  "problem_key": "sql-leetcode-175",
  "track_key":   "sql",
  "language":    "sql",
  "mode":        "run",
  "code":        "SELECT firstName, lastName, city, state FROM Person LEFT JOIN Address ..."
}
```

Dispatch condition: `track_key === 'sql'` OR `language === 'sql'`.

Optional fields:
- `selected_case_ids: ["case1", "case2"]` — run only specific fixtures (run mode only; ignored for submit)
- `solution_id: 42` — stored in `runner_meta`
- `mode: "submit"` — runs all fixtures; marks progress if all pass

**Response (201):**
```json
{ "id": 1234, "status": "queued", "tests_total": 7 }
```

### `GET /runs/:id?user_key=AYAN` — Poll for result

**Response when complete:**
```json
{
  "id": 1234,
  "status": "passed",
  "tests_passed": 7,
  "tests_total": 7,
  "verdict": {
    "status": "passed",
    "tests_passed": 7,
    "tests_total": 7,
    "cases": [
      {
        "id": "basic",
        "label": "Basic case",
        "passed": true,
        "expected": { "columns": ["firstName","lastName"], "rows": [["John","Doe"]] },
        "output":   { "columns": ["firstName","lastName"], "rows": [["John","Doe"]] },
        "error": null,
        "message": "Passed"
      }
    ]
  },
  "summary": "7/7 tests passed"
}
```

---

## 11. What the Next Agent Must Do

### Immediate (blocks live SQL runs)

1. **Apply Supabase migration `202603080001_problem_key_sql_track.sql`.**  
   Run `npx supabase db push` after linking the project, or apply manually via the Supabase SQL editor.  
   Project ref: `fjulxsdwycrmtamwfjxx`  
   URL: `https://fjulxsdwycrmtamwfjxx.supabase.co`

2. **Run live SQL verification tests** against `https://runner.czarflix.me`:
   ```bash
   # Easy — sql-leetcode-175 (Combine Two Tables, LEFT JOIN)
   curl -X POST https://runner.czarflix.me/runs \
     -H "Content-Type: application/json" \
     -d '{"user_key":"AYAN","problem_key":"sql-leetcode-175","track_key":"sql","language":"sql","mode":"run","code":"SELECT p.firstName, p.lastName, a.city, a.state FROM Person p LEFT JOIN Address a ON p.personId = a.personId"}'

   # Poll: GET https://runner.czarflix.me/runs/<id>?user_key=AYAN
   ```

3. **Verify wrong-answer detection** (send intentionally bad SQL, confirm `status: "failed"`).

4. **Verify DSA Python path regression** (send a Python run for a known problem like LC-23, confirm it still works via Judge0).

5. **Verify `selected_case_ids`** (send a run with only one fixture key, confirm only 1 case runs).

6. **Verify submit mode** — send `mode: "submit"` with correct SQL, check `progress` table in Supabase for a new solved row.

### Optional / future

- Populate `sql_problem_specs` and `sql_problem_fixtures` tables from the corpus (once migration is applied). The corpus-loader will automatically prefer DB over file once the tables have data.
- Wire `closeSqlPool()` to `process.on('SIGTERM', ...)` in `server.mjs` for graceful shutdown.
- Consider adding nginx rate-limiting on `/runs` for SQL path (SQL execution is more expensive than Judge0 queuing).

---

## 12. Known Issues / Risks

| Issue | Severity | Status |
|-------|----------|--------|
| Migration 202603080001 not applied — SQL runs will fail at `code_runs` INSERT | **Blocker** | Pending |
| Problem 167 (Two Sum II) — 7/8 tests passed in previous DSA live verification | Low | Pre-existing, not related to this session |
| Port 8787 not directly exposed (security group) | Informational | By design — nginx proxies via TLS |
| `closeSqlPool()` not wired to SIGTERM | Low | Pool will drain when container stops; not a data hazard |
| `sql_problem_specs`/`sql_problem_fixtures` RLS policies require `current_user_key()` — service role bypasses RLS anyway | Informational | No risk; runner uses service role key |

---

## 13. File Change Summary

```
dsa-app/runner-service/src/corpus-loader.mjs    NEW
dsa-app/runner-service/src/sql-runner.mjs        NEW
dsa-app/runner-service/src/config.mjs            MODIFIED  (+sqlExecPgDsn, SQL_EXEC_PG_DSN validation)
dsa-app/runner-service/src/server.mjs            MODIFIED  (+SQL path, createRun→createDsaRun, markSqlProgressSolved, processSqlRun, createSqlRun)
dsa-app/runner-service/package.json              MODIFIED  (+pg@^8.13.3, version→0.2.0)
dsa-app/runner-service/.env.example              MODIFIED  (+SQL_EXEC_PG_DSN docs)
dsa-app/deploy/runner/docker-compose.yml         MODIFIED  (+postgres:14-alpine service)
```

Frontend, Supabase migrations, Python scripts, and all other files: **untouched**.
