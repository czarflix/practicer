-- Admin + comparison: allow reading all users' progress
-- Needed for: (1) admin System tab analytics, (2) dashboard comparison widget

BEGIN;

-- Allow admins to read ALL progress rows
DROP POLICY IF EXISTS progress_admin_read ON public.progress;
CREATE POLICY progress_admin_read ON public.progress
  FOR SELECT USING (is_admin_user());

-- Allow all authenticated users to read others' progress (for comparison)
-- This is safe: progress only has status/solved_at, no private data
DROP POLICY IF EXISTS progress_read_authenticated ON public.progress;
CREATE POLICY progress_read_authenticated ON public.progress
  FOR SELECT USING (auth.role() = 'authenticated');

COMMIT;
