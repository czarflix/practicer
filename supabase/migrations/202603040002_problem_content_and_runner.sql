-- Problem content + test bank + Python runner support
-- Keeps existing `problems` table intact and layers normalized content on top.

begin;

-- Shared updated_at trigger function
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Flatten current pair-based roadmap table into one row per LC problem.
create or replace view public.v_study_problems as
select
  nc_lc as problem_lc,
  'neetcode'::text as track,
  phase,
  phase_name,
  phase_order,
  coalesce(nc_tier, tier) as tier,
  nc_title as title,
  nc_slug as slug,
  nc_difficulty as difficulty,
  nc_leetcode_url as leetcode_url,
  nc_companies as companies
from public.problems
union all
select
  cp_lc as problem_lc,
  'companion'::text as track,
  phase,
  phase_name,
  phase_order,
  coalesce(cp_tier, tier) as tier,
  cp_title as title,
  cp_slug as slug,
  cp_difficulty as difficulty,
  cp_leetcode_url as leetcode_url,
  cp_companies as companies
from public.problems;

-- Canonical problem content store (dataset + manual enrichment)
create table if not exists public.problem_content (
  problem_lc int primary key,
  task_id text,
  title text,
  difficulty text,
  tags jsonb not null default '[]'::jsonb,
  problem_description text,
  starter_code text,
  entry_point text,
  estimated_date date,
  dataset_prompt text,
  dataset_completion text,
  dataset_query text,
  dataset_response text,
  dataset_test_harness text,
  input_output jsonb not null default '[]'::jsonb,
  source text not null default 'dataset' check (source in ('dataset', 'manual', 'mixed')),
  dataset_split text check (dataset_split in ('train', 'test')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(tags) = 'array'),
  check (jsonb_typeof(input_output) = 'array')
);

create index if not exists idx_problem_content_source on public.problem_content(source);
create index if not exists idx_problem_content_difficulty on public.problem_content(difficulty);
create index if not exists idx_problem_content_dataset_split on public.problem_content(dataset_split);

drop trigger if exists trg_problem_content_updated_at on public.problem_content;
create trigger trg_problem_content_updated_at
before update on public.problem_content
for each row
execute function public.set_updated_at();

-- Editable test case bank used by your in-app settings UI
create table if not exists public.problem_test_cases (
  id bigserial primary key,
  problem_lc int not null references public.problem_content(problem_lc) on delete cascade,
  sort_order int not null,
  input_text text not null,
  expected_output text,
  source text not null default 'dataset' check (source in ('dataset', 'manual')),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (problem_lc, source, sort_order)
);

create index if not exists idx_problem_test_cases_problem on public.problem_test_cases(problem_lc);
create index if not exists idx_problem_test_cases_active on public.problem_test_cases(problem_lc, is_active);

drop trigger if exists trg_problem_test_cases_updated_at on public.problem_test_cases;
create trigger trg_problem_test_cases_updated_at
before update on public.problem_test_cases
for each row
execute function public.set_updated_at();

-- Historical submission/run log for Python-only runner
create table if not exists public.code_runs (
  id bigserial primary key,
  problem_lc int not null references public.problem_content(problem_lc) on delete cascade,
  language text not null default 'python' check (language = 'python'),
  submitted_code text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'passed', 'failed', 'error', 'timeout')),
  stdout text,
  stderr text,
  compile_output text,
  judge_token text,
  runtime_ms int,
  memory_kb int,
  tests_total int,
  tests_passed int,
  verdict jsonb not null default '{}'::jsonb,
  runner_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists idx_code_runs_problem_created on public.code_runs(problem_lc, created_at desc);
create index if not exists idx_code_runs_status_created on public.code_runs(status, created_at desc);

commit;
