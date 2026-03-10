# SQL Pilot Import

This is the app-side staging workflow for SQL import. It does **not** replace the SQL runner validation step.

## Preconditions

- Do **not** run the SQL import until:
  - the SQL runner path is implemented and deployed
  - the cross-track migrations are applied
  - one pilot phase is chosen
- Source of truth for SQL import rows:
  - `/Users/czarflix/Downloads/DSA/sql-rebuild/out/corpus_expanded_candidates.json`

## Build payloads

Build the full SQL payload:

```bash
cd /Users/czarflix/Downloads/DSA/dsa-app
npm run build:sql-import
```

Build a single-phase pilot payload:

```bash
cd /Users/czarflix/Downloads/DSA/dsa-app
node scripts/build-sql-import.mjs --phase 1
```

This writes a phase-scoped payload under:

```text
/Users/czarflix/Downloads/DSA/dsa-app/out/sql-import/phase-1
```

You can also build multiple phases:

```bash
node scripts/build-sql-import.mjs --phase 1,2
```

Or an explicit selection:

```bash
node scripts/build-sql-import.mjs --problem-key sql-leetcode-175,sql-datalemur-click-through-rate --label pilot-smoke
```

## Validate payloads

Validate the default full payload:

```bash
cd /Users/czarflix/Downloads/DSA/dsa-app
npm run validate:sql-import
```

Validate a pilot payload:

```bash
cd /Users/czarflix/Downloads/DSA/dsa-app
node scripts/validate-sql-import.mjs --payload out/sql-import/phase-1/sql-import-payload.json --out out/sql-import/phase-1/sql-import-validation.json
```

Validation checks:
- no duplicate `problem_key`
- no duplicate `source_problem_id`
- exact manifest alignment for the selected subset
- module/tier/order consistency
- content/spec/reference presence
- at least one public fixture per problem

## Validate pilot state after import

After the pilot phase is imported, validate the live Supabase state:

```bash
cd /Users/czarflix/Downloads/DSA/dsa-app
npm run validate:sql-pilot
```

Output file:

```text
/Users/czarflix/Downloads/DSA/dsa-app/out/sql-import/sql-pilot-validation.json
```

This verifies:
- phase 1 SQL module exists
- SQL study problems are present in both `study_problems` and `v_study_problems`
- `problem_content`, `sql_problem_specs`, and `sql_problem_reference_solutions` counts match the imported problem count
- SQL fixtures exist
- representative SQL problems are present
- an example SQL submit produced a solved `progress` row

## Dry-run import

Do a dry run first:

```bash
cd /Users/czarflix/Downloads/DSA/dsa-app
node scripts/import-sql-payload.mjs --payload out/sql-import/phase-1/sql-import-payload.json --dry-run
```

This prints counts and the selected `problem_key`s without touching Supabase.

## Real import

Only after:
- SQL runner is live and validated
- migration `/Users/czarflix/Downloads/DSA/dsa-app/supabase/migrations/202603080001_problem_key_sql_track.sql` is applied
- migration `/Users/czarflix/Downloads/DSA/dsa-app/supabase/migrations/202603080002_problem_key_runtime_notifications.sql` is applied
- migration `/Users/czarflix/Downloads/DSA/dsa-app/supabase/migrations/202603080003_progress_problem_type_sql.sql` is applied
- pilot payload validation is clean

Run:

```bash
cd /Users/czarflix/Downloads/DSA/dsa-app
node scripts/import-sql-payload.mjs --payload out/sql-import/phase-1/sql-import-payload.json
```

Behavior:
- upserts `study_tracks`
- upserts `study_modules`
- upserts `study_problems`
- upserts `problem_content`
- upserts `sql_problem_specs`
- upserts `sql_problem_reference_solutions`
- replaces `sql_problem_fixtures` for the imported `problem_key`s

## Recommended pilot order

1. Verify the deployed SQL runner is reachable and healthy
2. Apply `/Users/czarflix/Downloads/DSA/dsa-app/supabase/migrations/202603080001_problem_key_sql_track.sql`
3. Apply `/Users/czarflix/Downloads/DSA/dsa-app/supabase/migrations/202603080002_problem_key_runtime_notifications.sql`
4. Apply `/Users/czarflix/Downloads/DSA/dsa-app/supabase/migrations/202603080003_progress_problem_type_sql.sql`
5. Import phase 1
6. Run `npm run validate:sql-pilot`
7. Replay representative phase-1 SQL problems through the live runner
8. Verify app/admin/workspace/notifications/dashboard behavior
9. Only then import the remaining phases

## Live runner smoke

Use the scripted smoke path after the two migrations are applied and phase 1 is imported:

```bash
cd /Users/czarflix/Downloads/DSA/dsa-app
npm run smoke:sql-runner
```

Default checks:
- `sql-leetcode-175` (`run`)
- `sql-datalemur-international-call-percentage` (`run`)
- `sql-datalemur-international-call-percentage` selected-fixture rerun (`run`)
- `sql-leetcode-leetcode-569` (`run`)

Output file:

```text
/Users/czarflix/Downloads/DSA/dsa-app/out/sql-import/sql-runner-smoke.json
```

Optional submit check:

```bash
npm run smoke:sql-runner -- --include-submit
```

Notes:
- default user key is `AYAAN`
- override with `--user-key MANTSHA` if needed
- `--include-submit` mutates `code_runs` and can reconcile progress, so use it only after `080001`, `080002`, and `080003` are live
- the script uses the verified local SQL corpus to select representative problems and reference SQL
- the live runner deployment currently does not have corpus fallback material available, so the smoke step must run against imported SQL fixtures, not before import
- when `--include-submit` is used, the smoke report also verifies:
  - solved `progress` exists for the submitted SQL problem
  - cross-user `problem_solved` notification exists

## Rollout notes

- `202603080002_problem_key_runtime_notifications.sql` suppresses `SYSTEM`-authored
  `problem_added` / `test_case_added` / `test_case_updated` notifications during bulk
  import. Manual admin changes still notify normally.
- The deployed SQL runner should be validated against imported SQL fixtures, not assumed
  to have local corpus fallback material on the server.
