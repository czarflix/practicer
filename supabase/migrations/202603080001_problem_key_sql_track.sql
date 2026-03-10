BEGIN;

INSERT INTO public.study_tracks (key, name, sort_order, is_active)
VALUES ('sql', 'SQL', 2, true)
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active;

ALTER TABLE public.study_problems
  ADD COLUMN IF NOT EXISTS problem_key text,
  ADD COLUMN IF NOT EXISTS source_platform text,
  ADD COLUMN IF NOT EXISTS source_problem_id text,
  ADD COLUMN IF NOT EXISTS canonical_source_url text,
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS faang_verification text,
  ADD COLUMN IF NOT EXISTS inclusion_rationale text;

ALTER TABLE public.study_problems
  ALTER COLUMN problem_lc DROP NOT NULL;

ALTER TABLE public.study_problems
  DROP CONSTRAINT IF EXISTS study_problems_source_type_check;

ALTER TABLE public.study_problems
  ADD CONSTRAINT study_problems_source_type_check
  CHECK (source_type IN ('neetcode', 'companion', 'core'));

UPDATE public.study_problems
SET problem_key = COALESCE(problem_key, CASE
      WHEN track_key = 'dsa' AND problem_lc IS NOT NULL THEN format('dsa-leetcode-%s', problem_lc)
      ELSE format('%s-%s', track_key, id)
    END),
    source_platform = COALESCE(source_platform, CASE WHEN track_key = 'dsa' THEN 'leetcode' ELSE track_key END),
    source_problem_id = COALESCE(source_problem_id, CASE WHEN problem_lc IS NOT NULL THEN problem_lc::text ELSE title END)
WHERE problem_key IS NULL OR source_platform IS NULL OR source_problem_id IS NULL;

ALTER TABLE public.study_problems
  ALTER COLUMN problem_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_study_problems_problem_key ON public.study_problems(problem_key);
CREATE INDEX IF NOT EXISTS idx_study_problems_track_problem_key ON public.study_problems(track_key, problem_key);

ALTER TABLE public.problem_relationships
  ADD COLUMN IF NOT EXISTS from_problem_key text,
  ADD COLUMN IF NOT EXISTS to_problem_key text;

UPDATE public.problem_relationships pr
SET from_problem_key = sp_from.problem_key,
    to_problem_key = sp_to.problem_key
FROM public.study_problems sp_from,
     public.study_problems sp_to
WHERE sp_from.problem_lc = pr.from_problem_lc
  AND sp_to.problem_lc = pr.to_problem_lc
  AND (pr.from_problem_key IS NULL OR pr.to_problem_key IS NULL);

