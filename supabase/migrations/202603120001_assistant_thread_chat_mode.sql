BEGIN;

ALTER TABLE public.assistant_threads
  ADD COLUMN IF NOT EXISTS chat_mode text NOT NULL DEFAULT 'assist';

UPDATE public.assistant_threads
SET chat_mode = 'assist'
WHERE chat_mode IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'assistant_threads_chat_mode_check'
  ) THEN
    ALTER TABLE public.assistant_threads
      ADD CONSTRAINT assistant_threads_chat_mode_check
      CHECK (chat_mode IN ('assist', 'chat'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS assistant_threads_user_problem_mode_updated_idx
  ON public.assistant_threads(user_key, problem_key, chat_mode, updated_at DESC);

COMMIT;
