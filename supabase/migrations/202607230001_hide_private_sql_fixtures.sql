BEGIN;

DROP POLICY IF EXISTS sql_problem_fixtures_read_authenticated
  ON public.sql_problem_fixtures;
DROP POLICY IF EXISTS sql_problem_fixtures_read_public_authenticated
  ON public.sql_problem_fixtures;

CREATE POLICY sql_problem_fixtures_read_public_authenticated
  ON public.sql_problem_fixtures
  FOR SELECT
  USING (current_user_key() IS NOT NULL AND is_public = true);

COMMIT;
