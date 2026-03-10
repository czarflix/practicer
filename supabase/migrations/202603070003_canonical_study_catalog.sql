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

CREATE TABLE IF NOT EXISTS public.study_tracks (
  key text PRIMARY KEY,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_study_tracks_updated_at ON public.study_tracks;
CREATE TRIGGER trg_study_tracks_updated_at
  BEFORE UPDATE ON public.study_tracks
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.study_modules (
  id bigserial PRIMARY KEY,
  track_key text NOT NULL REFERENCES public.study_tracks(key) ON DELETE CASCADE,
  module_key text NOT NULL,
  module_number int,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (track_key, module_key)
);

CREATE INDEX IF NOT EXISTS idx_study_modules_track_sort ON public.study_modules(track_key, sort_order);

DROP TRIGGER IF EXISTS trg_study_modules_updated_at ON public.study_modules;
CREATE TRIGGER trg_study_modules_updated_at
  BEFORE UPDATE ON public.study_modules
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.study_problems (
  id bigserial PRIMARY KEY,
  problem_lc int NOT NULL UNIQUE,
  track_key text NOT NULL REFERENCES public.study_tracks(key) ON DELETE RESTRICT,
  module_id bigint REFERENCES public.study_modules(id) ON DELETE SET NULL,
  source_type text NOT NULL CHECK (source_type IN ('neetcode', 'companion')),
  title text NOT NULL,
  slug text,
  difficulty text,
  tier int CHECK (tier BETWEEN 1 AND 3),
  phase_order int NOT NULL DEFAULT 0,
  study_order int NOT NULL DEFAULT 0,
  curation_source text,
  category text,
  companies jsonb NOT NULL DEFAULT '[]'::jsonb,
  leetcode_url text,
  neetcode_url text,
  is_active boolean NOT NULL DEFAULT true,
  legacy_problem_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(companies) = 'array')
);

ALTER TABLE public.study_problems
  ADD COLUMN IF NOT EXISTS phase_order int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_study_problems_track_order ON public.study_problems(track_key, tier, study_order, problem_lc);
CREATE INDEX IF NOT EXISTS idx_study_problems_module ON public.study_problems(module_id, tier, study_order);
CREATE INDEX IF NOT EXISTS idx_study_problems_source_type ON public.study_problems(source_type);

DROP TRIGGER IF EXISTS trg_study_problems_updated_at ON public.study_problems;
CREATE TRIGGER trg_study_problems_updated_at
  BEFORE UPDATE ON public.study_problems
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.problem_relationships (
  id bigserial PRIMARY KEY,
  from_problem_lc int NOT NULL REFERENCES public.study_problems(problem_lc) ON DELETE CASCADE,
  to_problem_lc int NOT NULL REFERENCES public.study_problems(problem_lc) ON DELETE CASCADE,
  relationship_type text NOT NULL CHECK (relationship_type IN ('companion', 'related', 'followup')),
  label text,
  notes text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_problem_lc, to_problem_lc, relationship_type),
  CHECK (from_problem_lc <> to_problem_lc)
);

CREATE INDEX IF NOT EXISTS idx_problem_relationships_from_type ON public.problem_relationships(from_problem_lc, relationship_type, sort_order);
CREATE INDEX IF NOT EXISTS idx_problem_relationships_to_type ON public.problem_relationships(to_problem_lc, relationship_type, sort_order);

DROP TRIGGER IF EXISTS trg_problem_relationships_updated_at ON public.problem_relationships;
CREATE TRIGGER trg_problem_relationships_updated_at
  BEFORE UPDATE ON public.problem_relationships
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

ALTER TABLE public.study_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_problems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.problem_relationships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS study_tracks_read_authenticated ON public.study_tracks;
CREATE POLICY study_tracks_read_authenticated ON public.study_tracks
  FOR SELECT USING (current_user_key() IS NOT NULL);

DROP POLICY IF EXISTS study_modules_read_authenticated ON public.study_modules;
CREATE POLICY study_modules_read_authenticated ON public.study_modules
  FOR SELECT USING (current_user_key() IS NOT NULL);

DROP POLICY IF EXISTS study_problems_read_authenticated ON public.study_problems;
CREATE POLICY study_problems_read_authenticated ON public.study_problems
  FOR SELECT USING (current_user_key() IS NOT NULL);

