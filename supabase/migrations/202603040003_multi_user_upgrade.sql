-- Multi-user support for two-user setup (AYAN + MANTASHA)
-- Shared problem dataset + user-scoped progress/workspace data.

begin;

create table if not exists public.app_users (
  user_key text primary key,
  display_name text not null,
  created_at timestamptz not null default now()
);

insert into public.app_users (user_key, display_name)
values
  ('AYAN', 'Ayan'),
  ('MANTASHA', 'Mantasha')
on conflict (user_key) do update
set display_name = excluded.display_name;

-- Progress (was globally unique by problem_lc)
alter table if exists public.progress
  add column if not exists user_key text not null default 'AYAN';

alter table if exists public.progress
  drop constraint if exists progress_problem_lc_key;

alter table if exists public.progress
  add constraint progress_user_problem_unique unique (user_key, problem_lc);

alter table if exists public.progress
  add constraint progress_user_key_fkey
  foreign key (user_key) references public.app_users(user_key) on delete cascade;

create index if not exists idx_progress_user_problem on public.progress(user_key, problem_lc);
create index if not exists idx_progress_user_status on public.progress(user_key, status);

-- Notes / Solutions / Resources / Targets become user scoped
alter table if exists public.notes
  add column if not exists user_key text not null default 'AYAN';
alter table if exists public.notes
  add constraint notes_user_key_fkey
  foreign key (user_key) references public.app_users(user_key) on delete cascade;
create index if not exists idx_notes_user_problem on public.notes(user_key, problem_lc);
create index if not exists idx_notes_user_sort on public.notes(user_key, problem_lc, sort_order);

alter table if exists public.solutions
  add column if not exists user_key text not null default 'AYAN';
alter table if exists public.solutions
  add constraint solutions_user_key_fkey
  foreign key (user_key) references public.app_users(user_key) on delete cascade;
create index if not exists idx_solutions_user_problem on public.solutions(user_key, problem_lc);
create index if not exists idx_solutions_user_sort on public.solutions(user_key, problem_lc, sort_order);

alter table if exists public.resources
  add column if not exists user_key text not null default 'AYAN';
alter table if exists public.resources
  add constraint resources_user_key_fkey
  foreign key (user_key) references public.app_users(user_key) on delete cascade;
create index if not exists idx_resources_user_problem on public.resources(user_key, problem_lc);

alter table if exists public.targets
  add column if not exists user_key text not null default 'AYAN';
alter table if exists public.targets
  add constraint targets_user_key_fkey
  foreign key (user_key) references public.app_users(user_key) on delete cascade;
create index if not exists idx_targets_user_deadline on public.targets(user_key, deadline);

alter table if exists public.code_runs
  add column if not exists user_key text not null default 'AYAN';
alter table if exists public.code_runs
  add constraint code_runs_user_key_fkey
  foreign key (user_key) references public.app_users(user_key) on delete cascade;
create index if not exists idx_code_runs_user_problem_created on public.code_runs(user_key, problem_lc, created_at desc);

alter table if exists public.study_events
  add column if not exists user_key text not null default 'AYAN';
alter table if exists public.study_events
  add constraint study_events_user_key_fkey
  foreign key (user_key) references public.app_users(user_key) on delete cascade;
create index if not exists idx_study_events_user_created_at on public.study_events(user_key, created_at desc);

-- Per-user metadata overrides (instead of mutating shared problems row)
create table if not exists public.user_problem_overrides (
  id bigserial primary key,
  user_key text not null references public.app_users(user_key) on delete cascade,
  problem_lc int not null,
  custom_title text,
  custom_difficulty text,
  custom_companies jsonb not null default '[]'::jsonb,
  custom_leetcode_url text,
  custom_neetcode_url text,
  custom_tags jsonb not null default '[]'::jsonb,
  custom_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_key, problem_lc),
  check (jsonb_typeof(custom_companies) = 'array'),
  check (jsonb_typeof(custom_tags) = 'array')
);

drop trigger if exists trg_user_problem_overrides_updated_at on public.user_problem_overrides;
create trigger trg_user_problem_overrides_updated_at
before update on public.user_problem_overrides
for each row
execute function public.set_updated_at();

create index if not exists idx_user_problem_overrides_user_lc
  on public.user_problem_overrides(user_key, problem_lc);

commit;
