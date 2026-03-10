-- Dashboard analytics + review pipeline upgrade
-- Run this in Supabase SQL Editor before enabling advanced review scheduling.

begin;

-- 1) Extend progress with explicit review scheduling metadata
alter table if exists public.progress
  add column if not exists review_due_at timestamptz,
  add column if not exists last_status_changed_at timestamptz default now(),
  add column if not exists solved_count int default 0;

-- 2) Event log for velocity and audit history (recommended)
create table if not exists public.study_events (
  id bigserial primary key,
  problem_lc int not null,
  event_type text not null check (event_type in ('attempted','solved','reviewed','status_changed','time_logged')),
  event_value jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 3) Performance indexes
create index if not exists idx_progress_status on public.progress(status);
create index if not exists idx_progress_solved_at on public.progress(solved_at desc);
create index if not exists idx_progress_review_due_at on public.progress(review_due_at);
create index if not exists idx_study_events_created_at on public.study_events(created_at desc);
create index if not exists idx_study_events_problem_lc on public.study_events(problem_lc);

-- 4) Helpful view for dashboard velocity
create or replace view public.v_solved_per_day as
select
  date_trunc('day', solved_at)::date as solved_day,
  count(*)::int as solved_count
from public.progress
where solved_at is not null
group by 1
order by 1 desc;

commit;