DROP POLICY IF EXISTS problem_relationships_read_authenticated ON public.problem_relationships;
CREATE POLICY problem_relationships_read_authenticated ON public.problem_relationships
  FOR SELECT USING (current_user_key() IS NOT NULL);

DROP POLICY IF EXISTS study_tracks_admin_manage ON public.study_tracks;
CREATE POLICY study_tracks_admin_manage ON public.study_tracks
  FOR ALL USING (is_admin_user()) WITH CHECK (is_admin_user());

DROP POLICY IF EXISTS study_modules_admin_manage ON public.study_modules;
CREATE POLICY study_modules_admin_manage ON public.study_modules
  FOR ALL USING (is_admin_user()) WITH CHECK (is_admin_user());

DROP POLICY IF EXISTS study_problems_admin_manage ON public.study_problems;
CREATE POLICY study_problems_admin_manage ON public.study_problems
  FOR ALL USING (is_admin_user()) WITH CHECK (is_admin_user());

DROP POLICY IF EXISTS problem_relationships_admin_manage ON public.problem_relationships;
CREATE POLICY problem_relationships_admin_manage ON public.problem_relationships
  FOR ALL USING (is_admin_user()) WITH CHECK (is_admin_user());

INSERT INTO public.study_tracks (key, name, sort_order, is_active)
VALUES ('dsa', 'DSA', 1, true)
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active;

INSERT INTO public.study_modules (track_key, module_key, module_number, name, sort_order, description, is_active)
SELECT
  'dsa'::text,
  format('phase-%s', p.phase),
  p.phase,
  p.phase_name,
  p.phase,
  NULL,
  true
FROM public.problems p
WHERE p.phase IS NOT NULL
GROUP BY p.phase, p.phase_name
ON CONFLICT (track_key, module_key) DO UPDATE
SET module_number = EXCLUDED.module_number,
    name = EXCLUDED.name,
    sort_order = EXCLUDED.sort_order,
    is_active = true;

WITH legacy_rows AS (
  SELECT
    p.id AS legacy_problem_id,
    p.phase,
    p.phase_order,
    'dsa'::text AS track_key,
    format('phase-%s', p.phase) AS module_key,
    'neetcode'::text AS source_type,
    p.nc_lc AS problem_lc,
    p.nc_title AS title,
    p.nc_slug AS slug,
    p.nc_difficulty AS difficulty,
    COALESCE(p.nc_tier, p.tier) AS tier,
    'core'::text AS curation_source,
    p.nc_category AS category,
    COALESCE(p.nc_companies, '[]'::jsonb) AS companies,
    p.nc_leetcode_url AS leetcode_url,
    p.nc_neetcode_url AS neetcode_url,
    true AS is_active
  FROM public.problems p
  WHERE p.nc_lc IS NOT NULL
  UNION ALL
  SELECT
    p.id AS legacy_problem_id,
    p.phase,
    p.phase_order,
    'dsa'::text AS track_key,
    format('phase-%s', p.phase) AS module_key,
    'companion'::text AS source_type,
    p.cp_lc AS problem_lc,
    p.cp_title AS title,
    p.cp_slug AS slug,
    p.cp_difficulty AS difficulty,
    COALESCE(p.cp_tier, LEAST(3, p.tier + 1)) AS tier,
    'companion_set'::text AS curation_source,
    p.cp_pattern_connection AS category,
    COALESCE(p.cp_companies, '[]'::jsonb) AS companies,
    p.cp_leetcode_url AS leetcode_url,
    NULL::text AS neetcode_url,
    true AS is_active
  FROM public.problems p
  WHERE p.cp_lc IS NOT NULL
), ordered AS (
  SELECT
    lr.*,
    ROW_NUMBER() OVER (
      ORDER BY COALESCE(lr.tier, 999), COALESCE(lr.phase, 999), COALESCE(lr.phase_order, 999), lr.problem_lc
    ) AS derived_study_order
  FROM legacy_rows lr
)
INSERT INTO public.study_problems (
  problem_lc,
  track_key,
  module_id,
  source_type,
  title,
  slug,
  difficulty,
  tier,
  phase_order,
  study_order,
  curation_source,
  category,
  companies,
  leetcode_url,
  neetcode_url,
  is_active,
  legacy_problem_id
)
SELECT
  ordered.problem_lc,
  ordered.track_key,
  sm.id,
  ordered.source_type,
  ordered.title,
  ordered.slug,
  ordered.difficulty,
  ordered.tier,
  ordered.phase_order,
  ordered.derived_study_order,
  ordered.curation_source,
  ordered.category,
  ordered.companies,
  ordered.leetcode_url,
  ordered.neetcode_url,
  ordered.is_active,
  ordered.legacy_problem_id
