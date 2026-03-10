# Dashboard DB Upgrade Notes

Use this upgrade to support reliable review scheduling and richer analytics.

## 1) Run migration SQL

Execute:

- `docs/dashboard-db-upgrade.sql`

This adds:

- `progress.review_due_at`
- `progress.last_status_changed_at`
- `progress.solved_count`
- `study_events` table
- useful indexes
- `v_solved_per_day` view

## 2) Backfill review_due_at (optional)

If you want an immediate review queue seed:

```sql
update public.progress
set review_due_at = solved_at + interval '7 days'
where solved_at is not null
  and review_due_at is null;
```

## 3) Recommended app-side event writes (future)

On status/timer actions, insert into `study_events`:

- `attempted`
- `solved`
- `reviewed`
- `status_changed`
- `time_logged`

This gives a full audit trail and better long-term metrics.
