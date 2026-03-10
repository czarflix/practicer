# SQL Presentation Rollout

This is the SQL-only rollout for standardized problem-pane presentation.

Source of truth:
- `/Users/czarflix/sql_metadata/sql_workspace_presentation/sql_workspace_presentation_verified.json`

This rollout:
- adds `problem_content.presentation`
- writes the verified SQL presentation object into all `148` imported SQL rows
- lets the SQL workspace render:
  - `Statement`
  - `Schema`
  - `Examples`
  - `Notes`
  - `Source`

It does **not** change:
- SQL fixtures
- SQL specs
- runner semantics
- DSA content

## 1. Apply the small presentation migration

Run this in Supabase SQL Editor:

```text
/Users/czarflix/Downloads/DSA/dsa-app/supabase/migrations/202603080005_problem_content_presentation.sql
```

This adds:
- `public.problem_content.presentation jsonb not null default '{}'::jsonb`

## 2. Rebuild the SQL import payload locally

This ensures the SQL payload contains the verified presentation object for all SQL rows.

```bash
cd /Users/czarflix/Downloads/DSA/dsa-app
npm run build:sql-import
npm run validate:sql-import
```

Validation now also checks that every SQL `problem_content` row includes:
- `presentation.statement`
- `presentation.schema`
- `presentation.examples`
- `presentation.notes`
- `presentation.source`

## 3. Dry-run the presentation import

```bash
cd /Users/czarflix/Downloads/DSA/dsa-app
npm run import:sql-presentation -- --dry-run
```

This prints:
- presentation source path
- row count
- targeted `problem_key`s

## 4. Apply the SQL-only presentation update

```bash
cd /Users/czarflix/Downloads/DSA/dsa-app
npm run import:sql-presentation
```

Behavior:
- validates that `problem_content` rows already exist for the SQL keys
- updates only `problem_content.presentation`
- does not reinsert fixtures/specs/problems

## 5. Verify in the app

Check representative SQL problems:
- `sql-leetcode-175`
- `sql-stratascratch-10016`
- `sql-leetcode-1321`

Expected UI outcome:
- no raw pseudo-Markdown tables
- real schema tables
- real example input/output tables
- no SQL runtime section in the description pane
- source links still work

## Notes

- This rollout is SQL-only.
- DSA standardization is intentionally deferred.
- If the full SQL import payload is rebuilt later, it already carries the verified `presentation` object, so future full SQL imports stay consistent.
