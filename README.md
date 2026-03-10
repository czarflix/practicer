# Practicer

## Product

Website overview and feature summary live in [PRODUCT_OVERVIEW.md](./PRODUCT_OVERVIEW.md).

Unified React + Supabase workspace for DSA and SQL practice, with a separate runner backend for code execution.

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
npm run import:sql
npm run import:sql-presentation
```

## Runner Service

Runner backend is in [runner-service](./runner-service/README.md).

```bash
npm --prefix runner-service install
npm run runner:dev
```

## Deployment

Deployment scripts and infra notes live under [deploy](./deploy/README.md).
