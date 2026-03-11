begin;

drop policy if exists problem_content_admin_manage on public.problem_content;

create policy problem_content_admin_manage on public.problem_content
  for all
  using (is_admin_user())
  with check (is_admin_user());

commit;
