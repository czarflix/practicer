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

## Problem Visuals

```bash
npm run build:problem-visual-manifest
npm run validate:problem-visuals
npm run generate:problem-visuals-local -- --problem-key=dsa-leetcode-11
npm run sync:problem-visuals -- --mode=ingest --manifest=out/problem-visuals-manifest.json
npm run sync:problem-visuals -- --mode=generate --problem-key=dsa-leetcode-11
```

`sync:problem-visuals` enforces `gemini-3-pro-image-preview` as the only allowed model and fails the row instead of falling back.

Local-first review flow:

```bash
npm run generate:problem-visuals-local -- --limit=5
npm run validate:problem-visuals -- --manifest=out/problem-visuals-generated/problem-visuals-local-manifest.json --require-files --allow-partial
npm run sync:problem-visuals -- --mode=ingest --manifest=out/problem-visuals-generated/problem-visuals-local-manifest.json
```

If `GOOGLE_CLOUD_PROJECT` is unset, local generation falls back to your active `gcloud` project. If ADC is broken, it falls back to `gcloud auth print-access-token`.

## Runner Service

Runner backend is in [runner-service](./runner-service/README.md).

```bash
npm --prefix runner-service install
npm run runner:dev
```

## Deployment

Deployment scripts and infra notes live under [deploy](./deploy/README.md).