FROM ordered
LEFT JOIN public.study_modules sm
  ON sm.track_key = ordered.track_key
 AND sm.module_key = ordered.module_key
ON CONFLICT (problem_lc) DO UPDATE
SET track_key = EXCLUDED.track_key,
    module_id = EXCLUDED.module_id,
    source_type = EXCLUDED.source_type,
    title = EXCLUDED.title,
    slug = EXCLUDED.slug,
    difficulty = EXCLUDED.difficulty,
    tier = EXCLUDED.tier,
    phase_order = EXCLUDED.phase_order,
    study_order = EXCLUDED.study_order,
    curation_source = EXCLUDED.curation_source,
    category = EXCLUDED.category,
    companies = EXCLUDED.companies,
    leetcode_url = EXCLUDED.leetcode_url,
    neetcode_url = EXCLUDED.neetcode_url,
    is_active = EXCLUDED.is_active,
    legacy_problem_id = EXCLUDED.legacy_problem_id;

INSERT INTO public.problem_relationships (
  from_problem_lc,
  to_problem_lc,
  relationship_type,
  label,
  notes,
  sort_order
)
SELECT
  p.nc_lc,
  p.cp_lc,
  'companion'::text,
  NULLIF(trim(p.cp_pattern_connection), ''),
  NULLIF(trim(p.cp_why), ''),
  1
FROM public.problems p
WHERE p.nc_lc IS NOT NULL
  AND p.cp_lc IS NOT NULL
UNION ALL
SELECT
  p.cp_lc,
  p.nc_lc,
  'companion'::text,
  NULLIF(trim(p.cp_pattern_connection), ''),
  NULLIF(trim(p.cp_why), ''),
  1
FROM public.problems p
WHERE p.nc_lc IS NOT NULL
  AND p.cp_lc IS NOT NULL
ON CONFLICT (from_problem_lc, to_problem_lc, relationship_type) DO UPDATE
SET label = EXCLUDED.label,
    notes = EXCLUDED.notes,
    sort_order = EXCLUDED.sort_order;

DROP VIEW IF EXISTS public.v_study_problems;

CREATE VIEW public.v_study_problems AS
SELECT
  sp.id,
  sp.problem_lc,
  sp.track_key,
  sp.track_key AS track,
  sp.source_type,
  sp.source_type AS type,
  sm.id AS module_id,
  sm.module_key,
  sm.module_number AS phase,
  sm.name AS phase_name,
  sp.phase_order,
  sp.tier,
  sp.study_order,
  sp.title,
  sp.slug,
  sp.difficulty,
  sp.category,
  sp.companies,
  sp.leetcode_url,
  sp.neetcode_url,
  sp.is_active,
  sp.legacy_problem_id,
  comp.problem_lc AS companion_lc,
  comp.title AS companion_title,
  comp.slug AS companion_slug,
  comp.difficulty AS companion_difficulty,
  comp.tier AS companion_tier,
  comp.companies AS companion_companies,
  comp.leetcode_url AS companion_leetcode_url,
  comp.neetcode_url AS companion_neetcode_url,
  comp.source_type AS companion_source_type,
  rel.label AS companion_relation_label,
  rel.notes AS companion_relation_notes
FROM public.study_problems sp
LEFT JOIN public.study_modules sm ON sm.id = sp.module_id
LEFT JOIN LATERAL (
  SELECT pr.to_problem_lc, pr.label, pr.notes
  FROM public.problem_relationships pr
  WHERE pr.from_problem_lc = sp.problem_lc
    AND pr.relationship_type = 'companion'
  ORDER BY pr.sort_order, pr.id
  LIMIT 1
) rel ON true
LEFT JOIN public.study_problems comp ON comp.problem_lc = rel.to_problem_lc
WHERE sp.is_active = true;

