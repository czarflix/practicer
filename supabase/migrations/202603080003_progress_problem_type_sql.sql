BEGIN;

ALTER TABLE public.progress
  DROP CONSTRAINT IF EXISTS progress_problem_type_check;

ALTER TABLE public.progress
  ADD CONSTRAINT progress_problem_type_check
  CHECK (problem_type IN ('neetcode', 'companion', 'sql'));

COMMIT;
