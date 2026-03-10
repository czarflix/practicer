BEGIN;

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS dashboard_comparison_mode text NOT NULL DEFAULT 'compare';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_settings_dashboard_comparison_mode_check'
      AND conrelid = 'public.user_settings'::regclass
  ) THEN
    ALTER TABLE public.user_settings
      ADD CONSTRAINT user_settings_dashboard_comparison_mode_check
      CHECK (dashboard_comparison_mode IN ('compare', 'mine'));
  END IF;
END $$;

UPDATE public.user_settings
SET dashboard_comparison_mode = 'compare'
WHERE dashboard_comparison_mode IS NULL;

COMMIT;
