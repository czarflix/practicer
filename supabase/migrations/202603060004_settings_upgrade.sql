-- Migration: Unified settings — send/receive notification prefs, user_settings, problem_solved type

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extend notification type constraints to include problem_solved
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'comment_added',
    'comment_replied',
    'shared_solution',
    'shared_note',
    'problem_added',
    'test_case_added',
    'test_case_updated',
    'problem_solved',
    'daily_solved_milestone',
    'tier_completed'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Update notification_preferences: rename is_enabled → receive_enabled, add send_enabled
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.notification_preferences
  RENAME COLUMN is_enabled TO receive_enabled;

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS send_enabled boolean NOT NULL DEFAULT true;

-- Update type constraint to include problem_solved
ALTER TABLE public.notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_notification_type_check;
ALTER TABLE public.notification_preferences
  ADD CONSTRAINT notification_preferences_notification_type_check
  CHECK (notification_type IN (
    'comment_added',
    'comment_replied',
    'shared_solution',
    'shared_note',
    'problem_added',
    'test_case_added',
    'test_case_updated',
    'problem_solved',
    'daily_solved_milestone',
    'tier_completed'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Create user_settings table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_key text PRIMARY KEY REFERENCES public.app_users(user_key) ON DELETE CASCADE,
  solve_broadcast_mode text NOT NULL DEFAULT 'every_solve'
    CHECK (solve_broadcast_mode IN ('every_solve', 'milestone', 'off')),
  milestone_threshold int NOT NULL DEFAULT 5 CHECK (milestone_threshold > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_settings_own_user ON public.user_settings;
CREATE POLICY user_settings_own_user ON public.user_settings
  USING (user_key = current_user_key())
  WITH CHECK (user_key = current_user_key());

DROP TRIGGER IF EXISTS set_user_settings_updated_at ON public.user_settings;
CREATE TRIGGER set_user_settings_updated_at
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3b. Allow users to update their own app_users row (for display_name)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS app_users_update_own ON public.app_users;
CREATE POLICY app_users_update_own ON public.app_users
  FOR UPDATE
  USING (user_key = current_user_key())
  WITH CHECK (user_key = current_user_key());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Update create_notifications_for_other_users() — add sender gate
-- ─────────────────────────────────────────────────────────────────────────────
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
  -- Gate 1: Check if actor has opted out of sending this type
  IF EXISTS (
    SELECT 1 FROM public.notification_preferences
    WHERE user_key = p_actor_user_key
      AND notification_type = p_type
      AND send_enabled = false
  ) THEN
    RETURN;
  END IF;

  -- Gate 2: Insert only for recipients who want to receive
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
    AND COALESCE(pref.receive_enabled, true)
  ON CONFLICT (recipient_user_key, dedupe_key)
  WHERE dedupe_key IS NOT NULL
  DO NOTHING;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Update notify_progress_milestones() — configurable mode + problem_solved
-- ─────────────────────────────────────────────────────────────────────────────
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
  broadcast_mode text;
  threshold int;
BEGIN
  IF NEW.status <> 'solved' OR (TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = 'solved') THEN
    RETURN NEW;
  END IF;

  -- Read user settings
  SELECT COALESCE(us.solve_broadcast_mode, 'every_solve'),
         COALESCE(us.milestone_threshold, 5)
  INTO broadcast_mode, threshold
  FROM public.user_settings us
  WHERE us.user_key = NEW.user_key;

  -- Defaults if no row
  IF broadcast_mode IS NULL THEN
    broadcast_mode := 'every_solve';
    threshold := 5;
  END IF;

  -- Handle solve broadcasts based on mode
  IF broadcast_mode = 'every_solve' THEN
    DECLARE
      solved_title text;
    BEGIN
      SELECT COALESCE(p.title, '')
      INTO solved_title
      FROM public.problems p
      WHERE p.nc_lc = NEW.problem_lc OR p.cp_lc = NEW.problem_lc
      LIMIT 1;

      PERFORM public.create_notifications_for_other_users(
        NEW.user_key,
        'problem_solved',
        NEW.problem_lc,
        jsonb_build_object(
          'problem_lc', NEW.problem_lc,
          'title', COALESCE(solved_title, 'LC' || NEW.problem_lc)
        )
      );
    END;
  ELSIF broadcast_mode = 'milestone' THEN
    event_day := COALESCE(NEW.solved_at, now())::date;

    SELECT count(*)
    INTO solved_today_count
    FROM public.progress AS progress_row
    WHERE progress_row.user_key = NEW.user_key
      AND progress_row.status IN ('solved', 'review')
      AND progress_row.solved_at IS NOT NULL
      AND progress_row.solved_at::date = event_day;

    IF solved_today_count > 0 AND mod(solved_today_count, threshold) = 0 THEN
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
  END IF;
  -- If broadcast_mode = 'off', skip all solve notifications

  -- Tier completion check (always runs regardless of broadcast mode)
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

-- Recreate the trigger (same as before)
DROP TRIGGER IF EXISTS trg_progress_notify_milestones ON public.progress;
CREATE TRIGGER trg_progress_notify_milestones
  AFTER INSERT OR UPDATE OF status, solved_at ON public.progress
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_progress_milestones();

COMMIT;
