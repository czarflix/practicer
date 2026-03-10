-- Migration: Supabase Auth mapping + RLS policies for user-scoped tables
-- Apply this in Supabase SQL editor or via supabase db push.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add auth_user_id column to app_users
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS app_users_auth_user_id_idx ON app_users(auth_user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Helper function: resolve current user_key from authenticated JWT
--    Returns the app_users.user_key whose auth_user_id = auth.uid().
--    Used in RLS policies.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION current_user_key()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT user_key
  FROM app_users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$;

-- Grant execute to authenticated and anon roles
GRANT EXECUTE ON FUNCTION current_user_key() TO authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Enable RLS on user-scoped tables
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE progress         ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE solutions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE resources        ENABLE ROW LEVEL SECURITY;
ALTER TABLE targets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE code_runs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_problem_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_events     ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS policies — user_key-scoped tables
--    Pattern: select/insert/update/delete restricted to own user_key.
-- ─────────────────────────────────────────────────────────────────────────────

-- progress
DROP POLICY IF EXISTS progress_own_user ON progress;
CREATE POLICY progress_own_user ON progress
  USING (user_key = current_user_key())
  WITH CHECK (user_key = current_user_key());

-- notes
DROP POLICY IF EXISTS notes_own_user ON notes;
CREATE POLICY notes_own_user ON notes
  USING (user_key = current_user_key())
  WITH CHECK (user_key = current_user_key());

-- solutions
DROP POLICY IF EXISTS solutions_own_user ON solutions;
CREATE POLICY solutions_own_user ON solutions
  USING (user_key = current_user_key())
  WITH CHECK (user_key = current_user_key());

-- resources
DROP POLICY IF EXISTS resources_own_user ON resources;
CREATE POLICY resources_own_user ON resources
  USING (user_key = current_user_key())
  WITH CHECK (user_key = current_user_key());

-- targets
DROP POLICY IF EXISTS targets_own_user ON targets;
CREATE POLICY targets_own_user ON targets
  USING (user_key = current_user_key())
  WITH CHECK (user_key = current_user_key());

-- code_runs
DROP POLICY IF EXISTS code_runs_own_user ON code_runs;
CREATE POLICY code_runs_own_user ON code_runs
  USING (user_key = current_user_key())
  WITH CHECK (user_key = current_user_key());

-- user_problem_overrides
DROP POLICY IF EXISTS overrides_own_user ON user_problem_overrides;
CREATE POLICY overrides_own_user ON user_problem_overrides
  USING (user_key = current_user_key())
  WITH CHECK (user_key = current_user_key());

-- study_events
DROP POLICY IF EXISTS study_events_own_user ON study_events;
CREATE POLICY study_events_own_user ON study_events
  USING (user_key = current_user_key())
  WITH CHECK (user_key = current_user_key());

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS policies — shared / read-only dataset tables
--    Authenticated users can SELECT; writes restricted (app-level guard).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE problems           ENABLE ROW LEVEL SECURITY;
ALTER TABLE problem_content    ENABLE ROW LEVEL SECURITY;
ALTER TABLE problem_test_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users          ENABLE ROW LEVEL SECURITY;

-- problems: read for all authenticated
DROP POLICY IF EXISTS problems_read_authenticated ON problems;
CREATE POLICY problems_read_authenticated ON problems
  FOR SELECT USING (auth.role() = 'authenticated');

-- problem_content: read for all authenticated
DROP POLICY IF EXISTS problem_content_read_authenticated ON problem_content;
CREATE POLICY problem_content_read_authenticated ON problem_content
  FOR SELECT USING (auth.role() = 'authenticated');

-- problem_test_cases: read for all authenticated
DROP POLICY IF EXISTS problem_test_cases_read_authenticated ON problem_test_cases;
CREATE POLICY problem_test_cases_read_authenticated ON problem_test_cases
  FOR SELECT USING (auth.role() = 'authenticated');

-- app_users: each user can read own row + read others (for display names)
DROP POLICY IF EXISTS app_users_read_authenticated ON app_users;
CREATE POLICY app_users_read_authenticated ON app_users
  FOR SELECT USING (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────────────────────────────────────
-- NOTE: After applying this migration:
--   1. In Supabase Dashboard → Auth → Users: create the two users.
--   2. UPDATE app_users SET auth_user_id = '<uuid>' WHERE user_key = 'AYAAN';
--      UPDATE app_users SET auth_user_id = '<uuid>' WHERE user_key = 'MANTSHA';
-- ─────────────────────────────────────────────────────────────────────────────
