# Problem Content + Python Runner Upgrade

This upgrade adds:

- `v_study_problems` view (one row per LC problem from existing roadmap table)
- `problem_content` table (dataset/manual problem statements and metadata)
- `problem_test_cases` table (editable test bank)
- `code_runs` table (Python runner submission history)

## 1) Run migration SQL

Run either:

- `supabase/migrations/202603040002_problem_content_and_runner.sql`
- or copy/paste `docs/problem-content-runner-upgrade.sql` into Supabase SQL Editor

## 2) Seed dataset content

From project root:

```bash
npm run import:dataset
```

Preview counts without touching Supabase:

```bash
node scripts/import-dataset-content.mjs --dry-run
```

Defaults:

- roadmap source: `../dsa-companions.json`
- dataset train: `../../LeetCodeDataset-train.jsonl`
- dataset test: `../../LeetCodeDataset-test.jsonl`

Override paths with env vars:

- `LEETCODE_DATASET_TRAIN_PATH`
- `LEETCODE_DATASET_TEST_PATH`

## 3) Expected import behavior

- Upserts `problem_content` for all 300 roadmap LC IDs.
- Seeds dataset rows for matched IDs (273 in your current files).
- Creates manual placeholder rows for unmatched IDs (27 currently).
- Re-running import does not duplicate rows:
  - `problem_content` is upserted by `problem_lc`.
  - dataset cases are rebuilt from scratch for `source='dataset'`.
- Rebuilds only `source='dataset'` rows in `problem_test_cases`.
- Leaves manual test-case edits untouched.
- Preserves existing unmatched manual content rows on re-run.

## 4) Next phase

- Add Settings UI for per-problem test-case editing.
- Add Python runner API service (Judge0-backed).
- Store each run in `code_runs`.
