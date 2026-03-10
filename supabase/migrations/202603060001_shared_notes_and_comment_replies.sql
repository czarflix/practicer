-- Migration: shared_notes + threaded replies for problem_comments

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Threaded replies on problem_comments
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE problem_comments
  ADD COLUMN IF NOT EXISTS parent_comment_id bigint NULL
  REFERENCES problem_comments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS problem_comments_parent_idx
  ON problem_comments(problem_lc, parent_comment_id, created_at ASC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. shared_notes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shared_notes (
  id               bigserial PRIMARY KEY,
  problem_lc       int NOT NULL,
  author_user_key  text NOT NULL REFERENCES app_users(user_key) ON DELETE CASCADE,
  title            text NOT NULL,
  content          jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_note_id   bigint NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shared_notes_problem_lc_idx
  ON shared_notes(problem_lc, created_at DESC);

CREATE INDEX IF NOT EXISTS shared_notes_author_idx
  ON shared_notes(author_user_key, problem_lc);

ALTER TABLE shared_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shared_notes_read_authenticated ON shared_notes;
CREATE POLICY shared_notes_read_authenticated ON shared_notes
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS shared_notes_insert_own ON shared_notes;
CREATE POLICY shared_notes_insert_own ON shared_notes
  FOR INSERT WITH CHECK (author_user_key = current_user_key());

DROP POLICY IF EXISTS shared_notes_update_own ON shared_notes;
CREATE POLICY shared_notes_update_own ON shared_notes
  FOR UPDATE USING (author_user_key = current_user_key())
  WITH CHECK (author_user_key = current_user_key());

DROP POLICY IF EXISTS shared_notes_delete_own ON shared_notes;
CREATE POLICY shared_notes_delete_own ON shared_notes
  FOR DELETE USING (author_user_key = current_user_key());

DROP TRIGGER IF EXISTS set_shared_notes_updated_at ON shared_notes;
CREATE TRIGGER set_shared_notes_updated_at
  BEFORE UPDATE ON shared_notes
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
