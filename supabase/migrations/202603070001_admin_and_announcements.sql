-- Migration: admin role + announcement notifications + admin moderation policies

BEGIN;

-- 1. Add is_admin column to app_users
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;
UPDATE public.app_users SET is_admin = true WHERE user_key = 'AYAAN';

-- 2. Helper function to check if current user is admin
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.app_users WHERE user_key = current_user_key()),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin_user() TO authenticated, anon;

-- 3. Clean up any notification rows with invalid types, then add 'announcement'
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

DELETE FROM public.notifications WHERE type NOT IN (
  'comment_added', 'comment_replied', 'shared_solution', 'shared_note',
  'problem_added', 'test_case_added', 'test_case_updated',
  'daily_solved_milestone', 'tier_completed',
  'announcement'
);

ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'comment_added', 'comment_replied', 'shared_solution', 'shared_note',
    'problem_added', 'test_case_added', 'test_case_updated',
    'daily_solved_milestone', 'tier_completed',
    'announcement'
  )
);

ALTER TABLE public.notification_preferences DROP CONSTRAINT IF EXISTS notification_preferences_notification_type_check;
ALTER TABLE public.notification_preferences ADD CONSTRAINT notification_preferences_notification_type_check CHECK (
  notification_type IN (
    'comment_added', 'comment_replied', 'shared_solution', 'shared_note',
    'problem_added', 'test_case_added', 'test_case_updated',
    'daily_solved_milestone', 'tier_completed',
    'announcement'
  )
);

-- 4. Admin can INSERT notifications (for announcements)
DROP POLICY IF EXISTS notifications_admin_insert ON public.notifications;
CREATE POLICY notifications_admin_insert ON public.notifications
  FOR INSERT WITH CHECK (is_admin_user());

-- 5. Admin can DELETE any comment
DROP POLICY IF EXISTS comments_admin_delete ON public.problem_comments;
CREATE POLICY comments_admin_delete ON public.problem_comments
  FOR DELETE USING (is_admin_user());

-- 6. Admin can DELETE any shared solution
DROP POLICY IF EXISTS shared_solutions_admin_delete ON public.shared_solutions;
CREATE POLICY shared_solutions_admin_delete ON public.shared_solutions
  FOR DELETE USING (is_admin_user());

-- 7. Admin can DELETE any shared note
DROP POLICY IF EXISTS shared_notes_admin_delete ON public.shared_notes;
CREATE POLICY shared_notes_admin_delete ON public.shared_notes
  FOR DELETE USING (is_admin_user());

-- 8. Function to send announcement to all users
CREATE OR REPLACE FUNCTION public.send_announcement(
  p_admin_user_key text,
  p_title text,
  p_body text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify caller is admin
  IF NOT (SELECT is_admin FROM public.app_users WHERE user_key = p_admin_user_key) THEN
    RAISE EXCEPTION 'Only admins can send announcements';
  END IF;

  INSERT INTO public.notifications (
    recipient_user_key, actor_user_key, type, payload
  )
  SELECT
    app_user.user_key,
    p_admin_user_key,
    'announcement',
    jsonb_build_object('title', p_title, 'body', p_body)
  FROM public.app_users AS app_user
  LEFT JOIN public.notification_preferences AS pref
    ON pref.user_key = app_user.user_key
   AND pref.notification_type = 'announcement'
  WHERE app_user.user_key <> 'SYSTEM'
    AND COALESCE(pref.receive_enabled, true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_announcement(text, text, text) TO authenticated;

COMMIT;
