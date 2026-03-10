-- Migration: extend notifications for dataset/admin events + per-type preferences

BEGIN;

INSERT INTO public.app_users (user_key, display_name)
VALUES ('SYSTEM', 'System')
ON CONFLICT (user_key) DO NOTHING;

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (
    type IN (
      'comment_added',
      'comment_replied',
      'shared_solution',
      'shared_note',
      'problem_added',
      'test_case_added',
      'test_case_updated',
      'daily_solved_milestone',
      'tier_completed'
    )
  );

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
      'test_case_updated',
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

CREATE OR REPLACE FUNCTION public.notify_test_case_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_key text;
  notification_type text;
BEGIN
  actor_key := COALESCE(current_user_key(), 'SYSTEM');
  notification_type := CASE WHEN TG_OP = 'INSERT' THEN 'test_case_added' ELSE 'test_case_updated' END;

  PERFORM public.create_notifications_for_other_users(
    actor_key,
    notification_type,
    NEW.problem_lc,
    jsonb_build_object(
      'test_case_id', NEW.id,
      'sort_order', NEW.sort_order,
      'source', NEW.source,
      'is_active', NEW.is_active
    ),
    CASE
      WHEN TG_OP = 'UPDATE' THEN format('test_case_updated:%s:%s:%s', NEW.problem_lc, NEW.id, NEW.updated_at)
      ELSE NULL
    END
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_problem_test_cases_notify_insert ON public.problem_test_cases;
CREATE TRIGGER trg_problem_test_cases_notify_insert
  AFTER INSERT ON public.problem_test_cases
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_test_case_change();

DROP TRIGGER IF EXISTS trg_problem_test_cases_notify_update ON public.problem_test_cases;
CREATE TRIGGER trg_problem_test_cases_notify_update
  AFTER UPDATE ON public.problem_test_cases
  FOR EACH ROW
  WHEN (
    OLD.input_text IS DISTINCT FROM NEW.input_text
    OR OLD.expected_output IS DISTINCT FROM NEW.expected_output
    OR OLD.notes IS DISTINCT FROM NEW.notes
    OR OLD.is_active IS DISTINCT FROM NEW.is_active
    OR OLD.sort_order IS DISTINCT FROM NEW.sort_order
  )
  EXECUTE FUNCTION public.notify_test_case_change();

COMMIT;
