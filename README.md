# DSA Study App

Personal React + Supabase app for tracking 300 DSA problems (NeetCode + Companion), including notes, code versions, targets, and dataset-backed Python execution.

## App Setup

```bash
npm install
npm run dev
```

## Required Frontend Env (`.env.local`)

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_RUNNER_API_URL=http://localhost:8787
```

## Data Import Scripts

```bash
npm run import:problems
npm run import:dataset
```

## Runner Service (Python only)

Runner backend is in [runner-service](./runner-service/README.md).

```bash
npm --prefix runner-service install
npm run runner:dev
```

## SQL / Upgrade Docs

- Multi-user migration: [docs/multi-user-upgrade.sql](./docs/multi-user-upgrade.sql)
- Runner/content migration: [docs/problem-content-runner-upgrade.sql](./docs/problem-content-runner-upgrade.sql)
- Runner setup notes: [docs/runner-service.md](./docs/runner-service.md)
