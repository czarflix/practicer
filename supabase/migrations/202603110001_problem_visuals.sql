begin;

alter table public.problem_content
  drop constraint if exists problem_content_presentation_visuals_array_check;

alter table public.problem_content
  add constraint problem_content_presentation_visuals_array_check
  check (
    not (presentation ? 'visuals')
    or jsonb_typeof(presentation -> 'visuals') = 'array'
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'problem-images',
  'problem-images',
  true,
  1572864,
  array['image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists problem_images_public_read on storage.objects;

create policy problem_images_public_read on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'problem-images');

commit;
