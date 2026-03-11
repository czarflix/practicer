BEGIN;

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS preferred_ai_provider_mode text NOT NULL DEFAULT 'platform'
    CHECK (preferred_ai_provider_mode IN ('platform', 'user_key'));

CREATE TABLE IF NOT EXISTS public.assistant_threads (
  id bigserial PRIMARY KEY,
  user_key text NOT NULL REFERENCES public.app_users(user_key) ON DELETE CASCADE,
  problem_key text NOT NULL,
  track_key text NOT NULL CHECK (track_key IN ('dsa', 'sql')),
  title text NOT NULL DEFAULT 'New chat',
  rolling_summary text NOT NULL DEFAULT '',
  provider_mode text NOT NULL DEFAULT 'platform'
    CHECK (provider_mode IN ('platform', 'user_key')),
  last_message_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_threads_user_problem_updated_idx
  ON public.assistant_threads(user_key, problem_key, updated_at DESC);

CREATE INDEX IF NOT EXISTS assistant_threads_problem_active_idx
  ON public.assistant_threads(problem_key, archived_at, last_message_at DESC NULLS LAST);

ALTER TABLE public.assistant_threads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assistant_threads_own_user ON public.assistant_threads;
CREATE POLICY assistant_threads_own_user ON public.assistant_threads
  USING (user_key = current_user_key())
  WITH CHECK (user_key = current_user_key());

DROP TRIGGER IF EXISTS set_assistant_threads_updated_at ON public.assistant_threads;
CREATE TRIGGER set_assistant_threads_updated_at
  BEFORE UPDATE ON public.assistant_threads
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.assistant_messages (
  id bigserial PRIMARY KEY,
  thread_id bigint NOT NULL REFERENCES public.assistant_threads(id) ON DELETE CASCADE,
  user_key text NOT NULL REFERENCES public.app_users(user_key) ON DELETE CASCADE,
  problem_key text NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  intent text NOT NULL DEFAULT 'general',
  status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('queued', 'streaming', 'completed', 'error')),
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  model text,
  provider text,
  prompt_tokens int,
  output_tokens int,
  estimated_cost_usd numeric(12, 6),
  latency_ms int,
  context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_run_id bigint REFERENCES public.code_runs(id) ON DELETE SET NULL,
  source_note_id bigint REFERENCES public.notes(id) ON DELETE SET NULL,
  feedback_rating smallint CHECK (feedback_rating BETWEEN 1 AND 5),
  feedback_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(content) = 'object'),
  CHECK (jsonb_typeof(context_snapshot) = 'object')
);

CREATE INDEX IF NOT EXISTS assistant_messages_thread_created_idx
  ON public.assistant_messages(thread_id, created_at ASC);

CREATE INDEX IF NOT EXISTS assistant_messages_user_problem_created_idx
  ON public.assistant_messages(user_key, problem_key, created_at DESC);

ALTER TABLE public.assistant_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assistant_messages_own_user ON public.assistant_messages;
CREATE POLICY assistant_messages_own_user ON public.assistant_messages
  USING (user_key = current_user_key())
  WITH CHECK (user_key = current_user_key());

CREATE TABLE IF NOT EXISTS public.user_ai_credentials (
  id bigserial PRIMARY KEY,
  user_key text NOT NULL REFERENCES public.app_users(user_key) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('gemini_api')),
  encrypted_secret text NOT NULL,
  secret_nonce text NOT NULL,
  secret_tag text NOT NULL,
  masked_suffix text NOT NULL,
  label text NOT NULL DEFAULT 'Gemini API key',
  is_active boolean NOT NULL DEFAULT true,
  validated_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_ai_credentials_active_provider_idx
  ON public.user_ai_credentials(user_key, provider)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS user_ai_credentials_user_provider_idx
  ON public.user_ai_credentials(user_key, provider, updated_at DESC);

ALTER TABLE public.user_ai_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_ai_credentials_own_user ON public.user_ai_credentials;
CREATE POLICY user_ai_credentials_own_user ON public.user_ai_credentials
  USING (user_key = current_user_key())
  WITH CHECK (user_key = current_user_key());

DROP TRIGGER IF EXISTS set_user_ai_credentials_updated_at ON public.user_ai_credentials;
CREATE TRIGGER set_user_ai_credentials_updated_at
  BEFORE UPDATE ON public.user_ai_credentials
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_updated_at();

COMMIT;
