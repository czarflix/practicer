begin;

alter table public.problem_content
  add column if not exists presentation jsonb not null default '{}'::jsonb;

alter table public.problem_content
  drop constraint if exists problem_content_presentation_object_check;

alter table public.problem_content
  add constraint problem_content_presentation_object_check
  check (jsonb_typeof(presentation) = 'object');

commit;