CREATE INDEX IF NOT EXISTS idx_problem_relationships_from_problem_key ON public.problem_relationships(from_problem_key, relationship_type, sort_order);
CREATE INDEX IF NOT EXISTS idx_problem_relationships_to_problem_key ON public.problem_relationships(to_problem_key, relationship_type, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS ux_problem_relationships_problem_key_type
  ON public.problem_relationships(from_problem_key, to_problem_key, relationship_type)
  WHERE from_problem_key IS NOT NULL AND to_problem_key IS NOT NULL;

ALTER TABLE public.problem_content
  ADD COLUMN IF NOT EXISTS content_id bigserial,
  ADD COLUMN IF NOT EXISTS problem_key text,
  ADD COLUMN IF NOT EXISTS statement_raw text,
  ADD COLUMN IF NOT EXISTS statement_clean text,
  ADD COLUMN IF NOT EXISTS constraints_text text,
  ADD COLUMN IF NOT EXISTS starter_snippet text,
  ADD COLUMN IF NOT EXISTS editor_language text,
  ADD COLUMN IF NOT EXISTS runtime_kind text;

UPDATE public.problem_content pc
SET problem_key = sp.problem_key,
    statement_raw = COALESCE(pc.statement_raw, pc.problem_description),
    statement_clean = COALESCE(pc.statement_clean, pc.problem_description),
    constraints_text = COALESCE(pc.constraints_text, ''),
    starter_snippet = COALESCE(pc.starter_snippet, pc.starter_code),
    editor_language = COALESCE(pc.editor_language, 'python'),
    runtime_kind = COALESCE(pc.runtime_kind, 'python_problem')
FROM public.study_problems sp
WHERE sp.problem_lc = pc.problem_lc
  AND (pc.problem_key IS NULL OR pc.statement_raw IS NULL OR pc.statement_clean IS NULL OR pc.editor_language IS NULL OR pc.runtime_kind IS NULL);

ALTER TABLE public.problem_test_cases DROP CONSTRAINT IF EXISTS problem_test_cases_problem_lc_fkey;
ALTER TABLE public.code_runs DROP CONSTRAINT IF EXISTS code_runs_problem_lc_fkey;

UPDATE public.problem_content
SET content_id = nextval(pg_get_serial_sequence('public.problem_content', 'content_id'))
WHERE content_id IS NULL;

ALTER TABLE public.problem_content DROP CONSTRAINT IF EXISTS problem_content_problem_lc_key;
ALTER TABLE public.problem_content DROP CONSTRAINT IF EXISTS problem_content_pkey;
ALTER TABLE public.problem_content ALTER COLUMN problem_lc DROP NOT NULL;
ALTER TABLE public.problem_content ALTER COLUMN content_id SET NOT NULL;
ALTER TABLE public.problem_content ADD CONSTRAINT problem_content_pkey PRIMARY KEY (content_id);
ALTER TABLE public.problem_content ADD CONSTRAINT problem_content_problem_lc_key UNIQUE (problem_lc);
CREATE UNIQUE INDEX IF NOT EXISTS ux_problem_content_problem_key ON public.problem_content(problem_key) WHERE problem_key IS NOT NULL;

ALTER TABLE public.problem_test_cases
  ADD CONSTRAINT problem_test_cases_problem_lc_fkey
  FOREIGN KEY (problem_lc) REFERENCES public.problem_content(problem_lc) ON DELETE CASCADE;

ALTER TABLE public.code_runs
  ADD CONSTRAINT code_runs_problem_lc_fkey
  FOREIGN KEY (problem_lc) REFERENCES public.problem_content(problem_lc) ON DELETE CASCADE;

ALTER TABLE public.problem_test_cases
  ADD COLUMN IF NOT EXISTS problem_key text;
UPDATE public.problem_test_cases ptc
SET problem_key = pc.problem_key
FROM public.problem_content pc
WHERE pc.problem_lc = ptc.problem_lc
  AND ptc.problem_key IS NULL;
CREATE INDEX IF NOT EXISTS idx_problem_test_cases_problem_key ON public.problem_test_cases(problem_key, is_active);

ALTER TABLE public.code_runs
  ADD COLUMN IF NOT EXISTS problem_key text,
  ADD COLUMN IF NOT EXISTS track_key text;
UPDATE public.code_runs cr
SET problem_key = sp.problem_key,
    track_key = sp.track_key
FROM public.study_problems sp
WHERE sp.problem_lc = cr.problem_lc
  AND (cr.problem_key IS NULL OR cr.track_key IS NULL);
ALTER TABLE public.code_runs ALTER COLUMN problem_lc DROP NOT NULL;
ALTER TABLE public.code_runs DROP CONSTRAINT IF EXISTS code_runs_language_check;
ALTER TABLE public.code_runs ADD CONSTRAINT code_runs_language_check CHECK (language IN ('python', 'sql'));
CREATE INDEX IF NOT EXISTS idx_code_runs_problem_key_created ON public.code_runs(problem_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_code_runs_user_problem_key_created ON public.code_runs(user_key, problem_key, created_at DESC);

ALTER TABLE public.progress
  ADD COLUMN IF NOT EXISTS problem_key text;
UPDATE public.progress p
SET problem_key = sp.problem_key
FROM public.study_problems sp
WHERE sp.problem_lc = p.problem_lc
  AND p.problem_key IS NULL;
ALTER TABLE public.progress ALTER COLUMN problem_lc DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_progress_user_problem_key ON public.progress(user_key, problem_key);
CREATE UNIQUE INDEX IF NOT EXISTS ux_progress_user_problem_key ON public.progress(user_key, problem_key) WHERE problem_key IS NOT NULL;

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS problem_key text;
UPDATE public.notes n
SET problem_key = sp.problem_key
FROM public.study_problems sp
WHERE sp.problem_lc = n.problem_lc
  AND n.problem_key IS NULL;
ALTER TABLE public.notes ALTER COLUMN problem_lc DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notes_user_problem_key ON public.notes(user_key, problem_key);

ALTER TABLE public.solutions
  ADD COLUMN IF NOT EXISTS problem_key text;
UPDATE public.solutions s
SET problem_key = sp.problem_key
FROM public.study_problems sp
WHERE sp.problem_lc = s.problem_lc
  AND s.problem_key IS NULL;
ALTER TABLE public.solutions ALTER COLUMN problem_lc DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_solutions_user_problem_key ON public.solutions(user_key, problem_key);

ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS problem_key text;
UPDATE public.resources r
SET problem_key = sp.problem_key
FROM public.study_problems sp
WHERE sp.problem_lc = r.problem_lc
  AND r.problem_key IS NULL;
ALTER TABLE public.resources ALTER COLUMN problem_lc DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_resources_user_problem_key ON public.resources(user_key, problem_key);

ALTER TABLE public.user_problem_overrides
  ADD COLUMN IF NOT EXISTS problem_key text;
UPDATE public.user_problem_overrides u
SET problem_key = sp.problem_key
FROM public.study_problems sp
WHERE sp.problem_lc = u.problem_lc
  AND u.problem_key IS NULL;
ALTER TABLE public.user_problem_overrides ALTER COLUMN problem_lc DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_problem_overrides_problem_key ON public.user_problem_overrides(user_key, problem_key) WHERE problem_key IS NOT NULL;

ALTER TABLE public.problem_comments
  ADD COLUMN IF NOT EXISTS problem_key text;
UPDATE public.problem_comments c
SET problem_key = sp.problem_key
FROM public.study_problems sp
WHERE sp.problem_lc = c.problem_lc
  AND c.problem_key IS NULL;
ALTER TABLE public.problem_comments ALTER COLUMN problem_lc DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_problem_comments_problem_key_created ON public.problem_comments(problem_key, parent_comment_id, created_at ASC);

ALTER TABLE public.shared_notes
  ADD COLUMN IF NOT EXISTS problem_key text;
UPDATE public.shared_notes n
SET problem_key = sp.problem_key
FROM public.study_problems sp
WHERE sp.problem_lc = n.problem_lc
  AND n.problem_key IS NULL;
ALTER TABLE public.shared_notes ALTER COLUMN problem_lc DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shared_notes_problem_key_created ON public.shared_notes(problem_key, created_at DESC);

ALTER TABLE public.shared_solutions
  ADD COLUMN IF NOT EXISTS problem_key text;
UPDATE public.shared_solutions s
SET problem_key = sp.problem_key
FROM public.study_problems sp
WHERE sp.problem_lc = s.problem_lc
  AND s.problem_key IS NULL;
ALTER TABLE public.shared_solutions ALTER COLUMN problem_lc DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shared_solutions_problem_key_created ON public.shared_solutions(problem_key, created_at DESC);

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS problem_key text,
  ADD COLUMN IF NOT EXISTS track_key text;
UPDATE public.notifications n
SET problem_key = sp.problem_key,
    track_key = sp.track_key
FROM public.study_problems sp
WHERE sp.problem_lc = n.problem_lc
  AND (n.problem_key IS NULL OR n.track_key IS NULL);
CREATE INDEX IF NOT EXISTS idx_notifications_problem_key_created ON public.notifications(problem_key, created_at DESC);

ALTER TABLE public.study_events
  ADD COLUMN IF NOT EXISTS problem_key text;
UPDATE public.study_events e
SET problem_key = sp.problem_key
FROM public.study_problems sp
WHERE sp.problem_lc = e.problem_lc
  AND e.problem_key IS NULL;
CREATE INDEX IF NOT EXISTS idx_study_events_user_problem_key ON public.study_events(user_key, problem_key, created_at DESC);

ALTER TABLE public.targets
  ADD COLUMN IF NOT EXISTS track_key text NOT NULL DEFAULT 'dsa';
CREATE INDEX IF NOT EXISTS idx_targets_user_track_deadline ON public.targets(user_key, track_key, deadline);

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS active_track_key text NOT NULL DEFAULT 'dsa';

CREATE TABLE IF NOT EXISTS public.sql_problem_specs (
  id bigserial PRIMARY KEY,
  problem_key text NOT NULL REFERENCES public.study_problems(problem_key) ON DELETE CASCADE,
  dialect_original text NOT NULL,
  dialect_runtime text NOT NULL DEFAULT 'postgres14',
  submission_kind text NOT NULL CHECK (submission_kind IN ('query', 'script')),
  result_mode text NOT NULL CHECK (result_mode IN ('direct_result', 'postcheck_query')),
  starter_sql text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (problem_key)
);
CREATE INDEX IF NOT EXISTS idx_sql_problem_specs_runtime ON public.sql_problem_specs(dialect_runtime, submission_kind);
DROP TRIGGER IF EXISTS trg_sql_problem_specs_updated_at ON public.sql_problem_specs;
CREATE TRIGGER trg_sql_problem_specs_updated_at
  BEFORE UPDATE ON public.sql_problem_specs
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.sql_problem_fixtures (
  id bigserial PRIMARY KEY,
  problem_key text NOT NULL REFERENCES public.study_problems(problem_key) ON DELETE CASCADE,
  fixture_key text NOT NULL,
  label text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_public boolean NOT NULL DEFAULT false,
  setup_sql text NOT NULL,
  postcheck_sql text,
  expected_columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  comparison_mode text NOT NULL CHECK (comparison_mode IN ('ordered_rows', 'unordered_multiset', 'single_value', 'single_row')),
  order_required boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  coverage_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (problem_key, fixture_key)
);
CREATE INDEX IF NOT EXISTS idx_sql_problem_fixtures_problem_sort ON public.sql_problem_fixtures(problem_key, sort_order);
CREATE INDEX IF NOT EXISTS idx_sql_problem_fixtures_public ON public.sql_problem_fixtures(problem_key, is_public, is_active);
DROP TRIGGER IF EXISTS trg_sql_problem_fixtures_updated_at ON public.sql_problem_fixtures;
CREATE TRIGGER trg_sql_problem_fixtures_updated_at
  BEFORE UPDATE ON public.sql_problem_fixtures
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.sql_problem_reference_solutions (
  id bigserial PRIMARY KEY,
  problem_key text NOT NULL REFERENCES public.study_problems(problem_key) ON DELETE CASCADE,
  reference_sql_original text,
  reference_sql_runtime text,
  provenance_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (problem_key)
);
DROP TRIGGER IF EXISTS trg_sql_problem_reference_solutions_updated_at ON public.sql_problem_reference_solutions;
CREATE TRIGGER trg_sql_problem_reference_solutions_updated_at
  BEFORE UPDATE ON public.sql_problem_reference_solutions
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

ALTER TABLE public.sql_problem_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sql_problem_fixtures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sql_problem_reference_solutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sql_problem_specs_read_authenticated ON public.sql_problem_specs;
CREATE POLICY sql_problem_specs_read_authenticated ON public.sql_problem_specs
  FOR SELECT USING (current_user_key() IS NOT NULL);
DROP POLICY IF EXISTS sql_problem_fixtures_read_authenticated ON public.sql_problem_fixtures;
CREATE POLICY sql_problem_fixtures_read_authenticated ON public.sql_problem_fixtures
  FOR SELECT USING (current_user_key() IS NOT NULL);
DROP POLICY IF EXISTS sql_problem_reference_solutions_admin_manage ON public.sql_problem_reference_solutions;
CREATE POLICY sql_problem_reference_solutions_admin_manage ON public.sql_problem_reference_solutions
  FOR ALL USING (is_admin_user()) WITH CHECK (is_admin_user());
DROP POLICY IF EXISTS sql_problem_specs_admin_manage ON public.sql_problem_specs;
CREATE POLICY sql_problem_specs_admin_manage ON public.sql_problem_specs
  FOR ALL USING (is_admin_user()) WITH CHECK (is_admin_user());
DROP POLICY IF EXISTS sql_problem_fixtures_admin_manage ON public.sql_problem_fixtures;
CREATE POLICY sql_problem_fixtures_admin_manage ON public.sql_problem_fixtures
  FOR ALL USING (is_admin_user()) WITH CHECK (is_admin_user());

DROP VIEW IF EXISTS public.v_study_problems;
CREATE VIEW public.v_study_problems AS
SELECT
  sp.id,
  sp.problem_key,
  sp.problem_lc,
  sp.track_key,
  sp.track_key AS track,
  sp.source_type,
  sp.source_type AS type,
  sp.source_platform,
  sp.source_problem_id,
  sp.canonical_source_url,
  sp.source_url,
  sp.faang_verification,
  sp.inclusion_rationale,
  sm.id AS module_id,
  sm.module_key,
  sm.module_number AS phase,
  sm.name AS phase_name,
  sm.description AS phase_description,
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
  comp.problem_key AS companion_problem_key,
  comp.problem_lc AS companion_lc,
  comp.title AS companion_title,
  comp.slug AS companion_slug,
  comp.difficulty AS companion_difficulty,
  comp.tier AS companion_tier,
  comp.companies AS companion_companies,
  comp.leetcode_url AS companion_leetcode_url,
  comp.neetcode_url AS companion_neetcode_url,
  comp.source_type AS companion_source_type,
  comp.source_platform AS companion_source_platform,
  comp.source_problem_id AS companion_source_problem_id,
  rel.label AS companion_relation_label,
  rel.notes AS companion_relation_notes
FROM public.study_problems sp
LEFT JOIN public.study_modules sm ON sm.id = sp.module_id
LEFT JOIN LATERAL (
  SELECT pr.to_problem_key, pr.label, pr.notes
  FROM public.problem_relationships pr
  WHERE pr.from_problem_key = sp.problem_key
    AND pr.relationship_type = 'companion'
  ORDER BY pr.sort_order, pr.id
  LIMIT 1
) rel ON true
LEFT JOIN public.study_problems comp ON comp.problem_key = rel.to_problem_key
WHERE sp.is_active = true;
GRANT SELECT ON public.v_study_problems TO authenticated, anon;

COMMIT;
