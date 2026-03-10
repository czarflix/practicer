BEGIN;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'comment_added',
    'comment_replied',
    'shared_solution',
    'shared_note',
    'problem_added',
    'test_case_added',
    'test_case_updated',
    'problem_solved',
    'daily_solved_milestone',
    'tier_completed',
    'announcement'
  )
);

ALTER TABLE public.notification_preferences DROP CONSTRAINT IF EXISTS notification_preferences_notification_type_check;
ALTER TABLE public.notification_preferences ADD CONSTRAINT notification_preferences_notification_type_check CHECK (
  notification_type IN (
    'comment_added',
    'comment_replied',
    'shared_solution',
    'shared_note',
    'problem_added',
    'test_case_added',
    'test_case_updated',
    'problem_solved',
    'daily_solved_milestone',
    'tier_completed',
    'announcement'
  )
);

DROP FUNCTION IF EXISTS public.create_notifications_for_other_users(text, text, text, text, int, jsonb, text);
DROP FUNCTION IF EXISTS public.create_notifications_for_other_users(text, text, int, jsonb, text);
DROP FUNCTION IF EXISTS public.reconcile_progress_for_problem(text, text, int, text);
DROP FUNCTION IF EXISTS public.reconcile_progress_for_pair(text, int);
DROP FUNCTION IF EXISTS public.resolve_problem_context(text, int);

