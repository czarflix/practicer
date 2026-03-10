# Multi-User Upgrade (AYAN + MANTASHA)

Run this SQL in Supabase SQL Editor:

- `docs/multi-user-upgrade.sql`
- or `supabase/migrations/202603040003_multi_user_upgrade.sql`

## What this changes

- Adds `app_users` with two placeholder users:
  - `AYAN` / Ayan
  - `MANTASHA` / Mantasha
- Makes workspace data user-scoped:
  - `progress`, `notes`, `solutions`, `resources`, `targets`, `code_runs`
  - `study_events` (if present)
- Replaces global progress uniqueness:
  - from `unique(problem_lc)`
  - to `unique(user_key, problem_lc)`
- Adds `user_problem_overrides` for per-user metadata customization without mutating shared `problems`.

## Frontend behavior after this upgrade

- Sidebar lets you switch between AYAN and MANTASHA.
- Dashboard/targets/problem workspace data is isolated per selected user.
- Shared dataset tables remain common:
  - `problems`, `problem_content`, `problem_test_cases`

## Important

- Apply this migration before using the updated app build.
- If you skip it, user-scoped queries/mutations will fail due missing columns/tables.