GRANT SELECT ON public.v_study_problems TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.notify_problem_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_key text;
  module_number_value int;
  module_name_value text;
BEGIN
  actor_key := COALESCE(current_user_key(), 'SYSTEM');

  SELECT sm.module_number, sm.name
  INTO module_number_value, module_name_value
  FROM public.study_modules sm
  WHERE sm.id = NEW.module_id;

  PERFORM public.create_notifications_for_other_users(
    actor_key,
    'problem_added',
    NEW.problem_lc,
    jsonb_build_object(
      'problem_lc', NEW.problem_lc,
      'title', NEW.title,
      'track', NEW.track_key,
      'source_type', NEW.source_type,
      'phase', module_number_value,
      'phase_name', module_name_value,
      'tier', NEW.tier
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_problems_notify_insert ON public.problems;
DROP TRIGGER IF EXISTS trg_study_problems_notify_insert ON public.study_problems;
CREATE TRIGGER trg_study_problems_notify_insert
  AFTER INSERT ON public.study_problems
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_problem_insert();

CREATE OR REPLACE FUNCTION public.reconcile_progress_for_pair(p_user_key text, p_problem_lc int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_passed_submit boolean;
  v_problem_type text;
  v_now timestamptz := now();
BEGIN
  IF p_user_key IS NULL OR p_problem_lc IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.code_runs cr
    WHERE cr.user_key = p_user_key
      AND cr.problem_lc = p_problem_lc
      AND cr.status = 'passed'
      AND lower(coalesce(cr.runner_meta ->> 'mode', '')) = 'submit'
  )
  INTO v_has_passed_submit;

  SELECT CASE
    WHEN sp.source_type IN ('neetcode', 'companion') THEN sp.source_type
    ELSE 'neetcode'
  END
  INTO v_problem_type
  FROM public.study_problems sp
  WHERE sp.problem_lc = p_problem_lc
  LIMIT 1;

  v_problem_type := COALESCE(v_problem_type, 'neetcode');

  IF v_has_passed_submit THEN
    INSERT INTO public.progress (
      user_key,
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
      p_user_key,
      p_problem_lc,
      v_problem_type,
      'solved',
      NULL,
      0,
      v_now,
      v_now,
      false
    )
    ON CONFLICT (user_key, problem_lc)
    DO UPDATE
      SET status = 'solved',
          solved_at = COALESCE(public.progress.solved_at, excluded.solved_at),
          last_reviewed = v_now,
          problem_type = COALESCE(public.progress.problem_type, excluded.problem_type);
  ELSE
    UPDATE public.progress p
      SET status = 'unsolved',
          solved_at = NULL,
          last_reviewed = v_now
    WHERE p.user_key = p_user_key
      AND p.problem_lc = p_problem_lc
      AND p.status = 'solved';
  END IF;
END;
$$;

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
  solved_title text;
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

  IF broadcast_mode = 'every_solve' THEN
    SELECT COALESCE(sp.title, '')
    INTO solved_title
    FROM public.study_problems sp
    WHERE sp.problem_lc = NEW.problem_lc
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

  SELECT sp.tier
  INTO solved_tier
  FROM public.study_problems sp
  WHERE sp.problem_lc = NEW.problem_lc
    AND sp.track_key = 'dsa'
    AND sp.is_active = true
  LIMIT 1;

  IF solved_tier IS NULL THEN
    RETURN NEW;
  END IF;

  WITH tier_problem_lcs AS (
    SELECT sp.problem_lc AS lc
    FROM public.study_problems sp
    WHERE sp.track_key = 'dsa'
      AND sp.is_active = true
      AND sp.tier = solved_tier
  )
  SELECT count(*) INTO tier_total FROM tier_problem_lcs;

  WITH tier_problem_lcs AS (
    SELECT sp.problem_lc AS lc
    FROM public.study_problems sp
    WHERE sp.track_key = 'dsa'
      AND sp.is_active = true
      AND sp.tier = solved_tier
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

COMMIT;
