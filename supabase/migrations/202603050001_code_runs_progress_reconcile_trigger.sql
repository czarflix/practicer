-- Reconcile progress.solved state from surviving submit runs in code_runs.
-- Rule:
--   solved <=> exists at least one code_runs row for (user_key, problem_lc)
--             where status='passed' and runner_meta.mode='submit'

begin;

create or replace function public.reconcile_progress_for_pair(p_user_key text, p_problem_lc int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_passed_submit boolean;
  v_problem_type text;
  v_now timestamptz := now();
begin
  if p_user_key is null or p_problem_lc is null then
    return;
  end if;

  select exists (
    select 1
    from public.code_runs cr
    where cr.user_key = p_user_key
      and cr.problem_lc = p_problem_lc
      and cr.status = 'passed'
      and lower(coalesce(cr.runner_meta ->> 'mode', '')) = 'submit'
  )
  into v_has_passed_submit;

  if v_has_passed_submit then
    select case
      when exists (select 1 from public.problems p where p.nc_lc = p_problem_lc) then 'neetcode'
      when exists (select 1 from public.problems p where p.cp_lc = p_problem_lc) then 'companion'
      else 'neetcode'
    end
    into v_problem_type;

    insert into public.progress (
      user_key,
      problem_lc,
      problem_type,
      status,
      difficulty_rating,
      time_spent,
      solved_at,
      last_reviewed,
      is_bookmarked
    )
    values (
      p_user_key,
      p_problem_lc,
      v_problem_type,
      'solved',
      null,
      0,
      v_now,
      v_now,
      false
    )
    on conflict (user_key, problem_lc)
    do update
      set status = 'solved',
          solved_at = coalesce(public.progress.solved_at, excluded.solved_at),
          last_reviewed = v_now,
          problem_type = coalesce(public.progress.problem_type, excluded.problem_type);
  else
    update public.progress p
      set status = 'unsolved',
          solved_at = null,
          last_reviewed = v_now
    where p.user_key = p_user_key
      and p.problem_lc = p_problem_lc
      and p.status = 'solved';
  end if;
end;
$$;

create or replace function public.reconcile_progress_from_code_runs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.reconcile_progress_for_pair(new.user_key, new.problem_lc);
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.user_key is distinct from new.user_key or old.problem_lc is distinct from new.problem_lc then
      perform public.reconcile_progress_for_pair(old.user_key, old.problem_lc);
    end if;
    perform public.reconcile_progress_for_pair(new.user_key, new.problem_lc);
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.reconcile_progress_for_pair(old.user_key, old.problem_lc);
    return old;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_code_runs_reconcile_progress on public.code_runs;

create trigger trg_code_runs_reconcile_progress
after insert or update of status, runner_meta, user_key, problem_lc or delete
on public.code_runs
for each row
execute function public.reconcile_progress_from_code_runs();

-- Backfill all known pairs so current data obeys the same rule immediately.
with pairs as (
  select distinct user_key, problem_lc from public.progress
  union
  select distinct user_key, problem_lc from public.code_runs
)
select public.reconcile_progress_for_pair(pairs.user_key, pairs.problem_lc)
from pairs;

commit;
