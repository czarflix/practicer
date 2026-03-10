-- Migration: realtime notifications for collaboration + progress milestones

BEGIN;

INSERT INTO public.app_users (user_key, display_name)
VALUES ('SYSTEM', 'System')
ON CONFLICT (user_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.notifications (
  id bigserial PRIMARY KEY,
  recipient_user_key text NOT NULL
    CONSTRAINT notifications_recipient_user_key_fkey
    REFERENCES public.app_users(user_key) ON DELETE CASCADE,
  actor_user_key text NOT NULL
    CONSTRAINT notifications_actor_user_key_fkey
    REFERENCES public.app_users(user_key) ON DELETE CASCADE,
  type text NOT NULL CHECK (
    type IN (
      'comment_added',
      'comment_replied',
      'shared_solution',
      'shared_note',
      'problem_added',
      'test_case_added',
      'daily_solved_milestone',
      'tier_completed'
    )
  ),
  problem_lc int NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz NULL,
  CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX IF NOT EXISTS notifications_recipient_created_idx
  ON public.notifications(recipient_user_key, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_recipient_unread_idx
  ON public.notifications(recipient_user_key, read_at, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_recipient_dedupe_idx
  ON public.notifications(recipient_user_key, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END;
$$;

DROP POLICY IF EXISTS notifications_recipient_select ON public.notifications;
CREATE POLICY notifications_recipient_select ON public.notifications
  FOR SELECT USING (recipient_user_key = current_user_key());

DROP POLICY IF EXISTS notifications_recipient_update ON public.notifications;
CREATE POLICY notifications_recipient_update ON public.notifications
  FOR UPDATE
  USING (recipient_user_key = current_user_key())
  WITH CHECK (recipient_user_key = current_user_key());

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_key text NOT NULL REFERENCES public.app_users(user_key) ON DELETE CASCADE,
  notification_type text NOT NULL CHECK (
    notification_type IN (
      'comment_added',
      'comment_replied',
      'shared_solution',
      'shared_note',
      'problem_added',
      'test_case_added',
      'daily_solved_milestone',
      'tier_completed'
    )
  ),
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_key, notification_type)
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_preferences_own_user ON public.notification_preferences;
CREATE POLICY notification_preferences_own_user ON public.notification_preferences
  USING (user_key = current_user_key())
  WITH CHECK (user_key = current_user_key());

DROP TRIGGER IF EXISTS set_notification_preferences_updated_at ON public.notification_preferences;
CREATE TRIGGER set_notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE OR REPLACE FUNCTION public.create_notifications_for_other_users(
  p_actor_user_key text,
  p_type text,
  p_problem_lc int DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_dedupe_key text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (
    recipient_user_key,
    actor_user_key,
    type,
    problem_lc,
    payload,
    dedupe_key
  )
  SELECT
    app_user.user_key,
    p_actor_user_key,
    p_type,
    p_problem_lc,
    COALESCE(p_payload, '{}'::jsonb),
    p_dedupe_key
  FROM public.app_users AS app_user
  LEFT JOIN public.notification_preferences AS pref
    ON pref.user_key = app_user.user_key
   AND pref.notification_type = p_type
  WHERE app_user.user_key <> p_actor_user_key
    AND app_user.user_key <> 'SYSTEM'
    AND COALESCE(pref.is_enabled, true)
  ON CONFLICT (recipient_user_key, dedupe_key)
  WHERE dedupe_key IS NOT NULL
  DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_notifications_for_other_users(text, text, int, jsonb, text)
  TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.notify_problem_comment_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  notification_type text;
  preview text;
BEGIN
  notification_type := CASE
    WHEN NEW.parent_comment_id IS NULL THEN 'comment_added'
    ELSE 'comment_replied'
  END;

  preview := left(regexp_replace(COALESCE(NEW.content, ''), '\s+', ' ', 'g'), 160);

  PERFORM public.create_notifications_for_other_users(
    NEW.author_user_key,
    notification_type,
    NEW.problem_lc,
    jsonb_build_object(
      'comment_id', NEW.id,
      'parent_comment_id', NEW.parent_comment_id,
      'preview', preview
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_problem_comments_notify_insert ON public.problem_comments;
CREATE TRIGGER trg_problem_comments_notify_insert
  AFTER INSERT ON public.problem_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_problem_comment_insert();

CREATE OR REPLACE FUNCTION public.notify_shared_solution_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.create_notifications_for_other_users(
    NEW.author_user_key,
    'shared_solution',
    NEW.problem_lc,
    jsonb_build_object(
      'shared_solution_id', NEW.id,
      'title', NEW.title,
      'tests_passed', NEW.tests_passed,
      'tests_total', NEW.tests_total,
      'runtime_ms', NEW.runtime_ms
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shared_solutions_notify_insert ON public.shared_solutions;
CREATE TRIGGER trg_shared_solutions_notify_insert
  AFTER INSERT ON public.shared_solutions
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_shared_solution_insert();

CREATE OR REPLACE FUNCTION public.notify_shared_note_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.create_notifications_for_other_users(
    NEW.author_user_key,
    'shared_note',
    NEW.problem_lc,
    jsonb_build_object(
      'shared_note_id', NEW.id,
      'title', NEW.title
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shared_notes_notify_insert ON public.shared_notes;
CREATE TRIGGER trg_shared_notes_notify_insert
  AFTER INSERT ON public.shared_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_shared_note_insert();

CREATE OR REPLACE FUNCTION public.notify_problem_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_key text;
BEGIN
  actor_key := COALESCE(current_user_key(), 'SYSTEM');

  PERFORM public.create_notifications_for_other_users(
    actor_key,
    'problem_added',
    NEW.nc_lc,
    jsonb_build_object(
      'nc_lc', NEW.nc_lc,
      'cp_lc', NEW.cp_lc,
      'title', NEW.nc_title,
      'companion_title', NEW.cp_title,
      'phase', NEW.phase,
      'phase_name', NEW.phase_name,
      'tier', COALESCE(NEW.nc_tier, NEW.tier)
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_problems_notify_insert ON public.problems;
CREATE TRIGGER trg_problems_notify_insert
  AFTER INSERT ON public.problems
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_problem_insert();

CREATE OR REPLACE FUNCTION public.notify_test_case_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_key text;
BEGIN
  actor_key := COALESCE(current_user_key(), 'SYSTEM');

  PERFORM public.create_notifications_for_other_users(
    actor_key,
    'test_case_added',
    NEW.problem_lc,
    jsonb_build_object(
      'test_case_id', NEW.id,
      'sort_order', NEW.sort_order,
      'source', NEW.source
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_problem_test_cases_notify_insert ON public.problem_test_cases;
CREATE TRIGGER trg_problem_test_cases_notify_insert
  AFTER INSERT ON public.problem_test_cases
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_test_case_insert();

CREATE OR REPLACE FUNCTION public.notify_progress_milestones()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_day date;
  solved_today_count int;
  solved_tier int;
  tier_total int;
  tier_complete_count int;
BEGIN
  IF NEW.status <> 'solved' OR (TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = 'solved') THEN
    RETURN NEW;
  END IF;

  event_day := COALESCE(NEW.solved_at, now())::date;

  SELECT count(*)
  INTO solved_today_count
  FROM public.progress AS progress_row
  WHERE progress_row.user_key = NEW.user_key
    AND progress_row.status IN ('solved', 'review')
    AND progress_row.solved_at IS NOT NULL
    AND progress_row.solved_at::date = event_day;

  IF solved_today_count > 0 AND mod(solved_today_count, 5) = 0 THEN
    PERFORM public.create_notifications_for_other_users(
      NEW.user_key,
      'daily_solved_milestone',
      NEW.problem_lc,
      jsonb_build_object(
        'count', solved_today_count,
        'date', event_day
      ),
      format('daily_solved:%s:%s:%s', NEW.user_key, event_day, solved_today_count)
    );
  END IF;

  SELECT COALESCE(
    (
      SELECT COALESCE(problem_row.nc_tier, problem_row.tier)
      FROM public.problems AS problem_row
      WHERE problem_row.nc_lc = NEW.problem_lc
      LIMIT 1
    ),
    (
      SELECT COALESCE(problem_row.cp_tier, LEAST(3, problem_row.tier + 1))
      FROM public.problems AS problem_row
      WHERE problem_row.cp_lc = NEW.problem_lc
      LIMIT 1
    )
  )
  INTO solved_tier;

  IF solved_tier IS NULL THEN
    RETURN NEW;
  END IF;

  WITH tier_problem_lcs AS (
    SELECT problem_row.nc_lc AS lc
    FROM public.problems AS problem_row
    WHERE COALESCE(problem_row.nc_tier, problem_row.tier) = solved_tier
    UNION
    SELECT problem_row.cp_lc AS lc
    FROM public.problems AS problem_row
    WHERE COALESCE(problem_row.cp_tier, LEAST(3, problem_row.tier + 1)) = solved_tier
  )
  SELECT count(*)
  INTO tier_total
  FROM tier_problem_lcs;

  WITH tier_problem_lcs AS (
    SELECT problem_row.nc_lc AS lc
    FROM public.problems AS problem_row
    WHERE COALESCE(problem_row.nc_tier, problem_row.tier) = solved_tier
    UNION
    SELECT problem_row.cp_lc AS lc
    FROM public.problems AS problem_row
    WHERE COALESCE(problem_row.cp_tier, LEAST(3, problem_row.tier + 1)) = solved_tier
  )
  SELECT count(*)
  INTO tier_complete_count
  FROM public.progress AS progress_row
  INNER JOIN tier_problem_lcs ON tier_problem_lcs.lc = progress_row.problem_lc
  WHERE progress_row.user_key = NEW.user_key
    AND progress_row.status IN ('solved', 'review');

  IF tier_total > 0 AND tier_complete_count = tier_total THEN
    PERFORM public.create_notifications_for_other_users(
      NEW.user_key,
      'tier_completed',
      NEW.problem_lc,
      jsonb_build_object(
        'tier', solved_tier,
        'solved', tier_complete_count,
        'total', tier_total
      ),
      format('tier_completed:%s:%s', NEW.user_key, solved_tier)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_progress_notify_milestones ON public.progress;
CREATE TRIGGER trg_progress_notify_milestones
  AFTER INSERT OR UPDATE OF status, solved_at ON public.progress
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_progress_milestones();

COMMIT;
