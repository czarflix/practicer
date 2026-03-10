-- Migration: problem_comments + shared_solutions tables with RLS

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. problem_comments
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS problem_comments (
  id              bigserial PRIMARY KEY,
  problem_lc      int NOT NULL,
  author_user_key text NOT NULL REFERENCES app_users(user_key) ON DELETE CASCADE,
  content         text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS problem_comments_problem_lc_idx
  ON problem_comments(problem_lc, created_at DESC);

ALTER TABLE problem_comments ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read
DROP POLICY IF EXISTS comments_read_authenticated ON problem_comments;
CREATE POLICY comments_read_authenticated ON problem_comments
  FOR SELECT USING (auth.role() = 'authenticated');

-- Insert: author_user_key must match current user
DROP POLICY IF EXISTS comments_insert_own ON problem_comments;
CREATE POLICY comments_insert_own ON problem_comments
  FOR INSERT WITH CHECK (author_user_key = current_user_key());

-- Update: only author
DROP POLICY IF EXISTS comments_update_own ON problem_comments;
CREATE POLICY comments_update_own ON problem_comments
  FOR UPDATE USING (author_user_key = current_user_key())
  WITH CHECK (author_user_key = current_user_key());

-- Delete: only author
DROP POLICY IF EXISTS comments_delete_own ON problem_comments;
CREATE POLICY comments_delete_own ON problem_comments
  FOR DELETE USING (author_user_key = current_user_key());

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_problem_comments_updated_at ON problem_comments;
CREATE TRIGGER set_problem_comments_updated_at
  BEFORE UPDATE ON problem_comments
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. shared_solutions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shared_solutions (
  id                bigserial PRIMARY KEY,
  problem_lc        int NOT NULL,
  author_user_key   text NOT NULL REFERENCES app_users(user_key) ON DELETE CASCADE,
  title             text NOT NULL,
  code              text NOT NULL,
  language          text NOT NULL DEFAULT 'python',
  source_solution_id int NULL,
  source_run_id     bigint NULL,
  runtime_ms        int NULL,
  memory_kb         int NULL,
  tests_passed      int NULL,
  tests_total       int NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shared_solutions_problem_lc_idx
  ON shared_solutions(problem_lc, created_at DESC);

CREATE INDEX IF NOT EXISTS shared_solutions_author_idx
  ON shared_solutions(author_user_key, problem_lc);

ALTER TABLE shared_solutions ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read
DROP POLICY IF EXISTS shared_solutions_read_authenticated ON shared_solutions;
CREATE POLICY shared_solutions_read_authenticated ON shared_solutions
  FOR SELECT USING (auth.role() = 'authenticated');

-- Insert: author_user_key must match current user
DROP POLICY IF EXISTS shared_solutions_insert_own ON shared_solutions;
CREATE POLICY shared_solutions_insert_own ON shared_solutions
  FOR INSERT WITH CHECK (author_user_key = current_user_key());

-- Update: only author
DROP POLICY IF EXISTS shared_solutions_update_own ON shared_solutions;
CREATE POLICY shared_solutions_update_own ON shared_solutions
  FOR UPDATE USING (author_user_key = current_user_key())
  WITH CHECK (author_user_key = current_user_key());

-- Delete: only author
DROP POLICY IF EXISTS shared_solutions_delete_own ON shared_solutions;
CREATE POLICY shared_solutions_delete_own ON shared_solutions
  FOR DELETE USING (author_user_key = current_user_key());

-- Auto-update updated_at
DROP TRIGGER IF EXISTS set_shared_solutions_updated_at ON shared_solutions;
CREATE TRIGGER set_shared_solutions_updated_at
  BEFORE UPDATE ON shared_solutions
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