CREATE OR REPLACE FUNCTION public.resolve_problem_context(
  p_problem_key text DEFAULT NULL,
  p_problem_lc int DEFAULT NULL
)
RETURNS TABLE (
  problem_key text,
  problem_lc int,
  track_key text,
  title text,
  tier int,
  source_type text,
  module_number int,
  module_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sp.problem_key,
    sp.problem_lc,
    sp.track_key,
    sp.title,
    sp.tier,
    sp.source_type,
    sm.module_number,
    sm.name
  FROM public.study_problems sp
  LEFT JOIN public.study_modules sm ON sm.id = sp.module_id
  WHERE (
      p_problem_key IS NOT NULL
      AND sp.problem_key = p_problem_key
    )
    OR (
      p_problem_key IS NULL
      AND p_problem_lc IS NOT NULL
      AND sp.problem_lc = p_problem_lc
    )
  ORDER BY CASE WHEN p_problem_key IS NOT NULL AND sp.problem_key = p_problem_key THEN 0 ELSE 1 END
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.create_notifications_for_other_users(
  p_actor_user_key text,
  p_type text,
  p_problem_key text DEFAULT NULL,
  p_track_key text DEFAULT NULL,
  p_problem_lc int DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_dedupe_key text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_problem_key text;
  v_problem_lc int;
  v_track_key text;
begin
  SELECT rpc.problem_key, rpc.problem_lc, rpc.track_key
  INTO v_problem_key, v_problem_lc, v_track_key
  FROM public.resolve_problem_context(p_problem_key, p_problem_lc) rpc;

  v_problem_key := COALESCE(v_problem_key, p_problem_key);
  v_problem_lc := COALESCE(v_problem_lc, p_problem_lc);
  v_track_key := COALESCE(v_track_key, p_track_key,
    CASE
      WHEN COALESCE(v_problem_key, '') LIKE 'sql-%' THEN 'sql'
      WHEN v_problem_key IS NOT NULL OR v_problem_lc IS NOT NULL THEN 'dsa'
      ELSE NULL
    END
  );

  IF EXISTS (
    SELECT 1
    FROM public.notification_preferences pref
    WHERE pref.user_key = p_actor_user_key
      AND pref.notification_type = p_type
      AND pref.send_enabled = false
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.notifications (
    recipient_user_key,
    actor_user_key,
    type,
    problem_key,
    track_key,
    problem_lc,
    payload,
    dedupe_key
  )
  SELECT
    app_user.user_key,
    p_actor_user_key,
    p_type,
    v_problem_key,
    v_track_key,
    v_problem_lc,
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

CREATE OR REPLACE FUNCTION public.create_notifications_for_other_users(
  p_actor_user_key text,
  p_type text,
  p_problem_lc int,
  p_payload jsonb,
  p_dedupe_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.create_notifications_for_other_users(
    p_actor_user_key,
    p_type,
    NULL,
    NULL,
    p_problem_lc,
    p_payload,
    p_dedupe_key
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_notifications_for_other_users(text, text, text, text, int, jsonb, text)
  TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.create_notifications_for_other_users(text, text, int, jsonb, text)
  TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.reconcile_progress_for_problem(
  p_user_key_in text,
  p_problem_key_in text DEFAULT NULL,
  p_problem_lc_in int DEFAULT NULL,
  p_track_key_in text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_passed_submit boolean;
  v_problem_key text;
  v_problem_lc int;
  v_track_key text;
  v_problem_type text;
  v_now timestamptz := now();
BEGIN
  IF p_user_key_in IS NULL OR (p_problem_key_in IS NULL AND p_problem_lc_in IS NULL) THEN
    RETURN;
  END IF;

  SELECT rpc.problem_key, rpc.problem_lc, rpc.track_key, rpc.source_type
  INTO v_problem_key, v_problem_lc, v_track_key, v_problem_type
  FROM public.resolve_problem_context(p_problem_key_in, p_problem_lc_in) rpc;

  v_problem_key := COALESCE(v_problem_key, p_problem_key_in);
  v_problem_lc := COALESCE(v_problem_lc, p_problem_lc_in);
  v_track_key := COALESCE(v_track_key, p_track_key_in, CASE WHEN COALESCE(v_problem_key, '') LIKE 'sql-%' THEN 'sql' ELSE 'dsa' END);
  v_problem_type := COALESCE(
    CASE
      WHEN v_track_key = 'sql' THEN 'sql'
      WHEN v_problem_type IN ('neetcode', 'companion') THEN v_problem_type
      ELSE 'neetcode'
    END,
    CASE WHEN v_track_key = 'sql' THEN 'sql' ELSE 'neetcode' END
  );

  SELECT EXISTS (
    SELECT 1
    FROM public.code_runs cr
    WHERE cr.user_key = p_user_key_in
      AND (
        (v_problem_key IS NOT NULL AND cr.problem_key = v_problem_key)
        OR (v_problem_lc IS NOT NULL AND cr.problem_lc = v_problem_lc)
      )
      AND cr.status = 'passed'
      AND lower(COALESCE(cr.runner_meta ->> 'mode', '')) = 'submit'
  )
  INTO v_has_passed_submit;

  IF v_has_passed_submit THEN
    UPDATE public.progress p
    SET problem_key = COALESCE(p.problem_key, v_problem_key),
        problem_lc = COALESCE(p.problem_lc, v_problem_lc),
        problem_type = COALESCE(p.problem_type, v_problem_type),
        status = 'solved',
        solved_at = COALESCE(p.solved_at, v_now),
        last_reviewed = v_now
    WHERE p.user_key = p_user_key_in
      AND (
        (v_problem_key IS NOT NULL AND p.problem_key = v_problem_key)
        OR (v_problem_lc IS NOT NULL AND p.problem_lc = v_problem_lc)
      );

    IF NOT FOUND THEN
      INSERT INTO public.progress (
        user_key,
        problem_key,
        problem_lc,
        problem_type,
        status,
        difficulty_rating,
        time_spent,
        solved_at,
        last_reviewed,
        is_bookmarked
      )
      VALUES (
        p_user_key_in,
        v_problem_key,
        v_problem_lc,
        v_problem_type,
        'solved',
        NULL,
        0,
        v_now,
        v_now,
        false
      );
    END IF;
  ELSE
    UPDATE public.progress p
    SET status = 'unsolved',
        solved_at = NULL,
        last_reviewed = v_now
    WHERE p.user_key = p_user_key_in
      AND (
        (v_problem_key IS NOT NULL AND p.problem_key = v_problem_key)
        OR (v_problem_lc IS NOT NULL AND p.problem_lc = v_problem_lc)
      )
      AND p.status = 'solved';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_progress_for_pair(p_user_key_in text, p_problem_lc_in int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.reconcile_progress_for_problem(p_user_key_in, NULL, p_problem_lc_in, NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_progress_from_code_runs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.reconcile_progress_for_problem(NEW.user_key, NEW.problem_key, NEW.problem_lc, NEW.track_key);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.user_key IS DISTINCT FROM NEW.user_key
      OR OLD.problem_key IS DISTINCT FROM NEW.problem_key
      OR OLD.problem_lc IS DISTINCT FROM NEW.problem_lc THEN
      PERFORM public.reconcile_progress_for_problem(OLD.user_key, OLD.problem_key, OLD.problem_lc, OLD.track_key);
    END IF;
    PERFORM public.reconcile_progress_for_problem(NEW.user_key, NEW.problem_key, NEW.problem_lc, NEW.track_key);
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.reconcile_progress_for_problem(OLD.user_key, OLD.problem_key, OLD.problem_lc, OLD.track_key);
    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_code_runs_reconcile_progress ON public.code_runs;
CREATE TRIGGER trg_code_runs_reconcile_progress
AFTER INSERT OR UPDATE OF status, runner_meta, user_key, problem_lc, problem_key, track_key OR DELETE
ON public.code_runs
FOR EACH ROW
EXECUTE FUNCTION public.reconcile_progress_from_code_runs();

CREATE OR REPLACE FUNCTION public.notify_problem_comment_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  notification_type text;
  preview text;
  v_title text;
  v_track_key text;
BEGIN
  notification_type := CASE
    WHEN NEW.parent_comment_id IS NULL THEN 'comment_added'
    ELSE 'comment_replied'
  END;

  preview := left(regexp_replace(COALESCE(NEW.content, ''), '\s+', ' ', 'g'), 160);

  SELECT rpc.title, rpc.track_key
  INTO v_title, v_track_key
  FROM public.resolve_problem_context(NEW.problem_key, NEW.problem_lc) rpc;

  PERFORM public.create_notifications_for_other_users(
    NEW.author_user_key,
    notification_type,
    NEW.problem_key,
    v_track_key,
    NEW.problem_lc,
    jsonb_build_object(
      'comment_id', NEW.id,
      'parent_comment_id', NEW.parent_comment_id,
      'preview', preview,
      'title', v_title,
      'problem_title', v_title
    )
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_shared_solution_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
  v_track_key text;
BEGIN
  SELECT rpc.title, rpc.track_key
  INTO v_title, v_track_key
  FROM public.resolve_problem_context(NEW.problem_key, NEW.problem_lc) rpc;

  PERFORM public.create_notifications_for_other_users(
    NEW.author_user_key,
    'shared_solution',
    NEW.problem_key,
    v_track_key,
    NEW.problem_lc,
    jsonb_build_object(
      'shared_solution_id', NEW.id,
      'title', COALESCE(NEW.title, v_title),
      'problem_title', v_title,
      'tests_passed', NEW.tests_passed,
      'tests_total', NEW.tests_total,
      'runtime_ms', NEW.runtime_ms
    )
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_shared_note_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
  v_track_key text;
BEGIN
  SELECT rpc.title, rpc.track_key
  INTO v_title, v_track_key
  FROM public.resolve_problem_context(NEW.problem_key, NEW.problem_lc) rpc;

  PERFORM public.create_notifications_for_other_users(
    NEW.author_user_key,
    'shared_note',
    NEW.problem_key,
    v_track_key,
    NEW.problem_lc,
    jsonb_build_object(
      'shared_note_id', NEW.id,
      'title', COALESCE(NEW.title, v_title),
      'problem_title', v_title
    )
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_study_problem_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_key text;
  v_phase int;
  v_phase_name text;
BEGIN
  IF COALESCE(NEW.is_active, true) IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  actor_key := COALESCE(current_user_key(), 'SYSTEM');

  IF actor_key = 'SYSTEM' THEN
    RETURN NEW;
  END IF;

  SELECT sm.module_number, sm.name
  INTO v_phase, v_phase_name
  FROM public.study_modules sm
  WHERE sm.id = NEW.module_id;

  PERFORM public.create_notifications_for_other_users(
    actor_key,
    'problem_added',
    NEW.problem_key,
    NEW.track_key,
    NEW.problem_lc,
    jsonb_build_object(
      'problem_key', NEW.problem_key,
      'problem_lc', NEW.problem_lc,
      'title', NEW.title,
      'phase', v_phase,
      'phase_name', v_phase_name,
      'tier', NEW.tier,
      'track_key', NEW.track_key,
      'source_platform', NEW.source_platform,
      'source_problem_id', NEW.source_problem_id
    ),
    format('problem_added:%s', NEW.problem_key)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_problems_notify_insert ON public.problems;
DROP TRIGGER IF EXISTS trg_study_problems_notify_insert ON public.study_problems;
CREATE TRIGGER trg_study_problems_notify_insert
  AFTER INSERT ON public.study_problems
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_study_problem_insert();

CREATE OR REPLACE FUNCTION public.notify_case_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_key text;
  notification_type text;
  v_problem_key text;
  v_problem_lc int;
  v_track_key text;
  v_title text;
  v_payload jsonb;
  v_dedupe text;
BEGIN
  actor_key := COALESCE(current_user_key(), 'SYSTEM');
  notification_type := CASE WHEN TG_OP = 'INSERT' THEN 'test_case_added' ELSE 'test_case_updated' END;

  IF actor_key = 'SYSTEM' THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'sql_problem_fixtures' THEN
    v_problem_key := NEW.problem_key;
    SELECT rpc.problem_lc, rpc.track_key, rpc.title
    INTO v_problem_lc, v_track_key, v_title
    FROM public.resolve_problem_context(v_problem_key, NULL) rpc;

    v_payload := jsonb_build_object(
      'fixture_id', NEW.id,
      'fixture_key', NEW.fixture_key,
      'label', NEW.label,
      'sort_order', NEW.sort_order,
      'is_public', NEW.is_public,
      'is_active', NEW.is_active,
      'title', v_title,
      'problem_title', v_title
    );

    v_dedupe := CASE
      WHEN TG_OP = 'UPDATE' THEN format('sql_fixture_updated:%s:%s:%s', v_problem_key, NEW.fixture_key, NEW.updated_at)
      ELSE NULL
    END;
  ELSE
    v_problem_key := NEW.problem_key;
    v_problem_lc := NEW.problem_lc;
    SELECT rpc.track_key, rpc.title
    INTO v_track_key, v_title
    FROM public.resolve_problem_context(v_problem_key, v_problem_lc) rpc;

    v_payload := jsonb_build_object(
      'test_case_id', NEW.id,
      'sort_order', NEW.sort_order,
      'source', NEW.source,
      'is_active', NEW.is_active,
      'title', v_title,
      'problem_title', v_title
    );

    v_dedupe := CASE
      WHEN TG_OP = 'UPDATE' THEN format('test_case_updated:%s:%s:%s', COALESCE(v_problem_key, v_problem_lc::text), NEW.id, NEW.updated_at)
      ELSE NULL
    END;
  END IF;

  PERFORM public.create_notifications_for_other_users(
    actor_key,
    notification_type,
    v_problem_key,
    v_track_key,
    v_problem_lc,
    v_payload,
    v_dedupe
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_problem_test_cases_notify_insert ON public.problem_test_cases;
CREATE TRIGGER trg_problem_test_cases_notify_insert
  AFTER INSERT ON public.problem_test_cases
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_case_change();

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
  EXECUTE FUNCTION public.notify_case_change();

DROP TRIGGER IF EXISTS trg_sql_problem_fixtures_notify_insert ON public.sql_problem_fixtures;
CREATE TRIGGER trg_sql_problem_fixtures_notify_insert
  AFTER INSERT ON public.sql_problem_fixtures
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_case_change();

DROP TRIGGER IF EXISTS trg_sql_problem_fixtures_notify_update ON public.sql_problem_fixtures;
CREATE TRIGGER trg_sql_problem_fixtures_notify_update
  AFTER UPDATE ON public.sql_problem_fixtures
  FOR EACH ROW
  WHEN (
    OLD.setup_sql IS DISTINCT FROM NEW.setup_sql
    OR OLD.postcheck_sql IS DISTINCT FROM NEW.postcheck_sql
    OR OLD.expected_columns IS DISTINCT FROM NEW.expected_columns
    OR OLD.expected_rows IS DISTINCT FROM NEW.expected_rows
    OR OLD.comparison_mode IS DISTINCT FROM NEW.comparison_mode
    OR OLD.order_required IS DISTINCT FROM NEW.order_required
    OR OLD.is_active IS DISTINCT FROM NEW.is_active
    OR OLD.sort_order IS DISTINCT FROM NEW.sort_order
    OR OLD.label IS DISTINCT FROM NEW.label
  )
  EXECUTE FUNCTION public.notify_case_change();

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
  solved_track_key text;
  solved_title text;
  tier_total int;
  tier_complete_count int;
  broadcast_mode text;
  threshold int;
BEGIN
  IF NEW.status <> 'solved' OR (TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = 'solved') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(us.solve_broadcast_mode, 'every_solve'),
         COALESCE(us.milestone_threshold, 5)
  INTO broadcast_mode, threshold
  FROM public.user_settings us
  WHERE us.user_key = NEW.user_key;

  IF broadcast_mode IS NULL THEN
    broadcast_mode := 'every_solve';
    threshold := 5;
  END IF;

  SELECT rpc.track_key, rpc.title, rpc.tier
  INTO solved_track_key, solved_title, solved_tier
  FROM public.resolve_problem_context(NEW.problem_key, NEW.problem_lc) rpc;

  IF broadcast_mode = 'every_solve' THEN
    PERFORM public.create_notifications_for_other_users(
      NEW.user_key,
      'problem_solved',
      NEW.problem_key,
      solved_track_key,
      NEW.problem_lc,
      jsonb_build_object(
        'problem_key', NEW.problem_key,
        'problem_lc', NEW.problem_lc,
        'title', COALESCE(solved_title, COALESCE(NEW.problem_key, CASE WHEN NEW.problem_lc IS NOT NULL THEN 'LC' || NEW.problem_lc ELSE 'Problem' END)),
        'problem_title', solved_title
      )
    );
  ELSIF broadcast_mode = 'milestone' THEN
    event_day := COALESCE(NEW.solved_at, now())::date;

    SELECT count(*)
    INTO solved_today_count
    FROM public.progress progress_row
    WHERE progress_row.user_key = NEW.user_key
      AND progress_row.status IN ('solved', 'review')
      AND progress_row.solved_at IS NOT NULL
      AND progress_row.solved_at::date = event_day;

    IF solved_today_count > 0 AND mod(solved_today_count, threshold) = 0 THEN
      PERFORM public.create_notifications_for_other_users(
        NEW.user_key,
        'daily_solved_milestone',
        NEW.problem_key,
        solved_track_key,
        NEW.problem_lc,
        jsonb_build_object(
          'count', solved_today_count,
          'date', event_day
        ),
        format('daily_solved:%s:%s:%s', NEW.user_key, event_day, solved_today_count)
      );
    END IF;
  END IF;

  IF solved_tier IS NULL OR solved_track_key IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*)
  INTO tier_total
  FROM public.study_problems sp
  WHERE sp.track_key = solved_track_key
    AND sp.is_active = true
    AND sp.tier = solved_tier;

  SELECT count(*)
  INTO tier_complete_count
  FROM public.study_problems sp
  WHERE sp.track_key = solved_track_key
    AND sp.is_active = true
    AND sp.tier = solved_tier
    AND EXISTS (
      SELECT 1
      FROM public.progress progress_row
      WHERE progress_row.user_key = NEW.user_key
        AND progress_row.status IN ('solved', 'review')
        AND (
          (progress_row.problem_key IS NOT NULL AND progress_row.problem_key = sp.problem_key)
          OR (progress_row.problem_key IS NULL AND sp.problem_lc IS NOT NULL AND progress_row.problem_lc = sp.problem_lc)
        )
    );

  IF tier_total > 0 AND tier_complete_count = tier_total THEN
    PERFORM public.create_notifications_for_other_users(
      NEW.user_key,
      'tier_completed',
      NEW.problem_key,
      solved_track_key,
      NEW.problem_lc,
      jsonb_build_object(
        'tier', solved_tier,
        'track_key', solved_track_key,
        'solved', tier_complete_count,
        'total', tier_total
      ),
      format('tier_completed:%s:%s:%s', NEW.user_key, solved_track_key, solved_tier)
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

WITH pairs AS (
  SELECT DISTINCT user_key, problem_key, problem_lc FROM public.progress
  UNION
  SELECT DISTINCT user_key, problem_key, problem_lc FROM public.code_runs
)
SELECT public.reconcile_progress_for_problem(pairs.user_key, pairs.problem_key, pairs.problem_lc, NULL)
FROM pairs;

COMMIT;
